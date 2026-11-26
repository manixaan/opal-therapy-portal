/**
 * Opal Assist — Notes owing. No framework.
 *
 * "Notes owing" in the Assist sidebar lists the practitioner's finished
 * sessions from the last week that have no case note yet (the same rule as
 * the Opa phone and the evening reminder). For each one they can:
 *   - Write note: dictate (on-device only, the composer's own engine) or
 *     type what happened → see which names will be hidden → the governed
 *     case-note draft, linked to that appointment → read it, then Approve,
 *     Copy for Splose, open it in Case Notes to edit, or Discard;
 *   - Written in Splose: stop listing it (with Undo).
 *
 * A THIN CLIENT over routes the phone and the Case Notes composer already
 * use — no new endpoint, no second generation path:
 *   GET    /api/mobile/notes-owing                     the owed sessions
 *   POST   /api/mobile/notes-owing/:id/dismiss         written in Splose
 *   DELETE /api/mobile/notes-owing/:id/dismiss         undo
 *   POST   /api/mobile/case-note-drafts/names-check    what will be hidden
 *   POST   /api/mobile/case-note-drafts/generate       the draft (linkedEventId)
 *   POST   /api/mobile/case-note-drafts/:id/review     approve
 *   DELETE /api/mobile/case-note-drafts/:id            discard
 *
 * Nothing goes to Splose from here: Splose's API takes no notes, so the
 * approved note is copied and pasted, as in the Case Notes tab. The
 * transcript is never stored in the browser, logged or put in a URL, and no
 * failure clears it.
 *
 * Pure helpers are exported for node tests; open() needs a document.
 */
