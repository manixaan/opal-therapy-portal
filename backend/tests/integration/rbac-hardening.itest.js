'use strict';

/**
 * RBAC HARDENING (2026-08-06) — integration tests.
 *
 * Pins the default-deny role model:
 *   owner     → full access
 *   admin     → scheduling + travel ONLY (no billing/contacts/activity/NDIS/
 *               dormant/accounting/resources/settings/team controls)
 *   therapist → own calendar, own travel-logbook entries, approved resources
 *   read_only → no practice-management data
 *
 * Splose READ functions are mocked (no network). The travel-logbook endpoint
 * is exercised with two practitioners to prove server-side scoping.
 */

jest.mock('../../splose-api', () => ({
  testConnection: jest.fn(async () => ({ connected: true })),
  getSupportItems: jest.fn(async () => [
    { id: 'si-1', type: 'Travel - provider', appointmentId: 'ap-A1',
      appointmentAddress: '1 Alpha St, Willetton WA', toMinutes: 15, returnMinutes: 20,
      createdAt: '2026-08-01T01:00:00Z' },
    { id: 'si-2', type: 'Travel - provider', appointmentId: 'ap-B1',
      appointmentAddress: '2 Beta Rd, Baldivis WA', toMinutes: 30, returnMinutes: 0,
      createdAt: '2026-08-02T01:00:00Z' },
    { id: 'si-3', type: 'Consumables', appointmentId: 'ap-A1',
      appointmentAddress: '1 Alpha St', toMinutes: 5, returnMinutes: 0,
      createdAt: '2026-08-02T01:00:00Z' }, // not travel — excluded
    { id: 'si-4', type: 'Travel - provider', appointmentId: 'ap-A2',
      appointmentAddress: null, toMinutes: 10, returnMinutes: 0,
      createdAt: '2026-08-03T01:00:00Z' }, // no address — excluded
  ]),
  getAppointments: jest.fn(async (start, end, practitionerId) => {
    const all = [
      { id: 'ap-A1', start: '2026-08-01T01:00:00Z', end: '2026-08-01T02:00:00Z',
        practitionerId: 'prac-A', title: 'Session A1' },
      { id: 'ap-B1', start: '2026-08-02T01:00:00Z', end: '2026-08-02T02:00:00Z',
        practitionerId: 'prac-B', title: 'Session B1' },
    ];
    return practitionerId ? all.filter((a) => a.practitionerId === practitionerId) : all;
  }),
  getPatients: jest.fn(async () => []),
  getInvoices: jest.fn(async () => []),
  getPayments: jest.fn(async () => []),
  getContacts: jest.fn(async () => []),
  fetchAllCases: jest.fn(async () => []),
  getSupportActivities: jest.fn(async () => []),
  getServices: jest.fn(async () => []),
  getPractitioners: jest.fn(async () => []),
  getLocations: jest.fn(async () => []),
  getBusyTimes: jest.fn(async () => []),
  getBusyTimeTypes: jest.fn(async () => []),
  getAvailabilities: jest.fn(async () => []),
  getAppointment: jest.fn(async () => ({ id: 'ap-A1', practitionerId: 'prac-A' })),
  getPatient: jest.fn(async () => ({ id: 'p1' })),
}));

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { db, truncateAll, seedUser, closePool } = require('./helpers');

const PASSWORD = 'RbacPass1';

function buildApp() {
  const app = express();
  app.use(bodyParser.json());
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../routes'));
  app.use('/', require('../../invite-routes'));
  app.use('/', require('../../travel-routes'));
  app.use('/', require('../../resources-routes'));
  app.use('/', require('../../app-routes'));
  app.use('/', require('../../calendar-routes'));
  return app;
}

async function agentFor(app, role, overrides = {}) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser({ password_hash: hash, role, ...overrides });
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user };
}

async function linkPractitioner(userId, sploseId) {
  const r = await db.pool.query(
    `INSERT INTO therapist_profiles (user_id, display_name, splose_practitioner_id)
     VALUES ($1, 'RBAC Therapist', $2) RETURNING id`, [userId, sploseId]);
  return r.rows[0].id;
}

beforeEach(async () => {
  await truncateAll();
  require('../../auth')._resetLoginRateLimit();
});
afterAll(closePool);

// ═══ Admin: default-deny outside scheduling + travel ═════════════════════════

