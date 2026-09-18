'use strict';

/**
 * "Which Splose practitioner am I?" — self-service link/unlink.
 * Runs in-process with supertest; database and Splose are mocked.
 */

jest.mock('../database', () => ({
  pool:                   { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) },
  getUserByEmail:         jest.fn(),
  getUser:                jest.fn(),
  logAuditEvent:          jest.fn().mockResolvedValue(null),
  recordLogin:            jest.fn().mockResolvedValue(null),
  upsertTherapistProfile: jest.fn().mockResolvedValue({}),
  initializeDatabase:     jest.fn().mockResolvedValue(null),
}));
jest.mock('../email', () => ({ sendVerificationEmail: jest.fn(), sendPasswordResetEmail: jest.fn() }));
jest.mock('../outlook-oauth', () => ({}));
jest.mock('../splose-api', () => ({ getPractitioners: jest.fn() }));

const request = require('supertest');
const bcrypt = require('bcryptjs');
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const db = require('../database');
const sploseApi = require('../splose-api');

function buildApp() {
  const app = express();
  app.use(bodyParser.json());
  app.use(session({ secret: 'test', resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use('/', require('../auth'));
  app.use('/', require('../splose-link-routes'));
  return app;
}

const PASS = 'ValidPass1';
let HASH;
const ORG = '11111111-1111-4111-8111-111111111111';
const user = (over) => ({
  id: 'aaaaaaaa-1111-4111-8111-111111111111', email: 'sam@opal.test', name: 'Sam Okafor', display_name: null,
  role: 'therapist', organisation_id: ORG, is_active: true, account_status: 'active', email_verified: true, password_hash: HASH,
  tp_splose_practitioner_id: null, permissions: null, ...over,
});
const PRACS = [
  { id: 88167, fullName: 'Sam Okafor', email: 'Sam@Opal.test' },
  { id: 88200, fullName: 'Paulita Reyes', email: 'paulita@opal.test' },
  { id: 88300, fullName: 'Ann Mathew', email: 'ann@opal.test' },
];

async function login(app, u) {
  db.getUserByEmail.mockResolvedValue(u);
  db.getUser.mockResolvedValue(u);
  const agent = request.agent(app);
  const r = await agent.post('/api/auth/login').send({ email: u.email, password: PASS });
  expect(r.status).toBe(200);
  return agent;
}

beforeAll(async () => { HASH = await bcrypt.hash(PASS, 4); });
beforeEach(() => {
  jest.clearAllMocks();
  db.pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
  sploseApi.getPractitioners.mockResolvedValue(PRACS);
});

describe('GET /api/splose/my-practitioner', () => {
  test('a therapist may only select the practitioner whose email matches theirs', async () => {
    const agent = await login(buildApp(), user());
    const r = await agent.get('/api/splose/my-practitioner');
    expect(r.status).toBe(200);
    expect(r.body.linked).toBeNull();
    expect(r.body.canChooseAny).toBe(false);
    expect(r.body.options.map((o) => [o.id, o.selectable])).toEqual([['88167', true], ['88200', false], ['88300', false]]);
  });

  test('an owner may select anyone not already linked to another account', async () => {
    db.pool.query.mockResolvedValue({ rows: [{ id: '88200', name: 'Paulita', display_name: null }] });
    const agent = await login(buildApp(), user({ role: 'owner', email: 'ann@opal.test', tp_splose_practitioner_id: '88300' }));
    const r = await agent.get('/api/splose/my-practitioner');
    expect(r.body.linked).toEqual(expect.objectContaining({ id: '88300', fullName: 'Ann Mathew' }));
    expect(r.body.canChooseAny).toBe(true);
    const byId = Object.fromEntries(r.body.options.map((o) => [o.id, o]));
    expect(byId['88200'].selectable).toBe(false);
    expect(byId['88200'].claimedBy).toBe('Paulita');
    expect(byId['88167'].selectable).toBe(true);
  });

  test('read-only accounts are refused', async () => {
    const agent = await login(buildApp(), user({ role: 'read_only' }));
    const r = await agent.get('/api/splose/my-practitioner');
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('splose_read_only_denied');
  });

  test('no session is a 401', async () => {
    const r = await request(buildApp()).get('/api/splose/my-practitioner');
    expect(r.status).toBe(401);
  });
});

describe('PUT /api/splose/my-practitioner', () => {
  test('a therapist links their own practitioner and it is audited by id only', async () => {
    const agent = await login(buildApp(), user());
    const r = await agent.put('/api/splose/my-practitioner').send({ practitionerId: 88167 });
    expect(r.status).toBe(200);
    expect(r.body.linked).toEqual({ id: '88167', fullName: 'Sam Okafor' });
    expect(db.upsertTherapistProfile).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'aaaaaaaa-1111-4111-8111-111111111111', splosePractitionerId: '88167', organisationId: ORG,
    }));
    const audit = db.logAuditEvent.mock.calls.map((c) => c[0]).find((a) => a.action === 'splose.practitioner_linked');
    expect(audit).toBeTruthy();
    expect(audit.targetId).toBe('88167');
    expect(JSON.stringify(audit.metadata)).not.toMatch(/okafor|opal\.test/i);
  });

  test('a therapist cannot claim a colleague\'s practitioner', async () => {
    const agent = await login(buildApp(), user());
    const r = await agent.put('/api/splose/my-practitioner').send({ practitionerId: '88200' });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('practitioner_email_mismatch');
    expect(db.upsertTherapistProfile).not.toHaveBeenCalled();
  });

  test('an owner cannot take a practitioner already linked to another account', async () => {
    db.pool.query.mockResolvedValue({ rows: [{ id: '88200', name: 'Paulita', display_name: null }] });
    const agent = await login(buildApp(), user({ role: 'owner', email: 'ann@opal.test' }));
    const r = await agent.put('/api/splose/my-practitioner').send({ practitionerId: '88200' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('practitioner_already_linked');
  });

  test('an owner may link a free practitioner that is not their email', async () => {
    const agent = await login(buildApp(), user({ role: 'owner', email: 'ann@opal.test' }));
    const r = await agent.put('/api/splose/my-practitioner').send({ practitionerId: '88200' });
    expect(r.status).toBe(200);
  });

  test('an id Splose does not know is refused', async () => {
    const agent = await login(buildApp(), user({ role: 'owner' }));
    const r = await agent.put('/api/splose/my-practitioner').send({ practitionerId: '99999' });
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('practitioner_not_found');
  });

  test('a missing id is a 400', async () => {
    const agent = await login(buildApp(), user({ role: 'owner' }));
    const r = await agent.put('/api/splose/my-practitioner').send({});
    expect(r.status).toBe(400);
  });
});

describe('DELETE /api/splose/my-practitioner', () => {
  test('disconnecting clears the column explicitly and audits the previous id', async () => {
    const agent = await login(buildApp(), user({ tp_splose_practitioner_id: '88167' }));
    const r = await agent.delete('/api/splose/my-practitioner');
    expect(r.status).toBe(200);
    expect(r.body.linked).toBeNull();
    const sql = db.pool.query.mock.calls.find((c) => /UPDATE therapist_profiles/.test(c[0]));
    expect(sql).toBeTruthy();
    expect(sql[0]).toMatch(/splose_practitioner_id = NULL/);
    expect(sql[1]).toEqual(['aaaaaaaa-1111-4111-8111-111111111111']);
    const audit = db.logAuditEvent.mock.calls.map((c) => c[0]).find((a) => a.action === 'splose.practitioner_unlinked');
    expect(audit).toEqual(expect.objectContaining({ targetId: '88167' }));
  });
});
