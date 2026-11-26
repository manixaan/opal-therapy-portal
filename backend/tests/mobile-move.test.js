'use strict';

/**
 * POST /api/mobile/appointments/:id/move and the calendar's new fields
 * (canMove, linkedTo, travelLegs). Supertest against the mounted router; the
 * DB is an in-memory emulation of the SQL the route issues; event-move.js's
 * sync step is mocked (it has its own tests).
 */

jest.mock('../database', () => ({
  pool: { query: jest.fn(), connect: jest.fn() },
  getUserByEmail: jest.fn(),
  getUser: jest.fn(),
  logAuditEvent: jest.fn().mockResolvedValue(null),
  recordLogin: jest.fn().mockResolvedValue(null),
  getEventsForTherapists: jest.fn().mockResolvedValue([]),
  initializeDatabase: jest.fn().mockResolvedValue(null),
}));
jest.mock('../email', () => ({ sendVerificationEmail: jest.fn(), sendPasswordResetEmail: jest.fn() }));
jest.mock('../outlook-oauth', () => ({}));
jest.mock('../splose-api', () => ({}));
jest.mock('../event-move', () => {
  const real = jest.requireActual('../event-move');
  return {
    ...real,
    defaultDeps: () => ({}),
    mirrorPlan: jest.fn(async (_d, _u, outlookId) => ({ prefs: null, mirrorToOutlook: !!outlookId })),
    moveEvent: jest.fn(async ({ outlookId }) => ({ ok: true, savedToDb: true, savedToOutlook: !!outlookId,
      outlookStatus: outlookId ? 'saved' : 'not_linked', splose: 'queued' })),
  };
});

const request = require('supertest');
const bcrypt = require('bcryptjs');
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const db = require('../database');
const eventMove = require('../event-move');

const TP_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const ORG = 'cccccccc-2222-4222-8222-222222222222';
const mkUser = (id, role, extra = {}) => ({ id, email: `${id.slice(0, 4)}@opaltherapy.com.au`, role, is_active: true,
  account_status: 'active', email_verified: true, organisation_id: ORG, permissions: null, name: role, ...extra });
const USER_A = mkUser('aaaaaaaa-1111-4111-8111-111111111111', 'therapist', { therapist_profile_id: TP_A });
const USER_B = mkUser('bbbbbbbb-1111-4111-8111-111111111111', 'therapist');
const READ_ONLY = mkUser('cccccccc-1111-4111-8111-111111111111', 'read_only');
const ADMIN = mkUser('dddddddd-1111-4111-8111-111111111111', 'admin');
const USERS = Object.fromEntries([USER_A, USER_B, READ_ONLY, ADMIN].map((u) => [u.id, u]));

const SESSION_ID = 'eeeeeeee-0000-4000-8000-000000000001';
const BLOCK_ID = 'eeeeeeee-0000-4000-8000-000000000002';
const MEETING_ID = 'eeeeeeee-0000-4000-8000-000000000003';
// 2 Mar 2027 (future), Perth: session 09:00–10:00, its travel block 08:30–09:00, a meeting 12:00–13:00.
const SESSION = { id: SESSION_ID, user_id: USER_A.id, therapist_profile_id: TP_A, title: 'OT · Client One',
  event_type: 'therapy', status: 'confirmed', start_time: '2027-03-02T01:00:00.000Z', end_time: '2027-03-02T02:00:00.000Z',
  location: '12 Smith Street, Willetton WA', outlook_id: 'ol-1', splose_id: 'sp-1', custom_metadata: { secret: 'x' }, is_deleted: false };
const BLOCK = { ...SESSION, id: BLOCK_ID, title: 'Travel', event_type: 'travel', related_event_id: SESSION_ID,
  start_time: '2027-03-02T00:30:00.000Z', end_time: '2027-03-02T01:00:00.000Z', location: null, outlook_id: null, splose_id: null };
const MEETING = { ...SESSION, id: MEETING_ID, title: 'Team meeting', event_type: 'admin', location: null,
  start_time: '2027-03-02T04:00:00.000Z', end_time: '2027-03-02T05:00:00.000Z', outlook_id: null, splose_id: null };

let store, txLog, updateFails, pendingMoves;

