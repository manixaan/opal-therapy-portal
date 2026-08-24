'use strict';

/**
 * LEARNING — Owner-controlled learning workflows, assignment and progress.
 *
 * The Owner maintains a master library of learning workflows (inductions,
 * refreshers, compliance modules …), assigns them to individual employees,
 * and monitors progress. Employees see only learning assigned to them and
 * work through it in the Resource Hub's My Learning view.
 *
 * Versioning: the Owner edits `draft_content` freely. The moment a workflow
 * is assigned (or a newer version deliberately pushed), the draft is
 * snapshotted into learning_workflow_versions if it differs from the last
 * snapshot, and the assignment pins that version id forever. Editing the
 * master afterwards never changes what an assigned employee sees or what a
 * completed record says they completed. There is no approval stage — the
 * Owner's decision to assign IS the release.
 *
 * RBAC: every /api/learning route requires a session. The admin surface
 * (workflow CRUD, assigning, org-wide monitoring) is OWNER-ONLY, matching
 * the 2026-08-06 decision that HR-style controls belong to the owner alone.
 * Employee routes live under /api/learning/my and are STRICTLY user-scoped:
 * every read and write filters WHERE user_id = req.user.id, and a foreign
 * or cancelled assignment answers 404 — indistinguishable from absent.
 * Quiz correct answers never leave the server (grading is server-side).
 *
 * Audit: workflow lifecycle + assignment lifecycle + acknowledgements and
 * quiz passes, ids-only metadata. Notifications: one per assignment (the
 * storeNotification 24h type-dedup is defeated by putting the assignment id
 * in the type). No external calls.
 */

const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const db = require('./database');
const { pool } = require('./database');
const { requireAuth, requireRole } = require('./permissions');
const log = require('./logger').createLogger('learning');
const lc = require('./learning-content');

const orgOf = (req) => req.user?.organisation_id || null;
const isUuid = lc.isUuid;

const str = (v, max) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

const safe = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  log.error('learning route error', { error: err, path: req.path });
  if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
});

router.use('/api/learning', requireAuth);
const ownerOnly = requireRole('owner');

async function audit(req, action, targetId, metadata) {
  await db.logAuditEvent({
    action,
    targetType: 'learning',
    targetId: targetId ? String(targetId) : null,
    actorUserId: req.user?.id,
    organisationId: orgOf(req),
    ipAddress: req.ip,
    metadata: metadata || {},
  }).catch(() => {});
}

/** Durable in-portal notification; lazy require avoids a circular dep. */
function notify(userId, payload) {
  return Promise.resolve()
    .then(() => require('./app-routes').storeNotification(userId, payload))
    .catch(() => {});
}

/**
 * The induction registry, or null where it cannot be loaded.
 *
 * It is a frontend file the backend require()s (the same contract
 * tutorial-routes.js relies on), so a packaging change that leaves it out
 * must degrade the import rather than 500 the whole request.
 */
function requireInductionRegistry() {
  try {
    const reg = require('../frontend/current/induction-modules.js');
    return (reg && typeof reg.modulesForRole === 'function') ? reg : null;
  } catch (e) {
    log.warn('induction registry unavailable for import', { error: e });
    return null;
  }
}

function parseDueAt(v) {
  if (v === undefined || v === null || v === '') return { ok: true, value: null };
  const d = new Date(v);
  if (isNaN(d.getTime())) return { ok: false };
  return { ok: true, value: d.toISOString() };
}

/**
 * Quiz attempt throttle (in-memory, per user+assignment+item — the house
 * pattern from support-routes). Failed attempts return the exact score, which
 * is honest feedback for a person but an answer oracle for a script: with
 * unlimited retries every correctIndex can be extracted in ≤ questions×options
 * submissions. Ten attempts per window is far beyond honest use and far below
 * what extraction needs.
 */
const QUIZ_ATTEMPT_LIMIT = 10;
const QUIZ_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const _quizAttempts = new Map();
function quizRateLimited(key) {
  const now = Date.now();
  for (const [k, v] of _quizAttempts) { if (v.resetAt <= now) _quizAttempts.delete(k); }
  let e = _quizAttempts.get(key);
  if (!e || e.resetAt <= now) { e = { count: 0, resetAt: now + QUIZ_ATTEMPT_WINDOW_MS }; _quizAttempts.set(key, e); }
  e.count += 1;
  return e.count > QUIZ_ATTEMPT_LIMIT;
}

// ── Serialisers ──────────────────────────────────────────────────────────────

function workflowRow(r) {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    category: r.category,
    status: r.status,
    current_version: r.current_version,
    created_at: r.created_at,
    updated_at: r.updated_at,
    archived_at: r.archived_at,
    module_count: r.module_count !== undefined ? Number(r.module_count) : undefined,
    // Summed from the items' own `minutes`, so it is the duration the Owner
    // actually authored rather than an estimate this layer invented.
    estimated_minutes: r.estimated_minutes !== undefined ? Number(r.estimated_minutes) : undefined,
    active_assignments: r.active_assignments !== undefined ? Number(r.active_assignments) : undefined,
    completed_assignments: r.completed_assignments !== undefined ? Number(r.completed_assignments) : undefined,
    has_unpublished_changes: r.has_unpublished_changes,
  };
}

function assignmentRow(r, { forEmployee = false } = {}) {
  const out = {
    id: r.id,
    workflow_id: r.workflow_id,
    workflow_version_id: r.workflow_version_id,
    version: r.version === undefined ? undefined : Number(r.version),
    title: r.title,             // version snapshot title — what was assigned
    category: r.category,
    status: r.status,
    assigned_at: r.assigned_at,
    due_at: r.due_at,
    mandatory: r.mandatory,
    priority: r.priority,
    owner_note: r.owner_note,
    started_at: r.started_at,
    completed_at: r.completed_at,
    last_activity_at: r.last_activity_at,
    progress_percent: r.progress_percent,
    required_done: r.required_done,
    required_total: r.required_total,
    // Derived, never stored: an assignment is overdue only while it is still
    // live and unfinished. Completed and cancelled records are never overdue
    // however far past their due date they sit — and this must stay in step
    // with the `overdue=1` SQL filter below, which selects on the same three
    // facts. Two definitions of overdue is the bug this line exists to avoid.
    overdue: !!(r.due_at && !r.completed_at &&
      (r.status === 'assigned' || r.status === 'in_progress') &&
      new Date(r.due_at).getTime() < Date.now()),
  };
  if (!forEmployee) {
    out.user_id = r.user_id;
    out.user_name = r.user_name;
    out.user_email = r.user_email;
    out.user_role = r.user_role;
    out.assigned_by = r.assigned_by;
    out.assigned_by_name = r.assigned_by_name;
    out.cancelled_at = r.cancelled_at;
  }
  return out;
}

// ── Shared loaders ───────────────────────────────────────────────────────────

/** Load one workflow the OWNER may manage, or null (→ 404). Inside a
 *  transaction the row is locked: concurrent assigns of the same workflow
 *  serialise on it, so ensurePublishedVersion can never compute the same
 *  next version twice (the UNIQUE constraint stays a backstop, not a 500). */
