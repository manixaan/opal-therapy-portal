'use strict';

/**
 * Induction assistant — integration tests: real routes, real sessions, real
 * SQL, a scripted model through the route's test seam. Exercises migration
 * 067 (the conversation tables) and the tools' real queries: the assistant
 * creates an induction through the learning validator, reads it back, updates
 * it, and everything is scoped to the organisation and the user.
 */

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { db, truncateAll, seedUser, seedOrganisation, closePool } = require('./helpers');
const routes = require('../../induction-assistant-routes');

const PASSWORD = 'OwnerPass1';

function buildApp() {
  const app = express();
  app.use(bodyParser.json());
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use('/', require('../../auth'));
  app.use('/', routes);
  app.use('/', require('../../learning-routes'));
  return app;
}

let app, org, otherOrg;

async function agentFor(role, orgId) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser({ password_hash: hash, role, organisation_id: orgId });
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user };
}

function script(replies) {
  let n = 0;
  routes._setGenerateForTests(async () => {
    const next = replies[n++];
    if (!next) throw new Error('script exhausted');
    return { text: next.text || null, toolUse: next.tool ? { type: 'tool_use', id: 't' + n, name: next.tool, input: next.input || {} } : null, metadata: {} };
  });
}

beforeAll(async () => {
  app = buildApp();
  process.env.INDUCTION_AI_ENABLED = 'true';
});
beforeEach(async () => {
  await truncateAll();
  org = await seedOrganisation('Opal');
  otherOrg = await seedOrganisation('Elsewhere');
  routes._resetRateLimit();
});
afterAll(async () => { routes._setGenerateForTests(null); await closePool(); });

const SECTIONS = [
  { title: 'Welcome to the practice', items: [
    { type: 'content', title: 'Who we are', body: 'We are an NDIS practice.', required: true },
    { type: 'acknowledgement', title: 'Code of conduct', ack_statement: 'I have read the code.' } ] },
  { title: 'Check your understanding', items: [
    { type: 'quiz', title: 'Knowledge check', quiz: { passThreshold: 80, questions: [{ question: 'Where are appointments booked?', options: ['Splose', 'Outlook'], correctIndex: 0 }] } } ] },
];

test('creates an induction the library then shows, and persists the thread', async () => {
  const { agent, user } = await agentFor('owner', org.id);
  script([
    { text: 'Building it.', tool: 'create_induction', input: { title: 'New Graduate Induction', category: 'induction', description: 'Your first week.', sections: SECTIONS } },
    { text: 'Created “New Graduate Induction” with two chapters.' },
  ]);
  const res = await agent.post('/api/learning/assistant/chat').send({ message: 'Draft a new graduate induction' });
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('ok');
  expect(res.body.activity).toHaveLength(1);
  const wfId = res.body.activity[0].id;

  // The same page's own route sees it, validated and keyed.
  const list = await agent.get('/api/learning/workflows');
  expect(list.body.workflows.map((w) => w.id)).toContain(wfId);
  const detail = await agent.get('/api/learning/workflows/' + wfId);
  expect(detail.body.workflow.draft_content.sections).toHaveLength(2);
  expect(detail.body.workflow.draft_content.sections[0].items[1].ack_statement).toBe('I have read the code.');
  expect(detail.body.workflow.draft_content.sections[1].items[0].quiz.questions[0].options).toHaveLength(2);

  // The thread is stored under the user, with the activity on the assistant turn.
  const conv = await db.pool.query('SELECT * FROM induction_assistant_conversations WHERE id = $1', [res.body.conversationId]);
  expect(conv.rows[0].user_id).toBe(user.id);
  expect(conv.rows[0].organisation_id).toBe(org.id);
  const msgs = await db.pool.query('SELECT role, content, actions FROM induction_assistant_messages WHERE conversation_id = $1 ORDER BY id', [res.body.conversationId]);
  expect(msgs.rows.map((m) => m.role)).toEqual(['user', 'assistant']);
  expect(msgs.rows[1].actions[0].id).toBe(wfId);

  // Audit rows: the creation and the chat, ids only.
  const audit = await db.pool.query(`SELECT action, metadata FROM audit_logs WHERE action IN ('learning.workflow_created', 'learning.assistant_chat') ORDER BY id`);
  expect(audit.rows.map((r) => r.action).sort()).toEqual(['learning.assistant_chat', 'learning.workflow_created']);
  expect(audit.rows.find((r) => r.action === 'learning.workflow_created').metadata.via).toBe('induction_assistant');
  expect(JSON.stringify(audit.rows)).not.toContain('Draft a new graduate');
});

