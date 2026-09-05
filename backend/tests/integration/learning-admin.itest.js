'use strict';

/**
 * Assign Learning administration — integration tests for the three additions
 * on top of the owner workspace: the explicit Publish control, the bulk
 * pairs assignment with review-backed reassign semantics, and optimistic
 * locking on workflow saves. Plus the onboarding-bridge completion contract,
 * protected here explicitly because it is an integration another feature
 * depends on.
 *
 * Real Express routes, real sessions, real SQL. Lives in its own file so the
 * suites owned by the workspace session (learning.itest.js) stay theirs.
 */

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');

// The item-complete route lazy-requires the onboarding bridge post-commit.
// Mocking it BEFORE learning-routes is required lets the contract be
// asserted without standing up the whole onboarding schema's fixtures.
jest.mock('../../onboarding-learning-bridge', () => ({
  onLearningAssignmentCompleted: jest.fn().mockResolvedValue(undefined),
}));
const bridge = require('../../onboarding-learning-bridge');

const { db, truncateAll, seedUser, seedOrganisation, closePool } = require('./helpers');

const PASSWORD = 'AdminPass1';

function buildApp() {
  const app = express();
  app.use(bodyParser.json());
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../learning-routes'));
  return app;
}

let app, org;

async function agentFor(role, orgId, overrides) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser(Object.assign({ password_hash: hash, role, organisation_id: orgId }, overrides || {}));
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user };
}

const CONTENT = {
  sections: [{
    title: 'Only section',
    items: [{ key: 'i-one', type: 'content', title: 'Read this', required: true }],
  }],
};

async function createWorkflow(owner, over) {
  const res = await owner.agent.post('/api/learning/workflows')
    .send(Object.assign({ title: 'Bulk WF', category: 'induction', content: CONTENT }, over || {}));
  expect(res.status).toBe(201);
  return res.body.workflow;
}

async function completeAll(emp, assignmentId) {
  const r = await emp.agent.post(`/api/learning/my/${assignmentId}/items/i-one/complete`).send({});
  expect(r.status).toBe(200);
  expect(r.body.assignment_completed).toBe(true);
}

beforeAll(() => { app = buildApp(); });
beforeEach(async () => {
  await truncateAll();
  org = await seedOrganisation();
  require('../../auth')._resetLoginRateLimit();
  bridge.onLearningAssignmentCompleted.mockClear();
});
afterAll(closePool);

// ═══ Publish ═════════════════════════════════════════════════════════════════

test('publish snapshots the draft without assigning; republish is an honest no-op', async () => {
  const owner = await agentFor('owner', org.id);
  const wf = await createWorkflow(owner);

  const first = await owner.agent.post(`/api/learning/workflows/${wf.id}/publish`);
  expect(first.status).toBe(200);
  expect(first.body).toEqual({ published: true, version: 1 });

  // Nothing was assigned by publishing.
  const { rows: [asg] } = await db.pool.query(`SELECT COUNT(*)::int AS n FROM learning_assignments`);
  expect(asg.n).toBe(0);

  // Unchanged draft → no new version, and the response says so.
  const again = await owner.agent.post(`/api/learning/workflows/${wf.id}/publish`);
  expect(again.body).toEqual({ published: false, version: 1 });
  const { rows: [vc] } = await db.pool.query(`SELECT COUNT(*)::int AS n FROM learning_workflow_versions`);
  expect(vc.n).toBe(1);

  // An edit then publish → version 2; assigning afterwards reuses it.
  await owner.agent.put(`/api/learning/workflows/${wf.id}`).send({ title: 'Bulk WF v2' });
  const v2 = await owner.agent.post(`/api/learning/workflows/${wf.id}/publish`);
  expect(v2.body).toEqual({ published: true, version: 2 });

  const emp = await agentFor('therapist', org.id);
  const assign = await owner.agent.post(`/api/learning/workflows/${wf.id}/assign`).send({ userIds: [emp.user.id] });
  expect(assign.body.version).toBe(2);

  // Audit trail carries the publish events.
  const { rows: audits } = await db.pool.query(
    `SELECT metadata FROM audit_logs WHERE action = 'learning.workflow_published' ORDER BY created_at`);
  expect(audits.map((a) => a.metadata.version)).toEqual([1, 2]);
});