function installDb() {
  db.pool.query.mockImplementation(async (sql, p = []) => {
    const q = String(sql).replace(/\s+/g, ' ');
    if (q.includes('related_event_id = $1')) {
      return { rows: [...store.values()].filter((e) => e.related_event_id === p[0] && e.user_id === p[1] && !e.is_deleted) };
    }
    if (q.includes('FROM events WHERE id = $1 AND user_id = $2')) {
      const e = store.get(p[0]);
      return { rows: e && e.user_id === p[1] && !e.is_deleted ? [e] : [] };
    }
    if (q.includes('SELECT * FROM events WHERE id = $1')) return { rows: store.has(p[0]) ? [store.get(p[0])] : [] };
    if (q.includes('FROM events WHERE user_id = $1')) {
      const [uid, s, e2] = p;
      return { rows: [...store.values()].filter((e) => e.user_id === uid && !e.is_deleted
        && (!e.therapist_profile_id || e.therapist_profile_id !== p[3])
        && new Date(e.start_time) < new Date(e2) && new Date(e.end_time) > new Date(s)) };
    }
    if (q.includes('FROM users WHERE id = $1')) return { rows: [{ id: p[0], work_location_schedule: {}, default_work_location: {} }] };
    return { rows: [], rowCount: 0 };
  });
  db.getEventsForTherapists.mockImplementation(async (ids, { startDate, endDate }) => [...store.values()]
    .filter((e) => ids.includes(e.therapist_profile_id) && !e.is_deleted
      && new Date(e.start_time) < new Date(endDate) && new Date(e.end_time) > new Date(startDate)));
  db.pool.connect.mockImplementation(async () => ({
    query: jest.fn(async (sql, p = []) => {
      const q = String(sql).replace(/\s+/g, ' ');
      txLog.push(q.split(' ')[0]);
      if (q.startsWith('UPDATE events')) {
        const e = store.get(p[3]);
        const guard = e && e.user_id === p[4] && new Date(e.start_time).toISOString() === p[5];
        if (!guard || updateFails === p[3]) return { rowCount: 0 };
        pendingMoves.push([p[3], p[0]]);
        return { rowCount: 1 };
      }
      if (q === 'COMMIT') {
        for (const [id, start] of pendingMoves) {
          const e = store.get(id);
          const dur = new Date(e.end_time) - new Date(e.start_time);
          store.set(id, { ...e, start_time: start, end_time: new Date(new Date(start).getTime() + dur).toISOString() });
        }
      }
      return { rows: [], rowCount: 0 };
    }),
    release: jest.fn(),
  }));
}

let app, HASH, ip = 0;
beforeAll(async () => {
  HASH = await bcrypt.hash('ValidPass1', 1);
  app = express();
  app.set('trust proxy', 1);
  app.use(bodyParser.json());
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false }));
  app.use('/', require('../auth'));
  app.use('/', require('../mobile-routes'));
});
beforeEach(() => {
  jest.clearAllMocks();
  store = new Map([SESSION, BLOCK, MEETING].map((e) => [e.id, { ...e }]));
  txLog = []; pendingMoves = []; updateFails = null;
  installDb();
  db.getUser.mockImplementation(async (id) => (USERS[id] ? { ...USERS[id] } : null));
});

async function loginAs(user) {
  db.getUserByEmail.mockResolvedValueOnce({ ...user, password_hash: HASH });
  const agent = request.agent(app);
  const r = await agent.post('/api/auth/login').set('X-Forwarded-For', `10.77.0.${(ip++ % 200) + 10}`)
    .send({ email: user.email, password: 'ValidPass1' });
  expect(r.status).toBe(200);
  return agent;
}

const moveBody = (startPerth, endPerth, from = SESSION) => ({
  start: `2027-03-02T${startPerth}:00+08:00`, end: `2027-03-02T${endPerth}:00+08:00`,
  expectedStart: from.start_time, expectedEnd: from.end_time,
});
const url = `/api/mobile/appointments/${SESSION_ID}/move`;

describe('guards', () => {
  test('unauthenticated → 401', async () => {
    expect((await request(app).post(url).send(moveBody('10:00', '11:00'))).status).toBe(401);
  });
  test('read_only → 403 and nothing written', async () => {
    const res = await (await loginAs(READ_ONLY)).post(url).send(moveBody('10:00', '11:00'));
    expect(res.status).toBe(403);
    expect(db.pool.connect).not.toHaveBeenCalled();
  });
  test('another therapist’s appointment → 404, indistinguishable from missing', async () => {
    const res = await (await loginAs(USER_B)).post(url).send(moveBody('10:00', '11:00'));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found', code: 'not_found' });
    expect(db.pool.connect).not.toHaveBeenCalled();
  });
  test('admin (manage_all_schedules) may move only their OWN rows', async () => {
    const res = await (await loginAs(ADMIN)).post(url).send(moveBody('10:00', '11:00'));
    expect(res.status).toBe(404);
  });
  test('non-uuid id → 404', async () => {
    const res = await (await loginAs(USER_A)).post('/api/mobile/appointments/not-an-id/move').send(moveBody('10:00', '11:00'));
    expect(res.status).toBe(404);
  });
});

