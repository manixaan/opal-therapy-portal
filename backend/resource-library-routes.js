'use strict';

/**
 * THE LIBRARY'S FOLDER SURFACE.
 *
 * Browsing is open to anybody who may browse the Resource Hub; restructuring
 * is the Owner's (§34). That split is enforced here on every route rather than
 * in the client, because a folder tree is navigation and navigation is not a
 * permission — but moving four hundred documents is.
 *
 * ── COUNTS ARE PER READER ─────────────────────────────────────────────────
 * A folder's count is what THIS user can actually open. The same predicates
 * the resource list uses are applied to the count, so a therapist is never
 * shown "Assessments · 30" and then finds twenty-two. The admin rights-review
 * tier stays invisible in both places, by the same rule.
 *
 * ── FOLDERS DO NOT NARROW SEARCH ──────────────────────────────────────────
 * Nothing here filters search. Folder browsing is a separate query parameter
 * on the existing list route, and it is absent unless the client asks for it,
 * so a search keeps spanning the whole library (§21).
 */

const express = require('express');

const router = express.Router();
const db = require('./database');
const { pool } = require('./database');
const { requireAuth } = require('./permissions');
const governance = require('./resource-governance');
const organiser = require('./resource-library-organiser');
const taxonomy = require('./resource-library-taxonomy');
const classifier = require('./resource-library-classifier');
const log = require('./logger').createLogger('resource-library');

const hubEnabled = () => process.env.ENABLE_RESOURCE_HUB !== 'false';
const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));
const orgOf = (req) => req.user?.organisation_id || null;
const isOwner = (u) => u?.role === 'owner';
const canAuthor = (u) => u?.role === 'owner' || u?.role === 'admin';

router.use('/api/rh2/library', requireAuth, (req, res, next) => {
  if (!hubEnabled()) return res.status(403).json({ error: 'Resource Hub is disabled', code: 'resource_hub_disabled' });
  next();
});

const safe = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  log.error('library route error', { error: err, path: req.path });
  if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
});

/** Restructuring the library is the Owner's. Returns a sent response on denial. */
function requireOwner(req, res) {
  if (isOwner(req.user)) return null;
  return res.status(403).json({
    error: 'Only the practice owner can change the library structure.',
    code: 'library_structure_forbidden',
  });
}

const str = (v, max) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

function audit(req, action, targetId, metadata) {
  return db.logAuditEvent({
    actorUserId: req.user?.id, action, targetType: 'resource', targetId,
    ipAddress: req.ip, organisationId: orgOf(req), metadata: metadata || null,
  }).catch(() => {});
}

// ═════════════════════════════════════════════════════════════════════════════
//  VISIBILITY — one definition, used by every count on this surface
// ═════════════════════════════════════════════════════════════════════════════

/**
 * The predicate and parameters that decide which resources this user may see.
 *
 * Mirrors GET /api/rh2/resources exactly. Written as a helper rather than
 * copied so a future change to browsable states cannot make the counts and the
 * lists disagree — the failure mode there is silent and only a user notices.
 */
function visibilityFor(user, orgId, startIndex) {
  const params = [orgId];
  let where = `r.organisation_id IS NOT DISTINCT FROM $${startIndex}
    AND r.access_tier <> 'excluded-private'
    AND r.publication_state <> 'excluded-private'
    AND r.status <> 'archived' AND r.archived_at IS NULL`;

  if (!canAuthor(user)) {
    params.push(governance.BROWSABLE_STATES);
    where += ` AND r.status = 'approved' AND r.publication_state = ANY($${startIndex + params.length - 1}::text[])`;
    params.push(governance.tiersForRole(user && user.role));
    where += ` AND r.access_tier = ANY($${startIndex + params.length - 1}::text[])`;
  }
  return { where, params };
}

// ═════════════════════════════════════════════════════════════════════════════
//  BROWSING
// ═════════════════════════════════════════════════════════════════════════════

/**
 * The folder tree, with a count on every folder.
 *
 * A parent reports its own resources AND everything in its subfolders, because
 * "Therapy Resources · 446" is what a person expects to see before they open
 * it. `directCount` is reported alongside so the folder view can show what
 * sits at the parent level without recomputing it.
 *
 * Empty AI-generated folders are already deactivated by the run; an empty
 * folder a person created is still listed, because they made it on purpose
 * (§31).
 */
