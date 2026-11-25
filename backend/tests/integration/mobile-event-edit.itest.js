'use strict';

/**
 * PATCH /api/mobile/appointments/:id/details — edit client, session type and
 * address from the phone (25 Nov 2026), against the real *_test database.
 * Splose, Microsoft and Google are mocked — no network.
 *
 * Pins:
 *   - an address change is saved in place (manual pin + suburb), mirrored to
 *     Outlook, and the day's drives are re-priced into calendar_travel_legs;
 *   - a type or client change REBOOKS the slot the portal's way: a new row
 *     with the composed title/booking, a Splose draft for a client session,
 *     the old row soft-deleted with its Splose cancel queued, its travel
 *     block and travel choices carried to the new booking;
 *   - refusals write nothing: a client outside the caseload, a stale view,
 *     a client-required type with no client, someone else's row, read_only.
 */

jest.mock('../../outlook-oauth', () => ({
  MICROSOFT_OAUTH_CONFIG: { scopes: ['Calendars.ReadWrite'] },
  getAuthorizationUrl: jest.fn(), getAccessToken: jest.fn(), getMicrosoftUser: jest.fn(), refreshAccessToken: jest.fn(),
  updateOutlookEvent: jest.fn(async () => ({})),
  createOutlookEvent: jest.fn(async () => ({ outlookId: `OL-NEW-${Math.random().toString(36).slice(2, 8)}` })),
  deleteOutlookEvent: jest.fn(async () => ({})),
}));
jest.mock('../../splose-api', () => ({
  getPatients: jest.fn(async () => []),
  fetchAllCases: jest.fn(async () => []),
  peekPatient: jest.fn(() => null),
  getPatient: jest.fn(async (id) => {
    if (String(id) === '777002') return { id: 777002, fullName: 'Client Two', formattedAddress: '5 High Road, Riverton WA 6148' };
    const e = new Error('nf'); e.response = { status: 404 }; throw e;
  }),
}));

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const outlookApi = require('../../outlook-oauth');
const maps = require('../../billing/maps-adapter');
const { db, truncateAll, seedUser, closePool } = require('./helpers');

const PASSWORD = 'MobileEditPass1';
const route = jest.fn(async () => ({ minutes: 17, km: 9.2, provider: 'test' }));

beforeEach(async () => {
  await truncateAll();
  jest.clearAllMocks();
  require('../../auth')._resetLoginRateLimit();
  process.env.ENABLE_SPLOSE_DRAFT_SYNC = 'true';
  process.env.ENABLE_SPLOSE_AUTO_SYNC = 'false';
  process.env.ENABLE_OUTLOOK_WRITE = 'true';
  maps.setMapsProvider({ name: 'test', route, geocode: async () => null });
});
afterAll(async () => { maps.setMapsProvider(null); require('../../auth')._resetLoginRateLimit(); await closePool(); });

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
  const user = await seedUser({ password_hash: hash, role: 'owner', ...overrides });
  await db.pool.query(
    `UPDATE users SET access_token = 'tok', refresh_token = 'ref', token_expires_at = NOW() + interval '1 hour' WHERE id = $1`, [user.id]);
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user };
}

// A Perth day: a Splose session 09:00–10:00 (its travel block 08:30–09:00)
// and a second session 11:00–12:00 somewhere else.
// Three days out: the calendar's travel minutes are kept up to 14 days ahead.
const DAY = new Date(Date.now() + 8 * 3600e3 + 3 * 86400e3).toISOString().slice(0, 10);
const at = (hhmm) => new Date(`${DAY}T${hhmm}:00+08:00`).toISOString();
const S_START = at('09:00');
const S_END = at('10:00');
let seq = 0;
async function seedDay(userId) {
  seq += 1;
  const ins = (title, type, start, end, extra = {}) => db.pool.query(
    `INSERT INTO events (user_id, title, event_type, start_time, end_time, location, splose_id, outlook_id,
                         related_event_id, client_id, client_name, custom_metadata, status, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'confirmed','app') RETURNING *`,
    [userId, title, type, start, end, extra.location || null, extra.splose_id || null, extra.outlook_id || null,
      extra.related || null, extra.client_id || null, extra.client_name || null, JSON.stringify(extra.meta || {})]);
  const s = (await ins('Client Appointment — Client One', 'therapy', S_START, S_END, {
    location: '12 Smith Street, Willetton WA 6155', splose_id: `55500${seq}`, outlook_id: 'OL-SESSION',
    client_id: '777001', client_name: 'Client One',
    meta: { booking: { kind: 'therapy', clientId: '777001', clientName: 'Client One' }, travel: { afterOffsetMin: 5 } },
  })).rows[0];
  const t = (await ins('Travel', 'travel', at('08:30'), S_START, { related: s.id })).rows[0];
  const n = (await ins('Client Appointment — Client Three', 'therapy', at('11:00'), at('12:00'),
    { location: '9 Canning Highway, Applecross WA 6153' })).rows[0];
  return { s, t, n };
}
const row = async (id) => (await db.pool.query('SELECT * FROM events WHERE id = $1', [id])).rows[0];
const expected = { expectedStart: `${DAY}T09:00:00+08:00`, expectedEnd: `${DAY}T10:00:00+08:00` };

