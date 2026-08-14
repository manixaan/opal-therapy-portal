'use strict';

/**
 * Admin API for the resource ingestion register.
 *
 * Mounted under /api/rh2/admin/ingestion/*, owner and admin only. Nothing here
 * is reachable from the ordinary Resource Hub: the register is a different
 * table, served by different routes, behind a role gate. A therapist calling
 * these gets 403 before any query runs.
 *
 * PRIVATE RECORDS APPEAR HERE, AND THAT IS THE POINT
 * All 94 privacy-excluded records are listed, because the brief requires every
 * catalogue record to have a visible outcome rather than vanishing. They are
 * safe to list because they carry nothing identifying — migration 030's CHECK
 * constraint guarantees their filename, path, title and checksum are NULL. What
 * an administrator sees is "res-0123, privacy-excluded, permanently excluded",
 * which is an accounting fact, not a disclosure.
 */

const express = require('express');
const router = express.Router();
const { pool } = require('./database');
const { requireAuth } = require('./permissions');
const ing = require('./resource-ingestion');
const log = require('./logger').createLogger('resource-ingestion');

const EXPECTED_TOTAL = 650;

const safe = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const orgOf = (req) => req.user?.organisation_id || null;
const canAdmin = (u) => u?.role === 'owner' || u?.role === 'admin';

function requireAdmin(req, res) {
  if (!canAdmin(req.user)) {
    // Generic: the response must not confirm that an ingestion register exists.
    res.status(403).json({ error: 'Owner or admin only' });
    return true;
  }
  return false;
}

const INGESTION_STATUSES = ['registered', 'needs-link-verification', 'needs-human-review',
  'imported', 'excluded', 'archived', 'blocked', 'held'];
const QUALITY_STATUSES = ['not-assessed', 'not-applicable', 'passed', 'failed', 'pending-human'];

/**
 * Shape a register row for the interface.
 *
 * A privacy-excluded row has no title to show, so it gets a label built from
 * its catalogue id. That label is generated here rather than stored, so there
 * is no column anywhere that could accidentally be filled with the real one.
 */
function present(row) {
  const isPrivate = row.treatment === 'privacy-excluded';
  return {
    catalogueId: row.catalogue_id,
    title: isPrivate ? `Private record ${row.catalogue_id} — excluded` : row.proposed_title,
    treatment: row.treatment,
    ingestionStatus: row.ingestion_status,
    qualityStatus: row.quality_status,
    topic: row.topic,
    resourceType: row.resource_type,
    sourceClass: row.source_class,
    sourceOrganisation: isPrivate ? null : row.source_organisation,
    rightsStatus: isPrivate ? 'not-assessed-because-private' : row.rights_status,
    privacyStatus: row.privacy_status,
    duplicateOf: row.duplicate_of_catalogue_id,
    matchMethod: row.match_method,
    matchConfidence: row.match_confidence,
    officialUrl: row.official_url,
    linkedResourceId: row.linked_resource_id,
    linkedInstrumentId: row.linked_instrument_id,
    opalReplacementResourceId: row.opal_replacement_resource_id,
    reviewedAt: row.reviewed_at,
    reviewerUserId: row.reviewer_user_id,
    nextAction: row.next_action,
    // Deliberately absent for private rows — and NULL in the database anyway.
    sourceReference: isPrivate ? null : row.source_reference,
    sourceFilename: isPrivate ? null : row.source_filename,
    hasChecksum: !!row.checksum_sha256,
  };
}

// ── Summary: the number that must always be 650 ─────────────────────────────

