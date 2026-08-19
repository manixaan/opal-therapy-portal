'use strict';

/**
 * Interactive induction — tutorial progress API integration tests.
 * Real Express routes, real sessions, real SQL.
 *
 * Focus: auth boundary, role-gated catalogue/module access (404 for modules
 * a role cannot take), upsert/resume semantics, version handling, the
 * completion bridge into user_learning_progress, restart preserving the
 * completion record, strict user scoping, read_only write block, and the
 * owner/admin overview.
 */

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { db, truncateAll, seedUser, seedOrganisation, closePool } = require('./helpers');
const registry = require('../../../frontend/current/induction-modules.js');

const PASSWORD = 'TutorPass1';

function buildApp() {
  const app = express();
  app.use(bodyParser.json());
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../tutorial-routes'));
  return app;
}

let app, org;

async function agentFor(role, orgId) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser({ password_hash: hash, role, organisation_id: orgId });
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user };
}

beforeAll(() => { app = buildApp(); });
beforeEach(async () => {
  await truncateAll();
  org = await seedOrganisation();
  require('../../auth')._resetLoginRateLimit();
});
afterAll(closePool);

// ── Auth boundary ───────────────────────────────────────────────────────────

test('every endpoint requires a session', async () => {
  const anon = request(app);
  expect((await anon.get('/api/tutorials/progress')).status).toBe(401);
  expect((await anon.get('/api/tutorials/catalogue')).status).toBe(401);
  expect((await anon.put('/api/tutorials/portal-getting-started/progress').send({ version: 1, step: 1 })).status).toBe(401);
  expect((await anon.post('/api/tutorials/portal-getting-started/complete').send({ version: 1 })).status).toBe(401);
  expect((await anon.post('/api/tutorials/portal-getting-started/restart')).status).toBe(401);
  expect((await anon.get('/api/tutorials/overview')).status).toBe(401);
});

// ── Catalogue role filtering ────────────────────────────────────────────────

test('catalogue is role-filtered: therapist never sees owner-only modules', async () => {
  const { agent } = await agentFor('therapist', org.id);
  const res = await agent.get('/api/tutorials/catalogue');
  expect(res.status).toBe(200);
  const keys = res.body.modules.map((m) => m.key);
  expect(keys).toContain('portal-getting-started');
  expect(keys).not.toContain('portal-inviting-therapists');
  expect(keys).not.toContain('portal-master-scheduler');
});

test('owner catalogue includes every owner module with step counts', async () => {
  const { agent } = await agentFor('owner', org.id);
  const res = await agent.get('/api/tutorials/catalogue');
  const byKey = Object.fromEntries(res.body.modules.map((m) => [m.key, m]));
  expect(byKey['portal-inviting-therapists']).toBeTruthy();
  expect(byKey['portal-getting-started'].stepCount).toBeGreaterThanOrEqual(5);
});

// ── Progress lifecycle ──────────────────────────────────────────────────────

test('initial state: no rows; PUT creates; resume returns the same place', async () => {
  const { agent } = await agentFor('therapist', org.id);

  const empty = await agent.get('/api/tutorials/progress');
  expect(empty.body.progress).toEqual([]);

  const put = await agent.put('/api/tutorials/portal-getting-started/progress')
    .send({ version: 1, step: 4, stepCount: 14 });
  expect(put.status).toBe(200);
  expect(put.body.progress.status).toBe('in_progress');
  expect(put.body.progress.current_step).toBe(4);

  const back = await agent.get('/api/tutorials/progress');
  expect(back.body.progress).toHaveLength(1);
  expect(back.body.progress[0].tutorial_key).toBe('portal-getting-started');
  expect(back.body.progress[0].current_step).toBe(4);
});

test('furthest_step is monotonic within a version; stepping back keeps it', async () => {
  const { agent } = await agentFor('therapist', org.id);
  await agent.put('/api/tutorials/portal-getting-started/progress').send({ version: 1, step: 7 });
  const back = await agent.put('/api/tutorials/portal-getting-started/progress').send({ version: 1, step: 2 });
  expect(back.body.progress.current_step).toBe(2);
  expect(back.body.progress.furthest_step).toBe(7);
});

test('no duplicate rows for repeated writes (unique user+module)', async () => {
  const { agent } = await agentFor('therapist', org.id);
  for (const step of [0, 1, 2, 3]) {
    await agent.put('/api/tutorials/portal-getting-started/progress').send({ version: 1, step });
  }
  const { rows } = await db.pool.query('SELECT COUNT(*)::int AS n FROM tutorial_progress');
  expect(rows[0].n).toBe(1);
});

test('completion stamps completed_at and completed_version', async () => {
  const { agent } = await agentFor('therapist', org.id);
  await agent.put('/api/tutorials/portal-getting-started/progress').send({ version: 1, step: 13 });
  const done = await agent.post('/api/tutorials/portal-getting-started/complete').send({ version: 1 });
  expect(done.status).toBe(200);
  expect(done.body.progress.status).toBe('completed');
  expect(done.body.progress.completed_at).toBeTruthy();
  expect(done.body.progress.completed_version).toBe(1);
});

test('completing a module also completes the matching hub resource', async () => {
  const { agent, user } = await agentFor('therapist', org.id);
  const { rows: [resource] } = await db.pool.query(
    `INSERT INTO resources (organisation_id, title, slug, status, resource_type, content_type)
     VALUES ($1, 'Getting Started with the Opal Portal', 'portal-getting-started', 'approved', 'guide', 'tutorial')
     RETURNING id`, [org.id]);

  await agent.post('/api/tutorials/portal-getting-started/complete').send({ version: 1 });

  const { rows } = await db.pool.query(
    'SELECT * FROM user_learning_progress WHERE user_id = $1 AND resource_id = $2',
    [user.id, resource.id]);
  expect(rows).toHaveLength(1);
  expect(rows[0].completed_at).toBeTruthy();
});

