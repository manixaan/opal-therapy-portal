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

  /**
   * The sidebar, one group per client (Claude-project style): each group holds
   * that client's chats, newest first. Groups are ordered by their latest chat,
   * so opening a chat never reorders the list; a client just picked shows (on
   * top) even before its first chat. "General"
   * (no client) is a group like any other. A search shows every matching
   * client, with or without chats, so a new one can be started from there.
   *
   * @returns [{ ref: '' | clientRef, name, suburb, chats: [...], latest: ms }]
   */
  function groupThreads(conversations, clients, opts) {
    opts = opts || {};
    var byRef = {};
    (clients || []).forEach(function (c) { byRef[c.ref] = c; });
    var groups = {};
    var group = function (ref) {
      if (!groups[ref]) {
        var c = byRef[ref];
        groups[ref] = { ref: ref, name: ref ? (c ? c.name : 'Former client') : 'General', suburb: c ? c.suburb || '' : '', chats: [], latest: 0 };
      }
      return groups[ref];
    };
    (conversations || []).forEach(function (cv) {
      var g = group(cv.client_ref || '');
      g.chats.push(cv);
      g.latest = Math.max(g.latest, new Date(cv.updated_at).getTime() || 0);
    });
    var q = String(opts.query || '').trim();
    if (q) {
      var keep = {};
      filterClients(clients, q).forEach(function (c) { group(c.ref); keep[c.ref] = true; });
      Object.keys(groups).forEach(function (ref) { if (!keep[ref] && filterClients([{ name: groups[ref].name, suburb: groups[ref].suburb }], q).length === 0) delete groups[ref]; });
    } else {
      group('');
      if (opts.current) group(opts.current);
    }
    return Object.keys(groups).map(function (k) { return groups[k]; }).sort(function (a, b) {
      // A client just picked, with no chats yet, sits on top; otherwise nothing jumps when a chat is opened.
      var aNew = !q && opts.current && a.ref === opts.current && !a.chats.length;
      var bNew = !q && opts.current && b.ref === opts.current && !b.chats.length;
      if (aNew !== bNew) return aNew ? -1 : 1;
      return (b.latest - a.latest) || a.name.localeCompare(b.name);
    });
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { splitTokens, restoreTokens, clientSeed, filterClients, groupThreads };
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
    nameStyle: (function () { try { return localStorage.getItem('oa.nameStyle') === 'full' ? 'full' : 'first'; } catch (e) { return 'first'; } })(),
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
  // Splose sometimes cannot answer for a moment (its rate limit, a blip).
  // The server refuses those before anything is stored or sent to the model,
  // so the same request is simply tried again, quietly, before the person
  // ever sees "Could not reach Splose".
  var SPLOSE_BLIPS = { client_lookup_failed: 1, client_unresolvable: 1 };
  var RETRY_DELAYS = [1500, 4000];
  var api = function (path, opts) {
    opts = opts || {};
    var headers = opts.body ? { 'Content-Type': 'application/json' } : {};
    var once = function () {
      var withToken = office() ? office().token() : Promise.resolve(null);
      return withToken.then(function (tok) {
        if (tok) headers.Authorization = 'Bearer ' + tok;
        return fetch(path, { credentials: 'include', headers: headers, method: opts.method || (opts.body ? 'POST' : 'GET'), body: opts.body ? JSON.stringify(opts.body) : undefined, signal: opts.signal });
      });
    };
    var attempt = function (n) {
      return once().then(function (res) {
        if ((res.status !== 502 && res.status !== 503) || n >= RETRY_DELAYS.length) return res;
        return res.clone().json().catch(function () { return {}; }).then(function (j) {
          if (!SPLOSE_BLIPS[j && (j.code || j.error)]) return res;
          return new Promise(function (resolve, reject) {
            var t = setTimeout(function () { resolve(attempt(n + 1)); }, RETRY_DELAYS[n]);
            if (opts.signal) opts.signal.addEventListener('abort', function () { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
          });
        });
      });
    };
    return attempt(0);
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
  var DOC = function () { return global.OpalAssistDoc; };
  /** Names read as names — first name by default, no highlight; an unknown token reads as a role, never a bracket. */
  function renderTokens(text) {
    return splitTokens(text).map(function (run) {
      if (run.text !== undefined) return esc(run.text);
      return '<span class="oa-name">' + esc(DOC().displayName(run.token, S.names, S.nameStyle)) + '</span>';
    }).join('');
  }
  var shown = function (text) { return DOC().restoreText(text, S.names, S.nameStyle); };

  // ── Documents: one live editor per document message, kept across re-renders ──
  var editors = {};
  function editorFor(m) {
    var key = m.id || m.key;
    if (editors[key]) return editors[key];
    var extra = S.surface !== 'web' ? [['Insert into document', function (doc, btn) {
      var text = DOC().docToPlain(doc, S.names, S.nameStyle);
      if (typeof global.OpalAssist.onInsert === 'function') global.OpalAssist.onInsert(text);
      else if (office()) office().insert(text).then(function (ok) { btn.textContent = ok ? 'Inserted' : 'Could not insert'; setTimeout(function () { btn.textContent = 'Insert into document'; }, 1500); });
    }]] : [];
    editors[key] = DOC().mount({
      doc: m.doc,
      getNames: function () { return S.names; },
      getStyle: function () { return S.nameStyle; },
      onChange: function (doc, status) { m.doc = doc; saveDoc(m, status); },
      onRevise: reviseText,
      extraButtons: extra,
    });
    return editors[key];
  }

  function renderStack() {
    var stack = $('oa-stack');
    if (!S.messages.length) {
      // A task pane is narrow: one quiet line, not the full welcome.
      if (S.surface !== 'web') { stack.innerHTML = '<div class="oa-empty oa-empty-pane"><img src="/icons/opal-assist-live.svg?v=1" alt=""><p>Ask a question, or select text and press Use selection.</p></div>'; return; }
      stack.innerHTML = '<div class="oa-empty"><img src="/icons/opal-assist-live.svg?v=1" alt=""><h1>Opal Assist</h1>'
        + '<p>' + (S.client ? 'Everything in this chat is about <b>' + esc(S.client.name) + '</b>. Their name is hidden from the AI. ' : '')
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
      if (m.role === 'user') return '<div class="oa-msg user"><div class="oa-bubble">' + renderTokens(m.text) + '</div></div>';
      if (m.doc && !m.live) return '<div class="oa-msg assistant doc"><img class="oa-avatar" src="/icons/opal-assist.svg?v=3" alt=""><div class="oa-doc-host" data-doc="' + i + '"></div></div>';
      var body = m.live && !m.text ? '<div class="oa-thinking">' + (m.format && m.format !== 'chat' ? 'Opal Assist is writing it up' : 'Opal Assist is thinking') + '</div>' : renderTokens(m.text);
      // The reply being written wears the thinking mark: the same seeds, breathing faster.
      var avatar = m.live ? '/icons/opal-assist-thinking.svg?v=1' : '/icons/opal-assist.svg?v=3';
      var tools = (!m.live && !m.error) ? '<div class="oa-tools"><button class="oa-btn ghost sm" type="button" data-copy="' + i + '">Copy</button>'
        + (S.surface !== 'web' ? '<button class="oa-btn ghost sm" type="button" data-insert="' + i + '">Insert into document</button>' : '') + '</div>' : '';
      return '<div class="oa-msg assistant' + (m.error ? ' error' : '') + '"><img class="oa-avatar" src="' + avatar + '" alt=""><div><div class="oa-bubble">' + body + '</div>' + tools + '</div></div>';
    }).join('');
    Array.prototype.forEach.call(stack.querySelectorAll('.oa-doc-host'), function (host) { host.appendChild(editorFor(S.messages[+host.dataset.doc]).el); });
    updateContext();
    $('oa-body').scrollTop = $('oa-body').scrollHeight;
  }

  /** Run the server check on text the person typed into a document or an instruction: names become tokens. */
  function checkText(text) {
    if (!/[A-Za-z0-9]/.test(text.replace(TOKEN_RE, ''))) return Promise.resolve(text);
    return api('/api/assist/check', { body: { text: text, known: S.known, ignoredWords: S.ignoredWords, clientRef: S.client ? S.client.ref : undefined } })
      .then(function (r) { if (!r.ok) throw new Error('The text could not be checked for names just now.'); return r.json(); })
      .then(function (msg) { (msg.hidden || []).forEach(function (h) { S.names[h.token] = h.name; }); S.known = msg.known || S.known; return msg.text; });
  }

  var SEP = '\n\u2042\n'; // a mark nobody types, between the pieces of one check
  /** Save edits: everything typed is checked for names first, then stored (tokens only). */
  function saveDoc(m, status) {
    if (!m.id || !S.conversationId) { status('Not saved'); return; }
    var parts = [];
    m.doc.blocks.forEach(function (b) { parts.push(b.lead || ''); parts.push(b.text || ''); });
    status('Saving…');
    checkText(parts.join(SEP)).then(function (checked) {
      var back = checked.split(SEP);
      if (back.length !== parts.length) throw new Error('Not saved — please try again.');
      var doc = { kind: m.doc.kind, title: m.doc.title, blocks: m.doc.blocks.map(function (b, i) {
        var o = { t: b.t, text: back[i * 2 + 1] }; if (back[i * 2]) o.lead = back[i * 2]; return o;
      }) };
      return api('/api/assist/conversations/' + S.conversationId + '/messages/' + m.id, { method: 'PUT', body: { document: doc, known: S.known } })
        .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.answer || 'Not saved — please try again.'); return { doc: doc, j: j }; }); });
    }).then(function (res) {
      var hadNewTokens = !DOC().sameDoc(res.doc, m.doc);
      m.doc = res.j.document || res.doc; saveMap();
      if (hadNewTokens && editors[m.id]) editors[m.id].setDoc(m.doc); // a name typed in is now a token: show it as a name span
      status('Saved');
      setTimeout(function () { status(''); }, 1500);
    }).catch(function (err) { status(err.message || 'Not saved'); });
  }

  /** Rewrite one highlighted passage: passage and instruction are checked for names, then sent with the document as context. */
  function reviseText(passage, instruction, context) {
    if (!S.conversationId) return Promise.reject(new Error('Send a message first'));
    return checkText(passage).then(function (p) {
      return checkText(instruction).then(function (ins) {
        return checkText(context).then(function (ctx) {
          return api('/api/assist/revise', { body: { conversationId: S.conversationId, passage: p, instruction: ins, context: ctx, known: S.known } });
        });
      });
    }).then(function (r) { return r.json().then(function (j) {
      if (!r.ok || j.status !== 'ok') throw new Error(j.answer || 'Could not rewrite that — try again');
      saveMap();
      return j.text;
    }); });
  }
  var renderQueued = false;
  function scheduleRender() { if (renderQueued) return; renderQueued = true; requestAnimationFrame(function () { renderQueued = false; renderStack(); }); }

  function setStatus(text, cls) { var p = $('oa-status'); p.textContent = text; p.className = 'oa-pill' + (cls ? ' ' + cls : ''); }
  /** The side-panel mark breathes faster while a reply is being written. */
  function setThinking(on) {
    var mark = $('oa-brand-mark');
    if (mark) mark.src = on ? '/icons/opal-assist-thinking.svg?v=1' : '/icons/opal-assist-live.svg?v=1';
  }
  function setBusy(b) { S.busy = b; $('oa-send').disabled = b || !S.enabled; $('oa-stop').style.display = b ? '' : 'none'; $('oa-input').disabled = b; }

  // ── Review card ───────────────────────────────────────────────────────────
  function renderReview(focusSend) {
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
      + '<div class="oa-preview">' + esc(r.text) + (r.selectionText ? (S.surface === 'web' ? '\n\n— attached —\n' : '\n\n— selected content —\n') + esc(r.selectionText) : '') + '</div>'
      + (hidden ? '<ul class="oa-hidden">' + hidden + '</ul>' : '')
      + cands
      + '<div class="oa-addname"><input id="oa-addname" type="text" placeholder="Hide another name the check missed…" aria-label="Name to hide"><button class="oa-btn sm" type="button" id="oa-addname-btn">Hide it</button></div>'
      + (r.directoryPartial ? '<p class="oa-note warn"><b>Names may not be recognised right now.</b> ' + esc((r.directoryMissing || []).join(', ') || 'Part of the practice directory') + ' could not be loaded, so people from there are not hidden automatically. Type any name into the box above and press Hide it, or wait thirty seconds and press Check &amp; send again.</p>' : '')
      + (r.cautions || []).map(function (c) { return '<p class="oa-note warn"><b>' + (c.kind === 'combination' ? 'Could still identify someone.' : 'Sensitive topic.') + '</b> ' + esc(c.message) + '</p>'; }).join('')
      + ((r.directoryNotConnected || []).length ? '<p class="oa-note warn"><b>Splose is not connected on this server,</b> so client and contact names are not recognised. Hide them yourself with the box above.</p>' : '')
      + (r.failed ? '<p class="oa-note warn"><b>The check could not be updated.</b> Press Edit message, then send again to re-check.</p>' : '')
      + '<div class="oa-review-actions"><button class="oa-btn" type="button" id="oa-review-edit">Edit message</button><button class="oa-btn primary" type="button" id="oa-review-send"' + (r.pending ? ' disabled' : '') + '>' + (r.pending ? (r.failed ? 'Send' : 'Updating…') : 'Send') + '</button></div>'
      + '</div>';
    if (focusSend !== false && !r.pending) $('oa-review-send').focus();
  }

  /**
   * A Hide / Not a person / Hide it decision. The card changes at once; the
   * server check re-runs behind it (quick clicks share one run). Send stays
   * off until that run is back, so what leaves is always the server's text,
   * never this provisional preview.
   */
  function decide(word, hide) {
    var r = S.review; if (!r || !word) return;
    var lw = word.toLowerCase();
    r.candidates = r.candidates.filter(function (c) { return c.word.toLowerCase() !== lw; });
    if (hide) {
      S.pendingConfirmed = (S.pendingConfirmed || []).concat([word]);
      var re = new RegExp('\\b' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
      r.text = r.text.replace(re, '[PERSON]');
      if (r.selectionText) r.selectionText = r.selectionText.replace(re, '[PERSON]');
      r.hidden = r.hidden.concat([{ name: word, token: 'PERSON' }]);
    } else {
      S.ignoredWords.push(word);
    }
    r.pending = true; r.failed = false;
    renderReview(false);
    clearTimeout(S.recheckTimer);
    S.recheckTimer = setTimeout(function () { if (S.review === r) runCheck(r.raw, true); }, 120);
  }

  /** Run the server check on the message (and selection) and open the review card. `quiet` re-checks an open card in the background. */
  function runCheck(rawText, quiet) {
    var seq = S.checkSeq = (S.checkSeq || 0) + 1;
    var current = function () { return seq === S.checkSeq && (!quiet || !!S.review); };
    if (!quiet) { setBusy(true); setStatus('Checking…'); }
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
        if (!current()) return; // a newer decision, or the card was closed
        pending.hidden.forEach(function (h) { S.names[h.token] = h.name; });
        S.review = pending;
        if (!quiet) { setBusy(false); setStatus('Ready'); }
        renderReview(!quiet);
      })
      .catch(function (err) {
        if (!current()) return;
        if (quiet) { S.review.failed = true; renderReview(false); return; } // Send stays off
        setBusy(false); setStatus('Check failed', 'warn');
        if (err && err.message && err.message !== 'check_failed') $('oa-review-slot').innerHTML = '<p class="oa-note warn">' + esc(err.message) + '</p>';
      });
  }

  // ── Sending ───────────────────────────────────────────────────────────────
  function confirmSend() {
    var r = S.review;
    if (!r || r.pending) return;
    S.review = null; renderReview();
    S.known = r.known || S.known;
    S.pendingConfirmed = [];
    S.messages.push({ role: 'user', text: r.text });
    $('oa-input').value = '';
    if (COMPOSER()) { COMPOSER().clearAttachments(); COMPOSER().autosize(); }
    // The server (the model, in fact) decides whether this comes back as chat, a document or a case note.
    var live = { role: 'assistant', text: '', live: true, key: 'k' + Date.now() };
    S.messages.push(live);
    renderStack();
    setBusy(true); setStatus('Thinking…'); setThinking(true);
    var ctrl = new AbortController(); S.abort = ctrl;
    var body = { message: r.text, conversationId: S.conversationId, surface: S.surface, hiddenCount: r.hidden.length, known: S.known };
    if (S.client) body.clientRef = S.client.ref;
    if (r.selectionText) body.selection = r.selectionText;
    S.selection = ''; updateSelectionBar();

    api('/api/assist/chat/stream', { body: body, signal: ctrl.signal }).then(function (res) {
      if (res.status === 422) return res.json().then(function (j) { live.text = j.answer || 'That text still contains a name or contact detail.'; live.error = true; live.live = false; });
      if (res.status === 429 || res.status === 503 || res.status === 400 || res.status === 403 || res.status === 404 || res.status === 502) return res.json().then(function (j) { live.text = j.answer || j.error || 'Opal Assist is unavailable right now.'; live.error = true; live.live = false; });
      var ct = res.headers.get('content-type') || '';
      if (ct.indexOf('text/event-stream') < 0) return res.json().then(function (j) {
        live.text = j.answer || (j.document ? DOC().docToPlainTokens(j.document) : 'Opal Assist is unavailable right now.');
        live.error = j.status !== 'ok'; live.live = false;
        if (j.document) { live.doc = j.document; live.kind = j.kind; }
        if (j.messageId) live.id = j.messageId;
        if (j.conversationId) { S.conversationId = j.conversationId; if (S.title === 'New chat') { S.title = shown(S.messages[0].text).slice(0, 60); $('oa-title').textContent = S.title; } }
      });
      return readSse(res, live);
    }).catch(function (err) {
      live.live = false;
      if (!live.text) { live.text = err && err.name === 'AbortError' ? 'Stopped.' : 'Opal Assist is unavailable right now.'; live.error = true; }
    }).then(function () {
      live.live = false; S.abort = null; setBusy(false); setStatus('Ready'); setThinking(false);
      saveMap(); renderStack(); loadThreads(); $('oa-input').focus();
    });
  }

  function readSse(res, live) {
    var reader = res.body.getReader(); var dec = new TextDecoder(); var buf = '';
    function handle(ev, data) {
      if (ev === 'delta') { live.text += (data.t || ''); scheduleRender(); }
      else if (ev === 'done') { if (data.answer) live.text = data.answer; if (data.conversationId) { S.conversationId = data.conversationId; if (S.title === 'New chat') S.title = shown(S.messages[0].text).slice(0, 60); $('oa-title').textContent = S.title; } }
      else if (ev === 'shape') { live.format = data.kind || 'document'; scheduleRender(); }
      else if (ev === 'document') {
        live.doc = data.document; live.kind = data.kind; live.id = data.messageId; live.text = DOC().docToPlainTokens(data.document);
        if (data.conversationId) { S.conversationId = data.conversationId; if (S.title === 'New chat') { S.title = shown(S.messages[0].text).slice(0, 60); $('oa-title').textContent = S.title; } }
      }
      else if (ev === 'blocked' || ev === 'unavailable') { live.text = data.answer; live.error = true; live.doc = null; }
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
  /** Thread titles are stored tokenised: show them with this client's name, other tokens as roles. */
  /** A chat's title with names put back: this browser's map for that chat, plus its client. */
  function threadTitle(c, clientName) {
    var names = {};
    if (c.id === S.conversationId) names = S.names;
    else { try { var raw = localStorage.getItem('oa.map.' + c.id); if (raw) names = JSON.parse(raw).names || {}; } catch (e) { /* ignore */ } }
    names = Object.assign({}, names, clientName ? { CLIENT_1: clientName } : {});
    return DOC().restoreText(c.title || 'Chat', names, S.nameStyle);
  }
  function loadThreads() {
    return api('/api/assist/conversations').then(function (r) { return r.ok ? r.json() : { conversations: [] }; }).then(function (d) {
      S.threads = d.conversations || [];
      renderSidebar();
    }).catch(function () {});
  }

  // ── Sidebar: chats grouped under each client ──────────────────────────────
  var GROUP_PREVIEW = 5;
  function loadCollapsed() { try { return JSON.parse(localStorage.getItem('oa.collapsed') || '{}') || {}; } catch (e) { return {}; } }
  function threadRow(c, clientName) {
    var when = new Date(c.updated_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
    return '<button class="oa-thread' + (c.id === S.conversationId ? ' active' : '') + '" type="button" data-open="' + esc(c.id) + '" title="' + esc(when + (c.surface && c.surface !== 'web' ? ' · ' + c.surface : '')) + '">'
      + '<span class="oa-dot" aria-hidden="true"></span><span class="oa-thread-title">' + esc(threadTitle(c, clientName)) + '</span></button>';
  }
  function renderSidebar() {
    var el = $('oa-threads');
    if (!el) return;
    var threads = S.threads || [];
    if (S.surface !== 'web') {
      el.innerHTML = threads.map(function (c) { return threadRow(c, ''); }).join('') || '<p class="oa-side-empty">No chats yet.</p>';
      return;
    }
    var q = $('oa-client-search').value;
    var current = S.client ? S.client.ref : '';
    var groups = groupThreads(threads, S.clients, { query: q, current: current });
    var collapsed = loadCollapsed();
    S.showAll = S.showAll || {};
    el.innerHTML = (S.clientsError ? '<p class="oa-side-empty">' + esc(S.clientsError) + '</p>' : '')
      + groups.map(function (g) {
        var isOpen = !!q || !collapsed[g.ref || 'general'];
        var clientName = g.ref ? g.name : '';
        var shown = isOpen ? (S.showAll[g.ref] ? g.chats : g.chats.slice(0, GROUP_PREVIEW)) : [];
        var more = isOpen && !S.showAll[g.ref] && g.chats.length > GROUP_PREVIEW ? g.chats.length - GROUP_PREVIEW : 0;
        var label = g.ref ? g.name : 'General — no client';
        return '<section class="oa-group' + (g.ref === current ? ' current' : '') + (g.ref ? '' : ' general') + '">'
          + '<div class="oa-group-head">'
          + '<button class="oa-group-toggle" type="button" data-toggle="' + esc(g.ref || 'general') + '" aria-expanded="' + isOpen + '">'
          + '<span class="oa-group-name">' + esc(label) + '</span>' + (g.suburb ? '<small>' + esc(g.suburb) + '</small>' : '')
          + '<span class="oa-caret" aria-hidden="true"></span></button>'
          + '<button class="oa-group-new" type="button" data-client="' + esc(g.ref) + '" title="New chat' + (g.ref ? ' about ' + esc(g.name) : '') + '" aria-label="New chat' + (g.ref ? ' about ' + esc(g.name) : ' with no client') + '">+</button>'
          + '</div>'
          + (isOpen ? '<div class="oa-group-chats">'
            + shown.map(function (c) { return threadRow(c, clientName); }).join('')
            + (more ? '<button class="oa-group-more" type="button" data-more="' + esc(g.ref) + '">Show ' + more + ' more</button>' : '')
            + (!g.chats.length ? '<p class="oa-side-empty">No chats yet — press + to start one.</p>' : '')
            + '</div>' : '')
          + '</section>';
      }).join('')
      + (q && !groups.length ? '<p class="oa-side-empty">No client matches “' + esc(q) + '”.</p>' : '');
  }
  function toggleGroup(key) {
    var collapsed = loadCollapsed();
    if (collapsed[key]) delete collapsed[key]; else collapsed[key] = true;
    try { localStorage.setItem('oa.collapsed', JSON.stringify(collapsed)); } catch (e) { /* ignore */ }
    renderSidebar();
  }
  function openThread(id) {
    api('/api/assist/conversations/' + id).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d) return;
      S.conversationId = id; loadMap(id);
      var ref = d.conversation.client_ref || null;
      S.client = ref ? (S.clients.filter(function (c) { return c.ref === ref; })[0] || { ref: ref, name: '' }) : null;
      pinClientName(); saveMap(); renderClientChip(); renderSidebar();
      S.title = d.conversation.title || 'Chat'; $('oa-title').textContent = S.title;
      editors = {};
      S.messages = d.messages.map(function (m) { return { role: m.role, text: m.content, id: m.id, kind: m.kind, doc: m.document || null }; });
      S.review = null; renderReview(); renderStack(); loadThreads();
    });
  }
  function newChat() {
    var seed = clientSeed(S.client);
    editors = {};
    S.conversationId = null; S.messages = []; S.names = seed.names; S.known = seed.known; S.ignoredWords = []; S.review = null; S.title = 'New chat';
    $('oa-title').textContent = S.title; renderClientChip(); renderReview(); renderStack(); loadThreads(); $('oa-input').focus();
  }

  // ── Clients (web page only) ───────────────────────────────────────────────
  function renderClientChip() {
    var chip = $('oa-client-chip');
    if (S.client && S.client.name) { chip.hidden = false; chip.textContent = S.client.name; chip.title = 'This chat is about ' + S.client.name + ' — the AI sees [CLIENT_1]'; } else chip.hidden = true;
  }
  function selectClient(ref) {
    var c = ref ? S.clients.filter(function (x) { return x.ref === ref; })[0] : null;
    if (ref && !c) return;
    S.client = c || null;
    try { localStorage.setItem('oa.client', c ? c.ref : ''); } catch (e) { /* ignore */ }
    $('oa-client-search').value = '';
    newChat();
    if (global.innerWidth < 760) $('oa-side').classList.remove('open');
  }
  function loadClients(initialRef) {
    return api('/api/assist/clients').then(function (r) {
      return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Could not load your clients.'); return j; });
    }).then(function (d) {
      S.clients = d.clients || []; S.clientsError = '';
      if (initialRef) { var c = S.clients.filter(function (x) { return x.ref === initialRef; })[0]; if (c && !S.conversationId) { S.client = c; newChat(); } }
      if (S.client && !S.client.name) { var m = S.clients.filter(function (x) { return x.ref === S.client.ref; })[0]; if (m) { S.client = m; pinClientName(); renderClientChip(); renderStack(); loadThreads(); } }
      renderSidebar();
    }).catch(function (err) { S.clients = []; S.clientsError = (err && err.message) || 'Could not load your clients.'; renderSidebar(); });
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
  var COMPOSER = function () { return global.OpalAssistComposer; };
  function onSend() {
    if (S.busy || !S.enabled) return;
    if (S.surface === 'web') {
      if (COMPOSER().busyReading()) { setStatus('Still reading the file…', 'warn'); return; }
      // Attached files travel as the "selected content": checked for names like the message, then guarded again by the server.
      S.selection = COMPOSER().attachmentsText();
    }
    var raw = $('oa-input').value.trim();
    if (!raw && S.selection) raw = 'Please help with the attached file.';
    if (!raw) return;
    COMPOSER().stopDictation();
    runCheck(raw);
  }

  /** Roughly how much of the model's context this chat already uses: the recent turns sent with each message, the draft, and the attachments. */
  function updateContext() {
    if (!COMPOSER()) return;
    var turns = S.historyTurns || 16;
    var recent = S.messages.slice(-turns).map(function (m) { return m.text || ''; }).join('\n');
    var draft = ($('oa-input').value || '') + (S.surface === 'web' ? COMPOSER().attachmentsText() : S.selection);
    COMPOSER().renderContext(1500 + COMPOSER().estimateTokens(recent) + COMPOSER().estimateTokens(draft)); // ~1,500 for the instructions themselves
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest('button, a'); if (!t) return;
    if (t.id === 'oa-send') return onSend();
    if (t.id === 'oa-stop') { if (S.abort) S.abort.abort(); return; }
    if (t.id === 'oa-new') return newChat();
    if (t.id === 'oa-menu') { $('oa-side').classList.toggle('open'); return; }
    if (t.id === 'oa-review-send') return confirmSend();
    if (t.id === 'oa-review-edit') { clearTimeout(S.recheckTimer); S.review = null; renderReview(); $('oa-input').focus(); return; }
    if (t.id === 'oa-addname-btn') { var v = $('oa-addname').value.trim(); if (v) decide(v, true); return; }
    if (t.id === 'oa-selection-clear') { setSelection(''); return; }
    if (t.id === 'oa-use-selection') { if (office()) office().readSelection().then(function (txt) { setSelection(txt); if (!txt) setStatus('Nothing selected', 'warn'); }); return; }
    if (t.dataset.hide) return decide(t.dataset.hide, true);
    if (t.dataset.ignore) return decide(t.dataset.ignore, false);
    if (t.dataset.open) return openThread(t.dataset.open);
    if (t.dataset.toggle) return toggleGroup(t.dataset.toggle);
    if (t.dataset.more !== undefined) { S.showAll = S.showAll || {}; S.showAll[t.dataset.more] = true; renderSidebar(); return; }
    if (t.dataset.client !== undefined) return selectClient(t.dataset.client || null);
    if (t.id === 'oa-install') { if (installPrompt) { installPrompt.prompt(); installPrompt.userChoice.then(function () { installPrompt = null; t.hidden = true; }); } return; }
    if (t.dataset.chip) { $('oa-input').value = t.dataset.chip + ':\n\n'; $('oa-input').focus(); return; }
    if (t.dataset.copy !== undefined) { var m = S.messages[+t.dataset.copy]; navigator.clipboard.writeText(shown(m.text)).then(function () { t.textContent = 'Copied'; setTimeout(function () { t.textContent = 'Copy'; }, 1200); }); return; }
    if (t.dataset.insert !== undefined) {
      var mm = S.messages[+t.dataset.insert]; var restored = shown(mm.text);
      if (typeof global.OpalAssist.onInsert === 'function') global.OpalAssist.onInsert(restored);
      else if (office()) office().insert(restored).then(function (ok) { t.textContent = ok ? 'Inserted' : 'Could not insert'; setTimeout(function () { t.textContent = 'Insert into document'; }, 1500); });
      return;
    }
  });
  $('oa-input').addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); } });
  $('oa-client-search').addEventListener('input', renderSidebar);
  $('oa-namestyle').value = S.nameStyle;
  $('oa-namestyle').addEventListener('change', function (e) {
    S.nameStyle = e.target.value === 'full' ? 'full' : 'first';
    try { localStorage.setItem('oa.nameStyle', S.nameStyle); } catch (x) { /* ignore */ }
    Object.keys(editors).forEach(function (k) { editors[k].rerender(); });
    renderStack();
  });

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
    COMPOSER().init({ attachments: S.surface === 'web', onChange: updateContext });
    // The client comes from the link (?client=splose:patient:<id>), else the last one picked in this browser.
    var startRef = params.get('client');
    if (startRef === null) { try { startRef = localStorage.getItem('oa.client') || ''; } catch (e) { startRef = ''; } }
    if (S.surface !== 'web') { $('oa-client').style.display = 'none'; startRef = ''; }
    renderStack(); updateSelectionBar(); renderSidebar();
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
        S.historyTurns = c.historyTurns || 16;
        COMPOSER().setModel(c.model || null);
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
