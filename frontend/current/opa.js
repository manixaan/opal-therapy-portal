/* ═══════════════════════════════════════════════════════════════════════════
   OPA AI — the assistant shell and chat client.
   Global floating assistant: collapsed pebble button, draggable/resizable
   chat panel, minimise/maximise/close, position persistence, mobile sheet.

   Chat is LIVE and goes to POST /api/opa/chat. (This header claimed "no model
   calls in this phase" for four phases after that stopped being true, which is
   exactly how a reader ends up trusting the wrong file.)

   Architecture notes:
   - window.Opa            public API (open/close/toggle/newChat/_state)
   - window.registerOpaContext(ctx)  modules push structured page context;
     Opa never scrapes the DOM. Context is metadata only — never client
     records, notes, or clinical content (minimum-necessary principle).
     NOTE: nothing calls this yet, so currentModule() falls back to reading the
     active tab. Registering real context is a pending improvement, not a
     feature you can assume is running.
   - OPA_SUGGESTIONS       offline fallback only; the server owns suggestions.
   - Every model call is server-side. Nothing in this file may ever hold a
     model API key, a model id, or an AWS credential.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

(function (global) {

  // ── Pure geometry helpers (node-exported for unit tests) ─────────────────
  var OPA_MIN_W = 320, OPA_MIN_H = 400;

  // Clamp a panel rect into the viewport: never fully off screen, never
  // larger than the viewport allows, header always reachable.
  function opaClampRect(rect, vp) {
    var w = Math.max(OPA_MIN_W, Math.min(rect.w, Math.floor(vp.w * 0.92)));
    var h = Math.max(OPA_MIN_H, Math.min(rect.h, Math.floor(vp.h * 0.92)));
    var x = Math.min(Math.max(rect.x, 8 - (w - 60)), vp.w - 68);
    var y = Math.min(Math.max(rect.y, 8), vp.h - 48);
    return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
  }

  function opaDefaultRect(vp) {
    var w = Math.min(448, Math.floor(vp.w * 0.9));
    var h = Math.min(640, Math.floor(vp.h * 0.85));
    return { x: vp.w - w - 24, y: vp.h - h - 88, w: w, h: h };
  }

  var helpers = { opaClampRect: opaClampRect, opaDefaultRect: opaDefaultRect };
  if (typeof module !== 'undefined' && module.exports) module.exports = helpers;
  if (!global || !global.document) return; // node/test stops here

  // ── State ────────────────────────────────────────────────────────────────
  var OPA = {
    state: 'closed',          // closed | open | min | max
    rect: null,               // {x,y,w,h}
    context: null,            // last registered page context (metadata only)
    messages: [],             // conversation survives close/reopen this session
    conversationId: null,
    aiEnabled: null,          // null = unknown, checked on first open
    busy: false,
    abort: null,              // AbortController for cancel
    suggestions: null,        // server-provided page suggestions cache
    drag: null,
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function vp() { return { w: global.innerWidth, h: global.innerHeight }; }
  function isMobile() { return global.innerWidth < 700; }

  // ── Persistence (opa.window.*) ───────────────────────────────────────────
  function saveRect() {
    if (!OPA.rect) return;
    try {
      localStorage.setItem('opa.window.x', String(OPA.rect.x));
      localStorage.setItem('opa.window.y', String(OPA.rect.y));
      localStorage.setItem('opa.window.width', String(OPA.rect.w));
      localStorage.setItem('opa.window.height', String(OPA.rect.h));
      localStorage.setItem('opa.window.state', OPA.state);
    } catch (e) { /* private mode */ }
  }

  function loadRect() {
    try {
      var x = parseInt(localStorage.getItem('opa.window.x'), 10);
      var y = parseInt(localStorage.getItem('opa.window.y'), 10);
      var w = parseInt(localStorage.getItem('opa.window.width'), 10);
      var h = parseInt(localStorage.getItem('opa.window.height'), 10);
      if ([x, y, w, h].some(isNaN)) return null;
      return opaClampRect({ x: x, y: y, w: w, h: h }, vp());
    } catch (e) { return null; }
  }

  // ── Page context (registered, never scraped) ─────────────────────────────
  global.registerOpaContext = function (ctx) {
    OPA.context = ctx && typeof ctx === 'object' ? {
      module: String(ctx.module || ''),
      pageTitle: String(ctx.pageTitle || ''),
      availableActions: Array.isArray(ctx.availableActions) ? ctx.availableActions.slice(0, 20) : [],
    } : null;
  };

  function currentModule() {
    if (OPA.context && OPA.context.module) return OPA.context.module;
    var tab = document.querySelector('.tab.active[data-tab]');
    return tab ? tab.dataset.tab : 'calendar';
  }

  // OFFLINE FALLBACK ONLY — the server owns these.
  //
  // /api/opa/suggestions is the single source (it filters by role, which this
  // file cannot do); this copy shows only when that call fails, so the empty
  // state is never blank.
  //
  // KEEP IT IN STEP WITH backend/opa-routes.js → OPA_SUGGESTIONS. It drifted
  // once and the drift was worse than a stale chip: this list offered "Find a
  // handwriting resource" and "Find a therapy resource", while the system
  // prompt (backend/opa-prompt.js) explicitly instructs Opa that resource
  // search is not connected to it and that it must never invent resource
  // titles. The product was teaching users to ask the one question it is
  // required to refuse, and every refusal read as the assistant being broken.
  //
  // A chip must only ever ask for something Opa can actually answer.
  var OPA_SUGGESTIONS = {
    calendar: [
      'How do I schedule an appointment?',
      'How does the Master Scheduler work?',
      'How do Outlook calendars sync?',
      "Why isn't an appointment showing?",
    ],
    resources: [
      'Where are the Opal policies?',
      'How do learning paths work?',
      'How do I record CPD from a resource?',
      'How do I submit a resource for review?',
    ],
    accounting: [
      'Explain this dashboard',
      'How are invoice candidates created?',
      'How do I check the Xero connection?',
    ],
    book: [
      'How do I create an appointment?',
      'What do the booking types mean?',
    ],
    profile: [
      'How do I connect Outlook?',
      'Where do I upload my documents?',
      'How do I request leave?',
    ],
    settings: [
      'How do I change my working hours?',
      'How do I connect Outlook?',
      'How do I invite a therapist?',
    ],
    default: [
      'How does this page work?',
      'Show me around Opal Portal',
      'Where are our policies?',
    ],
  };

  function suggestionsFor(mod) {
    return OPA_SUGGESTIONS[mod] || OPA_SUGGESTIONS.default;
  }

  // ── DOM ──────────────────────────────────────────────────────────────────
  var fab, panel;

  function firstName() {
    var u = global.APP_USER;
    var n = (u && (u.display_name || u.name)) || '';
    return n.split(' ')[0] || 'there';
  }

  function buildFab() {
    fab = document.createElement('button');
    fab.id = 'opa-fab';
    fab.type = 'button';
    fab.setAttribute('aria-label', 'Ask Opa — Opal Therapy assistant');
    fab.title = 'Need help? Ask Opa';
    fab.innerHTML = '<span class="opa-fab-pebble" aria-hidden="true"></span>';
    fab.addEventListener('click', function () { Opa.toggle(); });
    document.body.appendChild(fab);
  }

  function buildPanel() {
    panel = document.createElement('section');
    panel.id = 'opa-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Opa — Opal Therapy assistant');
    panel.innerHTML =
      '<header class="opa-head" id="opa-head">' +
        '<span class="opa-fab-pebble opa-head-pebble" aria-hidden="true"></span>' +
        '<span class="opa-head-id"><strong>Opa</strong><span>Opal Therapy Assistant</span></span>' +
        '<span class="opa-head-btns">' +
          '<button type="button" data-act="new" title="New chat" aria-label="Start a new chat">+</button>' +
          '<button type="button" data-act="min" title="Minimise" aria-label="Minimise Opa">&minus;</button>' +
          '<button type="button" data-act="max" title="Maximise" aria-label="Maximise Opa">&#9633;</button>' +
          '<button type="button" data-act="close" data-help="opa-close" title="Close" aria-label="Close Opa">&times;</button>' +
        '</span>' +
      '</header>' +
      '<div class="opa-body" id="opa-body" aria-live="polite"></div>' +
      '<footer class="opa-composer">' +
        '<textarea id="opa-input" rows="1" placeholder="Ask Opa anything..." aria-label="Ask Opa anything"></textarea>' +
        '<button type="button" id="opa-send" aria-label="Send message">&#8593;</button>' +
      '</footer>' +
      '<span class="opa-resize" id="opa-resize" aria-hidden="true"></span>';
    document.body.appendChild(panel);

    panel.querySelector('.opa-head-btns').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'close') Opa.close();
      else if (b.dataset.act === 'min') Opa.minimise();
      else if (b.dataset.act === 'max') Opa.maximise();
      else if (b.dataset.act === 'new') Opa.newChat();
    });

    var input = panel.querySelector('#opa-input');
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    input.addEventListener('input', function () {
      input.style.height = 'auto';
      input.style.height = Math.min(120, input.scrollHeight) + 'px';
    });
    // Wrapped, never registered directly: a direct registration hands the
    // click Event to sendMessage as retryText — truthy, serialises to {},
    // and the backend refuses it as an empty message.
    panel.querySelector('#opa-send').addEventListener('click', function () { sendMessage(); });
    panel.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') Opa.close();
    });

    attachDrag();
    attachResize();
    renderBody();
  }

  // ── Conversation rendering (shell phase: honest placeholder answers) ─────
  function renderBody() {
    var body = panel.querySelector('#opa-body');
    if (!OPA.messages.length) {
      var mod = currentModule();
      var chips = OPA.suggestions || suggestionsFor(mod);
      body.innerHTML =
        '<div class="opa-empty">' +
          '<span class="opa-fab-pebble opa-empty-pebble" aria-hidden="true"></span>' +
          '<div class="opa-empty-hi">Hi ' + esc(firstName()) + '</div>' +
          '<div class="opa-empty-sub">What can I help you with?</div>' +
          '<div class="opa-suggestions">' +
            chips.map(function (s) {
              return '<button type="button" class="opa-sugg">' + esc(s) + '</button>';
            }).join('') +
          '</div>' +
        '</div>';
      body.querySelectorAll('.opa-sugg').forEach(function (b) {
        b.addEventListener('click', function () {
          var input = panel.querySelector('#opa-input');
          input.value = b.textContent;
          input.focus();
        });
      });
      return;
    }
    body.innerHTML = OPA.messages.map(function (m) {
      if (m.role === 'user') return '<div class="opa-msg opa-msg-user">' + esc(m.text) + '</div>';
      // A streaming reply with no text yet — the thinking indicator stands in.
      if (!m.text && OPA.busy) return '';
      var extras = '';
      if (m.sources && m.sources.length) {
        extras += '<div class="opa-srcs">Based on: ' + m.sources.slice(0, 3).map(function (s) {
          return '<span class="opa-src">' + esc(s.title) + '</span>';
        }).join(' · ') + '</div>';
      }
      if (m.actions && m.actions.length) {
        extras += '<div class="opa-acts">' + m.actions.map(function (a, k) {
          return '<button type="button" class="opa-act" data-i="' + m.i + '" data-k="' + k + '">' + esc(a.label || 'Open') + '</button>';
        }).join('') + '</div>';
      }
      if (m.retry) {
        extras += '<div class="opa-acts"><button type="button" class="opa-act opa-retry">Try again</button></div>';
      }
      return '<div class="opa-msg opa-msg-opa">' + esc(m.text) + extras +
        (m.copy !== false ? '<button type="button" class="opa-copy" data-i="' + m.i + '" aria-label="Copy answer">Copy</button>' : '') +
        '</div>';
    }).join('') +
    (OPA.busy
      ? '<div class="opa-msg opa-msg-opa opa-thinking">Opa is thinking&hellip; ' +
        '<button type="button" class="opa-act opa-cancel">Stop</button></div>'
      : '');
    body.querySelectorAll('.opa-copy').forEach(function (b) {
      b.addEventListener('click', function () {
        var m = OPA.messages[+b.dataset.i];
        if (m && navigator.clipboard) navigator.clipboard.writeText(m.text).catch(function () {});
        b.textContent = 'Copied';
        setTimeout(function () { b.textContent = 'Copy'; }, 1400);
      });
    });
    body.querySelectorAll('.opa-act[data-i]').forEach(function (b) {
      b.addEventListener('click', function () {
        var m = OPA.messages[+b.dataset.i];
        if (m && m.actions) runAction(m.actions[+b.dataset.k]);
      });
    });
    var retryBtn = body.querySelector('.opa-retry');
    if (retryBtn) retryBtn.addEventListener('click', function () { sendMessage(OPA.lastUserText); });
    var cancelBtn = body.querySelector('.opa-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', cancelGeneration);
    body.scrollTop = body.scrollHeight;
  }

  // Server-provided page suggestions (role-filtered); local config fallback.
  function loadSuggestions() {
    var mod = currentModule();
    fetch('/api/opa/suggestions?module=' + encodeURIComponent(mod), { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (j && Array.isArray(j.suggestions) && j.suggestions.length) {
          OPA.suggestions = j.suggestions;
          if (!OPA.messages.length) renderBody();
        }
      })
      .catch(function () { /* local fallback stands */ });
  }

  function checkConfig() {
    if (OPA.aiEnabled !== null) return;
    fetch('/api/opa/config', { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        OPA.aiEnabled = !!(j && j.enabled);
        if (!OPA.aiEnabled && !OPA.messages.length) {
          pushOpa({
            text: "Opa's AI service isn't available right now. You can still use the Portal normally.",
            copy: false,
          });
          renderBody();
        }
      })
      .catch(function () { OPA.aiEnabled = null; });
  }

  // ── Real chat (Phase 2): server-side model behind /api/opa/chat ──────────
  function chatContext() {
    var mod = currentModule();
    return {
      route: '/' + mod,
      module: mod,
      pageTitle: (OPA.context && OPA.context.pageTitle) || mod,
    };
  }

  function pushOpa(msg) {
    msg.role = 'opa';
    msg.i = OPA.messages.length;
    OPA.messages.push(msg);
  }

  function sendMessage(retryText) {
    // Only a real string is a retry. Anything else — most dangerously a DOM
    // Event from a listener that registered this function directly — must be
    // treated as "no retry", or it becomes the message: truthy, it skips the
    // input read AND the push-and-clear block, then JSON-serialises to {}.
    if (typeof retryText !== 'string') retryText = '';
    if (OPA.busy) return;
    var input = panel.querySelector('#opa-input');
    var text = retryText || input.value.trim();
    if (!text) return;
    if (!retryText) {
      input.value = '';
      input.style.height = 'auto';
      OPA.messages.push({ role: 'user', text: text, i: OPA.messages.length });
    }
    OPA.busy = true;
    OPA.lastUserText = text;
    renderBody();

    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    OPA.abort = ctrl;
    var payload = JSON.stringify({
      conversationId: OPA.conversationId,
      message: text,
      context: chatContext(),
    });
    var opts = {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl ? ctrl.signal : undefined,
      body: payload,
    };
    var canStream = typeof TextDecoder !== 'undefined' && typeof ReadableStream !== 'undefined';
    if (!canStream) return sendLegacy(opts);

    fetch('/api/opa/chat/stream', opts)
      .then(function (r) {
        var ctype = (r.headers.get('Content-Type') || '');
        // Anything that is not an event stream (unavailable, 400, 429) comes
        // back as ordinary JSON — handle it exactly like the legacy route.
        if (ctype.indexOf('text/event-stream') === -1 || !r.body || !r.body.getReader) {
          return r.json().then(function (j) { finishChat(r.ok, r.status, j); });
        }
        return readSse(r, ctrl);
      })
      .catch(chatError);
  }

  // Non-streaming fallback for browsers without stream support.
  function sendLegacy(opts) {
    fetch('/api/opa/chat', opts)
      .then(function (r) { return r.json().then(function (j) { finishChat(r.ok, r.status, j); }); })
      .catch(chatError);
  }

  function finishChat(ok, status, j) {
    OPA.busy = false; OPA.abort = null;
    j = j || {};
    if (!ok && status === 429) {
      pushOpa({ text: j.answer || 'Please wait a moment before sending more messages.', copy: false });
    } else if (j.answer) {
      if (j.conversationId) OPA.conversationId = j.conversationId;
      pushOpa({ text: j.answer, sources: j.sources || [], actions: j.actions || [] });
    } else {
      pushOpa({ text: "I couldn't retrieve that just now. You can try again, or open the Resource Hub directly.", retry: true, copy: false });
    }
    renderBody();
  }

  function chatError(err) {
    OPA.busy = false; OPA.abort = null;
    if (err && err.name === 'AbortError') {
      pushOpa({ text: 'Stopped.', copy: false });
    } else {
      pushOpa({ text: "I couldn't retrieve that just now. You can try again, or open the Resource Hub directly.", retry: true, copy: false });
    }
    renderBody();
  }

  // Coalesce per-delta re-renders into one per frame.
  var renderQueued = false;
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(function () { renderQueued = false; renderBody(); });
  }

  /**
   * Consume the SSE body. Deltas append into one live message; `blocked` and
   * `unavailable` REPLACE everything already shown — a guardrail can refuse
   * on a trailing chunk after text has streamed, and the discarded text is
   * the point of the event.
   */
  function readSse(r, ctrl) {
    var live = { role: 'opa', text: '', sources: [], actions: [], i: OPA.messages.length };
    OPA.messages.push(live);
    var reader = r.body.getReader();
    var dec = new TextDecoder();
    var buf = '';
    var sawTerminal = false;

    function handleEvent(ev, data) {
      if (ev === 'delta') {
        live.text += (data.t || '');
        scheduleRender();
      } else if (ev === 'done') {
        sawTerminal = true;
        if (data.conversationId) OPA.conversationId = data.conversationId;
        if (data.answer) live.text = data.answer;
        live.sources = data.sources || [];
      } else if (ev === 'blocked' || ev === 'unavailable') {
        sawTerminal = true;
        live.text = data.answer || "I couldn't retrieve that just now.";
        live.copy = false;
        if (ev === 'unavailable') live.retry = true;
      }
    }

    function pump() {
      return reader.read().then(function (step) {
        if (step.done) {
          OPA.busy = false; OPA.abort = null;
          if (!sawTerminal && !live.text) {
            live.text = "I couldn't retrieve that just now. You can try again, or open the Resource Hub directly.";
            live.retry = true; live.copy = false;
          }
          renderBody();
          return;
        }
        buf += dec.decode(step.value, { stream: true });
        var blocks = buf.split('\n\n');
        buf = blocks.pop();
        blocks.forEach(function (block) {
          var ev = null, data = '';
          block.split('\n').forEach(function (line) {
            if (line.indexOf('event: ') === 0) ev = line.slice(7).trim();
            else if (line.indexOf('data: ') === 0) data += line.slice(6);
          });
          if (ev) {
            try { handleEvent(ev, JSON.parse(data || '{}')); } catch (e) { /* skip malformed */ }
          }
        });
        return pump();
      });
    }
    return pump().catch(function (err) {
      // Drop the live bubble before the shared error handler adds its own.
      if (OPA.messages[OPA.messages.length - 1] === live && !live.text) OPA.messages.pop();
      chatError(err);
    });
  }

  function cancelGeneration() {
    if (OPA.abort) { try { OPA.abort.abort(); } catch (e) { /* already done */ } }
  }

  function runAction(a) {
    // Client-side validation mirror: only NAVIGATE to known app tabs.
    if (!a || a.type !== 'NAVIGATE') return;
    var TAB_FOR = { calendar: 'calendar', resources: 'resources', book: 'book', profile: 'profile', accounting: 'accounting', travel: 'logbook', settings: 'settings' };
    if (!TAB_FOR[a.target]) return;
    if (typeof global.switchTab === 'function') {
      global.__viewManuallySet = true;
      global.switchTab(TAB_FOR[a.target]);
    }
  }

  // ── Drag (header only; text selection in chat never drags) ──────────────
  function attachDrag() {
    var head = panel.querySelector('#opa-head');
    head.addEventListener('pointerdown', function (e) {
      if (e.target.closest('[data-act]') || isMobile() || OPA.state === 'max') return;
      OPA.drag = { kind: 'move', sx: e.clientX, sy: e.clientY, ox: OPA.rect.x, oy: OPA.rect.y };
      try { head.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
      e.preventDefault();
    });
    head.addEventListener('pointermove', function (e) {
      var d = OPA.drag;
      if (!d || d.kind !== 'move') return;
      OPA.rect = opaClampRect({
        x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy),
        w: OPA.rect.w, h: OPA.rect.h,
      }, vp());
      applyRect();
    });
    head.addEventListener('pointerup', function () {
      if (OPA.drag) { OPA.drag = null; saveRect(); }
    });
  }

  function attachResize() {
    var grip = panel.querySelector('#opa-resize');
    grip.addEventListener('pointerdown', function (e) {
      if (isMobile() || OPA.state === 'max') return;
      OPA.drag = { kind: 'size', sx: e.clientX, sy: e.clientY, ow: OPA.rect.w, oh: OPA.rect.h };
      try { grip.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
      e.preventDefault();
    });
    grip.addEventListener('pointermove', function (e) {
      var d = OPA.drag;
      if (!d || d.kind !== 'size') return;
      OPA.rect = opaClampRect({
        x: OPA.rect.x, y: OPA.rect.y,
        w: d.ow + (e.clientX - d.sx), h: d.oh + (e.clientY - d.sy),
      }, vp());
      applyRect();
    });
    grip.addEventListener('pointerup', function () {
      if (OPA.drag) { OPA.drag = null; saveRect(); }
    });
  }

  function applyRect() {
    if (isMobile()) {
      panel.classList.add('opa-mobile');
      panel.style.left = ''; panel.style.top = '';
      panel.style.width = ''; panel.style.height = '';
      return;
    }
    panel.classList.remove('opa-mobile');
    if (OPA.state === 'max') {
      panel.classList.add('opa-max');
      panel.style.left = ''; panel.style.top = '';
      panel.style.width = ''; panel.style.height = '';
      return;
    }
    panel.classList.remove('opa-max');
    panel.style.left = OPA.rect.x + 'px';
    panel.style.top = OPA.rect.y + 'px';
    panel.style.width = OPA.rect.w + 'px';
    panel.style.height = OPA.rect.h + 'px';
  }

  // Keep the panel reachable when the browser window changes size.
  global.addEventListener('resize', function () {
    if (OPA.state === 'open' && OPA.rect) {
      OPA.rect = opaClampRect(OPA.rect, vp());
      applyRect();
    }
  });

  // ── Public API ───────────────────────────────────────────────────────────
  var Opa = {
    open: function () {
      if (!panel) buildPanel();
      if (!OPA.rect) OPA.rect = loadRect() || opaDefaultRect(vp());
      OPA.state = 'open';
      panel.classList.add('opa-show');
      fab.classList.add('opa-fab-hidden');
      applyRect();
      renderBody();
      saveRect();
      checkConfig();
      OPA.suggestions = null;
      loadSuggestions();
      var input = panel.querySelector('#opa-input');
      setTimeout(function () { input && input.focus(); }, 180);
    },
    close: function () {
      OPA.state = 'closed';
      if (panel) panel.classList.remove('opa-show');
      fab.classList.remove('opa-fab-hidden');
      saveRect();
      fab.focus();
    },
    minimise: function () {
      // conversation survives — reopening restores it
      OPA.state = 'min';
      if (panel) panel.classList.remove('opa-show');
      fab.classList.remove('opa-fab-hidden');
      saveRect();
      fab.focus();
    },
    maximise: function () {
      OPA.state = OPA.state === 'max' ? 'open' : 'max';
      applyRect();
      saveRect();
    },
    toggle: function () {
      (OPA.state === 'open' || OPA.state === 'max') ? Opa.close() : Opa.open();
    },
    newChat: function () {
      OPA.messages = [];
      OPA.conversationId = null;
      cancelGeneration();
      renderBody();
    },
    _state: OPA,
  };
  global.Opa = Opa;

  // ── Boot: only inside the authenticated app shell ────────────────────────
  function boot() {
    if (!document.body || document.getElementById('opa-fab')) return;
    buildFab();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})(typeof window !== 'undefined' ? window : null);
