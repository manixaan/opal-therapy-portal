
'use strict';

/**
 * PATCH /api/events/:dbId/notes — the side panel's notes (19 Nov 2026), stored
 * on the event (custom_metadata.notes) instead of the browser's localStorage,
 * so they survive a reload. Pins: stored + returned by GET /api/events,
 * cleaned of anything but the editor's formatting, other metadata kept,
 * empty clears, own events only, read-only refused, bad ids 404.
 */

jest.mock('../../splose-api', () => ({ getPatients: jest.fn(async () => []), fetchAllCases: jest.fn(async () => []) }));
jest.mock('../../outlook-oauth', () => ({ MICROSOFT_OAUTH_CONFIG: { scopes: [] }, getAuthorizationUrl: jest.fn(), getAccessToken: jest.fn(), getMicrosoftUser: jest.fn(), refreshAccessToken: jest.fn() }));

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { db, truncateAll, seedUser, closePool } = require('./helpers');

const PASSWORD = 'EventNotesPass1';
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
const seedEvent = (userId) => db.createEvent(userId, { title: 'Case Management — Casey L', startTime: '2026-09-14T01:00:00Z', endTime: '2026-09-14T02:00:00Z', eventType: 'report' });

describe('PATCH /api/events/:dbId/notes', () => {
  test('stores cleaned notes on the event, keeps other metadata, survives a reload, and clears when empty', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app);
    const ev = await seedEvent(user.id);
    await db.pool.query(`UPDATE events SET custom_metadata = '{"booking":{"kind":"case-management"}}'::jsonb WHERE id = $1`, [ev.id]);

    const r = await agent.patch(`/api/events/${ev.id}/notes`).send({ notes: '<b style="x">Call</b> mum<script>alert(1)</script><img src=x onerror=alert(1)>' });
    expect(r.status).toBe(200);
    expect(r.body.notes).toEqual({ html: '<b>Call</b> mum' });
    // What the calendar loads after a reload.
    const list = await agent.get('/api/events');
    const meta = list.body.events.find(e => e.id === ev.id).custom_metadata;
    expect(meta.notes.html).toBe('<b>Call</b> mum');
    expect(meta.booking).toEqual({ kind: 'case-management' });

    const cleared = await agent.patch(`/api/events/${ev.id}/notes`).send({ notes: '<div><br></div>' });
    expect(cleared.body.notes).toBeNull();
    const row = await db.pool.query(`SELECT custom_metadata FROM events WHERE id = $1`, [ev.id]);
    expect(row.rows[0].custom_metadata.notes).toBeUndefined();
    expect(row.rows[0].custom_metadata.booking).toEqual({ kind: 'case-management' });
  });

  test('another person\'s event 404s; read-only refused; bad ids and bad bodies rejected', async () => {
    const app = buildApp();
    const { user: owner } = await agentFor(app);
    const ev = await seedEvent(owner.id);
    const { agent: other } = await agentFor(app);
    expect((await other.patch(`/api/events/${ev.id}/notes`).send({ notes: 'x' })).status).toBe(404);
    const row = await db.pool.query(`SELECT custom_metadata FROM events WHERE id = $1`, [ev.id]);
    expect((row.rows[0].custom_metadata || {}).notes).toBeUndefined();

    const { agent: ro, user: roUser } = await agentFor(app, 'read_only');
    const roEv = await seedEvent(roUser.id);
    expect((await ro.patch(`/api/events/${roEv.id}/notes`).send({ notes: 'x' })).status).toBe(403);

    const { agent: me } = await agentFor(app);
    expect((await me.patch('/api/events/not-a-uuid/notes').send({ notes: 'x' })).status).toBe(404);
    expect((await other.patch(`/api/events/${ev.id}/notes`).send({ notes: { html: 'x' } })).status).toBe(400);
    expect((await request(app).patch(`/api/events/${ev.id}/notes`).send({ notes: 'x' })).status).toBe(401);
  });
});
