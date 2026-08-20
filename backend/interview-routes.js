'use strict';

/**
 * INTERVIEW PREPARATION — API
 *
 * The Owner's structured recruitment interviews: a library of templates, a
 * record per applicant, and the two PDFs (blank fillable, populated) the
 * practice files as part of its recruitment documentation.
 *
 * ── RBAC, and where it is actually enforced ────────────────────────────────
 * Every route under /api/interviews requires a session AND the
 * `interviews.access` permission. That permission is in no role's defaults
 * except owner's (permissions.js), so the module does not exist for anybody
 * the Owner has not deliberately authorised — a therapist, a read-only
 * account, an unauthorised admin and an anonymous caller all receive the same
 * 403 from the same middleware, whatever the navigation happens to show.
 * Hiding the tab is a courtesy; this file is the boundary.
 *
 * Three distinct powers, checked separately at every route:
 *
 *   interviews.access     conduct interviews. Sees, edits and exports the
 *                         records THIS user created, and nothing else.
 *   interviews.view_all   read and export every interview in the practice.
 *                         Read only — it never confers the right to edit
 *                         somebody else's interview record.
 *   role === 'owner'      the above implicitly, plus permanent deletion and
 *                         the delegation endpoints. Delegation is gated on
 *                         ROLE, not on a permission, so the ability to hand
 *                         out access can never itself be handed out.
 *
 * Editing is deliberately narrower than reading: an interview is a document
 * one person wrote and signed. `view_all` lets a second person read and file
 * it; only its author (or the Owner) may change what it says.
 *
 * ── Organisation isolation ─────────────────────────────────────────────────
 * Every query filters organisation_id with IS NOT DISTINCT FROM, and a record
 * in another organisation is a 404 rather than a 403 — indistinguishable from
 * one that does not exist, so record ids cannot be probed. Same rule as
 * whodas-routes.js and learning-routes.js.
 *
 * ── Not clinical data ──────────────────────────────────────────────────────
 * Nothing here touches contacts, participants, events or any clinical table.
 * A job applicant is not a client and never acquires a clinical record by
 * being interviewed.
 */

const express = require('express');

const router = express.Router();
const db = require('./database');
const { pool } = require('./database');
const {
  requireAuth, requirePermission, hasPermission,
  INTERVIEW_PERMISSIONS, INTERVIEW_PERMISSION_GROUPS, INTERVIEW_PERMISSION_LABELS,
} = require('./permissions');
const log = require('./logger').createLogger('interviews');

const tpl = require('./interview-templates');
const pdfRenderer = require('./interview-pdf');

// ── Small shared helpers, house style ───────────────────────────────────────

const safe = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  // Message and path only. A body or a row here would put a candidate's
  // answers into the application log.
  log.error('interview route error', { error: err.message, path: req.path });
  if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
});

const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));
const orgOf = (req) => req.user?.organisation_id || null;

const str = (v, max) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

/** A date the DATE column will accept, or null. Never a partial parse. */
function isoDate(v) {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return isNaN(d.getTime()) ? null : s;
}

const notFound = (res) => res.status(404).json({ error: 'not_found' });

/** Make a user's search term match literally under LIKE ... ESCAPE '\\'. */
const escapeLike = (s) => String(s).replace(/[\\%_]/g, '\\$&');

// ── Auth: one choke point for the whole namespace ────────────────────────────

router.use('/api/interviews', requireAuth);
router.use('/api/interviews', requirePermission('interviews.access'));

/** Owner-only, by role: the power to delegate is never itself delegable. */
const ownerOnly = (req, res, next) => {
  if (req.user?.role !== 'owner') {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Only the practice owner can change Interview Preparation access.',
    });
  }
  next();
};

const canViewAll = (user) => user?.role === 'owner' || hasPermission(user, 'interviews.view_all');
const canEditRecord = (user, record) => user?.role === 'owner' || record.created_by === user?.id;

// ── Audit ────────────────────────────────────────────────────────────────────

/**
 * Ids and counts only. An interview record's answers are the most sensitive
 * thing this module holds, and an audit log is read by more people, kept for
 * longer and exported more often than the record itself. The record id
 * resolves the rest for anyone entitled to look.
 */
