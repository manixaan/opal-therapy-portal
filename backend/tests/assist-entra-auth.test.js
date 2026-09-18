'use strict';

/**
 * Microsoft 365 bearer sign-in for the Office task panes — validated with a
 * throwaway RSA key pair and a stubbed JWKS. No network, no database.
 */

jest.mock('../database', () => ({ getUserByEmail: jest.fn(), getUser: jest.fn() }));

const crypto = require('crypto');
const db = require('../database');
const entra = require('../assist/entra-auth');

const TENANT = '11111111-2222-4333-8444-555555555555';
const CLIENT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' });
jwk.kid = 'kid-1'; jwk.use = 'sig'; jwk.alg = 'RS256';

const b64u = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function sign(claims, { kid = 'kid-1', alg = 'RS256', key = privateKey } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const c = { iss: `https://login.microsoftonline.com/${TENANT}/v2.0`, aud: CLIENT, tid: TENANT, exp: now + 600, nbf: now - 10, preferred_username: 'Sam@Opal.test', ...claims };
  const head = b64u({ alg, typ: 'JWT', kid });
  const body = b64u(c);
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${head}.${body}.${sig}`;
}

beforeEach(() => {
  process.env.OPAL_ASSIST_ENTRA_CLIENT_ID = CLIENT;
  process.env.MICROSOFT_TENANT_ID = TENANT;
  entra._setFetchForTests(async (url) => ({
    ok: true,
    json: async () => (/openid-configuration/.test(url) ? { jwks_uri: 'https://login.microsoftonline.com/keys' } : { keys: [jwk] }),
  }));
  db.getUserByEmail.mockReset();
});
afterAll(() => { delete process.env.OPAL_ASSIST_ENTRA_CLIENT_ID; entra._setFetchForTests(null); });

const run = (headers) => new Promise((resolve) => {
  const req = { headers };
  const res = { status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b, req }); } };
  entra.entraBearerAuth(req, res, () => resolve({ next: true, req }));
});

test('a valid token for an active portal user sets req.user by email, case-insensitively', async () => {
  db.getUserByEmail.mockResolvedValue({ id: 'u1', email: 'sam@opal.test', role: 'therapist', is_active: true, account_status: 'active' });
  const r = await run({ authorization: 'Bearer ' + sign({}) });
  expect(r.next).toBe(true);
  expect(db.getUserByEmail).toHaveBeenCalledWith('sam@opal.test');
  expect(r.req.user.role).toBe('therapist');
  expect(r.req.authVia).toBe('entra');
});

test('no bearer header → passthrough to the session path', async () => {
  const r = await run({});
  expect(r.next).toBe(true);
  expect(r.req.user).toBeUndefined();
});

test('a token is refused when unconfigured, forged, expired, for another audience, or from another tenant', async () => {
  db.getUserByEmail.mockResolvedValue({ id: 'u1', email: 'sam@opal.test', role: 'therapist', is_active: true, account_status: 'active' });
  delete process.env.OPAL_ASSIST_ENTRA_CLIENT_ID;
  expect((await run({ authorization: 'Bearer ' + sign({}) })).body.code).toBe('entra_not_configured');
  process.env.OPAL_ASSIST_ENTRA_CLIENT_ID = CLIENT;

  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  expect((await run({ authorization: 'Bearer ' + sign({}, { key: other }) })).body.code).toBe('bad_signature');
  expect((await run({ authorization: 'Bearer ' + sign({ exp: Math.floor(Date.now() / 1000) - 600 }) })).body.code).toBe('expired');
  expect((await run({ authorization: 'Bearer ' + sign({ aud: 'someone-else' }) })).body.code).toBe('bad_audience');
  expect((await run({ authorization: 'Bearer ' + sign({ tid: 'ffffffff-0000-4000-8000-000000000000', iss: 'https://login.microsoftonline.com/ffffffff-0000-4000-8000-000000000000/v2.0' }) })).body.code).toBe('bad_issuer');
  expect((await run({ authorization: 'Bearer ' + sign({}, { alg: 'none' }) })).body.code).toBe('bad_alg');
  expect((await run({ authorization: 'Bearer not.a.token.at.all' })).body.code).toBe('malformed');
});

test('a valid token for an unknown, inactive or not-ready account never signs in', async () => {
  db.getUserByEmail.mockResolvedValue(null);
  expect((await run({ authorization: 'Bearer ' + sign({}) })).body.code).toBe('entra_no_account');
  db.getUserByEmail.mockResolvedValue({ id: 'u1', role: 'therapist', is_active: false });
  expect((await run({ authorization: 'Bearer ' + sign({}) })).body.code).toBe('entra_no_account');
  db.getUserByEmail.mockResolvedValue({ id: 'u1', role: 'pre_employee', is_active: true, account_status: 'active' });
  expect((await run({ authorization: 'Bearer ' + sign({}) })).body.code).toBe('entra_account_not_ready');
  db.getUserByEmail.mockResolvedValue({ id: 'u1', role: 'owner', is_active: true, must_change_password: true });
  expect((await run({ authorization: 'Bearer ' + sign({}) })).body.code).toBe('entra_account_not_ready');
});

test('api://client-id audience is accepted; an unknown key id is refused after one refresh', async () => {
  db.getUserByEmail.mockResolvedValue({ id: 'u1', email: 'sam@opal.test', role: 'admin', is_active: true, account_status: 'active' });
  expect((await run({ authorization: 'Bearer ' + sign({ aud: `api://${CLIENT}` }) })).next).toBe(true);
  expect((await run({ authorization: 'Bearer ' + sign({}, { kid: 'kid-9' }) })).body.code).toBe('unknown_kid');
});
