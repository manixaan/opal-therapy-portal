'use strict';

/**
 * Migration 072 — client_service_locations + travel_destinations, through the
 * real routes and a real database. Splose is mocked at the caseload seam
 * (loadOwnClient), so nothing leaves the machine.
 */

jest.mock('../../splose-caseload', () => {
  class CaseloadError extends Error { constructor(code, status, message) { super(message || code); this.code = code; this.status = status; } }
  return {
    CaseloadError, isSploseClientId: () => true,
    loadOwnClient: jest.fn(async (req, id) => (String(id) === '501'
      ? { id: '501', fullName: 'Ada Client', suburb: 'Willetton', formattedAddress: '12 Example Street, Willetton WA 6155' }
      : null)),
  };
});
jest.mock('../../splose-api', () => ({ getPatients: jest.fn(async () => []), fetchAllCases: jest.fn(async () => []) }));
jest.mock('../../outlook-oauth', () => ({ MICROSOFT_OAUTH_CONFIG: { scopes: [] }, getAuthorizationUrl: jest.fn(), getAccessToken: jest.fn(), getMicrosoftUser: jest.fn(), refreshAccessToken: jest.fn() }));

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { db, truncateAll, seedUser, closePool } = require('./helpers');

const PASSWORD = 'ClientLocPass1';
beforeEach(async () => { await truncateAll(); require('../../auth')._resetLoginRateLimit(); });
afterAll(async () => { require('../../auth')._resetLoginRateLimit(); await closePool(); });

function buildApp() {
  const app = express();
  app.use(bodyParser.json());
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../client-location-routes'));
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
const rows = async (table) => (await db.pool.query(`SELECT * FROM ${table} ORDER BY created_at`)).rows;

describe('client_service_locations', () => {
  test('a new address is stored once; a reformatted copy or the same place id is the same row', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app);
    const r1 = await agent.post('/api/client-locations/501').send({ address: '20 Example Rd, Canning Vale WA 6155', label: 'Day Program', placeId: 'ChIJday', lat: -32.06, lng: 115.92 });
    expect(r1.status).toBe(201);
    const r2 = await agent.post('/api/client-locations/501').send({ address: '20 Example Road, Canning Vale WA 6155, Australia' });
    expect(r2.status).toBe(200);
    expect(r2.body).toMatchObject({ duplicate: true, of: 'saved', location: { id: r1.body.location.id } });
    const r3 = await agent.post('/api/client-locations/501').send({ address: 'Somewhere spelled differently', placeId: 'ChIJday' });
    expect(r3.body.duplicate).toBe(true);
    const saved = await rows('client_service_locations');
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ client_id: '501', label: 'Day Program', place_id: 'ChIJday', source: 'manual', created_by: user.id });
    expect(saved[0].normalized_address).toBe('20 example road canning vale 6155');
  });

  test('a place saved as its bare street address takes its name when picked again with it — never a different address', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app);
    const r1 = await agent.post('/api/client-locations/501').send({ address: '271 Forrest Rd, Hilbert WA 6112, Australia', label: 'Other', placeId: 'ChIJxav' });
    expect(r1.status).toBe(201);
    const r2 = await agent.post('/api/client-locations/501').send({ address: 'Xavier Catholic College, 271 Forrest Rd, Hilbert WA 6112, Australia', label: 'School', placeId: 'ChIJxav' });
    expect(r2.status).toBe(200);
    expect(r2.body).toMatchObject({ duplicate: true, location: { id: r1.body.location.id, address: 'Xavier Catholic College, 271 Forrest Rd, Hilbert WA 6112, Australia' } });
    // Same place id but an unrelated address: matched as the same place, text left alone.
    const r3 = await agent.post('/api/client-locations/501').send({ address: 'Somewhere else entirely', placeId: 'ChIJxav' });
    expect(r3.body.location.address).toBe('Xavier Catholic College, 271 Forrest Rd, Hilbert WA 6112, Australia');
    const saved = await rows('client_service_locations');
    expect(saved).toHaveLength(1);
    expect(saved[0].normalized_address).toBe('xavier catholic college 271 forrest road hilbert 6112');
  });

  test('the Splose address is never copied into the portal', async () => {
    const { agent } = await agentFor(buildApp());
    const r = await agent.post('/api/client-locations/501').send({ address: '12 Example St, Willetton WA 6155' });
    expect(r.body).toMatchObject({ duplicate: true, of: 'splose' });
    expect(await rows('client_service_locations')).toHaveLength(0);
  });

  test('the unique indexes hold even outside the route', async () => {
    await db.pool.query(`INSERT INTO client_service_locations (client_id, formatted_address, normalized_address, place_id) VALUES ('501','a','a','P1')`);
    await expect(db.pool.query(`INSERT INTO client_service_locations (client_id, formatted_address, normalized_address) VALUES ('501','A','a')`)).rejects.toThrow(/duplicate key/);
    await expect(db.pool.query(`INSERT INTO client_service_locations (client_id, formatted_address, normalized_address, place_id) VALUES ('501','b','b','P1')`)).rejects.toThrow(/duplicate key/);
    // Another client may share the address; an archived row frees it.
    await db.pool.query(`INSERT INTO client_service_locations (client_id, formatted_address, normalized_address) VALUES ('502','a','a')`);
    await db.pool.query(`UPDATE client_service_locations SET archived_at = NOW() WHERE client_id = '501'`);
    await db.pool.query(`INSERT INTO client_service_locations (client_id, formatted_address, normalized_address, place_id) VALUES ('501','a','a','P1')`);
  });

  test('GET lists Splose first, saved next, then this clinician\'s earlier booking addresses; used bumps the count', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app);
    const { user: other } = await agentFor(app);
    const saved = (await agent.post('/api/client-locations/501').send({ address: 'Example Primary School, Willetton WA 6155', label: 'School' })).body.location;
    const ev = await db.createEvent(user.id, { title: 'Client Appointment — Ada Client', startTime: '2026-09-14T01:00:00Z', endTime: '2026-09-14T02:00:00Z', eventType: 'therapy' });
    await db.pool.query(`UPDATE events SET client_id = '501', location = '45 Example Avenue, Como WA 6152' WHERE id = $1`, [ev.id]);
    const theirs = await db.createEvent(other.id, { title: 'Client Appointment — Ada Client', startTime: '2026-09-15T01:00:00Z', endTime: '2026-09-15T02:00:00Z', eventType: 'therapy' });
    await db.pool.query(`UPDATE events SET client_id = '501', location = '99 Their Booking St, Bentley WA' WHERE id = $1`, [theirs.id]);

    const r = await agent.get('/api/client-locations/501');
    expect(r.status).toBe(200);
    expect(r.body.locations.map((l) => [l.source, l.address])).toEqual([
      ['splose', '12 Example Street, Willetton WA 6155'],
      ['manual', 'Example Primary School, Willetton WA 6155'],
      ['previous_booking', '45 Example Avenue, Como WA 6152'],
    ]);

    expect((await agent.post(`/api/client-locations/501/${saved.id}/used`)).status).toBe(200);
    expect((await rows('client_service_locations'))[0].use_count).toBe(1);
    expect((await agent.post(`/api/client-locations/502/${saved.id}/used`)).status).toBe(404); // not this client / not in caseload
  });

  test('read-only accounts and clients outside the caseload are refused', async () => {
    const app = buildApp();
    const { agent: ro } = await agentFor(app, 'read_only');
    expect((await ro.get('/api/client-locations/501')).status).toBe(403);
    const { agent } = await agentFor(app);
    expect((await agent.get('/api/client-locations/999')).status).toBe(404);
  });
});

