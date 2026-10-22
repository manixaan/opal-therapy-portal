'use strict';

/**
 * THE LIBRARY RECYCLE BIN — deleting, restoring and purging (migration 077).
 *
 * ── DELETE ────────────────────────────────────────────────────────────────
 * Nothing in the Library is destroyed by Delete. A document is stamped into
 * the bin (deleted_at, who, the folder it was in, and its exact prior state)
 * and hidden by the same status/archived_at rule every reader already obeys.
 * Deleting a folder takes its whole subtree with it — the folders and every
 * document filed in them — as ONE batch keyed by the deleted folder's id, so
 * they come back (or go for good) together.
 *
 * ── RESTORE ───────────────────────────────────────────────────────────────
 * An item goes back where it was. If the folder it came from is itself in the
 * bin, or was removed before the bin existed, the path is recreated: those
 * folders are revived (only them — not the rest of their batch). A restored
 * document gets back exactly the status, publication state and archive stamp
 * it had, so a draft comes back a draft and an approved policy comes back
 * approved.
 *
 * ── PURGE ─────────────────────────────────────────────────────────────────
 * Owner-only by hand, and automatic 90 days after deletion. Purging deletes
 * the rows (files, versions, derivatives and assignments cascade) and THEN
 * the stored bytes — but only bytes nothing else still references. Blobs are
 * content-addressed and shared across resources, so a policy PDF that is also
 * filed under another resource must survive the other one's purge.
 */

const { pool } = require('./database');
const fileStorage = require('./resource-file-storage');
const rules = require('./resource-library-rules');
const log = require('./logger').createLogger('resource-recycle-bin');

/** Every library folder of an organisation, keyed by id, including deleted ones. */
async function loadFolderMap(db, orgId) {
  const { rows } = await db.query(
    `SELECT id, parent_id, name, is_active, is_review_bucket, deleted_at,
            deleted_with_folder_id
       FROM resource_folders
      WHERE organisation_id IS NOT DISTINCT FROM $1 AND kind = 'library'`, [orgId]);
  return new Map(rows.map((r) => [r.id, r]));
}

/** The ids of a folder's descendants (not including itself). */
function descendantIds(map, rootId, filter) {
  const kids = new Map();
  for (const f of map.values()) {
    if (!f.parent_id) continue;
    if (!kids.has(f.parent_id)) kids.set(f.parent_id, []);
    kids.get(f.parent_id).push(f);
  }
  const out = [];
  const stack = [rootId];
  const seen = new Set([rootId]);
  while (stack.length) {
    const id = stack.pop();
    for (const child of kids.get(id) || []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      if (filter && !filter(child)) continue;
      out.push(child.id);
      stack.push(child.id);
    }
  }
  return out;
}

/** Folder names from the top down to (and including) `folderId`. */
function pathNames(map, folderId) {
  const names = [];
  let cursor = folderId ? map.get(folderId) : null;
  const seen = new Set();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    names.unshift(cursor.name);
    cursor = cursor.parent_id ? map.get(cursor.parent_id) : null;
  }
  return names;
}

// ═════════════════════════════════════════════════════════════════════════════
//  DELETE
// ═════════════════════════════════════════════════════════════════════════════

/** The live-and-in-scope predicate a deletable document must satisfy. */
const DELETABLE_SQL = `
     r.organisation_id IS NOT DISTINCT FROM $1
 AND r.deleted_at IS NULL
 AND r.status <> 'archived'
 AND r.archived_at IS NULL
 AND COALESCE(r.access_tier, '') <> 'excluded-private'
 AND COALESCE(r.publication_state, '') <> 'excluded-private'`;

/**
 * Stamp documents into the bin. `batchId` is the deleted folder that took them
 * (null for a document deleted on its own). Runs on the caller's client so it
 * shares the caller's transaction.
 */
