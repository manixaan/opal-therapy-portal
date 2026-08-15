'use strict';

/**
 * WHODAS 2.0 (36-ITEM) DIGITAL ASSESSMENT
 *
 * A therapist opens a client, starts a WHODAS 2.0 assessment in one of the
 * three official administration modes, completes the official WHO form
 * electronically, and files a completed PDF into the clinical record.
 *
 * ── Hard rules enforced here ───────────────────────────────────────────────
 * - FEATURE GATED. Every route 404s unless ENABLE_WHODAS_ASSESSMENT === 'true'.
 *   WHODAS 2.0 is a WHO instrument and production release is gated on Opal
 *   Therapy's licensing checklist (docs/whodas/03_LICENSING_COMPLIANCE.md).
 *   404 rather than 403: a disabled feature should not advertise itself.
 * - THE SERVER SCORES. The browser never sends a score and never computes one.
 *   Scores are calculated here, from stored responses, and frozen at completion.
 * - THE DOCUMENT IS WHO'S. Blank forms are streamed straight from the immutable
 *   template, hash-checked on every read. No header, footer, logo or rescaling.
 * - COMPLETED IS FINAL. Responses freeze at completion, in the database as well
 *   as here. Correcting one means an auditable amendment, never an edit.
 * - ORGANISATION ISOLATION. Every query filters organisation_id. A row in
 *   another organisation returns 404, not 403 — matching fca-routes.js, because
 *   "you may not see this" already leaks that it exists.
 * - OWN-ONLY DRAFTS. A draft in progress is the author's; completed
 *   assessments are visible across the organisation, since they are filed
 *   clinical records.
 * - PRIVACY. No client identity and no clinical content in logs, audit
 *   payloads or client-facing errors. Audit rows carry ids, versions, counts.
 *
 * ── Roles ──────────────────────────────────────────────────────────────────
 *   therapist, owner  full clinical access to their organisation's assessments
 *   read_only         read completed assessments and blank forms; no writes
 *   admin             NO ACCESS. Admin is a non-clinical scheduling role in
 *                     this portal (permissions.js) and WHODAS is clinical.
 */

const express = require('express');
const { randomUUID } = require('crypto');

const router = express.Router();
const db = require('./database');
const { pool } = require('./database');
const { requireAuth } = require('./permissions');
const { isWhodasAssessmentEnabled } = require('./feature-flags');
const { getBackend, getBackendName } = require('./storage');
const log = require('./logger').createLogger('whodas');

const registry = require('./whodas/template-registry');
const instrument = require('./whodas/instrument');
const { score, scoreAll, ALL_METHODS, DEFAULT_METHOD, SCORING_VERSION } = require('./whodas/scoring');
const { generateCompletedPdf } = require('./whodas/completed-pdf');

// ── Helpers (mirroring fca-routes.js conventions) ────────────────────────────

const safe = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  // Message only — request bodies carry clinical content.
  log.error('whodas route error', { error: err.message, path: req.path });
  if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
});

const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));
const orgOf = (req) => req.user?.organisation_id || null;
const str = (v, max) => (v === null || v === undefined ? null : String(v).trim().slice(0, max) || null);

const CLINICAL_ROLES = new Set(['therapist', 'owner']);

async function audit(req, action, targetId, extraMeta = {}) {
  // ids, versions and counts only — never names, never responses, never scores
  // tied to a named client.
  await db.logAuditEvent({
    action,
    targetType: 'whodas_assessment',
    targetId,
    actorUserId: req.user?.id,
    organisationId: orgOf(req),
    ipAddress: req.ip,
    metadata: extraMeta,
  }).catch(() => {});
}

/**
 * The licensing gate. Mounted ahead of everything, including auth, so a
 * disabled deployment exposes no WHODAS surface at all.
 */
router.use('/api/whodas', (req, res, next) => {
  if (!isWhodasAssessmentEnabled()) {
    // 404 rather than 403 — a disabled feature should not advertise itself.
    // The message is deliberately an environment statement and never names the
    // env var: an administrator finds that in the governance surface, and a
    // clinician reading a red banner only needs to know it is off here.
    return res.status(404).json({
      error: 'not_found',
      message: 'WHODAS 2.0 is not enabled in this environment.',
    });
  }
  next();
});

router.use('/api/whodas', requireAuth);

function requireClinicalRead(req, res, next) {
  const role = req.user?.role;
  if (!CLINICAL_ROLES.has(role) && role !== 'read_only') {
    return res.status(403).json({
      error: 'forbidden',
      message: 'WHODAS assessments are limited to treating therapists.',
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
      message: 'Only treating therapists can create or edit WHODAS assessments.',
    });
  }
  if (!orgOf(req)) {
    return res.status(403).json({ error: 'no_organisation', message: 'Your account is not linked to an organisation.' });
  }
  next();
}

// ── Instrument metadata ──────────────────────────────────────────────────────

/**
 * Everything the client needs to render the library and the viewer, except the
 * PDFs themselves. Item wording comes from instrument-data.json, which is
 * derived from the template PDFs rather than transcribed.
 */
