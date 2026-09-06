'use strict';

/**
 * Splose draft-and-publish sync (migration 058) — integration tests against
 * the real *_test database. Splose and Microsoft are mocked: no network.
 *
 * Pins:
 *   - migration 058: splose_sync_queue and splose_change_alerts exist
 *   - a client booking through POST /api/outlook/events queues a 'create'
 *   - a move (PATCH) on a queued booking amends the same row, still 'create'
 *   - deleting a queued-but-unpublished booking discards the row
 *   - deleting a Splose-linked booking queues a 'cancel'
 *   - read-only accounts get 403 on every /api/splose-sync route
 *   - publish runs the queue: the create stamps events.splose_id, the cancel
 *     calls Splose with a reason, a failed row stays listed with its error
 *   - a 'valid' alert verdict applies the Splose-side change locally and is
 *     audited; 'invalid' leaves the event alone
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

const mockSplose = {
  // Mirrors the real module: every write is refused when ENABLE_SPLOSE_WRITE is off.
  createAppointment: jest.fn(async (d) => {
    if (process.env.ENABLE_SPLOSE_WRITE === 'false') { const e = new Error('off'); e.code = 'FEATURE_DISABLED'; throw e; }
    return { id: 7001, ...d };
  }),
  updateAppointment: jest.fn(async () => ({})),
  cancelAppointment: jest.fn(async () => 1),
  getCancellationReasons: jest.fn(async () => [{ id: 57064, reason: 'Sick' }, { id: 57066, reason: 'Other' }]),
  getLocations: jest.fn(async () => [{ id: 9456, title: 'Opal Therapy', archived: false }]),
  fetchAllCases: jest.fn(async () => [{ id: 300, patientId: 41, status: 'Active' }]),
  getServices: jest.fn(async () => [{ id: 125320, name: 'Therapy Session' }]),
  getAppointments: jest.fn(async () => []),
};
jest.mock('../../splose-api', () => mockSplose);

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { db, truncateAll, seedUser, closePool } = require('./helpers');

const PASSWORD = 'DraftSyncPass1';

beforeEach(async () => {
  await truncateAll();
  jest.clearAllMocks();
  // Many logins in one file would otherwise trip the login rate limiter, and
  // leaving it exhausted would 429 whichever file runs next.
  require('../../auth')._resetLoginRateLimit();
  require('../../splose-sync-routes')._resetPublisher();
  process.env.ENABLE_SPLOSE_DRAFT_SYNC = 'true';
  process.env.ENABLE_SPLOSE_WRITE = 'true';
  process.env.ENABLE_OUTLOOK_WRITE = 'true';
  // Off unless a test turns it on: the manual-publish tests count pending rows.
  process.env.ENABLE_SPLOSE_AUTO_SYNC = 'false';
  delete process.env.SPLOSE_AUTO_SYNC_DELAY_MS;
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

async function agentFor(app, overrides = {}) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser({ password_hash: hash, ...overrides });
  // Outlook "connected" so the event write path has a token to use.
  await db.pool.query(
    `UPDATE users SET access_token = 'tok', refresh_token = 'ref', token_expires_at = NOW() + interval '1 hour' WHERE id = $1`,
    [user.id]
  );
  await db.pool.query(
    `INSERT INTO therapist_profiles (user_id, display_name, splose_practitioner_id) VALUES ($1, 'Test Therapist', '88167')`,
    [user.id]
  );
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user };
}

const START = '2026-09-14T01:00:00.000Z';
const END   = '2026-09-14T02:00:00.000Z';

async function bookClient(agent, extra = {}) {
  const res = await agent.post('/api/outlook/events').send({
    title: 'Client Appointment — Casey L', startTime: START, endTime: END,
    categories: ['Client Appointments'],
    splose: { patientId: 41, patientName: 'Casey L', sessionType: 'therapy', ...extra },
  });
  expect(res.status).toBe(201);
  return res.body;
}

async function waitForIdle(agent) {
  for (let i = 0; i < 50; i++) {
    const st = await agent.get('/api/splose-sync/status');
    if (st.status === 200 && !st.body.running) return st.body;
    await new Promise(r => setTimeout(r, 40));
  }
  throw new Error('publish did not finish');
}

describe('migration 058', () => {
  test('creates both tables with their constraints', async () => {
    const t = await db.pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_name IN ('splose_sync_queue', 'splose_change_alerts') ORDER BY 1`
    );
    expect(t.rows.map(r => r.table_name)).toEqual(['splose_change_alerts', 'splose_sync_queue']);
    await expect(db.pool.query(
      `INSERT INTO splose_sync_queue (user_id, event_id, action) VALUES (gen_random_uuid(), gen_random_uuid(), 'explode')`
    )).rejects.toThrow();
  });
});

describe('queueing from the calendar routes', () => {
  test('a client booking queues a create; a move amends it; a delete discards it', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app);
    const booked = await bookClient(agent);
    expect(booked.sploseQueued).toBeTruthy();

    let pend = await agent.get('/api/splose-sync/pending');
    expect(pend.status).toBe(200);
    expect(pend.body.count).toBe(1);
    expect(pend.body.changes[0]).toMatchObject({ action: 'create', eventId: booked.dbId, payload: { patientId: 41, sessionType: 'therapy' } });

    // Move it: still one row, still a create, with the new time.
    const moved = await agent.patch(`/api/outlook/events/${booked.dbId}`).send({ startTime: '2026-09-14T03:00:00.000Z', endTime: '2026-09-14T04:00:00.000Z' });
    expect(moved.status).toBe(200);
    pend = await agent.get('/api/splose-sync/pending');
    expect(pend.body.count).toBe(1);
    expect(pend.body.changes[0].action).toBe('create');
    expect(pend.body.changes[0].start).toBe('2026-09-14T03:00:00.000Z');

    // Delete before it ever reached Splose → nothing left to publish.
    const del = await agent.delete(`/api/outlook/events/${booked.dbId}`);
    expect(del.status).toBe(200);
    pend = await agent.get('/api/splose-sync/pending');
    expect(pend.body.count).toBe(0);
    const q = await db.pool.query(`SELECT status FROM splose_sync_queue WHERE event_id = $1`, [booked.dbId]);
    expect(q.rows[0].status).toBe('discarded');
    expect(user.id).toBeTruthy();
  });

  test('deleting a Splose-linked appointment queues a cancel', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app);
    const { rows } = await db.pool.query(
      `INSERT INTO events (user_id, title, start_time, end_time, event_type, splose_id, outlook_id)
       VALUES ($1, 'Client Appointment — Riley N', $2, $3, 'therapy', '6100', 'OL-x') RETURNING id`,
      [user.id, START, END]
    );
    const del = await agent.delete(`/api/outlook/events/${rows[0].id}`).send({ reasonId: 57064 });
    expect(del.status).toBe(200);
    const pend = await agent.get('/api/splose-sync/pending');
    expect(pend.body.count).toBe(1);
    expect(pend.body.changes[0]).toMatchObject({ action: 'cancel', payload: { reasonId: 57064 } });
  });

  test('nothing is queued when the draft-sync flag is off', async () => {
    process.env.ENABLE_SPLOSE_DRAFT_SYNC = 'false';
    const app = buildApp();
    const { agent } = await agentFor(app);
    const booked = await bookClient(agent);
    expect(booked.sploseQueued).toBeNull();
    const pend = await agent.get('/api/splose-sync/pending');
    expect(pend.status).toBe(403);
    expect(pend.body.code).toBe('feature_disabled');
  });
});

describe('guards', () => {
  test('read-only accounts are refused on every sync route', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app, { role: 'read_only' });
    for (const [method, path] of [
      ['get', '/api/splose-sync/pending'], ['get', '/api/splose-sync/status'], ['get', '/api/splose-sync/alerts'],
      ['post', '/api/splose-sync/publish'], ['delete', '/api/splose-sync/pending/00000000-0000-0000-0000-000000000000'],
      ['post', '/api/splose-sync/alerts/00000000-0000-0000-0000-000000000000/ack'],
      ['get', '/api/splose/cancellation-reasons'],
    ]) {
      const r = await agent[method](path).send({});
      expect([method, path, r.status]).toEqual([method, path, 403]);
    }
  });

  test('unauthenticated callers get 401', async () => {
    const app = buildApp();
    const r = await request(app).get('/api/splose-sync/pending');
    expect(r.status).toBe(401);
  });

  test('a therapist cannot read another user\'s queue via ?userId', async () => {
    const app = buildApp();
    const { agent: a } = await agentFor(app);
    const { agent: b, user: ub } = await agentFor(app);
    await bookClient(b);
    const r = await a.get('/api/splose-sync/pending?userId=' + ub.id);
    expect(r.status).toBe(200);
    expect(r.body.count).toBe(0);            // scoped back to the caller
  });
});

describe('publishing', () => {
  test('writes the queue to Splose in order, stamps splose_id, keeps a failed row with its reason', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app);
    const booked = await bookClient(agent);
    // A linked appointment to cancel, and one whose cancel Splose will reject.
    const { rows: linked } = await db.pool.query(
      `INSERT INTO events (user_id, title, start_time, end_time, event_type, splose_id, outlook_id)
       VALUES ($1, 'Client Appointment — Riley N', $2, $3, 'therapy', '6100', 'OL-a'),
              ($1, 'Client Appointment — Sam P',   $2, $3, 'therapy', '6200', 'OL-b') RETURNING id, splose_id`,
      [user.id, START, END]
    );
    await agent.delete(`/api/outlook/events/${linked[0].id}`).send({ reasonId: 57064 });
    await agent.delete(`/api/outlook/events/${linked[1].id}`).send({});
    mockSplose.cancelAppointment.mockImplementation(async (id) => {
      if (String(id) === '6200') { const e = new Error('gone'); e.response = { status: 404 }; throw e; }
      return 1;
    });

    const pend = await agent.get('/api/splose-sync/pending');
    expect(pend.body.count).toBe(3);
    const createRow = pend.body.changes.find(c => c.action === 'create');

    const pub = await agent.post('/api/splose-sync/publish').send({ overrides: { [createRow.id]: { serviceId: 125320 } } });
    expect(pub.status).toBe(202);
    const st = await waitForIdle(agent);
    expect(st.lastRun).toMatchObject({ total: 3, failed: 1 });

    // Order: cancels before the create.
    const order = st.lastRun.results.map(r => r.action);
    expect(order.slice(0, 2)).toEqual(['cancel', 'cancel']);
    expect(order[2]).toBe('create');

    expect(mockSplose.cancelAppointment).toHaveBeenCalledWith('6100', 57064, expect.any(String));
    expect(mockSplose.createAppointment).toHaveBeenCalledWith(expect.objectContaining({
      patientId: 41, serviceId: 125320, locationId: 9456, practitionerId: '88167', caseId: 300,
    }));

    const ev = await db.pool.query(`SELECT splose_id, client_id FROM events WHERE id = $1`, [booked.dbId]);
    expect(ev.rows[0]).toEqual({ splose_id: '7001', client_id: '41' });

    const after = await agent.get('/api/splose-sync/pending');
    expect(after.body.count).toBe(1);
    expect(after.body.changes[0]).toMatchObject({ action: 'cancel', status: 'failed', error: 'Splose no longer has this appointment' });

    const audit = await db.pool.query(`SELECT action FROM audit_logs WHERE action = 'splose_sync_publish_started'`);
    expect(audit.rows).toHaveLength(1);
  });

  test('publishing is refused when Splose writing is off, and the row stays pending', async () => {
    process.env.ENABLE_SPLOSE_WRITE = 'false';
    const app = buildApp();
    const { agent } = await agentFor(app);
    const booked = await bookClient(agent);
    const pend = await agent.get('/api/splose-sync/pending');
    const pub = await agent.post('/api/splose-sync/publish').send({ overrides: { [pend.body.changes[0].id]: { serviceId: 125320 } } });
    expect(pub.status).toBe(202);
    const st = await waitForIdle(agent);
    expect(st.lastRun.failed).toBe(1);
    expect(st.lastRun.results[0].error).toMatch(/switched off/);
    const ev = await db.pool.query(`SELECT splose_id FROM events WHERE id = $1`, [booked.dbId]);
    expect(ev.rows[0].splose_id).toBeNull();
  });
});

describe('changes made inside Splose', () => {
  async function seedAlert(user, eventId, kind, details, fp = 'fp1') {
    const { rows } = await db.pool.query(
      `INSERT INTO splose_change_alerts (user_id, event_id, splose_appointment_id, kind, fingerprint, details)
       VALUES ($1, $2, '6100', $3, $4, $5::jsonb) RETURNING id`,
      [user.id, eventId, kind, fp, JSON.stringify(details)]
    );
    return rows[0].id;
  }

  test('a valid "moved" verdict moves the local event; "invalid" leaves it and both are audited', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app);
    const { rows } = await db.pool.query(
      `INSERT INTO events (user_id, title, start_time, end_time, event_type, splose_id, outlook_id)
       VALUES ($1, 'Client Appointment — Riley N', $2, $3, 'therapy', '6100', 'OL-a') RETURNING id`,
      [user.id, START, END]
    );
    const eventId = rows[0].id;
    const to = { start: '2026-09-14T05:00:00.000Z', end: '2026-09-14T06:00:00.000Z' };
    const a1 = await seedAlert(user, eventId, 'moved', { from: { start: START, end: END }, to }, 'm1');

    let list = await agent.get('/api/splose-sync/alerts');
    expect(list.body.alerts.map(a => a.id)).toEqual([a1]);

    const ack = await agent.post(`/api/splose-sync/alerts/${a1}/ack`).send({ verdict: 'valid' });
    expect(ack.status).toBe(200);
    expect(ack.body.applied).toMatchObject({ kind: 'moved', changed: true });
    const ev = await db.pool.query(`SELECT start_time FROM events WHERE id = $1`, [eventId]);
    expect(new Date(ev.rows[0].start_time).toISOString()).toBe(to.start);

    const a2 = await seedAlert(user, eventId, 'cancelled', { reason: 'Sick' }, 'c1');
    const nack = await agent.post(`/api/splose-sync/alerts/${a2}/ack`).send({ verdict: 'invalid', note: 'Client did not cancel' });
    expect(nack.status).toBe(200);
    const still = await db.pool.query(`SELECT is_deleted FROM events WHERE id = $1`, [eventId]);
    expect(still.rows[0].is_deleted).not.toBe(true);

    list = await agent.get('/api/splose-sync/alerts');
    expect(list.body.alerts).toEqual([]);
    const audit = await db.pool.query(`SELECT action FROM audit_logs WHERE action LIKE 'splose_external_change_%' ORDER BY action`);
    expect(audit.rows.map(r => r.action)).toEqual(['splose_external_change_invalid', 'splose_external_change_valid']);
  });

  test('a valid "cancelled" verdict soft-deletes the event and drops its queued change', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app);
    const { rows } = await db.pool.query(
      `INSERT INTO events (user_id, title, start_time, end_time, event_type, splose_id)
       VALUES ($1, 'Client Appointment — Riley N', $2, $3, 'therapy', '6100') RETURNING id`,
      [user.id, START, END]
    );
    await db.pool.query(`INSERT INTO splose_sync_queue (user_id, event_id, action, payload) VALUES ($1, $2, 'update', '{}')`, [user.id, rows[0].id]);
    const id = await seedAlert(user, rows[0].id, 'cancelled', { reason: 'Sick' }, 'c2');
    const ack = await agent.post(`/api/splose-sync/alerts/${id}/ack`).send({ verdict: 'valid' });
    expect(ack.status).toBe(200);
    const ev = await db.pool.query(`SELECT is_deleted FROM events WHERE id = $1`, [rows[0].id]);
    expect(ev.rows[0].is_deleted).toBe(true);
    const q = await db.pool.query(`SELECT status FROM splose_sync_queue WHERE event_id = $1`, [rows[0].id]);
    expect(q.rows[0].status).toBe('discarded');
  });

  test('another therapist cannot acknowledge my alert', async () => {
    const app = buildApp();
    const { user } = await agentFor(app);
    const { agent: other } = await agentFor(app);
    const id = await seedAlert(user, null, 'created', { start: START, end: END }, 'n1');
    const r = await other.post(`/api/splose-sync/alerts/${id}/ack`).send({ verdict: 'valid' });
    expect(r.status).toBe(404);
  });
});

describe('auto-sync — the queue writes itself after a quiet period', () => {
  async function waitForQueue(pred, ms = 3000) {
    const started = Date.now();
    while (Date.now() - started < ms) {
      const { rows } = await db.pool.query(`SELECT status, error FROM splose_sync_queue`);
      if (pred(rows)) return rows;
      await new Promise(r => setTimeout(r, 25));
    }
    return (await db.pool.query(`SELECT status, error FROM splose_sync_queue`)).rows;
  }

  test('a complete booking reaches Splose without Sync Splose being pressed, and is audited as automatic', async () => {
    process.env.ENABLE_SPLOSE_AUTO_SYNC = 'true';
    process.env.SPLOSE_AUTO_SYNC_DELAY_MS = '40';
    process.env.SPLOSE_AUTO_SYNC_MIN_GAP_MS = '0';
    require('../../splose-sync-routes')._resetPublisher();
    const app = buildApp();
    const { agent } = await agentFor(app);
    const st0 = await agent.get('/api/splose-sync/status');
    expect(st0.body.autoSyncEnabled).toBe(true);

    const booked = await bookClient(agent, { serviceId: 125320 });
    const st1 = await agent.get('/api/splose-sync/status');
    expect(st1.body.autoSync).toMatchObject({ dueAt: expect.any(String) });

    const rows = await waitForQueue(r => r.length === 1 && r[0].status === 'done');
    expect(rows).toEqual([{ status: 'done', error: null }]);
    expect(mockSplose.createAppointment).toHaveBeenCalledWith(expect.objectContaining({ patientId: 41, serviceId: 125320 }));
    const ev = await db.pool.query(`SELECT splose_id FROM events WHERE id = $1`, [booked.dbId]);
    expect(ev.rows[0].splose_id).toBe('7001');
    const audit = await db.pool.query(`SELECT action FROM audit_logs WHERE action = 'splose_sync_auto_started'`);
    expect(audit.rows).toHaveLength(1);
    const pend = await agent.get('/api/splose-sync/pending');
    expect(pend.body.count).toBe(0);
  });

  test('a booking with no service is left for the review list; a move on it is not written either', async () => {
    process.env.ENABLE_SPLOSE_AUTO_SYNC = 'true';
    process.env.SPLOSE_AUTO_SYNC_DELAY_MS = '40';
    process.env.SPLOSE_AUTO_SYNC_MIN_GAP_MS = '0';
    require('../../splose-sync-routes')._resetPublisher();
    const app = buildApp();
    const { agent } = await agentFor(app);
    const booked = await bookClient(agent);
    await agent.patch(`/api/outlook/events/${booked.dbId}`).send({ startTime: '2026-09-15T01:00:00.000Z', endTime: '2026-09-15T02:00:00.000Z' });
    await new Promise(r => setTimeout(r, 200));
    const rows = await db.pool.query(`SELECT action, status, attempts FROM splose_sync_queue`);
    expect(rows.rows).toEqual([{ action: 'create', status: 'pending', attempts: 0 }]);
    expect(mockSplose.createAppointment).not.toHaveBeenCalled();
    expect(mockSplose.updateAppointment).not.toHaveBeenCalled();
  });

  test('with the flag off nothing is scheduled', async () => {
    process.env.SPLOSE_AUTO_SYNC_DELAY_MS = '40';
    const app = buildApp();
    const { agent } = await agentFor(app);
    await bookClient(agent, { serviceId: 125320 });
    const st = await agent.get('/api/splose-sync/status');
    expect(st.body.autoSyncEnabled).toBe(false);
    expect(st.body.autoSync).toBeNull();
    await new Promise(r => setTimeout(r, 120));
    const rows = await db.pool.query(`SELECT status FROM splose_sync_queue`);
    expect(rows.rows).toEqual([{ status: 'pending' }]);
  });
});
