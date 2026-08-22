'use strict';

/**
 * RESOURCE HUB R2 ROUTES — Learning, Knowledge, Standards & Clinical Excellence
 *
 * A NEW module mounted alongside (never inside) the R1 module. All routes live
 * under /api/rh2/* so nothing collides with /api/resources. The R1 module and
 * its RBAC (admin hard-denied) are untouched.
 *
 * R2 RBAC (decision 2026-08):
 *   - therapist / read_only: view APPROVED resources only, plus their own
 *     progress, favourites, CPD entries and acknowledgements. read_only's
 *     global write block is already enforced inside requireAuth.
 *   - admin: author (create drafts), edit non-approved resources, manage PD
 *     events and quick links, view analytics. NO approve/publish.
 *   - owner: everything — approve/archive, policy versioning (edits to
 *     approved resources), external-source registry and verification.
 *
 * Statuses reuse R1's vocabulary; 'approved' IS the published state.
 * No file blobs are ever exposed here — downloads stay on the R1 route.
 */

const crypto = require('crypto');
const net = require('net');
const dns = require('dns').promises;
const express = require('express');
const router = express.Router();
const axios = require('axios');
const db = require('./database');
const { pool } = require('./database');
const { requireAuth } = require('./permissions');
const log = require('./logger').createLogger('resource-hub-r2');

const hubEnabled = () => process.env.ENABLE_RESOURCE_HUB !== 'false';
const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));
const orgOf = (req) => req.user?.organisation_id || null;
const isOwner = (u) => u?.role === 'owner';
const canAuthor = (u) => u?.role === 'owner' || u?.role === 'admin';

const AUTHORITY_LEVELS = ['internal', 'opal_approved', 'official_regulatory', 'professional_body', 'external_reference'];

/**
 * Clinical classification vocabulary.
 *
 * These lists previously existed ONLY in the browser, as slugs the server had
 * never seen and nothing ever wrote — which is why the Population and Setting
 * filters returned nothing for every selection. They are now server-owned and
 * validated, so an unknown value is rejected rather than silently matching zero
 * rows and looking like "no results".
 *
 * UNCLASSIFIED is a real, selectable value: every existing resource is
 * unclassified, and saying so is more truthful than offering four options that
 * all return nothing.
 */
const CLINICAL_POPULATIONS = ['paediatric', 'adolescent', 'adult', 'older_adult'];
const CLINICAL_SETTINGS = ['clinic', 'school', 'home', 'telehealth', 'community'];
const UNCLASSIFIED = 'unclassified';

/**
 * Validate a clinical classification array on the way IN.
 *
 * The write path has always accepted these fields but never checked them, which
 * is how the browser's invented slugs could have been stored and then never
 * matched anything. Values are now validated against the same lists the filter
 * uses, so a stored classification is always a filterable one.
 *
 * @returns {{ok: true, value: string[]} | {ok: false, parameter: string}}
 */
function validateClinicalArray(input, allowed, parameter) {
  if (input === undefined) return { ok: true, value: undefined };
  const arr = Array.isArray(input) ? input : [input];
  const clean = [];
  for (const raw of arr.slice(0, 20)) {
    const v = String(raw == null ? '' : raw).trim();
    if (!v) continue;
    if (!allowed.includes(v)) return { ok: false, parameter };
    if (!clean.includes(v)) clean.push(v);
  }
  return { ok: true, value: clean };
}

const governance = require('./resource-governance');

/**
 * Every aggregate that names a resource must carry this. An excluded-private
 * record is client-derived: its TITLE alone is a disclosure, so it must never
 * reach an analytics table, a "most viewed" list or a search index. Written
 * once here and reused so a new aggregate cannot quietly omit it.
 */
const PRIVACY_PREDICATE =
  `r.access_tier <> 'excluded-private' AND r.publication_state <> 'excluded-private'`;

/**
 * Role gates for governance. These consult resource-governance's policy rather
 * than testing roles inline, so the rule lives in one unit-tested place and the
 * routes cannot drift from it.
 *
 * Both return a sent response on denial, or undefined to continue — call as
 * `const gate = requireApprover(req, res, 'approve'); if (gate) return gate;`
 */
function denyTransition(res, verdict) {
  return res.status(403).json({ error: verdict.reason, code: 'governance_role_denied' });
}

function requireReviewer(req, res) {
  // 'rights-review' stands in for any in-review target: they share one rule.
  const verdict = governance.canPerformTransition(req.user && req.user.role, 'rights-review');
  if (!verdict.allowed) return denyTransition(res, verdict);
  return undefined;
}

function requireApprover(req, res) {
  const verdict = governance.canPerformTransition(req.user && req.user.role, 'approved');
  if (!verdict.allowed) return denyTransition(res, verdict);
  return undefined;
}

/**
 * Attach derived governance flags to a row on its way out.
 *
 * `approved` and `published` are DIFFERENT claims and neither may be inferred
 * from the legacy `status` column: a record can carry status='approved' from
 * the pre-governance era while failing every gate that word now implies.
 */
function withGovernanceFlags(row) {
  const blockers = governance.approvalBlockers(row);
  return {
    ...row,
    approval_ready: blockers.length === 0,
    approval_blockers: blockers,
    is_published: row.publication_state === 'published',
  };
}

/**
 * Move a resource through the governance lifecycle and record why, atomically.
 * The state change and its audit row commit together or not at all — a
 * transition with no recorded reviewer is exactly the gap the governance
 * document exists to close.
 *
 * @returns {{ok: true, resource: object} | {ok: false, status: number, body: object}}
 */
async function transition(req, resourceId, {
  toState, legacyStatus, extraSet = '', extraParams = [], reason, blockerPatch,
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // FOR UPDATE: two owners approving at once must serialise, or one
    // transition's guard runs against state the other has already changed.
    const { rows } = await client.query(
      `SELECT * FROM resources
        WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2 FOR UPDATE`,
      [resourceId, orgOf(req)]);
    const r = rows[0];
    if (!r) {
      await client.query('ROLLBACK');
      return { ok: false, status: 404, body: { error: 'Not found' } };
    }

    const from = r.publication_state;

    // Authoritative role check. It lives HERE rather than in the route because
    // policing the clinical-attestation step needs the record's current state,
    // which only exists once the row is loaded. The route-level gates are a
    // cheap early denial; this is the one that decides.
    const authority = governance.canPerformTransition(
      req.user && req.user.role, toState, from);
    if (!authority.allowed) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        status: 403,
        body: { error: authority.reason, code: 'governance_role_denied', from, to: toState },
      };
    }

    const check = governance.canTransition(from, toState);
    if (!check.ok) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        status: 409,
        body: { error: check.reason, code: 'invalid_governance_transition', from, to: toState },
      };
    }

    if (toState === 'approved') {
      // Evaluate against the record as it will be AFTER this route's own
      // auto-set fields land (approval stamps the review date), otherwise the
      // guard blocks on a field the same statement is about to populate.
      const blockers = governance.approvalBlockers({ ...r, ...(blockerPatch || {}) });
      if (blockers.length) {
        await client.query('ROLLBACK');
        return {
          ok: false,
          status: 422,
          body: {
            error: 'This resource cannot be approved yet.',
            code: 'governance_requirements_unmet',
            blockers,
          },
        };
      }
    }

    const params = [resourceId, orgOf(req), toState, legacyStatus, ...extraParams];
    const { rows: updated } = await client.query(
      `UPDATE resources
          SET publication_state = $3, status = $4, updated_at = NOW()${extraSet}
        WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2
        RETURNING *`, params);

    await client.query(
      `INSERT INTO resource_governance_events
         (organisation_id, resource_id, field, from_value, to_value, reason, actor_user_id)
       VALUES ($1, $2, 'publication_state', $3, $4, $5, $6)`,
      [orgOf(req), resourceId, from, toState,
       (reason || '').slice(0, 1000) || null, req.user.id]);

    await client.query('COMMIT');
    return { ok: true, resource: updated[0], from };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
const FEEDBACK_KINDS = ['helpful', 'needs_update', 'missing'];
const PD_MODES = ['online', 'in_person', 'hybrid'];

router.use('/api/rh2', requireAuth, (req, res, next) => {
  if (!hubEnabled()) return res.status(403).json({ error: 'Resource Hub is disabled', code: 'resource_hub_disabled' });
  next();
});

// Async-handler guard (Express 4: an unhandled rejection would hang the request).
const safe = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  log.error('rh2 route error', { error: err, path: req.path });
  if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
});

function audit(req, action, targetId, metadata) {
  return db.logAuditEvent({
    actorUserId: req.user?.id, action, targetType: 'resource', targetId,
    ipAddress: req.ip, organisationId: orgOf(req), metadata: metadata || null,
  }).catch(() => {});
}

// Lazy import so tests can mount this module without app-routes.
function notify(userId, payload) {
  return Promise.resolve()
    .then(() => require('./app-routes').storeNotification(userId, payload))
    .catch(() => {});
}

const str = (v, max) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};
const strArr = (v, maxItems, maxLen) => Array.isArray(v)
  ? v.filter((x) => typeof x === 'string' && x.trim()).slice(0, maxItems).map((x) => x.trim().slice(0, maxLen))
  : [];

