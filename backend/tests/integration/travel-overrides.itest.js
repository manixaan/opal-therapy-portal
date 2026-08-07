'use strict';
/** Travel address overrides (migration 009) — local overlay, Splose untouched. */
jest.mock('../../splose-api', () => ({
  getSupportItems: jest.fn(async () => [
    { id: 'si-1', type: 'Travel - provider', appointmentId: 'ap-A1',
      appointmentAddress: '1 Alpha St, Willetton WA', toMinutes: 15, returnMinutes: 20,
      createdAt: '2026-08-01T01:00:00Z' },
    { id: 'si-2', type: 'Travel - provider', appointmentId: 'ap-B1',
      appointmentAddress: '2 Beta Rd, Baldivis WA', toMinutes: 30, returnMinutes: 0,
      createdAt: '2026-08-02T01:00:00Z' },
  ]),
  getAppointments: jest.fn(async (s, e, practitionerId) => {
    const all = [
      { id: 'ap-A1', start: '2026-08-01T01:00:00Z', end: '2026-08-01T02:00:00Z', practitionerId: 'prac-A', title: 'A1' },
      { id: 'ap-B1', start: '2026-08-02T01:00:00Z', end: '2026-08-02T02:00:00Z', practitionerId: 'prac-B', title: 'B1' },
    ];
    return practitionerId ? all.filter(a => a.practitionerId === practitionerId) : all;
  }),
}));
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { db, truncateAll, seedUser, closePool } = require('./helpers');
const PASSWORD = 'OvrPass1';
function buildApp() {
  const app = express();
  app.use(bodyParser.json());
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../travel-routes'));
  return app;
}
async function agentFor(app, role, overrides = {}) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser({ password_hash: hash, role, ...overrides });
  const agent = request.agent(app);
  expect((await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD })).status).toBe(200);
  return { agent, user };
}
async function linkPractitioner(userId, sploseId) {
  await db.pool.query(
    `INSERT INTO therapist_profiles (user_id, display_name, splose_practitioner_id)
     VALUES ($1, 'Ovr Therapist', $2)`, [userId, sploseId]);
}
beforeEach(async () => { await truncateAll(); require('../../auth')._resetLoginRateLimit(); });
afterAll(closePool);

test('owner PATCH persists; GET merges override and preserves the source address', async () => {
  const app = buildApp();
  const { agent } = await agentFor(app, 'owner');
  const p = await agent.patch('/api/travel/logbook/si-1/addresses')
    .send({ fromAddress: '9 Home St, Riverton', toAddress: '5 New Clinic Way, Willetton' });
  expect(p.status).toBe(200);
  expect(p.body.override.to_address).toBe('5 New Clinic Way, Willetton');
  const g = await agent.get('/api/travel/logbook?fy=2027');
  const e = g.body.entries.find(x => x.id === 'si-1');
  expect(e.destinationAddress).toBe('5 New Clinic Way, Willetton');
  expect(e.sourceDestination).toBe('1 Alpha St, Willetton WA');
  expect(e.fromAddress).toBe('9 Home St, Riverton');
  expect(e.addressEdited).toBe(true);
  // blank toAddress clears that leg's override
  await agent.patch('/api/travel/logbook/si-1/addresses').send({ toAddress: '' });
  const g2 = await agent.get('/api/travel/logbook?fy=2027');
  const e2 = g2.body.entries.find(x => x.id === 'si-1');
  expect(e2.destinationAddress).toBe('1 Alpha St, Willetton WA');
  expect(e2.fromAddress).toBe('9 Home St, Riverton'); // from leg untouched
  const audits = await db.pool.query("SELECT metadata FROM audit_logs WHERE action = 'travel.address_overridden'");
  expect(audits.rows.length).toBeGreaterThanOrEqual(2);
  expect(JSON.stringify(audits.rows[0].metadata)).not.toContain('Riverton');
});

test('therapist scoping: own item editable, other practitioner 404, unmapped 403, read_only 403, empty body 400', async () => {
  const app = buildApp();
  const { agent, user } = await agentFor(app, 'therapist');
  await linkPractitioner(user.id, 'prac-A');
  expect((await agent.patch('/api/travel/logbook/si-1/addresses').send({ toAddress: 'X St' })).status).toBe(200);
  expect((await agent.patch('/api/travel/logbook/si-2/addresses').send({ toAddress: 'X St' })).status).toBe(404);
  expect((await agent.patch('/api/travel/logbook/si-1/addresses').send({})).status).toBe(400);
  const { agent: un } = await agentFor(app, 'therapist');
  expect((await un.patch('/api/travel/logbook/si-1/addresses').send({ toAddress: 'X' })).status).toBe(403);
  const { agent: ro } = await agentFor(app, 'read_only');
  expect((await ro.patch('/api/travel/logbook/si-1/addresses').send({ toAddress: 'X' })).status).toBe(403);
});