async function audit(req, action, targetId, metadata) {
  await db.logAuditEvent({
    action,
    targetType: 'interview',
    targetId: targetId ? String(targetId) : null,
    actorUserId: req.user?.id,
    organisationId: orgOf(req),
    ipAddress: req.ip,
    metadata: metadata || {},
  }).catch(() => {});
}

/**
 * Routine autosaves are throttled out of the audit log.
 *
 * A two-second-idle autosave over a 45-minute interview is several hundred
 * writes; recording each as a distinct "interview edited" event would bury the
 * events that matter — completion, reopening, export, an edit after
 * completion — under noise, which is how an audit trail stops being read.
 * One INTERVIEW_EDITED per user per record per window is the signal.
 *
 * Post-completion edits are NEVER throttled: they are the ones a reviewer is
 * looking for. Same in-memory idiom as learning-routes.js's quiz throttle.
 */
const EDIT_AUDIT_WINDOW_MS = 15 * 60 * 1000;
const _editAudited = new Map();
function shouldAuditEdit(recordId, userId) {
  const now = Date.now();
  for (const [k, at] of _editAudited) { if (now - at > EDIT_AUDIT_WINDOW_MS) _editAudited.delete(k); }
  const key = `${recordId}:${userId}`;
  const last = _editAudited.get(key);
  if (last && now - last <= EDIT_AUDIT_WINDOW_MS) return false;
  _editAudited.set(key, now);
  return true;
}

// ── Serialisers ──────────────────────────────────────────────────────────────

/** Everything a list row needs — never the answers. */
function recordSummary(r, user) {
  const schema = r.template_schema || {};
  const progress = schema.sections
    ? tpl.progressOf(schema, r.responses || {})
    : { total: 0, answered: 0, percent: 0 };
  const recommendationLabel = (() => {
    if (!r.recommendation || !schema.sections) return null;
    let label = null;
    tpl.eachQuestion(schema, (q) => {
      if (q.type === 'choice' && q.emphasis) {
        const opt = (q.options || []).find((o) => o.key === r.recommendation);
        if (opt) label = opt.label;
      }
    });
    return label;
  })();

  return {
    id: r.id,
    templateKey: r.template_key,
    templateVersion: r.template_version,
    templateName: schema.name || r.template_key,
    candidateName: r.candidate_name,
    position: r.position,
    interviewDate: r.interview_date,
    interviewers: r.interviewers,
    status: r.status,
    recommendation: r.recommendation,
    recommendationLabel,
    createdBy: r.created_by,
    createdByName: r.created_by_name || null,
    updatedByName: r.updated_by_name || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    completedAt: r.completed_at,
    reopenedAt: r.reopened_at,
    archivedAt: r.archived_at,
    postCompletionEdits: Number(r.post_completion_edits) || 0,
    progress: { total: progress.total, answered: progress.answered, percent: progress.percent },
    // The client never derives its own permissions; the server states them.
    canEdit: canEditRecord(user, r),
    canDelete: user?.role === 'owner',
    route: `#interviews/record/${r.id}`,
  };
}

/** The full record the interview surface opens. */
function recordDetail(r, user) {
  return {
    ...recordSummary(r, user),
    template: r.template_schema,
    responses: r.responses || {},
    ratings: r.ratings || {},
  };
}

const RECORD_COLUMNS = `
  r.*,
  cu.name AS created_by_name,
  uu.name AS updated_by_name
`;
const RECORD_JOINS = `
  FROM interview_records r
  LEFT JOIN users cu ON cu.id = r.created_by
  LEFT JOIN users uu ON uu.id = r.updated_by
`;

/**
 * Load one record, applying visibility. Returns null for absent, foreign-org
 * and not-visible alike — a caller cannot tell the three apart.
 */
async function loadRecord(req, id) {
  if (!isUuid(id)) return null;
  const params = [id, orgOf(req)];
  let where = 'WHERE r.id = $1 AND r.organisation_id IS NOT DISTINCT FROM $2';
  if (!canViewAll(req.user)) {
    params.push(req.user.id);
    where += ` AND r.created_by = $${params.length}`;
  }
  const { rows } = await pool.query(`SELECT ${RECORD_COLUMNS} ${RECORD_JOINS} ${where} LIMIT 1`, params);
  return rows[0] || null;
}

// ═════════════════════════════════════════════════════════════════════════════
//  TEMPLATE LIBRARY
// ═════════════════════════════════════════════════════════════════════════════