// Server-side link-scheme validation: stored URLs must be http(s) — never
// javascript:, data:, file: etc. Quick links may also be app-internal paths
// ('/reports'), which the frontend renders without target="_blank".
const isHttpUrl = (u) => {
  try { const p = new URL(u).protocol; return p === 'https:' || p === 'http:'; } catch { return false; }
};
const isInternalPath = (u) => /^\/(?!\/)[a-zA-Z0-9\-._~!$&'()*+,;=:@%/?#[\]]*$/.test(String(u || ''));

/**
 * The version a user must have acknowledged for the acknowledgement to count.
 * Minor edits bump resources.version (so history stays linear) but must NEVER
 * invalidate existing acknowledgements — only the latest MATERIAL change
 * (initial approval included) re-triggers requiresAction. `alias` is the
 * resources alias in the surrounding query.
 */
const ackRelevantVersionSql = (alias) =>
  `COALESCE((SELECT MAX(v.version) FROM resource_versions v
      WHERE v.resource_id = ${alias}.id AND v.change_kind IN ('initial','material')), ${alias}.version)`;

function slugify(title) {
  return String(title || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 140) || 'resource';
}

async function uniqueSlug(orgId, base, excludeId) {
  let candidate = base;
  for (let i = 2; i < 60; i++) {
    const { rows } = await pool.query(
      'SELECT 1 FROM resources WHERE organisation_id IS NOT DISTINCT FROM $1 AND slug = $2 AND id IS DISTINCT FROM $3',
      [orgId, candidate, excludeId || null]);
    if (!rows.length) return candidate;
    candidate = `${base}-${i}`;
  }
  return `${base}-${Date.now()}`;
}

// Fetch one org-scoped resource by uuid or slug. Returns null when absent.
async function findResource(req, idOrSlug) {
  const bySlug = !isUuid(idOrSlug);
  if (bySlug && (!idOrSlug || idOrSlug.length > 160)) return null;
  const { rows } = await pool.query(
    `SELECT * FROM resources WHERE organisation_id IS NOT DISTINCT FROM $1 AND ${bySlug ? 'slug' : 'id'} = $2`,
    [orgOf(req), idOrSlug]);
  return rows[0] || null;
}

// Visibility rule: non-authors may only see approved resources AT A TIER
// THEIR ROLE READS.
//
// Privacy outranks authorship. An excluded-private record is client-derived, so
// its title alone is a disclosure — being an owner or admin does not unlock it
// here. Such a record is managed through the governance routes, which name it
// by id and never render its content.
//
// The tier check is what keeps the admin rights-review queue out of a
// therapist's reach even by direct id: those records still carry the legacy
// status 'approved', but their access_tier is 'admin', and a title can be as
// much a rights problem as its bytes. Callers must therefore pass a resource
// object that includes access_tier.
const visibleTo = (user, resource) => {
  if (!resource) return false;
  if (resource.access_tier === 'excluded-private'
      || resource.publication_state === 'excluded-private') return false;
  if (canAuthor(user)) return true;
  return resource.status === 'approved'
    && governance.canReadTier(user && user.role, resource.access_tier);
};

// Aggregate zero-result search terms. NEVER records who searched. The unique
// constraint cannot upsert NULL orgs, so update-then-insert with a race catch.
async function recordSearchMiss(orgId, rawTerm) {
  const term = String(rawTerm || '').trim().toLowerCase().slice(0, 200);
  if (!term) return;
  try {
    const upd = await pool.query(
      `UPDATE search_misses SET miss_count = miss_count + 1, last_searched_at = NOW()
        WHERE organisation_id IS NOT DISTINCT FROM $1 AND term = $2`, [orgId, term]);
    if (!upd.rowCount) {
      await pool.query('INSERT INTO search_misses (organisation_id, term) VALUES ($1, $2)', [orgId, term]);
    }
  } catch (_) { /* concurrent insert race — the aggregate is best-effort */ }
}

// Lazily flip finished PD events to 'past' (no cron in this stack).
async function markPastPdEvents(orgId) {
  await pool.query(
    `UPDATE pd_events SET status = 'past'
      WHERE organisation_id IS NOT DISTINCT FROM $1 AND status = 'upcoming'
        AND COALESCE(ends_at, starts_at) < NOW()`, [orgId]).catch(() => {});
}

// ═══ 1. Home ═════════════════════════════════════════════════════════════════

router.get('/api/rh2/home', safe(async (req, res) => {
  const orgId = orgOf(req);
  const userId = req.user.id;
  await markPastPdEvents(orgId);

  const [collections, continueLearning, requiredForYou, popular, recentlyAdded, upcomingPd, quickLinks] =
    await Promise.all([
      pool.query(
        `SELECT c.id, c.key, c.name, c.tagline, c.icon, c.sort_order,
                (SELECT COUNT(*) FROM resource_collection_items i
                   JOIN resources r ON r.id = i.resource_id AND r.status = 'approved'
                    AND ${PRIVACY_PREDICATE}
                  WHERE i.collection_id = c.id) AS item_count
           FROM resource_collections c
          WHERE c.organisation_id IS NOT DISTINCT FROM $1 AND c.is_active = TRUE
          ORDER BY c.sort_order, c.name`, [orgId]),
      pool.query(
        `SELECT p.id, p.key, p.name, p.description, p.target_role,
                COUNT(r.id) AS total,
                COUNT(prog.resource_id) AS completed
           FROM learning_paths p
           LEFT JOIN learning_path_items i ON i.path_id = p.id
           LEFT JOIN resources r ON r.id = i.resource_id AND r.status = 'approved'
                  AND ${PRIVACY_PREDICATE}
           LEFT JOIN user_learning_progress prog
                  ON prog.resource_id = r.id AND prog.user_id = $2
          WHERE p.organisation_id IS NOT DISTINCT FROM $1 AND p.is_active = TRUE
          GROUP BY p.id ORDER BY p.sort_order, p.name`, [orgId, userId]),
      pool.query(
        `SELECT r.id, r.slug, r.title, r.content_type, r.estimated_minutes,
                r.mandatory, r.acknowledgement_required, r.version
           FROM resources r
          WHERE r.organisation_id IS NOT DISTINCT FROM $1 AND r.status = 'approved'
            AND ${PRIVACY_PREDICATE}
            AND (r.mandatory OR r.acknowledgement_required)
            AND (COALESCE(r.target_roles, '[]'::jsonb) = '[]'::jsonb
              OR r.target_roles @> jsonb_build_array($3::text))
            AND (
              (r.acknowledgement_required AND NOT EXISTS (
                 SELECT 1 FROM policy_acknowledgements a
                  WHERE a.resource_id = r.id AND a.user_id = $2
                    AND a.version >= ${ackRelevantVersionSql('r')}))
              OR
              (r.mandatory AND NOT r.acknowledgement_required AND NOT EXISTS (
                 SELECT 1 FROM user_learning_progress p
                  WHERE p.resource_id = r.id AND p.user_id = $2))
            )
          ORDER BY r.updated_at DESC LIMIT 50`, [orgId, userId, String(req.user.role || '')]),
      pool.query(
        `SELECT r.id, r.slug, r.title, r.content_type, COUNT(v.id) AS view_count
           FROM resources r
           JOIN resource_views v ON v.resource_id = r.id AND v.viewed_at > NOW() - INTERVAL '30 days'
          WHERE r.organisation_id IS NOT DISTINCT FROM $1 AND r.status = 'approved'
            AND ${PRIVACY_PREDICATE}
          GROUP BY r.id ORDER BY COUNT(v.id) DESC, r.title LIMIT 10`, [orgId]),
      pool.query(
        `SELECT r.id, r.slug, r.title, r.content_type, r.created_at
           FROM resources r
          WHERE r.organisation_id IS NOT DISTINCT FROM $1 AND r.status = 'approved'
            AND ${PRIVACY_PREDICATE}
          ORDER BY r.created_at DESC LIMIT 10`, [orgId]),
      pool.query(
        `SELECT id, title, provider, topic, starts_at, ends_at, timezone, mode, location,
                cost_cents, cpd_hours, registration_url
           FROM pd_events
          WHERE organisation_id IS NOT DISTINCT FROM $1 AND status = 'upcoming' AND starts_at >= NOW()
          ORDER BY starts_at ASC LIMIT 5`, [orgId]),
      pool.query(
        `SELECT id, label, url, icon, sort_order FROM resource_quick_links
          WHERE organisation_id IS NOT DISTINCT FROM $1 AND is_active = TRUE
          ORDER BY sort_order, label`, [orgId]),
    ]);

  res.json({
    collections: collections.rows,
    continueLearning: continueLearning.rows.map((p) => ({
      ...p, total: Number(p.total), completed: Number(p.completed),
      percent: Number(p.total) ? Math.round((Number(p.completed) / Number(p.total)) * 100) : 0,
    })),
    requiredForYou: requiredForYou.rows,
    popular: popular.rows,
    recentlyAdded: recentlyAdded.rows,
    upcomingPd: upcomingPd.rows,
    quickLinks: quickLinks.rows,
  });
}));

// ═══ 2. Search + filters ═════════════════════════════════════════════════════


router.get('/api/rh2/resources', safe(async (req, res) => {
  const orgId = orgOf(req);
  const params = [orgId];
  let where = `r.organisation_id IS NOT DISTINCT FROM $1`;

  // This route is a search index — it takes a free-text `q`. An excluded-private
  // record must never be reachable through it, by anyone, so the predicate is
  // applied before the role branch rather than inside the non-author arm.
  where += ` AND ${PRIVACY_PREDICATE}`;

  if (canAuthor(req.user)) {
    const status = str(req.query.status, 30);
    if (status) { params.push(status); where += ` AND r.status = $${params.length}`; }
  } else {
    // The ordinary library shows what a staff member can actually use. Both
    // lifecycles must agree: a record can carry the legacy status 'approved'
    // from before governance existed while still sitting in rights or clinical
    // review, and that is not something to offer a therapist as available.
    // BROWSABLE_STATES includes 'inventory' — the owner's decision that the
    // catalogued imports are browsable with honest provenance badges — while
    // every in-review state stays out (see resource-governance.js).
    params.push(governance.BROWSABLE_STATES);
    where += ` AND r.status = 'approved'`;
    where += ` AND r.publication_state = ANY($${params.length}::text[])`;
    // File-tier reachability is enforced again at delivery; this predicate
    // only keeps admin-tier records (e.g. the rights-review queue) out of the
    // therapist's browse.
    params.push(governance.tiersForRole(req.user && req.user.role));
    where += ` AND r.access_tier = ANY($${params.length}::text[])`;
  }

  const q = str(req.query.q, 200);
  if (q) {
    params.push('%' + q + '%');
    const p = `$${params.length}`;
    where += ` AND (r.title ILIKE ${p} OR r.description ILIKE ${p} OR r.content ILIKE ${p}
      OR r.source_publisher ILIKE ${p}
      OR EXISTS (SELECT 1 FROM resource_tag_links tl JOIN resource_tags t ON t.id = tl.tag_id
                  WHERE tl.resource_id = r.id AND (t.name ILIKE ${p}
                    OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(t.aliases) al WHERE al ILIKE ${p}))))`;
  }
  if (req.query.contentType) { params.push(str(req.query.contentType, 40)); where += ` AND r.content_type = $${params.length}`; }
  /**
   * FOLDER BROWSING — opt-in, and only ever a narrowing the caller asked for.
   *
   * The semantic library folders live in resource_folder_assignments (migration
   * 039); `resources.folder_id` is the older ingestion grouping and is left
   * alone. A folder narrows the list ONLY when this parameter is present, so
   * search keeps spanning the whole library by default (§21) and no bookmark or
   * existing caller changes behaviour.
   *
   * `folderScope=tree` includes a folder's subfolders, which is what opening a
   * parent should show.
   */
  if (req.query.folderId !== undefined && req.query.folderId !== '') {
    if (!isUuid(req.query.folderId)) {
      return res.status(400).json({
        error: 'Unknown folder.', code: 'invalid_filter_value', parameter: 'folderId',
      });
    }
    params.push(req.query.folderId);
    const p = `$${params.length}`;
    const scoped = req.query.folderScope === 'tree'
      ? `(a.folder_id = ${p} OR a.folder_id IN (
            SELECT sf.id FROM resource_folders sf
             WHERE sf.parent_id = ${p}
               AND sf.organisation_id IS NOT DISTINCT FROM $1))`
      : `a.folder_id = ${p}`;
    where += ` AND EXISTS (SELECT 1 FROM resource_folder_assignments a
                 WHERE a.resource_id = r.id AND ${scoped})`;
  }
  let collectionKeyIdx = null; // param index, reused for curated ordering below
  if (req.query.collectionKey) {
    params.push(str(req.query.collectionKey, 60));
    collectionKeyIdx = params.length;
    where += ` AND EXISTS (SELECT 1 FROM resource_collection_items ci
                 JOIN resource_collections c ON c.id = ci.collection_id
                WHERE ci.resource_id = r.id AND c.key = $${params.length}
                  AND c.organisation_id IS NOT DISTINCT FROM $1)`;
  }
  // tagId may repeat (e.g. a topic tag plus a cost tag) — each one ANDs.
  for (const tagId of [].concat(req.query.tagId || []).filter((t) => isUuid(String(t)))) {
    params.push(tagId);
    where += ` AND EXISTS (SELECT 1 FROM resource_tag_links l WHERE l.resource_id = r.id AND l.tag_id = $${params.length})`;
  }
  if (req.query.authority && AUTHORITY_LEVELS.includes(req.query.authority)) {
    params.push(req.query.authority); where += ` AND r.authority_level = $${params.length}`;
  }
  // An unrecognised filter value is a CLIENT ERROR, not a no-op.
  //
  // Ignoring it would return the unfiltered list, so a typo or a stale bookmark
  // would quietly show MORE than the caller asked for while looking like a
  // successful filtered query — the worst of the three possible failures. (The
  // original bug was the opposite: a valid-looking value silently matching
  // nothing.) Rejecting is the only option that cannot mislead.
  //
  // The error names the parameter and nothing else: no row counts, no column
  // names, no vocabulary dump that would describe the schema.
  if (req.query.population !== undefined && req.query.population !== '') {
    if (req.query.population === UNCLASSIFIED) {
      where += ` AND (r.clinical_population IS NULL OR r.clinical_population = '[]'::jsonb)`;
    } else if (CLINICAL_POPULATIONS.includes(req.query.population)) {
      params.push(str(req.query.population, 100));
      where += ` AND r.clinical_population @> jsonb_build_array($${params.length}::text)`;
    } else {
      return res.status(400).json({
        error: 'Unknown clinical population filter.',
        code: 'invalid_filter_value',
        parameter: 'population',
      });
    }
  }
  if (req.query.setting !== undefined && req.query.setting !== '') {
    if (req.query.setting === UNCLASSIFIED) {
      where += ` AND (r.clinical_setting IS NULL OR r.clinical_setting = '[]'::jsonb)`;
    } else if (CLINICAL_SETTINGS.includes(req.query.setting)) {
      params.push(str(req.query.setting, 100));
      where += ` AND r.clinical_setting @> jsonb_build_array($${params.length}::text)`;
    } else {
      return res.status(400).json({
        error: 'Unknown clinical setting filter.',
        code: 'invalid_filter_value',
        parameter: 'setting',
      });
    }
  }
  if (req.query.mandatory === '1' || req.query.mandatory === 'true') where += ` AND r.mandatory = TRUE`;
  // Hosted document vs external link vs written guide — how a therapist gets
  // the thing is a first-class facet.
  if (req.query.kind !== undefined && req.query.kind !== '') {
    if (req.query.kind === 'hosted') {
      where += ` AND EXISTS (SELECT 1 FROM resource_files rf WHERE rf.resource_id = r.id)`;
    } else if (req.query.kind === 'external') {
      where += ` AND r.external_url IS NOT NULL`;
    } else if (req.query.kind === 'guide') {
      where += ` AND r.external_url IS NULL
                 AND NOT EXISTS (SELECT 1 FROM resource_files rf WHERE rf.resource_id = r.id)`;
    } else {
      return res.status(400).json({
        error: 'Unknown resource kind filter.',
        code: 'invalid_filter_value',
        parameter: 'kind',
      });
    }
  }
  if (req.query.saved === '1' || req.query.saved === 'true') {
    params.push(req.user.id);
    where += ` AND EXISTS (SELECT 1 FROM resource_favourites sf
                 WHERE sf.resource_id = r.id AND sf.user_id = $${params.length})`;
  }

  const sorts = {
    relevant: 'r.updated_at DESC',
    updated: 'r.updated_at DESC',
    az: 'r.title ASC',
    popular: 'view_count DESC, r.title ASC',
  };
  let orderBy = sorts[req.query.sort] || sorts.relevant;
  // Browsing a collection with the default sort follows the curated shelf
  // order (e.g. the Knowledge Library guide + Essentials shortlist surface
  // first; Start Here reads in its intended sequence). Explicit sorts win.
  if (collectionKeyIdx && (!req.query.sort || req.query.sort === 'relevant')) {
    orderBy = `(SELECT ci2.sort_order FROM resource_collection_items ci2
                  JOIN resource_collections c2 ON c2.id = ci2.collection_id
                 WHERE ci2.resource_id = r.id AND c2.key = $${collectionKeyIdx}
                   AND c2.organisation_id IS NOT DISTINCT FROM $1) ASC, r.title ASC`;
  }
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
  // Offset paging with a +1 probe row: the grid needs "is there more" without
  // paying for an exact COUNT over the whole catalogue on every keystroke.
  const offset = Math.min(Math.max(parseInt(req.query.offset, 10) || 0, 0), 10000);

  const { rows } = await pool.query(
    `SELECT r.id, r.slug, r.title, r.description, r.status, r.content_type, r.authority_level,
            r.mandatory, r.acknowledgement_required, r.cpd_eligible, r.cpd_hours,
            r.estimated_minutes, r.icon, r.version, r.external_url, r.source_publisher,
            r.updated_at, r.created_at,
            -- Governance (migration 024). source_class is what lets the client
            -- badge attribution honestly; without it the badge falls back to
            -- authority_level, which conflates authorship with citation.
            r.source_class, r.rights_status, r.access_tier, r.publication_state,
            r.clinical_status, r.brand_review_status, r.content_version,
            r.content_owner, r.review_due_at,
            COALESCE(json_agg(json_build_object('id', t.id, 'category', t.category, 'name', t.name))
                     FILTER (WHERE t.id IS NOT NULL), '[]') AS tags,
            EXISTS (SELECT 1 FROM resource_favourites f WHERE f.resource_id = r.id AND f.user_id = $${params.length + 1}) AS favourited,
            (SELECT COUNT(*) FROM resource_views v
              WHERE v.resource_id = r.id AND v.viewed_at > NOW() - INTERVAL '30 days') AS view_count,
            -- Card data: the primary hosted file, resolved here so the grid
            -- never issues one /files call per tile. The thumbnail URL itself
            -- is still served through the fully-gated file routes.
            pf.id AS primary_file_id,
            pf.format AS primary_file_format,
            pf.file_size_bytes AS primary_file_size_bytes,
            pf.has_thumbnail AS primary_file_has_thumbnail
       FROM resources r
       LEFT JOIN resource_tag_links tl ON tl.resource_id = r.id
       LEFT JOIN resource_tags t ON t.id = tl.tag_id
       LEFT JOIN LATERAL (
         SELECT f.id, f.format, f.file_size_bytes,
                EXISTS (SELECT 1 FROM resource_file_derivatives d
                         WHERE d.resource_file_id = f.id AND d.kind = 'thumbnail') AS has_thumbnail
           FROM resource_files f
          WHERE f.resource_id = r.id
          ORDER BY f.is_primary DESC, f.uploaded_at
          LIMIT 1
       ) pf ON TRUE
      WHERE ${where}
      GROUP BY r.id, pf.id, pf.format, pf.file_size_bytes, pf.has_thumbnail
      ORDER BY ${orderBy} LIMIT ${limit + 1} OFFSET ${offset}`,
    [...params, req.user.id]);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  if (!page.length && !offset && q) await recordSearchMiss(orgId, q);
  // approval_ready is computed HERE, from the same approvalBlockers() the
  // approve route enforces, so the badge can never claim an approval the server
  // would refuse. The client must not re-derive this policy. The thumbnail URL
  // is likewise SERVER-supplied — the client never assembles a file URL.
  const cardOf = (r) => ({
    ...withGovernanceFlags(r),
    primary_file_thumbnail_url: r.primary_file_has_thumbnail
      ? `/api/rh2/files/${r.primary_file_id}/thumbnail` : null,
  });
  res.json({ resources: page.map(cardOf), hasMore, offset, limit });
}));

/**
 * The vocabulary plus how many resources actually carry each value, so the UI
 * can show "Unclassified (168)" instead of four options that look equally
 * plausible and only one of which returns anything.
 */
router.get('/api/rh2/clinical-vocabulary', safe(async (req, res) => {
  const org = orgOf(req);
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE clinical_population IS NULL OR clinical_population = '[]'::jsonb)::int AS pop_unclassified,
       COUNT(*) FILTER (WHERE clinical_setting IS NULL OR clinical_setting = '[]'::jsonb)::int AS set_unclassified,
       COUNT(*)::int AS total
     FROM resources
     WHERE organisation_id IS NOT DISTINCT FROM $1 AND status = 'approved'`, [org]);
  res.json({
    populations: CLINICAL_POPULATIONS,
    settings: CLINICAL_SETTINGS,
    unclassifiedValue: UNCLASSIFIED,
    counts: {
      total: rows[0].total,
      populationUnclassified: rows[0].pop_unclassified,
      settingUnclassified: rows[0].set_unclassified,
    },
  });
}));

// ═══ 3. Detail ═══════════════════════════════════════════════════════════════

router.get('/api/rh2/resources/:idOrSlug', safe(async (req, res) => {
  const resource = await findResource(req, req.params.idOrSlug);
  if (!visibleTo(req.user, resource)) return res.status(404).json({ error: 'Not found' });
  const userId = req.user.id;

  const [tags, collections, versions, sources, quiz, userState, related] = await Promise.all([
    pool.query(
      `SELECT t.id, t.category, t.name, t.aliases FROM resource_tag_links tl
         JOIN resource_tags t ON t.id = tl.tag_id WHERE tl.resource_id = $1 ORDER BY t.category, t.name`,
      [resource.id]),
    pool.query(
      `SELECT c.id, c.key, c.name FROM resource_collection_items ci
         JOIN resource_collections c ON c.id = ci.collection_id
        WHERE ci.resource_id = $1 AND c.is_active = TRUE ORDER BY c.sort_order`, [resource.id]),
    pool.query(
      `SELECT id, version, title, change_note, change_kind, created_at
         FROM resource_versions WHERE resource_id = $1 ORDER BY version DESC`, [resource.id]),
    pool.query(
      `SELECT s.id, s.name, s.publisher, s.url, s.authority, s.status, s.effective_date,
              s.last_verified_at, s.change_detected_at
         FROM resource_external_sources res
         JOIN external_sources s ON s.id = res.source_id WHERE res.resource_id = $1
        ORDER BY s.name`, [resource.id]),
    pool.query(
      `SELECT qz.id, qz.pass_threshold,
              COALESCE(json_agg(json_build_object(
                'id', qq.id, 'question', qq.question, 'kind', qq.kind,
                'options', qq.options, 'correctIndex', qq.correct_index)
                ORDER BY qq.sort_order) FILTER (WHERE qq.id IS NOT NULL), '[]') AS questions
         FROM quizzes qz LEFT JOIN quiz_questions qq ON qq.quiz_id = qz.id
        WHERE qz.resource_id = $1 AND qz.is_active = TRUE GROUP BY qz.id`, [resource.id]),
    pool.query(
      `SELECT
         EXISTS (SELECT 1 FROM resource_favourites f WHERE f.resource_id = $1 AND f.user_id = $2) AS favourited,
         EXISTS (SELECT 1 FROM user_learning_progress p WHERE p.resource_id = $1 AND p.user_id = $2) AS completed,
         (SELECT MAX(version) FROM policy_acknowledgements a WHERE a.resource_id = $1 AND a.user_id = $2) AS acknowledged_version,
         COALESCE((SELECT MAX(v.version) FROM resource_versions v
            WHERE v.resource_id = $1 AND v.change_kind IN ('initial','material')), $3::int) AS material_version`,
      [resource.id, userId, resource.version]),
    pool.query(
      `SELECT r2.id, r2.slug, r2.title, r2.content_type FROM resources r2
        WHERE r2.organisation_id IS NOT DISTINCT FROM $1 AND r2.status = 'approved' AND r2.id <> $2
          AND r2.access_tier <> 'excluded-private' AND r2.publication_state <> 'excluded-private'
          AND (EXISTS (SELECT 1 FROM resource_collection_items a
                        JOIN resource_collection_items b ON b.collection_id = a.collection_id
                       WHERE a.resource_id = $2 AND b.resource_id = r2.id)
            OR EXISTS (SELECT 1 FROM resource_tag_links a
                        JOIN resource_tag_links b ON b.tag_id = a.tag_id
                       WHERE a.resource_id = $2 AND b.resource_id = r2.id))
        ORDER BY r2.updated_at DESC LIMIT 5`, [orgOf(req), resource.id]),
  ]);

  let quizOut = null;
  if (quiz.rows.length) {
    const qrow = quiz.rows[0];
    quizOut = {
      id: qrow.id,
      passThreshold: qrow.pass_threshold,
      questions: (qrow.questions || []).map((qq) => {
        if (!isOwner(req.user)) { const { correctIndex, ...rest } = qq; return rest; }
        return qq;
      }),
    };
  }

  const state = userState.rows[0] || {};
  const ackVersion = state.acknowledged_version === null ? null : Number(state.acknowledged_version);
  // Acks stay valid across MINOR edits: sufficiency is judged against the
  // version at the last material change, not the current document version.
  const materialVersion = Number(state.material_version || resource.version);

  // Recents/analytics trail — fire and forget, never blocks the response.
  pool.query('INSERT INTO resource_views (organisation_id, user_id, resource_id) VALUES ($1,$2,$3)',
    [orgOf(req), userId, resource.id]).catch(() => {});

  res.json({
    // Same computed flags as the list route, from the same approvalBlockers()
    // the approve route enforces — so the detail view can explain WHY a draft
    // cannot progress without reimplementing the policy in the browser.
    resource: withGovernanceFlags(resource),
    tags: tags.rows,
    collections: collections.rows,
    versions: versions.rows,
    externalSources: sources.rows,
    quiz: quizOut,
    userState: {
      favourited: state.favourited === true,
      completed: state.completed === true,
      acknowledgedVersion: Number.isFinite(ackVersion) ? ackVersion : null,
      acknowledgedCurrent: Number.isFinite(ackVersion) && ackVersion >= materialVersion,
    },
    related: related.rows,
  });
}));

// ═══ 4. Create + edit (R2 metadata) ══════════════════════════════════════════

async function syncCollections(orgId, resourceId, keys) {
  if (!Array.isArray(keys)) return;
  await pool.query('DELETE FROM resource_collection_items WHERE resource_id = $1', [resourceId]);
  for (const key of strArr(keys, 20, 60)) {
    await pool.query(
      `INSERT INTO resource_collection_items (collection_id, resource_id)
       SELECT id, $2 FROM resource_collections
        WHERE organisation_id IS NOT DISTINCT FROM $1 AND key = $3
       ON CONFLICT DO NOTHING`, [orgId, resourceId, key]);
  }
}

async function syncTags(resourceId, tagIds) {
  if (!Array.isArray(tagIds)) return;
  await pool.query('DELETE FROM resource_tag_links WHERE resource_id = $1', [resourceId]);
  for (const tagId of tagIds.filter(isUuid)) {
    await pool.query('INSERT INTO resource_tag_links (resource_id, tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [resourceId, tagId]);
  }
}

router.post('/api/rh2/resources', safe(async (req, res) => {
  if (!canAuthor(req.user)) return res.status(403).json({ error: 'Only admins and owners can author R2 resources' });
  const b = req.body || {};
  const title = str(b.title, 300);
  if (!title) return res.status(400).json({ error: 'title required' });
  const authority = b.authorityLevel || 'internal';
  if (!AUTHORITY_LEVELS.includes(authority)) {
    return res.status(400).json({ error: `authorityLevel must be one of: ${AUTHORITY_LEVELS.join(', ')}` });
  }
  const externalUrl = str(b.externalUrl, 2000);
  if (externalUrl && !isHttpUrl(externalUrl)) {
    return res.status(400).json({ error: 'externalUrl must be an http(s) URL' });
  }
  // Same vocabulary check as PATCH — a resource cannot be created carrying a
  // classification that no filter could ever match.
  const cPop = validateClinicalArray(b.clinicalPopulation, CLINICAL_POPULATIONS, 'clinicalPopulation');
  if (!cPop.ok) {
    return res.status(400).json({
      error: 'Unknown clinical population value.', code: 'invalid_clinical_value',
      parameter: cPop.parameter,
    });
  }
  const cSet = validateClinicalArray(b.clinicalSetting, CLINICAL_SETTINGS, 'clinicalSetting');
  if (!cSet.ok) {
    return res.status(400).json({
      error: 'Unknown clinical setting value.', code: 'invalid_clinical_value',
      parameter: cSet.parameter,
    });
  }
  const createPop = cPop.value || [];
  const createSet = cSet.value || [];

  const orgId = orgOf(req);
  const slug = await uniqueSlug(orgId, slugify(b.slug || title));

  const { rows } = await pool.query(
    // publication_state starts at 'inventory' ("exists, nobody has reviewed
    // it") and access_tier at 'staff' (the hub's broadest audience). NULLs
    // here fail closed in canDownloadInState/effectiveAccessTier, which would
    // make a draft's own files unopenable to its author.
    //
    // Provenance: content authored INSIDE the practice (authority internal /
    // opal_approved) is truthfully opal-original and opal-owned from birth —
    // the practice cannot lack rights to its own work. Externally-sourced
    // authorities keep the pessimistic defaults (unknown/unreviewed) so
    // third-party material stays unapprovable until a human reviews it.
    `INSERT INTO resources (organisation_id, title, description, slug, content, content_type,
        resource_type, status, publication_state, access_tier, source_class, rights_status,
        external_url, estimated_minutes, learning_minutes, mandatory,
        acknowledgement_required, cpd_eligible, cpd_hours, authority_level, icon, target_roles,
        clinical_population, clinical_setting, source_publisher, source_title,
        source_effective_date, content_owner, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'draft','inventory','staff',
             CASE WHEN $25 THEN 'opal-original' ELSE 'unknown' END,
             CASE WHEN $25 THEN 'opal-owned' ELSE 'unreviewed' END,
             $8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
     RETURNING *`,
    [orgId, title, str(b.description, 5000), slug, typeof b.content === 'string' ? b.content.slice(0, 200000) : null,
     str(b.contentType, 40), str(b.resourceType, 50), externalUrl,
     Number.isFinite(+b.estimatedMinutes) ? Math.round(+b.estimatedMinutes) : null,
     Number.isFinite(+b.learningMinutes) ? Math.round(+b.learningMinutes) : null,
     b.mandatory === true, b.acknowledgementRequired === true, b.cpdEligible === true,
     Number.isFinite(+b.cpdHours) ? +b.cpdHours : null, authority, str(b.icon, 40),
     JSON.stringify(strArr(b.targetRoles, 10, 30)), JSON.stringify(createPop),
     JSON.stringify(createSet), str(b.sourcePublisher, 200), str(b.sourceTitle, 300),
     b.sourceEffectiveDate || null, isUuid(b.contentOwner) ? b.contentOwner : req.user.id, req.user.id,
     authority === 'internal' || authority === 'opal_approved']);

  const resource = rows[0];
  await syncCollections(orgId, resource.id, b.collections);
  await syncTags(resource.id, b.tagIds);
  await audit(req, 'rh2.resource_created', resource.id, { title, slug });
  res.status(201).json({ resource });
}));

router.patch('/api/rh2/resources/:id', safe(async (req, res) => {
  if (!canAuthor(req.user)) return res.status(403).json({ error: 'Only admins and owners can edit R2 resources' });
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const resource = await findResource(req, req.params.id);
  if (!resource) return res.status(404).json({ error: 'Not found' });

  const isApproved = resource.status === 'approved';
  if ((isApproved || resource.status === 'archived') && !isOwner(req.user)) {
    return res.status(403).json({ error: 'Only the owner can edit approved or archived resources' });
  }

  const b = req.body || {};
  let changeKind = null;
  if (isApproved) {
    changeKind = b.changeKind;
    if (!['minor', 'material'].includes(changeKind)) {
      return res.status(400).json({ error: "Editing an approved resource requires changeKind 'minor' or 'material'" });
    }
  }

  if (b.authorityLevel !== undefined && !AUTHORITY_LEVELS.includes(b.authorityLevel)) {
    return res.status(400).json({ error: `authorityLevel must be one of: ${AUTHORITY_LEVELS.join(', ')}` });
  }

  const sets = [];
  const params = [];
  const set = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };

  if (b.title !== undefined) { const t = str(b.title, 300); if (!t) return res.status(400).json({ error: 'title cannot be empty' }); set('title', t); }
  if (b.description !== undefined) set('description', str(b.description, 5000));
  if (b.content !== undefined) set('content', typeof b.content === 'string' ? b.content.slice(0, 200000) : null);
  if (b.contentType !== undefined) set('content_type', str(b.contentType, 40));
  if (b.externalUrl !== undefined) {
    const u = str(b.externalUrl, 2000);
    if (u && !isHttpUrl(u)) return res.status(400).json({ error: 'externalUrl must be an http(s) URL' });
    set('external_url', u);
  }
  if (b.estimatedMinutes !== undefined) set('estimated_minutes', Number.isFinite(+b.estimatedMinutes) ? Math.round(+b.estimatedMinutes) : null);
  if (b.learningMinutes !== undefined) set('learning_minutes', Number.isFinite(+b.learningMinutes) ? Math.round(+b.learningMinutes) : null);
  if (b.mandatory !== undefined) set('mandatory', b.mandatory === true);
  if (b.acknowledgementRequired !== undefined) set('acknowledgement_required', b.acknowledgementRequired === true);
  if (b.cpdEligible !== undefined) set('cpd_eligible', b.cpdEligible === true);
  if (b.cpdHours !== undefined) set('cpd_hours', Number.isFinite(+b.cpdHours) ? +b.cpdHours : null);
  if (b.authorityLevel !== undefined) set('authority_level', b.authorityLevel);
  if (b.icon !== undefined) set('icon', str(b.icon, 40));
  if (b.targetRoles !== undefined) set('target_roles', JSON.stringify(strArr(b.targetRoles, 10, 30)));
  // Validated against the same vocabulary the filter uses, so a stored
  // classification is always one that can be filtered on. Previously this
  // accepted any string, which is how unfilterable values could be written.
  const popCheck = validateClinicalArray(b.clinicalPopulation, CLINICAL_POPULATIONS, 'clinicalPopulation');
  if (!popCheck.ok) {
    return res.status(400).json({
      error: 'Unknown clinical population value.', code: 'invalid_clinical_value',
      parameter: popCheck.parameter,
    });
  }
  const setCheck = validateClinicalArray(b.clinicalSetting, CLINICAL_SETTINGS, 'clinicalSetting');
  if (!setCheck.ok) {
    return res.status(400).json({
      error: 'Unknown clinical setting value.', code: 'invalid_clinical_value',
      parameter: setCheck.parameter,
    });
  }
  if (popCheck.value !== undefined) set('clinical_population', JSON.stringify(popCheck.value));
  if (setCheck.value !== undefined) set('clinical_setting', JSON.stringify(setCheck.value));
  if (b.sourcePublisher !== undefined) set('source_publisher', str(b.sourcePublisher, 200));
  if (b.sourceTitle !== undefined) set('source_title', str(b.sourceTitle, 300));
  if (b.sourceEffectiveDate !== undefined) set('source_effective_date', b.sourceEffectiveDate || null);
  if (b.slug !== undefined && str(b.slug, 160)) set('slug', await uniqueSlug(orgOf(req), slugify(b.slug), resource.id));

  if (!sets.length && !isApproved) return res.status(400).json({ error: 'No editable fields supplied' });

  if (isApproved) {
    // Version the change: keep an immutable snapshot of the outgoing state,
    // bump the version, then record the incoming state as the new version.
    const changeNote = str(b.changeNote, 300);
    await pool.query(
      `INSERT INTO resource_versions (resource_id, version, title, content, change_note, change_kind, created_by)
       VALUES ($1,$2,$3,$4,$5,'initial',$6) ON CONFLICT (resource_id, version) DO NOTHING`,
      [resource.id, resource.version, resource.title, resource.content, null, resource.created_by]);
    set('version', resource.version + 1);

    params.push(resource.id);
    await pool.query(`UPDATE resources SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length}`, [...params]);

    const after = await pool.query('SELECT * FROM resources WHERE id = $1', [resource.id]);
    const updated = after.rows[0];
    await pool.query(
      `INSERT INTO resource_versions (resource_id, version, title, content, change_note, change_kind, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (resource_id, version) DO NOTHING`,
      [resource.id, updated.version, updated.title, updated.content, changeNote, changeKind, req.user.id]);

    if (changeKind === 'material' && updated.acknowledgement_required) {
      // Acknowledgements are version-stamped and stay intact; affected staff
      // are notified that a re-acknowledgement is now required.
      const { rows: staff } = await pool.query(
        `SELECT id FROM users WHERE organisation_id IS NOT DISTINCT FROM $1 AND is_active = TRUE AND id <> $2`,
        [orgOf(req), req.user.id]);
      await Promise.all(staff.map((u) =>
        notify(u.id, {
          type: 'policy_update',
          title: 'Policy updated — acknowledgement required',
          message: `"${updated.title}" has had a material update (v${updated.version}). Please review and acknowledge the new version.`,
          severity: 'warning',
          relatedEntity: 'resource',
          actionPayload: { resourceId: resource.id, version: updated.version },
        })));
    }
    await audit(req, 'rh2.resource_versioned', resource.id, { changeKind, from: resource.version, to: updated.version });
    return res.json({ resource: updated });
  }

  params.push(resource.id);
  const { rows } = await pool.query(
    `UPDATE resources SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length} RETURNING *`, [...params]);
  if (b.collections !== undefined) await syncCollections(orgOf(req), resource.id, b.collections);
  if (b.tagIds !== undefined) await syncTags(resource.id, b.tagIds);
  await audit(req, 'rh2.resource_updated', resource.id, { fields: sets.length });
  // A clinical classification is governance metadata, so it gets its own audit
  // entry naming the values — "fields: 7" would not tell a reviewer what was
  // classified or to what.
  if (popCheck.value !== undefined || setCheck.value !== undefined) {
    await audit(req, 'rh2.resource_classified', resource.id, {
      clinicalPopulation: popCheck.value,
      clinicalSetting: setCheck.value,
    });
  }
  res.json({ resource: rows[0] });
}));

// ═══ 5. Workflow: submit / approve / archive ═════════════════════════════════

router.post('/api/rh2/resources/:id/submit', safe(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const { rows } = await pool.query(
    `UPDATE resources SET status = 'submitted_for_review', updated_at = NOW()
      WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2 AND status = 'draft'
        AND (created_by = $3 OR $4) RETURNING id`,
    [req.params.id, orgOf(req), req.user.id, isOwner(req.user)]);
  if (!rows.length) return res.status(404).json({ error: 'Not found or not a draft you own' });
  await audit(req, 'rh2.resource_submitted', req.params.id);
  res.json({ ok: true });
}));

// Approval is now gated twice: the transition must be legal for the record's
// current governance state, AND every provenance requirement must already be
// satisfied. Previously this route took any resource to 'approved' regardless
// of where it had been — archived and rejected records included.
/**
 * One-click approval — the OWNER'S ATTESTATION, not a bypass.
 *
 * The state machine deliberately has no inventory→approved edge: approval is
 * the end of a review walk. But every step of that walk is a decision the
 * owner alone is entitled to make (canPerformTransition allows the owner
 * every hop; the clinical attestation is owner-reserved), so when the OWNER
 * presses approve, this route makes those decisions EXPLICITLY: it records
 * each intermediate transition as its own governance event, stamps the
 * attestation fields the walk implies (clinical review completed; brand
 * review resolved; a content version recorded), and only then approves —
 * still subject to approvalBlockers, so unclassified or rights-restricted
 * third-party material remains unapprovable by any number of clicks.
 */
const FAST_TRACK_WALK = ['rights-review', 'clinical-review', 'brand-accessibility-review'];

router.post('/api/rh2/resources/:id/approve', safe(async (req, res) => {
  const gate = requireApprover(req, res);
  if (gate) return gate;
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });

  const reason = (req.body && req.body.reason) || 'Owner approval — review steps attested in one action.';

  // Walk the record to the review gate the machine requires. Each hop is a
  // real, separately-audited transition; a refusal surfaces as that hop's
  // error rather than being smoothed over.
  const { rows: currentRows } = await pool.query(
    `SELECT publication_state FROM resources
      WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2`,
    [req.params.id, orgOf(req)]);
  if (!currentRows.length) return res.status(404).json({ error: 'Not found' });
  let state = currentRows[0].publication_state;
  const startIdx = FAST_TRACK_WALK.indexOf(state);
  const walk = state === 'inventory' ? FAST_TRACK_WALK
    : startIdx !== -1 ? FAST_TRACK_WALK.slice(startIdx + 1) : [];
  for (const step of walk) {
    const hop = await transition(req, req.params.id, {
      toState: step, legacyStatus: 'draft', reason,
    });
    if (!hop.ok) return res.status(hop.status).json(hop.body);
    state = step;
  }

  // The attestations the walk implies, stamped as data with their own events.
  // clinical_status is the owner-reserved claim (canSetClinicalStatus) — this
  // route is already owner-gated above.
  const { rows: attRows } = await pool.query(
    `UPDATE resources
        SET clinical_status = 'clinically-reviewed',
            brand_review_status = CASE WHEN brand_review_status = 'pending'
                                       THEN 'approved' ELSE brand_review_status END,
            content_version = COALESCE(content_version, 'v' || version),
            updated_at = NOW()
      WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2
      RETURNING clinical_status, brand_review_status, content_version`,
    [req.params.id, orgOf(req)]);
  if (attRows.length) {
    await pool.query(
      `INSERT INTO resource_governance_events
         (organisation_id, resource_id, field, from_value, to_value, reason, actor_user_id)
       VALUES ($1, $2, 'clinical_status', NULL, 'clinically-reviewed', $3, $4)`,
      [orgOf(req), req.params.id, reason, req.user.id]);
  }

  const result = await transition(req, req.params.id, {
    toState: 'approved',
    legacyStatus: 'approved',
    reason,
    extraSet: `, approved_by = $5, approved_at = NOW(), last_reviewed_at = CURRENT_DATE,
               review_due_at = (CURRENT_DATE + INTERVAL '12 months')::date`,
    extraParams: [req.user.id],
    // This statement stamps the review date, so the guard must not block on it.
    blockerPatch: { review_due_at: 'set-by-this-approval' },
  });
  if (!result.ok) return res.status(result.status).json(result.body);

  const r = result.resource;
  await pool.query(
    `INSERT INTO resource_versions (resource_id, version, title, content, change_note, change_kind, created_by)
     SELECT $1, $2, $3, $4, 'Initial approved version', 'initial', $5
      WHERE NOT EXISTS (SELECT 1 FROM resource_versions WHERE resource_id = $1)`,
    [r.id, r.version, r.title, r.content, req.user.id]);
  await audit(req, 'rh2.resource_approved', r.id, { version: r.version, from: result.from });
  res.json({ ok: true, resource: r });
}));

// Withdraw, never destroy — the handoff requires records be retired rather than
// hard-deleted. 'retired' is reachable from every live state and is reversible:
// an owner can return a withdrawn record to 'inventory'.
router.post('/api/rh2/resources/:id/archive', safe(async (req, res) => {
  const gate = requireReviewer(req, res);
  if (gate) return gate;
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });

  const result = await transition(req, req.params.id, {
    toState: 'retired',
    legacyStatus: 'archived',
    reason: req.body && req.body.reason,
    extraSet: ', archived_at = NOW()',
  });
  if (!result.ok) return res.status(result.status).json(result.body);

  await audit(req, 'rh2.resource_archived', req.params.id, { from: result.from });
  res.json({ ok: true });
}));

/**
 * Send a record BACK for more work. This is not a rejection: the resource stays
 * alive, returns to rights-review, and carries legacy status 'needs_update'.
 *
 * Naming matters here because three audiences read it — the API caller, the
 * audit log and the reviewer in the UI. Calling this "reject" while it left the
 * record revivable meant an audit trail that said 'rejected' about resources
 * that were merely awaiting edits.
 */
router.post('/api/rh2/resources/:id/request-changes', safe(async (req, res) => {
  const gate = requireReviewer(req, res);
  if (gate) return gate;
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });

  const result = await transition(req, req.params.id, {
    toState: 'rights-review',
    legacyStatus: 'needs_update',
    reason: req.body && req.body.reason,
  });
  if (!result.ok) return res.status(result.status).json(result.body);

  await audit(req, 'rh2.resource_changes_requested', req.params.id, { from: result.from });
  res.json({ ok: true, outcome: 'changes-requested', from: result.from });
}));

/**
 * A non-approved outcome: this resource will not go into service as it stands.
 * It lands on 'retired' with legacy status 'rejected', distinct from an
 * archived record that simply reached end of life.
 *
 * 'retired' means INACTIVE / WITHDRAWN, not terminal — an owner can deliberately
 * restore it to 'inventory' and start review again. The only genuinely terminal
 * disposition in the hub is 'excluded-private'.
 */
router.post('/api/rh2/resources/:id/reject', safe(async (req, res) => {
  const gate = requireApprover(req, res);
  if (gate) return gate;
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });

  const result = await transition(req, req.params.id, {
    toState: 'retired',
    legacyStatus: 'rejected',
    reason: req.body && req.body.reason,
  });
  if (!result.ok) return res.status(result.status).json(result.body);

  await audit(req, 'rh2.resource_rejected', req.params.id, { from: result.from });
  res.json({ ok: true, outcome: 'rejected', from: result.from });
}));

/* ═══ Secure file delivery ═══════════════════════════════════════════════════
 *
 * The browser supplies ONE thing: a database file id. It never supplies, and
 * never receives, a path, a storage key or a storage root. Every other input to
 * the decision — which organisation owns it, what tier it sits at, what state
 * its resource is in — is read from the database on the server.
 *
 * Every refusal is a 404 with the same body. A 403 would confirm that a file
 * exists and that the caller merely lacks rights, which for a clinical resource
 * library is itself a disclosure.
 */
const fileStorage = require('./resource-file-storage');
const previewService = require('./resource-preview-service');

const FILE_NOT_FOUND = { error: 'Not found' };

/**
 * The single decision ladder for anything that serves file bytes — download,
 * inline preview and thumbnail all climb the same rungs, so a new delivery
 * surface cannot accidentally be the quiet way in. Returns the loaded row or
 * null; the caller has already been answered with the uniform 404 when null.
 */
async function loadDeliverableFile(req, res, fileId) {
  const notFound = () => { res.status(404).json(FILE_NOT_FOUND); return null; };

  if (!isUuid(fileId)) return notFound();

  // One query, joined through the parent resource: a file is only ever
  // reachable via a resource the caller's organisation owns.
  const { rows } = await pool.query(
    `SELECT f.id, f.file_name, f.file_mime, f.file_size_bytes, f.file_data,
            f.storage_backend, f.storage_key, f.access_tier AS file_tier,
            f.format, f.checksum_sha256,
            r.id AS resource_id, r.organisation_id, r.status AS resource_status,
            r.access_tier AS resource_tier, r.publication_state, r.archived_at
       FROM resource_files f
       JOIN resources r ON r.id = f.resource_id
      WHERE f.id = $1`,
    [fileId]);

  const f = rows[0];
  if (!f) return notFound();

  // 1. Organisation membership.
  const org = orgOf(req);
  if (!org || String(f.organisation_id) !== String(org)) return notFound();

  // 2. Governance state of the parent. Withdrawn and quarantined records serve
  //    nothing; in-review records still serve to authorised staff, because
  //    reviewing a document means opening it.
  if (!governance.canDownloadInState(f.publication_state)) return notFound();
  if (f.archived_at) return notFound();

  // 2b. The SAME visibility rule the detail route applies. Without this a
  //     therapist who is correctly 404'd from a draft resource could still
  //     enumerate and download its files — the two surfaces must agree, or the
  //     quieter one becomes the way in. access_tier travels with status: the
  //     rule reads both.
  if (!visibleTo(req.user, {
    status: f.resource_status,
    access_tier: f.resource_tier,
    publication_state: f.publication_state,
  })) return notFound();

  // 3. Effective tier: the MORE restrictive of resource and file. An unknown
  //    value on either side resolves to excluded-private and is refused.
  if (!governance.canReadFile(req.user && req.user.role, f.resource_tier, f.file_tier)) {
    return notFound();
  }

  return f;
}

/** Read a deliverable file's bytes, answering the uniform 404 on any failure. */
async function readFileBytes(res, f) {
  try {
    if (f.storage_backend === 'rhub' && f.storage_key) {
      // Backend-agnostic: local store today, Azure Blob in production.
      return await fileStorage.getBuffer(f.storage_key);
    }
    if (f.file_data) return Buffer.from(f.file_data, 'base64');
  } catch (err) {
    // Includes containment failures. Never echo the reason — it would describe
    // the filesystem.
    log.warn('resource file unreadable', { fileId: f.id, reason: err.message });
  }
  res.status(404).json(FILE_NOT_FOUND);
  return null;
}

function sendFileBytes(res, buf, { mime, disposition, filename }) {
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Length', String(buf.length));
  // res.end rather than res.send: send() appends "; charset=utf-8" to the
  // Content-Type, which is meaningless on a PDF or DOCX and misdescribes the
  // bytes. end() writes exactly the type chosen from the allow-list.
  return res.end(buf);
}

router.get('/api/rh2/files/:fileId', safe(async (req, res) => {
  const f = await loadDeliverableFile(req, res, req.params.fileId);
  if (!f) return undefined;

  const buf = await readFileBytes(res, f);
  if (!buf) return undefined;

  // Content-Type comes from the allow-list keyed on `format`, never from the
  // stored file_mime, so a poisoned row cannot choose how the browser
  // interprets the bytes.
  await audit(req, 'rh2.file_downloaded', f.resource_id, { fileId: f.id, format: f.format });
  return sendFileBytes(res, buf, {
    mime: fileStorage.mimeForFormat(f.format),
    disposition: 'attachment',
    filename: fileStorage.safeDownloadName(f.file_name, f.format),
  });
}));

/**
 * Inline preview bytes for the in-browser viewer.
 *
 * PDF and DOCX serve their ORIGINAL bytes with an inline disposition (the
 * client renders them with the vendored pdf.js / docx-preview). A legacy .doc
 * serves its generated preview-docx derivative. Everything else is a uniform
 * 404 and the UI shows the file-type fallback panel.
 *
 * Same decision ladder as download; audited separately so preview opens do
 * not inflate download analytics.
 */
router.get('/api/rh2/files/:fileId/preview', safe(async (req, res) => {
  const f = await loadDeliverableFile(req, res, req.params.fileId);
  if (!f) return undefined;

  const format = previewService.formatOf(f);

  if (previewService.INLINE_PREVIEWABLE.has(format)) {
    const buf = await readFileBytes(res, f);
    if (!buf) return undefined;
    await audit(req, 'rh2.file_previewed', f.resource_id, { fileId: f.id, format });
    return sendFileBytes(res, buf, {
      mime: fileStorage.mimeForFormat(format),
      disposition: 'inline',
      filename: fileStorage.safeDownloadName(f.file_name, format),
    });
  }

  // A derivative rendition (e.g. legacy .doc converted to .docx).
  const { rows } = await pool.query(
    `SELECT storage_key, format FROM resource_file_derivatives
      WHERE resource_file_id = $1 AND kind = 'preview-docx'`, [f.id]);
  if (!rows.length) return res.status(404).json(FILE_NOT_FOUND);
  let buf;
  try {
    buf = await fileStorage.getBuffer(rows[0].storage_key);
  } catch (err) {
    log.warn('resource preview unreadable', { fileId: f.id, reason: err.message });
    return res.status(404).json(FILE_NOT_FOUND);
  }
  await audit(req, 'rh2.file_previewed', f.resource_id, { fileId: f.id, format });
  return sendFileBytes(res, buf, {
    mime: fileStorage.mimeForFormat('docx'),
    disposition: 'inline',
    filename: fileStorage.safeDownloadName(f.file_name, 'docx'),
  });
}));

/**
 * Card thumbnail (generated first-page PNG). Same decision ladder as the
 * document itself: a thumbnail IS document content — the first page of a
 * quarantined file leaks exactly what quarantine exists to contain. Cacheable
 * privately for a day; content-addressed keys make staleness harmless.
 */
router.get('/api/rh2/files/:fileId/thumbnail', safe(async (req, res) => {
  const f = await loadDeliverableFile(req, res, req.params.fileId);
  if (!f) return undefined;

  const { rows } = await pool.query(
    `SELECT storage_key, format FROM resource_file_derivatives
      WHERE resource_file_id = $1 AND kind = 'thumbnail'`, [f.id]);
  if (!rows.length) return res.status(404).json(FILE_NOT_FOUND);
  let buf;
  try {
    buf = await fileStorage.getBuffer(rows[0].storage_key);
  } catch (err) {
    log.warn('resource thumbnail unreadable', { fileId: f.id, reason: err.message });
    return res.status(404).json(FILE_NOT_FOUND);
  }
  res.setHeader('Content-Type', rows[0].format === 'jpg' ? 'image/jpeg' : 'image/png');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('Content-Length', String(buf.length));
  return res.end(buf);
}));

/* ═══ Upload ═════════════════════════════════════════════════════════════════
 *
 * The pipeline the 2026-08 audit exists to enforce, in order, before a byte
 * is stored: format allow-list → size cap → magic-byte + quality gate →
 * content-evidence privacy scan → content-addressed dedupe → governed store →
 * derivatives. A file that names a client never reaches storage; a file whose
 * bytes disagree with its extension never reaches staff.
 */
const intake = require('./resource-file-intake');

const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
/** Formats staff may upload — the same set the delivery allow-list serves. */
const UPLOADABLE_FORMATS = new Set(['pdf', 'docx', 'pptx', 'xlsx', 'png', 'jpg']);

router.post('/api/rh2/resources/:id/files', safe(async (req, res) => {
  if (!canAuthor(req.user)) {
    return res.status(403).json({ error: 'Only owners and admins can upload resource files.' });
  }
  const resource = await findResource(req, req.params.id);
  if (!resource) return res.status(404).json(FILE_NOT_FOUND);
  if (resource.archived_at
      || resource.publication_state === 'excluded-private'
      || resource.publication_state === 'retired'
      || resource.access_tier === 'excluded-private') {
    return res.status(409).json({ error: 'This resource cannot receive files in its current state.' });
  }

    // Checking and storing live in resource-file-intake.js so this door and the
  // Library's drag-and-drop door cannot drift apart — a privacy scan that
  // applies to one upload path and not the other is the gap nobody notices.
  const stored = await intake.storeFile(resource, {
    fileName: str(req.body.fileName, 300),
    format: String(req.body.format || '').toLowerCase(),
    fileData: req.body.fileData,
    isPrimary: req.body.isPrimary !== false,
  }, { userId: req.user.id });

  if (!stored.ok) {
    if (stored.code === 'privacy_rejected') {
      await audit(req, 'rh2.file_upload_privacy_rejected', resource.id, {
        // Counts and kinds only — never content.
        privacy: stored.privacy, identifiers: stored.identifiers,
      });
    }
    return res.status(stored.status).json({ error: stored.error, code: stored.code });
  }

  const fileRow = stored.file;
  const format = fileRow.format;
  const checksum = stored.checksum;
  const previews = stored.previews;

  await audit(req, 'rh2.file_uploaded', resource.id, {
    fileId: fileRow.id, format, sizeBytes: stored.sizeBytes, checksum,
  });

  // Derivatives were generated inside the intake, which is also where a
  // renderer failure is swallowed — a missing thumbnail must never fail an
  // upload.
  res.status(201).json({
    file: fileRow,
    previews: previews ? previews.results : null,
    warnings: stored.warnings,
  });
}));

/**
 * Regenerate the cached previews for one file (admin repair action —
 * e.g. after a renderer upgrade or a broken thumbnail).
 */
router.post('/api/rh2/files/:fileId/regenerate-preview', safe(async (req, res) => {
  if (!canAuthor(req.user)) {
    return res.status(403).json({ error: 'Only owners and admins can regenerate previews.' });
  }
  if (!isUuid(req.params.fileId)) return res.status(404).json(FILE_NOT_FOUND);
  const { rows } = await pool.query(
    `SELECT f.id, f.storage_key, f.format, f.checksum_sha256, f.access_tier,
            r.organisation_id, r.publication_state, r.archived_at
       FROM resource_files f JOIN resources r ON r.id = f.resource_id
      WHERE f.id = $1`, [req.params.fileId]);
  const f = rows[0];
  const org = orgOf(req);
  if (!f || !org || String(f.organisation_id) !== String(org)) {
    return res.status(404).json(FILE_NOT_FOUND);
  }
  await previewService.removeDerivatives(pool, f.id);
  const result = await previewService.ensureDerivatives(pool, f);
  await audit(req, 'rh2.previews_regenerated', f.id, { outcomes: result.results });
  res.json({ ok: true, results: result.results });
}));

/**
 * File metadata for a resource. Deliberately projects a fixed column list:
 * storage_key, storage_backend and file_data must never reach a client.
 */
router.get('/api/rh2/resources/:id/files', safe(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json(FILE_NOT_FOUND);
  const resource = await findResource(req, req.params.id);
  if (!resource) return res.status(404).json(FILE_NOT_FOUND);
  // Same visibility rule as the detail route — a resource you cannot open must
  // not disclose its file list either.
  if (!visibleTo(req.user, resource)) return res.status(404).json(FILE_NOT_FOUND);
  if (!governance.canDownloadInState(resource.publication_state)) {
    return res.status(404).json(FILE_NOT_FOUND);
  }

  const { rows } = await pool.query(
    `SELECT f.id, f.file_name, f.format, f.file_size_bytes, f.checksum_sha256,
            f.access_tier, f.is_primary, f.uploaded_at, f.storage_key,
            EXISTS (SELECT 1 FROM resource_file_derivatives d
                     WHERE d.resource_file_id = f.id AND d.kind = 'thumbnail') AS has_thumbnail,
            EXISTS (SELECT 1 FROM resource_file_derivatives d
                     WHERE d.resource_file_id = f.id AND d.kind = 'preview-docx') AS has_preview_docx
       FROM resource_files f WHERE f.resource_id = $1 ORDER BY f.is_primary DESC, f.file_name`,
    [req.params.id]);

  // Only files this caller could actually download are listed at all.
  const visible = rows
    .filter((f) => governance.canReadFile(
      req.user && req.user.role, resource.access_tier, f.access_tier))
    .map((f) => {
      const format = previewService.formatOf(f);
      // What the in-browser viewer can do with this file: 'pdf' and 'docx'
      // render the original; a legacy .doc renders its converted derivative
      // (also via the docx renderer); anything else gets the fallback panel.
      const previewKind = previewService.INLINE_PREVIEWABLE.has(format)
        ? format
        : (f.has_preview_docx ? 'docx' : null);
      return {
        id: f.id,
        fileName: f.file_name,
        format: f.format,
        displayFormat: format || null,
        sizeBytes: f.file_size_bytes === null ? null : Number(f.file_size_bytes),
        checksumSha256: f.checksum_sha256,
        effectiveAccessTier: governance.effectiveAccessTier(resource.access_tier, f.access_tier),
        isPrimary: f.is_primary,
        uploadedAt: f.uploaded_at,
        downloadUrl: `/api/rh2/files/${f.id}`,
        previewKind,
        previewUrl: previewKind ? `/api/rh2/files/${f.id}/preview` : null,
        thumbnailUrl: f.has_thumbnail ? `/api/rh2/files/${f.id}/thumbnail` : null,
        // Present only for roles that may use it — the client renders what it
        // is given and makes no access decision of its own.
        regenerateUrl: canAuthor(req.user) ? `/api/rh2/files/${f.id}/regenerate-preview` : null,
      };
    });

  res.json({ files: visible });
}));

/**
 * Walk a resource through the review lifecycle.
 *
 * submit/approve/archive/reject cover the legacy four-step flow, but the
 * governance lifecycle has eight states — without this a reviewer could never
 * move a record from rights-review to clinical review to brand review, and
 * everything would pile up in whichever state it was seeded into. Legality is
 * decided by canTransition(), so this endpoint cannot be used to skip a stage
 * or to resurrect an excluded-private record.
 *
 * The legacy `status` deliberately stays 'draft' for every in-review state:
 * `status = 'approved'` is what the 36 read routes serve on, so a record still
 * under review must never hold it.
 */
const IN_REVIEW_STATES = ['inventory', 'rights-review', 'clinical-review', 'brand-accessibility-review'];

router.post('/api/rh2/resources/:id/governance-state', safe(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });

  const toState = String((req.body && req.body.toState) || '');
  // Authority is decided inside transition(), which knows the record's current
  // state and can therefore police the clinical-attestation step. Anything
  // checked here would be blind to where the record is coming FROM.
  const reason = req.body && req.body.reason;
  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ error: 'A reason is required for every governance transition.' });
  }

  const legacyStatus =
    toState === 'approved' ? 'approved'
      : toState === 'retired' ? 'archived'
        : toState === 'excluded-private' ? 'rejected'
          : IN_REVIEW_STATES.indexOf(toState) !== -1 ? 'draft'
            : null;
  if (legacyStatus === null) {
    return res.status(400).json({ error: `Unknown target state "${toState}".` });
  }

  const extra = toState === 'excluded-private' ? ", access_tier = 'excluded-private'" : '';
  const result = await transition(req, req.params.id, {
    toState, legacyStatus, reason, extraSet: extra,
    blockerPatch: toState === 'approved' ? { review_due_at: 'set-on-approval' } : undefined,
  });
  if (!result.ok) return res.status(result.status).json(result.body);

  await audit(req, 'rh2.resource_governance_state', req.params.id,
    { from: result.from, to: toState });
  res.json({ ok: true, from: result.from, to: toState });
}));

// ═══ 6. Acknowledgements ═════════════════════════════════════════════════════

router.post('/api/rh2/resources/:id/acknowledge', safe(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const resource = await findResource(req, req.params.id);
  if (!resource || resource.status !== 'approved') return res.status(404).json({ error: 'Not found' });
  if (!resource.acknowledgement_required) {
    return res.status(400).json({ error: 'This resource does not require acknowledgement' });
  }
  await pool.query(
    `INSERT INTO policy_acknowledgements (organisation_id, user_id, resource_id, version)
     VALUES ($1,$2,$3,$4) ON CONFLICT (user_id, resource_id, version) DO NOTHING`,
    [orgOf(req), req.user.id, resource.id, resource.version]);
  await audit(req, 'rh2.resource_acknowledged', resource.id, { version: resource.version });
  res.json({ ok: true, version: resource.version });
}));

// ═══ 7. Completion ═══════════════════════════════════════════════════════════

router.post('/api/rh2/resources/:id/complete', safe(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const resource = await findResource(req, req.params.id);
  if (!visibleTo(req.user, resource)) return res.status(404).json({ error: 'Not found' });
  await pool.query(
    `INSERT INTO user_learning_progress (user_id, resource_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
    [req.user.id, resource.id]);
  await audit(req, 'rh2.resource_completed', resource.id);
  res.json({ ok: true });
}));