router.get('/api/whodas/instrument', requireClinicalRead, safe(async (req, res) => {
  const data = registry.instrumentData();

  res.json({
    instrument: 'WHODAS-2.0',
    instrumentVersion: '2.0',
    itemSet: '36-item',
    scoringVersion: SCORING_VERSION,
    defaultScoringMethod: DEFAULT_METHOD,
    scoringMethods: ALL_METHODS,
    responseScale: instrument.RESPONSE_SCALE.map((r) => ({ value: r.value, label: r.label })),
    domains: instrument.DOMAINS,
    items: instrument.ITEMS,
    workSchoolItems: instrument.WORK_SCHOOL_ITEMS,
    dayCountItems: instrument.DAY_COUNT_ITEMS,
    proxyRelationshipOptions: instrument.PROXY_RELATIONSHIP_OPTIONS,
    workStatusOptions: instrument.A5_WORK_STATUS,
    methods: registry.instrumentTemplates().map((t) => ({
      method: t.method,
      templateKey: t.key,
      name: t.name,
      pageCount: t.pageCount,
      itemText: data.methods[t.method]?.items || {},
    })),
    flashcards: (() => {
      const f = registry.flashcardsTemplate();
      return f ? { templateKey: f.key, name: f.name, pageCount: f.pageCount } : null;
    })(),
    // Surfaced so the UI can state the provenance of the document on screen.
    source: registry.manifest().source,
  });
}));

/** The field map for one template — coordinates for the overlay controls. */
router.get('/api/whodas/templates/:key/field-map', requireClinicalRead, safe(async (req, res) => {
  const map = registry.fieldMap(req.params.key);
  if (!map) return res.status(404).json({ error: 'not_found' });
  res.json(map);
}));

/**
 * The official blank WHO form, streamed verbatim from the immutable template.
 * `?disposition=inline` is what the print flow uses.
 */
router.get('/api/whodas/templates/:key/blank', requireClinicalRead, safe(async (req, res) => {
  const tpl = registry.templateByKey(req.params.key);
  if (!tpl) return res.status(404).json({ error: 'not_found' });

  let bytes;
  try {
    bytes = registry.readTemplateBytes(tpl.key);
  } catch (err) {
    log.error('whodas template integrity failure', { key: tpl.key, error: err.message });
    return res.status(503).json({
      error: 'template_unavailable',
      message: 'The official WHO source document failed its integrity check and will not be served.',
    });
  }

  const inline = req.query.disposition === 'inline';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', bytes.length);
  // The blank instrument is not client data, but it is licensed content and
  // must not be cached by shared proxies.
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${tpl.filename}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(bytes);
}));

// ── Assessment listing ───────────────────────────────────────────────────────

/**
 * Which assessments this user may see: everything completed/voided/amended in
 * their organisation, plus their own drafts.
 */
const VISIBILITY_SQL = `
  (a.status <> 'draft' OR a.started_by_user_id = $2)
`;

function serialiseSummary(row) {
  const scores = row.scores || {};
  const preferred = scores[row.default_scoring_method || DEFAULT_METHOD] || null;
  return {
    id: row.id,
    clientId: row.client_id,
    administrationMethod: row.administration_method,
    itemSet: row.item_set,
    status: row.status,
    version: row.version,
    templateKey: row.template_key,
    templateVersion: row.template_version,
    startedAt: row.started_at,
    startedByName: row.started_by_name,
    completedAt: row.completed_at,
    completedByName: row.completed_by_name,
    scoringVersion: row.scoring_version,
    scoresCalculatedAt: row.scores_calculated_at,
    defaultScoringMethod: row.default_scoring_method,
    // History rows show the default (IRT) score only; the full set is on the
    // detail view, always labelled with its method.
    overallScore: preferred && preferred.scorable ? preferred.overall.value : null,
    overallScoreLabel: preferred ? preferred.label : null,
    amendsAssessmentId: row.amends_assessment_id,
    amendedByAssessmentId: row.amended_by_assessment_id,
    hasDocument: Boolean(row.document_id),
    documentId: row.document_id || null,
  };
}

router.get('/api/whodas/clients/:clientId/assessments', requireClinicalRead, safe(async (req, res) => {
  const clientId = str(req.params.clientId, 120);
  if (!clientId) return res.status(400).json({ error: 'invalid_client' });

  const { rows } = await pool.query(
    `SELECT a.*, gd.id AS document_id
       FROM whodas_assessments a
       LEFT JOIN LATERAL (
         SELECT id FROM whodas_generated_documents
          WHERE assessment_id = a.id ORDER BY created_at DESC LIMIT 1
       ) gd ON TRUE
      WHERE a.organisation_id = $1 AND a.client_id = $3 AND ${VISIBILITY_SQL}
        -- A deleted draft (voided, never completed) leaves every list; a
        -- voided COMPLETED assessment keeps its completed_at — the trigger
        -- freezes it — and stays visible, because it was once a filed record.
        AND NOT (a.status = 'voided' AND a.completed_at IS NULL)
      ORDER BY a.started_at DESC
      LIMIT 200`,
    [orgOf(req), req.user.id, clientId]
  );

  res.json({ assessments: rows.map(serialiseSummary) });
}));

