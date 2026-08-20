'use strict';

/**
 * Learning routes — permission-boundary unit tests (no real database).
 *
 * The DB is mocked, so these tests assert the AUTHORISATION layer only:
 * every endpoint requires a session; every owner-console endpoint refuses
 * therapist/admin/read_only; employee endpoints accept any authenticated
 * role (read_only writes die at the global choke point); and input ids are
 * validated before any query runs. Data behaviour (scoping, progress,
 * versioning) lives in tests/integration/learning.itest.js against real SQL.
 */

// ── Mock all external dependencies before any require ───────────────────────

jest.mock('../database', () => ({
  pool:               { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }), connect: jest.fn() },
  getUserByEmail:     jest.fn(),
  getUser:            jest.fn(),
  logAuditEvent:      jest.fn().mockResolvedValue(null),
  recordLogin:        jest.fn().mockResolvedValue(null),
  initializeDatabase: jest.fn().mockResolvedValue(null),
}));

jest.mock('../email', () => ({
  sendVerificationEmail:  jest.fn().mockResolvedValue(null),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(null),
}));

jest.mock('../outlook-oauth', () => ({}));
jest.mock('../splose-api',    () => ({}));

const request = require('supertest');
const bcrypt  = require('bcryptjs');
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const db = require('../database');

function buildApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(bodyParser.json());
  app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true },
  }));
  app.use('/', require('../auth'));
  app.use('/', require('../learning-routes'));
  return app;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const TEST_PASS = 'ValidPass1';
let TEST_HASH;

const ORG = 'cccccccc-2222-4222-8222-222222222222';
const WF_ID = 'dddddddd-3333-4333-8333-333333333333';
const AS_ID = 'eeeeeeee-4444-4444-8444-444444444444';

const mkUser = (role, n) => ({
  id: `${n}${n}${n}${n}${n}${n}${n}${n}-1111-4111-8111-11111111111${n}`,
  email: `${role}.${n}@opaltherapy.com.au`,
  role, is_active: true, account_status: 'active', email_verified: true,
  organisation_id: ORG, permissions: null, name: `${role} ${n}`,
});

const OWNER = mkUser('owner', 'a');
const ADMIN = mkUser('admin', 'b');
const THERAPIST = mkUser('therapist', 'c');
const READ_ONLY = mkUser('read_only', 'd');
const USERS = Object.fromEntries([OWNER, ADMIN, THERAPIST, READ_ONLY].map((u) => [u.id, u]));

let app;
let ipCounter = 0;

beforeAll(async () => {
  TEST_HASH = await bcrypt.hash(TEST_PASS, 1);
  app = buildApp();
  db.getUser.mockImplementation(async (id) => USERS[id] || null);
});

beforeEach(() => {
  db.pool.query.mockClear();
  db.pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
});

async function loginAs(user) {
  db.getUserByEmail.mockResolvedValueOnce({ ...user, password_hash: TEST_HASH });
  const agent = request.agent(app);
  const res = await agent
    .post('/api/auth/login')
    .set('X-Forwarded-For', `10.8.${Math.floor(ipCounter / 200)}.${(ipCounter++ % 200) + 10}`)
    .send({ email: user.email, password: TEST_PASS });
  expect(res.status).toBe(200);
  return agent;
}

const OWNER_ENDPOINTS = [
  ['GET',    '/api/learning/workflows'],
  ['POST',   '/api/learning/workflows'],
  ['GET',    `/api/learning/workflows/${WF_ID}`],
  ['PUT',    `/api/learning/workflows/${WF_ID}`],
  ['DELETE', `/api/learning/workflows/${WF_ID}`],
  ['POST',   `/api/learning/workflows/${WF_ID}/duplicate`],
  ['POST',   `/api/learning/workflows/${WF_ID}/archive`],
  ['POST',   `/api/learning/workflows/${WF_ID}/unarchive`],
  ['POST',   `/api/learning/workflows/${WF_ID}/assign`],
  ['GET',    `/api/learning/workflows/${WF_ID}/preview`],
  ['GET',    '/api/learning/assignments'],
  ['GET',    `/api/learning/assignments/${AS_ID}`],
  ['POST',   `/api/learning/assignments/${AS_ID}/cancel`],
  ['POST',   `/api/learning/assignments/${AS_ID}/push-latest`],
  ['GET',    '/api/learning/staff'],
];