router.get('/api/rh2/admin/ingestion/summary', requireAuth, safe(async (req, res) => {
  if (requireAdmin(req, res)) return;
  const orgId = orgOf(req);

  const [byTreatment, byStatus, byQuality, totals, instruments, cleanroom] = await Promise.all([
    pool.query(`SELECT treatment, COUNT(*)::int AS n FROM resource_ingestion_register
                 WHERE organisation_id = $1 GROUP BY treatment ORDER BY n DESC`, [orgId]),
    pool.query(`SELECT ingestion_status, COUNT(*)::int AS n FROM resource_ingestion_register
                 WHERE organisation_id = $1 GROUP BY ingestion_status ORDER BY n DESC`, [orgId]),
    pool.query(`SELECT quality_status, COUNT(*)::int AS n FROM resource_ingestion_register
                 WHERE organisation_id = $1 GROUP BY quality_status ORDER BY n DESC`, [orgId]),
    pool.query(`SELECT COUNT(*)::int AS total,
                       COUNT(*) FILTER (WHERE linked_resource_id IS NOT NULL)::int AS linked,
                       COUNT(*) FILTER (WHERE reviewer_user_id IS NOT NULL)::int AS reviewed,
                       COUNT(*) FILTER (WHERE official_url IS NOT NULL)::int AS with_url
                  FROM resource_ingestion_register WHERE organisation_id = $1`, [orgId]),
    pool.query(`SELECT COUNT(DISTINCT linked_instrument_id)::int AS instruments,
                       COUNT(*) FILTER (WHERE linked_instrument_id IS NOT NULL)::int AS records
                  FROM resource_ingestion_register WHERE organisation_id = $1`, [orgId]),
    pool.query(`SELECT risk_tier, COUNT(*)::int AS n,
                       COUNT(*) FILTER (WHERE resource_id IS NOT NULL)::int AS drafted
                  FROM resource_cleanroom_provenance WHERE organisation_id = $1
                 GROUP BY risk_tier`, [orgId]),
  ]);

  const total = totals.rows[0].total;
  res.json({
    total,
    expectedTotal: EXPECTED_TOTAL,
    // The interface shows this. A false here means the register no longer
    // accounts for the catalogue and must not be reported as complete.
    reconciles: total === EXPECTED_TOTAL,
    byTreatment: Object.fromEntries(byTreatment.rows.map((r) => [r.treatment, r.n])),
    byIngestionStatus: Object.fromEntries(byStatus.rows.map((r) => [r.ingestion_status, r.n])),
    byQualityStatus: Object.fromEntries(byQuality.rows.map((r) => [r.quality_status, r.n])),
    linkedToResources: totals.rows[0].linked,
    humanReviewed: totals.rows[0].reviewed,
    withVerifiedUrl: totals.rows[0].with_url,
    instrumentsMapped: instruments.rows[0].instruments,
    instrumentRecordsMapped: instruments.rows[0].records,
    cleanroom: Object.fromEntries(cleanroom.rows.map((r) => [r.risk_tier, { total: r.n, drafted: r.drafted }])),
    treatmentVocabulary: ing.TREATMENTS,
  });
}));

// ── Records ─────────────────────────────────────────────────────────────────

router.get('/api/rh2/admin/ingestion/records', requireAuth, safe(async (req, res) => {
  if (requireAdmin(req, res)) return;
  const orgId = orgOf(req);
  const params = [orgId];
  let where = 'organisation_id = $1';

  const { treatment, status, quality } = req.query;
  // An unrecognised filter is a client error, not a silently ignored one — the
  // same rule the resource list follows, for the same reason.
  if (treatment) {
    if (!ing.TREATMENTS.includes(String(treatment))) {
      return res.status(400).json({ error: 'Unknown treatment filter.', code: 'invalid_filter_value', parameter: 'treatment' });
    }
    params.push(treatment); where += ` AND treatment = $${params.length}`;
  }
  if (status) {
    if (!INGESTION_STATUSES.includes(String(status))) {
      return res.status(400).json({ error: 'Unknown status filter.', code: 'invalid_filter_value', parameter: 'status' });
    }
    params.push(status); where += ` AND ingestion_status = $${params.length}`;
  }
  if (quality) {
    if (!QUALITY_STATUSES.includes(String(quality))) {
      return res.status(400).json({ error: 'Unknown quality filter.', code: 'invalid_filter_value', parameter: 'quality' });
    }
    params.push(quality); where += ` AND quality_status = $${params.length}`;
  }

  const q = String(req.query.q || '').trim().slice(0, 120);
  if (q) {
    params.push(`%${q}%`);
    // Search never reaches a private row: its searchable columns are NULL, and
    // the catalogue-id branch is exact-match only so it cannot be swept up by a
    // wildcard.
    where += ` AND (proposed_title ILIKE $${params.length} OR source_organisation ILIKE $${params.length}
                    OR catalogue_id = $${params.length + 1})`;
    params.push(q);
  }

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  params.push(limit, offset);

  const { rows } = await pool.query(
    `SELECT * FROM resource_ingestion_register WHERE ${where}
      ORDER BY catalogue_id LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  const { rows: [count] } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM resource_ingestion_register WHERE ${where}`, params.slice(0, -2));

  res.json({ total: count.n, limit, offset, records: rows.map(present) });
}));

