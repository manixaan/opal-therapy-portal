'use strict';

/**
 * MICROSOFT GRAPH IDENTITY — creating and closing a Microsoft 365 account.
 *
 * Onboarding already mints a PORTAL login (onboarding-accounts.js). This
 * module does the Microsoft half: a work address on the practice's domain,
 * a licence so the address actually has a mailbox, and — at offboarding —
 * the reverse. It is the ONLY module that talks to Graph with the
 * application's own identity rather than a signed-in user's.
 *
 * ── APP-ONLY, NOT DELEGATED ────────────────────────────────────────────────
 * outlook-oauth.js / graph-mail.js act AS a user, with whatever that user
 * consented to. Creating users is not something an ordinary account may do,
 * so this path authenticates with the app registration's own client secret
 * (client-credentials flow) and needs APPLICATION permissions granted once
 * by a tenant Global Administrator:
 *
 *   User.ReadWrite.All      create the account, disable it, set the licence
 *   Organization.Read.All   read how many licences are left
 *
 * Until that grant exists, every call here fails with `grant_missing` and the
 * UI says "ask your Microsoft admin". Nothing is retried around it and nothing
 * falls back — silently widening what the app can do is precisely the thing
 * this module must not arrange for itself.
 *
 * ── WHAT COSTS MONEY ───────────────────────────────────────────────────────
 * The account is free; the LICENCE is the monthly charge. So the licence pool
 * is checked BEFORE the account is created, and an empty pool stops the whole
 * step with `no_licence` — "buy one first" — rather than leaving an unlicensed
 * shell the practice would have to notice. Buying licences is never done from
 * here: that is a deliberate human act in the Microsoft 365 admin centre, and
 * keeping it there also keeps this app's permission set narrower.
 *
 * ── THE PASSWORD ───────────────────────────────────────────────────────────
 * Graph is told to force a change at first sign-in. The plaintext passes
 * through this module exactly once, into the create request, and is never
 * logged, stored or included in an error.
 *
 * ── OFFBOARDING NEVER DELETES ──────────────────────────────────────────────
 * Disabling keeps the mailbox and OneDrive intact for the retention period;
 * releasing the licence returns it to the pool for the next starter. A hard
 * delete is a separate, deliberate act in the admin centre.
 */

const axios = require('axios');
const log = require('./logger').createLogger('graph-identity');

const GRAPH = 'https://graph.microsoft.com/v1.0';
const SCOPE = 'https://graph.microsoft.com/.default';

/** The two licence choices the Owner sees. The SKU ids are tenant-specific. */
const LICENCES = Object.freeze({
  basic: {
    key: 'basic',
    label: 'Basic',
    description: 'Email, Teams and the web apps. Enough for phone-and-browser roles.',
    envKey: 'M365_LICENCE_SKU_BASIC',
  },
  full: {
    key: 'full',
    label: 'Full',
    description: 'Everything in Basic plus the desktop Office apps.',
    envKey: 'M365_LICENCE_SKU_FULL',
  },
});

// ═════════════════════════════════════════════════════════════════════════════
//  CONFIGURATION
// ═════════════════════════════════════════════════════════════════════════════

function env(name) {
  return String(process.env[name] || '').trim();
}

function isEnabled() {
  return env('M365_PROVISIONING_ENABLED').toLowerCase() === 'true';
}

function domain() {
  return env('M365_DOMAIN').toLowerCase().replace(/^@/, '');
}

function usageLocation() {
  return (env('M365_USAGE_LOCATION') || 'AU').toUpperCase().slice(0, 2);
}

function licenceSku(key) {
  const licence = LICENCES[key];
  return licence ? env(licence.envKey) : '';
}

/** The message shown when the step cannot run. Plain words, no internals. */
const ADMIN_MESSAGE = 'Microsoft 365 accounts cannot be created from here yet. '
  + 'Ask your Microsoft admin to grant the portal permission to manage users, '
  + 'then switch the feature on.';

/**
 * Is the provisioning path configured at all?
 *
 * Checks configuration only, never the network: the answer feeds a screen
 * that renders on every journey load. The grant itself is discovered the
 * first time Graph refuses, and reported as `grant_missing`.
 */
