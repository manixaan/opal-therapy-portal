'use strict';

/**
 * ASSESSMENTS — CATALOGUE, CLIENT HISTORY AND SHARE PREPARATION
 *
 * The framework layer above the per-instrument modules. It answers three
 * questions that are the same for every standardised assessment, so that a
 * second implemented instrument needs no new route file:
 *
 *   what assessments exist, and what can be done with each   /catalogue
 *   what has been recorded for this client, across them all  /clients/:id/records
 *   what would this disclosure say                           /share
 *
 * Administration itself stays in the instrument's own module — WHODAS's items,
 * scoring, drafts and documents are /api/whodas/*, and this file never
 * duplicates them. It links.
 *
 * ── Not feature-gated ──────────────────────────────────────────────────────
 * Unlike /api/whodas/*, the catalogue answers even when an instrument's module
 * is switched off, because "WHODAS is off in this environment" is precisely
 * what a clinician needs to be told. What it never does is expose an
 * instrument's content: the catalogue carries identity, structure counts and
 * availability, never items and never scoring rules.
 *
 * ── Roles ──────────────────────────────────────────────────────────────────
 *   therapist, owner  full access; may start assessments and prepare shares
 *   read_only         may read the catalogue and completed records
 *   admin             catalogue only. Admin is a non-clinical scheduling role
 *                     (permissions.js), so it sees no client's records.
 *
 * ── Organisation isolation ─────────────────────────────────────────────────
 * Every client-scoped query filters organisation_id, and a record in another
 * organisation is a 404, matching whodas-routes.js and fca-routes.js.
 */

const express = require('express');

const router = express.Router();
const db = require('./database');
const { pool } = require('./database');
const { requireAuth } = require('./permissions');
const { isWhodasAssessmentEnabled } = require('./feature-flags');
const log = require('./logger').createLogger('assessments');

const { allDefinitions, definitionByKey } = require('./assessments/definitions');
const { availabilityFor, whodasRuntime } = require('./assessments/availability');
const { prepareShare } = require('./assessments/share');

const safe = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  // Message only — request bodies and rows carry clinical content.
  log.error('assessments route error', { error: err.message, path: req.path });
  if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
});

const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));
const orgOf = (req) => req.user?.organisation_id || null;
const str = (v, max) => (v === null || v === undefined ? null : String(v).trim().slice(0, max) || null);

const CLINICAL_ROLES = new Set(['therapist', 'owner']);
const CATALOGUE_ROLES = new Set(['therapist', 'owner', 'admin', 'read_only']);

router.use('/api/assessments', requireAuth);

function requireCatalogue(req, res, next) {
  if (!CATALOGUE_ROLES.has(req.user?.role)) {
    return res.status(403).json({ error: 'forbidden', message: 'You cannot view the assessment catalogue.' });
  }
  next();
}

function requireClinicalRead(req, res, next) {
  const role = req.user?.role;
  if (!CLINICAL_ROLES.has(role) && role !== 'read_only') {
    return res.status(403).json({
      error: 'forbidden',
      message: 'Assessment records are limited to treating therapists.',
    });
  }
  if (!orgOf(req)) {
    return res.status(403).json({ error: 'no_organisation', message: 'Your account is not linked to an organisation.' });
  }
  next();
}

function requireClinicalWrite(req, res, next) {
  if (!CLINICAL_ROLES.has(req.user?.role)) {
    return res.status(403).json({
      error: 'forbidden',
      message: 'Only treating therapists can prepare an assessment for sharing.',
    });
  }
  if (!orgOf(req)) {
    return res.status(403).json({ error: 'no_organisation', message: 'Your account is not linked to an organisation.' });
  }
  next();
}

async function audit(req, action, targetId, metadata) {
  // ids and counts only — never a name, a response or a score.
  await db.logAuditEvent({
    action,
    targetType: 'assessment',
    targetId,
    actorUserId: req.user?.id,
    organisationId: orgOf(req),
    ipAddress: req.ip,
    metadata: metadata || {},
  }).catch(() => {});
}

// ── Runtime facts about the implementing modules ────────────────────────────

/**
 * Whether each module can serve an assessment right now. The WHODAS check is a
 * manifest read plus the hash the registry already computed at load, not a
 * re-hash of four PDFs per request.
 */
