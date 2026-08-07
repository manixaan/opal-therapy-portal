'use strict';

/**
 * Snapshot Day integration tests — personal reminders + daily tasks.
 *
 * Pins the personal-scope model: every row is visible to its creator ONLY.
 * No role — owner included — can read or touch another user's items (404,
 * indistinguishable from "does not exist"). Reminder state machine 409s,
 * task reorder round-trip, validation, ids-only audit, and the read_only
 * choke point (GETs allowed, writes 403).
 */

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { db, truncateAll, seedUser, closePool } = require('./helpers');

const PASSWORD = 'SnapPass1';

function buildApp() {
  const app = express();
  app.use(bodyParser.json());
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../snapshot-routes'));
  return app;
}

async function agentFor(app, role, overrides = {}) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser({ password_hash: hash, role, ...overrides });
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user };
}

beforeEach(async () => { await truncateAll(); require('../../auth')._resetLoginRateLimit(); });
afterAll(closePool);

// ═══ Reminder lifecycle + state machine ══════════════════════════════════════

test('reminder lifecycle: create→edit→defer→complete→reopen→dismiss with 409s on bad transitions', async () => {
  const app = buildApp();
  const { agent } = await agentFor(app, 'therapist');

  const created = await agent.post('/api/snapshot/reminders').send({
    title: 'Call the equipment supplier', note: 'about the standing frame quote',
    dueAt: '2026-08-07T09:00:00+08:00', priority: 'high',
  });
  expect(created.status).toBe(201);
  const id = created.body.reminder.id;
  expect(created.body.reminder.state).toBe('upcoming');
  expect(created.body.reminder.priority).toBe('high');
  expect(created.body.reminder.title).toBe('Call the equipment supplier');

  // Edit while upcoming
  const edited = await agent.patch(`/api/snapshot/reminders/${id}`)
    .send({ title: 'Call the supplier before lunch', priority: 'normal' });
  expect(edited.status).toBe(200);
  expect(edited.body.reminder.title).toBe('Call the supplier before lunch');
  expect(edited.body.reminder.priority).toBe('normal');

  // Defer pushes due_at forward by exactly the requested minutes
  const before = new Date(edited.body.reminder.due_at).getTime();
  const deferred = await agent.post(`/api/snapshot/reminders/${id}/defer`).send({ minutes: 30 });
  expect(deferred.status).toBe(200);
  expect(new Date(deferred.body.reminder.due_at).getTime()).toBe(before + 30 * 60 * 1000);

  // Complete
  const done = await agent.post(`/api/snapshot/reminders/${id}/complete`);
  expect(done.status).toBe(200);
  expect(done.body.reminder.state).toBe('completed');
  expect(done.body.reminder.completed_at).toBeTruthy();

  // Defer a completed reminder → 409 invalid_state
  const badDefer = await agent.post(`/api/snapshot/reminders/${id}/defer`).send({ minutes: 15 });
  expect(badDefer.status).toBe(409);
  expect(badDefer.body.code).toBe('invalid_state');

  // Complete again / dismiss a completed one → 409
  expect((await agent.post(`/api/snapshot/reminders/${id}/complete`)).status).toBe(409);
  expect((await agent.post(`/api/snapshot/reminders/${id}/dismiss`)).status).toBe(409);

  // Reopen → upcoming with timestamps cleared
  const reopened = await agent.post(`/api/snapshot/reminders/${id}/reopen`);
  expect(reopened.status).toBe(200);
  expect(reopened.body.reminder.state).toBe('upcoming');
  expect(reopened.body.reminder.completed_at).toBeNull();
  expect(reopened.body.reminder.dismissed_at).toBeNull();

  // Reopen while already upcoming → 409
  expect((await agent.post(`/api/snapshot/reminders/${id}/reopen`)).status).toBe(409);

  // Dismiss
  const dismissed = await agent.post(`/api/snapshot/reminders/${id}/dismiss`);
  expect(dismissed.status).toBe(200);
  expect(dismissed.body.reminder.state).toBe('dismissed');
  expect(dismissed.body.reminder.dismissed_at).toBeTruthy();

  // Edit a dismissed reminder → 409 invalid_state
  const badEdit = await agent.patch(`/api/snapshot/reminders/${id}`).send({ title: 'sneak edit' });
  expect(badEdit.status).toBe(409);
  expect(badEdit.body.code).toBe('invalid_state');

  // List: due_at ASC, and from/to filters narrow the window
  await agent.post('/api/snapshot/reminders').send({ title: 'Earlier one', dueAt: '2026-08-06T01:00:00Z' });
  await agent.post('/api/snapshot/reminders').send({ title: 'Later one', dueAt: '2026-08-09T01:00:00Z' });
  const list = await agent.get('/api/snapshot/reminders');
  expect(list.status).toBe(200);
  expect(list.body.reminders).toHaveLength(3);
  expect(list.body.reminders.map((r) => r.title)[0]).toBe('Earlier one');
  const windowed = await agent.get('/api/snapshot/reminders?from=2026-08-08T00:00:00Z&to=2026-08-10T00:00:00Z');
  expect(windowed.body.reminders.map((r) => r.title)).toEqual(['Later one']);

  // Delete
  const del = await agent.delete(`/api/snapshot/reminders/${id}`);
  expect(del.status).toBe(200);
  expect(del.body.ok).toBe(true);
  expect((await agent.get(`/api/snapshot/reminders/${id}`)).status).toBe(404);
});