router.get('/api/rh2/library/folders', safe(async (req, res) => {
  const orgId = orgOf(req);
  const vis = visibilityFor(req.user, orgId, 2); // $1 is the folder org

  const { rows } = await pool.query(
    `SELECT f.id, f.name, f.description, f.slug, f.parent_id, f.sort_order,
            f.is_review_bucket, f.source, f.name_locked,
            (SELECT COUNT(*) FROM resource_folder_assignments a
               JOIN resources r ON r.id = a.resource_id
              WHERE a.folder_id = f.id AND ${vis.where})::int AS direct_count
       FROM resource_folders f
      WHERE f.organisation_id IS NOT DISTINCT FROM $1
        AND f.kind = 'library' AND f.is_active
      ORDER BY f.sort_order, f.name`,
    [orgId, ...vis.params]);

  const byId = new Map(rows.map((r) => [r.id, {
    id: r.id, name: r.name, description: r.description, slug: r.slug,
    parentId: r.parent_id, sortOrder: r.sort_order,
    isReviewBucket: r.is_review_bucket, source: r.source, nameLocked: r.name_locked,
    directCount: r.direct_count, count: r.direct_count, children: [],
  }]));

  const tree = [];
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) byId.get(node.parentId).children.push(node);
    else tree.push(node);
  }
  for (const parent of tree) {
    parent.count = parent.directCount + parent.children.reduce((n, c) => n + c.count, 0);
  }

  // Everything a reader may open, so "All Resources" can state its own size
  // without a second request. Built afresh at $1 rather than by rewriting the
  // predicate above — string-substituting placeholders is how a query starts
  // reading the wrong parameter.
  const total = visibilityFor(req.user, orgId, 1);
  const totalQ = await pool.query(
    `SELECT COUNT(*)::int AS n FROM resources r WHERE ${total.where}`, total.params);

  // An empty Needs Review is a safety net, not a shelf. The row stays — a
  // later upload that cannot be placed needs somewhere to land — but a reader
  // is not shown a folder with nothing in it (§31).
  const visible = tree.filter((f) => !f.isReviewBucket || f.count > 0);

  // The review bucket is listed last however it sorts — it is a queue, not a
  // subject area, and it should not lead the page.
  visible.sort((a, b) => (a.isReviewBucket ? 1 : 0) - (b.isReviewBucket ? 1 : 0)
    || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  res.json({ folders: visible, totalResources: totalQ.rows[0].n, organised: rows.length > 0 });
}));

/** One folder by id or slug, with its breadcrumb trail (§20). */
router.get('/api/rh2/library/folders/:idOrSlug', safe(async (req, res) => {
  const orgId = orgOf(req);
  const key = String(req.params.idOrSlug || '');
  const bySlug = !isUuid(key);
  if (bySlug && key.length > 160) return res.status(404).json({ error: 'Not found' });

  const { rows } = await pool.query(
    `SELECT id, name, description, slug, parent_id, is_review_bucket
       FROM resource_folders
      WHERE organisation_id IS NOT DISTINCT FROM $1 AND kind = 'library' AND is_active
        AND ${bySlug ? 'slug' : 'id'} = $2`,
    [orgId, key]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });

  const folder = rows[0];
  const trail = [];
  let cursor = folder;
  const seen = new Set();
  while (cursor && cursor.parent_id && !seen.has(cursor.parent_id)) {
    seen.add(cursor.parent_id);
    const up = await pool.query(
      `SELECT id, name, slug, parent_id FROM resource_folders WHERE id = $1
        AND organisation_id IS NOT DISTINCT FROM $2`, [cursor.parent_id, orgId]);
    if (!up.rows.length) break;
    trail.unshift({ id: up.rows[0].id, name: up.rows[0].name, slug: up.rows[0].slug });
    cursor = up.rows[0];
  }

  const children = await pool.query(
    `SELECT id, name, description, slug FROM resource_folders
      WHERE organisation_id IS NOT DISTINCT FROM $1 AND parent_id = $2
        AND kind = 'library' AND is_active ORDER BY sort_order, name`,
    [orgId, folder.id]);

  res.json({
    folder: {
      id: folder.id, name: folder.name, description: folder.description,
      slug: folder.slug, isReviewBucket: folder.is_review_bucket,
    },
    breadcrumb: trail,
    children: children.rows,
  });
}));

