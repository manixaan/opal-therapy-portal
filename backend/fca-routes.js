'use strict';

/**
 * FUNCTIONAL CAPACITY ASSESSMENT (FCA) REPORT GENERATION
 *
 * A therapist picks a client, chooses which sections of the Opal Functional
 * Assessment Report belong in this report, fills in what the portal cannot
 * know, and generates a styled Word document from the shipped template.
 *
 * ── Hard rules enforced here ───────────────────────────────────────────────
 * - NO EXTERNAL AI. Nothing in this feature calls a model, of any kind, ever.
 * - THE MANIFEST IS THE SINGLE SOURCE OF TRUTH. The server composes it, the
 *   engine renders it, and the wizard preview displays the same object. The
 *   frontend never computes its own section list, values or source labels.
 * - THE SNAPSHOT IS FROZEN. Generation resolves the four layers once and
 *   stores the result. Download re-reads that snapshot and never re-resolves,
 *   so an issued document cannot quietly change when Splose or a profile does.
 * - ORGANISATION ISOLATION. Every profile and draft query filters
 *   organisation_id. A user in org A asking for org B's row gets 404 — not 403,
 *   because "you may not see this" already leaks that it exists.
 * - OWN-ONLY DRAFTS. Matching case-note drafts: a draft belongs to the user who
 *   created it, and no role — owner included — reads another user's drafts. A
 *   draft in progress carries a therapist's unfinished clinical reasoning, and
 *   the org-wide view that owners get elsewhere is for finished, issued work.
 * - OPAL ISSUES ONLY WHAT IS OPAL'S TO ISSUE. The document id, date, version
 *   and status are minted once, when the draft is created, and stored — so the
 *   review step shows real values instead of four fields marked "Missing" that
 *   nobody could look up, and regenerating never renumbers a report. Nothing
 *   else is auto-filled: an issue date, a reviewer and the authorised
 *   recipients are facts about the world and stay missing until a human
 *   supplies them.
 * - EXCLUDING IS THE THERAPIST'S TO DECIDE. A field they say does not apply
 *   contributes NOTHING to the document — an empty control, or no line at all
 *   where the template says the tag owns one — and can never block generation.
 * - SAVE-BACK IS EXPLICIT. Nothing writes to a client profile implicitly:
 *   not on PATCH, not on generate. Only POST /save-to-profile writes, only the
 *   profile-eligible tags, and report-specific tags are rejected with a reason
 *   while nothing at all is written.
 * - PRIVACY. No client identity and no clinical content in logs, audit
 *   payloads or client-facing errors. Audit rows carry ids, versions and counts.
 *
 * ── Roles ──────────────────────────────────────────────────────────────────
 *   therapist, owner  create, edit, generate and download their OWN drafts;
 *                     read and update client profiles in their organisation
 *   read_only         read the template, client list and profiles; no writes,
 *                     no generation
 *   admin             NO ACCESS. Admin is a non-clinical scheduling role here
 *                     (see permissions.js) and an FCA is clinical documentation.
 */

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const router = express.Router();
const db = require('./database');
const { pool } = require('./database');
const { requireAuth } = require('./permissions');
const log = require('./logger').createLogger('fca');

const templateMap = require('./fca/template-map');
const { generateFcaDocx } = require('./fca/docx-engine');
const { paginateForPreview } = require('./fca/preview-pagination');

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const { resolveScalars } = require('./fca/resolve-scalars');
const { issueDocumentControl, documentControlFor } = require('./fca/document-id');
const { searchClients } = require('./fca/client-search');
const {
  loadSploseClient,
  loadClientProfile,
  loadPortalData,
} = require('./fca/data-layers');
const {
  normaliseSelection,
  normaliseCustomSections,
  normaliseOverrides,
  normaliseExcludedFields,
  buildManifest,
} = require('./fca/manifest');

const {
  TEMPLATE_ID,
  TEMPLATE_VERSION,
  TEMPLATE_NAME,
  PROFILE_ELIGIBLE_TAGS,
  PROFILE_PLAN_TAGS,
  SCALAR_BY_TAG,
  profileRejectionReason,
  templateDescriptor,
} = templateMap;

const TEMPLATE_FILE = path.join(__dirname, 'fca', 'templates', 'fca-v1.docx');

// ── House conventions ────────────────────────────────────────────────────────

const safe = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  // Message only — request bodies carry client and clinical content.
  log.error('fca route error', { error: err.message, path: req.path });
  if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
});

const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));
const orgOf = (req) => req.user?.organisation_id || null;
const str = (v, max) => (v === null || v === undefined ? null : String(v).trim().slice(0, max) || null);

/**
 * A value destined for a DATE column. pg hands DATE columns back as Date
 * objects, and Date.toString() ("Mon May 07 1990 …") is not something Postgres
 * will parse — so a superseded plan's own dates must be normalised on the way
 * back in, or re-saving a plan fails.
 */
const dateStr = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  return String(v).trim().slice(0, 40) || null;
};

