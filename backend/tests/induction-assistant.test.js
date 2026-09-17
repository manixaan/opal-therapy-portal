'use strict';

/**
 * Induction assistant — unit tests (no database, no model).
 *
 * The DB is mocked and the gateway is replaced through the route's test seam,
 * so these assert the BOUNDARY: owner-only, fail-closed when the feature is
 * off, bounded tool loop, tool inputs validated exactly as a request body
 * would be, and nothing but ids and counts in the audit row. The tool loop's
 * real SQL is exercised in tests/integration/induction-assistant.itest.js.
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

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const bcrypt  = require('bcryptjs');
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const db = require('../database');
const routes = require('../induction-assistant-routes');

function buildApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(bodyParser.json());
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false, httpOnly: true } }));
  app.use('/', require('../auth'));
  app.use('/', routes);
  return app;
}

const TEST_PASS = 'ValidPass1';
let TEST_HASH;
const ORG = 'cccccccc-2222-4222-8222-222222222222';
const WF_ID = 'dddddddd-3333-4333-8333-333333333333';
const CONV_ID = 'eeeeeeee-4444-4444-8444-444444444444';

const mkUser = (role, n) => ({
  id: `${n}${n}${n}${n}${n}${n}${n}${n}-1111-4111-8111-11111111111${n}`,
  email: `${role}.${n}@opaltherapy.com.au`,
  role, is_active: true, account_status: 'active', email_verified: true,
  organisation_id: ORG, permissions: null, name: `${role} ${n}`,
});
const OWNER = mkUser('owner', 'a');
const ADMIN = mkUser('admin', 'b');
const THERAPIST = mkUser('therapist', 'c');
const USERS = Object.fromEntries([OWNER, ADMIN, THERAPIST].map((u) => [u.id, u]));

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
  db.logAuditEvent.mockClear();
  routes._resetRateLimit();
  routes._setGenerateForTests(null);
  process.env.INDUCTION_AI_ENABLED = 'true';
});

async function login(user) {
  db.getUserByEmail.mockImplementation(async (email) =>
    (email === user.email ? { ...user, password_hash: TEST_HASH } : null));
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login')
    .set('X-Forwarded-For', `10.9.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`)
    .send({ email: user.email, password: TEST_PASS });
  expect(res.status).toBe(200);
  return agent;
}

const CONTENT = [{ title: 'Welcome', items: [{ type: 'content', title: 'Who we are', body: 'Hi.' }] }];

/** A scripted model: each call pops the next reply. */
function scriptModel(replies) {
  const calls = [];
  routes._setGenerateForTests(async (opts) => {
    calls.push(opts);
    const next = replies.shift();
    if (!next) throw new Error('script exhausted');
    if (next.throw) throw new Error(next.throw);
    return { text: next.text || null, toolUse: next.tool ? { type: 'tool_use', id: 't' + calls.length, name: next.tool, input: next.input || {} } : null, metadata: {} };
  });
  return calls;
}

// ── Authorisation ─────────────────────────────────────────────────────────────

describe('the assistant is owner-only', () => {
  test('anonymous is refused', async () => {
    const res = await request(app).post('/api/learning/assistant/chat').send({ message: 'hi' });
    expect(res.status).toBe(401);
  });

  test.each([['admin', ADMIN], ['therapist', THERAPIST]])('%s is refused on chat and config', async (_, user) => {
    const agent = await login(user);
    expect((await agent.post('/api/learning/assistant/chat').send({ message: 'hi' })).status).toBe(403);
    expect((await agent.get('/api/learning/assistant/config')).status).toBe(403);
    expect(db.logAuditEvent.mock.calls.some((c) => /assistant|learning/.test(c[0].action))).toBe(false);
  });
});

// ── Fail-closed ───────────────────────────────────────────────────────────────

describe('the feature is off unless switched on', () => {
  test('config reports disabled and chat degrades gracefully, without touching the model', async () => {
    delete process.env.INDUCTION_AI_ENABLED;
    const calls = scriptModel([{ text: 'should never be reached' }]);
    const agent = await login(OWNER);
    expect((await agent.get('/api/learning/assistant/config')).body).toEqual({ enabled: false });
    const res = await agent.post('/api/learning/assistant/chat').send({ message: 'Build me one' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('unavailable');
    expect(calls).toHaveLength(0);
    // Nothing persisted, nothing audited: the request never became a turn.
    expect(db.pool.query).not.toHaveBeenCalled();
  });

  test('the policy exists and is internal-only, onshore, non-clinical', () => {
    const policy = require('../ai/ai-policy').get('induction_assistant');
    expect(policy).toBeTruthy();
    expect(policy.classification).toBe('internal');
    expect(policy.allowedClassifications).not.toContain('clinical');
    expect(policy.outputTypes).toEqual(['assistant_response']);
    expect(policy.region).toBe('australia');
    expect(policy.mayReceiveClinicalData).toBe(false);
  });

  test('the security status page knows the feature flag', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'ai-security-routes.js'), 'utf8');
    expect(src).toContain("induction_assistant: 'INDUCTION_AI_ENABLED'");
  });
});