// ── Create ───────────────────────────────────────────────────────────────────

router.post('/api/whodas/assessments', requireClinicalWrite, safe(async (req, res) => {
  const clientId = str(req.body?.clientId, 120);
  const method = str(req.body?.administrationMethod, 20);

  if (!clientId) return res.status(400).json({ error: 'invalid_client' });
  if (!instrument.ADMINISTRATION_METHODS.includes(method)) {
    return res.status(400).json({
      error: 'invalid_method',
      message: `administrationMethod must be one of ${instrument.ADMINISTRATION_METHODS.join(', ')}.`,
    });
  }

  const tpl = registry.templateForMethod(method);
  if (!tpl) return res.status(500).json({ error: 'no_template' });

  const templateRow = await registry.activeTemplateRow(pool, tpl.key);
  if (!templateRow) {
    return res.status(503).json({
      error: 'template_not_registered',
      message: 'The WHO source document is not registered in this environment.',
    });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO whodas_assessments
         (organisation_id, client_id, client_name, administration_method,
          template_id, template_key, template_version, template_sha256,
          started_by_user_id, started_by_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        orgOf(req), clientId, str(req.body?.clientName, 200), method,
        templateRow.id, templateRow.template_key, templateRow.version, templateRow.sha256,
        req.user.id, str(req.user.name || req.user.email, 200),
      ]
    );

    const row = rows[0];
    await audit(req, 'WHODAS_ASSESSMENT_STARTED', row.id, {
      method,
      templateKey: row.template_key,
      templateVersion: row.template_version,
    });
    res.status(201).json({ assessment: serialiseDetail(row) });
  } catch (err) {
    // uniq_whodas_one_draft_per_client_method — a double-clicked "Start" or an
    // autosave retry must never create a second clinical record.
    if (err.code === '23505') {
      const { rows } = await pool.query(
        `SELECT * FROM whodas_assessments
          WHERE organisation_id = $1 AND client_id = $2
            AND administration_method = $3 AND status = 'draft'
          LIMIT 1`,
        [orgOf(req), clientId, method]
      );
      if (rows[0]) {
        return res.status(409).json({
          error: 'draft_exists',
          message: 'An assessment of this type is already in progress for this client.',
          assessment: serialiseDetail(rows[0]),
        });
      }
    }
    throw err;
  }
}));

// ── Fetch ────────────────────────────────────────────────────────────────────

function serialiseDetail(row, extra = {}) {
  return {
    ...serialiseSummary({ ...row, document_id: extra.documentId }),
    clientName: row.client_name,
    instrument: row.instrument,
    instrumentVersion: row.instrument_version,
    templateSha256: row.template_sha256,
    workSchoolApplicable: row.work_school_applicable,
    responses: row.responses || {},
    formData: row.form_data || {},
    scores: row.scores || {},
    voidReason: row.void_reason,
    amendmentReason: row.amendment_reason,
    updatedAt: row.updated_at,
    ...extra,
  };
}

async function loadAssessment(req, id) {
  if (!isUuid(id)) return null;
  const { rows } = await pool.query(
    `SELECT a.*, gd.id AS document_id
       FROM whodas_assessments a
       LEFT JOIN LATERAL (
         SELECT id FROM whodas_generated_documents
          WHERE assessment_id = a.id ORDER BY created_at DESC LIMIT 1
       ) gd ON TRUE
      WHERE a.id = $3 AND a.organisation_id = $1 AND ${VISIBILITY_SQL}`,
    [orgOf(req), req.user.id, id]
  );
  return rows[0] || null;
}

router.get('/api/whodas/assessments/:id', requireClinicalRead, safe(async (req, res) => {
  const row = await loadAssessment(req, req.params.id);
  // Deliberately ambiguous between "gone" and "not yours": the 404-not-403
  // rule at the top of this file only works if the response cannot tell the
  // two apart. This is the one a stale deep link hits, so it needs a sentence
  // rather than the bare code the surface used to print in its error banner.
  if (!row) {
    return res.status(404).json({
      error: 'not_found',
      message: 'That assessment record could not be found, or is no longer available to you.',
    });
  }

  res.json({
    assessment: serialiseDetail(row, { documentId: row.document_id }),
    fieldMap: registry.fieldMap(row.template_key),
  });
}));

// ── Autosave ─────────────────────────────────────────────────────────────────

/**
 * Field-level save. The client sends only what changed, plus the version it
 * last read. A mismatch is a 409 carrying the current server state, so a second
 * browser session can never silently overwrite newer clinical responses.
 */
