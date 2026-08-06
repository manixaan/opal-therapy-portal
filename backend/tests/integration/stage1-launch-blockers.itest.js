'use strict';

/**
 * STAGE 1 LAUNCH BLOCKERS — integration tests.
 *
 * Pins the audit fixes:
 *   A. Splose proxy RBAC (C1): read_only denied everywhere; therapist
 *      practitioner-scoped + fail-closed without a mapping; whole-practice
 *      PII/financial routes owner/admin-only.
 *   B. Splose write gates (C2): every write 403s with flags off — including
 *      the previously flag-bypassing POST /api/splose/patients — for EVERY
 *      role including owner.
 *   C. permissions choke point (H3): routes.js now uses permissions.requireAuth,
 *      so read_only cannot write local events.
 *   D. Invite/email links: registerUrl built from APP_BASE_URL (never
 *      localhost when set), emailSkipped surfaced, audited link retrieval,
 *      invite creation stays owner/admin-only.
 *
 * Splose READ functions are mocked (no network); WRITE functions are the
 * REAL implementations so the flag gates themselves are what pass the tests.
 * No real Splose write can occur: flags are unset (fail-closed) in tests.
 */

jest.mock('../../splose-api', () => {
  const actual = jest.requireActual('../../splose-api');
  return {
    ...actual, // real createAppointment/updateAppointment/createBusyTime/createPatient (flag-gated)
    testConnection: jest.fn(async () => ({ connected: true })),
    getPatients: jest.fn(async () => [{ id: 'sp-1', firstname: 'Pat', lastname: 'One' }]),
    getPatient: jest.fn(async () => ({ id: 'sp-1' })),
    getAppointments: jest.fn(async () => []),
    getAppointment: jest.fn(async () => ({ id: 'appt-1', practitionerId: 'prac-ann' })),
    getSupportItems: jest.fn(async () => []),
    getLocations: jest.fn(async () => []),
    getServices: jest.fn(async () => []),
    getPractitioners: jest.fn(async () => []),
    getBusyTimes: jest.fn(async () => []),
    getBusyTimeTypes: jest.fn(async () => []),
    getInvoices: jest.fn(async () => []),
    getPayments: jest.fn(async () => []),
    getContacts: jest.fn(async () => []),
    fetchAllCases: jest.fn(async () => []),
    getAvailabilities: jest.fn(async () => []),
    getSupportActivities: jest.fn(async () => []),
  };
});

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const sploseApi = require('../../splose-api');
const { db, truncateAll, seedUser, closePool } = require('./helpers');

const PASSWORD = 'Stage1Pass1';

function buildApp() {
  const app = express();
  app.use(bodyParser.json());
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../routes'));
  app.use('/', require('../../invite-routes'));
  return app;
}

async function agentFor(app, role, { withOrg = false, ...overrides } = {}) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser({ password_hash: hash, role, ...overrides });
  if (withOrg) {
    // user_invites.organisation_id is NOT NULL — invite tests need a real org
    const org = await db.pool.query(
      "INSERT INTO organisations (name) VALUES ('Stage1 Test Org') RETURNING id");
    await db.pool.query('UPDATE users SET organisation_id = $1 WHERE id = $2', [org.rows[0].id, user.id]);
    user.organisation_id = org.rows[0].id;
  }
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user };
}

/** Link a Splose practitioner id to a user (therapist mapping). */
async function linkPractitioner(userId, sploseId) {
  await db.pool.query(
    `INSERT INTO therapist_profiles (user_id, display_name, splose_practitioner_id)
     VALUES ($1, 'Test Therapist', $2)`, [userId, sploseId]);
}

const WRITE_FLAGS = ['ENABLE_SPLOSE_WRITE', 'ENABLE_OUTLOOK_WRITE', 'ENABLE_AUTOMATIC_REMOTE_DELETE'];

beforeEach(async () => {
  await truncateAll();
  jest.clearAllMocks();
  // Match the deployed posture EXPLICITLY: sync feature-flags default ON in
  // NODE_ENV=test for dev convenience, but staging/production set them to
  // the literal string 'false' — that is the state these gates must hold in.
  for (const f of WRITE_FLAGS) process.env[f] = 'false';
  delete process.env.APP_BASE_URL;
  require('../../auth')._resetLoginRateLimit();
});

afterAll(() => { for (const f of WRITE_FLAGS) delete process.env[f]; });
afterAll(closePool);

// ═══ A. Splose proxy RBAC ════════════════════════════════════════════════════

