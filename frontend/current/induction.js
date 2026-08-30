/* ═══════════════════════════════════════════════════════════════════════════
   OPAL PORTAL INDUCTION — INTERACTIVE TUTORIAL ENGINE

   Runs the step definitions in induction-modules.js as guided, resumable
   walkthroughs over the live portal. One overlay, many modules.

   Conventions (mirrors resourcehub.js / opa.js / supportpop.js):
     - single IIFE, string-built HTML, esc() on EVERY dynamic value
     - the overlay lives in its OWN root (#ind-layer) appended to <body> —
       never inside #rh2-root or any view that re-renders itself
     - progress is server-persisted (/api/tutorials/*) with a localStorage
       mirror so a dropped request never loses the user's place; read_only
       accounts are write-blocked server-wide, so they run on the mirror
     - anchors resolve like the help tours: [data-help="…"] first, then #id,
       then querySelector; a missing anchor degrades to a plain explanation
       card (with the step's screenshot when one exists) — never a crash
     - navigation goes through the app's own functions (OpalNav.go /
       switchTab), so RBAC, lazy loaders and history stay correct
     - pure helpers are exported for Node unit tests (see bottom)
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

(function (global) {

  // ── Pure helpers (exported for tests; no DOM access) ──────────────────────

  function indEsc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** Escape-first mini formatter: **bold** + blank-line paragraphs only. */
  function indFormat(text) {
    if (!text) return '';
    var paras = indEsc(String(text).replace(/\r\n?/g, '\n')).split(/\n{2,}/);
    return paras.map(function (p) {
      return '<p>' + p.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }

  /**
   * Place the step card near a spotlight rect without covering it.
   * Pure geometry: prefers below, then above, then right, then left;
   * always clamped inside the viewport. Returns {top,left,placement}.
   */
  function indPlaceCard(rect, cardW, cardH, vw, vh, margin) {
    var m = margin == null ? 14 : margin;
    var top, left, placement;
    if (rect.bottom + cardH + m <= vh) {
      placement = 'below';
      top = rect.bottom + m;
      left = Math.max(m, Math.min(rect.left, vw - cardW - m));
    } else if (rect.top - cardH - m >= 0) {
      placement = 'above';
      top = rect.top - cardH - m;
      left = Math.max(m, Math.min(rect.left, vw - cardW - m));
    } else if (rect.right + cardW + m <= vw) {
      placement = 'right';
      left = rect.right + m;
      top = Math.max(m, Math.min(rect.top, vh - cardH - m));
    } else if (rect.left - cardW - m >= 0) {
      placement = 'left';
      left = rect.left - cardW - m;
      top = Math.max(m, Math.min(rect.top, vh - cardH - m));
    } else {
      placement = 'center';
      left = Math.max(m, (vw - cardW) / 2);
      top = Math.max(m, (vh - cardH) / 2);
    }
    return { top: Math.round(top), left: Math.round(left), placement: placement };
  }

  /**
   * The four shade rectangles around a spotlight hole (pure).
   * hole/viewport: {top,left,width,height} in px. Empty hole → one full shade.
   */
  function indShadeRects(hole, vw, vh) {
    if (!hole) return [{ top: 0, left: 0, width: vw, height: vh }];
    var t = Math.max(0, hole.top), l = Math.max(0, hole.left);
    var b = Math.min(vh, hole.top + hole.height), r = Math.min(vw, hole.left + hole.width);
    return [
      { top: 0, left: 0, width: vw, height: t },                       // above
      { top: t, left: 0, width: l, height: Math.max(0, b - t) },       // left
      { top: t, left: r, width: Math.max(0, vw - r), height: Math.max(0, b - t) }, // right
      { top: b, left: 0, width: vw, height: Math.max(0, vh - b) },     // below
    ];
  }

  /** Overall induction progress for a role: {done,total,percent,nextKey}. */
  function indSummary(modules, role, progressByKey, moduleState) {
    var mods = modules.filter(function (m) { return m.roles.indexOf(String(role || '')) !== -1; });
    var done = 0, nextKey = null, nextInProgress = null;
    mods.forEach(function (m) {
      var st = moduleState(m, progressByKey[m.key]);
      if (st === 'completed' || st === 'updated') done++;
      else if (st === 'in_progress' && !nextInProgress) nextInProgress = m.key;
      else if (st === 'not_started' && !nextKey) nextKey = m.key;
    });
    return {
      done: done,
      total: mods.length,
      percent: mods.length ? Math.round(done / mods.length * 100) : 0,
      nextKey: nextInProgress || nextKey,
    };
  }

  // ── Environment guard: everything below needs a browser ───────────────────

  var doc = global && global.document;

  // Node/test export of the pure surface happens whether or not a DOM exists.
  var pureApi = {
    indEsc: indEsc,
    indFormat: indFormat,
    indPlaceCard: indPlaceCard,
    indShadeRects: indShadeRects,
    indSummary: indSummary,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = pureApi;
  if (!doc) return;

  var MODS = global.OpalInductionModules;
  if (!MODS) return; // definitions failed to load — engine stays dormant

  /**
   * ── The catalogue ────────────────────────────────────────────────────────
   * The bundled registry above is now the FALLBACK, not the source of truth.
   * The authored catalogue lives in the database (migration 045) and arrives
   * from /api/tutorials/catalogue, already narrowed to this role — so the
   * engine renders exactly what the server would validate a completion
   * against, and an Owner's edit reaches every learner without a deploy.
   *
   * If the fetch fails or returns nothing, MODS stays as the shipped
   * registry: an induction that still works offline beats a blank dashboard.
   */
  function serverCatalogue(mods) {
    var byKey = {};
    mods.forEach(function (m) { byKey[m.key] = m; });
    return {
      MODULES: mods,
      moduleByKey: function (k) { return byKey[String(k || '')] || null; },
      modulesForRole: function (r) {
        var rr = String(r || '');
        return mods.filter(function (m) { return (m.roles || []).indexOf(rr) !== -1; });
      },
      // The server already applied per-step role gating, so this is identity
      // over the delivered steps rather than a second filter — the signature
      // is kept so every call site reads the same either way.
      stepsForRole: function (mod) { return (mod && mod.steps) || []; },
      moduleState: MODS.moduleState,
    };
  }

  var catalogueAsked = false;
  function loadCatalogue() {
    if (catalogueAsked) return Promise.resolve(MODS);
    catalogueAsked = true;
    return api('/api/tutorials/catalogue').then(function (d) {
      var mods = d && d.ok && d.modules;
      if (!mods || !mods.length) return MODS;
      MODS = serverCatalogue(mods);
      // A dashboard painted from the bundled registry is now stale.
      progressChanged();
      return MODS;
    }).catch(function () { return MODS; });
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  function user() { return global.APP_USER || {}; }
  function role() { return String(user().role || ''); }
  function toast(title, msg, kind) {
    if (typeof global.showToast === 'function') global.showToast(title, msg || '', kind);
  }
  function reducedMotion() {
    try { return global.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { return false; }
  }

  async function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', credentials: 'include', headers: {} };
    if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    if (opts.keepalive) init.keepalive = true;
    try {
      var r = await fetch(path, init);
      var data = await r.json().catch(function () { return {}; });
      if (!r.ok) return { ok: false, status: r.status, error: data.message || data.error || ('Request failed (' + r.status + ')') };
      data.ok = true;
      return data;
    } catch (e) {
      return { ok: false, status: 0, error: 'network' };
    }
  }

  // ── Progress store (server + localStorage mirror) ─────────────────────────

  var LS_KEY = 'opal_induction_progress_v1';

  var P = {
    loaded: false,
    loading: null,      // in-flight promise
    serverWrites: true, // flips false on 403 (read_only) — mirror-only mode
    byKey: {},          // tutorial_key → progress row
  };

  function lsAll() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { return {}; }
  }
  function lsMine() {
    var all = lsAll();
    return all[String(user().id || '')] || {};
  }
  function lsSave(row) {
    try {
      var all = lsAll();
      var uid = String(user().id || '');
      if (!uid) return;
      (all[uid] = all[uid] || {})[row.tutorial_key] = row;
      localStorage.setItem(LS_KEY, JSON.stringify(all));
    } catch (e) { /* storage unavailable — server copy still holds */ }
  }

  /** Server rows win; mirror fills gaps (offline writes, read_only). */
  function mergeProgress(serverRows, mirrorRows) {
    var out = {};
    Object.keys(mirrorRows || {}).forEach(function (k) { out[k] = mirrorRows[k]; });
    (serverRows || []).forEach(function (r) { out[r.tutorial_key] = r; });
    return out;
  }

  function loadProgress(force) {
    if (P.loaded && !force) return Promise.resolve(P.byKey);
    if (P.loading) return P.loading;
    P.loading = api('/api/tutorials/progress').then(function (d) {
      P.byKey = mergeProgress(d.ok ? (d.progress || []) : [], lsMine());
      P.loaded = true;
      P.loading = null;
      // A dashboard rendered before this resolved is showing stale state —
      // tell it (the hub re-renders My Learning / Home on this event).
      progressChanged();
      return P.byKey;
    });
    return P.loading;
  }

  function progressChanged(detail) {
    // detail is only ever set for a preview run's close/finish — real progress
    // events stay bare, and listeners that ignore detail keep working.
    try { doc.dispatchEvent(new CustomEvent('induction:progress', detail ? { detail: detail } : undefined)); } catch (e) { /* old browser */ }
  }

  var saveTimer = null;
  function scheduleSave(key, patch, immediate) {
    var mod = MODS.moduleByKey(key);
    if (!mod) return;
    var row = P.byKey[key] || {
      tutorial_key: key, version: mod.version, status: 'in_progress',
      current_step: 0, furthest_step: 0,
      started_at: new Date().toISOString(),
    };
    Object.keys(patch).forEach(function (k) { row[k] = patch[k]; });
    row.version = row.status === 'completed' ? row.version : mod.version;
    row.last_viewed_at = new Date().toISOString();
    row.furthest_step = Math.max(row.furthest_step || 0, row.current_step || 0);
    P.byKey[key] = row;
    lsSave(row);

    if (saveTimer) clearTimeout(saveTimer);
    var push = function () {
      saveTimer = null;
      if (!P.serverWrites) return;
      api('/api/tutorials/' + encodeURIComponent(key) + '/progress', {
        method: 'PUT', keepalive: !!immediate,
        body: {
          version: mod.version,
          step: row.current_step,
          stepCount: MODS.stepsForRole(mod, role()).length,
        },
      }).then(function (d) {
        if (!d.ok && d.status === 403) P.serverWrites = false; // read_only
      });
    };
    if (immediate) push(); else saveTimer = setTimeout(push, 400);
  }

  // ── Anchor resolution ─────────────────────────────────────────────────────

  function resolveEl(sel) {
    if (!sel) return null;
    var el = null;
    if (sel.charAt(0) !== '#' && sel.charAt(0) !== '.' && sel.indexOf('[') === -1) {
      el = doc.querySelector('[data-help="' + sel + '"]');
      if (!el) el = doc.getElementById(sel);
    }
    if (!el) { try { el = doc.querySelector(sel); } catch (e) { el = null; } }
    return el;
  }

  function isVisible(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return false;
    // A closed slide-over keeps its children sized but parked past the
    // viewport's horizontal edge (translateX/fixed off-canvas) — sized yet
    // unreachable, and scrollIntoView cannot help because the page never
    // scrolls horizontally. Vertical off-screen is fine: showStep scrolls.
    // A zero-width viewport (hidden/backgrounded window) makes the check
    // meaningless — treat everything as reachable rather than degrade.
    var vw = global.innerWidth;
    if (vw > 0 && (r.right <= 4 || r.left >= vw - 4)) return false;
    return true;
  }

  /** Poll until fn() is truthy or timeout; resolves the value or null. */
  function waitFor(fn, timeoutMs) {
    return new Promise(function (resolve) {
      var t0 = Date.now();
      (function tick() {
        var v = fn();
        if (v) return resolve(v);
        if (Date.now() - t0 > (timeoutMs || 2500)) return resolve(null);
        setTimeout(tick, 120);
      })();
    });
  }

  function currentTab() {
    var active = doc.querySelector('.tab.active[data-tab]');
    return active ? active.dataset.tab : null;
  }

  /**
   * Containers a step can declare it lives in (route.open). All idempotent,
   * all typeof-guarded: opening an already-open surface is a no-op, and a
   * missing function simply leaves the step to its fallback.
   */
  var OPENERS = {
    booking: function () { if (typeof global.openBookingPanel === 'function') global.openBookingPanel(); },
    notifications: function () { if (typeof global.openNotificationsPanel === 'function') global.openNotificationsPanel(); },
    opa: function () { if (global.Opa && typeof global.Opa.open === 'function') global.Opa.open(); },
    'invite-modal': function () { if (typeof global.showInviteModal === 'function') global.showInviteModal(); },
  };

  /** Navigate for a step through the app's own machinery. */
  function navigateTo(route) {
    if (!route) return;
    if (route.tab && (currentTab() !== route.tab || route.view)) {
      global.__viewManuallySet = true; // saved default calendar view must not stomp us
      if (global.OpalNav && typeof global.OpalNav.go === 'function') {
        global.OpalNav.go({ tab: route.tab, view: route.view || null });
      } else if (typeof global.switchTab === 'function') {
        global.switchTab(route.tab);
      }
    }
    // Deeper context the router does not address. Settings sections: the
    // Integrations rows only exist once their section is shown. Calendar
    // mode: switchTab('master') is DENIED by the nav guard — the supported
    // programmatic entry is setCalendarMode('master').
    if (route.section && typeof global.showSettingsSection === 'function') {
      setTimeout(function () { try { global.showSettingsSection(route.section); } catch (e) { /* absent */ } }, 60);
    }
    if (route.calendarMode && typeof global.setCalendarMode === 'function') {
      setTimeout(function () {
        try {
          if (global.__calendarMode !== route.calendarMode) global.setCalendarMode(route.calendarMode);
        } catch (e) { /* mode unavailable for role */ }
      }, 60);
    }
    if (route.open && OPENERS[route.open]) {
      setTimeout(function () { try { OPENERS[route.open](); } catch (e) { /* surface absent */ } }, 120);
    }
  }

  /**
   * Establish the context a (re)started module expects: the module's start
   * route, plus — when resuming mid-module — the most recent step route at
   * or before the resume point, so a step without its own route still finds
   * the screen its neighbours put the user on.
   */
  function applyStartContext(mod, steps, resumeAt) {
    if (mod.start && mod.start.closeOpaPanel && resumeAt === 0 &&
        global.Opa && typeof global.Opa.close === 'function') {
      try { global.Opa.close(); } catch (e) { /* panel not built yet */ }
    }
    var route = mod.start ? { tab: mod.start.tab, view: mod.start.view, section: mod.start.section, calendarMode: mod.start.calendarMode } : null;
    for (var i = 0; i <= resumeAt && i < steps.length; i++) {
      if (steps[i].route) route = steps[i].route;
    }
    if (route) navigateTo(route);
  }

  // ── Engine state ──────────────────────────────────────────────────────────

  var S = {
    active: false,
    key: null,
    mod: null,
    steps: [],
    idx: 0,
    el: null,           // resolved target of the current step (or null)
    fallback: false,    // current step degraded (anchor missing)
    quiz: {},           // per-step quiz state: idx → {chosen, checked, correct}
    ack: {},            // per-step acknowledgement state: idx → true once signed
    clickHandler: null, // advance-on-click listener to detach
    lastFocus: null,    // element to restore focus to on close
    preview: false,     // preview run: full walkthrough, nothing persisted
  };

  // ── Overlay DOM ───────────────────────────────────────────────────────────

  function layer() { return doc.getElementById('ind-layer'); }

  function ensureLayer() {
    var host = layer();
    if (host) return host;
    host = doc.createElement('div');
    host.id = 'ind-layer';
    host.innerHTML =
      '<div class="ind-shade" data-ind-shade="0"></div>' +
      '<div class="ind-shade" data-ind-shade="1"></div>' +
      '<div class="ind-shade" data-ind-shade="2"></div>' +
      '<div class="ind-shade" data-ind-shade="3"></div>' +
      '<div class="ind-ring" id="ind-ring" aria-hidden="true"></div>' +
      '<section class="ind-card" id="ind-card" role="dialog" aria-labelledby="ind-title" aria-describedby="ind-body" tabindex="-1"></section>';
    doc.body.appendChild(host);
    return host;
  }

  function removeLayer() {
    var host = layer();
    if (host) host.parentNode.removeChild(host);
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  function stepCounterText() {
    return 'Step ' + (S.idx + 1) + ' of ' + S.steps.length;
  }

  function renderCard() {
    var card = doc.getElementById('ind-card');
    if (!card) return;
    var step = S.steps[S.idx];
    if (!step) return;
    var mod = S.mod;
    var isFirst = S.idx === 0;
    var isLast = S.idx === S.steps.length - 1;
    var q = S.quiz[S.idx] || {};

    var html = '<header class="ind-head">' +
      '<div class="ind-head-meta">' +
      '<span class="ind-module">' + indEsc(mod.title) + '</span>' +
      '<span class="ind-counter" aria-live="polite">' + indEsc(stepCounterText()) + '</span>' +
      '</div>' +
      '<button type="button" class="ind-x" onclick="OpalInduction.close()" aria-label="' +
      (S.preview ? 'Close the walkthrough preview' : 'Save my place and close the walkthrough') + '">&times;</button>' +
      '<div class="ind-bar" role="progressbar" aria-valuemin="0" aria-valuemax="' + S.steps.length + '" aria-valuenow="' + (S.idx + 1) + '" aria-label="Walkthrough progress">' +
      '<span style="width:' + Math.round((S.idx + 1) / S.steps.length * 100) + '%"></span></div>' +
      '</header>';

    if (step.type === 'warning') {
      html += '<div class="ind-flag ind-flag-warn">Take care</div>';
    } else if (S.fallback) {
      html += '<div class="ind-flag">This control isn’t on screen right now — here’s what it does.</div>';
    }

    html += '<h2 id="ind-title" class="ind-title">' + indEsc(step.title || '') + '</h2>';

    if ((step.type === 'screenshot' || S.fallback) && step.image && step.image.src) {
      // The image is also a link to itself: dense screenshots (the Splose
      // lessons especially) deserve a full-size view, and a new tab keeps the
      // walkthrough's place intact.
      html += '<figure class="ind-fig">' +
        '<a class="ind-fig-link" href="' + indEsc(step.image.src) + '" target="_blank" rel="noopener" ' +
        'aria-label="Open the full-size screenshot in a new tab">' +
        '<img src="' + indEsc(step.image.src) + '" alt="' + indEsc(step.image.alt || '') + '" loading="lazy" ' +
        'onerror="this.closest(\'figure\').classList.add(\'ind-fig-broken\');' +
        'var a=this.closest(\'a\');if(a){a.removeAttribute(\'href\');a.tabIndex=-1;}">' +
        '</a>' +
        '<figcaption class="ind-fig-fallback">The picture for this step could not load — the description below still applies.</figcaption>' +
        '</figure>';
    }

    html += '<div id="ind-body" class="ind-body">' + indFormat(step.body || '') + '</div>';

    if (step.type === 'acknowledgement') {
      html += '<div class="ind-ack">' +
        '<p class="ind-ack-statement">' + indEsc(step.ack_statement || '') + '</p>' +
        '<label class="ind-ack-check"><input type="checkbox"' + (S.ack[S.idx] ? ' checked disabled' : '') +
        ' onchange="OpalInduction._ackSign(this.checked)"> I have read and understood this.</label>' +
        (S.ack[S.idx] ? '<p class="ind-q-explain ok" role="status">Recorded.</p>' : '') +
        '</div>';
    }

    if ((step.type === 'quiz' || step.type === 'checkpoint') && step.quiz) {
      var qz = step.quiz;
      html += '<fieldset class="ind-quiz"><legend>' + indEsc(qz.question) + '</legend>';
      (qz.options || []).forEach(function (opt, j) {
        var id = 'ind-q-' + j;
        var cls = '';
        if (q.checked && q.chosen === j) cls = q.correct ? ' ind-q-right' : ' ind-q-wrong';
        html += '<div class="ind-q-opt' + cls + '">' +
          '<input type="radio" name="ind-quiz" id="' + id + '" value="' + j + '"' +
          (q.chosen === j ? ' checked' : '') + ' onchange="OpalInduction._quizPick(' + j + ')">' +
          '<label for="' + id + '">' + indEsc(opt) + '</label></div>';
      });
      html += '</fieldset>';
      if (q.checked) {
        // A checkpoint's explanation comes back from the server with the
        // verdict, because the answer itself never reached the browser.
        var explain = step.type === 'checkpoint' ? (q.explain || '') : (qz.explain || '');
        html += '<p class="ind-q-explain ' + (q.correct ? 'ok' : 'no') + '" role="status">' +
          (q.correct ? 'Correct. ' : 'Not quite — try again. ') + indEsc(explain) + '</p>';
      }
    }

    if (step.type === 'action' && !S.fallback) {
      html += '<p class="ind-try" role="status">Try it now — or use Next to move on.</p>';
    }

    // Footer
    html += '<footer class="ind-foot">';
    html += '<button type="button" class="ind-btn ind-btn-quiet" onclick="OpalInduction.prev()"' + (isFirst ? ' disabled' : '') + '>Back</button>';
    html += '<span class="ind-foot-spring"></span>';
    if (step.type === 'checkpoint' && !(q.checked && q.correct)) {
      // No Skip: a checkpoint is the one step a learner cannot page past.
      html += '<button type="button" class="ind-btn ind-btn-primary" onclick="OpalInduction._quizCheck()"' +
        (q.chosen == null || q.pending ? ' disabled' : '') + '>' +
        (q.pending ? 'Checking…' : 'Check answer') + '</button>';
    } else if (step.type === 'quiz' && !q.checked) {
      html += '<button type="button" class="ind-btn" onclick="OpalInduction.next()">Skip</button>';
      html += '<button type="button" class="ind-btn ind-btn-primary" onclick="OpalInduction._quizCheck()"' + (q.chosen == null ? ' disabled' : '') + '>Check answer</button>';
    } else if (step.type === 'acknowledgement' && !S.ack[S.idx]) {
      html += '<button type="button" class="ind-btn ind-btn-primary" disabled>Next</button>';
    } else if (isLast) {
      html += '<button type="button" class="ind-btn ind-btn-primary" onclick="OpalInduction.finish()">Finish module</button>';
    } else {
      html += '<button type="button" class="ind-btn ind-btn-primary" onclick="OpalInduction.next()">Next</button>';
    }
    html += '</footer>';

    card.innerHTML = html;
  }

  function positionOverlay() {
    var host = layer();
    if (!host || !S.active) return;
    var step = S.steps[S.idx];
    var card = doc.getElementById('ind-card');
    var ring = doc.getElementById('ind-ring');
    var vw = global.innerWidth, vh = global.innerHeight;
    var pad = step && step.pad != null ? step.pad : 6;

    var hole = null;
    if (S.el && isVisible(S.el) && !S.fallback) {
      var r = S.el.getBoundingClientRect();
      hole = { top: r.top - pad, left: r.left - pad, width: r.width + pad * 2, height: r.height + pad * 2 };
    }

    var shades = indShadeRects(hole, vw, vh);
    for (var i = 0; i < 4; i++) {
      var sh = host.querySelector('[data-ind-shade="' + i + '"]');
      var rect = shades[i] || { top: 0, left: 0, width: 0, height: 0 };
      sh.style.top = rect.top + 'px';
      sh.style.left = rect.left + 'px';
      sh.style.width = rect.width + 'px';
      sh.style.height = rect.height + 'px';
      // During an interactive try-it step the page stays clickable.
      sh.style.pointerEvents = (step && step.type === 'action') ? 'none' : 'auto';
    }

    if (hole && ring) {
      ring.style.display = 'block';
      ring.style.top = hole.top + 'px';
      ring.style.left = hole.left + 'px';
      ring.style.width = hole.width + 'px';
      ring.style.height = hole.height + 'px';
      ring.style.borderRadius = (step && step.rounded) || '8px';
    } else if (ring) {
      ring.style.display = 'none';
    }

    if (card) {
      var cw = card.offsetWidth || 380, ch = card.offsetHeight || 240;
      if (hole) {
        var pos = indPlaceCard(
          { top: hole.top, left: hole.left, right: hole.left + hole.width, bottom: hole.top + hole.height },
          cw, ch, vw, vh
        );
        card.style.top = pos.top + 'px';
        card.style.left = pos.left + 'px';
        card.style.transform = '';
      } else {
        card.style.top = '50%';
        card.style.left = '50%';
        card.style.transform = 'translate(-50%,-50%)';
      }
    }
  }

  // Reposition while active: resize, scroll, and DOM churn (e.g. #rh2-root
  // re-rendering under the overlay replaces the anchored element).
  var repositionScheduled = false;
  function scheduleReposition() {
    if (!S.active || repositionScheduled) return;
    repositionScheduled = true;
    requestAnimationFrame(function () {
      repositionScheduled = false;
      var step = S.steps[S.idx];
      if (step && step.target && (!S.el || !doc.contains(S.el))) {
        var el = resolveEl(step.target);
        if (el && isVisible(el)) { S.el = el; attachAdvanceClick(step); }
      }
      // Self-healing degradation: a step that fell back because its anchor
      // was mid-transition (a panel still sliding in) upgrades to a live
      // highlight the moment the anchor becomes teachable.
      if (step && S.fallback && (step.type === 'highlight' || step.type === 'action')) {
        var healed = resolveEl(step.target);
        if (healed && isVisible(healed)) {
          S.el = healed;
          S.fallback = false;
          renderCard();
          attachAdvanceClick(step);
        }
      }
      positionOverlay();
    });
  }
  var mo = null;
  function watchDom(on) {
    if (on && !mo) {
      mo = new MutationObserver(scheduleReposition);
      mo.observe(doc.body, { childList: true, subtree: true });
      global.addEventListener('resize', scheduleReposition, true);
      global.addEventListener('scroll', scheduleReposition, true);
    } else if (!on && mo) {
      mo.disconnect(); mo = null;
      global.removeEventListener('resize', scheduleReposition, true);
      global.removeEventListener('scroll', scheduleReposition, true);
    }
  }

  function attachAdvanceClick(step) {
    detachAdvanceClick();
    if (!step || step.type !== 'action' || step.advance !== 'click' || !S.el) return;
    var handler = function () { setTimeout(function () { if (S.active) next(); }, 250); };
    S.el.addEventListener('click', handler, { once: true });
    S.clickHandler = { el: S.el, fn: handler };
  }
  function detachAdvanceClick() {
    if (S.clickHandler) {
      try { S.clickHandler.el.removeEventListener('click', S.clickHandler.fn); } catch (e) { /* gone */ }
      S.clickHandler = null;
    }
  }

  // ── Step lifecycle ────────────────────────────────────────────────────────

  async function showStep(idx, direction) {
    if (!S.active) return;
    S.idx = Math.max(0, Math.min(idx, S.steps.length - 1));
    var step = S.steps[S.idx];
    S.el = null;
    S.fallback = false;
    detachAdvanceClick();

    // 1. Navigate where the step lives.
    if (step.route) navigateTo(step.route);

    // 2. Targets inside the collapsed "More" menu need it open.
    if (step.menu && typeof global.toggleNavMoreMenu === 'function') {
      try { global.toggleNavMoreMenu(true); } catch (e) { /* menu absent for role */ }
    }

    // 3. Resolve the anchor (with patience for lazy renders).
    if (step.target && (step.type === 'highlight' || step.type === 'action')) {
      S.el = await waitFor(function () {
        var el = resolveEl(step.target);
        return el && isVisible(el) ? el : null;
      }, 2600);
      if (!S.el) {
        // Graceful degradation: keep teaching with words/screenshot. A CSS
        // transition mutates nothing, so also recheck once shortly after —
        // the self-heal in scheduleReposition upgrades the step if the
        // anchor finished sliding in.
        S.fallback = true;
        setTimeout(scheduleReposition, 1200);
        try {
          console.info('[induction] anchor unavailable — degraded step', S.key, S.idx, step.target);
        } catch (e) { /* console absent */ }
      }
    }

    if (!S.active) return; // closed while waiting

    // 4. Paint.
    renderCard();
    positionOverlay();
    // The workshop dock follows the player: which step, and whether its
    // anchor actually resolved — the honest signal that a target has drifted.
    try {
      doc.dispatchEvent(new CustomEvent('induction:step', { detail: {
        key: S.key, index: S.idx, total: S.steps.length,
        target: step.target || null, resolved: !!(S.el && !S.fallback),
      } }));
    } catch (e) { /* old browser */ }
    if (S.el && !S.fallback) {
      try { S.el.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'nearest' }); } catch (e) { /* ok */ }
      setTimeout(positionOverlay, reducedMotion() ? 0 : 320);
    }
    attachAdvanceClick(step);

    // 5. Focus the card so keyboard users land on the controls.
    var card = doc.getElementById('ind-card');
    if (card) card.focus({ preventScroll: true });

    // 6. Persist the position (a preview run leaves no trace).
    if (!S.preview) scheduleSave(S.key, { current_step: S.idx, status: 'in_progress' });
  }

  /** A blocking step (checkpoint, sign-here) holds the learner where they are
   *  until it is satisfied. The server is the real gate for a checkpoint —
   *  this is the honest UI in front of it. */
  function blocked() {
    var step = S.steps[S.idx];
    if (!step) return false;
    if (step.type === 'checkpoint') {
      var q = S.quiz[S.idx];
      return !(q && q.checked && q.correct);
    }
    if (step.type === 'acknowledgement') return !S.ack[S.idx];
    return false;
  }

  function next() {
    if (!S.active) return;
    if (blocked()) return;
    if (S.idx >= S.steps.length - 1) return finish();
    showStep(S.idx + 1, 1);
  }
  function prev() {
    if (!S.active) return;
    if (S.idx > 0) showStep(S.idx - 1, -1);
  }

  /**
   * opts:
   *   preview  — show it as a first-timer sees it, saving nothing
   *   restart  — ignore the saved place
   *   module   — play THIS module object instead of looking the key up. The
   *              workshop passes an unsaved draft so an author can watch an
   *              edit run before publishing it. Always a preview, and always
   *              role-ungated: the author is watching, not taking, the module.
   *   at       — start at this step index (the workshop's "play from here")
   */
  async function start(key, opts) {
    opts = opts || {};
    var authored = opts.module || null;
    if (authored) opts = Object.assign({}, opts, { preview: true, restart: true });

    var mod = authored || MODS.moduleByKey(key);
    if (!mod) { toast('Tutorial unavailable', 'This module could not be found.'); return; }
    if (!authored && mod.roles.indexOf(role()) === -1) {
      toast('Not available for your role', 'This module covers tools your account does not use.');
      return;
    }
    var steps = authored ? (mod.steps || []) : MODS.stepsForRole(mod, role());
    if (!steps.length) { toast('Coming soon', 'This module has no content yet.'); return; }

    await loadProgress();
    if (S.active) closeOverlay(false);

    S.active = true;
    S.key = key;
    S.mod = mod;
    S.steps = steps;
    S.quiz = {};
    S.ack = {};
    S.lastFocus = doc.activeElement;
    S.preview = !!opts.preview;

    // A preview run shows the module as a first-timer sees it: no resume, no
    // saved place touched, nothing written — not even for the previewer.
    var row = S.preview ? null : P.byKey[key];
    var resumeAt = 0;
    if (!opts.restart && row && row.status === 'in_progress' &&
        Number(row.version) === Number(mod.version)) {
      resumeAt = Math.min(Number(row.current_step) || 0, steps.length - 1);
    }
    // A definition that changed under an in-progress user starts over —
    // the remembered step number no longer means the same thing.
    if (row && row.status === 'in_progress' && Number(row.version) !== Number(mod.version) && !opts.restart) {
      toast('This tutorial was updated', 'It starts from the beginning so nothing is missed.');
    }

    if (typeof opts.at === 'number') {
      resumeAt = Math.max(0, Math.min(Math.round(opts.at), steps.length - 1));
    }

    ensureLayer();
    watchDom(true);
    doc.body.classList.add('ind-open');
    applyStartContext(mod, steps, resumeAt);
    showStep(resumeAt, 0);
  }

  function closeOverlay(restoreFocus) {
    S.active = false;
    detachAdvanceClick();
    watchDom(false);
    removeLayer();
    doc.body.classList.remove('ind-open');
    if (restoreFocus && S.lastFocus && doc.contains(S.lastFocus)) {
      try { S.lastFocus.focus(); } catch (e) { /* ok */ }
    }
    S.key = null; S.mod = null; S.steps = []; S.el = null; S.preview = false;
  }

  /** Pause: keep the saved place, close cleanly. A preview pause has no place
   *  to keep — it only hands control back to whoever launched it. */
  function close() {
    if (!S.active) return;
    if (S.preview) {
      var pkey = S.key;
      closeOverlay(true);
      progressChanged({ preview: true, key: pkey, finished: false });
      return;
    }
    scheduleSave(S.key, { current_step: S.idx, status: 'in_progress' }, true);
    var title = S.mod ? S.mod.title : '';
    closeOverlay(true);
    toast('Progress saved', title ? ('Continue "' + title + '" any time from the Resource Hub.') : '');
    progressChanged();
  }

  async function finish() {
    if (!S.active) return;
    var key = S.key, mod = S.mod, preview = S.preview;
    closeOverlay(true);

    if (preview) {
      // A finished preview records nothing anywhere; the launcher is told so
      // its own unsaved tick can reflect the finish.
      progressChanged({ preview: true, key: key, finished: true });
      return;
    }

    var row = P.byKey[key] || { tutorial_key: key };
    row.status = 'completed';
    row.version = mod.version;
    row.completed_version = mod.version;
    row.current_step = 0;
    row.completed_at = new Date().toISOString();
    P.byKey[key] = row;
    lsSave(row);
    progressChanged();

    if (P.serverWrites) {
      var d = await api('/api/tutorials/' + encodeURIComponent(key) + '/complete', {
        method: 'POST', body: { version: mod.version },
      });
      if (!d.ok && d.status === 403) P.serverWrites = false;
    }
    toast('Module complete', '"' + mod.title + '" is done — nice work.');
    progressChanged();
  }

  async function restart(key) {
    var mod = MODS.moduleByKey(key);
    if (!mod) return;
    var row = P.byKey[key];
    if (row) {
      row.status = 'in_progress';
      row.current_step = 0;
      row.furthest_step = 0;
      row.version = mod.version;
      lsSave(row);
    }
    if (P.serverWrites) {
      api('/api/tutorials/' + encodeURIComponent(key) + '/restart', { method: 'POST' });
    }
    progressChanged();
    start(key, { restart: true });
  }

  // ── Quiz interactions ─────────────────────────────────────────────────────

  function _quizPick(j) {
    var q = S.quiz[S.idx] = S.quiz[S.idx] || {};
    if (q.checked && q.correct) return;
    q.chosen = j;
    q.checked = false;
    renderCard();
    positionOverlay();
  }
  async function _quizCheck() {
    var step = S.steps[S.idx];
    var q = S.quiz[S.idx];
    if (!step || !step.quiz || !q || q.chosen == null || q.pending) return;

    if (step.type === 'checkpoint') {
      // The answer is not in the payload — ask the server. A preview grades
      // nothing and records nothing, so it simply lets the author through.
      if (S.preview) {
        q.checked = true; q.correct = true; q.explain = '';
      } else {
        q.pending = true;
        renderCard();
        var idx = S.idx, chosen = q.chosen;
        var d = await api('/api/tutorials/' + encodeURIComponent(S.key) + '/evidence', {
          method: 'POST', body: { stepKey: step.key, chosen: chosen },
        });
        if (S.idx !== idx || !S.active) return; // moved on while waiting
        q.pending = false;
        if (!d.ok) {
          toast('Could not check that', 'The answer could not be checked just now — try again.', 'error');
          renderCard();
          return;
        }
        // api() flattens the payload onto the result and adds .ok — there is
        // no nested data object here.
        q.checked = true;
        q.correct = !!d.passed;
        q.explain = d.explain || '';
        if (!q.correct) q.chosen = null; // make them choose again, deliberately
      }
    } else {
      q.checked = true;
      q.correct = q.chosen === step.quiz.correctIndex;
    }

    renderCard();
    positionOverlay();
    var card = doc.getElementById('ind-card');
    if (card) card.focus({ preventScroll: true });
  }

  /** Sign a statement inside the walkthrough. Recorded server-side against
   *  the PUBLISHED wording — the browser's copy is never what is stored. */
  async function _ackSign(on) {
    if (!on) return;
    var step = S.steps[S.idx];
    if (!step || step.type !== 'acknowledgement') return;
    if (!S.preview) {
      var idx = S.idx;
      var d = await api('/api/tutorials/' + encodeURIComponent(S.key) + '/evidence', {
        method: 'POST', body: { stepKey: step.key, agreed: true },
      });
      if (S.idx !== idx || !S.active) return;
      if (!d.ok) {
        toast('Not recorded', 'That could not be recorded just now — try again.', 'error');
        renderCard();
        return;
      }
    }
    S.ack[S.idx] = true;
    renderCard();
    positionOverlay();
  }

  // ── Keyboard ──────────────────────────────────────────────────────────────

  doc.addEventListener('keydown', function (e) {
    if (!S.active) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowRight') {
      var step = S.steps[S.idx];
      var q = S.quiz[S.idx];
      if (step && step.type === 'quiz' && !(q && q.checked)) return; // don't skip past an unchecked quiz by accident
      if (blocked()) return; // a checkpoint or a signature is not arrow-past-able
      e.preventDefault(); next();
    }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
  });

  // ── Dashboard (rendered by the Resource Hub into My Learning) ─────────────

  var STATE_CHIP = {
    not_started: '<span class="ind-chip">Not started</span>',
    in_progress: '<span class="ind-chip ind-chip-blue">In progress</span>',
    completed: '<span class="ind-chip ind-chip-ok">Completed</span>',
    updated: '<span class="ind-chip ind-chip-warn">Updated</span>',
  };

  var dashConfirmRestart = null; // module key awaiting restart confirmation

  /**
   * The dashboard delivers the catalogue as one card per module group: the
   * portal's own walkthroughs, then the Splose induction. Groups are a
   * presentation concern only — progress, resume and completion never care
   * which group a module belongs to.
   */
  var DASH_GROUPS = [
    { key: 'portal', heading: 'Opal Portal induction',
      blurb: 'Interactive walkthroughs of the portal itself — pause any time, continue on any device.' },
    { key: 'splose', heading: 'Splose induction',
      blurb: 'How Opal uses Splose: appointments, notes, Teams and your reports — screenshot-led lessons, with your place saved as you go.' },
  ];

  function moduleGroup(m) { return m.group || 'portal'; }

  function dashboardHtml() {
    var r = role();
    if (!MODS.modulesForRole(r).length) return '';
    return DASH_GROUPS.map(dashGroupHtml).join('');
  }

  function dashGroupHtml(g) {
    var r = role();
    var mods = MODS.modulesForRole(r).filter(function (m) { return moduleGroup(m) === g.key; });
    if (!mods.length) return '';
    var groupMods = MODS.MODULES.filter(function (m) { return moduleGroup(m) === g.key; });
    var sum = indSummary(groupMods, r, P.byKey, MODS.moduleState);
    var hid = 'ind-dash-h-' + g.key;

    var out = '<section class="rh2-card ind-dash" aria-labelledby="' + hid + '">' +
      '<div class="ind-dash-head">' +
      '<div><h2 id="' + hid + '">' + indEsc(g.heading) + '</h2>' +
      '<p class="rh2-quiet">' + indEsc(g.blurb) + '</p></div>';

    if (sum.total) {
      out += '<div class="ind-dash-sum"><span class="ind-dash-count">' + sum.done + ' of ' + sum.total + '</span>' +
        '<span class="rh2-row-sub">modules complete</span></div>';
    }
    out += '</div>';
    out += '<div class="rh2-bar" role="progressbar" aria-valuenow="' + sum.percent + '" aria-valuemin="0" aria-valuemax="100" aria-label="' + indEsc(g.heading) + ' progress">' +
      '<span style="width:' + sum.percent + '%"></span></div>' +
      '<div class="rh2-row-sub" style="margin:4px 0 12px;">' + sum.percent + '% complete</div>';

    out += '<ol class="ind-dash-list">';
    mods.forEach(function (m) {
      var row = P.byKey[m.key];
      var st = MODS.moduleState(m, row);
      var steps = MODS.stepsForRole(m, r);
      var hasContent = steps.length > 0;
      var stepNote = '';
      if (st === 'in_progress' && row) {
        stepNote = 'Step ' + (Math.min(Number(row.current_step) || 0, steps.length - 1) + 1) + ' of ' + steps.length;
      }
      var actionLabel = st === 'in_progress' ? 'Continue'
        : (st === 'completed' || st === 'updated') ? 'Review' : 'Start';

      out += '<li class="ind-dash-item' + (st === 'completed' ? ' done' : '') + '">' +
        '<img class="ind-dash-thumb" src="' + indEsc(m.thumb) + '" alt="" loading="lazy" onerror="this.classList.add(\'broken\')">' +
        '<span class="ind-dash-main">' +
        '<span class="ind-dash-title">' + indEsc(m.title) + ' ' + (STATE_CHIP[st] || '') + '</span>' +
        '<span class="rh2-row-sub">' + indEsc(m.description) + '</span>' +
        '<span class="rh2-row-sub">' + m.minutes + ' min' + (stepNote ? ' · ' + indEsc(stepNote) : '') + '</span>' +
        '</span>' +
        '<span class="ind-dash-actions">';
      if (hasContent) {
        out += '<button type="button" class="rh2-btn' + (st === 'in_progress' || st === 'not_started' ? ' rh2-btn-primary' : '') + '" ' +
          'onclick="OpalInduction.start(\'' + indEsc(m.key) + '\')">' + actionLabel + '</button>';
        if (st !== 'not_started') {
          if (dashConfirmRestart === m.key) {
            out += '<span class="ind-restart-confirm">Start over? ' +
              '<button type="button" class="rh2-btn" onclick="OpalInduction.restart(\'' + indEsc(m.key) + '\')">Restart</button>' +
              '<button type="button" class="rh2-btn rh2-btn-quiet" onclick="OpalInduction._restartCancel()">Cancel</button></span>';
          } else {
            out += '<button type="button" class="rh2-btn rh2-btn-quiet" onclick="OpalInduction._restartAsk(\'' + indEsc(m.key) + '\')">Restart</button>';
          }
        }
      } else {
        out += '<span class="rh2-chip rh2-chip-quiet">Coming soon</span>';
      }
      out += '</span></li>';
    });
    out += '</ol></section>';
    return out;
  }

  /** Small "continue induction" teaser for the hub Home page. */
  function homeCardHtml() {
    var r = role();
    var mods = MODS.modulesForRole(r);
    if (!mods.length) return '';
    var sum = indSummary(MODS.MODULES, r, P.byKey, MODS.moduleState);
    if (!sum.total || sum.done >= sum.total) return '';
    var nextMod = sum.nextKey ? MODS.moduleByKey(sum.nextKey) : null;
    var row = nextMod ? P.byKey[nextMod.key] : null;
    var verb = row && row.status === 'in_progress' ? 'Continue' : 'Start';

    return '<section class="rh2-card ind-home-card" aria-labelledby="ind-home-h">' +
      '<div class="ind-dash-head"><div>' +
      '<h2 id="ind-home-h">Your induction</h2>' +
      '<p class="rh2-quiet">' + sum.done + ' of ' + sum.total + ' modules complete · ' + sum.percent + '%</p></div>' +
      (nextMod
        ? '<button type="button" class="rh2-btn rh2-btn-primary" onclick="OpalInduction.start(\'' + indEsc(nextMod.key) + '\')">' +
          verb + ': ' + indEsc(nextMod.title) + '</button>'
        : '<button type="button" class="rh2-btn rh2-btn-primary" onclick="OpalInduction.openDashboard()">Open induction</button>') +
      '</div>' +
      '<div class="rh2-bar" role="progressbar" aria-valuenow="' + sum.percent + '" aria-valuemin="0" aria-valuemax="100" aria-label="Induction progress">' +
      '<span style="width:' + sum.percent + '%"></span></div>' +
      '</section>';
  }

  function _restartAsk(key) { dashConfirmRestart = key; progressChanged(); }
  function _restartCancel() { dashConfirmRestart = null; progressChanged(); }

  function openDashboard() {
    if (global.OpalNav && typeof global.OpalNav.go === 'function') {
      global.OpalNav.go({ tab: 'resources', view: 'learning' });
    } else if (typeof global.switchTab === 'function') {
      global.switchTab('resources');
    }
  }

  /**
   * Bridge for the Resource Hub detail view: is there an interactive
   * walkthrough for this resource slug, usable by this role?
   */
  function moduleForSlug(slug) {
    var mod = MODS.moduleByKey(String(slug || ''));
    if (!mod) return null;
    if (mod.roles.indexOf(role()) === -1) return null;
    if (!MODS.stepsForRole(mod, role()).length) return null;
    return { key: mod.key, state: MODS.moduleState(mod, P.byKey[mod.key]) };
  }

  /** Card-thumbnail bridge for tutorial resources in the hub library. */
  function thumbFor(slug) {
    var mod = MODS.moduleByKey(String(slug || ''));
    return mod ? mod.thumb : null;
  }

  // ── Boot ──────────────────────────────────────────────────────────────────

  // Load progress once the signed-in user is known, so the hub can render
  // accurate induction state on first paint of My Learning.
  function bootWhenReady(tries) {
    if (user().id) { loadCatalogue(); loadProgress(); return; }
    if (tries > 60) return;
    setTimeout(function () { bootWhenReady(tries + 1); }, 250);
  }
  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', function () { bootWhenReady(0); });
  } else {
    bootWhenReady(0);
  }

  // ── Public surface ────────────────────────────────────────────────────────

  global.OpalInduction = {
    start: start,
    close: close,
    next: next,
    prev: prev,
    finish: finish,
    restart: restart,
    openDashboard: openDashboard,
    dashboardHtml: dashboardHtml,
    homeCardHtml: homeCardHtml,
    moduleForSlug: moduleForSlug,
    thumbFor: thumbFor,
    loadProgress: loadProgress,
    loadCatalogue: loadCatalogue,
    _quizPick: _quizPick,
    _quizCheck: _quizCheck,
    _ackSign: _ackSign,
    _restartAsk: _restartAsk,
    _restartCancel: _restartCancel,
    _state: S, // exposed for Playwright assertions, like OpalScheduler._state
  };

})(typeof window !== 'undefined' ? window : this);
