/* ═══════════════════════════════════════════════════════════════════════════
   OPAL CASE NOTES — therapist review surface for voice-to-case-note DRAFTS.

   Renders the whole Case Notes experience into #cn-root (inside the
   "Case Notes" tab). It is a THIN CLIENT over the existing, already-mounted
   /api/mobile/case-note-drafts routes (backend/case-note-routes.js). No new
   endpoint, no sync layer, no duplicated business logic.

   Conventions (mirrors resourcehub.js / supportpop.js):
     - single IIFE, string-built HTML, esc() on EVERY untrusted value
     - no raw-HTML passthrough anywhere; transcript/note render as text
     - pure helpers exported for node tests (casenotes-helpers.test.js)
     - delegated data-cn click/input handlers — no inline onclick carrying
       server-supplied ids into an attribute
     - backend enforces every boundary; the client only reflects it honestly

   NON-NEGOTIABLES ENCODED HERE:
     1. STRICTLY OWN ROWS. The list call is GET /api/mobile/case-note-drafts
        with NO query parameters — there is no user/therapist filter to pass
        and no cross-user or admin listing to build. Not-yours is 404 server
        side; this file never attempts it.
     2. DRAFTS STAY DRAFTS. No finalise, no approve, no send, no Splose or
        Outlook write, no "mark appointment documented". The only writes are
        PATCH (noteBody + plan), POST regenerate, DELETE (soft archive).
     3. SERVER-COMPOSED METADATA IS READ-ONLY. header.{clientName,
        clientAddress, serviceLine, sessionDateLabel}, identify and
        sessionDetails come from the linked appointment / the stored
        narrative snapshot. They render as muted metadata rows and NEVER
        appear inside a <textarea> or <input>. Only noteBody and plan are
        editable — exactly what PATCH accepts.
     4. NO CONTENT LEAVES. Transcript and note text are never logged, never
        put in a URL, never sent anywhere except the endpoints above. There
        is deliberately no console.* call in this file.
     5. FAIL-CLOSED GENERATION IS SURFACED HONESTLY. When the provider is
        not enabled the server answers 503 generation_unavailable; we show
        that message plus "Note generation is not enabled yet — you can
        still edit and save." and change nothing on screen. Never fabricate.

   Deliberately NOT integrated with the global Cmd+Z undo manager: clinical
   note text must have exactly one restore story (the server's stored draft),
   not a client-side stack that could silently reinstate superseded wording.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

(function (global) {

  // ── Pure helpers (node-exported for unit tests) ───────────────────────────

  var CN_MAX_PLAN_ITEMS = 20;

  function cnEsc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** Quiet relative time for the list ("Updated 2 hours ago"). */
  function cnRelativeTime(value, nowMs) {
    if (!value) return '';
    var t = new Date(value).getTime();
    if (!isFinite(t)) return '';
    var now = typeof nowMs === 'number' ? nowMs : Date.now();
    var secs = Math.round((now - t) / 1000);
    if (secs < 0) secs = 0;                       // clock skew reads as "just now"
    if (secs < 45) return 'just now';
    var mins = Math.round(secs / 60);
    if (mins < 60) return mins + (mins === 1 ? ' minute ago' : ' minutes ago');
    var hours = Math.round(mins / 60);
    if (hours < 24) return hours + (hours === 1 ? ' hour ago' : ' hours ago');
    var days = Math.round(hours / 24);
    if (days === 1) return 'yesterday';
    if (days < 7) return days + ' days ago';
    var d = new Date(t);
    return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  /**
   * Plan normaliser — matches the PATCH contract exactly: array of strings,
   * trimmed, empty rows dropped, at most 20 items.
   */
  function cnNormalisePlan(list) {
    if (!Array.isArray(list)) return [];
    var out = [];
    for (var i = 0; i < list.length && out.length < CN_MAX_PLAN_ITEMS; i++) {
      var v = list[i];
      if (typeof v !== 'string') { if (v == null) continue; v = String(v); }
      v = v.trim();
      if (v) out.push(v);
    }
    return out;
  }

  /** Dirty comparator — true when the editable fields differ from the draft. */
  function cnIsDirty(draft, edits) {
    if (!draft || !edits) return false;
    if (String(edits.noteBody == null ? '' : edits.noteBody) !== String(draft.noteBody == null ? '' : draft.noteBody)) return true;
    var a = cnNormalisePlan(edits.plan);
    var b = cnNormalisePlan(draft.plan);
    if (a.length !== b.length) return true;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return true;
    return false;
  }

  /**
   * Read-only metadata rows from the server-composed header. Missing values
   * are omitted rather than invented, mirroring buildHeader() on the server.
   */
  function cnMetaRows(header) {
    var h = header || {};
    return [
      { label: 'Client', value: h.clientName },
      { label: 'Address', value: h.clientAddress },
      { label: 'Service', value: h.serviceLine },
      { label: 'Session date', value: h.sessionDateLabel },
    ].filter(function (r) { return r.value != null && String(r.value).trim() !== ''; });
  }

  var helpers = {
    cnEsc: cnEsc,
    cnRelativeTime: cnRelativeTime,
    cnNormalisePlan: cnNormalisePlan,
    cnIsDirty: cnIsDirty,
    cnMetaRows: cnMetaRows,
    CN_MAX_PLAN_ITEMS: CN_MAX_PLAN_ITEMS,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = helpers;
  if (!global || !global.document) return; // node/test stops here

  var doc = global.document;
  var esc = cnEsc;

  // ── Constants ─────────────────────────────────────────────────────────────

  var API_BASE = '/api/mobile/case-note-drafts';
  var STATUS_LINE = 'Draft — saved in Opal only. Nothing is sent to Splose or Outlook.';
  var EMPTY_STATE = 'No case-note drafts yet. Notes recorded in the Opa mobile app appear here for review.';
  var METADATA_NOTE = 'These details come from the linked client record in Splose, or from the linked appointment in your calendar. They are not written by the AI and cannot be edited here.';
  var GENERATION_OFF = 'Note generation is not enabled yet — you can still edit and save.';
  var NOT_EDITABLE = 'This note is no longer editable';

  // ── State ─────────────────────────────────────────────────────────────────

  var S = {
    loaded: false,
    loading: false,
    listError: '',
    list: [],
    selectedId: null,
    draft: null,          // full draft from GET /:id
    detailLoading: false,
    detailError: '',
    edits: null,          // { noteBody: string, plan: string[] } — the ONLY editable fields
    saving: false,
    regenerating: false,
    archiving: false,
    msg: null,            // { kind: 'ok'|'warn'|'error'|'info', text }
    guard: null,          // { kind: 'select'|'leave', id, tab }
    transcriptOpen: false,
  };

  function icn(name, size) {
    if (typeof global.opIcon !== 'function') return '';
    return global.opIcon(name, size || 14);
  }

  function el(id) { return doc.getElementById(id); }

  // ── API ───────────────────────────────────────────────────────────────────
  // Session-cookie auth, same-origin. Nothing but the draft id ever appears
  // in a URL — never transcript or note text.

  async function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', credentials: 'include', headers: {} };
    if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    try {
      var r = await fetch(path, init);
      var data = await r.json().catch(function () { return {}; });
      if (!r.ok) {
        return {
          ok: false,
          status: r.status,
          code: data.code || '',
          error: data.error || ('Request failed (' + r.status + ')'),
        };
      }
      data.ok = true;
      return data;
    } catch (_) {
      return { ok: false, status: 0, code: '', error: 'Network error — please try again.' };
    }
  }

  function draftPath(id) { return API_BASE + '/' + encodeURIComponent(id); }

  // ── Derived state ─────────────────────────────────────────────────────────

  function isDirty() { return cnIsDirty(S.draft, S.edits); }
  function isEditable() { return !!(S.draft && S.draft.status === 'draft'); }
  function busy() { return S.saving || S.regenerating || S.archiving; }

  function setMsg(kind, text) { S.msg = text ? { kind: kind, text: text } : null; }

  // ── Loading ───────────────────────────────────────────────────────────────

  // Own drafts only. No query string: there is no user/therapist filter to
  // send, and the server scopes every row to the session user.
  async function loadList(keepSelection) {
    S.loading = true;
    S.listError = '';
    render();
    var d = await api(API_BASE);
    S.loading = false;
    S.loaded = true;
    if (!d.ok) {
      S.list = [];
      S.listError = d.error;
    } else {
      S.list = Array.isArray(d.caseNoteDrafts) ? d.caseNoteDrafts : [];
      if (!keepSelection || !S.list.some(function (x) { return x.id === S.selectedId; })) {
        if (!keepSelection) { S.selectedId = null; S.draft = null; S.edits = null; }
      }
    }
    render();
  }

  async function loadDraft(id) {
    S.detailLoading = true;
    S.detailError = '';
    render();
    var d = await api(draftPath(id));
    S.detailLoading = false;
    if (!d.ok) {
      S.detailError = d.status === 404 ? 'This draft is no longer available.' : d.error;
      S.draft = null;
      S.edits = null;
      render();
      return false;
    }
    adoptDraft(d.caseNoteDraft);
    render();
    return true;
  }

  /** Take the server's draft as the source of truth and reset local edits. */
  function adoptDraft(draft) {
    S.draft = draft || null;
    S.edits = draft
      ? { noteBody: draft.noteBody == null ? '' : String(draft.noteBody), plan: (draft.plan || []).map(String) }
      : null;
    if (draft) S.selectedId = draft.id;
  }

  // ── Selection + unsaved-changes guard ─────────────────────────────────────

  function select(id) {
    if (!id || id === S.selectedId) return;
    if (isDirty()) { S.guard = { kind: 'select', id: id }; render(); return; }
    S.guard = null;
    setMsg(null, '');
    S.transcriptOpen = false;
    S.selectedId = id;
    loadDraft(id);
  }

  function guardKeepEditing() {
    S.guard = null;
    render();
    var t = el('cn-note');
    if (t) { try { t.focus(); } catch (_) { /* not focusable yet */ } }
  }

  function guardDiscard() {
    var g = S.guard;
    S.guard = null;
    if (!g) { render(); return; }
    // Discard local edits only — nothing was ever sent to the server.
    if (S.draft) adoptDraft(S.draft);
    if (g.kind === 'select') {
      setMsg(null, '');
      S.transcriptOpen = false;
      S.selectedId = g.id;
      loadDraft(g.id);
      return;
    }
    if (g.kind === 'leave' && g.tab && typeof global.switchTab === 'function') {
      render();
      global.switchTab(g.tab);
      return;
    }
    render();
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  async function save() {
    if (!S.draft || busy() || !isEditable()) return;
    var noteBody = String(S.edits.noteBody == null ? '' : S.edits.noteBody);
    if (!noteBody.trim()) {
      setMsg('error', 'The note cannot be empty. Add some text before saving.');
      render();
      return;
    }
    var sent = { noteBody: noteBody, plan: cnNormalisePlan(S.edits.plan) };
    S.saving = true;
    setMsg('info', 'Saving…');
    render();

    var r = await api(draftPath(S.draft.id), { method: 'PATCH', body: sent });
    S.saving = false;

    if (!r.ok) {
      if (r.status === 409) {
        setMsg('warn', NOT_EDITABLE + '. Refreshing…');
        render();
        await loadList(true);
        await loadDraft(S.selectedId);
        setMsg('warn', NOT_EDITABLE + '.');
        render();
        return;
      }
      // 400 (and anything else): show the server's own message verbatim.
      setMsg('error', r.error);
      render();
      return;
    }

    // Typing does not stop while a request is in flight. Anything entered
    // after the payload was built must survive the response — clinical text
    // is never silently replaced by an older server copy.
    var typedDuringSave = cnIsDirty(sent, S.edits);
    var pending = { noteBody: S.edits.noteBody, plan: S.edits.plan.slice() };

    adoptDraft(r.caseNoteDraft);
    // Keep the list row's summary line in step with what was just saved.
    for (var i = 0; i < S.list.length; i++) {
      if (S.list[i].id === S.draft.id) S.list[i] = Object.assign({}, S.list[i], r.caseNoteDraft);
    }
    if (typedDuringSave) {
      S.edits = pending;
      setMsg('warn', 'Saved — but you kept typing while it saved, so those newer edits are still unsaved.');
    } else {
      setMsg('ok', 'Saved. This draft stays in Opal.');
    }
    render();
  }

  async function regenerate() {
    if (!S.draft || busy() || !isEditable()) return;
    if (isDirty()) {
      setMsg('warn', 'Save or discard your edits first — regenerating replaces the note text.');
      render();
      return;
    }
    S.regenerating = true;
    setMsg('info', 'Asking for a fresh draft…');
    render();

    var r = await api(draftPath(S.draft.id) + '/regenerate', { method: 'POST' });
    S.regenerating = false;

    if (!r.ok) {
      // Fail closed, honestly: nothing on screen changes, no invented text.
      var text = r.error;
      if (r.code === 'generation_unavailable') text = text + ' ' + GENERATION_OFF;
      setMsg('warn', text);
      render();
      return;
    }

    adoptDraft(r.caseNoteDraft);
    for (var i = 0; i < S.list.length; i++) {
      if (S.list[i].id === S.draft.id) S.list[i] = Object.assign({}, S.list[i], r.caseNoteDraft);
    }
    setMsg('ok', 'Draft regenerated from the original transcript.');
    render();
  }

  // Archive uses the app's styled danger-confirm modal (#modal-cn-archive),
  // the same modal-backdrop/.modal pattern as the calendar delete flow.
  function archiveAsk() {
    if (!S.draft || busy() || !isEditable()) return;
    var backdrop = el('modal-cn-archive');
    if (!backdrop) { archiveConfirm(); return; }
    var msg = el('cn-archive-msg');
    var head = el('cn-archive-title');
    if (head) head.innerHTML = icn('trash', 14) + ' Archive this draft';
    if (msg) {
      var name = (S.draft.header && S.draft.header.clientName) || 'this session';
      msg.textContent = 'Archive the case-note draft for ' + name + '?';
    }
    backdrop.classList.add('show');
    doc.addEventListener('keydown', archiveEscape);
    var cancel = el('cn-archive-cancel');
    if (cancel) { try { cancel.focus(); } catch (_) { /* hidden */ } }
  }

  function archiveClose() {
    var backdrop = el('modal-cn-archive');
    if (backdrop) backdrop.classList.remove('show');
    doc.removeEventListener('keydown', archiveEscape);
  }

  function archiveEscape(e) { if (e.key === 'Escape') archiveClose(); }

  async function archiveConfirm() {
    archiveClose();
    if (!S.draft || busy()) return;
    var id = S.draft.id;
    S.archiving = true;
    setMsg('info', 'Archiving…');
    render();

    var r = await api(draftPath(id), { method: 'DELETE' });
    S.archiving = false;

    if (!r.ok) {
      setMsg('error', r.error);
      render();
      return;
    }
    S.list = S.list.filter(function (x) { return x.id !== id; });
    S.selectedId = null;
    S.draft = null;
    S.edits = null;
    S.guard = null;
    setMsg('ok', 'Draft archived. It no longer appears in your list.');
    render();
  }

  // ── Plan row editing (the second — and last — editable field) ─────────────

  function planAdd() {
    if (!S.edits || !isEditable()) return;
    if (S.edits.plan.length >= CN_MAX_PLAN_ITEMS) return;
    S.edits.plan.push('');
    renderPlan();
    var rows = doc.querySelectorAll('#cn-plan-rows input[data-cn-input="plan"]');
    var last = rows[rows.length - 1];
    if (last) { try { last.focus(); } catch (_) { /* not focusable */ } }
    syncDirty();
  }

  function planRemove(idx) {
    if (!S.edits || !isEditable()) return;
    var i = Number(idx);
    if (!isFinite(i) || i < 0 || i >= S.edits.plan.length) return;
    S.edits.plan.splice(i, 1);
    renderPlan();
    syncDirty();
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  function autosize(node) {
    if (!node) return;
    node.style.height = 'auto';
    var h = Math.min(Math.max(node.scrollHeight + 2, 240), 1600);
    node.style.height = h + 'px';
  }

  function warnChip(draft) {
    var n = (draft.warnings || []).length;
    if (!n) return '';
    return '<span class="cn-chip">' + icn('info', 12) + ' ' + n + ' to check</span>';
  }

  function listItem(d) {
    var h = d.header || {};
    var active = d.id === S.selectedId;
    return '<button type="button" class="cn-item' + (active ? ' active' : '') + '"' +
      ' data-cn="select" data-cn-id="' + esc(d.id) + '"' +
      ' aria-current="' + (active ? 'true' : 'false') + '">' +
      '<span class="cn-item-top">' +
        '<span class="cn-item-name">' + esc(h.clientName || 'Session note') + '</span>' +
        '<span class="cn-item-when">' + esc(cnRelativeTime(d.updatedAt || d.createdAt)) + '</span>' +
      '</span>' +
      '<span class="cn-item-date">' + esc(h.sessionDateLabel || '') + '</span>' +
      (h.serviceLine ? '<span class="cn-item-svc">' + esc(h.serviceLine) + '</span>' : '') +
      warnChip(d) +
      '</button>';
  }

  function listPane() {
    var head = '<div class="cn-list-head">' +
      '<h2 id="cn-list-h">Your drafts</h2>' +
      '<button type="button" class="cn-icon-btn" data-cn="reload" title="Refresh list" aria-label="Refresh list">' +
        icn('refresh', 14) + '</button>' +
      '</div>';

    var body;
    if (S.loading && !S.list.length) {
      body = '<p class="cn-quiet">Loading your drafts…</p>';
    } else if (S.listError) {
      body = '<p class="cn-inline-error">' + esc(S.listError) + '</p>';
    } else if (!S.list.length) {
      body = '<div class="cn-empty">' + icn('doc', 20) + '<p>' + esc(EMPTY_STATE) + '</p></div>';
    } else {
      body = '<div class="cn-items" role="list">' + S.list.map(function (d) {
        return '<div role="listitem">' + listItem(d) + '</div>';
      }).join('') + '</div>';
    }
    return '<section class="cn-list" aria-labelledby="cn-list-h">' + head + body + '</section>';
  }

  function metaCard(draft) {
    var rows = cnMetaRows(draft.header).map(function (r) {
      return '<div class="cn-meta-row"><span class="cn-meta-label">' + esc(r.label) + '</span>' +
        '<span class="cn-meta-value">' + esc(r.value) + '</span></div>';
    }).join('');
    if (!rows) rows = '<div class="cn-meta-row"><span class="cn-meta-value cn-quiet">No client or appointment details were stored with this draft.</span></div>';
    return '<section class="cn-meta" aria-labelledby="cn-meta-h">' +
      '<h3 id="cn-meta-h" class="cn-meta-head">' + icn('calendar', 13) + ' Client and session details' +
        '<span class="cn-readonly-tag">' + icn('lock', 11) + ' read-only</span></h3>' +
      rows +
      '<p class="cn-meta-note">' + esc(METADATA_NOTE) + '</p>' +
      '</section>';
  }

  function warningsCard(draft) {
    var w = draft.warnings || [];
    if (!w.length) return '';
    return '<section class="cn-warnings" aria-labelledby="cn-warn-h">' +
      '<h3 id="cn-warn-h">' + icn('info', 13) + ' Worth checking before you rely on this note</h3>' +
      '<ul>' + w.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' +
      '</section>';
  }

  /** Server-composed narrative snapshot — shown, never editable. */
  function narrativeCard(draft) {
    var parts = [];
    if (draft.identify) {
      parts.push('<div class="cn-narr-block"><span class="cn-meta-label">Identify</span>' +
        '<p>' + esc(draft.identify) + '</p></div>');
    }
    if (draft.sessionDetails) {
      parts.push('<div class="cn-narr-block"><span class="cn-meta-label">Session details</span>' +
        '<p>' + esc(draft.sessionDetails) + '</p></div>');
    }
    if (!parts.length) return '';
    return '<section class="cn-narrative" aria-labelledby="cn-narr-h">' +
      '<h3 id="cn-narr-h" class="cn-meta-head">Generated sections as stored' +
        '<span class="cn-readonly-tag">' + icn('lock', 11) + ' read-only</span></h3>' +
      parts.join('') +
      '<p class="cn-meta-note">The snapshot the note was composed from. Edit the note itself above.</p>' +
      '</section>';
  }

  function planRowsHtml() {
    var editable = isEditable();
    var plan = (S.edits && S.edits.plan) || [];
    if (!plan.length) {
      return '<p class="cn-quiet" id="cn-plan-empty">No plan items. ' +
        (editable ? 'Add one if the session calls for it.' : '') + '</p>';
    }
    return plan.map(function (v, i) {
      var id = 'cn-plan-' + i;
      return '<div class="cn-plan-row">' +
        '<label class="cn-sr-only" for="' + id + '">Plan item ' + (i + 1) + '</label>' +
        '<input type="text" id="' + id + '" class="cn-input" data-cn-input="plan" data-cn-idx="' + i + '"' +
          ' value="' + esc(v) + '"' + (editable ? '' : ' readonly') + ' maxlength="500">' +
        (editable ? '<button type="button" class="cn-icon-btn" data-cn="plan-remove" data-cn-idx="' + i + '"' +
          ' aria-label="Remove plan item ' + (i + 1) + '">' + icn('trash', 13) + '</button>' : '') +
        '</div>';
    }).join('');
  }

  function planCard() {
    var editable = isEditable();
    var count = ((S.edits && S.edits.plan) || []).length;
    return '<section class="cn-plan" aria-labelledby="cn-plan-h">' +
      '<h3 id="cn-plan-h" class="cn-pane-head">Plan' +
        '<span class="cn-editable-tag">' + icn('edit', 11) + ' editable</span></h3>' +
      '<div id="cn-plan-rows">' + planRowsHtml() + '</div>' +
      '<div class="cn-plan-foot">' +
        (editable
          ? '<button type="button" class="btn" data-cn="plan-add"' +
            (count >= CN_MAX_PLAN_ITEMS ? ' disabled' : '') + '>' + icn('plus', 13) + ' Add plan item</button>'
          : '') +
        '<span class="cn-quiet" id="cn-plan-count">' + count + ' of ' + CN_MAX_PLAN_ITEMS +
          ' · empty rows are dropped when you save</span>' +
      '</div>' +
      '</section>';
  }

  function bodyPanes(draft) {
    var editable = isEditable();
    var note = (S.edits && S.edits.noteBody) || '';
    return '<div class="cn-body-grid">' +
      '<section class="cn-note-pane" aria-labelledby="cn-note-h">' +
        '<h3 id="cn-note-h" class="cn-pane-head"><label for="cn-note">Note</label>' +
          '<span class="cn-editable-tag">' + icn('edit', 11) + ' editable</span></h3>' +
        '<textarea id="cn-note" class="cn-note" data-cn-input="note" spellcheck="true"' +
          ' aria-describedby="cn-note-hint"' + (editable ? '' : ' readonly') + '>' + esc(note) + '</textarea>' +
        '<p class="cn-quiet" id="cn-note-hint">Your wording is what is stored. Nothing is submitted anywhere else.</p>' +
      '</section>' +
      '<aside class="cn-transcript' + (S.transcriptOpen ? ' open' : '') + '" aria-labelledby="cn-tx-h">' +
        '<h3 id="cn-tx-h" class="cn-tx-head">' + icn('doc', 13) + ' Transcript — what was recorded' +
          '<span class="cn-readonly-tag">' + icn('lock', 11) + ' read-only</span></h3>' +
        '<button type="button" class="cn-tx-toggle" data-cn="toggle-transcript"' +
          ' aria-expanded="' + (S.transcriptOpen ? 'true' : 'false') + '" aria-controls="cn-tx-body">' +
          icn('doc', 13) + ' Transcript — what was recorded' +
          '<span class="cn-tx-chevron" aria-hidden="true">' + (S.transcriptOpen ? '−' : '+') + '</span>' +
        '</button>' +
        '<div class="cn-tx-body" id="cn-tx-body"><pre class="cn-tx-text">' +
          esc(draft.transcript || '') + '</pre></div>' +
      '</aside>' +
      '</div>';
  }

  function msgHtml() {
    if (!S.msg) return '<div id="cn-msg" role="status" aria-live="polite"></div>';
    return '<div id="cn-msg" role="status" aria-live="polite">' +
      '<p class="cn-msg cn-msg-' + esc(S.msg.kind) + '">' + esc(S.msg.text) + '</p></div>';
  }

  function guardHtml() {
    if (!S.guard) return '<div id="cn-guard"></div>';
    var what = S.guard.kind === 'leave'
      ? 'You have unsaved changes to this note. Leaving Case Notes now will discard them.'
      : 'You have unsaved changes to this note. Opening another draft now will discard them.';
    return '<div id="cn-guard"><div class="cn-guard" role="alert">' +
      '<p>' + esc(what) + '</p>' +
      '<div class="cn-guard-actions">' +
        '<button type="button" class="btn primary" data-cn="guard-keep">Keep editing</button>' +
        '<button type="button" class="btn" data-cn="guard-discard">Discard changes</button>' +
      '</div></div></div>';
  }

  function detailActions() {
    var editable = isEditable();
    var dirty = isDirty();
    return '<div class="cn-actions">' +
      '<span class="cn-dirty" id="cn-dirty">' + (dirty ? 'Unsaved changes' : '') + '</span>' +
      '<button type="button" class="btn primary" id="cn-save" data-cn="save"' +
        ((!editable || !dirty || busy()) ? ' disabled' : '') + '>' +
        icn('check', 13) + ' ' + (S.saving ? 'Saving…' : 'Save') + '</button>' +
      '<button type="button" class="btn" id="cn-regen" data-cn="regenerate"' +
        ((!editable || busy() || dirty) ? ' disabled' : '') +
        ' title="Rebuild the note from the original transcript">' +
        icn('refresh', 13) + ' ' + (S.regenerating ? 'Regenerating…' : 'Regenerate') + '</button>' +
      '<button type="button" class="btn cn-danger" id="cn-archive" data-cn="archive"' +
        ((!editable || busy()) ? ' disabled' : '') + '>' +
        icn('trash', 13) + ' Archive</button>' +
      '</div>';
  }

  function detailPane() {
    if (S.detailLoading) {
      return '<section class="cn-detail"><p class="cn-quiet">Loading draft…</p></section>';
    }
    if (S.detailError) {
      return '<section class="cn-detail"><p class="cn-inline-error">' + esc(S.detailError) + '</p></section>';
    }
    if (!S.draft) {
      // The message region lives here too, so "Draft archived" (the moment
      // the selection disappears) is still confirmed to the therapist.
      return '<section class="cn-detail cn-detail-blank">' + msgHtml() +
        '<div class="cn-empty">' + icn('doc', 20) +
        '<p>' + (S.list.length
          ? 'Select a draft on the left to review it.'
          : 'Nothing to review right now.') + '</p>' +
        '<p class="cn-quiet">' + esc(STATUS_LINE) + '</p></div></section>';
    }

    var d = S.draft;
    var title = (d.header && d.header.clientName) || 'Case note draft';
    var stateLine = isEditable()
      ? STATUS_LINE
      : 'Archived draft — read-only. ' + STATUS_LINE;

    return '<section class="cn-detail" aria-labelledby="cn-detail-h">' +
      '<div class="cn-detail-head">' +
        '<div class="cn-detail-id">' +
          '<h2 id="cn-detail-h">' + esc(title) + '</h2>' +
          '<p class="cn-status-line">' + icn('lock', 12) + ' ' + esc(stateLine) + '</p>' +
        '</div>' +
        detailActions() +
      '</div>' +
      msgHtml() +
      guardHtml() +
      metaCard(d) +
      warningsCard(d) +
      bodyPanes(d) +
      planCard() +
      narrativeCard(d) +
      '</section>';
  }

  function render() {
    var root = el('cn-root');
    if (!root) return;
    root.innerHTML =
      '<div class="cn-page-head">' +
        '<h1>Case Notes</h1>' +
        '<p class="cn-quiet">Drafts dictated in the Opa mobile app, waiting for your review. ' +
          esc(STATUS_LINE) + '</p>' +
      '</div>' +
      '<div class="cn-layout">' + listPane() + detailPane() + '</div>';
    var note = el('cn-note');
    if (note) autosize(note);
  }

  function renderPlan() {
    var host = el('cn-plan-rows');
    if (!host) { render(); return; }
    host.innerHTML = planRowsHtml();
    var count = ((S.edits && S.edits.plan) || []).length;
    var counter = el('cn-plan-count');
    if (counter) counter.textContent = count + ' of ' + CN_MAX_PLAN_ITEMS + ' · empty rows are dropped when you save';
    var add = doc.querySelector('[data-cn="plan-add"]');
    if (add) add.disabled = count >= CN_MAX_PLAN_ITEMS;
  }

  /** Cheap dirty-state sync — never re-renders the editors under the cursor. */
  function syncDirty() {
    var dirty = isDirty();
    var pill = el('cn-dirty');
    if (pill) pill.textContent = dirty ? 'Unsaved changes' : '';
    var saveBtn = el('cn-save');
    if (saveBtn) saveBtn.disabled = !isEditable() || !dirty || busy();
    var regen = el('cn-regen');
    if (regen) regen.disabled = !isEditable() || busy() || dirty;
  }

  // ── Event delegation ──────────────────────────────────────────────────────

  doc.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-cn]') : null;
    if (!t) return;
    var action = t.getAttribute('data-cn');
    if (action === 'select') { select(t.getAttribute('data-cn-id')); return; }
    if (action === 'reload') { loadList(true); return; }
    if (action === 'save') { save(); return; }
    if (action === 'regenerate') { regenerate(); return; }
    if (action === 'archive') { archiveAsk(); return; }
    if (action === 'archive-confirm') { archiveConfirm(); return; }
    if (action === 'archive-cancel') { archiveClose(); return; }
    if (action === 'plan-add') { planAdd(); return; }
    if (action === 'plan-remove') { planRemove(t.getAttribute('data-cn-idx')); return; }
    if (action === 'guard-keep') { guardKeepEditing(); return; }
    if (action === 'guard-discard') { guardDiscard(); return; }
    if (action === 'toggle-transcript') {
      S.transcriptOpen = !S.transcriptOpen;
      var wrap = t.closest('.cn-transcript');
      if (wrap) wrap.classList.toggle('open', S.transcriptOpen);
      t.setAttribute('aria-expanded', S.transcriptOpen ? 'true' : 'false');
      var chev = t.querySelector('.cn-tx-chevron');
      if (chev) chev.textContent = S.transcriptOpen ? '−' : '+';
    }
  });

  doc.addEventListener('input', function (e) {
    var t = e.target;
    if (!t || !t.getAttribute) return;
    var kind = t.getAttribute('data-cn-input');
    if (!kind || !S.edits) return;
    if (kind === 'note') {
      S.edits.noteBody = t.value;
      autosize(t);
      syncDirty();
      return;
    }
    if (kind === 'plan') {
      var i = Number(t.getAttribute('data-cn-idx'));
      if (isFinite(i) && i >= 0) {
        while (S.edits.plan.length <= i) S.edits.plan.push('');
        S.edits.plan[i] = t.value;
        syncDirty();
      }
    }
  });

  // Unsaved-changes guard on leaving the tab: inline, one-time, never a
  // browser dialog. The first click surfaces the banner; "Discard changes"
  // completes the navigation.
  // Registered on window in the CAPTURE phase so it always runs before the
  // nav's own per-tab click listener, whatever order the modules loaded in.
  (global.addEventListener ? global : doc).addEventListener('click', function (e) {
    if (!isDirty()) return;
    var view = el('view-casenotes');
    if (!view || !view.classList.contains('active')) return;
    var tab = e.target && e.target.closest ? e.target.closest('.tab[data-tab]') : null;
    if (!tab || tab.dataset.tab === 'casenotes') return;
    if (S.guard && S.guard.kind === 'leave' && S.guard.tab === tab.dataset.tab) return; // already warned
    e.preventDefault();
    e.stopPropagation();
    S.guard = { kind: 'leave', tab: tab.dataset.tab };
    render();
    var keep = doc.querySelector('[data-cn="guard-keep"]');
    if (keep) { try { keep.focus(); } catch (_) { /* not focusable */ } }
  }, true);

  // ── Entry point ───────────────────────────────────────────────────────────

  function open() {
    if (!el('cn-root')) return;
    if (!S.loaded && !S.loading) { loadList(false); return; }
    render();
  }

  doc.addEventListener('DOMContentLoaded', function () {
    var view = el('view-casenotes');
    if (view && view.classList.contains('active')) open();
  });

  // ── Public surface ────────────────────────────────────────────────────────

  global.CaseNotes = {
    open: open,
    reload: function () { return loadList(true); },
    select: select,
    save: save,
    regenerate: regenerate,
    archiveAsk: archiveAsk,
    archiveConfirm: archiveConfirm,
    archiveCancel: archiveClose,
    planAdd: planAdd,
    planRemove: planRemove,
    _state: S,
    _helpers: helpers,
  };

})(typeof window !== 'undefined' ? window : null);
