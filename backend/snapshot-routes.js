'use strict';

/**
 * SNAPSHOT DAY — personal reminders + daily task list.
 *
 * STRICTLY user-scoped: every read and write filters WHERE user_id =
 * req.user.id. There is NO cross-user access for ANY role — owner and admin
 * included — because this is personal productivity data, not practice data.
 * Anything not owned by the caller answers 404, indistinguishable from
 * "does not exist".
 *
 * read_only: GETs are allowed; unsafe methods are already blocked by the
 * single choke point in permissions.requireAuth (no extra denies here).
 *
 * Audit: create/delete only ('snapshot.reminder_created',
 * 'snapshot.task_deleted', …) with ids-only metadata — never titles or
 * notes. camelCase bodies in, snake_case rows out. No external calls.
 */

const express = require('express');
const router = express.Router();
const db = require('./database');
const { pool } = require('./database');
const { requireAuth } = require('./permissions');
const log = require('./logger').createLogger('snapshot');

const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));
const orgOf = (req) => req.user?.organisation_id || null;
const isIso = (s) => typeof s === 'string' && s.trim() !== '' && !Number.isNaN(Date.parse(s));

router.use('/api/snapshot', requireAuth);

// Async-handler guard (same rationale as purchases-routes: an unhandled
// rejection in an Express 4 async handler would hang the request).
const safe = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  log.error('snapshot route error', { error: err, path: req.path });
  if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
});

/** Load the caller's own row, or null (→ 404). Table names are literals. */
async function loadOwn(req, table, id) {
  if (!isUuid(id)) return null;
  const { rows } = await pool.query(
    `SELECT * FROM ${table} WHERE id = $1 AND user_id = $2`, [id, req.user.id]);
  return rows[0] || null;
}

/** Audit create/delete only. Metadata carries the id alone — never content. */
async function audit(req, action, targetType, targetId) {
  await db.logAuditEvent({
    action, targetType, targetId,
    actorUserId: req.user?.id, organisationId: orgOf(req), ipAddress: req.ip,
    metadata: { id: targetId },
  }).catch(() => {});
}

// ── Validation ───────────────────────────────────────────────────────────────

const PRIORITIES = ['low', 'normal', 'high'];

function validateTitleNote(b, { requireTitle }) {
  if (requireTitle && !(typeof b.title === 'string' && b.title.trim())) {
    return 'title is required';
  }
  if (b.title !== undefined && !(typeof b.title === 'string' && b.title.trim())) {
    return 'title must be a non-empty string';
  }
  if (b.title !== undefined && b.title.trim().length > 300) {
    return 'title must be 300 characters or fewer';
  }
  if (b.note !== undefined && b.note !== null && typeof b.note !== 'string') {
    return 'note must be a string';
  }
  return null;
}

function validateReminderFields(b, { requireTitle, requireDueAt }) {
  const base = validateTitleNote(b, { requireTitle });
  if (base) return base;
  if (requireDueAt && !isIso(b.dueAt)) {
    return 'dueAt (ISO timestamp) is required';
  }
  if (b.dueAt !== undefined && !isIso(b.dueAt)) {
    return 'dueAt must be a valid ISO timestamp';
  }
  if (b.priority !== undefined && !PRIORITIES.includes(b.priority)) {
    return "priority must be one of 'low', 'normal', 'high'";
  }
  return null;
}

function validateTaskFields(b, { requireTitle }) {
  const base = validateTitleNote(b, { requireTitle });
  if (base) return base;
  if (b.dueTime !== undefined && b.dueTime !== null && !isIso(b.dueTime)) {
    return 'dueTime must be a valid ISO timestamp or null';
  }
  return null;
}

// ═══ Reminders ═══════════════════════════════════════════════════════════════

// List — own only; optional from/to ISO filters on due_at.
router.get('/api/snapshot/reminders', safe(async (req, res) => {
  const params = [req.user.id];
  let where = 'user_id = $1';
  if (req.query.from !== undefined) {
    if (!isIso(req.query.from)) return res.status(400).json({ error: 'from must be a valid ISO timestamp' });
    params.push(req.query.from);
    where += ` AND due_at >= $${params.length}`;
  }
  if (req.query.to !== undefined) {
    if (!isIso(req.query.to)) return res.status(400).json({ error: 'to must be a valid ISO timestamp' });
    params.push(req.query.to);
    where += ` AND due_at <= $${params.length}`;
  }
  const { rows } = await pool.query(
    `SELECT * FROM snapshot_reminders WHERE ${where} ORDER BY due_at ASC LIMIT 200`, params);
  res.json({ reminders: rows });
}));

