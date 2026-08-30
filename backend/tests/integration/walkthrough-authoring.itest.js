'use strict';

/**
 * The walkthrough workshop — Owner authoring API (phase 2).
 *
 * The line this file holds: authoring writes to the DRAFT, and only publish
 * changes what a learner sees. Plus the guards that stop an author breaking
 * the induction — role widening, destructive clicks, renaming a live module,
 * deleting one people have taken — and the owner-only boundary on every route.
 */

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { db, truncateAll, seedUser, seedOrganisation, closePool } = require('./helpers');
const catalogue = require('../../walkthrough-catalogue');

const PASSWORD = 'ShopPass1';

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

const STEP = (over) => Object.assign(
  { type: 'callout', title: 'A note', body: 'Some words.' }, over);

async function createWalkthrough(agent, over) {
  const res = await agent.post('/api/walkthroughs').send(Object.assign({
    key: 'my-tour', title: 'My tour', roles: ['owner', 'therapist'],
    minutes: 4, steps: [STEP()],
  }, over));
  return res;
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

// ── The owner-only boundary ─────────────────────────────────────────────────

test('every authoring route is owner-only', async () => {
  const created = await createWalkthrough(owner.agent);
  const id = created.body.walkthrough.id;

  for (const role of ['therapist', 'admin', 'read_only']) {
    const { agent } = await agentFor(role, org.id);
    expect((await agent.get('/api/walkthroughs')).status).toBe(403);
    expect((await agent.get('/api/walkthroughs/anchors')).status).toBe(403);
    expect((await agent.get(`/api/walkthroughs/${id}`)).status).toBe(403);
    expect((await agent.post('/api/walkthroughs').send({ title: 'x', roles: ['owner'] })).status).toBe(403);
    expect((await agent.put(`/api/walkthroughs/${id}`).send({ title: 'x', roles: ['owner'] })).status).toBe(403);
    expect((await agent.post(`/api/walkthroughs/${id}/publish`)).status).toBe(403);
    expect((await agent.delete(`/api/walkthroughs/${id}`)).status).toBe(403);
  }
  expect((await request(app).get('/api/walkthroughs')).status).toBe(401);
});

test('one organisation cannot reach another organisation walkthrough', async () => {
  const created = await createWalkthrough(owner.agent);
  const id = created.body.walkthrough.id;

  const otherOrg = await seedOrganisation();
  const other = await agentFor('owner', otherOrg.id);
  expect((await other.agent.get(`/api/walkthroughs/${id}`)).status).toBe(404);
  expect((await other.agent.put(`/api/walkthroughs/${id}`).send({ title: 'Hijack', roles: ['owner'] })).status).toBe(404);
  expect((await other.agent.post(`/api/walkthroughs/${id}/publish`)).status).toBe(404);
  expect((await other.agent.delete(`/api/walkthroughs/${id}`)).status).toBe(404);
});

// ── Draft, then publish ─────────────────────────────────────────────────────

test('a new walkthrough is invisible to learners until it is published', async () => {
  const created = await createWalkthrough(owner.agent);
  expect(created.status).toBe(201);
  expect(created.body.walkthrough.current_version).toBe(0);

  const before = await owner.agent.get('/api/tutorials/catalogue');
  expect(before.body.modules.some((m) => m.key === 'my-tour')).toBe(false);

  const pub = await owner.agent.post(`/api/walkthroughs/${created.body.walkthrough.id}/publish`);
  expect(pub.status).toBe(200);
  expect(pub.body).toEqual({ published: true, version: 1 });

  const after = await owner.agent.get('/api/tutorials/catalogue');
  const mine = after.body.modules.find((m) => m.key === 'my-tour');
  expect(mine).toBeTruthy();
  expect(mine.steps).toHaveLength(1);
  expect(mine.version).toBe(1);
});

test('editing the draft of a published walkthrough leaves learners on v1', async () => {
  const created = await createWalkthrough(owner.agent);
  const id = created.body.walkthrough.id;
  await owner.agent.post(`/api/walkthroughs/${id}/publish`);

  const saved = await owner.agent.put(`/api/walkthroughs/${id}`).send({
    key: 'my-tour', title: 'My tour', roles: ['owner', 'therapist'], minutes: 4,
    steps: [STEP({ title: 'Rewritten' }), STEP({ title: 'And another' })],
  });
  expect(saved.status).toBe(200);
  expect(saved.body.walkthrough.has_unpublished_changes).toBe(true);

  const learner = await owner.agent.get('/api/tutorials/catalogue');
  const mine = learner.body.modules.find((m) => m.key === 'my-tour');
  expect(mine.version).toBe(1);
  expect(mine.steps).toHaveLength(1);
  expect(mine.steps[0].title).toBe('A note');

  const pub2 = await owner.agent.post(`/api/walkthroughs/${id}/publish`);
  expect(pub2.body).toEqual({ published: true, version: 2 });
  const after = await owner.agent.get('/api/tutorials/catalogue');
  expect(after.body.modules.find((m) => m.key === 'my-tour').steps).toHaveLength(2);
});

test('publishing an unchanged draft is a no-op, not a new version', async () => {
  const created = await createWalkthrough(owner.agent);
  const id = created.body.walkthrough.id;
  await owner.agent.post(`/api/walkthroughs/${id}/publish`);
  const again = await owner.agent.post(`/api/walkthroughs/${id}/publish`);
  expect(again.body).toEqual({ published: false, version: 1 });

  const { rows } = await db.pool.query(
    `SELECT COUNT(*)::int AS n FROM walkthrough_module_versions WHERE module_id = $1`, [id]);
  expect(rows[0].n).toBe(1);
});

test('an empty walkthrough cannot be published', async () => {
  const created = await createWalkthrough(owner.agent, { steps: [] });
  const res = await owner.agent.post(`/api/walkthroughs/${created.body.walkthrough.id}/publish`);
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/at least one step/);
});