test('publish refuses archived and empty workflows, and non-owners entirely', async () => {
  const owner = await agentFor('owner', org.id);
  const emptyWf = await createWorkflow(owner, { title: 'Empty', content: { sections: [] } });
  expect((await owner.agent.post(`/api/learning/workflows/${emptyWf.id}/publish`)).status).toBe(400);

  const wf = await createWorkflow(owner, { title: 'To archive' });
  await owner.agent.post(`/api/learning/workflows/${wf.id}/archive`);
  expect((await owner.agent.post(`/api/learning/workflows/${wf.id}/publish`)).status).toBe(409);

  const therapist = await agentFor('therapist', org.id);
  expect((await therapist.agent.post(`/api/learning/workflows/${wf.id}/publish`)).status).toBe(403);
});

// ═══ Bulk pairs assignment ═══════════════════════════════════════════════════

test('several learning items to several people in one call, versions pinned', async () => {
  const owner = await agentFor('owner', org.id);
  const wfA = await createWorkflow(owner, { title: 'WF A' });
  const wfB = await createWorkflow(owner, { title: 'WF B' });
  const e1 = await agentFor('therapist', org.id, { name: 'Emp One' });
  const e2 = await agentFor('admin', org.id, { name: 'Emp Two' });

  const res = await owner.agent.post('/api/learning/assign').send({
    pairs: [
      { workflowId: wfA.id, userId: e1.user.id },
      { workflowId: wfA.id, userId: e2.user.id },
      { workflowId: wfB.id, userId: e1.user.id },
      { workflowId: wfB.id, userId: e2.user.id },
    ],
    dueAt: '2026-09-15',
    note: 'Bulk note',
  });
  expect(res.status).toBe(201);
  expect(res.body.assigned).toHaveLength(4);
  expect(res.body.skipped).toHaveLength(0);
  expect(res.body.versions[wfA.id.toLowerCase()]).toBe(1);
  expect(res.body.versions[wfB.id.toLowerCase()]).toBe(1);

  // Both employees see both items with the shared metadata.
  const mine = await e1.agent.get('/api/learning/my');
  expect(mine.body.assignments).toHaveLength(2);
  mine.body.assignments.forEach((a) => {
    expect(a.owner_note).toBe('Bulk note');
    expect(a.version).toBe(1);
  });

  // One notification per assignment.
  const { rows: [notifs] } = await db.pool.query(
    `SELECT COUNT(*)::int AS n FROM user_notifications WHERE type LIKE 'learning_assigned_%'`);
  expect(notifs.n).toBe(4);
});

test('bulk skips: active duplicate, completed-without-reassign, ineligible people, bad workflows', async () => {
  const owner = await agentFor('owner', org.id);
  const wf = await createWorkflow(owner);
  const active = await agentFor('therapist', org.id, { name: 'Has Active' });
  const done = await agentFor('therapist', org.id, { name: 'Has Done' });
  const readOnly = await seedUser({ role: 'read_only', organisation_id: org.id, name: 'Read Only' });
  const inactive = await seedUser({ role: 'therapist', organisation_id: org.id, is_active: false });
  const fresh = await agentFor('therapist', org.id, { name: 'Fresh' });

  // Set up: one active assignment, one completed assignment.
  await owner.agent.post(`/api/learning/workflows/${wf.id}/assign`).send({ userIds: [active.user.id, done.user.id] });
  const doneAsg = (await done.agent.get('/api/learning/my')).body.assignments[0];
  await completeAll(done, doneAsg.id);

  const archived = await createWorkflow(owner, { title: 'Archived WF' });
  await owner.agent.post(`/api/learning/workflows/${archived.id}/archive`);

  const res = await owner.agent.post('/api/learning/assign').send({
    pairs: [
      { workflowId: wf.id, userId: active.user.id },              // active dup
      { workflowId: wf.id, userId: done.user.id },                // completed, no reassign
      { workflowId: wf.id, userId: readOnly.id },                 // read_only
      { workflowId: wf.id, userId: inactive.id },                 // inactive
      { workflowId: wf.id, userId: fresh.user.id },               // fine
      { workflowId: archived.id, userId: fresh.user.id },         // archived wf
    ],
  });
  expect(res.status).toBe(201);
  expect(res.body.assigned).toHaveLength(1);
  expect(res.body.assigned[0].user_name).toBe('Fresh');
  const reasons = {};
  res.body.skipped.forEach((s) => { reasons[`${s.userId}:${s.workflowId}`] = s.reason; });
  expect(reasons[`${active.user.id}:${wf.id}`]).toBe('already_active');
  expect(reasons[`${done.user.id}:${wf.id}`]).toBe('already_completed');
  expect(reasons[`${readOnly.id}:${wf.id}`]).toBe('read_only_account');
  expect(reasons[`${inactive.id}:${wf.id}`]).toBe('not_found');
  expect(reasons[`${fresh.user.id}:${archived.id}`]).toBe('workflow_archived');
});