router.get('/api/interviews/templates', safe(async (req, res) => {
  const cat = tpl.catalogue();
  res.json({
    ok: true,
    templates: cat.templates,
    upcoming: cat.upcoming,
    capabilities: {
      viewAll: canViewAll(req.user),
      manageAccess: req.user.role === 'owner',
      delete: req.user.role === 'owner',
    },
  });
}));

/** The full schema — what the online form and the preview both render from. */
router.get('/api/interviews/templates/:key', safe(async (req, res) => {
  const t = tpl.templateByKey(req.params.key);
  if (!t) return notFound(res);
  res.json({ ok: true, template: t, meta: tpl.catalogueEntry(t) });
}));

/** The blank fillable PDF. Generated on demand from the same schema. */
router.get('/api/interviews/templates/:key/pdf', safe(async (req, res) => {
  const t = tpl.templateByKey(req.params.key);
  if (!t) return notFound(res);

  let out;
  try {
    out = await pdfRenderer.renderInterviewPdf({ template: t, mode: 'blank' });
  } catch (err) {
    log.error('blank interview pdf failed', { key: t.key, error: err.message });
    return res.status(500).json({ error: 'pdf_failed', message: 'The blank template could not be generated.' });
  }

  await audit(req, 'INTERVIEW_TEMPLATE_EXPORTED', null, { templateKey: t.key, templateVersion: t.version });
  sendPdf(req, res, out.bytes, pdfRenderer.blankFilename(t), { cache: 'private, max-age=600' });
}));

// ═════════════════════════════════════════════════════════════════════════════
//  RECORDS
// ═════════════════════════════════════════════════════════════════════════════

router.get('/api/interviews/records', safe(async (req, res) => {
  const params = [orgOf(req)];
  let where = 'WHERE r.organisation_id IS NOT DISTINCT FROM $1';

  if (!canViewAll(req.user)) {
    params.push(req.user.id);
    where += ` AND r.created_by = $${params.length}`;
  }

  const status = str(req.query.status, 20);
  if (status && status !== 'all' && tpl.STATUSES.includes(status)) {
    params.push(status);
    where += ` AND r.status = $${params.length}`;
  } else if (!status || status === 'active') {
    // The default working list hides archived records without losing them.
    where += " AND r.status <> 'archived'";
  }

  const templateKey = str(req.query.templateKey, 80);
  if (templateKey) { params.push(templateKey); where += ` AND r.template_key = $${params.length}`; }

  const search = str(req.query.q, 120);
  if (search) {
    // escapeLike, not just a bound parameter: a parameter stops SQL injection
    // but LIKE still reads % and _ inside the VALUE as wildcards, so searching
    // for "%" would list every applicant in the practice and "_" would match
    // any single character. A person typing into a search box means the
    // characters they typed.
    params.push(`%${escapeLike(search.toLowerCase())}%`);
    where += ` AND (LOWER(r.candidate_name) LIKE $${params.length} ESCAPE '\\'`
      + ` OR LOWER(COALESCE(r.position, '')) LIKE $${params.length} ESCAPE '\\')`;
  }

  const from = isoDate(req.query.from);
  if (from) { params.push(from); where += ` AND r.interview_date >= $${params.length}`; }
  const to = isoDate(req.query.to);
  if (to) { params.push(to); where += ` AND r.interview_date <= $${params.length}`; }

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 200);
  params.push(limit);

  const { rows } = await pool.query(
    `SELECT ${RECORD_COLUMNS} ${RECORD_JOINS} ${where} ORDER BY r.updated_at DESC LIMIT $${params.length}`,
    params
  );

  res.json({
    ok: true,
    records: rows.map((r) => recordSummary(r, req.user)),
    scope: canViewAll(req.user) ? 'practice' : 'own',
    statuses: tpl.STATUSES,
  });
}));