async function stampResources(client, orgId, ids, userId, batchId) {
  if (!ids.length) return [];
  const { rows } = await client.query(
    `UPDATE resources r
        SET deleted_at = NOW(), deleted_by = $3, deleted_with_folder_id = $4,
            deleted_from_folder_id = (SELECT a.folder_id FROM resource_folder_assignments a
                                       WHERE a.resource_id = r.id),
            deleted_prior = jsonb_build_object(
              'status', r.status, 'publication_state', r.publication_state,
              'archived_at', r.archived_at),
            status = 'archived', archived_at = NOW(), updated_at = NOW(), updated_by = $3
      WHERE r.id = ANY($2::uuid[]) AND ${DELETABLE_SQL}
      RETURNING r.id, r.title`,
    [orgId, ids, userId, batchId]);
  return rows;
}

/**
 * Send documents and folders to the bin, in one transaction.
 *
 * @returns {{resources: Array<{id,title}>, folders: Array<{id,name,resourceCount}>}}
 */
async function deleteItems(orgId, { resourceIds = [], folderIds = [] }, userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const map = await loadFolderMap(client, orgId);
    const doneFolders = [];
    const doneResources = [];

    // A folder inside another selected folder goes with its ancestor's batch.
    const selected = new Set(folderIds.filter((id) => map.has(id)));
    const isUnderSelected = (id) => {
      let cursor = map.get(id) && map.get(id).parent_id;
      const seen = new Set();
      while (cursor && !seen.has(cursor)) {
        if (selected.has(cursor)) return true;
        seen.add(cursor);
        cursor = map.get(cursor) && map.get(cursor).parent_id;
      }
      return false;
    };

    for (const id of selected) {
      const f = map.get(id);
      if (!f || !f.is_active || f.is_review_bucket || isUnderSelected(id)) continue;
      const batch = [id, ...descendantIds(map, id, (c) => c.is_active)];
      await client.query(
        `UPDATE resource_folders
            SET is_active = FALSE, deleted_at = NOW(), deleted_by = $2,
                deleted_with_folder_id = $3, updated_at = NOW(), updated_by = $2
          WHERE id = ANY($1::uuid[])`, [batch, userId, id]);
      const filed = await client.query(
        `SELECT r.id FROM resource_folder_assignments a JOIN resources r ON r.id = a.resource_id
          WHERE a.folder_id = ANY($2::uuid[]) AND ${DELETABLE_SQL}`, [orgId, batch]);
      const stamped = await stampResources(client, orgId, filed.rows.map((r) => r.id), userId, id);
      doneFolders.push({ id, name: f.name, resourceCount: stamped.length, folderCount: batch.length });
    }

    const loose = resourceIds.filter((x) => !doneResources.some((d) => d.id === x));
    doneResources.push(...await stampResources(client, orgId, loose, userId, null));

    await client.query('COMMIT');
    return { resources: doneResources, folders: doneFolders };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  RESTORE
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Make sure `folderId` and every folder above it is live, reviving only the
 * folders on the path. Returns false when the path cannot be rebuilt (a
 * folder on it no longer exists at all).
 */
async function revivePath(client, map, folderId, userId) {
  const chain = [];
  let cursor = folderId;
  const seen = new Set();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const f = map.get(cursor);
    if (!f) return false;
    chain.push(f);
    cursor = f.parent_id;
  }
  const dead = chain.filter((f) => !f.is_active).map((f) => f.id);
  if (dead.length) {
    await client.query(
      `UPDATE resource_folders
          SET is_active = TRUE, deleted_at = NULL, deleted_by = NULL,
              deleted_with_folder_id = NULL, updated_at = NOW(), updated_by = $2
        WHERE id = ANY($1::uuid[])`, [dead, userId]);
    for (const id of dead) {
      const f = map.get(id);
      f.is_active = true; f.deleted_at = null; f.deleted_with_folder_id = null;
    }
  }
  return true;
}