describe('Splose proxy RBAC (audit C1)', () => {
  const PII_FINANCIAL = [
    '/api/splose/patients', '/api/splose/patients/sp-1', '/api/splose/cases',
    '/api/splose/contacts', '/api/splose/invoices', '/api/splose/payments',
    '/api/splose/support-activities', '/api/splose/support-items',
    '/api/splose/dormant-cases',
  ];
  const REFERENCE = ['/api/splose/services', '/api/splose/practitioners', '/api/splose/status'];

  test('unauthenticated is 401 on every Splose route', async () => {
    const app = buildApp();
    for (const path of [...PII_FINANCIAL, ...REFERENCE, '/api/splose/appointments?startDate=2026-07-01&endDate=2026-07-02']) {
      expect((await request(app).get(path)).status).toBe(401);
    }
  });

  test('read_only is denied the ENTIRE Splose proxy — even reference data', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app, 'read_only');
    for (const path of [...PII_FINANCIAL, ...REFERENCE]) {
      const res = await agent.get(path);
      expect([403]).toContain(res.status);
    }
  });

  test('therapist cannot fetch the patient directory, invoices, payments or any whole-practice data', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app, 'therapist');
    for (const path of PII_FINANCIAL) {
      const res = await agent.get(path);
      expect(res.status).toBe(403);
    }
    expect(sploseApi.getPatients).not.toHaveBeenCalled();
    expect(sploseApi.getInvoices).not.toHaveBeenCalled();
    expect(sploseApi.getPayments).not.toHaveBeenCalled();
  });

  test('therapist WITHOUT a practitioner mapping fails closed on appointments', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app, 'therapist');
    const res = await agent.get('/api/splose/appointments?startDate=2026-07-01&endDate=2026-07-07');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('practitioner_mapping_required');
    expect(sploseApi.getAppointments).not.toHaveBeenCalled();
  });

  test('mapped therapist is FORCED to their own practitioner; requesting another id is denied', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app, 'therapist');
    await linkPractitioner(user.id, 'prac-me');

    // Requesting someone else's data → explicit denial
    const denied = await agent.get('/api/splose/appointments?startDate=2026-07-01&endDate=2026-07-07&practitionerId=prac-other');
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('practitioner_scope_denied');

    // No id (or own id) → scoped to own mapping server-side
    const ok = await agent.get('/api/splose/appointments?startDate=2026-07-01&endDate=2026-07-07');
    expect(ok.status).toBe(200);
    expect(sploseApi.getAppointments).toHaveBeenCalledWith('2026-07-01', '2026-07-07', 'prac-me');
  });

  test('mapped therapist cannot fetch another practitioner\'s single appointment', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app, 'therapist');
    await linkPractitioner(user.id, 'prac-me'); // mock appointment belongs to prac-ann
    const res = await agent.get('/api/splose/appointments/appt-1');
    expect(res.status).toBe(403);
  });

  test('owner keeps practice-wide data; admin keeps scheduling data but loses financial/PII areas (RBAC 2026-08-06)', async () => {
    const app = buildApp();
    const { agent: owner } = await agentFor(app, 'owner');
    expect((await owner.get('/api/splose/patients')).status).toBe(200);
    expect((await owner.get('/api/splose/invoices')).status).toBe(200);
    expect((await owner.get('/api/splose/appointments?startDate=2026-07-01&endDate=2026-07-02')).status).toBe(200);

    const { agent: admin } = await agentFor(app, 'admin');
    // Scheduling remit retained
    expect((await admin.get('/api/splose/patients')).status).toBe(200);
    expect((await admin.get('/api/splose/appointments?startDate=2026-07-01&endDate=2026-07-02')).status).toBe(200);
    expect((await admin.get('/api/splose/support-items')).status).toBe(200); // travel logbook
    // Practice financial/PII areas denied
    for (const p of ['/api/splose/invoices', '/api/splose/payments', '/api/splose/contacts',
                     '/api/splose/cases', '/api/splose/support-activities', '/api/splose/dormant-cases']) {
      expect((await admin.get(p)).status).toBe(403);
    }
  });
});

// ═══ B. Splose write gates ═══════════════════════════════════════════════════

