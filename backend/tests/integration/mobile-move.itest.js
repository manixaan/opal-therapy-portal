'use strict';

/**
 * POST /api/mobile/appointments/:id/move against the real *_test database
 * (23 Nov 2026). Splose and Microsoft are mocked — no network.
 *
 * Pins:
 *   - the session and its linked travel block move together, stored as UTC
 *     (TIMESTAMP columns) from a +08:00 request;
 *   - the move takes the portal's road: a Splose-linked session queues an
 *     'update', and Outlook is mirrored with the new times;
 *   - Undo (moving it back) amends the SAME queue row — Splose sees one change;
 *   - an overlap is refused with nothing written, and someone else's row is a 404.
 */

jest.mock('../../outlook-oauth', () => ({
  MICROSOFT_OAUTH_CONFIG: { scopes: ['Calendars.ReadWrite'] },
  getAuthorizationUrl: jest.fn(), getAccessToken: jest.fn(), getMicrosoftUser: jest.fn(), refreshAccessToken: jest.fn(),
  updateOutlookEvent: jest.fn(async () => ({})),
}));
jest.mock('../../splose-api', () => ({ getPatients: jest.fn(async () => []), fetchAllCases: jest.fn(async () => []) }));

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const outlookApi = require('../../outlook-oauth');
const { db, truncateAll, seedUser, closePool } = require('./helpers');

const PASSWORD = 'MobileMovePass1';

beforeEach(async () => {
  await truncateAll();
  jest.clearAllMocks();
  require('../../auth')._resetLoginRateLimit();
  process.env.ENABLE_SPLOSE_DRAFT_SYNC = 'true';
  process.env.ENABLE_SPLOSE_AUTO_SYNC = 'false';
  process.env.ENABLE_OUTLOOK_WRITE = 'true';
});
afterAll(async () => { require('../../auth')._resetLoginRateLimit(); await closePool(); });

function buildApp() {
  const app = express();
  app.use(bodyParser.json());
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../routes'));
  app.use('/', require('../../mobile-routes'));
  return app;
}

async function agentFor(app, overrides = {}) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser({ password_hash: hash, ...overrides });
  await db.pool.query(
    `UPDATE users SET access_token = 'tok', refresh_token = 'ref', token_expires_at = NOW() + interval '1 hour' WHERE id = $1`, [user.id]);
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user };
}

// A day safely in the future, Perth: session 09:00–10:00, its travel block 08:30–09:00.
const DAY = '2027-03-02';
async function seedDay(userId) {
  const ins = (title, type, start, end, extra = {}) => db.pool.query(
    `INSERT INTO events (user_id, title, event_type, start_time, end_time, location, splose_id, outlook_id, related_event_id, status, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'confirmed','app') RETURNING *`,
    [userId, title, type, start, end, extra.location || null, extra.splose_id || null, extra.outlook_id || null, extra.related || null]);
  const s = (await ins('OT · Client One', 'therapy', '2027-03-02T01:00:00.000Z', '2027-03-02T02:00:00.000Z',
    { location: '12 Smith Street, Willetton WA', splose_id: '555001', outlook_id: 'OL-SESSION' })).rows[0];
  const t = (await ins('Travel', 'travel', '2027-03-02T00:30:00.000Z', '2027-03-02T01:00:00.000Z', { related: s.id })).rows[0];
  const m = (await ins('Team meeting', 'admin', '2027-03-02T04:00:00.000Z', '2027-03-02T05:00:00.000Z')).rows[0];
  return { s, t, m };
}
const times = async (id) => {
  const { rows: [r] } = await db.pool.query('SELECT start_time, end_time, last_modified_by FROM events WHERE id = $1', [id]);
  return { start: new Date(r.start_time).toISOString(), end: new Date(r.end_time).toISOString(), by: r.last_modified_by };
};

