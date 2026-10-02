'use strict';

/**
 * Route-aware Smart Booking — the backend seams it adds (2 Oct 2026):
 *   • POST /api/maps/routes forwards a FUTURE departure time only;
 *   • PATCH /api/events/:dbId/travel keeps a leg's routed facts (minutes,
 *     metres, purpose, place) and drops anything malformed;
 *   • GET /api/profile/work-schedule/:userId — another clinician's week for
 *     "Booking for", owner/admin (view_all_travel) only, same organisation.
 */

let mockUser = null;
jest.mock('../database', () => ({
  pool: { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) },
  logAuditEvent: jest.fn().mockResolvedValue(null),
}));
jest.mock('../outlook-oauth', () => ({}));
jest.mock('../splose-api', () => ({}));
jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));
jest.mock('../permissions', () => {
  const actual = jest.requireActual('../permissions');
  return {
    ...actual,
    requireAuth: (req, res, next) => {
      if (!mockUser) return res.status(401).json({ error: 'Not authenticated' });
      req.user = mockUser; req.session = { userId: mockUser.id }; next();
    },
  };
});

const request = require('supertest');
const express = require('express');
const axios = require('axios');
const db = require('../database');

const ORG = '11111111-1111-4111-8111-111111111111';
const ME = 'aaaaaaaa-1111-4111-8111-111111111111';
const OTHER = 'cccccccc-3333-4333-8333-333333333333';
const as = (role) => { mockUser = { id: ME, role, organisation_id: ORG }; };

function app(router) {
  const a = express();
  a.use(express.json());
  a.use('/', require(router));
  return a;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = null;
  db.pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
  process.env.GOOGLE_MAPS_API_KEY = 'test-key-abcdefghijklmnop';
});
afterAll(() => { delete process.env.GOOGLE_MAPS_API_KEY; });

describe('POST /api/maps/routes departure time', () => {
  const { futureDepartureTime } = require('../maps-routes');

  test('only a valid future time inside 90 days is forwarded', () => {
    const soon = new Date(Date.now() + 3600 * 1000).toISOString();
    expect(futureDepartureTime(soon)).toBe(soon);
    expect(futureDepartureTime(new Date(Date.now() - 3600 * 1000).toISOString())).toBeNull();
    expect(futureDepartureTime(new Date(Date.now() + 200 * 24 * 3600 * 1000).toISOString())).toBeNull();
    expect(futureDepartureTime('tomorrow-ish')).toBeNull();
    expect(futureDepartureTime(12345)).toBeNull();
  });

  test('the proxy sends departureTime to Google when given one, and nothing otherwise', async () => {
    as('therapist');
    axios.post.mockResolvedValue({ data: { routes: [{ duration: '1500s', distanceMeters: 18000 }] } });
    const when = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
    const a = app('../maps-routes');
    const r = await request(a).post('/api/maps/routes').send({ origin: '12 Example St, Willetton', destination: '20 Example Rd, Canning Vale', departureTime: when });
    expect(r.status).toBe(200);
    expect(axios.post.mock.calls[0][1]).toMatchObject({ departureTime: when, routingPreference: 'TRAFFIC_AWARE' });
    await request(a).post('/api/maps/routes').send({ origin: 'A St, Como', destination: 'B St, Como', departureTime: '2001-01-01T00:00:00Z' });
    expect(axios.post.mock.calls[1][1]).not.toHaveProperty('departureTime');
  });
});

