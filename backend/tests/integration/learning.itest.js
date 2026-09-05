'use strict';

/**
 * Owner-controlled learning — full-lifecycle integration tests.
 * Real Express routes, real sessions, real SQL (migration 033).
 *
 * Focus: the Definition-of-Done path (owner creates → edits → assigns →
 * employee sees only theirs → works through items → completion recorded),
 * version pinning (master edits never rewrite an employee's assignment or
 * completed history), duplicate-active-assignment protection with legitimate
 * reassignment, quiz grading server-side (answers never leave the DB),
 * acknowledgements, archive semantics, cancellation, deliberate version
 * push, IDOR/cross-user/cross-org boundaries, and audit/notification rows.
 */

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { db, truncateAll, seedUser, seedOrganisation, closePool } = require('./helpers');

const PASSWORD = 'LearnPass1';

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

/** A small but complete workflow: content + acknowledgement + quiz. */
const CONTENT = {
  sections: [
    {
      title: 'Welcome',
      items: [
        { key: 'i-read', type: 'content', title: 'Welcome to Opal', body: 'Read me.', required: true, minutes: 5 },
        { key: 'i-opt', type: 'content', title: 'Optional extra', required: false },
      ],
    },
    {
      title: 'Compliance',
      items: [
        { key: 'i-ack', type: 'acknowledgement', title: 'Code of conduct', ack_statement: 'I agree to the code.', required: true },
        {
          key: 'i-quiz', type: 'quiz', title: 'Knowledge check', required: true,
          quiz: {
            passThreshold: 80,
            questions: [
              { question: 'Two plus two?', options: ['3', '4'], correctIndex: 1 },
              { question: 'Sky colour?', options: ['blue', 'plaid'], correctIndex: 0 },
            ],
          },
        },
      ],
    },
  ],
};

async function createWorkflow(owner, over) {
  const res = await owner.agent.post('/api/learning/workflows')
    .send(Object.assign({ title: 'New Graduate OT', category: 'induction', content: CONTENT }, over || {}));
  expect(res.status).toBe(201);
  return res.body.workflow;
}

async function assign(owner, wfId, userIds, extra) {
  const res = await owner.agent.post(`/api/learning/workflows/${wfId}/assign`)
    .send(Object.assign({ userIds }, extra || {}));
  expect(res.status).toBe(201);
  return res.body;
}

beforeAll(() => { app = buildApp(); });
beforeEach(async () => {
  await truncateAll();
  org = await seedOrganisation();
  require('../../auth')._resetLoginRateLimit();
});
afterAll(closePool);

// ═══ The Definition-of-Done lifecycle ════════════════════════════════════════

test('owner creates → assigns → employee completes → history is recorded', async () => {
  const owner = await agentFor('owner', org.id);
  const sarah = await agentFor('therapist', org.id, { name: 'Sarah Jones' });

  // Owner creates and refines the workflow.
  const wf = await createWorkflow(owner);
  expect(wf.current_version).toBe(0); // nothing published yet

  // Assigning publishes v1 automatically and pins it.
  const out = await assign(owner, wf.id, [sarah.user.id], { dueAt: '2026-08-30', note: 'Welcome aboard!' });
  expect(out.version).toBe(1);
  expect(out.assigned).toHaveLength(1);
  const asg = out.assigned[0];
  expect(asg.status).toBe('assigned');
  expect(asg.required_total).toBe(3); // i-read, i-ack, i-quiz (i-opt is optional)

  // The employee sees exactly one assignment with the owner's note.
  const mine = await sarah.agent.get('/api/learning/my');
  expect(mine.body.assignments).toHaveLength(1);
  expect(mine.body.assignments[0].owner_note).toBe('Welcome aboard!');
  expect(mine.body.assignments[0].title).toBe('New Graduate OT');

  // Opening it: full content, quiz answers stripped, no progress yet.
  const detail = await sarah.agent.get(`/api/learning/my/${asg.id}`);
  expect(detail.status).toBe(200);
  const quizItem = detail.body.content.sections[1].items.find((i) => i.type === 'quiz');
  quizItem.quiz.questions.forEach((q) => expect(q.correctIndex).toBeUndefined());

  // Start → in_progress.
  const started = await sarah.agent.post(`/api/learning/my/${asg.id}/start`);
  expect(started.body.assignment.status).toBe('in_progress');
  expect(started.body.assignment.started_at).toBeTruthy();

  // Content item → 33%. The response keeps the version-snapshot fields the
  // player header renders from (title/version/category).
  const r1 = await sarah.agent.post(`/api/learning/my/${asg.id}/items/i-read/complete`).send({});
  expect(r1.body.completed).toBe(true);
  expect(r1.body.assignment.progress_percent).toBe(33);
  expect(r1.body.assignment.title).toBe('New Graduate OT');
  expect(r1.body.assignment.version).toBe(1);
  expect(r1.body.assignment.category).toBe('induction');

  // Acknowledgement demands explicit confirmation.
  expect((await sarah.agent.post(`/api/learning/my/${asg.id}/items/i-ack/complete`).send({})).status).toBe(400);
  const r2 = await sarah.agent.post(`/api/learning/my/${asg.id}/items/i-ack/complete`).send({ acknowledged: true });
  expect(r2.body.assignment.progress_percent).toBe(66);

  // Quiz: failing leaves no progress row; passing completes the assignment.
  const fail = await sarah.agent.post(`/api/learning/my/${asg.id}/items/i-quiz/complete`).send({ answers: [0, 1] });
  expect(fail.status).toBe(200);
  expect(fail.body.completed).toBe(false);
  expect(fail.body.quiz.passed).toBe(false);

  const pass = await sarah.agent.post(`/api/learning/my/${asg.id}/items/i-quiz/complete`).send({ answers: [1, 0] });
  expect(pass.body.completed).toBe(true);
  expect(pass.body.quiz).toEqual(expect.objectContaining({ score: 2, total: 2, passed: true }));
  expect(pass.body.assignment_completed).toBe(true);
  expect(pass.body.assignment.status).toBe('completed');
  expect(pass.body.assignment.progress_percent).toBe(100);
  expect(pass.body.assignment.completed_at).toBeTruthy();

  // Owner sees the completion, item evidence included.
  const ownerView = await owner.agent.get(`/api/learning/assignments/${asg.id}`);
  expect(ownerView.body.assignment.status).toBe('completed');
  expect(ownerView.body.assignment.user_name).toBe('Sarah Jones');
  const quizRow = ownerView.body.sections[1].items.find((i) => i.key === 'i-quiz');
  expect(quizRow.evidence).toEqual(expect.objectContaining({ kind: 'quiz', score: 2, total: 2 }));
  const ackRow = ownerView.body.sections[1].items.find((i) => i.key === 'i-ack');
  expect(ackRow.evidence.kind).toBe('acknowledgement');

  // Audit trail recorded the load-bearing events.
  const { rows: audits } = await db.pool.query(
    `SELECT action FROM audit_logs ORDER BY created_at`);
  const actions = audits.map((a) => a.action);
  for (const expected of ['learning.workflow_created', 'learning.workflow_published',
    'learning.assigned', 'learning.assignment_started', 'learning.acknowledged',
    'learning.quiz_attempted', 'learning.completed']) {
    expect(actions).toContain(expected);
  }

  // The employee got an in-portal notification for the assignment.
  const { rows: notifs } = await db.pool.query(
    `SELECT * FROM user_notifications WHERE user_id = $1`, [sarah.user.id]);
  expect(notifs.some((n) => n.type === `learning_assigned_${asg.id}`)).toBe(true);
});

