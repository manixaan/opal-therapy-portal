/**
 * Opal Assist — the web page (and, with ?surface=word|excel|outlook, the
 * Office task pane). No framework.
 *
 * The one idea: THE SERVER ONLY EVER SEES TOKENS. Before a message is sent
 * it goes to /api/assist/check, which returns the text with every known
 * person and contact detail replaced by a token, plus the list of what was
 * hidden. This page keeps the token→name map for the conversation — in
 * memory and sessionStorage, never on the server — and puts the names back
 * when it renders, in both directions. A reply that mentions [CLIENT_1] is
 * shown with the client's name; the model never had it.
 *
 * Pure helpers (restoreTokens, splitTokens) are exported for node tests and
 * the file returns early without a DOM.
 */
(function (global) {
  'use strict';

  var TOKEN_RE = /\[([A-Z][A-Z0-9_]*)\]/g;

  /** Split text into runs: {text} or {token}. */
  function splitTokens(text) {
    var out = [];
    var last = 0;
    var m;
    TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(String(text || ''))) !== null) {
      if (m.index > last) out.push({ text: text.slice(last, m.index) });
      out.push({ token: m[1] });
      last = m.index + m[0].length;
    }
    if (last < String(text || '').length) out.push({ text: text.slice(last) });
    return out;
  }

  /** Plain-text restoration (for copy / insert). Unknown tokens stay bracketed. */
  function restoreTokens(text, names) {
    return String(text || '').replace(TOKEN_RE, function (whole, t) { return names && names[t] ? names[t] : whole; });
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { splitTokens, restoreTokens };
  if (!global.document) return;

  // ── State ─────────────────────────────────────────────────────────────────
  var params = new URLSearchParams(global.location.search);
  var S = {
    surface: ['word', 'excel', 'outlook', 'mobile'].indexOf(params.get('surface')) >= 0 ? params.get('surface') : 'web',
    enabled: false,
    user: null,
    conversationId: null,
    title: 'New chat',
    messages: [],        // [{ role:'user'|'assistant', text (tokenised), error?, live? }]
    names: {},           // token → display name (this browser only)
    known: [],           // [{token, ref|name, role}] echoed to /check for stable tokens
    ignoredWords: [],
    selection: '',       // raw selected content (tokenised at send)
    busy: false,
    abort: null,
    review: null,        // pending check result awaiting confirmation
  };

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var api = function (path, opts) {
    opts = opts || {};
    return fetch(path, { credentials: 'include', headers: opts.body ? { 'Content-Type': 'application/json' } : {}, method: opts.method || (opts.body ? 'POST' : 'GET'), body: opts.body ? JSON.stringify(opts.body) : undefined, signal: opts.signal });
  };

  // ── Per-conversation map, this browser only ───────────────────────────────
  function saveMap() {
    if (!S.conversationId) return;
    try { sessionStorage.setItem('oa.map.' + S.conversationId, JSON.stringify({ names: S.names, known: S.known, ignoredWords: S.ignoredWords })); } catch (e) { /* private mode */ }
  }
  function loadMap(id) {
    try { var raw = sessionStorage.getItem('oa.map.' + id); if (raw) { var m = JSON.parse(raw); S.names = m.names || {}; S.known = m.known || []; S.ignoredWords = m.ignoredWords || []; return; } } catch (e) { /* ignore */ }
    S.names = {}; S.known = []; S.ignoredWords = [];
  }

  // ── Rendering ─────────────────────────────────────────────────────────────
  function renderTokens(text, userSide) {
    return splitTokens(text).map(function (run) {
      if (run.text !== undefined) return esc(run.text);
      var name = S.names[run.token];
      return name
        ? '<span class="oa-name" title="Hidden from the AI as [' + esc(run.token) + ']">' + esc(name) + '</span>'
        : '<span class="oa-name token" title="A person or detail this browser has no name for">[' + esc(run.token) + ']</span>';
    }).join('');
  }

  function renderStack() {
    var stack = $('oa-stack');
    if (!S.messages.length) {
      stack.innerHTML = '<div class="oa-empty"><img src="/icons/opal-assist.svg" alt=""><h1>Opal Assist</h1>'
        + '<p>Draft letters and emails, tidy case-note wording, prepare for plan reviews, summarise documents, build spreadsheet formulas. '
        + 'Paste what you have — names and contact details are hidden before anything leaves the practice.</p>'
        + '<div class="oa-chips">' + [
          'Draft a plan review summary from these notes',
          'Rewrite this email to a parent in plain language',
          'Turn these bullet points into a progress letter',
          'Explain this NDIS support item',
        ].map(function (c) { return '<button class="oa-chip" type="button" data-chip="' + esc(c) + '">' + esc(c) + '</button>'; }).join('') + '</div></div>';
      return;
    }
    stack.innerHTML = S.messages.map(function (m, i) {
      if (m.role === 'user') return '<div class="oa-msg user"><div class="oa-bubble">' + renderTokens(m.text, true) + '</div></div>';
      var body = m.live && !m.text ? '<div class="oa-thinking">Opal Assist is thinking</div>' : renderTokens(m.text);
      var tools = (!m.live && !m.error) ? '<div class="oa-tools"><button class="oa-btn ghost sm" type="button" data-copy="' + i + '">Copy</button>'
        + (S.surface !== 'web' ? '<button class="oa-btn ghost sm" type="button" data-insert="' + i + '">Insert into document</button>' : '') + '</div>' : '';
      return '<div class="oa-msg assistant' + (m.error ? ' error' : '') + '"><img class="oa-avatar" src="/icons/opal-assist.svg" alt=""><div><div class="oa-bubble">' + body + '</div>' + tools + '</div></div>';
    }).join('');
    $('oa-body').scrollTop = $('oa-body').scrollHeight;
  }
  var renderQueued = false;
  function scheduleRender() { if (renderQueued) return; renderQueued = true; requestAnimationFrame(function () { renderQueued = false; renderStack(); }); }

  function setStatus(text, cls) { var p = $('oa-status'); p.textContent = text; p.className = 'oa-pill' + (cls ? ' ' + cls : ''); }
  function setBusy(b) { S.busy = b; $('oa-send').disabled = b || !S.enabled; $('oa-stop').style.display = b ? '' : 'none'; $('oa-input').disabled = b; }

  // ── Review card ───────────────────────────────────────────────────────────
  function renderReview() {
    var slot = $('oa-review-slot');
    var r = S.review;
    if (!r) { slot.innerHTML = ''; return; }
    var hidden = r.hidden.map(function (h) { return '<li>' + esc(h.name) + ' <b>→ [' + esc(h.token) + ']</b></li>'; }).join('');
    var cands = r.candidates.length ? '<div class="oa-cands"><h3>Is any of these a person? They would be sent as written.</h3>'
      + r.candidates.map(function (c) {
        return '<span class="oa-cand">' + esc(c.word) + ' <button class="oa-btn sm" type="button" data-hide="' + esc(c.word) + '">Hide</button><button class="oa-btn ghost sm" type="button" data-ignore="' + esc(c.word) + '">Not a person</button></span>';
      }).join('') + '</div>' : '';
    slot.innerHTML = '<div class="oa-review" role="dialog" aria-label="Check before sending">'
      + '<h2>' + (r.hidden.length ? r.hidden.length + ' item' + (r.hidden.length === 1 ? '' : 's') + ' will be hidden' : 'Nothing to hide') + '</h2>'
      + '<p class="lead">This is exactly what leaves the practice. Tokens stand in for people and contact details; you keep seeing the real names.</p>'
      + '<div class="oa-preview">' + esc(r.text) + (r.selectionText ? '\n\n— selected content —\n' + esc(r.selectionText) : '') + '</div>'
      + (hidden ? '<ul class="oa-hidden">' + hidden + '</ul>' : '')
      + cands
      + '<div class="oa-addname"><input id="oa-addname" type="text" placeholder="Hide another name the check missed…" aria-label="Name to hide"><button class="oa-btn sm" type="button" id="oa-addname-btn">Hide it</button></div>'
      + (r.directoryPartial ? '<p class="oa-note">Part of the practice directory was unavailable, so check the preview carefully.</p>' : '')
      + '<div class="oa-review-actions"><button class="oa-btn" type="button" id="oa-review-edit">Edit message</button><button class="oa-btn primary" type="button" id="oa-review-send">Send</button></div>'
      + '</div>';
    $('oa-review-send').focus();
  }

  /** Run the server check on the message (and selection) and open the review card. */
  function runCheck(rawText) {
    setBusy(true);
    setStatus('Checking…');
    var confirmed = S.known.filter(function (k) { return k.name; }).map(function (k) { return k.name; }).concat(S.pendingConfirmed || []);
    return api('/api/assist/check', { body: { text: rawText, known: S.known, confirmedNames: confirmed, ignoredWords: S.ignoredWords } })
      .then(function (r) { if (!r.ok) throw new Error('check_failed'); return r.json(); })
      .then(function (msg) {
        var pending = { text: msg.text, hidden: msg.hidden, candidates: msg.candidates, known: msg.known, directoryPartial: msg.directoryPartial, raw: rawText };
        if (!S.selection) return pending;
        return api('/api/assist/check', { body: { text: S.selection, known: msg.known, confirmedNames: confirmed, ignoredWords: S.ignoredWords } })
          .then(function (r) { if (!r.ok) throw new Error('check_failed'); return r.json(); })
          .then(function (sel) {
            pending.selectionText = sel.text; pending.known = sel.known;
            pending.hidden = pending.hidden.concat(sel.hidden.filter(function (h) { return !pending.hidden.some(function (p) { return p.token === h.token; }); }));
            pending.candidates = pending.candidates.concat(sel.candidates.filter(function (c) { return !pending.candidates.some(function (p) { return p.word === c.word; }); }));
            return pending;
          });
      })
      .then(function (pending) {
        pending.hidden.forEach(function (h) { S.names[h.token] = h.name; });
        S.review = pending;
        setBusy(false); setStatus('Ready');
        renderReview();
      })
      .catch(function () { setBusy(false); setStatus('Check failed', 'warn'); });
  }

  // ── Sending ───────────────────────────────────────────────────────────────
  function confirmSend() {
    var r = S.review;
    if (!r) return;
    S.review = null; renderReview();
    S.known = r.known || S.known;
    S.pendingConfirmed = [];
    S.messages.push({ role: 'user', text: r.text });
    $('oa-input').value = '';
    var live = { role: 'assistant', text: '', live: true };
    S.messages.push(live);
    renderStack();
    setBusy(true); setStatus('Thinking…');
    var ctrl = new AbortController(); S.abort = ctrl;
    var body = { message: r.text, conversationId: S.conversationId, surface: S.surface, hiddenCount: r.hidden.length, known: S.known };
    if (r.selectionText) body.selection = r.selectionText;
    S.selection = ''; updateSelectionBar();

    api('/api/assist/chat/stream', { body: body, signal: ctrl.signal }).then(function (res) {
      if (res.status === 422) return res.json().then(function (j) { live.text = j.answer || 'That text still contains a name or contact detail.'; live.error = true; live.live = false; });
      if (res.status === 429) return res.json().then(function (j) { live.text = j.answer; live.error = true; live.live = false; });
      var ct = res.headers.get('content-type') || '';
      if (ct.indexOf('text/event-stream') < 0) return res.json().then(function (j) { live.text = j.answer || 'Opal Assist is unavailable right now.'; live.error = j.status !== 'ok'; live.live = false; if (j.conversationId) S.conversationId = j.conversationId; });
      return readSse(res, live);
    }).catch(function (err) {
      live.live = false;
      if (!live.text) { live.text = err && err.name === 'AbortError' ? 'Stopped.' : 'Opal Assist is unavailable right now.'; live.error = true; }
    }).then(function () {
      live.live = false; S.abort = null; setBusy(false); setStatus('Ready');
      saveMap(); renderStack(); loadThreads(); $('oa-input').focus();
    });
  }

  function readSse(res, live) {
    var reader = res.body.getReader(); var dec = new TextDecoder(); var buf = '';
    function handle(ev, data) {
      if (ev === 'delta') { live.text += (data.t || ''); scheduleRender(); }
      else if (ev === 'done') { if (data.answer) live.text = data.answer; if (data.conversationId) { S.conversationId = data.conversationId; if (S.title === 'New chat') S.title = restoreTokens(S.messages[0].text, S.names).slice(0, 60); $('oa-title').textContent = S.title; } }
      else if (ev === 'blocked' || ev === 'unavailable') { live.text = data.answer; live.error = true; }
    }
    function pump() {
      return reader.read().then(function (step) {
        if (step.done) return;
        buf += dec.decode(step.value, { stream: true });
        var blocks = buf.split('\n\n'); buf = blocks.pop();
        blocks.forEach(function (block) {
          var ev = null, data = '';
          block.split('\n').forEach(function (line) { if (line.indexOf('event: ') === 0) ev = line.slice(7).trim(); else if (line.indexOf('data: ') === 0) data += line.slice(6); });
          if (ev) { try { handle(ev, JSON.parse(data || '{}')); } catch (e) { /* skip */ } }
        });
        return pump();
      });
    }
    return pump();
  }

  // ── Threads ───────────────────────────────────────────────────────────────
  function loadThreads() {
    return api('/api/assist/conversations').then(function (r) { return r.ok ? r.json() : { conversations: [] }; }).then(function (d) {
      var el = $('oa-threads');
      el.innerHTML = (d.conversations || []).map(function (c) {
        return '<button class="oa-thread' + (c.id === S.conversationId ? ' active' : '') + '" type="button" data-open="' + esc(c.id) + '">' + esc(c.title || 'Chat') + '<small>' + esc(new Date(c.updated_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })) + ' · ' + esc(c.surface) + '</small></button>';
      }).join('') || '<p class="oa-note" style="padding:8px 10px;">No chats yet.</p>';
    }).catch(function () {});
  }
  function openThread(id) {
    api('/api/assist/conversations/' + id).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d) return;
      S.conversationId = id; loadMap(id);
      S.title = d.conversation.title || 'Chat'; $('oa-title').textContent = S.title;
      S.messages = d.messages.map(function (m) { return { role: m.role, text: m.content }; });
      S.review = null; renderReview(); renderStack(); loadThreads();
    });
  }
  function newChat() {
    S.conversationId = null; S.messages = []; S.names = {}; S.known = []; S.ignoredWords = []; S.review = null; S.title = 'New chat';
    $('oa-title').textContent = S.title; renderReview(); renderStack(); loadThreads(); $('oa-input').focus();
  }

  // ── Selection (Office surfaces) ───────────────────────────────────────────
  function updateSelectionBar() {
    var bar = $('oa-selection');
    if (S.selection) { bar.classList.add('show'); $('oa-selection-info').textContent = S.selection.length + ' characters'; } else bar.classList.remove('show');
  }
  function setSelection(text) { S.selection = String(text || '').slice(0, 20000); updateSelectionBar(); }

  // ── Events ────────────────────────────────────────────────────────────────
  function onSend() {
    if (S.busy || !S.enabled) return;
    var raw = $('oa-input').value.trim();
    if (!raw) return;
    runCheck(raw);
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest('button, a'); if (!t) return;
    if (t.id === 'oa-send') return onSend();
    if (t.id === 'oa-stop') { if (S.abort) S.abort.abort(); return; }
    if (t.id === 'oa-new') return newChat();
    if (t.id === 'oa-menu') { $('oa-side').classList.toggle('open'); return; }
    if (t.id === 'oa-review-send') return confirmSend();
    if (t.id === 'oa-review-edit') { S.review = null; renderReview(); $('oa-input').focus(); return; }
    if (t.id === 'oa-addname-btn') { var v = $('oa-addname').value.trim(); if (v) { S.pendingConfirmed = (S.pendingConfirmed || []).concat([v]); runCheck(S.review.raw); } return; }
    if (t.id === 'oa-selection-clear') { setSelection(''); return; }
    if (t.dataset.hide) { S.pendingConfirmed = (S.pendingConfirmed || []).concat([t.dataset.hide]); runCheck(S.review.raw); return; }
    if (t.dataset.ignore) { S.ignoredWords.push(t.dataset.ignore); runCheck(S.review.raw); return; }
    if (t.dataset.open) return openThread(t.dataset.open);
    if (t.dataset.chip) { $('oa-input').value = t.dataset.chip + ':\n\n'; $('oa-input').focus(); return; }
    if (t.dataset.copy !== undefined) { var m = S.messages[+t.dataset.copy]; navigator.clipboard.writeText(restoreTokens(m.text, S.names)).then(function () { t.textContent = 'Copied'; setTimeout(function () { t.textContent = 'Copy'; }, 1200); }); return; }
    if (t.dataset.insert !== undefined) { var mm = S.messages[+t.dataset.insert]; if (typeof global.OpalAssist.onInsert === 'function') global.OpalAssist.onInsert(restoreTokens(mm.text, S.names)); return; }
  });
  $('oa-input').addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); } });

  // ── Boot ──────────────────────────────────────────────────────────────────
  function boot() {
    if (S.surface !== 'web') document.body.classList.add('oa-pane');
    if (global.innerWidth < 760) $('oa-menu').style.display = '';
    renderStack(); updateSelectionBar();
    api('/api/auth/me').then(function (r) { return r.ok ? r.json() : null; }).then(function (u) { S.user = u; }).catch(function () {});
    api('/api/assist/config').then(function (r) { if (r.status === 401) { global.location.href = '/login?next=' + encodeURIComponent(global.location.pathname + global.location.search); return null; } return r.json(); })
      .then(function (c) {
        if (!c) return;
        S.enabled = !!c.enabled;
        setStatus(S.enabled ? 'Ready' : 'Not switched on', S.enabled ? '' : 'off');
        $('oa-send').disabled = !S.enabled;
        if (!S.enabled) $('oa-hint').textContent = 'Opal Assist is not switched on for this portal yet. Ask the practice owner.';
      }).catch(function () { setStatus('Unavailable', 'off'); });
    loadThreads();
  }
  global.OpalAssist = { setSelection: setSelection, newChat: newChat, onInsert: null, _state: S };
  boot();
})(typeof window !== 'undefined' ? window : globalThis);
