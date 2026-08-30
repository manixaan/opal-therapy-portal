'use strict';

/**
 * Checkpoints and signatures inside a walkthrough (migration 046, phase 3).
 *
 * The two claims this file has to hold:
 *
 *   • a checkpoint is a REAL gate — the answer never reaches the browser, the
 *     server grades the attempt, and a wrong answer records nothing but a
 *     count;
 *   • a signature records the wording that was PUBLISHED, not the wording the
 *     client sent, so what somebody agreed to is answerable later.
 */

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const { db, truncateAll, seedUser, seedOrganisation, closePool } = require('./helpers');
const catalogue = require('../../walkthrough-catalogue');

const PASSWORD = 'EvidPass1';
const STATEMENT = 'I have read the infection control policy and will follow it.';

function buildApp() {
  const app = express();
  app.use(bodyParser.json());
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../tutorial-routes'));
  app.use('/', require('../../walkthrough-routes'));
  return app;
}

let app, org, owner;

async function agentFor(role, orgId) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser({ password_hash: hash, role, organisation_id: orgId });
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user };
}

/** A published walkthrough with a page, a checkpoint and a sign-here. */
async function publishFixture(agent) {
  const created = await agent.post('/api/walkthroughs').send({
    key: 'safety-tour', title: 'Safety', roles: ['owner', 'admin', 'therapist', 'read_only'],
    steps: [
      { type: 'page', title: 'Read this', body: 'The policy in brief.' },
      { type: 'checkpoint', title: 'Check', quiz: {
        question: 'What do you do first?', options: ['Guess', 'Follow the policy'],
        correctIndex: 1, explain: 'The policy always comes first.' } },
      { type: 'acknowledgement', title: 'Sign', ack_statement: STATEMENT },
    ],
  });
  expect(created.status).toBe(201);
  const id = created.body.walkthrough.id;
  expect((await agent.post(`/api/walkthroughs/${id}/publish`)).status).toBe(200);
  const detail = await agent.get(`/api/walkthroughs/${id}`);
  return { id, steps: detail.body.steps };
}

beforeAll(() => { app = buildApp(); });
beforeEach(async () => {
  await truncateAll();
  catalogue.invalidate();
  org = await seedOrganisation();
  require('../../auth')._resetLoginRateLimit();
  owner = await agentFor('owner', org.id);
});
afterAll(closePool);

// ── The answer never ships ──────────────────────────────────────────────────

test("a checkpoint's answer is stripped from the learner catalogue", async () => {
  await publishFixture(owner.agent);
  const { agent } = await agentFor('therapist', org.id);
  const res = await agent.get('/api/tutorials/catalogue');
  const mod = res.body.modules.find((m) => m.key === 'safety-tour');

  const checkpoint = mod.steps.find((s) => s.type === 'checkpoint');
  expect(checkpoint.quiz.options).toHaveLength(2);
  expect(checkpoint.quiz.correctIndex).toBeUndefined();
  expect(checkpoint.quiz.explain).toBeUndefined();
  expect(JSON.stringify(mod)).not.toContain('correctIndex');

  // The whole payload for this module must not contain the explanation
  // either — it names the right answer in prose.
  expect(JSON.stringify(mod)).not.toContain('The policy always comes first');
});

// ── Grading ─────────────────────────────────────────────────────────────────

test('a wrong answer is refused and records nothing but a count', async () => {
  const fx = await publishFixture(owner.agent);
  const cp = fx.steps.find((s) => s.type === 'checkpoint');
  const { agent, user } = await agentFor('therapist', org.id);
  await agent.put('/api/tutorials/safety-tour/progress').send({ version: 1, step: 0 });

  const wrong = await agent.post('/api/tutorials/safety-tour/evidence')
    .send({ stepKey: cp.key, chosen: 0 });
  expect(wrong.status).toBe(200);
  expect(wrong.body.passed).toBe(false);
  expect(wrong.body.explain).toBe('The policy always comes first.');

  const { rows } = await db.pool.query(
    `SELECT evidence FROM tutorial_progress WHERE user_id = $1 AND tutorial_key = 'safety-tour'`,
    [user.id]);
  const rec = rows[0].evidence[cp.key];
  expect(rec.attempts).toBe(1);
  expect(rec.passed).toBeUndefined();
  // Never the answer they gave.
  expect(JSON.stringify(rec)).not.toContain('chosen');
});

test('a right answer is recorded as passed', async () => {
  const fx = await publishFixture(owner.agent);
  const cp = fx.steps.find((s) => s.type === 'checkpoint');
  const { agent, user } = await agentFor('therapist', org.id);

  const right = await agent.post('/api/tutorials/safety-tour/evidence')
    .send({ stepKey: cp.key, chosen: 1 });
  expect(right.status).toBe(200);
  expect(right.body.passed).toBe(true);

  const { rows } = await db.pool.query(
    `SELECT evidence FROM tutorial_progress WHERE user_id = $1 AND tutorial_key = 'safety-tour'`,
    [user.id]);
  expect(rows[0].evidence[cp.key].passed).toBe(true);
  expect(rows[0].evidence[cp.key].at).toBeTruthy();
});