test('reassign is explicit: the completed record survives and a fresh assignment appears', async () => {
  const owner = await agentFor('owner', org.id);
  const wf = await createWorkflow(owner);
  const emp = await agentFor('therapist', org.id);

  await owner.agent.post(`/api/learning/workflows/${wf.id}/assign`).send({ userIds: [emp.user.id] });
  const first = (await emp.agent.get('/api/learning/my')).body.assignments[0];
  await completeAll(emp, first.id);

  const res = await owner.agent.post('/api/learning/assign').send({
    pairs: [{ workflowId: wf.id, userId: emp.user.id, reassign: true }],
  });
  expect(res.body.assigned).toHaveLength(1);

  // Both records exist: the completed history untouched, the new one fresh.
  const mine = await emp.agent.get('/api/learning/my');
  expect(mine.body.assignments).toHaveLength(2);
  const statuses = mine.body.assignments.map((a) => a.status).sort();
  expect(statuses).toEqual(['assigned', 'completed']);
  const completed = mine.body.assignments.find((a) => a.status === 'completed');
  expect(completed.id).toBe(first.id);
  expect(completed.completed_at).toBeTruthy();
  expect(completed.progress_percent).toBe(100);
});

test('bulk assignment is owner-only and validates its shape', async () => {
  const owner = await agentFor('owner', org.id);
  const emp = await agentFor('therapist', org.id);
  const wf = await createWorkflow(owner);

  expect((await emp.agent.post('/api/learning/assign')
    .send({ pairs: [{ workflowId: wf.id, userId: emp.user.id }] })).status).toBe(403);

  for (const body of [
    {},
    { pairs: [] },
    { pairs: [{ workflowId: 'nope', userId: emp.user.id }] },
    { pairs: [{ workflowId: wf.id, userId: emp.user.id }], dueAt: 'not-a-date' },
  ]) {
    expect((await owner.agent.post('/api/learning/assign').send(body)).status).toBe(400);
  }
});

// ═══ Optimistic locking ══════════════════════════════════════════════════════

test('a stale save is refused with 409 instead of clobbering the newer edit', async () => {
  const owner = await agentFor('owner', org.id);
  const wf = await createWorkflow(owner);

  const loadedA = (await owner.agent.get(`/api/learning/workflows/${wf.id}`)).body.workflow;
  const loadedB = (await owner.agent.get(`/api/learning/workflows/${wf.id}`)).body.workflow;

  // Session A saves first — accepted, updated_at moves on.
  const saveA = await owner.agent.put(`/api/learning/workflows/${wf.id}`)
    .send({ title: 'Session A title', expectedUpdatedAt: loadedA.updated_at });
  expect(saveA.status).toBe(200);

  // Session B saves against the timestamp it loaded — refused, nothing changes.
  const saveB = await owner.agent.put(`/api/learning/workflows/${wf.id}`)
    .send({ title: 'Session B title', expectedUpdatedAt: loadedB.updated_at });
  expect(saveB.status).toBe(409);
  expect(saveB.body.error).toBe('stale_edit');
  const after = (await owner.agent.get(`/api/learning/workflows/${wf.id}`)).body.workflow;
  expect(after.title).toBe('Session A title');

  // Reloading and saving with the fresh timestamp succeeds.
  const saveB2 = await owner.agent.put(`/api/learning/workflows/${wf.id}`)
    .send({ title: 'Session B after reload', expectedUpdatedAt: after.updated_at });
  expect(saveB2.status).toBe(200);

  // Compatibility: a save without the token still works (and a garbage token is 400).
  expect((await owner.agent.put(`/api/learning/workflows/${wf.id}`).send({ title: 'No token' })).status).toBe(200);
  expect((await owner.agent.put(`/api/learning/workflows/${wf.id}`)
    .send({ title: 'x', expectedUpdatedAt: 'garbage' })).status).toBe(400);
});

// ═══ Onboarding bridge contract ══════════════════════════════════════════════