// ═══ Version pinning ═════════════════════════════════════════════════════════

test('editing the master never changes an existing assignment or its history', async () => {
  const owner = await agentFor('owner', org.id);
  const emp = await agentFor('therapist', org.id);

  const wf = await createWorkflow(owner);
  const out = await assign(owner, wf.id, [emp.user.id]);
  const asgId = out.assigned[0].id;

  // Employee completes everything on v1.
  await emp.agent.post(`/api/learning/my/${asgId}/items/i-read/complete`).send({});
  await emp.agent.post(`/api/learning/my/${asgId}/items/i-ack/complete`).send({ acknowledged: true });
  await emp.agent.post(`/api/learning/my/${asgId}/items/i-quiz/complete`).send({ answers: [1, 0] });

  // Owner substantially rewrites the master afterwards.
  const newContent = { sections: [{ title: 'Rewritten', items: [{ key: 'i-new', type: 'content', title: 'All new', required: true }] }] };
  const upd = await owner.agent.put(`/api/learning/workflows/${wf.id}`)
    .send({ title: 'New Graduate OT v2', content: newContent });
  expect(upd.status).toBe(200);

  // The employee's completed assignment still shows what was ACTUALLY completed.
  const view = await emp.agent.get(`/api/learning/my/${asgId}`);
  expect(view.body.assignment.status).toBe('completed');
  expect(view.body.assignment.title).toBe('New Graduate OT');       // v1 snapshot title
  expect(view.body.content.sections[0].items[0].key).toBe('i-read'); // v1 content
  expect(view.body.assignment.version).toBe(1);

  // A NEW assignment to someone else gets v2 with the new content.
  const emp2 = await agentFor('therapist', org.id);
  const out2 = await assign(owner, wf.id, [emp2.user.id]);
  expect(out2.version).toBe(2);
  const view2 = await emp2.agent.get(`/api/learning/my/${out2.assigned[0].id}`);
  expect(view2.body.assignment.title).toBe('New Graduate OT v2');
  expect(view2.body.content.sections[0].items[0].key).toBe('i-new');
});

test('assigning twice without changes reuses the same version (no snapshot spam)', async () => {
  const owner = await agentFor('owner', org.id);
  const a = await agentFor('therapist', org.id);
  const b = await agentFor('therapist', org.id);
  const wf = await createWorkflow(owner);
  expect((await assign(owner, wf.id, [a.user.id])).version).toBe(1);
  expect((await assign(owner, wf.id, [b.user.id])).version).toBe(1);
  const { rows } = await db.pool.query(`SELECT COUNT(*)::int AS n FROM learning_workflow_versions`);
  expect(rows[0].n).toBe(1);
});

