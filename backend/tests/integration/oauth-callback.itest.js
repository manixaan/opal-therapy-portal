'use strict';

/**
 * OAuth-callback session-attachment regression tests (staging onboarding-loop
 * bug). The callback previously matched users by MICROSOFT email, auto-created
 * a second account for shared mailboxes, and switched the session onto it —
 * resetting onboarding to Step 1. These tests pin the repaired contract:
 *
 *   - tokens attach to the SESSION user, never a mailbox-matched user
 *   - the session is never switched
 *   - no account is auto-created outside development/test
 *   - onboarding progress survives connect / refresh / re-login
 *   - invalid state is rejected before any token exchange
 *   - reconnecting replaces tokens without duplicates
 *
 * Microsoft's token/user endpoints are mocked; everything else (HTTP,
 * sessions, SQL) is real.
 */

jest.mock('../../outlook-oauth', () => {
  const actual = jest.requireActual('../../outlook-oauth');
  return {
    ...actual,
    getAccessToken: jest.fn(),
    getMicrosoftUser: jest.fn(),
  };
});

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const outlookApi = require('../../outlook-oauth');
const { db, truncateAll, seedUser, closePool } = require('./helpers');

const PASSWORD = 'CallbackPass1';
const MAILBOX = 'shared.mailbox@example.test'; // ≠ any portal email

function buildApp() {
  const app = express();
  app.use(bodyParser.json());
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../routes'));
  app.use('/', require('../../register-routes'));
  return app;
}

async function agentFor(app, overrides) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser({ password_hash: hash, ...overrides });
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user };
}

/** Start the OAuth flow so the session holds a real state, return it. */
async function beginOauth(agent) {
  const r = await agent.get('/auth/outlook-login');
  expect(r.status).toBe(200);
  const url = new URL(r.body.authUrl);
  return url.searchParams.get('state');
}

function mockMicrosoft() {
  outlookApi.getAccessToken.mockResolvedValue({
    accessToken: 'mock-access-token-value',
    refreshToken: 'mock-refresh-token-value',
    expiresIn: 3600,
  });
  outlookApi.getMicrosoftUser.mockResolvedValue({
    id: 'ms-id-shared-mailbox',
    email: MAILBOX,
    displayName: 'Shared Mailbox',
  });
}

beforeEach(async () => { await truncateAll(); jest.clearAllMocks(); mockMicrosoft(); });
afterAll(closePool);