test('completion works even when no matching resource exists (bridge is best-effort)', async () => {
  const { agent } = await agentFor('therapist', org.id);
  const done = await agent.post('/api/tutorials/portal-notifications/complete').send({ version: 1 });
  expect(done.status).toBe(200);
});

test('restart resets position, bumps restart_count, keeps the completion record', async () => {
  const { agent } = await agentFor('therapist', org.id);
  await agent.post('/api/tutorials/portal-getting-started/complete').send({ version: 1 });
  const restarted = await agent.post('/api/tutorials/portal-getting-started/restart');
  expect(restarted.status).toBe(200);
  expect(restarted.body.progress.status).toBe('in_progress');
  expect(restarted.body.progress.current_step).toBe(0);
  expect(restarted.body.progress.restart_count).toBe(1);
  expect(restarted.body.progress.completed_at).toBeTruthy();     // history survives
  expect(restarted.body.progress.completed_version).toBe(1);
});

test('restart of a module never started is 404, not a phantom row', async () => {
  const { agent } = await agentFor('therapist', org.id);
  expect((await agent.post('/api/tutorials/portal-getting-started/restart')).status).toBe(404);
  const { rows } = await db.pool.query('SELECT COUNT(*)::int AS n FROM tutorial_progress');
  expect(rows[0].n).toBe(0);
});

// ── Version handling ────────────────────────────────────────────────────────

test('a version above the registry is refused', async () => {
  const { agent } = await agentFor('therapist', org.id);
  const res = await agent.put('/api/tutorials/portal-getting-started/progress').send({ version: 99, step: 0 });
  expect(res.status).toBe(400);
});

test('a version change resets the furthest-step high-water mark', async () => {
  const { agent } = await agentFor('therapist', org.id);
  const mod = registry.moduleByKey('portal-getting-started');
  // Simulate an old-version row directly (the registry only knows the
  // current version, so the API cannot write a stale one).
  await agent.put('/api/tutorials/portal-getting-started/progress').send({ version: mod.version, step: 9 });
  await db.pool.query('UPDATE tutorial_progress SET version = 0');
  const res = await agent.put('/api/tutorials/portal-getting-started/progress').send({ version: mod.version, step: 1 });
  expect(res.body.progress.furthest_step).toBe(1); // not 9
});

// ── Validation ──────────────────────────────────────────────────────────────

test('invalid module key and role-blocked module both answer 404', async () => {
  const { agent } = await agentFor('therapist', org.id);
  expect((await agent.put('/api/tutorials/does-not-exist/progress').send({ version: 1, step: 0 })).status).toBe(404);
  // Owner-only module, therapist caller — indistinguishable from absent.
  expect((await agent.put('/api/tutorials/portal-inviting-therapists/progress').send({ version: 1, step: 0 })).status).toBe(404);
  expect((await agent.post('/api/tutorials/portal-inviting-therapists/complete').send({ version: 1 })).status).toBe(404);
});

test('invalid step values are refused', async () => {
  const { agent } = await agentFor('therapist', org.id);
  for (const step of [-1, 1.5, 'x', null]) {
    const res = await agent.put('/api/tutorials/portal-getting-started/progress').send({ version: 1, step });
    expect(res.status).toBe(400);
  }
});

// ── Scoping ─────────────────────────────────────────────────────────────────

test('progress is strictly per-user', async () => {
  const a = await agentFor('therapist', org.id);
  const b = await agentFor('therapist', org.id);
  await a.agent.put('/api/tutorials/portal-getting-started/progress').send({ version: 1, step: 5 });
  const other = await b.agent.get('/api/tutorials/progress');
  expect(other.body.progress).toEqual([]);
});

test('read_only can read but every write is blocked by the global choke point', async () => {
  const { agent } = await agentFor('read_only', org.id);
  expect((await agent.get('/api/tutorials/catalogue')).status).toBe(200);
  expect((await agent.get('/api/tutorials/progress')).status).toBe(200);
  expect((await agent.put('/api/tutorials/portal-getting-started/progress').send({ version: 1, step: 1 })).status).toBe(403);
  expect((await agent.post('/api/tutorials/portal-getting-started/complete').send({ version: 1 })).status).toBe(403);
});

// ── Overview ────────────────────────────────────────────────────────────────

test('overview is owner/admin only and reports per-role totals', async () => {
  const owner = await agentFor('owner', org.id);
  const therapist = await agentFor('therapist', org.id);

  expect((await therapist.agent.get('/api/tutorials/overview')).status).toBe(403);

  await therapist.agent.post('/api/tutorials/portal-getting-started/complete').send({ version: 1 });
  await therapist.agent.put('/api/tutorials/portal-using-calendar/progress').send({ version: 1, step: 2 });

  const res = await owner.agent.get('/api/tutorials/overview');
  expect(res.status).toBe(200);
  const row = res.body.staff.find((s) => s.userId === therapist.user.id);
  expect(row).toBeTruthy();
  expect(row.total).toBe(registry.modulesForRole('therapist').length);
  expect(row.completed).toBe(1);
  expect(row.inProgress).toBe(1);
  expect(row.lastActivityAt).toBeTruthy();
});

test('overview never crosses organisations', async () => {
  const otherOrg = await seedOrganisation('Other Org');
  const owner = await agentFor('owner', org.id);
  const outsider = await agentFor('therapist', otherOrg.id);
  await outsider.agent.post('/api/tutorials/portal-getting-started/complete').send({ version: 1 });

  const res = await owner.agent.get('/api/tutorials/overview');
  expect(res.body.staff.find((s) => s.userId === outsider.user.id)).toBeUndefined();
});