router.patch('/api/whodas/assessments/:id', requireClinicalWrite, safe(async (req, res) => {
  const row = await loadAssessment(req, req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });

  if (row.status !== 'draft') {
    return res.status(409).json({
      error: 'not_editable',
      message: 'This assessment is completed. Changes require an auditable amendment.',
    });
  }
  if (row.started_by_user_id !== req.user.id) {
    return res.status(403).json({
      error: 'forbidden',
      message: 'An assessment in progress can only be edited by the clinician who started it.',
    });
  }

  const expected = req.body?.version;
  if (expected !== undefined && Number(expected) !== row.version) {
    return res.status(409).json({
      error: 'stale_version',
      message: 'This assessment changed in another session. Reload before saving.',
      currentVersion: row.version,
      assessment: serialiseDetail(row),
    });
  }

  // Validate every incoming response against the WHO scale. An unrecognised
  // value is rejected outright rather than stored and tripped over at scoring.
  const incoming = req.body?.responses && typeof req.body.responses === 'object' ? req.body.responses : {};
  const rejected = [];
  const responses = { ...(row.responses || {}) };

  for (const [itemId, value] of Object.entries(incoming)) {
    if (!instrument.ITEM_BY_ID.has(itemId)) { rejected.push(itemId); continue; }
    if (value === null || value === '') { delete responses[itemId]; continue; }
    if (!instrument.isResponseValue(value)) { rejected.push(itemId); continue; }
    responses[itemId] = value;
  }
  if (rejected.length) {
    return res.status(400).json({ error: 'invalid_responses', itemIds: rejected });
  }

  const formData = { ...(row.form_data || {}) };
  const incomingForm = req.body?.formData && typeof req.body.formData === 'object' ? req.body.formData : {};
  for (const [k, v] of Object.entries(incomingForm)) {
    if (v === null || v === '') delete formData[k];
    else formData[k] = typeof v === 'number' ? v : String(v).slice(0, 400);
  }

  let workSchoolApplicable = row.work_school_applicable;
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'workSchoolApplicable')) {
    const w = req.body.workSchoolApplicable;
    if (w !== null && typeof w !== 'boolean') {
      return res.status(400).json({ error: 'invalid_work_school_applicable' });
    }
    workSchoolApplicable = w;
    // Marking the respondent as not working clears any work-block answers, so
    // a stale response can never contribute to a later score.
    if (w === false) instrument.WORK_SCHOOL_ITEMS.forEach((id) => delete responses[id]);
  }

  const { rows } = await pool.query(
    `UPDATE whodas_assessments
        SET responses = $4, form_data = $5, work_school_applicable = $6, version = version + 1
      WHERE id = $3 AND organisation_id = $1 AND version = $2 AND status = 'draft'
      RETURNING *`,
    [orgOf(req), row.version, row.id, JSON.stringify(responses), JSON.stringify(formData), workSchoolApplicable]
  );

  // Lost the race against a concurrent write between the read and the update.
  if (!rows[0]) {
    const fresh = await loadAssessment(req, row.id);
    return res.status(409).json({
      error: 'stale_version',
      message: 'This assessment changed in another session. Reload before saving.',
      currentVersion: fresh ? fresh.version : null,
      assessment: fresh ? serialiseDetail(fresh) : null,
    });
  }

  // Counts only — never which items, never which values.
  await audit(req, 'WHODAS_RESPONSE_UPDATED', row.id, {
    version: rows[0].version,
    changedCount: Object.keys(incoming).length + Object.keys(incomingForm).length,
    answeredCount: Object.keys(rows[0].responses || {}).length,
  });

  res.json({ assessment: serialiseDetail(rows[0]) });
}));

// ── Completion validation ────────────────────────────────────────────────────

/**
 * What is missing before this assessment can be completed. Item-level, so the
 * UI can walk the clinician to each gap.
 */
function validateForCompletion(row) {
  const problems = [];

  if (row.work_school_applicable === null || row.work_school_applicable === undefined) {
    problems.push({
      code: 'work_school_undeclared',
      message:
        'Record whether the respondent works (paid, non-paid, self-employed) or goes to school. ' +
        'This decides whether items D5.5–D5.8 apply.',
    });
  }

  const applicable = row.work_school_applicable
    ? instrument.ITEM_IDS
    : instrument.ALWAYS_APPLICABLE_ITEMS;

  const responses = row.responses || {};
  const missing = applicable.filter((id) => {
    const v = responses[id];
    return v === undefined || v === null || v === '';
  });

  if (missing.length) {
    problems.push({
      code: 'unanswered_items',
      message: `${missing.length} of ${applicable.length} applicable items are unanswered.`,
      itemIds: missing,
    });
  }

  return {
    ok: problems.length === 0,
    problems,
    missingItemIds: missing,
    applicableCount: applicable.length,
    notApplicableItemIds: row.work_school_applicable ? [] : [...instrument.WORK_SCHOOL_ITEMS],
  };
}

