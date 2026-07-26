'use strict';

/**
 * XERO API CLIENT (Accounting module)
 *
 * OAuth 2.0 auth-code flow + read-only Accounting API access. Modelled on
 * outlook-oauth.js but deliberately kept separate. Key rules baked in:
 *
 *  - Tokens are DECRYPTED at this choke point (callers hand us the stored
 *    "enc:…" ciphertext); we never assume plaintext. Mirrors the fix that
 *    resolved the Splose "Bearer enc:" staging bug.
 *  - Access tokens are short-lived (~30 min). ensureValidToken refreshes
 *    proactively; Xero ROTATES the refresh token on every refresh, so the
 *    new refresh token MUST be persisted by the caller.
 *  - Rate limits: 429 responses are honoured via Retry-After with bounded
 *    retries. All reads paginate.
 *  - No secrets are logged; errors surface Xero error codes only.
 *
 * Secrets come from env (Key Vault refs in Azure):
 *   XERO_CLIENT_ID, XERO_CLIENT_SECRET, XERO_REDIRECT_URI
 */

const axios = require('axios');
const crypto = require('crypto');
const { decrypt } = require('./crypto-utils');

const AUTH_BASE = 'https://login.xero.com/identity/connect/authorize';
const TOKEN_URL = 'https://identity.xero.com/connect/token';
const CONNECTIONS_URL = 'https://api.xero.com/connections';
const API_BASE = 'https://api.xero.com/api.xro/2.0';

// Read-first scopes. offline_access is required for refresh tokens.
const SCOPES = [
  'openid', 'profile', 'email', 'offline_access',
  'accounting.transactions.read',
  'accounting.contacts.read',
  'accounting.settings.read',
  'accounting.reports.read',
];

function config() {
  return {
    clientId: process.env.XERO_CLIENT_ID || '',
    clientSecret: process.env.XERO_CLIENT_SECRET || '',
    redirectUri: process.env.XERO_REDIRECT_URI
      || ((process.env.APP_BASE_URL || 'http://localhost:5001') + '/api/accounting/xero/callback'),
  };
}

function isConfigured() {
  const c = config();
  return !!(c.clientId && c.clientSecret && c.clientId !== 'staging-placeholder-not-configured');
}

/** Build the authorize URL + the CSRF state to store in the session. */
function buildAuthorizeUrl() {
  const c = config();
  const state = crypto.randomBytes(24).toString('hex');
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: c.clientId,
    redirect_uri: c.redirectUri,
    scope: SCOPES.join(' '),
    state,
  });
  return { url: `${AUTH_BASE}?${params.toString()}`, state };
}

function basicAuthHeader() {
  const c = config();
  return 'Basic ' + Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64');
}

/** Exchange an auth code for tokens. */
async function exchangeCodeForTokens(code) {
  const c = config();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: c.redirectUri,
  });
  const res = await axios.post(TOKEN_URL, body.toString(), {
    headers: { Authorization: basicAuthHeader(), 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 20000,
  });
  return normaliseTokenResponse(res.data);
}

/** Refresh using a (decrypted) refresh token. Returns the NEW token set. */
async function refreshTokens(refreshTokenPlaintext) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshTokenPlaintext,
  });
  const res = await axios.post(TOKEN_URL, body.toString(), {
    headers: { Authorization: basicAuthHeader(), 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 20000,
  });
  return normaliseTokenResponse(res.data);
}

function normaliseTokenResponse(d) {
  return {
    accessToken: d.access_token,
    refreshToken: d.refresh_token,       // rotates each refresh — persist it
    expiresIn: d.expires_in,             // seconds
    expiresAt: new Date(Date.now() + (d.expires_in - 60) * 1000), // 60s safety margin
  };
}

/** List tenants (organisations) this token is authorised for. */
async function getConnections(accessTokenPlaintext) {
  const res = await axios.get(CONNECTIONS_URL, {
    headers: { Authorization: `Bearer ${accessTokenPlaintext}`, 'Content-Type': 'application/json' },
    timeout: 20000,
  });
  return (res.data || []).map(t => ({
    connectionId: t.id,
    tenantId: t.tenantId,
    tenantName: t.tenantName,
    tenantType: t.tenantType,
  }));
}

/** Revoke a connection (disconnect). */
async function revokeConnection(accessTokenPlaintext, connectionId) {
  await axios.delete(`${CONNECTIONS_URL}/${connectionId}`, {
    headers: { Authorization: `Bearer ${accessTokenPlaintext}` },
    timeout: 20000,
  }).catch(() => { /* best-effort; local disconnect is authoritative */ });
}

// ── Authenticated read client ────────────────────────────────────────────────

/**
 * Ensure a connection row has a live access token. Accepts the stored
 * (possibly encrypted) token fields and a persist callback. Returns the
 * plaintext access token to use, refreshing + persisting if near expiry.
 */
async function ensureValidToken(connection, persistFn) {
  const now = Date.now();
  const expiresAt = connection.token_expires_at ? new Date(connection.token_expires_at).getTime() : 0;
  if (expiresAt - now > 60 * 1000) {
    return decrypt(connection.access_token);
  }
  if (!connection.refresh_token) throw new Error('No Xero refresh token — reconnect required');
  const refreshed = await refreshTokens(decrypt(connection.refresh_token));
  if (typeof persistFn === 'function') await persistFn(refreshed);
  return refreshed.accessToken;
}

const MAX_RETRIES = 4;

/** GET a paginated Accounting API resource. Honours 429 Retry-After + backoff. */
async function apiGet(accessTokenPlaintext, tenantId, path, params = {}) {
  let attempt = 0;
  for (;;) {
    try {
      const res = await axios.get(`${API_BASE}${path}`, {
        headers: {
          Authorization: `Bearer ${accessTokenPlaintext}`,
          'Xero-tenant-id': tenantId,
          Accept: 'application/json',
        },
        params,
        timeout: 30000,
      });
      return res.data;
    } catch (err) {
      const status = err.response?.status;
      if (status === 429 && attempt < MAX_RETRIES) {
        const retryAfter = Number(err.response.headers['retry-after']) || Math.pow(2, attempt);
        await sleep(Math.min(retryAfter, 60) * 1000);
        attempt++;
        continue;
      }
      if ((status === 500 || status === 503) && attempt < MAX_RETRIES) {
        await sleep(Math.pow(2, attempt) * 500);
        attempt++;
        continue;
      }
      throw err;
    }
  }
}

/**
 * Fetch all pages of a list resource (Xero paginates with ?page=N, 100/page).
 * Returns { items, complete } — complete=false means we stopped at the page
 * cap (truncated), so downstream must treat it as incomplete evidence.
 */
async function apiGetAll(accessTokenPlaintext, tenantId, path, key, params = {}) {
  const MAX_PAGES = 100;
  const items = [];
  let page = 1;
  let complete = true;
  for (;;) {
    const data = await apiGet(accessTokenPlaintext, tenantId, path, { ...params, page });
    const batch = data?.[key] || [];
    items.push(...batch);
    if (batch.length < 100) break;      // last page
    page++;
    if (page > MAX_PAGES) { complete = false; break; }
  }
  return { items, complete };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = {
  SCOPES,
  config,
  isConfigured,
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  refreshTokens,
  getConnections,
  revokeConnection,
  ensureValidToken,
  apiGet,
  apiGetAll,
};
