'use strict';

/**
 * Splose sync — match, link or ignore (migration 080). Real *_test database;
 * Splose and Microsoft are mocked: nothing reaches the network, and no
 * Splose write function is ever expected to be called except where a test
 * says so against the mock.
 *
 * Pins:
 *   - migration 080 columns exist
 *   - GET matches: exact / likely per queued create; cancelled, other-client
 *     and already-linked appointments are never offered
 *   - LINK sets events.splose_id, resolves the row as 'linked', audits, and
 *     closes the open unlinked / created alerts
 *   - a linked event's later move queues an UPDATE against that Splose id and
 *     publishing it updates (never creates)
 *   - the watcher does not record a linked appointment as "created in Splose"
 *   - link refusals: other client, cancelled, linked elsewhere, unknown id
 *   - bulk link links only rows with a single exact match
 *   - IGNORE: never re-queued on edit, hidden from unlinked alerts, listed
 *     under Ignored; Owner/Admin undo re-queues the create
 *   - Send is refused while ENABLE_SPLOSE_WRITE is off; link and ignore work
 *   - 403 for read-only accounts; a therapist cannot act on another's queue
 */

jest.mock('../../outlook-oauth', () => ({
  MICROSOFT_OAUTH_CONFIG: { scopes: ['Calendars.ReadWrite'] },
  getAuthorizationUrl: jest.fn(),
  getAccessToken: jest.fn(),
  getMicrosoftUser: jest.fn(),
  refreshAccessToken: jest.fn(),
  getOutlookCalendarEvents: jest.fn(async () => []),
  getOutlookCalendarDelta: jest.fn(async () => ({ changed: [], deleted: [], deltaToken: 't' })),
  createOutlookEvent: jest.fn(async () => ({ outlookId: 'OL-' + Math.random().toString(36).slice(2, 8) })),
  updateOutlookEvent: jest.fn(async () => ({})),
  deleteOutlookEvent: jest.fn(async () => ({})),
  subscribeToCalendarChanges: jest.fn(),
}));

// The Splose diary the mock serves; tests fill it.
let mockDiary = [];
const mockSplose = {
  isConfigured: () => true,
  createAppointment: jest.fn(async (d) => {
    if (process.env.ENABLE_SPLOSE_WRITE === 'false') { const e = new Error('off'); e.code = 'FEATURE_DISABLED'; throw e; }
    return { id: 9999, ...d };
  }),
  updateAppointment: jest.fn(async () => ({})),
  cancelAppointment: jest.fn(async () => 1),
  getCancellationReasons: jest.fn(async () => [{ id: 57066, reason: 'Other' }]),
  getLocations: jest.fn(async () => [{ id: 9456, title: 'Opal Therapy', archived: false }]),
  fetchAllCases: jest.fn(async () => [{ id: 300, patientId: 41, status: 'Active' }]),
  getServices: jest.fn(async () => [{ id: 125320, title: 'Therapy Session' }]),
  getPatients: jest.fn(async () => [{ id: 41, fullName: 'Jane Doe' }, { id: 42, fullName: 'Sam Pell' }]),
  getAppointments: jest.fn(async () => mockDiary),
  getAppointment: jest.fn(async (id) => {
    const a = mockDiary.find(x => String(x.id) === String(id));
    if (!a) { const e = new Error('nf'); e.response = { status: 404 }; throw e; }
    return a;
  }),
};
jest.mock('../../splose-api', () => mockSplose);

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { db, truncateAll, seedUser, closePool } = require('./helpers');

const PASSWORD = 'LinkIgnorePass1';
const START = '2026-09-14T01:00:00.000Z';   // 9:00 Perth
const END   = '2026-09-14T02:00:00.000Z';

const appt = (id, start, extra = {}) => ({
  id, start, end: new Date(new Date(start).getTime() + 3600000).toISOString(),
  practitionerId: '88167', serviceId: 125320, locationId: 9456,
  patients: [{ patientId: 41, status: 'Booked' }], createdAt: '2026-09-12T23:00:00.000Z', ...extra,
});