router.get('/api/whodas/assessments/:id/validation', requireClinicalRead, safe(async (req, res) => {
  const row = await loadAssessment(req, req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json(validateForCompletion(row));
}));

// ── Complete ─────────────────────────────────────────────────────────────────

/**
 * Filename for a completed WHODAS document.
 *
 * Human-readable and dated, per the naming requirement — but deliberately
 * carrying NO client name. Filenames end up in download folders, email
 * attachment lists and shared screens, so the client identity stays in the
 * record rather than on the file. The assessment id keeps it unique and
 * traceable back to the clinical record.
 */
function completedFilename(row) {
  const when = (row.completed_at ? new Date(row.completed_at) : new Date())
    .toISOString().slice(0, 10);
  const shortId = String(row.id || '').slice(0, 8);
  return `whodas-2.0-36-item-${row.administration_method}-${when}-${shortId}.pdf`;
}

/**
 * @param exec optional transaction client. When the assessment row is being
 *   created in the same transaction, the document INSERT must run on that same
 *   connection or its foreign key cannot see the not-yet-committed parent.
 */
async function storeDocument({ assessmentId, bytes, filename, template, userId, pageCount, source, exec }) {
  const backend = getBackend();
  const docId = randomUUID();
  const base64 = bytes.toString('base64');

  const put = await backend.put({
    userId,
    docId,
    fileName: filename,
    mime: 'application/pdf',
    base64,
  });

  const { rows } = await (exec || pool).query(
    `INSERT INTO whodas_generated_documents
       (assessment_id, storage_backend, storage_key, file_data, filename, mime_type,
        byte_size, checksum, template_key, template_version, template_sha256,
        page_count, created_by_user_id, document_source)
     VALUES ($1,$2,$3,$4,$5,'application/pdf',$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING id`,
    [
      assessmentId,
      put.backend || getBackendName(),
      put.storageKey || null,
      put.storageKey ? null : base64,
      filename,
      bytes.length,
      registry.sha256(bytes),
      template.key,
      template.version,
      template.sha256,
      pageCount,
      userId,
      source || 'generated',
    ]
  );
  return rows[0].id;
}

router.post('/api/whodas/assessments/:id/complete', requireClinicalWrite, safe(async (req, res) => {
  const row = await loadAssessment(req, req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });

  if (row.status !== 'draft') {
    return res.status(409).json({ error: 'not_editable', message: 'This assessment is already completed.' });
  }
  if (row.started_by_user_id !== req.user.id) {
    return res.status(403).json({
      error: 'forbidden',
      message: 'Only the clinician who started this assessment can complete it.',
    });
  }

  const validation = validateForCompletion(row);
  if (!validation.ok) {
    // Never produce a score from an incomplete assessment.
    return res.status(422).json({ error: 'incomplete', ...validation });
  }

  const workSchoolApplicable = Boolean(row.work_school_applicable);
  const all = scoreAll({ responses: row.responses || {}, workSchoolApplicable });

  const calculatedAt = new Date().toISOString();
  const scores = {};
  for (const method of ALL_METHODS) {
    scores[method] = { ...all.methods[method], calculatedAt };
  }

  const itemSet = workSchoolApplicable ? '36-item' : '32-item';

  const { rows } = await pool.query(
    `UPDATE whodas_assessments
        SET status = 'completed',
            item_set = $4,
            scores = $5,
            default_scoring_method = $6,
            scoring_version = $7,
            scores_calculated_at = $8,
            completed_by_user_id = $9,
            completed_by_name = $10,
            completed_at = NOW(),
            version = version + 1
      WHERE id = $3 AND organisation_id = $1 AND version = $2 AND status = 'draft'
      RETURNING *`,
    [
      orgOf(req), row.version, row.id, itemSet, JSON.stringify(scores),
      DEFAULT_METHOD, SCORING_VERSION, calculatedAt,
      req.user.id, str(req.user.name || req.user.email, 200),
    ]
  );
  if (!rows[0]) {
    return res.status(409).json({ error: 'stale_version', message: 'This assessment changed in another session.' });
  }
  const completed = rows[0];

  await audit(req, 'WHODAS_ASSESSMENT_COMPLETED', completed.id, {
    method: completed.administration_method,
    itemSet,
    scoringVersion: SCORING_VERSION,
    templateVersion: completed.template_version,
    answeredCount: Object.keys(completed.responses || {}).length,
    missingCount: scores[DEFAULT_METHOD]?.missingData?.missingCount ?? 0,
  });

  // Generate the completed PDF. A failure here must not undo a clinically
  // completed assessment — the document can be regenerated from frozen data.
  let documentId = null;
  let documentError = null;
  try {
    const template = registry.templateByKey(completed.template_key);
    const generated = await generateCompletedPdf({
      templateKey: completed.template_key,
      responses: completed.responses || {},
      formData: completed.form_data || {},
      notApplicableItems: workSchoolApplicable ? [] : instrument.WORK_SCHOOL_ITEMS,
    });

    documentId = await storeDocument({
      assessmentId: completed.id,
      bytes: generated.bytes,
      filename: completedFilename(completed),
      template,
      userId: req.user.id,
      pageCount: generated.pageCount,
    });

    await audit(req, 'WHODAS_PDF_GENERATED', completed.id, {
      documentId,
      pageCount: generated.pageCount,
      marksDrawn: generated.marksDrawn,
      templateSha256: template.sha256,
      warnings: generated.warnings.length,
    });
  } catch (err) {
    // The assessment is already completed and locked by this point, so the
    // clinical record stands. But swallowing this silently left a completed
    // assessment with no document and no way to produce one — the caller was
    // told documentGenerated:false with no reason and no remedy. Report it,
    // and /document/regenerate below is the remedy.
    documentError = err.message || 'generation_failed';
    log.error('whodas completed pdf generation failed', {
      assessmentId: completed.id, error: err.message,
    });
    await audit(req, 'WHODAS_PDF_GENERATION_FAILED', completed.id, { error: documentError });
  }

  res.json({
    assessment: serialiseDetail(completed, { documentId }),
    documentGenerated: Boolean(documentId),
    documentError: documentError || undefined,
    documentRemedy: documentError
      ? 'The assessment is saved and scored. Use Regenerate document to produce the PDF.'
      : undefined,
  });
}));

