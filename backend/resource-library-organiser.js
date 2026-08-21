'use strict';

/**
 * ORGANISING THE LIBRARY — the part that touches the database.
 *
 * One run does five things, in this order and no other:
 *
 *   scan     which resources are in scope at all
 *   profile  what each one is, from metadata plus a sample of its text
 *   derive   what folders the collection actually needs
 *   review   a model improves placements and wording, where it is available
 *   apply    folders created, assignments written, previous state recorded
 *
 * Everything before `apply` is read-only. The library is untouched until the
 * whole answer exists and has been validated, so a run that dies halfway
 * leaves a working library rather than a half-sorted one (§61).
 *
 * ── WHAT A RUN MAY NOT DO ─────────────────────────────────────────────────
 * It does not move a file, rewrite a storage key, change a resource id, touch
 * a tag, a version, a favourite or an acknowledgement. It writes rows in
 * resource_folders, resource_folder_assignments and the two audit tables, and
 * that is the entire blast radius (§62). `resources.folder_id` — the legacy
 * ingestion grouping — is not written either.
 *
 * ── MANUAL PLACEMENT IS FINAL ─────────────────────────────────────────────
 * An assignment with manual_lock is read, counted and reported, and never
 * rewritten by a run (§14). The Owner corrects the machine once; the machine
 * does not argue.
 *
 * ── PROGRESS WITHOUT INTERNALS ────────────────────────────────────────────
 * The run row carries a coarse `phase`. The words a user reads are chosen in
 * the client, so no model id, token count or table name reaches a screen
 * (§16).
 */

const { pool } = require('./database');
const db = require('./database');
const taxonomy = require('./resource-library-taxonomy');
const classifier = require('./resource-library-classifier');
const textSampler = require('./resource-library-text');
const log = require('./logger').createLogger('resource-library-organiser');

/** Resources whose text is sampled from the file. Beyond this, metadata only. */
const MAX_FILES_SAMPLED = 400;
/** Hard ceiling on one run, so a runaway library cannot run for an hour. */
const MAX_RESOURCES = 5000;

const PHASES = Object.freeze(['scanning', 'reading', 'structuring', 'organising', 'done']);

// ═════════════════════════════════════════════════════════════════════════════
//  SCOPE — what a run is allowed to look at
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Active, non-private resources for one organisation.
 *
 * Archived records are excluded so folder counts describe what is actually
 * usable (§29), and excluded-private records are excluded because they are
 * client-derived: they must not reach a model, and they must not appear in a
 * folder either. Their absence here is the same boundary the Resource Hub
 * already enforces everywhere else.
 */
const SCOPE_SQL = `
     r.organisation_id IS NOT DISTINCT FROM $1
 AND r.status <> 'archived'
 AND r.archived_at IS NULL
 AND COALESCE(r.access_tier, '') <> 'excluded-private'
 AND COALESCE(r.publication_state, '') <> 'excluded-private'`;

async function loadCorpus(orgId) {
  const { rows } = await pool.query(
    `SELECT r.id, r.title, r.description, LEFT(r.content, 8000) AS content,
            r.content_type, r.resource_type, r.external_url, r.updated_at,
            COALESCE(array_agg(t.name) FILTER (WHERE t.id IS NOT NULL), '{}') AS tags,
            pf.id AS file_id, pf.storage_key, pf.format, pf.file_mime, pf.file_size_bytes
       FROM resources r
       LEFT JOIN resource_tag_links tl ON tl.resource_id = r.id
       LEFT JOIN resource_tags t ON t.id = tl.tag_id
       LEFT JOIN LATERAL (
         SELECT f.id, f.storage_key, f.format, f.file_mime, f.file_size_bytes
           FROM resource_files f
          WHERE f.resource_id = r.id
          ORDER BY f.is_primary DESC, f.uploaded_at
          LIMIT 1
       ) pf ON TRUE
      WHERE ${SCOPE_SQL}
      GROUP BY r.id, pf.id, pf.storage_key, pf.format, pf.file_mime, pf.file_size_bytes
      ORDER BY r.updated_at DESC
      LIMIT ${MAX_RESOURCES}`,
    [orgId]);
  return rows;
}