test('owner can deliberately push the latest version; surviving progress is kept', async () => {
  const owner = await agentFor('owner', org.id);
  const emp = await agentFor('therapist', org.id);
  const wf = await createWorkflow(owner);
  const out = await assign(owner, wf.id, [emp.user.id]);
  const asgId = out.assigned[0].id;

  // Employee completes i-read, then the owner edits: keeps i-read, drops the
  // quiz, adds a new required item.
  await emp.agent.post(`/api/learning/my/${asgId}/items/i-read/complete`).send({});
  const v2content = {
    sections: [{
      title: 'Welcome',
      items: [
        { key: 'i-read', type: 'content', title: 'Welcome to Opal', required: true },
        { key: 'i-extra', type: 'content', title: 'New requirement', required: true },
      ],
    }],
  };
  await owner.agent.put(`/api/learning/workflows/${wf.id}`).send({ content: v2content });

  const push = await owner.agent.post(`/api/learning/assignments/${asgId}/push-latest`);
  expect(push.status).toBe(200);
  expect(push.body.assignment.version).toBe(2);
  expect(push.body.assignment.required_total).toBe(2);
  expect(push.body.assignment.required_done).toBe(1);   // i-read survived
  expect(push.body.assignment.progress_percent).toBe(50);

  // Pushing again without further edits is refused as already-latest.
  expect((await owner.agent.post(`/api/learning/assignments/${asgId}/push-latest`)).status).toBe(409);

  // Pushing to a NEVER-STARTED assignment must not fabricate employee
  // activity: status stays 'assigned', started_at stays null.
  const fresh = await agentFor('therapist', org.id);
  const outFresh = await assign(owner, wf.id, [fresh.user.id]);
  await owner.agent.put(`/api/learning/workflows/${wf.id}`).send({ title: 'Renamed for v3' });
  const pushedFresh = await owner.agent.post(`/api/learning/assignments/${outFresh.assigned[0].id}/push-latest`);
  expect(pushedFresh.status).toBe(200);
  expect(pushedFresh.body.assignment.status).toBe('assigned');
  expect(pushedFresh.body.assignment.started_at).toBeNull();

  // A push that satisfies the completion rule records completion + audit.
  const almost = await agentFor('therapist', org.id);
  const outAlmost = await assign(owner, wf.id, [almost.user.id]);
  await almost.agent.post(`/api/learning/my/${outAlmost.assigned[0].id}/items/i-read/complete`).send({});
  await owner.agent.put(`/api/learning/workflows/${wf.id}`).send({
    content: { sections: [{ title: 'Only', items: [{ key: 'i-read', type: 'content', title: 'Welcome to Opal', required: true }] }] },
  });
  const pushComplete = await owner.agent.post(`/api/learning/assignments/${outAlmost.assigned[0].id}/push-latest`);
  expect(pushComplete.body.assignment.status).toBe('completed');
  const { rows: pushAudits } = await db.pool.query(
    `SELECT action, metadata FROM audit_logs WHERE action = 'learning.completed'
      AND target_id = $1`, [outAlmost.assigned[0].id]);
  expect(pushAudits).toHaveLength(1);
  expect(pushAudits[0].metadata.viaVersionPush).toBe(true);

  // Completed assignments are never pushed.
  const emp2 = await agentFor('therapist', org.id);
  const out2 = await assign(owner, wf.id, [emp2.user.id]);
  await emp2.agent.post(`/api/learning/my/${out2.assigned[0].id}/items/i-read/complete`).send({});
  await emp2.agent.post(`/api/learning/my/${out2.assigned[0].id}/items/i-extra/complete`).send({});
  await owner.agent.put(`/api/learning/workflows/${wf.id}`).send({ title: 'Changed again' });
  const refused = await owner.agent.post(`/api/learning/assignments/${out2.assigned[0].id}/push-latest`);
  expect(refused.status).toBe(409);
});

// ═══ Duplicate protection and reassignment ═══════════════════════════════════

test('an active duplicate is skipped; reassignment after completion/cancellation works', async () => {
  const owner = await agentFor('owner', org.id);
  const emp = await agentFor('therapist', org.id);
  const wf = await createWorkflow(owner);

  const first = await assign(owner, wf.id, [emp.user.id]);
  const dup = await assign(owner, wf.id, [emp.user.id]);
  expect(dup.assigned).toHaveLength(0);
  expect(dup.skipped).toEqual([expect.objectContaining({ reason: 'already_active' })]);

  // Cancel → reassign works.
  await owner.agent.post(`/api/learning/assignments/${first.assigned[0].id}/cancel`);
  const again = await assign(owner, wf.id, [emp.user.id]);
  expect(again.assigned).toHaveLength(1);

  // Complete → reassign works too (annual refresher).
  const asg2 = again.assigned[0].id;
  await emp.agent.post(`/api/learning/my/${asg2}/items/i-read/complete`).send({});
  await emp.agent.post(`/api/learning/my/${asg2}/items/i-ack/complete`).send({ acknowledged: true });
  await emp.agent.post(`/api/learning/my/${asg2}/items/i-quiz/complete`).send({ answers: [1, 0] });
  const refresher = await assign(owner, wf.id, [emp.user.id]);
  expect(refresher.assigned).toHaveLength(1);

  // Both the completed and the new assignment are visible to the employee.
  const mine = await emp.agent.get('/api/learning/my');
  expect(mine.body.assignments).toHaveLength(2);
  const statuses = mine.body.assignments.map((a) => a.status).sort();
  expect(statuses).toEqual(['assigned', 'completed']);
});

// ═══ Cancellation ════════════════════════════════════════════════════════════

test('a cancelled assignment disappears for the employee but stays on record for the owner', async () => {
  const owner = await agentFor('owner', org.id);
  const emp = await agentFor('therapist', org.id);
  const wf = await createWorkflow(owner);
  const out = await assign(owner, wf.id, [emp.user.id]);
  const asgId = out.assigned[0].id;

  await emp.agent.post(`/api/learning/my/${asgId}/items/i-read/complete`).send({});
  const cancel = await owner.agent.post(`/api/learning/assignments/${asgId}/cancel`);
  expect(cancel.status).toBe(200);
  expect(cancel.body.assignment.status).toBe('cancelled');

  // Employee: gone from the list, 404 on direct access, writes refused.
  expect((await emp.agent.get('/api/learning/my')).body.assignments).toHaveLength(0);
  expect((await emp.agent.get(`/api/learning/my/${asgId}`)).status).toBe(404);
  expect((await emp.agent.post(`/api/learning/my/${asgId}/items/i-ack/complete`).send({ acknowledged: true })).status).toBe(404);

  // Owner: still on record with its progress at time of cancellation.
  const view = await owner.agent.get(`/api/learning/assignments/${asgId}`);
  expect(view.body.assignment.status).toBe('cancelled');
  expect(view.body.assignment.progress_percent).toBe(33);

  // A completed assignment cannot be cancelled (history is immutable).
  const out2 = await assign(owner, wf.id, [emp.user.id]);
  const asg2 = out2.assigned[0].id;
  await emp.agent.post(`/api/learning/my/${asg2}/items/i-read/complete`).send({});
  await emp.agent.post(`/api/learning/my/${asg2}/items/i-ack/complete`).send({ acknowledged: true });
  await emp.agent.post(`/api/learning/my/${asg2}/items/i-quiz/complete`).send({ answers: [1, 0] });
  expect((await owner.agent.post(`/api/learning/assignments/${asg2}/cancel`)).status).toBe(404);
});

