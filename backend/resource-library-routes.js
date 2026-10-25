'use strict';

/**
 * THE LIBRARY'S FOLDER SURFACE — a document library.
 *
 * Folders are a filing cabinet the practice keeps by hand, nested to any
 * depth. Browsing is open to anybody who may browse the Resource Hub (and
 * shows only what governance lets them see); managing — upload, new folder,
 * rename, move, replace, delete to the recycle bin, restore — belongs to the
 * Owner and Admins, and permanently deleting from the bin to the Owner alone.
 * Both splits are enforced HERE, on every route, by permissions.js
 * requireRole; the client only hides what would be refused.
 *
 * Every mutation is audited. Audit metadata carries names, ids and counts —
 * never a document's content.
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
const { requireAuth, requireRole } = require('./permissions');
const governance = require('./resource-governance');
const intake = require('./resource-file-intake');
const rules = require('./resource-library-rules');
const bin = require('./resource-recycle-bin');
const fileStorage = require('./resource-file-storage');
const log = require('./logger').createLogger('resource-library');

/** Upload, folders, rename, move, replace, delete, restore: Owner and Admin. */
const requireManager = requireRole('owner', 'admin');
/** Permanently deleting from the recycle bin: the Owner only. */
const requireOwnerOnly = requireRole('owner');

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
const canAuthor = (u) => u?.role === 'owner' || u?.role === 'admin';

router.use('/api/rh2/library', requireAuth, (req, res, next) => {
  if (!hubEnabled()) return res.status(403).json({ error: 'Resource Hub is disabled', code: 'resource_hub_disabled' });
  next();
});

const safe = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  log.error('library route error', { error: err, path: req.path });
  if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
});

const str = (v, max) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