// ═══ Task lifecycle + reorder round-trip ═════════════════════════════════════

test('task lifecycle: create x3 → reorder → complete → reopen → delete with order verified', async () => {
  const app = buildApp();
  const { agent } = await agentFor(app, 'therapist');

  const t1 = (await agent.post('/api/snapshot/tasks').send({ title: 'Prep sensory bins' })).body.task;
  const t2 = (await agent.post('/api/snapshot/tasks').send({ title: 'Write session notes', note: 'two clients' })).body.task;
  const t3 = (await agent.post('/api/snapshot/tasks').send({ title: 'Order laminating pouches', dueTime: '2026-08-07T08:00:00Z' })).body.task;
  expect([t1.sort_order, t2.sort_order, t3.sort_order]).toEqual([0, 1, 2]);
  expect(t3.due_time).toBeTruthy();

  // Reorder: t3, t1, t2 — round-trips through the list
  const reorder = await agent.put('/api/snapshot/tasks/order').send({ ids: [t3.id, t1.id, t2.id] });
  expect(reorder.status).toBe(200);
  expect(reorder.body.ok).toBe(true);
  let list = await agent.get('/api/snapshot/tasks');
  expect(list.body.tasks.map((t) => t.id)).toEqual([t3.id, t1.id, t2.id]);
  expect(list.body.tasks.map((t) => t.sort_order)).toEqual([0, 1, 2]);

  // Complete t1 → drops below open tasks in the list
  const done = await agent.post(`/api/snapshot/tasks/${t1.id}/complete`);
  expect(done.status).toBe(200);
  expect(done.body.task.completed).toBe(true);
  expect(done.body.task.completed_at).toBeTruthy();
  list = await agent.get('/api/snapshot/tasks');
  expect(list.body.tasks.map((t) => t.id)).toEqual([t3.id, t2.id, t1.id]);

  // Reopen t1
  const reopened = await agent.post(`/api/snapshot/tasks/${t1.id}/reopen`);
  expect(reopened.status).toBe(200);
  expect(reopened.body.task.completed).toBe(false);
  expect(reopened.body.task.completed_at).toBeNull();

  // Edit
  const edited = await agent.patch(`/api/snapshot/tasks/${t2.id}`).send({ note: 'three clients now' });
  expect(edited.status).toBe(200);
  expect(edited.body.task.note).toBe('three clients now');

  // Delete t2
  const del = await agent.delete(`/api/snapshot/tasks/${t2.id}`);
  expect(del.status).toBe(200);
  expect(del.body.ok).toBe(true);
  list = await agent.get('/api/snapshot/tasks');
  expect(list.body.tasks.map((t) => t.id)).toEqual([t3.id, t1.id]);
  expect((await agent.get(`/api/snapshot/tasks/${t2.id}`)).status).toBe(404);

  // A new task appends after the current max sort_order (t1 sits at 1 now)
  const t4 = (await agent.post('/api/snapshot/tasks').send({ title: 'Tidy the gym mats' })).body.task;
  expect(t4.sort_order).toBe(2);
});

// ═══ User isolation — personal scope for every role ══════════════════════════

