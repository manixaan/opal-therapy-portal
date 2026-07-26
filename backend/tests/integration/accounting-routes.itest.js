'use strict';

/**
 * Accounting module integration tests — real Express routes, real sessions,
 * real SQL. Focus: owner-only RBAC on every route, fail-closed write flags,
 * candidate lifecycle, and no session-switch on Xero OAuth. Xero's HTTP API
 * is mocked; everything else is real.
 */

jest.mock('../../xero-api', () => {
  const actual = jest.requireActual('../../xero-api');
  return {
    ...actual,
    isConfigured: jest.fn(() => true),
    exchangeCodeForTokens: jest.fn(),
    getConnections: jest.fn(),
    apiGet: jest.fn(),
    apiGetAll: jest.fn(),
    ensureValidToken: jest.fn(async () => 'plaintext-access-token'),
  };
});

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const xeroApi = require('../../xero-api');
const { db, truncateAll, seedUser, closePool } = require('./helpers');
const adb = require('../../accounting-db');

const PASSWORD = 'AcctPass1';

function buildApp() {
  const app = express();
  app.use(bodyParser.json());
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../accounting-routes'));
  return app;
}

async function agentFor(app, role) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser({ password_hash: hash, role });
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user };
}

beforeEach(async () => {
  await truncateAll();
  jest.clearAllMocks();
  xeroApi.isConfigured.mockReturnValue(true);
  require('../../auth')._resetLoginRateLimit(); // many logins per file, same IP
});
afterAll(closePool);

describe('RBAC — owner only', () => {
  const routes = [
    ['get', '/api/accounting/xero/status'],
    ['get', '/api/accounting/dashboard'],
    ['get', '/api/accounting/candidates'],
    ['post', '/api/accounting/xero/sync'],
    ['get', '/api/accounting/reconciliation'],
    ['get', '/api/accounting/pricing-rules'],
  ];

  test('non-owner roles are denied every accounting route', async () => {
    const app = buildApp();
    for (const role of ['admin', 'therapist', 'read_only']) {
      const { agent } = await agentFor(app, role);
      for (const [method, path] of routes) {
        const res = await agent[method](path);
        expect([401, 403]).toContain(res.status); // never 200
      }
    }
  });

  test('unauthenticated is denied', async () => {
    const app = buildApp();
    for (const [method, path] of routes) {
      const res = await request(app)[method](path);
      expect(res.status).toBe(401);
    }
  });

  test('owner is allowed (200 even when not yet connected)', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app, 'owner');
    const status = await agent.get('/api/accounting/xero/status');
    expect(status.status).toBe(200);
    expect(status.body.connected).toBe(false);
    expect(status.body.flags.xeroWrite).toBe(false);
  });
});

describe('OAuth connect — no session switch, tokens to org', () => {
  test('connect returns authUrl and stores state', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app, 'owner');
    const res = await agent.get('/api/accounting/xero/connect');
    expect(res.status).toBe(200);
    expect(res.body.authUrl).toContain('login.xero.com');
  });

  test('callback attaches tokens to the org and keeps the session user', async () => {
    process.env.NODE_ENV = 'test';
    xeroApi.exchangeCodeForTokens.mockResolvedValue({
      accessToken: 'at', refreshToken: 'rt', expiresIn: 1800, expiresAt: new Date(Date.now() + 1800000),
    });
    xeroApi.getConnections.mockResolvedValue([{ connectionId: 'c1', tenantId: 'tenant-xyz', tenantName: 'Demo Co', tenantType: 'ORGANISATION' }]);
    xeroApi.apiGet.mockResolvedValue({ Organisations: [{ BaseCurrency: 'AUD' }] });

    const app = buildApp();
    const { agent, user } = await agentFor(app, 'owner');
    // Seed the session state via connect.
    await agent.get('/api/accounting/xero/connect');
    // Grab the state the route stored by reading it back through a status call is
    // not possible; instead call callback with test-mode leniency (state check
    // is lenient in NODE_ENV=test) so a mismatched state still proceeds.
    const cb = await agent.get('/api/accounting/xero/callback?code=abc&state=whatever');
    expect(cb.status).toBe(200);
    expect(cb.text).toContain('Xero connected');

    // Token row exists on the org, encrypted, and no new user was created.
    const conn = await adb.getConnection(user.organisation_id);
    expect(conn).toBeTruthy();
    expect(conn.xero_tenant_id).toBe('tenant-xyz');
    expect(conn.access_token.startsWith('enc:')).toBe(true); // encrypted at rest
    const users = await db.pool.query('SELECT COUNT(*) FROM users');
    expect(Number(users.rows[0].count)).toBe(1); // no Xero-email auto-provisioning

    // Session user unchanged.
    const me = await agent.get('/api/accounting/xero/status');
    expect(me.status).toBe(200);
    expect(me.body.connected).toBe(true);
    expect(me.body.organisation.name).toBe('Demo Co');
  });

  test('callback with wrong role is 403', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app, 'therapist');
    const res = await agent.get('/api/accounting/xero/callback?code=abc&state=s');
    expect(res.status).toBe(403);
    expect(xeroApi.exchangeCodeForTokens).not.toHaveBeenCalled();
  });

  test('invalid state in staging is 403 before token exchange', async () => {
    process.env.NODE_ENV = 'staging';
    const app = buildApp();
    const { agent } = await agentFor(app, 'owner');
    await agent.get('/api/accounting/xero/connect');
    const res = await agent.get('/api/accounting/xero/callback?code=abc&state=forged');
    expect(res.status).toBe(403);
    expect(xeroApi.exchangeCodeForTokens).not.toHaveBeenCalled();
    process.env.NODE_ENV = 'test';
  });
});