// ═════════════════════════════════════════════════════════════════════════════
//  ORGANISING
// ═════════════════════════════════════════════════════════════════════════════

const RUN_FIELDS = `id, status, phase, mode, scanned_count, profiled_count, assigned_count,
  skipped_locked, review_count, folders_created, ai_used, taxonomy, duplicates,
  error, rolled_back_at, started_at, finished_at`;

/**
 * How the current or last run is going.
 *
 * Deliberately says nothing about which model, how many tokens, or which
 * table (§16) — `phase` is a word the client turns into "Understanding
 * document topics…" and nothing else leaves here.
 */
router.get('/api/rh2/library/status', safe(async (req, res) => {
  const orgId = orgOf(req);
  const { rows } = await pool.query(
    `SELECT ${RUN_FIELDS} FROM resource_classification_runs
      WHERE organisation_id IS NOT DISTINCT FROM $1
      ORDER BY started_at DESC LIMIT 1`, [orgId]);

  const run = rows[0] || null;
  res.json({
    run: run ? {
      id: run.id, status: run.status, phase: run.phase, mode: run.mode,
      scanned: run.scanned_count, profiled: run.profiled_count,
      assigned: run.assigned_count, keptManual: run.skipped_locked,
      needsReview: run.review_count, foldersCreated: run.folders_created,
      startedAt: run.started_at, finishedAt: run.finished_at,
      rolledBackAt: run.rolled_back_at,
      // The Owner is told plainly whether the deeper review ran. Everyone is
      // spared the reason code.
      reviewed: !!run.ai_used,
      failed: run.status === 'failed',
      duplicates: isOwner(req.user) ? (run.duplicates || []) : [],
    } : null,
    canOrganise: isOwner(req.user),
  });
}));

/**
 * Organise (or reorganise) the library.
 *
 * Returns as soon as the run row exists; the work continues in the background
 * and progress is read from /status. There is no approval step — the Owner
 * asked for it, and corrections afterwards are one click (§15).
 */
router.post('/api/rh2/library/organise', safe(async (req, res) => {
  const denied = requireOwner(req, res); if (denied) return denied;
  const orgId = orgOf(req);
  const mode = req.body && req.body.mode === 'reorganise' ? 'reorganise' : 'organise';

  const run = await organiser.startRun(orgId, req.user.id, mode);
  if (!run) {
    return res.status(409).json({
      error: 'The library is already being organised.', code: 'organisation_in_progress',
    });
  }

  await audit(req, 'resource_library.organise_started', null, { runId: run.id, mode });

  // Detached on purpose: the caller gets an id, not a five-minute request.
  // executeRun records its own failure on the run row, so nothing is lost if
  // this rejects.
  Promise.resolve()
    .then(() => organiser.executeRun(run, { userId: req.user.id }))
    .catch((err) => log.error('organisation run threw', { error: err, runId: run.id }));

  res.status(202).json({ runId: run.id, status: 'running' });
}));

/** Undo a run's placements (§39). */
router.post('/api/rh2/library/rollback', safe(async (req, res) => {
  const denied = requireOwner(req, res); if (denied) return denied;
  const orgId = orgOf(req);

  let runId = str(req.body && req.body.runId, 40);
  if (runId && !isUuid(runId)) return res.status(400).json({ error: 'Unknown run.' });
  if (!runId) {
    const last = await pool.query(
      `SELECT id FROM resource_classification_runs
        WHERE organisation_id IS NOT DISTINCT FROM $1 AND status = 'complete'
        ORDER BY started_at DESC LIMIT 1`, [orgId]);
    if (!last.rows.length) return res.status(404).json({ error: 'Nothing to undo.' });
    runId = last.rows[0].id;
  }

  const result = await organiser.rollbackRun(orgId, runId, req.user.id);
  if (!result.ok) {
    const message = result.reason === 'still_running'
      ? 'That organisation is still running.'
      : result.reason === 'already_rolled_back'
        ? 'That organisation has already been undone.'
        : 'Unknown run.';
    return res.status(result.reason === 'not_found' ? 404 : 409).json({ error: message, code: result.reason });
  }
  res.json({ ok: true, restored: result.restored });
}));