test('session + linked travel block move together, sync the portal’s way, and Undo amends the same Splose row', async () => {
  const app = buildApp();
  const { agent } = await agentFor(app);
  const { s, t } = await seedDay((await db.pool.query('SELECT id FROM users LIMIT 1')).rows[0].id);

  const res = await agent.post(`/api/mobile/appointments/${s.id}/move`).send({
    start: `${DAY}T10:00:00+08:00`, end: `${DAY}T11:00:00+08:00`,
    expectedStart: '2027-03-02T01:00:00.000Z', expectedEnd: '2027-03-02T02:00:00.000Z' });
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ ok: true, linkedMoved: [t.id], sync: { splose: 'queued', outlook: 'saved' } });

  expect(await times(s.id)).toEqual({ start: '2027-03-02T02:00:00.000Z', end: '2027-03-02T03:00:00.000Z', by: 'app' });
  expect(await times(t.id)).toEqual({ start: '2027-03-02T01:30:00.000Z', end: '2027-03-02T02:00:00.000Z', by: 'app' });
  expect(outlookApi.updateOutlookEvent).toHaveBeenCalledWith('tok', 'OL-SESSION', expect.objectContaining({
    startTime: '2027-03-02T02:00:00.000Z', endTime: '2027-03-02T03:00:00.000Z' }));

  let q = await db.pool.query(`SELECT action, status, payload FROM splose_sync_queue WHERE event_id = $1`, [s.id]);
  expect(q.rows).toHaveLength(1);
  expect(q.rows[0]).toMatchObject({ action: 'update', status: 'pending' });
  expect(q.rows[0].payload.start).toBe('2027-03-02T02:00:00.000Z');

  // Undo = move it back with the times the phone now holds.
  const undo = await agent.post(`/api/mobile/appointments/${s.id}/move`).send({
    start: `${DAY}T09:00:00+08:00`, end: `${DAY}T10:00:00+08:00`,
    expectedStart: '2027-03-02T02:00:00.000Z', expectedEnd: '2027-03-02T03:00:00.000Z' });
  expect(undo.status).toBe(200);
  expect((await times(t.id)).start).toBe('2027-03-02T00:30:00.000Z');
  q = await db.pool.query(`SELECT payload FROM splose_sync_queue WHERE event_id = $1 AND status IN ('pending','failed')`, [s.id]);
  expect(q.rows).toHaveLength(1);
  expect(q.rows[0].payload.start).toBe('2027-03-02T01:00:00.000Z');

  const audit = await db.pool.query(`SELECT target_id, metadata FROM audit_logs WHERE action = 'mobile_event_moved' ORDER BY created_at`);
  expect(audit.rows.map((r) => [r.target_id, r.metadata.deltaMinutes])).toEqual([[s.id, 60], [s.id, -60]]);
});

test('an overlap is refused and nothing is written; a stale phone gets 409 changed', async () => {
  const app = buildApp();
  const { agent, user } = await agentFor(app);
  const { s, t, m } = await seedDay(user.id);

  const clash = await agent.post(`/api/mobile/appointments/${s.id}/move`).send({
    start: `${DAY}T11:30:00+08:00`, end: `${DAY}T12:30:00+08:00`,
    expectedStart: '2027-03-02T01:00:00.000Z', expectedEnd: '2027-03-02T02:00:00.000Z' });
  expect(clash.status).toBe(409);
  expect(clash.body).toMatchObject({ code: 'overlap', conflict: { id: m.id } });
  expect((await times(s.id)).start).toBe('2027-03-02T01:00:00.000Z');
  expect((await times(t.id)).start).toBe('2027-03-02T00:30:00.000Z');
  expect(outlookApi.updateOutlookEvent).not.toHaveBeenCalled();

  const stale = await agent.post(`/api/mobile/appointments/${s.id}/move`).send({
    start: `${DAY}T10:00:00+08:00`, end: `${DAY}T11:00:00+08:00`,
    expectedStart: '2027-03-02T00:00:00.000Z', expectedEnd: '2027-03-02T01:00:00.000Z' });
  expect(stale.status).toBe(409);
  expect(stale.body.code).toBe('changed');
});

test('someone else’s appointment is a 404 and stays put', async () => {
  const app = buildApp();
  const { agent } = await agentFor(app);
  const other = await seedUser({ role: 'therapist' });
  const { s } = await seedDay(other.id);
  const res = await agent.post(`/api/mobile/appointments/${s.id}/move`).send({
    start: `${DAY}T10:00:00+08:00`, end: `${DAY}T11:00:00+08:00`,
    expectedStart: '2027-03-02T01:00:00.000Z', expectedEnd: '2027-03-02T02:00:00.000Z' });
  expect(res.status).toBe(404);
  expect((await times(s.id)).start).toBe('2027-03-02T01:00:00.000Z');
});

test('the calendar reports canMove and the linked block', async () => {
  const app = buildApp();
  const { agent, user } = await agentFor(app);
  const { s, t } = await seedDay(user.id);
  const res = await agent.get(`/api/mobile/calendar?date=${DAY}`);
  expect(res.status).toBe(200);
  const byId = Object.fromEntries(res.body.days[0].appointments.map((a) => [a.id, a]));
  expect(byId[s.id]).toMatchObject({ canMove: true, linkedTo: null });
  expect(byId[t.id]).toMatchObject({ canMove: true, linkedTo: s.id });
  expect(res.body.days[0].travelLegs).toEqual(expect.any(Array));
});
