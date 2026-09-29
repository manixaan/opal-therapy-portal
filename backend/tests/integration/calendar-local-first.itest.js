'use strict';

/**
 * The calendar works without Outlook (29 Sep 2026).
 *
 * POST /api/outlook/events saves the event to the portal FIRST and only then
 * mirrors it to the calendar owner's own Outlook when connected. With no
 * Outlook account at all the booking is still saved (it used to be lost:
 * the browser drew a tile that vanished on the next refresh). Edits to a
 * portal-only event are saved too. Guards: read-only accounts cannot book,
 * a manager cannot book onto another organisation's calendar, and an existing
 * row can only be mirrored onto its own calendar.
 */

jest.mock('../../splose-api', () => ({ getPatients: jest.fn(async () => []), fetchAllCases: jest.fn(async () => []) }));
jest.mock('../../outlook-oauth', () => ({ MICROSOFT_OAUTH_CONFIG: { scopes: [] }, getAuthorizationUrl: jest.fn(), getAccessToken: jest.fn(), getMicrosoftUser: jest.fn(), refreshAccessToken: jest.fn() }));

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { db, truncateAll, seedUser, seedOrganisation, closePool } = require('./helpers');

const PASSWORD = 'LocalFirstPass1';
beforeEach(async () => { await truncateAll(); require('../../auth')._resetLoginRateLimit(); });
afterAll(async () => { require('../../auth')._resetLoginRateLimit(); await closePool(); });

function buildApp() {
  const app = express();
  app.use(bodyParser.json());
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../routes'));
  return app;
}
async function agentFor(app, role, orgId) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser({ password_hash: hash, role, organisation_id: orgId || null });
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user };
}
const booking = { title: 'Client Appointment — Casey L', startTime: '2026-10-05T01:00:00.000Z', endTime: '2026-10-05T02:00:00.000Z', location: '10 Sample St, Willetton WA', categories: ['Client Appointment'] };

describe('POST /api/outlook/events — local-first', () => {
  test('with no Outlook connected the event is saved to the portal and survives a reload', async () => {
    const app = buildApp();
    const org = await seedOrganisation();
    const { agent, user } = await agentFor(app, 'therapist', org.id);
    const tp = await db.pool.query(`INSERT INTO therapist_profiles (organisation_id, user_id, display_name) VALUES ($1,$2,'T') RETURNING id`, [org.id, user.id]);

    const res = await agent.post('/api/outlook/events').send(booking);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ok: true, savedToOutlook: false, outlookStatus: 'not_connected', outlookId: null });
    expect(res.body.dbId).toBeTruthy();

    const { rows: [row] } = await db.pool.query(`SELECT * FROM events WHERE id = $1`, [res.body.dbId]);
    expect(row).toMatchObject({ user_id: user.id, title: booking.title, event_type: 'therapy', source: 'app',
      is_deleted: false, outlook_id: null, therapist_profile_id: tp.rows[0].id, organisation_id: org.id });

    // It is part of the calendar the browser reloads.
    const list = await agent.get('/api/events');
    expect(list.status).toBe(200);
    const events = list.body.events || list.body;
    expect(JSON.stringify(events)).toContain(res.body.dbId);
  });

  test('a portal-only event can be moved without Outlook', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app, 'therapist');
    const created = await agent.post('/api/outlook/events').send(booking);
    const moved = await agent.patch(`/api/outlook/events/${created.body.dbId}`).send({ startTime: '2026-10-05T03:00:00.000Z', endTime: '2026-10-05T04:00:00.000Z' });
    expect(moved.status).toBe(200);
    expect(moved.body).toMatchObject({ ok: true, savedToDb: true, savedToOutlook: false, outlookStatus: 'not_linked' });
    const { rows: [row] } = await db.pool.query(`SELECT start_time FROM events WHERE id = $1`, [created.body.dbId]);
    expect(new Date(row.start_time).toISOString()).toBe('2026-10-05T03:00:00.000Z');
  });

  test('missing fields are refused before anything is written', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app, 'therapist');
    const res = await agent.post('/api/outlook/events').send({ title: 'x' });
    expect(res.status).toBe(400);
    const { rows: [{ n }] } = await db.pool.query(`SELECT COUNT(*)::int AS n FROM events`);
    expect(n).toBe(0);
  });

  test('guards: read-only cannot book; no booking onto another organisation; no mirroring someone else\'s row', async () => {
    const app = buildApp();
    const orgA = await seedOrganisation('A'), orgB = await seedOrganisation('B');
    const ro = await agentFor(app, 'read_only', orgA.id);
    expect((await ro.agent.post('/api/outlook/events').send(booking)).status).toBe(403);

    const owner = await agentFor(app, 'owner', orgA.id);
    const outsider = await seedUser({ role: 'therapist', organisation_id: orgB.id });
    const cross = await owner.agent.post('/api/outlook/events').send({ ...booking, targetTherapistUserId: outsider.id });
    expect(cross.status).toBe(404);

    const other = await db.createEvent(outsider.id, { title: 'Theirs', startTime: booking.startTime, endTime: booking.endTime, eventType: 'therapy' });
    const hijack = await owner.agent.post('/api/outlook/events').send({ ...booking, dbEventId: other.id });
    expect(hijack.status).toBe(404);
    const { rows: [{ n }] } = await db.pool.query(`SELECT COUNT(*)::int AS n FROM events`);
    expect(n).toBe(1);
  });

  test('an owner booking for a clinician in the same practice lands on the clinician\'s calendar', async () => {
    const app = buildApp();
    const org = await seedOrganisation();
    const owner = await agentFor(app, 'owner', org.id);
    const clinician = await seedUser({ role: 'therapist', organisation_id: org.id });
    const res = await owner.agent.post('/api/outlook/events').send({ ...booking, targetTherapistUserId: clinician.id });
    expect(res.status).toBe(201);
    const { rows: [row] } = await db.pool.query(`SELECT user_id FROM events WHERE id = $1`, [res.body.dbId]);
    expect(row.user_id).toBe(clinician.id);
  });
});
