/**
 * Entry page of the "Opal" icon in the Outlook / Teams app bar (/outlook).
 *
 * Asks the Microsoft 365 host for a single-sign-on token (Teams JS
 * getAuthToken), swaps it for a portal session (POST /api/auth/entra-embed,
 * which sets the partitioned embed cookie), checks the cookie actually
 * stuck, then opens the ordinary portal shell in this same frame.
 *
 * Nothing here is trusted by the server: the token is validated there and
 * mapped to an existing active portal account, or refused.
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var hostReady = false;

  // A sign-in that keeps bouncing back here (cookie refused by the browser,
  // account not ready) must stop, not loop.
  var LOOP_KEY = 'opal.outlookTab.attempts';
  function attempts() {
    try {
      var now = Date.now();
      var list = JSON.parse(sessionStorage.getItem(LOOP_KEY) || '[]').filter(function (t) { return now - t < 60000; });
      list.push(now);
      sessionStorage.setItem(LOOP_KEY, JSON.stringify(list));
      return list.length;
    } catch (_) { return 1; }
  }

  function show(title, detail) {
    $('title').textContent = title;
    $('detail').textContent = detail;
    $('spin').hidden = true;
    $('actions').hidden = false;
  }

  function loadScript(src, integrity) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.integrity = integrity;
      s.crossOrigin = 'anonymous';
      s.onload = resolve;
      s.onerror = function () { reject(new Error('sdk_load')); };
      document.head.appendChild(s);
    });
  }

  function withTimeout(p, ms, code) {
    return Promise.race([p, new Promise(function (_, reject) { setTimeout(function () { reject(new Error(code)); }, ms); })]);
  }

  var MESSAGES = {
    entra_no_account: ['No Opal account for this Microsoft account', 'Ask the practice owner to invite you to the portal with this email address.'],
    entra_account_not_ready: ['Finish setting up your Opal account first', 'Sign in to Opal in the browser once to complete your account, then come back here.'],
    outlook_tab_disabled: ['Opal in Outlook is not switched on yet', 'You can still use Opal in the browser.'],
    cookie_blocked: ['Your browser blocked the sign-in', 'This browser does not allow Opal to keep you signed in inside Outlook. Open Opal in the browser instead.'],
    not_in_host: ['Open Opal from the Outlook app bar', 'This page only works inside Outlook or Teams.'],
    loop: ['Opal could not keep you signed in', 'Open Opal in the browser, or try again in a minute.'],
  };
  function fail(code) {
    var m = MESSAGES[code] || ['Opal could not sign you in', 'Try again, or open Opal in the browser.'];
    show(m[0], m[1]);
  }

  function signIn() {
    $('spin').hidden = false;
    $('actions').hidden = true;
    $('title').textContent = 'Signing you in to Opal…';
    $('detail').textContent = 'Using your Microsoft 365 account.';
    if (attempts() > 3) return Promise.resolve(fail('loop'));

    return fetch('/api/auth/entra-embed/config', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (cfg) {
        if (!cfg.enabled) throw new Error('outlook_tab_disabled');
        return window.microsoftTeams ? null : loadScript(cfg.teamsJs.src, cfg.teamsJs.integrity);
      })
      .then(function () {
        if (hostReady) return null;
        return withTimeout(window.microsoftTeams.app.initialize(), 8000, 'not_in_host').then(function () { hostReady = true; });
      })
      .then(function () { return window.microsoftTeams.authentication.getAuthToken(); })
      .then(function (token) {
        return fetch('/api/auth/entra-embed', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: token }),
        });
      })
      .then(function (r) {
        if (r.ok) return null;
        return r.json().catch(function () { return {}; }).then(function (b) { throw new Error(b.code || 'signin_failed'); });
      })
      // The session only helps if the browser kept the cookie.
      .then(function () { return fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' }); })
      .then(function (r) {
        if (!r.ok) throw new Error('cookie_blocked');
        window.location.replace('/');
      })
      .catch(function (err) { fail(err && err.message); });
  }

  $('retry').addEventListener('click', function () {
    try { sessionStorage.removeItem(LOOP_KEY); } catch (_) {}
    signIn();
  });
  // Outside the browser frame the link opens a normal tab; inside the host,
  // ask Outlook/Teams to open it so it is not trapped in the frame.
  $('open').addEventListener('click', function (e) {
    if (hostReady && window.microsoftTeams && window.microsoftTeams.app && window.microsoftTeams.app.openLink) {
      e.preventDefault();
      window.microsoftTeams.app.openLink(window.location.origin + '/');
    }
  });

  signIn();
})();