router.delete('/api/rh2/resources/:id/complete', safe(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });
  await pool.query('DELETE FROM user_learning_progress WHERE user_id = $1 AND resource_id = $2',
    [req.user.id, req.params.id]);
  res.json({ ok: true });
}));

// ═══ 8. Favourites ═══════════════════════════════════════════════════════════

router.post('/api/rh2/resources/:id/favourite', safe(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const resource = await findResource(req, req.params.id);
  if (!visibleTo(req.user, resource)) return res.status(404).json({ error: 'Not found' });
  await pool.query('INSERT INTO resource_favourites (user_id, resource_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [req.user.id, resource.id]);
  res.json({ ok: true });
}));

router.delete('/api/rh2/resources/:id/favourite', safe(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });
  await pool.query('DELETE FROM resource_favourites WHERE user_id = $1 AND resource_id = $2',
    [req.user.id, req.params.id]);
  res.json({ ok: true });
}));

// ═══ 9. Feedback ═════════════════════════════════════════════════════════════

router.post('/api/rh2/resources/:id/feedback', safe(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const resource = await findResource(req, req.params.id);
  if (!visibleTo(req.user, resource)) return res.status(404).json({ error: 'Not found' });
  const kind = req.body?.kind;
  if (!FEEDBACK_KINDS.includes(kind)) {
    return res.status(400).json({ error: `kind must be one of: ${FEEDBACK_KINDS.join(', ')}` });
  }
  await pool.query(
    `INSERT INTO resource_feedback (organisation_id, resource_id, user_id, kind, comment)
     VALUES ($1,$2,$3,$4,$5)`,
    [orgOf(req), resource.id, req.user.id, kind, str(req.body?.comment, 1000)]);
  await audit(req, 'rh2.resource_feedback', resource.id, { kind });
  res.json({ ok: true });
}));