describe('a move', () => {
  test('moves the session AND its linked travel block in one transaction, then syncs each the portal’s way', async () => {
    const res = await (await loginAs(USER_A)).post(url).send(moveBody('10:00', '11:00'));
    expect(res.status).toBe(200);
    expect(txLog[0]).toBe('BEGIN');
    expect(txLog).toContain('COMMIT');
    expect(store.get(SESSION_ID).start_time).toBe('2027-03-02T02:00:00.000Z');
    expect(store.get(BLOCK_ID).start_time).toBe('2027-03-02T01:30:00.000Z');
    expect(res.body).toMatchObject({ ok: true, linkedMoved: [BLOCK_ID], outlookTravelStale: true,
      sync: { splose: 'queued', outlook: 'saved' }, warnings: [] });
    expect(eventMove.moveEvent).toHaveBeenCalledTimes(2);
    for (const [arg] of eventMove.moveEvent.mock.calls) expect(arg).toMatchObject({ writeLocal: false, userId: USER_A.id });
    expect(db.logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'mobile_event_moved', targetId: SESSION_ID,
      metadata: { id: SESSION_ID, deltaMinutes: 60, linkedMoved: [BLOCK_ID] } }));
  });

  test('response carries no raw sync payloads', async () => {
    const res = await (await loginAs(USER_A)).post(url).send(moveBody('10:00', '11:00'));
    const text = JSON.stringify(res.body);
    for (const leak of ['sp-1', 'ol-1', 'secret', 'custom_metadata']) expect(text).not.toContain(leak);
  });

  test('overlap → 409 overlap naming the clash; nothing written', async () => {
    const res = await (await loginAs(USER_A)).post(url).send(moveBody('11:30', '12:30'));
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'overlap', conflict: { id: MEETING_ID, title: 'Team meeting' } });
    expect(db.pool.connect).not.toHaveBeenCalled();
    expect(eventMove.moveEvent).not.toHaveBeenCalled();
  });

  test('changed since loaded → 409 changed', async () => {
    const body = { ...moveBody('10:00', '11:00'), expectedStart: '2027-03-02T00:00:00.000Z' };
    const res = await (await loginAs(USER_A)).post(url).send(body);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('changed');
  });

  test('a row changed between check and write → rollback, 409 changed, no sync', async () => {
    updateFails = BLOCK_ID;
    const res = await (await loginAs(USER_A)).post(url).send(moveBody('10:00', '11:00'));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('changed');
    expect(txLog).toContain('ROLLBACK');
    expect(txLog).not.toContain('COMMIT');
    expect(store.get(SESSION_ID).start_time).toBe(SESSION.start_time);
    expect(eventMove.moveEvent).not.toHaveBeenCalled();
  });

  test('a cancelled appointment → 403 not_movable', async () => {
    store.set(SESSION_ID, { ...SESSION, status: 'cancelled' });
    const res = await (await loginAs(USER_A)).post(url).send(moveBody('10:00', '11:00'));
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'not_movable', reason: 'cancelled' });
  });

  test('bad body → 400 invalid', async () => {
    const res = await (await loginAs(USER_A)).post(url).send({ start: 'tomorrow' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid');
  });
});

describe('GET /api/mobile/calendar additions', () => {
  test('canMove, linkedTo and a travelLegs list per day', async () => {
    const res = await (await loginAs(USER_A)).get('/api/mobile/calendar?date=2027-03-02');
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.days[0].appointments.map((a) => [a.id, a]));
    expect(byId[SESSION_ID]).toMatchObject({ canMove: true, linkedTo: null });
    expect(byId[BLOCK_ID]).toMatchObject({ canMove: true, linkedTo: SESSION_ID });
    expect(Array.isArray(res.body.days[0].travelLegs)).toBe(true);
  });

  test('read_only sees canMove:false everywhere', async () => {
    db.getEventsForTherapists.mockResolvedValue([]);
    store.forEach((e, id) => store.set(id, { ...e, user_id: READ_ONLY.id, therapist_profile_id: null }));
    const res = await (await loginAs(READ_ONLY)).get('/api/mobile/calendar?date=2027-03-02');
    expect(res.body.days[0].appointments.length).toBe(3);
    for (const a of res.body.days[0].appointments) expect(a.canMove).toBe(false);
  });
});