test('completing learning still calls the onboarding bridge with (assignmentId, userId)', async () => {
  const owner = await agentFor('owner', org.id);
  const wf = await createWorkflow(owner);
  const emp = await agentFor('therapist', org.id);
  await owner.agent.post(`/api/learning/workflows/${wf.id}/assign`).send({ userIds: [emp.user.id] });
  const asg = (await emp.agent.get('/api/learning/my')).body.assignments[0];

  await completeAll(emp, asg.id);

  expect(bridge.onLearningAssignmentCompleted).toHaveBeenCalledTimes(1);
  expect(bridge.onLearningAssignmentCompleted).toHaveBeenCalledWith(asg.id, emp.user.id);
});

test('a failing bridge never fails the employee completion', async () => {
  bridge.onLearningAssignmentCompleted.mockRejectedValueOnce(new Error('bridge down'));
  const owner = await agentFor('owner', org.id);
  const wf = await createWorkflow(owner);
  const emp = await agentFor('therapist', org.id);
  await owner.agent.post(`/api/learning/workflows/${wf.id}/assign`).send({ userIds: [emp.user.id] });
  const asg = (await emp.agent.get('/api/learning/my')).body.assignments[0];

  const r = await emp.agent.post(`/api/learning/my/${asg.id}/items/i-one/complete`).send({});
  expect(r.status).toBe(200);
  expect(r.body.assignment_completed).toBe(true);
});

// ═══ Staff rollups feed the review step ══════════════════════════════════════

test('staff reports completed_workflow_ids alongside active_workflow_ids', async () => {
  const owner = await agentFor('owner', org.id);
  const wfA = await createWorkflow(owner, { title: 'WF A' });
  const wfB = await createWorkflow(owner, { title: 'WF B' });
  const emp = await agentFor('therapist', org.id);

  await owner.agent.post('/api/learning/assign').send({
    pairs: [
      { workflowId: wfA.id, userId: emp.user.id },
      { workflowId: wfB.id, userId: emp.user.id },
    ],
  });
  const asgA = (await emp.agent.get('/api/learning/my')).body.assignments
    .find((a) => a.title === 'WF A');
  await completeAll(emp, asgA.id);

  const staff = await owner.agent.get('/api/learning/staff');
  const row = staff.body.staff.find((s) => s.id === emp.user.id);
  expect(row.completed_workflow_ids).toEqual([wfA.id]);
  expect(row.active_workflow_ids).toEqual([wfB.id]);
});

// ═══ Importing the practice's existing inductions ════════════════════════════