test('strict per-user isolation: 404 across users on every verb; owner cannot read therapist items', async () => {
  const app = buildApp();
  const { agent: a } = await agentFor(app, 'therapist');
  const { agent: b } = await agentFor(app, 'therapist');
  const { agent: owner } = await agentFor(app, 'owner');

  const rem = (await a.post('/api/snapshot/reminders')
    .send({ title: 'A private reminder', dueAt: '2026-08-07T02:00:00Z' })).body.reminder;
  const task1 = (await a.post('/api/snapshot/tasks').send({ title: 'A private task' })).body.task;
  const task2 = (await a.post('/api/snapshot/tasks').send({ title: 'Another private task' })).body.task;

  // User B: 404 on A's reminder for every verb
  expect((await b.get(`/api/snapshot/reminders/${rem.id}`)).status).toBe(404);
  expect((await b.patch(`/api/snapshot/reminders/${rem.id}`).send({ title: 'hijack' })).status).toBe(404);
  expect((await b.post(`/api/snapshot/reminders/${rem.id}/complete`)).status).toBe(404);
  expect((await b.post(`/api/snapshot/reminders/${rem.id}/dismiss`)).status).toBe(404);
  expect((await b.post(`/api/snapshot/reminders/${rem.id}/defer`).send({ minutes: 10 })).status).toBe(404);
  expect((await b.delete(`/api/snapshot/reminders/${rem.id}`)).status).toBe(404);

  // User B: 404 on A's task for every verb
  expect((await b.get(`/api/snapshot/tasks/${task1.id}`)).status).toBe(404);
  expect((await b.patch(`/api/snapshot/tasks/${task1.id}`).send({ title: 'hijack' })).status).toBe(404);
  expect((await b.post(`/api/snapshot/tasks/${task1.id}/complete`)).status).toBe(404);
  expect((await b.post(`/api/snapshot/tasks/${task1.id}/reopen`)).status).toBe(404);
  expect((await b.delete(`/api/snapshot/tasks/${task1.id}`)).status).toBe(404);

  // B's lists exclude A's items entirely
  expect((await b.get('/api/snapshot/reminders')).body.reminders).toHaveLength(0);
  expect((await b.get('/api/snapshot/tasks')).body.tasks).toHaveLength(0);

  // B's reorder cannot move A's tasks — foreign ids are ignored
  expect((await b.put('/api/snapshot/tasks/order').send({ ids: [task2.id, task1.id] })).status).toBe(200);
  const aList = await a.get('/api/snapshot/tasks');
  expect(aList.body.tasks.map((t) => t.id)).toEqual([task1.id, task2.id]);

  // Owner is NOT above the personal scope — 404 and empty lists too
  expect((await owner.get(`/api/snapshot/reminders/${rem.id}`)).status).toBe(404);
  expect((await owner.patch(`/api/snapshot/reminders/${rem.id}`).send({ title: 'x' })).status).toBe(404);
  expect((await owner.get(`/api/snapshot/tasks/${task1.id}`)).status).toBe(404);
  expect((await owner.delete(`/api/snapshot/tasks/${task1.id}`)).status).toBe(404);
  expect((await owner.get('/api/snapshot/reminders')).body.reminders).toHaveLength(0);
  expect((await owner.get('/api/snapshot/tasks')).body.tasks).toHaveLength(0);

  // Unknown / non-uuid ids → 404; unauthenticated → 401
  expect((await a.get('/api/snapshot/reminders/00000000-0000-4000-8000-000000000000')).status).toBe(404);
  expect((await a.get('/api/snapshot/tasks/not-a-uuid')).status).toBe(404);
  expect((await request(app).get('/api/snapshot/reminders')).status).toBe(401);
  expect((await request(app).post('/api/snapshot/tasks').send({ title: 'x' })).status).toBe(401);
});

// ═══ Validation ══════════════════════════════════════════════════════════════

