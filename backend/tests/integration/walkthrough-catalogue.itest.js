'use strict';

/**
 * Owner-authorable walkthrough catalogue (migration 045) — integration.
 *
 * What this pins, all of it new risk introduced by moving the catalogue out
 * of code and into the database:
 *
 *   • the schema exists and the seed is idempotent;
 *   • a seeded organisation is served from the DATABASE, and an authored
 *     edit reaches learners without a deploy;
 *   • an unseeded organisation still gets the shipped built-ins — moving the
 *     catalogue must not blank anyone's induction;
 *   • role gating survives the move (404, indistinguishable from absent);
 *   • completion is validated against the PUBLISHED version, not the draft:
 *     editing a draft can never invalidate work in flight;
 *   • only an Owner may seed.
 */

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { db, truncateAll, seedUser, seedOrganisation, closePool } = require('./helpers');
const catalogue = require('../../walkthrough-catalogue');
const registry = require('../../../frontend/current/induction-modules.js');

const PASSWORD = 'WalkPass1';

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
  catalogue.invalidate();
  org = await seedOrganisation();
  require('../../auth')._resetLoginRateLimit();
});
afterAll(closePool);

// ── Schema ──────────────────────────────────────────────────────────────────

test('migration 045 created both tables with the key uniqueness guard', async () => {
  const { rows } = await db.pool.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_name IN ('walkthrough_modules', 'walkthrough_module_versions')
      ORDER BY table_name`);
  expect(rows.map((r) => r.table_name))
    .toEqual(['walkthrough_module_versions', 'walkthrough_modules']);

  // organisation_id is nullable and NULLs compare as distinct — the COALESCE
  // sentinel index is what stops two org-less rows sharing a key and making
  // moduleByKey() ambiguous.
  await db.pool.query(
    `INSERT INTO walkthrough_modules (organisation_id, key, title, roles)
     VALUES (NULL, 'dup-key', 'One', '["owner"]'::jsonb)`);
  await expect(db.pool.query(
    `INSERT INTO walkthrough_modules (organisation_id, key, title, roles)
     VALUES (NULL, 'dup-key', 'Two', '["owner"]'::jsonb)`)).rejects.toThrow();
});

// ── Seeding ─────────────────────────────────────────────────────────────────

test('seeding writes every shipped module with a published version, once', async () => {
  const first = await catalogue.seedBuiltIns(org.id, null);
  expect(first.created.length).toBe(registry.MODULES.length);
  expect(first.skipped).toEqual([]);

  const { rows } = await db.pool.query(
    `SELECT m.key, m.current_version, m.source, COUNT(v.id)::int AS versions
       FROM walkthrough_modules m
       JOIN walkthrough_module_versions v ON v.module_id = m.id
      WHERE m.organisation_id = $1
      GROUP BY m.id, m.key, m.current_version, m.source`, [org.id]);
  expect(rows.length).toBe(registry.MODULES.length);
  rows.forEach((r) => {
    expect(r.source).toBe('builtin');
    expect(r.current_version).toBeGreaterThanOrEqual(1);
    expect(r.versions).toBe(1);
  });

  const second = await catalogue.seedBuiltIns(org.id, null);
  expect(second.created).toEqual([]);
  expect(second.skipped.length).toBe(registry.MODULES.length);
});

test('re-seeding never overwrites an edit to a built-in', async () => {
  await catalogue.seedBuiltIns(org.id, null);
  await db.pool.query(
    `UPDATE walkthrough_module_versions v SET title = 'Owner edited'
       FROM walkthrough_modules m
      WHERE v.module_id = m.id AND m.organisation_id = $1
        AND m.key = 'portal-getting-started' AND v.version = m.current_version`,
    [org.id]);

  await catalogue.seedBuiltIns(org.id, null);
  catalogue.invalidate();
  const mod = await catalogue.moduleByKey(org.id, 'portal-getting-started');
  expect(mod.title).toBe('Owner edited');
});

// ── Served from the database ────────────────────────────────────────────────

test('an authored edit reaches the learner catalogue without a deploy', async () => {
  await catalogue.seedBuiltIns(org.id, null);
  const { agent } = await agentFor('owner', org.id);

  await db.pool.query(
    `UPDATE walkthrough_module_versions v
        SET steps = jsonb_build_array(jsonb_build_object(
              'type', 'callout', 'title', 'Authored here', 'body', 'From the database.'))
       FROM walkthrough_modules m
      WHERE v.module_id = m.id AND m.organisation_id = $1
        AND m.key = 'portal-getting-started' AND v.version = m.current_version`,
    [org.id]);
  catalogue.invalidate();

  const res = await agent.get('/api/tutorials/catalogue');
  expect(res.status).toBe(200);
  const mod = res.body.modules.find((m) => m.key === 'portal-getting-started');
  expect(mod.steps).toHaveLength(1);
  expect(mod.steps[0].title).toBe('Authored here');
  expect(mod.stepCount).toBe(1);
});

test('an unseeded organisation still gets the shipped built-ins', async () => {
  const { agent } = await agentFor('owner', org.id);
  const res = await agent.get('/api/tutorials/catalogue');
  expect(res.status).toBe(200);
  const keys = res.body.modules.map((m) => m.key);
  expect(keys).toContain('portal-getting-started');
  expect(res.body.modules.every((m) => Array.isArray(m.steps) && m.steps.length)).toBe(true);
});

test('a draft that was never published is invisible to learners', async () => {
  await db.pool.query(
    `INSERT INTO walkthrough_modules
       (organisation_id, key, title, roles, draft_steps, current_version)
     VALUES ($1, 'unpublished-draft', 'Work in progress', '["owner"]'::jsonb, '[]'::jsonb, 0)`,
    [org.id]);
  catalogue.invalidate();
  const { agent } = await agentFor('owner', org.id);
  const res = await agent.get('/api/tutorials/catalogue');
  expect(res.body.modules.map((m) => m.key)).not.toContain('unpublished-draft');
});

// ── Role gating survives the move ───────────────────────────────────────────

test('role gating holds against the database catalogue', async () => {
  await catalogue.seedBuiltIns(org.id, null);
  const { agent } = await agentFor('therapist', org.id);

  const res = await agent.get('/api/tutorials/catalogue');
  const keys = res.body.modules.map((m) => m.key);
  expect(keys).toContain('portal-getting-started');
  expect(keys).not.toContain('portal-inviting-therapists');

  // Unknown and role-blocked answer identically.
  expect((await agent.post('/api/tutorials/portal-inviting-therapists/complete')
    .send({ version: 1 })).status).toBe(404);
  expect((await agent.post('/api/tutorials/no-such-module/complete')
    .send({ version: 1 })).status).toBe(404);
});

test('owner-gated steps never leave the server in a therapist payload', async () => {
  await catalogue.seedBuiltIns(org.id, null);
  const { agent } = await agentFor('therapist', org.id);
  const res = await agent.get('/api/tutorials/catalogue');
  const perf = res.body.modules.find((m) => m.key === 'splose-performance');
  expect(perf).toBeTruthy();
  expect(perf.steps.some((s) => s.roles && s.roles.indexOf('therapist') === -1)).toBe(false);
});

// ── Completion validates against the published version ──────────────────────

test('completion is validated against the published version, not the draft', async () => {
  await catalogue.seedBuiltIns(org.id, null);
  const { agent } = await agentFor('owner', org.id);

  // A draft edit — the learner-facing published version is untouched.
  await db.pool.query(
    `UPDATE walkthrough_modules SET draft_steps = '[]'::jsonb
      WHERE organisation_id = $1 AND key = 'portal-getting-started'`, [org.id]);
  catalogue.invalidate();

  const published = await catalogue.moduleByKey(org.id, 'portal-getting-started');
  const ok = await agent.post('/api/tutorials/portal-getting-started/complete')
    .send({ version: published.version });
  expect(ok.status).toBe(200);
  expect(ok.body.progress.completed_version).toBe(published.version);

  // A version that was never published is still refused.
  const bad = await agent.post('/api/tutorials/portal-getting-started/complete')
    .send({ version: published.version + 5 });
  expect(bad.status).toBe(400);
});

// ── Who may seed ────────────────────────────────────────────────────────────

test('only an owner may seed the catalogue', async () => {
  const therapist = await agentFor('therapist', org.id);
  expect((await therapist.agent.post('/api/tutorials/seed')).status).toBe(403);

  const admin = await agentFor('admin', org.id);
  expect((await admin.agent.post('/api/tutorials/seed')).status).toBe(403);

  expect((await request(app).post('/api/tutorials/seed')).status).toBe(401);

  const owner = await agentFor('owner', org.id);
  const res = await owner.agent.post('/api/tutorials/seed');
  expect(res.status).toBe(200);
  expect(res.body.created.length).toBe(registry.MODULES.length);

  const { rows } = await db.pool.query(
    `SELECT COUNT(*)::int AS n FROM audit_logs WHERE action = 'walkthroughs.seeded'`);
  expect(rows[0].n).toBe(1);
});

test('one organisation never sees another organisation catalogue', async () => {
  const other = await seedOrganisation();
  await catalogue.seedBuiltIns(other.id, null);
  await db.pool.query(
    `UPDATE walkthrough_module_versions v SET title = 'Other org only'
       FROM walkthrough_modules m
      WHERE v.module_id = m.id AND m.organisation_id = $1 AND m.key = 'portal-getting-started'`,
    [other.id]);
  catalogue.invalidate();

  const { agent } = await agentFor('owner', org.id);
  const res = await agent.get('/api/tutorials/catalogue');
  expect(res.body.modules.some((m) => m.title === 'Other org only')).toBe(false);
});
