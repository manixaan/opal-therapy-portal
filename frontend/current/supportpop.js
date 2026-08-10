/* ═══════════════════════════════════════════════════════════════════════════
   OPAL SUPPORT POPUP — floating, draggable Support window.
   Mirrors the Opa shell architecture (opa.js): pure geometry helpers exported
   for node tests, pointer drag via the header, resize grip, position/size
   persistence, mobile bottom-sheet, Escape-to-close, focus management.

   Deliberately NOT a modal: there is no page-dimming layer and the app behind
   the window stays fully interactive — users can reproduce an issue on the
   page while describing it here.

   Sub-views: 'New issue' (same field contract as the legacy report modal —
   the /api/support/tickets API is unchanged) and 'My tickets' (rendering is
   shared with the legacy drawer through window.supMySetCtx/supMyShowList/
   supMyShowDetail so verification, comments and reopen logic exist once).

   Voice dictation: Web Speech API (en-AU), feature-detected — mic buttons are
   not rendered at all in unsupported browsers. Dictation only ever edits the
   field text; submission stays a manual action (never auto-submit).
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

(function (global) {

  // ── Pure geometry helpers (node-exported for unit tests) ─────────────────
  var SUP_MIN_W = 360, SUP_MIN_H = 420;

  // Clamp the window rect into the viewport: never fully off screen, never
  // larger than the viewport allows, header always reachable.
  function supClampRect(rect, vp) {
    var w = Math.max(SUP_MIN_W, Math.min(rect.w, Math.floor(vp.w * 0.92)));
    var h = Math.max(SUP_MIN_H, Math.min(rect.h, Math.floor(vp.h * 0.92)));
    var x = Math.min(Math.max(rect.x, 8 - (w - 60)), vp.w - 68);
    var y = Math.min(Math.max(rect.y, 8), vp.h - 48);
    return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
  }

  // Default: right-of-centre, clear of the Opa pebble in the bottom corner.
  function supDefaultRect(vp) {
    var w = Math.min(480, Math.floor(vp.w * 0.9));
    var h = Math.min(620, Math.floor(vp.h * 0.85));
    return {
      x: Math.max(12, vp.w - w - 92),
      y: Math.max(12, Math.floor((vp.h - h) / 2)),
      w: w, h: h,
    };
  }

  var helpers = { supClampRect: supClampRect, supDefaultRect: supDefaultRect, SUP_MIN_W: SUP_MIN_W, SUP_MIN_H: SUP_MIN_H };
  if (typeof module !== 'undefined' && module.exports) module.exports = helpers;
  if (!global || !global.document) return; // node/test stops here

  // ── State ────────────────────────────────────────────────────────────────
  var SP = {
    open: false,
    rect: null,          // {x,y,w,h}
    view: 'new',         // 'new' | 'mine'
    drag: null,
    prefill: null,       // OpalSupport.openReport(prefill) contract
    created: null,       // last ticket created through this window
    busy: false,
  };

  function vp() {
    var d = global.document && global.document.documentElement;
    var w = global.innerWidth || (d && d.clientWidth) || 0;
    var h = global.innerHeight || (d && d.clientHeight) || 0;
    // A hidden or not-yet-laid-out window can report a 0x0 viewport; clamping
    // a saved rect against that would destroy the user's position. Fall back
    // to a sane desktop size until real dimensions arrive (the resize
    // listener re-clamps once they do).
    if (w < 200 || h < 200) { w = Math.max(w, 1024); h = Math.max(h, 768); }
    return { w: w, h: h };
  }
  function isMobile() { return vp().w < 700; }
  function el(id) { return document.getElementById(id); }

  // Mirror the hidden native input's state into our styled control.
  function supFileSync() {
    var input = el('sp-r-shot');
    var name = el('sp-r-shot-name');
    var clear = el('sp-r-shot-clear');
    if (!input || !name) return;
    var f = input.files && input.files[0];
    name.textContent = f ? f.name : 'No file chosen';
    name.classList.toggle('has-file', !!f);
    if (clear) clear.style.display = f ? '' : 'none';
  }

  // ── Persistence (support.window.*) ───────────────────────────────────────
  function saveRect() {
    if (!SP.rect) return;
    try {
      localStorage.setItem('support.window.x', String(SP.rect.x));
      localStorage.setItem('support.window.y', String(SP.rect.y));
      localStorage.setItem('support.window.width', String(SP.rect.w));
      localStorage.setItem('support.window.height', String(SP.rect.h));
    } catch (e) { /* private mode */ }
  }

  function loadRect() {
    try {
      var x = parseInt(localStorage.getItem('support.window.x'), 10);
      var y = parseInt(localStorage.getItem('support.window.y'), 10);
      var w = parseInt(localStorage.getItem('support.window.width'), 10);
      var h = parseInt(localStorage.getItem('support.window.height'), 10);
      if ([x, y, w, h].some(isNaN)) return null;
      return supClampRect({ x: x, y: y, w: w, h: h }, vp());
    } catch (e) { return null; }
  }

  // ── Voice dictation (Web Speech API, feature-detected) ───────────────────
  var SR = global.SpeechRecognition || global.webkitSpeechRecognition || null;
  var VOICE_UNAVAILABLE = 'Voice input is not available in this browser — you can type as normal.';
  var VOICE_HINT = "Voice dictation uses your browser's speech service.";
  var MIC_SVG =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>' +
    '<path d="M19 10v2a7 7 0 0 1-14 0v-2"/>' +
    '<line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';

  var voice = { key: null, rec: null, btn: null, field: null, interim: null };

  function voiceCleanup() {
    if (voice.btn) {
      voice.btn.classList.remove('sp-mic-on');
      voice.btn.setAttribute('aria-pressed', 'false');
    }
    if (voice.interim) voice.interim.textContent = '';
    voice = { key: null, rec: null, btn: null, field: null, interim: null };
  }

  function stopVoice() {
    var rec = voice.rec;
    voiceCleanup();
    if (rec) { try { rec.stop(); } catch (e) { /* already stopped */ } }
  }

  function showVoiceNote() {
    var note = el('sp-voice-note');
    if (note) note.hidden = false;
  }

  // Commit dictated text into the field at the caret (or the end when the
  // field is not focused). Never triggers submission.
  function insertDictation(field, text) {
    if (!field || !text) return;
    var v = field.value;
    var s = typeof field.selectionStart === 'number' ? field.selectionStart : v.length;
    var e = typeof field.selectionEnd === 'number' ? field.selectionEnd : v.length;
    if (document.activeElement !== field) { s = v.length; e = v.length; }
    var pre = v.slice(0, s), post = v.slice(e);
    var sep = pre && !/\s$/.test(pre) ? ' ' : '';
    var next = pre + sep + text + post;
    var max = field.maxLength > 0 ? field.maxLength : Infinity;
    field.value = next.slice(0, max);
    var pos = Math.min(field.value.length, (pre + sep + text).length);
    try { field.setSelectionRange(pos, pos); } catch (err) { /* selects unsupported */ }
  }

  function toggleVoice(key) {
    if (!SR) return; // buttons are never rendered in this case; belt-and-braces
    if (voice.key === key) { stopVoice(); return; }
    stopVoice();

    var field = el(key === 'title' ? 'sp-r-title' : 'sp-r-desc');
    var btn = el(key === 'title' ? 'sp-mic-title' : 'sp-mic-desc');
    var interim = el(key === 'title' ? 'sp-vi-title' : 'sp-vi-desc');
    if (!field || !btn) return;

    var rec;
    try { rec = new SR(); } catch (e) { showVoiceNote(); return; }
    rec.lang = 'en-AU';
    rec.continuous = true;
    rec.interimResults = true;
    voice = { key: key, rec: rec, btn: btn, field: field, interim: interim };

    rec.onresult = function (ev) {
      // Finalised phrases are committed into the field; the pending interim
      // phrase renders greyed beneath it. Nothing here submits the form.
      var pending = '';
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        var r = ev.results[i];
        var t = (r[0] && r[0].transcript) || '';
        if (r.isFinal) insertDictation(field, t.trim());
        else pending += t;
      }
      if (interim) interim.textContent = pending.trim();
    };
    rec.onerror = function (ev) {
      var code = ev && ev.error;
      if (code === 'not-allowed' || code === 'service-not-allowed' || code === 'audio-capture') showVoiceNote();
      voiceCleanup();
    };
    rec.onend = function () {
      if (voice.rec === rec) voiceCleanup(); // service ended on its own
    };

    try {
      rec.start();
      btn.classList.add('sp-mic-on');
      btn.setAttribute('aria-pressed', 'true');
      field.focus();
    } catch (e) {
      showVoiceNote();
      voiceCleanup();
    }
  }

  // ── DOM ──────────────────────────────────────────────────────────────────
  var panel = null;

  var LIFE_RING_SVG =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/>' +
    '<line x1="4.93" y1="4.93" x2="9.17" y2="9.17"/><line x1="14.83" y1="14.83" x2="19.07" y2="19.07"/>' +
    '<line x1="14.83" y1="9.17" x2="19.07" y2="4.93"/><line x1="4.93" y1="19.07" x2="9.17" y2="14.83"/></svg>';

  function micButtonHtml(id, label) {
    if (!SR) return ''; // unsupported browser: no mic buttons at all
    return '<button type="button" class="sp-mic" id="' + id + '" aria-pressed="false" ' +
      'title="' + label + '" aria-label="' + label + '">' + MIC_SVG + '</button>';
  }

  function newIssueFormHtml() {
    return '' +
      '<div id="sp-r-form">' +
        '<label for="sp-r-type">What kind of issue is this?</label>' +
        '<select id="sp-r-type">' +
          '<option value="bug">Something is broken (bug)</option>' +
          '<option value="feature_request">An idea or feature request</option>' +
          '<option value="resource_issue">A problem with a resource</option>' +
          '<option value="data_issue">Data looks wrong</option>' +
          '<option value="usability">Something is confusing or hard to use</option>' +
          '<option value="other">Something else</option>' +
        '</select>' +
        '<label for="sp-r-title">Short summary</label>' +
        '<div class="sp-voice-row">' +
          '<input type="text" id="sp-r-title" maxlength="200" placeholder="e.g. Week view tiles overlap after resizing" />' +
          micButtonHtml('sp-mic-title', 'Dictate the summary') +
        '</div>' +
        '<div class="sp-voice-interim" id="sp-vi-title" aria-live="polite"></div>' +
        '<label for="sp-r-desc">What happened?</label>' +
        '<div class="sp-voice-row">' +
          '<textarea id="sp-r-desc" rows="4" maxlength="5000" placeholder="What were you doing, and what went wrong?"></textarea>' +
          micButtonHtml('sp-mic-desc', 'Dictate the description') +
        '</div>' +
        '<div class="sp-voice-interim" id="sp-vi-desc" aria-live="polite"></div>' +
        (SR ? '<div class="sp-voice-hint">' + VOICE_HINT + '</div>' : '') +
        '<div class="sp-voice-note" id="sp-voice-note" hidden>' + VOICE_UNAVAILABLE + '</div>' +
        '<div id="sp-r-expected-wrap">' +
          '<label for="sp-r-expected">What did you expect to happen?</label>' +
          '<textarea id="sp-r-expected" rows="2" maxlength="3000"></textarea>' +
        '</div>' +
        '<label for="sp-r-impact">How much is this affecting you?</label>' +
        '<select id="sp-r-impact">' +
          '<option value="low">Low — a minor annoyance</option>' +
          '<option value="medium" selected>Medium — slows me down</option>' +
          '<option value="high">High — blocking part of my work</option>' +
          '<option value="critical">Critical — I cannot work until this is fixed</option>' +
        '</select>' +
        '<label for="sp-r-shot">Screenshot (optional — PNG, JPEG or WEBP, up to 5 MB)</label>' +
        // Native file inputs render in browser chrome and cannot be styled;
        // the real input stays for behaviour/accessibility but is visually
        // hidden behind our own button + filename line.
        '<div class="sp-file">' +
          '<input type="file" id="sp-r-shot" class="sp-file-native" accept="image/png,image/jpeg,image/webp" />' +
          '<button type="button" class="sp-file-btn" id="sp-r-shot-btn">Attach a screenshot</button>' +
          '<span class="sp-file-name" id="sp-r-shot-name">No file chosen</span>' +
          '<button type="button" class="sp-file-clear" id="sp-r-shot-clear" style="display:none;" aria-label="Remove screenshot">Remove</button>' +
        '</div>' +
        '<div class="sp-privacy">Please do not include participant names, clinical information or other sensitive personal information in technical support tickets.</div>' +
        '<div class="sp-form-actions">' +
          '<button class="btn primary" type="button" id="sp-r-submit">Submit ticket</button>' +
        '</div>' +
      '</div>' +
      '<div class="sp-success" id="sp-r-success" style="display:none;">' +
        '<div class="sp-success-icon" id="sp-success-icon"></div>' +
        '<p id="sp-success-msg"></p>' +
        '<p class="sp-quiet" style="margin:0 0 14px;">You can follow progress under My tickets. We will let you know when there is something to test.</p>' +
        '<button class="btn primary" type="button" id="sp-r-view-ticket">View ticket</button>' +
      '</div>';
  }

  function buildPanel() {
    panel = document.createElement('section');
    panel.id = 'supportpop';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Support — report an issue or follow your tickets');
    panel.innerHTML =
      '<header class="sp-head" id="sp-head">' +
        '<span class="sp-head-icon" aria-hidden="true">' + LIFE_RING_SVG + '</span>' +
        '<span class="sp-head-id"><strong>Support</strong><span>Report an issue or follow your tickets</span></span>' +
        '<span class="sp-head-btns">' +
          '<button type="button" data-act="close" title="Close" aria-label="Close Support">&times;</button>' +
        '</span>' +
      '</header>' +
      '<div class="sp-seg" role="tablist" aria-label="Support views">' +
        '<button type="button" class="sp-seg-btn" id="sp-seg-new" role="tab" aria-selected="true">New issue</button>' +
        '<button type="button" class="sp-seg-btn" id="sp-seg-mine" role="tab" aria-selected="false">My tickets</button>' +
      '</div>' +
      '<div class="sp-body">' +
        '<div id="sp-view-new" role="tabpanel" aria-label="New issue">' + newIssueFormHtml() + '</div>' +
        '<div id="sp-view-mine" role="tabpanel" aria-label="My tickets" style="display:none;">' +
          '<div class="sp-mine-head">' +
            '<span id="sp-mine-title">My tickets</span>' +
            '<button class="btn" type="button" id="sp-mine-back" style="display:none;">Back</button>' +
          '</div>' +
          '<div id="sp-mine-body" tabindex="-1"><div class="sp-quiet">Loading…</div></div>' +
        '</div>' +
      '</div>' +
      '<span class="sp-resize" id="sp-resize" aria-hidden="true"></span>';
    document.body.appendChild(panel);

    panel.querySelector('[data-act="close"]').addEventListener('click', function () { SupportPop.close(); });
    el('sp-seg-new').addEventListener('click', function () {
      // Returning to New issue after a successful submit starts a fresh form.
      if (el('sp-r-success').style.display !== 'none') resetForm(null);
      setView('new');
      focusFirstField();
    });
    el('sp-seg-mine').addEventListener('click', function () { setView('mine'); });
    el('sp-r-submit').addEventListener('click', submitReport);
    el('sp-r-view-ticket').addEventListener('click', function () {
      setView('mine', SP.created ? SP.created.id : null);
    });
    el('sp-r-type').addEventListener('change', typeChanged);
    el('sp-r-shot-btn').addEventListener('click', function () { el('sp-r-shot').click(); });
    el('sp-r-shot').addEventListener('change', supFileSync);
    el('sp-r-shot-clear').addEventListener('click', function () {
      el('sp-r-shot').value = '';
      supFileSync();
    });
    el('sp-mine-back').addEventListener('click', function () { showMine(null); });
    if (SR) {
      el('sp-mic-title').addEventListener('click', function () { toggleVoice('title'); });
      el('sp-mic-desc').addEventListener('click', function () { toggleVoice('desc'); });
    }

    panel.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') SupportPop.close();
    });

    attachDrag();
    attachResize();
  }

  function typeChanged() {
    var t = el('sp-r-type').value;
    el('sp-r-expected-wrap').style.display = (t === 'bug') ? '' : 'none';
  }

  // ── Sub-views ────────────────────────────────────────────────────────────
  function setView(view, ticketId) {
    stopVoice(); // leaving the form (or re-entering it) never keeps the mic on
    SP.view = view;
    el('sp-seg-new').setAttribute('aria-selected', view === 'new' ? 'true' : 'false');
    el('sp-seg-mine').setAttribute('aria-selected', view === 'mine' ? 'true' : 'false');
    el('sp-view-new').style.display = view === 'new' ? '' : 'none';
    el('sp-view-mine').style.display = view === 'mine' ? '' : 'none';
    if (view === 'mine') showMine(ticketId || null);
  }

  // My tickets: shared rendering with the legacy drawer. supMySetCtx points
  // the drawer's list/detail/verify/comment functions at this window's
  // elements so the logic exists once (see mockup_v3.html).
  function showMine(ticketId) {
    var body = el('sp-mine-body');
    if (typeof global.supMySetCtx === 'function' && typeof global.supMyShowList === 'function') {
      global.supMySetCtx({ body: body, title: el('sp-mine-title'), back: el('sp-mine-back') });
      if (ticketId && typeof global.supMyShowDetail === 'function') global.supMyShowDetail(ticketId);
      else global.supMyShowList();
    } else {
      body.innerHTML = '<div class="sp-quiet">Tickets are unavailable right now. Please try again later.</div>';
    }
  }

  // ── New-issue form ───────────────────────────────────────────────────────
  function resetForm(prefill) {
    SP.prefill = prefill || null;
    SP.created = null;
    el('sp-r-form').style.display = '';
    el('sp-r-success').style.display = 'none';
    el('sp-r-title').value = (prefill && prefill.title) || '';
    el('sp-r-desc').value = '';
    el('sp-r-expected').value = '';
    el('sp-r-shot').value = '';
    supFileSync();
    el('sp-r-impact').value = 'medium';
    var typeSel = el('sp-r-type');
    var validTypes = ['bug', 'feature_request', 'resource_issue', 'data_issue', 'usability', 'other'];
    typeSel.value = (prefill && validTypes.indexOf(prefill.type) !== -1) ? prefill.type : 'bug';
    typeChanged();
    var note = el('sp-voice-note');
    if (note) note.hidden = true;
  }

  function toast(msg, isErr) {
    if (typeof global.showToast === 'function') global.showToast(msg, isErr);
  }

  async function submitReport() {
    if (SP.busy) return;
    stopVoice(); // submitting always ends dictation; submission is manual only

    var title = el('sp-r-title').value.trim();
    var desc = el('sp-r-desc').value.trim();
    if (!title) { toast('Please add a short summary', true); return; }
    if (!desc) { toast('Please describe what happened', true); return; }

    var shotInput = el('sp-r-shot');
    var file = shotInput.files && shotInput.files[0];
    if (file && typeof global.supPrecheckScreenshot === 'function') {
      var pre = global.supPrecheckScreenshot(file);
      if (pre) { toast(pre, true); return; }
    }

    var btn = el('sp-r-submit');
    SP.busy = true;
    btn.disabled = true; btn.textContent = 'Submitting…';

    var ctx = typeof global.createIssueContext === 'function' ? global.createIssueContext() : {};
    var technicalContext = { timestamp: ctx.timestamp };
    if (SP.prefill && SP.prefill.technicalContext) {
      var pf = SP.prefill.technicalContext;
      for (var k in pf) { if (Object.prototype.hasOwnProperty.call(pf, k)) technicalContext[k] = pf[k]; }
    }

    var d = await global.supApi('/api/support/tickets', { method: 'POST', body: {
      type: el('sp-r-type').value,
      title: title, description: desc,
      expectedBehaviour: el('sp-r-expected').value.trim() || undefined,
      reportedPriority: el('sp-r-impact').value,
      module: ctx.module, route: ctx.route, browser: ctx.browser, viewport: ctx.viewport,
      technicalContext: technicalContext,
    } });

    SP.busy = false;
    btn.disabled = false; btn.textContent = 'Submit ticket';
    if (!d || !d.__ok || !d.ticket) {
      toast((d && (d.message || d.error)) || 'Could not create the ticket', true);
      return;
    }
    SP.created = d.ticket;

    if (file && typeof global.supUploadScreenshot === 'function') {
      var ok = await global.supUploadScreenshot(d.ticket.id, file);
      if (!ok) toast('Ticket created, but the screenshot could not be attached', true);
    }

    el('sp-r-form').style.display = 'none';
    el('sp-success-icon').innerHTML = typeof global.opIcon === 'function' ? global.opIcon('check', 28) : '';
    el('sp-success-msg').textContent = 'Thanks — ticket ' + d.ticket.ticket_number + ' has been created.';
    el('sp-r-success').style.display = '';
  }

  // ── Drag (header only; text selection in the form never drags) ───────────
  function attachDrag() {
    var head = panel.querySelector('#sp-head');
    head.addEventListener('pointerdown', function (e) {
      if (e.target.closest('button') || isMobile()) return;
      SP.drag = { kind: 'move', sx: e.clientX, sy: e.clientY, ox: SP.rect.x, oy: SP.rect.y };
      try { head.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
      e.preventDefault();
    });
    head.addEventListener('pointermove', function (e) {
      var d = SP.drag;
      if (!d || d.kind !== 'move') return;
      SP.rect = supClampRect({
        x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy),
        w: SP.rect.w, h: SP.rect.h,
      }, vp());
      applyRect();
    });
    head.addEventListener('pointerup', function () {
      if (SP.drag) { SP.drag = null; saveRect(); }
    });
  }

  function attachResize() {
    var grip = panel.querySelector('#sp-resize');
    grip.addEventListener('pointerdown', function (e) {
      if (isMobile()) return;
      SP.drag = { kind: 'size', sx: e.clientX, sy: e.clientY, ow: SP.rect.w, oh: SP.rect.h };
      try { grip.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
      e.preventDefault();
    });
    grip.addEventListener('pointermove', function (e) {
      var d = SP.drag;
      if (!d || d.kind !== 'size') return;
      SP.rect = supClampRect({
        x: SP.rect.x, y: SP.rect.y,
        w: d.ow + (e.clientX - d.sx), h: d.oh + (e.clientY - d.sy),
      }, vp());
      applyRect();
    });
    grip.addEventListener('pointerup', function () {
      if (SP.drag) { SP.drag = null; saveRect(); }
    });
  }

  function applyRect() {
    if (isMobile()) {
      panel.classList.add('sp-mobile');
      panel.style.left = ''; panel.style.top = '';
      panel.style.width = ''; panel.style.height = '';
      return;
    }
    panel.classList.remove('sp-mobile');
    panel.style.left = SP.rect.x + 'px';
    panel.style.top = SP.rect.y + 'px';
    panel.style.width = SP.rect.w + 'px';
    panel.style.height = SP.rect.h + 'px';
  }

  // Keep the window reachable when the browser window changes size.
  global.addEventListener('resize', function () {
    if (SP.open && SP.rect) {
      SP.rect = supClampRect(SP.rect, vp());
      applyRect();
    }
  });

  function focusFirstField() {
    setTimeout(function () {
      var target = SP.view === 'new' ? el('sp-r-type') : el('sp-mine-body');
      if (target) { try { target.focus(); } catch (e) { /* detached */ } }
    }, 180);
  }

  // ── Public API ───────────────────────────────────────────────────────────
  var SupportPop = {
    open: function (view, ticketId) {
      var firstOpen = !panel;
      if (!panel) buildPanel();
      if (firstOpen) resetForm(null);
      if (!SP.rect) SP.rect = loadRect() || supDefaultRect(vp());
      SP.open = true;
      panel.classList.add('sp-show');
      applyRect();
      saveRect();
      setView(view || SP.view, ticketId);
      focusFirstField();
    },
    close: function () {
      stopVoice(); // closing the window always ends dictation
      SP.open = false;
      if (panel) panel.classList.remove('sp-show');
      saveRect();
      var launcher = document.getElementById('tab-support-pop');
      if (launcher) { try { launcher.focus(); } catch (e) { /* hidden */ } }
    },
    toggle: function () {
      if (SP.open) SupportPop.close(); else SupportPop.open();
    },
    // OpalSupport bridge — same prefill contract as the legacy report modal:
    // { type, title, technicalContext }.
    openReport: function (prefill) {
      if (!panel) buildPanel();
      resetForm(prefill || null);
      SupportPop.open('new');
    },
    openMyTickets: function (ticketId) {
      SupportPop.open('mine', ticketId || null);
    },
    _state: SP,
  };
  global.SupportPop = SupportPop;

})(typeof window !== 'undefined' ? window : null);
