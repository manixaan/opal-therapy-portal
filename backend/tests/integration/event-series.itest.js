'use strict';

/**
 * Recurring appointments (migration 075, series-routes.js, 11 Oct 2026).
 * The first booking goes through Create appointment; the repeats are booked
 * by the same path, linked to the series, keeping the clock time.
 */

jest.mock('../../splose-api', () => ({ getPatients: jest.fn(async () => []), fetchAllCases: jest.fn(async () => []) }));
jest.mock('../../outlook-oauth', () => ({ MICROSOFT_OAUTH_CONFIG: { scopes: [] }, getAuthorizationUrl: jest.fn(), getAccessToken: jest.fn(), getMicrosoftUser: jest.fn(), refreshAccessToken: jest.fn() }));

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { db, truncateAll, seedUser, seedOrganisation, closePool } = require('./helpers');

const PASSWORD = 'SeriesPass1';
beforeEach(async () => { await truncateAll(); require('../../auth')._resetLoginRateLimit(); });
afterAll(async () => { require('../../auth')._resetLoginRateLimit(); await closePool(); });

function buildApp() {
  const app = express();
  app.use(bodyParser.json());
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../routes'));
  app.use('/', require('../../series-routes'));
  return app;
}
async function agentFor(app, role, orgId) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser({ password_hash: hash, role, organisation_id: orgId || null });
  const agent = request.agent(app);
  expect((await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD })).status).toBe(200);
  return { agent, user };
}
// Mon 12 Oct 2026, 9:30–10:30 Perth.
const booking = {
  title: 'Client Appointment — Casey L', startTime: '2026-10-12T01:30:00.000Z', endTime: '2026-10-12T02:30:00.000Z',
  location: '13 Lecania St, Seville Grove WA 6112', categories: ['Client Appointments'],
  booking: { kind: 'therapy', clientId: '90001', clientName: 'Casey L' }, mmmZone: 2,
  splose: { patientId: 90001, patientName: 'Casey L' },
};
const weekly4 = { freq: 'week', interval: 1, days: ['mon'], end: { type: 'count', count: 4 } };

describe('recurring appointments', () => {
  test('weekly ×4: three repeats booked like the first, same clock time, linked to one series', async () => {
    const app = buildApp();
    const org = await seedOrganisation();
    const { agent, user } = await agentFor(app, 'therapist', org.id);
    const first = await agent.post('/api/outlook/events').send(booking);
    expect(first.status).toBe(201);

    const r = await agent.post(`/api/events/${first.body.dbId}/series`).send({ rule: weekly4 });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ ok: true, count: 4, failed: [], summary: 'Occurs every week on Monday for 4 appointments' });
    expect(r.body.created.map(c => c.date)).toEqual(['2026-10-19', '2026-10-26', '2026-11-02']);

    const { rows } = await db.pool.query(
      `SELECT start_time, end_time, series_id, series_index, client_id, location, user_id, custom_metadata->'booking'->>'kind' AS kind
         FROM events WHERE series_id IS NOT NULL ORDER BY start_time`);
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map(x => x.series_id)).size).toBe(1);
    expect(rows.map(x => x.series_index)).toEqual([0, 1, 2, 3]);
    expect(rows.map(x => new Date(x.start_time).toISOString())).toEqual([
      '2026-10-12T01:30:00.000Z', '2026-10-19T01:30:00.000Z', '2026-10-26T01:30:00.000Z', '2026-11-02T01:30:00.000Z']);
    rows.forEach(x => {
      expect(new Date(x.end_time) - new Date(x.start_time)).toBe(3600000);
      expect(x).toMatchObject({ client_id: '90001', location: booking.location, user_id: user.id, kind: 'therapy' });
    });
    // The zone picked at booking (MM2 where the address says MM1) carries to every repeat.
    const { rows: zones } = await db.pool.query(`SELECT mmm_zone FROM calendar_event_mmm`);
    expect(zones.map(z => z.mmm_zone)).toEqual([2, 2, 2, 2]);

    const g = await agent.get(`/api/events/${r.body.created[1].dbId}/series`);
    expect(g.status).toBe(200);
    expect(g.body.series.summary).toBe('Occurs every week on Monday for 4 appointments');
    expect(g.body.events.map(e => e.index)).toEqual([0, 1, 2, 3]);
    expect(g.body.events.find(e => e.isThis).index).toBe(2);

    // An appointment already in a series cannot start another.
    expect((await agent.post(`/api/events/${first.body.dbId}/series`).send({ rule: weekly4 })).status).toBe(409);
  });

  test('guards: a bad rule writes nothing; someone else\'s event is not found; read-only cannot book', async () => {
    const app = buildApp();
    const org = await seedOrganisation();
    const { agent } = await agentFor(app, 'therapist', org.id);
    const first = await agent.post('/api/outlook/events').send(booking);
    const bad = await agent.post(`/api/events/${first.body.dbId}/series`).send({ rule: { freq: 'week', end: { type: 'count', count: 1 } } });
    expect(bad.status).toBe(400);
    expect((await db.pool.query(`SELECT COUNT(*)::int AS n FROM events`)).rows[0].n).toBe(1);

    const other = await agentFor(app, 'therapist', org.id);
    expect((await other.agent.post(`/api/events/${first.body.dbId}/series`).send({ rule: weekly4 })).status).toBe(404);
    expect((await other.agent.get(`/api/events/${first.body.dbId}/series`)).status).toBe(404);
    const ro = await agentFor(app, 'read_only', org.id);
    expect((await ro.agent.post(`/api/events/${first.body.dbId}/series`).send({ rule: weekly4 })).status).toBe(403);
    expect((await request(app).post('/api/recurrence/preview').send({ rule: weekly4, start: '2026-10-12' })).status).toBe(401);
  });

  test('an owner can make a clinician\'s appointment repeat; the repeats stay on the clinician\'s calendar', async () => {
    const app = buildApp();
    const org = await seedOrganisation();
    const { agent: clin, user: clinician } = await agentFor(app, 'therapist', org.id);
    const first = await clin.post('/api/outlook/events').send(booking);
    const { agent: owner } = await agentFor(app, 'owner', org.id);
    const r = await owner.post(`/api/events/${first.body.dbId}/series`).send({ rule: { freq: 'week', interval: 2, end: { type: 'count', count: 2 } } });
    expect(r.status).toBe(201);
    const { rows } = await db.pool.query(`SELECT user_id FROM events WHERE id = $1`, [r.body.created[0].dbId]);
    expect(rows[0].user_id).toBe(clinician.id);
  });

  test('preview says what Outlook would: the dates, the sentence and the cap', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app, 'therapist', (await seedOrganisation()).id);
    const p = await agent.post('/api/recurrence/preview').send({ rule: { freq: 'week', days: ['mon'], end: { type: 'date', until: '2026-12-11' } }, start: '2026-10-12' });
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ count: 9, capped: false, last: '7 Dec 2026', summary: 'Occurs every week on Monday until 11 Dec 2026' });
    const capped = await agent.post('/api/recurrence/preview').send({ rule: { freq: 'day', end: { type: 'date', until: '2027-12-01' } }, start: '2026-10-12' });
    expect(capped.body).toMatchObject({ count: 52, capped: true });
  });
});
