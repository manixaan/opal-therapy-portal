'use strict';

/**
 * Opa mobile CRM features against the real *_test database (migration 094).
 * Splose and APNs are mocked — no network.
 *
 * Pins:
 *   - Notes owing: own finished therapy sessions with no live case note,
 *     within the window; drafted / dismissed / cancelled / future / someone
 *     else's sessions are not owed; an archived draft makes it owed again.
 *   - Client card: authorised by the caller's own appointment; read_only 403;
 *     another therapist's appointment 404; history and last note are the
 *     caller's own; audited with ids only.
 *   - Push devices: register, re-register moves the token, sign-out deletes,
 *     malformed token 400.
 *   - Push jobs: leave-now and the evening digest send once each, carry no
 *     client name, and a token Apple calls gone is disabled.
 */

jest.mock('../../outlook-oauth', () => ({}));
jest.mock('../../splose-api', () => ({
  getPatients: jest.fn(async () => []),
  fetchAllCases: jest.fn(async () => []),
  peekPatient: jest.fn(() => null),
  getPatient: jest.fn(),
}));
jest.mock('../../push/apns', () => ({
  configured: jest.fn(() => true),
  send: jest.fn(async () => ({ ok: true, status: 200, reason: null, gone: false })),
}));

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const sploseApi = require('../../splose-api');
const apns = require('../../push/apns');
const { db, truncateAll, seedUser, closePool } = require('./helpers');

const PASSWORD = 'MobileCrmPass1';
const HOUR = 3600000;

beforeEach(async () => {
  await truncateAll();
  jest.clearAllMocks();
  require('../../auth')._resetLoginRateLimit();
});
afterAll(async () => { require('../../auth')._resetLoginRateLimit(); await closePool(); });

function buildApp() {
  const app = express();
  app.use(bodyParser.json());
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../mobile-routes'));
  return app;
}

async function agentFor(app, overrides = {}) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser({ password_hash: hash, ...overrides });
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user };
}

async function session_(userId, startMs, { type = 'therapy', status = 'confirmed', clientId = 'P100', clientName = 'Client One', travel = null, title = 'OT · Client One' } = {}) {
  const { rows: [r] } = await db.pool.query(
    `INSERT INTO events (user_id, title, event_type, start_time, end_time, status, source, client_id, client_name, travel_time_minutes)
     VALUES ($1,$2,$3,$4,$5,$6,'app',$7,$8,$9) RETURNING *`,
    [userId, title, type, new Date(startMs).toISOString(), new Date(startMs + HOUR).toISOString(), status, clientId, clientName, travel]);
  return r;
}

async function draft(userId, eventId, { status = 'draft', splosePatientId = null, body = 'Client engaged well in kitchen task practice.' } = {}) {
  await db.pool.query(
    `INSERT INTO case_note_drafts
       (user_id, linked_event_id, splose_patient_id, transcript, header, identify, session_details,
        note_body, style_version, provider_id, model_id, review_status, status)
     VALUES ($1,$2,$3,'t','{}'::jsonb,'i','s',$4,'v1','p','m','review_required',$5)`,
    [userId, eventId, splosePatientId, body, status]);
}

describe('notes owing', () => {
  test('lists only own finished sessions without a live case note', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app);
    const other = await seedUser();
    const now = Date.now();
    const owed = await session_(user.id, now - 5 * HOUR, { title: 'Owed' });
    const drafted = await session_(user.id, now - 7 * HOUR, { title: 'Drafted' });
    await draft(user.id, drafted.id);
    const archived = await session_(user.id, now - 9 * HOUR, { title: 'Archived draft' });
    await draft(user.id, archived.id, { status: 'archived' });
    await session_(user.id, now - 11 * HOUR, { title: 'Cancelled', status: 'cancelled' });
    await session_(user.id, now + 2 * HOUR, { title: 'Future' });
    await session_(user.id, now - 10 * 24 * HOUR, { title: 'Too old' });
    await session_(user.id, now - 4 * HOUR, { title: 'Meeting', type: 'admin' });
    await session_(other.id, now - 5 * HOUR, { title: 'Not mine' });

    const res = await agent.get('/api/mobile/notes-owing');
    expect(res.status).toBe(200);
    expect(res.body.sessions.map((s) => s.title)).toEqual(['Owed', 'Archived draft']);
    expect(res.body.sessions[0]).toEqual(expect.objectContaining({ id: owed.id, clientName: 'Client One' }));

    const today = await agent.get('/api/mobile/today');
    expect(today.body.summary.notesOwingCount).toBe(2);
  });

  test('"written in Splose" dismisses it, undo brings it back; another user’s session is 404', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app);
    const other = await seedUser();
    const mine = await session_(user.id, Date.now() - 3 * HOUR);
    const theirs = await session_(other.id, Date.now() - 3 * HOUR);

    expect((await agent.post(`/api/mobile/notes-owing/${theirs.id}/dismiss`)).status).toBe(404);
    expect((await agent.post(`/api/mobile/notes-owing/${mine.id}/dismiss`)).status).toBe(200);
    expect((await agent.get('/api/mobile/notes-owing')).body.count).toBe(0);
    expect((await agent.delete(`/api/mobile/notes-owing/${mine.id}/dismiss`)).status).toBe(200);
    expect((await agent.get('/api/mobile/notes-owing')).body.count).toBe(1);
  });

  test('needs a session', async () => {
    expect((await request(buildApp()).get('/api/mobile/notes-owing')).status).toBe(401);
  });
});

