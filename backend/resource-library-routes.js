'use strict';

/**
 * THE LIBRARY'S FOLDER SURFACE.
 *
 * Folders are a filing cabinet the practice keeps by hand: the Owner makes
 * them, names them, and puts documents in them. Browsing is open to anybody
 * who may browse the Resource Hub; changing the structure is the Owner's, and
 * that split is enforced here on every route rather than in the client.
 *
 * ── THIS USED TO ORGANISE ITSELF ──────────────────────────────────────────
 * An earlier version derived the folder tree from the documents' contents and
 * refined it with a model. The folders it produced are still here and still
 * correct — they are ordinary rows — but the machinery that generated them has
 * been removed at the practice's request. Nothing reads a document to decide
 * where it goes any more; a file lands where a person puts it.
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
const intake = require('./resource-file-intake');
const log = require('./logger').createLogger('resource-library');

/**
 * The resources a folder may hold: this organisation's own, still active, and
 * never a client-derived record. Lifted from the removed organiser module,
 * which existed mostly to hold it.
 */
const SCOPE_SQL = `
     r.organisation_id IS NOT DISTINCT FROM $1
 AND r.status <> 'archived'
 AND r.archived_at IS NULL
 AND COALESCE(r.access_tier, '') <> 'excluded-private'
 AND COALESCE(r.publication_state, '') <> 'excluded-private'`;

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

/**
 * A folder name a person would accept: ordinary words, nothing that looks like
 * a database code, and nothing that means "we did not decide".
 */
const BANNED_FOLDER_NAMES = ['miscellaneous', 'misc', 'other', 'other documents', 'general',
  'general files', 'unsorted', 'various', 'stuff', 'documents', 'files'];