// ═══ 10. My Learning ═════════════════════════════════════════════════════════

async function loadLearningPaths(req, key) {
  const orgId = orgOf(req);
  const params = [orgId];
  let where = 'p.organisation_id IS NOT DISTINCT FROM $1 AND p.is_active = TRUE';
  if (key) { params.push(key); where += ` AND p.key = $${params.length}`; }
  const { rows: paths } = await pool.query(
    `SELECT p.id, p.key, p.name, p.description, p.target_role, p.sort_order
       FROM learning_paths p WHERE ${where} ORDER BY p.sort_order, p.name`, params);
  if (!paths.length) return [];

  const { rows: items } = await pool.query(
    `SELECT i.path_id, i.resource_id, i.sort_order, i.required,
            r.title, r.slug, r.content_type, r.estimated_minutes, r.learning_minutes,
            r.acknowledgement_required, r.version,
            (prog.resource_id IS NOT NULL) AS completed,
            EXISTS (SELECT 1 FROM policy_acknowledgements a
                     WHERE a.resource_id = r.id AND a.user_id = $1
                       AND a.version >= ${ackRelevantVersionSql('r')}) AS acknowledged
       FROM learning_path_items i
       JOIN resources r ON r.id = i.resource_id AND r.status = 'approved'
            AND ${PRIVACY_PREDICATE}
       LEFT JOIN user_learning_progress prog ON prog.resource_id = r.id AND prog.user_id = $1
      WHERE i.path_id = ANY($2::uuid[])
      ORDER BY i.sort_order, r.title`,
    [req.user.id, paths.map((p) => p.id)]);

  return paths.map((p) => {
    const pathItems = items.filter((i) => i.path_id === p.id);
    const completed = pathItems.filter((i) => i.completed).length;
    return {
      ...p,
      items: pathItems,
      total: pathItems.length,
      completed,
      percent: pathItems.length ? Math.round((completed / pathItems.length) * 100) : 0,
    };
  });
}