// ═══ Archive semantics ═══════════════════════════════════════════════════════

test('archived workflows cannot be assigned or edited, but history stays readable', async () => {
  const owner = await agentFor('owner', org.id);
  const emp = await agentFor('therapist', org.id);
  const wf = await createWorkflow(owner);
  const out = await assign(owner, wf.id, [emp.user.id]);

  await owner.agent.post(`/api/learning/workflows/${wf.id}/archive`);
  expect((await owner.agent.post(`/api/learning/workflows/${wf.id}/assign`).send({ userIds: [emp.user.id] })).status).toBe(409);
  expect((await owner.agent.put(`/api/learning/workflows/${wf.id}`).send({ title: 'X' })).status).toBe(409);

  // Existing assignment keeps working for the employee.
  const r = await emp.agent.post(`/api/learning/my/${out.assigned[0].id}/items/i-read/complete`).send({});
  expect(r.status).toBe(200);

  // Archived workflows leave the default library list but not includeArchived.
  const defaultList = await owner.agent.get('/api/learning/workflows');
  expect(defaultList.body.workflows).toHaveLength(0);
  const withArchived = await owner.agent.get('/api/learning/workflows?includeArchived=1');
  expect(withArchived.body.workflows).toHaveLength(1);

  // Unarchive restores assignability.
  await owner.agent.post(`/api/learning/workflows/${wf.id}/unarchive`);
  const emp2 = await agentFor('therapist', org.id);
  expect((await assign(owner, wf.id, [emp2.user.id])).assigned).toHaveLength(1);
});

test('delete is refused once assignment history exists; drafts delete cleanly', async () => {
  const owner = await agentFor('owner', org.id);
  const emp = await agentFor('therapist', org.id);

  const draft = await createWorkflow(owner, { title: 'Unused draft' });
  expect((await owner.agent.delete(`/api/learning/workflows/${draft.id}`)).status).toBe(200);

  const used = await createWorkflow(owner, { title: 'Used' });
  await assign(owner, used.id, [emp.user.id]);
  expect((await owner.agent.delete(`/api/learning/workflows/${used.id}`)).status).toBe(409);
});

// ═══ Duplication ═════════════════════════════════════════════════════════════

test('duplicating creates an independent workflow with fresh item keys', async () => {
  const owner = await agentFor('owner', org.id);
  const wf = await createWorkflow(owner);
  const dup = await owner.agent.post(`/api/learning/workflows/${wf.id}/duplicate`);
  expect(dup.status).toBe(201);
  expect(dup.body.workflow.title).toBe('New Graduate OT (copy)');

  // Editing the copy leaves the original untouched.
  await owner.agent.put(`/api/learning/workflows/${dup.body.workflow.id}`).send({ title: 'Rural Starter' });
  const orig = await owner.agent.get(`/api/learning/workflows/${wf.id}`);
  expect(orig.body.workflow.title).toBe('New Graduate OT');

  // Fresh keys: no key from the original survives into the copy.
  const copy = await owner.agent.get(`/api/learning/workflows/${dup.body.workflow.id}`);
  const keysOf = (w) => w.draft_content.sections.flatMap((s) => s.items.map((i) => i.key));
  const overlap = keysOf(copy.body.workflow).filter((k) => keysOf(orig.body.workflow).includes(k));
  expect(overlap).toEqual([]);
});

// ═══ Security boundaries ═════════════════════════════════════════════════════

test('an employee cannot read or write another employee\'s assignment (404, not 403)', async () => {
  const owner = await agentFor('owner', org.id);
  const alice = await agentFor('therapist', org.id);
  const mallory = await agentFor('therapist', org.id);
  const wf = await createWorkflow(owner);
  const out = await assign(owner, wf.id, [alice.user.id]);
  const asgId = out.assigned[0].id;

  expect((await mallory.agent.get(`/api/learning/my/${asgId}`)).status).toBe(404);
  expect((await mallory.agent.post(`/api/learning/my/${asgId}/start`)).status).toBe(404);
  expect((await mallory.agent.post(`/api/learning/my/${asgId}/items/i-read/complete`).send({})).status).toBe(404);

  // And no progress row appeared from the attempts.
  const { rows } = await db.pool.query(`SELECT COUNT(*)::int AS n FROM learning_item_progress`);
  expect(rows[0].n).toBe(0);
});

test('inactive employees, strangers and read_only accounts cannot be assigned', async () => {
  const owner = await agentFor('owner', org.id);
  const inactive = await seedUser({ role: 'therapist', organisation_id: org.id, is_active: false });
  const otherOrg = await seedOrganisation('Other Org');
  const outsider = await seedUser({ role: 'therapist', organisation_id: otherOrg.id });
  const readOnly = await seedUser({ role: 'read_only', organisation_id: org.id });

  const wf = await createWorkflow(owner);
  const res = await owner.agent.post(`/api/learning/workflows/${wf.id}/assign`)
    .send({ userIds: [inactive.id, outsider.id, readOnly.id] });
  expect(res.status).toBe(201);
  expect(res.body.assigned).toHaveLength(0);
  const reasons = Object.fromEntries(res.body.skipped.map((s) => [s.userId, s.reason]));
  expect(reasons[inactive.id]).toBe('not_found');
  expect(reasons[outsider.id]).toBe('not_found');
  // read_only writes die at the global choke point, so the assignment could
  // never be started — refused with its own reason rather than masked.
  expect(reasons[readOnly.id]).toBe('read_only_account');
});