router.post('/api/interviews/records', safe(async (req, res) => {
  const body = req.body || {};
  const template = tpl.templateByKey(body.templateKey);
  if (!template) return res.status(400).json({ error: 'unknown_template', message: 'That interview template does not exist.' });

  const candidateName = str(body.candidateName, 200);
  if (!candidateName) {
    return res.status(400).json({ error: 'candidate_required', message: 'A candidate name is required to start an interview.' });
  }

  const interviewDate = isoDate(body.interviewDate) || new Date().toISOString().slice(0, 10);
  // The signed-in user is the natural default interviewer, and stays editable —
  // a panel of two is normal, and the record should be able to say so.
  const interviewers = str(body.interviewers, 300) || str(req.user.name, 300);
  const position = str(body.position, 200) || template.defaultPosition || null;

  const { rows } = await pool.query(
    `INSERT INTO interview_records
       (organisation_id, template_key, template_version, template_schema,
        candidate_name, position, interview_date, interviewers,
        status, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9,$9)
     RETURNING *`,
    [
      orgOf(req), template.key, template.version, JSON.stringify(tpl.snapshotOf(template)),
      candidateName, position, interviewDate, interviewers, req.user.id,
    ]
  );
  const row = rows[0];
  row.created_by_name = req.user.name;

  await audit(req, 'INTERVIEW_CREATED', row.id, {
    templateKey: template.key, templateVersion: template.version,
  });

  res.status(201).json({ ok: true, record: recordDetail(row, req.user) });
}));

router.get('/api/interviews/records/:id', safe(async (req, res) => {
  const row = await loadRecord(req, req.params.id);
  if (!row) return notFound(res);
  await audit(req, 'INTERVIEW_OPENED', row.id, { status: row.status });
  res.json({ ok: true, record: recordDetail(row, req.user) });
}));

/**
 * Save. One endpoint for autosave, explicit Save and Save & Exit alike —
 * they differ only in what the client does afterwards, never in what is
 * persisted, so a crash mid-interview loses nothing an explicit save would
 * have kept.
 *
 * `expectedUpdatedAt`, when supplied, makes a lost update visible instead of
 * silent: if the row moved under the client (a second tab, a colleague with
 * the record open) the save is refused with the current record attached, and
 * the interviewer is told rather than overwritten.
 */