router.get('/api/rh2/learning', safe(async (req, res) => {
  res.json({ paths: await loadLearningPaths(req, null) });
}));

router.get('/api/rh2/learning/:key', safe(async (req, res) => {
  const paths = await loadLearningPaths(req, str(req.params.key, 60));
  if (!paths.length) return res.status(404).json({ error: 'Not found' });
  res.json({ path: paths[0] });
}));

// ═══ 11. Knowledge checks ════════════════════════════════════════════════════

router.post('/api/rh2/resources/:id/quiz-attempt', safe(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const resource = await findResource(req, req.params.id);
  if (!visibleTo(req.user, resource)) return res.status(404).json({ error: 'Not found' });

  const { rows: quizzes } = await pool.query(
    'SELECT * FROM quizzes WHERE resource_id = $1 AND is_active = TRUE', [resource.id]);
  if (!quizzes.length) return res.status(404).json({ error: 'No knowledge check for this resource' });
  const quiz = quizzes[0];

  const { rows: questions } = await pool.query(
    'SELECT id, correct_index FROM quiz_questions WHERE quiz_id = $1 ORDER BY sort_order', [quiz.id]);
  if (!questions.length) return res.status(404).json({ error: 'No knowledge check for this resource' });

  const answers = req.body?.answers;
  if (!Array.isArray(answers) || answers.length !== questions.length
      || answers.some((a) => !Number.isInteger(a) || a < 0 || a > 20)) {
    return res.status(400).json({ error: `answers must be an array of ${questions.length} option indices` });
  }

  // Scoring is strictly server-side: correct_index never leaves the server
  // for non-owners (see the detail route), so a client cannot self-mark.
  const score = questions.reduce((n, q, i) => n + (answers[i] === q.correct_index ? 1 : 0), 0);
  const percent = Math.round((score / questions.length) * 100);
  const passed = percent >= quiz.pass_threshold;

  await pool.query(
    `INSERT INTO quiz_attempts (quiz_id, user_id, score, total, passed) VALUES ($1,$2,$3,$4,$5)`,
    [quiz.id, req.user.id, score, questions.length, passed]);
  if (passed) {
    await pool.query(
      'INSERT INTO user_learning_progress (user_id, resource_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [req.user.id, resource.id]);
  }
  await audit(req, 'rh2.quiz_attempted', resource.id, { score, total: questions.length, passed });
  res.json({ score, total: questions.length, percent, passed });
}));

