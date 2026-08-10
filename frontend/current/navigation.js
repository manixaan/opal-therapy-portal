/* ═══════════════════════════════════════════════════════════════════════════
   OPAL PORTAL — IN-APP BROWSER NAVIGATION (Back / Forward)

   The portal is a single-page app served as /mockup_v3.html. Before this
   module existed it had tab/view switching but no History API integration at
   all, so pressing Back LEFT the application and the user lost their place.
   This module makes Back and Forward step through the application's OWN
   navigation instead.

   Conventions (mirrors resourcehub.js / casenotes.js / supportpop.js):
     - single IIFE, no build step, no dependencies
     - pure helpers exported for node tests (navigation-routes.test.js) BEFORE
       anything touches the DOM
     - SELF-INSTALLING: this file is not wired into mockup_v3.html's own
       script bodies. It monkey-patches the existing globals at load time, the
       same house pattern as patchSettingsTabSwitch() and
       patchCalendarModeForScheduler() inside mockup_v3.html. Every hook is
       guarded with a typeof check and degrades to a silent no-op when the
       global is absent, so the module is safe to load on any page.

   DESIGN NOTES / NON-NEGOTIABLES ENCODED HERE:

     1. HASH ROUTING, NOT pushState PATHS. The app is served from a single
        static file with no server-side routing, so a path-based route would
        404 on refresh. location.hash survives refresh, needs no server work
        and cannot 404.

     2. THE USER IS NEVER TRAPPED. No decoy history entry is ever pushed to
        absorb the first Back press, and this file deliberately registers no
        unload veto of any kind. At the root state the browser's own entry
        is still the previous entry, so Back leaves the site normally. The
        only write that happens without a real navigation is a replaceState
        at boot, which by definition adds no entry.

     3. RESTORATION GOES THROUGH THE APP'S OWN FUNCTIONS. popstate never
        pokes the DOM directly for navigation; it calls switchTab /
        setCalendarMode / RH2.nav / CaseNotes.select so RBAC, lazy loading
        and rendering all stay correct. A re-entrancy flag stops restoration
        pushing new entries.

     4. RBAC IS RESPECTED, QUIETLY. A route the signed-in role cannot reach
        is never restored; it falls back to their permitted home (Calendar)
        without a scolding toast — the user did not choose that hash, a stale
        bookmark did. switchTab's own default-deny guard remains the real
        client-side boundary and the backend remains the actual one.

     5. NOTHING EXISTING CHANGES. No browser-storage key is read or written
        here: calendar week position, scheduler date, Opa/Support window
        geometry and completed-section collapse all keep working untouched.
        This module only adds history entries and restores state.

   ROUTE GRAMMAR (see the table in normaliseRoute below):
     #calendar | #calendar/week | #calendar/scheduler
     #resources | #resources/library | #resources/detail/:id
     #casenotes | #casenotes/:id
     #book | #profile | #logbook | #accounting | #settings | #support | …
     #fca/step-2 | #letter/step-3
   Overlays hang off the base route after a "!" so Back closes the overlay
   rather than leaving the underlying view:
     #calendar/week!booking | #calendar/week!event/:id | #profile!support
     #settings!modal/modal-purchase
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

(function (global) {

  /* ═════════════════════════════════════════════════════════════════════════
     PURE HELPERS — no DOM, no globals. Exported for node unit tests.
     ═════════════════════════════════════════════════════════════════════════ */

  var DEFAULT_TAB = 'calendar';

  // Every data-tab in mockup_v3.html, plus the two full-screen wizard
  // surfaces (fca / letter) which are not tabs but are navigable states.
  var KNOWN_TABS = [
    'calendar', 'profile', 'casenotes', 'resources', 'book',
    'contacts', 'activity', 'billing', 'ndis', 'dormant',
    'travel', 'logbook', 'accounting', 'settings', 'support', 'purchases',
    'fca', 'letter',
  ];

  var WIZARD_TABS = ['fca', 'letter'];

  // Route names for the calendar modes. The app calls the Master Scheduler
  // mode 'master' internally; the route says 'scheduler' because that is what
  // the button is labelled and what a human would type.
  var CAL_MODES = ['day', 'week', 'month', 'scheduler'];

  var RH_VIEWS = ['home', 'library', 'saved', 'learning', 'admin', 'detail'];

  var OVERLAYS = ['booking', 'event', 'support', 'modal'];
  var OVERLAYS_WITH_ID = ['event', 'modal'];

  var MAX_ID = 120;    // ids longer than this are hostile, not real
  var MAX_HASH = 512;  // never parse more hash than this
  var MAX_STEP = 12;   // FCA has 6 steps, Letter 5 — 12 is generous headroom

  function lower(v) {
    return (typeof v === 'string' || typeof v === 'number') ? String(v).toLowerCase() : '';
  }

  // Ids come from the URL, so they are untrusted. They are only ever handed
  // to the app's own lookup functions (never interpolated into HTML), but
  // they are still length-capped and stripped of the route separators so a
  // crafted hash cannot smuggle extra segments through.
  function safeId(v) {
    if (v == null) return '';
    var s = String(v).trim();
    if (!s) return '';
    s = s.replace(/[#!/?\s]/g, '');
    if (s.length > MAX_ID) s = s.slice(0, MAX_ID);
    return s;
  }

  function blankRoute() {
    return { tab: DEFAULT_TAB, view: null, id: null, step: null, overlay: null, overlayId: null };
  }

  function inList(list, v) { return list.indexOf(v) !== -1; }

  /**
   * normaliseRoute(state) → canonical route state.
   *
   * Total function: anything at all can be passed in (null, a string, a
   * hostile object) and a valid, safe route comes back. This is what makes
   * a garbage hash harmless — it degrades to #calendar rather than throwing
   * or half-applying.
   */
  function normaliseRoute(state) {
    var s = (state && typeof state === 'object') ? state : {};
    var out = blankRoute();

    var tab = lower(s.tab);
    if (inList(KNOWN_TABS, tab)) out.tab = tab;

    if (out.tab === 'calendar') {
      var mode = lower(s.view);
      if (mode === 'master') mode = 'scheduler';       // app name → route name
      if (inList(CAL_MODES, mode)) out.view = mode;    // absent = "leave the current mode alone"

    } else if (out.tab === 'resources') {
      var view = lower(s.view);
      if (!inList(RH_VIEWS, view)) view = 'home';
      var rid = safeId(s.id);
      if (view === 'detail' && !rid) view = 'library'; // "#resources/detail/" with no id
      out.view = view;
      if (view === 'detail') out.id = rid;

    } else if (out.tab === 'casenotes') {
      out.id = safeId(s.id) || null;

    } else if (inList(WIZARD_TABS, out.tab)) {
      var n = parseInt(s.step, 10);
      out.step = (isFinite(n) && n >= 1 && n <= MAX_STEP) ? n : null;
    }

    var ov = lower(s.overlay);
    if (inList(OVERLAYS, ov)) {
      var oid = safeId(s.overlayId);
      if (inList(OVERLAYS_WITH_ID, ov)) {
        if (oid) { out.overlay = ov; out.overlayId = oid; }   // no id → not a real overlay
      } else {
        out.overlay = ov;
      }
    }

    return out;
  }

  /**
   * encodeRoute(state) → "#..." string. Always canonical: the default
   * Resource Hub view and an absent calendar mode are simply omitted, so a
   * re-render of the same screen never produces a different string (which is
   * what lets routesEqual suppress duplicate history entries).
   */
  function encodeRoute(state) {
    var s = normaliseRoute(state);
    var out = '#' + s.tab;

    if (s.tab === 'calendar') {
      if (s.view) out += '/' + s.view;
    } else if (s.tab === 'resources') {
      if (s.view === 'detail') out += '/detail/' + encodeURIComponent(s.id);
      else if (s.view && s.view !== 'home') out += '/' + s.view;
    } else if (s.tab === 'casenotes') {
      if (s.id) out += '/' + encodeURIComponent(s.id);
    } else if (inList(WIZARD_TABS, s.tab)) {
      if (s.step) out += '/step-' + s.step;
    }

    if (s.overlay) {
      out += '!' + s.overlay;
      if (s.overlayId) out += '/' + encodeURIComponent(s.overlayId);
    }
    return out;
  }

  function decodeSegment(v) {
    if (v == null) return '';
    try { return decodeURIComponent(String(v)); }
    catch (e) { return String(v); }   // malformed %-escape — keep the raw text
  }

  /**
   * decodeRoute(hash) → route state. Accepts anything: "", "#", "#/",
   * "#resources/detail/" (no id), an unknown tab, a 10kB hash. Never throws.
   */
  function decodeRoute(hash) {
    var h = (hash == null) ? '' : String(hash);
    if (h.length > MAX_HASH) h = h.slice(0, MAX_HASH);
    h = h.replace(/^#+/, '').replace(/^\/+/, '').replace(/\/+$/, '');
    if (!h) return blankRoute();

    var overlayRaw = '';
    var bang = h.indexOf('!');
    if (bang !== -1) {
      overlayRaw = h.slice(bang + 1);
      h = h.slice(0, bang).replace(/\/+$/, '');
    }

    var parts = h ? h.split('/').filter(Boolean) : [];
    var st = { tab: parts[0] };

    var tab = lower(parts[0]);
    if (tab === 'calendar') {
      st.view = parts[1];
    } else if (tab === 'resources') {
      st.view = parts[1];
      if (lower(parts[1]) === 'detail') st.id = decodeSegment(parts[2]);
    } else if (tab === 'casenotes') {
      st.id = decodeSegment(parts[1]);
    } else if (inList(WIZARD_TABS, tab)) {
      var m = /^step-(\d{1,3})$/.exec(lower(parts[1] || ''));
      if (m) st.step = parseInt(m[1], 10);
    }

    if (overlayRaw) {
      var oParts = overlayRaw.split('/').filter(Boolean);
      st.overlay = oParts[0];
      if (oParts.length > 1) st.overlayId = decodeSegment(oParts.slice(1).join('/'));
    }

    return normaliseRoute(st);
  }

  function routesEqual(a, b) {
    if (!a || !b) return false;
    var x = normaliseRoute(a), y = normaliseRoute(b);
    return x.tab === y.tab && x.view === y.view && x.id === y.id &&
           x.step === y.step && x.overlay === y.overlay && x.overlayId === y.overlayId;
  }

  /**
   * pushOrReplace(prev, next) → 'push' | 'replace'.
   *
   * The single rule that keeps the history stack honest:
   *   - nothing recorded yet (boot)          → replace, never add an entry
   *   - the same route again (re-render)     → replace, no duplicate entries
   *   - anything else                        → push, one entry per navigation
   */
  function pushOrReplace(prev, next) {
    if (!prev) return 'replace';
    return routesEqual(prev, next) ? 'replace' : 'push';
  }

  /** Strip the overlay off a route, leaving the underlying view. */
  function baseOf(state) {
    var s = normaliseRoute(state);
    s.overlay = null;
    s.overlayId = null;
    return s;
  }

  var helpers = {
    encodeRoute: encodeRoute,
    decodeRoute: decodeRoute,
    normaliseRoute: normaliseRoute,
    routesEqual: routesEqual,
    pushOrReplace: pushOrReplace,
    baseOf: baseOf,
    DEFAULT_TAB: DEFAULT_TAB,
    KNOWN_TABS: KNOWN_TABS,
    CAL_MODES: CAL_MODES,
    RH_VIEWS: RH_VIEWS,
    OVERLAYS: OVERLAYS,
    MAX_ID: MAX_ID,
    MAX_HASH: MAX_HASH,
    MAX_STEP: MAX_STEP,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = helpers;

  // node / test environments stop here — everything below needs a browser.
  if (!global || !global.document || !global.history ||
      typeof global.history.pushState !== 'function') return;

  /* ═════════════════════════════════════════════════════════════════════════
     RUNTIME
     ═════════════════════════════════════════════════════════════════════════ */

  var doc = global.document;
  var hist = global.history;

  // Captured before any hook can run. Deep linking reads THIS, never
  // location.hash at boot time: a navigation that happens while auth is still
  // resolving would otherwise have already overwritten the hash the user
  // arrived with.
  var INITIAL_HASH = (global.location && global.location.hash) || '';

  var NAV = {
    current: null,   // last route we wrote, as a normalised state object
    restoring: 0,    // >0 while popstate restoration is running (no pushes)
    inNav: 0,        // >0 while a hooked navigation function is running
    lastBackAt: 0,   // throttle for history.back() (anti double-fire)
    booted: false,   // deep-link restore has run
    rhView: null,    // Resource Hub sub-view (RH2 exports no state object)
    rhId: null,
    wizard: null,    // 'fca' | 'letter' | null
    wizardStep: null,
  };

  function q(sel) { try { return doc.querySelector(sel); } catch (e) { return null; } }
  function qa(sel) { try { return Array.prototype.slice.call(doc.querySelectorAll(sel)); } catch (e) { return []; } }
  function isFn(v) { return typeof v === 'function'; }

  /* ── Reading the app's current state ──────────────────────────────────────
     Always read back from the DOM/globals AFTER calling through a hook rather
     than trusting the argument. mockup_v3.html wraps switchTab several times
     (patchSettingsTabSwitch, and the RBAC default-deny guard installed later
     by applyNavRoleVisibility), and the guard can rewrite a denied tab to
     'calendar'. Reading the result means this module records what actually
     happened whichever order the wrappers ended up in. */

  function activeTabName() {
    var el = q('.tab.active[data-tab]');
    if (el && el.dataset && el.dataset.tab) return el.dataset.tab;
    var view = q('.view.active');
    if (view && view.id && view.id.indexOf('view-') === 0) return view.id.slice(5);
    return DEFAULT_TAB;
  }

  function calendarModeName() {
    var mode = lower(global.__calendarMode) || '';
    if (mode === 'master') return 'scheduler';
    return inList(CAL_MODES, mode) ? mode : null;
  }

  function caseNoteSelectedId() {
    var cn = global.CaseNotes;
    if (!cn || !cn._state) return null;
    return safeId(cn._state.selectedId) || null;
  }

  function wizardStepOf(name) {
    var mod = (name === 'fca') ? global.FCA : global.LetterBuilder;
    if (!mod || !mod._state) return null;
    var n = parseInt(mod._state.step, 10);
    return (isFinite(n) && n >= 1 && n <= MAX_STEP) ? n : null;
  }

  /** The current base (overlay-free) route, derived from the live app. */
  function currentBase() {
    if (NAV.wizard) {
      return { tab: NAV.wizard, step: wizardStepOf(NAV.wizard) || NAV.wizardStep || 1 };
    }
    var tab = activeTabName();
    var st = { tab: tab };
    if (tab === 'calendar') st.view = calendarModeName();
    else if (tab === 'resources') { st.view = NAV.rhView || 'home'; st.id = NAV.rhId; }
    else if (tab === 'casenotes') st.id = caseNoteSelectedId();
    return st;
  }

  /* ── Writing history ──────────────────────────────────────────────────── */

  function writeRoute(state) {
    if (NAV.restoring) return;                     // restoration never pushes
    if (!NAV.booted) return;                       // never clobber the arrival hash
    var next = normaliseRoute(state);
    var mode = pushOrReplace(NAV.current, next);
    var url = encodeRoute(next);
    try {
      if (mode === 'push') hist.pushState({ opalNav: url }, '', url);
      else hist.replaceState({ opalNav: url }, '', url);
    } catch (e) { return; }                        // sandboxed / quota — stay silent
    NAV.current = next;
  }

  /** Record wherever the app has just landed (no overlay). */
  function syncBase() {
    if (NAV.restoring) return;
    writeRoute(currentBase());
  }

  /* ── Overlays as history steps ────────────────────────────────────────────
     Opening an overlay pushes ONE entry, so Back closes the overlay and
     leaves the underlying view intact. Closing it normally (button, Escape,
     backdrop click) consumes that entry with history.back() so the stack can
     never drift out of sync with what is on screen.

     Three separate guards stop the classic double-fire loop:
       a) NAV.restoring — a close triggered BY popstate never calls back()
       b) NAV.inNav     — switchTab closes overlays on its way out; those
                          closes are part of a navigation, not a Back
       c) the overlay must actually be the current route, and NAV.current is
          demoted to the base route BEFORE back() is called, so a second
          close in the same tick finds nothing to consume. A 120ms throttle
          catches anything that still slips through (Escape + backdrop
          pointerdown firing together, for instance). */

  function openOverlay(kind, id) {
    if (NAV.restoring || NAV.inNav || !NAV.booted) return;
    var st = currentBase();
    st.overlay = kind;
    st.overlayId = id || null;
    var next = normaliseRoute(st);
    if (!next.overlay) return;                     // normalisation rejected it
    if (routesEqual(next, NAV.current)) return;    // already the current entry
    writeRoute(next);
  }

  function closeOverlay(kind, id) {
    if (NAV.restoring || NAV.inNav || !NAV.booted) return;
    if (!NAV.current || NAV.current.overlay !== kind) return;
    if (id && NAV.current.overlayId && NAV.current.overlayId !== safeId(id)) return;

    var now = Date.now();
    if (now - NAV.lastBackAt < 120) return;
    NAV.lastBackAt = now;

    NAV.current = baseOf(NAV.current);             // demote first — see (c) above
    try { hist.back(); } catch (e) { /* nothing we can do */ }
  }

  function supportPopOpen() { return !!q('.sp-show'); }

  function closeOverlays(target) {
    var keepModal = (target && target.overlay === 'modal') ? target.overlayId : null;

    if (!(target && target.overlay === 'event') && isFn(global.closeBlockDetail)) {
      try { global.closeBlockDetail(); } catch (e) {}
    }
    if (!(target && target.overlay === 'booking') && isFn(global.closeBookingPanel)) {
      try { global.closeBookingPanel(false); } catch (e) {}
    }
    if (!(target && target.overlay === 'support') && supportPopOpen() &&
        global.SupportPop && isFn(global.SupportPop.close)) {
      try { global.SupportPop.close(); } catch (e) {}
    }
    qa('.modal-backdrop.show, .modal.show').forEach(function (el) {
      if (keepModal && el.id === keepModal) return;
      try { el.classList.remove('show'); } catch (e) {}
    });
  }

  function applyOverlay(target) {
    if (!target || !target.overlay) return;
    if (target.overlay === 'booking' && isFn(global.openBookingPanel)) {
      try { global.openBookingPanel({ keepState: true }); } catch (e) {}
    } else if (target.overlay === 'event' && isFn(global.openBlockDetail)) {
      try { global.openBlockDetail(target.overlayId); } catch (e) {}
    } else if (target.overlay === 'support' && global.SupportPop && isFn(global.SupportPop.open)) {
      try { global.SupportPop.open(); } catch (e) {}
    } else if (target.overlay === 'modal') {
      var el = doc.getElementById(target.overlayId);
      if (el) { try { el.classList.add('show'); } catch (e) {} }
    }
  }

  /* ── RBAC ─────────────────────────────────────────────────────────────────
     Never restore a route the signed-in role cannot reach. Resolved through
     the app's own NAV_ALLOWED_TABS / navAllowedTabs so there is exactly one
     definition of "allowed" on the client. When the answer is not yet known
     (auth still resolving) we let switchTab's own default-deny guard decide
     rather than second-guessing it here. */

  function allowedTabs() {
    if (Array.isArray(global.NAV_ALLOWED_TABS) && global.NAV_ALLOWED_TABS.length) {
      return global.NAV_ALLOWED_TABS;
    }
    if (isFn(global.navAllowedTabs) && global.APP_USER) {
      try {
        var list = global.navAllowedTabs(global.APP_USER.role);
        if (Array.isArray(list) && list.length) return list;
      } catch (e) {}
    }
    return null;
  }

  function tabAllowed(tab) {
    if (inList(WIZARD_TABS, tab)) {
      // Wizards are full-screen surfaces owned by their own modules; if the
      // module is not loaded the restore is a no-op anyway.
      var mod = (tab === 'fca') ? global.FCA : global.LetterBuilder;
      return !!(mod && isFn(mod.open));
    }
    var allowed = allowedTabs();
    if (!allowed) return true;                     // not known yet — defer to switchTab
    if (inList(allowed, tab)) return true;
    // Mirrors the app's own exception: Smart Booking is reachable by anyone
    // who is not read_only, even though it is not in ROLE_NAV.
    if (tab === 'book' && global.APP_USER && global.APP_USER.role !== 'read_only') return true;
    return false;
  }

  /* ── Restoration ──────────────────────────────────────────────────────────
     Order matters: close any open overlay FIRST (so a stale backdrop cannot
     cover the view we are about to switch to), then apply the base view,
     then re-open the target overlay if the route has one (Forward). */

  function closeWizards() {
    if (NAV.wizard === 'fca' && global.FCA && isFn(global.FCA.close)) {
      try { global.FCA.close(); } catch (e) {}
    }
    if (NAV.wizard === 'letter' && global.LetterBuilder && isFn(global.LetterBuilder.close)) {
      try { global.LetterBuilder.close(); } catch (e) {}
    }
    NAV.wizard = null;
    NAV.wizardStep = null;
  }

  function applyBase(t) {
    if (inList(WIZARD_TABS, t.tab)) {
      var mod = (t.tab === 'fca') ? global.FCA : global.LetterBuilder;
      if (mod && isFn(mod.open)) {
        try { mod.open(); } catch (e) {}
        NAV.wizard = t.tab;
        NAV.wizardStep = t.step || 1;
      }
      return;
    }
    closeWizards();

    // An explicitly restored calendar view is a deliberate choice, so raise
    // the same flag the view-tab buttons raise — and raise it BEFORE
    // switchTab, not after. patchSettingsTabSwitch applies the saved
    // calendarDefaultView the first time the calendar tab is opened unless
    // this flag is already set; setting it afterwards would be one call too
    // late and the restored view would be stomped on the way in.
    if (t.tab === 'calendar' && t.view) global.__viewManuallySet = true;

    if (isFn(global.switchTab)) { try { global.switchTab(t.tab); } catch (e) {} }

    if (t.tab === 'calendar' && t.view) {
      // Only switch when the mode actually differs. setCalendarMode() calls
      // renderCurrentWeek(), which rebuilds window.SESSIONS with freshly
      // generated tile ids — re-rendering a mode that is already showing
      // would invalidate the very event id a Forward press is about to
      // re-open, and would throw away the user's scroll position for nothing.
      if (calendarModeName() !== t.view && isFn(global.setCalendarMode)) {
        var mode = (t.view === 'scheduler') ? 'master' : t.view;
        try { global.setCalendarMode(mode); } catch (e) {}
      }
    }

    if (t.tab === 'resources' && global.RH2) {
      // The Resources tab only boots RH2 from a real click on the nav tab, so
      // a restored route has to activate it explicitly.
      if (isFn(global.RH2.open)) { try { global.RH2.open(); } catch (e) {} }
      if (t.view === 'detail' && t.id && isFn(global.RH2.openDetail)) {
        try { global.RH2.openDetail(t.id, 'library'); } catch (e) {}
        NAV.rhView = 'detail'; NAV.rhId = t.id;
      } else if (isFn(global.RH2.nav)) {
        try { global.RH2.nav(t.view || 'home'); } catch (e) {}
        NAV.rhView = t.view || 'home'; NAV.rhId = null;
      }
    }

    if (t.tab === 'casenotes' && t.id && global.CaseNotes && isFn(global.CaseNotes.select)) {
      try { global.CaseNotes.select(t.id); } catch (e) {}
    }
  }

  function restore(state) {
    NAV.restoring++;
    try {
      var target = normaliseRoute(state);
      if (!tabAllowed(target.tab)) {
        // Quietly fall back to the permitted home screen and rewrite the URL
        // so the denied hash does not sit in the address bar. replaceState,
        // so no extra entry appears.
        target = normaliseRoute({ tab: DEFAULT_TAB });
        try { hist.replaceState({ opalNav: encodeRoute(target) }, '', encodeRoute(target)); } catch (e) {}
      }
      closeOverlays(target);
      applyBase(target);
      applyOverlay(target);
      NAV.current = target;
    } catch (e) {
      // A restore must never throw: a broken hash would otherwise leave the
      // re-entrancy counter stuck and kill all further navigation.
    } finally {
      NAV.restoring--;
      if (NAV.restoring < 0) NAV.restoring = 0;
    }
  }

  /* ── Hook installation ────────────────────────────────────────────────────
     Every hook is typeof-guarded and simply not installed when its global is
     missing. The module-level globals (RH2, CaseNotes, SupportPop, FCA,
     LetterBuilder) load from their own deferred scripts, so hooking is
     retried for a few seconds rather than assuming a script order — this file
     works wherever the integrator puts the <script> line. */

  // Installed-once registry. Without it the retry loop would wrap switchTab a
  // second time after applyNavRoleVisibility() installs the RBAC default-deny
  // guard on top of ours (it takes whatever window.switchTab is at that
  // moment). One layer is all we need: ours stays in the chain either way.
  var installed = {};

  function hookGlobalFn(name, make) {
    if (installed['fn:' + name]) return true;
    var orig = global[name];
    if (!isFn(orig)) return false;
    global[name] = make(orig);
    installed['fn:' + name] = true;
    return true;
  }

  function hookMethod(nsName, method, make) {
    var key = nsName + '.' + method;
    if (installed[key]) return true;
    var ns = global[nsName];
    if (!ns || !isFn(ns[method])) return false;
    ns[method] = make(ns[method].bind(ns));
    installed[key] = true;
    return true;
  }

  function installCoreHooks() {
    // switchTab — the tab bar, the More menu, every programmatic tab change.
    hookGlobalFn('switchTab', function (orig) {
      return function (name) {
        NAV.inNav++;
        var out;
        try { out = orig.apply(this, arguments); }
        finally { NAV.inNav--; if (NAV.inNav < 0) NAV.inNav = 0; }
        if (name !== 'resources') { NAV.rhView = null; NAV.rhId = null; }
        syncBase();
        return out;
      };
    });

    // setCalendarMode — day / week / month / master. Already wrapped by
    // patchCalendarModeForScheduler in mockup_v3.html; this sits outside it.
    hookGlobalFn('setCalendarMode', function (orig) {
      return function () {
        NAV.inNav++;
        var out;
        try { out = orig.apply(this, arguments); }
        finally { NAV.inNav--; if (NAV.inNav < 0) NAV.inNav = 0; }
        syncBase();
        return out;
      };
    });

    // switchCalendarView — the older today/week/month button set, which sets
    // __calendarMode itself and then calls switchTab.
    hookGlobalFn('switchCalendarView', function (orig) {
      return function () {
        NAV.inNav++;
        var out;
        try { out = orig.apply(this, arguments); }
        finally { NAV.inNav--; if (NAV.inNav < 0) NAV.inNav = 0; }
        syncBase();
        return out;
      };
    });

    // Booking side panel.
    hookGlobalFn('openBookingPanel', function (orig) {
      return function () {
        var out = orig.apply(this, arguments);
        openOverlay('booking', null);
        return out;
      };
    });
    hookGlobalFn('closeBookingPanel', function (orig) {
      return function () {
        var wasOpen = !!q('#booking-side-panel.open');
        var out = orig.apply(this, arguments);
        if (wasOpen) closeOverlay('booking');
        return out;
      };
    });

    // Event detail drawer.
    hookGlobalFn('openBlockDetail', function (orig) {
      return function (id) {
        var out = orig.apply(this, arguments);
        if (q('#detail-drawer.show')) openOverlay('event', id);
        return out;
      };
    });
    hookGlobalFn('closeBlockDetail', function (orig) {
      return function () {
        var wasOpen = !!q('#detail-drawer.show');
        var out = orig.apply(this, arguments);
        if (wasOpen) closeOverlay('event');
        return out;
      };
    });
  }

  function installModuleHooks() {
    var done = true;

    // Resource Hub — RH2 exports no state object, so the sub-view is tracked
    // from the arguments it is navigated with.
    if (global.RH2) {
      hookMethod('RH2', 'nav', function (orig) {
        return function (view) {
          var out = orig.apply(this, arguments);
          NAV.rhView = lower(view) || 'home';
          NAV.rhId = null;
          syncBase();
          return out;
        };
      });
      hookMethod('RH2', 'openDetail', function (orig) {
        return function (id) {
          var out = orig.apply(this, arguments);
          NAV.rhView = 'detail';
          NAV.rhId = safeId(id) || null;
          syncBase();
          return out;
        };
      });
    } else { done = false; }

    // Case Notes — selecting a draft is a real navigation. select() bails out
    // when the current draft is dirty, so the resulting id is read back from
    // the module's own exported state rather than assumed.
    if (global.CaseNotes) {
      hookMethod('CaseNotes', 'select', function (orig) {
        return function () {
          var out = orig.apply(this, arguments);
          syncBase();
          return out;
        };
      });
    } else { done = false; }

    // Support popup — a floating window, but it is an overlay for Back.
    if (global.SupportPop) {
      hookMethod('SupportPop', 'open', function (orig) {
        return function () {
          var out = orig.apply(this, arguments);
          openOverlay('support', null);
          return out;
        };
      });
      hookMethod('SupportPop', 'close', function (orig) {
        return function () {
          var wasOpen = supportPopOpen();
          var out = orig.apply(this, arguments);
          if (wasOpen) closeOverlay('support');
          return out;
        };
      });
    } else { done = false; }

    // FCA + Letter wizards. They expose open/close but NO step setter, so the
    // step is read from their published _state at push time, and
    // OpalNav.pushStep(name, step) is offered for a one-line call from their
    // own goStep() (see the integrator notes).
    WIZARD_TABS.forEach(function (name) {
      var nsName = (name === 'fca') ? 'FCA' : 'LetterBuilder';
      if (!global[nsName]) { done = false; return; }
      hookMethod(nsName, 'open', function (orig) {
        return function () {
          var out = orig.apply(this, arguments);
          NAV.wizard = name;
          NAV.wizardStep = wizardStepOf(name) || 1;
          syncBase();
          return out;
        };
      });
      hookMethod(nsName, 'close', function (orig) {
        return function () {
          var out = orig.apply(this, arguments);
          if (NAV.wizard === name) { NAV.wizard = null; NAV.wizardStep = null; }
          syncBase();
          return out;
        };
      });
    });

    return done;
  }

  /* Generic modals. The app has no single open/close pair for them — they are
     .modal-backdrop elements toggled with .show by a dozen call sites — so a
     class observer is attached to each one INDIVIDUALLY. Observing
     document.body with a class filter would fire on every calendar re-render;
     per-element observers cost nothing. */
  var watched = (typeof global.WeakSet === 'function') ? new global.WeakSet() : null;

  function installModalWatchers() {
    var MO = global.MutationObserver;
    if (!isFn(MO)) return;
    qa('.modal-backdrop[id], .modal[id]').forEach(function (el) {
      if (watched) { if (watched.has(el)) return; watched.add(el); }
      else if (el.__opalNavWatched) return;
      else el.__opalNavWatched = true;

      var obs = new MO(function () {
        if (NAV.restoring || NAV.inNav) return;
        if (el.classList.contains('show')) openOverlay('modal', el.id);
        else closeOverlay('modal', el.id);
      });
      try { obs.observe(el, { attributes: true, attributeFilter: ['class'] }); } catch (e) {}
    });
  }

  /* ── Boot / deep link ─────────────────────────────────────────────────────
     initAuth() in mockup_v3.html resolves asynchronously and then applies
     role gating and user settings with its own retry poller. Restoring before
     that lands would race the RBAC nav rebuild and the calendarDefaultView
     logic, so this mirrors the app's applyRoleGatingWhenReady pattern and
     waits for the same signals. */

  function appReady() {
    return !!global.APP_USER &&
           Array.isArray(global.NAV_ALLOWED_TABS) &&
           isFn(global.switchTab);
  }

  function bootRestore() {
    if (NAV.booted) return;
    NAV.booted = true;

    var raw = INITIAL_HASH;
    var hasHash = !!raw.replace(/^#+/, '').replace(/\/+/g, '');

    if (!hasHash) {
      // No hash: the app's default behaviour is untouched. Record where it
      // landed and canonicalise the URL with replaceState — which adds NO
      // history entry, so Back from the root still leaves the site.
      NAV.current = null;
      writeRoute(currentBase());
      return;
    }

    var target = decodeRoute(raw);
    NAV.current = null;
    restore(target);
    // restore() sets NAV.current; make sure the URL matches the route that was
    // actually applied (a denied or garbage hash is rewritten here).
    var url = encodeRoute(NAV.current || currentBase());
    try { hist.replaceState({ opalNav: url }, '', url); } catch (e) {}
  }

  function waitForApp(attempt) {
    if (appReady()) { bootRestore(); return; }
    if ((attempt || 0) < 60) {
      global.setTimeout(function () { waitForApp((attempt || 0) + 1); }, 100);
      return;
    }
    bootRestore();   // ~6s — settle anyway rather than never routing at all
  }

  /* ── Wiring ──────────────────────────────────────────────────────────── */

  global.addEventListener('popstate', function (ev) {
    var st = (ev && ev.state && ev.state.opalNav)
      ? decodeRoute(ev.state.opalNav)
      : decodeRoute((global.location && global.location.hash) || '');
    restore(st);
  });

  // Secondary net for a hash typed straight into the address bar, which fires
  // hashchange but not popstate. It is a no-op for our own writes and for the
  // hashchange that trails a popstate, because NAV.current already matches —
  // that is what stops the two listeners feeding each other.
  global.addEventListener('hashchange', function () {
    if (NAV.restoring) return;
    var next = decodeRoute((global.location && global.location.hash) || '');
    if (routesEqual(next, NAV.current)) return;
    restore(next);
  });

  installCoreHooks();
  installModalWatchers();

  (function retryModuleHooks(attempt) {
    var complete = installModuleHooks();
    installCoreHooks();   // cheap and idempotent — catches late definitions
    if (complete || (attempt || 0) >= 40) return;
    global.setTimeout(function () { retryModuleHooks((attempt || 0) + 1); }, 150);
  })(0);

  global.addEventListener('load', function () {
    installCoreHooks();
    installModalWatchers();
    global.setTimeout(installModalWatchers, 3000);
  });

  waitForApp(0);

  /* ── Public surface ──────────────────────────────────────────────────── */

  global.OpalNav = {
    // Pure helpers (also unit-tested from node).
    encodeRoute: encodeRoute,
    decodeRoute: decodeRoute,
    normaliseRoute: normaliseRoute,
    routesEqual: routesEqual,
    pushOrReplace: pushOrReplace,

    /**
     * Optional hook for wizards that own their own step state.
     * FCA and LetterBuilder expose no step setter, so their goStep() can call
     *   window.OpalNav && OpalNav.pushStep('fca', n);
     * to make each wizard step a Back-able history entry. Safe to call when
     * this module is absent (the guard above), and a no-op during restore.
     */
    pushStep: function (name, step) {
      var tab = lower(name);
      if (!inList(WIZARD_TABS, tab)) return;
      if (NAV.restoring) return;
      NAV.wizard = tab;
      NAV.wizardStep = parseInt(step, 10) || 1;
      writeRoute({ tab: tab, step: NAV.wizardStep });
    },

    /** Programmatic navigation, e.g. OpalNav.go({ tab: 'calendar', view: 'month' }). */
    go: function (state) {
      var prev = NAV.current;
      restore(state);                 // restore() also applies the RBAC fallback
      var landed = NAV.current;
      NAV.current = prev;             // so pushOrReplace sees the real predecessor
      writeRoute(landed);
    },

    /** The route the module believes is current (a copy). */
    current: function () { return NAV.current ? normaliseRoute(NAV.current) : null; },

    _state: NAV,
  };

})(typeof window !== 'undefined' ? window : this);
