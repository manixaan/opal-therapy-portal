'use strict';

/**
 * RESOURCE HUB ROUTES (Phase R1 foundation)
 *
 * Governed resource repository. Backend-enforced RBAC:
 *   - owner/admin: create, upload, approve/reject, archive, folders
 *   - therapist:   view/search APPROVED, download, favourite, submit drafts
 *   - read_only:   view approved unrestricted list only (no downloads of
 *                  restricted items; write guard in requireAuth already
 *                  blocks their unsafe methods)
 * Files use the existing document-storage abstraction — private, authenticated
 * downloads only. Client-linked suggestions / AI / external sharing are
 * LATER phases behind fail-closed flags (not implemented here).
 *
 * Flags (fail closed except the read flag):
 *   ENABLE_RESOURCE_HUB (default on) · ENABLE_RESOURCE_CLIENT_SUGGESTIONS /
 *   ENABLE_RESOURCE_AI_SUGGESTIONS / ENABLE_RESOURCE_EXTERNAL_SHARING
 *   (all require literal 'true'; no routes exist for them yet by design).
 */

const express = require('express');
const router = express.Router();
const db = require('./database');
const { pool } = require('./database');
const { requireAuth, requireRole } = require('./permissions');
const { validateUpload } = require('./profile-routes');
const log = require('./logger').createLogger('resources');

const hubEnabled = () => process.env.ENABLE_RESOURCE_HUB !== 'false';
const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));
// RBAC 2026-08-06: resource management is owner-only (admin has no Resources access).
const canManage = (u) => u?.role === 'owner';
const orgOf = (req) => req.user?.organisation_id || null;

router.use('/api/resources', requireAuth, (req, res, next) => {
  if (!hubEnabled()) return res.status(403).json({ error: 'Resource Hub is disabled', code: 'resource_hub_disabled' });
  // RBAC 2026-08-06: admin has no Resource Hub access (default-deny; a future
  // explicit permission can reopen it). Owner manages; therapists/read_only view.
  if (req.user?.role === 'admin') {
    return res.status(403).json({ error: 'You do not have access to this area. Please contact the practice owner if you believe this is incorrect.', code: 'role_denied' });
  }
  next();
});


// Async-handler guard: an unhandled rejection in an Express 4 async handler
// never responds (the request hangs; jest never exits — the R1 bench bug).
const safe = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  log.error('resources route error', { error: err, path: req.path });
  if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
});

function audit(req, action, targetId, metadata) {
  return db.logAuditEvent({
    actorUserId: req.user?.id, action, targetType: 'resource', targetId,
    ipAddress: req.ip, organisationId: orgOf(req), metadata: metadata || null,
  }).catch(() => {});
}

// ── Folders + tags ───────────────────────────────────────────────────────────

router.get('/api/resources/folders', safe(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM resource_folders WHERE organisation_id IS NOT DISTINCT FROM $1 ORDER BY sort_order, name', [orgOf(req)]);
  res.json({ folders: rows });
}));