// ═══ 12. External source registry (owner) ════════════════════════════════════

function sourceFreshness(s) {
  if (s.status === 'source_changed') return 'source_changed';
  if (s.next_verify_at && new Date(s.next_verify_at) < new Date()) return 'review_due';
  return s.status;
}

router.get('/api/rh2/sources', safe(async (req, res) => {
  if (!isOwner(req.user)) return res.status(403).json({ error: 'Owner only' });
  const { rows } = await pool.query(
    `SELECT s.*, COALESCE(json_agg(json_build_object('id', r.id, 'title', r.title))
                 FILTER (WHERE r.id IS NOT NULL), '[]') AS resources
       FROM external_sources s
       LEFT JOIN resource_external_sources res ON res.source_id = s.id
       LEFT JOIN resources r ON r.id = res.resource_id
      WHERE s.organisation_id IS NOT DISTINCT FROM $1
      GROUP BY s.id ORDER BY s.name`, [orgOf(req)]);
  res.json({ sources: rows.map((s) => ({ ...s, freshness: sourceFreshness(s) })) });
}));

router.post('/api/rh2/sources', safe(async (req, res) => {
  if (!isOwner(req.user)) return res.status(403).json({ error: 'Owner only' });
  const b = req.body || {};
  const name = str(b.name, 200);
  const url = str(b.url, 2000);
  if (!name || !url) return res.status(400).json({ error: 'name and url required' });
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'url must be http(s)' });
  const authority = b.authority || 'external_reference';
  if (!AUTHORITY_LEVELS.includes(authority)) {
    return res.status(400).json({ error: `authority must be one of: ${AUTHORITY_LEVELS.join(', ')}` });
  }
  const { rows } = await pool.query(
    `INSERT INTO external_sources (organisation_id, name, publisher, url, authority, effective_date, last_verified_at, next_verify_at)
     VALUES ($1,$2,$3,$4,$5,$6,CURRENT_DATE,(CURRENT_DATE + INTERVAL '6 months')::date) RETURNING *`,
    [orgOf(req), name, str(b.publisher, 200), url, authority, b.effectiveDate || null]);
  const source = rows[0];
  for (const rid of (Array.isArray(b.resourceIds) ? b.resourceIds : []).filter(isUuid)) {
    await pool.query(
      `INSERT INTO resource_external_sources (resource_id, source_id)
       SELECT id, $2 FROM resources WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $3
       ON CONFLICT DO NOTHING`, [rid, source.id, orgOf(req)]);
  }
  await audit(req, 'rh2.source_created', source.id, { name, url });
  res.status(201).json({ source });
}));

