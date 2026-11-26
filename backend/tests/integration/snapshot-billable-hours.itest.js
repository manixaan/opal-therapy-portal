'use strict';

/**
 * Snapshot billable hours (25 Nov 2026) — GET /api/snapshot/billable-hours.
 * The snapshot counts what invoicing counts: billable work (sessions +
 * timed non-face-to-face shares), client travel (the rule book over the
 * calendar's recorded minutes) and cancellations, the caller's own diary only.
 * Real SQL against the isolated *_test database; nothing here writes.
 */

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { db, truncateAll, seedUser, seedOrganisation, closePool } = require('./helpers');
const { canonAddr } = require('../../billing/route-facts');

const PASSWORD = 'SnapHours1';
const DAY = '2026-11-16';                       // a past Monday (Perth)
// events.start_time is a UTC timestamp without zone: Perth hour h is UTC h − 8.
const T = (h, m = 0) => `${DAY}T${String(h - 8).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`;
const A = '12 Example St, Bertram WA 6167';
const B = '5 Sample Rd, Como WA 6152';

function buildApp() {
  const app = express();
  app.use(bodyParser.json());
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../snapshot-routes'));
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

async function ev(userId, { title, start, end, type = 'therapy', clientId = null, location = null, status = 'confirmed', meta = {} }) {
  const { rows } = await db.pool.query(
    `INSERT INTO events (user_id, title, start_time, end_time, event_type, client_id, client_name, location, status, custom_metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [userId, title, start, end, type, clientId, clientId ? 'Client ' + clientId : null, location, status, JSON.stringify(meta)]);
  return rows[0];
}

beforeEach(async () => { await truncateAll(); require('../../auth')._resetLoginRateLimit(); });
afterAll(closePool);

test('work, client travel and cancellations follow the invoicing rules', async () => {
  const app = buildApp();
  const org = await seedOrganisation();
  const { agent, user } = await agentFor(app, { organisation_id: org.id });

  // Billable sessions: 60 + 90 min, two clients, in person.
  const s1 = await ev(user.id, { title: 'Therapy — C1', start: T(9), end: T(10), clientId: 'c1', location: A });
  const s2 = await ev(user.id, { title: 'Therapy — C2', start: T(11), end: T(12, 30), clientId: 'c2', location: B });
  // Cancelled (status) 60 min + did not attend (attendance) 45 min → cancellations, not work.
  await ev(user.id, { title: 'Therapy — C3', start: T(13), end: T(14), clientId: 'c3', location: A, status: 'cancelled' });
  const dna = await ev(user.id, { title: 'Therapy — C4', start: T(14, 30), end: T(15, 15), clientId: 'c4', location: B });
  await db.pool.query(`INSERT INTO calendar_event_billing (event_id, organisation_id, attendance) VALUES ($1,$2,'DID_NOT_ATTEND')`, [dna.id, org.id]);
  // Not invoiced: admin, and a non-face-to-face block with no client.
  await ev(user.id, { title: 'Admin', start: T(16), end: T(17), type: 'admin' });
  await ev(user.id, { title: 'Emails', start: T(17), end: T(18), type: 'admin', meta: { booking: { kind: 'emails', group: 'nf2f' } } });
  // Non-face-to-face with a client, 60-min block, 30 min timed → 30 min.
  const nf = await ev(user.id, { title: 'Case Noting — C1', start: T(18), end: T(19), type: 'admin',
    meta: { booking: { kind: 'case-noting', group: 'nf2f', clients: [{ clientId: 'c1', clientName: 'Client c1' }] } } });
  await db.pool.query(
    `INSERT INTO event_billing_timers (event_id, organisation_id, user_id, status, accumulated_seconds, limit_seconds)
     VALUES ($1,$2,$3,'STOPPED',1800,3600)`, [nf.id, org.id, user.id]);
  // The calendar recorded a 20-min drive A → B (no base set: no start / home legs).
  await db.pool.query(
    `INSERT INTO calendar_travel_legs (user_id, local_date, origin_canon, destination_canon, origin, destination, minutes, owner_event_id, side)
     VALUES ($1,$2,$3,$4,$5,$6,20,$7,'after')`, [user.id, DAY, canonAddr(A), canonAddr(B), A, B, s1.id]);
  // Someone else's session on the same day never shows.
  const other = await seedUser({ organisation_id: org.id });
  await ev(other.id, { title: 'Therapy — X', start: T(9), end: T(12), clientId: 'x', location: A });

  const res = await agent.get(`/api/snapshot/billable-hours?from=${DAY}&to=${DAY}`);
  expect(res.status).toBe(200);
  const d = res.body.days[DAY];
  expect(d.workMin).toBe(60 + 90 + 30);
  expect(d.travelMin).toBe(20);              // rule 6: 20 ≤ 2 × 30, all of it billed
  expect(d.cancelledMin).toBe(60 + 45);
  expect(d.cancelledCount).toBe(2);
  expect(d.dnaCount).toBe(1);
  expect(d.unpricedLegs).toBe(0);
  expect(s2.id).toBeTruthy();

  // Read-only: no stub profiles, no settings row, nothing written.
  const { rows: [{ n }] } = await db.pool.query('SELECT COUNT(*)::int AS n FROM billing_settings');
  expect(n).toBe(0);
});

test('a session held for review is not billable; a booked future session is', async () => {
  const app = buildApp();
  const org = await seedOrganisation();
  const { agent, user } = await agentFor(app, { organisation_id: org.id });
  const held = await ev(user.id, { title: 'Guessed', start: T(9), end: T(10), clientId: 'c1', location: A });
  await db.pool.query(`INSERT INTO event_block_reviews (event_id, user_id, status) VALUES ($1,$2,'guessed')`, [held.id, user.id])
    .catch(async () => db.pool.query(`INSERT INTO event_block_reviews (event_id, status) VALUES ($1,'guessed')`, [held.id]));
  const future = '2099-01-05';
  await ev(user.id, { title: 'Booked', start: `${future}T01:00:00Z`, end: `${future}T02:00:00Z`, clientId: 'c2', location: B });

  const past = await agent.get(`/api/snapshot/billable-hours?from=${DAY}&to=${DAY}`);
  expect(past.body.days[DAY].workMin).toBe(0);
  const ahead = await agent.get(`/api/snapshot/billable-hours?from=${future}&to=${future}`);
  expect(ahead.body.days[future].workMin).toBe(60);
});

test('guards: sign-in required, a bad or over-long range is refused', async () => {
  const app = buildApp();
  expect((await request(app).get(`/api/snapshot/billable-hours?from=${DAY}&to=${DAY}`)).status).toBe(401);
  const org = await seedOrganisation();
  const { agent } = await agentFor(app, { organisation_id: org.id });
  expect((await agent.get('/api/snapshot/billable-hours?from=2026-11-20&to=2026-11-16')).status).toBe(400);
  expect((await agent.get('/api/snapshot/billable-hours?from=2026-01-01&to=2026-03-01')).status).toBe(400);
  expect((await agent.get('/api/snapshot/billable-hours?from=nope&to=2026-11-16')).status).toBe(400);
});