describe('client card', () => {
  const PATIENT = {
    id: 'P100', firstname: 'Client', lastname: 'One', fullName: 'Client One',
    email: 'client.one@example.test', mobilePhone: '0400 111 222',
    formattedAddress: '12 Smith Street, Willetton, WA',
    _raw: { homePhone: '08 9300 1234', workPhone: '0400 111 222' },
  };

  test('own appointment → contact details, own history, own last note; audited with ids only', async () => {
    sploseApi.getPatient.mockResolvedValue(PATIENT);
    const app = buildApp();
    const { agent, user } = await agentFor(app);
    const other = await seedUser();
    const now = Date.now();
    const earlier = await session_(user.id, now - 7 * 24 * HOUR);
    await draft(user.id, earlier.id, { body: 'Mine — practised transfers.' });
    const theirs = await session_(other.id, now - 2 * 24 * HOUR);
    await draft(other.id, theirs.id, { body: 'SOMEONE ELSE’S NOTE' });
    const today = await session_(user.id, now + HOUR);
    await session_(user.id, now + 7 * 24 * HOUR);

    const res = await agent.get(`/api/mobile/appointments/${today.id}/client`);
    expect(res.status).toBe(200);
    const c = res.body.client;
    expect(c.fullName).toBe('Client One');
    expect(c.phones).toEqual([{ label: 'Mobile', number: '0400 111 222' }, { label: 'Home', number: '08 9300 1234' }]);
    expect(c.email).toBe('client.one@example.test');
    expect(c.pastSessions.map((s) => s.id)).toEqual([earlier.id]);
    expect(c.nextSession).not.toBeNull();
    expect(c.lastNote.excerpt).toBe('Mine — practised transfers.');
    expect(JSON.stringify(res.body)).not.toContain('SOMEONE ELSE');

    const { rows } = await db.pool.query(
      `SELECT target_id, metadata FROM audit_logs WHERE action = 'mobile.client_card_viewed'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].target_id).toBe('P100');
    expect(JSON.stringify(rows[0].metadata)).not.toMatch(/0400|Client One|Smith/);
  });

  test('another therapist’s appointment is 404; read_only is 403', async () => {
    sploseApi.getPatient.mockResolvedValue(PATIENT);
    const app = buildApp();
    const { agent } = await agentFor(app);
    const other = await seedUser();
    const theirs = await session_(other.id, Date.now() + HOUR);
    expect((await agent.get(`/api/mobile/appointments/${theirs.id}/client`)).status).toBe(404);

    const ro = await agentFor(app, { role: 'read_only' });
    const roEvent = await session_(ro.user.id, Date.now() + HOUR);
    expect((await ro.agent.get(`/api/mobile/appointments/${roEvent.id}/client`)).status).toBe(403);
    expect(sploseApi.getPatient).not.toHaveBeenCalled();
  });

  test('no linked client and Splose failures answer plainly', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app);
    const none = await session_(user.id, Date.now() + HOUR, { clientId: null });
    expect((await agent.get(`/api/mobile/appointments/${none.id}/client`)).body).toEqual({ client: null, reason: 'no_client_linked' });

    const linked = await session_(user.id, Date.now() + 2 * HOUR);
    sploseApi.getPatient.mockRejectedValueOnce(Object.assign(new Error('boom'), { response: { status: 500 } }));
    const down = await agent.get(`/api/mobile/appointments/${linked.id}/client`);
    expect(down.status).toBe(502);
    expect(down.body.code).toBe('client_lookup_failed');
  });
});

describe('push devices', () => {
  const TOKEN = 'ab'.repeat(32);

  test('register, move to the next account that signs in, delete on sign-out', async () => {
    const app = buildApp();
    const a = await agentFor(app);
    expect((await a.agent.post('/api/mobile/push-devices').send({ token: TOKEN, environment: 'sandbox' })).status).toBe(200);
    const b = await agentFor(app);
    expect((await b.agent.post('/api/mobile/push-devices').send({ token: TOKEN.toUpperCase() })).status).toBe(200);
    let { rows } = await db.pool.query('SELECT user_id, environment FROM mobile_push_devices');
    expect(rows).toEqual([{ user_id: b.user.id, environment: 'production' }]);

    expect((await a.agent.delete(`/api/mobile/push-devices/${TOKEN}`)).status).toBe(200);
    expect((await db.pool.query('SELECT 1 FROM mobile_push_devices')).rowCount).toBe(1);
    expect((await b.agent.delete(`/api/mobile/push-devices/${TOKEN}`)).status).toBe(200);
    ({ rows } = await db.pool.query('SELECT 1 FROM mobile_push_devices'));
    expect(rows).toHaveLength(0);
  });

  test('a malformed token is 400', async () => {
    const { agent } = await agentFor(buildApp());
    expect((await agent.post('/api/mobile/push-devices').send({ token: 'not-a-token' })).status).toBe(400);
  });
});

describe('push jobs', () => {
  const jobs = () => require('../../push/push-jobs');
  beforeEach(() => { process.env.PUSH_NOTIFICATIONS_ENABLED = 'true'; });
  afterEach(() => { delete process.env.PUSH_NOTIFICATIONS_ENABLED; });

  async function withDevice() {
    const user = await seedUser();
    await db.pool.query(`INSERT INTO mobile_push_devices (user_id, token) VALUES ($1, $2)`, [user.id, 'cd'.repeat(32)]);
    return user;
  }

  test('leave-now goes once, at start − travel − buffer, with no client name', async () => {
    const user = await withDevice();
    // 02:00 Perth = 18:00Z the day before; session at 10:00 Perth, 25 min drive.
    const start = Date.parse('2027-03-02T02:00:00.000Z');
    await session_(user.id, start, { travel: 25, clientName: 'Client One' });
    const leaveAt = start - (25 + jobs().LEAVE_BUFFER_MIN) * 60000;

    await jobs().tick(new Date(leaveAt - 10 * 60000));
    expect(apns.send).not.toHaveBeenCalled();
    await jobs().tick(new Date(leaveAt));
    await jobs().tick(new Date(leaveAt + 2 * 60000));
    expect(apns.send).toHaveBeenCalledTimes(1);
    const msg = apns.send.mock.calls[0][1];
    expect(msg.title).toBe('Time to leave');
    expect(msg.body).toBe('25 min drive to your 10:00 am session.');
    expect(JSON.stringify(msg)).not.toMatch(/Client One/);
  });

  test('evening digest counts today’s owed notes, once a day; Apple "gone" disables the token', async () => {
    const user = await withDevice();
    // Two sessions earlier today (Perth), at 18:00 Perth = 10:00Z.
    const evening = Date.parse('2027-03-02T10:00:00.000Z');
    await session_(user.id, Date.parse('2027-03-02T01:00:00.000Z'));
    await session_(user.id, Date.parse('2027-03-02T03:00:00.000Z'));
    apns.send.mockResolvedValueOnce({ ok: false, status: 410, reason: 'Unregistered', gone: true });

    await jobs().tick(new Date(evening));
    await jobs().tick(new Date(evening + 4 * 60000));
    expect(apns.send).toHaveBeenCalledTimes(1);
    expect(apns.send.mock.calls[0][1].body).toBe('2 case notes to write from today.');
    const { rows: [d] } = await db.pool.query('SELECT disabled_at, disabled_reason FROM mobile_push_devices');
    expect(d.disabled_at).not.toBeNull();
    expect(d.disabled_reason).toBe('Unregistered');
  });

  test('off unless enabled', async () => {
    delete process.env.PUSH_NOTIFICATIONS_ENABLED;
    expect(await jobs().tick()).toEqual({ skipped: true });
  });
});