const EMPLOYEE_ENDPOINTS = [
  ['GET',  '/api/learning/my'],
  ['GET',  `/api/learning/my/${AS_ID}`],
  ['POST', `/api/learning/my/${AS_ID}/start`],
  ['POST', `/api/learning/my/${AS_ID}/items/i-x/complete`],
];

const call = (agent, method, path) => agent[method.toLowerCase()](path).send({});

// ═══ Auth boundary ════════════════════════════════════════════════════════════

test('every learning endpoint requires a session', async () => {
  const anon = request(app);
  for (const [method, path] of [...OWNER_ENDPOINTS, ...EMPLOYEE_ENDPOINTS]) {
    const res = await call(anon, method, path);
    expect([method, path, res.status]).toEqual([method, path, 401]);
  }
});

// ═══ Owner console is owner-only ═════════════════════════════════════════════

test.each([['therapist', THERAPIST], ['admin', ADMIN]])(
  '%s is refused on every owner endpoint (403), with no data queries run',
  async (_label, user) => {
    const agent = await loginAs(user);
    for (const [method, path] of OWNER_ENDPOINTS) {
      db.pool.query.mockClear();
      const res = await call(agent, method, path);
      expect([method, path, res.status]).toEqual([method, path, 403]);
      // requireRole refuses before any handler SQL executes.
      expect(db.pool.query).not.toHaveBeenCalled();
    }
  });

test('read_only is refused on owner endpoints (403 via role or choke point)', async () => {
  const agent = await loginAs(READ_ONLY);
  for (const [method, path] of OWNER_ENDPOINTS) {
    const res = await call(agent, method, path);
    expect([method, path, res.status]).toEqual([method, path, 403]);
  }
});

test('owner passes the guard on the library list (200 with empty data)', async () => {
  const agent = await loginAs(OWNER);
  const res = await agent.get('/api/learning/workflows');
  expect(res.status).toBe(200);
  expect(res.body.workflows).toEqual([]);
});

// ═══ Employee endpoints ══════════════════════════════════════════════════════

test('any authenticated role may read their own learning', async () => {
  for (const user of [OWNER, ADMIN, THERAPIST, READ_ONLY]) {
    const agent = await loginAs(user);
    const res = await agent.get('/api/learning/my');
    expect(res.status).toBe(200);
    expect(res.body.assignments).toEqual([]);
  }
});

test('read_only cannot write progress (global choke point)', async () => {
  const agent = await loginAs(READ_ONLY);
  expect((await agent.post(`/api/learning/my/${AS_ID}/start`)).status).toBe(403);
  expect((await agent.post(`/api/learning/my/${AS_ID}/items/i-x/complete`).send({})).status).toBe(403);
});

test('an assignment the caller does not own answers 404 (not 403)', async () => {
  const agent = await loginAs(THERAPIST);
  // pool returns no rows — exactly what a foreign or absent assignment looks like
  const res = await agent.get(`/api/learning/my/${AS_ID}`);
  expect(res.status).toBe(404);
  expect(res.body).toEqual({ error: 'Not found' });
});

// ═══ Input validation before data access ═════════════════════════════════════

test('malformed ids are refused without touching the database', async () => {
  const agent = await loginAs(OWNER);
  for (const path of [
    '/api/learning/workflows/not-a-uuid',
    '/api/learning/assignments/42',
  ]) {
    db.pool.query.mockClear();
    const res = await agent.get(path);
    expect([path, res.status]).toEqual([path, 404]);
    expect(db.pool.query).not.toHaveBeenCalled();
  }
});

test('creating a workflow validates the title', async () => {
  const agent = await loginAs(OWNER);
  expect((await agent.post('/api/learning/workflows').send({})).status).toBe(400);
  expect((await agent.post('/api/learning/workflows').send({ title: '   ' })).status).toBe(400);
});

test('assigning validates userIds shape before any transaction', async () => {
  const agent = await loginAs(OWNER);
  const cases = [
    {},                          // missing
    { userIds: [] },             // empty
    { userIds: ['not-a-uuid'] }, // malformed
    { userIds: [OWNER.id], dueAt: 'yesterday-ish' }, // bad date
  ];
  for (const body of cases) {
    const res = await agent.post(`/api/learning/workflows/${WF_ID}/assign`).send(body);
    expect([JSON.stringify(body), res.status]).toEqual([JSON.stringify(body), 400]);
  }
});
