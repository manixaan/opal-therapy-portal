'use strict';

/**
 * BLOCK REVIEW (migration 086) — blocks booked outside the portal, over real
 * Postgres. Splose is mocked and the caseload is stubbed: no network.
 *
 * Proves: an Outlook block is classified and its confident guess applied but
 * held out of invoicing; a block with gaps is left untouched until a person
 * fills them (and is held from invoicing too); confirm releases the hold; a
 * block at a real place needs where the clinician was before and after, stored
 * as Smart Booking's travel answers; even a Splose appointment Splose fully
 * describes waits for a person; dismiss puts a guess back exactly as it came in; a client off the caller's caseload cannot be attached; nobody
 * else's blocks are visible; read-only accounts are refused.
 */

jest.mock('../../splose-api', () => ({
  isConfigured: () => true,
  getPatients: jest.fn(), getContacts: jest.fn(), getPractitioners: jest.fn(),
  getServices: jest.fn(async () => [{ id: 131003, title: 'Assessment Session (Occupational Therapy)' }]),
  getAppointment: jest.fn(async (id) => ({ id, serviceId: 131003 })),
}));

const request = require('supertest');
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const { db, truncateAll, seedUser, seedOrganisation, closePool } = require('./helpers');
const caseload = require('../../splose-caseload');
const routes = require('../../block-review-routes');
const { loadCandidateEvents } = require('../../billing/invoice-generation');

const CLIENTS = [
  { id: '9001', fullName: 'Harper Testwell', suburb: 'Applecross', formattedAddress: '12 Example Street, Applecross WA 6153' },
  { id: '9002', fullName: 'Jordan Sampleton', suburb: 'Como', formattedAddress: '4 Sample Road, Como WA 6152' },
];

