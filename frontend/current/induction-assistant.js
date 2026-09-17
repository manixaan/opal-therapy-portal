/**
 * INDUCTION ASSISTANT — the Owner's conversational co-author on Assign
 * Learning.
 *
 * A side panel (like the walkthrough workshop's dock) that talks to
 * POST /api/learning/assistant/chat. The assistant can list, read, create
 * and update inductions and walkthroughs on the server; this file only
 * renders the conversation, shows what the assistant DID on each turn, and
 * refreshes the page's own data afterwards so the catalogue and the builder
 * reflect it. It holds no model access and no content authority of its own.
 *
 * Globals on window (no modules, no build step): OpalInductionAssistant.
 */
(function (global) {
  'use strict';
  var doc = global.document;

  var IA = {
    open: false,
    enabled: null,        // null until /config answers
    conversationId: null,
    messages: [],         // { role: 'user'|'assistant', text, activity, error }
    busy: false,
    abort: null,
    draft: '',
    listening: false,     // dictation in progress
    rec: null,            // the SpeechRecognition instance
    speakingIdx: -1,      // which assistant message is being read aloud
  };

  // ── Speech: dictation in, read-aloud out. Both are the browser's own
  //    (Web Speech API) — nothing leaves the page except the final text the
  //    Owner sends, exactly as if they had typed it. Hidden when unsupported.
  var Recognition = global.SpeechRecognition || global.webkitSpeechRecognition || null;
  var canSpeak = !!(global.speechSynthesis && global.SpeechSynthesisUtterance);

  var SUGGESTIONS = [
    'Draft a first-week induction for a new occupational therapist',
    'Create a short refresher on booking telehealth appointments',
    'Add a knowledge check to the induction I have open',
    'What inductions do we already have?',
  ];

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** Light markdown: **bold**, bullets, paragraphs. Escaped first. */
  function md(text) {
    var lines = esc(text).split('\n');
    var out = '', inList = false, para = [];
    var flush = function () {
      if (para.length) { out += '<p>' + para.join('<br>') + '</p>'; para = []; }
    };
    lines.forEach(function (l) {
      var m = l.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
      if (m) {
        flush();
        if (!inList) { out += '<ul>'; inList = true; }
        out += '<li>' + m[1] + '</li>';
        return;
      }
      if (inList) { out += '</ul>'; inList = false; }
      if (!l.trim()) { flush(); return; }
      var h = l.match(/^\s*#{1,3}\s+(.*)$/);
      if (h) { flush(); out += '<h4>' + h[1] + '</h4>'; return; }
      para.push(l);
    });
    if (inList) out += '</ul>';
    flush();
    return out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  }

  function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', credentials: 'include', headers: {} };
    if (opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    if (opts.signal) init.signal = opts.signal;
    return fetch(path, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { j._status = r.status; j._ok = r.ok; return j; });
    });
  }

  function layer() {
    var el = doc.getElementById('ia-dock');
    if (!el) {
      el = doc.createElement('aside');
      el.id = 'ia-dock';
      el.className = 'ia-dock';
      el.setAttribute('role', 'complementary');
      el.setAttribute('aria-label', 'Induction assistant');
      doc.body.appendChild(el);
    }
    return el;
  }

  function isOwner() { return String((global.APP_USER || {}).role || '') === 'owner'; }

  /** The walkthrough open in the workshop, if any. */
  function openWalkthroughId() {
    try { return (global.OpalWorkshop && global.OpalWorkshop.currentId && global.OpalWorkshop.currentId()) || null; } catch (e) { return null; }
  }

  /** The induction open in the builder, if the hub exposes one. */
  function openWorkflowId() {
    try {
      var s = global.RH2 && global.RH2._laEditorId ? global.RH2._laEditorId() : null;
      return s || null;
    } catch (e) { return null; }
  }

  function toggle() {
    if (!isOwner()) return;
    IA.open = !IA.open;
    doc.body.classList.toggle('ia-open', IA.open);
    if (IA.open && IA.enabled === null) {
      api('/api/learning/assistant/config').then(function (j) { IA.enabled = !!j.enabled; render(); });
    }
    render();
    if (IA.open) {
      var input = doc.getElementById('ia-input');
      if (input) { try { input.focus(); } catch (e) { /* not painted */ } }
    }
  }
  function close() {
    if (canSpeak) { global.speechSynthesis.cancel(); IA.speakingIdx = -1; }
    if (IA.listening && IA.rec) { try { IA.rec.stop(); } catch (e) { /* ok */ } }
    if (IA.open) toggle();
  }

  function render() {
    var host = layer();
    if (!IA.open) { host.innerHTML = ''; return; }
    var h = '<div class="ia-head">' +
      '<div><div class="ia-title">Induction assistant</div>' +
      '<div class="ia-sub">Builds inductions and walkthroughs with you. It never assigns or publishes.</div></div>' +
      '<button type="button" class="ia-x" aria-label="Close the assistant" onclick="OpalInductionAssistant.close()">&times;</button>' +
      '</div>';

    h += '<div class="ia-body" id="ia-body">';
    if (IA.enabled === false) {
      h += '<div class="ia-note">The assistant is not switched on for this practice yet. Ask your administrator to enable it; you can still build inductions by hand.</div>';
    } else if (!IA.messages.length) {
      h += '<div class="ia-intro"><p>Tell me what the induction is for and who it is for, and I will draft the chapters and lessons in the library for you to edit. Try one of these:</p>' +
        '<div class="ia-sugs">' + SUGGESTIONS.map(function (s) {
          return '<button type="button" class="ia-sug" onclick="OpalInductionAssistant.send(' + JSON.stringify(s).replace(/"/g, '&quot;') + ')">' + esc(s) + '</button>';
        }).join('') + '</div></div>';
    }
    IA.messages.forEach(function (m, idx) {
      if (m.role === 'user') {
        h += '<div class="ia-msg ia-user"><div class="ia-bubble">' + esc(m.text) + '</div></div>';
        return;
      }
      h += '<div class="ia-msg ia-assistant' + (m.error ? ' ia-err' : '') + '"><div class="ia-bubble">' + md(m.text) +
        (canSpeak && !m.error
          ? '<button type="button" class="ia-speak' + (IA.speakingIdx === idx ? ' is-on' : '') + '" aria-pressed="' + (IA.speakingIdx === idx) +
            '" aria-label="' + (IA.speakingIdx === idx ? 'Stop reading' : 'Read aloud') + '" title="' + (IA.speakingIdx === idx ? 'Stop' : 'Read aloud') +
            '" onclick="OpalInductionAssistant.speak(' + idx + ')">' + (IA.speakingIdx === idx ? '&#9632;' : '&#128266;') + '</button>'
          : '') +
        '</div>';
      if (m.activity && m.activity.length) {
        h += '<ul class="ia-acts">' + m.activity.map(function (a) {
          var open = '';
          if ((a.tool === 'create_induction' || a.tool === 'update_induction') && a.id) {
            open = ' <button type="button" class="ia-link" onclick="OpalInductionAssistant.openInduction(\'' + esc(a.id) + '\')">Open in the builder &rarr;</button>';
          } else if ((a.tool === 'create_walkthrough' || a.tool === 'update_walkthrough') && a.id) {
            open = ' <button type="button" class="ia-link" onclick="OpalInductionAssistant.openWalkthrough(\'' + esc(a.id) + '\')">Open in the workshop &rarr;</button>';
          }
          return '<li><span class="ia-act-dot" aria-hidden="true"></span>' + esc(a.summary || a.tool) + open + '</li>';
        }).join('') + '</ul>';
      }
      if (m.retry) h += '<button type="button" class="ia-link" onclick="OpalInductionAssistant.retry()">Try again</button>';
      h += '</div>';
    });
    if (IA.busy) {
      h += '<div class="ia-msg ia-assistant"><div class="ia-bubble ia-thinking"><span></span><span></span><span></span> Working on it &mdash; building may take a moment</div></div>';
    }
    h += '</div>';

    h += '<div class="ia-foot">' +
      '<textarea id="ia-input" class="ia-input" rows="2" placeholder="Describe the induction you want… or press Dictate and say it" ' +
        (IA.enabled === false ? 'disabled ' : '') +
        'oninput="OpalInductionAssistant._draft(this.value)" ' +
        'onkeydown="if(event.key===\'Enter\'&&!event.shiftKey){event.preventDefault();OpalInductionAssistant.send();}">' + esc(IA.draft) + '</textarea>' +
      '<div class="ia-foot-row">' +
        (Recognition
          ? '<button type="button" class="ia-btn ia-mic' + (IA.listening ? ' is-on' : '') + '" aria-pressed="' + IA.listening +
            '" aria-label="' + (IA.listening ? 'Stop dictating' : 'Dictate') + '" title="' + (IA.listening ? 'Stop dictating' : 'Dictate your message') + '" ' +
            (IA.enabled === false ? 'disabled ' : '') + 'onclick="OpalInductionAssistant.micToggle()">' +
            (IA.listening ? '<span class="ia-mic-dot" aria-hidden="true"></span> Listening…' : '&#127908; Dictate') + '</button>'
          : '') +
        (IA.busy
          ? '<button type="button" class="ia-btn" onclick="OpalInductionAssistant.stop()">Stop</button>'
          : '<button type="button" class="ia-btn ia-btn-primary" ' + (IA.enabled === false ? 'disabled ' : '') + 'onclick="OpalInductionAssistant.send()">Send</button>') +
        (IA.messages.length ? '<button type="button" class="ia-btn ia-btn-quiet" onclick="OpalInductionAssistant.newThread()">New conversation</button>' : '') +
      '</div></div>';

    host.innerHTML = h;
    var body = doc.getElementById('ia-body');
    if (body) body.scrollTop = body.scrollHeight;
  }

  function _draft(v) { IA.draft = v; }

  function micToggle() {
    if (!Recognition || IA.enabled === false) return;
    if (IA.listening) { try { IA.rec.stop(); } catch (e) { /* already stopped */ } return; }
    var rec = new Recognition();
    rec.lang = 'en-AU';
    rec.continuous = true;
    rec.interimResults = true;
    var base = (doc.getElementById('ia-input') || {}).value || IA.draft || '';
    if (base && !/\s$/.test(base)) base += ' ';
    var finalText = '';
    rec.onresult = function (ev) {
      var interim = '';
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        var t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) finalText += t + ' '; else interim += t;
      }
      IA.draft = base + finalText + interim;
      var input = doc.getElementById('ia-input');
      if (input) { input.value = IA.draft; input.scrollTop = input.scrollHeight; }
    };
    rec.onerror = function (ev) {
      IA.listening = false; IA.rec = null;
      if (ev && ev.error === 'not-allowed') {
        IA.messages.push({ role: 'assistant', text: 'The browser blocked the microphone. Allow it for this site and try again.', error: true });
      }
      render();
    };
    rec.onend = function () { IA.listening = false; IA.rec = null; IA.draft = (base + finalText).trim(); render(); };
    IA.rec = rec;
    IA.listening = true;
    render();
    try { rec.start(); } catch (e) { IA.listening = false; IA.rec = null; render(); }
  }

  /** Read one assistant reply aloud; pressing again stops it. */
  function speak(idx) {
    if (!canSpeak) return;
    if (IA.speakingIdx === idx) { global.speechSynthesis.cancel(); IA.speakingIdx = -1; render(); return; }
    global.speechSynthesis.cancel();
    var m = IA.messages[idx];
    if (!m) return;
    var u = new global.SpeechSynthesisUtterance(String(m.text || '').replace(/\*\*/g, '').replace(/^\s*[-*#]+\s*/gm, ''));
    u.lang = 'en-AU';
    u.onend = function () { if (IA.speakingIdx === idx) { IA.speakingIdx = -1; render(); } };
    u.onerror = u.onend;
    IA.speakingIdx = idx;
    render();
    global.speechSynthesis.speak(u);
  }

  function send(text) {
    if (typeof text !== 'string') text = '';
    if (IA.busy || IA.enabled === false) return;
    var input = doc.getElementById('ia-input');
    var msg = text || (input ? input.value.trim() : IA.draft.trim());
    if (!msg) return;
    IA.draft = '';
    IA.messages.push({ role: 'user', text: msg });
    IA.lastUserText = msg;
    IA.busy = true;
    render();
    // The assistant creates things partway through its work, and its reply
    // can take half a minute. Refresh the library every few seconds while it
    // is busy so a new tile appears when it is made, not when the reply lands.
    startPolling();

    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    IA.abort = ctrl;
    api('/api/learning/assistant/chat', {
      method: 'POST',
      signal: ctrl ? ctrl.signal : undefined,
      body: { conversationId: IA.conversationId, message: msg, workflowId: openWorkflowId(), walkthroughId: openWalkthroughId() },
    }).then(function (j) {
      IA.busy = false; IA.abort = null;
      stopPolling();
      if (j._status === 429) {
        IA.messages.push({ role: 'assistant', text: j.answer || 'Please wait a moment before sending more messages.', error: true });
      } else if (j.answer) {
        if (j.conversationId) IA.conversationId = j.conversationId;
        IA.messages.push({ role: 'assistant', text: j.answer, activity: j.activity || [], error: j.status === 'unavailable' || j.status === 'blocked' });
        if (j.activity && j.activity.length) afterActivity(j.activity);
      } else {
        IA.messages.push({ role: 'assistant', text: 'I could not get an answer just now.', retry: true, error: true });
      }
      render();
    }).catch(function (err) {
      IA.busy = false; IA.abort = null;
      stopPolling();
      IA.messages.push({ role: 'assistant', text: err && err.name === 'AbortError' ? 'Stopped.' : 'I could not get an answer just now.', retry: !(err && err.name === 'AbortError'), error: true });
      render();
    });
  }

  var pollTimer = null;
  function startPolling() {
    stopPolling();
    pollTimer = setInterval(function () {
      var rh = global.RH2;
      // Only the catalogue: a reload under an open builder would repaint the
      // pane the Owner may be typing in.
      if (rh && rh.aslReload && !openWorkflowId() && !openWalkthroughId()) rh.aslReload();
    }, 4000);
  }
  function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

  function retry() {
    if (!IA.lastUserText || IA.busy) return;
    // Drop the failed answer and the echoed question, then resend.
    while (IA.messages.length && IA.messages[IA.messages.length - 1].role === 'assistant') IA.messages.pop();
    if (IA.messages.length && IA.messages[IA.messages.length - 1].role === 'user') IA.messages.pop();
    send(IA.lastUserText);
  }

  function stop() { if (IA.abort) { try { IA.abort.abort(); } catch (e) { /* already done */ } } }

  function newThread() {
    if (IA.busy) return;
    IA.conversationId = null;
    IA.messages = [];
    render();
  }

  /** The library, the open builder and the open workshop are stale once the assistant acted. */
  function afterActivity(activity) {
    var wk = global.OpalWorkshop;
    var wkId = openWalkthroughId();
    if (wk && wkId && activity.some(function (a) { return a.id === wkId; })) {
      // Reload the workshop's draft — unless the Owner has unsaved edits there,
      // which must never be thrown away under them.
      if (wk.isDirty && wk.isDirty()) {
        IA.messages.push({ role: 'assistant', text: 'I updated the walkthrough you have open, but you have unsaved changes in the workshop. Save or close it, then reopen to see mine.', error: true });
      } else if (wk.edit) {
        wk.edit(wkId);
      }
    }
    var rh = global.RH2;
    if (!rh) return;
    var openId = openWorkflowId();
    var touchedOpen = activity.some(function (a) { return a.id && a.id === openId; });
    if (rh.aslReload) rh.aslReload();
    if (touchedOpen && rh.laEdit) rh.laEdit(openId);
  }

  function openInduction(id) {
    if (global.RH2 && global.RH2.laEdit) {
      if (global.RH2.nav && !(doc.getElementById('rh2-root') && doc.getElementById('rh2-root').dataset.view === 'learning')) global.RH2.nav('learning');
      global.RH2.laEdit(id);
    }
  }
  function openWalkthrough(id) {
    if (global.OpalWorkshop && global.OpalWorkshop.edit) global.OpalWorkshop.edit(id);
  }

  global.OpalInductionAssistant = {
    toggle: toggle, close: close, send: send, retry: retry, stop: stop,
    newThread: newThread, openInduction: openInduction, openWalkthrough: openWalkthrough,
    micToggle: micToggle, speak: speak,
    _draft: _draft, _state: IA,
  };
})(typeof window !== 'undefined' ? window : this);