async function loadWorkflow(req, id, client) {
  if (!isUuid(id)) return null;
  const q = client || pool;
  const { rows } = await q.query(
    `SELECT * FROM learning_workflows
      WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2
      ${client ? 'FOR UPDATE' : ''}`,
    [id, orgOf(req)]);
  return rows[0] || null;
}

/**
 * Publish the draft as a new immutable version if it differs from the last
 * published snapshot (or nothing was ever published). Returns the version
 * row an assignment should pin. Runs inside the caller's transaction.
 */
async function ensurePublishedVersion(client, req, wf) {
  const { rows } = await client.query(
    `SELECT * FROM learning_workflow_versions
      WHERE workflow_id = $1 ORDER BY version DESC LIMIT 1`, [wf.id]);
  const latest = rows[0];
  const unchanged = latest &&
    latest.title === wf.title &&
    (latest.description || null) === (wf.description || null) &&
    (latest.category || null) === (wf.category || null) &&
    lc.equalContent(latest.content, wf.draft_content);
  if (unchanged) return latest;

  const nextVersion = (latest ? Number(latest.version) : 0) + 1;
  const ins = await client.query(
    `INSERT INTO learning_workflow_versions
       (workflow_id, version, title, description, category, content, published_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [wf.id, nextVersion, wf.title, wf.description, wf.category,
      JSON.stringify(wf.draft_content), req.user.id]);
  await client.query(
    `UPDATE learning_workflows SET current_version = $2, updated_at = NOW() WHERE id = $1`,
    [wf.id, nextVersion]);
  // No audit here: audit_logs writes on its own pool connection and would
  // survive a rollback of THIS transaction. Callers audit
  // 'learning.workflow_published' after commit (they detect a publish by
  // version.version > wf.current_version).
  return ins.rows[0];
}

/**
 * Recompute an assignment's denormalised progress from the item-progress
 * table against its pinned version content, transitioning status when the
 * completion rule is met. Runs inside the caller's transaction; the caller
 * must hold FOR UPDATE on the assignment row.
 *
 * `employeeAction` distinguishes the employee working (assigned →
 * in_progress, started_at/last_activity_at stamped) from an OWNER action
 * like push-latest, which must never fabricate employee activity on an
 * assignment they have not opened. Completion can result either way.
 */
async function recomputeProgress(client, assignment, content, { employeeAction = true } = {}) {
  const { rows } = await client.query(
    `SELECT item_key FROM learning_item_progress WHERE assignment_id = $1`,
    [assignment.id]);
  const prog = lc.progressFor(content, rows.map((r) => r.item_key));
  const nowComplete = prog.complete && assignment.status !== 'completed';
  const upd = await client.query(
    `UPDATE learning_assignments SET
       status           = CASE WHEN $2 THEN 'completed'
                               WHEN $6 AND status = 'assigned' THEN 'in_progress'
                               ELSE status END,
       started_at       = CASE WHEN $6 THEN COALESCE(started_at, NOW()) ELSE started_at END,
       completed_at     = CASE WHEN $2 THEN COALESCE(completed_at, NOW()) ELSE completed_at END,
       progress_percent = $3,
       required_done    = $4,
       required_total   = $5,
       last_activity_at = CASE WHEN $6 THEN NOW() ELSE last_activity_at END
     WHERE id = $1 RETURNING *`,
    [assignment.id, prog.complete, prog.percent, prog.countedDone, prog.countedTotal, employeeAction]);
  return { row: upd.rows[0], progress: prog, becameComplete: nowComplete };
}

// ═════════════════════════════════════════════════════════════════════════════
//  OWNER — workflow library
// ═════════════════════════════════════════════════════════════════════════════

router.get('/api/learning/workflows', ownerOnly, safe(async (req, res) => {
  const includeArchived = String(req.query.includeArchived || '') === '1';
  const { rows } = await pool.query(
    `SELECT w.*,
            (SELECT COUNT(*) FROM learning_assignments a
              WHERE a.workflow_id = w.id AND a.status IN ('assigned','in_progress')) AS active_assignments,
            (SELECT COUNT(*) FROM learning_assignments a
              WHERE a.workflow_id = w.id AND a.status = 'completed') AS completed_assignments,
            latest.content AS latest_content, latest.title AS latest_title,
            latest.description AS latest_description, latest.category AS latest_category
       FROM learning_workflows w
       LEFT JOIN LATERAL (
         SELECT v.title, v.description, v.category, v.content
           FROM learning_workflow_versions v
          WHERE v.workflow_id = w.id ORDER BY v.version DESC LIMIT 1
       ) latest ON TRUE
      WHERE w.organisation_id IS NOT DISTINCT FROM $1
        ${includeArchived ? '' : `AND w.status = 'active'`}
      ORDER BY w.status = 'active' DESC, w.updated_at DESC`,
    [orgOf(req)]);
  res.json({
    workflows: rows.map((r) => {
      const stats = lc.contentStats(r.draft_content);
      // Same four-field comparison as ensurePublishedVersion and the detail
      // route — the list must agree with what assigning would actually do.
      const unchanged = Number(r.current_version) > 0 &&
        r.latest_title === r.title &&
        (r.latest_description || null) === (r.description || null) &&
        (r.latest_category || null) === (r.category || null) &&
        lc.equalContent(r.latest_content, r.draft_content);
      return workflowRow({
        ...r,
        module_count: stats.items,
        estimated_minutes: stats.minutes,
        has_unpublished_changes: !unchanged,
      });
    }),
    categories: lc.CATEGORIES,
  });
}));

router.post('/api/learning/workflows', ownerOnly, safe(async (req, res) => {
  const b = req.body || {};
  const title = str(b.title, lc.LIMITS.title);
  if (!title) return res.status(400).json({ error: 'title is required' });
  const description = str(b.description, 1000);
  const category = str(b.category, 60) || 'induction';
  const norm = lc.normaliseContent(b.content);
  if (!norm.ok) return res.status(400).json({ error: norm.error });

  const { rows } = await pool.query(
    `INSERT INTO learning_workflows (organisation_id, title, description, category, draft_content, created_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [orgOf(req), title, description, category, JSON.stringify(norm.content), req.user.id]);
  await audit(req, 'learning.workflow_created', rows[0].id, { title });
  res.status(201).json({ workflow: workflowRow(rows[0]) });
}));

