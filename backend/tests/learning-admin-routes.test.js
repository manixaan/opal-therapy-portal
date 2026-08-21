'use strict';

/**
 * Assign Learning administration — permission-boundary unit tests for the
 * three endpoints added on top of the owner workspace (no real database).
 *
 * Publish, bulk assignment and the optimistic-lock save are management
 * operations: they must be unreachable by every role except owner, and they
 * must refuse malformed input before any query runs. Behaviour against real
 * SQL lives in tests/integration/learning-admin.itest.js.
 */

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

const TEST_PASS = 'ValidPass1';
let TEST_HASH;

const ORG = 'cccccccc-2222-4222-8222-222222222222';
const WF_ID = 'dddddddd-3333-4333-8333-333333333333';
const USER_ID = 'ffffffff-5555-4555-8555-555555555555';

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
    .set('X-Forwarded-For', `10.7.${Math.floor(ipCounter / 200)}.${(ipCounter++ % 200) + 10}`)
    .send({ email: user.email, password: TEST_PASS });
  expect(res.status).toBe(200);
  return agent;
}

const MANAGEMENT_ENDPOINTS = [
  ['POST', `/api/learning/workflows/${WF_ID}/publish`],
  ['POST', '/api/learning/assign'],
];

// ═══ Auth boundary ════════════════════════════════════════════════════════════

test('the management endpoints require a session', async () => {
  const anon = request(app);
  for (const [method, path] of MANAGEMENT_ENDPOINTS) {
    const res = await anon[method.toLowerCase()](path).send({});
    expect([path, res.status]).toEqual([path, 401]);
  }
});

test.each([['therapist', THERAPIST], ['admin', ADMIN], ['read_only', READ_ONLY]])(
  '%s cannot reach publish or bulk assignment (403, no queries run)',
  async (_label, user) => {
    const agent = await loginAs(user);
    for (const [method, path] of MANAGEMENT_ENDPOINTS) {
      db.pool.query.mockClear();
      const res = await agent[method.toLowerCase()](path).send({
        pairs: [{ workflowId: WF_ID, userId: USER_ID }],
      });
      expect([path, res.status]).toEqual([path, 403]);
      expect(db.pool.query).not.toHaveBeenCalled();
    }
  });

// ═══ Validation happens before data access ════════════════════════════════════

test('bulk assignment validates the pairs list before touching the database', async () => {
  const agent = await loginAs(OWNER);
  const cases = [
    {},                                                             // no pairs
    { pairs: [] },                                                  // empty
    { pairs: [{ workflowId: 'not-a-uuid', userId: USER_ID }] },     // bad workflow id
    { pairs: [{ workflowId: WF_ID, userId: 'not-a-uuid' }] },       // bad user id
    { pairs: [{ userId: USER_ID }] },                               // missing workflow
    { pairs: Array.from({ length: 501 }, () => ({ workflowId: WF_ID, userId: USER_ID })) },
    { pairs: [{ workflowId: WF_ID, userId: USER_ID }], dueAt: 'whenever' },
  ];
  for (const body of cases) {
    db.pool.query.mockClear();
    const res = await agent.post('/api/learning/assign').send(body);
    expect([JSON.stringify(body).slice(0, 60), res.status])
      .toEqual([JSON.stringify(body).slice(0, 60), 400]);
    expect(db.pool.query).not.toHaveBeenCalled();
  }
});

test('publish rejects a malformed workflow id without querying', async () => {
  const agent = await loginAs(OWNER);
  db.pool.query.mockClear();
  const res = await agent.post('/api/learning/workflows/not-a-uuid/publish').send({});
  expect(res.status).toBe(404);
  expect(db.pool.query).not.toHaveBeenCalled();
});

test('a workflow save rejects a malformed lock token before writing', async () => {
  const agent = await loginAs(OWNER);
  // loadWorkflow must find something for the handler to reach the guard.
  db.pool.query.mockResolvedValueOnce({
    rows: [{ id: WF_ID, title: 'X', status: 'active', draft_content: { sections: [] }, organisation_id: ORG }],
    rowCount: 1,
  });
  const res = await agent.put(`/api/learning/workflows/${WF_ID}`)
    .send({ title: 'New', expectedUpdatedAt: 'garbage' });
  expect(res.status).toBe(400);
  // Only the load ran; no UPDATE was issued.
  expect(db.pool.query).toHaveBeenCalledTimes(1);
});