// ═════════════════════════════════════════════════════════════════════════════
//  FOLDER MANAGEMENT (§37)
// ═════════════════════════════════════════════════════════════════════════════

/** A folder slug that is stable and safe in a URL (§52). */
async function uniqueSlug(orgId, base) {
  const root = String(base).toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 120) || 'folder';
  for (let i = 1; i < 80; i++) {
    const candidate = i === 1 ? root : `${root}-${i}`;
    const { rows } = await pool.query(
      `SELECT 1 FROM resource_folders WHERE organisation_id IS NOT DISTINCT FROM $1
        AND kind = 'library' AND slug = $2`, [orgId, candidate]);
    if (!rows.length) return candidate;
  }
  return `${root}-${Date.now()}`;
}

router.post('/api/rh2/library/folders', safe(async (req, res) => {
  const denied = requireOwner(req, res); if (denied) return denied;
  const orgId = orgOf(req);

  const name = classifier.validFolderName(str(req.body && req.body.name, 60));
  if (!name) {
    return res.status(400).json({
      error: 'Give the folder a short, descriptive name of ordinary words.',
      code: 'invalid_folder_name',
    });
  }
  const description = str(req.body && req.body.description, 200);

  let parentId = str(req.body && req.body.parentId, 40);
  if (parentId) {
    if (!isUuid(parentId)) return res.status(400).json({ error: 'Unknown parent folder.' });
    const parent = await pool.query(
      `SELECT id, parent_id FROM resource_folders
        WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2 AND kind = 'library'`,
      [parentId, orgId]);
    if (!parent.rows.length) return res.status(404).json({ error: 'Unknown parent folder.' });
    // Two levels is the whole hierarchy (§9). A folder tree that can nest
    // forever becomes a file explorer, which is not what this is (§73).
    if (parent.rows[0].parent_id) {
      return res.status(400).json({
        error: 'Folders go two levels deep. Add this inside a top-level folder instead.',
        code: 'depth_limit',
      });
    }
  } else {
    parentId = null;
  }

  const slug = await uniqueSlug(orgId, name);
  const { rows } = await pool.query(
    `INSERT INTO resource_folders
       (organisation_id, parent_id, name, description, slug, kind, source,
        sort_order, is_active, name_locked, created_by)
     VALUES ($1, $2, $3, $4, $5, 'library', 'manual', 999, TRUE, TRUE, $6)
     RETURNING id, name, description, slug, parent_id`,
    [orgId, parentId, name, description, slug, req.user.id]);

  await audit(req, 'resource_library.folder_created', rows[0].id, { name });
  res.status(201).json({ folder: rows[0] });
}));

router.patch('/api/rh2/library/folders/:id', safe(async (req, res) => {
  const denied = requireOwner(req, res); if (denied) return denied;
  const orgId = orgOf(req);
  const id = req.params.id;
  if (!isUuid(id)) return res.status(404).json({ error: 'Not found' });

  const current = await pool.query(
    `SELECT id, name, parent_id, is_review_bucket FROM resource_folders
      WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2 AND kind = 'library'`,
    [id, orgId]);
  if (!current.rows.length) return res.status(404).json({ error: 'Not found' });

  const sets = [];
  const params = [id];
  const changed = {};

  if (req.body && req.body.name !== undefined) {
    const name = classifier.validFolderName(str(req.body.name, 60));
    if (!name) {
      return res.status(400).json({
        error: 'Give the folder a short, descriptive name of ordinary words.',
        code: 'invalid_folder_name',
      });
    }
    params.push(name); sets.push(`name = $${params.length}`);
    // Renaming is a decision, and automatic reorganisation must respect it
    // from now on (§25).
    sets.push('name_locked = TRUE');
    changed.name = name;
  }
  if (req.body && req.body.description !== undefined) {
    params.push(str(req.body.description, 200)); sets.push(`description = $${params.length}`);
    changed.description = true;
  }
  if (req.body && req.body.sortOrder !== undefined) {
    const n = parseInt(req.body.sortOrder, 10);
    if (Number.isFinite(n)) { params.push(Math.min(998, Math.max(0, n))); sets.push(`sort_order = $${params.length}`); }
  }
  if (req.body && req.body.parentId !== undefined) {
    if (current.rows[0].is_review_bucket) {
      return res.status(400).json({ error: 'Needs Review stays at the top level.', code: 'review_bucket_fixed' });
    }
    const parentId = str(req.body.parentId, 40);
    if (!parentId) { sets.push('parent_id = NULL'); }
    else {
      if (!isUuid(parentId) || parentId === id) return res.status(400).json({ error: 'Unknown parent folder.' });
      const parent = await pool.query(
        `SELECT id, parent_id FROM resource_folders
          WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2 AND kind = 'library'`,
        [parentId, orgId]);
      if (!parent.rows.length) return res.status(404).json({ error: 'Unknown parent folder.' });
      if (parent.rows[0].parent_id) {
        return res.status(400).json({ error: 'Folders go two levels deep.', code: 'depth_limit' });
      }
      const kids = await pool.query(
        'SELECT 1 FROM resource_folders WHERE parent_id = $1 AND is_active LIMIT 1', [id]);
      if (kids.rows.length) {
        return res.status(400).json({
          error: 'Move or remove this folder\'s subfolders first.', code: 'depth_limit',
        });
      }
      params.push(parentId); sets.push(`parent_id = $${params.length}`);
    }
    changed.parent = true;
  }

  if (!sets.length) return res.status(400).json({ error: 'Nothing to change.' });
  sets.push('updated_at = NOW()');

  const { rows } = await pool.query(
    `UPDATE resource_folders SET ${sets.join(', ')} WHERE id = $1
     RETURNING id, name, description, slug, parent_id, sort_order`, params);

  await audit(req, 'resource_library.folder_updated', id, changed);
  res.json({ folder: rows[0] });
}));

