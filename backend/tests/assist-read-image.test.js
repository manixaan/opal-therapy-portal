'use strict';

/**
 * Opal Assist picture attachments — POST /api/assist/read-image.
 * A picture becomes TEXT by the portal's own OCR: no model call, nothing
 * stored, guarded like every other Assist route. OCR, database and provider
 * are mocked; synthetic data only.
 */

jest.mock('../database', () => ({
  pool:               { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) },
  getUserByEmail:     jest.fn(),
  getUser:            jest.fn(),
  logAuditEvent:      jest.fn().mockResolvedValue(null),
  recordLogin:        jest.fn().mockResolvedValue(null),
  initializeDatabase: jest.fn().mockResolvedValue(null),
}));
jest.mock('../email', () => ({ sendVerificationEmail: jest.fn(), sendPasswordResetEmail: jest.fn() }));
jest.mock('../outlook-oauth', () => ({}));
jest.mock('../splose-api', () => ({ isConfigured: () => false, getPatients: jest.fn(), getContacts: jest.fn(), getPractitioners: jest.fn() }));
jest.mock('../onboarding-ocr', () => ({ ocrDocument: jest.fn() }));

const request = require('supertest');
const bcrypt = require('bcryptjs');
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const db = require('../database');
const ocr = require('../onboarding-ocr');
const provider = require('../assist/assist-provider');
const routes = require('../assist-routes');

function buildApp() {
  const app = express();
  app.use(bodyParser.json());
  app.use(session({ secret: 'test', resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use('/', require('../auth'));
  app.use('/', routes);
  return app;
}
const PASS = 'ValidPass1';
let HASH;
const user = (over) => ({
  id: 'aaaaaaaa-1111-4111-8111-111111111111', email: 'sam@opal.test', name: 'Sam Okafor', display_name: null,
  role: 'therapist', organisation_id: null, is_active: true, account_status: 'active', email_verified: true, password_hash: HASH, permissions: null, ...over,
});
async function login(app, u) {
  db.getUserByEmail.mockResolvedValue(u); db.getUser.mockResolvedValue(u);
  const agent = request.agent(app);
  expect((await agent.post('/api/auth/login').send({ email: u.email, password: PASS })).status).toBe(200);
  return agent;
}
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);
const send = (agent, body = JPEG, type = 'image/jpeg') => agent.post('/api/assist/read-image').set('Content-Type', type).send(body);

let modelCalls;
beforeAll(async () => { HASH = await bcrypt.hash(PASS, 4); });
beforeEach(() => {
  jest.clearAllMocks();
  require('../auth')._resetLoginRateLimit();
  routes._resetRateLimitForTests(); routes._resetOcrForTests();
  process.env.OPAL_ASSIST_ENABLED = 'true';
  process.env.AWS_REGION = process.env.AWS_REGION || 'ap-southeast-2';
  process.env.BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID || 'au.anthropic.test-profile-synthetic';
  modelCalls = jest.fn(); provider._setProviderForTests(modelCalls);
  ocr.ocrDocument.mockResolvedValue({ status: 'ocr', pages: ['Behaviour support plan', 'Page two'], chars: 30, confidence: 88, pageCount: 1, truncated: false });
});
afterEach(() => { provider._setProviderForTests(null); delete process.env.OPAL_ASSIST_ENABLED; });

test('no session is 401 and read-only accounts are 403 — the picture is never read', async () => {
  expect((await send(request(buildApp()))).status).toBe(401);
  const agent = await login(buildApp(), user({ role: 'read_only' }));
  expect((await send(agent)).status).toBe(403);
  expect(ocr.ocrDocument).not.toHaveBeenCalled();
});

test('a picture comes back as its text: no model call, nothing written to the database', async () => {
  const agent = await login(buildApp(), user());
  db.pool.query.mockClear();
  const r = await send(agent);
  expect(r.status).toBe(200);
  expect(r.body).toEqual({ status: 'ocr', text: 'Behaviour support plan\n\nPage two', confidence: 88 });
  expect(ocr.ocrDocument).toHaveBeenCalledWith({ buffer: JPEG, mime: 'image/jpeg' });
  expect(modelCalls).not.toHaveBeenCalled();
  expect(db.pool.query).not.toHaveBeenCalled();
});

test('only PNG or JPEG bytes are read', async () => {
  const agent = await login(buildApp(), user());
  expect((await send(agent, Buffer.from('GIF89a'), 'image/gif')).status).toBe(400);
  expect((await agent.post('/api/assist/read-image').send({ image: 'x' })).status).toBe(400);
  expect((await send(agent, Buffer.alloc(0))).status).toBe(400);
  expect(ocr.ocrDocument).not.toHaveBeenCalled();
});

test('a picture over 8 MB is 413 before OCR runs', async () => {
  const agent = await login(buildApp(), user());
  const r = await send(agent, Buffer.alloc(8 * 1024 * 1024 + 10, 1));
  expect(r.status).toBe(413);
  expect(ocr.ocrDocument).not.toHaveBeenCalled();
});

test('Assist switched off refuses the picture too (fail closed)', async () => {
  const agent = await login(buildApp(), user());
  process.env.OPAL_ASSIST_ENABLED = 'false';
  expect((await send(agent)).status).toBe(503);
  expect(ocr.ocrDocument).not.toHaveBeenCalled();
});

test('no text and engine failure answer plainly, without content', async () => {
  const agent = await login(buildApp(), user());
  ocr.ocrDocument.mockResolvedValueOnce({ status: 'no_text', pages: [''], chars: 0, confidence: 10 });
  const a = await send(agent);
  expect(a.status).toBe(422); expect(a.body.message).toMatch(/No readable text/);
  ocr.ocrDocument.mockResolvedValueOnce({ status: 'failed', pages: [], chars: 0, confidence: null });
  const b = await send(agent);
  expect(b.status).toBe(502); expect(b.body).not.toHaveProperty('text');
});

test('at most two pictures are read at once across the server; the third is told to retry', async () => {
  const agent = await login(buildApp(), user());
  const gates = [];
  ocr.ocrDocument.mockImplementation(() => new Promise((resolve) => gates.push(() => resolve({ status: 'ocr', pages: ['text text text text text'], chars: 25, confidence: 90 }))));
  const first = send(agent).then((r) => r); const second = send(agent).then((r) => r);
  for (let i = 0; gates.length < 2 && i < 100; i++) await new Promise((r) => setTimeout(r, 20));
  expect(gates).toHaveLength(2);
  const third = await send(agent);
  expect(third.status).toBe(503); expect(third.body.error).toBe('ocr_busy');
  gates.forEach((g) => g());
  expect((await first).status).toBe(200); expect((await second).status).toBe(200);
  ocr.ocrDocument.mockResolvedValue({ status: 'ocr', pages: ['text text text text text'], chars: 25, confidence: 90 });
  expect((await send(agent)).status).toBe(200); // the slots are free again
});

test('the composer attaches only the TEXT of a picture, and never sends the picture to a chat route', () => {
  const fs = require('fs'); const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../../frontend/current/assist-composer.js'), 'utf8');
  const posts = src.match(/fetch\('[^']+'/g) || [];
  expect(posts).toEqual(["fetch('/api/assist/read-image'"]);
  expect(src).toContain("'--- Text read from attached picture: '");
});
