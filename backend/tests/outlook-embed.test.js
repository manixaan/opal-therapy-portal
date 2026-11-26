'use strict';

/**
 * The Outlook app-bar tab (outlook-embed.js): a second, partitioned
 * SameSite=None session issued only by a Microsoft SSO exchange, with its
 * own CSRF and framing rules. These tests pin the guards, not just the
 * happy path: no embed session when the feature is off, no session for a
 * refused token or account, no cross-site writes, no framing outside it.
 */

jest.mock('../assist/entra-auth', () => ({
  isConfigured: jest.fn(() => true),
  validate: jest.fn(),
  resolveAccount: jest.fn(),
  refusalCode: jest.fn((e) => e.message),
}));

const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const request = require('supertest');
const entra = require('../assist/entra-auth');
const embed = require('../outlook-embed');

const db = { logAuditEvent: jest.fn(async () => {}), recordLogin: jest.fn(async () => {}) };
const HTTPS = { 'X-Forwarded-Proto': 'https' };
const SAME = { ...HTTPS, 'Sec-Fetch-Site': 'same-origin' };

function makeApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'self'"], frameAncestors: ["'self'"] } } }));
  app.use(express.json());
  const store = new session.MemoryStore();
  const normal = session({ store, secret: 's', resave: false, saveUninitialized: false, cookie: { sameSite: 'lax', httpOnly: true } });
  app.use(embed.createSessionDispatcher({ session, normal, normalStore: store, embedStore: new session.MemoryStore(), secret: 's', ttlMs: 60000 }));
  app.use(embed.embedGuards);
  app.post('/test/normal-login', (req, res) => { req.session.userId = 'n1'; res.json({ ok: true }); });
  // The real password sign-in regenerates the session (auth.js) — the path
  // that picked up the embed cookie's options when the store was shared.
  app.post('/test/normal-login-regenerate', (req, res) => req.session.regenerate(() => {
    req.session.userId = 'n1'; res.json({ ok: true });
  }));
  app.use('/', embed.createRouter({ frontendPath: __dirname, db }));
  app.get('/whoami', (req, res) => res.json({ userId: req.session && req.session.userId || null, embed: !!req.isEmbed }));
  app.post('/write', (req, res) => res.json({ ok: true }));
  return app;
}

const cookieOf = (res, name) => (res.headers['set-cookie'] || []).find((c) => c.startsWith(name + '='));

beforeEach(() => {
  process.env.OPAL_OUTLOOK_TAB_ENABLED = 'true';
  entra.isConfigured.mockReturnValue(true);
  entra.validate.mockReset();
  entra.resolveAccount.mockReset();
  db.logAuditEvent.mockClear();
  db.recordLogin.mockClear();
});

async function signIn(app) {
  entra.validate.mockResolvedValue({ preferred_username: 'sam@opal.test' });
  entra.resolveAccount.mockResolvedValue({ user: { id: 'u1', role: 'therapist', organisation_id: 'o1' } });
  const res = await request(app).post(embed.EXCHANGE_PATH).set(SAME).send({ token: 'tok' });
  return { res, cookie: cookieOf(res, embed.EMBED_COOKIE) };
}

test('a valid Microsoft token gets a partitioned SameSite=None session, audited, and the session works', async () => {
  const app = makeApp();
  const { res, cookie } = await signIn(app);
  expect(res.status).toBe(200);
  expect(cookie).toMatch(/SameSite=None/i);
  expect(cookie).toMatch(/Secure/);
  expect(cookie).toMatch(/Partitioned/);
  expect(cookie).toMatch(/HttpOnly/);
  expect(cookieOf(res, 'connect.sid')).toBeUndefined();
  expect(db.logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'login_success', actorUserId: 'u1', metadata: { via: 'outlook_tab' } }));

  const who = await request(app).get('/whoami').set(HTTPS).set('Cookie', cookie.split(';')[0]);
  expect(who.body).toEqual({ userId: 'u1', embed: true });
});

test('feature off: no exchange, and an embed cookie is ignored (ordinary session path)', async () => {
  const app = makeApp();
  const { cookie } = await signIn(app);
  process.env.OPAL_OUTLOOK_TAB_ENABLED = 'false';
  const r = await request(app).post(embed.EXCHANGE_PATH).set(SAME).send({ token: 'tok' });
  expect(r.status).toBe(404);
  expect(r.body.code).toBe('outlook_tab_disabled');
  const who = await request(app).get('/whoami').set(HTTPS).set('Cookie', cookie.split(';')[0]);
  expect(who.body).toEqual({ userId: null, embed: false });
});

test('feature needs the Entra settings too', async () => {
  entra.isConfigured.mockReturnValue(false);
  const r = await request(makeApp()).post(embed.EXCHANGE_PATH).set(SAME).send({ token: 'tok' });
  expect(r.status).toBe(404);
});