router.get('/api/learning/workflows/:id', ownerOnly, safe(async (req, res) => {
  const wf = await loadWorkflow(req, req.params.id);
  if (!wf) return res.status(404).json({ error: 'Not found' });
  const [versions, counts, latestFull] = await Promise.all([
    pool.query(
      `SELECT v.id, v.version, v.title, v.published_at, v.published_by, u.name AS published_by_name,
              (SELECT COUNT(*) FROM learning_assignments a WHERE a.workflow_version_id = v.id) AS assignment_count
         FROM learning_workflow_versions v
         LEFT JOIN users u ON u.id = v.published_by
        WHERE v.workflow_id = $1 ORDER BY v.version DESC`, [wf.id]),
    pool.query(
      `SELECT COUNT(*) FILTER (WHERE status IN ('assigned','in_progress')) AS active,
              COUNT(*) FILTER (WHERE status = 'completed') AS completed,
              COUNT(*) AS total
         FROM learning_assignments WHERE workflow_id = $1`, [wf.id]),
    pool.query(
      `SELECT title, description, category, content FROM learning_workflow_versions
        WHERE workflow_id = $1 ORDER BY version DESC LIMIT 1`, [wf.id]),
  ]);
  const latest = latestFull.rows[0] || null;
  const unchanged = latest && latest.title === wf.title &&
    (latest.description || null) === (wf.description || null) &&
    (latest.category || null) === (wf.category || null) &&
    lc.equalContent(latest.content, wf.draft_content);
  res.json({
    workflow: {
      ...workflowRow(wf),
      draft_content: wf.draft_content,
      has_unpublished_changes: !unchanged,
      stats: lc.contentStats(wf.draft_content),
    },
    versions: versions.rows.map((v) => ({
      id: v.id, version: Number(v.version), title: v.title,
      published_at: v.published_at, published_by_name: v.published_by_name,
      assignment_count: Number(v.assignment_count),
    })),
    assignment_counts: {
      active: Number(counts.rows[0].active),
      completed: Number(counts.rows[0].completed),
      total: Number(counts.rows[0].total),
    },
    categories: lc.CATEGORIES,
  });
}));

router.put('/api/learning/workflows/:id', ownerOnly, safe(async (req, res) => {
  const wf = await loadWorkflow(req, req.params.id);
  if (!wf) return res.status(404).json({ error: 'Not found' });
  if (wf.status === 'archived') {
    return res.status(409).json({ error: 'This workflow is archived — unarchive it to edit' });
  }
  const b = req.body || {};
  const title = b.title !== undefined ? str(b.title, lc.LIMITS.title) : wf.title;
  if (!title) return res.status(400).json({ error: 'title is required' });
  const description = b.description !== undefined ? str(b.description, 1000) : wf.description;
  const category = b.category !== undefined ? (str(b.category, 60) || 'other') : wf.category;

  let content = wf.draft_content;
  if (b.content !== undefined) {
    const norm = lc.normaliseContent(b.content);
    if (!norm.ok) return res.status(400).json({ error: norm.error });
    content = norm.content;
  }

  // Optimistic lock: the editor sends back the updated_at it loaded. A
  // mismatch means another session (or another tab) saved in between — refuse
  // with 409 rather than last-write-wins clobbering their content. Truncated
  // to milliseconds because Postgres stores microseconds while the JS Date the
  // editor round-trips holds milliseconds. Omitting the field skips the check
  // (compatibility with existing callers and tests).
  const params = [wf.id, title, description, category, JSON.stringify(content)];
  let guard = '';
  if (b.expectedUpdatedAt !== undefined) {
    const expected = new Date(b.expectedUpdatedAt);
    if (isNaN(expected.getTime())) {
      return res.status(400).json({ error: 'expectedUpdatedAt must be a valid timestamp' });
    }
    params.push(expected.toISOString());
    guard = ` AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $${params.length}::timestamptz)`;
  }

  const { rows } = await pool.query(
    `UPDATE learning_workflows
        SET title = $2, description = $3, category = $4, draft_content = $5, updated_at = NOW()
      WHERE id = $1${guard} RETURNING *`,
    params);
  if (!rows[0]) {
    // The workflow exists (loaded above) — the guard failed.
    return res.status(409).json({
      error: 'stale_edit',
      message: 'This workflow was changed in another session — reload it before saving.',
    });
  }
  await audit(req, 'learning.workflow_updated', wf.id, {});
  res.json({ workflow: { ...workflowRow(rows[0]), draft_content: rows[0].draft_content, stats: lc.contentStats(rows[0].draft_content) } });
}));

router.post('/api/learning/workflows/:id/duplicate', ownerOnly, safe(async (req, res) => {
  const wf = await loadWorkflow(req, req.params.id);
  if (!wf) return res.status(404).json({ error: 'Not found' });
  // Fresh item/section keys: the duplicate is its OWN workflow — sharing keys
  // with the original would be harmless today but confusing in exports.
  const norm = lc.normaliseContent({
    sections: (wf.draft_content.sections || []).map((s) => ({
      ...s, key: null, items: (s.items || []).map((it) => ({ ...it, key: null })),
    })),
  });
  const title = (wf.title + ' (copy)').slice(0, lc.LIMITS.title);
  const { rows } = await pool.query(
    `INSERT INTO learning_workflows (organisation_id, title, description, category, draft_content, created_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [orgOf(req), title, wf.description, wf.category, JSON.stringify(norm.content), req.user.id]);
  await audit(req, 'learning.workflow_duplicated', rows[0].id, { sourceWorkflowId: wf.id });
  res.status(201).json({ workflow: workflowRow(rows[0]) });
}));

router.post('/api/learning/workflows/:id/archive', ownerOnly, safe(async (req, res) => {
  const wf = await loadWorkflow(req, req.params.id);
  if (!wf) return res.status(404).json({ error: 'Not found' });
  const { rows } = await pool.query(
    `UPDATE learning_workflows SET status = 'archived', archived_at = NOW(), updated_at = NOW()
      WHERE id = $1 RETURNING *`, [wf.id]);
  await audit(req, 'learning.workflow_archived', wf.id, {});
  res.json({ workflow: workflowRow(rows[0]) });
}));

router.post('/api/learning/workflows/:id/unarchive', ownerOnly, safe(async (req, res) => {
  const wf = await loadWorkflow(req, req.params.id);
  if (!wf) return res.status(404).json({ error: 'Not found' });
  const { rows } = await pool.query(
    `UPDATE learning_workflows SET status = 'active', archived_at = NULL, updated_at = NOW()
      WHERE id = $1 RETURNING *`, [wf.id]);
  await audit(req, 'learning.workflow_unarchived', wf.id, {});
  res.json({ workflow: workflowRow(rows[0]) });
}));

router.delete('/api/learning/workflows/:id', ownerOnly, safe(async (req, res) => {
  const wf = await loadWorkflow(req, req.params.id);
  if (!wf) return res.status(404).json({ error: 'Not found' });
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM learning_assignments WHERE workflow_id = $1`, [wf.id]);
  if (rows[0].n > 0) {
    return res.status(409).json({
      error: 'This workflow has assignment history and cannot be deleted — archive it instead',
    });
  }
  await pool.query(`DELETE FROM learning_workflows WHERE id = $1`, [wf.id]);
  await audit(req, 'learning.workflow_deleted', wf.id, { title: wf.title });
  res.json({ deleted: true });
}));

/** Owner preview — the employee projection of the CURRENT DRAFT. Creates
 *  nothing and writes nothing. */
router.get('/api/learning/workflows/:id/preview', ownerOnly, safe(async (req, res) => {
  const wf = await loadWorkflow(req, req.params.id);
  if (!wf) return res.status(404).json({ error: 'Not found' });
  const stats = lc.contentStats(wf.draft_content);
  res.json({
    preview: true,
    workflow: { id: wf.id, title: wf.title, description: wf.description, category: wf.category },
    content: lc.serialiseForEmployee(wf.draft_content),
    stats,
  });
}));

