'use strict';

/** Non-face-to-face timer endpoints (nf2f-routes.js, migration 076). */
jest.mock('../../splose-api', () => ({ getPatients: jest.fn(async () => []), fetchAllCases: jest.fn(async () => []) }));
jest.mock('../../outlook-oauth', () => ({ MICROSOFT_OAUTH_CONFIG: { scopes: [] }, getAuthorizationUrl: jest.fn(), getAccessToken: jest.fn(), getMicrosoftUser: jest.fn(), refreshAccessToken: jest.fn() }));

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { db, truncateAll, seedUser, seedOrganisation, closePool } = require('./helpers');

const PASSWORD = 'TimerPass1';
beforeEach(async () => { await truncateAll(); require('../../auth')._resetLoginRateLimit(); });
afterAll(async () => { require('../../auth')._resetLoginRateLimit(); await closePool(); });

function buildApp() {
  const app = express();
  app.use(bodyParser.json());
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../routes'));
  app.use('/', require('../../nf2f-routes'));
  return app;
}
async function agentFor(app, role, orgId) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser({ password_hash: hash, role, organisation_id: orgId || null });
  const agent = request.agent(app);
  expect((await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD })).status).toBe(200);
  return { agent, user };
}
const block = (clients) => ({ title: 'Case Management', startTime: '2026-10-12T05:00:00.000Z', endTime: '2026-10-12T06:00:00.000Z',
  categories: ['Case Management'], booking: { kind: 'case-management', clients } });
const five = ['11', '12', '13', '14', '15'].map((id) => ({ clientId: id, clientName: 'Client ' + id }));

describe('non-face-to-face timer', () => {
  test('book with several clients → equal shares → start, running chip, stop, allocate', async () => {
    const app = buildApp();
    const org = await seedOrganisation();
    const { agent } = await agentFor(app, 'therapist', org.id);
    const b = await agent.post('/api/outlook/events').send(block(five));
    expect(b.status).toBe(201);
    const id = b.body.dbId;

    let v = (await agent.get(`/api/events/${id}/nf2f`)).body;
    expect(v).toMatchObject({ billable: true, timer: { status: 'IDLE', elapsedSeconds: 0, limitSeconds: 3600 } });
    expect(v.allocation.clients.map((c) => c.percent)).toEqual([20, 20, 20, 20, 20]);

    v = (await agent.post(`/api/events/${id}/nf2f/start`)).body;
    expect(v.timer.status).toBe('RUNNING');
    const running = (await agent.get('/api/nf2f/running')).body.running;
    expect(running.map((r) => r.eventId)).toEqual([id]);

    // Pretend 10 minutes passed, then stop.
    await db.pool.query(`UPDATE event_billing_timers SET run_started_at = NOW() - interval '10 minutes' WHERE event_id = $1`, [id]);
    v = (await agent.post(`/api/events/${id}/nf2f/stop`)).body;
    expect(v.timer.status).toBe('STOPPED');
    expect(v.timer.elapsedSeconds).toBeGreaterThanOrEqual(600);
    expect((await agent.get('/api/nf2f/running')).body.running).toEqual([]);

    // One client at 40%: the rest share 60%; a non-billable share comes off the top.
    const bad = await agent.put(`/api/events/${id}/nf2f/allocation`).send({ allocation: five.map((c, i) => ({ clientId: c.clientId, percent: i === 0 ? 40 : 10 })) });
    expect(bad.status).toBe(400);
    const ok = await agent.put(`/api/events/${id}/nf2f/allocation`).send({ nonBillablePercent: 20,
      allocation: five.map((c, i) => ({ clientId: c.clientId, percent: i === 0 ? 40 : 10 })) });
    expect(ok.status).toBe(200);
    expect(ok.body.allocation).toMatchObject({ nonBillablePercent: 20 });
    expect(ok.body.allocation.clients.map((c) => c.percent)).toEqual([40, 10, 10, 10, 10]);
    expect(ok.body.split.reduce((s, p) => s + p.seconds, 0)).toBe(Math.round(ok.body.timer.elapsedSeconds * 0.8));
  });

  test('starting a second block\'s timer stops the first; no clients = no timer', async () => {
    const app = buildApp();
    const org = await seedOrganisation();
    const { agent } = await agentFor(app, 'therapist', org.id);
    const a = (await agent.post('/api/outlook/events').send(block(five.slice(0, 1)))).body.dbId;
    const b = (await agent.post('/api/outlook/events').send({ ...block(five.slice(1, 2)), startTime: '2026-10-12T07:00:00.000Z', endTime: '2026-10-12T08:00:00.000Z' })).body.dbId;
    await agent.post(`/api/events/${a}/nf2f/start`);
    await agent.post(`/api/events/${b}/nf2f/start`);
    expect((await agent.get('/api/nf2f/running')).body.running.map((r) => r.eventId)).toEqual([b]);
    expect((await agent.get(`/api/events/${a}/nf2f`)).body.timer.status).toBe('STOPPED');

    const none = (await agent.post('/api/outlook/events').send(block([]))).body.dbId;
    expect((await agent.get(`/api/events/${none}/nf2f`)).body.billable).toBe(false);
    expect((await agent.post(`/api/events/${none}/nf2f/start`)).status).toBe(400);
  });

  test('guards: someone else\'s block is not found; unauthenticated is 401', async () => {
    const app = buildApp();
    const org = await seedOrganisation();
    const { agent } = await agentFor(app, 'therapist', org.id);
    const id = (await agent.post('/api/outlook/events').send(block(five.slice(0, 2)))).body.dbId;
    const other = await agentFor(app, 'therapist', org.id);
    expect((await other.agent.post(`/api/events/${id}/nf2f/start`)).status).toBe(404);
    expect((await other.agent.put(`/api/events/${id}/nf2f/allocation`).send({ allocation: [] })).status).toBe(404);
    expect((await request(app).get('/api/nf2f/running')).status).toBe(401);
    expect((await request(app).post(`/api/events/${id}/nf2f/start`)).status).toBe(401);
  });
});