describe('PATCH /api/events/:dbId/travel — a leg keeps its routed facts', () => {
  const { cleanTravelSpec } = require('../routes');

  test('Return Home: a base with the routed minutes and purpose', () => {
    expect(cleanTravelSpec({ kind: 'base', id: 'home-1', purpose: 'home', travelMin: 23.4, distanceMeters: 18000, routedAt: '2026-10-02T01:00:00Z' }))
      .toEqual({ kind: 'base', id: 'home-1', purpose: 'home', travelMin: 23, distanceMeters: 18000, routedAt: '2026-10-02T01:00:00.000Z' });
  });

  test('Go Somewhere Else: an address with its place, coordinates and remembered destination', () => {
    const s = cleanTravelSpec({ kind: 'address', address: 'Fiona Stanley Hospital, Murdoch WA', label: 'Fiona Stanley Hospital', purpose: 'elsewhere',
      placeId: 'ChIJfsh', lat: -32.07, lng: 115.84, travelMin: 18, destinationId: 'bbbbbbbb-2222-4222-8222-222222222222' });
    expect(s).toMatchObject({ kind: 'address', label: 'Fiona Stanley Hospital', purpose: 'elsewhere', placeId: 'ChIJfsh', lat: -32.07, lng: 115.84, travelMin: 18 });
  });

  test('malformed facts are dropped, never stored; the spec itself still validates', () => {
    const s = cleanTravelSpec({ kind: 'base', id: 'home-1', purpose: 'party', travelMin: -5, placeId: 'bad id', lat: 200, lng: 5, destinationId: 'x', routedAt: 'nope' });
    expect(s).toEqual({ kind: 'base', id: 'home-1' });
    expect(cleanTravelSpec({ kind: 'address', address: '' })).toBeUndefined();
    expect(cleanTravelSpec({ kind: 'teleport' })).toBeUndefined();
  });

  test('the endpoint still refuses read-only accounts and scopes the row to the caller', async () => {
    const a = app('../routes');
    as('read_only');
    expect((await request(a).patch('/api/events/e1/travel').send({ after: { kind: 'base', id: 'home-1' } })).status).toBe(403);
    as('therapist');
    db.pool.query.mockResolvedValue({ rows: [{ id: 'e1', custom_metadata: { travel: { after: { kind: 'base', id: 'home-1', travelMin: 20 } } } }] });
    const r = await request(a).patch('/api/events/e1/travel').send({ after: { kind: 'base', id: 'home-1', purpose: 'home', travelMin: 20 } });
    expect(r.status).toBe(200);
    const [, params] = db.pool.query.mock.calls.find(([t]) => /UPDATE events/.test(t));
    expect(params[1]).toBe(ME);
    expect(JSON.parse(params[2])).toEqual({ after: { kind: 'base', id: 'home-1', purpose: 'home', travelMin: 20 } });
  });
});

describe('GET /api/profile/work-schedule/:userId — another clinician, read-only', () => {
  test('a therapist cannot read anyone else\'s work locations', async () => {
    as('therapist');
    const r = await request(app('../profile-routes')).get('/api/profile/work-schedule/' + OTHER);
    expect(r.status).toBe(403);
    expect(db.pool.query).not.toHaveBeenCalled();
  });

  test('owner/admin read a same-organisation clinician\'s week and bases', async () => {
    for (const role of ['owner', 'admin']) {
      as(role);
      db.pool.query.mockResolvedValueOnce({ rows: [{ work_location_schedule: { '2026-W40': { mon: 'home-1' } }, default_work_location: { homes: [{ id: 'home-1', addr: '1 Holman St, Derby WA' }] } }] });
      const r = await request(app('../profile-routes')).get('/api/profile/work-schedule/' + OTHER);
      expect(r.status).toBe(200);
      expect(r.body.workLocationSchedule['2026-W40'].mon).toBe('home-1');
      const [sqlText, params] = db.pool.query.mock.calls[db.pool.query.mock.calls.length - 1];
      expect(sqlText).toMatch(/organisation_id IS NOT DISTINCT FROM \$2/);
      expect(params).toEqual([OTHER, ORG]);
    }
  });

  test('unknown, other-organisation or malformed ids disclose nothing', async () => {
    as('owner');
    expect((await request(app('../profile-routes')).get('/api/profile/work-schedule/' + OTHER)).status).toBe(404);
    expect((await request(app('../profile-routes')).get('/api/profile/work-schedule/not-a-uuid')).status).toBe(400);
  });
});