/**
 * Import the practice's EXISTING inductions into the assignable library.
 *
 * Two bodies of induction content predate this feature and are not
 * assignable on their own:
 *
 *   • Resource Hub learning paths (migration 011) — curated, ordered lists of
 *     real hub resources ("New Starter — Occupational Therapist" and friends).
 *     They render inside an employee's My Learning but an Owner cannot assign
 *     one to a named person, set a due date, or edit its steps.
 *   • The interactive portal induction (migration 032) — the walkthroughs of
 *     the portal itself, code-owned in induction-modules.js.
 *
 * This turns each of them into a learning_workflow the Owner fully owns:
 * assignable, versioned, and editable step by step. Path resources become
 * `resource` items (the hub page is the content, so nothing is duplicated);
 * portal walkthroughs become `task` items naming the walkthrough to run, or
 * `resource` items where the hub carries the matching tutorial page — the
 * module key IS that resource's slug, by the induction registry's own rule.
 *
 * Idempotent by title within the organisation: an import that has already
 * happened creates nothing, and an Owner's later edits are never overwritten.
 */
/**
 * Section titles for an imported learning path.
 *
 * A path is a flat ordered list; the induction is delivered one section per
 * screen. content_type is the grouping the source data already carries, so it
 * is what the importer divides on — and these are the names a reader would
 * use for those groups. Anything unmapped keeps its own type as a title, and
 * the Owner renames any of them inline while editing.
 */
const IMPORT_SECTION_LABELS = {
  article: 'Orientation',
  policy: 'Policies and standards',
  procedure: 'Policies and standards',
  learning_module: 'Learning modules',
  tutorial: 'Using the portal',
  ndis_guide: 'NDIS essentials',
  guide: 'Guides',
  form: 'Forms and templates',
  template: 'Forms and templates',
  checklist: 'Checklists',
  video: 'Watch and listen',
};

function importSectionLabel(contentType) {
  const key = String(contentType || '').trim().toLowerCase();
  if (IMPORT_SECTION_LABELS[key]) return IMPORT_SECTION_LABELS[key];
  if (!key) return 'Modules';
  return key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

router.post('/api/learning/workflows/import', ownerOnly, safe(async (req, res) => {
  const org = orgOf(req);
  const created = [];
  const skipped = [];

  const existing = await pool.query(
    `SELECT title FROM learning_workflows WHERE organisation_id IS NOT DISTINCT FROM $1`, [org]);
  const haveTitle = new Set(existing.rows.map((r) => String(r.title).trim().toLowerCase()));

  const insert = async (title, description, category, sections) => {
    if (haveTitle.has(title.trim().toLowerCase())) { skipped.push({ title, reason: 'already_present' }); return; }
    const norm = lc.normaliseContent({ sections });
    if (!norm.ok) { skipped.push({ title, reason: 'invalid_content' }); return; }
    if (!lc.contentStats(norm.content).items) { skipped.push({ title, reason: 'no_items' }); return; }
    const { rows } = await pool.query(
      `INSERT INTO learning_workflows (organisation_id, title, description, category, draft_content, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, title`,
      [org, title, description, category, JSON.stringify(norm.content), req.user.id]);
    haveTitle.add(title.trim().toLowerCase());
    created.push({ id: rows[0].id, title: rows[0].title, items: lc.contentStats(norm.content).items });
  };

  // ── Resource Hub learning paths ────────────────────────────────────────────
  const { rows: paths } = await pool.query(
    `SELECT id, key, name, description, target_role FROM learning_paths
      WHERE organisation_id IS NOT DISTINCT FROM $1 AND is_active = TRUE
      ORDER BY sort_order ASC, name ASC`, [org]);

  for (const p of paths) {
    const { rows: items } = await pool.query(
      `SELECT r.id, r.title, r.content_type, r.estimated_minutes, r.learning_minutes, i.required
         FROM learning_path_items i
         JOIN resources r ON r.id = i.resource_id
        WHERE i.path_id = $1
        ORDER BY i.sort_order ASC`, [p.id]);
    if (!items.length) { skipped.push({ title: p.name, reason: 'no_items' }); continue; }
    // The path is a flat list of up to twenty modules. Delivered as ONE
    // section it is the long scrolling page the step flow replaced, so it is
    // divided into screens at the boundaries the data already has. Order is
    // preserved exactly — only the screen breaks are new.
    await insert(
      p.name,
      p.description || null,
      // target_role is advisory on a path; the workflow's category is a
      // vocabulary the Owner can change afterwards.
      /rural|remote/i.test(p.name) ? 'rural_remote' : 'induction',
      lc.sectionsFromOrderedItems(items.map((r) => ({
        group: String(r.content_type || ''),
        label: importSectionLabel(r.content_type),
        item: {
          type: 'resource',
          title: r.title,
          resource_id: r.id,
          resource_title: r.title,
          required: r.required !== false,
          minutes: Number(r.learning_minutes || r.estimated_minutes) || undefined,
        },
      })), 'Modules'));
  }

  // ── The interactive portal induction ───────────────────────────────────────
  const modules = requireInductionRegistry();
  if (modules) {
    const mods = modules.modulesForRole('therapist').concat(
      modules.modulesForRole('owner').filter((m) => !m.roles.includes('therapist')));
    if (mods.length) {
      // Where the hub carries the matching tutorial page, link it; the module
      // key is that resource's slug by the registry's own contract.
      const { rows: tutorialRows } = await pool.query(
        `SELECT id, slug, title FROM resources
          WHERE organisation_id IS NOT DISTINCT FROM $1 AND slug = ANY($2::text[])`,
        [org, mods.map((m) => m.key)]);
      const bySlug = Object.fromEntries(tutorialRows.map((r) => [r.slug, r]));
      await insert(
        'Opal Portal Induction',
        'The interactive walkthroughs of the portal itself: calendar, bookings, travel, resources and your profile.',
        'induction',
        // One screen per handful of walkthroughs rather than the whole portal
        // on a single page; the registry's order is kept exactly.
        lc.sectionsFromOrderedItems(mods.map((m) => {
          const hit = bySlug[m.key];
          return {
            group: 'walkthrough',
            label: 'Portal walkthroughs',
            item: hit
              ? { type: 'resource', title: m.title, resource_id: hit.id, resource_title: hit.title, required: true, minutes: m.minutes }
              : { type: 'task', title: m.title, required: true, minutes: m.minutes,
                  body: (m.description || '') + '\n\nRun this walkthrough from the Resource Hub — My Learning, under the portal induction.' },
          };
        }), 'Portal walkthroughs'));
    }
  }

  if (created.length) {
    await audit(req, 'learning.workflows_imported', null, {
      created: created.map((c) => c.id), count: created.length,
    });
  }
  res.json({ created, skipped });
}));

/**
 * Explicit publish: snapshot the current draft as the latest version WITHOUT
 * assigning anyone. Publishing is still automatic at assign/push time — this
 * exists so the Owner can deliberately say "this is what learners receive
 * from now on" after finishing edits (§ Save and Publish behaviour). A
 * publish with no changes is a 200 no-op, not an error.
 */
router.post('/api/learning/workflows/:id/publish', ownerOnly, safe(async (req, res) => {
  // Checked before taking a pool connection: a malformed id can never match,
  // so opening a transaction for it is pure waste under load.
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const client = await pool.connect();
  let outcome;
  try {
    await client.query('BEGIN');
    const wf = await loadWorkflow(req, req.params.id, client);
    if (!wf) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }
    if (wf.status === 'archived') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This workflow is archived — unarchive it to publish' });
    }
    if (!lc.contentStats(wf.draft_content).items) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Add at least one learning item before publishing' });
    }
    const version = await ensurePublishedVersion(client, req, wf);
    await client.query('COMMIT');
    outcome = {
      wfId: wf.id,
      version: Number(version.version),
      published: Number(version.version) > Number(wf.current_version),
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  if (outcome.published) {
    await audit(req, 'learning.workflow_published', outcome.wfId, { version: outcome.version });
  }
  res.json({ published: outcome.published, version: outcome.version });
}));