describe('write flags fail closed', () => {
  async function connectOrg(user) {
    return adb.upsertConnection({
      organisationId: user.organisation_id, tenantId: 't1', tenantName: 'T', tenantType: 'ORGANISATION',
      connectedByUserId: user.id, accessToken: 'at', refreshToken: 'rt', tokenExpiresAt: new Date(Date.now() + 1e6), baseCurrency: 'AUD',
    });
  }

  test('draft invoice creation is 403 while flag off — even for owner, even with a valid candidate', async () => {
    delete process.env.ENABLE_XERO_WRITE;
    delete process.env.ENABLE_XERO_DRAFT_INVOICE_CREATE;
    const app = buildApp();
    const { agent, user } = await agentFor(app, 'owner');
    await connectOrg(user);
    const cand = await adb.upsertCandidate({
      organisationId: user.organisation_id, sploseAppointmentId: 'appt-1', xeroContactId: 'xc-1',
      status: 'approved_for_draft', totalAmount: 100,
    }, [{ description: 'x', quantity: 1, unitAmount: 100, accountCode: '200' }]);

    const res = await agent.post(`/api/accounting/candidates/${cand.id}/create-draft-invoice`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('draft_create_disabled');
  });

  test('with flags on, an unapproved candidate is still rejected (validation gauntlet)', async () => {
    process.env.ENABLE_XERO_WRITE = 'true';
    process.env.ENABLE_XERO_DRAFT_INVOICE_CREATE = 'true';
    const app = buildApp();
    const { agent, user } = await agentFor(app, 'owner');
    await connectOrg(user);
    const cand = await adb.upsertCandidate({
      organisationId: user.organisation_id, sploseAppointmentId: 'appt-2', xeroContactId: 'xc-1',
      status: 'ready_for_review', totalAmount: 100,   // NOT approved_for_draft
    }, [{ description: 'x', quantity: 1, unitAmount: 100, accountCode: '200' }]);
    const res = await agent.post(`/api/accounting/candidates/${cand.id}/create-draft-invoice`);
    expect(res.status).toBe(400);
    delete process.env.ENABLE_XERO_WRITE;
    delete process.env.ENABLE_XERO_DRAFT_INVOICE_CREATE;
  });
});

describe('candidate review + reconciliation decisions are audited', () => {
  test('review updates status and writes audit', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app, 'owner');
    const cand = await adb.upsertCandidate({
      organisationId: user.organisation_id, sploseAppointmentId: 'appt-3', status: 'ready_for_review', totalAmount: 50,
    }, []);
    const res = await agent.post(`/api/accounting/candidates/${cand.id}/review`).send({ status: 'approved_for_draft' });
    expect(res.status).toBe(200);
    expect(res.body.candidate.status).toBe('approved_for_draft');
    const audit = await db.pool.query("SELECT COUNT(*) FROM audit_logs WHERE action='finance.candidate_reviewed'");
    expect(Number(audit.rows[0].count)).toBe(1);
  });
});

describe('webhook signature enforcement', () => {
  test('handler rejects when webhooks flag off (404) and on bad signature (401)', async () => {
    const { xeroWebhookHandler } = require('../../accounting-routes');
    // Flag off → 404
    delete process.env.ENABLE_XERO_WEBHOOKS;
    let statusCode; const res1 = { status(c) { statusCode = c; return this; }, end() {} };
    xeroWebhookHandler({ get: () => '', body: Buffer.from('{}') }, res1);
    expect(statusCode).toBe(404);

    // Flag on, bad signature → 401
    process.env.ENABLE_XERO_WEBHOOKS = 'true';
    process.env.XERO_WEBHOOK_KEY = 'secret';
    const res2 = { status(c) { statusCode = c; return this; }, end() {} };
    xeroWebhookHandler({ get: () => 'wrong', body: Buffer.from('{}') }, res2);
    expect(statusCode).toBe(401);
    delete process.env.ENABLE_XERO_WEBHOOKS;
    delete process.env.XERO_WEBHOOK_KEY;
  });
});
