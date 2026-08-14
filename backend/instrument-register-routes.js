'use strict';

/**
 * CONTROLLED INSTRUMENT REGISTER + UNRESOLVED-SOURCE REVIEW QUEUE
 *
 * Two governance surfaces that share one principle: the system records what a
 * human decided, and never decides on their behalf.
 *
 * THE REGISTER holds metadata and permitted-use notes for standardised
 * instruments (WHODAS, COPM, MoCA, RUDAS, Sensory Profile, MOHOST). It holds no
 * instrument content — no forms, no items, no scoring, no manuals — and it links
 * to an implementing module (WHODAS) rather than duplicating one. Opal is never
 * recorded as the rights holder of a controlled instrument.
 *
 * THE REVIEW QUEUE lists resources whose source_class is still 'unknown'. It
 * shows the evidence already on the record — publisher strings, cited sources,
 * authority level — WITHOUT presenting any of it as a conclusion, and requires a
 * reviewer to state a reason before anything changes.
 *
 * THE RULE THAT SHAPES BOTH: classifying who wrote something grants no permission
 * to redistribute it. source_class and rights_status are accepted, validated,
 * stored and audited as INDEPENDENT decisions. Recording an authorship class
 * leaves rights exactly as it found them.
 */

const express = require('express');
const router = express.Router();
const db = require('./database');
const { pool } = require('./database');
const { requireAuth } = require('./permissions');
const governance = require('./resource-governance');
const log = require('./logger').createLogger('instrument-register');

const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));
const orgOf = (req) => req.user?.organisation_id || null;
const str = (v, n) => String(v == null ? '' : v).slice(0, n);

const safe = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  log.error('instrument register route error', { error: err, path: req.path });
  if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
});

function audit(req, action, targetId, metadata) {
  return db.logAuditEvent({
    actorUserId: req.user?.id, action, targetType: 'controlled_instrument',
    targetId, ipAddress: req.ip, organisationId: orgOf(req), metadata: metadata || null,
  }).catch(() => {});
}

router.use('/api/rh2', requireAuth);

/** Reviewers of governance metadata: owner and admin, per established policy. */
function requireReviewer(req, res) {
  const verdict = governance.canPerformTransition(req.user && req.user.role, 'rights-review');
  if (!verdict.allowed) {
    res.status(403).json({ error: verdict.reason, code: 'governance_role_denied' });
    return true;
  }
  return false;
}

/**
 * Declaring an instrument clinically current is a clinical attestation, and
 * carries the same owner-only restriction as it does for resources. An admin can
 * still manage the licence position, the edition and the review dates.
 */
function requireOwnerForClinical(req, res, clinicalStatus) {
  if (clinicalStatus !== 'current') return false;
  const verdict = governance.canSetClinicalStatus(req.user && req.user.role, 'clinically-reviewed');
  if (!verdict.allowed) {
    res.status(403).json({
      error: 'Recording an instrument as clinically current is reserved for the owner.',
      code: 'governance_role_denied',
    });
    return true;
  }
  return false;
}

const INSTRUMENT_COLUMNS = `
  id, key, name, abbreviation, edition, rights_holder, source_url,
  licensing_notes, permitted_use, access_restriction, rights_status,
  clinical_status, evidence_checked, evidence_notes, reviewer_user_id,
  reviewed_at, next_review_due, linked_module, linked_module_route, state,
  created_at, updated_at`;

/**
 * Fields whose value is a claim about someone else's property. When they have
 * not been confirmed by a person, the API says so explicitly rather than letting
 * an empty column read as "fine".
 */
function withUnresolvedFlags(row) {
  const unresolved = [];
  if (row.rights_status === 'unreviewed' || row.rights_status === 'unknown') unresolved.push('rights_status');
  if (row.clinical_status === 'unreviewed') unresolved.push('clinical_status');
  if (!row.evidence_checked) unresolved.push('evidence_checked');
  if (!row.edition) unresolved.push('edition');
  if (!row.rights_holder) unresolved.push('rights_holder');
  if (!row.permitted_use) unresolved.push('permitted_use');
  if (!row.reviewed_at) unresolved.push('reviewed_at');
  return {
    ...row,
    unresolvedFields: unresolved,
    isFullyReviewed: unresolved.length === 0,
    // Never inferred from anything: only a human decision can set this.
    mayBeUsedUnderRecordedLicence: row.rights_status === 'licensed-for-use',
  };
}

