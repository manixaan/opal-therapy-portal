
'use strict';

/**
 * PATCH /api/events/:dbId/travel — a session's own "before / after" travel
 * answers, stored in custom_metadata.travel. Portal-only state: never reaches
 * Splose or Outlook. Pins the shape validation, ownership and role guards.
 */

jest.mock('../../splose-api', () => ({ getPatients: jest.fn(async () => []), fetchAllCases: jest.fn(async () => []) }));
jest.mock('../../outlook-oauth', () => ({ MICROSOFT_OAUTH_CONFIG: { scopes: [] }, getAuthorizationUrl: jest.fn(), getAccessToken: jest.fn(), getMicrosoftUser: jest.fn(), refreshAccessToken: jest.fn() }));

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { db, truncateAll, seedUser, closePool } = require('./helpers');

const PASSWORD = 'TravelPlanPass1';
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
async function agentFor(app, role = 'therapist') {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser({ password_hash: hash, role });
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user };
}
async function seedEvent(userId) {
  return db.createEvent(userId, { title: 'Client Appointment — Casey L', startTime: '2026-09-14T01:00:00Z', endTime: '2026-09-14T02:00:00Z', eventType: 'therapy' });
}

describe('PATCH /api/events/:dbId/travel', () => {
  test('stores before/after on the event, merges with other metadata, and clears with null', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app);
    const ev = await seedEvent(user.id);
    await db.pool.query(`UPDATE events SET custom_metadata = '{"keep":"me"}'::jsonb WHERE id = $1`, [ev.id]);

    const r1 = await agent.patch(`/api/events/${ev.id}/travel`).send({ before: { kind: 'base', id: 'home-1' }, after: { kind: 'address', address: '5 Sample St, Baldivis WA', suburb: 'Baldivis', label: 'Nan\'s place', extra: 'dropped' } });
    expect(r1.status).toBe(200);
    expect(r1.body.travel).toEqual({ before: { kind: 'base', id: 'home-1' }, after: { kind: 'address', address: '5 Sample St, Baldivis WA', suburb: 'Baldivis', label: 'Nan\'s place' } });
    const row = await db.pool.query(`SELECT custom_metadata FROM events WHERE id = $1`, [ev.id]);
    expect(row.rows[0].custom_metadata.keep).toBe('me');
    expect(row.rows[0].custom_metadata.travel.before).toEqual({ kind: 'base', id: 'home-1' });

    const r2 = await agent.patch(`/api/events/${ev.id}/travel`).send({ before: null, after: null });
    expect(r2.status).toBe(200);
    expect(r2.body.travel).toEqual({});
    // The list the calendar loads carries it.
    const list = await agent.get('/api/events');
    expect(list.body.events.find(e => e.id === ev.id).custom_metadata.travel).toEqual({});
  });

  test('rejects malformed specs, another user\'s event, and read-only accounts', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app);
    const ev = await seedEvent(user.id);
    expect((await agent.patch(`/api/events/${ev.id}/travel`).send({ before: { kind: 'teleport' } })).status).toBe(400);
    expect((await agent.patch(`/api/events/${ev.id}/travel`).send({ after: { kind: 'address', address: '' } })).status).toBe(400);
    expect((await agent.patch(`/api/events/${ev.id}/travel`).send({ after: 'home' })).status).toBe(400);

    const { agent: other, user: otherUser } = await agentFor(app);
    expect((await other.patch(`/api/events/${ev.id}/travel`).send({ after: { kind: 'base', id: 'office' } })).status).toBe(404);
    const theirs = await seedEvent(otherUser.id);
    expect((await other.patch(`/api/events/${theirs.id}/travel`).send({ after: { kind: 'base', id: 'office' } })).status).toBe(200);

    const { agent: ro, user: roUser } = await agentFor(app, 'read_only');
    const roEv = await seedEvent(roUser.id);
    expect((await ro.patch(`/api/events/${roEv.id}/travel`).send({ after: { kind: 'base', id: 'office' } })).status).toBe(403);
    expect((await request(app).patch(`/api/events/${ev.id}/travel`).send({})).status).toBe(401);
  });
});
