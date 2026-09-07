'use strict';

/**
 * XERO CUSTOM CONNECTION — PAYROLL (client_credentials, server-side only)
 *
 * The accounting module (xero-api.js) uses the owner-driven authorization-code
 * flow with tokens persisted per organisation. Payroll onboarding deliberately
 * does NOT reuse those tokens: it runs on Xero's "Custom Connection" — a
 * separate app with the client_credentials grant, its own secret and its own
 * (granular, least-privilege) scope set. Nothing here ever reaches a browser.
 *
 *   - The access token is held in process memory for its returned lifetime
 *     (minus a safety margin) and nowhere else. It is never written to the
 *     database, a log, an audit row or a response.
 *   - The tenant id is discovered from GET /connections with the token and
 *     cached alongside it. Responses expose at most its last six characters.
 *   - Configuration is fail-closed: with no client id/secret the module reports
 *     `configured: false` and every caller refuses, rather than falling back to
 *     the accounting tokens.
 *
 * Scopes. A Custom Connection's scopes are fixed when the app is authorised in
 * Xero; the token request repeats them and Xero rejects a superset. The set
 * here is the least that creates and verifies an employee:
 *   payroll.employees      create / update / read the employee
 *   payroll.settings.read  calendars, pay items, super funds, super products
 *   payroll.payruns.read   see whether a draft pay run includes them
 * payroll.settings (write) is added ONLY when creating a missing regulated
 * super fund is enabled. payroll.payruns / payroll.payslip write scopes are
 * never requested — the documented API cannot add an employee to an existing
 * draft pay run, and claiming otherwise would be a fiction.
 */

const axios = require('axios');
const flags = require('./finance-flags');

const TOKEN_URL = 'https://identity.xero.com/connect/token';
const CONNECTIONS_URL = 'https://api.xero.com/connections';

const BASE_SCOPES = Object.freeze(['payroll.employees', 'payroll.settings.read', 'payroll.payruns.read']);
const SUPERFUND_CREATE_SCOPE = 'payroll.settings';
const SAFETY_MARGIN_MS = 60 * 1000;

let _cache = null; // { accessToken, expiresAt, tenantId, tenantName, scope }

function config() {
  return {
    clientId: process.env.XERO_PAYROLL_CLIENT_ID || '',
    clientSecret: process.env.XERO_PAYROLL_CLIENT_SECRET || '',
  };
}

function isConfigured() {
  const c = config();
  return !!(c.clientId && c.clientSecret);
}

/** The scopes this deployment asks for. */
function scopes() {
  const list = [...BASE_SCOPES];
  if (flags.isPayrollSuperFundCreateEnabled()) list.push(SUPERFUND_CREATE_SCOPE);
  return list;
}

function notConfiguredError() {
  const err = new Error('The Xero payroll connection is not configured');
  err.code = 'XERO_PAYROLL_NOT_CONFIGURED';
  err.statusCode = 503;
  return err;
}

/**
 * A live access token and the tenant it is for. Cached for the token's own
 * lifetime; a 401 downstream should call invalidate() and try once more.
 */
async function getConnection({ http = axios } = {}) {
  if (!isConfigured()) throw notConfiguredError();
  if (_cache && _cache.expiresAt - Date.now() > SAFETY_MARGIN_MS) return _cache;

  const c = config();
  const body = new URLSearchParams({ grant_type: 'client_credentials', scope: scopes().join(' ') });
  let tokenRes;
  try {
    tokenRes = await http.post(TOKEN_URL, body.toString(), {
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 20000,
    });
  } catch (err) {
    throw authError(err);
  }
  const d = tokenRes.data || {};
  if (!d.access_token) throw authError(new Error('No access token in the token response'));
  const expiresIn = Number(d.expires_in) || 1800;

  let connections;
  try {
    const res = await http.get(CONNECTIONS_URL, {
      headers: { Authorization: `Bearer ${d.access_token}`, Accept: 'application/json' },
      timeout: 20000,
    });
    connections = Array.isArray(res.data) ? res.data : [];
  } catch (err) {
    throw authError(err);
  }
  const tenant = connections.find((t) => t.tenantType === 'ORGANISATION') || connections[0];
  if (!tenant || !tenant.tenantId) {
    const err = new Error('The Xero payroll connection has no organisation attached');
    err.code = 'XERO_PAYROLL_NO_TENANT';
    err.statusCode = 503;
    throw err;
  }

  _cache = {
    accessToken: d.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
    tenantId: tenant.tenantId,
    tenantName: tenant.tenantName || null,
    scope: typeof d.scope === 'string' ? d.scope.split(' ') : scopes(),
  };
  return _cache;
}

function authError(err) {
  const status = err.response?.status;
  const out = new Error(status === 400 || status === 401
    ? 'Xero rejected the payroll connection credentials'
    : 'Could not reach Xero to authorise the payroll connection');
  out.code = status === 400 || status === 401 ? 'XERO_PAYROLL_AUTH_FAILED' : 'XERO_PAYROLL_AUTH_UNAVAILABLE';
  out.statusCode = 503;
  out.httpStatus = status || null;
  return out;
}

/** Drop the cached token (after a 401, or in tests). */
function invalidate() { _cache = null; }

/**
 * Safe health summary for the Owner's screen. Never the token, never the full
 * tenant id.
 */
async function health({ http = axios } = {}) {
  if (!isConfigured()) {
    return { configured: false, connected: false, reason: 'XERO_PAYROLL_CLIENT_ID / XERO_PAYROLL_CLIENT_SECRET are not set', scopes: scopes(), syncEnabled: flags.isPayrollSyncEnabled() };
  }
  try {
    const c = await getConnection({ http });
    return {
      configured: true, connected: true,
      tenantName: c.tenantName, tenantIdSuffix: String(c.tenantId).slice(-6),
      scopes: c.scope, tokenExpiresAt: new Date(c.expiresAt).toISOString(),
      syncEnabled: flags.isPayrollSyncEnabled(), superFundCreateEnabled: flags.isPayrollSuperFundCreateEnabled(),
    };
  } catch (err) {
    return { configured: true, connected: false, reason: err.message, code: err.code || null, scopes: scopes(), syncEnabled: flags.isPayrollSyncEnabled() };
  }
}

module.exports = {
  BASE_SCOPES, SUPERFUND_CREATE_SCOPE, TOKEN_URL, CONNECTIONS_URL,
  isConfigured, scopes, getConnection, invalidate, health,
};