/** Audit one mutation. Metadata is names, ids and counts — never content. */
function audit(req, action, targetId, metadata, targetType = 'resource') {
  return db.logAuditEvent({
    actorUserId: req.user?.id, action, targetType, targetId,
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

  // Folders nest to any depth, so every figure here is the whole subtree's —
  // the same treeCounts the browse route and the folder tree use.
  const counts = await treeCounts(req.user, orgId);
  const of = (id) => counts.get(id) || { direct: 0, total: 0 };
  const childNodes = children.rows.map((c) => ({
    id: c.id, name: c.name, description: c.description, slug: c.slug,
    directCount: of(c.id).direct, count: of(c.id).total, children: [],
  }));
  const node = { directCount: of(folder.id).direct, count: of(folder.id).total };

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
//  BROWSING A FOLDER AS A DOCUMENT LIBRARY
// ═════════════════════════════════════════════════════════════════════════════

const displayName = (alias) =>
  `COALESCE(NULLIF(${alias}.display_name, ''), NULLIF(${alias}.name, ''), ${alias}.email)`;

/**
 * Rolled-up counts for every live folder of the organisation, as this reader
 * sees them: Map id → { direct, total }. Any depth: a folder's total is its
 * own documents plus all of its descendants'.
 */
async function treeCounts(user, orgId) {
  const { rows } = await pool.query(
    `SELECT id, parent_id FROM resource_folders
      WHERE organisation_id IS NOT DISTINCT FROM $1 AND kind = 'library' AND is_active`, [orgId]);
  const direct = await directCounts(user, orgId, rows.map((r) => r.id));
  const kids = new Map();
  for (const r of rows) {
    if (!r.parent_id) continue;
    if (!kids.has(r.parent_id)) kids.set(r.parent_id, []);
    kids.get(r.parent_id).push(r.id);
  }
  const out = new Map();
  const visiting = new Set();
  const total = (id) => {
    if (out.has(id)) return out.get(id).total;
    if (visiting.has(id)) return 0; // corrupt data that loops counts once
    visiting.add(id);
    let n = direct.get(id) || 0;
    for (const k of kids.get(id) || []) n += total(k);
    out.set(id, { direct: direct.get(id) || 0, total: n });
    return n;
  };
  for (const r of rows) total(r.id);
  return out;
}

/**
 * One folder's contents, SharePoint-style: its subfolders and the documents
 * filed directly in it, with the columns the list view shows (name, modified,
 * modified by, size, type). `folderId=root` lists the top level.
 *
 * Documents are filtered by the same visibility rule as every other read, so
 * a therapist sees approved, tier-appropriate documents only, and an author
 * also sees drafts (flagged by their state).
 */
router.get('/api/rh2/library/browse', safe(async (req, res) => {
  const orgId = orgOf(req);
  const key = String(req.query.folderId || 'root');
  const isRoot = key === 'root' || key === '';
  if (!isRoot && !isUuid(key)) return res.status(404).json({ error: 'Not found' });

  let folder = null;
  const breadcrumb = [];
  if (!isRoot) {
    const { rows } = await pool.query(
      `SELECT f.id, f.name, f.description, f.slug, f.parent_id, f.is_review_bucket,
              f.created_at, f.updated_at, ${displayName('cu')} AS created_by_name
         FROM resource_folders f LEFT JOIN users cu ON cu.id = f.created_by
        WHERE f.id = $1 AND f.organisation_id IS NOT DISTINCT FROM $2
          AND f.kind = 'library' AND f.is_active`, [key, orgId]);
    if (!rows.length) return res.status(404).json({ error: 'That folder no longer exists.', code: 'folder_not_found' });
    folder = rows[0];
    const map = await bin.loadFolderMap(pool, orgId);
    let cursor = folder.parent_id ? map.get(folder.parent_id) : null;
    const seen = new Set();
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      breadcrumb.unshift({ id: cursor.id, name: cursor.name });
      cursor = cursor.parent_id ? map.get(cursor.parent_id) : null;
    }
  }

  const counts = await treeCounts(req.user, orgId);
  const sub = await pool.query(
    `SELECT f.id, f.name, f.description, f.slug, f.is_review_bucket, f.created_at,
            f.updated_at, ${displayName('mu')} AS modified_by_name
       FROM resource_folders f
       LEFT JOIN users mu ON mu.id = COALESCE(f.updated_by, f.created_by)
      WHERE f.organisation_id IS NOT DISTINCT FROM $1 AND f.kind = 'library' AND f.is_active
        AND ${isRoot ? `(f.parent_id IS NULL OR NOT EXISTS (
              SELECT 1 FROM resource_folders p WHERE p.id = f.parent_id AND p.is_active))`
    : 'f.parent_id = $2'}
      ORDER BY f.is_review_bucket, f.sort_order, lower(f.name)`,
    isRoot ? [orgId] : [orgId, key]);

  const folders = sub.rows
    .map((f) => ({
      id: f.id, name: f.name, description: f.description, slug: f.slug,
      isReviewBucket: f.is_review_bucket,
      count: (counts.get(f.id) || {}).total || 0,
      createdAt: f.created_at, modifiedAt: f.updated_at || f.created_at,
      modifiedBy: f.modified_by_name || null,
    }))
    // An empty Needs Review is a safety net, not a shelf (§31).
    .filter((f) => !f.isReviewBucket || f.count > 0);

  let documents = [];
  if (!isRoot) {
    const vis = visibilityFor(req.user, orgId, 2);
    const { rows } = await pool.query(
      `SELECT r.id, r.title, r.slug, r.description, r.status, r.publication_state,
              r.access_tier, r.content_type, r.mandatory, r.external_url,
              r.created_at, r.updated_at,
              ${displayName('cu')} AS created_by_name,
              ${displayName('mu')} AS modified_by_name,
              pf.id AS file_id, pf.file_name, pf.format, pf.file_size_bytes,
              pf.access_tier AS file_tier, pf.has_thumbnail,
              (SELECT MAX(v.version_no) FROM resource_file_versions v
                WHERE v.resource_id = r.id) AS version_no
         FROM resource_folder_assignments a
         JOIN resources r ON r.id = a.resource_id
         LEFT JOIN users cu ON cu.id = r.created_by
         LEFT JOIN users mu ON mu.id = COALESCE(r.updated_by, r.created_by)
         LEFT JOIN LATERAL (
           SELECT f.id, f.file_name, f.format, f.file_size_bytes, f.access_tier,
                  EXISTS (SELECT 1 FROM resource_file_derivatives d
                           WHERE d.resource_file_id = f.id AND d.kind = 'thumbnail') AS has_thumbnail
             FROM resource_files f
            WHERE f.resource_id = r.id AND f.superseded_at IS NULL
            ORDER BY f.is_primary DESC, f.uploaded_at
            LIMIT 1
         ) pf ON TRUE
        WHERE a.folder_id = $1 AND ${vis.where}
        ORDER BY lower(r.title)
        LIMIT 2000`,
      [key, ...vis.params]);
    const role = req.user && req.user.role;
    documents = rows.map((r) => {
      const fileOk = r.file_id && governance.canReadFile(role, r.access_tier, r.file_tier);
      return {
        id: r.id, title: r.title, slug: r.slug, description: r.description,
        status: r.status, publicationState: r.publication_state, accessTier: r.access_tier,
        contentType: r.content_type, mandatory: r.mandatory,
        external: !!r.external_url && !r.file_id,
        createdAt: r.created_at, createdBy: r.created_by_name || null,
        modifiedAt: r.updated_at || r.created_at, modifiedBy: r.modified_by_name || null,
        versionNo: r.version_no || (r.file_id ? 1 : null),
        file: fileOk ? {
          id: r.file_id, fileName: r.file_name, format: r.format,
          sizeBytes: r.file_size_bytes === null ? null : Number(r.file_size_bytes),
          downloadUrl: `/api/rh2/files/${r.file_id}`,
          thumbnailUrl: r.has_thumbnail ? `/api/rh2/files/${r.file_id}/thumbnail` : null,
        } : null,
      };
    });
  }

  res.json({
    folder: folder ? {
      id: folder.id, name: folder.name, description: folder.description, slug: folder.slug,
      parentId: folder.parent_id, isReviewBucket: folder.is_review_bucket,
      createdAt: folder.created_at, createdBy: folder.created_by_name || null,
      modifiedAt: folder.updated_at, count: (counts.get(folder.id) || {}).total || 0,
    } : null,
    breadcrumb,
    folders,
    documents,
    canManage: canAuthor(req.user),
    canPurge: !!(req.user && req.user.role === 'owner'),
  });
}));

// ═════════════════════════════════════════════════════════════════════════════
//  FOLDER MANAGEMENT (§37) — Owner and Admin
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

function badName(res, verdict) {
  return res.status(400).json({ error: verdict.error, code: verdict.code });
}

/** Is `name` already used by a live sibling under `parentId` (case-insensitive)? */
async function siblingNameTaken(orgId, parentId, name, exceptId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM resource_folders
      WHERE organisation_id IS NOT DISTINCT FROM $1 AND kind = 'library' AND is_active
        AND parent_id IS NOT DISTINCT FROM $2::uuid AND lower(name) = lower($3)
        AND ($4::uuid IS NULL OR id <> $4::uuid)
      LIMIT 1`, [orgId, parentId || null, name, exceptId || null]);
  return rows.length > 0;
}

function nameTaken(res, name) {
  return res.status(409).json({
    error: `A folder called "${name}" already exists here.`, code: 'folder_name_taken',
  });
}

/** A parent a folder may be created in or moved into: live, a library folder, not Needs Review. */
async function usableParent(orgId, parentId) {
  const { rows } = await pool.query(
    `SELECT id, parent_id, name FROM resource_folders
      WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2 AND kind = 'library'
        AND is_active AND NOT is_review_bucket`, [parentId, orgId]);
  return rows[0] || null;
}

router.post('/api/rh2/library/folders', requireManager, safe(async (req, res) => {
  const orgId = orgOf(req);
  const verdict = rules.validateFolderName(req.body && req.body.name);
  if (!verdict.ok) return badName(res, verdict);
  const name = verdict.name;
  const description = str(req.body && req.body.description, 200);

  let parentId = str(req.body && req.body.parentId, 40);
  if (parentId && parentId !== 'root') {
    if (!isUuid(parentId)) return res.status(400).json({ error: 'Unknown parent folder.' });
    // Any depth (owner decision, Oct 2026). The parent must be live and must
    // not be the Needs Review queue.
    if (!(await usableParent(orgId, parentId))) {
      return res.status(404).json({ error: 'That parent folder no longer exists.', code: 'parent_not_found' });
    }
  } else {
    parentId = null;
  }
  if (await siblingNameTaken(orgId, parentId, name)) return nameTaken(res, name);

  const slug = await uniqueSlug(orgId, name);
  const { rows } = await pool.query(
    `INSERT INTO resource_folders
       (organisation_id, parent_id, name, description, slug, kind, source,
        sort_order, is_active, name_locked, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, 'library', 'manual', 999, TRUE, TRUE, $6, $6)
     RETURNING id, name, description, slug, parent_id`,
    [orgId, parentId, name, description, slug, req.user.id]);

  await audit(req, 'resource_library.folder_created', rows[0].id, { name, parentId }, 'resource_folder');
  res.status(201).json({ folder: rows[0] });
}));

router.patch('/api/rh2/library/folders/:id', requireManager, safe(async (req, res) => {
  const orgId = orgOf(req);
  const id = req.params.id;
  if (!isUuid(id)) return res.status(404).json({ error: 'Not found' });

  const current = await pool.query(
    `SELECT id, name, description, parent_id, is_review_bucket FROM resource_folders
      WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2 AND kind = 'library' AND is_active`,
    [id, orgId]);
  if (!current.rows.length) return res.status(404).json({ error: 'Not found' });
  const cur = current.rows[0];

  const sets = [];
  const params = [id];
  const changed = {};
  let finalName = cur.name;
  let finalParent = cur.parent_id;

  if (req.body && req.body.name !== undefined) {
    const verdict = rules.validateFolderName(req.body.name);
    if (!verdict.ok) return badName(res, verdict);
    finalName = verdict.name;
    params.push(finalName); sets.push(`name = $${params.length}`);
    // Renaming is a decision, and automatic reorganisation must respect it
    // from now on (§25).
    sets.push('name_locked = TRUE');
    changed.name = { from: cur.name, to: finalName };
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
    if (cur.is_review_bucket) {
      return res.status(400).json({ error: 'Needs Review stays at the top level.', code: 'review_bucket_fixed' });
    }
    const parentId = str(req.body.parentId, 40);
    if (!parentId || parentId === 'root') {
      finalParent = null;
      sets.push('parent_id = NULL');
    } else {
      if (!isUuid(parentId)) return res.status(400).json({ error: 'Unknown parent folder.' });
      const map = await bin.loadFolderMap(pool, orgId);
      if (rules.wouldCreateCycle(id, parentId, (fid) => (map.get(fid) || {}).parent_id)) {
        return res.status(400).json({
          error: 'A folder cannot be moved into itself or one of its own subfolders.',
          code: 'folder_cycle',
        });
      }
      if (!(await usableParent(orgId, parentId))) {
        return res.status(404).json({ error: 'That folder no longer exists.', code: 'parent_not_found' });
      }
      finalParent = parentId;
      params.push(parentId); sets.push(`parent_id = $${params.length}`);
    }
    changed.parent = { from: cur.parent_id, to: finalParent };
  }

  if (!sets.length) return res.status(400).json({ error: 'Nothing to change.' });
  if ((changed.name || changed.parent)
      && await siblingNameTaken(orgId, finalParent, finalName, id)) return nameTaken(res, finalName);

  params.push(req.user.id);
  sets.push(`updated_at = NOW(), updated_by = $${params.length}`);
  const { rows } = await pool.query(
    `UPDATE resource_folders SET ${sets.join(', ')} WHERE id = $1
     RETURNING id, name, description, slug, parent_id, sort_order`, params);

  await audit(req, 'resource_library.folder_updated', id, changed, 'resource_folder');
  res.json({ folder: rows[0], previous: { name: cur.name, parentId: cur.parent_id } });
}));

// ═════════════════════════════════════════════════════════════════════════════
//  DELETE → RECYCLE BIN
// ═════════════════════════════════════════════════════════════════════════════

/** How many items one delete, move or restore request may touch. */
const MAX_BATCH = 200;

const uuids = (v) => [...new Set([].concat(v || []).filter((x) => isUuid(x)).map(String))];

/**
 * The live learning workflows that link any of these documents (as a
 * "resource" item in the draft or in the current published version).
 * Returns [{ id, title, resourceIds }].
 */
async function learningReferences(orgId, resourceIds) {
  if (!resourceIds.length) return [];
  const { rows } = await pool.query(
    `WITH contents AS (
       SELECT w.id, w.title, w.draft_content AS content
         FROM learning_workflows w
        WHERE w.organisation_id IS NOT DISTINCT FROM $1 AND w.status = 'active'
       UNION ALL
       SELECT w.id, w.title, v.content
         FROM learning_workflows w
         JOIN learning_workflow_versions v ON v.workflow_id = w.id AND v.version = w.current_version
        WHERE w.organisation_id IS NOT DISTINCT FROM $1 AND w.status = 'active'
     )
     SELECT c.id, c.title, array_agg(DISTINCT lower(i->>'resource_id')) AS resource_ids
       FROM contents c,
            jsonb_array_elements(CASE WHEN jsonb_typeof(c.content->'sections') = 'array'
                                      THEN c.content->'sections' ELSE '[]'::jsonb END) s,
            jsonb_array_elements(CASE WHEN jsonb_typeof(s->'items') = 'array'
                                      THEN s->'items' ELSE '[]'::jsonb END) i
      WHERE i->>'type' = 'resource' AND lower(i->>'resource_id') = ANY($2::text[])
      GROUP BY c.id, c.title
      ORDER BY c.title`,
    [orgId, resourceIds.map((x) => x.toLowerCase())]);
  return rows.map((r) => ({ id: r.id, title: r.title, resourceIds: r.resource_ids }));
}

/** Every live document filed in these folders or anywhere beneath them. */
async function documentsUnder(orgId, folderIds) {
  if (!folderIds.length) return [];
  const map = await bin.loadFolderMap(pool, orgId);
  const all = new Set();
  for (const id of folderIds) {
    if (!map.has(id)) continue;
    all.add(id);
    bin.descendantIds(map, id, (c) => c.is_active).forEach((d) => all.add(d));
  }
  if (!all.size) return [];
  const { rows } = await pool.query(
    `SELECT r.id FROM resource_folder_assignments a JOIN resources r ON r.id = a.resource_id
      WHERE a.folder_id = ANY($2::uuid[]) AND ${SCOPE_SQL}`, [orgId, [...all]]);
  return rows.map((r) => r.id);
}

/**
 * Send documents and folders to the recycle bin.
 *
 * A document a learning workflow links is not deleted silently: the first
 * request answers 409 `in_use` listing those workflows, and the caller must
 * repeat it with `confirm: true`. Learners then see "This resource was
 * removed" in place of the item rather than a dead link.
 */
async function deleteHandler(req, res, { resourceIds, folderIds }) {
  const orgId = orgOf(req);
  if (!resourceIds.length && !folderIds.length) {
    return res.status(400).json({ error: 'Choose something to delete.' });
  }
  if (resourceIds.length + folderIds.length > MAX_BATCH) {
    return res.status(400).json({ error: `Delete at most ${MAX_BATCH} items at a time.`, code: 'too_many' });
  }
  if (folderIds.length) {
    const { rows: review } = await pool.query(
      `SELECT id FROM resource_folders WHERE id = ANY($1::uuid[]) AND is_review_bucket`, [folderIds]);
    if (review.length) {
      return res.status(400).json({ error: 'Needs Review cannot be deleted.', code: 'review_bucket_fixed' });
    }
  }

  const affected = [...new Set([...resourceIds, ...await documentsUnder(orgId, folderIds)])];
  const refs = await learningReferences(orgId, affected);
  if (refs.length && !(req.body && req.body.confirm === true)) {
    return res.status(409).json({
      error: refs.length === 1
        ? `This is used in the learning workflow "${refs[0].title}".`
        : `This is used in ${refs.length} learning workflows.`,
      code: 'in_use',
      workflows: refs,
    });
  }

  const result = await bin.deleteItems(orgId, { resourceIds, folderIds }, req.user.id);
  if (!result.resources.length && !result.folders.length) {
    return res.status(404).json({ error: 'Nothing matching could be deleted.', code: 'not_found' });
  }
  for (const f of result.folders) {
    await audit(req, 'resource_library.folder_deleted', f.id,
      { name: f.name, documents: f.resourceCount, folders: f.folderCount }, 'resource_folder');
  }
  for (const r of result.resources) {
    await audit(req, 'resource_library.resource_deleted', r.id, { title: r.title });
  }
  if (refs.length) {
    await audit(req, 'resource_library.deleted_in_use', null,
      { workflows: refs.map((w) => w.id), documents: affected.length });
  }
  res.json({
    ok: true,
    deleted: {
      resources: result.resources.map((r) => r.id),
      folders: result.folders.map((f) => f.id),
    },
    counts: {
      documents: result.resources.length + result.folders.reduce((n, f) => n + f.resourceCount, 0),
      folders: result.folders.length,
    },
  });
}

router.post('/api/rh2/library/delete', requireManager, safe(async (req, res) => {
  return deleteHandler(req, res, {
    resourceIds: uuids(req.body && req.body.resourceIds),
    folderIds: uuids(req.body && req.body.folderIds),
  });
}));

/** The original folder-remove door: now the same delete-to-bin. */
router.delete('/api/rh2/library/folders/:id', requireManager, safe(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });
  return deleteHandler(req, res, { resourceIds: [], folderIds: [req.params.id] });
}));

/**
 * Before deleting: which learning workflows use these documents (or the
 * documents inside these folders)? Lets the client warn up front.
 */
router.post('/api/rh2/library/delete-check', requireManager, safe(async (req, res) => {
  const orgId = orgOf(req);
  const resourceIds = uuids(req.body && req.body.resourceIds);
  const folderIds = uuids(req.body && req.body.folderIds);
  const affected = [...new Set([...resourceIds, ...await documentsUnder(orgId, folderIds)])];
  res.json({ workflows: await learningReferences(orgId, affected), documents: affected.length });
}));

// ═════════════════════════════════════════════════════════════════════════════
//  THE RECYCLE BIN
// ═════════════════════════════════════════════════════════════════════════════

/**
 * What is in the bin. A deleted folder is one entry standing for everything
 * deleted with it; a document deleted on its own is its own entry.
 */
router.get('/api/rh2/library/recycle-bin', requireManager, safe(async (req, res) => {
  const orgId = orgOf(req);
  const map = await bin.loadFolderMap(pool, orgId);
  const now = new Date();

  const { rows: folders } = await pool.query(
    `SELECT f.id, f.name, f.parent_id, f.deleted_at, f.deleted_with_folder_id,
            ${displayName('u')} AS deleted_by_name
       FROM resource_folders f LEFT JOIN users u ON u.id = f.deleted_by
      WHERE f.organisation_id IS NOT DISTINCT FROM $1 AND f.kind = 'library'
        AND f.deleted_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM resource_folders p
                         WHERE p.id = f.parent_id AND p.deleted_at IS NOT NULL
                           AND p.deleted_with_folder_id = f.deleted_with_folder_id)
      ORDER BY f.deleted_at DESC`, [orgId]);

  const { rows: docs } = await pool.query(
    `SELECT r.id, r.title, r.deleted_at, r.deleted_from_folder_id, r.deleted_with_folder_id,
            ${displayName('u')} AS deleted_by_name,
            pf.file_name, pf.format, pf.file_size_bytes
       FROM resources r
       LEFT JOIN users u ON u.id = r.deleted_by
       LEFT JOIN LATERAL (
         SELECT f.file_name, f.format, f.file_size_bytes FROM resource_files f
          WHERE f.resource_id = r.id AND f.superseded_at IS NULL
          ORDER BY f.is_primary DESC, f.uploaded_at LIMIT 1) pf ON TRUE
      WHERE r.organisation_id IS NOT DISTINCT FROM $1 AND r.deleted_at IS NOT NULL
        AND (r.deleted_with_folder_id IS NULL OR NOT EXISTS (
              SELECT 1 FROM resource_folders b
               WHERE b.id = r.deleted_from_folder_id AND b.deleted_at IS NOT NULL
                 AND b.deleted_with_folder_id = r.deleted_with_folder_id))
      ORDER BY r.deleted_at DESC`, [orgId]);

  const items = [];
  for (const f of folders) {
    const members = await bin.batchMembers(pool, orgId, map, f.id);
    items.push({
      kind: 'folder', id: f.id, name: f.name,
      originalPath: bin.pathNames(map, f.parent_id),
      deletedAt: f.deleted_at, deletedBy: f.deleted_by_name || null,
      daysLeft: rules.daysLeft(f.deleted_at, now),
      documentCount: members ? members.resources.length : 0,
      folderCount: members ? members.folders.length - 1 : 0,
    });
  }
  for (const r of docs) {
    items.push({
      kind: 'resource', id: r.id, name: r.title,
      fileName: r.file_name || null, format: r.format || null,
      sizeBytes: r.file_size_bytes === null || r.file_size_bytes === undefined ? null : Number(r.file_size_bytes),
      originalPath: bin.pathNames(map, r.deleted_from_folder_id),
      deletedAt: r.deleted_at, deletedBy: r.deleted_by_name || null,
      daysLeft: rules.daysLeft(r.deleted_at, now),
    });
  }
  items.sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
  res.json({
    items, retentionDays: rules.RECYCLE_BIN_DAYS,
    canPurge: !!(req.user && req.user.role === 'owner'),
  });
}));

/** [{kind,id}] from a request body, validated. */
function binItems(body) {
  const items = [].concat((body && body.items) || [])
    .filter((i) => i && (i.kind === 'folder' || i.kind === 'resource') && isUuid(i.id))
    .map((i) => ({ kind: i.kind, id: String(i.id) }));
  return items.slice(0, MAX_BATCH);
}

router.post('/api/rh2/library/recycle-bin/restore', requireManager, safe(async (req, res) => {
  const items = binItems(req.body);
  if (!items.length) return res.status(400).json({ error: 'Choose something to restore.' });
  const result = await bin.restoreItems(orgOf(req), items, req.user.id);
  if (!result.folders.length && !result.resources.length) {
    return res.status(404).json({ error: 'Those items are no longer in the recycle bin.', code: 'not_found' });
  }
  for (const f of result.folders) {
    await audit(req, 'resource_library.folder_restored', f.id,
      { name: f.name, documents: f.resourceCount }, 'resource_folder');
  }
  for (const r of result.resources) {
    await audit(req, 'resource_library.resource_restored', r.id, { title: r.title, folderId: r.folderId });
  }
  res.json({ ok: true, restored: result });
}));

router.post('/api/rh2/library/recycle-bin/purge', requireOwnerOnly, safe(async (req, res) => {
  const items = binItems(req.body);
  if (!items.length) return res.status(400).json({ error: 'Choose something to delete permanently.' });
  const result = await bin.purge(orgOf(req), {
    folderIds: items.filter((i) => i.kind === 'folder').map((i) => i.id),
    resourceIds: items.filter((i) => i.kind === 'resource').map((i) => i.id),
  });
  await audit(req, 'resource_library.recycle_bin_purged', null,
    { documents: result.resources, folders: result.folders, ids: items.map((i) => i.id) });
  res.json({ ok: true, purged: result });
}));

router.post('/api/rh2/library/recycle-bin/empty', requireOwnerOnly, safe(async (req, res) => {
  const contents = await bin.binContents(orgOf(req));
  const result = await bin.purge(orgOf(req), contents);
  await audit(req, 'resource_library.recycle_bin_emptied', null,
    { documents: result.resources, folders: result.folders });
  res.json({ ok: true, purged: result });
}));

// ═════════════════════════════════════════════════════════════════════════════
//  MOVING DOCUMENTS AND FOLDERS (§35, §36)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Move documents and/or folders into a folder (or folders to the top level,
 * `folderId: 'root'`).
 *
 * A document's placement is marked manual and locked, and that lock is what
 * every later automatic run reads and respects (§14). A folder cannot be moved
 * into itself or a descendant, and cannot land beside a folder of the same
 * name. The response carries where everything came FROM, so the client can
 * offer Undo by moving it back.
 */
router.post('/api/rh2/library/move', requireManager, safe(async (req, res) => {
  const orgId = orgOf(req);
  const target = str(req.body && req.body.folderId, 40);
  const toRoot = target === 'root';
  if (!toRoot && !isUuid(target)) return res.status(400).json({ error: 'Choose a folder.' });

  const resourceIds = uuids(req.body && req.body.resourceIds);
  const folderIds = uuids(req.body && req.body.folderIds);
  if (!resourceIds.length && !folderIds.length) {
    return res.status(400).json({ error: 'Choose at least one item to move.' });
  }
  if (resourceIds.length + folderIds.length > MAX_BATCH) {
    return res.status(400).json({ error: `Move at most ${MAX_BATCH} items at a time.`, code: 'too_many' });
  }
  if (toRoot && resourceIds.length) {
    return res.status(400).json({ error: 'Documents live inside a folder. Choose a folder.', code: 'document_needs_folder' });
  }

  let folder = null;
  if (!toRoot) {
    const f = await pool.query(
      `SELECT id, name, is_review_bucket FROM resource_folders
        WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2 AND kind = 'library' AND is_active`,
      [target, orgId]);
    if (!f.rows.length) return res.status(404).json({ error: 'That folder no longer exists.', code: 'folder_not_found' });
    folder = f.rows[0];
    if (folder.is_review_bucket && folderIds.length) {
      return res.status(400).json({ error: 'Folders cannot go inside Needs Review.', code: 'review_bucket_fixed' });
    }
  }
  const targetId = toRoot ? null : folder.id;

  // Folder checks first, before anything is written.
  const map = await bin.loadFolderMap(pool, orgId);
  const movingFolders = [];
  for (const id of folderIds) {
    const f = map.get(id);
    if (!f || !f.is_active) return res.status(404).json({ error: 'A folder you chose no longer exists.', code: 'folder_not_found' });
    if (f.is_review_bucket) return res.status(400).json({ error: 'Needs Review stays at the top level.', code: 'review_bucket_fixed' });
    if (rules.wouldCreateCycle(id, targetId, (fid) => (map.get(fid) || {}).parent_id)) {
      return res.status(400).json({
        error: `"${f.name}" cannot be moved into itself or one of its own subfolders.`, code: 'folder_cycle',
      });
    }
    if ((f.parent_id || null) === targetId) continue; // already there
    if (await siblingNameTaken(orgId, targetId, f.name, id)) return nameTaken(res, f.name);
    movingFolders.push(f);
  }

  // Every document id is checked against this organisation's own resources
  // before it is written anywhere (§33).
  let ids = [];
  if (resourceIds.length) {
    const valid = await pool.query(
      `SELECT r.id FROM resources r WHERE r.id = ANY($2::uuid[]) AND ${SCOPE_SQL}`,
      [orgId, resourceIds]);
    ids = valid.rows.map((r) => r.id);
    if (!ids.length && !folderIds.length) {
      return res.status(404).json({ error: 'No matching documents.' });
    }
  }

  const previous = { resources: [], folders: [] };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const resourceId of ids) {
      const prior = await client.query(
        'SELECT folder_id, classification_source, manual_lock FROM resource_folder_assignments WHERE resource_id = $1',
        [resourceId]);
      const from = prior.rows[0] ? prior.rows[0].folder_id : null;
      previous.resources.push({ id: resourceId, folderId: from });
      if (from === targetId) continue;
      await client.query(
        `INSERT INTO resource_folder_assignments
           (resource_id, organisation_id, folder_id, classification_source, confidence,
            manual_lock, rationale, classified_at)
         VALUES ($1, $2, $3, 'manual', 1.0, TRUE, 'Placed by hand.', NOW())
         ON CONFLICT (resource_id) DO UPDATE
           SET folder_id = EXCLUDED.folder_id, classification_source = 'manual',
               confidence = 1.0, manual_lock = TRUE,
               rationale = EXCLUDED.rationale, classified_at = NOW()`,
        [resourceId, orgId, targetId]);
      await client.query(
        `INSERT INTO resource_assignment_history
           (run_id, organisation_id, resource_id, from_folder_id, to_folder_id,
            from_source, to_source, from_locked, changed_by)
         VALUES (NULL, $1, $2, $3, $4, $5, 'manual', $6, $7)`,
        [orgId, resourceId, from, targetId,
          prior.rows[0] ? prior.rows[0].classification_source : null,
          prior.rows[0] ? prior.rows[0].manual_lock : null, req.user.id]);
    }
    for (const f of movingFolders) {
      previous.folders.push({ id: f.id, parentId: f.parent_id || null });
      await client.query(
        `UPDATE resource_folders SET parent_id = $2, updated_at = NOW(), updated_by = $3
          WHERE id = $1`, [f.id, targetId, req.user.id]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  const destination = folder ? folder.name : 'Library';
  await audit(req, 'resource_library.resources_moved', targetId,
    { folder: destination, documents: ids.length, folders: movingFolders.length });
  res.json({
    ok: true,
    moved: ids.length + movingFolders.length,
    documents: ids.length,
    folders: movingFolders.length,
    folder: destination,
    previous,
  });
}));

// ═════════════════════════════════════════════════════════════════════════════
//  PUTTING A DOCUMENT IN A FOLDER
// ═════════════════════════════════════════════════════════════════════════════

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

/** What a file name becomes as a document title. */
const titleFromFileName = (fileName) =>
  fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300)
  || fileName;

/** Remove a stored blob when no file row references it any more. */
async function dropBlobIfUnreferenced(storageKey) {
  if (!storageKey) return;
  const { rows } = await pool.query('SELECT 1 FROM resource_files WHERE storage_key = $1 LIMIT 1', [storageKey]);
  if (!rows.length) await fileStorage.removeBlob(storageKey).catch(() => {});
}

function unsupported(res) {
  return res.status(415).json({
    error: 'That file type is not supported. Use PDF, Word, Excel, PowerPoint or an image.',
    code: 'unsupported_format',
  });
}

/**
 * Store a new version of an existing document's file. The new file is live at
 * once; the previous one is kept in the version history (resource-file-intake).
 * Returns a sent response.
 */
async function replaceDocument(req, res, resource, fileName, fileData) {
  const format = intake.formatForName(fileName);
  if (!format) return unsupported(res);
  const stored = await intake.storeFile(resource, {
    fileName, format, fileData, isPrimary: true,
  }, { userId: req.user.id, deferDerivatives: true });
  if (!stored.ok) {
    if (stored.code === 'privacy_rejected') {
      await audit(req, 'resource_library.upload_privacy_rejected', resource.id,
        { replace: true, privacy: stored.privacy, identifiers: stored.identifiers });
    }
    return res.status(stored.status).json({ error: stored.error, code: stored.code, reasons: stored.reasons });
  }
  await pool.query('UPDATE resources SET updated_at = NOW(), updated_by = $2 WHERE id = $1',
    [resource.id, req.user.id]);
  await audit(req, 'resource_library.file_replaced', resource.id, {
    fileName, format, sizeBytes: stored.sizeBytes, versionNo: stored.versionNo,
  });
  return res.status(200).json({
    ok: true, replaced: true,
    resource: { id: resource.id, title: resource.title, slug: resource.slug },
    file: stored.file, versionNo: stored.versionNo,
    warnings: stored.warnings, privacyScanned: stored.privacyScanned,
  });
}

/** A document in this organisation's library scope, or null. */
async function scopedResource(orgId, id) {
  if (!isUuid(id)) return null;
  const { rows } = await pool.query(
    `SELECT r.* FROM resources r WHERE r.id = $2 AND ${SCOPE_SQL}`, [orgId, id]);
  return rows[0] || null;
}

/**
 * Upload a file straight into a folder.
 *
 * This is the front door: drag a PDF onto a folder, or pick it from the button,
 * and it is there. One request creates the resource record, stores the bytes
 * through the shared intake gate, and files it — so a half-done upload cannot
 * leave a resource with no document or a document with no home.
 *
 * ── A NAME ALREADY IN THE FOLDER ──────────────────────────────────────────
 * When a document with the same file name (or the same title) is already
 * filed here, the upload answers 409 `duplicate_name` and stores nothing. The
 * client asks the person and repeats with `onConflict`:
 *   'replace'  — a new version of that document (live at once, history kept)
 *   'keepBoth' — a separate document named "Name (2).ext"
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
router.post('/api/rh2/library/folders/:id/upload', requireManager, safe(async (req, res) => {
  const orgId = orgOf(req);
  const folderId = req.params.id;
  if (!isUuid(folderId)) return res.status(404).json({ error: 'Unknown folder.' });

  const folder = await pool.query(
    `SELECT id, name FROM resource_folders
      WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2
        AND kind = 'library' AND is_active`, [folderId, orgId]);
  if (!folder.rows.length) return res.status(404).json({ error: 'That folder no longer exists.', code: 'folder_not_found' });

  let fileName = str(req.body && req.body.fileName, 300);
  if (!fileName) return res.status(400).json({ error: 'A file name is required.' });
  fileName = fileName.replace(/[\\/]/g, '_');

  // The format comes from the name, not from the caller: a client that says
  // "pdf" about a .exe should not get to choose which gate runs.
  const format = intake.formatForName(fileName);
  if (!format) return unsupported(res);

  const onConflict = req.body && req.body.onConflict;
  let title = str(req.body && req.body.title, 300) || titleFromFileName(fileName);

  // ── duplicate names in this folder ─────────────────────────────────────
  const { rows: siblings } = await pool.query(
    `SELECT r.id, r.title, pf.file_name
       FROM resource_folder_assignments a
       JOIN resources r ON r.id = a.resource_id
       LEFT JOIN LATERAL (
         SELECT f.file_name FROM resource_files f
          WHERE f.resource_id = r.id AND f.superseded_at IS NULL
          ORDER BY f.is_primary DESC, f.uploaded_at LIMIT 1) pf ON TRUE
      WHERE a.folder_id = $2 AND ${SCOPE_SQL}`, [orgId, folderId]);
  const clash = siblings.find((s) => (s.file_name && rules.nameKey(s.file_name) === rules.nameKey(fileName))
    || rules.nameKey(s.title) === rules.nameKey(title));
  if (clash) {
    if (onConflict === 'replace') {
      const resource = await scopedResource(orgId, clash.id);
      if (!resource) return res.status(404).json({ error: 'Not found' });
      return replaceDocument(req, res, resource, fileName, req.body && req.body.fileData);
    }
    const dot = fileName.lastIndexOf('.');
    const ext = dot > 0 ? fileName.slice(dot) : '';
    const taken = [];
    siblings.forEach((s) => {
      if (s.file_name) taken.push(s.file_name);
      taken.push(s.title + ext);
    });
    const suggestion = rules.suffixedName(fileName, taken);
    if (onConflict !== 'keepBoth') {
      return res.status(409).json({
        error: `"${clash.file_name || clash.title}" is already in ${folder.rows[0].name}.`,
        code: 'duplicate_name',
        existing: { id: clash.id, title: clash.title, fileName: clash.file_name || null },
        suggestedName: suggestion,
      });
    }
    fileName = suggestion;
    title = titleFromFileName(fileName);
  }

  const client = await pool.connect();
  let resource;
  try {
    await client.query('BEGIN');
    const slug = await uniqueResourceSlug(client, orgId, title);
    const created = await client.query(
      `INSERT INTO resources
         (organisation_id, title, slug, content_type, resource_type, status,
          publication_state, access_tier, source_class, rights_status,
          authority_level, created_by, updated_by, content_owner, approved_by, approved_at)
       VALUES ($1, $2, $3, 'download', 'download', 'approved',
               'approved', 'staff', 'opal-original', 'opal-owned',
               'internal', $4, $4, $4, $4, NOW())
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

  // The record exists but has no document yet, which is not a resource. Any
  // way out of this block other than success — a refusal, a storage fault, a
  // database error filing it — removes it again (and any bytes only it
  // referenced), so an approved, staff-visible shell can never be left behind
  // for every therapist to find. It was created moments ago by this request
  // and nothing else references it.
  let stored;
  const discard = async () => {
    await pool.query('DELETE FROM resources WHERE id = $1', [resource.id]).catch(() => {});
    if (stored && stored.storageKey) await dropBlobIfUnreferenced(stored.storageKey);
  };
  try {
    stored = await intake.storeFile(resource, {
      fileName, format, fileData: req.body && req.body.fileData, isPrimary: true,
      // Thumbnails are generated by shelling out to a renderer, which is slow
      // and entirely optional. Somebody dropping twenty files should not wait
      // for twenty renders; the cards lazy-load thumbnails and fall back to a
      // file-type glyph when one is not there yet.
    }, { userId: req.user.id, deferDerivatives: true });

    if (stored.ok) {
      await pool.query(
        `INSERT INTO resource_folder_assignments
           (resource_id, organisation_id, folder_id, classification_source, confidence,
            manual_lock, rationale)
         VALUES ($1, $2, $3, 'manual', 1.0, TRUE, 'Uploaded into this folder.')
         ON CONFLICT (resource_id) DO UPDATE SET folder_id = EXCLUDED.folder_id`,
        [resource.id, orgId, folderId]);
    }
  } catch (err) {
    await discard();
    throw err;
  }

  if (!stored.ok) {
    await discard();
    if (stored.code === 'privacy_rejected') {
      await audit(req, 'resource_library.upload_privacy_rejected', null,
        { folder: folder.rows[0].name, privacy: stored.privacy, identifiers: stored.identifiers });
    }
    return res.status(stored.status).json({ error: stored.error, code: stored.code, reasons: stored.reasons });
  }

  await audit(req, 'resource_library.file_uploaded', resource.id, {
    folder: folder.rows[0].name, fileName, format, sizeBytes: stored.sizeBytes,
    keptBoth: !!clash,
  });

  res.status(201).json({
    ok: true,
    resource: { id: resource.id, title: resource.title, slug: resource.slug },
    file: stored.file,
    folder: folder.rows[0].name,
    renamedTo: clash ? fileName : null,
    warnings: stored.warnings,
    // Said plainly so the client can be honest about what was and was not
    // inspected, rather than implying every format is scanned.
    privacyScanned: stored.privacyScanned,
  });
}));