test('a refused token or account never gets a session, and the refusal is audited', async () => {
  const app = makeApp();
  entra.validate.mockRejectedValue(new Error('bad_signature'));
  let r = await request(app).post(embed.EXCHANGE_PATH).set(SAME).send({ token: 'forged' });
  expect(r.status).toBe(401);
  expect(r.body.code).toBe('bad_signature');
  expect(cookieOf(r, embed.EMBED_COOKIE)).toBeUndefined();
  expect(db.logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'login_failed', metadata: { via: 'outlook_tab', reason: 'bad_signature' } }));

  entra.validate.mockResolvedValue({ preferred_username: 'pre@opal.test' });
  entra.resolveAccount.mockResolvedValue({ status: 403, code: 'entra_account_not_ready', error: 'x' });
  r = await request(app).post(embed.EXCHANGE_PATH).set(SAME).send({ token: 'tok' });
  expect(r.status).toBe(403);
  expect(cookieOf(r, embed.EMBED_COOKIE)).toBeUndefined();

  r = await request(app).post(embed.EXCHANGE_PATH).set(SAME).send({});
  expect(r.status).toBe(400);
});

test('embed sessions refuse writes that are not same-origin (CSRF), including the exchange', async () => {
  const app = makeApp();
  const { cookie } = await signIn(app);
  const c = cookie.split(';')[0];
  expect((await request(app).post('/write').set(HTTPS).set('Cookie', c).set('Sec-Fetch-Site', 'cross-site')).status).toBe(403);
  expect((await request(app).post('/write').set(HTTPS).set('Cookie', c)).status).toBe(403); // header missing → deny
  expect((await request(app).post('/write').set(SAME).set('Cookie', c)).status).toBe(200);
  expect((await request(app).post(embed.EXCHANGE_PATH).set(HTTPS).set('Sec-Fetch-Site', 'cross-site').send({ token: 't' })).status).toBe(403);
});

test('only embed requests may be framed by Microsoft 365; ordinary ones keep frame-ancestors self', async () => {
  const app = makeApp();
  const plain = await request(app).get('/whoami').set(HTTPS);
  expect(plain.headers['content-security-policy']).toMatch(/frame-ancestors 'self'(;|$)/);
  expect(plain.headers['x-frame-options']).toBe('SAMEORIGIN');

  const { cookie } = await signIn(app);
  const framed = await request(app).get('/whoami').set(HTTPS).set('Cookie', cookie.split(';')[0]);
  expect(framed.headers['content-security-policy']).toContain('https://*.office.com');
  expect(framed.headers['content-security-policy']).toContain('https://*.microsoft365.com');
  expect(framed.headers['content-security-policy']).toContain("default-src 'self'");
  expect(framed.headers['x-frame-options']).toBeUndefined();
});

test('the ordinary Lax session wins whenever its cookie is present', async () => {
  const app = makeApp();
  const { cookie } = await signIn(app);
  const n = await request(app).post('/test/normal-login').set(HTTPS);
  const normal = cookieOf(n, 'connect.sid').split(';')[0];
  const who = await request(app).get('/whoami').set(HTTPS).set('Cookie', `${normal}; ${cookie.split(';')[0]}`);
  expect(who.body).toEqual({ userId: 'n1', embed: false });
});

test('a framed navigation is recognised only when the feature is on', () => {
  const req = (dest) => ({ get: (h) => (h === 'sec-fetch-dest' ? dest : undefined) });
  expect(embed.isFramedNavigation(req('iframe'))).toBe(true);
  expect(embed.isFramedNavigation(req('document'))).toBe(false);
  process.env.OPAL_OUTLOOK_TAB_ENABLED = 'false';
  expect(embed.isFramedNavigation(req('iframe'))).toBe(false);
});

test('the Teams SDK is pinned by exact version and integrity hash', () => {
  expect(embed.TEAMS_JS.src).toMatch(/^https:\/\/res\.cdn\.office\.net\/teams-js\/\d+\.\d+\.\d+\//);
  expect(embed.TEAMS_JS.integrity).toMatch(/^sha384-/);
});

test('a regenerated ordinary session keeps its own Lax cookie — over http too', async () => {
  const app = makeApp();
  await signIn(app); // the embed middleware has run at least once
  const res = await request(app).post('/test/normal-login-regenerate');
  const cookie = cookieOf(res, 'connect.sid');
  expect(cookie).toBeDefined();
  expect(cookie).toMatch(/SameSite=Lax/i);
  expect(cookie).not.toMatch(/SameSite=None|Partitioned|Secure/i);
});

test('sharing one store between the two sessions is refused', () => {
  const store = new session.MemoryStore();
  expect(() => embed.createSessionDispatcher({ session, normal: () => {}, normalStore: store, embedStore: store, secret: 's', ttlMs: 1 }))
    .toThrow(/own store/);
});