function configState() {
  if (!isEnabled()) return { ok: false, code: 'disabled', message: ADMIN_MESSAGE };
  const missing = ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET', 'MICROSOFT_TENANT_ID', 'M365_DOMAIN']
    .filter((k) => !env(k));
  if (!licenceSku('basic') && !licenceSku('full')) missing.push('M365_LICENCE_SKU_BASIC');
  if (missing.length) {
    log.warn('M365 provisioning is enabled but incomplete', { missing });
    return { ok: false, code: 'misconfigured', message: ADMIN_MESSAGE };
  }
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain())) {
    return { ok: false, code: 'misconfigured', message: ADMIN_MESSAGE };
  }
  return { ok: true, code: 'ok', message: null, domain: domain() };
}

// ═════════════════════════════════════════════════════════════════════════════
//  ERRORS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * One error type, with a short vocabulary the route maps to a status:
 *   grant_missing   the tenant has not consented (or the secret is wrong)
 *   no_licence      the pool is exhausted
 *   upn_taken       that address already exists in the tenant
 *   not_found       the account is gone
 *   transient       Graph or the network failed; retry later
 */
class GraphIdentityError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'GraphIdentityError';
    this.code = code;
    this.status = status || null;
  }
}

function classify(err, fallback = 'transient') {
  if (err instanceof GraphIdentityError) return err;
  const status = err?.response?.status || null;
  const graphCode = err?.response?.data?.error?.code || '';
  const graphMessage = err?.response?.data?.error?.message || '';
  if (status === 401 || status === 403 || /Authorization_RequestDenied|invalid_client|unauthorized_client/i.test(graphCode)) {
    return new GraphIdentityError('grant_missing', ADMIN_MESSAGE, status);
  }
  if (status === 404) return new GraphIdentityError('not_found', 'That Microsoft account no longer exists.', status);
  if (/ObjectConflict|userPrincipalName already exists|already exists/i.test(`${graphCode} ${graphMessage}`)) {
    return new GraphIdentityError('upn_taken', 'That address already exists in Microsoft 365.', status);
  }
  if (/license|licence/i.test(graphMessage) && /not have any available|no available|not enough|insufficient|exceed/i.test(graphMessage)) {
    return new GraphIdentityError('no_licence', noLicenceMessage(), status);
  }
  return new GraphIdentityError(fallback, 'Microsoft 365 did not respond as expected. Try again in a few minutes.', status);
}

function noLicenceMessage() {
  return 'No Microsoft 365 licences left. Buy one in the Microsoft 365 admin centre first, then try again.';
}

// ═════════════════════════════════════════════════════════════════════════════
//  TOKEN — client credentials, cached in memory
// ═════════════════════════════════════════════════════════════════════════════

let cachedToken = null; // { value, expiresAt }

async function getAppToken() {
  if (cachedToken && cachedToken.expiresAt - Date.now() > 60 * 1000) return cachedToken.value;
  const params = new URLSearchParams();
  params.append('client_id', env('MICROSOFT_CLIENT_ID'));
  params.append('client_secret', env('MICROSOFT_CLIENT_SECRET'));
  params.append('scope', SCOPE);
  params.append('grant_type', 'client_credentials');
  try {
    const { data } = await axios.post(
      `https://login.microsoftonline.com/${encodeURIComponent(env('MICROSOFT_TENANT_ID'))}/oauth2/v2.0/token`,
      params.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 }
    );
    cachedToken = {
      value: data.access_token,
      expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
    };
    return cachedToken.value;
  } catch (err) {
    cachedToken = null;
    // A token failure is a configuration/consent problem far more often than
    // an outage, so it is reported as the grant rather than as transient.
    const status = err?.response?.status || null;
    log.warn('M365 app token request failed', { status, code: err?.response?.data?.error || null });
    throw new GraphIdentityError('grant_missing', ADMIN_MESSAGE, status);
  }
}

