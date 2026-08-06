'use strict';

/**
 * AI RESOURCE STUDIO DRAFTS (Resource Hub V1)
 *
 * LOCAL draft store only — there are NO external AI calls anywhere in this
 * file (or the backend). The provider flag ENABLE_RESOURCE_AI_SUGGESTIONS
 * stays false; /api/resources/ai-drafts/config simply reports it so the
 * frontend can hide generation UI.
 *
 * RBAC (default-deny): drafts are a clinical-content workspace.
 *   - therapist/owner: own drafts (create/edit/submit)
 *   - owner:           review queue (submitted_for_review only — never other
 *                      users' private drafts), request-changes/decline/approve
 *   - admin:           403 on everything
 *   - read_only:       403 on everything
 * Approve publishes an APPROVED resource into the Resource Hub and links it
 * back via published_resource_id. Nothing is deleted.
 * All draft mutations are audited (targetType 'ai_draft'; metadata carries
 * status only — never draft content).
 */

const express = require('express');
const router = express.Router();
const db = require('./database');
const { pool } = require('./database');
const { requireAuth } = require('./permissions');
const log = require('./logger').createLogger('ai-drafts');

const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));
const orgOf = (req) => req.user?.organisation_id || null;

router.use('/api/resources/ai-drafts', requireAuth, (req, res, next) => {
  if (req.user?.role === 'admin' || req.user?.role === 'read_only') {
    return res.status(403).json({
      error: 'You do not have access to this area. Please contact the practice owner if you believe this is incorrect.',
      code: 'role_denied',
    });
  }
  next();
});

// Async-handler guard (same pattern as resources-routes).
const safe = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  log.error('ai-drafts route error', { error: err, path: req.path });
  if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
});

function audit(req, action, targetId, metadata) {
  return db.logAuditEvent({
    actorUserId: req.user?.id, action, targetType: 'ai_draft', targetId,
    ipAddress: req.ip, organisationId: orgOf(req), metadata: metadata || null,
  }).catch(() => {});
}

/** Statuses the owner may see on other users' drafts (never private_draft). */
const OWNER_VISIBLE_STATUSES = ['submitted_for_review', 'changes_requested', 'published', 'declined'];

/** Load a draft the caller may see, or null (→ 404). */
async function loadVisible(req, id) {
  if (!isUuid(id)) return null;
  const { rows } = await pool.query(
    'SELECT * FROM resource_ai_drafts WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2',
    [id, orgOf(req)]);
  const draft = rows[0];
  if (!draft) return null;
  if (draft.user_id === req.user.id) return draft;
  if (req.user.role === 'owner' && OWNER_VISIBLE_STATUSES.includes(draft.status)) return draft;
  return null;
}

// ── Config (provider flag stays off — reported for the frontend) ─────────────

router.get('/api/resources/ai-drafts/config', safe(async (req, res) => {
  res.json({ aiEnabled: process.env.ENABLE_RESOURCE_AI_SUGGESTIONS === 'true' });
}));

// ── CRUD ─────────────────────────────────────────────────────────────────────

