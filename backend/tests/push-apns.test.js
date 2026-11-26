'use strict';

/**
 * push/apns.js — the provider JWT Apple checks, and the fail-closed edges.
 * No network: nothing here reaches send()'s HTTP/2 request.
 */

const crypto = require('crypto');

const ENV = ['APNS_KEY_P8', 'APNS_KEY_ID', 'APNS_TEAM_ID', 'APNS_BUNDLE_ID'];
let apns;
let publicKey;

beforeEach(() => {
  jest.resetModules();
  const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  publicKey = pair.publicKey;
  process.env.APNS_KEY_P8 = Buffer.from(pair.privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64');
  process.env.APNS_KEY_ID = 'ABC123DEFG';
  process.env.APNS_TEAM_ID = 'MQ7JVUHWM9';
  process.env.APNS_BUNDLE_ID = 'au.com.opaltherapy.opa';
  apns = require('../push/apns');
});
afterEach(() => ENV.forEach((k) => delete process.env[k]));

const unb64 = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

test('the provider token is an ES256 JWT Apple can verify, reused within its life', () => {
  const now = Date.parse('2026-11-25T00:00:00Z');
  const token = apns._providerToken({ pem: unb64(process.env.APNS_KEY_P8).toString(), keyId: 'ABC123DEFG', teamId: 'MQ7JVUHWM9' }, now);
  const [h, c, sig] = token.split('.');
  expect(JSON.parse(unb64(h))).toEqual({ alg: 'ES256', kid: 'ABC123DEFG' });
  expect(JSON.parse(unb64(c))).toEqual({ iss: 'MQ7JVUHWM9', iat: now / 1000 });
  expect(crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, unb64(sig))).toBe(true);
  expect(apns._providerToken({ pem: '', keyId: 'ABC123DEFG', teamId: 'x' }, now + 60000)).toBe(token);
});

test('unconfigured is inert: nothing sent, no throw', async () => {
  delete process.env.APNS_KEY_ID;
  expect(apns.configured()).toBe(false);
  await expect(apns.send({ token: 'ab', environment: 'production' }, { title: 't', body: 'b' }))
    .resolves.toEqual(expect.objectContaining({ ok: false, reason: 'not_configured' }));
});

test('an oversized payload is refused before anything is sent', async () => {
  const r = await apns.send({ token: 'ab', environment: 'production' }, { title: 't', body: 'x'.repeat(2000) });
  expect(r).toEqual(expect.objectContaining({ ok: false, reason: 'payload_too_large' }));
});