async function graph(method, path, body) {
  const token = await getAppToken();
  try {
    const res = await axios({
      method, url: `${GRAPH}${path}`, data: body,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      timeout: 20000,
      validateStatus: (s) => s >= 200 && s < 300,
    });
    return res.data;
  } catch (err) {
    const classified = classify(err);
    log.warn('graph identity call failed', {
      method, path: path.replace(/\/users\/[^/?]+/g, '/users/<id>'), status: classified.status, code: classified.code,
    });
    throw classified;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  NAMING
// ═════════════════════════════════════════════════════════════════════════════

/**
 * "Jane-Marie O'Brien" → "jane-marie.obrien". ASCII only, because a UPN must
 * be; hyphens kept because they are part of the name; nothing else survives.
 */
function mailNickname(fullName) {
  const parts = String(fullName || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/\s+/)
    .map((p) => p.replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, ''))
    .filter(Boolean);
  if (!parts.length) return '';
  const nick = parts.length === 1 ? parts[0] : `${parts[0]}.${parts[parts.length - 1]}`;
  return nick.slice(0, 64);
}

/** The full address for a name on the configured domain, or '' if unusable. */
function suggestUserPrincipalName(fullName, dom = domain()) {
  const nick = mailNickname(fullName);
  return nick && dom ? `${nick}@${dom}` : '';
}

/**
 * Accept a UPN an Owner typed, on the practice domain only.
 * Returns { ok, upn, nickname } or { ok:false, error }.
 */
function validateUserPrincipalName(input, dom = domain()) {
  const upn = String(input || '').trim().toLowerCase();
  const m = /^([a-z0-9][a-z0-9._-]{0,63})@([a-z0-9.-]+\.[a-z]{2,})$/.exec(upn);
  if (!m) return { ok: false, error: 'That is not a valid Microsoft 365 address.' };
  if (m[2] !== dom) return { ok: false, error: `The address must be on ${dom}.` };
  if (/\.\.|^\.|\.$/.test(m[1])) return { ok: false, error: 'That is not a valid Microsoft 365 address.' };
  return { ok: true, upn, nickname: m[1] };
}

// ═════════════════════════════════════════════════════════════════════════════
//  LICENCES
// ═════════════════════════════════════════════════════════════════════════════

/**
 * How many of each configured licence are left.
 * @returns {Promise<Record<string,{key,label,description,configured,total,used,available}>>}
 */
async function licenceAvailability() {
  const data = await graph('get', '/subscribedSkus');
  const skus = Array.isArray(data?.value) ? data.value : [];
  const out = {};
  for (const licence of Object.values(LICENCES)) {
    const skuId = licenceSku(licence.key);
    const row = { key: licence.key, label: licence.label, description: licence.description,
      configured: !!skuId, total: 0, used: 0, available: 0, skuName: null };
    if (skuId) {
      const sku = skus.find((s) => String(s.skuId).toLowerCase() === skuId.toLowerCase());
      if (sku) {
        const total = Number(sku.prepaidUnits?.enabled) || 0;
        const used = Number(sku.consumedUnits) || 0;
        Object.assign(row, { total, used, available: Math.max(0, total - used), skuName: sku.skuPartNumber || null });
      }
    }
    out[licence.key] = row;
  }
  return out;
}

async function assignLicence(objectId, licenceKey) {
  const skuId = licenceSku(licenceKey);
  if (!skuId) throw new GraphIdentityError('misconfigured', ADMIN_MESSAGE);
  await graph('post', `/users/${encodeURIComponent(objectId)}/assignLicense`, {
    addLicenses: [{ skuId, disabledPlans: [] }],
    removeLicenses: [],
  });
}

async function removeAllLicences(objectId) {
  const data = await graph('get', `/users/${encodeURIComponent(objectId)}/licenseDetails`);
  const skuIds = (Array.isArray(data?.value) ? data.value : []).map((l) => l.skuId).filter(Boolean);
  if (!skuIds.length) return 0;
  await graph('post', `/users/${encodeURIComponent(objectId)}/assignLicense`, {
    addLicenses: [], removeLicenses: skuIds,
  });
  return skuIds.length;
}

// ═════════════════════════════════════════════════════════════════════════════
//  USERS
// ═════════════════════════════════════════════════════════════════════════════

async function findUserByPrincipalName(upn) {
  try {
    const data = await graph('get', `/users/${encodeURIComponent(upn)}?$select=id,userPrincipalName,accountEnabled`);
    return data ? { id: data.id, upn: data.userPrincipalName, enabled: data.accountEnabled } : null;
  } catch (err) {
    if (err.code === 'not_found') return null;
    throw err;
  }
}

/**
 * Create the account. The password is used here and nowhere else.
 * @returns {Promise<{id:string, upn:string}>}
 */
async function createUser({ displayName, givenName, surname, upn, nickname, password }) {
  const data = await graph('post', '/users', {
    accountEnabled: true,
    displayName: String(displayName || '').slice(0, 256),
    givenName: givenName ? String(givenName).slice(0, 64) : undefined,
    surname: surname ? String(surname).slice(0, 64) : undefined,
    mailNickname: nickname,
    userPrincipalName: upn,
    usageLocation: usageLocation(),
    passwordProfile: {
      forceChangePasswordNextSignIn: true,
      password,
    },
  });
  return { id: data.id, upn: data.userPrincipalName || upn };
}

/** Disable sign-in and end every live session. Never deletes. */
async function disableUser(objectId) {
  await graph('patch', `/users/${encodeURIComponent(objectId)}`, { accountEnabled: false });
  try {
    await graph('post', `/users/${encodeURIComponent(objectId)}/revokeSignInSessions`, {});
  } catch (err) {
    // The account is already disabled; a failed revoke only means existing
    // tokens live out their hour. Worth a log line, not a failed offboarding.
    log.warn('revokeSignInSessions failed after disable', { code: err.code });
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  THE TWO OPERATIONS THE PORTAL PERFORMS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Provision: check the pool, refuse a taken address, create, then license.
 *
 * Order matters. The pool is checked first so an empty one costs nothing.
 * If the licence step fails AFTER the account exists, the account is still
 * reported — `licenceAssigned:false` — because rolling it back would discard
 * a real object the Owner can see in the admin centre, and the licence can be
 * retried on its own.
 */
async function provision({ displayName, givenName, surname, upn, nickname, password, licenceKey }) {
  // Sibling calls go through the export table so a test can stub Graph at
  // this module's edge without a network.
  const self = module.exports;
  const licence = LICENCES[licenceKey];
  if (!licence) throw new GraphIdentityError('bad_request', 'Choose either a Basic or Full licence.');
  if (!licenceSku(licenceKey)) throw new GraphIdentityError('misconfigured', ADMIN_MESSAGE);

  const pool = await self.licenceAvailability();
  if (!pool[licenceKey] || pool[licenceKey].available < 1) {
    throw new GraphIdentityError('no_licence', noLicenceMessage());
  }

  if (await self.findUserByPrincipalName(upn)) {
    throw new GraphIdentityError('upn_taken', 'That address already exists in Microsoft 365. Choose another.');
  }

  const created = await self.createUser({ displayName, givenName, surname, upn, nickname, password });

  let licenceAssigned = false;
  let licenceError = null;
  try {
    await self.assignLicence(created.id, licenceKey);
    licenceAssigned = true;
  } catch (err) {
    licenceError = classify(err);
  }
  return { objectId: created.id, upn: created.upn, licenceKey, licenceAssigned, licenceError };
}

/** Offboard: disable, revoke, release the licence. */
async function decommission(objectId) {
  const self = module.exports;
  await self.disableUser(objectId);
  let licencesReleased = 0;
  try {
    licencesReleased = await self.removeAllLicences(objectId);
  } catch (err) {
    log.warn('licence release failed after disable', { code: classify(err).code });
  }
  return { disabled: true, licencesReleased };
}

/** Test seam: forget the cached token. */
function _resetTokenCache() { cachedToken = null; }

module.exports = {
  LICENCES,
  ADMIN_MESSAGE,
  GraphIdentityError,
  isEnabled,
  configState,
  domain,
  mailNickname,
  suggestUserPrincipalName,
  validateUserPrincipalName,
  licenceAvailability,
  findUserByPrincipalName,
  createUser,
  assignLicence,
  removeAllLicences,
  disableUser,
  provision,
  decommission,
  noLicenceMessage,
  classify,
  _resetTokenCache,
};
