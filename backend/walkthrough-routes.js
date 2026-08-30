'use strict';

/**
 * THE WALKTHROUGH WORKSHOP — Owner authoring for the interactive induction.
 *
 * Phase 2 of docs/INDUCTION_WORKSHOP.md. Every route here is OWNER ONLY and
 * writes only to the DRAFT (walkthrough_modules.draft_steps). Nothing an
 * employee sees changes until publish cuts an immutable version, which is
 * what makes editing a built-in in place safe: a learner mid-module stays on
 * the version they were given (tutorial_progress.version, migration 032).
 *
 * The learner-facing read path is backend/tutorial-routes.js via
 * walkthrough-catalogue.js. It reads published versions only, so these routes
 * cannot disturb it before the Owner says so.
 *
 * Every write invalidates the catalogue cache. Skipping that would let a
 * publish sit invisible for up to a minute and read as a bug.
 *
 * Shape and safety rules live in walkthrough-content.js: markup stripped from
 * authored text, image sources forced site-relative, per-step roles narrowing
 * only, and no step that makes a learner CLICK something irreversible.
 */

const express = require('express');
const router = express.Router();
const db = require('./database');
const { pool } = require('./database');
const { requireAuth, requireRole } = require('./permissions');
const log = require('./logger').createLogger('walkthroughs');
const wc = require('./walkthrough-content');
const catalogue = require('./walkthrough-catalogue');
const anchors = require('./walkthrough-anchors');

const orgOf = (req) => req.user?.organisation_id || null;

router.use('/api/walkthroughs', requireAuth);
const ownerOnly = requireRole('owner');

const safe = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  log.error('walkthrough route error', { error: err, path: req.path });
  if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s) => UUID_RE.test(String(s || ''));

async function audit(req, action, targetId, metadata) {
  await db.logAuditEvent({
    action,
    targetType: 'walkthrough_module',
    targetId: targetId || null,
    actorUserId: req.user?.id,
    organisationId: orgOf(req),
    ipAddress: req.ip,
    metadata: metadata || {},
  }).catch(() => {});
}

/** Load one module scoped to the caller's organisation, or null (→ 404). */
async function loadModule(req, id, client) {
  if (!isUuid(id)) return null;
  const q = client || pool;
  const { rows } = await q.query(
    `SELECT * FROM walkthrough_modules
      WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2`,
    [id, orgOf(req)]);
  return rows[0] || null;
}

/**
 * Draft vs published: has the Owner changed anything since the last snapshot?
 * Compared on the same fields publish writes, so the badge in the editor and
 * what publishing would actually do can never disagree.
 */
function draftDiffers(row, latest) {
  if (!latest || Number(row.current_version) < 1) return true;
  return latest.title !== row.title ||
    (latest.description || null) !== (row.description || null) ||
    Number(latest.minutes) !== Number(row.minutes) ||
    JSON.stringify(latest.roles || []) !== JSON.stringify(row.roles || []) ||
    (latest.thumb || null) !== (row.thumb || null) ||
    JSON.stringify(latest.start_context || {}) !== JSON.stringify(row.start_context || {}) ||
    JSON.stringify(latest.steps || []) !== JSON.stringify(row.draft_steps || []);
}

function moduleRow(r, extra) {
  return Object.assign({
    id: r.id,
    key: r.key,
    title: r.title,
    description: r.description || '',
    group: r.group_key,
    minutes: r.minutes,
    roles: r.roles || [],
    thumb: r.thumb || '',
    start: r.start_context || {},
    current_version: Number(r.current_version),
    source: r.source,
    status: r.status,
    step_count: Array.isArray(r.draft_steps) ? r.draft_steps.length : 0,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }, extra || {});
}