// ═════════════════════════════════════════════════════════════════════════════
//  OWNER — assigning
// ═════════════════════════════════════════════════════════════════════════════

router.post('/api/learning/workflows/:id/assign', ownerOnly, safe(async (req, res) => {
  const b = req.body || {};
  const userIds = Array.isArray(b.userIds) ? b.userIds.map(String) : [];
  if (!userIds.length || userIds.length > 100) {
    return res.status(400).json({ error: 'userIds must list 1–100 employees' });
  }
  if (userIds.some((u) => !isUuid(u))) {
    return res.status(400).json({ error: 'userIds must be valid ids' });
  }
  const due = parseDueAt(b.dueAt);
  if (!due.ok) return res.status(400).json({ error: 'dueAt must be a valid date' });
  const note = str(b.note, 1000);
  const mandatory = b.mandatory !== false;
  const priority = ['low', 'normal', 'high'].includes(b.priority) ? b.priority : 'normal';

  const client = await pool.connect();
  let result;
  try {
    await client.query('BEGIN');
    const wf = await loadWorkflow(req, req.params.id, client);
    if (!wf) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }
    if (wf.status === 'archived') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This workflow is archived and cannot be assigned' });
    }
    const stats = lc.contentStats(wf.draft_content);
    if (!stats.items) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Add at least one learning item before assigning' });
    }

    const version = await ensurePublishedVersion(client, req, wf);
    const publishedNew = Number(version.version) > Number(wf.current_version);
    const counted = lc.countedKeys(version.content).length;

    const assigned = [];
    const skipped = [];
    for (const userId of [...new Set(userIds)]) {
      const { rows: users } = await client.query(
        `SELECT id, name, email, role FROM users
          WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2 AND is_active = TRUE`,
        [userId, orgOf(req)]);
      if (!users[0]) { skipped.push({ userId, reason: 'not_found' }); continue; }
      // read_only accounts cannot write progress (global choke point in
      // requireAuth), so an assignment to one could never be started —
      // refuse it here rather than create a trap.
      if (users[0].role === 'read_only') {
        skipped.push({ userId, reason: 'read_only_account', name: users[0].name });
        continue;
      }

      const ins = await client.query(
        `INSERT INTO learning_assignments
           (organisation_id, workflow_id, workflow_version_id, user_id, assigned_by,
            due_at, mandatory, priority, owner_note, required_total)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (user_id, workflow_id) WHERE status IN ('assigned','in_progress')
         DO NOTHING
         RETURNING *`,
        [orgOf(req), wf.id, version.id, users[0].id, req.user.id,
          due.value, mandatory, priority, note, counted]);
      if (!ins.rows[0]) { skipped.push({ userId, reason: 'already_active', name: users[0].name }); continue; }
      assigned.push({
        ...ins.rows[0],
        title: version.title,
        version: version.version,
        category: version.category,
        user_name: users[0].name,
        user_email: users[0].email,
      });
    }
    await client.query('COMMIT');
    result = { assigned, skipped, version: Number(version.version), publishedNew, workflowId: wf.id };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // After commit: notifications + audit (best-effort, never fail the request).
  if (result.publishedNew) {
    await audit(req, 'learning.workflow_published', result.workflowId, { version: result.version });
  }
  for (const a of result.assigned) {
    await audit(req, 'learning.assigned', a.id, {
      workflowId: a.workflow_id, versionId: a.workflow_version_id, userId: a.user_id,
    });
    await notify(a.user_id, {
      type: `learning_assigned_${a.id}`,
      title: 'New learning assigned',
      message: `"${a.title}" has been assigned to you. Open My Learning to begin.`,
      severity: 'info',
      relatedEntity: 'learning_assignment',
      actionPayload: { assignmentId: a.id },
    });
  }
  res.status(201).json({
    assigned: result.assigned.map((a) => assignmentRow(a)),
    skipped: result.skipped,
    version: result.version,
  });
}));

/**
 * Bulk assignment: explicit (workflow, user) PAIRS, produced by the review
 * step in the Assign Learning dialog. One transaction for the whole batch.
 *
 * Reassignment is deliberate at the API level, not just in the UI: a pair
 * whose user has ALREADY COMPLETED that workflow is refused with
 * 'already_completed' unless the pair carries reassign:true — the review
 * step's per-pair Reassign checkbox is what sets it. Active duplicates are
 * skipped by the same partial unique index as the single-workflow route.
 * A new assignment after reassign NEVER touches the completed record — the
 * history row stays exactly as it was.
 *
 * Workflows are locked FOR UPDATE in sorted-id order so two concurrent bulk
 * assigns over overlapping workflow sets serialise instead of deadlocking.
 */