/** Put deleted documents back to their prior state, filed where they were. */
async function reviveResources(client, orgId, ids, userId, map) {
  if (!ids.length) return [];
  const { rows } = await client.query(
    `SELECT id, title, deleted_from_folder_id, deleted_prior FROM resources
      WHERE id = ANY($2::uuid[]) AND organisation_id IS NOT DISTINCT FROM $1
        AND deleted_at IS NOT NULL`, [orgId, ids]);
  const out = [];
  for (const r of rows) {
    const prior = r.deleted_prior || {};
    let folderId = r.deleted_from_folder_id;
    if (folderId && !(await revivePath(client, map, folderId, userId))) folderId = null;
    await client.query(
      `UPDATE resources
          SET status = COALESCE($2, 'draft'), publication_state = COALESCE($3, publication_state),
              archived_at = $4::timestamptz,
              deleted_at = NULL, deleted_by = NULL, deleted_from_folder_id = NULL,
              deleted_with_folder_id = NULL, deleted_prior = NULL,
              updated_at = NOW(), updated_by = $5
        WHERE id = $1`,
      [r.id, prior.status || null, prior.publication_state || null, prior.archived_at || null, userId]);
    if (folderId) {
      await client.query(
        `INSERT INTO resource_folder_assignments
           (resource_id, organisation_id, folder_id, classification_source, confidence,
            manual_lock, rationale, classified_at)
         VALUES ($1, $2, $3, 'manual', 1.0, TRUE, 'Restored from the recycle bin.', NOW())
         ON CONFLICT (resource_id) DO UPDATE
           SET folder_id = EXCLUDED.folder_id, manual_lock = TRUE,
               classification_source = 'manual', rationale = EXCLUDED.rationale,
               classified_at = NOW()`,
        [r.id, orgId, folderId]);
    }
    out.push({ id: r.id, title: r.title, folderId, path: folderId ? pathNames(map, folderId) : [] });
  }
  return out;
}

/** The folders and documents a bin entry stands for (a folder entry is a subtree). */
async function batchMembers(client, orgId, map, folderId) {
  const root = map.get(folderId);
  if (!root || !root.deleted_at) return null;
  const batch = root.deleted_with_folder_id;
  const folders = [folderId, ...descendantIds(map, folderId,
    (c) => !!c.deleted_at && c.deleted_with_folder_id === batch)];
  const { rows } = await client.query(
    `SELECT id FROM resources
      WHERE organisation_id IS NOT DISTINCT FROM $1 AND deleted_at IS NOT NULL
        AND deleted_with_folder_id = $2 AND deleted_from_folder_id = ANY($3::uuid[])`,
    [orgId, batch, folders]);
  return { folders, resources: rows.map((r) => r.id) };
}

/**
 * Restore bin entries: `items` is [{kind:'folder'|'resource', id}].
 * @returns {{folders: Array, resources: Array}}
 */