router.get('/api/rh2/admin/ingestion/records/:catalogueId', requireAuth, safe(async (req, res) => {
  if (requireAdmin(req, res)) return;
  const orgId = orgOf(req);
  const { rows } = await pool.query(
    'SELECT * FROM resource_ingestion_register WHERE organisation_id = $1 AND catalogue_id = $2',
    [orgId, String(req.params.catalogueId).slice(0, 20)]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });

  const events = await pool.query(
    `SELECT e.field, e.from_value, e.to_value, e.reason, e.created_at, u.email AS actor
       FROM resource_ingestion_events e
       LEFT JOIN users u ON u.id = e.actor_user_id
      WHERE e.register_id = $1 ORDER BY e.created_at DESC`, [rows[0].id]);

  const cleanroom = await pool.query(
    `SELECT clinical_purpose, inspiration_class, risk_tier, clinical_gate, rights_gate,
            brand_gate, accessibility_gate, legal_gate, blocker_note, resource_id
       FROM resource_cleanroom_provenance WHERE organisation_id = $1 AND catalogue_id = $2`,
    [orgId, rows[0].catalogue_id]);

  res.json({
    ...present(rows[0]),
    checksumSha256: rows[0].treatment === 'privacy-excluded' ? null : rows[0].checksum_sha256,
    sizeBytes: rows[0].size_bytes,
    pageOrSlideCount: rows[0].page_or_slide_count,
    notes: rows[0].notes,
    cleanRoom: cleanroom.rows[0] || null,
    auditHistory: events.rows,
  });
}));