function moduleRuntime() {
  const modules = {};
  modules.whodas = whodasRuntime({
    enabled: isWhodasAssessmentEnabled(),
    verify: () => {
      const registry = require('./whodas/template-registry');
      const templates = registry.instrumentTemplates();
      if (!templates.length) throw new Error('no WHODAS template is registered');
    },
  });
  return modules;
}

/**
 * Whether THIS request could actually administer an assessment. Distinct from
 * whether the instrument can be administered at all, which is what
 * availabilityFor answers.
 */
function canAdminister(req) {
  return CLINICAL_ROLES.has(req.user?.role) && Boolean(orgOf(req));
}

/** Definition + availability, ready to serialise. */
function describe(def, runtime, actor) {
  const availability = availabilityFor(def, runtime);

  // The actor overlay. availability.js is deliberately pure — two facts, both
  // about the deployment — and that purity is what makes the badge checkable,
  // so the actor is applied HERE rather than smuggled into it. Without this a
  // catalogue-only role, or a therapist whose account is not linked to an
  // organisation, was told canStart:true and shown a primary "Start
  // assessment" button that 403s on the first request behind it.
  if (actor && !actor.canAdminister && (availability.canStart || availability.canDownloadBlank)) {
    availability.canStart = false;
    availability.canDownloadBlank = false;
    availability.actorReason = actor.reason;
  }

  return Object.assign({}, def, {
    availability,
    // The address of this assessment's information page, so the client never
    // builds routes out of string concatenation it invented.
    infoRoute: `#resources/instruments/${encodeURIComponent(def.key)}`,
  });
}

/** Why this request cannot administer, phrased for the person reading it. */
function actorFor(req) {
  if (canAdminister(req)) return { canAdminister: true, reason: null };
  if (!CLINICAL_ROLES.has(req.user?.role)) {
    return {
      canAdminister: false,
      reason: 'Your role can read the assessment catalogue but cannot administer an assessment.',
    };
  }
  return {
    canAdminister: false,
    reason: 'Your account is not linked to an organisation, so an assessment cannot be filed against a client.',
  };
}

/**
 * Governance metadata for the same instruments, keyed by register key. Read
 * separately from the definitions so a missing or unseeded register degrades to
 * "no review recorded" rather than an empty catalogue.
 */
async function registerRows(req) {
  const out = {};
  try {
    const { rows } = await pool.query(
      `SELECT key, edition, rights_holder, source_url, licensing_notes, permitted_use,
              rights_status, clinical_status, evidence_checked, reviewed_at,
              next_review_due, state
         FROM controlled_instruments
        WHERE organisation_id IS NOT DISTINCT FROM $1`,
      [orgOf(req)]
    );
    rows.forEach((r) => { out[r.key] = r; });
  } catch (err) {
    // The register is supplementary. An assessment a clinician can administer
    // must not disappear because a governance table is unavailable.
    log.warn('controlled instrument register unavailable', { error: err.message });
  }
  return out;
}

/**
 * The register's own view of an instrument, carried alongside the definition
 * but never used to decide availability. See assessments/availability.js.
 */
function governanceOf(row) {
  if (!row) {
    return {
      registered: false,
      rightsStatus: null,
      clinicalStatus: null,
      evidenceChecked: false,
      reviewedAt: null,
      nextReviewDue: null,
      note: 'This instrument is not yet in the governance register.',
    };
  }
  return {
    registered: true,
    edition: row.edition || null,
    rightsHolder: row.rights_holder || null,
    sourceUrl: row.source_url || null,
    licensingNotes: row.licensing_notes || null,
    permittedUse: row.permitted_use || null,
    rightsStatus: row.rights_status,
    clinicalStatus: row.clinical_status,
    evidenceChecked: Boolean(row.evidence_checked),
    reviewedAt: row.reviewed_at || null,
    nextReviewDue: row.next_review_due || null,
    state: row.state,
    note: null,
  };
}

// ── Catalogue ───────────────────────────────────────────────────────────────