beforeEach(async () => {
  await truncateAll();
  jest.clearAllMocks();
  mockDiary = [];
  require('../../auth')._resetLoginRateLimit();
  require('../../splose-sync-routes')._resetPublisher();
  process.env.ENABLE_SPLOSE_DRAFT_SYNC = 'true';
  process.env.ENABLE_SPLOSE_WRITE = 'true';
  process.env.ENABLE_OUTLOOK_WRITE = 'true';
  process.env.ENABLE_SPLOSE_AUTO_SYNC = 'false';
});
afterAll(async () => { require('../../auth')._resetLoginRateLimit(); await closePool(); });

function buildApp() {
  const app = express();
  app.use(bodyParser.json());
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../routes'));
  app.use('/', require('../../splose-sync-routes'));
  return app;
}

async function agentFor(app, overrides = {}, practitioner = '88167') {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser({ password_hash: hash, ...overrides });
  await db.pool.query(
    `UPDATE users SET access_token = 'tok', refresh_token = 'ref', token_expires_at = NOW() + interval '1 hour' WHERE id = $1`, [user.id]);
  await db.pool.query(
    `INSERT INTO therapist_profiles (user_id, display_name, splose_practitioner_id) VALUES ($1, 'Test Therapist', $2)`, [user.id, practitioner]);
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user };
}

async function book(agent, start = START, end = END, extra = {}) {
  const res = await agent.post('/api/outlook/events').send({
    title: 'Client Appointment — Jane D', startTime: start, endTime: end, categories: ['Client Appointments'],
    splose: { patientId: 41, patientName: 'Jane D', sessionType: 'therapy', serviceId: 125320, ...extra },
  });
  expect(res.status).toBe(201);
  const q = await db.pool.query(`SELECT id FROM splose_sync_queue WHERE event_id = $1 AND status = 'pending'`, [res.body.dbId]);
  return { eventId: res.body.dbId, queueId: q.rows[0].id };
}

async function waitForIdle(agent) {
  for (let i = 0; i < 50; i++) {
    const st = await agent.get('/api/splose-sync/status');
    if (st.status === 200 && !st.body.running) return st.body;
    await new Promise(r => setTimeout(r, 40));
  }
  throw new Error('publish did not finish');
}

