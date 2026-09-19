'use strict';

/**
 * Opal Assist routes — the guard is the point: nothing with a name or contact
 * detail reaches the provider. In-process with supertest; database, Splose and
 * the provider are mocked. Synthetic names only.
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

const request = require('supertest');
const bcrypt = require('bcryptjs');
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const db = require('../database');
const directory = require('../assist/identity-directory');
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
const CONV = { id: '12345678-1234-4123-8123-123456789012', user_id: 'aaaaaaaa-1111-4111-8111-111111111111', surface: 'web' };

beforeAll(async () => { HASH = await bcrypt.hash(PASS, 4); });
beforeEach(() => {
  jest.clearAllMocks();
  require('../auth')._resetLoginRateLimit();
  routes._resetRateLimitForTests();
  process.env.OPAL_ASSIST_ENABLED = 'true';
  process.env.AWS_REGION = process.env.AWS_REGION || 'ap-southeast-2';
  process.env.BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID || 'au.anthropic.test-profile-synthetic';
  provider._setProviderForTests(async ({ messages, onText }) => {
    const last = messages[messages.length - 1].content;
    const reply = `Draft for [CLIENT_1]: ${last.length} chars received.`;
    if (onText) { onText(reply.slice(0, 10)); onText(reply.slice(10)); }
    return { text: reply };
  });
  directory._setCacheForTests({ entries: [{ role: 'client', ref: 'splose:patient:1', name: 'Aiden Blackwood-Tan', variants: directory.strictVariants('Aiden Blackwood-Tan') }], partial: false });
  db.pool.query.mockImplementation(async (sql) => {
    if (/INSERT INTO assist_conversations/.test(sql)) return { rows: [CONV], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
});
afterEach(() => { provider._setProviderForTests(null); delete process.env.OPAL_ASSIST_ENABLED; });

test('read-only accounts are refused; no session is 401', async () => {
  const agent = await login(buildApp(), user({ role: 'read_only' }));
  expect((await agent.post('/api/assist/check').send({ text: 'hi' })).status).toBe(403);
  expect((await request(buildApp()).get('/api/assist/config')).status).toBe(401);
});

test('check hides known people and contact details without calling the provider', async () => {
  const spy = jest.fn(); provider._setProviderForTests(spy);
  const agent = await login(buildApp(), user());
  const r = await agent.post('/api/assist/check').send({ text: 'Aiden rang from 0412 345 678.' });
  expect(r.status).toBe(200);
  expect(r.body.text).toBe('[CLIENT_1] rang from [PHONE_1].');
  expect(r.body.hidden.map((h) => h.token)).toEqual(['CLIENT_1', 'PHONE_1']);
  expect(spy).not.toHaveBeenCalled();
});

test('chat refuses a message that still carries a name — the provider is never called', async () => {
  const spy = jest.fn(); provider._setProviderForTests(spy);
  const agent = await login(buildApp(), user());
  const r = await agent.post('/api/assist/chat').send({ message: 'Write to Aiden about his plan.' });
  expect(r.status).toBe(422);
  expect(r.body.code).toBe('known_name_present');
  expect(spy).not.toHaveBeenCalled();
  const sel = await agent.post('/api/assist/chat').send({ message: 'Summarise this.', selection: 'Call me on 0412 345 678' });
  expect(sel.status).toBe(422);
  expect(sel.body.where).toBe('selection');
});

test('chat sends tokenised text, stores only tokenised text, and audits counts only', async () => {
  const agent = await login(buildApp(), user());
  const r = await agent.post('/api/assist/chat').send({ message: 'Write to [CLIENT_1] about the plan review.', hiddenCount: 1, surface: 'word' });
  expect(r.status).toBe(200);
  expect(r.body.status).toBe('ok');
  expect(r.body.conversationId).toBe(CONV.id);
  const inserts = db.pool.query.mock.calls.filter((c) => /INSERT INTO assist_messages/.test(c[0]));
  expect(inserts).toHaveLength(2);
  expect(inserts[0][1][1]).toBe('Write to [CLIENT_1] about the plan review.');
  const audit = db.logAuditEvent.mock.calls.map((c) => c[0]).find((a) => a.action === 'assist.chat');
  expect(audit.metadata).toEqual(expect.objectContaining({ surface: 'word', hiddenCount: 1, streamed: false }));
  expect(JSON.stringify(audit)).not.toContain('plan review');
});

test('the stream sends deltas then done; a guardrail refusal after deltas sends blocked', async () => {
  const agent = await login(buildApp(), user());
  const ok = await agent.post('/api/assist/chat/stream').send({ message: 'Hello [CLIENT_1]' });
  expect(ok.headers['content-type']).toMatch(/text\/event-stream/);
  expect(ok.text).toMatch(/event: delta/);
  expect(ok.text).toMatch(/event: done/);
  provider._setProviderForTests(async ({ onText }) => { onText('partial words '); throw new Error('content_blocked'); });
  const blocked = await agent.post('/api/assist/chat/stream').send({ message: 'Hello again' });
  expect(blocked.text).toMatch(/event: delta/);
  expect(blocked.text).toMatch(/event: blocked/);
  expect(blocked.text).not.toMatch(/event: done/);
});

test('switched off answers unavailable and never touches the provider', async () => {
  process.env.OPAL_ASSIST_ENABLED = 'false';
  const spy = jest.fn(); provider._setProviderForTests(spy);
  const agent = await login(buildApp(), user());
  const cfg = await agent.get('/api/assist/config');
  expect(cfg.body.enabled).toBe(false);
  const r = await agent.post('/api/assist/chat').send({ message: 'hi' });
  expect(r.body.status).toBe('unavailable');
  expect(spy).not.toHaveBeenCalled();
});

test('another user\'s conversation is not found', async () => {
  db.pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
  const agent = await login(buildApp(), user());
  expect((await agent.get('/api/assist/conversations/' + CONV.id)).status).toBe(404);
  expect((await agent.delete('/api/assist/conversations/' + CONV.id)).status).toBe(404);
  expect((await agent.post('/api/assist/chat').send({ message: 'hi', conversationId: CONV.id })).status).toBe(404);
});

describe('document actions — a typed instruction becomes a list of fixed tools', () => {
  test('only the de-identified instruction reaches the model, and only offered tool ids come back', async () => {
    let seen = null;
    provider._setProviderForTests(async ({ system, messages }) => { seen = { system, messages }; return { text: 'Sure! {"actions": ["tidy", "toc", "delete_everything", "tidy"], "note": "ok"}' }; });
    const agent = await login(buildApp(), user());
    const r = await agent.post('/api/assist/actions').send({ surface: 'word', instruction: "Clean up Aiden's report and refresh the contents", document: 'SECRET BODY' });
    expect(r.status).toBe(200);
    expect(r.body.actions).toEqual(['tidy', 'toc']);
    expect(seen.messages).toEqual([{ role: 'user', content: "Clean up [CLIENT_1]'s report and refresh the contents" }]);
    expect(JSON.stringify(seen)).not.toMatch(/Aiden|SECRET BODY/);
    expect(seen.system).toContain('tidy:');
  });

  test('an unknown surface or empty instruction is refused; a reply that is not JSON yields no actions', async () => {
    provider._setProviderForTests(async () => ({ text: 'I would format the document.' }));
    const agent = await login(buildApp(), user());
    expect((await agent.post('/api/assist/actions').send({ surface: 'outlook', instruction: 'x' })).status).toBe(400);
    expect((await agent.post('/api/assist/actions').send({ surface: 'excel', instruction: '  ' })).status).toBe(400);
    const r = await agent.post('/api/assist/actions').send({ surface: 'excel', instruction: 'make it nice' });
    expect(r.body.actions).toEqual([]);
    expect(r.body.note).toMatch(/chat below/);
  });

  test('guarded like the rest: no session is 401, read-only is 403', async () => {
    expect((await request(buildApp()).post('/api/assist/actions').send({ surface: 'word', instruction: 'x' })).status).toBe(401);
    const agent = await login(buildApp(), user({ role: 'read_only' }));
    expect((await agent.post('/api/assist/actions').send({ surface: 'word', instruction: 'x' })).status).toBe(403);
  });
});