async function audit(req, action, targetId, extraMeta = {}) {
  // ids, versions and counts only — never names, never clinical content.
  await db.logAuditEvent({
    action,
    targetType: 'fca_report',
    targetId,
    actorUserId: req.user?.id,
    organisationId: orgOf(req),
    ipAddress: req.ip,
    metadata: { ...extraMeta },
  }).catch(() => {});
}

const CLINICAL_ROLES = new Set(['therapist', 'owner']);

/** Clinical write access: create/edit/generate drafts, write profiles. */
function requireClinicalWrite(req, res, next) {
  const role = req.user?.role;
  if (!CLINICAL_ROLES.has(role)) {
    return res.status(403).json({ error: 'forbidden', message: 'Report generation is limited to treating therapists.' });
  }
  if (!orgOf(req)) {
    return res.status(403).json({ error: 'no_organisation', message: 'Your account is not linked to an organisation.' });
  }
  next();
}

/** Read access: clinical roles plus read_only. Admin is excluded outright. */
function requireClinicalRead(req, res, next) {
  const role = req.user?.role;
  if (!CLINICAL_ROLES.has(role) && role !== 'read_only') {
    return res.status(403).json({ error: 'forbidden', message: 'Report generation is limited to treating therapists.' });
  }
  if (!orgOf(req)) {
    return res.status(403).json({ error: 'no_organisation', message: 'Your account is not linked to an organisation.' });
  }
  next();
}

router.use('/api/fca', requireAuth);

// ── Template registry ────────────────────────────────────────────────────────

let templateBufferCache = null;

function readTemplateBuffer() {
  if (!templateBufferCache) templateBufferCache = fs.readFileSync(TEMPLATE_FILE);
  return templateBufferCache;
}

/**
 * The active template row, created on first use from the shipped file.
 * Rows are immutable once generated from (enforced by a trigger in 018), so a
 * new template means a new version row, never an edit to this one.
 */
async function activeTemplate() {
  const found = await pool.query(
    `SELECT * FROM fca_templates
      WHERE template_key = $1 AND version = $2
      LIMIT 1`,
    [TEMPLATE_ID, TEMPLATE_VERSION]
  );
  if (found.rows[0]) return found.rows[0];

  const checksum = crypto.createHash('sha256').update(readTemplateBuffer()).digest('hex');
  const ins = await pool.query(
    `INSERT INTO fca_templates (template_key, version, name, storage_path, checksum, is_active)
     VALUES ($1,$2,$3,$4,$5,TRUE)
     ON CONFLICT (template_key, version) DO NOTHING
     RETURNING *`,
    [TEMPLATE_ID, TEMPLATE_VERSION, TEMPLATE_NAME, 'fca/templates/fca-v1.docx', checksum]
  );
  if (ins.rows[0]) return ins.rows[0];

  // Lost the race with a concurrent request — read the row it inserted.
  const again = await pool.query(
    'SELECT * FROM fca_templates WHERE template_key = $1 AND version = $2 LIMIT 1',
    [TEMPLATE_ID, TEMPLATE_VERSION]
  );
  return again.rows[0];
}

// ── Layer loaders ────────────────────────────────────────────
// Splose, the organisation's client report profile and the author's own portal
// record are loaded by fca/data-layers.js, shared with the progress note
// letter. ONE implementation means one implementation of organisation
// isolation and one of "Splose is the system of record".

const DOCUMENT_ID_PREFIX = 'FCA';

/**
 * The report-control values OPAL ISSUES for this draft.
 *
 * They are minted ONCE, when the draft is created, and stored in
 * document_control — so the review step shows the real document id, date,
 * version and status rather than four fields marked "Missing" that no
 * therapist could possibly go and look up. Reading the stored row rather than
 * re-minting is what makes regeneration safe: a second generate cannot produce
 * a second document id, because it does not produce one at all.
 *
 * The numbering convention itself lives in fca/document-id.js, shared with the
 * progress note letter.
 */
function serverData(row) {
  return documentControlFor(DOCUMENT_ID_PREFIX, row);
}

// ── Draft serialisation ──────────────────────────────────────────────────────

/**
 * Resolve the four layers for a draft.
 * `frozen` uses the stored snapshot verbatim — never re-resolving is the whole
 * point of freezing it.
 */
async function composeDraft(req, row, { frozen = false } = {}) {
  const selection = {
    selectedSections: row.selected_sections || [],
    sectionOrder: row.section_order || [],
  };
  const customSections = row.custom_sections || [];
  const excludedFields = normaliseExcludedFields(row.excluded_fields || []);

  let scalarData;
  let scalarSources;
  let missingFields;

  if (frozen) {
    scalarData = row.scalar_snapshot || {};
    scalarSources = row.scalar_sources || {};
    missingFields = row.missing_fields || [];
  } else {
    const client = await loadSploseClient(row.client_id);
    const { profile, currentPlan, goals } = await loadClientProfile(row.organisation_id, row.client_id);
    const portal = await loadPortalData(row.created_by_user_id, row.therapist_profile_id);
    ({ scalarData, scalarSources, missingFields } = resolveScalars({
      splose: client,
      profile,
      currentPlan,
      goals,
      overrides: row.scalar_overrides || {},
      portal,
      // Issued when this draft was created, so the therapist reviews the real
      // document id, date, version and status — not four "Missing" rows.
      server: serverData(row),
    }));
  }

  const manifest = buildManifest({
    ...selection,
    customSections,
    scalarData,
    scalarSources,
    excludedFields,
  });

  return {
    id: row.id,
    clientId: row.client_id,
    clientName: row.client_name,
    clientPreferredName: row.client_preferred_name,
    therapistProfileId: row.therapist_profile_id,
    therapistName: row.therapist_name,
    templateId: row.template_id,
    templateVersion: row.template_version,
    status: row.status,
    selectedSections: selection.selectedSections,
    sectionOrder: selection.sectionOrder,
    customSections,
    excludedFields,
    manifest,
    missingFields,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    generatedAt: row.generated_at,
    documentId: row.generated_document_id,
  };
}

