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

// Visibility rule: non-authors may only see approved resources.
const visibleTo = (user, resource) => !!resource && (canAuthor(user) || resource.status === 'approved');

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

  const [collections, continueLearning, requiredForYou, whatsNew, popular, recentlyAdded, upcomingPd, quickLinks] =
    await Promise.all([
      pool.query(
        `SELECT c.id, c.key, c.name, c.tagline, c.icon, c.sort_order,
                (SELECT COUNT(*) FROM resource_collection_items i
                   JOIN resources r ON r.id = i.resource_id AND r.status = 'approved'
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
           LEFT JOIN user_learning_progress prog
                  ON prog.resource_id = r.id AND prog.user_id = $2
          WHERE p.organisation_id IS NOT DISTINCT FROM $1 AND p.is_active = TRUE
          GROUP BY p.id ORDER BY p.sort_order, p.name`, [orgId, userId]),
      pool.query(
        `SELECT r.id, r.slug, r.title, r.content_type, r.estimated_minutes,
                r.mandatory, r.acknowledgement_required, r.version
           FROM resources r
          WHERE r.organisation_id IS NOT DISTINCT FROM $1 AND r.status = 'approved'
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
        `SELECT id, slug, title, content_type, authority_level, updated_at
           FROM resources WHERE organisation_id IS NOT DISTINCT FROM $1 AND status = 'approved'
          ORDER BY approved_at DESC NULLS LAST, updated_at DESC LIMIT 10`, [orgId]),
      pool.query(
        `SELECT r.id, r.slug, r.title, r.content_type, COUNT(v.id) AS view_count
           FROM resources r
           JOIN resource_views v ON v.resource_id = r.id AND v.viewed_at > NOW() - INTERVAL '30 days'
          WHERE r.organisation_id IS NOT DISTINCT FROM $1 AND r.status = 'approved'
          GROUP BY r.id ORDER BY COUNT(v.id) DESC, r.title LIMIT 10`, [orgId]),
      pool.query(
        `SELECT id, slug, title, content_type, created_at
           FROM resources WHERE organisation_id IS NOT DISTINCT FROM $1 AND status = 'approved'
          ORDER BY created_at DESC LIMIT 10`, [orgId]),
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
    whatsNew: whatsNew.rows,
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

  if (canAuthor(req.user)) {
    const status = str(req.query.status, 30);
    if (status) { params.push(status); where += ` AND r.status = $${params.length}`; }
  } else {
    where += ` AND r.status = 'approved'`;
  }

  const q = str(req.query.q, 200);
  if (q) {
    params.push('%' + q + '%');
    const p = `$${params.length}`;
    where += ` AND (r.title ILIKE ${p} OR r.description ILIKE ${p} OR r.content ILIKE ${p}
      OR EXISTS (SELECT 1 FROM resource_tag_links tl JOIN resource_tags t ON t.id = tl.tag_id
                  WHERE tl.resource_id = r.id AND (t.name ILIKE ${p}
                    OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(t.aliases) al WHERE al ILIKE ${p}))))`;
  }
  if (req.query.contentType) { params.push(str(req.query.contentType, 40)); where += ` AND r.content_type = $${params.length}`; }
  if (req.query.collectionKey) {
    params.push(str(req.query.collectionKey, 60));
    where += ` AND EXISTS (SELECT 1 FROM resource_collection_items ci
                 JOIN resource_collections c ON c.id = ci.collection_id
                WHERE ci.resource_id = r.id AND c.key = $${params.length}
                  AND c.organisation_id IS NOT DISTINCT FROM $1)`;
  }
  if (req.query.tagId && isUuid(req.query.tagId)) {
    params.push(req.query.tagId);
    where += ` AND EXISTS (SELECT 1 FROM resource_tag_links l WHERE l.resource_id = r.id AND l.tag_id = $${params.length})`;
  }
  if (req.query.authority && AUTHORITY_LEVELS.includes(req.query.authority)) {
    params.push(req.query.authority); where += ` AND r.authority_level = $${params.length}`;
  }
  if (req.query.population) {
    params.push(str(req.query.population, 100));
    where += ` AND r.clinical_population @> jsonb_build_array($${params.length}::text)`;
  }
  if (req.query.setting) {
    params.push(str(req.query.setting, 100));
    where += ` AND r.clinical_setting @> jsonb_build_array($${params.length}::text)`;
  }
  if (req.query.mandatory === '1' || req.query.mandatory === 'true') where += ` AND r.mandatory = TRUE`;
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
  const orderBy = sorts[req.query.sort] || sorts.relevant;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);

  const { rows } = await pool.query(
    `SELECT r.id, r.slug, r.title, r.description, r.status, r.content_type, r.authority_level,
            r.mandatory, r.acknowledgement_required, r.cpd_eligible, r.cpd_hours,
            r.estimated_minutes, r.icon, r.version, r.external_url, r.source_publisher,
            r.updated_at, r.created_at,
            COALESCE(json_agg(json_build_object('id', t.id, 'category', t.category, 'name', t.name))
                     FILTER (WHERE t.id IS NOT NULL), '[]') AS tags,
            EXISTS (SELECT 1 FROM resource_favourites f WHERE f.resource_id = r.id AND f.user_id = $${params.length + 1}) AS favourited,
            (SELECT COUNT(*) FROM resource_views v
              WHERE v.resource_id = r.id AND v.viewed_at > NOW() - INTERVAL '30 days') AS view_count
       FROM resources r
       LEFT JOIN resource_tag_links tl ON tl.resource_id = r.id
       LEFT JOIN resource_tags t ON t.id = tl.tag_id
      WHERE ${where}
      GROUP BY r.id ORDER BY ${orderBy} LIMIT ${limit}`,
    [...params, req.user.id]);

  if (!rows.length && q) await recordSearchMiss(orgId, q);
  res.json({ resources: rows });
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
    resource,
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
  const orgId = orgOf(req);
  const slug = await uniqueSlug(orgId, slugify(b.slug || title));

  const { rows } = await pool.query(
    `INSERT INTO resources (organisation_id, title, description, slug, content, content_type,
        resource_type, status, external_url, estimated_minutes, learning_minutes, mandatory,
        acknowledgement_required, cpd_eligible, cpd_hours, authority_level, icon, target_roles,
        clinical_population, clinical_setting, source_publisher, source_title,
        source_effective_date, content_owner, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
     RETURNING *`,
    [orgId, title, str(b.description, 5000), slug, typeof b.content === 'string' ? b.content.slice(0, 200000) : null,
     str(b.contentType, 40), str(b.resourceType, 50), externalUrl,
     Number.isFinite(+b.estimatedMinutes) ? Math.round(+b.estimatedMinutes) : null,
     Number.isFinite(+b.learningMinutes) ? Math.round(+b.learningMinutes) : null,
     b.mandatory === true, b.acknowledgementRequired === true, b.cpdEligible === true,
     Number.isFinite(+b.cpdHours) ? +b.cpdHours : null, authority, str(b.icon, 40),
     JSON.stringify(strArr(b.targetRoles, 10, 30)), JSON.stringify(strArr(b.clinicalPopulation, 20, 100)),
     JSON.stringify(strArr(b.clinicalSetting, 20, 100)), str(b.sourcePublisher, 200), str(b.sourceTitle, 300),
     b.sourceEffectiveDate || null, isUuid(b.contentOwner) ? b.contentOwner : req.user.id, req.user.id]);

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
  if (b.clinicalPopulation !== undefined) set('clinical_population', JSON.stringify(strArr(b.clinicalPopulation, 20, 100)));
  if (b.clinicalSetting !== undefined) set('clinical_setting', JSON.stringify(strArr(b.clinicalSetting, 20, 100)));
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

router.post('/api/rh2/resources/:id/approve', safe(async (req, res) => {
  if (!isOwner(req.user)) return res.status(403).json({ error: 'Only the owner can approve resources' });
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const { rows } = await pool.query(
    `UPDATE resources SET status = 'approved', approved_by = $3, approved_at = NOW(),
            last_reviewed_at = CURRENT_DATE,
            review_due_at = (CURRENT_DATE + INTERVAL '12 months')::date, updated_at = NOW()
      WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2 RETURNING *`,
    [req.params.id, orgOf(req), req.user.id]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  const r = rows[0];
  await pool.query(
    `INSERT INTO resource_versions (resource_id, version, title, content, change_note, change_kind, created_by)
     SELECT $1, $2, $3, $4, 'Initial approved version', 'initial', $5
      WHERE NOT EXISTS (SELECT 1 FROM resource_versions WHERE resource_id = $1)`,
    [r.id, r.version, r.title, r.content, req.user.id]);
  await audit(req, 'rh2.resource_approved', r.id, { version: r.version });
  res.json({ ok: true, resource: r });
}));

router.post('/api/rh2/resources/:id/archive', safe(async (req, res) => {
  if (!isOwner(req.user)) return res.status(403).json({ error: 'Only the owner can archive resources' });
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const { rows } = await pool.query(
    `UPDATE resources SET status = 'archived', archived_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2 RETURNING id`,
    [req.params.id, orgOf(req)]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  await audit(req, 'rh2.resource_archived', req.params.id);
  res.json({ ok: true });
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
          GROUP BY r.id ORDER BY COUNT(v.id) DESC LIMIT 10`, [orgId]),
      pool.query(
        `SELECT r.id, r.title, COUNT(f.user_id) AS saves FROM resources r
           JOIN resource_favourites f ON f.resource_id = r.id
          WHERE r.organisation_id IS NOT DISTINCT FROM $1
          GROUP BY r.id ORDER BY COUNT(f.user_id) DESC LIMIT 10`, [orgId]),
      pool.query(
        `SELECT r.id, r.title, COUNT(p.user_id) AS completions FROM resources r
           JOIN user_learning_progress p ON p.resource_id = r.id
          WHERE r.organisation_id IS NOT DISTINCT FROM $1
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
            AND (r.review_due_at < CURRENT_DATE
              OR EXISTS (SELECT 1 FROM resource_external_sources res
                          JOIN external_sources s ON s.id = res.source_id
                         WHERE res.resource_id = r.id AND s.status = 'source_changed'))
          ORDER BY r.review_due_at ASC NULLS LAST LIMIT 50`, [orgId]),
      pool.query(
        `SELECT f.id, f.kind, f.comment, f.created_at, r.title AS resource_title, r.id AS resource_id
           FROM resource_feedback f JOIN resources r ON r.id = f.resource_id
          WHERE f.organisation_id IS NOT DISTINCT FROM $1 ORDER BY f.created_at DESC LIMIT 50`, [orgId]),
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