/** How many people are part-way through this module, by key within the org. */
async function progressCount(orgId, key) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM tutorial_progress
      WHERE organisation_id IS NOT DISTINCT FROM $1 AND tutorial_key = $2`,
    [orgId, key]);
  return rows[0].n;
}

// ═══════════════════════════════════════════════════════════════════════════
//  The shelf
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Every walkthrough the Owner may edit — the shelf. A walkthrough built
 * inside one induction lands here and can be dropped into any other, which
 * is the reuse the workshop is built around.
 *
 * `seeded: false` means the shipped built-ins have not been imported into
 * this organisation yet: staff are being served the fallback catalogue and
 * there is nothing to edit until POST /api/tutorials/seed runs.
 */
router.get('/api/walkthroughs', ownerOnly, safe(async (req, res) => {
  const includeArchived = String(req.query.includeArchived || '') === '1';
  const { rows } = await pool.query(
    `SELECT m.*, latest.steps AS latest_steps, latest.title AS latest_title,
            latest.description AS latest_description, latest.minutes AS latest_minutes,
            latest.roles AS latest_roles, latest.thumb AS latest_thumb,
            latest.start_context AS latest_start_context,
            (SELECT COUNT(*)::int FROM tutorial_progress p
              WHERE p.organisation_id IS NOT DISTINCT FROM m.organisation_id
                AND p.tutorial_key = m.key) AS learners
       FROM walkthrough_modules m
       LEFT JOIN LATERAL (
         SELECT v.* FROM walkthrough_module_versions v
          WHERE v.module_id = m.id ORDER BY v.version DESC LIMIT 1
       ) latest ON TRUE
      WHERE m.organisation_id IS NOT DISTINCT FROM $1
        ${includeArchived ? '' : `AND m.status = 'active'`}
      ORDER BY m.status = 'active' DESC, m.group_key ASC, m.created_at ASC`,
    [orgOf(req)]);

  res.json({
    seeded: rows.length > 0,
    walkthroughs: rows.map((r) => moduleRow(r, {
      learners: r.learners,
      has_unpublished_changes: draftDiffers(r, r.latest_steps ? {
        title: r.latest_title, description: r.latest_description,
        minutes: r.latest_minutes, roles: r.latest_roles, thumb: r.latest_thumb,
        start_context: r.latest_start_context, steps: r.latest_steps,
      } : null),
    })),
    stepTypes: wc.STEP_TYPES,
    roles: wc.KNOWN_ROLES,
  });
}));

/**
 * "Check my walkthroughs still work" — every step whose spotlight points at
 * something the portal no longer offers, or at something fragile enough that
 * it might stop working without warning.
 *
 * Reported against the PUBLISHED steps wherever there are any, because that
 * is what a new employee actually meets today; a walkthrough that was never
 * published is checked as a draft and says so. The whole point is that a
 * broken tour surfaces in a report rather than in front of somebody's first
 * week.
 *
 * Static classification against the portal map — it cannot know whether an
 * anchor is on screen at this moment (that depends on tab, role and state),
 * only whether it exists at all. That is exactly the drift this catches.
 */
router.get('/api/walkthroughs/report', ownerOnly, safe(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT m.id, m.key, m.title, m.current_version, m.draft_steps,
            latest.steps AS published_steps
       FROM walkthrough_modules m
       LEFT JOIN LATERAL (
         SELECT v.steps FROM walkthrough_module_versions v
          WHERE v.module_id = m.id AND v.version = m.current_version LIMIT 1
       ) latest ON TRUE
      WHERE m.organisation_id IS NOT DISTINCT FROM $1 AND m.status = 'active'
      ORDER BY m.group_key ASC, m.created_at ASC`,
    [orgOf(req)]);

  let broken = 0;
  let fragile = 0;
  const walkthroughs = rows.map((r) => {
    const published = Array.isArray(r.published_steps) ? r.published_steps : null;
    const steps = published || (Array.isArray(r.draft_steps) ? r.draft_steps : []);
    const issues = [];
    steps.forEach((s, i) => {
      if (!s.target) return;
      const stability = anchors.stabilityOf(s.target);
      if (stability === 'anchor' || stability === 'id') return;
      if (stability === 'unknown') broken++; else fragile++;
      issues.push({
        index: i, stepKey: s.key || null, title: s.title || '',
        target: s.target, stability,
      });
    });
    return {
      id: r.id, key: r.key, title: r.title,
      checked: published ? 'published' : 'draft',
      version: Number(r.current_version),
      stepCount: steps.length,
      issues,
    };
  });

  res.json({
    walkthroughs: walkthroughs.filter((w) => w.issues.length),
    checkedCount: walkthroughs.length,
    broken,
    fragile,
  });
}));

/** The portal map: everything a spotlight can point at, grouped for picking. */
router.get('/api/walkthroughs/anchors', ownerOnly, safe(async (req, res) => {
  res.json({ anchors: anchors.anchors() });
}));

// ═══════════════════════════════════════════════════════════════════════════
//  One walkthrough
// ═══════════════════════════════════════════════════════════════════════════

/** The full draft, plus the publish history the Owner needs to read state. */
router.get('/api/walkthroughs/:id', ownerOnly, safe(async (req, res) => {
  const m = await loadModule(req, req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });

  const [versions, learners] = await Promise.all([
    pool.query(
      `SELECT v.id, v.version, v.title, v.published_at, u.name AS published_by_name
         FROM walkthrough_module_versions v
         LEFT JOIN users u ON u.id = v.published_by
        WHERE v.module_id = $1 ORDER BY v.version DESC`, [m.id]),
    progressCount(orgOf(req), m.key),
  ]);
  const latest = versions.rows[0]
    ? (await pool.query(`SELECT * FROM walkthrough_module_versions WHERE id = $1`,
        [versions.rows[0].id])).rows[0]
    : null;

  const steps = Array.isArray(m.draft_steps) ? m.draft_steps : [];
  res.json({
    walkthrough: moduleRow(m, {
      learners,
      has_unpublished_changes: draftDiffers(m, latest),
    }),
    steps,
    // Per-step target health, so the editor can warn where a spotlight is
    // fragile or already pointing at nothing.
    targets: steps.map((s, i) => (s.target
      ? { index: i, target: s.target, stability: anchors.stabilityOf(s.target) }
      : null)).filter(Boolean),
    versions: versions.rows,
  });
}));