test('validation: missing title / missing dueAt / defer range / bad fields → 400', async () => {
  const app = buildApp();
  const { agent } = await agentFor(app, 'therapist');

  // Reminders
  expect((await agent.post('/api/snapshot/reminders').send({})).status).toBe(400);
  expect((await agent.post('/api/snapshot/reminders').send({ title: '   ', dueAt: '2026-08-07T02:00:00Z' })).status).toBe(400);
  expect((await agent.post('/api/snapshot/reminders').send({ title: 'No due date' })).status).toBe(400);
  expect((await agent.post('/api/snapshot/reminders').send({ title: 'Bad due', dueAt: 'not-a-date' })).status).toBe(400);
  expect((await agent.post('/api/snapshot/reminders').send({ title: 'x'.repeat(301), dueAt: '2026-08-07T02:00:00Z' })).status).toBe(400);
  expect((await agent.post('/api/snapshot/reminders').send({ title: 'Bad priority', dueAt: '2026-08-07T02:00:00Z', priority: 'urgent' })).status).toBe(400);

  // Tasks
  expect((await agent.post('/api/snapshot/tasks').send({})).status).toBe(400);
  expect((await agent.post('/api/snapshot/tasks').send({ title: '' })).status).toBe(400);
  expect((await agent.post('/api/snapshot/tasks').send({ title: 'Bad time', dueTime: 'noonish' })).status).toBe(400);
  expect((await agent.put('/api/snapshot/tasks/order').send({ ids: 'not-an-array' })).status).toBe(400);

  // Defer minutes out of range on a real, upcoming reminder
  const rem = (await agent.post('/api/snapshot/reminders')
    .send({ title: 'Defer target', dueAt: '2026-08-07T02:00:00Z' })).body.reminder;
  expect((await agent.post(`/api/snapshot/reminders/${rem.id}/defer`).send({ minutes: 4 })).status).toBe(400);
  expect((await agent.post(`/api/snapshot/reminders/${rem.id}/defer`).send({ minutes: 1441 })).status).toBe(400);
  expect((await agent.post(`/api/snapshot/reminders/${rem.id}/defer`).send({ minutes: 10.5 })).status).toBe(400);
  expect((await agent.post(`/api/snapshot/reminders/${rem.id}/defer`).send({})).status).toBe(400);
  // Boundaries are inclusive
  expect((await agent.post(`/api/snapshot/reminders/${rem.id}/defer`).send({ minutes: 5 })).status).toBe(200);
  expect((await agent.post(`/api/snapshot/reminders/${rem.id}/defer`).send({ minutes: 1440 })).status).toBe(200);
});

// ═══ Audit — create/delete only, ids-only metadata ═══════════════════════════

test('audit rows for reminder_created + task_deleted carry ids only — never titles or notes', async () => {
  const app = buildApp();
  const { agent } = await agentFor(app, 'therapist');

  const rem = (await agent.post('/api/snapshot/reminders')
    .send({ title: 'SecretReminderTitle', note: 'SecretReminderNote', dueAt: '2026-08-07T02:00:00Z' })).body.reminder;
  const task = (await agent.post('/api/snapshot/tasks')
    .send({ title: 'SecretTaskTitle', note: 'SecretTaskNote' })).body.task;
  expect((await agent.delete(`/api/snapshot/tasks/${task.id}`)).status).toBe(200);
  expect((await agent.delete(`/api/snapshot/reminders/${rem.id}`)).status).toBe(200);

  const audit = await db.pool.query(
    "SELECT action, target_id, metadata::text AS m FROM audit_logs WHERE action LIKE 'snapshot.%'");
  const actions = audit.rows.map((r) => r.action);
  expect(actions).toContain('snapshot.reminder_created');
  expect(actions).toContain('snapshot.task_created');
  expect(actions).toContain('snapshot.task_deleted');
  expect(actions).toContain('snapshot.reminder_deleted');

  const createdRow = audit.rows.find((r) => r.action === 'snapshot.reminder_created');
  expect(createdRow.target_id).toBe(rem.id);
  for (const r of audit.rows) {
    expect(r.m || '').not.toContain('Secret');
  }
});

// ═══ read_only — GETs pass, writes hit the global choke point ════════════════

test('read_only: GET lists 200, all writes 403 via the global choke point', async () => {
  const app = buildApp();
  const { agent: ro } = await agentFor(app, 'read_only');

  expect((await ro.get('/api/snapshot/reminders')).status).toBe(200);
  expect((await ro.get('/api/snapshot/tasks')).status).toBe(200);

  expect((await ro.post('/api/snapshot/reminders').send({ title: 'x', dueAt: '2026-08-07T02:00:00Z' })).status).toBe(403);
  expect((await ro.post('/api/snapshot/tasks').send({ title: 'x' })).status).toBe(403);
  expect((await ro.put('/api/snapshot/tasks/order').send({ ids: [] })).status).toBe(403);
  expect((await ro.delete('/api/snapshot/tasks/00000000-0000-4000-8000-000000000000')).status).toBe(403);
});
