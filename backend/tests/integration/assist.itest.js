'use strict';

/**
 * OPAL ASSIST (migration 070) — integration tests against a real database.
 * Threads and turns are stored tokenised; retention is 30 days; a thread is
 * its owner's alone; purge removes expired threads and their turns.
 * The provider is overridden — no model, no network.
 */

jest.mock('../../splose-api', () => ({ isConfigured: () => false, getPatients: jest.fn(), getContacts: jest.fn(), getPractitioners: jest.fn() }));

const request = require('supertest');
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const db = require('../../database');
const { truncateAll, seedUser, closePool } = require('./helpers');
const provider = require('../../assist/assist-provider');
const directory = require('../../assist/identity-directory');
const routes = require('../../assist-routes');

function buildApp() {
  const app = express();
  app.use(bodyParser.json());
  app.use(session({ secret: 'test', resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use((req, res, next) => { if (req.headers['x-test-user']) req.session.userId = req.headers['x-test-user']; next(); });
  app.use('/', routes);
  return app;
}

beforeEach(async () => {
  await truncateAll();
  routes._resetRateLimitForTests();
  process.env.OPAL_ASSIST_ENABLED = 'true';
  process.env.AWS_REGION = process.env.AWS_REGION || 'ap-southeast-2';
  process.env.BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID || 'au.anthropic.test-profile-synthetic';
  provider._setProviderForTests(async () => ({ text: 'Reply for [CLIENT_1].' }));
  directory._setCacheForTests({ entries: [{ role: 'client', ref: 'splose:patient:1', name: 'Aiden Blackwood-Tan', variants: directory.strictVariants('Aiden Blackwood-Tan') }], partial: false });
});
afterAll(async () => { provider._setProviderForTests(null); delete process.env.OPAL_ASSIST_ENABLED; await closePool(); });

test('migration 070 created the two tables with the 30-day default', async () => {
  const q = await db.pool.query(`SELECT column_default FROM information_schema.columns WHERE table_name = 'assist_conversations' AND column_name = 'expires_at'`);
  expect(q.rows[0].column_default).toMatch(/30 days/);
  const m = await db.pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'assist_messages'`);
  expect(m.rows.map((r) => r.column_name)).toEqual(expect.arrayContaining(['conversation_id', 'role', 'content', 'hidden_count']));
});

test('a thread is created tokenised, continued with history, and is only its owner\'s', async () => {
  const app = buildApp();
  const me = await seedUser({ role: 'therapist' });
  const other = await seedUser({ role: 'owner' });

  const first = await request(app).post('/api/assist/chat').set('x-test-user', me.id).send({ message: 'Draft a letter for [CLIENT_1].', hiddenCount: 1 });
  expect(first.status).toBe(200);
  const id = first.body.conversationId;

  const stored = await db.pool.query('SELECT role, content, hidden_count FROM assist_messages WHERE conversation_id = $1 ORDER BY id', [id]);
  expect(stored.rows.map((r) => r.content)).toEqual(['Draft a letter for [CLIENT_1].', 'Reply for [CLIENT_1].']);
  expect(stored.rows[0].hidden_count).toBe(1);

  let seen;
  provider._setProviderForTests(async ({ messages }) => { seen = messages; return { text: 'Shorter reply.' }; });
  const second = await request(app).post('/api/assist/chat').set('x-test-user', me.id).send({ message: 'Make it shorter.', conversationId: id });
  expect(second.status).toBe(200);
  expect(seen.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);

  expect((await request(app).get('/api/assist/conversations/' + id).set('x-test-user', other.id)).status).toBe(404);
  const mine = await request(app).get('/api/assist/conversations').set('x-test-user', me.id);
  expect(mine.body.conversations).toHaveLength(1);

  const refused = await request(app).post('/api/assist/chat').set('x-test-user', me.id).send({ message: 'Now mention Aiden by name.', conversationId: id });
  expect(refused.status).toBe(422);
});

test('purge removes threads past their expiry along with their turns', async () => {
  const app = buildApp();
  const me = await seedUser({ role: 'admin' });
  const r = await request(app).post('/api/assist/chat').set('x-test-user', me.id).send({ message: 'Hello.' });
  const id = r.body.conversationId;
  expect(await routes.purgeExpired()).toBe(0);
  await db.pool.query(`UPDATE assist_conversations SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [id]);
  expect(await routes.purgeExpired()).toBe(1);
  const left = await db.pool.query('SELECT COUNT(*)::int AS n FROM assist_messages');
  expect(left.rows[0].n).toBe(0);
});