/** Own draft, in the caller's organisation. Anything else is 404. */
async function loadOwnDraft(req, id) {
  if (!isUuid(id)) return null;
  const { rows } = await pool.query(
    `SELECT * FROM fca_report_drafts
      WHERE id = $1 AND organisation_id = $2 AND created_by_user_id = $3`,
    [id, orgOf(req), req.user.id]
  );
  return rows[0] || null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Template
// ═══════════════════════════════════════════════════════════════════════════

router.get('/api/fca/template', requireClinicalRead, safe(async (req, res) => {
  res.json({ template: templateDescriptor() });
}));

// ═══════════════════════════════════════════════════════════════════════════
//  Clients (Splose, live)
// ═══════════════════════════════════════════════════════════════════════════

router.get('/api/fca/clients', requireClinicalRead, safe(async (req, res) => {
  // Shared with the progress note letter — see fca/client-search.js.
  let clients;
  try {
    clients = await searchClients(orgOf(req), req.query.q);
  } catch (err) {
    // Never fabricate a client list. If Splose is down, say so.
    log.warn('splose client list unavailable', { error: err.cause || err.message });
    return res.status(503).json({
      error: 'splose_unavailable',
      message: 'Client data is temporarily unavailable. Please try again shortly.',
    });
  }
  res.json({ clients });
}));

// ═══════════════════════════════════════════════════════════════════════════
//  Client report profiles (organisation-scoped, layer 2)
// ═══════════════════════════════════════════════════════════════════════════

function serialiseProfile(profile) {
  if (!profile) return null;
  return {
    id: profile.id,
    clientId: profile.splose_client_id,
    preferredName: profile.preferred_name,
    pronouns: profile.pronouns,
    dateOfBirth: profile.date_of_birth,
    primaryDisability: profile.primary_disability,
    otherConditions: profile.other_conditions,
    nomineeDetails: profile.nominee_details,
    supportCoordinatorDetails: profile.support_coordinator_details,
    referrerDetails: profile.referrer_details,
    otherContacts: profile.other_contacts || [],
    createdAt: profile.created_at,
    updatedAt: profile.updated_at,
  };
}

function serialisePlans(plans) {
  return plans.map((p) => ({
    id: p.id,
    planStart: p.plan_start,
    planEnd: p.plan_end,
    isCurrent: p.is_current,
    createdAt: p.created_at,
    goals: (p.goals || []).map((g) => ({ id: g.id, goalText: g.goal_text, sortOrder: g.sort_order })),
  }));
}

router.get('/api/fca/clients/:clientId/profile', requireClinicalRead, safe(async (req, res) => {
  const { profile, plans } = await loadClientProfile(orgOf(req), req.params.clientId);
  res.json({ profile: serialiseProfile(profile), plans: serialisePlans(plans) });
}));

const PROFILE_COLUMNS = [
  ['preferredName', 'preferred_name'],
  ['pronouns', 'pronouns'],
  ['dateOfBirth', 'date_of_birth'],
  ['primaryDisability', 'primary_disability'],
  ['otherConditions', 'other_conditions'],
  ['nomineeDetails', 'nominee_details'],
  ['supportCoordinatorDetails', 'support_coordinator_details'],
  ['referrerDetails', 'referrer_details'],
];

/**
 * Upsert the profile row. Only the durable client facts listed above; a caller
 * cannot reach any other column from here.
 */
async function upsertProfile(client, organisationId, clientId, userId, body) {
  const values = {};
  for (const [apiKey, column] of PROFILE_COLUMNS) {
    if (Object.prototype.hasOwnProperty.call(body, apiKey)) {
      values[column] = column === 'date_of_birth' ? (str(body[apiKey], 40) || null) : str(body[apiKey], 2000);
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'otherContacts') && Array.isArray(body.otherContacts)) {
    values.other_contacts = JSON.stringify(body.otherContacts.slice(0, 20));
  }

  const columns = Object.keys(values);
  const insertCols = ['organisation_id', 'splose_client_id', 'created_by_user_id', 'updated_by_user_id', ...columns];
  const insertVals = [organisationId, String(clientId), userId, userId, ...columns.map((c) => values[c])];
  const placeholders = insertVals.map((_, i) => `$${i + 1}`);

  const updates = columns.map((c) => `${c} = EXCLUDED.${c}`);
  updates.push('updated_by_user_id = EXCLUDED.updated_by_user_id', 'updated_at = NOW()');

  const { rows } = await client.query(
    `INSERT INTO fca_client_profiles (${insertCols.join(', ')})
     VALUES (${placeholders.join(', ')})
     ON CONFLICT (organisation_id, splose_client_id)
     DO UPDATE SET ${updates.join(', ')}
     RETURNING *`,
    insertVals
  );
  return rows[0];
}

/**
 * Supersede the current plan with a new version. The old row is NEVER updated
 * beyond clearing is_current, and its goals stay attached to it, so last year's
 * plan dates and goals remain queryable exactly as they were reported.
 */
async function supersedePlan(client, profileId, userId, currentPlan) {
  const planStart = dateStr(currentPlan.planStart);
  const planEnd = dateStr(currentPlan.planEnd);
  const goals = Array.isArray(currentPlan.goals)
    ? currentPlan.goals.map((g) => str(typeof g === 'string' ? g : g?.goalText, 1000)).filter(Boolean).slice(0, 20)
    : [];

  await client.query(
    'UPDATE fca_client_ndis_plans SET is_current = FALSE WHERE client_profile_id = $1 AND is_current',
    [profileId]
  );

  const { rows } = await client.query(
    `INSERT INTO fca_client_ndis_plans (client_profile_id, plan_start, plan_end, is_current, created_by_user_id)
     VALUES ($1, $2::date, $3::date, TRUE, $4) RETURNING *`,
    [profileId, planStart, planEnd, userId]
  );
  const plan = rows[0];

  for (let i = 0; i < goals.length; i++) {
    await client.query(
      'INSERT INTO fca_client_ndis_goals (plan_id, goal_text, sort_order) VALUES ($1,$2,$3)',
      [plan.id, goals[i], i]
    );
  }
  return plan;
}

router.put('/api/fca/clients/:clientId/profile', requireClinicalWrite, safe(async (req, res) => {
  const body = req.body || {};
  const clientId = String(req.params.clientId);
  const organisationId = orgOf(req);

  const client = await pool.connect();
  let profile;
  try {
    await client.query('BEGIN');
    profile = await upsertProfile(client, organisationId, clientId, req.user.id, body);
    if (body.currentPlan && typeof body.currentPlan === 'object') {
      await supersedePlan(client, profile.id, req.user.id, body.currentPlan);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  const changedFields = PROFILE_COLUMNS
    .filter(([apiKey]) => Object.prototype.hasOwnProperty.call(body, apiKey))
    .map(([, column]) => column);
  if (body.currentPlan) changedFields.push('ndis_plan');

  // Field NAMES only. The values are client data and never enter an audit row.
  await audit(req, 'fca.client_profile_updated', profile.id, {
    clientId, fields: changedFields, planSuperseded: Boolean(body.currentPlan),
  });

  const fresh = await loadClientProfile(organisationId, clientId);
  res.json({ profile: serialiseProfile(fresh.profile), plans: serialisePlans(fresh.plans) });
}));

// ═══════════════════════════════════════════════════════════════════════════
//  Drafts
// ═══════════════════════════════════════════════════════════════════════════

router.post('/api/fca/drafts', requireClinicalWrite, safe(async (req, res) => {
  const clientId = str(req.body?.clientId, 100);
  if (!clientId) return res.status(400).json({ error: 'clientId is required' });

  let client;
  try {
    client = await loadSploseClient(clientId);
  } catch (err) {
    if (err.sploseFailure) {
      return res.status(503).json({ error: 'splose_unavailable', message: 'Client data is temporarily unavailable. Please try again shortly.' });
    }
    throw err;
  }
  if (!client) return res.status(404).json({ error: 'not_found' });

  const template = await activeTemplate();
  const { profile } = await loadClientProfile(orgOf(req), clientId);
  const { selectedSections, sectionOrder } = normaliseSelection({});

  const therapistProfileId = isUuid(req.body?.therapistProfileId)
    ? req.body.therapistProfileId
    : (isUuid(req.user.therapist_profile_id) ? req.user.therapist_profile_id : null);

  const portal = await loadPortalData(req.user.id, therapistProfileId);

  // The document control values are ISSUED HERE, once, so they are visible in
  // the review step and can never be renumbered by a later generate. The id is
  // derived from the row's own uuid, which the database mints — so it is
  // written in a second statement rather than guessed beforehand.
  const { rows } = await pool.query(
    `INSERT INTO fca_report_drafts
       (organisation_id, client_id, client_name, client_preferred_name,
        therapist_profile_id, therapist_name, created_by_user_id,
        template_id, template_version, selected_sections, section_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [orgOf(req), clientId, client.fullName || null, profile?.preferred_name || null,
      therapistProfileId, portal.therapistName, req.user.id,
      template.id, template.version,
      JSON.stringify(selectedSections), JSON.stringify(sectionOrder)]
  );

  const issued = await pool.query(
    'UPDATE fca_report_drafts SET document_control = $2 WHERE id = $1 RETURNING *',
    [rows[0].id, JSON.stringify(issueDocumentControl(
      DOCUMENT_ID_PREFIX, rows[0].id, new Date(rows[0].created_at)
    ))]
  );
  rows[0] = issued.rows[0] || rows[0];

  const draft = await composeDraft(req, rows[0]);
  await audit(req, 'fca.draft_created', rows[0].id, { clientId, templateVersion: template.version });
  res.status(201).json({ draft });
}));

router.get('/api/fca/drafts', requireClinicalRead, safe(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, client_id, client_name, client_preferred_name, therapist_profile_id,
            therapist_name, template_id, template_version, status, missing_fields,
            excluded_fields, selected_sections, custom_sections,
            created_at, updated_at, generated_at, generated_document_id
       FROM fca_report_drafts
      WHERE organisation_id = $1 AND created_by_user_id = $2
      ORDER BY created_at DESC
      LIMIT 200`,
    [orgOf(req), req.user.id]
  );

  res.json({
    drafts: rows.map((r) => ({
      id: r.id,
      clientId: r.client_id,
      clientName: r.client_name,
      clientPreferredName: r.client_preferred_name,
      therapistProfileId: r.therapist_profile_id,
      therapistName: r.therapist_name,
      templateId: r.template_id,
      templateVersion: r.template_version,
      status: r.status,
      sectionCount: (r.selected_sections || []).length,
      customSectionCount: (r.custom_sections || []).length,
      // An excluded field is a decision, not an omission — the entry list
      // reports the two separately rather than counting one as the other.
      missingFields: (r.missing_fields || []).filter((t) => !(r.excluded_fields || []).includes(t)),
      excludedFields: r.excluded_fields || [],
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      generatedAt: r.generated_at,
      documentId: r.generated_document_id,
    })),
  });
}));

router.get('/api/fca/drafts/:id', requireClinicalRead, safe(async (req, res) => {
  const row = await loadOwnDraft(req, req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });

  try {
    const draft = await composeDraft(req, row, { frozen: row.status === 'generated' });
    res.json({ draft });
  } catch (err) {
    if (err.sploseFailure) {
      return res.status(503).json({ error: 'splose_unavailable', message: 'Client data is temporarily unavailable. Please try again shortly.' });
    }
    throw err;
  }
}));

router.patch('/api/fca/drafts/:id', requireClinicalWrite, safe(async (req, res) => {
  const row = await loadOwnDraft(req, req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  if (row.status !== 'draft') {
    return res.status(409).json({ error: 'not_editable', message: 'This report has already been generated.' });
  }

  const body = req.body || {};

  const selection = normaliseSelection({
    selectedSections: Object.prototype.hasOwnProperty.call(body, 'selectedSections')
      ? body.selectedSections : row.selected_sections,
    sectionOrder: Object.prototype.hasOwnProperty.call(body, 'sectionOrder')
      ? body.sectionOrder : row.section_order,
  });

  const customSections = Object.prototype.hasOwnProperty.call(body, 'customSections')
    ? normaliseCustomSections(body.customSections, randomUUID)
    : (row.custom_sections || []);

  // Merged, not replaced: the wizard PATCHes one field at a time.
  const overrides = Object.prototype.hasOwnProperty.call(body, 'scalarOverrides')
    ? { ...(row.scalar_overrides || {}), ...normaliseOverrides(body.scalarOverrides) }
    : (row.scalar_overrides || {});
  // An explicit null clears an override rather than storing a null value.
  for (const [k, v] of Object.entries(overrides)) if (v === null || v === '') delete overrides[k];

  // Replaced, not merged: exclusion is a SET the therapist owns outright, and
  // a merge would make un-excluding impossible to express.
  const excludedFields = Object.prototype.hasOwnProperty.call(body, 'excludedFields')
    ? normaliseExcludedFields(body.excludedFields)
    : normaliseExcludedFields(row.excluded_fields || []);

  // Excluding a field CLEARS any value typed for it. Keeping a hidden override
  // behind an excluded row would mean un-excluding silently resurrected a
  // value the therapist last saw struck through — so the two states are made
  // genuinely exclusive, and un-excluding falls back to whatever the layers
  // resolve, which is the honest answer.
  for (const tag of excludedFields) delete overrides[tag];

  // NOTHING here writes to the client profile. Editing a draft is not consent
  // to change a reusable client record; only POST /save-to-profile does that.
  const { rows } = await pool.query(
    `UPDATE fca_report_drafts
        SET selected_sections = $2, section_order = $3, custom_sections = $4,
            scalar_overrides = $5, excluded_fields = $6, updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [row.id, JSON.stringify(selection.selectedSections), JSON.stringify(selection.sectionOrder),
      JSON.stringify(customSections), JSON.stringify(overrides), JSON.stringify(excludedFields)]
  );

  try {
    res.json({ draft: await composeDraft(req, rows[0]) });
  } catch (err) {
    if (err.sploseFailure) {
      return res.status(503).json({ error: 'splose_unavailable', message: 'Client data is temporarily unavailable. Please try again shortly.' });
    }
    throw err;
  }
}));

router.delete('/api/fca/drafts/:id', requireClinicalWrite, safe(async (req, res) => {
  const row = await loadOwnDraft(req, req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });

  // Archive, never destroy: a generated report and its audit trail must survive.
  await pool.query(
    "UPDATE fca_report_drafts SET status = 'archived', updated_at = NOW() WHERE id = $1",
    [row.id]
  );
  await audit(req, 'fca.draft_archived', row.id, { clientId: row.client_id });
  res.json({ ok: true });
}));

// ── Save back to the client profile (explicit, permissioned, field-scoped) ───

router.post('/api/fca/drafts/:id/save-to-profile', requireClinicalWrite, safe(async (req, res) => {
  const row = await loadOwnDraft(req, req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });

  const requested = Array.isArray(req.body?.fields) ? req.body.fields.map(String) : [];
  if (requested.length === 0) return res.status(400).json({ error: 'fields is required' });

  const eligible = new Set(PROFILE_ELIGIBLE_TAGS);
  const planTags = new Set(PROFILE_PLAN_TAGS);
  const overrides = row.scalar_overrides || {};

  const accepted = [];
  const rejected = [];

  for (const tag of requested) {
    if (!SCALAR_BY_TAG.has(tag)) { rejected.push({ tag, reason: 'unknown_tag' }); continue; }
    if (!eligible.has(tag)) { rejected.push({ tag, reason: profileRejectionReason(tag) }); continue; }
    const value = overrides[tag];
    if (value === null || value === undefined || String(value).trim() === '') {
      rejected.push({ tag, reason: 'no_value_on_draft' });
      continue;
    }
    accepted.push(tag);
  }

  // A request that names any report-specific field writes NOTHING. Partially
  // honouring it would leave the therapist unsure what actually got saved.
  const hasIneligible = rejected.some((r) => r.reason !== 'no_value_on_draft');
  if (hasIneligible || accepted.length === 0) {
    const { profile, plans } = await loadClientProfile(row.organisation_id, row.client_id);
    return res.status(hasIneligible ? 400 : 200).json({
      profile: serialiseProfile(profile),
      plans: serialisePlans(plans),
      savedFields: [],
      rejected,
    });
  }

  const profileBody = {};
  const planBody = {};
  for (const tag of accepted) {
    const meta = SCALAR_BY_TAG.get(tag);
    const value = String(overrides[tag]).trim();
    if (meta.profileField) {
      const apiKey = PROFILE_COLUMNS.find(([, col]) => col === meta.profileField)?.[0];
      if (apiKey) profileBody[apiKey] = value;
    } else if (planTags.has(tag)) {
      planBody[meta.profilePlanField] = value;
    }
  }

  const client = await pool.connect();
  let profile;
  try {
    await client.query('BEGIN');
    profile = await upsertProfile(client, row.organisation_id, row.client_id, req.user.id, profileBody);

    if (Object.keys(planBody).length > 0) {
      // Plan or goal fields ALWAYS create a new plan version. The existing
      // current plan is superseded, not edited, so its dates and goals survive.
      const existing = await loadClientProfile(row.organisation_id, row.client_id);
      const cur = existing.currentPlan;
      const curGoals = (existing.goals || []).map((g) => g.goal_text);

      const goals = curGoals.slice();
      if (planBody['goal:0'] !== undefined) goals[0] = planBody['goal:0'];
      if (planBody['goal:1'] !== undefined) goals[1] = planBody['goal:1'];

      await supersedePlan(client, profile.id, req.user.id, {
        planStart: planBody.plan_start !== undefined ? planBody.plan_start : cur?.plan_start,
        planEnd: planBody.plan_end !== undefined ? planBody.plan_end : cur?.plan_end,
        goals: goals.filter((g) => g !== undefined && g !== null),
      });
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // Field NAMES only — never the values, which are client data.
  await audit(req, 'fca.client_profile_updated', profile.id, {
    clientId: row.client_id,
    draftId: row.id,
    fields: accepted,
    planSuperseded: Object.keys(planBody).length > 0,
  });

  const fresh = await loadClientProfile(row.organisation_id, row.client_id);
  res.json({
    profile: serialiseProfile(fresh.profile),
    plans: serialisePlans(fresh.plans),
    savedFields: accepted,
    rejected,
  });
}));

// ── Generate ─────────────────────────────────────────────────────────────────

function reportFilename(preferredName, fullName, generatedAt) {
  const name = String(preferredName || fullName || 'Participant').trim() || 'Participant';
  const safeName = name.replace(/[\\/:*?"<>|]/g, '-').slice(0, 80);
  return `FCA - ${safeName} - ${generatedAt.toISOString().slice(0, 10)}.docx`;
}

/**
 * Compose the DOCX for a draft — the whole four-layer resolve, manifest build
 * and render, with NO persistence.
 *
 * Extracted so the preview and the download are literally the same computation.
 * A preview that composed independently would be a second implementation of the
 * report, and the two would drift the first time either changed — which is the
 * failure mode "preview the actual document" exists to prevent.
 *
 * @returns {{buffer, manifest, missingFields, excludedFields, template, generatedAt}}
 * @throws  {Error} with .httpStatus/.httpBody for the caller to surface
 */
async function composeDraftDocx(row) {
  const template = await activeTemplate();

  let client;
  try {
    client = await loadSploseClient(row.client_id);
  } catch (err) {
    if (err.sploseFailure) {
      const e = new Error('splose_unavailable');
      e.httpStatus = 503;
      e.httpBody = { error: 'splose_unavailable', message: 'Client data is temporarily unavailable. Please try again shortly.' };
      throw e;
    }
    throw err;
  }

  const { profile, currentPlan, goals } = await loadClientProfile(row.organisation_id, row.client_id);
  const portal = await loadPortalData(row.created_by_user_id, row.therapist_profile_id);
  const generatedAt = new Date();
  const excludedFields = normaliseExcludedFields(row.excluded_fields || []);

  const { scalarData, scalarSources, missingFields } = resolveScalars({
    splose: client,
    profile,
    currentPlan,
    goals,
    overrides: row.scalar_overrides || {},
    portal,
    // The values issued when the draft was created — read, never re-minted, so
    // regenerating a report cannot renumber it.
    server: serverData(row),
  });

  const manifest = buildManifest({
    selectedSections: row.selected_sections || [],
    sectionOrder: row.section_order || [],
    customSections: row.custom_sections || [],
    scalarData,
    scalarSources,
    excludedFields,
  });

  let buffer;
  try {
    buffer = await generateFcaDocx({ templateBuffer: readTemplateBuffer(), manifest });
  } catch (err) {
    log.error('fca document composition failed', { error: err.message, draftId: row.id });
    const e = new Error('generation_failed');
    e.httpStatus = 500;
    e.httpBody = { error: 'generation_failed', message: 'The report could not be generated.' };
    throw e;
  }

  return { buffer, manifest, missingFields, excludedFields, template, generatedAt, scalarData, scalarSources };
}

/**
 * Exact preview: the composed DOCX bytes, rendered in the browser by the
 * vendored docx-preview. Nothing is stored — the bytes are composed on demand
 * and streamed, so there is no preview artefact to expire, leak or clean up,
 * and no clinical document leaves this origin.
 */
router.get('/api/fca/drafts/:id/preview.docx', requireClinicalRead, safe(async (req, res) => {
  const row = await loadOwnDraft(req, req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });

  let composed;
  try {
    composed = await composeDraftDocx(row);
  } catch (err) {
    if (err.httpStatus) return res.status(err.httpStatus).json(err.httpBody);
    throw err;
  }

  // The document's own page breaks, restated in the one form the browser
  // renderer reads. See fca/preview-pagination.js: the Opal template starts
  // each section with w:pageBreakBefore, which docx-preview parses and then
  // ignores — without this the whole report renders as a single endless sheet
  // with no page boundaries. The DOWNLOAD is deliberately not touched: Word
  // honours the property natively.
  const previewBuffer = await paginateForPreview(composed.buffer);

  // The draft revision travels back so the client can discard a response that
  // a newer edit has already superseded.
  res.setHeader('X-Opal-Draft-Revision', String(req.query.rev || ''));
  res.setHeader('Content-Type', DOCX_MIME);
  res.setHeader('Content-Length', String(previewBuffer.length));
  res.setHeader('Content-Disposition', 'inline; filename="preview.docx"');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.end(previewBuffer);
}));

router.post('/api/fca/drafts/:id/generate', requireClinicalWrite, safe(async (req, res) => {
  const row = await loadOwnDraft(req, req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  if (row.status === 'archived') return res.status(409).json({ error: 'archived' });

  // Identical composition to the preview — same helper, same inputs.
  let composed;
  try {
    composed = await composeDraftDocx(row);
  } catch (err) {
    if (err.httpStatus) return res.status(err.httpStatus).json(err.httpBody);
    throw err;
  }
  const { buffer, manifest, missingFields, excludedFields, template, generatedAt, scalarData, scalarSources } = composed;

  const warnings = (buffer.fcaStats?.warnings || []).slice();
  // An EXCLUDED field is not an outstanding one: the therapist has already
  // decided it does not belong, and nothing was inserted for it. Only the
  // genuinely unresolved fields are worth telling them about.
  const excludedSet = new Set(excludedFields);
  const unresolved = missingFields.filter((tag) => !excludedSet.has(tag));
  if (unresolved.length) {
    // Flagged, never fabricated.
    warnings.push(`${unresolved.length} field${unresolved.length === 1 ? '' : 's'} had no data and were left as template placeholders.`);
  }
  if (excludedFields.length) {
    warnings.push(`${excludedFields.length} field${excludedFields.length === 1 ? ' was' : 's were'} excluded and left blank in the document.`);
  }

  const preferredName = scalarData.OPAL_CLIENT_PREFERRED_NAME || row.client_preferred_name;
  const filename = reportFilename(preferredName, scalarData.OPAL_CLIENT_FULL_NAME || row.client_name, generatedAt);
  const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
  const base64 = buffer.toString('base64');

  const documentId = randomUUID();
  const { getBackend, getBackendName } = require('./storage');
  const backendName = getBackendName();
  const put = await getBackend(backendName).put({
    userId: req.user.id, docId: documentId, fileName: filename,
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    base64,
  });

  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    await dbClient.query(
      `INSERT INTO fca_generated_documents
         (id, draft_id, storage_backend, storage_key, file_data, filename, byte_size,
          checksum, template_version, created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [documentId, row.id, put.backend, put.storageKey || null,
        put.backend === 'db' ? base64 : null, filename, buffer.length,
        checksum, template.version, req.user.id]
    );
    await dbClient.query(
      // excluded_fields is written with the rest of the snapshot: what was
      // deliberately omitted is part of explaining an issued document.
      `UPDATE fca_report_drafts
          SET status = 'generated', scalar_snapshot = $2, scalar_sources = $3,
              missing_fields = $4, excluded_fields = $5, generated_document_id = $6,
              generated_at = $7, updated_at = NOW()
        WHERE id = $1`,
      [row.id, JSON.stringify(scalarData), JSON.stringify(scalarSources),
        JSON.stringify(missingFields), JSON.stringify(excludedFields),
        documentId, generatedAt]
    );
    await dbClient.query('COMMIT');
  } catch (err) {
    await dbClient.query('ROLLBACK').catch(() => {});
    await getBackend(backendName).remove({ backend: put.backend, storageKey: put.storageKey }).catch(() => {});
    throw err;
  } finally {
    dbClient.release();
  }

  const sectionCount = manifest.sections.filter((s) => s.kind !== 'custom' && s.included).length;
  const customSectionCount = manifest.sections.filter((s) => s.kind === 'custom').length;

  // ids, versions and counts. No names, no clinical content.
  await audit(req, 'fca.report_generated', row.id, {
    draftId: row.id,
    clientId: row.client_id,
    therapistProfileId: row.therapist_profile_id,
    templateVersion: template.version,
    sectionCount,
    customSectionCount,
    excludedFieldCount: excludedFields.length,
  });

  res.json({ documentId, filename, missingFields, excludedFields, warnings });
}));

// ── Download (authenticated, own-draft only) ─────────────────────────────────

router.get('/api/fca/documents/:documentId/download', requireClinicalRead, safe(async (req, res) => {
  if (!isUuid(req.params.documentId)) return res.status(404).json({ error: 'not_found' });

  const { rows } = await pool.query(
    `SELECT gd.* FROM fca_generated_documents gd
       JOIN fca_report_drafts d ON d.id = gd.draft_id
      WHERE gd.id = $1 AND d.organisation_id = $2 AND d.created_by_user_id = $3`,
    [req.params.documentId, orgOf(req), req.user.id]
  );
  const doc = rows[0];
  if (!doc) return res.status(404).json({ error: 'not_found' });

  const { getBackend } = require('./storage');
  let base64;
  try {
    ({ base64 } = await getBackend(doc.storage_backend || 'db').get({
      backend: doc.storage_backend, storageKey: doc.storage_key, fileData: doc.file_data,
    }));
  } catch (err) {
    log.error('fca download failed', { error: err.message, documentId: doc.id });
    return res.status(500).json({ error: 'download_failed' });
  }
  if (!base64) return res.status(404).json({ error: 'not_found' });

  await audit(req, 'fca.report_downloaded', doc.draft_id, { documentId: doc.id, templateVersion: doc.template_version });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.filename)}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(Buffer.from(base64, 'base64'));
}));

// ═══════════════════════════════════════════════════════════════════════════
//  Section presets (per user)
// ═══════════════════════════════════════════════════════════════════════════

router.get('/api/fca/presets', requireClinicalRead, safe(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM fca_section_presets WHERE user_id = $1 ORDER BY name ASC',
    [req.user.id]
  );
  res.json({
    presets: rows.map((p) => ({
      id: p.id, name: p.name,
      selectedSections: p.selected_sections || [],
      sectionOrder: p.section_order || [],
    })),
  });
}));