router.post('/api/resources/folders', requireRole('owner'), safe(async (req, res) => {
  const { name, parentId, description } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const { rows } = await pool.query(
    `INSERT INTO resource_folders (organisation_id, parent_id, name, description, created_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [orgOf(req), parentId || null, name, description || null, req.user.id]);
  await audit(req, 'resource.folder_created', rows[0].id, { name });
  res.status(201).json({ folder: rows[0] });
}));

router.get('/api/resources/tags', safe(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM resource_tags ORDER BY category, name');
  res.json({ tags: rows });
}));

// ── Resources ────────────────────────────────────────────────────────────────

// List: therapists/read_only see APPROVED only; owner/admin may filter status.
router.get('/api/resources', safe(async (req, res) => {
  const params = [orgOf(req)];
  let where = 'r.organisation_id IS NOT DISTINCT FROM $1';
  const status = canManage(req.user) ? (req.query.status || null) : 'approved';
  if (status) { params.push(status); where += ` AND r.status = $${params.length}`; }
  if (!canManage(req.user)) where += ` AND r.visibility = 'staff'`;
  if (req.query.folderId && isUuid(req.query.folderId)) { params.push(req.query.folderId); where += ` AND r.folder_id = $${params.length}`; }
  if (req.query.type) { params.push(req.query.type); where += ` AND r.resource_type = $${params.length}`; }
  if (req.query.q) { params.push('%' + req.query.q + '%'); where += ` AND (r.title ILIKE $${params.length} OR r.description ILIKE $${params.length})`; }
  if (req.query.tagId && isUuid(req.query.tagId)) {
    params.push(req.query.tagId);
    where += ` AND EXISTS (SELECT 1 FROM resource_tag_links l WHERE l.resource_id = r.id AND l.tag_id = $${params.length})`;
  }
  // ?saved=1 → only the caller's favourites ($N below is the appended user id).
  if (req.query.saved === '1') {
    where += ` AND EXISTS (SELECT 1 FROM resource_favourites f WHERE f.resource_id = r.id AND f.user_id = $${params.length + 1})`;
  }
  const { rows } = await pool.query(
    `SELECT r.*,
            COALESCE(json_agg(json_build_object('id',t.id,'category',t.category,'name',t.name))
                     FILTER (WHERE t.id IS NOT NULL), '[]') AS tags,
            EXISTS (SELECT 1 FROM resource_favourites f WHERE f.resource_id = r.id AND f.user_id = $${params.length + 1}) AS favourited,
            (SELECT COUNT(*) FROM resource_files rf WHERE rf.resource_id = r.id) AS file_count
       FROM resources r
       LEFT JOIN resource_tag_links tl ON tl.resource_id = r.id
       LEFT JOIN resource_tags t ON t.id = tl.tag_id
      WHERE ${where}
      GROUP BY r.id ORDER BY r.updated_at DESC LIMIT 300`,
    [...params, req.user.id]);
  res.json({ resources: rows });
}));

// Create (owner/admin create directly; therapists create DRAFTS for review).
router.post('/api/resources', safe(async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.title) return res.status(400).json({ error: 'title required' });
    const status = canManage(req.user) ? (b.status === 'approved' ? 'approved' : 'draft') : 'draft';
    // Approval fields computed in JS — reusing a parameter inside SQL CASE
    // expressions made pg's type inference fail ("inconsistent types for $6").
    const isApproved = status === 'approved';
    const reviewDue = isApproved
      ? new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().slice(0, 10)
      : null;
    const { rows } = await pool.query(
      `INSERT INTO resources (organisation_id, folder_id, title, description, resource_type,
          status, external_url, source_reference, copyright_status, evidence_level, age_range,
          safety_notes, usage_instructions, created_by, approved_by, approved_at, review_due_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      [orgOf(req), isUuid(b.folderId) ? b.folderId : null, b.title, b.description || null,
       b.resourceType || null, status, b.externalUrl || null, b.sourceReference || null,
       b.copyrightStatus || null, b.evidenceLevel || null, b.ageRange || null,
       b.safetyNotes || null, b.usageInstructions || null, req.user.id,
       isApproved ? req.user.id : null, isApproved ? new Date() : null, reviewDue]);
    const resource = rows[0];
    for (const tagId of (b.tagIds || []).filter(isUuid)) {
      await pool.query('INSERT INTO resource_tag_links (resource_id, tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [resource.id, tagId]);
    }
    await audit(req, 'resource.created', resource.id, { title: b.title, status });
    res.status(201).json({ resource });
  } catch (err) {
    log.error('resource create failed', { error: err });
    res.status(500).json({ error: 'Failed to create resource' });
  }
}));

// Upload a file to a resource (owner/admin only) via the storage abstraction.
router.post('/api/resources/:id/files', requireRole('owner'), safe(async (req, res) => {
  try {
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });
    const { fileName, fileMime, fileData, fileSizeBytes } = req.body || {};
    const uploadError = validateUpload({ fileName, fileMime, fileData });
    if (uploadError) return res.status(415).json({ error: uploadError });
    const r = await pool.query('SELECT id FROM resources WHERE id=$1 AND organisation_id IS NOT DISTINCT FROM $2', [req.params.id, orgOf(req)]);
    if (!r.rows.length) return res.status(404).json({ error: 'Not found' });

    const { getBackend, getBackendName } = require('./storage');
    const backendName = getBackendName();
    const ins = await pool.query(
      `INSERT INTO resource_files (resource_id, file_name, file_mime, file_size_bytes, file_data, storage_backend)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [req.params.id, fileName, fileMime, fileSizeBytes || null,
       backendName === 'db' ? fileData : null, backendName]);
    const fileId = ins.rows[0].id;
    if (backendName !== 'db' && fileData) {
      try {
        const put = await getBackend().put({ userId: req.user.id, docId: fileId, fileName, mime: fileMime, base64: fileData });
        await pool.query('UPDATE resource_files SET storage_backend=$2, storage_key=$3, file_data=NULL WHERE id=$1',
          [fileId, put.backend, put.storageKey]);
      } catch (putErr) {
        await pool.query('DELETE FROM resource_files WHERE id=$1', [fileId]);
        throw putErr;
      }
    }
    await pool.query('UPDATE resource_files SET uploaded_by=$2 WHERE id=$1', [fileId, req.user.id]);
    await audit(req, 'resource.file_uploaded', req.params.id, { fileName, mime: fileMime });
    res.status(201).json({ ok: true, fileId });
  } catch (err) {
    log.error('resource upload failed', { error: err });
    res.status(500).json({ error: 'Upload failed' });
  }
}));

// Private, authenticated download. Therapists: approved resources only.
router.get('/api/resources/:id/download', safe(async (req, res) => {
  try {
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });
    const { rows } = await pool.query(
      `SELECT rf.*, r.status, r.visibility, r.title FROM resource_files rf
        JOIN resources r ON r.id = rf.resource_id
       WHERE rf.resource_id = $1 AND r.organisation_id IS NOT DISTINCT FROM $2
       ORDER BY rf.uploaded_at DESC LIMIT 1`, [req.params.id, orgOf(req)]);
    const f = rows[0];
    if (!f) return res.status(404).json({ error: 'Not found' });
    if (!canManage(req.user) && f.status !== 'approved') return res.status(403).json({ error: 'Resource not approved' });
    if (req.user.role === 'read_only' && f.visibility !== 'staff') return res.status(403).json({ error: 'Restricted' });

    const { getBackend } = require('./storage');
    let base64 = null;
    try {
      ({ base64 } = await getBackend(f.storage_backend || 'db').get({
        backend: f.storage_backend, storageKey: f.storage_key, fileData: f.file_data }));
    } catch (_) { /* missing object → 404 below */ }
    if (!base64) return res.status(404).json({ error: 'File content unavailable' });
    await audit(req, 'resource.downloaded', req.params.id, { fileName: f.file_name });
    res.setHeader('Content-Type', f.file_mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(f.file_name || 'resource')}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(Buffer.from(base64, 'base64'));
  } catch (err) {
    log.error('resource download failed', { error: err });
    res.status(500).json({ error: 'Download failed' });
  }
}));

// Favourites (any authenticated staff role; read_only blocked by write guard).
router.post('/api/resources/:id/favourite', safe(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });
  await pool.query('INSERT INTO resource_favourites (user_id, resource_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user.id, req.params.id]);
  await audit(req, 'resource.favourited', req.params.id);
  res.json({ ok: true });
}));
router.delete('/api/resources/:id/favourite', safe(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });
  await pool.query('DELETE FROM resource_favourites WHERE user_id=$1 AND resource_id=$2', [req.user.id, req.params.id]);
  res.json({ ok: true });
}));

// ── Feedback, link health, kit progress (Resource Hub V1) ────────────────────

// Lightweight helpful/not-helpful signal — audit-only, no table.
router.post('/api/resources/:id/feedback', safe(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const r = await pool.query('SELECT id FROM resources WHERE id=$1 AND organisation_id IS NOT DISTINCT FROM $2', [req.params.id, orgOf(req)]);
  if (!r.rows.length) return res.status(404).json({ error: 'Not found' });
  await audit(req, 'resource.feedback', req.params.id, { helpful: req.body?.helpful === true });
  res.json({ ok: true });
}));

// Report a broken/suspect link. Flags only — NO outbound HTTP check exists.
router.post('/api/resources/:id/report', safe(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const { rows } = await pool.query(
    `UPDATE resources SET link_status='reported' WHERE id=$1 AND organisation_id IS NOT DISTINCT FROM $2 RETURNING id`,
    [req.params.id, orgOf(req)]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  await audit(req, 'resource.reported', req.params.id, { reason: (req.body?.reason || '').slice(0, 200) });
  res.json({ ok: true });
}));

// Owner marks a link ok/broken (or clears). Format-only — no fetch, ever.
router.post('/api/resources/:id/link-status', requireRole('owner'), safe(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const status = req.body?.status ?? null;
  if (status !== null && !['ok', 'broken'].includes(status)) {
    return res.status(400).json({ error: "status must be 'ok', 'broken' or null" });
  }
  const { rows } = await pool.query(
    `UPDATE resources SET link_status=$3, link_checked_at=NOW()
      WHERE id=$1 AND organisation_id IS NOT DISTINCT FROM $2 RETURNING id`,
    [req.params.id, orgOf(req), status]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  await audit(req, 'resource.link_status_changed', req.params.id, { status });
  res.json({ ok: true });
}));

// Per-user starter-kit progress. GET open to all hub roles (read_only reads
// are fine); PUT is blocked for read_only by the global write choke point.
router.get('/api/resources/kits/progress', safe(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT kit_key, completed_steps FROM user_resource_progress WHERE user_id = $1', [req.user.id]);
  const progress = {};
  for (const r of rows) progress[r.kit_key] = r.completed_steps || [];
  res.json({ progress });
}));

router.put('/api/resources/kits/:kitKey/progress', safe(async (req, res) => {
  const kitKey = String(req.params.kitKey || '');
  if (!kitKey || kitKey.length > 100) return res.status(400).json({ error: 'Invalid kit key' });
  const steps = req.body?.completedSteps;
  if (!Array.isArray(steps) || steps.length > 50 || steps.some((s) => typeof s !== 'string' || s.length > 200)) {
    return res.status(400).json({ error: 'completedSteps must be an array of up to 50 strings' });
  }
  await pool.query(
    `INSERT INTO user_resource_progress (user_id, kit_key, completed_steps, updated_at)
     VALUES ($1,$2,$3,NOW())
     ON CONFLICT (user_id, kit_key) DO UPDATE SET completed_steps = EXCLUDED.completed_steps, updated_at = NOW()`,
    [req.user.id, kitKey, JSON.stringify(steps)]);
  res.json({ ok: true, kitKey, completedSteps: steps });
}));

// Governance: submit / approve / reject / archive.
router.post('/api/resources/:id/submit', safe(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const { rows } = await pool.query(
    `UPDATE resources SET status='submitted_for_review', updated_at=NOW()
      WHERE id=$1 AND organisation_id IS NOT DISTINCT FROM $2 AND status='draft'
        AND (created_by = $3 OR $4) RETURNING id`,
    [req.params.id, orgOf(req), req.user.id, canManage(req.user)]);
  if (!rows.length) return res.status(404).json({ error: 'Not found or not a draft you own' });
  await audit(req, 'resource.submitted_for_review', req.params.id);
  res.json({ ok: true });
}));

router.post('/api/resources/:id/approve', requireRole('owner'), safe(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const { rows } = await pool.query(
    `UPDATE resources SET status='approved', approved_by=$3, approved_at=NOW(),
            review_due_at=(CURRENT_DATE + INTERVAL '12 months')::date, updated_at=NOW()
      WHERE id=$1 AND organisation_id IS NOT DISTINCT FROM $2 RETURNING id`,
    [req.params.id, orgOf(req), req.user.id]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  await audit(req, 'resource.approved', req.params.id);
  res.json({ ok: true });
}));

router.post('/api/resources/:id/reject', requireRole('owner'), safe(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });
  await pool.query(`UPDATE resources SET status='rejected', updated_at=NOW() WHERE id=$1 AND organisation_id IS NOT DISTINCT FROM $2`, [req.params.id, orgOf(req)]);
  await audit(req, 'resource.rejected', req.params.id, { reason: (req.body?.reason || '').slice(0, 200) });
  res.json({ ok: true });
}));

router.delete('/api/resources/:id/archive', requireRole('owner'), safe(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });
  await pool.query(`UPDATE resources SET status='archived', updated_at=NOW() WHERE id=$1 AND organisation_id IS NOT DISTINCT FROM $2`, [req.params.id, orgOf(req)]);
  await audit(req, 'resource.archived', req.params.id);
  res.json({ ok: true });
}));

module.exports = router;