router.patch('/api/rh2/sources/:id', safe(async (req, res) => {
  if (!isOwner(req.user)) return res.status(403).json({ error: 'Owner only' });
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  const sets = [];
  const params = [];
  const set = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
  if (b.name !== undefined) { const n = str(b.name, 200); if (!n) return res.status(400).json({ error: 'name cannot be empty' }); set('name', n); }
  if (b.publisher !== undefined) set('publisher', str(b.publisher, 200));
  if (b.url !== undefined) {
    const u = str(b.url, 2000);
    if (!u || !/^https?:\/\//i.test(u)) return res.status(400).json({ error: 'url must be http(s)' });
    set('url', u);
  }
  if (b.authority !== undefined) {
    if (!AUTHORITY_LEVELS.includes(b.authority)) return res.status(400).json({ error: 'invalid authority' });
    set('authority', b.authority);
  }
  if (b.effectiveDate !== undefined) set('effective_date', b.effectiveDate || null);
  if (b.status !== undefined) {
    if (!['current', 'review_due', 'source_changed', 'outdated', 'archived'].includes(b.status)) {
      return res.status(400).json({ error: 'invalid status' });
    }
    set('status', b.status);
  }
  if (!sets.length) return res.status(400).json({ error: 'No editable fields supplied' });
  params.push(req.params.id, orgOf(req));
  const { rows } = await pool.query(
    `UPDATE external_sources SET ${sets.join(', ')}
      WHERE id = $${params.length - 1} AND organisation_id IS NOT DISTINCT FROM $${params.length} RETURNING *`,
    [...params]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  await audit(req, 'rh2.source_updated', req.params.id);
  res.json({ source: rows[0] });
}));

/**
 * Pure change-detection: given the stored source row and the fetch result,
 * compute the columns to persist. Exported for unit testing — the itest never
 * makes real HTTP calls.
 */
function computeSourceCheckUpdate(source, fetched) {
  const update = {
    http_status: fetched.httpStatus ?? null,
    etag: fetched.etag ? String(fetched.etag).slice(0, 200) : source.etag,
    last_modified: fetched.lastModified ? String(fetched.lastModified).slice(0, 120) : source.last_modified,
    content_hash: fetched.contentHash || source.content_hash,
    changed: false,
  };
  const differs = (oldVal, newVal) => oldVal && newVal && oldVal !== newVal;
  if (differs(source.etag, fetched.etag)
      || differs(source.last_modified, fetched.lastModified)
      || differs(source.content_hash, fetched.contentHash)) {
    update.changed = true;
  }
  return update;
}

/**
 * SSRF guard for check-now. An owner-registered URL (and every redirect hop it
 * takes) must resolve only to public unicast addresses: no loopback, RFC1918,
 * link-local (incl. the 169.254.169.254 metadata service), CGNAT-adjacent
 * multicast/unspecified ranges, or IPv6 equivalents. DNS is resolved and ALL
 * returned addresses are validated, which also neutralises decimal/octal IPv4
 * encodings (lookup normalises them to dotted quads). Pure functions are
 * exported for unit testing — no HTTP in tests.
 */
function isPrivateIp(addr) {
  const s = String(addr || '').trim().toLowerCase();
  const family = net.isIP(s);
  if (family === 4) {
    const p = s.split('.').map(Number);
    return (
      p[0] === 0 ||                                  // 0.0.0.0/8 (incl. 0.0.0.0)
      p[0] === 10 ||                                 // 10/8
      p[0] === 127 ||                                // 127/8 loopback
      (p[0] === 169 && p[1] === 254) ||              // 169.254/16 link-local + metadata IP
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||  // 172.16/12
      (p[0] === 192 && p[1] === 168) ||              // 192.168/16
      p[0] >= 224                                    // 224/4 multicast + 240/4 reserved/broadcast
    );
  }
  if (family === 6) {
    if (s === '::' || s === '::1') return true;      // unspecified + loopback
    // IPv4-mapped/compatible (::ffff:a.b.c.d) — judge the embedded IPv4.
    const v4 = s.match(/:((?:\d{1,3}\.){3}\d{1,3})$/);
    if (v4) return isPrivateIp(v4[1]);
    const head = s.split(':')[0].padStart(4, '0');
    if (/^fe[89ab]/.test(head)) return true;         // fe80::/10 link-local
    if (/^f[cd]/.test(head)) return true;            // fc00::/7 unique-local
    if (/^ff/.test(head)) return true;               // ff00::/8 multicast
    return false;
  }
  return true; // not a parseable IP — treat as unsafe
}

// Static (DNS-free) vetting of one URL/redirect hop. Returns null when the hop
// looks safe, otherwise a short reason string.
function urlHopIssue(rawUrl) {
  let u;
  try { u = new URL(String(rawUrl || '')); } catch (_) { return 'invalid URL'; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'protocol not allowed';
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host) return 'invalid URL';
  if (host === 'localhost' || host.endsWith('.localhost')) return 'blocked hostname';
  if (host === 'local' || host.endsWith('.local')) return 'blocked hostname';
  if (host === 'metadata.google.internal') return 'blocked hostname';
  if (net.isIP(host) && isPrivateIp(host)) return 'private address';
  return null;
}

async function assertSafeSourceUrl(rawUrl) {
  const issue = urlHopIssue(rawUrl);
  if (issue) throw new Error(`unsafe source URL: ${issue}`);
  const host = new URL(rawUrl).hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) return; // literal IP already vetted above
  const addrs = await dns.lookup(host, { all: true, verbatim: true });
  if (!addrs.length) throw new Error('unsafe source URL: unresolvable host');
  for (const a of addrs) {
    if (isPrivateIp(a.address)) throw new Error('unsafe source URL: resolves to a private address');
  }
}

const SOURCE_FETCH_MAX_BYTES = 512 * 1024;
const SOURCE_FETCH_MAX_HOPS = 3;

// Fetch with redirects disabled; each hop is re-validated (protocol, hostname
// blocklist, resolved addresses) before it is requested, and the body is
// capped at 512 KB. Applied identically to the HEAD probe and the GET fallback.
async function fetchValidated(method, url) {
  let current = url;
  for (let hop = 0; hop <= SOURCE_FETCH_MAX_HOPS; hop++) {
    await assertSafeSourceUrl(current);
    const opts = {
      timeout: 5000,
      maxRedirects: 0,
      validateStatus: () => true,
      maxContentLength: SOURCE_FETCH_MAX_BYTES,
      maxBodyLength: SOURCE_FETCH_MAX_BYTES,
    };
    const resp = method === 'get'
      ? await axios.get(current, { ...opts, responseType: 'arraybuffer', headers: { Range: 'bytes=0-65535' } })
      : await axios.head(current, opts);
    const location = resp.headers?.location;
    if ([301, 302, 303, 307, 308].includes(resp.status) && location) {
      current = new URL(location, current).toString();
      continue;
    }
    return resp;
  }
  throw new Error('unsafe source URL: too many redirects');
}

async function fetchSourceMeta(url) {
  let resp = null;
  try {
    resp = await fetchValidated('head', url);
  } catch (_) { resp = null; }
  let body = null;
  if (!resp || resp.status === 405 || resp.status >= 400 || (!resp.headers?.etag && !resp.headers?.['last-modified'])) {
    try {
      resp = await fetchValidated('get', url);
      body = resp.data;
    } catch (_) { /* keep whatever the HEAD gave us */ }
  }
  if (!resp) return { httpStatus: null, etag: null, lastModified: null, contentHash: null };
  return {
    httpStatus: resp.status,
    etag: resp.headers?.etag || null,
    lastModified: resp.headers?.['last-modified'] || null,
    contentHash: body ? crypto.createHash('sha256').update(Buffer.from(body)).digest('hex') : null,
  };
}

// Explicit admin action ONLY — never runs during normal page requests.
router.post('/api/rh2/sources/check-now', safe(async (req, res) => {
  if (!isOwner(req.user)) return res.status(403).json({ error: 'Owner only' });
  const { rows: sources } = await pool.query(
    `SELECT * FROM external_sources WHERE organisation_id IS NOT DISTINCT FROM $1 AND status <> 'archived'
      ORDER BY name`, [orgOf(req)]);
  const results = [];
  for (const source of sources) {
    const fetched = await fetchSourceMeta(source.url);
    const update = computeSourceCheckUpdate(source, fetched);
    if (update.changed) {
      await pool.query(
        `UPDATE external_sources SET http_status = $2, etag = $3, last_modified = $4, content_hash = $5,
                last_checked_at = NOW(), status = 'source_changed', change_detected_at = NOW(),
                verified_after_change = FALSE
          WHERE id = $1`,
        [source.id, update.http_status, update.etag, update.last_modified, update.content_hash]);
    } else {
      await pool.query(
        `UPDATE external_sources SET http_status = $2, etag = $3, last_modified = $4, content_hash = $5,
                last_checked_at = NOW()
          WHERE id = $1`,
        [source.id, update.http_status, update.etag, update.last_modified, update.content_hash]);
    }
    results.push({ id: source.id, name: source.name, httpStatus: update.http_status, changed: update.changed });
  }
  // Linked resources are NEVER modified automatically — a detected change only
  // flags the source for human verification.
  await audit(req, 'rh2.sources_checked', null, { checked: results.length });
  res.json({ checked: results.length, results });
}));

router.post('/api/rh2/sources/:id/verify', safe(async (req, res) => {
  if (!isOwner(req.user)) return res.status(403).json({ error: 'Owner only' });
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const { rows } = await pool.query(
    `UPDATE external_sources SET status = 'current', last_verified_at = CURRENT_DATE,
            next_verify_at = (CURRENT_DATE + INTERVAL '6 months')::date, verified_after_change = TRUE
      WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2 RETURNING *`,
    [req.params.id, orgOf(req)]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  await audit(req, 'rh2.source_verified', req.params.id);
  res.json({ source: rows[0] });
}));

// ═══ 13. PD events ═══════════════════════════════════════════════════════════

router.get('/api/rh2/pd', safe(async (req, res) => {
  const orgId = orgOf(req);
  await markPastPdEvents(orgId);
  const { rows } = await pool.query(
    `SELECT * FROM pd_events WHERE organisation_id IS NOT DISTINCT FROM $1 AND status <> 'archived'
      ORDER BY starts_at ASC NULLS LAST`, [orgId]);
  res.json({
    upcoming: rows.filter((e) => e.status === 'upcoming'),
    past: rows.filter((e) => e.status === 'past' || e.status === 'cancelled'),
  });
}));

/**
 * Shape a pd_events row for the browser.
 *
 * Deliberately explicit rather than SELECT *: the row carries internal columns
 * (created_by, external_ref, organisation_id) that a client has no use for, and
 * an outward-facing contract should be something you can read, not whatever the
 * table happens to hold this month.
 *
 * `bookingUrl` is always the PROVIDER'S page. Opal has no booking integration,
 * so this contract has no notion of a booking, a seat or a payment — the
 * therapist finishes the transaction on the provider's own site.
 */
function serialisePdEvent(r) {
  return {
    id: r.id,
    title: r.title,
    provider: r.provider || null,
    description: r.description || null,
    topic: r.topic || null,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    timezone: r.timezone,
    mode: r.mode,
    location: r.location || null,
    costCents: r.cost_cents === null || r.cost_cents === undefined ? null : Number(r.cost_cents),
    cpdHours: r.cpd_hours === null || r.cpd_hours === undefined ? null : Number(r.cpd_hours),
    targetRoles: r.target_roles || [],
    status: r.status,
    // Two different links: where you book, and where the event is described.
    bookingUrl: safeWebUrl(r.registration_url),
    sourceUrl: safeWebUrl(r.source_url),
    imageUrl: safeWebUrl(r.image_url, true),
    // Provenance, so the page can say where a listing came from rather than
    // implying Opal is the authority on someone else's course.
    sourceName: r.source || null,
    providerKey: r.provider_key || 'manual',
    syncedAt: r.synced_at || null,
    updatedAt: r.updated_at || r.created_at,
    // Booking is never in-app. Stated in the contract so a client cannot
    // reasonably render an in-app booking control.
    bookingIsExternal: true,
  };
}

/**
 * Only http(s) survives. A stored value is data, and data that becomes an href
 * must not be able to carry javascript:, data: or file:. The database
 * constraint says the same thing; this is the second line, because a row could
 * predate the constraint.
 */
function safeWebUrl(v, httpsOnly) {
  const raw = String(v == null ? '' : v).trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (httpsOnly) return u.protocol === 'https:' ? raw : null;
    return (u.protocol === 'http:' || u.protocol === 'https:') ? raw : null;
  } catch (e) { return null; }
}

/**
 * The professional-development catalogue: search and filters over upcoming
 * events, with past events available on request.
 *
 * Reuses pd_events — the same rows the Home preview and the admin tab already
 * use. There is no second store and no separate sync: an event added by an
 * administrator appears here immediately.
 */
router.get('/api/rh2/pd/catalogue', safe(async (req, res) => {
  const orgId = orgOf(req);
  await markPastPdEvents(orgId);

  const params = [orgId];
  let where = `organisation_id IS NOT DISTINCT FROM $1 AND status <> 'archived'`;

  const when = req.query.when === 'past' ? 'past' : 'upcoming';
  if (when === 'upcoming') where += ` AND status = 'upcoming'`;
  else where += ` AND status IN ('past','cancelled')`;

  if (req.query.q) {
    params.push('%' + str(req.query.q, 120) + '%');
    where += ` AND (title ILIKE $${params.length} OR provider ILIKE $${params.length}
                    OR description ILIKE $${params.length} OR topic ILIKE $${params.length})`;
  }
  if (PD_MODES.includes(req.query.mode)) {
    params.push(req.query.mode);
    where += ` AND mode = $${params.length}`;
  }
  if (req.query.topic) {
    params.push(str(req.query.topic, 100));
    where += ` AND topic = $${params.length}`;
  }
  // "Free" means a recorded zero, not an unknown cost. An event with no price
  // recorded is not free — it is unpriced, and saying otherwise would be a
  // claim about someone else's course.
  if (req.query.cost === 'free') where += ` AND cost_cents = 0`;
  else if (req.query.cost === 'paid') where += ` AND cost_cents > 0`;
  if (req.query.cpd === '1') where += ` AND cpd_hours IS NOT NULL AND cpd_hours > 0`;

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM pd_events WHERE ${where}`, params);

  params.push(limit, offset);
  const order = when === 'upcoming' ? 'starts_at ASC NULLS LAST' : 'starts_at DESC NULLS LAST';
  const { rows } = await pool.query(
    `SELECT * FROM pd_events WHERE ${where}
      ORDER BY ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`, params);

  // Filter vocabularies come from the data actually present, so the UI cannot
  // offer a topic that would return nothing.
  const { rows: topics } = await pool.query(
    `SELECT DISTINCT topic FROM pd_events
      WHERE organisation_id IS NOT DISTINCT FROM $1 AND topic IS NOT NULL AND status <> 'archived'
      ORDER BY topic`, [orgId]);

  res.json({
    total: countRows[0].total,
    limit,
    offset,
    events: rows.map(serialisePdEvent),
    facets: { topics: topics.map((t) => t.topic), modes: PD_MODES },
    // Said plainly so no client implies otherwise.
    bookingNote: 'Booking is completed on the provider\'s own website. Opal does not process registrations or payments.',
  });
}));

/** One event, in full, for the detail view. */
router.get('/api/rh2/pd/:id', safe(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const { rows } = await pool.query(
    `SELECT * FROM pd_events
      WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2 AND status <> 'archived'`,
    [req.params.id, orgOf(req)]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json({ event: serialisePdEvent(rows[0]) });
}));

router.post('/api/rh2/pd', safe(async (req, res) => {
  if (!canAuthor(req.user)) return res.status(403).json({ error: 'Only admins and owners can manage PD events' });
  const b = req.body || {};
  const title = str(b.title, 300);
  if (!title) return res.status(400).json({ error: 'title required' });
  const mode = b.mode || 'online';
  if (!PD_MODES.includes(mode)) return res.status(400).json({ error: `mode must be one of: ${PD_MODES.join(', ')}` });
  const registrationUrl = str(b.registrationUrl, 2000);
  if (registrationUrl && !isHttpUrl(registrationUrl)) {
    return res.status(400).json({ error: 'registrationUrl must be an http(s) URL' });
  }
  const { rows } = await pool.query(
    `INSERT INTO pd_events (organisation_id, title, provider, description, topic, starts_at, ends_at,
        timezone, mode, location, cost_cents, cpd_hours, registration_url, target_roles, source, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [orgOf(req), title, str(b.provider, 200), typeof b.description === 'string' ? b.description.slice(0, 10000) : null,
     str(b.topic, 100), b.startsAt || null, b.endsAt || null, str(b.timezone, 50) || 'Australia/Perth', mode,
     str(b.location, 300), Number.isFinite(+b.costCents) ? Math.round(+b.costCents) : null,
     Number.isFinite(+b.cpdHours) ? +b.cpdHours : null, registrationUrl,
     JSON.stringify(strArr(b.targetRoles, 10, 30)), str(b.source, 200), req.user.id]);
  await audit(req, 'rh2.pd_event_created', rows[0].id, { title });
  res.status(201).json({ event: rows[0] });
}));

router.patch('/api/rh2/pd/:id', safe(async (req, res) => {
  if (!canAuthor(req.user)) return res.status(403).json({ error: 'Only admins and owners can manage PD events' });
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  const sets = [];
  const params = [];
  const set = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
  if (b.title !== undefined) { const t = str(b.title, 300); if (!t) return res.status(400).json({ error: 'title cannot be empty' }); set('title', t); }
  if (b.provider !== undefined) set('provider', str(b.provider, 200));
  if (b.description !== undefined) set('description', typeof b.description === 'string' ? b.description.slice(0, 10000) : null);
  if (b.topic !== undefined) set('topic', str(b.topic, 100));
  if (b.startsAt !== undefined) set('starts_at', b.startsAt || null);
  if (b.endsAt !== undefined) set('ends_at', b.endsAt || null);
  if (b.mode !== undefined) {
    if (!PD_MODES.includes(b.mode)) return res.status(400).json({ error: 'invalid mode' });
    set('mode', b.mode);
  }
  if (b.location !== undefined) set('location', str(b.location, 300));
  if (b.costCents !== undefined) set('cost_cents', Number.isFinite(+b.costCents) ? Math.round(+b.costCents) : null);
  if (b.cpdHours !== undefined) set('cpd_hours', Number.isFinite(+b.cpdHours) ? +b.cpdHours : null);
  if (b.registrationUrl !== undefined) {
    const u = str(b.registrationUrl, 2000);
    if (u && !isHttpUrl(u)) return res.status(400).json({ error: 'registrationUrl must be an http(s) URL' });
    set('registration_url', u);
  }
  if (b.status !== undefined) {
    if (!['upcoming', 'past', 'archived', 'cancelled'].includes(b.status)) return res.status(400).json({ error: 'invalid status' });
    set('status', b.status);
  }
  if (!sets.length) return res.status(400).json({ error: 'No editable fields supplied' });
  params.push(req.params.id, orgOf(req));
  const { rows } = await pool.query(
    `UPDATE pd_events SET ${sets.join(', ')}
      WHERE id = $${params.length - 1} AND organisation_id IS NOT DISTINCT FROM $${params.length} RETURNING *`,
    [...params]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  await audit(req, 'rh2.pd_event_updated', req.params.id);
  res.json({ event: rows[0] });
}));

router.delete('/api/rh2/pd/:id', safe(async (req, res) => {
  if (!canAuthor(req.user)) return res.status(403).json({ error: 'Only admins and owners can manage PD events' });
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const { rows } = await pool.query(
    'DELETE FROM pd_events WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2 RETURNING id',
    [req.params.id, orgOf(req)]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  await audit(req, 'rh2.pd_event_deleted', req.params.id);
  res.json({ ok: true });
}));

// ═══ 14. CPD tracker (own entries only, every role) ══════════════════════════

router.get('/api/rh2/cpd', safe(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM cpd_entries WHERE user_id = $1 ORDER BY activity_date DESC, created_at DESC LIMIT 500`,
    [req.user.id]);
  res.json({ entries: rows });
}));

router.post('/api/rh2/cpd', safe(async (req, res) => {
  const b = req.body || {};
  const activity = str(b.activity, 300);
  if (!activity || !b.activityDate) return res.status(400).json({ error: 'activity and activityDate required' });
  const hours = Number.isFinite(+b.hours) ? +b.hours : 0;
  const interactive = Number.isFinite(+b.interactiveHours) ? +b.interactiveHours : 0;
  if (hours < 0 || hours > 100 || interactive < 0 || interactive > 100) {
    return res.status(400).json({ error: 'hours out of range' });
  }
  const { rows } = await pool.query(
    `INSERT INTO cpd_entries (organisation_id, user_id, activity_date, activity, provider, learning_goal,
        hours, interactive_hours, reflection, competency_area, evidence_note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [orgOf(req), req.user.id, b.activityDate, activity, str(b.provider, 200),
     typeof b.learningGoal === 'string' ? b.learningGoal.slice(0, 5000) : null, hours, interactive,
     typeof b.reflection === 'string' ? b.reflection.slice(0, 5000) : null,
     str(b.competencyArea, 100), typeof b.evidenceNote === 'string' ? b.evidenceNote.slice(0, 2000) : null]);
  await audit(req, 'rh2.cpd_entry_created', rows[0].id);
  res.status(201).json({ entry: rows[0] });
}));

router.patch('/api/rh2/cpd/:id', safe(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  const sets = [];
  const params = [];
  const set = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
  if (b.activity !== undefined) { const a = str(b.activity, 300); if (!a) return res.status(400).json({ error: 'activity cannot be empty' }); set('activity', a); }
  if (b.activityDate !== undefined) set('activity_date', b.activityDate);
  if (b.provider !== undefined) set('provider', str(b.provider, 200));
  if (b.learningGoal !== undefined) set('learning_goal', typeof b.learningGoal === 'string' ? b.learningGoal.slice(0, 5000) : null);
  if (b.hours !== undefined) {
    const h = +b.hours;
    if (!Number.isFinite(h) || h < 0 || h > 100) return res.status(400).json({ error: 'hours out of range' });
    set('hours', h);
  }
  if (b.interactiveHours !== undefined) {
    const h = +b.interactiveHours;
    if (!Number.isFinite(h) || h < 0 || h > 100) return res.status(400).json({ error: 'interactiveHours out of range' });
    set('interactive_hours', h);
  }
  if (b.reflection !== undefined) set('reflection', typeof b.reflection === 'string' ? b.reflection.slice(0, 5000) : null);
  if (b.competencyArea !== undefined) set('competency_area', str(b.competencyArea, 100));
  if (b.evidenceNote !== undefined) set('evidence_note', typeof b.evidenceNote === 'string' ? b.evidenceNote.slice(0, 2000) : null);
  if (!sets.length) return res.status(400).json({ error: 'No editable fields supplied' });
  params.push(req.params.id, req.user.id);
  const { rows } = await pool.query(
    `UPDATE cpd_entries SET ${sets.join(', ')}, updated_at = NOW()
      WHERE id = $${params.length - 1} AND user_id = $${params.length} RETURNING *`, [...params]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  await audit(req, 'rh2.cpd_entry_updated', req.params.id);
  res.json({ entry: rows[0] });
}));

router.delete('/api/rh2/cpd/:id', safe(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const { rows } = await pool.query(
    'DELETE FROM cpd_entries WHERE id = $1 AND user_id = $2 RETURNING id', [req.params.id, req.user.id]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  await audit(req, 'rh2.cpd_entry_deleted', req.params.id);
  res.json({ ok: true });
}));

// Registration year runs 1 December – 30 November (OT Board registration
// standard). ?year=2026 → 2025-12-01 .. 2026-11-30.
router.get('/api/rh2/cpd/summary', safe(async (req, res) => {
  const year = parseInt(req.query.year, 10) || new Date().getUTCFullYear();
  if (year < 2000 || year > 2100) return res.status(400).json({ error: 'invalid year' });
  const from = `${year - 1}-12-01`;
  const to = `${year}-11-30`;
  const { rows } = await pool.query(
    `SELECT COUNT(*) AS entry_count, COALESCE(SUM(hours), 0) AS total_hours,
            COALESCE(SUM(interactive_hours), 0) AS interactive_hours
       FROM cpd_entries WHERE user_id = $1 AND activity_date BETWEEN $2 AND $3`,
    [req.user.id, from, to]);
  const s = rows[0];
  res.json({
    year,
    periodStart: from,
    periodEnd: to,
    entryCount: Number(s.entry_count),
    totalHours: Number(s.total_hours),
    interactiveHours: Number(s.interactive_hours),
    note: 'This tracker is informational only. Responsibility for meeting the Occupational Therapy Board of Australia CPD registration standard remains with the practitioner.',
  });
}));

// ═══ 15. Analytics (owner + admin) ═══════════════════════════════════════════

router.get('/api/rh2/admin/analytics', safe(async (req, res) => {
  if (!canAuthor(req.user)) return res.status(403).json({ error: 'Owner or admin only' });
  const orgId = orgOf(req);

  const [mostViewed, mostSaved, mostCompleted, searchMisses, ackCompletion, pathCompletion, staleResources, feedback] =
    await Promise.all([
      pool.query(
        `SELECT r.id, r.title, COUNT(v.id) AS views FROM resources r
           JOIN resource_views v ON v.resource_id = r.id
          WHERE r.organisation_id IS NOT DISTINCT FROM $1
            AND ${PRIVACY_PREDICATE}
          GROUP BY r.id ORDER BY COUNT(v.id) DESC LIMIT 10`, [orgId]),
      pool.query(
        `SELECT r.id, r.title, COUNT(f.user_id) AS saves FROM resources r
           JOIN resource_favourites f ON f.resource_id = r.id
          WHERE r.organisation_id IS NOT DISTINCT FROM $1
            AND ${PRIVACY_PREDICATE}
          GROUP BY r.id ORDER BY COUNT(f.user_id) DESC LIMIT 10`, [orgId]),
      pool.query(
        `SELECT r.id, r.title, COUNT(p.user_id) AS completions FROM resources r
           JOIN user_learning_progress p ON p.resource_id = r.id
          WHERE r.organisation_id IS NOT DISTINCT FROM $1
            AND ${PRIVACY_PREDICATE}
          GROUP BY r.id ORDER BY COUNT(p.user_id) DESC LIMIT 10`, [orgId]),
      pool.query(
        `SELECT term, miss_count, last_searched_at FROM search_misses
          WHERE organisation_id IS NOT DISTINCT FROM $1 ORDER BY miss_count DESC, last_searched_at DESC LIMIT 20`,
        [orgId]),
      pool.query(
        `SELECT r.id, r.title, r.version,
                (SELECT COUNT(DISTINCT a.user_id) FROM policy_acknowledgements a
                  WHERE a.resource_id = r.id
                    AND a.version >= ${ackRelevantVersionSql('r')}) AS acknowledged_users,
                (SELECT COUNT(*) FROM users u
                  WHERE u.organisation_id IS NOT DISTINCT FROM $1 AND u.is_active = TRUE) AS active_users
           FROM resources r
          WHERE r.organisation_id IS NOT DISTINCT FROM $1 AND r.status = 'approved'
            AND ${PRIVACY_PREDICATE}
            AND r.acknowledgement_required = TRUE
          ORDER BY r.title`, [orgId]),
      pool.query(
        `SELECT p.id, p.key, p.name,
                COUNT(i.id) AS total_items,
                (SELECT COUNT(*) FROM users u
                  WHERE u.organisation_id IS NOT DISTINCT FROM $1 AND u.is_active = TRUE
                    AND NOT EXISTS (
                      SELECT 1 FROM learning_path_items i2
                       WHERE i2.path_id = p.id AND NOT EXISTS (
                         SELECT 1 FROM user_learning_progress pr
                          WHERE pr.user_id = u.id AND pr.resource_id = i2.resource_id))
                    AND EXISTS (SELECT 1 FROM learning_path_items i3 WHERE i3.path_id = p.id)
                ) AS users_completed_all
           FROM learning_paths p LEFT JOIN learning_path_items i ON i.path_id = p.id
          WHERE p.organisation_id IS NOT DISTINCT FROM $1 AND p.is_active = TRUE
          GROUP BY p.id ORDER BY p.sort_order`, [orgId]),
      pool.query(
        `SELECT DISTINCT r.id, r.title, r.review_due_at,
                EXISTS (SELECT 1 FROM resource_external_sources res
                         JOIN external_sources s ON s.id = res.source_id
                        WHERE res.resource_id = r.id AND s.status = 'source_changed') AS source_changed
           FROM resources r
          WHERE r.organisation_id IS NOT DISTINCT FROM $1 AND r.status = 'approved'
            AND ${PRIVACY_PREDICATE}
            AND (r.review_due_at < CURRENT_DATE
              OR EXISTS (SELECT 1 FROM resource_external_sources res
                          JOIN external_sources s ON s.id = res.source_id
                         WHERE res.resource_id = r.id AND s.status = 'source_changed'))
          ORDER BY r.review_due_at ASC NULLS LAST LIMIT 50`, [orgId]),
      pool.query(
        `SELECT f.id, f.kind, f.comment, f.created_at, r.title AS resource_title, r.id AS resource_id
           FROM resource_feedback f JOIN resources r ON r.id = f.resource_id
          WHERE f.organisation_id IS NOT DISTINCT FROM $1 AND ${PRIVACY_PREDICATE}
          ORDER BY f.created_at DESC LIMIT 50`, [orgId]),
    ]);

  res.json({
    mostViewed: mostViewed.rows,
    mostSaved: mostSaved.rows,
    mostCompleted: mostCompleted.rows,
    searchMisses: searchMisses.rows,
    ackCompletion: ackCompletion.rows.map((r) => ({
      ...r,
      acknowledged_users: Number(r.acknowledged_users),
      active_users: Number(r.active_users),
    })),
    pathCompletion: pathCompletion.rows.map((r) => ({
      ...r, total_items: Number(r.total_items), users_completed_all: Number(r.users_completed_all),
    })),
    staleResources: staleResources.rows,
    feedback: feedback.rows,
  });
}));

// ═══ 16. Quick links (owner + admin manage; read them via /home) ═════════════

// Quick links may be external http(s) URLs or app-internal paths ('/reports');
// anything else (javascript:, data:, file: ...) is rejected server-side.
const isQuickLinkUrl = (u) => isHttpUrl(u) || isInternalPath(u);

// Admin list: every link, including inactive ones (home only serves active).
router.get('/api/rh2/quick-links', safe(async (req, res) => {
  if (!canAuthor(req.user)) return res.status(403).json({ error: 'Owner or admin only' });
  const { rows } = await pool.query(
    `SELECT id, label, url, icon, sort_order, is_active FROM resource_quick_links
      WHERE organisation_id IS NOT DISTINCT FROM $1 ORDER BY sort_order, label`, [orgOf(req)]);
  res.json({ quickLinks: rows });
}));

router.post('/api/rh2/quick-links', safe(async (req, res) => {
  if (!canAuthor(req.user)) return res.status(403).json({ error: 'Owner or admin only' });
  const label = str(req.body?.label, 100);
  const url = str(req.body?.url, 2000);
  if (!label || !url) return res.status(400).json({ error: 'label and url required' });
  if (!isQuickLinkUrl(url)) return res.status(400).json({ error: 'url must be an http(s) URL or an internal /path' });
  const { rows } = await pool.query(
    `INSERT INTO resource_quick_links (organisation_id, label, url, icon, sort_order)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [orgOf(req), label, url, str(req.body?.icon, 40),
     Number.isFinite(+req.body?.sortOrder) ? Math.round(+req.body.sortOrder) : 0]);
  await audit(req, 'rh2.quick_link_created', rows[0].id, { label });
  res.status(201).json({ quickLink: rows[0] });
}));

router.patch('/api/rh2/quick-links/:id', safe(async (req, res) => {
  if (!canAuthor(req.user)) return res.status(403).json({ error: 'Owner or admin only' });
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  const sets = [];
  const params = [];
  const set = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
  if (b.label !== undefined) { const l = str(b.label, 100); if (!l) return res.status(400).json({ error: 'label cannot be empty' }); set('label', l); }
  if (b.url !== undefined) {
    const u = str(b.url, 2000);
    if (!u) return res.status(400).json({ error: 'url cannot be empty' });
    if (!isQuickLinkUrl(u)) return res.status(400).json({ error: 'url must be an http(s) URL or an internal /path' });
    set('url', u);
  }
  if (b.icon !== undefined) set('icon', str(b.icon, 40));
  if (b.sortOrder !== undefined) set('sort_order', Number.isFinite(+b.sortOrder) ? Math.round(+b.sortOrder) : 0);
  if (b.isActive !== undefined) set('is_active', b.isActive === true);
  if (!sets.length) return res.status(400).json({ error: 'No editable fields supplied' });
  params.push(req.params.id, orgOf(req));
  const { rows } = await pool.query(
    `UPDATE resource_quick_links SET ${sets.join(', ')}
      WHERE id = $${params.length - 1} AND organisation_id IS NOT DISTINCT FROM $${params.length} RETURNING *`,
    [...params]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  await audit(req, 'rh2.quick_link_updated', req.params.id);
  res.json({ quickLink: rows[0] });
}));

router.delete('/api/rh2/quick-links/:id', safe(async (req, res) => {
  if (!canAuthor(req.user)) return res.status(403).json({ error: 'Owner or admin only' });
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const { rows } = await pool.query(
    'DELETE FROM resource_quick_links WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2 RETURNING id',
    [req.params.id, orgOf(req)]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  await audit(req, 'rh2.quick_link_deleted', req.params.id);
  res.json({ ok: true });
}));

module.exports = Object.assign(router, { computeSourceCheckUpdate, isPrivateIp, urlHopIssue });