async function restoreItems(orgId, items, userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const map = await loadFolderMap(client, orgId);
    const restoredFolders = [];
    const restoredResources = [];

    for (const it of items.filter((i) => i.kind === 'folder')) {
      const members = await batchMembers(client, orgId, map, it.id);
      if (!members) continue;
      const root = map.get(it.id);
      // A live sibling may have taken the name while this was in the bin.
      const siblings = [...map.values()].filter((f) => f.is_active && f.id !== it.id
        && (f.parent_id || null) === (root.parent_id || null)).map((f) => f.name);
      const name = rules.suffixedName(root.name, siblings);
      if (root.parent_id && !(await revivePath(client, map, root.parent_id, userId))) {
        await client.query('UPDATE resource_folders SET parent_id = NULL WHERE id = $1', [it.id]);
        root.parent_id = null;
      }
      await client.query(
        `UPDATE resource_folders
            SET is_active = TRUE, deleted_at = NULL, deleted_by = NULL,
                deleted_with_folder_id = NULL, updated_at = NOW(), updated_by = $2
          WHERE id = ANY($1::uuid[])`, [members.folders, userId]);
      if (name !== root.name) {
        await client.query('UPDATE resource_folders SET name = $2 WHERE id = $1', [it.id, name]);
      }
      for (const id of members.folders) {
        const f = map.get(id);
        f.is_active = true; f.deleted_at = null; f.deleted_with_folder_id = null;
      }
      const docs = await reviveResources(client, orgId, members.resources, userId, map);
      restoredResources.push(...docs);
      restoredFolders.push({
        id: it.id, name, path: pathNames(map, it.id), resourceCount: docs.length,
      });
    }

    const docIds = items.filter((i) => i.kind === 'resource').map((i) => i.id);
    restoredResources.push(...await reviveResources(client, orgId, docIds, userId, map));

    await client.query('COMMIT');
    return { folders: restoredFolders, resources: restoredResources };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  PURGE
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Remove stored bytes that no row references any more. Called AFTER the rows
 * are gone, so a key shared with a surviving resource still has its row and
 * is left alone.
 */
async function removeUnreferencedBlobs(fileKeys, derivativeKeys) {
  let removed = 0;
  for (const key of new Set(fileKeys)) {
    const { rows } = await pool.query(
      'SELECT 1 FROM resource_files WHERE storage_key = $1 LIMIT 1', [key]);
    if (rows.length) continue;
    try { await fileStorage.removeBlob(key); removed++; } catch (err) {
      log.warn('blob removal failed', { reason: err.message });
    }
  }
  for (const key of new Set(derivativeKeys)) {
    const { rows } = await pool.query(
      'SELECT 1 FROM resource_file_derivatives WHERE storage_key = $1 LIMIT 1', [key]);
    if (rows.length) continue;
    try { await fileStorage.removeBlob(key); removed++; } catch (err) {
      log.warn('derivative removal failed', { reason: err.message });
    }
  }
  return removed;
}

/**
 * Permanently delete documents and folders that are IN THE BIN. Anything not
 * in the bin is ignored, so this can never be pointed at a live document.
 * Folders with a live descendant are skipped: the database would cascade the
 * delete onto it.
 *
 * @returns {{resources:number, folders:number, blobs:number}}
 */
async function purge(orgId, { resourceIds = [], folderIds = [] }, { allOrgs = false } = {}) {
  const client = await pool.connect();
  let fileKeys = [];
  let derivativeKeys = [];
  let resourceCount = 0;
  let folderCount = 0;
  try {
    await client.query('BEGIN');
    const orgClause = allOrgs ? 'TRUE' : 'organisation_id IS NOT DISTINCT FROM $2';
    const orgParam = allOrgs ? [] : [orgId];

    let folders = [];
    if (folderIds.length) {
      const { rows } = await client.query(
        `SELECT id, organisation_id FROM resource_folders
          WHERE id = ANY($1::uuid[]) AND ${orgClause} AND kind = 'library' AND deleted_at IS NOT NULL`,
        [folderIds, ...orgParam]);
      folders = rows;
    }
    // A folder entry stands for its subtree. A subtree with anything live in
    // it is skipped: parent_id cascades, so deleting it would take the live
    // folder with it.
    const maps = new Map();
    const allFolders = new Set();
    for (const f of folders) {
      if (!maps.has(f.organisation_id)) maps.set(f.organisation_id, await loadFolderMap(client, f.organisation_id));
      const map = maps.get(f.organisation_id);
      const below = descendantIds(map, f.id);
      if (below.some((id) => map.get(id).is_active)) continue;
      allFolders.add(f.id);
      below.forEach((id) => allFolders.add(id));
    }

    // Documents that went to the bin WITH those folders go with them. A
    // document deleted on its own keeps its own bin entry; losing its folder
    // only means a later restore files it nowhere (the FK sets it NULL).
    const { rows: docs } = await client.query(
      `SELECT id FROM resources
        WHERE deleted_at IS NOT NULL AND ${orgClause}
          AND (id = ANY($1::uuid[])
               OR (deleted_with_folder_id IS NOT NULL
                   AND deleted_from_folder_id = ANY($${allOrgs ? 2 : 3}::uuid[])))`,
      [resourceIds, ...orgParam, [...allFolders]]);
    const docIds = docs.map((d) => d.id);

    if (docIds.length) {
      const keys = await client.query(
        `SELECT storage_key FROM resource_files
          WHERE resource_id = ANY($1::uuid[]) AND storage_key IS NOT NULL`, [docIds]);
      fileKeys = keys.rows.map((r) => r.storage_key);
      const dkeys = await client.query(
        `SELECT d.storage_key FROM resource_file_derivatives d
           JOIN resource_files f ON f.id = d.resource_file_id
          WHERE f.resource_id = ANY($1::uuid[])`, [docIds]);
      derivativeKeys = dkeys.rows.map((r) => r.storage_key);
      const del = await client.query('DELETE FROM resources WHERE id = ANY($1::uuid[])', [docIds]);
      resourceCount = del.rowCount;
    }
    if (allFolders.size) {
      const del = await client.query(
        'DELETE FROM resource_folders WHERE id = ANY($1::uuid[]) AND deleted_at IS NOT NULL',
        [[...allFolders]]);
      folderCount = del.rowCount;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  const blobs = await removeUnreferencedBlobs(fileKeys, derivativeKeys);
  return { resources: resourceCount, folders: folderCount, blobs };
}

/** Everything in an organisation's bin, as purge() arguments. */
async function binContents(orgId) {
  const f = await pool.query(
    `SELECT id FROM resource_folders WHERE organisation_id IS NOT DISTINCT FROM $1
        AND kind = 'library' AND deleted_at IS NOT NULL`, [orgId]);
  const r = await pool.query(
    `SELECT id FROM resources WHERE organisation_id IS NOT DISTINCT FROM $1
        AND deleted_at IS NOT NULL`, [orgId]);
  return { folderIds: f.rows.map((x) => x.id), resourceIds: r.rows.map((x) => x.id) };
}

/**
 * The scheduled purge: everything deleted more than RECYCLE_BIN_DAYS before
 * `now`, across every organisation. `now` is a parameter so a test can shift
 * time rather than wait 90 days.
 */
async function purgeExpired({ now = new Date(), days = rules.RECYCLE_BIN_DAYS } = {}) {
  const cutoff = new Date(new Date(now).getTime() - days * 24 * 60 * 60 * 1000);
  const f = await pool.query(
    `SELECT id FROM resource_folders WHERE kind = 'library' AND deleted_at IS NOT NULL
        AND deleted_at <= $1`, [cutoff]);
  const r = await pool.query(
    'SELECT id FROM resources WHERE deleted_at IS NOT NULL AND deleted_at <= $1', [cutoff]);
  if (!f.rows.length && !r.rows.length) return { resources: 0, folders: 0, blobs: 0 };
  return purge(null, {
    folderIds: f.rows.map((x) => x.id), resourceIds: r.rows.map((x) => x.id),
  }, { allOrgs: true });
}

// ── the daily job ───────────────────────────────────────────────────────────

const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;
let _timer = null;
let _running = false;

/**
 * Same shape as the onboarding expiry sweep: one unref'd interval, guarded so
 * two ticks never overlap, first run a few minutes after boot. Single-instance
 * assumption as there; a second instance would only find nothing to purge.
 */
function startRecycleBinScheduler({ intervalMs = PURGE_INTERVAL_MS, firstDelayMs = 10 * 60 * 1000 } = {}) {
  if (_timer) return _timer;
  const tick = async () => {
    if (_running) return;
    _running = true;
    try {
      const result = await purgeExpired();
      if (result.resources || result.folders) {
        log.info('recycle bin purge', result);
        const db = require('./database');
        await db.logAuditEvent({
          actorUserId: null, action: 'resource_library.recycle_bin_auto_purged',
          targetType: 'resource', targetId: null, metadata: result,
        }).catch(() => {});
      }
    } catch (err) {
      if (!/relation .* does not exist|column .* does not exist/i.test(err.message)) {
        log.error('recycle bin purge failed', { error: err });
      }
    } finally { _running = false; }
  };
  setTimeout(tick, firstDelayMs).unref();
  _timer = setInterval(tick, intervalMs);
  _timer.unref();
  return _timer;
}

function stopRecycleBinScheduler() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

module.exports = {
  loadFolderMap,
  descendantIds,
  pathNames,
  deleteItems,
  restoreItems,
  batchMembers,
  purge,
  binContents,
  purgeExpired,
  startRecycleBinScheduler,
  stopRecycleBinScheduler,
};
