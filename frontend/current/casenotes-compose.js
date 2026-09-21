/* ═══════════════════════════════════════════════════════════════════════════
   OPAL CASE NOTES — COMPOSER. Start a case note in the portal: link a client,
   dictate or type what happened, check the names, ask for the draft.

   Renders into #cnc-root (a sibling of #cn-root inside the "Case Notes" tab)
   and hands the finished draft to the review surface in casenotes.js. It is a
   THIN CLIENT over routes the Opa mobile app already uses — no new endpoint,
   no second generation path:
     GET  /api/mobile/clients                          caseload picker
     POST /api/mobile/case-note-drafts/names-check     what will be hidden
     POST /api/mobile/case-note-drafts/generate        the governed draft

   Kept in its own file on purpose: casenotes.js is guarded as a surface where
   ONLY the note and the plan are ever typed into. This file owns the two
   fields that surface must never grow — the client search and the transcript.

   NON-NEGOTIABLES ENCODED HERE (the same ones the phone keeps):
     1. DICTATION IS ON-DEVICE OR NOT AT ALL. The browser speech engine is
        used only when it can prove local processing (processLocally). A
        browser that would send audio to a vendor's servers gets an honest
        "not available" and the typed field — never a silent cloud fallback,
        never an audio upload.
     2. SILENCE IS A PAUSE, NOT A FINISH. Only the Stop button, leaving the
        tab, or hiding the page ends a dictation. The engine ending on its
        own is restarted.
     3. THE TRANSCRIPT IS THE THERAPIST'S. Finished phrases are appended to
        the field; unfinished ones are shown beside it and never overwrite
        anything typed.
     4. NAMES ARE CHECKED BEFORE ANYTHING IS GENERATED. The draft button
        appears only under a names check that matches the current text, with
        every flagged word decided. Editing the text withdraws the check.
     5. NO CONTENT LEAVES. Transcript text is never logged, never stored in
        the browser, never put in a URL. There is deliberately no console.*
        call in this file.
     6. FAILURES KEEP THE TRANSCRIPT. No failure path clears the field, and a
        refusal is never retried automatically.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

(function (global) {

  // ── Pure helpers (node-exported for unit tests) ───────────────────────────

  var CNC_MAX_TRANSCRIPT_CHARS = 8000;   // mirrors MAX_TRANSCRIPT_CHARS on the server
  var CNC_LANGS = ['en-AU', 'en-US'];    // preferred first

  function cncEsc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /**
   * Append one finished phrase to the transcript. One space between phrases,
   * none before punctuation, a capital after a sentence end, and never past
   * the server's limit (the overflow is dropped, not the existing text).
   */
  function cncAppendFinal(text, phrase) {
    var base = String(text == null ? '' : text);
    var add = String(phrase == null ? '' : phrase).replace(/\s+/g, ' ').trim();
    if (!add) return base;
    var trimmedEnd = base.replace(/[ \t]+$/, '');
    var startsSentence = !trimmedEnd || /[.!?\n]$/.test(trimmedEnd);
    if (startsSentence) add = add.charAt(0).toUpperCase() + add.slice(1);
    var joiner = (!trimmedEnd || /\n$/.test(trimmedEnd) || /^[.,;:!?]/.test(add)) ? '' : ' ';
    var out = trimmedEnd + joiner + add;
    return out.length > CNC_MAX_TRANSCRIPT_CHARS ? out.slice(0, CNC_MAX_TRANSCRIPT_CHARS) : out;
  }

  /** Case-insensitive picker filter over name and suburb; every term must match. */
  function cncFilterClients(clients, query) {
    var list = Array.isArray(clients) ? clients : [];
    var terms = String(query == null ? '' : query).toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return list.slice();
    return list.filter(function (c) {
      var hay = (String((c && c.fullName) || '') + ' ' + String((c && c.suburb) || '')).toLowerCase();
      return terms.every(function (t) { return hay.indexOf(t) !== -1; });
    });
  }

  /**
   * Turn the therapist's per-word answers into the generate payload.
   * 'person' → confirmedNames (hidden), 'word' → ignoredWords (kept).
   * Anything unanswered is reported, and blocks generation.
   */
  function cncNameDecisions(candidates, decisions) {
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

  /**
   * Can this browser's speech engine be REQUIRED to stay on the device?
   * Both the static availability probe and the instance switch must exist;
   * an engine without them cannot make that promise, so it is not used.
   */
  function cncCanRequireOnDevice(Ctor) {
    return !!(Ctor && typeof Ctor.available === 'function' &&
      Ctor.prototype && 'processLocally' in Ctor.prototype);
  }

  var helpers = {
    cncEsc: cncEsc,
    cncAppendFinal: cncAppendFinal,
    cncFilterClients: cncFilterClients,
    cncNameDecisions: cncNameDecisions,
    cncCanRequireOnDevice: cncCanRequireOnDevice,
    CNC_MAX_TRANSCRIPT_CHARS: CNC_MAX_TRANSCRIPT_CHARS,
    CNC_LANGS: CNC_LANGS,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = helpers;
  if (!global || !global.document) return; // node/test stops here

  var doc = global.document;
  var esc = cncEsc;

  // ── Constants ─────────────────────────────────────────────────────────────

  var CLIENTS_API = '/api/mobile/clients';
  var DRAFTS_API = '/api/mobile/case-note-drafts';
  var MAX_SHOWN_CLIENTS = 40;
  var DICTATION_OFF = 'On-device dictation is not available in this browser, so nothing is recorded here. ' +
    'Type the note instead — your computer’s own dictation key works in this field too.';
  var KEPT = 'Your transcript is still here — nothing was lost.';
  var MIC_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"' +
    ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/>' +
    '<path d="M5 10v1a7 7 0 0 0 14 0v-1"/><line x1="12" y1="18" x2="12" y2="22"/></svg>';

  // ── State ─────────────────────────────────────────────────────────────────

  var C = {
    open: false,
    clients: null,          // null = not loaded yet
    clientsLoading: false,
    clientsError: '',
    query: '',
    client: null,           // { id, fullName, suburb }
    transcript: '',
    interim: '',
    dictation: 'unknown',   // unknown | checking | ready | installable | installing | unavailable
    dictationLang: '',
    listening: false,
    names: null,            // { hidden, candidates } for the CURRENT transcript + client
    decisions: {},          // word → 'person' | 'word'
    checking: false,
    generating: false,
    msg: null,              // { kind, text }
  };
  var rec = null;
  var quickEnds = 0;
  var startedAt = 0;

  function icn(name, size) {
    if (typeof global.opIcon !== 'function') return '';
    return global.opIcon(name, size || 14);
  }
  function el(id) { return doc.getElementById(id); }
  function busy() { return C.checking || C.generating; }
  function setMsg(kind, text) { C.msg = text ? { kind: kind, text: text } : null; renderMsg(); }

  // ── API — session cookie, same origin, content only ever in a JSON body ───

  async function api(path, body) {
    var init = { method: body === undefined ? 'GET' : 'POST', credentials: 'include', headers: {} };
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    try {
      var r = await fetch(path, init);
      var data = await r.json().catch(function () { return {}; });
      if (!r.ok) {
        return { ok: false, status: r.status, code: data.code || '', error: data.error || ('Request failed (' + r.status + ')') };
      }
      data.ok = true;
      return data;
    } catch (_) {
      return { ok: false, status: 0, code: '', error: 'Network error — please try again.' };
    }
  }

  async function loadClients() {
    C.clientsLoading = true;
    C.clientsError = '';
    renderClient();
    var d = await api(CLIENTS_API);
    C.clientsLoading = false;
    if (!d.ok) { C.clients = null; C.clientsError = d.error; } else { C.clients = Array.isArray(d.clients) ? d.clients : []; }
    renderClient();
  }

  // ── Dictation — on-device or not at all ───────────────────────────────────

  function speechCtor() { return global.SpeechRecognition || global.webkitSpeechRecognition || null; }

  async function probeDictation() {
    var Ctor = speechCtor();
    if (!cncCanRequireOnDevice(Ctor)) { C.dictation = 'unavailable'; renderDictation(); return; }
    C.dictation = 'checking';
    renderDictation();
    var installable = '';
    for (var i = 0; i < CNC_LANGS.length; i++) {
      var status = 'unavailable';
      try { status = await Ctor.available({ langs: [CNC_LANGS[i]], processLocally: true }); } catch (_) { status = 'unavailable'; }
      if (status === 'available') { C.dictation = 'ready'; C.dictationLang = CNC_LANGS[i]; renderDictation(); return; }
      if (!installable && (status === 'downloadable' || status === 'downloading')) installable = CNC_LANGS[i];
    }
    if (installable && typeof Ctor.install === 'function') { C.dictation = 'installable'; C.dictationLang = installable; }
    else C.dictation = 'unavailable';
    renderDictation();
  }

  async function installDictation() {
    var Ctor = speechCtor();
    if (C.dictation !== 'installable' || !Ctor) return;
    C.dictation = 'installing';
    renderDictation();
    var ok = false;
    try { ok = await Ctor.install({ langs: [C.dictationLang], processLocally: true }); } catch (_) { ok = false; }
    C.dictation = ok ? 'ready' : 'unavailable';
    renderDictation();
  }

  function startDictation() {
    var Ctor = speechCtor();
    if (C.dictation !== 'ready' || C.listening || busy() || !cncCanRequireOnDevice(Ctor)) return;
    try {
      rec = new Ctor();
      rec.lang = C.dictationLang;
      rec.continuous = true;
      rec.interimResults = true;
      rec.processLocally = true;
      // Fail closed: an engine that did not take the switch is not started.
      if (rec.processLocally !== true) throw new Error('not_local');
    } catch (_) {
      rec = null;
      C.dictation = 'unavailable';
      renderDictation();
      return;
    }
    rec.onresult = function (e) {
      var interim = '';
      for (var i = e.resultIndex; i < e.results.length; i++) {
        var r = e.results[i];
        var text = r && r[0] ? r[0].transcript : '';
        if (r.isFinal) commitPhrase(text); else interim += text;
      }
      C.interim = interim;
      renderInterim();
    };
    rec.onerror = function (e) {
      var code = e && e.error;
      if (code === 'no-speech' || code === 'aborted') return;      // a pause is not a finish
      var text = 'Dictation stopped unexpectedly. ' + KEPT;
      if (code === 'not-allowed' || code === 'service-not-allowed') text = 'The microphone was not allowed for this page, so dictation is off. You can still type.';
      if (code === 'audio-capture') text = 'No microphone was found. You can still type.';
      if (code === 'language-not-supported') { C.dictation = 'unavailable'; text = DICTATION_OFF; }
      stopDictation();
      setMsg('warn', text);
    };
    rec.onend = function () {
      if (!C.listening) return;
      // The engine gave up on a silence. The therapist did not press Stop.
      quickEnds = (Date.now() - startedAt < 1000) ? quickEnds + 1 : 0;
      if (quickEnds >= 3) { stopDictation(); setMsg('warn', 'Dictation could not keep running. ' + KEPT); return; }
      try { startedAt = Date.now(); rec.start(); } catch (_) { stopDictation(); }
    };
    try {
      quickEnds = 0;
      startedAt = Date.now();
      rec.start();
      C.listening = true;
      setMsg(null, '');
    } catch (_) {
      rec = null;
      C.listening = false;
    }
    renderDictation();
  }

  function stopDictation() {
    var was = C.listening;
    C.listening = false;
    C.interim = '';
    if (rec) {
      try { rec.onend = null; rec.stop(); } catch (_) { /* already stopped */ }
      rec = null;
    }
    if (was) { renderDictation(); renderInterim(); }
  }

  function commitPhrase(phrase) {
    var field = el('cnc-transcript');
    var current = field ? field.value : C.transcript;
    var next = cncAppendFinal(current, phrase);
    if (next === current) return;
    C.transcript = next;
    if (field) { field.value = next; field.scrollTop = field.scrollHeight; }
    transcriptChanged();
  }

  /** Any change to the text or the client withdraws the names check. */
  function transcriptChanged() {
    if (C.names) { C.names = null; C.decisions = {}; renderNames(); }
    renderCount();
    renderActions();
  }

  // ── Names check → draft ───────────────────────────────────────────────────

  function readyToCheck() { return !!(C.client && C.transcript.trim() && !busy()); }

  async function checkNames() {
    if (!readyToCheck()) return;
    stopDictation();
    C.checking = true;
    setMsg('info', 'Checking which names will be hidden…');
    renderActions();
    var sentText = C.transcript;
    var sentClient = C.client.id;
    var d = cncNameDecisions(C.names && C.names.candidates, C.decisions);
    var r = await api(DRAFTS_API + '/names-check', {
      transcript: sentText, linkedClientId: sentClient,
      confirmedNames: d.confirmedNames, ignoredWords: d.ignoredWords,
    });
    C.checking = false;
    if (!r.ok) { setMsg('error', r.error + ' ' + KEPT); renderActions(); return; }
    // An answer about text that has since changed is not an answer.
    if (sentText !== C.transcript || !C.client || sentClient !== C.client.id) { setMsg(null, ''); renderActions(); return; }
    C.names = { hidden: Array.isArray(r.hidden) ? r.hidden : [], candidates: Array.isArray(r.candidates) ? r.candidates : [] };
    setMsg(null, '');
    renderNames();
    renderActions();
  }

  function requestId() {
    try { return global.crypto && global.crypto.randomUUID ? global.crypto.randomUUID() : undefined; } catch (_) { return undefined; }
  }

  async function generate() {
    if (!C.names || !readyToCheck()) return;
    var d = cncNameDecisions(C.names.candidates, C.decisions);
    if (d.undecided.length) { setMsg('warn', 'Answer each flagged word first — is it a person’s name or not?'); return; }
    C.generating = true;
    setMsg('info', 'Writing the draft from your transcript…');
    renderActions();
    var r = await api(DRAFTS_API + '/generate', {
      transcript: C.transcript, linkedClientId: C.client.id,
      confirmedNames: d.confirmedNames, ignoredWords: d.ignoredWords, requestId: requestId(),
    });
    C.generating = false;
    if (!r.ok) {
      // Never retried from here: a refusal or a switched-off feature does not
      // change by asking again, and the transcript stays exactly where it is.
      var text = r.error;
      if (r.code === 'generation_unavailable') text = 'Case-note formatting is not available right now.';
      if (r.code === 'names_not_hidden') text = 'Opa couldn’t keep every name hidden for this dictation, so it was not formatted.';
      if (r.code === 'content_blocked') text = 'This content could not be processed.';
      setMsg(r.status === 502 || r.status === 0 || r.status === 429 ? 'error' : 'warn', text + ' ' + KEPT);
      renderActions();
      return;
    }
    var id = r.draftId || (r.caseNoteDraft && r.caseNoteDraft.id);
    reset();
    close();
    if (global.CaseNotes && typeof global.CaseNotes.reload === 'function') {
      await global.CaseNotes.reload();
      if (id && typeof global.CaseNotes.select === 'function') global.CaseNotes.select(id);
    }
  }

  // ── Rendering — the transcript field is built once and never re-rendered ──

  function clientHtml() {
    if (C.client) {
      return '<div class="cnc-picked">' + icn('user', 14) +
        '<span class="cnc-picked-name">' + esc(C.client.fullName) + '</span>' +
        (C.client.suburb ? '<span class="cn-quiet">' + esc(C.client.suburb) + '</span>' : '') +
        '<button type="button" class="btn" data-cnc="client-clear"' + (busy() ? ' disabled' : '') + '>Change</button></div>';
    }
    var body;
    if (C.clientsLoading) body = '<p class="cn-quiet">Loading your clients…</p>';
    else if (C.clientsError) {
      body = '<p class="cn-inline-error">' + esc(C.clientsError) + '</p>' +
        '<button type="button" class="btn" data-cnc="clients-retry">Try again</button>';
    } else if (!C.clients) body = '';
    else if (!C.clients.length) body = '<p class="cn-quiet">No open clients are on your caseload in Splose.</p>';
    else {
      var hits = cncFilterClients(C.clients, C.query);
      var shown = hits.slice(0, MAX_SHOWN_CLIENTS);
      body = shown.length
        ? '<div class="cnc-results" role="list">' + shown.map(function (c) {
          return '<div role="listitem"><button type="button" class="cnc-result" data-cnc="client-pick" data-cnc-id="' + esc(c.id) + '">' +
            '<span>' + esc(c.fullName) + '</span>' +
            (c.suburb ? '<span class="cn-quiet">' + esc(c.suburb) + '</span>' : '') + '</button></div>';
        }).join('') + '</div>' +
          (hits.length > shown.length ? '<p class="cn-quiet">' + (hits.length - shown.length) + ' more — keep typing to narrow the list.</p>' : '')
        : '<p class="cn-quiet">No client on your caseload matches that.</p>';
    }
    return '<label class="cn-sr-only" for="cnc-search">Search your clients</label>' +
      '<input type="search" id="cnc-search" class="cn-input" data-cnc-input="search" autocomplete="off"' +
        ' placeholder="Search your clients by name or suburb" value="' + esc(C.query) + '">' +
      '<div id="cnc-results-host">' + body + '</div>';
  }

  function renderClient() {
    var host = el('cnc-client');
    if (!host) return;
    host.innerHTML = clientHtml();
  }

  /** Only the result list — so the search field keeps focus and caret. */
  function renderResults() {
    var host = el('cnc-results-host');
    if (!host) { renderClient(); return; }
    var tmp = doc.createElement('div');
    tmp.innerHTML = clientHtml();
    var fresh = tmp.querySelector('#cnc-results-host');
    host.innerHTML = fresh ? fresh.innerHTML : '';
  }

  function renderDictation() {
    var host = el('cnc-dictation');
    if (!host) return;
    var html;
    if (C.listening) {
      html = '<button type="button" class="btn cnc-stop" data-cnc="dictate-stop">' +
        '<span class="cnc-dot" aria-hidden="true"></span> Stop dictating</button>' +
        '<span class="cn-quiet">Listening on this computer. Pauses are fine — it keeps going until you stop it.</span>';
    } else if (C.dictation === 'ready') {
      html = '<button type="button" class="btn" data-cnc="dictate-start"' + (busy() ? ' disabled' : '') + '>' + MIC_SVG + ' Dictate</button>' +
        '<span class="cn-quiet">Transcribed on this computer. No audio is recorded or sent anywhere.</span>';
    } else if (C.dictation === 'installable' || C.dictation === 'installing') {
      html = '<button type="button" class="btn" data-cnc="dictate-install"' + (C.dictation === 'installing' ? ' disabled' : '') + '>' +
        MIC_SVG + ' ' + (C.dictation === 'installing' ? 'Setting up…' : 'Set up on-device dictation') + '</button>' +
        '<span class="cn-quiet">A one-off download of the browser’s speech pack, so dictation can run on this computer.</span>';
    } else if (C.dictation === 'unavailable') {
      html = '<span class="cn-quiet">' + esc(DICTATION_OFF) + '</span>';
    } else {
      html = '<span class="cn-quiet">Checking whether this browser can dictate on-device…</span>';
    }
    host.innerHTML = html;
  }

  function renderInterim() {
    var host = el('cnc-interim');
    if (host) host.textContent = C.interim ? '… ' + C.interim : '';
  }

  function renderCount() {
    var host = el('cnc-count');
    if (!host) return;
    var n = C.transcript.length;
    host.textContent = n + ' of ' + CNC_MAX_TRANSCRIPT_CHARS + ' characters';
    host.classList.toggle('cnc-over', n >= CNC_MAX_TRANSCRIPT_CHARS);
  }

  function renderNames() {
    var host = el('cnc-names');
    if (!host) return;
    if (!C.names) { host.innerHTML = ''; return; }
    var hidden = C.names.hidden.map(function (h) {
      return '<li>' + esc(h.label || 'A name') + ' <span class="cn-quiet">× ' + esc(h.count) + '</span></li>';
    }).join('');
    var cands = C.names.candidates.map(function (c, i) {
      var pick = C.decisions[c.word];
      return '<div class="cnc-cand" role="group" aria-label="' + esc('Is ' + c.word + ' a person?') + '">' +
        '<span class="cnc-cand-word">' + esc(c.word) + '</span>' +
        '<button type="button" class="btn' + (pick === 'person' ? ' primary' : '') + '" data-cnc="cand-person" data-cnc-idx="' + i + '"' +
          ' aria-pressed="' + (pick === 'person' ? 'true' : 'false') + '">A person — hide it</button>' +
        '<button type="button" class="btn' + (pick === 'word' ? ' primary' : '') + '" data-cnc="cand-word" data-cnc-idx="' + i + '"' +
          ' aria-pressed="' + (pick === 'word' ? 'true' : 'false') + '">Not a name — keep it</button></div>';
    }).join('');
    host.innerHTML = '<section class="cnc-names" aria-labelledby="cnc-names-h">' +
      '<h3 id="cnc-names-h" class="cn-pane-head">' + icn('lock', 13) + ' Names hidden before the AI sees this</h3>' +
      (hidden ? '<ul class="cnc-hidden">' + hidden + '</ul>'
        : '<p class="cn-quiet">No known names were found in this transcript.</p>') +
      (cands ? '<p class="cnc-ask">These words might be names. Say which are people:</p>' + cands : '') +
      '<p class="cn-quiet">Hidden names are swapped for placeholders on the way out and restored in your draft.</p>' +
      '</section>';
  }

  function renderActions() {
    var host = el('cnc-actions');
    if (!host) return;
    var undecided = C.names ? cncNameDecisions(C.names.candidates, C.decisions).undecided.length : 0;
    var primary = C.names
      ? '<button type="button" class="btn primary" data-cnc="generate"' + ((!readyToCheck() || undecided) ? ' disabled' : '') + '>' +
          icn('doc', 13) + ' ' + (C.generating ? 'Writing the draft…' : 'Create case note draft') + '</button>'
      : '<button type="button" class="btn primary" data-cnc="check"' + (!readyToCheck() ? ' disabled' : '') + '>' +
          icn('lock', 13) + ' ' + (C.checking ? 'Checking…' : 'Check names') + '</button>';
    var hint = !C.client ? 'Link a client first.'
      : !C.transcript.trim() ? 'Dictate or type what happened in the session.'
      : !C.names ? 'Next: see which names will be hidden.'
      : undecided ? undecided + (undecided === 1 ? ' word' : ' words') + ' still to answer.'
      : 'The draft opens for your review. Nothing is sent to Splose or Outlook.';
    host.innerHTML = primary +
      '<button type="button" class="btn" data-cnc="close"' + (C.generating ? ' disabled' : '') + '>Cancel</button>' +
      '<span class="cn-quiet">' + esc(hint) + '</span>';
    var pickBtn = doc.querySelector('[data-cnc="client-clear"]');
    if (pickBtn) pickBtn.disabled = busy();
  }

  function renderMsg() {
    var host = el('cnc-msg');
    if (!host) return;
    host.innerHTML = C.msg ? '<p class="cn-msg cn-msg-' + esc(C.msg.kind) + '">' + esc(C.msg.text) + '</p>' : '';
  }

  function renderShell() {
    var root = el('cnc-root');
    if (!root) return;
    root.innerHTML =
      '<div class="cn-page-head"><h1>New case note</h1>' +
        '<p class="cn-quiet">Link a client, then dictate or type what happened. Opal turns it into a draft in the practice format for you to review.</p></div>' +
      '<div class="cnc-panel">' +
        '<section class="cnc-step" aria-labelledby="cnc-h-client"><h2 id="cnc-h-client" class="cn-pane-head">1 · Client</h2>' +
          '<div id="cnc-client"></div></section>' +
        '<section class="cnc-step" aria-labelledby="cnc-h-tx"><h2 id="cnc-h-tx" class="cn-pane-head"><label for="cnc-transcript">2 · What happened</label></h2>' +
          '<div id="cnc-dictation" class="cnc-dictation"></div>' +
          '<textarea id="cnc-transcript" class="cn-note cnc-transcript" data-cnc-input="transcript" spellcheck="true"' +
            ' maxlength="' + CNC_MAX_TRANSCRIPT_CHARS + '" aria-describedby="cnc-count"' +
            ' placeholder="Dictate, or type your session notes here in your own words."></textarea>' +
          '<p id="cnc-interim" class="cnc-interim" aria-live="off"></p>' +
          '<p id="cnc-count" class="cn-quiet"></p></section>' +
        '<div id="cnc-names"></div>' +
        '<div id="cnc-msg" role="status" aria-live="polite"></div>' +
        '<div id="cnc-actions" class="cnc-actions"></div>' +
      '</div>';
    var field = el('cnc-transcript');
    if (field) field.value = C.transcript;
    renderClient(); renderDictation(); renderCount(); renderNames(); renderMsg(); renderActions();
  }

  // ── Open / close ──────────────────────────────────────────────────────────

  function reset() {
    stopDictation();
    C.client = null; C.query = ''; C.transcript = ''; C.interim = '';
    C.names = null; C.decisions = {}; C.msg = null;
  }

  function open() {
    var root = el('cnc-root');
    var review = el('cn-root');
    if (!root || C.open) return;
    C.open = true;
    if (review) review.hidden = true;
    root.hidden = false;
    renderShell();
    if (!C.clients && !C.clientsLoading) loadClients();
    if (C.dictation === 'unknown') probeDictation();
    var search = el('cnc-search');
    if (search) { try { search.focus(); } catch (_) { /* not focusable yet */ } }
  }

  function close() {
    stopDictation();
    C.open = false;
    var root = el('cnc-root');
    var review = el('cn-root');
    if (root) { root.hidden = true; root.innerHTML = ''; }
    if (review) review.hidden = false;
  }

  /** Cancel keeps nothing: a half-dictated clinical transcript is not parked in the page. */
  function cancel() {
    if (C.generating) return;
    reset();
    close();
  }

  // ── Events ────────────────────────────────────────────────────────────────

  doc.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-cnc]') : null;
    if (!t) return;
    var action = t.getAttribute('data-cnc');
    if (action === 'open') { open(); return; }
    if (!C.open) return;
    if (action === 'close') { cancel(); return; }
    if (action === 'clients-retry') { loadClients(); return; }
    if (action === 'client-pick') {
      var id = t.getAttribute('data-cnc-id');
      var hit = (C.clients || []).filter(function (c) { return String(c.id) === String(id); })[0];
      if (hit) { C.client = hit; C.query = ''; renderClient(); transcriptChanged(); }
      return;
    }
    if (action === 'client-clear') { if (!busy()) { C.client = null; renderClient(); transcriptChanged(); } return; }
    if (action === 'dictate-start') { startDictation(); return; }
    if (action === 'dictate-stop') { stopDictation(); return; }
    if (action === 'dictate-install') { installDictation(); return; }
    if (action === 'check') { checkNames(); return; }
    if (action === 'generate') { generate(); return; }
    if (action === 'cand-person' || action === 'cand-word') {
      var c = C.names && C.names.candidates[Number(t.getAttribute('data-cnc-idx'))];
      if (c) { C.decisions[c.word] = action === 'cand-person' ? 'person' : 'word'; renderNames(); renderActions(); }
    }
  });

  doc.addEventListener('input', function (e) {
    var t = e.target;
    var kind = t && t.getAttribute ? t.getAttribute('data-cnc-input') : null;
    if (!kind) return;
    if (kind === 'search') { C.query = t.value; renderResults(); return; }
    if (kind === 'transcript') { C.transcript = t.value; transcriptChanged(); }
  });

  // A microphone must never stay live on a screen the therapist has left.
  (global.addEventListener ? global : doc).addEventListener('click', function (e) {
    if (!C.listening) return;
    var tab = e.target && e.target.closest ? e.target.closest('.tab[data-tab]') : null;
    if (tab && tab.dataset.tab !== 'casenotes') stopDictation();
  }, true);
  doc.addEventListener('visibilitychange', function () { if (doc.hidden) stopDictation(); });

  // ── Public surface ────────────────────────────────────────────────────────

  global.CaseNotesCompose = { open: open, close: cancel, _state: C, _helpers: helpers };

})(typeof window !== 'undefined' ? window : null);