router.get('/api/assessments/catalogue', requireCatalogue, safe(async (req, res) => {
  const runtime = { modules: moduleRuntime() };
  const register = await registerRows(req);

  const actor = actorFor(req);
  const assessments = allDefinitions().map((def) => {
    const described = describe(def, runtime, actor);
    described.governance = governanceOf(register[def.key]);
    // The register may carry an edition the code does not.
    if (!described.edition && described.governance.edition) {
      described.edition = described.governance.edition;
    }
    if (!described.attribution.rightsHolder && described.governance.rightsHolder) {
      described.attribution.rightsHolder = described.governance.rightsHolder;
    }
    return described;
  });

  res.json({
    assessments,
    counts: assessments.reduce((acc, a) => {
      acc[a.availability.state] = (acc[a.availability.state] || 0) + 1;
      return acc;
    }, {}),
  });
}));

router.get('/api/assessments/catalogue/:key', requireCatalogue, safe(async (req, res) => {
  const def = definitionByKey(str(req.params.key, 60));
  if (!def) {
    return res.status(404).json({
      error: 'not_found',
      message: 'No assessment with that key is registered.',
    });
  }

  const runtime = { modules: moduleRuntime() };
  const register = await registerRows(req);
  const described = describe(def, runtime, actorFor(req));
  described.governance = governanceOf(register[def.key]);
  if (!described.edition && described.governance.edition) described.edition = described.governance.edition;
  if (!described.attribution.rightsHolder && described.governance.rightsHolder) {
    described.attribution.rightsHolder = described.governance.rightsHolder;
  }

  res.json({ assessment: described });
}));

// ── Client history, across every implemented instrument ─────────────────────

/**
 * Which records this user may see: everything completed in their organisation,
 * plus their own drafts. Identical to whodas-routes.js — drafts are personal
 * work in progress, filed records are the organisation's.
 */
async function whodasRecordsFor(req, clientId) {
  if (!isWhodasAssessmentEnabled()) return [];
  const { rows } = await pool.query(
    `SELECT a.id, a.client_id, a.status, a.administration_method, a.item_set,
            a.started_at, a.started_by_name, a.completed_at, a.completed_by_name,
            a.completion_source, a.default_scoring_method, a.scores,
            a.instrument_version, a.template_key, a.template_version,
            a.amends_assessment_id, a.amended_by_assessment_id,
            gd.id AS document_id
       FROM whodas_assessments a
       LEFT JOIN LATERAL (
         SELECT id FROM whodas_generated_documents
          WHERE assessment_id = a.id ORDER BY created_at DESC LIMIT 1
       ) gd ON TRUE
      WHERE a.organisation_id = $1 AND a.client_id = $2
        AND (a.status <> 'draft' OR a.started_by_user_id = $3)
        -- Same exclusion as the whodas module's own list: a deleted draft
        -- (voided, never completed) leaves history; a voided COMPLETED record
        -- keeps its completed_at and stays, because it was once filed.
        AND NOT (a.status = 'voided' AND a.completed_at IS NULL)
      ORDER BY a.started_at DESC
      LIMIT 200`,
    [orgOf(req), clientId, req.user.id]
  );

  return rows.map((row) => {
    const scores = row.scores || {};
    const preferred = scores[row.default_scoring_method] || null;
    return {
      id: row.id,
      assessmentKey: 'whodas-2.0-36',
      module: 'whodas',
      clientId: row.client_id,
      status: row.status,
      completionSource: row.completion_source,
      administrationMethod: row.administration_method,
      itemSet: row.item_set,
      instrumentVersion: row.instrument_version,
      // The exact document version this record was completed against. History
      // must stay tied to the edition that produced it.
      templateKey: row.template_key,
      templateVersion: row.template_version,
      startedAt: row.started_at,
      startedByName: row.started_by_name,
      completedAt: row.completed_at,
      completedByName: row.completed_by_name,
      overallScore: preferred && preferred.scorable ? preferred.overall.value : null,
      overallScoreLabel: preferred ? preferred.label : null,
      amendsAssessmentId: row.amends_assessment_id,
      amendedByAssessmentId: row.amended_by_assessment_id,
      hasDocument: Boolean(row.document_id),
      // Where the full record lives. One address, used by every caller.
      route: `#assessment/record/${row.id}`,
    };
  });
}

router.get('/api/assessments/clients/:clientId/records', requireClinicalRead, safe(async (req, res) => {
  const clientId = str(req.params.clientId, 120);
  if (!clientId) return res.status(400).json({ error: 'invalid_client' });

  const records = await whodasRecordsFor(req, clientId);
  res.json({
    records,
    // So the client can render a history section per instrument without
    // re-deriving which instruments are implemented.
    modules: Object.keys(moduleRuntime()),
  });
}));

