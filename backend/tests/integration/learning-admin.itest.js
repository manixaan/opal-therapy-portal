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