/**
 * Retire a folder. Its resources are not deleted — they go to Needs Review so
 * the Owner can place them, which is the only outcome that cannot lose a
 * document (§62).
 */
router.delete('/api/rh2/library/folders/:id', safe(async (req, res) => {
  const denied = requireOwner(req, res); if (denied) return denied;
  const orgId = orgOf(req);
  const id = req.params.id;
  if (!isUuid(id)) return res.status(404).json({ error: 'Not found' });

  const current = await pool.query(
    `SELECT id, name, is_review_bucket FROM resource_folders
      WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2 AND kind = 'library'`,
    [id, orgId]);
  if (!current.rows.length) return res.status(404).json({ error: 'Not found' });
  if (current.rows[0].is_review_bucket) {
    return res.status(400).json({ error: 'Needs Review cannot be removed.', code: 'review_bucket_fixed' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const review = await client.query(
      `SELECT id FROM resource_folders
        WHERE organisation_id IS NOT DISTINCT FROM $1 AND kind = 'library' AND is_review_bucket
        LIMIT 1`, [orgId]);

    const descendants = await client.query(
      `SELECT id FROM resource_folders WHERE id = $1 OR parent_id = $1`, [id]);
    const ids = descendants.rows.map((r) => r.id);

    let moved = 0;
    if (review.rows.length) {
      const upd = await client.query(
        `UPDATE resource_folder_assignments
            SET folder_id = $1, manual_lock = FALSE, classification_source = 'rules',
                confidence = 0, rationale = 'Folder removed — needs a new home.',
                classified_at = NOW()
          WHERE folder_id = ANY($2::uuid[])`,
        [review.rows[0].id, ids]);
      moved = upd.rowCount;
    } else {
      // No review bucket to catch them: refuse rather than orphan.
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Organise the library once before removing folders.', code: 'no_review_folder',
      });
    }

    await client.query(
      `UPDATE resource_folders SET is_active = FALSE, updated_at = NOW()
        WHERE id = ANY($1::uuid[])`, [ids]);
    await client.query('COMMIT');

    await audit(req, 'resource_library.folder_archived', id, { name: current.rows[0].name, moved });
    res.json({ ok: true, movedToReview: moved });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}));

// ═════════════════════════════════════════════════════════════════════════════
//  MOVING RESOURCES (§35, §36)
// ═════════════════════════════════════════════════════════════════════════════

/** How many resources one bulk move may touch. */
const MAX_MOVE = 200;

/**
 * Move one or more resources into a folder, by hand.
 *
 * The placement is marked manual and locked, and that lock is what every later
 * automatic run reads and respects (§14). Nothing else about the resource
 * changes: not its id, its files, its tags, its favourites or its URL.
 */
router.post('/api/rh2/library/move', safe(async (req, res) => {
  const denied = requireOwner(req, res); if (denied) return denied;
  const orgId = orgOf(req);

  const folderId = str(req.body && req.body.folderId, 40);
  if (!isUuid(folderId)) return res.status(400).json({ error: 'Choose a folder.' });
  const folder = await pool.query(
    `SELECT id, name FROM resource_folders
      WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2 AND kind = 'library' AND is_active`,
    [folderId, orgId]);
  if (!folder.rows.length) return res.status(404).json({ error: 'Unknown folder.' });

  const requested = [].concat((req.body && req.body.resourceIds) || []).filter((x) => isUuid(x));
  if (!requested.length) return res.status(400).json({ error: 'Choose at least one resource.' });
  if (requested.length > MAX_MOVE) {
    return res.status(400).json({ error: `Move at most ${MAX_MOVE} resources at a time.`, code: 'too_many' });
  }

  // Every id is checked against this organisation's own resources before it is
  // written anywhere. A caller cannot file somebody else's document by
  // guessing a uuid (§33).
  const valid = await pool.query(
    `SELECT r.id FROM resources r WHERE r.id = ANY($2::uuid[]) AND ${organiser.SCOPE_SQL}`,
    [orgId, requested]);
  const ids = valid.rows.map((r) => r.id);
  if (!ids.length) return res.status(404).json({ error: 'No matching resources.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const resourceId of ids) {
      const prior = await client.query(
        'SELECT folder_id, classification_source, manual_lock FROM resource_folder_assignments WHERE resource_id = $1',
        [resourceId]);
      await client.query(
        `INSERT INTO resource_folder_assignments
           (resource_id, organisation_id, folder_id, classification_source, confidence,
            manual_lock, rationale, classified_at)
         VALUES ($1, $2, $3, 'manual', 1.0, TRUE, 'Placed by the practice owner.', NOW())
         ON CONFLICT (resource_id) DO UPDATE
           SET folder_id = EXCLUDED.folder_id, classification_source = 'manual',
               confidence = 1.0, manual_lock = TRUE,
               rationale = EXCLUDED.rationale, classified_at = NOW()`,
        [resourceId, orgId, folderId]);
      await client.query(
        `INSERT INTO resource_assignment_history
           (run_id, organisation_id, resource_id, from_folder_id, to_folder_id,
            from_source, to_source, from_locked, changed_by)
         VALUES (NULL, $1, $2, $3, $4, $5, 'manual', $6, $7)`,
        [orgId, resourceId, prior.rows[0] ? prior.rows[0].folder_id : null, folderId,
          prior.rows[0] ? prior.rows[0].classification_source : null,
          prior.rows[0] ? prior.rows[0].manual_lock : null, req.user.id]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  await audit(req, 'resource_library.resources_moved', folderId,
    { folder: folder.rows[0].name, count: ids.length });
  res.json({ ok: true, moved: ids.length, folder: folder.rows[0].name });
}));

/**
 * Hand a resource back to automatic classification.
 *
 * The counterpart to a manual move: an Owner who changes their mind should not
 * have to guess where the machine would have put it.
 */
router.post('/api/rh2/library/reclassify', safe(async (req, res) => {
  const denied = requireOwner(req, res); if (denied) return denied;
  const orgId = orgOf(req);
  const resourceId = str(req.body && req.body.resourceId, 40);
  if (!isUuid(resourceId)) return res.status(400).json({ error: 'Unknown resource.' });

  const result = await organiser.classifyResource(orgId, resourceId, {
    userId: req.user.id, force: true,
  });
  if (!result) {
    return res.status(409).json({
      error: 'Organise the library once before classifying a single resource.',
      code: 'not_organised',
    });
  }
  res.json({ ok: true, folder: result.folderName, needsReview: result.review, confidence: result.confidence });
}));

/** The taxonomy vocabulary, so a picker can offer folders that do not exist yet. */
router.get('/api/rh2/library/themes', safe(async (req, res) => {
  const denied = requireOwner(req, res); if (denied) return denied;
  res.json({
    themes: taxonomy.THEMES.map((t) => ({
      key: t.key, name: t.name, description: t.description, parent: t.parent || null,
    })),
  });
}));

module.exports = router;