// ── Share preparation ───────────────────────────────────────────────────────

const METHOD_LABELS = {
  interviewer: 'Interviewer-administered',
  self: 'Self-administered',
  proxy: 'Proxy-administered',
};

function formatDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

async function orgName(req) {
  try {
    const { rows } = await pool.query('SELECT name FROM organisations WHERE id = $1', [orgOf(req)]);
    return rows[0]?.name || null;
  } catch (err) {
    return null;
  }
}

/**
 * Prepare a disclosure about a BLANK form. No client is involved, so nothing
 * client-identifying can appear in it.
 */
router.post('/api/assessments/catalogue/:key/share', requireClinicalWrite, safe(async (req, res) => {
  const def = definitionByKey(str(req.params.key, 60));
  if (!def) {
    return res.status(404).json({
      error: 'not_found',
      message: 'No assessment with that key is registered.',
    });
  }

  const runtime = { modules: moduleRuntime() };
  const availability = availabilityFor(def, runtime);
  if (!availability.canDownloadBlank) {
    return res.status(409).json({
      error: 'no_blank_form',
      message: 'There is no blank form to share for this assessment.',
      availability,
    });
  }

  const method = str(req.body?.administrationMethod, 20);
  const chosen = def.administrationMethods.find((m) => m.method === method)
    || def.administrationMethods[0]
    || null;

  const draft = prepareShare({
    definition: def,
    kind: 'blank',
    method: chosen ? (METHOD_LABELS[chosen.method] || chosen.name) : null,
    orgName: await orgName(req),
    attachment: chosen
      ? {
        filename: `${chosen.templateKey}.pdf`,
        downloadPath: `/api/whodas/templates/${encodeURIComponent(chosen.templateKey)}/blank`,
      }
      : null,
    transportConfigured: false,
  });

  await audit(req, 'assessment_share_prepared', null, {
    assessmentKey: def.key, kind: 'blank', sent: false,
  });

  res.json({ share: draft });
}));

/**
 * Prepare a disclosure about one completed record.
 *
 * Nothing is sent. The response is a draft for the clinician to read, and the
 * audit row records that a share was PREPARED — which is the event that
 * actually happened.
 */
router.post('/api/assessments/records/:id/share', requireClinicalWrite, safe(async (req, res) => {
  const id = str(req.params.id, 60);
  const missing = {
    error: 'not_found',
    message: 'That assessment record could not be found, or is no longer available to you.',
  };
  if (!isUuid(id)) return res.status(404).json(missing);
  if (!isWhodasAssessmentEnabled()) {
    return res.status(404).json({
      error: 'not_found',
      message: 'WHODAS 2.0 is not enabled in this environment.',
    });
  }

  const { rows } = await pool.query(
    `SELECT a.*, gd.id AS document_id, gd.filename AS document_filename
       FROM whodas_assessments a
       LEFT JOIN LATERAL (
         SELECT id, filename FROM whodas_generated_documents
          WHERE assessment_id = a.id ORDER BY created_at DESC LIMIT 1
       ) gd ON TRUE
      WHERE a.id = $1 AND a.organisation_id = $2
        AND (a.status <> 'draft' OR a.started_by_user_id = $3)`,
    [id, orgOf(req), req.user.id]
  );
  const row = rows[0];
  if (!row) return res.status(404).json(missing);

  if (row.status === 'draft') {
    return res.status(409).json({
      error: 'not_completed',
      message: 'A draft assessment cannot be shared. Complete it first.',
    });
  }

  const def = definitionByKey('whodas-2.0-36');
  const draft = prepareShare({
    definition: def,
    kind: 'completed',
    clientName: row.client_name || null,
    assessorName: row.completed_by_name || row.started_by_name || null,
    completedOn: formatDate(row.completed_at),
    method: METHOD_LABELS[row.administration_method] || row.administration_method,
    orgName: await orgName(req),
    attachment: row.document_id
      ? {
        filename: row.document_filename,
        downloadPath: `/api/whodas/assessments/${encodeURIComponent(row.id)}/document`,
      }
      : null,
    transportConfigured: false,
  });

  await audit(req, 'assessment_share_prepared', row.id, {
    assessmentKey: def.key, kind: 'completed', hasDocument: Boolean(row.document_id), sent: false,
  });

  res.json({ share: draft });
}));

module.exports = router;