// ═════════════════════════════════════════════════════════════════════════════
//  PROFILING
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Build a semantic profile per resource.
 *
 * Text is sampled from the primary file only for resources whose metadata is
 * thin — a record with a real description and curated tags already tells us
 * what it is, and opening its PDF buys nothing (§43). Sampling is also capped,
 * because a first run over a library of this size should finish in minutes.
 */
async function buildProfiles(rows, { onProgress } = {}) {
  const tagWeights = taxonomy.tagWeights(rows.map((r) => r.tags || []));
  const profiles = [];
  let sampled = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    let text = '';
    let textSource = r.content ? 'content' : 'metadata';

    const thin = !r.description && !r.content && (r.tags || []).length < 2;
    if (thin && r.file_id && sampled < MAX_FILES_SAMPLED) {
      const got = await textSampler.sampleFile(r);
      text = got.text;
      textSource = got.source;
      if (got.text) sampled += 1;
    }

    const profile = taxonomy.buildProfile(r, { tags: r.tags || [], tagWeights, text, textSource });
    profile.contentType = r.content_type || r.resource_type || null;
    profile.tags = r.tags || [];
    profile.sampledText = text || null;
    profiles.push(profile);

    if (onProgress && (i % 50 === 0 || i === rows.length - 1)) await onProgress(i + 1, rows.length);
  }
  return profiles;
}

// ═════════════════════════════════════════════════════════════════════════════
//  APPLYING — folders, then assignments, transactionally
// ═════════════════════════════════════════════════════════════════════════════

function slugFor(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 140);
}

/**
 * Create or update the library folders, returning key -> folder id.
 *
 * A folder that already exists is REUSED, matched by slug. That is what makes
 * re-running safe: the Owner's bookmarks, the deep links and any manual
 * placements keep pointing at the same rows, and a second run does not produce
 * a second "Assessments" (§25, §52). A folder a person has renamed keeps its
 * name — name_locked survives every later run (§14).
 */
async function upsertFolders(client, orgId, folders, userId, patches) {
  const ids = new Map();
  let created = 0;

  // Parents first: a child needs its parent's id.
  const ordered = [...folders].sort((a, b) => (a.parent ? 1 : 0) - (b.parent ? 1 : 0));

  for (let i = 0; i < ordered.length; i++) {
    const f = ordered[i];
    const patch = (patches && patches.get(f.key)) || {};
    const name = patch.name || f.name;
    const description = patch.description || f.description || null;
    const slug = slugFor(f.key);
    const parentId = f.parent ? ids.get(f.parent) || null : null;

    const existing = await client.query(
      `SELECT id, name_locked FROM resource_folders
        WHERE organisation_id IS NOT DISTINCT FROM $1 AND kind = 'library' AND slug = $2`,
      [orgId, slug]);

    if (existing.rows.length) {
      const row = existing.rows[0];
      // A renamed folder keeps the name a person gave it; everything else is
      // refreshed so counts, ordering and reactivation stay correct.
      await client.query(
        `UPDATE resource_folders
            SET name = CASE WHEN name_locked THEN name ELSE $2 END,
                description = CASE WHEN name_locked THEN description ELSE $3 END,
                parent_id = $4, sort_order = $5, is_active = TRUE,
                is_review_bucket = $6, updated_at = NOW()
          WHERE id = $1`,
        [row.id, name, description, parentId, i, !!f.isReviewBucket]);
      ids.set(f.key, row.id);
      continue;
    }

    const ins = await client.query(
      `INSERT INTO resource_folders
         (organisation_id, parent_id, name, description, slug, kind, source,
          sort_order, is_active, is_review_bucket, created_by)
       VALUES ($1, $2, $3, $4, $5, 'library', $6, $7, TRUE, $8, $9)
       RETURNING id`,
      [orgId, parentId, name, description, slug,
        patches && patches.has(f.key) ? 'ai' : 'rules', i, !!f.isReviewBucket, userId || null]);
    ids.set(f.key, ins.rows[0].id);
    created += 1;
  }
  return { ids, created };
}

/**
 * Write the assignments, recording what each one replaced.
 *
 * Locked assignments are skipped outright — not compared, not overwritten,
 * not counted as changed. An assignment that has not actually moved writes no
 * history row, so the audit trail describes changes rather than restating the
 * status quo several hundred times.
 */