describe('migration 080', () => {
  test('adds the never-sync stamp and the queue resolution', async () => {
    const c = await db.pool.query(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE (table_name = 'events' AND column_name IN ('splose_sync_ignored_at', 'splose_sync_ignored_by'))
           OR (table_name = 'splose_sync_queue' AND column_name = 'resolution') ORDER BY 1, 2`);
    expect(c.rows.map(r => r.table_name + '.' + r.column_name)).toEqual([
      'events.splose_sync_ignored_at', 'events.splose_sync_ignored_by', 'splose_sync_queue.resolution']);
  });
});

describe('matching', () => {
  test('exact and likely candidates; cancelled, other-client and linked appointments never offered', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app);
    const a = await book(agent);
    const b = await book(agent, '2026-09-15T01:00:00.000Z', '2026-09-15T02:00:00.000Z');
    // Held by another portal event already.
    await db.pool.query(`INSERT INTO events (user_id, title, start_time, end_time, event_type, splose_id) VALUES ($1, 'X', $2, $3, 'therapy', '7005')`, [user.id, START, END]);
    mockDiary = [
      appt(7001, START),
      appt(7002, '2026-09-14T01:20:00.000Z'),
      appt(7003, START, { patients: [{ patientId: 41, status: 'Cancelled' }] }),
      appt(7004, START, { patients: [{ patientId: 42, status: 'Booked' }] }),
      appt(7005, START),
    ];
    const r = await agent.get('/api/splose-sync/matches');
    expect(r.status).toBe(200);
    expect(r.body.windowMinutes).toBe(30);
    expect(r.body.matches[a.queueId]).toEqual([
      expect.objectContaining({ sploseAppointmentId: '7001', confidence: 'exact', patientName: 'Jane Doe', serviceName: 'Therapy Session', locationName: 'Opal Therapy' }),
      expect.objectContaining({ sploseAppointmentId: '7002', confidence: 'likely' }),
    ]);
    expect(r.body.matches[b.queueId]).toEqual([]);
    expect(mockSplose.getAppointments).toHaveBeenCalledTimes(1);
  });
});

describe('link', () => {
  test('sets splose_id, resolves the row as linked, audits, closes alerts — and writes nothing to Splose', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app);
    const { eventId, queueId } = await book(agent);
    mockDiary = [appt(7001, START)];
    await db.pool.query(
      `INSERT INTO splose_change_alerts (user_id, splose_appointment_id, kind, fingerprint, details) VALUES ($1, '7001', 'created', 'c', '{}')`, [user.id]);

    const r = await agent.post(`/api/splose-sync/pending/${queueId}/link`).send({ sploseAppointmentId: '7001' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, eventId, sploseAppointmentId: '7001' });

    const ev = await db.pool.query(`SELECT splose_id, client_id, last_synced_to_splose FROM events WHERE id = $1`, [eventId]);
    expect(ev.rows[0]).toMatchObject({ splose_id: '7001', client_id: '41' });
    expect(ev.rows[0].last_synced_to_splose).toBeTruthy();
    const q = await db.pool.query(`SELECT status, resolution, splose_appointment_id FROM splose_sync_queue WHERE id = $1`, [queueId]);
    expect(q.rows[0]).toEqual({ status: 'done', resolution: 'linked', splose_appointment_id: '7001' });
    const audit = await db.pool.query(`SELECT target_id, metadata FROM audit_logs WHERE action = 'splose_sync_linked'`);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].metadata).toMatchObject({ sploseAppointmentId: '7001', how: 'single' });
    const alerts = await agent.get('/api/splose-sync/alerts');
    expect(alerts.body.alerts).toEqual([]);
    expect((await agent.get('/api/splose-sync/pending')).body.count).toBe(0);
    for (const fn of ['createAppointment', 'updateAppointment', 'cancelAppointment']) expect(mockSplose[fn]).not.toHaveBeenCalled();
  });

  test('a linked event moved later queues an UPDATE against the linked id, and publishing updates — never creates', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app);
    const { eventId, queueId } = await book(agent);
    mockDiary = [appt(7001, START)];
    expect((await agent.post(`/api/splose-sync/pending/${queueId}/link`).send({ sploseAppointmentId: '7001' })).status).toBe(200);

    const moved = await agent.patch(`/api/outlook/events/${eventId}`).send({ startTime: '2026-09-14T03:00:00.000Z', endTime: '2026-09-14T04:00:00.000Z' });
    expect(moved.status).toBe(200);
    const pend = await agent.get('/api/splose-sync/pending');
    expect(pend.body.count).toBe(1);
    expect(pend.body.changes[0]).toMatchObject({ action: 'update', eventId, sploseAppointmentId: '7001' });

    expect((await agent.post('/api/splose-sync/publish').send({})).status).toBe(202);
    const st = await waitForIdle(agent);
    expect(st.lastRun).toMatchObject({ total: 1, failed: 0 });
    expect(mockSplose.updateAppointment).toHaveBeenCalledWith('7001', expect.objectContaining({ start: '2026-09-14T03:00:00.000Z' }));
    expect(mockSplose.createAppointment).not.toHaveBeenCalled();

    // Deleting it queues a cancel against the same id.
    await agent.delete(`/api/outlook/events/${eventId}`).send({ reasonId: 57066 });
    const after = await agent.get('/api/splose-sync/pending');
    expect(after.body.changes[0]).toMatchObject({ action: 'cancel', sploseAppointmentId: '7001' });
  });

  test('the watcher does not record a linked appointment as booked in Splose', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app);
    const { queueId } = await book(agent);
    mockDiary = [appt(7001, START)];
    expect((await agent.post(`/api/splose-sync/pending/${queueId}/link`).send({ sploseAppointmentId: '7001' })).status).toBe(200);
    const watcher = require('../../splose-draft-sync').createWatcher({ db, sploseApi: mockSplose, now: () => new Date('2026-09-13T00:00:00Z') });
    const run = await watcher.run();
    expect(run).toEqual({ alerts: 0 });
    const n = await db.pool.query(`SELECT COUNT(*)::int AS n FROM splose_change_alerts`);
    expect(n.rows[0].n).toBe(0);
    const live = await db.pool.query(`SELECT COUNT(*)::int AS n FROM events WHERE splose_id = '7001'`);
    expect(live.rows[0].n).toBe(1);
  });

  test('refusals: another client, cancelled, linked elsewhere, unknown id, bad id', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app);
    const { queueId } = await book(agent);
    await db.pool.query(`INSERT INTO events (user_id, title, start_time, end_time, event_type, splose_id) VALUES ($1, 'X', $2, $3, 'therapy', '7005')`, [user.id, START, END]);
    mockDiary = [
      appt(7003, START, { patients: [{ patientId: 41, status: 'Cancelled' }] }),
      appt(7004, START, { patients: [{ patientId: 42, status: 'Booked' }] }),
      appt(7005, START),
      appt(7006, START, { practitionerId: '1' }),
    ];
    const link = (id) => agent.post(`/api/splose-sync/pending/${queueId}/link`).send({ sploseAppointmentId: id });
    expect((await link('7003')).body.code).toBe('splose_cancelled');
    expect((await link('7004')).body.code).toBe('patient_mismatch');
    expect((await link('7005')).body.code).toBe('already_linked_elsewhere');
    expect((await link('7006')).body.code).toBe('practitioner_mismatch');
    const nf = await link('8888');
    expect([nf.status, nf.body.code]).toEqual([404, 'splose_not_found']);
    expect((await link('abc')).status).toBe(400);
    const q = await db.pool.query(`SELECT status FROM splose_sync_queue WHERE id = $1`, [queueId]);
    expect(q.rows[0].status).toBe('pending');
  });

  test('bulk link links only rows with a single exact match', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app);
    const one = await book(agent);                                                              // exact 7001
    const likely = await book(agent, '2026-09-15T01:00:00.000Z', '2026-09-15T02:00:00.000Z');  // likely only
    const two = await book(agent, '2026-09-16T01:00:00.000Z', '2026-09-16T02:00:00.000Z');     // two exacts
    const none = await book(agent, '2026-09-17T01:00:00.000Z', '2026-09-17T02:00:00.000Z');    // nothing
    mockDiary = [
      appt(7001, START),
      appt(7010, '2026-09-15T01:15:00.000Z'),
      appt(7020, '2026-09-16T01:00:00.000Z'), appt(7021, '2026-09-16T01:00:00.000Z'),
    ];
    const r = await agent.post('/api/splose-sync/link-matches').send({});
    expect(r.status).toBe(200);
    expect(r.body.linked).toEqual([expect.objectContaining({ queueId: one.queueId, sploseAppointmentId: '7001' })]);
    expect(r.body.notEligible).toBe(3);
    expect(mockSplose.getAppointments).toHaveBeenCalledWith(expect.any(String), expect.any(String), null, { fresh: true });
    const left = (await agent.get('/api/splose-sync/pending')).body.changes.map(c => c.id).sort();
    expect(left).toEqual([likely.queueId, two.queueId, none.queueId].sort());
    expect(mockSplose.createAppointment).not.toHaveBeenCalled();
  });
});

describe('ignore permanently', () => {
  test('never re-queued on edit, hidden from unlinked alerts, listed under Ignored', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app);
    const { eventId, queueId } = await book(agent);
    const r = await agent.post(`/api/splose-sync/pending/${queueId}/ignore`).send({});
    expect(r.status).toBe(200);

    const ev = await db.pool.query(`SELECT splose_sync_ignored_at, splose_sync_ignored_by FROM events WHERE id = $1`, [eventId]);
    expect(ev.rows[0].splose_sync_ignored_at).toBeTruthy();
    expect(ev.rows[0].splose_sync_ignored_by).toBe(user.id);
    const q = await db.pool.query(`SELECT status, resolution FROM splose_sync_queue WHERE id = $1`, [queueId]);
    expect(q.rows[0]).toEqual({ status: 'discarded', resolution: 'ignored' });
    const audit = await db.pool.query(`SELECT COUNT(*)::int AS n FROM audit_logs WHERE action = 'splose_sync_ignored'`);
    expect(audit.rows[0].n).toBe(1);

    // An edit does not put it back.
    await agent.patch(`/api/outlook/events/${eventId}`).send({ startTime: '2026-09-14T03:00:00.000Z', endTime: '2026-09-14T04:00:00.000Z' });
    expect((await agent.get('/api/splose-sync/pending')).body.count).toBe(0);
    const live = await db.pool.query(`SELECT COUNT(*)::int AS n FROM splose_sync_queue WHERE event_id = $1 AND status IN ('pending','failed')`, [eventId]);
    expect(live.rows[0].n).toBe(0);

    // The watcher does not offer it as unlinked; an old alert for it is hidden.
    const watcher = require('../../splose-draft-sync').createWatcher({ db, sploseApi: mockSplose, now: () => new Date('2026-09-13T00:00:00Z') });
    expect(await watcher.run()).toEqual({ alerts: 0 });
    await db.pool.query(
      `INSERT INTO splose_change_alerts (user_id, event_id, splose_appointment_id, kind, fingerprint, details) VALUES ($1, $2, 'local:old', 'unlinked', 'unlinked', '{}')`, [user.id, eventId]);
    expect((await agent.get('/api/splose-sync/alerts')).body.alerts).toEqual([]);

    const ig = await agent.get('/api/splose-sync/ignored');
    expect(ig.body).toMatchObject({ count: 1, canUndo: false });
    expect(ig.body.events[0]).toMatchObject({ eventId });
  });

  test('bulk ignore resolves each named create and skips the rest', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app);
    const a = await book(agent);
    const b = await book(agent, '2026-09-15T01:00:00.000Z', '2026-09-15T02:00:00.000Z');
    const r = await agent.post('/api/splose-sync/ignore').send({ queueIds: [a.queueId, b.queueId, '00000000-0000-0000-0000-000000000000'] });
    expect(r.status).toBe(200);
    expect(r.body.ignored.map(x => x.queueId).sort()).toEqual([a.queueId, b.queueId].sort());
    expect(r.body.skipped).toEqual([{ queueId: '00000000-0000-0000-0000-000000000000', code: 'not_found' }]);
    expect((await agent.post('/api/splose-sync/ignore').send({})).status).toBe(400);
  });

  test('undo: a therapist is refused; an owner restores it and the create is queued again with its service', async () => {
    const app = buildApp();
    const { agent: owner, user: ownerUser } = await agentFor(app, { role: 'owner' });
    const { eventId, queueId } = await book(owner);
    expect((await owner.post(`/api/splose-sync/pending/${queueId}/ignore`).send({})).status).toBe(200);

    const { agent: therapist } = await agentFor(app);
    expect((await therapist.post(`/api/splose-sync/ignored/${eventId}/undo`).send({})).status).toBe(403);

    const u = await owner.post(`/api/splose-sync/ignored/${eventId}/undo`).send({});
    expect(u.status).toBe(200);
    expect(u.body.queued).toBeTruthy();
    const ev = await db.pool.query(`SELECT splose_sync_ignored_at FROM events WHERE id = $1`, [eventId]);
    expect(ev.rows[0].splose_sync_ignored_at).toBeNull();
    const pend = await owner.get('/api/splose-sync/pending');
    expect(pend.body.changes).toEqual([expect.objectContaining({ action: 'create', eventId, payload: expect.objectContaining({ patientId: 41, serviceId: 125320 }) })]);
    const audit = await db.pool.query(`SELECT actor_user_id FROM audit_logs WHERE action = 'splose_sync_ignore_undone'`);
    expect(audit.rows).toEqual([{ actor_user_id: ownerUser.id }]);
    expect((await owner.post(`/api/splose-sync/ignored/${eventId}/undo`).send({})).status).toBe(404);
  });
});

describe('writes switched off', () => {
  test('Send is refused; link and ignore still work', async () => {
    process.env.ENABLE_SPLOSE_WRITE = 'false';
    const app = buildApp();
    const { agent } = await agentFor(app);
    const a = await book(agent);
    const b = await book(agent, '2026-09-15T01:00:00.000Z', '2026-09-15T02:00:00.000Z');
    const pub = await agent.post('/api/splose-sync/publish').send({ queueIds: [a.queueId] });
    expect(pub.status).toBe(403);
    expect(pub.body).toMatchObject({ code: 'splose_write_disabled', error: 'Splose writing is switched off in this environment' });
    const st = await agent.get('/api/splose-sync/status');
    expect(st.body.writeEnabled).toBe(false);

    mockDiary = [appt(7001, START)];
    expect((await agent.post(`/api/splose-sync/pending/${a.queueId}/link`).send({ sploseAppointmentId: '7001' })).status).toBe(200);
    expect((await agent.post(`/api/splose-sync/pending/${b.queueId}/ignore`).send({})).status).toBe(200);
    expect(mockSplose.createAppointment).not.toHaveBeenCalled();
  });
});

describe('guards', () => {
  test('read-only accounts are refused on every new route', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app, { role: 'read_only' });
    const z = '00000000-0000-0000-0000-000000000000';
    for (const [method, path] of [
      ['get', '/api/splose-sync/matches'], ['post', `/api/splose-sync/pending/${z}/link`], ['post', '/api/splose-sync/link-matches'],
      ['post', `/api/splose-sync/pending/${z}/ignore`], ['post', '/api/splose-sync/ignore'], ['get', '/api/splose-sync/ignored'],
      ['post', `/api/splose-sync/ignored/${z}/undo`],
    ]) {
      const r = await agent[method](path).send({ sploseAppointmentId: '7001', queueIds: [z] });
      expect([method, path, r.status]).toEqual([method, path, 403]);
    }
  });

  test('unauthenticated callers get 401', async () => {
    const app = buildApp();
    const r = await request(app).get('/api/splose-sync/matches');
    expect(r.status).toBe(401);
  });

  test("a therapist cannot link, ignore or see matches for another user's queue; an owner can act on it", async () => {
    const app = buildApp();
    const { agent: a } = await agentFor(app);
    const { agent: b, user: ub } = await agentFor(app);
    const { queueId, eventId } = await book(b);
    mockDiary = [appt(7001, START)];
    const link = await a.post(`/api/splose-sync/pending/${queueId}/link?userId=${ub.id}`).send({ sploseAppointmentId: '7001' });
    expect(link.status).toBe(404);
    const ign = await a.post(`/api/splose-sync/pending/${queueId}/ignore?userId=${ub.id}`).send({});
    expect(ign.status).toBe(404);
    const m = await a.get(`/api/splose-sync/matches?userId=${ub.id}`);
    expect(m.body.matches).toEqual({});
    const bulk = await a.post('/api/splose-sync/link-matches').send({ userId: ub.id });
    expect(bulk.body.linked).toEqual([]);

    const { agent: owner } = await agentFor(app, { role: 'owner' });
    const ok = await owner.post(`/api/splose-sync/pending/${queueId}/link?userId=${ub.id}`).send({ sploseAppointmentId: '7001' });
    expect(ok.status).toBe(200);
    const ev = await db.pool.query(`SELECT splose_id FROM events WHERE id = $1`, [eventId]);
    expect(ev.rows[0].splose_id).toBe('7001');
  });
});