// ── Register: read ──────────────────────────────────────────────────────────

router.get('/api/rh2/instruments', safe(async (req, res) => {
  const tiers = governance.tiersForRole(req.user && req.user.role);
  if (!tiers.length) return res.json({ instruments: [] });

  const params = [orgOf(req), tiers];
  let where = `organisation_id IS NOT DISTINCT FROM $1 AND access_restriction = ANY($2::text[])`;
  if (req.query.state === 'active' || req.query.state === 'retired') {
    params.push(req.query.state);
    where += ` AND state = $${params.length}`;
  }
  const { rows } = await pool.query(
    `SELECT ${INSTRUMENT_COLUMNS} FROM controlled_instruments
      WHERE ${where} ORDER BY state, abbreviation`, params);
  res.json({ instruments: rows.map(withUnresolvedFlags) });
}));

router.get('/api/rh2/instruments/:key', safe(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ${INSTRUMENT_COLUMNS} FROM controlled_instruments
      WHERE organisation_id IS NOT DISTINCT FROM $1 AND key = $2`,
    [orgOf(req), str(req.params.key, 60)]);
  const row = rows[0];
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!governance.canReadTier(req.user && req.user.role, row.access_restriction)) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.json({ instrument: withUnresolvedFlags(row) });
}));

router.get('/api/rh2/instruments/:id/events', safe(async (req, res) => {
  if (requireReviewer(req, res)) return undefined;
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const { rows } = await pool.query(
    `SELECT e.field, e.from_value, e.to_value, e.reason, e.created_at, u.email AS actor
       FROM controlled_instrument_events e
       LEFT JOIN users u ON u.id = e.actor_user_id
      WHERE e.instrument_id = $1 AND e.organisation_id IS NOT DISTINCT FROM $2
      ORDER BY e.created_at DESC LIMIT 200`,
    [req.params.id, orgOf(req)]);
  return res.json({ events: rows });
}));

// ── Register: review ────────────────────────────────────────────────────────

const EDITABLE = {
  edition: { max: 120 },
  rights_holder: { max: 200 },
  permitted_use: { max: 4000 },
  licensing_notes: { max: 4000 },
  evidence_notes: { max: 4000 },
  rights_status: { enum: ['unreviewed', 'restricted', 'licensed-for-use', 'licence-required', 'official-link-only', 'not-permitted', 'unknown'] },
  clinical_status: { enum: ['unreviewed', 'current', 'superseded', 'withdrawn'] },
  access_restriction: { enum: ['clinician', 'admin'] },
  state: { enum: ['active', 'retired'] },
  evidence_checked: { bool: true },
  next_review_due: { date: true },
};

router.post('/api/rh2/instruments/:id/review', safe(async (req, res) => {
  if (requireReviewer(req, res)) return undefined;
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });

  const body = req.body || {};
  const reason = str(body.reason, 1000).trim();
  if (!reason) {
    return res.status(400).json({ error: 'A reason is required for every register change.' });
  }
  if (requireOwnerForClinical(req, res, body.clinical_status)) return undefined;

  // Validate every supplied field BEFORE opening a transaction.
  const changes = {};
  for (const [field, rule] of Object.entries(EDITABLE)) {
    if (body[field] === undefined) continue;
    const v = body[field];
    if (rule.enum && rule.enum.indexOf(v) === -1) {
      return res.status(400).json({ error: `Invalid value for ${field}.` });
    }
    if (rule.bool && typeof v !== 'boolean') {
      return res.status(400).json({ error: `${field} must be true or false.` });
    }
    if (rule.date && v !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) {
      return res.status(400).json({ error: `${field} must be a date (YYYY-MM-DD).` });
    }
    changes[field] = rule.max ? str(v, rule.max) : v;
  }
  if (!Object.keys(changes).length) {
    return res.status(400).json({ error: 'No changes supplied.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: before } = await client.query(
      `SELECT * FROM controlled_instruments
        WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2 FOR UPDATE`,
      [req.params.id, orgOf(req)]);
    const prev = before[0];
    if (!prev) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }

    const sets = [];
    const params = [req.params.id];
    for (const [field, value] of Object.entries(changes)) {
      params.push(value);
      sets.push(`${field} = $${params.length}`);
    }
    params.push(req.user.id);
    sets.push(`reviewer_user_id = $${params.length}`);
    sets.push('reviewed_at = CURRENT_DATE');
    sets.push('updated_at = NOW()');

    const { rows: after } = await client.query(
      `UPDATE controlled_instruments SET ${sets.join(', ')} WHERE id = $1 RETURNING ${INSTRUMENT_COLUMNS}`,
      params);

    // One audit row per field actually changed, each carrying the reason.
    for (const [field, value] of Object.entries(changes)) {
      if (String(prev[field]) === String(value)) continue;
      await client.query(
        `INSERT INTO controlled_instrument_events
           (organisation_id, instrument_id, field, from_value, to_value, reason, actor_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [orgOf(req), req.params.id, field,
         prev[field] === null ? null : String(prev[field]),
         value === null ? null : String(value), reason, req.user.id]);
    }

    await client.query('COMMIT');
    await audit(req, 'rh2.instrument_reviewed', req.params.id,
      { fields: Object.keys(changes) });
    return res.json({ ok: true, instrument: withUnresolvedFlags(after[0]) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}));