test('quiz attempts are throttled — the score is not an unlimited answer oracle', async () => {
  const owner = await agentFor('owner', org.id);
  const emp = await agentFor('therapist', org.id);
  const wf = await createWorkflow(owner);
  const out = await assign(owner, wf.id, [emp.user.id]);
  const asgId = out.assigned[0].id;

  let limited = null;
  for (let i = 0; i < 11; i++) {
    const r = await emp.agent.post(`/api/learning/my/${asgId}/items/i-quiz/complete`).send({ answers: [0, 1] });
    if (r.status === 429) { limited = { at: i + 1, body: r.body }; break; }
    expect(r.body.completed).toBe(false);
  }
  expect(limited).toBeTruthy();
  expect(limited.at).toBe(11); // ten attempts allowed, the eleventh refused
  expect(limited.body.error).toBe('rate_limited');
});

test('an owner of another organisation sees none of this org\'s learning', async () => {
  const owner = await agentFor('owner', org.id);
  const emp = await agentFor('therapist', org.id);
  const wf = await createWorkflow(owner);
  const out = await assign(owner, wf.id, [emp.user.id]);

  const otherOrg = await seedOrganisation('Other Org');
  const foreignOwner = await agentFor('owner', otherOrg.id);
  expect((await foreignOwner.agent.get('/api/learning/workflows')).body.workflows).toHaveLength(0);
  expect((await foreignOwner.agent.get('/api/learning/assignments')).body.assignments).toHaveLength(0);
  expect((await foreignOwner.agent.get(`/api/learning/workflows/${wf.id}`)).status).toBe(404);
  expect((await foreignOwner.agent.get(`/api/learning/assignments/${out.assigned[0].id}`)).status).toBe(404);
  expect((await foreignOwner.agent.post(`/api/learning/assignments/${out.assigned[0].id}/cancel`)).status).toBe(404);
  const staff = await foreignOwner.agent.get('/api/learning/staff');
  expect(staff.body.staff.map((s) => s.id)).not.toContain(emp.user.id);
});

test('employees cannot reach the owner console even for their own data', async () => {
  const owner = await agentFor('owner', org.id);
  const emp = await agentFor('therapist', org.id);
  const wf = await createWorkflow(owner);
  const out = await assign(owner, wf.id, [emp.user.id]);

  expect((await emp.agent.get('/api/learning/workflows')).status).toBe(403);
  expect((await emp.agent.get(`/api/learning/assignments/${out.assigned[0].id}`)).status).toBe(403);
  expect((await emp.agent.post('/api/learning/workflows').send({ title: 'Rogue' })).status).toBe(403);
  expect((await emp.agent.post(`/api/learning/workflows/${wf.id}/assign`).send({ userIds: [emp.user.id] })).status).toBe(403);
});

// ═══ Progress integrity ══════════════════════════════════════════════════════

test('re-completing an item is idempotent — counts never inflate', async () => {
  const owner = await agentFor('owner', org.id);
  const emp = await agentFor('therapist', org.id);
  const wf = await createWorkflow(owner);
  const out = await assign(owner, wf.id, [emp.user.id]);
  const asgId = out.assigned[0].id;

  for (let i = 0; i < 3; i++) {
    await emp.agent.post(`/api/learning/my/${asgId}/items/i-read/complete`).send({});
  }
  const { rows } = await db.pool.query(
    `SELECT COUNT(*)::int AS n FROM learning_item_progress WHERE assignment_id = $1`, [asgId]);
  expect(rows[0].n).toBe(1);
  const view = await emp.agent.get(`/api/learning/my/${asgId}`);
  expect(view.body.assignment.progress_percent).toBe(33);
});

test('unknown item keys 404 and optional items complete without counting', async () => {
  const owner = await agentFor('owner', org.id);
  const emp = await agentFor('therapist', org.id);
  const wf = await createWorkflow(owner);
  const out = await assign(owner, wf.id, [emp.user.id]);
  const asgId = out.assigned[0].id;

  expect((await emp.agent.post(`/api/learning/my/${asgId}/items/i-ghost/complete`).send({})).status).toBe(404);

  const r = await emp.agent.post(`/api/learning/my/${asgId}/items/i-opt/complete`).send({});
  expect(r.body.completed).toBe(true);
  expect(r.body.assignment.progress_percent).toBe(0); // optional — required count unchanged
});

test('writes to a completed assignment are refused (completion is immutable)', async () => {
  const owner = await agentFor('owner', org.id);
  const emp = await agentFor('therapist', org.id);
  const wf = await createWorkflow(owner);
  const out = await assign(owner, wf.id, [emp.user.id]);
  const asgId = out.assigned[0].id;

  await emp.agent.post(`/api/learning/my/${asgId}/items/i-read/complete`).send({});
  await emp.agent.post(`/api/learning/my/${asgId}/items/i-ack/complete`).send({ acknowledged: true });
  await emp.agent.post(`/api/learning/my/${asgId}/items/i-quiz/complete`).send({ answers: [1, 0] });

  const after = await emp.agent.post(`/api/learning/my/${asgId}/items/i-opt/complete`).send({});
  expect(after.status).toBe(409);

  // Completed assignments stay readable.
  expect((await emp.agent.get(`/api/learning/my/${asgId}`)).status).toBe(200);
});

// ═══ Owner monitoring ════════════════════════════════════════════════════════