/** Record a human decision. The importer never writes these fields. */
router.patch('/api/rh2/admin/ingestion/records/:catalogueId', requireAuth, safe(async (req, res) => {
  if (requireAdmin(req, res)) return;
  const orgId = orgOf(req);
  const catalogueId = String(req.params.catalogueId).slice(0, 20);

  const { rows } = await pool.query(
    'SELECT * FROM resource_ingestion_register WHERE organisation_id = $1 AND catalogue_id = $2',
    [orgId, catalogueId]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  const before = rows[0];

  // A privacy-excluded record is not a workflow item. Nothing about it is
  // negotiable through this endpoint, and the exclusion is permanent.
  if (before.treatment === 'privacy-excluded') {
    return res.status(403).json({
      error: 'Privacy-excluded records cannot be re-treated.', code: 'privacy_excluded_is_permanent' });
  }

  const patch = {};
  const events = [];
  const { treatment, ingestionStatus, qualityStatus, officialUrl, nextAction, reason } = req.body || {};

  if (treatment !== undefined) {
    if (!ing.TREATMENTS.includes(treatment)) {
      return res.status(400).json({ error: 'Unknown treatment.', code: 'invalid_value', parameter: 'treatment' });
    }
    if (treatment === 'privacy-excluded') {
      return res.status(400).json({
        error: 'Privacy exclusion is set by classification, not by hand.', code: 'invalid_value' });
    }
    patch.treatment = treatment;
    events.push(['treatment', before.treatment, treatment]);
  }
  if (ingestionStatus !== undefined) {
    if (!INGESTION_STATUSES.includes(ingestionStatus)) {
      return res.status(400).json({ error: 'Unknown status.', code: 'invalid_value', parameter: 'ingestionStatus' });
    }
    patch.ingestion_status = ingestionStatus;
    events.push(['ingestion_status', before.ingestion_status, ingestionStatus]);
  }
  if (qualityStatus !== undefined) {
    if (!QUALITY_STATUSES.includes(qualityStatus)) {
      return res.status(400).json({ error: 'Unknown quality status.', code: 'invalid_value', parameter: 'qualityStatus' });
    }
    patch.quality_status = qualityStatus;
    events.push(['quality_status', before.quality_status, qualityStatus]);
  }
  if (officialUrl !== undefined) {
    if (officialUrl !== null && !/^https:\/\//i.test(String(officialUrl))) {
      return res.status(400).json({ error: 'Official URL must be https.', code: 'invalid_value', parameter: 'officialUrl' });
    }
    patch.official_url = officialUrl;
    events.push(['official_url', before.official_url, officialUrl]);
  }
  if (nextAction !== undefined) patch.next_action = String(nextAction).slice(0, 2000);

  if (!Object.keys(patch).length) {
    return res.status(400).json({ error: 'Nothing to update.', code: 'empty_patch' });
  }

  // Stamping the reviewer is what stops the importer overwriting the decision
  // on its next run — see the upsert in ingest-resource-catalogue.js.
  patch.reviewer_user_id = req.user.id;
  patch.reviewed_at = new Date().toISOString().slice(0, 10);

  const sets = [];
  const params = [orgId, catalogueId];
  for (const [col, val] of Object.entries(patch)) {
    params.push(val); sets.push(`${col} = $${params.length}`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const upd = await client.query(
      `UPDATE resource_ingestion_register SET ${sets.join(', ')}, updated_at = NOW()
        WHERE organisation_id = $1 AND catalogue_id = $2 RETURNING *`, params);
    for (const [field, from, to] of events) {
      await client.query(
        `INSERT INTO resource_ingestion_events
           (organisation_id, register_id, catalogue_id, field, from_value, to_value, reason, actor_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [orgId, before.id, catalogueId, field,
          from == null ? null : String(from).slice(0, 120),
          to == null ? null : String(to).slice(0, 120),
          reason ? String(reason).slice(0, 2000) : null, req.user.id]);
    }
    await client.query('COMMIT');
    log.info('ingestion register updated', { catalogueId, by: req.user.id });
    res.json(present(upd.rows[0]));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}));

// ── Clean-room backlog ──────────────────────────────────────────────────────

router.get('/api/rh2/admin/ingestion/cleanroom', requireAuth, safe(async (req, res) => {
  if (requireAdmin(req, res)) return;
  const { rows } = await pool.query(
    `SELECT p.catalogue_id, p.clinical_purpose, p.inspiration_class, p.risk_tier,
            p.clinical_gate, p.rights_gate, p.brand_gate, p.accessibility_gate,
            p.legal_gate, p.blocker_note, p.resource_id,
            r.title, r.status, r.publication_state, r.content_version
       FROM resource_cleanroom_provenance p
       LEFT JOIN resources r ON r.id = p.resource_id
      WHERE p.organisation_id = $1
      ORDER BY p.risk_tier, p.catalogue_id`, [orgOf(req)]);
  res.json({
    total: rows.length,
    drafted: rows.filter((r) => r.resource_id).length,
    blocked: rows.filter((r) => !r.resource_id).length,
    items: rows,
  });
}));

// ── Instrument mapping ──────────────────────────────────────────────────────

router.get('/api/rh2/admin/ingestion/instruments', requireAuth, safe(async (req, res) => {
  if (requireAdmin(req, res)) return;
  const { rows } = await pool.query(
    `SELECT i.key, i.abbreviation, i.name, i.rights_holder, i.rights_status,
            i.access_restriction, i.state, i.linked_module,
            COUNT(g.id)::int AS catalogue_records,
            (SELECT COUNT(*)::int FROM resource_files f
               JOIN resources r2 ON r2.id = f.resource_id
              WHERE r2.instrument_key = i.key) AS hosted_files
       FROM controlled_instruments i
       LEFT JOIN resource_ingestion_register g ON g.linked_instrument_id = i.id
      WHERE i.organisation_id = $1
      GROUP BY i.id ORDER BY i.abbreviation`, [orgOf(req)]);
  res.json({
    total: rows.length,
    mappedRecords: rows.reduce((n, r) => n + r.catalogue_records, 0),
    // Must always be zero: no proprietary instrument document is ever hosted.
    hostedProprietaryFiles: rows.reduce((n, r) => n + r.hosted_files, 0),
    instruments: rows,
  });
}));

module.exports = router;