describe('portal-first connection (session user)', () => {
  test('1+2: tokens + mailbox address persist on the SESSION user; status endpoints report them', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app, { role: 'owner' });
    const state = await beginOauth(agent);

    const cb = await agent.get(`/auth/oauth/callback?code=mock-code&state=${encodeURIComponent(state)}`);
    expect(cb.status).toBe(200); // success page

    const row = (await db.pool.query(
      'SELECT email, (access_token IS NOT NULL) AS has_token, outlook_connected_email FROM users WHERE id=$1',
      [user.id])).rows[0];
    expect(row.has_token).toBe(true);
    expect(row.outlook_connected_email).toBe(MAILBOX);

    const me = await agent.get('/auth/user');
    expect(me.body.email).toBe(user.email); // session NOT switched
    expect(me.body.hasOutlookTokens).toBe(true);
    expect(me.body.outlookConnectedEmail).toBe(MAILBOX);
  });

  test('7: no account is created for the mailbox email; other users untouched', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app, { role: 'owner' });
    const { user: other } = await agentFor(app, { role: 'therapist' });
    const state = await beginOauth(agent);
    await agent.get(`/auth/oauth/callback?code=c&state=${encodeURIComponent(state)}`);

    const mailboxUser = await db.pool.query('SELECT 1 FROM users WHERE email=$1', [MAILBOX]);
    expect(mailboxUser.rows).toHaveLength(0);
    const otherRow = (await db.pool.query(
      'SELECT (access_token IS NOT NULL) AS has_token FROM users WHERE id=$1', [other.id])).rows[0];
    expect(otherRow.has_token).toBe(false);
  });

  test('3+4: onboarding progress survives the connect and a refresh-equivalent reload', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app, { role: 'owner' });
    await agent.post('/api/auth/complete-onboarding-step').send({ step: 'profile', data: {} });
    await agent.post('/api/auth/complete-onboarding-step').send({ step: 'professional', data: {} });

    const state = await beginOauth(agent);
    await agent.get(`/auth/oauth/callback?code=c&state=${encodeURIComponent(state)}`);
    await agent.post('/api/auth/complete-onboarding-step').send({ step: 'outlook', data: { connected: true } });

    for (let reload = 0; reload < 2; reload++) { // second pass = "refresh"
      const ob = await agent.get('/api/auth/onboarding');
      expect(ob.status).toBe(200);
      expect(ob.body.user.email).toBe(user.email);
      expect(ob.body.user.onboardingCompletedSteps).toEqual(
        expect.arrayContaining(['profile', 'professional', 'outlook']));
      expect(ob.body.user.hasOutlookConnected).toBe(true);
    }
  });

  test('5: progress and connection survive logout + fresh login', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app, { role: 'owner' });
    await agent.post('/api/auth/complete-onboarding-step').send({ step: 'profile', data: {} });
    const state = await beginOauth(agent);
    await agent.get(`/auth/oauth/callback?code=c&state=${encodeURIComponent(state)}`);
    await agent.post('/api/auth/logout');

    const fresh = request.agent(app);
    const login = await fresh.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
    expect(login.status).toBe(200);
    const ob = await fresh.get('/api/auth/onboarding');
    expect(ob.body.user.onboardingCompletedSteps).toContain('profile');
    expect(ob.body.user.hasOutlookConnected).toBe(true);
    expect(ob.body.user.outlookConnectedEmail).toBe(MAILBOX);
  });

  test('8: reconnecting replaces tokens without duplicate accounts or arrays', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app, { role: 'owner' });

    for (let i = 0; i < 2; i++) {
      const state = await beginOauth(agent);
      const cb = await agent.get(`/auth/oauth/callback?code=c${i}&state=${encodeURIComponent(state)}`);
      expect(cb.status).toBe(200);
      await agent.post('/api/auth/complete-onboarding-step').send({ step: 'outlook', data: { connected: true } });
    }

    const users = await db.pool.query('SELECT COUNT(*) FROM users');
    expect(Number(users.rows[0].count)).toBe(1); // just the portal user
    const row = (await db.pool.query(
      'SELECT onboarding_completed_steps AS s FROM users WHERE id=$1', [user.id])).rows[0];
    const outlookEntries = row.s.filter((x) => x === 'outlook');
    expect(outlookEntries).toHaveLength(1); // dedupe guard
  });
});

describe('strict environments (staging/production semantics)', () => {
  afterEach(() => { process.env.NODE_ENV = 'test'; });

  test('6: state mismatch → 403 BEFORE any token exchange', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app, { role: 'owner' });
    await beginOauth(agent); // real state stored in session
    process.env.NODE_ENV = 'staging';
    const cb = await agent.get('/auth/oauth/callback?code=c&state=forged-state');
    expect(cb.status).toBe(403);
    expect(outlookApi.getAccessToken).not.toHaveBeenCalled();
  });

  test('9: valid state but no signed-in portal user → 401, no auto-created account', async () => {
    const app = buildApp();
    const anon = request.agent(app); // never logs in
    const state = await beginOauth(anon); // outlook-login is public; sets session state
    process.env.NODE_ENV = 'staging';
    const cb = await anon.get(`/auth/oauth/callback?code=c&state=${encodeURIComponent(state)}`);
    expect(cb.status).toBe(401);
    const users = await db.pool.query('SELECT COUNT(*) FROM users');
    expect(Number(users.rows[0].count)).toBe(0); // nothing provisioned
  });
});

describe('frontend contract (10)', () => {
  test('onboarding payload carries everything the wizard needs to resume', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app, { role: 'owner' });
    await agent.post('/api/auth/complete-onboarding-step').send({ step: 'profile', data: {} });
    await agent.post('/api/auth/complete-onboarding-step').send({ step: 'outlook', data: {}, skipped: true });

    const ob = await agent.get('/api/auth/onboarding');
    const u = ob.body.user;
    expect(Array.isArray(u.onboardingCompletedSteps)).toBe(true);
    expect(Array.isArray(u.onboardingSkippedSteps)).toBe(true);
    expect(u.onboardingCompletedSteps).toContain('profile');
    expect(u.onboardingSkippedSteps).toContain('outlook');
    expect(typeof u.onboardingStep).toBe('string');
    expect(u).toHaveProperty('hasOutlookConnected');
    expect(u).toHaveProperty('outlookConnectedEmail');
  });
});