router.patch('/api/interviews/records/:id', safe(async (req, res) => {
  const row = await loadRecord(req, req.params.id);
  if (!row) return notFound(res);
  if (!canEditRecord(req.user, row)) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Only the interviewer who created this record, or the practice owner, can change it.',
    });
  }
  if (row.status === 'archived') {
    return res.status(409).json({ error: 'archived', message: 'Restore this interview before editing it.' });
  }

  const body = req.body || {};
  if (body.expectedUpdatedAt) {
    const seen = new Date(body.expectedUpdatedAt).getTime();
    const actual = new Date(row.updated_at).getTime();
    if (Number.isFinite(seen) && seen !== actual) {
      return res.status(409).json({
        error: 'stale',
        message: 'This interview was changed somewhere else. Reload to see the latest version.',
        record: recordDetail(row, req.user),
      });
    }
  }

  const schema = row.template_schema || {};
  const sets = [];
  const params = [];
  const set = (col, value) => { params.push(value); sets.push(`${col} = $${params.length}`); };

  if (body.candidateName !== undefined) {
    const name = str(body.candidateName, 200);
    if (!name) return res.status(400).json({ error: 'candidate_required', message: 'A candidate name is required.' });
    set('candidate_name', name);
  }
  if (body.position !== undefined) set('position', str(body.position, 200));
  if (body.interviewers !== undefined) set('interviewers', str(body.interviewers, 300));
  if (body.interviewDate !== undefined) {
    const d = isoDate(body.interviewDate);
    if (body.interviewDate && !d) {
      return res.status(400).json({ error: 'invalid_date', message: 'The interview date is not a valid date.' });
    }
    set('interview_date', d);
  }

  let responses = row.responses || {};
  if (body.responses !== undefined) {
    // A partial patch merges; the client sends only what changed. Coercion is
    // against the record's OWN snapshot, so a template edit since creation can
    // never smuggle a new question into an old record.
    const incoming = tpl.coerceResponses(schema, body.responses);
    responses = { ...responses, ...incoming };
    set('responses', JSON.stringify(responses));
  }

  if (body.ratings !== undefined) {
    let coerced = {};
    tpl.eachQuestion(schema, (q) => {
      if (q.type === 'ratings') coerced = tpl.coerceAnswer(q, body.ratings) || {};
    });
    set('ratings', JSON.stringify(coerced));
  }

  if (body.recommendation !== undefined) {
    let allowed = null;
    tpl.eachQuestion(schema, (q) => {
      if (q.type === 'choice' && q.emphasis) allowed = (q.options || []).map((o) => o.key);
    });
    const value = str(body.recommendation, 60);
    if (value && (!allowed || !allowed.includes(value))) {
      return res.status(400).json({ error: 'invalid_recommendation', message: 'That is not one of the recommendation options.' });
    }
    set('recommendation', value);
  }

  if (!sets.length) return res.json({ ok: true, record: recordDetail(row, req.user), unchanged: true });

  // Saving into a draft moves it along; a completed record stays completed and
  // is instead marked as having been edited afterwards.
  const wasCompleted = row.status === 'completed';
  if (row.status === 'draft') set('status', 'in_progress');
  if (wasCompleted) sets.push('post_completion_edits = post_completion_edits + 1');

  set('updated_by', req.user.id);
  sets.push('updated_at = NOW()');
  params.push(row.id);

  const { rows } = await pool.query(
    `UPDATE interview_records SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params
  );
  const updated = rows[0];
  updated.created_by_name = row.created_by_name;
  updated.updated_by_name = req.user.name;

  if (wasCompleted) {
    await audit(req, 'INTERVIEW_EDITED_AFTER_COMPLETION', row.id, {
      postCompletionEdits: Number(updated.post_completion_edits) || 0,
    });
  } else if (shouldAuditEdit(row.id, req.user.id)) {
    await audit(req, 'INTERVIEW_EDITED', row.id, { status: updated.status });
  }

  res.json({ ok: true, record: recordDetail(updated, req.user) });
}));

/**
 * Complete. Only the four identifying facts are mandatory — an interview note
 * with unanswered questions is a normal interview note, not an invalid one, so
 * blank questions are REPORTED back and never refused.
 */
router.post('/api/interviews/records/:id/complete', safe(async (req, res) => {
  const row = await loadRecord(req, req.params.id);
  if (!row) return notFound(res);
  if (!canEditRecord(req.user, row)) {
    return res.status(403).json({ error: 'Forbidden', message: 'Only the interviewer who created this record, or the practice owner, can complete it.' });
  }
  if (row.status === 'archived') {
    return res.status(409).json({ error: 'archived', message: 'Restore this interview before completing it.' });
  }
  if (row.status === 'completed') {
    return res.json({ ok: true, record: recordDetail(row, req.user), alreadyCompleted: true });
  }

  const missing = [];
  if (!row.candidate_name) missing.push('Candidate name');
  if (!row.interview_date) missing.push('Interview date');
  if (!row.position) missing.push('Role / position');
  if (!row.interviewers) missing.push('Interviewer');
  if (missing.length) {
    return res.status(422).json({
      error: 'incomplete_details',
      message: `Add the interview's ${missing.join(', ')} before completing it.`,
      missing,
    });
  }

  const { rows } = await pool.query(
    `UPDATE interview_records
        SET status = 'completed', completed_at = NOW(), completed_by = $1,
            updated_by = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *`,
    [req.user.id, row.id]
  );
  const updated = rows[0];
  updated.created_by_name = row.created_by_name;
  updated.updated_by_name = req.user.name;

  await audit(req, 'INTERVIEW_COMPLETED', row.id, { templateKey: row.template_key });

  const progress = tpl.progressOf(row.template_schema || {}, row.responses || {});
  res.json({
    ok: true,
    record: recordDetail(updated, req.user),
    // Advisory, never a blocker: the interviewer is told what they left blank.
    blankQuestions: progress.blank.length,
  });
}));

router.post('/api/interviews/records/:id/reopen', safe(async (req, res) => {
  const row = await loadRecord(req, req.params.id);
  if (!row) return notFound(res);
  if (!canEditRecord(req.user, row)) {
    return res.status(403).json({ error: 'Forbidden', message: 'Only the interviewer who created this record, or the practice owner, can reopen it.' });
  }
  if (row.status !== 'completed') {
    return res.status(409).json({ error: 'not_completed', message: 'Only a completed interview can be reopened.' });
  }

  const { rows } = await pool.query(
    `UPDATE interview_records
        SET status = 'in_progress', reopened_at = NOW(), updated_by = $1, updated_at = NOW()
      WHERE id = $2 RETURNING *`,
    [req.user.id, row.id]
  );
  const updated = rows[0];
  updated.created_by_name = row.created_by_name;
  updated.updated_by_name = req.user.name;

  await audit(req, 'INTERVIEW_REOPENED', row.id, {});
  res.json({ ok: true, record: recordDetail(updated, req.user) });
}));

