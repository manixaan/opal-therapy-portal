/**
 * Opal Assist — the web page (and, with ?surface=word|excel|outlook, the
 * Office task pane). No framework.
 *
 * The one idea: THE SERVER ONLY EVER SEES TOKENS. Before a message is sent
 * it goes to /api/assist/check, which returns the text with every known
 * person and contact detail replaced by a token, plus the list of what was
 * hidden. This page keeps the token→name map for the conversation — in
 * memory and this browser's localStorage, never on the server — and puts the names back
 * when it renders, in both directions. A reply that mentions [CLIENT_1] is
 * shown with the client's name; the model never had it.
 *
 * CLIENT CHATS. The side panel lists the person's own clients. Picking one
 * files every new chat under that client: the client is pinned as
 * [CLIENT_1] from the first message (the server pins it too), and the
 * panel shows only that client's earlier chats. The map is kept in
 * localStorage for the 30 days a chat lives, so a chat reopened tomorrow —
 * in the portal's tab or the installed Opal Assist app — still shows names.
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

  /** The starting map for a chat about one client: the client is always [CLIENT_1]. */
  function clientSeed(client) {
    if (!client) return { names: {}, known: [] };
    return { names: { CLIENT_1: client.name }, known: [{ token: 'CLIENT_1', ref: client.ref, role: 'client' }] };
  }

  /** Clients whose name (or suburb) matches every typed word. */
  function filterClients(list, q) {
    var words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
    return (list || []).filter(function (c) {
      var hay = (String(c.name || '') + ' ' + String(c.suburb || '')).toLowerCase();
      return words.every(function (w) { return hay.indexOf(w) >= 0; });
    });
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { splitTokens, restoreTokens, clientSeed, filterClients };
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
    client: null,        // { ref, name } — the client this chat belongs to, or null (general)
    clients: [],         // the person's own clients, for the picker
    clientsError: '',
  };
  var MAP_TTL_MS = 31 * 24 * 3600 * 1000; // chats live 30 days on the server

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  // Inside Office there is no portal cookie (cross-site iframe); the pane
  // presents a Microsoft 365 token instead, which the server maps to the
  // same portal account by email.
  var office = function () { return global.OpalAssistOffice || null; };
  var api = function (path, opts) {
    opts = opts || {};
    var headers = opts.body ? { 'Content-Type': 'application/json' } : {};
    var withToken = office() ? office().token() : Promise.resolve(null);
    return withToken.then(function (tok) {
      if (tok) headers.Authorization = 'Bearer ' + tok;
      return fetch(path, { credentials: 'include', headers: headers, method: opts.method || (opts.body ? 'POST' : 'GET'), body: opts.body ? JSON.stringify(opts.body) : undefined, signal: opts.signal });
    });
  };

  // ── Per-conversation map, this browser only ───────────────────────────────
  function saveMap() {
    if (!S.conversationId) return;
    try { localStorage.setItem('oa.map.' + S.conversationId, JSON.stringify({ names: S.names, known: S.known, ignoredWords: S.ignoredWords, at: Date.now() })); } catch (e) { /* private mode */ }
  }
  function loadMap(id) {
    try {
      var raw = localStorage.getItem('oa.map.' + id) || sessionStorage.getItem('oa.map.' + id);
      if (raw) { var m = JSON.parse(raw); S.names = m.names || {}; S.known = m.known || []; S.ignoredWords = m.ignoredWords || []; return; }
    } catch (e) { /* ignore */ }
    S.names = {}; S.known = []; S.ignoredWords = [];
  }
  /** Names are kept no longer than the chat itself. */
  function pruneMaps() {
    try {
      for (var i = localStorage.length - 1; i >= 0; i--) {
        var k = localStorage.key(i);
        if (!k || k.indexOf('oa.map.') !== 0) continue;
        var m = null; try { m = JSON.parse(localStorage.getItem(k)); } catch (e) { m = null; }
        if (!m || !m.at || Date.now() - m.at > MAP_TTL_MS) localStorage.removeItem(k);
      }
    } catch (e) { /* storage blocked */ }
  }
  /** The client's own name always shows, even when this browser has no map for the chat. */
  function pinClientName() {
    if (!S.client) return;
    if (S.client.name) S.names.CLIENT_1 = S.client.name;
    if (!S.known.some(function (k) { return k.ref === S.client.ref; })) S.known = clientSeed(S.client).known.concat(S.known);
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
      // A task pane is narrow: one quiet line, not the full welcome.
      if (S.surface !== 'web') { stack.innerHTML = '<div class="oa-empty oa-empty-pane"><img src="/icons/opal-assist.svg?v=3" alt=""><p>Ask a question, or select text and press Use selection.</p></div>'; return; }
      stack.innerHTML = '<div class="oa-empty"><img src="/icons/opal-assist.svg?v=3" alt=""><h1>Opal Assist</h1>'
        + '<p>' + (S.client ? 'Everything in this chat is about <b>' + esc(S.client.name) + '</b>, who the AI only ever sees as [CLIENT_1]. ' : '')
        + 'Paste your case note, FCA section or letter and ask for it rephrased, tightened or rewritten — names and contact details are hidden before anything leaves the practice.</p>'
        + '<div class="oa-chips">' + [
          'Rephrase this case note in professional, objective language',
          'Rewrite this FCA section in person-centred, reasonable-and-necessary terms',
          'Turn these notes into a progress letter paragraph for the family',
          'Make this shorter and clearer without changing the meaning',
        ].map(function (c) { return '<button class="oa-chip" type="button" data-chip="' + esc(c) + '">' + esc(c) + '</button>'; }).join('') + '</div></div>';
      return;
    }
    stack.innerHTML = S.messages.map(function (m, i) {
      if (m.role === 'user') return '<div class="oa-msg user"><div class="oa-bubble">' + renderTokens(m.text, true) + '</div></div>';
      var body = m.live && !m.text ? '<div class="oa-thinking">Opal Assist is thinking</div>' : renderTokens(m.text);
      var tools = (!m.live && !m.error) ? '<div class="oa-tools"><button class="oa-btn ghost sm" type="button" data-copy="' + i + '">Copy</button>'
        + (S.surface !== 'web' ? '<button class="oa-btn ghost sm" type="button" data-insert="' + i + '">Insert into document</button>' : '') + '</div>' : '';
      return '<div class="oa-msg assistant' + (m.error ? ' error' : '') + '"><img class="oa-avatar" src="/icons/opal-assist.svg?v=3" alt=""><div><div class="oa-bubble">' + body + '</div>' + tools + '</div></div>';
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
      + (r.directoryPartial ? '<p class="oa-note warn"><b>Names may not be recognised right now.</b> ' + esc((r.directoryMissing || []).join(', ') || 'Part of the practice directory') + ' could not be loaded, so people from there are not hidden automatically. Type any name into the box above and press Hide it, or wait thirty seconds and press Check &amp; send again.</p>' : '')
      + (r.cautions || []).map(function (c) { return '<p class="oa-note warn"><b>' + (c.kind === 'combination' ? 'Could still identify someone.' : 'Sensitive topic.') + '</b> ' + esc(c.message) + '</p>'; }).join('')
      + ((r.directoryNotConnected || []).length ? '<p class="oa-note warn"><b>Splose is not connected on this server,</b> so client and contact names are not recognised. Hide them yourself with the box above.</p>' : '')
      + '<div class="oa-review-actions"><button class="oa-btn" type="button" id="oa-review-edit">Edit message</button><button class="oa-btn primary" type="button" id="oa-review-send">Send</button></div>'
      + '</div>';
    $('oa-review-send').focus();
  }

  /** Run the server check on the message (and selection) and open the review card. */
  function runCheck(rawText) {
    setBusy(true);
    setStatus('Checking…');
    var confirmed = S.known.filter(function (k) { return k.name; }).map(function (k) { return k.name; }).concat(S.pendingConfirmed || []);
    var clientRef = S.client ? S.client.ref : undefined;
    return api('/api/assist/check', { body: { text: rawText, known: S.known, confirmedNames: confirmed, ignoredWords: S.ignoredWords, clientRef: clientRef } })
      .then(function (r) {
        if (r.status === 503 || r.status === 400) return r.json().then(function (j) { throw new Error(j.message || 'check_failed'); });
        if (!r.ok) throw new Error('check_failed'); return r.json();
      })
      .then(function (msg) {
        var pending = { text: msg.text, hidden: msg.hidden, candidates: msg.candidates, known: msg.known, directoryPartial: msg.directoryPartial, directoryMissing: msg.directoryMissing, directoryNotConnected: msg.directoryNotConnected, cautions: msg.cautions || [], raw: rawText };
        if (!S.selection) return pending;
        return api('/api/assist/check', { body: { text: S.selection, known: msg.known, confirmedNames: confirmed, ignoredWords: S.ignoredWords, clientRef: clientRef } })
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
      .catch(function (err) {
        setBusy(false); setStatus('Check failed', 'warn');
        if (err && err.message && err.message !== 'check_failed') $('oa-review-slot').innerHTML = '<p class="oa-note warn">' + esc(err.message) + '</p>';
      });
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
    if (S.client) body.clientRef = S.client.ref;
    if (r.selectionText) body.selection = r.selectionText;
    S.selection = ''; updateSelectionBar();

    api('/api/assist/chat/stream', { body: body, signal: ctrl.signal }).then(function (res) {
      if (res.status === 422) return res.json().then(function (j) { live.text = j.answer || 'That text still contains a name or contact detail.'; live.error = true; live.live = false; });
      if (res.status === 429 || res.status === 503 || res.status === 400 || res.status === 403 || res.status === 404 || res.status === 502) return res.json().then(function (j) { live.text = j.answer || j.error || 'Opal Assist is unavailable right now.'; live.error = true; live.live = false; });
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
    var q = S.surface === 'web' ? '?client=' + encodeURIComponent(S.client ? S.client.ref : 'general') : '';
    $('oa-threads-label').textContent = S.surface !== 'web' ? 'Chats' : S.client ? 'Chats about ' + S.client.name : 'General chats (no client)';
    return api('/api/assist/conversations' + q).then(function (r) { return r.ok ? r.json() : { conversations: [] }; }).then(function (d) {
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
      var ref = d.conversation.client_ref || null;
      S.client = ref ? (S.clients.filter(function (c) { return c.ref === ref; })[0] || { ref: ref, name: '' }) : null;
      pinClientName(); saveMap(); renderClientChip(); renderClients();
      S.title = d.conversation.title || 'Chat'; $('oa-title').textContent = S.title;
      S.messages = d.messages.map(function (m) { return { role: m.role, text: m.content }; });
      S.review = null; renderReview(); renderStack(); loadThreads();
    });
  }
  function newChat() {
    var seed = clientSeed(S.client);
    S.conversationId = null; S.messages = []; S.names = seed.names; S.known = seed.known; S.ignoredWords = []; S.review = null; S.title = 'New chat';
    $('oa-title').textContent = S.title; renderClientChip(); renderReview(); renderStack(); loadThreads(); $('oa-input').focus();
  }

  // ── Clients (web page only) ───────────────────────────────────────────────
  function renderClientChip() {
    var chip = $('oa-client-chip');
    if (S.client && S.client.name) { chip.hidden = false; chip.textContent = S.client.name; chip.title = 'This chat is about ' + S.client.name + ' — the AI sees [CLIENT_1]'; } else chip.hidden = true;
  }
  function renderClients() {
    var el = $('oa-client-list');
    if (!el) return;
    if (S.clientsError) { el.innerHTML = '<p class="oa-note" style="padding:4px 10px;">' + esc(S.clientsError) + '</p>'; return; }
    var list = filterClients(S.clients, $('oa-client-search').value).slice(0, 80);
    el.innerHTML = '<button class="oa-client-opt general' + (!S.client ? ' active' : '') + '" type="button" role="option" data-client="">General — no client</button>'
      + list.map(function (c) {
        return '<button class="oa-client-opt' + (S.client && S.client.ref === c.ref ? ' active' : '') + '" type="button" role="option" data-client="' + esc(c.ref) + '">' + esc(c.name) + (c.suburb ? '<small>' + esc(c.suburb) + '</small>' : '') + '</button>';
      }).join('');
  }
  function selectClient(ref) {
    var c = ref ? S.clients.filter(function (x) { return x.ref === ref; })[0] : null;
    if (ref && !c) return;
    S.client = c || null;
    try { localStorage.setItem('oa.client', c ? c.ref : ''); } catch (e) { /* ignore */ }
    renderClients(); newChat();
    if (global.innerWidth < 760) $('oa-side').classList.remove('open');
  }
  function loadClients(initialRef) {
    return api('/api/assist/clients').then(function (r) {
      return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Could not load your clients.'); return j; });
    }).then(function (d) {
      S.clients = d.clients || []; S.clientsError = '';
      if (initialRef) { var c = S.clients.filter(function (x) { return x.ref === initialRef; })[0]; if (c && !S.conversationId) { S.client = c; newChat(); } }
      if (S.client && !S.client.name) { var m = S.clients.filter(function (x) { return x.ref === S.client.ref; })[0]; if (m) { S.client = m; pinClientName(); renderClientChip(); renderStack(); loadThreads(); } }
      renderClients();
    }).catch(function (err) { S.clients = []; S.clientsError = (err && err.message) || 'Could not load your clients.'; renderClients(); });
  }

  // ── Leaving, and installing as an app ─────────────────────────────────────
  // Opened from the portal's button: "Portal" goes back to that tab and closes this window.
  function wirePortalButton() {
    var a = $('oa-portal');
    var opener = null; try { opener = global.opener && !global.opener.closed && global.opener.location.origin === global.location.origin ? global.opener : null; } catch (e) { opener = null; }
    if (!opener) return;
    a.textContent = 'Close'; a.title = 'Close Opal Assist and go back to the portal';
    a.addEventListener('click', function (e) { e.preventDefault(); try { opener.focus(); } catch (x) { /* ignore */ } global.close(); });
  }
  var installPrompt = null;
  global.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); installPrompt = e; var b = $('oa-install'); if (b) b.hidden = false; });
  global.addEventListener('appinstalled', function () { installPrompt = null; var b = $('oa-install'); if (b) b.hidden = true; });

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
    if (t.id === 'oa-use-selection') { if (office()) office().readSelection().then(function (txt) { setSelection(txt); if (!txt) setStatus('Nothing selected', 'warn'); }); return; }
    if (t.dataset.hide) { S.pendingConfirmed = (S.pendingConfirmed || []).concat([t.dataset.hide]); runCheck(S.review.raw); return; }
    if (t.dataset.ignore) { S.ignoredWords.push(t.dataset.ignore); runCheck(S.review.raw); return; }
    if (t.dataset.open) return openThread(t.dataset.open);
    if (t.dataset.client !== undefined) return selectClient(t.dataset.client || null);
    if (t.id === 'oa-install') { if (installPrompt) { installPrompt.prompt(); installPrompt.userChoice.then(function () { installPrompt = null; t.hidden = true; }); } return; }
    if (t.dataset.chip) { $('oa-input').value = t.dataset.chip + ':\n\n'; $('oa-input').focus(); return; }
    if (t.dataset.copy !== undefined) { var m = S.messages[+t.dataset.copy]; navigator.clipboard.writeText(restoreTokens(m.text, S.names)).then(function () { t.textContent = 'Copied'; setTimeout(function () { t.textContent = 'Copy'; }, 1200); }); return; }
    if (t.dataset.insert !== undefined) {
      var mm = S.messages[+t.dataset.insert]; var restored = restoreTokens(mm.text, S.names);
      if (typeof global.OpalAssist.onInsert === 'function') global.OpalAssist.onInsert(restored);
      else if (office()) office().insert(restored).then(function (ok) { t.textContent = ok ? 'Inserted' : 'Could not insert'; setTimeout(function () { t.textContent = 'Insert into document'; }, 1500); });
      return;
    }
  });
  $('oa-input').addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); } });
  $('oa-client-search').addEventListener('input', renderClients);

  // Inside Office, Microsoft 365 sign-in is tried first. When Office cannot
  // supply it (Word signed in to a different Microsoft account, consent not
  // given, an older Office), the person signs in to the portal right here in
  // the pane instead — the same account, the same guards.
  function showPaneSignIn() {
    setStatus('Sign in', 'off');
    $('oa-send').disabled = true;
    var code = office() && office().state.error ? ' (Office code ' + office().state.error + ')' : '';
    var slot = $('oa-review-slot');
    slot.innerHTML = '<div class="oa-signin"><strong>Sign in to use Opal Assist</strong>'
      + '<p>Word could not pass on your Microsoft 365 sign-in' + esc(code) + '. Sign in with your portal account instead.</p>'
      + '<button class="oa-btn primary" type="button" id="oa-pane-signin">Sign in to the portal</button></div>';
    $('oa-pane-signin').addEventListener('click', function () {
      global.location.href = '/login?next=' + encodeURIComponent(global.location.pathname + global.location.search);
    });
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  function boot() {
    if (S.surface !== 'web') { document.body.classList.add('oa-pane'); $('oa-hint').textContent = 'Names and contact details are hidden before sending.'; $('oa-input').placeholder = 'Ask Opal Assist…'; }
    if (global.innerWidth < 760) $('oa-menu').style.display = '';
    pruneMaps(); wirePortalButton();
    // The client comes from the link (?client=splose:patient:<id>), else the last one picked in this browser.
    var startRef = params.get('client');
    if (startRef === null) { try { startRef = localStorage.getItem('oa.client') || ''; } catch (e) { startRef = ''; } }
    if (S.surface !== 'web') { $('oa-client').style.display = 'none'; startRef = ''; }
    renderStack(); updateSelectionBar(); renderClients();
    api('/api/auth/me').then(function (r) { return r.ok ? r.json() : null; }).then(function (u) { S.user = u; }).catch(function () {});
    if (office()) { $('oa-use-selection').style.display = ''; }
    api('/api/assist/config').then(function (r) {
      if (r.status === 401) {
        if (office()) { showPaneSignIn(); return null; }
        global.location.href = '/login?next=' + encodeURIComponent(global.location.pathname + global.location.search); return null;
      }
      return r.json();
    })
      .then(function (c) {
        if (!c) return;
        S.enabled = !!c.enabled;
        setStatus(S.enabled ? 'Ready' : 'Not switched on', S.enabled ? '' : 'off');
        $('oa-send').disabled = !S.enabled;
        if (!S.enabled) $('oa-hint').textContent = 'Opal Assist is not switched on for this portal yet. Ask the practice owner.';
      }).catch(function () { setStatus('Unavailable', 'off'); });
    loadThreads();
    if (S.surface === 'web') loadClients(/^splose:patient:[A-Za-z0-9_-]+$/.test(startRef || '') ? startRef : '');
  }
  global.OpalAssist = { setSelection: setSelection, newChat: newChat, onInsert: null, _state: S };
  if (S.surface !== 'web' && office() && !office().state.ready && !office().state.error) document.addEventListener('opal-assist-office-ready', boot, { once: true });
  else boot();
})(typeof window !== 'undefined' ? window : globalThis);