describe('travel_destinations', () => {
  test('a clinician\'s destinations are their own, deduplicated by place', async () => {
    const app = buildApp();
    const { agent: a, user: ua } = await agentFor(app);
    const { agent: b } = await agentFor(app);
    const body = { address: 'Fiona Stanley Hospital, 11 Robin Warren Dr, Murdoch WA 6150', label: 'Fiona Stanley Hospital', placeId: 'ChIJfsh' };
    expect((await a.post('/api/travel-destinations').send(body)).status).toBe(201);
    const again = await a.post('/api/travel-destinations').send({ address: 'FSH, Murdoch', placeId: 'ChIJfsh' });
    expect(again.body).toMatchObject({ duplicate: true, destination: { useCount: 2 } });
    expect((await a.get('/api/travel-destinations')).body.destinations).toHaveLength(1);
    expect((await b.get('/api/travel-destinations')).body.destinations).toHaveLength(0);
    const stored = await rows('travel_destinations');
    expect(stored).toHaveLength(1);
    expect(stored[0].user_id).toBe(ua.id);
  });
});

describe('a leg keeps its routed facts on the event (PATCH /api/events/:dbId/travel)', () => {
  test('Return Home and Go Somewhere Else answers round-trip with minutes, purpose and place', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app);
    const ev = await db.createEvent(user.id, { title: 'Client Appointment — Ada Client', startTime: '2026-09-14T01:00:00Z', endTime: '2026-09-14T02:00:00Z', eventType: 'therapy' });
    const after = { kind: 'address', address: 'Fiona Stanley Hospital, Murdoch WA', label: 'Fiona Stanley Hospital', purpose: 'elsewhere', placeId: 'ChIJfsh', lat: -32.07, lng: 115.84, travelMin: 18, distanceMeters: 15400 };
    const r = await agent.patch(`/api/events/${ev.id}/travel`).send({ before: null, after });
    expect(r.status).toBe(200);
    const row = (await db.pool.query(`SELECT custom_metadata FROM events WHERE id = $1`, [ev.id])).rows[0];
    expect(row.custom_metadata.travel.after).toEqual(after);
  });
});