// ── Unresolved-source review queue ──────────────────────────────────────────

/**
 * Resources whose authorship has not been established. The evidence already on
 * the record travels with each row so a reviewer can judge — but it is labelled
 * as evidence, never as a suggested answer, and the API proposes nothing.
 */
router.get('/api/rh2/admin/source-review', safe(async (req, res) => {
  if (requireReviewer(req, res)) return undefined;

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const sort = ['title', 'updated_at', 'created_at'].indexOf(String(req.query.sort)) !== -1
    ? String(req.query.sort) : 'title';
  const dir = String(req.query.dir).toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  const params = [orgOf(req)];
  let where = `r.organisation_id IS NOT DISTINCT FROM $1
               AND r.source_class = 'unknown'
               AND r.access_tier <> 'excluded-private'
               AND r.publication_state <> 'excluded-private'`;

  if (req.query.q) {
    params.push(`%${str(req.query.q, 120)}%`);
    where += ` AND (r.title ILIKE $${params.length} OR r.source_publisher ILIKE $${params.length})`;
  }
  if (req.query.authority) {
    params.push(str(req.query.authority, 40));
    where += ` AND r.authority_level = $${params.length}`;
  }

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM resources r WHERE ${where}`, params);

  params.push(limit, offset);
  const { rows } = await pool.query(
    `SELECT r.id, r.title, r.slug, r.source_class, r.source_publisher, r.rights_status,
            r.authority_level, r.resource_type, r.external_url, r.source_title,
            r.provenance, r.updated_at, r.created_at
       FROM resources r WHERE ${where}
      ORDER BY r.${sort} ${dir}
      LIMIT $${params.length - 1} OFFSET $${params.length}`, params);

  res.json({
    total: countRows[0].total,
    limit,
    offset,
    // Explicitly labelled: these are inputs to a judgement, not a judgement.
    evidenceNote: 'Publisher and cited-source values are evidence only. They do not establish authorship or any right to redistribute.',
    items: rows.map((r) => ({
      id: r.id,
      title: r.title,
      slug: r.slug,
      resourceType: r.resource_type,
      currentSourceClass: r.source_class,
      currentRightsStatus: r.rights_status,
      evidence: {
        publisherString: r.source_publisher || null,
        citedSourceTitle: r.source_title || null,
        externalUrl: r.external_url || null,
        authorityLevel: r.authority_level || null,
        recordedProvenance: (r.provenance && r.provenance.classification) || null,
        recordedEvidence: (r.provenance && r.provenance.evidence) || null,
      },
      updatedAt: r.updated_at,
    })),
  });
}));

/**
 * Record a source-review decision.
 *
 * sourceClass, publisher and rightsStatus arrive as SEPARATE optional fields and
 * are written independently. Supplying a source class alone leaves rights
 * untouched — establishing who wrote something has never established a right to
 * republish it, and "the logo was removed" is not a rights status.
 */
router.post('/api/rh2/admin/source-review/:id', safe(async (req, res) => {
  if (requireReviewer(req, res)) return undefined;
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });

  const b = req.body || {};
  const reason = str(b.reason, 1000).trim();
  if (!reason) {
    return res.status(400).json({ error: 'A reason or evidence note is required for every source decision.' });
  }

  const sourceClass = b.sourceClass === undefined ? undefined : String(b.sourceClass);
  const rightsStatus = b.rightsStatus === undefined ? undefined : String(b.rightsStatus);
  const publisher = b.publisher === undefined ? undefined : str(b.publisher, 200);
  const confidence = ['low', 'medium', 'high'].indexOf(String(b.confidence)) !== -1
    ? String(b.confidence) : 'medium';

  if (sourceClass !== undefined && governance.SOURCE_CLASSES.indexOf(sourceClass) === -1) {
    return res.status(400).json({ error: 'Invalid source class.' });
  }
  if (rightsStatus !== undefined && governance.RIGHTS_STATUSES.indexOf(rightsStatus) === -1) {
    return res.status(400).json({ error: 'Invalid rights status.' });
  }
  if (sourceClass === undefined && rightsStatus === undefined && publisher === undefined) {
    return res.status(400).json({ error: 'No decision supplied.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: before } = await client.query(
      `SELECT * FROM resources
        WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2 FOR UPDATE`,
      [req.params.id, orgOf(req)]);
    const prev = before[0];
    if (!prev) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }
    if (prev.access_tier === 'excluded-private') {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }

    const sets = ['updated_at = NOW()'];
    const params = [req.params.id];
    const events = [];

    if (sourceClass !== undefined && sourceClass !== prev.source_class) {
      params.push(sourceClass); sets.push(`source_class = $${params.length}`);
      events.push(['source_class', prev.source_class, sourceClass]);
    }
    if (publisher !== undefined && publisher !== prev.source_publisher) {
      params.push(publisher || null); sets.push(`source_publisher = $${params.length}`);
      events.push(['source_publisher', prev.source_publisher, publisher]);
    }
    // Independent. Absent here means untouched — never derived from sourceClass.
    if (rightsStatus !== undefined && rightsStatus !== prev.rights_status) {
      params.push(rightsStatus); sets.push(`rights_status = $${params.length}`);
      events.push(['rights_status', prev.rights_status, rightsStatus]);
    }

    const provenance = {
      classification: {
        sourceClass: sourceClass === undefined ? undefined : {
          value: sourceClass,
          method: 'human-source-review',
          confidence,
          at: new Date().toISOString(),
          by: req.user.id,
          note: reason,
        },
        rightsStatus: rightsStatus === undefined ? undefined : {
          value: rightsStatus,
          method: 'human-rights-review',
          confidence,
          at: new Date().toISOString(),
          by: req.user.id,
          note: reason,
        },
      },
    };
    params.push(JSON.stringify(provenance));
    sets.push(`provenance = COALESCE(provenance,'{}'::jsonb) || $${params.length}::jsonb`);

    const { rows: after } = await client.query(
      `UPDATE resources SET ${sets.join(', ')} WHERE id = $1
       RETURNING id, source_class, source_publisher, rights_status`, params);

    for (const [field, from, to] of events) {
      await client.query(
        `INSERT INTO resource_governance_events
           (organisation_id, resource_id, field, from_value, to_value, reason, actor_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [orgOf(req), req.params.id, field, from, to, reason, req.user.id]);
    }

    await client.query('COMMIT');
    await audit(req, 'rh2.source_reviewed', req.params.id,
      { fields: events.map((e) => e[0]), confidence });

    return res.json({
      ok: true,
      resource: after[0],
      // Stated back to the caller so a UI cannot imply otherwise.
      rightsUnchanged: rightsStatus === undefined,
      note: rightsStatus === undefined
        ? 'Source class recorded. Rights status is unchanged — classification grants no redistribution right.'
        : 'Source class and rights status recorded as separate decisions.',
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}));

module.exports = router;
module.exports.withUnresolvedFlags = withUnresolvedFlags;
module.exports.EDITABLE = EDITABLE;
