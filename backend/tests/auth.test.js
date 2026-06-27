'use strict';

/**
 * Auth flow tests — login, logout, rate limiting, session guard.
 *
 * All external services are mocked; no real database, email, or OAuth connections
 * are made. Tests run fully in-process using supertest.
 */

// ── Mock all external dependencies before any require ───────────────────────

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

// Prevent Outlook and Splose modules from making real HTTP calls
jest.mock('../outlook-oauth', () => ({}));
jest.mock('../splose-api',    () => ({}));

// ── Test setup ───────────────────────────────────────────────────────────────

const request = require('supertest');
const bcrypt  = require('bcryptjs');
const db      = require('../database');
const buildApp = require('./helpers/buildApp');

let app;
let TEST_HASH; // bcrypt hash of TEST_PASS, computed once before all tests

const TEST_PASS = 'ValidPass1';

const ACTIVE_USER = {
  id:              'user-therapist-001',
  email:           'therapist@opaltherapy.com.au',
  password_hash:   null, // set in beforeAll
  role:            'therapist',
  is_active:       true,
  account_status:  'active',
  email_verified:  true,
  organisation_id: 'org-001',
  permissions:     null,
  name:            'Test Therapist',
  display_name:    'Test Therapist',
};

beforeAll(async () => {
  // bcrypt cost 1 is intentionally low — only for test speed, never for production
  TEST_HASH = await bcrypt.hash(TEST_PASS, 1);
  ACTIVE_USER.password_hash = TEST_HASH;
  app = buildApp();
});

beforeEach(() => {
  jest.clearAllMocks();
  // Restore default mock implementations after each test
  db.pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
  db.logAuditEvent.mockResolvedValue(null);
  db.recordLogin.mockResolvedValue(null);
});

// ── Login — success ──────────────────────────────────────────────────────────

test('login with valid credentials returns 200 and a session cookie', async () => {
  db.getUserByEmail.mockResolvedValueOnce({ ...ACTIVE_USER });

  const res = await request(app)
    .post('/api/auth/login')
    .set('X-Forwarded-For', '10.0.1.1')
    .send({ email: ACTIVE_USER.email, password: TEST_PASS });

  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(res.body.user.email).toBe(ACTIVE_USER.email);
  expect(res.headers['set-cookie']).toBeDefined();
});

// ── Login — wrong password ───────────────────────────────────────────────────

test('login with wrong password returns 401', async () => {
  db.getUserByEmail.mockResolvedValueOnce({ ...ACTIVE_USER });

  const res = await request(app)
    .post('/api/auth/login')
    .set('X-Forwarded-For', '10.0.1.2')
    .send({ email: ACTIVE_USER.email, password: 'WrongPassword9' });

  expect(res.status).toBe(401);
  expect(res.body.error).toMatch(/invalid/i);
});

// ── Login — unknown email ────────────────────────────────────────────────────

test('login with unknown email returns 401 (no user enumeration)', async () => {
  db.getUserByEmail.mockResolvedValueOnce(null);

  const res = await request(app)
    .post('/api/auth/login')
    .set('X-Forwarded-For', '10.0.1.3')
    .send({ email: 'nobody@opaltherapy.com.au', password: TEST_PASS });

  expect(res.status).toBe(401);
  // Generic message — must not reveal whether the email exists
  expect(res.body.error).toMatch(/invalid/i);
});

// ── Login — inactive account ─────────────────────────────────────────────────

test('login with inactive account returns 403', async () => {
  db.getUserByEmail.mockResolvedValueOnce({ ...ACTIVE_USER, is_active: false });

  const res = await request(app)
    .post('/api/auth/login')
    .set('X-Forwarded-For', '10.0.1.4')
    .send({ email: ACTIVE_USER.email, password: TEST_PASS });

  expect(res.status).toBe(403);
});

// ── Login — pending email verification ──────────────────────────────────────

test('login with unverified email returns 403 with pending_verification code', async () => {
  db.getUserByEmail.mockResolvedValueOnce({
    ...ACTIVE_USER,
    account_status: 'pending_verification',
  });

  const res = await request(app)
    .post('/api/auth/login')
    .set('X-Forwarded-For', '10.0.1.5')
    .send({ email: ACTIVE_USER.email, password: TEST_PASS });

  expect(res.status).toBe(403);
  expect(res.body.code).toBe('pending_verification');
});

// ── Login — missing fields ───────────────────────────────────────────────────

test('login missing email or password returns 400', async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .set('X-Forwarded-For', '10.0.1.6')
    .send({ email: 'test@opaltherapy.com.au' }); // no password

  expect(res.status).toBe(400);
});

// ── GET /api/auth/me — unauthenticated ──────────────────────────────────────

test('GET /api/auth/me without session returns 401', async () => {
  const res = await request(app).get('/api/auth/me');
  expect(res.status).toBe(401);
});

// ── Logout ───────────────────────────────────────────────────────────────────

test('logout destroys the session', async () => {
  // 1. Log in
  db.getUserByEmail.mockResolvedValueOnce({ ...ACTIVE_USER });
  const agent = request.agent(app);

  const loginRes = await agent
    .post('/api/auth/login')
    .set('X-Forwarded-For', '10.0.1.7')
    .send({ email: ACTIVE_USER.email, password: TEST_PASS });

  expect(loginRes.status).toBe(200);

  // 2. Confirm /me works while logged in
  db.getUser.mockResolvedValueOnce({ ...ACTIVE_USER });
  const meRes = await agent.get('/api/auth/me');
  expect(meRes.status).toBe(200);

  // 3. Logout
  const logoutRes = await agent
    .post('/api/auth/logout')
    .set('X-Forwarded-For', '10.0.1.7');
  expect(logoutRes.status).toBe(200);

  // 4. /me should now return 401
  const meAfter = await agent.get('/api/auth/me');
  expect(meAfter.status).toBe(401);
});

// ── Rate limiting — 11th attempt triggers 429 ────────────────────────────────

test('rate limiter returns 429 after 10 failed login attempts from same IP', async () => {
  const RATE_LIMIT_IP = '10.0.2.99'; // unique IP so no cross-test state

  // Attempts 1–10: wrong password — should return 401
  for (let i = 0; i < 10; i++) {
    db.getUserByEmail.mockResolvedValueOnce({ ...ACTIVE_USER });
    const res = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', RATE_LIMIT_IP)
      .send({ email: ACTIVE_USER.email, password: 'WrongPass9' });

    // Attempts 1-10 should be 401, not 429
    expect(res.status).toBe(401);
  }

  // Attempt 11: should be blocked by rate limiter (429)
  db.getUserByEmail.mockResolvedValueOnce({ ...ACTIVE_USER });
  const blockedRes = await request(app)
    .post('/api/auth/login')
    .set('X-Forwarded-For', RATE_LIMIT_IP)
    .send({ email: ACTIVE_USER.email, password: 'WrongPass9' });

  expect(blockedRes.status).toBe(429);
  expect(blockedRes.headers['retry-after']).toBeDefined();
}, 30000); // generous timeout — 11 sequential requests with bcrypt