// ── The authoring guards ────────────────────────────────────────────────────

test('a step cannot be gated to a role the walkthrough does not admit', async () => {
  const res = await createWalkthrough(owner.agent, {
    roles: ['therapist'], steps: [STEP({ roles: ['owner'] })],
  });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/does not admit/);
});

test('a step cannot make a learner click a destructive control', async () => {
  const res = await createWalkthrough(owner.agent, {
    steps: [{ type: 'action', title: 'Press it', body: 'Go on',
              target: 'settings-outlook-disconnect', advance: 'click' }],
  });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/destructive or externally visible/);
});

test('authored markup never survives the round trip', async () => {
  const created = await createWalkthrough(owner.agent, {
    steps: [STEP({ body: '<img src=x onerror=alert(1)>hello' })],
  });
  expect(created.status).toBe(201);
  const detail = await owner.agent.get(`/api/walkthroughs/${created.body.walkthrough.id}`);
  expect(detail.body.steps[0].body).toBe('hello');
});

test('a published walkthrough cannot be renamed', async () => {
  const created = await createWalkthrough(owner.agent);
  const id = created.body.walkthrough.id;
  await owner.agent.post(`/api/walkthroughs/${id}/publish`);

  const res = await owner.agent.put(`/api/walkthroughs/${id}`).send({
    key: 'renamed-tour', title: 'My tour', roles: ['owner'], steps: [STEP()],
  });
  expect(res.status).toBe(409);
  expect(res.body.error).toMatch(/cannot be renamed/);
});

test('a duplicate key is refused rather than shadowing an existing walkthrough', async () => {
  await createWalkthrough(owner.agent);
  const again = await createWalkthrough(owner.agent);
  expect(again.status).toBe(409);
});

// ── Deletion and archiving ──────────────────────────────────────────────────

test('an unpublished, untaken draft may be deleted', async () => {
  const created = await createWalkthrough(owner.agent);
  const res = await owner.agent.delete(`/api/walkthroughs/${created.body.walkthrough.id}`);
  expect(res.status).toBe(200);
  expect((await owner.agent.get('/api/walkthroughs')).body.walkthroughs).toHaveLength(0);
});