router.post('/api/walkthroughs', ownerOnly, safe(async (req, res) => {
  const b = req.body || {};
  const meta = wc.normaliseModuleMeta(b);
  if (!meta.ok) return res.status(400).json({ error: meta.error });
  const steps = wc.normaliseSteps(b.steps, meta.meta.roles);
  if (!steps.ok) return res.status(400).json({ error: steps.error });

  let rows;
  try {
    ({ rows } = await pool.query(
      `INSERT INTO walkthrough_modules
         (organisation_id, key, title, description, group_key, minutes, roles,
          thumb, start_context, draft_steps, source, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10::jsonb, 'custom', $11)
       RETURNING *`,
      [orgOf(req), meta.meta.key, meta.meta.title, meta.meta.description,
       meta.meta.group_key, meta.meta.minutes, JSON.stringify(meta.meta.roles),
       meta.meta.thumb || null, JSON.stringify(meta.meta.start_context),
       JSON.stringify(steps.steps), req.user.id]));
  } catch (err) {
    if (err && err.code === '23505') {
      return res.status(409).json({ error: 'A walkthrough with that key already exists' });
    }
    throw err;
  }
  catalogue.invalidate(orgOf(req));
  await audit(req, 'walkthrough.created', rows[0].id, { key: rows[0].key });
  res.status(201).json({ walkthrough: moduleRow(rows[0]) });
}));

/**
 * Save the draft. Metadata and steps in one call — the workshop edits both in
 * the same gesture and a partial save would leave a step gated to a role the
 * module no longer admits.
 *
 * The KEY is immutable once published: tutorial_progress joins on
 * tutorial_key, so renaming a live module would orphan every learner's
 * progress. Refused rather than silently migrated.
 */