function buildApp() {
  const app = express();
  app.use(bodyParser.json());
  app.use(session({ secret: 'test', resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use((req, res, next) => { if (req.headers['x-test-user']) req.session.userId = req.headers['x-test-user']; next(); });
  app.use('/', routes);
  return app;
}

async function outlookBlock(userId, { title, location = '', start = '2026-10-20T01:00:00Z', end = '2026-10-20T02:00:00Z', eventType = 'outlook' }) {
  const { rows } = await db.pool.query(
    `INSERT INTO events (user_id, title, start_time, end_time, location, event_type, outlook_id, source, created_by_source, sync_status, last_modified_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'outlook', 'outlook', 'synced', 'outlook') RETURNING *`,
    [userId, title, start, end, location, eventType, 'ol-' + Math.random().toString(36).slice(2)]);
  return rows[0];
}
const eventRow = async (id) => (await db.pool.query('SELECT * FROM events WHERE id = $1', [id])).rows[0];
const reviewRow = async (id) => (await db.pool.query('SELECT * FROM event_block_reviews WHERE event_id = $1', [id])).rows[0];

let org, me, app;

beforeEach(async () => {
  await truncateAll();
  routes._resetForTests();
  org = await seedOrganisation();
  me = await seedUser({ role: 'therapist', organisation_id: org.id });
  app = buildApp();
  jest.spyOn(caseload, 'listOwnClients').mockResolvedValue({ clients: CLIENTS, scope: 'caseload' });
  jest.spyOn(caseload, 'loadOwnClient').mockImplementation(async (req, id) => CLIENTS.find(c => c.id === String(id)) || null);
});
afterEach(() => jest.restoreAllMocks());
afterAll(async () => { await closePool(); });

const get = (user, since = '2026-10-01') => request(app).get(`/api/block-review?since=${since}`).set('x-test-user', user.id);
const post = (user, path, body = {}) => request(app).post(path).set('x-test-user', user.id).send(body);
const candidates = (ids) => loadCandidateEvents(db.pool, org.id, { from: '2026-10-01', to: '2026-10-31', eventIds: ids, tz: 'Australia/Perth' });

test('migration 086 created event_block_reviews with its status check', async () => {
  const c = await db.pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'event_block_reviews'`);
  expect(c.rows.map(r => r.column_name)).toEqual(expect.arrayContaining(['event_id', 'user_id', 'status', 'guess', 'before', 'fingerprint']));
  const ev = await outlookBlock(me.id, { title: 'x' });
  await expect(db.pool.query(`INSERT INTO event_block_reviews (event_id, user_id, status) VALUES ($1, $2, 'bogus')`, [ev.id, me.id]))
    .rejects.toThrow(/check/i);
});

test('a confident Outlook guess is applied, flagged, and held out of invoicing until confirmed', async () => {
  const ev = await outlookBlock(me.id, { title: 'Assessment – Harper Testwell' });
  const res = await get(me);
  expect(res.status).toBe(200);
  expect(res.body.counts).toEqual({ guessed: 1, needsInput: 0 });
  const b = res.body.blocks[0];
  expect(b.guess).toMatchObject({ kind: 'assessment', clientId: '9001', location: '12 Example Street, Applecross WA 6153' });

  const after = await eventRow(ev.id);
  expect(after.event_type).toBe('therapy');
  expect(after.client_id).toBe('9001');
  expect(after.custom_metadata.booking).toMatchObject({ kind: 'assessment', group: 'direct', clientId: '9001' });
  expect(after.is_manual_location_override).toBe(true);

  // Held: a guess is never invoiced.
  expect(await candidates([ev.id])).toHaveLength(0);

  expect(res.body.blocks[0].guess.needsTravel).toBe(true);
  // At a real place: before/after are required.
  const noTravel = await post(me, `/api/block-review/${ev.id}/confirm`, { kind: 'assessment', clientId: '9001', location: '12 Example Street, Applecross WA 6153' });
  expect(noTravel.status).toBe(400);
  expect(noTravel.body.code).toBe('travel_required');
  const badSide = await post(me, `/api/block-review/${ev.id}/confirm`, { kind: 'assessment', clientId: '9001', location: '12 Example Street, Applecross WA 6153',
    travel: { before: { mode: 'home' }, after: { mode: 'address', address: '' } } });
  expect(badSide.status).toBe(400);
  expect(badSide.body).toMatchObject({ code: 'travel_invalid', side: 'after' });
  expect((await reviewRow(ev.id)).status).toBe('guessed');

  const ok = await post(me, `/api/block-review/${ev.id}/confirm`, { kind: 'assessment', clientId: '9001', location: '12 Example Street, Applecross WA 6153',
    travel: { before: { mode: 'home' }, after: { mode: 'address', address: '1 Bespoke Lane, Perth WA 6000', placeId: 'pl-1', lat: -31.95, lng: 115.86 } } });
  expect(ok.status).toBe(200);
  const travelled = await eventRow(ev.id);
  expect(travelled.custom_metadata.travel).toEqual({
    before: { kind: 'address', address: '', label: 'Home', purpose: 'home', source: 'block_review' },
    after: { kind: 'address', address: '1 Bespoke Lane, Perth WA 6000', label: '1 Bespoke Lane', purpose: 'elsewhere', source: 'block_review', placeId: 'pl-1', lat: -31.95, lng: 115.86 },
  });
  const audit = await db.pool.query(`SELECT metadata FROM audit_logs WHERE action = 'block_review.confirm' AND target_id = $1`, [ev.id]);
  expect(audit.rows[0].metadata.travel).toEqual({ before: 'home', after: 'elsewhere' });
  expect(JSON.stringify(audit.rows)).not.toMatch(/Bespoke|Example Street|Harper/);
  expect((await reviewRow(ev.id)).status).toBe('confirmed');
  expect(await candidates([ev.id])).toHaveLength(1);

  // Settled blocks are not offered again.
  const again = await get(me);
  expect(again.body.blocks).toHaveLength(0);
});

test('a block with gaps is left untouched until a person fills them', async () => {
  const ev = await outlookBlock(me.id, { title: 'Session' });
  const res = await get(me);
  expect(res.body.counts).toEqual({ guessed: 0, needsInput: 1 });
  expect(res.body.blocks[0].guess.missing).toContain('client');
  const after = await eventRow(ev.id);
  expect(after.event_type).toBe('outlook');
  expect(after.client_id).toBeNull();
  expect(after.custom_metadata && after.custom_metadata.booking).toBeFalsy();
  // Needs info is held from invoicing too.
  expect(await candidates([ev.id])).toHaveLength(0);

  const done = await post(me, `/api/block-review/${ev.id}/confirm`, { kind: 'therapy', clientId: '9002', location: '4 Sample Road, Como WA 6152',
    travel: { before: { mode: 'address', address: '9 Earlier Client St, Como WA' }, after: { mode: 'home' } } });
  expect(done.status).toBe(200);
  const fin = await eventRow(ev.id);
  expect(fin).toMatchObject({ event_type: 'therapy', client_id: '9002', location: '4 Sample Road, Como WA 6152' });
});

test('a desk block with an Outlook address: clearing the place needs no travel; an online kind never does', async () => {
  const ev = await outlookBlock(me.id, { title: 'Emails', location: '4 Sample Road, Como WA 6152' });
  await get(me);
  // Kept place → it is a stop on the route → before/after required.
  expect((await post(me, `/api/block-review/${ev.id}/confirm`, { kind: 'emails' })).body.code).toBe('travel_required');
  // Cleared ('') → at the desk: no travel, and the block's place is cleared.
  await post(me, `/api/block-review/${ev.id}/confirm`, { kind: 'emails', location: '' }).expect(200);
  const fin = await eventRow(ev.id);
  expect(fin.location).toBe('');
  expect(fin.custom_metadata.travel).toBeUndefined();

  const mdt = await outlookBlock(me.id, { title: 'MDT – Harper Testwell', location: '12 Example Street, Applecross WA 6153', start: '2026-10-22T01:00:00Z', end: '2026-10-22T02:00:00Z' });
  await get(me);
  await post(me, `/api/block-review/${mdt.id}/confirm`, { kind: 'mdt', clientId: '9001' }).expect(200);
});

test('a report client lives in booking, not client_id (the Splose reconciler must not offer it)', async () => {
  const ev = await outlookBlock(me.id, { title: 'Writing' });
  await get(me);
  await post(me, `/api/block-review/${ev.id}/confirm`, { kind: 'fca', clientId: '9001' }).expect(200);
  const fin = await eventRow(ev.id);
  expect(fin.client_id).toBeNull();
  expect(fin.event_type).toBe('report');
  expect(fin.custom_metadata.booking).toMatchObject({ kind: 'fca', group: 'report', clientId: '9001' });
});

test('dismissing a guess puts the block back exactly as it came in', async () => {
  const ev = await outlookBlock(me.id, { title: 'Assessment – Harper Testwell', location: '' });
  await get(me);
  expect((await eventRow(ev.id)).client_id).toBe('9001');
  await post(me, `/api/block-review/${ev.id}/dismiss`).expect(200);
  const fin = await eventRow(ev.id);
  expect(fin).toMatchObject({ event_type: 'outlook', client_id: null, location: '', is_manual_location_override: false });
  expect(fin.custom_metadata.booking).toBeUndefined();
  expect((await reviewRow(ev.id)).status).toBe('dismissed');
  await post(me, `/api/block-review/${ev.id}/dismiss`).expect(409);
});

test('a Splose appointment Splose fully describes still waits for a person (before/after)', async () => {
  const { rows: [ev] } = await db.pool.query(
    `INSERT INTO events (user_id, title, start_time, end_time, location, event_type, splose_id, client_id, source, created_by_source, sync_status, last_modified_by)
     VALUES ($1, 'Client Appointment (booked in Splose)', '2026-10-21T01:00:00Z', '2026-10-21T02:00:00Z', '4 Sample Road, Como WA 6152', 'therapy', '5551', '9002', 'splose', 'splose', 'synced', 'splose') RETURNING *`,
    [me.id]);
  const res = await get(me);
  expect(res.body.blocks).toHaveLength(1);
  expect(res.body.blocks[0]).toMatchObject({ status: 'guessed', origin: 'splose', guess: { kind: 'assessment', clientId: '9002', needsTravel: true } });
  const fin = await eventRow(ev.id);
  expect(fin.custom_metadata).toMatchObject({ splose_service_id: '131003', booking: { kind: 'assessment' } });
  expect(await candidates([ev.id])).toHaveLength(0);
  await post(me, `/api/block-review/${ev.id}/confirm`, { kind: 'assessment', clientId: '9002',
    travel: { before: { mode: 'home' }, after: { mode: 'home' } } }).expect(200);
  expect(await candidates([ev.id])).toHaveLength(1);
});

test('confirm-guessed accepts applied guesses only, never one at a place (it needs before/after)', async () => {
  const a = await outlookBlock(me.id, { title: 'Lunch' });
  const b = await outlookBlock(me.id, { title: 'Session' });
  const c = await outlookBlock(me.id, { title: 'Assessment – Harper Testwell' });
  await get(me);
  expect((await reviewRow(c.id)).status).toBe('guessed');
  const r = await post(me, '/api/block-review/confirm-guessed', { eventIds: [a.id, b.id, c.id] });
  expect(r.body).toEqual({ confirmed: 1, needTravel: 1 });
  expect((await reviewRow(a.id)).status).toBe('confirmed');
  expect((await reviewRow(b.id)).status).toBe('needs_input');
  expect((await reviewRow(c.id)).status).toBe('guessed');
});

test('a client off the caller’s caseload cannot be attached', async () => {
  const ev = await outlookBlock(me.id, { title: 'Session' });
  await get(me);
  const r = await post(me, `/api/block-review/${ev.id}/confirm`, { kind: 'therapy', clientId: '7777' });
  expect(r.status).toBe(400);
  expect(r.body.code).toBe('not_on_caseload');
  expect((await eventRow(ev.id)).client_id).toBeNull();
});

test('a direct service without a client is refused', async () => {
  const ev = await outlookBlock(me.id, { title: 'Session' });
  await get(me);
  const r = await post(me, `/api/block-review/${ev.id}/confirm`, { kind: 'therapy' });
  expect(r.status).toBe(400);
  expect(r.body.code).toBe('client_required');
});

test('nobody sees or settles another person’s blocks', async () => {
  const other = await seedUser({ role: 'admin', organisation_id: org.id });
  const ev = await outlookBlock(me.id, { title: 'Session' });
  await get(me);
  const theirs = await get(other);
  expect(theirs.body.blocks).toHaveLength(0);
  await post(other, `/api/block-review/${ev.id}/confirm`, { kind: 'lunch' }).expect(404);
  await post(other, `/api/block-review/${ev.id}/dismiss`).expect(404);
  expect((await reviewRow(ev.id)).status).toBe('needs_input');
});

test('read-only and signed-out callers are refused', async () => {
  const ro = await seedUser({ role: 'read_only', organisation_id: org.id });
  expect((await get(ro)).status).toBe(403);
  expect((await request(app).get('/api/block-review')).status).toBe(401);
});

test('a needs_input block changed in Outlook is looked at again; portal bookings are never swept', async () => {
  const ev = await outlookBlock(me.id, { title: 'Session' });
  await get(me);
  await db.pool.query(`UPDATE events SET title = 'Lunch' WHERE id = $1`, [ev.id]);
  const res = await get(me);
  expect(res.body.blocks[0].status).toBe('guessed');

  const { rows: [app1] } = await db.pool.query(
    `INSERT INTO events (user_id, title, start_time, end_time, event_type, source, created_by_source)
     VALUES ($1, 'Assessment – Harper Testwell', '2026-10-22T01:00:00Z', '2026-10-22T02:00:00Z', 'therapy', 'app', 'app') RETURNING id`, [me.id]);
  await get(me);
  expect(await reviewRow(app1.id)).toBeUndefined();
});

test('the audit trail carries ids and counts, never titles or names', async () => {
  const ev = await outlookBlock(me.id, { title: 'Assessment – Harper Testwell' });
  await get(me);
  await post(me, `/api/block-review/${ev.id}/confirm`, { kind: 'assessment', clientId: '9001' }).expect(200);
  const { rows } = await db.pool.query(`SELECT action, metadata::text AS m FROM audit_logs WHERE action LIKE 'block_review.%'`);
  expect(rows.map(r => r.action).sort()).toEqual(['block_review.confirm', 'block_review.sweep']);
  for (const r of rows) expect(r.m).not.toMatch(/Harper|Testwell|Example Street/);
});