/** Seed a Resource Hub learning path with N real resources. */
async function seedPath(orgId, key, name, titles, opts = {}) {
  const { rows: [path] } = await db.pool.query(
    `INSERT INTO learning_paths (organisation_id, key, name, description, target_role)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [orgId, key, name, opts.description || null, opts.targetRole || 'therapist']);
  let i = 0;
  for (const entry of titles) {
    // A title alone keeps the old shape; [title, content_type] carries the
    // grouping the importer divides sections on.
    const t = Array.isArray(entry) ? entry[0] : entry;
    const contentType = Array.isArray(entry) ? entry[1] : null;
    const { rows: [r] } = await db.pool.query(
      `INSERT INTO resources (organisation_id, title, status, resource_type, content_type, slug, estimated_minutes)
       VALUES ($1,$2,'approved','guide',$3,$4,$5) RETURNING id`,
      [orgId, t, contentType, `${key}-${i}`, 10 + i]);
    await db.pool.query(
      `INSERT INTO learning_path_items (path_id, resource_id, sort_order, required)
       VALUES ($1,$2,$3,$4)`, [path.id, r.id, i, i !== 1]); // one optional item
    i += 1;
  }
  return path.id;
}

test('existing learning paths import as editable, assignable workflows', async () => {
  const owner = await agentFor('owner', org.id);
  await seedPath(org.id, 'new-ot-starter', 'New Starter — Occupational Therapist',
    ['Welcome to Opal', 'How we work', 'Privacy policy'], { description: 'The ordered essentials.' });
  await seedPath(org.id, 'rural-remote-starter', 'Rural and Remote Starter',
    ['Rural overview', 'Pre-trip checklist']);

  const res = await owner.agent.post('/api/learning/workflows/import');
  expect(res.status).toBe(200);
  const byTitle = Object.fromEntries(res.body.created.map((c) => [c.title, c]));
  expect(byTitle['New Starter — Occupational Therapist'].items).toBe(3);
  expect(byTitle['Rural and Remote Starter'].items).toBe(2);

  // The imported workflow is a normal, fully editable workflow.
  const wfId = byTitle['New Starter — Occupational Therapist'].id;
  const detail = await owner.agent.get(`/api/learning/workflows/${wfId}`);
  expect(detail.status).toBe(200);
  const items = detail.body.workflow.draft_content.sections[0].items;
  expect(items.map((i) => i.title)).toEqual(['Welcome to Opal', 'How we work', 'Privacy policy']);
  // Order, resource links and the path's own required flags all survive.
  items.forEach((i) => { expect(i.type).toBe('resource'); expect(i.resource_id).toBeTruthy(); });
  expect(items[1].required).toBe(false);
  // Rural naming picks the rural category rather than defaulting to induction.
  const rural = await owner.agent.get(`/api/learning/workflows/${byTitle['Rural and Remote Starter'].id}`);
  expect(rural.body.workflow.category).toBe('rural_remote');
});

test('a long path imports as several screens, in its original order', async () => {
  // This is the defect the step flow exists to prevent: eighteen modules
  // delivered as one section is the long scrolling page again, wearing the
  // new renderer.
  const owner = await agentFor('owner', org.id);
  await seedPath(org.id, 'long-ot-starter', 'New Starter — OT (long)', [
    ['Welcome', 'article'], ['How we work', 'article'], ['First day', 'article'],
    ['First week', 'article'], ['Who to ask', 'article'], ['Escalation', 'article'],
    ['Privacy policy', 'policy'], ['Documentation standard', 'policy'],
    ['AI module', 'learning_module'],
    ['Portal basics', 'tutorial'], ['Calendar', 'tutorial'], ['Bookings', 'tutorial'],
  ]);

  const created = (await owner.agent.post('/api/learning/workflows/import')).body.created
    .find((c) => c.title === 'New Starter — OT (long)');
  const detail = await owner.agent.get(`/api/learning/workflows/${created.id}`);
  const sections = detail.body.workflow.draft_content.sections;

  // More than one screen, none of them longer than a screen.
  expect(sections.length).toBeGreaterThan(1);
  sections.forEach((sec) => expect(sec.items.length).toBeLessThanOrEqual(6));
  // Divided at the boundaries the source data carries, not arbitrarily.
  expect(sections[0].title).toBe('Orientation');
  expect(sections.map((sec) => sec.title)).toContain('Policies and standards');
  // Every item survives, in exactly the order the path curated.
  expect(sections.flatMap((sec) => sec.items.map((i) => i.title))).toEqual([
    'Welcome', 'How we work', 'First day', 'First week', 'Who to ask', 'Escalation',
    'Privacy policy', 'Documentation standard', 'AI module',
    'Portal basics', 'Calendar', 'Bookings',
  ]);
  // Every section key is distinct, which is what progress maps by.
  const keys = sections.map((sec) => sec.key);
  expect(new Set(keys).size).toBe(keys.length);
});

test('the Owner can edit an imported induction and add steps to it', async () => {
  const owner = await agentFor('owner', org.id);
  await seedPath(org.id, 'admin-starter', 'New Starter — Admin', ['Portal basics', 'Privacy']);
  const imported = (await owner.agent.post('/api/learning/workflows/import')).body.created
    .find((c) => c.title === 'New Starter — Admin');

  const before = await owner.agent.get(`/api/learning/workflows/${imported.id}`);
  const content = before.body.workflow.draft_content;
  content.sections[0].items.push({ type: 'acknowledgement', title: 'Confirm the handbook',
    ack_statement: 'I have read the admin handbook.', required: true });
  content.sections.push({ title: 'Added by the Owner', items: [
    { type: 'content', title: 'Local office notes', body: 'Where the keys live.', required: true } ] });

  const saved = await owner.agent.put(`/api/learning/workflows/${imported.id}`)
    .send({ content, expectedUpdatedAt: before.body.workflow.updated_at });
  expect(saved.status).toBe(200);
  expect(saved.body.workflow.stats.items).toBe(4);
  expect(saved.body.workflow.stats.sections).toBe(2);

  // And it can then be assigned like anything else.
  const emp = await agentFor('therapist', org.id);
  const assign = await owner.agent.post('/api/learning/assign')
    .send({ pairs: [{ workflowId: imported.id, userId: emp.user.id }] });
  expect(assign.body.assigned).toHaveLength(1);
  const mine = await emp.agent.get('/api/learning/my');
  expect(mine.body.assignments[0].title).toBe('New Starter — Admin');
});

test('importing twice creates nothing the second time', async () => {
  const owner = await agentFor('owner', org.id);
  await seedPath(org.id, 'new-grad-ot', 'New Graduate — Clinical Foundations', ['Standards', 'Documentation']);

  const first = await owner.agent.post('/api/learning/workflows/import');
  expect(first.body.created.some((c) => c.title === 'New Graduate — Clinical Foundations')).toBe(true);

  const second = await owner.agent.post('/api/learning/workflows/import');
  expect(second.body.created.some((c) => c.title === 'New Graduate — Clinical Foundations')).toBe(false);
  expect(second.body.skipped.some((s) => s.title === 'New Graduate — Clinical Foundations'
    && s.reason === 'already_present')).toBe(true);

  const { rows } = await db.pool.query(
    `SELECT COUNT(*)::int AS n FROM learning_workflows WHERE title = 'New Graduate — Clinical Foundations'`);
  expect(rows[0].n).toBe(1);
});

test('an Owner edit is never overwritten by a later import', async () => {
  const owner = await agentFor('owner', org.id);
  await seedPath(org.id, 'new-ot-starter', 'New Starter — Occupational Therapist', ['Welcome to Opal']);
  const made = (await owner.agent.post('/api/learning/workflows/import')).body.created[0];

  await owner.agent.put(`/api/learning/workflows/${made.id}`).send({
    description: 'Rewritten by the practice owner.',
    content: { sections: [{ title: 'Owner section', items: [
      { key: 'i-own', type: 'content', title: 'Owner content', required: true } ] }] },
  });
  await owner.agent.post('/api/learning/workflows/import');

  const after = await owner.agent.get(`/api/learning/workflows/${made.id}`);
  expect(after.body.workflow.description).toBe('Rewritten by the practice owner.');
  expect(after.body.workflow.draft_content.sections[0].title).toBe('Owner section');
});

test('the portal induction imports as its own workflow', async () => {
  const owner = await agentFor('owner', org.id);
  const res = await owner.agent.post('/api/learning/workflows/import');
  const portal = res.body.created.find((c) => c.title === 'Opal Portal Induction');
  expect(portal).toBeTruthy();
  expect(portal.items).toBeGreaterThanOrEqual(9);

  const detail = await owner.agent.get(`/api/learning/workflows/${portal.id}`);
  const items = detail.body.workflow.draft_content.sections[0].items;
  // Without hub tutorial pages present these are tasks naming the walkthrough.
  expect(items.every((i) => i.type === 'task' || i.type === 'resource')).toBe(true);
  expect(items.map((i) => i.title)).toContain('Getting Started with the Opal Portal');
});

test('the Splose induction imports with launchable lessons and a formal close', async () => {
  const owner = await agentFor('owner', org.id);
  const res = await owner.agent.post('/api/learning/workflows/import');
  const splose = res.body.created.find((c) => c.title === 'Splose Induction');
  expect(splose).toBeTruthy();

  const detail = await owner.agent.get(`/api/learning/workflows/${splose.id}`);
  const sections = detail.body.workflow.draft_content.sections;
  const items = sections.flatMap((s) => s.items);

  // Eight walkthrough lessons, each a task carrying its registry key — the
  // player's launch tiles. Splose has no hub pages, so nothing is a resource.
  const tasks = items.filter((i) => i.type === 'task');
  expect(tasks).toHaveLength(8);
  tasks.forEach((t) => expect(t.walkthrough_key).toMatch(/^splose-/));
  expect(tasks.map((t) => t.walkthrough_key)).toContain('splose-daily-workflow');

  // The portal workflow stays portal-only — the Splose lessons never leak
  // into it (they would arrive as unlaunchable tasks with misleading text).
  const portal = res.body.created.find((c) => c.title === 'Opal Portal Induction');
  const pDetail = await owner.agent.get(`/api/learning/workflows/${portal.id}`);
  const pItems = pDetail.body.workflow.draft_content.sections.flatMap((s) => s.items);
  expect(pItems.some((i) => i.walkthrough_key || /^Splose/.test(i.title))).toBe(false);

  // The close the curriculum asks for: a server-scored knowledge check at
  // the 80% pass mark. No acknowledgement — the first-day checklist was
  // dropped; the walkthroughs already cover every line of it.
  const quiz = items.find((i) => i.type === 'quiz');
  expect(quiz.quiz.passThreshold).toBe(80);
  expect(quiz.quiz.questions).toHaveLength(10);
  expect(items.some((i) => i.type === 'acknowledgement')).toBe(false);

  // What a learner receives keeps the walkthrough key (the player needs it)
  // and never the answer key.
  const emp = await agentFor('therapist', org.id);
  const assign = await owner.agent.post('/api/learning/assign')
    .send({ pairs: [{ workflowId: splose.id, userId: emp.user.id }] });
  expect(assign.body.assigned).toHaveLength(1);
  const mine = await emp.agent.get('/api/learning/my');
  const my = mine.body.assignments.find((a) => a.title === 'Splose Induction');
  const view = await emp.agent.get(`/api/learning/my/${my.id}`);
  const empItems = view.body.content.sections.flatMap((s) => s.items);
  empItems.filter((i) => i.type === 'task')
    .forEach((t) => expect(t.walkthrough_key).toMatch(/^splose-/));
  const empQuiz = empItems.find((i) => i.type === 'quiz');
  empQuiz.quiz.questions.forEach((q) => expect(q.correctIndex).toBeUndefined());
});

test('a path whose resources are gone is reported, not silently dropped', async () => {
  const owner = await agentFor('owner', org.id);
  await db.pool.query(
    `INSERT INTO learning_paths (organisation_id, key, name) VALUES ($1,'empty-path','Empty Induction')`,
    [org.id]);
  const res = await owner.agent.post('/api/learning/workflows/import');
  expect(res.body.created.some((c) => c.title === 'Empty Induction')).toBe(false);
  expect(res.body.skipped.some((s) => s.title === 'Empty Induction' && s.reason === 'no_items')).toBe(true);
});

test('importing is owner-only', async () => {
  const therapist = await agentFor('therapist', org.id);
  expect((await therapist.agent.post('/api/learning/workflows/import')).status).toBe(403);
  const admin = await agentFor('admin', org.id);
  expect((await admin.agent.post('/api/learning/workflows/import')).status).toBe(403);
});

test('another organisation\'s paths are never imported', async () => {
  const otherOrg = await seedOrganisation('Other Org');
  await seedPath(otherOrg.id, 'foreign-path', 'Foreign Induction', ['Secret module']);
  const owner = await agentFor('owner', org.id);
  const res = await owner.agent.post('/api/learning/workflows/import');
  expect(res.body.created.some((c) => c.title === 'Foreign Induction')).toBe(false);
});

// ═══ Assignment status monitor ═══════════════════════════════════════════════

/**
 * The Owner-facing monitor behind Assign Learning's "Assignment status"
 * section. Filtering is the whole feature, so each filter is exercised against
 * real rows — and the overdue one is exercised against the case that actually
 * bites: an assignment finished AFTER its due date.
 */
describe('assignment status filters', () => {
  const list = (owner, qs) => owner.agent.get('/api/learning/assignments' + (qs ? '?' + qs : ''));
  const titles = (res) => res.body.assignments.map((a) => a.user_name).sort();

  async function scenario() {
    const owner = await agentFor('owner', org.id);
    const wf = await createWorkflow(owner, { title: 'Manual Handling' });

    const notStarted = await agentFor('therapist', org.id, { name: 'Not Started', email: 'ns@x.test' });
    const inProgress = await agentFor('therapist', org.id, { name: 'In Progress', email: 'ip@x.test' });
    const done = await agentFor('therapist', org.id, { name: 'All Done', email: 'ad@x.test' });
    const late = await agentFor('therapist', org.id, { name: 'Running Late', email: 'rl@x.test' });

    // Everyone is assigned with a due date already in the past, so "overdue"
    // can only be distinguishing on completion — not on the date.
    const past = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const asg = await owner.agent.post(`/api/learning/workflows/${wf.id}/assign`).send({
      userIds: [notStarted.user.id, inProgress.user.id, done.user.id, late.user.id],
      dueAt: past,
    });
    expect(asg.status).toBe(201);

    // In progress: started, nothing finished.
    const ipId = (await inProgress.agent.get('/api/learning/my')).body.assignments[0].id;
    expect((await inProgress.agent.post(`/api/learning/my/${ipId}/start`)).status).toBe(200);

    // Completed — both of these finished LATE, which is the interesting case.
    for (const emp of [done, late]) {
      const id = (await emp.agent.get('/api/learning/my')).body.assignments[0].id;
      await completeAll(emp, id);
    }
    return { owner, wf, notStarted, inProgress, done, late };
  }

  test('every assignment is listed with recipient, item, dates and status', async () => {
    const { owner } = await scenario();
    const res = await list(owner);
    expect(res.status).toBe(200);
    expect(res.body.assignments).toHaveLength(4);
    for (const a of res.body.assignments) {
      expect(typeof a.user_name).toBe('string');
      expect(a.title).toBe('Manual Handling');
      expect(a.assigned_at).toBeTruthy();
      expect(a.due_at).toBeTruthy();
      expect(['assigned', 'in_progress', 'completed']).toContain(a.status);
    }
  });

  test('not-started, in-progress and completed each return exactly their own', async () => {
    const { owner } = await scenario();
    expect(titles(await list(owner, 'status=assigned'))).toEqual(['Not Started']);
    expect(titles(await list(owner, 'status=in_progress'))).toEqual(['In Progress']);
    expect(titles(await list(owner, 'status=completed'))).toEqual(['All Done', 'Running Late']);
  });

  test('overdue means past due AND unfinished — a late completion is not overdue', async () => {
    const { owner } = await scenario();
    // All four are past their due date; only the two still open are overdue.
    const res = await list(owner, 'overdue=1');
    expect(titles(res)).toEqual(['In Progress', 'Not Started']);
    res.body.assignments.forEach((a) => {
      expect(a.overdue).toBe(true);
      expect(a.completed_at).toBeNull();
    });

    // And the serialised flag agrees with the filter on the rows it excluded —
    // the drift that would let the table say Overdue on a finished record.
    const all = await list(owner);
    all.body.assignments.filter((a) => a.status === 'completed')
      .forEach((a) => expect([a.user_name, a.overdue]).toEqual([a.user_name, false]));
  });

  test('a cancelled assignment is never overdue, however far past due', async () => {
    const { owner, notStarted } = await scenario();
    const id = (await list(owner, 'status=assigned')).body.assignments[0].id;
    expect((await owner.agent.post(`/api/learning/assignments/${id}/cancel`)).status).toBe(200);

    expect(titles(await list(owner, 'overdue=1'))).toEqual(['In Progress']);
    const cancelled = (await list(owner, 'status=cancelled')).body.assignments[0];
    expect([cancelled.user_id, cancelled.overdue]).toEqual([notStarted.user.id, false]);
  });

  test('search finds a person or a learning item; a miss returns nothing', async () => {
    const { owner } = await scenario();
    expect(titles(await list(owner, 'q=Running'))).toEqual(['Running Late']);
    expect(titles(await list(owner, 'q=rl@x.test'))).toEqual(['Running Late']);
    expect((await list(owner, 'q=Manual Handling')).body.assignments).toHaveLength(4);
    expect((await list(owner, 'q=nobody-by-that-name')).body.assignments).toEqual([]);
  });

  test('filters compose — one person, one status', async () => {
    const { owner, late } = await scenario();
    expect(titles(await list(owner, `userId=${late.user.id}&status=completed`))).toEqual(['Running Late']);
    expect((await list(owner, `userId=${late.user.id}&status=assigned`)).body.assignments).toEqual([]);
  });

  test('non-owners cannot read the monitor at all — no filter reaches the data', async () => {
    const { owner } = await scenario();
    for (const role of ['therapist', 'admin', 'read_only']) {
      const other = await agentFor(role, org.id, { email: `guard-${role}@x.test` });
      for (const qs of ['', 'status=completed', 'overdue=1', 'q=Running']) {
        const res = await other.agent.get('/api/learning/assignments' + (qs ? '?' + qs : ''));
        expect([role, qs, res.status]).toEqual([role, qs, 403]);
        expect(res.body.assignments).toBeUndefined();
      }
    }
    // The owner still gets through, so the guard is the role and not an outage.
    expect((await list(owner)).status).toBe(200);
  });

  test('another organisation’s assignments are invisible', async () => {
    await scenario();
    const otherOrg = await seedOrganisation('Other Practice');
    const intruder = await agentFor('owner', otherOrg.id, { email: 'other-owner@x.test' });
    expect((await list(intruder)).body.assignments).toEqual([]);
    expect((await list(intruder, 'overdue=1')).body.assignments).toEqual([]);
  });
});
