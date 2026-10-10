'use strict';

/**
 * Smart Booking locations — GET/POST /api/client-locations/:clientId and
 * /api/travel-destinations (client-location-routes.js), plus the pure
 * dedupe/normalise helpers in client-locations-db.js.
 * Runs in-process with supertest; database and Splose caseload are mocked.
 */

jest.mock('../database', () => ({
  pool:                   { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) },
  getUserByEmail:         jest.fn(),
  getUser:                jest.fn(),
  logAuditEvent:          jest.fn().mockResolvedValue(null),
  recordLogin:            jest.fn().mockResolvedValue(null),
  initializeDatabase:     jest.fn().mockResolvedValue(null),
}));
jest.mock('../email', () => ({ sendVerificationEmail: jest.fn(), sendPasswordResetEmail: jest.fn() }));
jest.mock('../outlook-oauth', () => ({}));
jest.mock('../splose-caseload', () => {
  class CaseloadError extends Error { constructor(code, status, message) { super(message || code); this.code = code; this.status = status; } }
  return { CaseloadError, loadOwnClient: jest.fn(), isSploseClientId: () => true };
});

const request = require('supertest');
const bcrypt = require('bcryptjs');
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const db = require('../database');
const caseload = require('../splose-caseload');
const store = require('../client-locations-db');