test('GET …/edit tells the phone the type, client, address and what it can become', async () => {
  const app = buildApp();
  const { agent, user } = await agentFor(app);
  const { s, t } = await seedDay(user.id);
  const res = await agent.get(`/api/mobile/appointments/${s.id}/edit`);
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ canEdit: true, kind: 'therapy', kindLabel: 'Therapy Session',
    client: { id: '777001', name: 'Client One' }, address: '12 Smith Street, Willetton WA 6155' });
  expect(res.body.kinds.map((k) => k.kind)).toEqual(expect.arrayContaining(['therapy', 'telehealth', 'case-noting', 'lunch']));
  expect(res.body.kinds.find((k) => k.kind === 'fca')).toMatchObject({ client: 'required', group: 'report' });

  const travel = await agent.get(`/api/mobile/appointments/${t.id}/edit`);
  expect(travel.body).toMatchObject({ canEdit: false, reason: 'type' });

  const cal = await agent.get(`/api/mobile/calendar?date=${DAY}`);
  const byId = Object.fromEntries(cal.body.days[0].appointments.map((a) => [a.id, a]));
  expect(byId[s.id].canEdit).toBe(true);
  expect(byId[t.id].canEdit).toBe(false);

  const detail = await agent.get(`/api/mobile/appointments/${s.id}`);
  expect(detail.body.appointment).toMatchObject({ canEdit: true, canMove: true });
});

test('a new address is saved in place, mirrored to Outlook, and the day’s drives are re-priced', async () => {
  const app = buildApp();
  const { agent, user } = await agentFor(app);
  const { s, n } = await seedDay(user.id);

  const res = await agent.patch(`/api/mobile/appointments/${s.id}/details`).send({
    ...expected, address: { address: '40 Leach Highway, Wilson WA 6107', lat: -32.02, lng: 115.91 } });
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ ok: true, mode: 'address', id: s.id, sync: { outlook: 'saved' }, travel: { repriced: true } });
  expect(res.body.appointment.location).toBe('40 Leach Highway, Wilson WA 6107');

  const r = await row(s.id);
  expect(r.manual_location).toMatchObject({ address: '40 Leach Highway, Wilson WA 6107', lat: -32.02, lng: 115.91 });
  expect(r.is_manual_location_override).toBe(true);
  expect(r.last_modified_by).toBe('app');
  expect(outlookApi.updateOutlookEvent).toHaveBeenCalledWith('tok', 'OL-SESSION', { location: '40 Leach Highway, Wilson WA 6107' });

  // The drive from the new place to the next session was priced and stored.
  expect(route).toHaveBeenCalledWith('40 Leach Highway, Wilson WA 6107', '9 Canning Highway, Applecross WA 6153');
  const legs = await db.pool.query(`SELECT origin, destination, minutes, owner_event_id FROM calendar_travel_legs WHERE user_id = $1`, [user.id]);
  expect(legs.rows).toEqual([expect.objectContaining({ origin: '40 Leach Highway, Wilson WA 6107',
    destination: '9 Canning Highway, Applecross WA 6153', minutes: 17, owner_event_id: n.id })]);

  // Nothing was rebooked and Splose was not asked for anything.
  expect((await db.pool.query(`SELECT 1 FROM splose_sync_queue`)).rows).toHaveLength(0);
  const audit = await db.pool.query(`SELECT target_id FROM audit_logs WHERE action = 'mobile_event_address_changed'`);
  expect(audit.rows.map((x) => x.target_id)).toEqual([s.id]);
});

