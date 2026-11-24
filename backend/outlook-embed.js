'use strict';

/**
 * THE WHOLE PORTAL INSIDE OUTLOOK — the "Opal" icon in the Outlook app bar.
 *
 * Outlook (and Teams) show a Microsoft 365 app's personal tab as a cross-site
 * iframe. Two things stop the ordinary portal working there:
 *
 *   1. frame-ancestors 'self' — the shell refuses to be framed by Outlook.
 *   2. the session cookie is SameSite=Lax, so the browser never sends it
 *      inside Outlook's frame; every request would look signed out.
 *
 * This module fixes both, and only for requests that come from inside the
 * Outlook frame:
 *
 *   - A SECOND session cookie, `opal.embed.sid`, SameSite=None; Secure;
 *     Partitioned (CHIPS). A partitioned cookie is keyed to the top-level
 *     site, so it exists only under outlook.office.com / teams.microsoft.com
 *     and is never sent when another site frames the portal. The ordinary
 *     Lax cookie is untouched.
 *   - The embed cookie is only ever issued by POST /api/auth/entra-embed,
 *     which exchanges a Microsoft 365 SSO token (Teams JS getAuthToken) for a
 *     portal session — validated by assist/entra-auth.js and refused for
 *     exactly the accounts Opal Assist refuses.
 *   - Requests on an embed session that change state must carry
 *     Sec-Fetch-Site: same-origin. SameSite=None gives up the cookie's own
 *     CSRF protection, so this puts it back (fail-closed: no header, no write).
 *   - Requests on an embed session may be framed by the Microsoft 365 hosts;
 *     every other request keeps frame-ancestors 'self'.
 *
 * Dormant unless OPAL_OUTLOOK_TAB_ENABLED=true AND Opal Assist's Entra
 * settings exist (OPAL_ASSIST_ENTRA_CLIENT_ID, MICROSOFT_TENANT_ID). Needs
 * https: a Secure cookie is never set on plain http.
 */

const path = require('path');
const express = require('express');
const entra = require('./assist/entra-auth');
const { createIpRateLimiter } = require('./request-safety');

const EMBED_COOKIE = 'opal.embed.sid';
const NORMAL_COOKIE = 'connect.sid';
const EXCHANGE_PATH = '/api/auth/entra-embed';
const TAB_PATH = '/outlook';

// Office hosts that may frame the Opal Assist task pane (server.js /assist).
const OFFICE_FRAME_ANCESTORS = [
  "'self'", 'https://*.officeapps.live.com', 'https://*.office.com', 'https://*.office365.com',
  'https://*.microsoft.com', 'https://*.sharepoint.com', 'https://*.cloud.microsoft', 'https://outlook.live.com',
];
// The app-bar tab is also hosted by the Microsoft 365 app (microsoft365.com).
const TAB_FRAME_ANCESTORS = [...OFFICE_FRAME_ANCESTORS, 'https://*.microsoft365.com'];

// Teams JS SDK, pinned by version and by Subresource Integrity.
const TEAMS_JS = {
  src: 'https://res.cdn.office.net/teams-js/2.24.0/js/MicrosoftTeams.min.js',
  integrity: 'sha384-79NK4sbfVpgLoDFqyfj18/S1Uj8jhLBeRGvKO1Cqw5634RznExQ90myY/qV/0gsN',
};

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function isEnabled() {
  return process.env.OPAL_OUTLOOK_TAB_ENABLED === 'true' && entra.isConfigured();
}

function hasCookie(header, name) {
  return String(header || '').split(';').some((c) => c.trim().startsWith(name + '='));
}

const pathOf = (req) => String(req.originalUrl || req.url || '').split('?')[0];

/**
 * One session middleware for the app (and Socket.IO) that picks the cookie.
 * The ordinary session wins whenever its cookie is present; the embed session
 * is used only for the exchange itself or a request carrying the embed cookie
 * and no ordinary one. When the feature is off, the embed session never runs.
 */
function createSessionDispatcher({ session, normal, store, secret, ttlMs }) {
  const embed = session({
    name: EMBED_COOKIE,
    store,
    secret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { secure: true, httpOnly: true, sameSite: 'none', partitioned: true, maxAge: ttlMs },
  });
  return function sessionDispatcher(req, res, next) {
    if (isEnabled()) {
      const cookies = req.headers && req.headers.cookie;
      const wantEmbed = pathOf(req) === EXCHANGE_PATH
        || (!hasCookie(cookies, NORMAL_COOKIE) && hasCookie(cookies, EMBED_COOKIE));
      if (wantEmbed) {
        req.isEmbed = true;
        return embed(req, res, next);
      }
    }
    return normal(req, res, next);
  };
}