// ═════════════════════════════════════════════════════════════════════════════
//  ONE DOCUMENT: replace, versions, rename, details
// ═════════════════════════════════════════════════════════════════════════════

/** Replace a document's file with a new version (live immediately). */
router.post('/api/rh2/library/resources/:id/replace', requireManager, safe(async (req, res) => {
  const resource = await scopedResource(orgOf(req), req.params.id);
  if (!resource) return res.status(404).json({ error: 'Not found' });
  let fileName = str(req.body && req.body.fileName, 300);
  if (!fileName) return res.status(400).json({ error: 'A file name is required.' });
  fileName = fileName.replace(/[\\/]/g, '_');
  return replaceDocument(req, res, resource, fileName, req.body && req.body.fileData);
}));

/** May this user see this document at all? Returns the row or null. */
async function visibleResource(req, id) {
  if (!isUuid(id)) return null;
  const vis = visibilityFor(req.user, orgOf(req), 2);
  const { rows } = await pool.query(
    `SELECT r.* FROM resources r WHERE r.id = $1 AND ${vis.where}`, [id, ...vis.params]);
  return rows[0] || null;
}

/**
 * A document's file versions, newest first: who, when, size, file name, and a
 * download link through the governed file route. Anyone who can open the
 * document can see its history; restoring is the managers'.
 */