async function applyAssignments(client, orgId, runId, assignments, folderIds, userId) {
  const locked = await client.query(
    `SELECT resource_id FROM resource_folder_assignments
      WHERE organisation_id IS NOT DISTINCT FROM $1 AND manual_lock = TRUE`, [orgId]);
  const lockedIds = new Set(locked.rows.map((r) => r.resource_id));

  const previous = await client.query(
    `SELECT resource_id, folder_id, classification_source, manual_lock
       FROM resource_folder_assignments
      WHERE organisation_id IS NOT DISTINCT FROM $1`, [orgId]);
  const before = new Map(previous.rows.map((r) => [r.resource_id, r]));

  let assigned = 0;
  let skipped = 0;
  let review = 0;

  for (const a of assignments) {
    if (lockedIds.has(a.resourceId)) { skipped += 1; continue; }

    const folderId = folderIds.get(a.folderKey);
    // A folder key with no row is a bug in derivation, not something to guess
    // around. Leaving the resource where it was is the safe failure.
    if (!folderId) { skipped += 1; continue; }
    if (a.folderKey === taxonomy.REVIEW_KEY) review += 1;

    const prior = before.get(a.resourceId);
    const confidence = Math.round(Math.min(1, Math.max(0, a.confidence || 0)) * 1000) / 1000;

    await client.query(
      `INSERT INTO resource_folder_assignments
         (resource_id, organisation_id, folder_id, classification_source, confidence,
          manual_lock, rationale, run_id, classified_at)
       VALUES ($1, $2, $3, $4, $5, FALSE, $6, $7, NOW())
       ON CONFLICT (resource_id) DO UPDATE
         SET folder_id = EXCLUDED.folder_id,
             classification_source = EXCLUDED.classification_source,
             confidence = EXCLUDED.confidence,
             rationale = EXCLUDED.rationale,
             run_id = EXCLUDED.run_id,
             classified_at = NOW()`,
      [a.resourceId, orgId, folderId, a.source === 'ai' ? 'ai' : 'rules',
        confidence, (a.rationale || '').slice(0, 300), runId]);

    if (!prior || prior.folder_id !== folderId) {
      await client.query(
        `INSERT INTO resource_assignment_history
           (run_id, organisation_id, resource_id, from_folder_id, to_folder_id,
            from_source, to_source, from_locked, changed_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [runId, orgId, a.resourceId, prior ? prior.folder_id : null, folderId,
          prior ? prior.classification_source : null, a.source === 'ai' ? 'ai' : 'rules',
          prior ? prior.manual_lock : null, userId || null]);
    }
    assigned += 1;
  }

  /**
   * An empty derived folder is retired (§31). Two exceptions, and both matter:
   *
   *   a folder a PERSON made — an empty folder somebody created deliberately
   *   is a plan, not a mistake;
   *
   *   NEEDS REVIEW — which is a system fixture rather than a topic. It is
   *   where a later upload goes when it cannot be placed, and where a deleted
   *   folder's resources are sent so nothing is orphaned. Retiring it because
   *   a good run left it empty removes the safety net exactly when the library
   *   looks tidiest. It is HIDDEN from the folder list while empty instead,
   *   which is what §31 is actually asking for.
   */
  await client.query(
    `UPDATE resource_folders f SET is_active = FALSE, updated_at = NOW()
      WHERE f.organisation_id IS NOT DISTINCT FROM $1
        AND f.kind = 'library' AND f.source <> 'manual' AND f.is_active
        AND NOT f.is_review_bucket
        AND NOT EXISTS (SELECT 1 FROM resource_folder_assignments a WHERE a.folder_id = f.id)
        AND NOT EXISTS (SELECT 1 FROM resource_folders c WHERE c.parent_id = f.id AND c.is_active)`,
    [orgId]);

  return { assigned, skipped, review };
}

// ═════════════════════════════════════════════════════════════════════════════
//  THE RUN
// ═════════════════════════════════════════════════════════════════════════════

async function setPhase(runId, phase, patch = {}) {
  const fields = ['phase = $2'];
  const params = [runId, phase];
  for (const [col, val] of Object.entries(patch)) {
    params.push(val);
    fields.push(`${col} = $${params.length}`);
  }
  await pool.query(
    `UPDATE resource_classification_runs SET ${fields.join(', ')} WHERE id = $1`, params)
    .catch(() => {});
}

/**
 * Begin a run. Returns the run row, or null when one is already going.
 *
 * The uniqueness is enforced by a partial unique index rather than by checking
 * first — two Owners pressing the button at the same moment would both pass a
 * check, and neither snapshot would then describe the library.
 */
async function startRun(orgId, userId, mode = 'organise') {
  try {
    const { rows } = await pool.query(
      `INSERT INTO resource_classification_runs (organisation_id, started_by, mode)
       VALUES ($1, $2, $3) RETURNING *`,
      [orgId, userId || null, mode]);
    return rows[0];
  } catch (err) {
    if (err && err.code === '23505') return null; // a run is already going
    throw err;
  }
}

/**
 * Do the work. Called without await by the route — progress is read from the
 * run row, and a failure is recorded there rather than thrown at nobody.
 */
async function executeRun(run, { userId } = {}) {
  const orgId = run.organisation_id;
  const runId = run.id;

  try {
    await setPhase(runId, 'scanning');
    const rows = await loadCorpus(orgId);
    await setPhase(runId, 'reading', { scanned_count: rows.length });

    if (!rows.length) {
      await pool.query(
        `UPDATE resource_classification_runs
            SET status='complete', phase='done', finished_at=NOW(), taxonomy='[]'::jsonb
          WHERE id=$1`, [runId]);
      return;
    }

    const profiles = await buildProfiles(rows, {
      onProgress: (done) => setPhase(runId, 'reading', { profiled_count: done }),
    });

    await setPhase(runId, 'structuring', { profiled_count: profiles.length });
    const derived = taxonomy.deriveTaxonomy(profiles);
    let assignments = taxonomy.assignAll(profiles, derived);

    // ── the model's turn, if it has one ──────────────────────────────────
    let aiUsed = false;
    let aiReason = classifier.unavailableReason();
    let patches = null;

    if (classifier.isAvailable()) {
      const options = derived.folders.map((f) => ({
        key: f.key, name: f.name, description: f.description,
      }));
      const refined = await classifier.refinePlacements(profiles, options, {
        userId, organisationId: orgId,
        onBatch: (done, total) => setPhase(runId, 'structuring', {
          profiled_count: Math.round((done / total) * profiles.length),
        }),
      }).catch((err) => {
        aiReason = (err && (err.reason || err.message) || 'ai_error').slice(0, 80);
        return null;
      });

      if (refined && refined.placements.size) {
        aiUsed = true;
        assignments = assignments.map((a) =>
          classifier.reconcile(a, refined.placements.get(a.resourceId) || null));
      } else if (refined) {
        aiReason = 'no_usable_answer';
      }

      patches = await describeFolders(derived, assignments, rows)
        .then((described) => classifier.refineTaxonomy(described, { userId, organisationId: orgId }))
        .catch(() => null);
      if (patches && patches.size) aiUsed = true;
    }

    // ── apply ─────────────────────────────────────────────────────────────
    await setPhase(runId, 'organising');
    const client = await pool.connect();
    let result;
    try {
      await client.query('BEGIN');
      const { ids, created } = await upsertFolders(client, orgId, derived.folders, userId, patches);
      result = await applyAssignments(client, orgId, runId, assignments, ids, userId);
      result.created = created;
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    const snapshot = derived.folders.map((f) => ({
      key: f.key,
      name: (patches && patches.get(f.key) && patches.get(f.key).name) || f.name,
      parent: f.parent || null,
    }));

    await pool.query(
      `UPDATE resource_classification_runs
          SET status='complete', phase='done', finished_at=NOW(),
              assigned_count=$2, skipped_locked=$3, review_count=$4, folders_created=$5,
              ai_used=$6, ai_unavailable_reason=$7, taxonomy=$8::jsonb, duplicates=$9::jsonb
        WHERE id=$1`,
      [runId, result.assigned, result.skipped, result.review, result.created,
        aiUsed, aiUsed ? null : (aiReason || 'unavailable'),
        JSON.stringify(snapshot), JSON.stringify(taxonomy.findDuplicates(profiles))]);

    await db.logAuditEvent({
      actorUserId: userId, action: 'resource_library.organised', targetType: 'resource',
      targetId: null, organisationId: orgId,
      metadata: {
        runId, resources: rows.length, folders: derived.folders.length,
        assigned: result.assigned, lockedKept: result.skipped, needsReview: result.review,
        aiUsed,
      },
    }).catch(() => {});
  } catch (err) {
    log.error('library organisation failed', { error: err, runId });
    await pool.query(
      `UPDATE resource_classification_runs
          SET status='failed', finished_at=NOW(), error=$2 WHERE id=$1`,
      [runId, String((err && err.message) || 'unknown').slice(0, 300)]).catch(() => {});
  }
}

/** Folder summaries for the model's review: names, counts and example titles. */
async function describeFolders(derived, assignments, rows) {
  const titles = new Map(rows.map((r) => [r.id, r.title]));
  const byKey = new Map();
  for (const a of assignments) {
    if (!byKey.has(a.folderKey)) byKey.set(a.folderKey, []);
    byKey.get(a.folderKey).push(titles.get(a.resourceId) || '');
  }
  const nameOf = (key) => (derived.folders.find((f) => f.key === key) || {}).name || key;
  return derived.folders.map((f) => ({
    key: f.key,
    name: f.name,
    description: f.description,
    isReviewBucket: !!f.isReviewBucket,
    parentName: f.parent ? nameOf(f.parent) : null,
    count: (byKey.get(f.key) || []).length,
    sampleTitles: (byKey.get(f.key) || []).filter(Boolean).slice(0, 8),
  }));
}

// ═════════════════════════════════════════════════════════════════════════════
//  ONE RESOURCE AT A TIME (§23, §57, §58, §59)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Shelve a single resource against the taxonomy that already exists.
 *
 * Cannot create a folder, by construction: it chooses from the live folder
 * list or returns Needs Review (§24). Refuses to move a locked assignment, so
 * editing a resource's description cannot undo the Owner's filing (§58), and
 * returns null when no taxonomy exists yet — a library nobody has organised
 * should not sprout one folder because somebody uploaded a file.
 *
 * @returns {Promise<{folderId, folderName, confidence, review}|null>}
 */
async function classifyResource(orgId, resourceId, { userId, force = false } = {}) {
  const { rows } = await pool.query(
    `SELECT r.id, r.title, r.description, LEFT(r.content, 8000) AS content,
            r.content_type, r.resource_type, r.external_url,
            COALESCE(array_agg(t.name) FILTER (WHERE t.id IS NOT NULL), '{}') AS tags,
            pf.id AS file_id, pf.storage_key, pf.format, pf.file_mime, pf.file_size_bytes
       FROM resources r
       LEFT JOIN resource_tag_links tl ON tl.resource_id = r.id
       LEFT JOIN resource_tags t ON t.id = tl.tag_id
       LEFT JOIN LATERAL (
         SELECT f.id, f.storage_key, f.format, f.file_mime, f.file_size_bytes
           FROM resource_files f WHERE f.resource_id = r.id
          ORDER BY f.is_primary DESC, f.uploaded_at LIMIT 1
       ) pf ON TRUE
      WHERE r.id = $2 AND ${SCOPE_SQL}
      GROUP BY r.id, pf.id, pf.storage_key, pf.format, pf.file_mime, pf.file_size_bytes`,
    [orgId, resourceId]);
  if (!rows.length) return null;
  const r = rows[0];

  const existing = await pool.query(
    'SELECT manual_lock FROM resource_folder_assignments WHERE resource_id = $1', [resourceId]);
  if (existing.rows.length && existing.rows[0].manual_lock && !force) return null;

  const folders = await pool.query(
    `SELECT id, name, slug, is_review_bucket FROM resource_folders
      WHERE organisation_id IS NOT DISTINCT FROM $1 AND kind = 'library' AND is_active`,
    [orgId]);
  if (!folders.rows.length) return null; // nothing organised yet — do not invent a shelf

  const bySlug = new Map(folders.rows.map((f) => [f.slug, f]));
  const keys = folders.rows.map((f) => f.slug).filter(Boolean);

  let text = '';
  let textSource = r.content ? 'content' : 'metadata';
  if (!r.description && !r.content && r.file_id) {
    const got = await textSampler.sampleFile(r);
    text = got.text; textSource = got.source;
  }

  const profile = taxonomy.buildProfile(r, { tags: r.tags || [], text, textSource });
  const choice = taxonomy.classifyOne(profile, keys);

  const folder = bySlug.get(choice.folderKey)
    || folders.rows.find((f) => f.is_review_bucket)
    || null;
  if (!folder) return null;

  await pool.query(
    `INSERT INTO resource_folder_assignments
       (resource_id, organisation_id, folder_id, classification_source, confidence, manual_lock, rationale)
     VALUES ($1, $2, $3, 'rules', $4, FALSE, $5)
     ON CONFLICT (resource_id) DO UPDATE
       SET folder_id = EXCLUDED.folder_id, classification_source = 'rules',
           confidence = EXCLUDED.confidence, rationale = EXCLUDED.rationale,
           classified_at = NOW()
      WHERE resource_folder_assignments.manual_lock = FALSE`,
    [resourceId, orgId, folder.id,
      Math.round(Math.min(1, Math.max(0, choice.confidence)) * 1000) / 1000,
      (choice.rationale || '').slice(0, 300)]);

  await db.logAuditEvent({
    actorUserId: userId, action: 'resource_library.auto_classified',
    targetType: 'resource', targetId: resourceId, organisationId: orgId,
    metadata: { folder: folder.name, confidence: choice.confidence },
  }).catch(() => {});

  return {
    folderId: folder.id, folderName: folder.name,
    confidence: choice.confidence, review: !!folder.is_review_bucket,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
//  ROLLBACK (§39)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Put the assignments back the way the named run found them.
 *
 * Works off the history rows the run wrote, in reverse, and refuses to touch
 * anything a person has locked SINCE the run — an Owner's later correction
 * outranks an undo of the thing they were correcting.
 */
async function rollbackRun(orgId, runId, userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const run = await client.query(
      `SELECT * FROM resource_classification_runs
        WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2 FOR UPDATE`, [runId, orgId]);
    if (!run.rows.length) { await client.query('ROLLBACK'); return { ok: false, reason: 'not_found' }; }
    if (run.rows[0].status === 'running') { await client.query('ROLLBACK'); return { ok: false, reason: 'still_running' }; }
    if (run.rows[0].rolled_back_at) { await client.query('ROLLBACK'); return { ok: false, reason: 'already_rolled_back' }; }

    const history = await client.query(
      `SELECT * FROM resource_assignment_history
        WHERE run_id = $1 ORDER BY id DESC`, [runId]);

    let restored = 0;
    for (const h of history.rows) {
      const current = await client.query(
        'SELECT manual_lock FROM resource_folder_assignments WHERE resource_id = $1', [h.resource_id]);
      if (current.rows.length && current.rows[0].manual_lock) continue;

      if (!h.from_folder_id) {
        await client.query('DELETE FROM resource_folder_assignments WHERE resource_id = $1', [h.resource_id]);
      } else {
        await client.query(
          `UPDATE resource_folder_assignments
              SET folder_id = $2, classification_source = COALESCE($3, 'rules'),
                  manual_lock = COALESCE($4, FALSE), classified_at = NOW()
            WHERE resource_id = $1`,
          [h.resource_id, h.from_folder_id, h.from_source, h.from_locked]);
      }
      restored += 1;
    }

    // Folders this run created and nothing else now uses are retired, not
    // deleted: a deleted folder takes its history row's foreign key with it.
    await client.query(
      `UPDATE resource_folders f SET is_active = FALSE, updated_at = NOW()
        WHERE f.organisation_id IS NOT DISTINCT FROM $1 AND f.kind = 'library'
          AND f.source <> 'manual' AND NOT f.is_review_bucket
          AND NOT EXISTS (SELECT 1 FROM resource_folder_assignments a WHERE a.folder_id = f.id)
          AND NOT EXISTS (SELECT 1 FROM resource_folders c WHERE c.parent_id = f.id AND c.is_active)`,
      [orgId]);

    await client.query(
      `UPDATE resource_classification_runs SET status='rolled_back', rolled_back_at=NOW() WHERE id=$1`,
      [runId]);
    await client.query('COMMIT');

    await db.logAuditEvent({
      actorUserId: userId, action: 'resource_library.rolled_back', targetType: 'resource',
      targetId: null, organisationId: orgId, metadata: { runId, restored },
    }).catch(() => {});

    return { ok: true, restored };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  PHASES, SCOPE_SQL, MAX_FILES_SAMPLED, MAX_RESOURCES,
  loadCorpus, buildProfiles, slugFor, upsertFolders, applyAssignments,
  describeFolders, setPhase, startRun, executeRun, classifyResource, rollbackRun,
};