router.post('/api/interviews/records/:id/archive', safe(async (req, res) => {
  const row = await loadRecord(req, req.params.id);
  if (!row) return notFound(res);
  if (!canEditRecord(req.user, row)) {
    return res.status(403).json({ error: 'Forbidden', message: 'Only the interviewer who created this record, or the practice owner, can archive it.' });
  }
  const { rows } = await pool.query(
    `UPDATE interview_records
        SET status = 'archived', archived_at = NOW(), updated_by = $1, updated_at = NOW()
      WHERE id = $2 RETURNING *`,
    [req.user.id, row.id]
  );
  const updated = rows[0];
  updated.created_by_name = row.created_by_name;
  await audit(req, 'INTERVIEW_ARCHIVED', row.id, {});
  res.json({ ok: true, record: recordDetail(updated, req.user) });
}));

router.post('/api/interviews/records/:id/restore', safe(async (req, res) => {
  const row = await loadRecord(req, req.params.id);
  if (!row) return notFound(res);
  if (!canEditRecord(req.user, row)) {
    return res.status(403).json({ error: 'Forbidden', message: 'Only the interviewer who created this record, or the practice owner, can restore it.' });
  }
  if (row.status !== 'archived') {
    return res.status(409).json({ error: 'not_archived', message: 'That interview is not archived.' });
  }
  // Restore to what it was: completed if it had been completed, otherwise
  // back into progress. An archived record never loses its history.
  const restored = row.completed_at ? 'completed' : 'in_progress';
  const { rows } = await pool.query(
    `UPDATE interview_records
        SET status = $1, archived_at = NULL, updated_by = $2, updated_at = NOW()
      WHERE id = $3 RETURNING *`,
    [restored, req.user.id, row.id]
  );
  const updated = rows[0];
  updated.created_by_name = row.created_by_name;
  await audit(req, 'INTERVIEW_RESTORED', row.id, { status: restored });
  res.json({ ok: true, record: recordDetail(updated, req.user) });
}));

/**
 * Permanent deletion — Owner only, by role.
 *
 * Archiving is what everybody else gets, and what the UI offers first: a
 * recruitment record that has been read, quoted in a hiring decision or
 * referred to in a reference check should not be removable by whoever typed
 * it. Deletion exists because a mis-keyed record (wrong candidate, duplicate,
 * created against the wrong template) is real, and the Owner is the data
 * controller who may decide that.
 */
router.delete('/api/interviews/records/:id', ownerOnly, safe(async (req, res) => {
  const row = await loadRecord(req, req.params.id);
  if (!row) return notFound(res);
  await pool.query('DELETE FROM interview_records WHERE id = $1', [row.id]);
  await audit(req, 'INTERVIEW_DELETED', row.id, {
    templateKey: row.template_key, status: row.status,
  });
  res.json({ ok: true, deleted: row.id });
}));

// ═════════════════════════════════════════════════════════════════════════════
//  PDF EXPORT
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Deliver PDF bytes.
 *
 * The filename is built from sanitised parts and then re-scrubbed of anything
 * that could terminate or extend the header — a candidate called
 * `"; attachment; filename="payroll` must not be able to rewrite the
 * disposition. `?disposition=inline` is what the Print action uses: the same
 * document, rendered by the browser's own viewer, so what prints is exactly
 * what downloads.
 */
function sendPdf(req, res, bytes, filename, opts = {}) {
  const clean = String(filename).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 180) || 'interview.pdf';
  const inline = req.query.disposition === 'inline';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', bytes.length);
  res.setHeader('Cache-Control', opts.cache || 'no-store, private');
  if (!opts.cache) res.setHeader('Pragma', 'no-cache');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${clean}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(bytes);
}

router.get('/api/interviews/records/:id/pdf', safe(async (req, res) => {
  const row = await loadRecord(req, req.params.id);
  if (!row) return notFound(res);

  const schema = row.template_schema;
  if (!schema || !Array.isArray(schema.sections)) {
    return res.status(500).json({ error: 'pdf_failed', message: 'This interview has no template snapshot to render.' });
  }

  let out;
  try {
    out = await pdfRenderer.renderInterviewPdf({ template: schema, mode: 'populated', record: row });
  } catch (err) {
    log.error('interview pdf failed', { recordId: row.id, error: err.message });
    return res.status(500).json({
      error: 'pdf_failed',
      message: 'The interview PDF could not be generated. Your answers are safe in the portal.',
    });
  }

  await audit(req, 'INTERVIEW_PDF_EXPORTED', row.id, {
    pageCount: out.pageCount, inline: req.query.disposition === 'inline',
  });
  sendPdf(req, res, out.bytes, pdfRenderer.recordFilename(schema, row));
}));