router.post('/api/learning/assign', ownerOnly, safe(async (req, res) => {
  const b = req.body || {};
  const rawPairs = Array.isArray(b.pairs) ? b.pairs : [];
  if (!rawPairs.length || rawPairs.length > 500) {
    return res.status(400).json({ error: 'pairs must list 1–500 workflow/user pairs' });
  }
  const seenPair = new Set();
  const pairs = [];
  for (const p of rawPairs) {
    if (!p || !isUuid(p.workflowId) || !isUuid(p.userId)) {
      return res.status(400).json({ error: 'every pair needs a valid workflowId and userId' });
    }
    const key = `${p.workflowId}:${p.userId}`.toLowerCase();
    if (seenPair.has(key)) continue;
    seenPair.add(key);
    pairs.push({ workflowId: p.workflowId, userId: p.userId, reassign: p.reassign === true });
  }
  const due = parseDueAt(b.dueAt);
  if (!due.ok) return res.status(400).json({ error: 'dueAt must be a valid date' });
  const note = str(b.note, 1000);
  const mandatory = b.mandatory !== false;
  const priority = ['low', 'normal', 'high'].includes(b.priority) ? b.priority : 'normal';

  const client = await pool.connect();
  let result;
  try {
    await client.query('BEGIN');

    // Lock + publish each workflow once, in sorted order (deadlock avoidance).
    const workflowIds = [...new Set(pairs.map((p) => p.workflowId.toLowerCase()))].sort();
    const workflows = new Map(); // id -> { wf, version, counted, publishedNew, skipReason }
    for (const wfId of workflowIds) {
      const wf = await loadWorkflow(req, wfId, client);
      if (!wf) { workflows.set(wfId, { skipReason: 'workflow_not_found' }); continue; }
      if (wf.status === 'archived') { workflows.set(wfId, { skipReason: 'workflow_archived' }); continue; }
      if (!lc.contentStats(wf.draft_content).items) {
        workflows.set(wfId, { skipReason: 'workflow_empty' });
        continue;
      }
      const version = await ensurePublishedVersion(client, req, wf);
      workflows.set(wfId, {
        wf, version,
        counted: lc.countedKeys(version.content).length,
        publishedNew: Number(version.version) > Number(wf.current_version),
      });
    }

    // Eligibility once per distinct user — same contract as the single route.
    const userIds = [...new Set(pairs.map((p) => p.userId.toLowerCase()))];
    const users = new Map(); // id -> row | { skipReason }
    for (const userId of userIds) {
      const { rows } = await client.query(
        `SELECT id, name, email, role FROM users
          WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2 AND is_active = TRUE`,
        [userId, orgOf(req)]);
      if (!rows[0]) { users.set(userId, { skipReason: 'not_found' }); continue; }
      if (rows[0].role === 'read_only') {
        users.set(userId, { skipReason: 'read_only_account', name: rows[0].name });
        continue;
      }
      users.set(userId, { row: rows[0] });
    }

    const assigned = [];
    const skipped = [];
    for (const p of pairs) {
      const wfEntry = workflows.get(p.workflowId.toLowerCase());
      const userEntry = users.get(p.userId.toLowerCase());
      if (wfEntry.skipReason) {
        skipped.push({ workflowId: p.workflowId, userId: p.userId, reason: wfEntry.skipReason });
        continue;
      }
      if (userEntry.skipReason) {
        skipped.push({ workflowId: p.workflowId, userId: p.userId, reason: userEntry.skipReason, name: userEntry.name });
        continue;
      }
      const user = userEntry.row;

      if (!p.reassign) {
        const { rows: done } = await client.query(
          `SELECT 1 FROM learning_assignments
            WHERE user_id = $1 AND workflow_id = $2 AND status = 'completed' LIMIT 1`,
          [user.id, wfEntry.wf.id]);
        if (done[0]) {
          skipped.push({ workflowId: p.workflowId, userId: p.userId, reason: 'already_completed', name: user.name });
          continue;
        }
      }

      const ins = await client.query(
        `INSERT INTO learning_assignments
           (organisation_id, workflow_id, workflow_version_id, user_id, assigned_by,
            due_at, mandatory, priority, owner_note, required_total)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (user_id, workflow_id) WHERE status IN ('assigned','in_progress')
         DO NOTHING
         RETURNING *`,
        [orgOf(req), wfEntry.wf.id, wfEntry.version.id, user.id, req.user.id,
          due.value, mandatory, priority, note, wfEntry.counted]);
      if (!ins.rows[0]) {
        skipped.push({ workflowId: p.workflowId, userId: p.userId, reason: 'already_active', name: user.name });
        continue;
      }
      assigned.push({
        ...ins.rows[0],
        title: wfEntry.version.title,
        version: wfEntry.version.version,
        category: wfEntry.version.category,
        user_name: user.name,
        user_email: user.email,
      });
    }

    await client.query('COMMIT');
    const versions = {};
    for (const [wfId, entry] of workflows) {
      if (entry.version) versions[wfId] = Number(entry.version.version);
    }
    result = {
      assigned, skipped, versions,
      published: [...workflows.entries()]
        .filter(([, e]) => e.publishedNew)
        .map(([wfId, e]) => ({ workflowId: wfId, version: Number(e.version.version) })),
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // After commit: audits + notifications, best-effort, same as the single route.
  for (const pub of result.published) {
    await audit(req, 'learning.workflow_published', pub.workflowId, { version: pub.version });
  }
  for (const a of result.assigned) {
    await audit(req, 'learning.assigned', a.id, {
      workflowId: a.workflow_id, versionId: a.workflow_version_id, userId: a.user_id,
    });
    await notify(a.user_id, {
      type: `learning_assigned_${a.id}`,
      title: 'New learning assigned',
      message: `"${a.title}" has been assigned to you. Open My Learning to begin.`,
      severity: 'info',
      relatedEntity: 'learning_assignment',
      actionPayload: { assignmentId: a.id },
    });
  }
  res.status(201).json({
    assigned: result.assigned.map((a) => assignmentRow(a)),
    skipped: result.skipped,
    versions: result.versions,
  });
}));

// ═════════════════════════════════════════════════════════════════════════════
//  OWNER — monitoring
// ═════════════════════════════════════════════════════════════════════════════

const ASSIGNMENT_SELECT = `
  SELECT a.*, v.version, v.title, v.category,
         u.name AS user_name, u.email AS user_email, u.role AS user_role,
         ab.name AS assigned_by_name
    FROM learning_assignments a
    JOIN learning_workflow_versions v ON v.id = a.workflow_version_id
    JOIN users u ON u.id = a.user_id
    LEFT JOIN users ab ON ab.id = a.assigned_by`;

router.get('/api/learning/assignments', ownerOnly, safe(async (req, res) => {
  const params = [orgOf(req)];
  let where = `a.organisation_id IS NOT DISTINCT FROM $1`;

  const status = str(req.query.status, 20);
  if (status && ['assigned', 'in_progress', 'completed', 'cancelled'].includes(status)) {
    params.push(status); where += ` AND a.status = $${params.length}`;
  }
  if (isUuid(req.query.workflowId)) {
    params.push(req.query.workflowId); where += ` AND a.workflow_id = $${params.length}`;
  }
  if (isUuid(req.query.userId)) {
    params.push(req.query.userId); where += ` AND a.user_id = $${params.length}`;
  }
  const q = str(req.query.q, 120);
  if (q) {
    params.push('%' + q + '%');
    where += ` AND (u.name ILIKE $${params.length} OR u.email ILIKE $${params.length} OR v.title ILIKE $${params.length})`;
  }
  if (String(req.query.overdue || '') === '1') {
    where += ` AND a.due_at IS NOT NULL AND a.completed_at IS NULL
               AND a.status IN ('assigned','in_progress') AND a.due_at < NOW()`;
  }

  const { rows } = await pool.query(
    `${ASSIGNMENT_SELECT} WHERE ${where}
      ORDER BY a.status IN ('assigned','in_progress') DESC, a.assigned_at DESC
      LIMIT 500`, params);
  res.json({ assignments: rows.map((r) => assignmentRow(r)) });
}));

router.get('/api/learning/assignments/:id', ownerOnly, safe(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const { rows } = await pool.query(
    `${ASSIGNMENT_SELECT}
      WHERE a.id = $1 AND a.organisation_id IS NOT DISTINCT FROM $2`,
    [req.params.id, orgOf(req)]);
  const a = rows[0];
  if (!a) return res.status(404).json({ error: 'Not found' });

  const [{ rows: items }, { rows: [wf] }, { rows: [vc] }] = await Promise.all([
    pool.query(`SELECT item_key, item_type, completed_at, evidence
                  FROM learning_item_progress WHERE assignment_id = $1`, [a.id]),
    pool.query(`SELECT current_version, status FROM learning_workflows WHERE id = $1`, [a.workflow_id]),
    pool.query(`SELECT content FROM learning_workflow_versions WHERE id = $1`, [a.workflow_version_id]),
  ]);
  const doneByKey = Object.fromEntries(items.map((r) => [r.item_key, r]));
  const sections = ((vc && vc.content.sections) || []).map((s) => ({
    key: s.key,
    title: s.title,
    items: (s.items || []).map((it) => ({
      key: it.key, type: it.type, title: it.title, required: it.required !== false,
      minutes: it.minutes,
      completed_at: doneByKey[it.key] ? doneByKey[it.key].completed_at : null,
      evidence: doneByKey[it.key] ? doneByKey[it.key].evidence : null,
    })),
  }));
  res.json({
    assignment: assignmentRow(a),
    sections,
    workflow_current_version: wf ? Number(wf.current_version) : null,
    workflow_status: wf ? wf.status : null,
  });
}));

router.post('/api/learning/assignments/:id/cancel', ownerOnly, safe(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const { rows } = await pool.query(
    `UPDATE learning_assignments
        SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = $3
      WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2
        AND status IN ('assigned', 'in_progress')
      RETURNING *`,
    [req.params.id, orgOf(req), req.user.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  await audit(req, 'learning.assignment_cancelled', rows[0].id, {
    workflowId: rows[0].workflow_id, userId: rows[0].user_id,
  });
  res.json({ assignment: assignmentRow(rows[0]) });
}));

/**
 * Deliberately push the latest version to an ACTIVE assignment. Progress on
 * items whose keys survive carries over; the completion rule is recomputed
 * against the new content. Completed assignments are history — never touched.
 */
router.post('/api/learning/assignments/:id/push-latest', ownerOnly, safe(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT * FROM learning_assignments
        WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2
        FOR UPDATE`, [req.params.id, orgOf(req)]);
    const a = rows[0];
    if (!a || !['assigned', 'in_progress'].includes(a.status)) {
      await client.query('ROLLBACK');
      return res.status(a ? 409 : 404).json({ error: a ? 'Only active assignments can be updated' : 'Not found' });
    }
    const wf = await loadWorkflow(req, a.workflow_id, client);
    if (!wf || wf.status === 'archived') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'The workflow is archived — unarchive it first' });
    }
    if (!lc.contentStats(wf.draft_content).items) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'The workflow has no learning items — add content before pushing an update' });
    }
    const version = await ensurePublishedVersion(client, req, wf);
    const publishedNew = Number(version.version) > Number(wf.current_version);
    if (version.id === a.workflow_version_id) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This assignment already has the latest version' });
    }
    await client.query(
      `UPDATE learning_assignments SET workflow_version_id = $2 WHERE id = $1`,
      [a.id, version.id]);
    // Owner action: recompute against the new content but never fabricate
    // employee activity (assigned stays assigned; started_at untouched).
    const upd = await recomputeProgress(client, a, version.content, { employeeAction: false });
    await client.query('COMMIT');
    if (publishedNew) {
      await audit(req, 'learning.workflow_published', wf.id, { version: Number(version.version) });
    }
    await audit(req, 'learning.assignment_version_pushed', a.id, {
      fromVersionId: a.workflow_version_id, toVersion: Number(version.version), userId: a.user_id,
    });
    if (upd.becameComplete) {
      await audit(req, 'learning.completed', a.id, {
        workflowId: a.workflow_id, versionId: version.id, viaVersionPush: true,
      });
    }
    await notify(a.user_id, {
      // Version in the type: a second push within 24h must not be swallowed
      // by storeNotification's same-type dedup.
      type: `learning_updated_${a.id}_v${Number(version.version)}`,
      title: 'Assigned learning updated',
      message: 'An item of your assigned learning was updated to a newer version. Your completed modules are kept.',
      severity: 'info',
      relatedEntity: 'learning_assignment',
      actionPayload: { assignmentId: a.id },
    });
    res.json({ assignment: assignmentRow({ ...upd.row, version: version.version, title: version.title }) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}));

/** Active staff directory for the assign picker + per-employee rollups. */
/**
 * The people an Owner may assign learning to.
 *
 * "Active" is TWO conditions, not one. `is_active` is the account switch; a
 * suspended or deactivated account can still carry `is_active = TRUE` because
 * `account_status` is what login actually refuses on. Filtering only the first
 * would offer the Owner somebody who cannot sign in to do the work.
 *
 * `read_only` accounts are excluded for the reason the assign route already
 * refuses them: requireAuth blocks every write they would need to record
 * progress, so an assignment to one could never be started. Better absent from
 * the list than present and silently skipped at submit.
 *
 * `pre_employee` stays IN. A new starter part-way through onboarding is
 * precisely somebody an Owner wants to give the induction to, and
 * /api/learning/my is on their path allowlist.
 *
 * `active_workflow_ids` is what lets the assignment picker mark "already has
 * this" BEFORE the Owner submits, rather than reporting it afterwards as a
 * skipped row.
 */
router.get('/api/learning/staff', ownerOnly, safe(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.email, u.role,
            COUNT(a.id) FILTER (WHERE a.status IN ('assigned','in_progress')) AS active_assignments,
            COUNT(a.id) FILTER (WHERE a.status = 'completed') AS completed_assignments,
            MAX(a.last_activity_at) AS last_activity_at,
            COALESCE(
              ARRAY_AGG(DISTINCT a.workflow_id)
                FILTER (WHERE a.status IN ('assigned','in_progress')),
              '{}'
            ) AS active_workflow_ids,
            COALESCE(
              ARRAY_AGG(DISTINCT a.workflow_id)
                FILTER (WHERE a.status = 'completed'),
              '{}'
            ) AS completed_workflow_ids
       FROM users u
       LEFT JOIN learning_assignments a
              ON a.user_id = u.id AND a.organisation_id IS NOT DISTINCT FROM $1
      WHERE u.organisation_id IS NOT DISTINCT FROM $1
        AND u.is_active = TRUE
        AND COALESCE(u.account_status, 'active') = 'active'
        AND u.role <> 'read_only'
      GROUP BY u.id, u.name, u.email, u.role
      ORDER BY u.name ASC`, [orgOf(req)]);
  res.json({
    staff: rows.map((r) => ({
      id: r.id, name: r.name, email: r.email, role: r.role,
      active_assignments: Number(r.active_assignments),
      completed_assignments: Number(r.completed_assignments),
      last_activity_at: r.last_activity_at,
      active_workflow_ids: (r.active_workflow_ids || []).filter(Boolean),
      // The review step marks completed pairs and offers per-pair Reassign;
      // active pairs are skipped as duplicates. Same shape as active ids.
      completed_workflow_ids: (r.completed_workflow_ids || []).filter(Boolean),
    })),
  });
}));

