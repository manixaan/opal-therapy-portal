'use strict';

/**
 * MICROSOFT 365 SIGN-IN FOR THE OFFICE TASK PANES.
 *
 * A Word/Excel/Outlook task pane is a cross-site iframe, so the portal's
 * SameSite=Lax session cookie is never sent from it. Office hands the pane
 * an Entra ID access token instead (OfficeRuntime.auth.getAccessToken),
 * and the pane presents it as `Authorization: Bearer …` on /api/assist/*.
 *
 * This module validates that token — with Node's own crypto, no library —
 * and maps it onto an existing portal account by email. It never creates
 * an account and never widens a role: if the email is not an active portal
 * user, the token is refused. Everything is fail-closed and dormant until
 * both settings exist:
 *
 *   OPAL_ASSIST_ENTRA_CLIENT_ID   the add-in's app registration (client) id
 *   MICROSOFT_TENANT_ID           the practice tenant (already used for Outlook)
 *
 * Checks: RS256 signature against the tenant's published keys (JWKS, cached
 * one hour, refreshed once on an unknown kid), issuer for that tenant (v2.0
 * or v1.0 sts), audience = client id or api://client id, tenant id claim,
 * exp / nbf with 60 s skew. Nothing about the token is logged.
 */

const crypto = require('crypto');

const KEY_TTL_MS = 60 * 60 * 1000;
const SKEW_S = 60;

let _keys = null;       // { fetchedAt, byKid: Map }
let _fetchImpl = null;  // test seam

function config() {
  const clientId = process.env.OPAL_ASSIST_ENTRA_CLIENT_ID;
  const tenant = process.env.MICROSOFT_TENANT_ID;
  if (!clientId || !tenant) return null;
  return { clientId, tenant };
}

function isConfigured() { return !!config(); }

async function fetchJson(url) {
  const f = _fetchImpl || global.fetch;
  const r = await f(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`jwks_http_${r.status}`);
  return r.json();
}

async function loadKeys(tenant, { force = false } = {}) {
  if (!force && _keys && Date.now() - _keys.fetchedAt < KEY_TTL_MS) return _keys.byKid;
  const meta = await fetchJson(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/v2.0/.well-known/openid-configuration`);
  const jwks = await fetchJson(meta.jwks_uri);
  const byKid = new Map();
  for (const k of jwks.keys || []) {
    if (k.kty !== 'RSA' || !k.kid) continue;
    try { byKid.set(k.kid, crypto.createPublicKey({ key: k, format: 'jwk' })); } catch (_) { /* skip malformed */ }
  }
  _keys = { fetchedAt: Date.now(), byKid };
  return byKid;
}

const b64url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/**
 * Validate a bearer token. Resolves to the claims, or throws Error(code).
 * Codes: not_configured, malformed, bad_alg, unknown_kid, bad_signature,
 * bad_issuer, bad_audience, bad_tenant, expired, not_yet_valid.
 */
async function validate(token) {
  const cfg = config();
  if (!cfg) throw new Error('not_configured');
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('malformed');
  let header; let claims;
  try { header = JSON.parse(b64url(parts[0]).toString('utf8')); claims = JSON.parse(b64url(parts[1]).toString('utf8')); } catch (_) { throw new Error('malformed'); }
  if (header.alg !== 'RS256' || !header.kid) throw new Error('bad_alg');

  let keys = await loadKeys(cfg.tenant);
  let key = keys.get(header.kid);
  if (!key) { keys = await loadKeys(cfg.tenant, { force: true }); key = keys.get(header.kid); }
  if (!key) throw new Error('unknown_kid');

  const ok = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, b64url(parts[2]));
  if (!ok) throw new Error('bad_signature');

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp + SKEW_S < now) throw new Error('expired');
  if (typeof claims.nbf === 'number' && claims.nbf - SKEW_S > now) throw new Error('not_yet_valid');

  const issuers = [`https://login.microsoftonline.com/${cfg.tenant}/v2.0`, `https://sts.windows.net/${cfg.tenant}/`];
  if (!issuers.includes(claims.iss)) throw new Error('bad_issuer');
  const auds = [cfg.clientId, `api://${cfg.clientId}`];
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.some((a) => auds.includes(a))) throw new Error('bad_audience');
  if (claims.tid && claims.tid !== cfg.tenant) throw new Error('bad_tenant');
  return claims;
}

/** The email Entra asserts for this person; null when the token has none. */
function emailOf(claims) {
  const e = claims.preferred_username || claims.email || claims.upn || null;
  return e && /^[^@\s]+@[^@\s]+$/.test(e) ? String(e).trim().toLowerCase() : null;
}

/**
 * Express middleware. With no bearer header (or no configuration) it does
 * nothing, so the ordinary session path runs. With one, it either sets
 * req.user from the matching active portal account or answers 401 — a
 * presented token is never silently ignored.
 */
function entraBearerAuth(req, res, next) {
  const h = req.headers.authorization || '';
  if (!/^Bearer\s+\S+/i.test(h)) return next();
  if (!isConfigured()) return res.status(401).json({ error: 'Microsoft sign-in is not configured for this portal', code: 'entra_not_configured' });
  const token = h.replace(/^Bearer\s+/i, '').trim();
  validate(token).then(async (claims) => {
    const email = emailOf(claims);
    if (!email) return res.status(401).json({ error: 'Token carries no email', code: 'entra_no_email' });
    const db = require('../database');
    const { getPermissions } = require('../permissions');
    const user = await db.getUserByEmail(email);
    if (!user || user.is_active === false) return res.status(401).json({ error: 'No active portal account for this Microsoft sign-in', code: 'entra_no_account' });
    if (user.must_change_password === true || user.role === 'pre_employee' || (user.account_status && user.account_status !== 'active')) {
      return res.status(403).json({ error: 'Finish setting up your portal account first', code: 'entra_account_not_ready' });
    }
    user.permissions = getPermissions(user.role, user.permissions || []);
    req.user = user;
    req.authVia = 'entra';
    next();
  }).catch((err) => {
    const code = ['malformed', 'bad_alg', 'unknown_kid', 'bad_signature', 'bad_issuer', 'bad_audience', 'bad_tenant', 'expired', 'not_yet_valid'].includes(err.message) ? err.message : 'entra_unavailable';
    res.status(401).json({ error: 'Microsoft sign-in was not accepted', code });
  });
}

function _setFetchForTests(fn) { _fetchImpl = fn; _keys = null; }

module.exports = { validate, emailOf, entraBearerAuth, isConfigured, _setFetchForTests };