router.post('/api/resources/ai-drafts', safe(async (req, res) => {
  const b = req.body || {};
  if (!(typeof b.title === 'string' && b.title.trim())) {
    return res.status(400).json({ error: 'title required' });
  }
  const { rows } = await pool.query(
    `INSERT INTO resource_ai_drafts (organisation_id, user_id, title, resource_type, topic,
        audience, tone, format, instructions, content)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [orgOf(req), req.user.id, b.title.trim(), b.resourceType || null, b.topic || null,
     b.audience || null, b.tone || null, b.format || null, b.instructions || null, b.content || null]);
  await audit(req, 'ai_draft.created', rows[0].id, { status: rows[0].status });
  res.status(201).json({ draft: rows[0] });
}));

// Own drafts; owner may pass ?queue=1 for the review queue (submitted only).
router.get('/api/resources/ai-drafts', safe(async (req, res) => {
  if (req.query.queue === '1' && req.user.role === 'owner') {
    const { rows } = await pool.query(
      `SELECT d.id, d.title, d.resource_type, d.topic, d.status, d.updated_at,
              u.name AS author_name, d.user_id
         FROM resource_ai_drafts d JOIN users u ON u.id = d.user_id
        WHERE d.organisation_id IS NOT DISTINCT FROM $1 AND d.status = 'submitted_for_review'
        ORDER BY d.updated_at ASC LIMIT 200`, [orgOf(req)]);
    return res.json({ drafts: rows, queue: true });
  }
  const { rows } = await pool.query(
    `SELECT * FROM resource_ai_drafts WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 200`,
    [req.user.id]);
  res.json({ drafts: rows });
}));

router.get('/api/resources/ai-drafts/:id', safe(async (req, res) => {
  const draft = await loadVisible(req, req.params.id);
  if (!draft) return res.status(404).json({ error: 'Not found' });
  res.json({ draft });
}));

const EDIT_FIELDS = [
  ['title', 'title'], ['resourceType', 'resource_type'], ['topic', 'topic'],
  ['audience', 'audience'], ['tone', 'tone'], ['format', 'format'],
  ['instructions', 'instructions'], ['content', 'content'],
];

router.patch('/api/resources/ai-drafts/:id', safe(async (req, res) => {
  const draft = await loadVisible(req, req.params.id);
  if (!draft) return res.status(404).json({ error: 'Not found' });
  if (draft.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Only the author can edit a draft' });
  }
  if (!['private_draft', 'changes_requested'].includes(draft.status)) {
    return res.status(409).json({ error: `Cannot edit a draft in status '${draft.status}'`, code: 'invalid_status_transition' });
  }
  const b = req.body || {};
  if (b.title !== undefined && !(typeof b.title === 'string' && b.title.trim())) {
    return res.status(400).json({ error: 'title must be a non-empty string' });
  }
  const sets = [];
  const params = [draft.id];
  for (const [bodyKey, col] of EDIT_FIELDS) {
    if (b[bodyKey] !== undefined) {
      params.push(bodyKey === 'title' ? b.title.trim() : b[bodyKey]);
      sets.push(`${col} = $${params.length}`);
    }
  }
  if (!sets.length) return res.status(400).json({ error: 'No editable fields supplied' });
  const { rows } = await pool.query(
    `UPDATE resource_ai_drafts SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING *`, params);
  await audit(req, 'ai_draft.edited', draft.id, { status: rows[0].status });
  res.json({ draft: rows[0] });
}));

// ── Review workflow ──────────────────────────────────────────────────────────

/**
 * Shared transition: visibility (404) → from-status check (409) → update.
 * Returns the updated row, or null after having sent the error response.
 */
async function transition(req, res, { from, to, event, sets = {} }) {
  const draft = await loadVisible(req, req.params.id);
  if (!draft) {
    res.status(404).json({ error: 'Not found' });
    return null;
  }
  if (!from.includes(draft.status)) {
    res.status(409).json({ error: `Cannot move a draft from '${draft.status}' to '${to}'`, code: 'invalid_status_transition' });
    return null;
  }
  const params = [draft.id, draft.status, to];
  const setSql = ['status = $3', 'updated_at = NOW()'];
  for (const [col, value] of Object.entries(sets)) {
    params.push(value);
    setSql.push(`${col} = $${params.length}`);
  }
  const { rows } = await pool.query(
    `UPDATE resource_ai_drafts SET ${setSql.join(', ')} WHERE id = $1 AND status = $2 RETURNING *`, params);
  if (!rows.length) {
    res.status(409).json({ error: 'Draft changed concurrently — reload and retry', code: 'invalid_status_transition' });
    return null;
  }
  await audit(req, `ai_draft.${event}`, draft.id, { status: to });
  return rows[0];
}

router.post('/api/resources/ai-drafts/:id/submit', safe(async (req, res) => {
  const draft = await loadVisible(req, req.params.id);
  if (draft && draft.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Only the author can submit a draft' });
  }
  const updated = await transition(req, res, {
    from: ['private_draft', 'changes_requested'], to: 'submitted_for_review', event: 'submitted',
  });
  if (updated) res.json({ ok: true, draft: updated });
}));

function requireOwner(req, res) {
  if (req.user.role !== 'owner') {
    res.status(403).json({ error: 'Forbidden', message: 'This action requires one of: owner' });
    return false;
  }
  return true;
}

router.post('/api/resources/ai-drafts/:id/request-changes', safe(async (req, res) => {
  if (!requireOwner(req, res)) return;
  const comment = (req.body?.comment || '').trim();
  if (!comment) return res.status(400).json({ error: 'comment is required when requesting changes' });
  const updated = await transition(req, res, {
    from: ['submitted_for_review'], to: 'changes_requested', event: 'request_changes',
    sets: { review_comment: comment },
  });
  if (updated) res.json({ ok: true, draft: updated });
}));

router.post('/api/resources/ai-drafts/:id/decline', safe(async (req, res) => {
  if (!requireOwner(req, res)) return;
  const updated = await transition(req, res, {
    from: ['submitted_for_review', 'changes_requested'], to: 'declined', event: 'declined',
    sets: { review_comment: req.body?.comment || null },
  });
  if (updated) res.json({ ok: true, draft: updated });
}));

// Approve → publish an APPROVED resource into the hub; draft is kept
// (status 'published', linked via published_resource_id). Deletes nothing.
router.post('/api/resources/ai-drafts/:id/approve', safe(async (req, res) => {
  if (!requireOwner(req, res)) return;
  const draft = await loadVisible(req, req.params.id);
  if (!draft) return res.status(404).json({ error: 'Not found' });
  if (draft.status !== 'submitted_for_review') {
    return res.status(409).json({ error: `Cannot publish a draft in status '${draft.status}'`, code: 'invalid_status_transition' });
  }
  const description = draft.topic
    ? `Practice resource on ${draft.topic}`
    : ((draft.content || '').slice(0, 200) || null);
  const { rows: resourceRows } = await pool.query(
    `INSERT INTO resources (organisation_id, title, description, resource_type, status,
        approved_by, approved_at, review_due_at, usage_instructions, created_by, source_reference)
     VALUES ($1,$2,$3,$4,'approved',$5,NOW(),(CURRENT_DATE + INTERVAL '12 months')::date,$6,$7,$8)
     RETURNING *`,
    [draft.organisation_id, draft.title, description, draft.resource_type || 'template',
     req.user.id, draft.content || null, draft.user_id,
     'AI Resource Studio draft (manually authored)']);
  const resource = resourceRows[0];
  const { rows } = await pool.query(
    `UPDATE resource_ai_drafts SET status = 'published', published_resource_id = $2,
            review_comment = $3, updated_at = NOW()
      WHERE id = $1 AND status = 'submitted_for_review' RETURNING *`,
    [draft.id, resource.id, req.body?.comment || null]);
  if (!rows.length) {
    // Lost the race — remove the just-created resource and report the conflict.
    await pool.query('DELETE FROM resources WHERE id = $1', [resource.id]);
    return res.status(409).json({ error: 'Draft changed concurrently — reload and retry', code: 'invalid_status_transition' });
  }
  await audit(req, 'ai_draft.published', draft.id, { status: 'published' });
  await db.logAuditEvent({
    actorUserId: req.user.id, action: 'resource.published_from_draft',
    targetType: 'resource', targetId: resource.id, ipAddress: req.ip,
    organisationId: orgOf(req), metadata: { draftId: draft.id },
  }).catch(() => {});
  res.json({ ok: true, draft: rows[0], resource });
}));

module.exports = router;