// ═════════════════════════════════════════════════════════════════════════════
//  DELEGATION — the Owner grants Interview Preparation access to an Admin
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Which roles may hold a delegated interview permission.
 *
 * Administration only. Interview Preparation exists so an authorised
 * administrator can interview applicants on the Owner's behalf; a clinician's
 * job does not involve reading a candidate's salary expectations, and a
 * read-only account cannot write one. Narrowing the grant here means a
 * mis-click in the delegation UI cannot open recruitment records to the
 * clinical side of the practice.
 */
const DELEGABLE_ROLES = new Set(['admin']);

router.get('/api/interviews/permissions', ownerOnly, safe(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, email, role, permissions, is_active
       FROM users
      WHERE organisation_id IS NOT DISTINCT FROM $1
        AND role IN ('owner', 'admin')
        AND is_active = TRUE
      ORDER BY role, name`,
    [orgOf(req)]
  );

  res.json({
    ok: true,
    available: INTERVIEW_PERMISSIONS,
    groups: INTERVIEW_PERMISSION_GROUPS,
    labels: INTERVIEW_PERMISSION_LABELS,
    delegableRoles: [...DELEGABLE_ROLES],
    users: rows.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      // The Owner's own access is implicit and is shown as such, never as a
      // stored grant that could be taken away.
      implicit: u.role === 'owner',
      granted: u.role === 'owner'
        ? INTERVIEW_PERMISSIONS
        : (Array.isArray(u.permissions) ? u.permissions : []).filter((p) => INTERVIEW_PERMISSIONS.includes(p)),
    })),
  });
}));

router.put('/api/interviews/permissions/:userId', ownerOnly, safe(async (req, res) => {
  const { userId } = req.params;
  if (!isUuid(userId)) return notFound(res);

  const requested = Array.isArray(req.body?.permissions) ? req.body.permissions : [];
  const invalid = requested.filter((p) => !INTERVIEW_PERMISSIONS.includes(p));
  if (invalid.length) {
    return res.status(400).json({ error: 'unknown_permission', message: `Unknown permission: ${invalid[0]}` });
  }
  // view_all without access would be a permission nobody can use — the module
  // itself is gated on access. Refusing it is clearer than silently adding it.
  if (requested.includes('interviews.view_all') && !requested.includes('interviews.access')) {
    return res.status(400).json({
      error: 'invalid_combination',
      message: 'Seeing all interviews requires Interview Preparation access as well.',
    });
  }

  const { rows: targets } = await pool.query(
    `SELECT id, role, permissions FROM users
      WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2 LIMIT 1`,
    [userId, orgOf(req)]
  );
  const target = targets[0];
  if (!target) return notFound(res);
  if (target.role === 'owner') {
    return res.status(409).json({ error: 'owner_implicit', message: 'The owner already has full Interview Preparation access.' });
  }
  if (!DELEGABLE_ROLES.has(target.role)) {
    return res.status(409).json({
      error: 'role_not_delegable',
      message: 'Interview Preparation can only be given to an administrator. '
        + 'Interview records hold recruitment information and are not a clinical surface.',
    });
  }

  // This endpoint owns the interviews.* namespace and nothing else: any
  // onboarding or other grant already on the record is preserved untouched.
  const existing = Array.isArray(target.permissions) ? target.permissions : [];
  const kept = existing.filter((p) => !INTERVIEW_PERMISSIONS.includes(p));
  const next = [...new Set([...kept, ...requested])];

  await pool.query(
    'UPDATE users SET permissions = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
    [userId, JSON.stringify(next)]
  );

  const before = existing.filter((p) => INTERVIEW_PERMISSIONS.includes(p));
  await audit(req, 'INTERVIEW_ACCESS_CHANGED', userId, {
    targetUserId: userId,
    role: target.role,
    granted: requested,
    // Named explicitly so a later review can see what was taken away too.
    revoked: before.filter((p) => !requested.includes(p)),
  });

  res.json({ ok: true, userId, permissions: requested });
}));

module.exports = router;