test('the assignments monitor filters by status, workflow, employee and search', async () => {
  const owner = await agentFor('owner', org.id);
  const sarah = await agentFor('therapist', org.id, { name: 'Sarah Jones' });
  const alex = await agentFor('admin', org.id, { name: 'Alex Smith' });

  const wfA = await createWorkflow(owner, { title: 'New Graduate OT' });
  const wfB = await createWorkflow(owner, { title: 'Admin Starter' });
  const outA = await assign(owner, wfA.id, [sarah.user.id]);
  await assign(owner, wfB.id, [alex.user.id]);

  await sarah.agent.post(`/api/learning/my/${outA.assigned[0].id}/start`);

  const all = await owner.agent.get('/api/learning/assignments');
  expect(all.body.assignments).toHaveLength(2);

  const inProg = await owner.agent.get('/api/learning/assignments?status=in_progress');
  expect(inProg.body.assignments).toHaveLength(1);
  expect(inProg.body.assignments[0].user_name).toBe('Sarah Jones');

  const byWf = await owner.agent.get(`/api/learning/assignments?workflowId=${wfB.id}`);
  expect(byWf.body.assignments).toHaveLength(1);
  expect(byWf.body.assignments[0].title).toBe('Admin Starter');

  const byUser = await owner.agent.get(`/api/learning/assignments?userId=${sarah.user.id}`);
  expect(byUser.body.assignments).toHaveLength(1);

  const byQ = await owner.agent.get('/api/learning/assignments?q=alex');
  expect(byQ.body.assignments).toHaveLength(1);
  expect(byQ.body.assignments[0].user_name).toBe('Alex Smith');

  const staff = await owner.agent.get('/api/learning/staff');
  const sarahRow = staff.body.staff.find((s) => s.id === sarah.user.id);
  expect(sarahRow.active_assignments).toBe(1);
});

test('due dates surface overdue without mutating status', async () => {
  const owner = await agentFor('owner', org.id);
  const emp = await agentFor('therapist', org.id);
  const wf = await createWorkflow(owner);
  const out = await assign(owner, wf.id, [emp.user.id], { dueAt: '2020-01-01' });

  const mine = await emp.agent.get('/api/learning/my');
  expect(mine.body.assignments[0].overdue).toBe(true);
  expect(mine.body.assignments[0].status).toBe('assigned');

  const filtered = await owner.agent.get('/api/learning/assignments?overdue=1');
  expect(filtered.body.assignments).toHaveLength(1);
  expect(filtered.body.assignments[0].id).toBe(out.assigned[0].id);
});

// ═══ Preview ═════════════════════════════════════════════════════════════════

test('preview shows the draft without creating anything, answers stripped', async () => {
  const owner = await agentFor('owner', org.id);
  const wf = await createWorkflow(owner);

  const before = await db.pool.query(`SELECT COUNT(*)::int AS n FROM learning_workflow_versions`);
  const res = await owner.agent.get(`/api/learning/workflows/${wf.id}/preview`);
  expect(res.status).toBe(200);
  expect(res.body.preview).toBe(true);
  const quizItem = res.body.content.sections[1].items.find((i) => i.type === 'quiz');
  quizItem.quiz.questions.forEach((q) => expect(q.correctIndex).toBeUndefined());

  const after = await db.pool.query(`SELECT COUNT(*)::int AS n FROM learning_workflow_versions`);
  expect(after.rows[0].n).toBe(before.rows[0].n); // nothing published
  const asg = await db.pool.query(`SELECT COUNT(*)::int AS n FROM learning_assignments`);
  expect(asg.rows[0].n).toBe(0);                  // nothing assigned
});

// ═══ Resource completion bridge ═════════════════════════════════════════════

test('completing a resource item marks the hub resource complete (best-effort)', async () => {
  const owner = await agentFor('owner', org.id);
  const emp = await agentFor('therapist', org.id);

  const { rows: [resource] } = await db.pool.query(
    `INSERT INTO resources (organisation_id, title, status, resource_type)
     VALUES ($1, 'Privacy policy', 'approved', 'policy') RETURNING id`, [org.id]);

  const content = {
    sections: [{
      title: 'S',
      items: [{ key: 'i-res', type: 'resource', title: 'Read the policy', resource_id: resource.id, required: true }],
    }],
  };
  const wf = await createWorkflow(owner, { content });
  const out = await assign(owner, wf.id, [emp.user.id]);

  const r = await emp.agent.post(`/api/learning/my/${out.assigned[0].id}/items/i-res/complete`).send({});
  expect(r.body.assignment_completed).toBe(true);

  const { rows } = await db.pool.query(
    `SELECT * FROM user_learning_progress WHERE user_id = $1 AND resource_id = $2`,
    [emp.user.id, resource.id]);
  expect(rows).toHaveLength(1);
});

test('resource items carry the resource slug, org-scoped — learner detail and preview alike', async () => {
  // The player opens a resource item's interactive walkthrough straight from
  // the tile; the slug is how it finds the walkthrough. A resource outside the
  // caller's organisation must contribute nothing.
  const owner = await agentFor('owner', org.id);
  const emp = await agentFor('therapist', org.id);

  const { rows: [resource] } = await db.pool.query(
    `INSERT INTO resources (organisation_id, title, status, resource_type, slug)
     VALUES ($1, 'Getting started', 'approved', 'tutorial', 'portal-getting-started') RETURNING id`, [org.id]);
  const { rows: [foreignOrg] } = await db.pool.query(
    `INSERT INTO organisations (name) VALUES ('Elsewhere') RETURNING id`);
  const { rows: [foreign] } = await db.pool.query(
    `INSERT INTO resources (organisation_id, title, status, resource_type, slug)
     VALUES ($1, 'Foreign tutorial', 'approved', 'tutorial', 'portal-foreign') RETURNING id`, [foreignOrg.id]);

  const content = {
    sections: [{
      title: 'S',
      items: [
        { key: 'i-walk', type: 'resource', title: 'Walkthrough', resource_id: resource.id, required: true },
        { key: 'i-far', type: 'resource', title: 'Foreign', resource_id: foreign.id, required: false },
      ],
    }],
  };
  const wf = await createWorkflow(owner, { content });

  const prev = await owner.agent.get(`/api/learning/workflows/${wf.id}/preview`);
  expect(prev.status).toBe(200);
  const pItems = prev.body.content.sections[0].items;
  expect(pItems.find((i) => i.key === 'i-walk').resource_slug).toBe('portal-getting-started');
  expect(pItems.find((i) => i.key === 'i-far').resource_slug).toBeUndefined();

  const out = await assign(owner, wf.id, [emp.user.id]);
  const mine = await emp.agent.get(`/api/learning/my/${out.assigned[0].id}`);
  expect(mine.status).toBe(200);
  const mItems = mine.body.content.sections[0].items;
  expect(mItems.find((i) => i.key === 'i-walk').resource_slug).toBe('portal-getting-started');
  expect(mItems.find((i) => i.key === 'i-far').resource_slug).toBeUndefined();
});