// ── Input ────────────────────────────────────────────────────────────────────

describe('input is validated before anything runs', () => {
  test('an empty or oversized message is refused', async () => {
    scriptModel([]);
    const agent = await login(OWNER);
    expect((await agent.post('/api/learning/assistant/chat').send({ message: '' })).status).toBe(400);
    expect((await agent.post('/api/learning/assistant/chat').send({ message: 'x'.repeat(4001) })).status).toBe(400);
  });

  test('a conversation id that is not a uuid, or not mine, is 404', async () => {
    scriptModel([]);
    const agent = await login(OWNER);
    expect((await agent.post('/api/learning/assistant/chat').send({ message: 'hi', conversationId: 'nope' })).status).toBe(404);
    db.pool.query.mockResolvedValueOnce({ rows: [] }); // ownership lookup finds nothing
    expect((await agent.post('/api/learning/assistant/chat').send({ message: 'hi', conversationId: CONV_ID })).status).toBe(404);
  });
});

// ── The loop ─────────────────────────────────────────────────────────────────

describe('the tool loop', () => {
  test('a plain answer is one generation, persisted, audited with counts only', async () => {
    const calls = scriptModel([{ text: 'You have no inductions yet. Shall I draft one?' }]);
    db.pool.query.mockImplementation(async (sql) => {
      if (/INSERT INTO induction_assistant_conversations/.test(sql)) return { rows: [{ id: CONV_ID }] };
      return { rows: [] };
    });
    const agent = await login(OWNER);
    const res = await agent.post('/api/learning/assistant/chat').send({ message: 'What do we have?' });
    expect(res.status).toBe(200);
    expect(res.body.answer).toMatch(/no inductions/);
    expect(res.body.conversationId).toBe(CONV_ID);
    expect(res.body.activity).toEqual([]);
    expect(calls).toHaveLength(1);
    // The model was handed the tools and the feature, never a raw model id.
    expect(calls[0].feature).toBe('induction_assistant');
    expect(calls[0].tools.map((t) => t.name)).toEqual(expect.arrayContaining(['create_induction', 'get_induction', 'list_anchors', 'get_walkthrough', 'update_walkthrough']));
    expect(calls[0].modelKey).toBeUndefined();
    // Audit: counts only.
    const audit = db.logAuditEvent.mock.calls.find((c) => c[0].action === 'learning.assistant_chat')[0];
    expect(audit.metadata).toEqual({ toolCalls: 0, tools: [] });
    expect(JSON.stringify(audit)).not.toContain('What do we have');
  });

  test('create_induction validates like the route, then reports what it made', async () => {
    const calls = scriptModel([
      { text: 'Creating it now.', tool: 'create_induction', input: { title: 'Welcome to Opal', category: 'induction', sections: CONTENT } },
      { text: 'Done — “Welcome to Opal” has one chapter.' },
    ]);
    db.pool.query.mockImplementation(async (sql) => {
      if (/INSERT INTO learning_workflows/.test(sql)) return { rows: [{ id: WF_ID, title: 'Welcome to Opal' }] };
      if (/INSERT INTO induction_assistant_conversations/.test(sql)) return { rows: [{ id: CONV_ID }] };
      return { rows: [] };
    });
    const agent = await login(OWNER);
    const res = await agent.post('/api/learning/assistant/chat').send({ message: 'Make a welcome induction' });
    expect(res.status).toBe(200);
    expect(res.body.activity).toEqual([expect.objectContaining({ tool: 'create_induction', id: WF_ID })]);
    expect(res.body.answer).toMatch(/Done/);
    // The second generation carried the tool result back, with a text block
    // beside it for the guardrail's current-message scope.
    const second = calls[1].messages;
    const last = second[second.length - 1];
    expect(last.role).toBe('user');
    expect(last.content[0].type).toBe('tool_result');
    expect(last.content[0].is_error).toBe(false);
    expect(last.content.some((b) => b.type === 'text')).toBe(true);
    // The insert went through the validator: keys were assigned.
    const insert = db.pool.query.mock.calls.find((c) => /INSERT INTO learning_workflows/.test(c[0]));
    const stored = JSON.parse(insert[1][4]);
    expect(stored.sections[0].items[0].key).toMatch(/^i/);
    expect(db.logAuditEvent.mock.calls.some((c) => c[0].action === 'learning.workflow_created' && c[0].metadata.via === 'induction_assistant')).toBe(true);
  });

  test('invalid tool input is handed back as an error result, never thrown', async () => {
    scriptModel([
      { tool: 'create_induction', input: { title: 'Bad', sections: [{ title: 'Ch', items: [{ type: 'quiz', title: 'Q', quiz: { questions: [{ question: 'x', options: ['only one'], correctIndex: 0 }] } }] }] } },
      { text: 'Sorry, let me fix that.' },
    ]);
    const calls = [];
    routes._setGenerateForTests(async (opts) => {
      calls.push(opts);
      if (calls.length === 1) return { text: null, toolUse: { type: 'tool_use', id: 't1', name: 'create_induction', input: { title: 'Bad', sections: [{ title: 'Ch', items: [{ type: 'quiz', title: 'Q', quiz: { questions: [{ question: 'x', options: ['only one'], correctIndex: 0 }] } }] }] } } };
      return { text: 'I fixed the question and will try again if you like.', toolUse: null };
    });
    db.pool.query.mockImplementation(async (sql) => (/INSERT INTO induction_assistant_conversations/.test(sql) ? { rows: [{ id: CONV_ID }] } : { rows: [] }));
    const agent = await login(OWNER);
    const res = await agent.post('/api/learning/assistant/chat').send({ message: 'Make a quiz' });
    expect(res.status).toBe(200);
    expect(res.body.activity).toEqual([]);
    const last = calls[1].messages[calls[1].messages.length - 1];
    expect(last.content[0].is_error).toBe(true);
    expect(last.content[0].content).toMatch(/at least two options/);
    expect(db.pool.query.mock.calls.some((c) => /INSERT INTO learning_workflows/.test(c[0]))).toBe(false);
  });

  test('the loop is bounded: after the cap it stops and says so', async () => {
    const calls = [];
    routes._setGenerateForTests(async (opts) => {
      calls.push(opts);
      return { text: null, toolUse: { type: 'tool_use', id: 't' + calls.length, name: 'list_inductions', input: {} } };
    });
    db.pool.query.mockImplementation(async (sql) => (/INSERT INTO induction_assistant_conversations/.test(sql) ? { rows: [{ id: CONV_ID }] } : { rows: [] }));
    const agent = await login(OWNER);
    const res = await agent.post('/api/learning/assistant/chat').send({ message: 'loop forever' });
    expect(res.status).toBe(200);
    expect(calls.length).toBe(9); // MAX_TOOL_CALLS + the final, refused turn
    expect(res.body.answer).toMatch(/stopped after several steps/);
  });

  test('a guardrail refusal is a blocked answer, a transport failure is unavailable — both HTTP 200, nothing persisted', async () => {
    const agent = await login(OWNER);
    routes._setGenerateForTests(async () => { throw new Error('guardrail_intervened'); });
    let res = await agent.post('/api/learning/assistant/chat').send({ message: 'x' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('blocked');
    routes._setGenerateForTests(async () => { throw new Error('provider_error'); });
    res = await agent.post('/api/learning/assistant/chat').send({ message: 'x' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('unavailable');
    expect(db.pool.query.mock.calls.some((c) => /INSERT INTO induction_assistant/.test(c[0]))).toBe(false);
  });

  test('a foreign workflowId focus is dropped, not trusted', async () => {
    const calls = scriptModel([{ text: 'ok' }]);
    db.pool.query.mockImplementation(async (sql) => {
      if (/SELECT id, title FROM learning_workflows/.test(sql)) return { rows: [] };
      if (/INSERT INTO induction_assistant_conversations/.test(sql)) return { rows: [{ id: CONV_ID }] };
      return { rows: [] };
    });
    const agent = await login(OWNER);
    await agent.post('/api/learning/assistant/chat').send({ message: 'add a chapter to this', workflowId: WF_ID });
    expect(calls[0].system).not.toContain(WF_ID);
  });
});

// ── The prompt ───────────────────────────────────────────────────────────────

describe('the prompt', () => {
  test('describes the lesson and step types the validators accept, and forbids assigning', () => {
    const p = routes.buildSystemPrompt({ user: { name: 'Ann Owner' } });
    for (const t of ['content', 'resource', 'task', 'acknowledgement', 'quiz', 'highlight', 'checkpoint', 'complete']) {
      expect(p).toContain(t);
    }
    expect(p).toMatch(/cannot assign/);
    expect(p).toMatch(/Never invent practice policies/);
    expect(p).toContain('Ann');
  });

  test('assigning and publishing are not tools', () => {
    const names = routes.TOOLS.map((t) => t.name);
    expect(names).not.toEqual(expect.arrayContaining(['assign_induction', 'publish_induction', 'archive_induction']));
  });
});
