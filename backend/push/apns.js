'use strict';

/**
 * APNS — push to the Opa iPhone app, straight to Apple. No third-party push
 * service sits in between, so nothing about a notification leaves the portal
 * except to Apple.
 *
 * Token-based auth (.p8 key): an ES256 JWT signed with node:crypto, reused
 * for 50 minutes (Apple accepts 20–60). HTTP/2 via node:http2. No dependency.
 *
 * Configuration — all four or nothing (inert, `configured()` false):
 *   APNS_KEY_P8     the .p8 file's contents, PEM or base64 of the PEM
 *   APNS_KEY_ID     the key's 10-character id
 *   APNS_TEAM_ID    the Apple developer team id
 *   APNS_BUNDLE_ID  the app's bundle id (the apns-topic)
 *
 * Content rule (MOBILE_SECURITY_MODEL.md §5): a notification never carries a
 * client's name, address or anything clinical. Callers build the text; this
 * module refuses a payload over 1 KB as a backstop and never logs the text.
 */

const crypto = require('crypto');
const http2 = require('http2');
const log = require('../logger').createLogger('apns');

const HOSTS = {
  production: 'https://api.push.apple.com',
  sandbox: 'https://api.sandbox.push.apple.com',
};
const JWT_TTL_MS = 50 * 60 * 1000;
const MAX_PAYLOAD = 1024;

function config() {
  const raw = process.env.APNS_KEY_P8 || '';
  const keyId = (process.env.APNS_KEY_ID || '').trim();
  const teamId = (process.env.APNS_TEAM_ID || '').trim();
  const bundleId = (process.env.APNS_BUNDLE_ID || '').trim();
  if (!raw || !keyId || !teamId || !bundleId) return null;
  const pem = raw.includes('BEGIN PRIVATE KEY') ? raw.replace(/\\n/g, '\n')
    : Buffer.from(raw.trim(), 'base64').toString('utf8');
  return { pem, keyId, teamId, bundleId };
}

function configured() { return !!config(); }

let cachedJwt = null; // { token, at, keyId }

const b64url = (buf) => Buffer.from(buf).toString('base64')
  .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

function providerToken(cfg, now = Date.now()) {
  if (cachedJwt && cachedJwt.keyId === cfg.keyId && now - cachedJwt.at < JWT_TTL_MS) return cachedJwt.token;
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: cfg.keyId }));
  const claims = b64url(JSON.stringify({ iss: cfg.teamId, iat: Math.floor(now / 1000) }));
  const signature = crypto.sign('sha256', Buffer.from(`${header}.${claims}`),
    { key: cfg.pem, dsaEncoding: 'ieee-p1363' });
  const token = `${header}.${claims}.${b64url(signature)}`;
  cachedJwt = { token, at: now, keyId: cfg.keyId };
  return token;
}

const sessions = {};
function sessionFor(environment) {
  const host = HOSTS[environment] || HOSTS.production;
  const s = sessions[host];
  if (s && !s.closed && !s.destroyed) return s;
  const fresh = http2.connect(host);
  fresh.on('error', (err) => log.warn('apns connection error', { error: err.message }));
  fresh.unref();
  sessions[host] = fresh;
  return fresh;
}

/**
 * Send one notification. Resolves { ok, status, reason, gone } — never
 * throws. `gone` = Apple says this token is finished (410, or 400
 * BadDeviceToken / DeviceTokenNotForTopic): the caller disables it.
 */
function send(device, { title, body, data = {}, collapseId = null, threadId = null }) {
  const cfg = config();
  if (!cfg) return Promise.resolve({ ok: false, status: 0, reason: 'not_configured', gone: false });
  const payload = JSON.stringify({
    aps: { alert: { title, body }, sound: 'default', ...(threadId ? { 'thread-id': threadId } : {}) },
    // expo-notifications hands a remote notification's `body` key to the app
    // as `content.data` — where the tap's destination is read from.
    body: data,
  });
  if (Buffer.byteLength(payload) > MAX_PAYLOAD) {
    return Promise.resolve({ ok: false, status: 0, reason: 'payload_too_large', gone: false });
  }
  return new Promise((resolve) => {
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; resolve(r); } };
    try {
      const headers = {
        ':method': 'POST',
        ':path': `/3/device/${device.token}`,
        authorization: `bearer ${providerToken(cfg)}`,
        'apns-topic': cfg.bundleId,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        ...(collapseId ? { 'apns-collapse-id': String(collapseId).slice(0, 64) } : {}),
      };
      const req = sessionFor(device.environment).request(headers);
      let status = 0;
      let text = '';
      req.setEncoding('utf8');
      req.on('response', (h) => { status = Number(h[':status']) || 0; });
      req.on('data', (c) => { text += c; });
      req.on('end', () => {
        let reason = null;
        try { reason = text ? JSON.parse(text).reason || null : null; } catch (_) { /* no body */ }
        const gone = status === 410 || reason === 'BadDeviceToken'
          || reason === 'DeviceTokenNotForTopic' || reason === 'Unregistered';
        done({ ok: status === 200, status, reason, gone });
      });
      req.on('error', (err) => done({ ok: false, status: 0, reason: err.code || 'request_error', gone: false }));
      req.setTimeout(10000, () => { req.close(); done({ ok: false, status: 0, reason: 'timeout', gone: false }); });
      req.end(payload);
    } catch (err) {
      done({ ok: false, status: 0, reason: 'send_failed', gone: false });
    }
  });
}

module.exports = { configured, send, _providerToken: providerToken, _resetForTests: () => { cachedJwt = null; } };