/**
 * After the dispatcher: CSRF for embed sessions, and framing by Microsoft 365
 * for embed requests only.
 */
function embedGuards(req, res, next) {
  if (!req.isEmbed) return next();
  if (UNSAFE_METHODS.has(req.method) && req.get('sec-fetch-site') !== 'same-origin') {
    return res.status(403).json({ error: 'Request origin not permitted', code: 'embed_cross_site' });
  }
  const csp = res.getHeader('Content-Security-Policy');
  if (csp) {
    res.setHeader('Content-Security-Policy',
      String(csp).replace(/frame-ancestors[^;]*/, `frame-ancestors ${TAB_FRAME_ANCESTORS.join(' ')}`));
  }
  res.removeHeader('X-Frame-Options');
  next();
}

/** Inside a frame, the sign-in page cannot show — send it back to the tab. */
function isFramedNavigation(req) {
  return isEnabled() && req.get('sec-fetch-dest') === 'iframe';
}

function createRouter({ frontendPath, db = require('./database') } = {}) {
  const router = express.Router();

  // The tab's entry page: no data, framable by Microsoft 365 only, and the one
  // place the Teams SDK may load from.
  router.get(TAB_PATH, (req, res) => {
    res.removeHeader('X-Frame-Options');
    res.set('Content-Security-Policy', [
      "default-src 'self'",
      `script-src 'self' https://res.cdn.office.net`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      `frame-ancestors ${TAB_FRAME_ANCESTORS.join(' ')}`,
    ].join('; '));
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(frontendPath, 'outlook-tab.html'));
  });

  router.get('/api/auth/entra-embed/config', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ enabled: isEnabled(), teamsJs: TEAMS_JS });
  });

  const limit = createIpRateLimiter({
    windowMs: 15 * 60 * 1000, max: 30, message: 'Too many sign-in attempts. Please try again shortly.',
  });

  router.post(EXCHANGE_PATH, limit, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!isEnabled()) return res.status(404).json({ error: 'Not available', code: 'outlook_tab_disabled' });
    if (!req.isEmbed || !req.session) return res.status(400).json({ error: 'Not available', code: 'outlook_tab_no_session' });
    const token = req.body && typeof req.body.token === 'string' ? req.body.token : '';
    if (!token) return res.status(400).json({ error: 'Microsoft sign-in token required', code: 'malformed' });

    const audit = (action, userId, metadata) => db.logAuditEvent({
      actorUserId: userId || null, action, targetType: 'user', targetId: userId || null,
      metadata, ipAddress: req.ip, organisationId: null,
    }).catch(() => {});

    let claims;
    try {
      claims = await entra.validate(token);
    } catch (err) {
      const code = entra.refusalCode(err);
      await audit('login_failed', null, { via: 'outlook_tab', reason: code });
      return res.status(401).json({ error: 'Microsoft sign-in was not accepted', code });
    }

    let r;
    try { r = await entra.resolveAccount(claims); } catch (_) {
      return res.status(503).json({ error: 'Sign-in is unavailable — please try again', code: 'entra_unavailable' });
    }
    if (!r.user) {
      await audit('login_failed', null, { via: 'outlook_tab', reason: r.code });
      return res.status(r.status).json({ error: r.error, code: r.code });
    }
    const user = r.user;

    // New session id on every sign-in (no fixation).
    req.session.regenerate(async (err) => {
      if (err) return res.status(500).json({ error: 'Sign-in failed — please try again' });
      req.session.userId = user.id;
      req.session.authVia = 'outlook_tab';
      try { await db.recordLogin(user.id); } catch (_) {}
      try {
        await db.logAuditEvent({
          actorUserId: user.id, action: 'login_success', targetType: 'user', targetId: user.id,
          metadata: { via: 'outlook_tab' }, ipAddress: req.ip, organisationId: user.organisation_id || null,
        });
      } catch (_) {}
      res.json({ ok: true });
    });
  });

  return router;
}

module.exports = {
  EMBED_COOKIE,
  EXCHANGE_PATH,
  TAB_PATH,
  OFFICE_FRAME_ANCESTORS,
  TAB_FRAME_ANCESTORS,
  TEAMS_JS,
  isEnabled,
  createSessionDispatcher,
  embedGuards,
  isFramedNavigation,
  createRouter,
};