describe('admin boundaries (scheduling + travel only)', () => {
  test('admin is denied billing/contacts/activity/NDIS/dormant Splose areas', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app, 'admin');
    for (const p of ['/api/splose/invoices', '/api/splose/payments', '/api/splose/contacts',
                     '/api/splose/cases', '/api/splose/support-activities', '/api/splose/dormant-cases']) {
      expect((await agent.get(p)).status).toBe(403);
    }
  });

  test('admin is denied Resources entirely (list, folders, manage)', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app, 'admin');
    expect((await agent.get('/api/resources')).status).toBe(403);
    expect((await agent.get('/api/resources/folders')).status).toBe(403);
    expect((await agent.post('/api/resources/folders').send({ name: 'x' })).status).toBe(403);
  });

  test('admin is denied team controls: invites, team-setup, user management', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app, 'admin');
    expect((await agent.get('/api/invites')).status).toBe(403);
    expect((await agent.get('/api/admin/team-setup')).status).toBe(403);
    expect((await agent.get('/api/users')).status).toBe(403);
    expect((await agent.get('/api/admin/users')).status).toBe(403);
  });

  test('admin is denied therapist-profile edits but keeps scheduling reads', async () => {
    const app = buildApp();
    const { agent, user: adminUser } = await agentFor(app, 'admin');
    const org = await db.pool.query("INSERT INTO organisations (name) VALUES ('RBAC Org') RETURNING id");
    await db.pool.query('UPDATE users SET organisation_id = $1 WHERE id = $2', [org.rows[0].id, adminUser.id]);
    const { user: t } = await agentFor(app, 'therapist');
    const profileId = await linkPractitioner(t.id, 'prac-A');
    expect((await agent.put(`/api/therapists/${profileId}`).send({ displayName: 'X' })).status).toBe(403);
    expect((await agent.get('/api/therapists')).status).toBe(200);
    expect((await agent.get('/api/splose/appointments?startDate=2026-08-01&endDate=2026-08-02')).status).toBe(200);
    expect((await agent.get('/api/sync/diagnostics')).status).toBe(200);
    expect((await agent.get('/api/travel/logbook?fy=2027')).status).toBe(200);
  });
});

// ═══ Therapist travel logbook: server-side scoping ═══════════════════════════

describe('travel logbook scoping (GET /api/travel/logbook)', () => {
  test('owner and admin see all practice travel entries', async () => {
    const app = buildApp();
    for (const role of ['owner', 'admin']) {
      const { agent } = await agentFor(app, role);
      const res = await agent.get('/api/travel/logbook?fy=2027');
      expect(res.status).toBe(200);
      expect(res.body.scope).toBe('practice');
      expect(res.body.entries.map((e) => e.id).sort()).toEqual(['si-1', 'si-2']);
      expect(res.body.kilometreRate).toBeGreaterThan(0);
    }
  });

  test('mapped therapist sees ONLY their own entries; totals labelled per leg', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app, 'therapist');
    await linkPractitioner(user.id, 'prac-A');
    const res = await agent.get('/api/travel/logbook?fy=2027');
    expect(res.status).toBe(200);
    expect(res.body.scope).toBe('own');
    expect(res.body.entries).toHaveLength(1);
    const e = res.body.entries[0];
    expect(e.id).toBe('si-1');
    expect(e.practitionerId).toBe('prac-A');
    expect(e.toMinutes).toBe(15);
    expect(e.returnMinutes).toBe(20);
    expect(e.totalMinutes).toBe(35);
    // another therapist's entry (prac-B) must never appear
    expect(res.body.entries.some((x) => x.id === 'si-2')).toBe(false);
  });

  test('unmapped therapist fails closed; read_only denied; unauthenticated 401', async () => {
    const app = buildApp();
    const { agent: unmapped } = await agentFor(app, 'therapist');
    const r1 = await unmapped.get('/api/travel/logbook');
    expect(r1.status).toBe(403);
    expect(r1.body.code).toBe('practitioner_mapping_required');

    const { agent: ro } = await agentFor(app, 'read_only');
    expect((await ro.get('/api/travel/logbook')).status).toBe(403);

    expect((await request(app).get('/api/travel/logbook')).status).toBe(401);
  });
});

// ═══ Therapist denials + sync diagnostics gate ═══════════════════════════════

describe('therapist boundaries stay closed after hardening', () => {
  test('therapist denied practice areas, diagnostics, invites and team-setup', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app, 'therapist');
    for (const p of ['/api/splose/invoices', '/api/splose/payments', '/api/splose/contacts',
                     '/api/splose/cases', '/api/splose/dormant-cases', '/api/splose/patients',
                     '/api/sync/diagnostics', '/api/invites', '/api/admin/team-setup',
                     '/api/calendar/master', '/api/therapists']) {
      expect((await agent.get(p)).status).toBe(403);
    }
  });

  test('owner retains every area admin lost', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app, 'owner');
    for (const p of ['/api/splose/invoices', '/api/splose/payments', '/api/splose/contacts',
                     '/api/splose/cases', '/api/splose/support-activities', '/api/splose/dormant-cases',
                     '/api/resources', '/api/invites', '/api/admin/team-setup', '/api/sync/diagnostics']) {
      expect((await agent.get(p)).status).toBe(200);
    }
  });
});