router.put('/api/walkthroughs/:id', ownerOnly, safe(async (req, res) => {
  const m = await loadModule(req, req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  if (m.status === 'archived') {
    return res.status(409).json({ error: 'This walkthrough is archived — unarchive it to edit' });
  }

  const b = req.body || {};
  const meta = wc.normaliseModuleMeta(Object.assign({}, b, { key: b.key || m.key }));
  if (!meta.ok) return res.status(400).json({ error: meta.error });
  const steps = wc.normaliseSteps(b.steps === undefined ? m.draft_steps : b.steps, meta.meta.roles);
  if (!steps.ok) return res.status(400).json({ error: steps.error });

  if (meta.meta.key !== m.key && Number(m.current_version) >= 1) {
    return res.status(409).json({
      error: 'A published walkthrough cannot be renamed — learners’ progress is recorded against its key',
    });
  }

  let rows;
  try {
    ({ rows } = await pool.query(
      `UPDATE walkthrough_modules SET
         key = $2, title = $3, description = $4, group_key = $5, minutes = $6,
         roles = $7::jsonb, thumb = $8, start_context = $9::jsonb,
         draft_steps = $10::jsonb, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [m.id, meta.meta.key, meta.meta.title, meta.meta.description, meta.meta.group_key,
       meta.meta.minutes, JSON.stringify(meta.meta.roles), meta.meta.thumb || null,
       JSON.stringify(meta.meta.start_context), JSON.stringify(steps.steps)]));
  } catch (err) {
    if (err && err.code === '23505') {
      return res.status(409).json({ error: 'A walkthrough with that key already exists' });
    }
    throw err;
  }
  catalogue.invalidate(orgOf(req));
  res.json({
    walkthrough: moduleRow(rows[0], { has_unpublished_changes: true }),
    steps: steps.steps,
    targets: steps.steps.map((s, i) => (s.target
      ? { index: i, target: s.target, stability: anchors.stabilityOf(s.target) }
      : null)).filter(Boolean),
  });
}));

/**
 * Publish: snapshot the saved draft as the next immutable version. This is
 * the ONLY route that changes what a learner sees.
 */
router.post('/api/walkthroughs/:id/publish', ownerOnly, safe(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const client = await pool.connect();
  let outcome;
  try {
    await client.query('BEGIN');
    const m = await loadModule(req, req.params.id, client);
    if (!m) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }
    if (m.status === 'archived') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This walkthrough is archived — unarchive it to publish' });
    }
    const steps = Array.isArray(m.draft_steps) ? m.draft_steps : [];
    if (!steps.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Add at least one step before publishing' });
    }
    // Re-validate on the way out. The draft was validated when it was saved,
    // but publishing is the moment it becomes what learners are validated
    // against — a row edited by any other path must not slip through.
    const check = wc.normaliseSteps(steps, m.roles);
    if (!check.ok) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: check.error });
    }

    const { rows: last } = await client.query(
      `SELECT * FROM walkthrough_module_versions
        WHERE module_id = $1 ORDER BY version DESC LIMIT 1`, [m.id]);
    if (!draftDiffers(m, last[0] || null)) {
      await client.query('ROLLBACK');
      return res.json({ published: false, version: Number(m.current_version) });
    }

    const version = Number(m.current_version) + 1;
    await client.query(
      `INSERT INTO walkthrough_module_versions
         (module_id, version, title, description, minutes, roles, thumb,
          start_context, steps, published_by)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9::jsonb, $10)`,
      [m.id, version, m.title, m.description, m.minutes, JSON.stringify(m.roles),
       m.thumb, JSON.stringify(m.start_context), JSON.stringify(check.steps), req.user.id]);
    await client.query(
      `UPDATE walkthrough_modules SET current_version = $2, updated_at = NOW() WHERE id = $1`,
      [m.id, version]);
    await client.query('COMMIT');
    outcome = { id: m.id, key: m.key, version };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  catalogue.invalidate(orgOf(req));
  await audit(req, 'walkthrough.published', outcome.id, { key: outcome.key, version: outcome.version });
  res.json({ published: true, version: outcome.version });
}));

router.post('/api/walkthroughs/:id/duplicate', ownerOnly, safe(async (req, res) => {
  const m = await loadModule(req, req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });

  const key = `${m.key}-copy-${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await pool.query(
    `INSERT INTO walkthrough_modules
       (organisation_id, key, title, description, group_key, minutes, roles,
        thumb, start_context, draft_steps, source, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10::jsonb, 'custom', $11)
     RETURNING *`,
    [orgOf(req), key, `${m.title} (copy)`.slice(0, 200), m.description, m.group_key,
     m.minutes, JSON.stringify(m.roles || []), m.thumb,
     JSON.stringify(m.start_context || {}), JSON.stringify(m.draft_steps || []), req.user.id]);
  catalogue.invalidate(orgOf(req));
  await audit(req, 'walkthrough.duplicated', rows[0].id, { from: m.key, key });
  res.status(201).json({ walkthrough: moduleRow(rows[0]) });
}));

router.post('/api/walkthroughs/:id/archive', ownerOnly, safe(async (req, res) => {
  const m = await loadModule(req, req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  const { rows } = await pool.query(
    `UPDATE walkthrough_modules SET status = 'archived', archived_at = NOW(), updated_at = NOW()
      WHERE id = $1 RETURNING *`, [m.id]);
  catalogue.invalidate(orgOf(req));
  await audit(req, 'walkthrough.archived', m.id, { key: m.key });
  res.json({ walkthrough: moduleRow(rows[0]) });
}));

router.post('/api/walkthroughs/:id/unarchive', ownerOnly, safe(async (req, res) => {
  const m = await loadModule(req, req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  const { rows } = await pool.query(
    `UPDATE walkthrough_modules SET status = 'active', archived_at = NULL, updated_at = NOW()
      WHERE id = $1 RETURNING *`, [m.id]);
  catalogue.invalidate(orgOf(req));
  await audit(req, 'walkthrough.unarchived', m.id, { key: m.key });
  res.json({ walkthrough: moduleRow(rows[0]) });
}));

/**
 * Delete — only a walkthrough nobody has ever taken and nothing has ever
 * published. Anything else archives instead: a deleted key would leave
 * tutorial_progress rows pointing at a module that no longer exists, and the
 * induction history is a record of what staff were actually asked to do.
 */
router.delete('/api/walkthroughs/:id', ownerOnly, safe(async (req, res) => {
  const m = await loadModule(req, req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  if (Number(m.current_version) >= 1) {
    return res.status(409).json({
      error: 'This walkthrough has been published — archive it instead so completions keep their meaning',
    });
  }
  const learners = await progressCount(orgOf(req), m.key);
  if (learners > 0) {
    return res.status(409).json({ error: 'Staff have progress against this walkthrough — archive it instead' });
  }
  await pool.query(`DELETE FROM walkthrough_modules WHERE id = $1`, [m.id]);
  catalogue.invalidate(orgOf(req));
  await audit(req, 'walkthrough.deleted', m.id, { key: m.key });
  res.json({ deleted: true });
}));

module.exports = router;