test('a published walkthrough archives instead of deleting', async () => {
  const created = await createWalkthrough(owner.agent);
  const id = created.body.walkthrough.id;
  await owner.agent.post(`/api/walkthroughs/${id}/publish`);

  const del = await owner.agent.delete(`/api/walkthroughs/${id}`);
  expect(del.status).toBe(409);

  const arch = await owner.agent.post(`/api/walkthroughs/${id}/archive`);
  expect(arch.status).toBe(200);
  // Archived leaves the learner catalogue immediately.
  const cat = await owner.agent.get('/api/tutorials/catalogue');
  expect(cat.body.modules.some((m) => m.key === 'my-tour')).toBe(false);
  // And is not editable while archived.
  expect((await owner.agent.put(`/api/walkthroughs/${id}`)
    .send({ title: 'x', roles: ['owner'], steps: [STEP()] })).status).toBe(409);

  await owner.agent.post(`/api/walkthroughs/${id}/unarchive`);
  expect((await owner.agent.get('/api/tutorials/catalogue'))
    .body.modules.some((m) => m.key === 'my-tour')).toBe(true);
});

test('a walkthrough staff have taken cannot be deleted', async () => {
  const created = await createWalkthrough(owner.agent);
  const id = created.body.walkthrough.id;
  await owner.agent.post(`/api/walkthroughs/${id}/publish`);
  await owner.agent.put('/api/tutorials/my-tour/progress').send({ version: 1, step: 0 });

  // Even with the publication rolled back to a draft state, the progress
  // rows alone must block deletion.
  await db.pool.query(`UPDATE walkthrough_modules SET current_version = 0 WHERE id = $1`, [id]);
  const res = await owner.agent.delete(`/api/walkthroughs/${id}`);
  expect(res.status).toBe(409);
  expect(res.body.error).toMatch(/progress against this walkthrough/);
});

test('duplicate copies the draft onto a fresh unpublished key', async () => {
  const created = await createWalkthrough(owner.agent);
  const res = await owner.agent.post(`/api/walkthroughs/${created.body.walkthrough.id}/duplicate`);
  expect(res.status).toBe(201);
  expect(res.body.walkthrough.key).not.toBe('my-tour');
  expect(res.body.walkthrough.current_version).toBe(0);
  expect(res.body.walkthrough.step_count).toBe(1);
});

// ── The shelf and the portal map ────────────────────────────────────────────

test('the shelf reports seeding state, learners and unpublished changes', async () => {
  const empty = await owner.agent.get('/api/walkthroughs');
  expect(empty.body.seeded).toBe(false);
  expect(empty.body.walkthroughs).toEqual([]);

  await owner.agent.post('/api/tutorials/seed');
  const shelf = await owner.agent.get('/api/walkthroughs');
  expect(shelf.body.seeded).toBe(true);
  expect(shelf.body.walkthroughs.length).toBeGreaterThanOrEqual(9);
  // A freshly seeded built-in is published and matches its snapshot.
  shelf.body.walkthroughs.forEach((w) => {
    expect(w.source).toBe('builtin');
    expect(w.has_unpublished_changes).toBe(false);
  });
});

test('the portal map lists groupable anchors, and flags fragile targets', async () => {
  const res = await owner.agent.get('/api/walkthroughs/anchors');
  expect(res.status).toBe(200);
  expect(res.body.anchors.length).toBeGreaterThan(20);
  const byTarget = Object.fromEntries(res.body.anchors.map((a) => [a.target, a]));
  expect(byTarget['cal-view-week']).toBeTruthy();
  expect(byTarget['cal-view-week'].group).toBe('Calendar');
  expect(byTarget['cal-view-week'].stability).toBe('anchor');

  const created = await createWalkthrough(owner.agent, {
    steps: [
      STEP({ type: 'highlight', target: 'cal-view-week' }),
      STEP({ type: 'highlight', target: '#stg-user-list' }),
      STEP({ type: 'highlight', target: '.some-class' }),
      STEP({ type: 'highlight', target: 'not-a-real-anchor' }),
    ],
  });
  const detail = await owner.agent.get(`/api/walkthroughs/${created.body.walkthrough.id}`);
  expect(detail.body.targets.map((t) => t.stability))
    .toEqual(['anchor', 'id', 'css', 'unknown']);
});