// ═══ The assignment picker ═══════════════════════════════════════════════════
//
// GET /api/learning/staff is what the Owner's Assign dialog is built from, so
// what it returns IS what an Owner can assign to. Two things matter: everybody
// listed can actually do the work, and the Owner can see who already has it
// before they submit rather than being told afterwards.

test('the picker lists only people who could actually do the work', async () => {
  const owner = await agentFor('owner', org.id);
  const therapist = await seedUser({ role: 'therapist', organisation_id: org.id, name: 'Working Therapist' });
  const admin = await seedUser({ role: 'admin', organisation_id: org.id, name: 'Practice Admin' });
  const starter = await seedUser({ role: 'pre_employee', organisation_id: org.id, name: 'New Starter' });

  // Three ways an account can be unable to do it.
  const deactivated = await seedUser({ role: 'therapist', organisation_id: org.id, is_active: false });
  const suspended = await seedUser({ role: 'therapist', organisation_id: org.id, account_status: 'suspended' });
  const readOnly = await seedUser({ role: 'read_only', organisation_id: org.id });

  const otherOrg = await seedOrganisation('Other Org');
  const outsider = await seedUser({ role: 'therapist', organisation_id: otherOrg.id });

  const ids = (await owner.agent.get('/api/learning/staff')).body.staff.map((s) => s.id);

  expect(ids).toContain(therapist.id);
  expect(ids).toContain(admin.id);
  // A new starter part-way through onboarding is exactly who the induction is
  // for, and /api/learning/my is on their allowlist.
  expect(ids).toContain(starter.id);

  expect(ids).not.toContain(deactivated.id);
  // is_active is TRUE on this one — account_status is what login refuses on,
  // so filtering only the first would offer somebody who cannot sign in.
  expect(ids).not.toContain(suspended.id);
  // requireAuth blocks every write a read_only account would need to record
  // progress; the assign route refuses them, so listing them would be a trap.
  expect(ids).not.toContain(readOnly.id);
  expect(ids).not.toContain(outsider.id);
});

test('the picker carries the name, role and what each person already has', async () => {
  const owner = await agentFor('owner', org.id);
  const sarah = await agentFor('therapist', org.id, { name: 'Sarah Jones' });
  const tom = await agentFor('therapist', org.id, { name: 'Tom Ng' });

  const induction = await createWorkflow(owner, { title: 'Induction' });
  const manual = await createWorkflow(owner, { title: 'Manual Handling' });
  await assign(owner, induction.id, [sarah.user.id]);

  const staff = (await owner.agent.get('/api/learning/staff')).body.staff;
  const bySarah = staff.find((s) => s.id === sarah.user.id);
  const byTom = staff.find((s) => s.id === tom.user.id);

  // Everything the dialog renders for a row comes from here.
  expect(bySarah.name).toBe('Sarah Jones');
  expect(bySarah.role).toBe('therapist');
  expect(bySarah.email).toBeTruthy();

  // This is what lets the dialog mark "already assigned" BEFORE submitting,
  // instead of reporting it afterwards as a skipped row.
  expect(bySarah.active_workflow_ids).toContain(induction.id);
  expect(bySarah.active_workflow_ids).not.toContain(manual.id);
  expect(byTom.active_workflow_ids).toEqual([]);
});

test('learning finished is no longer "already has it" — it can be assigned again', async () => {
  const owner = await agentFor('owner', org.id);
  const sarah = await agentFor('therapist', org.id, { name: 'Sarah Jones' });
  const wf = await createWorkflow(owner);
  const out = await assign(owner, wf.id, [sarah.user.id]);

  await db.pool.query(
    "UPDATE learning_assignments SET status = 'completed', completed_at = NOW() WHERE id = $1",
    [out.assigned[0].id]);

  const staff = (await owner.agent.get('/api/learning/staff')).body.staff;
  const row = staff.find((s) => s.id === sarah.user.id);
  expect(row.active_workflow_ids).not.toContain(wf.id);
  expect(row.completed_assignments).toBe(1);
});