// ═════════════════════════════════════════════════════════════════════════════
//  EMPLOYEE — my learning
// ═════════════════════════════════════════════════════════════════════════════

/** Load one assignment the CALLER owns, or null (→ 404). Cancelled
 *  assignments are withdrawn — they answer like they never existed. */
async function loadMyAssignment(req, id, client) {
  if (!isUuid(id)) return null;
  const q = client || pool;
  const { rows } = await q.query(
    `SELECT a.*, v.version, v.title, v.category, v.content,
            ab.name AS assigned_by_name
       FROM learning_assignments a
       JOIN learning_workflow_versions v ON v.id = a.workflow_version_id
       LEFT JOIN users ab ON ab.id = a.assigned_by
      WHERE a.id = $1 AND a.user_id = $2 AND a.status != 'cancelled'
      ${client ? 'FOR UPDATE OF a' : ''}`,
    [id, req.user.id]);
  return rows[0] || null;
}

router.get('/api/learning/my', safe(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT a.*, v.version, v.title, v.category, ab.name AS assigned_by_name
       FROM learning_assignments a
       JOIN learning_workflow_versions v ON v.id = a.workflow_version_id
       LEFT JOIN users ab ON ab.id = a.assigned_by
      WHERE a.user_id = $1 AND a.status != 'cancelled'
      ORDER BY a.status IN ('assigned','in_progress') DESC,
               a.due_at ASC NULLS LAST, a.assigned_at DESC`,
    [req.user.id]);
  res.json({
    assignments: rows.map((r) => ({
      ...assignmentRow(r, { forEmployee: true }),
      assigned_by_name: r.assigned_by_name,
    })),
  });
}));

router.get('/api/learning/my/:id', safe(async (req, res) => {
  const a = await loadMyAssignment(req, req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  const { rows: items } = await pool.query(
    `SELECT item_key, item_type, completed_at FROM learning_item_progress
      WHERE assignment_id = $1`, [a.id]);
  res.json({
    assignment: { ...assignmentRow(a, { forEmployee: true }), assigned_by_name: a.assigned_by_name },
    content: lc.serialiseForEmployee(a.content),
    completed_items: Object.fromEntries(items.map((r) => [r.item_key, r.completed_at])),
  });
}));

router.post('/api/learning/my/:id/start', safe(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const { rows } = await pool.query(
    `UPDATE learning_assignments
        SET status = 'in_progress', started_at = COALESCE(started_at, NOW()), last_activity_at = NOW()
      WHERE id = $1 AND user_id = $2 AND status = 'assigned'
      RETURNING *`,
    [req.params.id, req.user.id]);
  if (rows[0]) await audit(req, 'learning.assignment_started', rows[0].id, {});
  // Idempotent: already started (or completed) is fine — report current state.
  const a = await loadMyAssignment(req, req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  res.json({ assignment: assignmentRow(a, { forEmployee: true }) });
}));

router.post('/api/learning/my/:id/items/:itemKey/complete', safe(async (req, res) => {
  const itemKey = str(req.params.itemKey, lc.LIMITS.key);
  if (!itemKey) return res.status(404).json({ error: 'Not found' });

  const client = await pool.connect();
  let outcome;
  try {
    await client.query('BEGIN');
    const a = await loadMyAssignment(req, req.params.id, client);
    if (!a) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }
    if (a.status === 'completed') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This learning is already completed' });
    }
    const item = lc.itemByKey(a.content, itemKey);
    if (!item) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }

    const b = req.body || {};
    let evidence = null;
    let quizResult = null;

    if (item.type === 'acknowledgement') {
      if (b.acknowledged !== true) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'The acknowledgement must be explicitly confirmed' });
      }
      evidence = {
        kind: 'acknowledgement',
        statement_sha256: crypto.createHash('sha256')
          .update(item.ack_statement || '', 'utf8').digest('hex'),
      };
    } else if (item.type === 'quiz') {
      if (quizRateLimited(`${req.user.id}:${a.id}:${itemKey}`)) {
        await client.query('ROLLBACK');
        return res.status(429).json({
          error: 'rate_limited',
          message: 'Too many attempts in a short time — take a break and try again in a few minutes.',
        });
      }
      quizResult = lc.gradeQuiz(item.quiz, b.answers);
      if (!quizResult.passed) {
        await client.query('ROLLBACK');
        await audit(req, 'learning.quiz_attempted', a.id, {
          itemKey, score: quizResult.score, total: quizResult.total, passed: false,
        });
        return res.json({ completed: false, quiz: quizResult });
      }
      evidence = { kind: 'quiz', score: quizResult.score, total: quizResult.total, percent: quizResult.percent };
    } else if (item.type === 'resource') {
      evidence = { kind: 'resource_viewed', resource_id: item.resource_id };
    }

    await client.query(
      `INSERT INTO learning_item_progress (assignment_id, item_key, item_type, evidence)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (assignment_id, item_key) DO NOTHING`,
      [a.id, itemKey, item.type, evidence ? JSON.stringify(evidence) : null]);

    const upd = await recomputeProgress(client, a, a.content);
    await client.query('COMMIT');
    outcome = { a, item, upd, quizResult };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  const { a, item, upd, quizResult } = outcome;
  if (item.type === 'acknowledgement') {
    await audit(req, 'learning.acknowledged', a.id, { itemKey });
  } else if (item.type === 'quiz') {
    await audit(req, 'learning.quiz_attempted', a.id, {
      itemKey, score: quizResult.score, total: quizResult.total, passed: true,
    });
  }
  if (upd.becameComplete) {
    await audit(req, 'learning.completed', a.id, {
      workflowId: a.workflow_id, versionId: a.workflow_version_id,
    });
    if (a.assigned_by && a.assigned_by !== req.user.id) {
      await notify(a.assigned_by, {
        type: `learning_completed_${a.id}`,
        title: 'Learning completed',
        message: `${req.user.name || 'A staff member'} completed "${a.title}".`,
        severity: 'success',
        relatedEntity: 'learning_assignment',
        actionPayload: { assignmentId: a.id },
      });
    }
  }

  // Best-effort bridge: a learning workflow assigned as part of someone's
  // ONBOARDING completes the matching onboarding requirement, so a new starter
  // does not have to tick the same module off twice. One-way only — nothing in
  // onboarding writes back into learning state. Post-commit and wrapped, like
  // the resource bridge below: a bridge failure must never make a completed
  // module look like an error to the employee.
  if (upd.becameComplete) {
    try {
      await require('./onboarding-learning-bridge')
        .onLearningAssignmentCompleted(a.id, a.user_id);
    } catch (e) {
      log.warn('onboarding completion bridge failed', { error: e, assignmentId: a.id });
    }
  }

  // Best-effort bridge: completing a resource item also marks the hub
  // resource complete for this user, so hub learning percentages agree.
  if (item.type === 'resource' && item.resource_id) {
    try {
      await pool.query(
        `INSERT INTO user_learning_progress (user_id, resource_id, completed_at)
         SELECT $1, r.id, NOW() FROM resources r
          WHERE r.id = $2 AND r.organisation_id IS NOT DISTINCT FROM $3
         ON CONFLICT (user_id, resource_id) DO NOTHING`,
        [req.user.id, item.resource_id, orgOf(req)]);
    } catch (e) {
      log.warn('resource completion bridge failed', { error: e, itemKey });
    }
  }

  res.json({
    completed: true,
    quiz: quizResult || undefined,
    // upd.row is the bare assignments row — carry the version-snapshot fields
    // (title/version/category) over from the loaded assignment so the player
    // header survives the refresh.
    assignment: assignmentRow(
      { ...upd.row, title: a.title, version: a.version, category: a.category },
      { forEmployee: true }),
    assignment_completed: upd.becameComplete,
  });
}));

module.exports = router;