test('a type change rebooks the slot: new booking, old one gone with a Splose cancel, travel carried over', async () => {
  const app = buildApp();
  const { agent, user } = await agentFor(app);
  const { s, t } = await seedDay(user.id);

  const res = await agent.patch(`/api/mobile/appointments/${s.id}/details`).send({ ...expected, kind: 'case-noting' });
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ ok: true, mode: 'rebook', replacedId: s.id, oldRemoved: true });
  const newId = res.body.id;
  expect(newId).not.toBe(s.id);

  const fresh = await row(newId);
  expect(fresh.title).toBe('Case Noting — Client One');
  expect(new Date(fresh.start_time).toISOString()).toBe(S_START);
  expect(new Date(fresh.end_time).toISOString()).toBe(S_END);
  expect(fresh.location).toBe('12 Smith Street, Willetton WA 6155');
  expect(fresh.custom_metadata.booking).toMatchObject({ kind: 'case-noting', group: 'nf2f' });
  expect(fresh.custom_metadata.travel).toEqual({ afterOffsetMin: 5 });

  expect((await row(s.id)).is_deleted).toBe(true);
  expect((await row(t.id)).is_deleted).toBeFalsy();
  expect((await row(t.id)).related_event_id).toBe(newId);
  expect(outlookApi.deleteOutlookEvent).toHaveBeenCalledWith('tok', 'OL-SESSION');

  const q = await db.pool.query(`SELECT event_id, action FROM splose_sync_queue ORDER BY created_at`);
  expect(q.rows).toEqual([{ event_id: s.id, action: 'cancel' }]); // non-face-to-face is not a Splose appointment
});

test('a client change books the new client’s Splose session, at their address when asked', async () => {
  const app = buildApp();
  const { agent, user } = await agentFor(app);
  const { s } = await seedDay(user.id);

  const res = await agent.patch(`/api/mobile/appointments/${s.id}/details`).send({ ...expected, clientId: '777002', useClientAddress: true });
  expect(res.status).toBe(200);
  const fresh = await row(res.body.id);
  expect(fresh.title).toBe('Client Appointment — Client Two');
  expect(fresh.client_id).toBe('777002');
  expect(fresh.manual_location).toMatchObject({ address: '5 High Road, Riverton WA 6148' });
  const q = await db.pool.query(`SELECT event_id, action, payload FROM splose_sync_queue ORDER BY created_at`);
  const create = q.rows.find((x) => x.action === 'create');
  expect(create).toMatchObject({ event_id: res.body.id });
  expect(create.payload).toMatchObject({ patientId: '777002', serviceId: 125320, sessionType: 'therapy' });
  expect(q.rows.find((x) => x.action === 'cancel')).toMatchObject({ event_id: s.id });
  expect(res.body.travel.repriced).toBe(true);
});

test('refusals write nothing', async () => {
  const app = buildApp();
  const { agent, user } = await agentFor(app);
  const { s } = await seedDay(user.id);
  const count = async () => (await db.pool.query(`SELECT COUNT(*)::int AS n FROM events WHERE is_deleted IS NOT TRUE`)).rows[0].n;
  const before = await count();

  const stranger = await agent.patch(`/api/mobile/appointments/${s.id}/details`).send({ ...expected, clientId: '999999' });
  expect(stranger.status).toBe(404);
  expect(stranger.body.code).toBe('client_not_found');

  const stale = await agent.patch(`/api/mobile/appointments/${s.id}/details`).send({
    expectedStart: `${DAY}T08:00:00+08:00`, expectedEnd: `${DAY}T09:00:00+08:00`, kind: 'lunch' });
  expect(stale.status).toBe(409);
  expect(stale.body.code).toBe('changed');

  const noClient = await agent.patch(`/api/mobile/appointments/${s.id}/details`).send({ ...expected, kind: 'fca', clientId: null });
  expect(noClient.status).toBe(400);
  expect(noClient.body.code).toBe('client_required');

  const badKind = await agent.patch(`/api/mobile/appointments/${s.id}/details`).send({ ...expected, kind: 'flight' });
  expect(badKind.status).toBe(400);

  expect(await count()).toBe(before);
  expect((await row(s.id)).is_deleted).toBeFalsy();
  expect((await db.pool.query(`SELECT 1 FROM splose_sync_queue`)).rows).toHaveLength(0);
  expect(outlookApi.updateOutlookEvent).not.toHaveBeenCalled();
});

test('someone else’s appointment is a 404; read_only cannot edit', async () => {
  const app = buildApp();
  const { agent } = await agentFor(app);
  const other = await seedUser({ role: 'therapist' });
  const { s } = await seedDay(other.id);
  const res = await agent.patch(`/api/mobile/appointments/${s.id}/details`).send({ ...expected, kind: 'lunch' });
  expect(res.status).toBe(404);
  expect((await row(s.id)).is_deleted).toBeFalsy();

  const ro = await agentFor(buildApp(), { role: 'read_only' });
  const mine = await seedDay(ro.user.id);
  const denied = await ro.agent.patch(`/api/mobile/appointments/${mine.s.id}/details`).send({ ...expected, kind: 'lunch' });
  expect(denied.status).toBe(403);
});