router.post('/api/fca/presets', requireClinicalWrite, safe(async (req, res) => {
  const name = str(req.body?.name, 80);
  if (!name) return res.status(400).json({ error: 'name is required' });

  const { selectedSections, sectionOrder } = normaliseSelection({
    selectedSections: req.body?.selectedSections,
    sectionOrder: req.body?.sectionOrder,
  });

  const { rows } = await pool.query(
    `INSERT INTO fca_section_presets (user_id, organisation_id, name, selected_sections, section_order)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (user_id, name)
     DO UPDATE SET selected_sections = EXCLUDED.selected_sections,
                   section_order = EXCLUDED.section_order
     RETURNING *`,
    [req.user.id, orgOf(req), name, JSON.stringify(selectedSections), JSON.stringify(sectionOrder)]
  );
  const p = rows[0];
  res.status(201).json({
    preset: {
      id: p.id, name: p.name,
      selectedSections: p.selected_sections || [],
      sectionOrder: p.section_order || [],
    },
  });
}));

router.delete('/api/fca/presets/:id', requireClinicalWrite, safe(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'not_found' });
  const { rowCount } = await pool.query(
    'DELETE FROM fca_section_presets WHERE id = $1 AND user_id = $2',
    [req.params.id, req.user.id]
  );
  if (!rowCount) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
}));

module.exports = router;