test('reads and updates the induction that is open, and history carries across turns', async () => {
  const { agent } = await agentFor('owner', org.id);
  const created = await agent.post('/api/learning/workflows').send({ title: 'Booking basics', content: { sections: SECTIONS.slice(0, 1) } });
  const wfId = created.body.workflow.id;
  const before = await agent.get('/api/learning/workflows/' + wfId);
  const originalKey = before.body.workflow.draft_content.sections[0].key;

  script([
    { tool: 'get_induction', input: { id: wfId } },
    { tool: 'update_induction', input: { id: wfId, sections: [Object.assign({ key: originalKey }, SECTIONS[0]), { title: 'Telehealth', items: [{ type: 'task', title: 'Book a telehealth session', body: 'In Splose.' }] }] } },
    { text: 'Added a Telehealth chapter.' },
  ]);
  const first = await agent.post('/api/learning/assistant/chat').send({ message: 'Add a telehealth chapter to this induction', workflowId: wfId });
  expect(first.body.activity).toEqual([expect.objectContaining({ tool: 'update_induction', id: wfId })]);

  const detail = await agent.get('/api/learning/workflows/' + wfId);
  expect(detail.body.workflow.draft_content.sections.map((s) => s.title)).toEqual(['Welcome to the practice', 'Telehealth']);
  // The existing chapter kept its key through the round trip.
  expect(detail.body.workflow.draft_content.sections[0].key).toBe(originalKey);

  // Second turn on the same thread: the model sees the earlier exchange.
  let seen = null;
  routes._setGenerateForTests(async (opts) => { seen = opts.messages; return { text: 'Yes, it has two chapters now.', toolUse: null }; });
  const second = await agent.post('/api/learning/assistant/chat').send({ message: 'How many chapters now?', conversationId: first.body.conversationId });
  expect(second.status).toBe(200);
  expect(seen.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
  expect(seen[0].content).toBe('Add a telehealth chapter to this induction');
});

test('tools are organisation-scoped and threads are user-owned', async () => {
  const mine = await agentFor('owner', org.id);
  const theirs = await agentFor('owner', otherOrg.id);
  const foreign = await theirs.agent.post('/api/learning/workflows').send({ title: 'Not yours', content: { sections: SECTIONS.slice(0, 1) } });
  const foreignId = foreign.body.workflow.id;

  let resultSeen = null;
  routes._setGenerateForTests(async (opts) => {
    const last = opts.messages[opts.messages.length - 1];
    if (Array.isArray(last.content) && last.content[0].type === 'tool_result') { resultSeen = last.content[0]; return { text: 'Could not.', toolUse: null }; }
    return { text: null, toolUse: { type: 'tool_use', id: 't1', name: 'get_induction', input: { id: foreignId } } };
  });
  const res = await mine.agent.post('/api/learning/assistant/chat').send({ message: 'Show me ' + foreignId });
  expect(res.status).toBe(200);
  expect(resultSeen.is_error).toBe(true);
  expect(resultSeen.content).toMatch(/No induction has that id/);

  // Their conversation id answers 404 for me.
  const other = await theirs.agent.post('/api/learning/assistant/chat').send({ message: 'hello' });
  const stolen = await mine.agent.post('/api/learning/assistant/chat').send({ message: 'hi', conversationId: other.body.conversationId });
  expect(stolen.status).toBe(404);
});

test('creates, reads and updates a walkthrough through the same validators the workshop uses', async () => {
  const { agent } = await agentFor('owner', org.id);
  const STEPS = [
    { type: 'intro', title: 'Welcome', body: 'Hi.' },
    { type: 'callout', title: 'The rule', body: 'Splose is the source of truth.' },
    { type: 'complete', title: 'Done', body: 'That is it.' },
  ];
  script([
    { tool: 'create_walkthrough', input: { title: 'Splose basics', roles: ['therapist'], minutes: 4, steps: STEPS } },
    { text: 'Created.' },
  ]);
  const made = await agent.post('/api/learning/assistant/chat').send({ message: 'Make a Splose walkthrough' });
  expect(made.body.activity[0].tool).toBe('create_walkthrough');
  const wkId = made.body.activity[0].id;

  // The model reads first, then sends the COMPLETE step list back with the
  // keys it was given, plus a new step — the shape the prompt asks for.
  let read = null;
  let n = 0;
  routes._setGenerateForTests(async (opts) => {
    const last = opts.messages[opts.messages.length - 1];
    if (Array.isArray(last.content) && last.content[0].type === 'tool_result' && !read) read = JSON.parse(last.content[0].content);
    n += 1;
    if (n === 1) return { text: null, toolUse: { type: 'tool_use', id: 't1', name: 'get_walkthrough', input: { id: wkId } }, metadata: {} };
    if (n === 2) {
      const kept = read.steps.map((st) => ({ key: st.key, type: st.type, title: st.title, body: st.body }));
      const steps = [kept[0], kept[1], { type: 'warning', title: 'Careful', body: 'Never delete.' }, kept[2]];
      return { text: null, toolUse: { type: 'tool_use', id: 't2', name: 'update_walkthrough', input: { id: wkId, steps } }, metadata: {} };
    }
    return { text: 'Added a warning step.', toolUse: null, metadata: {} };
  });
  const upd = await agent.post('/api/learning/assistant/chat').send({ message: 'Add a warning', walkthroughId: wkId });
  expect(read.steps).toHaveLength(3);
  expect(upd.body.activity[0].tool).toBe('update_walkthrough');
  const { rows } = await db.pool.query('SELECT draft_steps, status FROM walkthrough_modules WHERE id = $1', [wkId]);
  expect(rows[0].draft_steps.map((s) => s.type)).toEqual(['intro', 'callout', 'warning', 'complete']);
  expect(rows[0].draft_steps[0].key).toBe(read.steps[0].key);
});

test('a non-owner never reaches the model', async () => {
  const { agent } = await agentFor('admin', org.id);
  let called = false;
  routes._setGenerateForTests(async () => { called = true; return { text: 'x', toolUse: null }; });
  const res = await agent.post('/api/learning/assistant/chat').send({ message: 'hi' });
  expect(res.status).toBe(403);
  expect(called).toBe(false);
});
