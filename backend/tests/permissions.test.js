'use strict';

/**
 * Permission and role enforcement tests.
 *
 * Verifies that:
 *  - Unauthenticated requests to protected routes → 401
 *  - Therapist/read_only users hitting owner-only routes → 403
 *  - Owner users can reach owner-only routes (handler runs, no 401/403)
 *  - Registration without allowlist/invite is rejected
 *  - read_only role cannot trigger write actions
 *  - stripFinancials removes financial fields from response objects
 */

// ── Mock all external dependencies before any require ────────────────────────

jest.mock('../database', () => ({
  pool:             { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) },
  getUserByEmail:   jest.fn(),
  getUser:          jest.fn(),
  logAuditEvent:    jest.fn().mockResolvedValue(null),
  recordLogin:      jest.fn().mockResolvedValue(null),
  createLocalUser:  jest.fn(),
  createUser:       jest.fn(),
  findPendingInviteByEmail: jest.fn().mockResolvedValue(null),
  findInviteByToken:        jest.fn().mockResolvedValue(null),
  registerUserFromInvite:   jest.fn(),
  updateUserRole:           jest.fn().mockResolvedValue(null),
  getEvents:                jest.fn().mockResolvedValue([]),
  getEventsForTherapists:   jest.fn().mockResolvedValue([]),
  getTherapistProfile:      jest.fn().mockResolvedValue(null),
  getTherapistProfileById:  jest.fn().mockResolvedValue(null),
  getAllTherapistProfiles:   jest.fn().mockResolvedValue([]),
  getLeaveRequests:         jest.fn().mockResolvedValue([]),
  getCPDActivities:         jest.fn().mockResolvedValue([]),
  getPDDocuments:           jest.fn().mockResolvedValue([]),
  getCredentials:           jest.fn().mockResolvedValue([]),
  initializeDatabase:       jest.fn().mockResolvedValue(null),
}));

jest.mock('../email', () => ({
  sendVerificationEmail:  jest.fn().mockResolvedValue(null),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(null),
  sendInviteEmail:        jest.fn().mockResolvedValue(null),
  sendApprovalEmail:      jest.fn().mockResolvedValue(null),
}));

jest.mock('../outlook-oauth', () => ({}));
jest.mock('../splose-api',    () => ({}));

// ── Imports ──────────────────────────────────────────────────────────────────

const request  = require('supertest');
const bcrypt   = require('bcryptjs');
const db       = require('../database');
const buildApp = require('./helpers/buildApp');
const { stripFinancials } = require('../permissions');

// ── Test data ─────────────────────────────────────────────────────────────────

const TEST_PASS = 'ValidPass1';
let   TEST_HASH;

const makeUser = (overrides = {}) => ({
  id:              'user-001',
  email:           'user@opaltherapy.com.au',
  password_hash:   null, // set in beforeAll
  role:            'therapist',
  is_active:       true,
  account_status:  'active',
  email_verified:  true,
  organisation_id: 'org-001',
  permissions:     null,
  name:            'Test User',
  display_name:    'Test User',
  ...overrides,
});

let app;

beforeAll(async () => {
  TEST_HASH = await bcrypt.hash(TEST_PASS, 1);
  app = buildApp();
});

beforeEach(() => {
  jest.clearAllMocks();
  db.pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
  db.logAuditEvent.mockResolvedValue(null);
  db.recordLogin.mockResolvedValue(null);
});

// ── Helper: create an authenticated supertest agent for a given role ─────────

async function loginAs(role) {
  const user = makeUser({ id: `user-${role}`, role, password_hash: TEST_HASH });
  db.getUserByEmail.mockResolvedValueOnce(user);

  const agent = request.agent(app);
  const res = await agent
    .post('/api/auth/login')
    .set('X-Forwarded-For', `10.1.1.${Math.floor(Math.random() * 200) + 10}`)
    .send({ email: user.email, password: TEST_PASS });

  expect(res.status).toBe(200); // sanity check — login must succeed

  // After login, every requireAuth call will look up the user by session userId
  db.getUser.mockResolvedValue(user);

  return agent;
}

// ── 1. Unauthenticated access to protected routes → 401 ─────────────────────

test('GET /api/events without session returns 401', async () => {
  const res = await request(app).get('/api/events');
  expect(res.status).toBe(401);
});