router.get('/api/rh2/library/resources/:id/versions', safe(async (req, res) => {
  const resource = await visibleResource(req, req.params.id);
  if (!resource) return res.status(404).json({ error: 'Not found' });
  const { rows } = await pool.query(
    `SELECT v.version_no, v.file_id, v.file_name, v.format, v.file_size_bytes, v.action,
            v.restored_from_version, v.created_at, ${displayName('u')} AS created_by_name,
            (f.id IS NOT NULL) AS file_exists
       FROM resource_file_versions v
       LEFT JOIN users u ON u.id = v.created_by
       LEFT JOIN resource_files f ON f.id = v.file_id AND f.resource_id = v.resource_id
      WHERE v.resource_id = $1
      ORDER BY v.version_no DESC`, [resource.id]);
  const current = rows.length ? rows[0].version_no : null;
  res.json({
    versions: rows.map((v) => ({
      versionNo: v.version_no,
      fileName: v.file_name, format: v.format,
      sizeBytes: v.file_size_bytes === null ? null : Number(v.file_size_bytes),
      action: v.action, restoredFrom: v.restored_from_version,
      createdAt: v.created_at, createdBy: v.created_by_name || null,
      isCurrent: v.version_no === current,
      downloadUrl: v.file_exists ? `/api/rh2/files/${v.file_id}` : null,
    })),
    canRestore: canAuthor(req.user),
  });
}));