function buildApp() {
  const app = express();
  app.use(bodyParser.json());
  app.use(session({ secret: 'test', resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use('/', require('../auth'));
  app.use('/', require('../client-location-routes'));
  return app;
}

const PASS = 'ValidPass1';
let HASH;
const ORG = '11111111-1111-4111-8111-111111111111';
const USER_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const LOC_ID = 'bbbbbbbb-2222-4222-8222-222222222222';
const user = (over) => ({
  id: USER_ID, email: 'sam@opal.test', name: 'Sam Okafor', display_name: null,
  role: 'therapist', organisation_id: ORG, is_active: true, account_status: 'active', email_verified: true, password_hash: HASH,
  tp_splose_practitioner_id: '88167', permissions: null, ...over,
});
const CLIENT = { id: '501', fullName: 'Ada Client', suburb: 'Willetton', formattedAddress: '12 Example Street, Willetton WA 6155' };

async function login(app, u) {
  db.getUserByEmail.mockResolvedValue(u);
  db.getUser.mockResolvedValue(u);
  const agent = request.agent(app);
  const r = await agent.post('/api/auth/login').send({ email: u.email, password: PASS });
  expect(r.status).toBe(200);
  return agent;
}

/** Route SQL by its first keyword + table so each test states only what it needs. */
function sql(handlers) {
  db.pool.query.mockImplementation(async (text, params) => {
    const t = String(text);
    for (const [re, fn] of handlers) if (re.test(t)) return fn(params, t);
    return { rows: [], rowCount: 0 };
  });
}

beforeAll(async () => { HASH = await bcrypt.hash(PASS, 4); });
beforeEach(() => {
  jest.clearAllMocks();
  require('../auth')._resetLoginRateLimit();
  db.pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
  caseload.loadOwnClient.mockResolvedValue(CLIENT);
});

describe('pure helpers', () => {
  test('formatting differences normalise to one address', () => {
    const a = store.normaliseAddress('12 Example St, Como WA 6152');
    expect(store.normaliseAddress('12 Example Street, Como WA 6152, Australia')).toBe(a);
    expect(store.normaliseAddress('12  example street,  COMO  6152')).toBe(a);
    expect(store.normaliseAddress('14 Example Street, Como WA 6152')).not.toBe(a);
  });

  test('a duplicate is found by place id, then address, then ~25 m of coordinates', () => {
    const rows = [
      { id: 'p', place_id: 'ChIJplace', normalized_address: store.normaliseAddress('1 Other Rd, Bentley'), lat: null, lng: null },
      { id: 'a', place_id: null, normalized_address: store.normaliseAddress('12 Example St, Como WA 6152'), lat: null, lng: null },
      { id: 'c', place_id: null, normalized_address: 'x', lat: -32.0, lng: 115.9 },
    ];
    expect(store.findDuplicate(rows, { address: 'anything', placeId: 'ChIJplace' }).id).toBe('p');
    expect(store.findDuplicate(rows, { address: '12 Example Street, Como WA 6152, Australia' }).id).toBe('a');
    expect(store.findDuplicate(rows, { address: 'Unit 1', lat: -32.00010, lng: 115.90010 }).id).toBe('c'); // ~14 m
    expect(store.findDuplicate(rows, { address: 'Far away', lat: -32.002, lng: 115.9 })).toBeNull();      // ~220 m
  });

  test('input is validated: address required, junk coordinates and place ids dropped', () => {
    expect(store.cleanLocationInput({}).error).toMatch(/address/);
    const v = store.cleanLocationInput({ address: ' 9 Road St, Como ', placeId: 'bad id!', lat: 'x', lng: 5 }).value;
    expect(v).toMatchObject({ address: '9 Road St, Como', placeId: null, lat: null, lng: null });
  });
});

describe('guards', () => {
  test('unauthenticated is refused', async () => {
    const r = await request(buildApp()).get('/api/client-locations/501');
    expect(r.status).toBe(401);
  });

  test('read_only and pre_employee accounts are refused before any lookup', async () => {
    for (const role of ['read_only', 'pre_employee']) {
      const agent = await login(buildApp(), user({ role }));
      const r = await agent.get('/api/client-locations/501');
      expect(r.status).toBe(403);
      const d = await agent.get('/api/travel-destinations');
      expect(d.status).toBe(403);
    }
    expect(caseload.loadOwnClient).not.toHaveBeenCalled();
  });

  test('a client outside the caller\'s caseload is a 404 and nothing is read or written', async () => {
    caseload.loadOwnClient.mockResolvedValue(null);
    const agent = await login(buildApp(), user());
    expect((await agent.get('/api/client-locations/999')).status).toBe(404);
    expect((await agent.post('/api/client-locations/999').send({ address: '1 Any St, Como' })).status).toBe(404);
    expect(db.pool.query.mock.calls.some(([t]) => /client_service_locations/.test(t))).toBe(false);
  });

  test('an unmapped therapist fails closed with the caseload code', async () => {
    caseload.loadOwnClient.mockRejectedValue(new caseload.CaseloadError('practitioner_mapping_required', 403, 'not linked'));
    const agent = await login(buildApp(), user({ tp_splose_practitioner_id: null }));
    const r = await agent.get('/api/client-locations/501');
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('practitioner_mapping_required');
  });

  test('a Splose outage is a 502, never an empty list', async () => {
    caseload.loadOwnClient.mockRejectedValue(new Error('ECONNRESET'));
    const agent = await login(buildApp(), user());
    const r = await agent.get('/api/client-locations/501');
    expect(r.status).toBe(502);
    expect(JSON.stringify(r.body)).not.toMatch(/ECONNRESET/);
  });
});

describe('GET /api/client-locations/:clientId', () => {
  test('Splose address first, then saved locations, then previously used — deduplicated', async () => {
    sql([
      [/FROM client_service_locations/, () => ({ rows: [
        { id: LOC_ID, label: 'School', formatted_address: 'Example Primary School, Willetton WA 6155', normalized_address: store.normaliseAddress('Example Primary School, Willetton WA 6155'), place_id: 'ChIJschool', lat: -32.05, lng: 115.88, source: 'manual', use_count: 2, last_used_at: null },
      ] })],
      [/FROM events/, (params) => {
        expect(params[1]).toBe(USER_ID); // a therapist sees addresses from their OWN bookings
        return { rows: [
          { location: '12 Example St, Willetton WA 6155', last_used: '2026-09-01' }, // = Splose address
          { location: '45 Example Avenue, Como WA 6152', last_used: '2026-08-01' },
        ] };
      }],
    ]);
    const agent = await login(buildApp(), user());
    const r = await agent.get('/api/client-locations/501');
    expect(r.status).toBe(200);
    expect(r.body.locations.map((l) => [l.source, l.label])).toEqual([
      ['splose', 'Home'], ['manual', 'School'], ['previous_booking', 'Previously used'],
    ]);
    expect(r.body.locations[1]).toMatchObject({ id: LOC_ID, placeId: 'ChIJschool' });
  });

  test('owner/admin read previous bookings practice-wide', async () => {
    let seen;
    sql([[/FROM events/, (params) => { seen = params[1]; return { rows: [] }; }]]);
    const agent = await login(buildApp(), user({ role: 'owner' }));
    expect((await agent.get('/api/client-locations/501')).status).toBe(200);
    expect(seen).toBeNull();
  });
});

describe('POST /api/client-locations/:clientId', () => {
  test('a new Google-picked address is saved with its place id and audited with ids only', async () => {
    const inserted = [];
    sql([
      [/^\s*SELECT \* FROM client_service_locations/, () => ({ rows: [] })],
      [/INSERT INTO client_service_locations/, (p) => { inserted.push(p); return { rows: [{ id: LOC_ID, label: p[2], formatted_address: p[3], place_id: p[5], lat: p[6], lng: p[7], source: p[8], use_count: 0 }] }; }],
    ]);
    const agent = await login(buildApp(), user());
    const r = await agent.post('/api/client-locations/501').send({ address: '20 Example Road, Canning Vale WA 6155', label: 'Day Program', placeId: 'ChIJday', lat: -32.06, lng: 115.92 });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ duplicate: false, location: { id: LOC_ID, label: 'Day Program', placeId: 'ChIJday', source: 'manual' } });
    expect(inserted[0][1]).toBe('501');
    const audit = db.logAuditEvent.mock.calls.map((c) => c[0]).find((a) => a.action === 'client_location.added');
    expect(audit).toMatchObject({ action: 'client_location.added', targetId: LOC_ID });
    expect(JSON.stringify(audit)).not.toMatch(/Canning Vale|Example Road/);
  });

  test('the Splose address again is not stored — Splose stays authoritative', async () => {
    const agent = await login(buildApp(), user());
    const r = await agent.post('/api/client-locations/501').send({ address: '12 Example St, Willetton WA 6155, Australia' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ duplicate: true, of: 'splose', location: null });
    expect(db.pool.query.mock.calls.some(([t]) => /INSERT INTO client_service_locations/.test(t))).toBe(false);
  });

  test('a differently formatted copy of a saved location returns the existing row', async () => {
    sql([
      [/^\s*SELECT \* FROM client_service_locations/, () => ({ rows: [
        { id: LOC_ID, label: 'Home', formatted_address: '45 Example Avenue, Como WA 6152', normalized_address: store.normaliseAddress('45 Example Avenue, Como WA 6152'), place_id: null, source: 'manual', use_count: 1 },
      ] })],
      [/UPDATE client_service_locations/, (p) => ({ rows: [{ id: p[0], label: 'Home', formatted_address: '45 Example Avenue, Como WA 6152', place_id: p[1], source: 'manual', use_count: 1 }] })],
    ]);
    const agent = await login(buildApp(), user());
    const r = await agent.post('/api/client-locations/501').send({ address: '45 Example Ave, Como WA 6152', placeId: 'ChIJcomo' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ duplicate: true, of: 'saved', location: { id: LOC_ID, placeId: 'ChIJcomo' } });
    expect(db.pool.query.mock.calls.some(([t]) => /INSERT INTO client_service_locations/.test(t))).toBe(false);
    expect(db.logAuditEvent.mock.calls.some((c) => c[0].action === 'client_location.added')).toBe(false);
  });

  test('a missing address is a 400', async () => {
    const agent = await login(buildApp(), user());
    expect((await agent.post('/api/client-locations/501').send({ label: 'Home' })).status).toBe(400);
  });

  test('marking a location used needs a real id and the client\'s own row', async () => {
    const agent = await login(buildApp(), user());
    expect((await agent.post('/api/client-locations/501/not-a-uuid/used')).status).toBe(400);
    expect((await agent.post('/api/client-locations/501/' + LOC_ID + '/used')).status).toBe(404);
    sql([[/UPDATE client_service_locations/, (p) => { expect(p).toEqual([LOC_ID, '501']); return { rows: [{ id: LOC_ID, label: 'Home', formatted_address: 'x', source: 'manual', use_count: 3 }] }; }]]);
    expect((await agent.post('/api/client-locations/501/' + LOC_ID + '/used')).status).toBe(200);
  });
});

describe('/api/travel-destinations', () => {
  test('a destination is the caller\'s own and never names a client', async () => {
    let insertParams;
    sql([
      [/^\s*SELECT \* FROM travel_destinations/, (p) => { expect(p).toEqual([USER_ID]); return { rows: [] }; }],
      [/INSERT INTO travel_destinations/, (p) => { insertParams = p; return { rows: [{ id: LOC_ID, label: p[1], formatted_address: p[2], place_id: p[4], use_count: 1 }] }; }],
    ]);
    const agent = await login(buildApp(), user());
    const r = await agent.post('/api/travel-destinations').send({ address: 'Fiona Stanley Hospital, 11 Robin Warren Dr, Murdoch WA 6150', label: 'Fiona Stanley Hospital', placeId: 'ChIJfsh' });
    expect(r.status).toBe(201);
    expect(insertParams[0]).toBe(USER_ID);
    expect(r.body.destination).toMatchObject({ label: 'Fiona Stanley Hospital', placeId: 'ChIJfsh' });
    expect(caseload.loadOwnClient).not.toHaveBeenCalled();
  });

  test('the same place again bumps the existing destination instead of duplicating it', async () => {
    sql([
      [/^\s*SELECT \* FROM travel_destinations/, () => ({ rows: [{ id: LOC_ID, label: 'FSH', formatted_address: 'x', normalized_address: 'x', place_id: 'ChIJfsh', use_count: 4 }] })],
      [/UPDATE travel_destinations/, (p) => ({ rows: [{ id: p[0], label: 'FSH', formatted_address: 'x', place_id: 'ChIJfsh', use_count: 5 }] })],
    ]);
    const agent = await login(buildApp(), user());
    const r = await agent.post('/api/travel-destinations').send({ address: 'Fiona Stanley Hospital, Murdoch', placeId: 'ChIJfsh' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ duplicate: true, destination: { id: LOC_ID, useCount: 5 } });
  });
});