router.get('/api/snapshot/reminders/:id', safe(async (req, res) => {
  const row = await loadOwn(req, 'snapshot_reminders', req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({ reminder: row });
}));

// Create.
router.post('/api/snapshot/reminders', safe(async (req, res) => {
  const b = req.body || {};
  const invalid = validateReminderFields(b, { requireTitle: true, requireDueAt: true });
  if (invalid) return res.status(400).json({ error: invalid });
  if (b.linkedEventId !== undefined && b.linkedEventId !== null && !isUuid(b.linkedEventId)) {
    return res.status(400).json({ error: 'linkedEventId must be a UUID' });
  }
  if (b.linkedKind !== undefined && b.linkedKind !== null
      && !(typeof b.linkedKind === 'string' && b.linkedKind.length <= 30)) {
    return res.status(400).json({ error: 'linkedKind must be a string of 30 characters or fewer' });
  }
  const { rows } = await pool.query(
    `INSERT INTO snapshot_reminders
       (user_id, organisation_id, title, note, due_at, priority, linked_event_id, linked_kind)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [req.user.id, orgOf(req), b.title.trim(), b.note || null, b.dueAt,
     b.priority || 'normal', b.linkedEventId || null, b.linkedKind || null]);
  const reminder = rows[0];
  await audit(req, 'snapshot.reminder_created', 'snapshot_reminder', reminder.id);
  res.status(201).json({ reminder });
}));

// Edit — only while upcoming; completed/dismissed reminders are frozen.
router.patch('/api/snapshot/reminders/:id', safe(async (req, res) => {
  const row = await loadOwn(req, 'snapshot_reminders', req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.state !== 'upcoming') {
    return res.status(409).json({
      error: `Cannot edit a reminder in state '${row.state}'`, code: 'invalid_state',
    });
  }
  const b = req.body || {};
  const invalid = validateReminderFields(b, { requireTitle: false, requireDueAt: false });
  if (invalid) return res.status(400).json({ error: invalid });
  const sets = [];
  const params = [row.id, req.user.id];
  for (const [bodyKey, col] of [['title', 'title'], ['note', 'note'], ['dueAt', 'due_at'], ['priority', 'priority']]) {
    if (b[bodyKey] !== undefined) {
      params.push(bodyKey === 'title' ? b.title.trim() : b[bodyKey]);
      sets.push(`${col} = $${params.length}`);
    }
  }
  if (!sets.length) return res.status(400).json({ error: 'No editable fields supplied' });
  const { rows } = await pool.query(
    `UPDATE snapshot_reminders SET ${sets.join(', ')}, updated_at = NOW()
      WHERE id = $1 AND user_id = $2 RETURNING *`, params);
  res.json({ reminder: rows[0] });
}));

/**
 * Shared state transition. Loads own row (404), checks the from-state set
 * (409 invalid_state), applies atomically against the observed state.
 */
async function reminderTransition(req, res, { from, to, sets = {} }) {
  const row = await loadOwn(req, 'snapshot_reminders', req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!from.includes(row.state)) {
    return res.status(409).json({
      error: `Cannot move a reminder from '${row.state}' to '${to}'`, code: 'invalid_state',
    });
  }
  const params = [row.id, req.user.id, row.state, to];
  const setSql = ['state = $4', 'updated_at = NOW()'];
  for (const [col, value] of Object.entries(sets)) {
    params.push(value);
    setSql.push(`${col} = $${params.length}`);
  }
  const { rows } = await pool.query(
    `UPDATE snapshot_reminders SET ${setSql.join(', ')}
      WHERE id = $1 AND user_id = $2 AND state = $3 RETURNING *`, params);
  if (!rows.length) {
    return res.status(409).json({ error: 'Reminder changed concurrently — reload and retry', code: 'invalid_state' });
  }
  res.json({ ok: true, reminder: rows[0] });
}

router.post('/api/snapshot/reminders/:id/complete', safe(async (req, res) => reminderTransition(req, res, {
  from: ['upcoming'], to: 'completed', sets: { completed_at: new Date() },
})));

router.post('/api/snapshot/reminders/:id/dismiss', safe(async (req, res) => reminderTransition(req, res, {
  from: ['upcoming'], to: 'dismissed', sets: { dismissed_at: new Date() },
})));

router.post('/api/snapshot/reminders/:id/reopen', safe(async (req, res) => reminderTransition(req, res, {
  from: ['completed', 'dismissed'], to: 'upcoming', sets: { completed_at: null, dismissed_at: null },
})));

// Defer — push due_at forward; only meaningful while upcoming.
router.post('/api/snapshot/reminders/:id/defer', safe(async (req, res) => {
  const minutes = req.body?.minutes;
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 1440) {
    return res.status(400).json({ error: 'minutes must be an integer between 5 and 1440' });
  }
  const row = await loadOwn(req, 'snapshot_reminders', req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.state !== 'upcoming') {
    return res.status(409).json({
      error: `Cannot defer a reminder in state '${row.state}'`, code: 'invalid_state',
    });
  }
  const { rows } = await pool.query(
    `UPDATE snapshot_reminders
        SET due_at = due_at + make_interval(mins => $3), updated_at = NOW()
      WHERE id = $1 AND user_id = $2 AND state = 'upcoming' RETURNING *`,
    [row.id, req.user.id, minutes]);
  if (!rows.length) {
    return res.status(409).json({ error: 'Reminder changed concurrently — reload and retry', code: 'invalid_state' });
  }
  res.json({ ok: true, reminder: rows[0] });
}));

router.delete('/api/snapshot/reminders/:id', safe(async (req, res) => {
  const row = await loadOwn(req, 'snapshot_reminders', req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  await pool.query('DELETE FROM snapshot_reminders WHERE id = $1 AND user_id = $2', [row.id, req.user.id]);
  await audit(req, 'snapshot.reminder_deleted', 'snapshot_reminder', row.id);
  res.json({ ok: true });
}));

// ═══ Tasks ═══════════════════════════════════════════════════════════════════

// List — own only; open tasks first, then by manual order, then age.
router.get('/api/snapshot/tasks', safe(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM snapshot_tasks WHERE user_id = $1
      ORDER BY completed ASC, sort_order ASC, created_at ASC LIMIT 300`, [req.user.id]);
  res.json({ tasks: rows });
}));

// Create — appended at the end of the caller's list (max sort_order + 1).
router.post('/api/snapshot/tasks', safe(async (req, res) => {
  const b = req.body || {};
  const invalid = validateTaskFields(b, { requireTitle: true });
  if (invalid) return res.status(400).json({ error: invalid });
  const { rows } = await pool.query(
    `INSERT INTO snapshot_tasks (user_id, organisation_id, title, note, due_time, sort_order)
     VALUES ($1,$2,$3,$4,$5,
             (SELECT COALESCE(MAX(sort_order) + 1, 0) FROM snapshot_tasks WHERE user_id = $1))
     RETURNING *`,
    [req.user.id, orgOf(req), b.title.trim(), b.note || null, b.dueTime || null]);
  const task = rows[0];
  await audit(req, 'snapshot.task_created', 'snapshot_task', task.id);
  res.status(201).json({ task });
}));

// Reorder — sort_order by array position. Ids that are not the caller's own
// (or not UUIDs) are silently ignored: the caller can only reorder their list.
router.put('/api/snapshot/tasks/order', safe(async (req, res) => {
  const ids = req.body?.ids;
  if (!Array.isArray(ids) || ids.length > 300) {
    return res.status(400).json({ error: 'ids must be an array of up to 300 task ids' });
  }
  const valid = ids.filter(isUuid);
  if (valid.length) {
    await pool.query(
      `UPDATE snapshot_tasks t
          SET sort_order = v.ord - 1, updated_at = NOW()
         FROM (SELECT * FROM unnest($2::uuid[]) WITH ORDINALITY AS u(id, ord)) v
        WHERE t.id = v.id AND t.user_id = $1`,
      [req.user.id, valid]);
  }
  res.json({ ok: true });
}));

router.get('/api/snapshot/tasks/:id', safe(async (req, res) => {
  const row = await loadOwn(req, 'snapshot_tasks', req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({ task: row });
}));

router.patch('/api/snapshot/tasks/:id', safe(async (req, res) => {
  const row = await loadOwn(req, 'snapshot_tasks', req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  const invalid = validateTaskFields(b, { requireTitle: false });
  if (invalid) return res.status(400).json({ error: invalid });
  const sets = [];
  const params = [row.id, req.user.id];
  for (const [bodyKey, col] of [['title', 'title'], ['note', 'note'], ['dueTime', 'due_time']]) {
    if (b[bodyKey] !== undefined) {
      params.push(bodyKey === 'title' ? b.title.trim() : b[bodyKey]);
      sets.push(`${col} = $${params.length}`);
    }
  }
  if (!sets.length) return res.status(400).json({ error: 'No editable fields supplied' });
  const { rows } = await pool.query(
    `UPDATE snapshot_tasks SET ${sets.join(', ')}, updated_at = NOW()
      WHERE id = $1 AND user_id = $2 RETURNING *`, params);
  res.json({ task: rows[0] });
}));

/** Complete/reopen are idempotent toggles — no state machine for tasks. */
async function setTaskCompleted(req, res, completed) {
  const row = await loadOwn(req, 'snapshot_tasks', req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const { rows } = await pool.query(
    `UPDATE snapshot_tasks
        SET completed = $3, completed_at = $4, updated_at = NOW()
      WHERE id = $1 AND user_id = $2 RETURNING *`,
    [row.id, req.user.id, completed, completed ? new Date() : null]);
  res.json({ ok: true, task: rows[0] });
}

router.post('/api/snapshot/tasks/:id/complete', safe(async (req, res) => setTaskCompleted(req, res, true)));
router.post('/api/snapshot/tasks/:id/reopen', safe(async (req, res) => setTaskCompleted(req, res, false)));

router.delete('/api/snapshot/tasks/:id', safe(async (req, res) => {
  const row = await loadOwn(req, 'snapshot_tasks', req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  await pool.query('DELETE FROM snapshot_tasks WHERE id = $1 AND user_id = $2', [row.id, req.user.id]);
  await audit(req, 'snapshot.task_deleted', 'snapshot_task', row.id);
  res.json({ ok: true });
}));

module.exports = router;