/**
 * Restore a previous version. History is never rewritten: the old file
 * becomes current again as a NEW version that records which one it restored.
 */
router.post('/api/rh2/library/resources/:id/versions/:versionNo/restore', requireManager, safe(async (req, res) => {
  const orgId = orgOf(req);
  const resource = await scopedResource(orgId, req.params.id);
  if (!resource) return res.status(404).json({ error: 'Not found' });
  const versionNo = parseInt(req.params.versionNo, 10);
  if (!Number.isInteger(versionNo) || versionNo < 1) return res.status(404).json({ error: 'Not found' });

  const client = await pool.connect();
  let created;
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM resources WHERE id = $1 FOR UPDATE', [resource.id]);
    const { rows: vr } = await client.query(
      `SELECT v.version_no, v.file_id, f.file_name, f.format, f.file_size_bytes,
              f.checksum_sha256, f.is_primary
         FROM resource_file_versions v
         JOIN resource_files f ON f.id = v.file_id AND f.resource_id = v.resource_id
        WHERE v.resource_id = $1 AND v.version_no = $2`, [resource.id, versionNo]);
    if (!vr.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'That version is no longer available.', code: 'version_not_found' });
    }
    const v = vr[0];
    if (v.is_primary) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'That version is already the current one.', code: 'already_current' });
    }
    await client.query(
      `UPDATE resource_files SET is_primary = FALSE, superseded_at = NOW()
        WHERE resource_id = $1 AND is_primary`, [resource.id]);
    await client.query(
      'UPDATE resource_files SET is_primary = TRUE, superseded_at = NULL WHERE id = $1', [v.file_id]);
    const ins = await client.query(
      `INSERT INTO resource_file_versions
         (resource_id, organisation_id, version_no, file_id, file_name, format,
          file_size_bytes, checksum_sha256, action, restored_from_version, created_by)
       SELECT $1, $2, COALESCE(MAX(version_no), 0) + 1, $3, $4, $5, $6, $7, 'restore', $8, $9
         FROM resource_file_versions WHERE resource_id = $1
       RETURNING version_no`,
      [resource.id, orgId, v.file_id, v.file_name, v.format, v.file_size_bytes,
        v.checksum_sha256, versionNo, req.user.id]);
    created = ins.rows[0].version_no;
    await client.query('UPDATE resources SET updated_at = NOW(), updated_by = $2 WHERE id = $1',
      [resource.id, req.user.id]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  await audit(req, 'resource_library.version_restored', resource.id,
    { restoredFrom: versionNo, newVersion: created });
  res.json({ ok: true, versionNo: created, restoredFrom: versionNo });
}));