// ── Void ─────────────────────────────────────────────────────────────────────

/**
 * Re-issue the completed PDF for an assessment that has none.
 *
 * The remedy for a generation failure at completion time. It renders from the
 * SAME frozen response set and the same immutable template, so a re-issue is
 * not a new clinical act — the assessment is untouched, only the artefact is
 * produced. Refuses to run when a document already exists, because silently
 * replacing a document a clinician may already have sent is exactly the
 * overwrite the amendment flow exists to prevent.
 */
router.post('/api/whodas/assessments/:id/document/regenerate', requireClinicalWrite, safe(async (req, res) => {
  const row = await loadAssessment(req, req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  if (row.status !== 'completed' && row.status !== 'amended') {
    return res.status(409).json({
      error: 'Only a completed assessment has a document to issue.',
      code: 'not_completed',
    });
  }
  if (row.completion_source === 'uploaded') {
    return res.status(409).json({
      error: 'This assessment was completed outside Opal. Its document was uploaded, not generated.',
      code: 'externally_completed',
    });
  }

  const { rows: existing } = await pool.query(
    `SELECT id FROM whodas_generated_documents
      WHERE assessment_id = $1 AND document_source = 'generated' LIMIT 1`,
    [row.id]);
  if (existing.length) {
    return res.status(409).json({
      error: 'A document already exists for this assessment.',
      code: 'document_exists',
      documentId: existing[0].id,
    });
  }

  try {
    const template = registry.templateByKey(row.template_key);
    const generated = await generateCompletedPdf({
      templateKey: row.template_key,
      responses: row.responses,
      formData: row.form_data,
      notApplicableItems: row.not_applicable_items,
    });
    const documentId = await storeDocument({
      assessmentId: row.id,
      bytes: generated.bytes,
      filename: completedFilename(row),
      template,
      userId: req.user.id,
      pageCount: generated.pageCount,
      source: 'generated',
    });
    await audit(req, 'WHODAS_PDF_REISSUED', row.id, {
      documentId, pageCount: generated.pageCount, templateSha256: template.sha256,
    });
    return res.json({ ok: true, documentId });
  } catch (err) {
    log.error('whodas pdf re-issue failed', { assessmentId: row.id, error: err.message });
    return res.status(500).json({ error: 'generation_failed', detail: err.message });
  }
}));

/**
 * Record an assessment completed OUTSIDE Opal and attach the scanned document.
 *
 * The paper workflow: print a blank WHO form, have it completed, scan it, file
 * it here. The assessment row exists so the event appears in the client's
 * history alongside electronic ones, but it carries NO responses and NO score —
 * migration 028 enforces that at the database level. Nothing here reads or
 * interprets the uploaded file; scoring a handwritten form would mean inventing
 * data, so a clinician who wants a score enters the responses electronically.
 */
router.post('/api/whodas/clients/:clientId/assessments/upload', requireClinicalWrite, safe(async (req, res) => {
  const clientId = String(req.params.clientId || '').trim();
  if (!clientId) return res.status(404).json({ error: 'not_found' });

  const b = req.body || {};
  const method = String(b.administrationMethod || '');
  if (instrument.ADMINISTRATION_METHODS.indexOf(method) === -1) {
    return res.status(400).json({
      error: 'Choose which WHO form was completed: interviewer, self or proxy.',
      code: 'method_required',
    });
  }
  const assessedOn = String(b.assessedOn || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(assessedOn)) {
    return res.status(400).json({ error: 'A completion date is required (YYYY-MM-DD).', code: 'date_required' });
  }
  const base64 = typeof b.fileBase64 === 'string' ? b.fileBase64 : '';
  if (!base64) return res.status(400).json({ error: 'No file supplied.', code: 'file_required' });

  let bytes;
  try { bytes = Buffer.from(base64, 'base64'); }
  catch (e) { return res.status(400).json({ error: 'The file could not be read.', code: 'file_unreadable' }); }
  if (!bytes.length) return res.status(400).json({ error: 'The file is empty.', code: 'file_required' });
  if (bytes.length > 20 * 1024 * 1024) {
    return res.status(413).json({ error: 'The file is larger than 20 MB.', code: 'file_too_large' });
  }
  // Only a PDF. The magic bytes are checked rather than the supplied name,
  // because a filename is a claim and a header is evidence.
  if (bytes.slice(0, 5).toString('latin1') !== '%PDF-') {
    return res.status(400).json({ error: 'Only a PDF can be uploaded.', code: 'not_a_pdf' });
  }

  // The manifest entry gives key/version/sha256; the DB row gives template_id,
  // which whodas_assessments requires. Resolve both, exactly as the start route
  // does — an upload must reference the same registered template a generated
  // assessment would.
  const template = registry.templateForMethod(method);
  if (!template) return res.status(503).json({ error: 'template_unavailable' });
  const templateRow = await registry.activeTemplateRow(pool, template.key);
  if (!templateRow) {
    return res.status(503).json({
      error: 'template_not_registered',
      message: 'The WHO template registry has not synced. Restart the server and try again.',
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO whodas_assessments
         (organisation_id, client_id, client_name, administration_method, template_id,
          template_key, template_version, template_sha256, status, completion_source,
          started_by_user_id, completed_by_user_id, completed_at,
          work_school_applicable, responses, form_data, scores, started_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'completed','uploaded',$9,$9,$10,$11,
               '{}'::jsonb,'{}'::jsonb,'{}'::jsonb,$10)
       RETURNING *`,
      [orgOf(req), clientId, str(b.clientName, 200) || null, method, templateRow.id,
       templateRow.template_key, templateRow.version, templateRow.sha256,
       req.user.id, assessedOn,
       b.workSchoolApplicable === false ? false : true]);
    const assessment = rows[0];

    const documentId = await storeDocument({
      assessmentId: assessment.id,
      bytes,
      filename: completedFilename(assessment),
      // Template provenance on an uploaded document describes the BLANK form it
      // was completed on — nothing here rendered it.
      template: { key: templateRow.template_key, version: templateRow.version, sha256: templateRow.sha256 },
      userId: req.user.id,
      pageCount: null,
      source: 'uploaded',
      exec: client,
    });

    await client.query('COMMIT');
    await audit(req, 'WHODAS_ASSESSMENT_UPLOADED', assessment.id, {
      documentId, method, assessedOn, byteSize: bytes.length,
    });
    return res.status(201).json({
      assessment: serialiseDetail(assessment, { documentId }),
      completionSource: 'uploaded',
      note: 'Recorded as externally completed. No score is calculated for an uploaded form.',
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}));

/**
 * Delete a DRAFT assessment.
 *
 * "Delete" is the clinician's word for it; the mechanism is the module's
 * established soft delete. Migration 021 is explicit that a voided assessment
 * is "retained, never deleted", and clinical rows in this codebase are never
 * hard-deleted — so the row survives, status 'voided', with who/when/why
 * recorded, and both list endpoints exclude never-completed voided rows so the
 * deleted draft disappears from every history the user sees.
 *
 * Scope is airtight by construction:
 *   - loadAssessment is organisation-filtered AND draft-visibility-filtered,
 *     so another organisation's record and a colleague's draft are both 404
 *     before any status check runs;
 *   - only status 'draft' may be deleted — a completed, amended or voided
 *     record is a filed clinical record and refuses with 409;
 *   - the UPDATE re-checks status = 'draft', so a draft completed between the
 *     read and the write cannot be swept away by a stale click;
 *   - voiding one row frees that client+method's one-draft slot (the partial
 *     unique index applies WHERE status = 'draft'), so a new assessment can
 *     be started immediately. Templates, other drafts, and every other
 *     record are untouched — this is a single-row UPDATE by primary key.
 */
router.delete('/api/whodas/assessments/:id', requireClinicalWrite, safe(async (req, res) => {
  const row = await loadAssessment(req, req.params.id);
  if (!row) {
    return res.status(404).json({
      error: 'not_found',
      message: 'That assessment record could not be found, or is no longer available to you.',
    });
  }
  if (row.status !== 'draft') {
    return res.status(409).json({
      error: 'not_a_draft',
      message: 'Only a draft assessment can be deleted. A completed assessment is a filed '
        + 'clinical record — void or amend it instead.',
    });
  }

  const { rows } = await pool.query(
    `UPDATE whodas_assessments
        SET status = 'voided', voided_by_user_id = $3, voided_at = NOW(),
            void_reason = $4, version = version + 1
      WHERE id = $2 AND organisation_id = $1 AND status = 'draft'
      RETURNING id`,
    [orgOf(req), row.id, req.user.id, 'Draft deleted by its author before completion']
  );
  if (!rows[0]) {
    return res.status(409).json({
      error: 'not_a_draft',
      message: 'This assessment changed while the confirmation was open. Reload and try again.',
    });
  }

  await audit(req, 'WHODAS_DRAFT_DELETED', row.id, {
    administrationMethod: row.administration_method,
    // How much was thrown away, as a count only — never the responses.
    responsesDiscarded: Object.keys(row.responses || {}).length,
  });

  res.json({ ok: true, deleted: true, id: row.id });
}));

router.post('/api/whodas/assessments/:id/void', requireClinicalWrite, safe(async (req, res) => {
  const row = await loadAssessment(req, req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  if (row.status === 'voided') return res.status(409).json({ error: 'already_voided' });

  const reason = str(req.body?.reason, 500);
  if (!reason) {
    return res.status(400).json({ error: 'reason_required', message: 'A reason is required to void an assessment.' });
  }

  const { rows } = await pool.query(
    `UPDATE whodas_assessments
        SET status = 'voided', voided_by_user_id = $3, voided_at = NOW(),
            void_reason = $4, version = version + 1
      WHERE id = $2 AND organisation_id = $1 AND status <> 'voided'
      RETURNING *`,
    [orgOf(req), row.id, req.user.id, reason]
  );
  if (!rows[0]) return res.status(409).json({ error: 'already_voided' });

  await audit(req, 'WHODAS_ASSESSMENT_VOIDED', row.id, { previousStatus: row.status });
  res.json({ assessment: serialiseDetail(rows[0]) });
}));

// ── Amend ────────────────────────────────────────────────────────────────────

/**
 * Correcting a completed assessment. The original is never edited: it is marked
 * `amended` and a new draft is opened, pre-filled from its responses, pointing
 * back at it. Both remain in the client's record.
 */
router.post('/api/whodas/assessments/:id/amend', requireClinicalWrite, safe(async (req, res) => {
  const row = await loadAssessment(req, req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });

  if (row.status !== 'completed') {
    return res.status(409).json({
      error: 'not_amendable',
      message: 'Only a completed assessment can be amended.',
    });
  }

  const reason = str(req.body?.reason, 500);
  if (!reason) {
    return res.status(400).json({ error: 'reason_required', message: 'A reason is required to amend an assessment.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const templateRow = await registry.activeTemplateRow(client, row.template_key);
    if (!templateRow) {
      await client.query('ROLLBACK');
      return res.status(503).json({ error: 'template_not_registered' });
    }

    const { rows: created } = await client.query(
      `INSERT INTO whodas_assessments
         (organisation_id, client_id, client_name, administration_method,
          template_id, template_key, template_version, template_sha256,
          started_by_user_id, started_by_name, responses, form_data,
          work_school_applicable, amends_assessment_id, amendment_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        row.organisation_id, row.client_id, row.client_name, row.administration_method,
        templateRow.id, templateRow.template_key, templateRow.version, templateRow.sha256,
        req.user.id, str(req.user.name || req.user.email, 200),
        JSON.stringify(row.responses || {}), JSON.stringify(row.form_data || {}),
        row.work_school_applicable, row.id, reason,
      ]
    );

    await client.query(
      `UPDATE whodas_assessments
          SET status = 'amended', amended_by_assessment_id = $2, version = version + 1
        WHERE id = $1`,
      [row.id, created[0].id]
    );

    await client.query('COMMIT');

    await audit(req, 'WHODAS_ASSESSMENT_AMENDED', row.id, { amendmentId: created[0].id });
    res.status(201).json({ assessment: serialiseDetail(created[0]), amends: row.id });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') {
      return res.status(409).json({
        error: 'draft_exists',
        message: 'An assessment of this type is already in progress for this client.',
      });
    }
    throw err;
  } finally {
    client.release();
  }
}));

// ── Completed document download ──────────────────────────────────────────────

router.get('/api/whodas/assessments/:id/document', requireClinicalRead, safe(async (req, res) => {
  const row = await loadAssessment(req, req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });

  const { rows } = await pool.query(
    `SELECT * FROM whodas_generated_documents
      WHERE assessment_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [row.id]
  );
  const doc = rows[0];
  if (!doc) return res.status(404).json({ error: 'no_document' });

  // Resolve the backend the document was WRITTEN with, not whatever the
  // environment is set to now. getBackend() with no argument defaults to the
  // current env, so after a switch from db to blob every previously stored
  // document would be looked up in the wrong place. fca-routes.js:932 already
  // does it this way.
  let base64;
  try {
    ({ base64 } = await getBackend(doc.storage_backend || 'db').get({
      backend: doc.storage_backend,
      storageKey: doc.storage_key,
      fileData: doc.file_data,
    }));
  } catch (err) {
    log.error('whodas document read failed', { documentId: doc.id, error: err.message });
    return res.status(500).json({ error: 'download_failed' });
  }
  const bytes = Buffer.from(base64, 'base64');

  const inline = req.query.disposition === 'inline';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', bytes.length);
  // Completed clinical record: never cached anywhere.
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${doc.filename}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');

  await audit(req, 'WHODAS_PDF_DOWNLOADED', row.id, { documentId: doc.id, inline });
  res.send(bytes);
}));

// ── Ad-hoc scoring preview (draft only, never persisted) ─────────────────────

/**
 * Lets the completion screen show what the score will be before locking. The
 * server still computes it — the browser never scores — and nothing is stored.
 */
router.get('/api/whodas/assessments/:id/score-preview', requireClinicalRead, safe(async (req, res) => {
  const row = await loadAssessment(req, req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });

  if (row.work_school_applicable === null || row.work_school_applicable === undefined) {
    return res.status(422).json({ error: 'work_school_undeclared' });
  }

  const method = str(req.query.method, 20) || DEFAULT_METHOD;
  if (!ALL_METHODS.includes(method)) return res.status(400).json({ error: 'invalid_method' });

  res.json({
    preview: true,
    result: score({
      responses: row.responses || {},
      workSchoolApplicable: Boolean(row.work_school_applicable),
      method,
    }),
  });
}));

module.exports = router;
module.exports.validateForCompletion = validateForCompletion;