(function (global) {
  'use strict';

  var MAX_TRANSCRIPT_CHARS = 8000; // mirrors MAX_TRANSCRIPT_CHARS in case-note-routes.js
  var KEPT = 'Your words are still here.';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /** "Tue 24 Nov, 9:00 am" in Perth time. */
  function fmtWhen(v) {
    var d = new Date(v);
    if (!v || isNaN(d)) return '';
    try {
      return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Australia/Perth' }) + ', '
        + d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Perth' }).replace(/\s?([ap])\.?m\.?/i, ' $1m').toLowerCase();
    } catch (e) { return d.toString(); }
  }

  /** The row heading: the client, else the appointment title. */
  function sessionLabel(s) { return (s && (s.clientName || s.title)) || 'Session'; }

  /** Words the therapist has answered for, and the ones still to answer. */
  function nameDecisions(candidates, decisions) {
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

  /** The sidebar button text. */
  function buttonLabel(count) { return count > 0 ? 'Notes owing · ' + count : 'Notes owing'; }

  /** A refusal from /generate, in words for the person. */
  function generateError(r) {
    var code = r && r.code;
    if (code === 'generation_unavailable') return 'Case-note drafting is not available right now.';
    if (code === 'names_not_hidden') return 'Not every name could be kept hidden, so the draft was not written.';
    if (code === 'content_blocked') return 'The AI service declined this content.';
    if (r && r.status === 429) return 'Too many drafts in a short time — wait a minute and try again.';
    return (r && r.error) || 'The draft could not be written just now.';
  }

  var api = { fmtWhen: fmtWhen, sessionLabel: sessionLabel, nameDecisions: nameDecisions, buttonLabel: buttonLabel, generateError: generateError, MAX_TRANSCRIPT_CHARS: MAX_TRANSCRIPT_CHARS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!global.document) { global.OpalAssistNotesOwing = api; return; }

  // ── Network: JSON in, { ok, status, code, error, ...body } out ─────────────
  function call(fetcher, path, method, body) {
    var opts = { method: method || (body ? 'POST' : 'GET') };
    if (body) opts.body = body;
    return fetcher(path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        j = j || {};
        if (!r.ok) return { ok: false, status: r.status, code: j.code || '', error: j.error || j.message || ('Request failed (' + r.status + ')') };
        j.ok = true; return j;
      });
    }, function () { return { ok: false, status: 0, code: '', error: 'Network error — please try again.' }; });
  }

  /** The owed count for the sidebar button; null when it cannot be read. */
  function count(fetcher) {
    return call(fetcher, '/api/mobile/notes-owing').then(function (r) { return r.ok ? (r.count || 0) : null; });
  }

  function close() {
    var el = document.getElementById('oa-no');
    if (!el) return;
    if (el._release) el._release();
    el.remove();
  }

  /**
   * opts: { api: Assist's fetch, composer: OpalAssistComposer, onCount(n) }
   */
  function open(opts) {
    close();
    var P = { view: 'list', sessions: null, error: '', undo: {}, session: null, text: '', names: null, decisions: {}, busy: '', draft: null, approved: false, msg: null, mic: null };
    var el = document.createElement('div');
    el.className = 'oa-cf-backdrop'; el.id = 'oa-no';
    el.innerHTML = '<div class="oa-cf oa-no" role="dialog" aria-modal="true" aria-labelledby="oa-no-title">'
      + '<div class="oa-cf-head"><h2 id="oa-no-title">Notes owing</h2>'
      + '<button type="button" class="oa-btn ghost sm" data-no="close" aria-label="Close">×</button></div>'
      + '<div class="oa-cf-body" id="oa-no-body"></div></div>';
    document.body.appendChild(el);
    var body = el.querySelector('#oa-no-body');
    el._release = function () { if (P.mic) { P.mic.release(); P.mic = null; } };

    function remaining() { return (P.sessions || []).filter(function (s) { return !P.undo[s.id]; }); }
    function tellCount() { if (opts.onCount && P.sessions) opts.onCount(remaining().length); }

    // ── List ────────────────────────────────────────────────────────────────
    function load() {
      P.error = '';
      return call(opts.api, '/api/mobile/notes-owing').then(function (r) {
        if (!r.ok) { P.error = r.error; P.sessions = P.sessions || null; }
        else { P.sessions = Array.isArray(r.sessions) ? r.sessions : []; P.windowDays = r.windowDays || 7; P.undo = {}; }
        tellCount();
        if (P.view === 'list') renderList();
      });
    }

    function renderList() {
      var html = '<p class="oa-no-lede">Finished sessions from the last ' + (P.windowDays || 7) + ' days with no case note in the portal. Write one here, or mark it as written in Splose.</p>';
      if (P.error) html += '<div class="oa-cf-empty bad">' + esc(P.error) + ' <button type="button" class="oa-btn ghost sm" data-no="reload">Try again</button></div>';
      else if (!P.sessions) html += '<div class="oa-cf-empty">Loading…</div>';
      else if (!P.sessions.length) html += '<div class="oa-no-done">All caught up — no notes owing.</div>';
      else {
        html += '<ul class="oa-no-list">' + P.sessions.map(function (s) {
          if (P.undo[s.id]) {
            return '<li class="oa-no-item muted"><span><b>' + esc(sessionLabel(s)) + '</b><small>Marked as written in Splose</small></span>'
              + '<button type="button" class="oa-btn ghost sm" data-no="undo" data-id="' + esc(s.id) + '">Undo</button></li>';
          }
          return '<li class="oa-no-item"><span><b>' + esc(sessionLabel(s)) + '</b><small>' + esc(fmtWhen(s.start)) + (s.clientName && s.title ? ' · ' + esc(s.title) : '') + '</small></span>'
            + '<span class="oa-no-row-actions"><button type="button" class="oa-btn ghost sm" data-no="dismiss" data-id="' + esc(s.id) + '" title="You wrote this note straight into Splose — stop listing it">Written in Splose</button>'
            + '<button type="button" class="oa-btn primary sm" data-no="write" data-id="' + esc(s.id) + '">Write note</button></span></li>';
        }).join('') + '</ul>';
      }
      body.innerHTML = html;
    }

    function dismiss(id, undo) {
      return call(opts.api, '/api/mobile/notes-owing/' + encodeURIComponent(id) + '/dismiss', undo ? 'DELETE' : 'POST').then(function (r) {
        if (!r.ok) { P.error = r.error; renderList(); return; }
        if (undo) delete P.undo[id]; else P.undo[id] = true;
        tellCount(); renderList();
      });
    }

    // ── Write ───────────────────────────────────────────────────────────────
    function startWrite(id) {
      var s = (P.sessions || []).filter(function (x) { return x.id === id; })[0];
      if (!s) return;
      P.view = 'write'; P.session = s; P.text = ''; P.names = null; P.decisions = {}; P.busy = ''; P.draft = null; P.approved = false; P.msg = null;
      body.innerHTML = '<button type="button" class="oa-btn ghost sm oa-no-back" data-no="back">← All notes owing</button>'
        + '<div class="oa-no-session"><b>' + esc(sessionLabel(s)) + '</b><small>' + esc(fmtWhen(s.start)) + (s.clientName && s.title ? ' · ' + esc(s.title) : '') + '</small></div>'
        + '<div id="oa-no-compose"><label class="oa-no-label" for="oa-no-text">What happened in the session?</label>'
        + '<div class="oa-no-field"><textarea id="oa-no-text" maxlength="' + MAX_TRANSCRIPT_CHARS + '" rows="8" placeholder="Dictate or type the session in your own words — what you worked on, how it went, what is next."></textarea>'
        + '<button type="button" class="oa-icon-btn oa-no-mic" id="oa-no-mic" aria-label="Dictate" aria-pressed="false" hidden><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg></button></div>'
        + '<div class="oa-no-count" id="oa-no-count"></div>'
        + '<div id="oa-no-names"></div></div>'
        + '<div id="oa-no-result"></div>'
        + '<div class="oa-no-msg" id="oa-no-msg" role="status" aria-live="polite"></div>'
        + '<div class="oa-no-actions" id="oa-no-actions"></div>';
      var ta = body.querySelector('#oa-no-text');
      if (opts.composer && opts.composer.dictateInto) {
        P.mic = opts.composer.dictateInto(ta, { onChange: textChanged, onState: renderMic });
      }
      renderMic(opts.composer && opts.composer.dictationState ? opts.composer.dictationState() : 'unavailable', false);
      textChanged();
      ta.focus();
    }

    function renderMic(state, listening) {
      var b = el.querySelector('#oa-no-mic'); if (!b) return;
      b.hidden = !(state === 'ready' || state === 'installable' || state === 'installing') || !!P.draft;
      b.classList.toggle('on', !!listening);
      b.setAttribute('aria-pressed', listening ? 'true' : 'false');
      b.title = listening ? 'Stop dictating' : state === 'installable' ? 'Set up on-device dictation (one download, then speech never leaves this computer)' : state === 'installing' ? 'Setting up dictation…' : 'Dictate — speech is turned into text on this computer only';
    }

    function setMsg(kind, text) { P.msg = text ? { kind: kind, text: text } : null; var m = el.querySelector('#oa-no-msg'); if (m) { m.className = 'oa-no-msg' + (P.msg ? ' ' + P.msg.kind : ''); m.textContent = P.msg ? P.msg.text : ''; } }

    /** Any change to the words withdraws the names check. */
    function textChanged() {
      var ta = el.querySelector('#oa-no-text'); if (!ta) return;
      if (ta.value.length > MAX_TRANSCRIPT_CHARS) ta.value = ta.value.slice(0, MAX_TRANSCRIPT_CHARS);
      if (ta.value !== P.text) { P.text = ta.value; if (P.names) { P.names = null; P.decisions = {}; renderNames(); } }
      var c = el.querySelector('#oa-no-count');
      c.textContent = P.text.length ? P.text.length.toLocaleString() + ' / ' + MAX_TRANSCRIPT_CHARS.toLocaleString() : '';
      renderActions();
    }

    function renderNames() {
      var host = el.querySelector('#oa-no-names'); if (!host) return;
      if (!P.names) { host.innerHTML = ''; return; }
      var hidden = P.names.hidden.map(function (h) { return '<li>' + esc(h.label || 'A name') + ' <span>× ' + esc(h.count) + '</span></li>'; }).join('');
      var cands = P.names.candidates.map(function (c, i) {
        var pick = P.decisions[c.word];
        return '<div class="oa-no-cand" role="group" aria-label="' + esc('Is ' + c.word + ' a person?') + '"><b>' + esc(c.word) + '</b>'
          + '<button type="button" class="oa-btn sm' + (pick === 'person' ? ' primary' : '') + '" data-no="person" data-i="' + i + '" aria-pressed="' + (pick === 'person') + '">A person — hide it</button>'
          + '<button type="button" class="oa-btn sm' + (pick === 'word' ? ' primary' : '') + '" data-no="word" data-i="' + i + '" aria-pressed="' + (pick === 'word') + '">Not a name — keep it</button></div>';
      }).join('');
      host.innerHTML = '<section class="oa-no-names"><h3>Hidden before the AI sees it</h3>'
        + (hidden ? '<ul>' + hidden + '</ul>' : '<p>No known names were found.</p>')
        + (cands ? '<p>These words might be names. Say which are people:</p>' + cands : '')
        + '</section>';
    }

    function renderActions() {
      var host = el.querySelector('#oa-no-actions'); if (!host) return;
      if (P.draft) {
        if (P.approved) {
          var left = remaining().length;
          host.innerHTML = (left ? '<button type="button" class="oa-btn primary" data-no="next">Next note owing (' + left + ')</button>' : '<button type="button" class="oa-btn primary" data-no="back">Done</button>')
            + '<button type="button" class="oa-btn" data-no="copy">Copy for Splose</button>';
          return;
        }
        host.innerHTML = '<button type="button" class="oa-btn primary" data-no="approve"' + (P.busy ? ' disabled' : '') + '>' + (P.busy === 'approve' ? 'Approving…' : 'Approve') + '</button>'
          + '<button type="button" class="oa-btn" data-no="copy">Copy for Splose</button>'
          + '<a class="oa-btn" href="/#casenotes/' + encodeURIComponent(P.draft.id) + '" target="_blank" rel="noopener">Edit in Case Notes</a>'
          + '<button type="button" class="oa-btn ghost danger" data-no="discard"' + (P.busy ? ' disabled' : '') + '>Discard</button>';
        return;
      }
      var undecided = P.names ? nameDecisions(P.names.candidates, P.decisions).undecided.length : 0;
      var ready = !!P.text.trim() && !P.busy;
      host.innerHTML = P.names
        ? '<button type="button" class="oa-btn primary" data-no="generate"' + (!ready || undecided ? ' disabled' : '') + '>' + (P.busy === 'generate' ? 'Writing the draft…' : 'Write the case note') + '</button>'
          + '<span class="oa-no-hint">' + (undecided ? undecided + (undecided === 1 ? ' word' : ' words') + ' still to answer.' : 'You review it before it counts as a note.') + '</span>'
        : '<button type="button" class="oa-btn primary" data-no="check"' + (!ready ? ' disabled' : '') + '>' + (P.busy === 'check' ? 'Checking…' : 'Check names') + '</button>'
          + '<span class="oa-no-hint">' + (P.text.trim() ? 'Next: see which names will be hidden.' : 'Dictate or type what happened.') + '</span>';
    }

    function renderDraft() {
      var host = el.querySelector('#oa-no-result'); if (!host) return;
      var compose = el.querySelector('#oa-no-compose');
      if (!P.draft) { host.innerHTML = ''; if (compose) compose.hidden = false; return; }
      if (compose) compose.hidden = true;
      var warnings = (P.draft.warnings || []).map(function (w) { return '<li>' + esc(typeof w === 'string' ? w : (w && (w.message || w.text)) || '') + '</li>'; }).join('');
      host.innerHTML = '<div class="oa-no-badge' + (P.approved ? ' ok' : '') + '">' + (P.approved ? 'Approved — saved in Opal. Paste it into Splose; Opal does not send notes there.' : 'AI-assisted draft — read it before you approve.') + '</div>'
        + (warnings ? '<ul class="oa-no-warn">' + warnings + '</ul>' : '')
        + '<pre class="oa-no-note">' + esc(P.draft.noteBody || '') + '</pre>';
    }

    function checkNames() {
      if (!P.text.trim() || P.busy) return;
      if (P.mic && opts.composer.stopDictation) opts.composer.stopDictation();
      var sent = P.text; var d = nameDecisions(P.names && P.names.candidates, P.decisions);
      P.busy = 'check'; setMsg('', ''); renderActions();
      call(opts.api, '/api/mobile/case-note-drafts/names-check', 'POST', { transcript: sent, linkedEventId: P.session.id, confirmedNames: d.confirmedNames, ignoredWords: d.ignoredWords }).then(function (r) {
        P.busy = '';
        if (!r.ok) { setMsg('bad', r.error + ' ' + KEPT); renderActions(); return; }
        if (sent !== P.text) { renderActions(); return; } // an answer about older words is not an answer
        P.names = { hidden: Array.isArray(r.hidden) ? r.hidden : [], candidates: Array.isArray(r.candidates) ? r.candidates : [] };
        renderNames(); renderActions();
      });
    }

    function generate() {
      if (!P.names || P.busy) return;
      var d = nameDecisions(P.names.candidates, P.decisions);
      if (d.undecided.length) return;
      P.busy = 'generate'; setMsg('info', 'Writing the draft…'); renderActions();
      var rid; try { rid = global.crypto && global.crypto.randomUUID ? global.crypto.randomUUID() : undefined; } catch (e) { rid = undefined; }
      call(opts.api, '/api/mobile/case-note-drafts/generate', 'POST', { transcript: P.text, linkedEventId: P.session.id, confirmedNames: d.confirmedNames, ignoredWords: d.ignoredWords, requestId: rid }).then(function (r) {
        P.busy = '';
        if (!r.ok) { setMsg('bad', generateError(r) + ' ' + KEPT); renderActions(); return; } // never retried from here
        P.draft = r.caseNoteDraft || null;
        if (!P.draft || !P.draft.id) { setMsg('bad', 'The draft came back incomplete. ' + KEPT); renderActions(); return; }
        if (P.mic) { P.mic.release(); P.mic = null; }
        // The session now has a draft, so it is no longer owed.
        P.sessions = (P.sessions || []).filter(function (s) { return s.id !== P.session.id; });
        tellCount();
        setMsg('', ''); renderMic('unavailable', false); renderDraft(); renderActions();
      });
    }

    function approve() {
      if (!P.draft || P.busy) return;
      P.busy = 'approve'; renderActions();
      call(opts.api, '/api/mobile/case-note-drafts/' + encodeURIComponent(P.draft.id) + '/review', 'POST', { decision: 'approved' }).then(function (r) {
        P.busy = '';
        if (!r.ok) { setMsg('bad', r.error); renderActions(); return; }
        P.approved = true; setMsg('', ''); renderDraft(); renderActions();
      });
    }

    function discard() {
      if (!P.draft || P.busy) return;
      P.busy = 'discard'; renderActions();
      call(opts.api, '/api/mobile/case-note-drafts/' + encodeURIComponent(P.draft.id), 'DELETE').then(function (r) {
        P.busy = '';
        if (!r.ok) { setMsg('bad', r.error); renderActions(); return; }
        // Discarded: the session is owed again, and the words are kept to try again.
        P.sessions = [P.session].concat((P.sessions || []).filter(function (s) { return s.id !== P.session.id; }));
        tellCount();
        P.draft = null; P.names = null; P.decisions = {};
        var ta = el.querySelector('#oa-no-text');
        if (ta && opts.composer && opts.composer.dictateInto) P.mic = opts.composer.dictateInto(ta, { onChange: textChanged, onState: renderMic });
        renderMic(opts.composer && opts.composer.dictationState ? opts.composer.dictationState() : 'unavailable', false);
        renderDraft(); renderNames(); renderActions(); setMsg('info', 'Draft discarded. ' + KEPT);
      });
    }

    function copy() {
      var text = P.draft && P.draft.noteBody ? String(P.draft.noteBody) : '';
      if (!text) return;
      var done = function (ok) { setMsg(ok ? 'info' : 'bad', ok ? 'Copied — paste it into the client’s notes in Splose.' : 'Could not copy automatically. Select the note and copy it instead.'); };
      try { global.navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); }); } catch (e) { done(false); }
    }

    function backToList() {
      if (P.mic) { P.mic.release(); P.mic = null; }
      P.view = 'list'; P.session = null; P.draft = null; P.text = ''; P.msg = null;
      renderList();
    }

    el.addEventListener('input', function (e) { if (e.target.id === 'oa-no-text') textChanged(); });
    el.addEventListener('click', function (e) {
      if (e.target === el) { if (!P.busy) close(); return; }
      var b = e.target.closest('[data-no]'); if (!b || b.disabled) return;
      var a = b.dataset.no;
      if (a === 'close') close();
      else if (a === 'reload') { P.sessions = null; renderList(); load(); }
      else if (a === 'write') startWrite(b.dataset.id);
      else if (a === 'dismiss') dismiss(b.dataset.id, false);
      else if (a === 'undo') dismiss(b.dataset.id, true);
      else if (a === 'back') backToList();
      else if (a === 'next') { var n = remaining()[0]; if (n) startWrite(n.id); else backToList(); }
      else if (a === 'check') checkNames();
      else if (a === 'generate') generate();
      else if (a === 'person' || a === 'word') {
        var c = P.names && P.names.candidates[+b.dataset.i];
        if (c) { P.decisions[c.word] = a; renderNames(); renderActions(); }
      }
      else if (a === 'approve') approve();
      else if (a === 'discard') discard();
      else if (a === 'copy') copy();
    });
    el.addEventListener('click', function (e) { if (e.target.closest('#oa-no-mic') && P.mic) P.mic.toggle(); });
    el.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !P.busy) { e.stopPropagation(); close(); } });

    renderList();
    load();
  }

  api.open = open; api.close = close; api.count = count;
  global.OpalAssistNotesOwing = api;
})(typeof window !== 'undefined' ? window : globalThis);