test('GET /api/admin/users without session returns 401', async () => {
  const res = await request(app).get('/api/admin/users');
  expect(res.status).toBe(401);
});

test('GET /api/calendar/master without session returns 401', async () => {
  const res = await request(app).get('/api/calendar/master');
  expect(res.status).toBe(401);
});

// ── 2. Therapist cannot access owner-only routes → 403 ──────────────────────

test('therapist GET /api/admin/users returns 403', async () => {
  const agent = await loginAs('therapist');
  const res = await agent.get('/api/admin/users');
  expect(res.status).toBe(403);
});

test('therapist GET /api/splose/debug/raw-patient/:id returns 403', async () => {
  const agent = await loginAs('therapist');
  const res = await agent.get('/api/splose/debug/raw-patient/123');
  expect(res.status).toBe(403);
});

test('therapist GET /api/splose/debug/location-report returns 403', async () => {
  const agent = await loginAs('therapist');
  const res = await agent.get('/api/splose/debug/location-report');
  expect(res.status).toBe(403);
});

test('therapist GET /api/calendar/master returns 403', async () => {
  const agent = await loginAs('therapist');
  const res = await agent.get('/api/calendar/master');
  expect(res.status).toBe(403);
});

// ── 3. Owner can access owner-only routes ────────────────────────────────────

test('owner GET /api/admin/users returns 200 (handler runs)', async () => {
  const agent = await loginAs('owner');
  // pool.query returns { rows: [] } — handler maps to { users: [] }
  const res = await agent.get('/api/admin/users');
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('users');
});

// ── 4. read_only role cannot perform write actions ───────────────────────────

test('read_only user PATCH /api/admin/users/:id/approve returns 403', async () => {
  const agent = await loginAs('read_only');
  const res = await agent.patch('/api/admin/users/some-user-id/approve');
  expect(res.status).toBe(403);
});

test('read_only user PATCH /api/admin/users/:id/role returns 403', async () => {
  const agent = await loginAs('read_only');
  const res = await agent
    .patch('/api/admin/users/some-user-id/role')
    .send({ role: 'therapist' });
  expect(res.status).toBe(403);
});

// ── 5. Registration allowlist — unallowed email without invite is rejected ───

test('POST /api/auth/register with disallowed email and no invite is rejected', async () => {
  // ALLOWED_DOMAINS and ALLOWED_EMAILS are both '' (set in setup.js)
  // findPendingInviteByEmail returns null (no pending invite)
  db.findPendingInviteByEmail.mockResolvedValueOnce(null);

  const res = await request(app)
    .post('/api/auth/register')
    .send({
      email:           'outsider@gmail.com',
      password:        TEST_PASS,
      confirmPassword: TEST_PASS,
      profile:         { name: 'Outsider' }, // correct nested format
    });

  // Route returns 403 with code 'not_authorised' when not on allowlist and no invite
  expect(res.status).toBe(403);
  expect(res.body.code).toBe('not_authorised');
});

// ── 6. stripFinancials removes sensitive fields from response objects ─────────

test('stripFinancials removes all financial fields from a plain object', () => {
  const input = {
    id:          'event-1',
    title:       'Home Visit',
    rate:        120,
    billing_rate: 95,
    invoice_amount: 240,
    revenue:     480,
    cost:        50,
    earnings:    430,
    startTime:   '2026-06-01T09:00:00Z',
  };

  const result = stripFinancials(input);

  expect(result.id).toBe('event-1');
  expect(result.title).toBe('Home Visit');
  expect(result.startTime).toBeDefined();

  // All financial fields must be stripped
  expect(result).not.toHaveProperty('rate');
  expect(result).not.toHaveProperty('billing_rate');
  expect(result).not.toHaveProperty('invoice_amount');
  expect(result).not.toHaveProperty('revenue');
  expect(result).not.toHaveProperty('cost');
  expect(result).not.toHaveProperty('earnings');
});

test('stripFinancials works on arrays', () => {
  const items = [
    { id: '1', rate: 100, title: 'A' },
    { id: '2', rate: 200, title: 'B' },
  ];
  const result = stripFinancials(items);
  expect(result).toHaveLength(2);
  expect(result[0]).not.toHaveProperty('rate');
  expect(result[1]).not.toHaveProperty('rate');
  expect(result[0].title).toBe('A');
});