test('assigning to several people at once records who assigned it, and when', async () => {
  const owner = await agentFor('owner', org.id);
  const sarah = await agentFor('therapist', org.id, { name: 'Sarah Jones' });
  const tom = await agentFor('therapist', org.id, { name: 'Tom Ng' });
  const wf = await createWorkflow(owner);

  const before = new Date();
  const out = await assign(owner, wf.id, [sarah.user.id, tom.user.id]);
  expect(out.assigned).toHaveLength(2);
  expect(out.skipped).toHaveLength(0);

  const { rows } = await db.pool.query(
    'SELECT user_id, assigned_by, assigned_at FROM learning_assignments WHERE workflow_id = $1', [wf.id]);
  expect(rows).toHaveLength(2);
  for (const r of rows) {
    expect(r.assigned_by).toBe(owner.user.id);
    expect(new Date(r.assigned_at).getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
  }

  // And it lands on each person's own learning, which is the whole point.
  expect((await sarah.agent.get('/api/learning/my')).body.assignments).toHaveLength(1);
  expect((await tom.agent.get('/api/learning/my')).body.assignments).toHaveLength(1);
});

test('assigning the same thing twice adds nothing and loses nothing', async () => {
  const owner = await agentFor('owner', org.id);
  const sarah = await agentFor('therapist', org.id, { name: 'Sarah Jones' });
  const tom = await agentFor('therapist', org.id, { name: 'Tom Ng' });
  const wf = await createWorkflow(owner);

  await assign(owner, wf.id, [sarah.user.id]);
  // The Owner picks both — the dialog would have marked Sarah, but a stale
  // page, a second tab or a double submit must not create a second row.
  const again = await assign(owner, wf.id, [sarah.user.id, tom.user.id]);

  expect(again.assigned.map((a) => a.user_id)).toEqual([tom.user.id]);
  expect(again.skipped).toEqual([
    expect.objectContaining({ userId: sarah.user.id, reason: 'already_active' }),
  ]);

  const { rows } = await db.pool.query(
    'SELECT user_id FROM learning_assignments WHERE workflow_id = $1 AND user_id = $2', [wf.id, sarah.user.id]);
  expect(rows).toHaveLength(1);
  expect((await sarah.agent.get('/api/learning/my')).body.assignments).toHaveLength(1);
});

test('only an owner can open the picker or assign — hiding the button is not the control', async () => {
  const owner = await agentFor('owner', org.id);
  const wf = await createWorkflow(owner);
  const therapist = await agentFor('therapist', org.id);
  const admin = await agentFor('admin', org.id);
  const target = await seedUser({ role: 'therapist', organisation_id: org.id });

  for (const who of [therapist, admin]) {
    expect((await who.agent.get('/api/learning/staff')).status).toBe(403);
    expect((await who.agent.post(`/api/learning/workflows/${wf.id}/assign`)
      .send({ userIds: [target.id] })).status).toBe(403);
  }
  // Nothing was created by the refused calls.
  const { rows } = await db.pool.query('SELECT id FROM learning_assignments WHERE workflow_id = $1', [wf.id]);
  expect(rows).toHaveLength(0);

  // Signed out is refused too, not merely unrendered.
  expect((await request(app).get('/api/learning/staff')).status).toBe(401);
});

test('the library reports the duration the Owner authored, for the card to show', async () => {
  const owner = await agentFor('owner', org.id);
  await createWorkflow(owner);
  const wf = (await owner.agent.get('/api/learning/workflows')).body.workflows[0];
  // CONTENT records five minutes against one item and nothing against the rest.
  expect(wf.estimated_minutes).toBe(5);
  expect(wf.module_count).toBe(4);
});

test('the employee can restart a started induction: progress cleared, still theirs, still in progress', async () => {
  const owner = await agentFor('owner', org.id);
  const emp = await agentFor('therapist', org.id);
  const other = await agentFor('therapist', org.id, { name: 'Someone Else' });

  const wf = await createWorkflow(owner);
  const out = await assign(owner, wf.id, [emp.user.id]);
  const asgId = out.assigned[0].id;

  // Not started yet: restart is harmless and leaves it in progress.
  expect((await emp.agent.post(`/api/learning/my/${asgId}/restart`)).status).toBe(200);

  await emp.agent.post(`/api/learning/my/${asgId}/items/i-read/complete`).send({});
  await emp.agent.post(`/api/learning/my/${asgId}/items/i-ack/complete`).send({ acknowledged: true });
  const before = await emp.agent.get(`/api/learning/my/${asgId}`);
  expect(before.body.assignment.progress_percent).toBe(66);
  expect(Object.keys(before.body.completed_items)).toHaveLength(2);

  // Nobody else can restart it — it does not exist for them.
  expect((await other.agent.post(`/api/learning/my/${asgId}/restart`)).status).toBe(404);

  const r = await emp.agent.post(`/api/learning/my/${asgId}/restart`);
  expect(r.status).toBe(200);
  expect(r.body.assignment.status).toBe('in_progress');
  expect(r.body.assignment.progress_percent).toBe(0);
  expect(r.body.assignment.required_done).toBe(0);
  expect(r.body.assignment.required_total).toBe(3);
  expect(r.body.completed_items).toEqual({});
  expect(r.body.content.sections.length).toBeGreaterThan(0);

  const after = await emp.agent.get(`/api/learning/my/${asgId}`);
  expect(after.body.completed_items).toEqual({});
  expect(after.body.assignment.progress_percent).toBe(0);

  // Progress can be earned again from scratch.
  const again = await emp.agent.post(`/api/learning/my/${asgId}/items/i-read/complete`).send({});
  expect(again.body.assignment.progress_percent).toBe(33);

  // A completed induction is a record: restart is refused and nothing changes.
  await emp.agent.post(`/api/learning/my/${asgId}/items/i-ack/complete`).send({ acknowledged: true });
  await emp.agent.post(`/api/learning/my/${asgId}/items/i-quiz/complete`).send({ answers: [1, 0] });
  expect((await emp.agent.get(`/api/learning/my/${asgId}`)).body.assignment.status).toBe('completed');
  expect((await emp.agent.post(`/api/learning/my/${asgId}/restart`)).status).toBe(409);
  const kept = await emp.agent.get(`/api/learning/my/${asgId}`);
  expect(kept.body.assignment.status).toBe('completed');
  expect(Object.keys(kept.body.completed_items)).toHaveLength(3);

  // The Owner's record shows the restart.
  const log = await db.pool.query(`SELECT action FROM audit_logs WHERE action = 'learning.assignment_restarted'`);
  expect(log.rows.length).toBeGreaterThanOrEqual(1);
});
