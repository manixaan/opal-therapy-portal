/* ═══════════════════════════════════════════════════════════════════════════
   OPAL CASE NOTES — WORKSPACE (14 Nov 2026). Case noting, organised by block.

   "New case note" opens this in the Case Notes tab, in place of the review
   list (#cn-root). Flick through the weeks; every case-noting (non-face-to-
   face) block of that week is listed. Open one and each client on the block
   gets a panel of its own: write what was done, check the names, and Opal
   Assist writes it up as a case-note draft — which then opens in the review
   surface (casenotes.js) for editing. The block's billable timer is started
   and stopped here and is the SAME timer as the calendar block's (nf2f.js
   handles the buttons; the calendar chip and tiles follow).

   A thin client over existing governed routes plus one listing:
     GET  /api/nf2f/blocks?from=&to=                     the week's blocks
     GET  /api/events/:id/nf2f                           one block's timer
     GET  /api/mobile/case-note-drafts?nf2fEventId=      notes from a block
     POST /api/mobile/case-note-drafts/names-check       what will be hidden
     POST /api/mobile/case-note-drafts/generate          the governed draft
   Each note is CLIENT-linked and records its block (nf2fEventId).

   The same non-negotiables as the composer (casenotes-compose.js):
     - names are checked before anything is generated, every flagged word
       answered; editing the text withdraws the check;
     - no clinical text is logged, stored in the browser or put in a URL —
       there is deliberately no console.* call in this file;
     - a failure never clears what was typed, and is never retried by itself;
     - drafts stay drafts: review happens in the review surface.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

(function (global) {

  // ── Pure helpers (node-exported for unit tests) ───────────────────────────

  var CNW_MAX_CHARS = 8000;   // mirrors MAX_TRANSCRIPT_CHARS on the server

  function cnwEsc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** Perth calendar date (YYYY-MM-DD) of an instant. */
  function cnwPerthYmd(ms) {
    return new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
  }

  /** The Monday–Sunday week (Perth) holding a YYYY-MM-DD, shifted by `offset` weeks. */
  function cnwWeekOf(ymd, offset) {
    var d = new Date(String(ymd) + 'T00:00:00Z');
    if (isNaN(d.getTime())) return null;
    var dow = (d.getUTCDay() + 6) % 7; // Monday = 0
    d.setUTCDate(d.getUTCDate() - dow + 7 * (offset || 0));
    var from = d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 6);
    return { from: from, to: d.toISOString().slice(0, 10) };
  }

  /** "9 – 15 Nov 2026" (or across months / years). */
  function cnwWeekLabel(week) {
    var M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var a = String(week.from).split('-'), b = String(week.to).split('-');
    var da = +a[2], db = +b[2], ma = M[+a[1] - 1], mb = M[+b[1] - 1];
    if (a[0] !== b[0]) return da + ' ' + ma + ' ' + a[0] + ' – ' + db + ' ' + mb + ' ' + b[0];
    if (a[1] !== b[1]) return da + ' ' + ma + ' – ' + db + ' ' + mb + ' ' + b[0];
    return da + ' – ' + db + ' ' + mb + ' ' + b[0];
  }

  /** m:ss or h:mm:ss. */
  function cnwClock(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0');
  }

  /** How many of a block's clients already have a note written from it. */
  function cnwNotesDone(block) {
    var notes = (block && block.notes) || {};
    return ((block && block.clients) || []).filter(function (c) { return !!notes[String(c.clientId)]; }).length;
  }

  /** Same contract as the composer: 'person' → hidden, 'word' → kept, rest blocks generation. */
  function cnwNameDecisions(candidates, decisions) {
    var out = { confirmedNames: [], ignoredWords: [], undecided: [] };
    var d = decisions || {};
    (Array.isArray(candidates) ? candidates : []).forEach(function (c) {
      var w = c && typeof c.word === 'string' ? c.word : '';
      if (!w) return;
      if (d[w] === 'person') out.confirmedNames.push(w);
      else if (d[w] === 'word') out.ignoredWords.push(w);
      else out.undecided.push(w);
    });
    return out;
  }

  var helpers = {
    cnwEsc: cnwEsc, cnwPerthYmd: cnwPerthYmd, cnwWeekOf: cnwWeekOf, cnwWeekLabel: cnwWeekLabel,
    cnwClock: cnwClock, cnwNotesDone: cnwNotesDone, cnwNameDecisions: cnwNameDecisions, CNW_MAX_CHARS: CNW_MAX_CHARS,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = helpers;
  if (!global || !global.document) return; // node/test stops here

  var doc = global.document;
  var esc = cnwEsc;
  var DRAFTS_API = '/api/mobile/case-note-drafts';
  var KEPT = 'What you wrote is still here — nothing was lost.';
  var KIND_LABEL = {
    'case-noting': 'Case noting', 'case-management': 'Case management', 'resource-prep': 'Resource preparation',
    emails: 'Emails', 'phone-calls': 'Phone calls',
  };

  // ── State ─────────────────────────────────────────────────────────────────

  var W = {
    open: false,
    week: null,            // { from, to }
    blocks: null,          // null = not loaded
    loading: false,
    error: '',
    block: null,           // the open block (from the list), or null for the week view
    timer: null,           // the open block's live timer view
    panels: {},            // clientId → { text, names, decisions, checking, generating, msg, draft }
  };
  var tick = null;

  function icn(name, size) { return typeof global.opIcon === 'function' ? global.opIcon(name, size || 14) : ''; }
  function el(id) { return doc.getElementById(id); }
  function root() { return el('cnw-root'); }
  function panel(id) {
    var k = String(id);
    if (!W.panels[k]) W.panels[k] = { text: '', names: null, decisions: {}, checking: false, generating: false, msg: null, draft: null };
    return W.panels[k];
  }
  function anyBusy() {
    return Object.keys(W.panels).some(function (k) { return W.panels[k].checking || W.panels[k].generating; });
  }
  function hasUnsaved() {
    return Object.keys(W.panels).some(function (k) { return !W.panels[k].draft && W.panels[k].text.trim(); });
  }

  // ── API — session cookie, same origin, content only ever in a JSON body ───

  async function api(path, body) {
    var init = { method: body === undefined ? 'GET' : 'POST', credentials: 'include', headers: {} };
    if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    try {
      var r = await fetch(path, init);
      var data = await r.json().catch(function () { return {}; });
      if (!r.ok) return { ok: false, status: r.status, code: data.code || '', error: data.error || ('Request failed (' + r.status + ')') };
      data.ok = true;
      return data;
    } catch (_) {
      return { ok: false, status: 0, code: '', error: 'Network error — please try again.' };
    }
  }

  async function loadWeek() {
    W.loading = true; W.error = '';
    render();
    var asked = W.week.from;
    var r = await api('/api/nf2f/blocks?from=' + W.week.from + '&to=' + W.week.to);
    if (!W.week || W.week.from !== asked) return; // the week changed while loading
    W.loading = false;
    if (!r.ok) { W.blocks = null; W.error = r.error; } else { W.blocks = Array.isArray(r.blocks) ? r.blocks : []; }
    if (W.block) { // keep the open block in step with the list (notes written, timer)
      var fresh = (W.blocks || []).filter(function (b) { return b.eventId === W.block.eventId; })[0];
      if (fresh) W.block = fresh;
    }
    render();
  }

  async function loadTimer() {
    if (!W.block) return;
    var id = W.block.eventId;
    var r = await api('/api/events/' + encodeURIComponent(id) + '/nf2f');
    if (!W.block || W.block.eventId !== id || !r.ok) return;
    W.timer = { status: r.timer.status, elapsedSeconds: r.timer.elapsedSeconds, limitSeconds: r.timer.limitSeconds, at: Date.now() };
    renderTimer();
  }

  async function loadDrafts() {
    if (!W.block) return;
    var id = W.block.eventId;
    var r = await api(DRAFTS_API + '?nf2fEventId=' + encodeURIComponent(id));
    if (!W.block || W.block.eventId !== id || !r.ok) return;
    (r.caseNoteDrafts || []).slice().reverse().forEach(function (d) { // newest wins
      if (d.linkedClientId) panel(d.linkedClientId).draft = d;
    });
    renderPanels();
  }

  // ── Names check → draft (per client) ──────────────────────────────────────

  async function checkNames(clientId) {
    var p = panel(clientId);
    if (!p.text.trim() || p.checking || p.generating) return;
    p.checking = true; p.msg = { kind: 'info', text: 'Checking which names will be hidden…' };
    renderPanelParts(clientId);
    var sent = p.text;
    var d = cnwNameDecisions(p.names && p.names.candidates, p.decisions);
    var r = await api(DRAFTS_API + '/names-check', {
      transcript: sent, linkedClientId: String(clientId), nf2fEventId: W.block.eventId,
      confirmedNames: d.confirmedNames, ignoredWords: d.ignoredWords,
    });
    p.checking = false;
    if (!r.ok) { p.msg = { kind: 'error', text: r.error + ' ' + KEPT }; renderPanelParts(clientId); return; }
    if (sent !== p.text) { p.msg = null; renderPanelParts(clientId); return; } // the text moved on
    p.names = { hidden: Array.isArray(r.hidden) ? r.hidden : [], candidates: Array.isArray(r.candidates) ? r.candidates : [] };
    p.msg = null;
    renderPanelParts(clientId);
  }

  function requestId() {
    try { return global.crypto && global.crypto.randomUUID ? global.crypto.randomUUID() : undefined; } catch (_) { return undefined; }
  }

  async function writeUp(clientId) {
    var p = panel(clientId);
    if (!p.names || p.generating || !p.text.trim()) return;
    var d = cnwNameDecisions(p.names.candidates, p.decisions);
    if (d.undecided.length) { p.msg = { kind: 'warn', text: 'Answer each flagged word first — is it a person’s name or not?' }; renderPanelParts(clientId); return; }
    p.generating = true; p.msg = { kind: 'info', text: 'Opal Assist is writing the case note…' };
    renderPanelParts(clientId);
    var r = await api(DRAFTS_API + '/generate', {
      transcript: p.text, linkedClientId: String(clientId), nf2fEventId: W.block.eventId,
      confirmedNames: d.confirmedNames, ignoredWords: d.ignoredWords, requestId: requestId(),
    });
    p.generating = false;
    if (!r.ok) {
      var text = r.error;
      if (r.code === 'generation_unavailable') text = 'Opal Assist case-note writing is not available right now.';
      if (r.code === 'names_not_hidden') text = 'Opal Assist couldn’t keep every name hidden, so it did not write this note.';
      if (r.code === 'content_blocked') text = 'This content could not be processed.';
      p.msg = { kind: r.status === 502 || r.status === 0 || r.status === 429 ? 'error' : 'warn', text: text + ' ' + KEPT };
      renderPanelParts(clientId);
      return;
    }
    p.draft = r.caseNoteDraft || null;
    p.text = ''; p.names = null; p.decisions = {}; p.msg = null;
    if (W.block) {
      W.block.notes = W.block.notes || {};
      W.block.notes[String(clientId)] = { draftId: r.draftId, reviewStatus: r.reviewStatus || 'review_required' };
    }
    renderPanels();
    if (global.CaseNotes && typeof global.CaseNotes.reload === 'function') global.CaseNotes.reload();
  }

  /** Hand a draft to the review surface (edit, regenerate, review). */
  async function review(draftId) {
    close(true);
    if (global.CaseNotes && typeof global.CaseNotes.reload === 'function') {
      await global.CaseNotes.reload();
      if (typeof global.CaseNotes.select === 'function') global.CaseNotes.select(draftId);
    }
  }

  /** Opal Assist's chat, opened on this client (names stay tokenised there too). */
  function openAssist(clientId) {
    var url = '/assist?client=' + encodeURIComponent('splose:patient:' + clientId);
    var w = global.open(url, 'opal-assist', 'width=1100,height=820');
    if (w) { try { w.focus(); } catch (_) { /* ignore */ } } else { global.location.href = url; }
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  function when(b) {
    var s = new Date(b.start), e = new Date(b.end);
    var day = s.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Australia/Perth' });
    var t = function (d) { return d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Perth' }); };
    return day + ' · ' + t(s) + ' – ' + t(e);
  }

  function timerLabel(t) {
    if (!t) return '';
    return t.status === 'RUNNING' ? 'Timing' : t.status === 'STOPPED' ? 'Stopped' : 'Not started';
  }

  function weekHtml() {
    var head = '<div class="cnw-week-nav" role="group" aria-label="Choose the week">' +
      '<button type="button" class="cn-icon-btn" data-cnw="prev" aria-label="Previous week" title="Previous week">‹</button>' +
      '<span class="cnw-week-label" aria-live="polite">' + esc(cnwWeekLabel(W.week)) + '</span>' +
      '<button type="button" class="cn-icon-btn" data-cnw="next" aria-label="Next week" title="Next week">›</button>' +
      '<label class="cn-sr-only" for="cnw-date">Go to the week of</label>' +
      '<input type="date" id="cnw-date" class="cn-input cnw-date" data-cnw-input="date" value="' + esc(W.week.from) + '">' +
      '<button type="button" class="btn" data-cnw="this-week">This week</button></div>';
    var body;
    if (W.loading && !W.blocks) body = '<p class="cn-quiet">Finding this week’s case-noting blocks…</p>';
    else if (W.error) body = '<p class="cn-inline-error">' + esc(W.error) + '</p><button type="button" class="btn" data-cnw="reload">Try again</button>';
    else if (!W.blocks || !W.blocks.length) {
      body = '<div class="cn-empty">' + icn('calendar', 20) + '<p>No case-noting blocks this week. Book one in Smart Booking (Case noting, with its clients), or use the arrows to look at another week.</p></div>';
    } else {
      body = '<div class="cnw-blocks" role="list">' + W.blocks.map(function (b) {
        var n = (b.clients || []).length, done = cnwNotesDone(b);
        return '<div role="listitem"><button type="button" class="cnw-block" data-cnw="block" data-cnw-id="' + esc(b.eventId) + '">' +
          '<span class="cnw-block-top"><span class="cnw-block-title">' + esc(b.title || KIND_LABEL[b.kind] || 'Case noting') + '</span>' +
            (b.timer && b.timer.status === 'RUNNING' ? '<span class="cnw-live" title="Timer running">● Timing</span>' : '') + '</span>' +
          '<span class="cn-quiet">' + esc(when(b)) + '</span>' +
          '<span class="cnw-block-meta">' + (n ? n + (n === 1 ? ' client' : ' clients') + ' · ' + done + ' of ' + n + ' notes written' : 'No clients on this block') + '</span>' +
          (n ? '<span class="cnw-progress" aria-hidden="true"><span style="width:' + Math.round(done / n * 100) + '%"></span></span>' : '') +
          '</button></div>';
      }).join('') + '</div>';
    }
    return head + body;
  }

  function blockHtml() {
    var b = W.block;
    var clients = b.clients || [];
    return '<div class="cnw-block-head">' +
        '<button type="button" class="btn" data-cnw="back">‹ All blocks this week</button>' +
        '<div><h2 class="cnw-h2">' + esc(b.title || KIND_LABEL[b.kind] || 'Case noting') + '</h2>' +
        '<p class="cn-quiet">' + esc(when(b)) + '</p></div></div>' +
      '<div class="cnw-timer" id="cnw-timer"></div>' +
      (clients.length
        ? '<div class="cnw-panels" id="cnw-panels"></div>'
        : '<p class="cn-quiet">This block has no clients, so there is nothing to note against it. Add clients to the block from the calendar.</p>');
  }

  function renderTimer() {
    var host = el('cnw-timer');
    if (!host || !W.block) return;
    var t = W.timer;
    if (!t) { host.innerHTML = '<span class="cn-quiet">Loading the block’s timer…</span>'; return; }
    var secs = t.elapsedSeconds + (t.status === 'RUNNING' ? Math.floor((Date.now() - t.at) / 1000) : 0);
    secs = Math.min(secs, t.limitSeconds || secs);
    var id = esc(W.block.eventId);
    host.innerHTML = '<span class="cnw-clock' + (t.status === 'RUNNING' ? ' running' : '') + '">' + cnwClock(secs) + '</span>' +
      '<span class="cn-quiet">of ' + Math.round((t.limitSeconds || 0) / 60) + ' min · ' + timerLabel(t) + '</span>' +
      (t.status === 'RUNNING'
        ? '<button type="button" class="btn" data-nf2f-stop="' + id + '" data-cnw-timer="1">Stop timer</button>'
        : '<button type="button" class="btn primary" data-nf2f-start="' + id + '" data-cnw-timer="1">' + (secs ? 'Resume timer' : 'Start timer') + '</button>') +
      '<button type="button" class="btn" data-nf2f-alloc="' + id + '">Allocate billing</button>' +
      '<span class="cn-quiet cnw-sync">Same timer as the calendar block.</span>';
  }

  function namesHtml(p, cid) {
    if (!p.names) return '';
    var hidden = p.names.hidden.map(function (h) {
      return '<li>' + esc(h.label || 'A name') + ' <span class="cn-quiet">× ' + esc(h.count) + '</span></li>';
    }).join('');
    var cands = p.names.candidates.map(function (c, i) {
      var pick = p.decisions[c.word];
      return '<div class="cnc-cand" role="group" aria-label="' + esc('Is ' + c.word + ' a person?') + '">' +
        '<span class="cnc-cand-word">' + esc(c.word) + '</span>' +
        '<button type="button" class="btn' + (pick === 'person' ? ' primary' : '') + '" data-cnw="cand-person" data-cnw-client="' + esc(cid) + '" data-cnw-idx="' + i + '" aria-pressed="' + (pick === 'person') + '">A person — hide it</button>' +
        '<button type="button" class="btn' + (pick === 'word' ? ' primary' : '') + '" data-cnw="cand-word" data-cnw-client="' + esc(cid) + '" data-cnw-idx="' + i + '" aria-pressed="' + (pick === 'word') + '">Not a name — keep it</button></div>';
    }).join('');
    return '<div class="cnc-names"><p class="cn-pane-head">' + icn('lock', 13) + ' Names hidden before Opal Assist sees this</p>' +
      (hidden ? '<ul class="cnc-hidden">' + hidden + '</ul>' : '<p class="cn-quiet">No known names were found.</p>') +
      (cands ? '<p class="cnc-ask">These words might be names. Say which are people:</p>' + cands : '') + '</div>';
  }

  function actionsHtml(p, cid) {
    var undecided = p.names ? cnwNameDecisions(p.names.candidates, p.decisions).undecided.length : 0;
    var ready = !!p.text.trim() && !p.checking && !p.generating;
    var main = p.names
      ? '<button type="button" class="btn primary" data-cnw="write" data-cnw-client="' + esc(cid) + '"' + (!ready || undecided ? ' disabled' : '') + '>' +
          icn('doc', 13) + ' ' + (p.generating ? 'Writing…' : 'Write up with Opal Assist') + '</button>'
      : '<button type="button" class="btn primary" data-cnw="check" data-cnw-client="' + esc(cid) + '"' + (!ready ? ' disabled' : '') + '>' +
          icn('lock', 13) + ' ' + (p.checking ? 'Checking…' : 'Check names') + '</button>';
    var hint = !p.text.trim() ? 'Jot down what you did — Opal Assist turns it into the case note.'
      : !p.names ? 'Next: see which names will be hidden.'
      : undecided ? undecided + (undecided === 1 ? ' word' : ' words') + ' still to answer.'
      : 'The draft opens for your review. Nothing is sent to Splose or Outlook.';
    return main + '<button type="button" class="btn" data-cnw="assist" data-cnw-client="' + esc(cid) + '" title="Open Opal Assist’s chat for this client — names stay hidden there too">' +
      icn('spark', 13) + ' Ask Opal Assist</button><span class="cn-quiet">' + esc(hint) + '</span>';
  }

  function draftHtml(p, cid) {
    var d = p.draft;
    var state = d.reviewStatus === 'approved' ? 'Reviewed' : 'Draft — needs your review';
    return '<div class="cnw-draft"><p class="cnw-draft-state">' + icn('doc', 13) + ' ' + esc(state) + '</p>' +
      '<div class="cnw-draft-body">' + esc(d.noteBody || '') + '</div>' +
      '<div class="cnw-actions"><button type="button" class="btn primary" data-cnw="review" data-cnw-draft="' + esc(d.id) + '">Open to review</button>' +
      '<button type="button" class="btn" data-cnw="assist" data-cnw-client="' + esc(cid) + '">' + icn('spark', 13) + ' Ask Opal Assist</button></div></div>';
  }

  /** The whole panel list — text areas are built here and never re-rendered while typing. */
  function renderPanels() {
    var host = el('cnw-panels');
    if (!host || !W.block) return;
    host.innerHTML = (W.block.clients || []).map(function (c) {
      var cid = String(c.clientId), p = panel(cid);
      var body = p.draft ? draftHtml(p, cid)
        : '<label class="cn-sr-only" for="cnw-text-' + esc(cid) + '">What you did for ' + esc(c.clientName || 'this client') + '</label>' +
          '<textarea id="cnw-text-' + esc(cid) + '" class="cn-input cnw-text" rows="5" maxlength="' + CNW_MAX_CHARS + '" data-cnw-input="text" data-cnw-client="' + esc(cid) + '"' +
            ' placeholder="What did you do for ' + esc(c.clientName || 'this client') + '? Emails, calls, report work, liaison…">' + esc(p.text) + '</textarea>' +
          '<div class="cnw-count cn-quiet" id="cnw-count-' + esc(cid) + '"></div>' +
          '<div id="cnw-names-' + esc(cid) + '"></div><div class="cnw-msg" id="cnw-msg-' + esc(cid) + '"></div>' +
          '<div class="cnw-actions" id="cnw-actions-' + esc(cid) + '"></div>';
      return '<section class="cnw-panel" aria-labelledby="cnw-h-' + esc(cid) + '">' +
        '<h3 class="cnw-panel-h" id="cnw-h-' + esc(cid) + '">' + icn('user', 14) + ' ' + esc(c.clientName || ('Client ' + cid)) + '</h3>' + body + '</section>';
    }).join('');
    (W.block.clients || []).forEach(function (c) { if (!panel(c.clientId).draft) renderPanelParts(c.clientId); });
  }

  /** Everything in a panel except its text area. */
  function renderPanelParts(clientId) {
    var cid = String(clientId), p = panel(cid);
    var n = el('cnw-names-' + cid), a = el('cnw-actions-' + cid), m = el('cnw-msg-' + cid), k = el('cnw-count-' + cid);
    if (n) n.innerHTML = namesHtml(p, cid);
    if (a) a.innerHTML = actionsHtml(p, cid);
    if (m) m.innerHTML = p.msg ? '<p class="cn-msg cn-msg-' + esc(p.msg.kind) + '">' + esc(p.msg.text) + '</p>' : '';
    if (k) { k.textContent = p.text.length > CNW_MAX_CHARS * 0.8 ? p.text.length + ' of ' + CNW_MAX_CHARS + ' characters' : ''; }
    var ta = el('cnw-text-' + cid);
    if (ta) ta.disabled = p.generating;
  }

  function render() {
    var r = root();
    if (!r || !W.open) return;
    r.innerHTML = '<div class="cn-page-head cnw-head"><h1>Case noting</h1>' +
        '<span class="cnw-head-actions"><button type="button" class="btn" data-cnw="single" title="Write one note for a client, not from a block">A note without a block</button>' +
        '<button type="button" class="btn" data-cnw="close">Back to drafts</button></span></div>' +
      '<p class="cn-quiet cnw-intro">Pick a week, open a case-noting block, and write a note for each of its clients. Opal Assist writes each one up as a draft for your review.</p>' +
      '<div id="cnw-body">' + (W.block ? blockHtml() : weekHtml()) + '</div>';
    if (W.block) { renderTimer(); renderPanels(); }
  }

  // ── Open / close / navigate ───────────────────────────────────────────────

  function todayYmd() { return cnwPerthYmd(Date.now()); }

  function open() {
    var r = root();
    if (!r || W.open) return;
    if (global.CaseNotesCompose && global.CaseNotesCompose._state && global.CaseNotesCompose._state.open) return;
    W.open = true;
    var review = el('cn-root');
    if (review) review.hidden = true;
    r.hidden = false;
    if (!W.week) W.week = cnwWeekOf(todayYmd(), 0);
    render();
    loadWeek();
    startTick();
  }

  /** The portal's own styled confirm (dialog.js) — never the browser's. */
  async function okToDrop(question) {
    if (!hasUnsaved()) return true;
    if (typeof global.portalConfirm !== 'function') return false;
    return !!(await global.portalConfirm(question + ' Notes you have not written up yet will be cleared.',
      { title: 'Unwritten notes', ok: 'Clear them', danger: true }));
  }

  async function close(force) {
    if (!force && anyBusy()) return false;
    if (!force && !(await okToDrop('Leave case noting?'))) return false;
    W.open = false; W.block = null; W.timer = null; W.panels = {};
    stopTick();
    var r = root(), review = el('cn-root');
    if (r) { r.hidden = true; r.innerHTML = ''; }
    if (review) review.hidden = false;
    return true;
  }

  function goWeek(week) {
    if (!week) return;
    W.week = week; W.blocks = null; W.block = null; W.timer = null;
    loadWeek();
  }

  function openBlock(id) {
    var b = (W.blocks || []).filter(function (x) { return x.eventId === id; })[0];
    if (!b) return;
    W.block = b; W.timer = b.timer ? { status: b.timer.status, elapsedSeconds: b.timer.elapsedSeconds, limitSeconds: b.timer.limitSeconds, at: Date.now() } : null;
    W.panels = {};
    render();
    loadTimer();
    loadDrafts();
    var top = root(); if (top && top.scrollIntoView) { try { top.scrollIntoView({ block: 'start' }); } catch (_) { /* ignore */ } }
  }

  async function backToWeek() {
    if (anyBusy()) return;
    if (!(await okToDrop('Go back to the week?'))) return;
    W.block = null; W.timer = null; W.panels = {};
    render();
    loadWeek();
  }

  function startTick() {
    stopTick();
    tick = setInterval(function () { if (W.open && W.block && W.timer && W.timer.status === 'RUNNING') renderTimer(); }, 1000);
  }
  function stopTick() { if (tick) { clearInterval(tick); tick = null; } }

  // ── Events ────────────────────────────────────────────────────────────────

  doc.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-cnw], [data-cnw-timer]') : null;
    if (!t) return;
    // Timer buttons are handled by nf2f.js (same timer as the calendar block);
    // re-read the block's timer once it has answered.
    if (t.hasAttribute('data-cnw-timer')) { setTimeout(loadTimer, 700); setTimeout(loadTimer, 2000); return; }
    var action = t.getAttribute('data-cnw');
    if (action === 'open') { open(); return; }
    if (!W.open) return;
    var cid = t.getAttribute('data-cnw-client');
    if (action === 'close') { close(false); return; }
    if (action === 'single') {
      close(false).then(function (left) { if (left && global.CaseNotesCompose) global.CaseNotesCompose.open(); });
      return;
    }
    if (action === 'prev') { goWeek(cnwWeekOf(W.week.from, -1)); return; }
    if (action === 'next') { goWeek(cnwWeekOf(W.week.from, 1)); return; }
    if (action === 'this-week') { goWeek(cnwWeekOf(todayYmd(), 0)); return; }
    if (action === 'reload') { loadWeek(); return; }
    if (action === 'block') { openBlock(t.getAttribute('data-cnw-id')); return; }
    if (action === 'back') { backToWeek(); return; }
    if (action === 'check') { checkNames(cid); return; }
    if (action === 'write') { writeUp(cid); return; }
    if (action === 'review') { review(t.getAttribute('data-cnw-draft')); return; }
    if (action === 'assist') { openAssist(cid); return; }
    if (action === 'cand-person' || action === 'cand-word') {
      var p = panel(cid);
      var c = p.names && p.names.candidates[Number(t.getAttribute('data-cnw-idx'))];
      if (c) { p.decisions[c.word] = action === 'cand-person' ? 'person' : 'word'; renderPanelParts(cid); }
    }
  });

  doc.addEventListener('input', function (e) {
    var t = e.target;
    var kind = t && t.getAttribute ? t.getAttribute('data-cnw-input') : null;
    if (!kind || !W.open) return;
    if (kind === 'date') {
      var wk = cnwWeekOf(t.value, 0);
      if (wk && wk.from !== W.week.from) goWeek(wk);
      return;
    }
    if (kind === 'text') {
      var cid = t.getAttribute('data-cnw-client'), p = panel(cid);
      p.text = t.value;
      if (p.names) { p.names = null; p.decisions = {}; } // editing withdraws the names check
      renderPanelParts(cid);
    }
  });

  // The timer chip / allocation dialog live in nf2f.js; when the page comes
  // back into view, re-read this block's timer.
  doc.addEventListener('visibilitychange', function () { if (!doc.hidden && W.open && W.block) loadTimer(); });

  global.CaseNotesWorkspace = { open: open, close: function () { close(false); }, _state: W, _helpers: helpers };

})(typeof window !== 'undefined' ? window : null);