/**
 * Rename a document.
 *
 * Deliberately its own route rather than the Admin PATCH. Renaming from the
 * library is a filing action, not an editorial one: it changes what the
 * document is called and nothing else, so it does not ask for a change note
 * and does not touch the version history or anybody's acknowledgement.
 */
router.patch('/api/rh2/library/resources/:id', requireManager, safe(async (req, res) => {
  const orgId = orgOf(req);
  const id = req.params.id;
  if (!isUuid(id)) return res.status(404).json({ error: 'Not found' });

  const title = str(req.body && req.body.title, 300);
  if (!title) return res.status(400).json({ error: 'Give the document a name.', code: 'empty_title' });

  const before = await scopedResource(orgId, id);
  if (!before) return res.status(404).json({ error: 'Not found' });

  // SCOPE_SQL is written against an `r` alias, so the UPDATE has to provide
  // one — without it Postgres refuses with "missing FROM-clause entry".
  const { rows } = await pool.query(
    `UPDATE resources r SET title = $3, updated_at = NOW(), updated_by = $4
      WHERE r.id = $2 AND ${SCOPE_SQL}
      RETURNING r.id, r.title, r.slug`,
    [orgId, id, title, req.user.id]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });

  await audit(req, 'resource_library.resource_renamed', id, { from: before.title, to: title });
  res.json({ ok: true, resource: rows[0], previous: { title: before.title } });
}));