function validFolderName(name) {
  const n = String(name || '').trim();
  if (n.length < 2 || n.length > 60) return null;
  if (!/^[A-Za-z][A-Za-z0-9&/,'’\- ]*$/.test(n)) return null;
  if (/\d{2,}|_|^[A-Z]{4,}$/.test(n)) return null;
  if (/\s\d+$/.test(n)) return null;
  if (n.split(/\s+/).length > 5) return null;
  if (BANNED_FOLDER_NAMES.includes(n.toLowerCase())) return null;
  return n;
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
    AND ${governance.LIVE_RESOURCE_SQL}`;

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
 * How many resources THIS reader can open in each of these folders, counting
 * only what is filed in the folder itself.
 *
 * The folder grid and the folder you then open are two different requests, and
 * they used to arrive at their numbers by two different routes. One counting
 * routine removes the possibility: a card that says thirty and a folder that
 * shows one is exactly what two copies of an almost-identical query produce.
 *
 * Returns a Map keyed by folder id; a folder with nothing in it is absent, so
 * read it with `counts.get(id) || 0`.
 */
async function directCounts(user, orgId, folderIds) {
  const ids = (folderIds || []).filter(Boolean);
  if (!ids.length) return new Map();
  const vis = visibilityFor(user, orgId, 2); // $1 is the folder id array
  const { rows } = await pool.query(
    `SELECT a.folder_id, COUNT(*)::int AS n
       FROM resource_folder_assignments a
       JOIN resources r ON r.id = a.resource_id
      WHERE a.folder_id = ANY($1::uuid[]) AND ${vis.where}
      GROUP BY a.folder_id`,
    [ids, ...vis.params]);
  return new Map(rows.map((r) => [r.folder_id, r.n]));
}

/**
 * What a folder reports: its own resources plus everything in its subfolders.
 *
 * "Therapy Resources · 446" is what a person expects before they open it, and
 * the browse route's `folderScope=tree` returns exactly that set. Walking the
 * children rather than folding one level means a folder deeper than the two
 * the UI creates is still counted somewhere rather than nowhere.
 */
function rollUp(node) {
  node.count = node.directCount + (node.children || [])
    .reduce((n, child) => n + rollUp(child), 0);
  return node.count;
}

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

  const { rows } = await pool.query(
    `SELECT f.id, f.name, f.description, f.slug, f.parent_id, f.sort_order,
            f.is_review_bucket, f.source, f.name_locked
       FROM resource_folders f
      WHERE f.organisation_id IS NOT DISTINCT FROM $1
        AND f.kind = 'library' AND f.is_active
      ORDER BY f.sort_order, f.name`,
    [orgId]);

  const counts = await directCounts(req.user, orgId, rows.map((r) => r.id));
  const byId = new Map(rows.map((r) => [r.id, {
    id: r.id, name: r.name, description: r.description, slug: r.slug,
    parentId: r.parent_id, sortOrder: r.sort_order,
    isReviewBucket: r.is_review_bucket, source: r.source, nameLocked: r.name_locked,
    directCount: counts.get(r.id) || 0, count: counts.get(r.id) || 0, children: [],
  }]));

  const tree = [];
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) byId.get(node.parentId).children.push(node);
    else tree.push(node);
  }
  for (const parent of tree) rollUp(parent);

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

/**
 * One folder by id or slug, with its breadcrumb trail (§20) and its count.
 *
 * The count is here, and not left to the client to find in the folder tree,
 * because the folder header is the second place a number appears and the two
 * must not be able to disagree. It is produced by the same `directCounts` the
 * grid uses and rolled up the same way, so opening a folder restates the
 * figure its card gave rather than recomputing one from whatever page of
 * results happened to arrive.
 */
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

  const counts = await directCounts(
    req.user, orgId, [folder.id, ...children.rows.map((c) => c.id)]);
  const childNodes = children.rows.map((c) => ({
    id: c.id, name: c.name, description: c.description, slug: c.slug,
    directCount: counts.get(c.id) || 0, count: counts.get(c.id) || 0, children: [],
  }));
  const node = {
    directCount: counts.get(folder.id) || 0, count: 0, children: childNodes,
  };
  rollUp(node);

  res.json({
    folder: {
      id: folder.id, name: folder.name, description: folder.description,
      slug: folder.slug, isReviewBucket: folder.is_review_bucket,
      // What opening this folder will show: its own resources and its
      // subfolders', the same set `folderScope=tree` returns from the browse
      // route and the same figure the folder card carries.
      count: node.count, directCount: node.directCount,
    },
    breadcrumb: trail,
    children: childNodes,
  });
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

  const name = validFolderName(str(req.body && req.body.name, 60));
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
    const name = validFolderName(str(req.body.name, 60));
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
    /**
     * Somewhere for the orphans to land.
     *
     * The bucket used to be created by the automatic organiser. Nothing
     * creates it now, so it is made on demand — the first time a folder is
     * removed and there is nowhere for its documents to go. Creating it here
     * rather than up front means a practice that never deletes a folder never
     * sees a folder it did not make.
     */
    let review = await client.query(
      `SELECT id FROM resource_folders
        WHERE organisation_id IS NOT DISTINCT FROM $1 AND kind = 'library' AND is_review_bucket
        LIMIT 1`, [orgId]);
    if (!review.rows.length) {
      review = await client.query(
        `INSERT INTO resource_folders
           (organisation_id, name, description, slug, kind, source, sort_order,
            is_active, is_review_bucket, name_locked, created_by)
         VALUES ($1, 'Needs Review',
                 'Documents left without a folder. Move them where they belong.',
                 'needs-review', 'library', 'manual', 999, TRUE, TRUE, TRUE, $2)
         ON CONFLICT (organisation_id, slug) WHERE slug IS NOT NULL AND kind = 'library'
           DO UPDATE SET is_active = TRUE, is_review_bucket = TRUE
         RETURNING id`,
        [orgId, req.user.id]);
    }

    const descendants = await client.query(
      `SELECT id FROM resource_folders WHERE id = $1 OR parent_id = $1`, [id]);
    const ids = descendants.rows.map((r) => r.id);

    let moved = 0;
    {
      const upd = await client.query(
        `UPDATE resource_folder_assignments
            SET folder_id = $1, manual_lock = FALSE, classification_source = 'rules',
                confidence = 0, rationale = 'Folder removed — needs a new home.',
                classified_at = NOW()
          WHERE folder_id = ANY($2::uuid[])`,
        [review.rows[0].id, ids]);
      moved = upd.rowCount;
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
    `SELECT r.id FROM resources r WHERE r.id = ANY($2::uuid[]) AND ${SCOPE_SQL}`,
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

// ═════════════════════════════════════════════════════════════════════════════
//  PUTTING A DOCUMENT IN A FOLDER
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Upload a file straight into a folder.
 *
 * This is the front door: drag a PDF onto a folder, or pick it from the button,
 * and it is there. One request creates the resource record, stores the bytes
 * through the shared intake gate, and files it — so a half-done upload cannot
 * leave a resource with no document or a document with no home.
 *
 * ── WHY IT ARRIVES LIVE ───────────────────────────────────────────────────
 * The record is created approved and staff-visible rather than as a draft
 * awaiting review. That is a deliberate decision by the practice: a folder a
 * person files into is expected to contain what they just put in it, and a
 * drag-and-drop that silently produces something nobody else can see is a
 * worse lie than no review step. The governance lifecycle still exists for
 * resources authored through Admin; it is this door that skips it.
 *
 * The privacy gate does NOT skip. A PDF or Word file carrying somebody's
 * completed details is refused here exactly as it is in Admin.
 */
router.post('/api/rh2/library/folders/:id/upload', safe(async (req, res) => {
  const denied = requireOwner(req, res); if (denied) return denied;
  const orgId = orgOf(req);
  const folderId = req.params.id;
  if (!isUuid(folderId)) return res.status(404).json({ error: 'Unknown folder.' });

  const folder = await pool.query(
    `SELECT id, name FROM resource_folders
      WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2
        AND kind = 'library' AND is_active`, [folderId, orgId]);
  if (!folder.rows.length) return res.status(404).json({ error: 'Unknown folder.' });

  const fileName = str(req.body && req.body.fileName, 300);
  if (!fileName) return res.status(400).json({ error: 'A file name is required.' });

  // The format comes from the name, not from the caller: a client that says
  // "pdf" about a .exe should not get to choose which gate runs.
  const format = intake.formatForName(fileName);
  if (!format) {
    return res.status(415).json({
      error: 'That file type is not supported. Use PDF, Word, Excel, PowerPoint or an image.',
      code: 'unsupported_format',
    });
  }

  // The title defaults to the file name without its extension — what a person
  // would have typed anyway — and stays renameable afterwards.
  const title = str(req.body && req.body.title, 300)
    || fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 300)
    || fileName;

  const client = await pool.connect();
  let resource;
  try {
    await client.query('BEGIN');
    const slug = await uniqueResourceSlug(client, orgId, title);
    const created = await client.query(
      `INSERT INTO resources
         (organisation_id, title, slug, content_type, resource_type, status,
          publication_state, access_tier, source_class, rights_status,
          authority_level, created_by, content_owner, approved_by, approved_at)
       VALUES ($1, $2, $3, 'download', 'download', 'approved',
               'approved', 'staff', 'opal-original', 'opal-owned',
               'internal', $4, $4, $4, NOW())
       RETURNING *`,
      [orgId, title, slug, req.user.id]);
    resource = created.rows[0];
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  const stored = await intake.storeFile(resource, {
    fileName, format, fileData: req.body && req.body.fileData, isPrimary: true,
    // Thumbnails are generated by shelling out to a renderer, which is slow
    // and entirely optional. Somebody dropping twenty files should not wait
    // for twenty renders; the cards lazy-load thumbnails and fall back to a
    // file-type glyph when one is not there yet.
  }, { userId: req.user.id, deferDerivatives: true });

  if (!stored.ok) {
    // The record exists but has no document, which is not a resource — remove
    // it rather than leaving an empty shell in the folder. It was created
    // moments ago by this request and has nothing else attached to it.
    await pool.query('DELETE FROM resources WHERE id = $1', [resource.id]).catch(() => {});
    if (stored.code === 'privacy_rejected') {
      await audit(req, 'resource_library.upload_privacy_rejected', null,
        { folder: folder.rows[0].name, privacy: stored.privacy, identifiers: stored.identifiers });
    }
    return res.status(stored.status).json({ error: stored.error, code: stored.code });
  }

  await pool.query(
    `INSERT INTO resource_folder_assignments
       (resource_id, organisation_id, folder_id, classification_source, confidence,
        manual_lock, rationale)
     VALUES ($1, $2, $3, 'manual', 1.0, TRUE, 'Uploaded into this folder.')
     ON CONFLICT (resource_id) DO UPDATE SET folder_id = EXCLUDED.folder_id`,
    [resource.id, orgId, folderId]);

  await audit(req, 'resource_library.file_uploaded', resource.id, {
    folder: folder.rows[0].name, fileName, format, sizeBytes: stored.sizeBytes,
  });

  res.status(201).json({
    ok: true,
    resource: { id: resource.id, title: resource.title, slug: resource.slug },
    file: stored.file,
    folder: folder.rows[0].name,
    warnings: stored.warnings,
    // Said plainly so the client can be honest about what was and was not
    // inspected, rather than implying every format is scanned.
    privacyScanned: stored.privacyScanned,
  });
}));

/** A resource slug that is unique for the organisation. */
async function uniqueResourceSlug(client, orgId, title) {
  const base = String(title || 'document').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 140) || 'document';
  for (let i = 1; i < 80; i++) {
    const candidate = i === 1 ? base : `${base}-${i}`;
    const { rows } = await client.query(
      'SELECT 1 FROM resources WHERE organisation_id IS NOT DISTINCT FROM $1 AND slug = $2',
      [orgId, candidate]);
    if (!rows.length) return candidate;
  }
  return `${base}-${Date.now()}`;
}

/**
 * Rename a document.
 *
 * Deliberately its own route rather than the Admin PATCH. Renaming from a
 * right-click is a filing action, not an editorial one: it changes what the
 * card says and nothing else, so it does not ask for a change note and does
 * not touch the version history or anybody's acknowledgement.
 */
router.patch('/api/rh2/library/resources/:id', safe(async (req, res) => {
  const denied = requireOwner(req, res); if (denied) return denied;
  const orgId = orgOf(req);
  const id = req.params.id;
  if (!isUuid(id)) return res.status(404).json({ error: 'Not found' });

  const title = str(req.body && req.body.title, 300);
  if (!title) return res.status(400).json({ error: 'Give the document a name.', code: 'empty_title' });

  // SCOPE_SQL is written against an `r` alias, so the UPDATE has to provide
  // one — without it Postgres refuses with "missing FROM-clause entry".
  const { rows } = await pool.query(
    `UPDATE resources r SET title = $3, updated_at = NOW()
      WHERE r.id = $2 AND ${SCOPE_SQL}
      RETURNING r.id, r.title, r.slug`,
    [orgId, id, title]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });

  await audit(req, 'resource_library.resource_renamed', id, { title });
  res.json({ ok: true, resource: rows[0] });
}));

module.exports = router;