describe('Splose write gates (audit C2) — no write path reachable with flags off', () => {
  test('POST /api/splose/patients is blocked for OWNER while ENABLE_SPLOSE_WRITE is off (the old axios bypass is gone)', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app, 'owner');
    const res = await agent.post('/api/splose/patients').send({ firstname: 'X', lastname: 'Y' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('feature_disabled');
  });

  test('therapist and read_only cannot reach the patient-create route at all', async () => {
    const app = buildApp();
    const t = await agentFor(app, 'therapist');
    expect((await t.agent.post('/api/splose/patients').send({})).status).toBe(403);
    const r = await agentFor(app, 'read_only');
    expect((await r.agent.post('/api/splose/patients').send({})).status).toBe(403);
  });

  test('appointment create/update and busy-time create are all flag-blocked for owner', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app, 'owner');
    const create = await agent.post('/api/splose/appointments').send({
      start: 's', end: 'e', serviceId: '1', locationId: '2', practitionerId: '3', patientId: '4', caseId: '5',
    });
    expect(create.status).toBe(403);
    expect(create.body.code).toBe('feature_disabled');

    const update = await agent.put('/api/splose/appointments/appt-1').send({ start: 's' });
    expect(update.status).toBe(403);
    expect(update.body.code).toBe('feature_disabled');

    const busy = await agent.post('/api/splose/busy-times').send({ start: 's', end: 'e', busyTimeTypeId: 'b' });
    expect(busy.status).toBe(403);
    expect(busy.body.code).toBe('feature_disabled');
  });

  test('unmapped therapist is stopped before the flag gate on appointment writes (fail-closed ordering)', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app, 'therapist');
    const res = await agent.post('/api/splose/appointments').send({ practitionerId: 'prac-other' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('practitioner_mapping_required');
  });
});

// ═══ C. Permissions choke point ══════════════════════════════════════════════

describe('permissions choke point (audit H3)', () => {
  test('read_only cannot POST local events (was possible via routes.js local requireAuth)', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app, 'read_only');
    const res = await agent.post('/api/events').send({ title: 'x', start: new Date().toISOString(), end: new Date().toISOString() });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/read-only/i);
  });

  test('therapist CAN still create their own local events (no over-blocking)', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app, 'therapist');
    const res = await agent.post('/api/events').send({
      title: 'Planning block',
      start: '2026-08-03T01:00:00.000Z',
      end: '2026-08-03T02:00:00.000Z',
    });
    expect([200, 201]).toContain(res.status);
  });
});

// ═══ D. Invite links + email states ══════════════════════════════════════════

describe('invite links use APP_BASE_URL and email states are truthful', () => {
  test('registerUrl is built from APP_BASE_URL — never localhost when set', async () => {
    process.env.APP_BASE_URL = 'https://opal-portal-staging.azurewebsites.net';
    const app = buildApp();
    const { agent } = await agentFor(app, 'owner', { withOrg: true });
    const res = await agent.post('/api/invites').send({ email: 'new.therapist@example.test', role: 'therapist' });
    expect(res.status).toBe(201);
    expect(res.body.emailSent).toBe(false);       // no SMTP in tests
    expect(res.body.emailSkipped).toBe(true);     // surfaced, not hidden
    expect(res.body.registerUrl).toMatch(/^https:\/\/opal-portal-staging\.azurewebsites\.net\/register\?token=/);
    expect(res.body.registerUrl).not.toMatch(/localhost/);
    // Token never leaks into the invite list
    const list = await agent.get('/api/invites');
    expect(JSON.stringify(list.body)).not.toContain('invite_token');
  });

  test('link retrieval endpoint returns the APP_BASE_URL link, is audited, and is owner/admin-only', async () => {
    process.env.APP_BASE_URL = 'https://portal.example.test';
    const app = buildApp();
    const { agent, user } = await agentFor(app, 'owner', { withOrg: true });
    const created = await agent.post('/api/invites').send({ email: 'link.me@example.test', role: 'therapist' });
    expect(created.status).toBe(201);
    const id = created.body.invite.id;

    const link = await agent.get(`/api/invites/${id}/link`);
    expect(link.status).toBe(200);
    expect(link.body.registerUrl).toMatch(/^https:\/\/portal\.example\.test\/register\?token=/);

    const audit = await db.pool.query("SELECT COUNT(*) FROM audit_logs WHERE action='invite.link_retrieved'");
    expect(Number(audit.rows[0].count)).toBe(1);

    const t = await agentFor(app, 'therapist');
    expect((await t.agent.get(`/api/invites/${id}/link`)).status).toBe(403);
  });

  test('therapist and read_only cannot create invites', async () => {
    const app = buildApp();
    const t = await agentFor(app, 'therapist');
    expect((await t.agent.post('/api/invites').send({ email: 'a@b.test', role: 'therapist' })).status).toBe(403);
    const r = await agentFor(app, 'read_only');
    expect((await r.agent.post('/api/invites').send({ email: 'a@b.test', role: 'therapist' })).status).toBe(403);
  });
});