test('an answer outside the options offered is refused', async () => {
  const fx = await publishFixture(owner.agent);
  const cp = fx.steps.find((s) => s.type === 'checkpoint');
  const { agent } = await agentFor('therapist', org.id);
  for (const chosen of [-1, 2, 'yes', null]) {
    const res = await agent.post('/api/tutorials/safety-tour/evidence')
      .send({ stepKey: cp.key, chosen });
    expect(res.status).toBe(400);
  }
});

// ── Signatures ──────────────────────────────────────────────────────────────

test('a signature records the published wording, not the client copy', async () => {
  const fx = await publishFixture(owner.agent);
  const ack = fx.steps.find((s) => s.type === 'acknowledgement');
  const { agent, user } = await agentFor('therapist', org.id);

  const res = await agent.post('/api/tutorials/safety-tour/evidence')
    .send({ stepKey: ack.key, agreed: true, statement: 'I agree to nothing whatsoever.' });
  expect(res.status).toBe(200);

  const { rows } = await db.pool.query(
    `SELECT evidence FROM tutorial_progress WHERE user_id = $1 AND tutorial_key = 'safety-tour'`,
    [user.id]);
  const rec = rows[0].evidence[ack.key];
  expect(rec.statement).toBe(STATEMENT);
  expect(rec.hash).toBe(crypto.createHash('sha256').update(STATEMENT).digest('hex'));
});

test('an acknowledgement that was not agreed to is refused', async () => {
  const fx = await publishFixture(owner.agent);
  const ack = fx.steps.find((s) => s.type === 'acknowledgement');
  const { agent } = await agentFor('therapist', org.id);
  expect((await agent.post('/api/tutorials/safety-tour/evidence')
    .send({ stepKey: ack.key })).status).toBe(400);
  expect((await agent.post('/api/tutorials/safety-tour/evidence')
    .send({ stepKey: ack.key, agreed: 'yes' })).status).toBe(400);
});

// ── The boundary ────────────────────────────────────────────────────────────

test('evidence is refused for steps that record nothing, and for unknown steps', async () => {
  const fx = await publishFixture(owner.agent);
  const page = fx.steps.find((s) => s.type === 'page');
  const { agent } = await agentFor('therapist', org.id);

  expect((await agent.post('/api/tutorials/safety-tour/evidence')
    .send({ stepKey: page.key, agreed: true })).status).toBe(400);
  expect((await agent.post('/api/tutorials/safety-tour/evidence')
    .send({ stepKey: 'made-up', chosen: 0 })).status).toBe(400);
});

test('evidence requires a session and a module the role can take', async () => {
  const fx = await publishFixture(owner.agent);
  const cp = fx.steps.find((s) => s.type === 'checkpoint');
  expect((await request(app).post('/api/tutorials/safety-tour/evidence')
    .send({ stepKey: cp.key, chosen: 1 })).status).toBe(401);

  // Republish gated to owners only: a therapist's module vanishes entirely.
  await owner.agent.put(`/api/walkthroughs/${fx.id}`).send({
    key: 'safety-tour', title: 'Safety', roles: ['owner'], steps: fx.steps,
  });
  await owner.agent.post(`/api/walkthroughs/${fx.id}/publish`);
  catalogue.invalidate();

  const { agent } = await agentFor('therapist', org.id);
  expect((await agent.post('/api/tutorials/safety-tour/evidence')
    .send({ stepKey: cp.key, chosen: 1 })).status).toBe(404);
});

test('one member of staff never sees or writes another’s evidence', async () => {
  const fx = await publishFixture(owner.agent);
  const ack = fx.steps.find((s) => s.type === 'acknowledgement');
  const a = await agentFor('therapist', org.id);
  const b = await agentFor('therapist', org.id);

  await a.agent.post('/api/tutorials/safety-tour/evidence').send({ stepKey: ack.key, agreed: true });

  const mine = await b.agent.get('/api/tutorials/progress');
  expect(mine.body.progress).toEqual([]);

  const { rows } = await db.pool.query(
    `SELECT user_id FROM tutorial_progress WHERE tutorial_key = 'safety-tour'`);
  expect(rows).toHaveLength(1);
  expect(String(rows[0].user_id)).toBe(String(a.user.id));
});

test('recording evidence is audited without the answer', async () => {
  const fx = await publishFixture(owner.agent);
  const cp = fx.steps.find((s) => s.type === 'checkpoint');
  const { agent } = await agentFor('therapist', org.id);
  await agent.post('/api/tutorials/safety-tour/evidence').send({ stepKey: cp.key, chosen: 1 });

  const { rows } = await db.pool.query(
    `SELECT metadata FROM audit_logs WHERE action = 'tutorial.evidence_recorded'`);
  expect(rows).toHaveLength(1);
  expect(rows[0].metadata.kind).toBe('checkpoint');
  expect(JSON.stringify(rows[0].metadata)).not.toContain('chosen');
});