test('publishing is audited with the version it cut', async () => {
  const created = await createWalkthrough(owner.agent);
  await owner.agent.post(`/api/walkthroughs/${created.body.walkthrough.id}/publish`);
  const { rows } = await db.pool.query(
    `SELECT action, metadata FROM audit_logs WHERE action = 'walkthrough.published'`);
  expect(rows).toHaveLength(1);
  expect(rows[0].metadata.version).toBe(1);
  expect(rows[0].metadata.key).toBe('my-tour');
});

// ── The target report ───────────────────────────────────────────────────────

test('the report names every spotlight pointing at nothing, and the fragile ones', async () => {
  const created = await createWalkthrough(owner.agent, {
    steps: [
      STEP({ type: 'highlight', title: 'Fine', target: 'cal-view-week' }),
      STEP({ type: 'highlight', title: 'By id', target: '#stg-user-list' }),
      STEP({ type: 'highlight', title: 'Fragile', target: '.settings-nav-item' }),
      STEP({ type: 'highlight', title: 'Gone', target: 'renamed-last-year' }),
    ],
  });
  const res = await owner.agent.get('/api/walkthroughs/report');
  expect(res.status).toBe(200);
  expect(res.body.checkedCount).toBe(1);
  expect(res.body.broken).toBe(1);
  expect(res.body.fragile).toBe(1);

  const w = res.body.walkthroughs[0];
  expect(w.id).toBe(created.body.walkthrough.id);
  // A never-published walkthrough is checked as a draft, and says so.
  expect(w.checked).toBe('draft');
  // Anchors and ids are healthy and are not reported at all.
  expect(w.issues.map((i) => i.title)).toEqual(['Fragile', 'Gone']);
  expect(w.issues.map((i) => i.stability)).toEqual(['css', 'unknown']);
  expect(w.issues[1].index).toBe(3);
});

test('the report checks what staff actually see, not the draft', async () => {
  const created = await createWalkthrough(owner.agent, {
    steps: [STEP({ type: 'highlight', title: 'Fine', target: 'cal-view-week' })],
  });
  const id = created.body.walkthrough.id;
  await owner.agent.post(`/api/walkthroughs/${id}/publish`);

  // The draft breaks; the published version staff are taking is still fine.
  await owner.agent.put(`/api/walkthroughs/${id}`).send({
    key: 'my-tour', title: 'My tour', roles: ['owner', 'therapist'],
    steps: [STEP({ type: 'highlight', title: 'Broken now', target: 'gone-away' })],
  });

  const res = await owner.agent.get('/api/walkthroughs/report');
  expect(res.body.walkthroughs).toEqual([]);
  expect(res.body.broken).toBe(0);

  await owner.agent.post(`/api/walkthroughs/${id}/publish`);
  const after = await owner.agent.get('/api/walkthroughs/report');
  expect(after.body.broken).toBe(1);
  expect(after.body.walkthroughs[0].checked).toBe('published');
});

test('an archived walkthrough is not reported — nobody is being shown it', async () => {
  const created = await createWalkthrough(owner.agent, {
    steps: [STEP({ type: 'highlight', title: 'Gone', target: 'not-there' })],
  });
  expect((await owner.agent.get('/api/walkthroughs/report')).body.broken).toBe(1);
  await owner.agent.post(`/api/walkthroughs/${created.body.walkthrough.id}/archive`);
  expect((await owner.agent.get('/api/walkthroughs/report')).body.broken).toBe(0);
});

test('the report is owner-only', async () => {
  const { agent } = await agentFor('therapist', org.id);
  expect((await agent.get('/api/walkthroughs/report')).status).toBe(403);
  expect((await request(app).get('/api/walkthroughs/report')).status).toBe(401);
});
