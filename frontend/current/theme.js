/* ─────────────────────────────────────────────────────────────────────────
   theme.js — day / night mode for the portal shell.

   Three preferences, kept per browser in localStorage:
     auto  — follows the clock on this device: night from NIGHT_START to
             DAY_START, day otherwise. Re-checked every minute, so a portal
             left open across dusk changes on its own.
     light — always day.
     dark  — always night.

   Loaded WITHOUT defer, ahead of the stylesheets, so <html data-theme> is
   stamped before first paint. theme.css carries the night palette.
   ───────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var KEY = 'opal.theme';
  var NIGHT_START = 18;   // 6pm  — local hour night mode begins
  var DAY_START = 6;      // 6am  — local hour day mode returns
  var ORDER = ['auto', 'light', 'dark'];
  var LABEL = { auto: 'Auto (follows the time of day)', light: 'Day', dark: 'Night' };
  var ICON = {
    // sun
    light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    // moon
    dark: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    // half-filled disc — "the portal decides"
    auto: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>'
  };

  function getPref() {
    try {
      var v = localStorage.getItem(KEY);
      return ORDER.indexOf(v) === -1 ? 'auto' : v;
    } catch (e) { return 'auto'; }
  }

  function isNight(date) {
    var h = (date || new Date()).getHours();
    return h >= NIGHT_START || h < DAY_START;
  }

  function resolve(pref) {
    if (pref === 'light' || pref === 'dark') return pref;
    return isNight() ? 'dark' : 'light';
  }

  function paintToggle(pref, applied) {
    // Settings select + account-menu segment mirror the saved preference.
    var sels = document.querySelectorAll('[data-theme-select]');
    for (var i = 0; i < sels.length; i++) sels[i].value = pref;
    var segs = document.querySelectorAll('[data-theme-set]');
    for (var j = 0; j < segs.length; j++) segs[j].setAttribute('aria-pressed', segs[j].getAttribute('data-theme-set') === pref ? 'true' : 'false');
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[pref] + '</svg>';
    var text = 'Theme: ' + LABEL[pref] + (pref === 'auto' ? ' — ' + (applied === 'dark' ? 'night' : 'day') + ' now' : '') + '. Click to change.';
    btn.title = text;
    btn.setAttribute('aria-label', text);
  }

  function apply() {
    var pref = getPref();
    var applied = resolve(pref);
    var root = document.documentElement;
    if (root.getAttribute('data-theme') !== applied) root.setAttribute('data-theme', applied);
    root.setAttribute('data-theme-pref', pref);
    paintToggle(pref, applied);
    return applied;
  }

  function setPref(pref) {
    if (ORDER.indexOf(pref) === -1) pref = 'auto';
    try { localStorage.setItem(KEY, pref); } catch (e) { /* private window — session only */ }
    return apply();
  }

  function cycle() {
    return setPref(ORDER[(ORDER.indexOf(getPref()) + 1) % ORDER.length]);
  }

  apply();                                             // before first paint
  document.addEventListener('DOMContentLoaded', apply); // toggle button now exists
  setInterval(apply, 60 * 1000);                       // auto mode crosses dusk/dawn
  document.addEventListener('visibilitychange', function () { if (!document.hidden) apply(); });
  window.addEventListener('storage', function (e) { if (e.key === KEY) apply(); }); // other tabs

  window.OpalTheme = { get: getPref, set: setPref, cycle: cycle, apply: apply, isNight: isNight };
})();