/**
 * Everything the details pane shows about one document: where it is filed,
 * who made and last changed it, its current file and version, its tags and
 * its governance state.
 */
router.get('/api/rh2/library/resources/:id/details', safe(async (req, res) => {
  const orgId = orgOf(req);
  const resource = await visibleResource(req, req.params.id);
  if (!resource) return res.status(404).json({ error: 'Not found' });

  const { rows: who } = await pool.query(
    `SELECT ${displayName('cu')} AS created_by_name, ${displayName('mu')} AS modified_by_name,
            ${displayName('ou')} AS owner_name
       FROM resources r
       LEFT JOIN users cu ON cu.id = r.created_by
       LEFT JOIN users mu ON mu.id = COALESCE(r.updated_by, r.created_by)
       LEFT JOIN users ou ON ou.id = r.content_owner
      WHERE r.id = $1`, [resource.id]);
  const { rows: place } = await pool.query(
    'SELECT folder_id FROM resource_folder_assignments WHERE resource_id = $1', [resource.id]);
  const map = await bin.loadFolderMap(pool, orgId);
  const folderId = place[0] ? place[0].folder_id : null;
  const { rows: tags } = await pool.query(
    `SELECT t.category, t.name FROM resource_tag_links l JOIN resource_tags t ON t.id = l.tag_id
      WHERE l.resource_id = $1 ORDER BY t.category, t.name`, [resource.id]);
  const { rows: file } = await pool.query(
    `SELECT f.id, f.file_name, f.format, f.file_size_bytes, f.uploaded_at, f.access_tier
       FROM resource_files f WHERE f.resource_id = $1 AND f.superseded_at IS NULL
      ORDER BY f.is_primary DESC, f.uploaded_at LIMIT 1`, [resource.id]);
  const { rows: ver } = await pool.query(
    'SELECT MAX(version_no) AS n, COUNT(*)::int AS c FROM resource_file_versions WHERE resource_id = $1',
    [resource.id]);
  const f = file[0];
  const fileOk = f && governance.canReadFile(req.user && req.user.role, resource.access_tier, f.access_tier);

  res.json({
    resource: {
      id: resource.id, title: resource.title, slug: resource.slug,
      description: resource.description, contentType: resource.content_type,
      status: resource.status, publicationState: resource.publication_state,
      accessTier: resource.access_tier, mandatory: resource.mandatory,
      createdAt: resource.created_at, createdBy: who[0] ? who[0].created_by_name : null,
      modifiedAt: resource.updated_at, modifiedBy: who[0] ? who[0].modified_by_name : null,
      owner: who[0] ? who[0].owner_name : null,
      reviewDueAt: resource.review_due_at, lastReviewedAt: resource.last_reviewed_at,
      folder: folderId && map.has(folderId) && map.get(folderId).is_active
        ? { id: folderId, path: bin.pathNames(map, folderId) } : null,
      file: fileOk ? {
        id: f.id, fileName: f.file_name, format: f.format,
        sizeBytes: f.file_size_bytes === null ? null : Number(f.file_size_bytes),
        uploadedAt: f.uploaded_at, downloadUrl: `/api/rh2/files/${f.id}`,
      } : null,
      versionNo: ver[0] && ver[0].n ? ver[0].n : null,
      versionCount: ver[0] ? ver[0].c : 0,
      tags,
    },
  });
}));

module.exports = router;
