'use strict';

/**
 * PROGRESS NOTE LETTER GENERATION
 *
 * A therapist picks a participant, chooses who the letter is addressed to,
 * chooses which blocks of the Opal progress-note letter belong in it, and
 * generates a styled Word document from the shipped template.
 *
 * This is the FCA report's machinery pointed at a second template. The engine,
 * the scalar resolver, the manifest composer, the data layers and the client
 * search are all SHARED — this file supplies the letter's routes, its
 * addressing rules and its validation, and nothing else.
 *
 * ── Hard rules enforced here ───────────────────────────────────────────────
 * - NO EXTERNAL AI. Nothing in this feature calls a model, of any kind, ever.
 * - THE MANIFEST IS THE SINGLE SOURCE OF TRUTH. The server composes it, the
 *   engine renders it, and the wizard preview displays the same object.
 * - THE SNAPSHOT IS FROZEN. Generation resolves every layer once and stores the
 *   result. Download re-reads that snapshot and never re-resolves, so an issued
 *   letter cannot quietly change when Splose, a profile or an org setting does.
 * - REQUIRED BLOCKS ARE NOT NEGOTIABLE. "Purpose and context" and "Therapy and
 *   progress update" are always in. A request that tries to deselect one is
 *   REFUSED with 400 rather than silently corrected — a therapist who thinks
 *   they removed a section and did not has been misled.
 * - NO UNRESOLVED PLACEHOLDER SHIPS. Every tag that cannot be cleaned away is
 *   required; generation is refused until it resolves, and the finished package
 *   is re-checked for "[PORTAL — …]" before a single byte is stored.
 * - OPAL ISSUES ONLY WHAT IS OPAL'S TO ISSUE. The document id is minted once,
 *   when the draft is created, and stored — so the review step shows the real
 *   reference instead of a field marked "Missing" that nobody could look up,
 *   and regenerating never renumbers a letter. The letter date has always
 *   defaulted to today for the same reason. Nothing else is auto-filled.
 * - EXCLUDING IS THE THERAPIST'S TO DECIDE. A field they say does not apply
 *   contributes NOTHING to the letter — its whole line goes where the template
 *   marks the tag as owning one, and otherwise it renders as an empty control
 *   — and an excluded field NEVER blocks generation, required or not.
 * - ORGANISATION ISOLATION. Every query filters organisation_id. Cross-org is
 *   404, not 403 — "you may not see this" already leaks that it exists.
 * - OWN-ONLY DRAFTS. A draft belongs to the user who created it. No role,
 *   owner included, reads another user's drafts.
 * - SAVE-BACK IS EXPLICIT. Choosing a recipient never writes to a client
 *   profile. Only POST /save-recipient-to-profile writes, and only when asked.
 * - PRIVACY. Audit rows carry ids, versions and counts. Never a participant
 *   name, never a recipient name, never a line of clinical narrative.
 *
 * ── Roles ──────────────────────────────────────────────────────────────────
 *   therapist, owner  create, edit, generate and download their OWN drafts
 *   read_only         read the template, client list, contacts and own drafts
 *   admin             NO ACCESS. Admin is a non-clinical scheduling role here.
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
const log = require('./logger').createLogger('letters');

const ltm = require('./fca/letter-template-map');
const { generateLetterDocx, assertNoPortalPlaceholders } = require('./fca/letter-blocks');
const { resolveScalars } = require('./fca/resolve-scalars');
const { issueDocumentControl, documentControlFor } = require('./fca/document-id');
const { searchClients } = require('./fca/client-search');
const {
  loadSploseClient,
  loadClientProfile,
  loadPortalData,
  loadOrganisationSettings,
  isUuid,
} = require('./fca/data-layers');
const {
  normaliseSelection,
  normaliseCustomSections,
  normaliseOverrides,
  normaliseExcludedFields,
  buildManifest,
} = require('./fca/manifest');

const {
  LETTER_DOCUMENT_TYPE,
  LETTER_TEMPLATE_ID,
  LETTER_TEMPLATE_VERSION,
  LETTER_TEMPLATE_NAME,
  LETTER_TEMPLATE_FILENAME,
  LETTER_TEMPLATE_STORAGE_PATH,
  LETTER_DOCUMENT_ID_PREFIX,
  LETTER_REQUIRED_SECTION_TAGS,
  LETTER_SECTION_BY_TAG,
  LETTER_SCALAR_BY_TAG,
  LETTER_REQUIRED_VALUE_TAGS,
  LETTER_MAX_OVERRIDE_CHARS,
  LETTER_MAX_CC_RECIPIENTS,
  RECIPIENT_TARGETS,
  RECIPIENT_PROFILE_COLUMN,
  RECIPIENT_SOURCE_ROLE,
  LETTER_MANIFEST_CATALOGUE,
  LETTER_SCALAR_CATALOGUE,
  letterTemplateDescriptor,
} = ltm;

const TEMPLATE_FILE = path.join(__dirname, 'fca', 'templates', LETTER_TEMPLATE_FILENAME);

// ── House conventions ───────────────────────────────────────────────────────

const safe = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  // Message only — request bodies carry participant, recipient and clinical content.
  log.error('letter route error', { error: err.message, path: req.path });
  if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
});

const orgOf = (req) => req.user?.organisation_id || null;
const str = (v, max) => (v === null || v === undefined ? null : String(v).trim().slice(0, max) || null);

/** Multi-line free text: internal newlines are meaningful and are preserved. */
const multiline = (v, max) => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  return s === '' ? null : s.slice(0, max);
};

async function audit(req, action, targetId, extraMeta = {}) {
  // ids, versions and counts only — never names, never clinical content.
  await db.logAuditEvent({
    action,
    targetType: 'progress_note_letter',
    targetId,
    actorUserId: req.user?.id,
    organisationId: orgOf(req),
    ipAddress: req.ip,
    metadata: { ...extraMeta },
  }).catch(() => {});
}

const CLINICAL_ROLES = new Set(['therapist', 'owner']);

/** Clinical write access: create/edit/generate letters. */
function requireClinicalWrite(req, res, next) {
  const role = req.user?.role;
  if (!CLINICAL_ROLES.has(role)) {
    return res.status(403).json({ error: 'forbidden', message: 'Letter generation is limited to treating therapists.' });
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
    return res.status(403).json({ error: 'forbidden', message: 'Letter generation is limited to treating therapists.' });
  }
  if (!orgOf(req)) {
    return res.status(403).json({ error: 'no_organisation', message: 'Your account is not linked to an organisation.' });
  }
  next();
}

router.use('/api/letters', requireAuth);

// ── Template registry ───────────────────────────────────────────────────────

let templateBufferCache = null;

function readTemplateBuffer() {
  if (!templateBufferCache) templateBufferCache = fs.readFileSync(TEMPLATE_FILE);
  return templateBufferCache;
}

/**
 * The active letter template row, created on first use from the shipped file.
 * The SAME fca_templates table the report uses, distinguished by document_type.
 * Rows are immutable once generated from (trigger in migration 018).
 */
async function activeTemplate() {
  const found = await pool.query(
    'SELECT * FROM fca_templates WHERE template_key = $1 AND version = $2 LIMIT 1',
    [LETTER_TEMPLATE_ID, LETTER_TEMPLATE_VERSION]
  );
  if (found.rows[0]) return found.rows[0];

  const checksum = crypto.createHash('sha256').update(readTemplateBuffer()).digest('hex');
  const ins = await pool.query(
    `INSERT INTO fca_templates (template_key, version, name, storage_path, checksum, is_active, document_type)
     VALUES ($1,$2,$3,$4,$5,TRUE,$6)
     ON CONFLICT (template_key, version) DO NOTHING
     RETURNING *`,
    [LETTER_TEMPLATE_ID, LETTER_TEMPLATE_VERSION, LETTER_TEMPLATE_NAME,
      LETTER_TEMPLATE_STORAGE_PATH, checksum, LETTER_DOCUMENT_TYPE]
  );
  if (ins.rows[0]) return ins.rows[0];

  // Lost the race with a concurrent request — read the row it inserted.
  const again = await pool.query(
    'SELECT * FROM fca_templates WHERE template_key = $1 AND version = $2 LIMIT 1',
    [LETTER_TEMPLATE_ID, LETTER_TEMPLATE_VERSION]
  );
  return again.rows[0];
}

// ── Letter-specific normalisation ───────────────────────────────────────────

const RECIPIENT_FIELD_LIMIT = 200;

/** The recipient snapshot. Free text only — nothing here is looked up again. */
function normaliseRecipient(recipient) {
  if (!recipient || typeof recipient !== 'object' || Array.isArray(recipient)) return {};
  return {
    name: str(recipient.name, RECIPIENT_FIELD_LIMIT),
    role: str(recipient.role, RECIPIENT_FIELD_LIMIT),
    organisation: str(recipient.organisation, RECIPIENT_FIELD_LIMIT),
    address: multiline(recipient.address, LETTER_MAX_OVERRIDE_CHARS),
    salutation: str(recipient.salutation, RECIPIENT_FIELD_LIMIT),
  };
}

function normaliseCcRecipients(cc) {
  if (!Array.isArray(cc)) return [];
  return cc
    .filter((c) => c && typeof c === 'object' && str(c.name, RECIPIENT_FIELD_LIMIT))
    .slice(0, LETTER_MAX_CC_RECIPIENTS)
    .map((c) => ({
      name: str(c.name, RECIPIENT_FIELD_LIMIT),
      organisation: str(c.organisation, RECIPIENT_FIELD_LIMIT),
    }));
}

/**
 * Only the keys the caller actually sent. The wizard PATCHes one field at a
 * time, so treating an absent key as "clear it" would wipe the letter date the
 * moment a therapist typed a subject.
 */
function normaliseLetterDetails(details) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return {};
  const limits = { letterDate: 40, subject: 300, reportingPeriod: 200 };
  const out = {};
  for (const [key, max] of Object.entries(limits)) {
    if (Object.prototype.hasOwnProperty.call(details, key)) out[key] = str(details[key], max);
  }
  return out;
}

/**
 * The scalar tag each structured letter field owns.
 *
 * ONE table, used for two things: composing the overrides that feed the
 * resolver, and telling the wizard which of its own addressing fields the
 * therapist has excluded. The wizard therefore needs no template tag of its
 * own — the front end deliberately contains not a single merge tag, because a
 * second copy of the template contract would drift the moment the template did.
 */
const LETTER_FIELD_TAGS = {
  recipientName: 'OPAL_LETTER_RECIPIENT_NAME',
  recipientRole: 'OPAL_LETTER_RECIPIENT_ROLE',
  recipientOrganisation: 'OPAL_LETTER_RECIPIENT_ORGANISATION',
  recipientAddress: 'OPAL_LETTER_RECIPIENT_ADDRESS',
  salutation: 'OPAL_LETTER_SALUTATION',
  letterDate: 'OPAL_LETTER_DATE',
  subject: 'OPAL_LETTER_SUBJECT',
  reportingPeriod: 'OPAL_LETTER_REPORTING_PERIOD',
  cc: 'OPAL_LETTER_CC',
  documentId: 'OPAL_LETTER_DOCUMENT_ID',
};

/**
 * The nine scalar tags the structured letter fields own.
 *
 * A structured value WINS over a raw scalarOverride for the tag it owns,
 * because the structured field is what the wizard writes and what the therapist
 * can see; a raw override only fills a gap the structured field left empty.
 */
function scalarsFromLetterFields(recipient, ccRecipients, details) {
  const cc = (ccRecipients || [])
    .map((c) => [c.name, c.organisation].filter(Boolean).join(', '))
    .filter(Boolean)
    // Real line breaks: the engine renders these as w:br inside the control.
    .join('\n');

  return {
    [LETTER_FIELD_TAGS.recipientName]: recipient?.name || null,
    [LETTER_FIELD_TAGS.recipientRole]: recipient?.role || null,
    [LETTER_FIELD_TAGS.recipientOrganisation]: recipient?.organisation || null,
    [LETTER_FIELD_TAGS.recipientAddress]: recipient?.address || null,
    [LETTER_FIELD_TAGS.salutation]: recipient?.salutation || null,
    [LETTER_FIELD_TAGS.letterDate]: details?.letterDate || null,
    [LETTER_FIELD_TAGS.subject]: details?.subject || null,
    [LETTER_FIELD_TAGS.reportingPeriod]: details?.reportingPeriod || null,
    [LETTER_FIELD_TAGS.cc]: cc || null,
  };
}

/**
 * Which of the wizard's own addressing fields are excluded.
 *
 * The addressing block of the preview is drawn from the draft's structured
 * snapshots rather than from the manifest's scalar list, so it needs to be told
 * — by the server, in the server's own vocabulary — which of those lines the
 * document will not contain. Without this the preview would show a subject line
 * that the .docx omits, which is exactly the disagreement this design exists to
 * prevent.
 */
function excludedLetterFields(excludedTags) {
  const excluded = new Set(excludedTags || []);
  const out = {};
  for (const [field, tag] of Object.entries(LETTER_FIELD_TAGS)) {
    if (excluded.has(tag)) out[field] = true;
  }
  return out;
}

/**
 * The document-control values OPAL ISSUES for this letter.
 *
 * Minted ONCE, when the draft is created, and stored on the row — so the
 * review step shows the real reference rather than a "Missing" row nobody
 * could fill, and a second generate cannot mint a second reference. The shared
 * issuer also carries a version and status; this template has no control for
 * either, so they are stored and simply never rendered.
 */
function serverData(row) {
  return documentControlFor(LETTER_DOCUMENT_ID_PREFIX, row);
}

/** Structured fields on top of raw overrides, blanks not overwriting anything. */
function mergedOverrides(row) {
  const out = { ...(row.scalar_overrides || {}) };
  const derived = scalarsFromLetterFields(
    row.letter_recipient || {}, row.letter_cc_recipients || [], row.letter_details || {}
  );
  for (const [tag, value] of Object.entries(derived)) {
    if (value !== null && value !== undefined && String(value).trim() !== '') out[tag] = value;
  }
  return out;
}

// ── Draft composition ───────────────────────────────────────────────────────

/**
 * Resolve every layer for a draft.
 * `frozen` uses the stored snapshot verbatim — never re-resolving is the whole
 * point of freezing it.
 */
async function composeDraft(row, { frozen = false } = {}) {
  const selection = normaliseSelection({
    selectedSections: row.selected_sections || [],
    sectionOrder: row.section_order || [],
  }, LETTER_MANIFEST_CATALOGUE);
  const customSections = row.custom_sections || [];
  const excludedFields = normaliseExcludedFields(row.excluded_fields || [], LETTER_MANIFEST_CATALOGUE);

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
    const organisation = await loadOrganisationSettings(row.organisation_id);
    ({ scalarData, scalarSources, missingFields } = resolveScalars({
      splose: client,
      profile,
      currentPlan,
      goals,
      overrides: mergedOverrides(row),
      portal,
      organisation,
      // Issued when this draft was created, so the therapist reviews the real
      // document reference rather than a "Missing" row they cannot resolve.
      server: serverData(row),
      catalogue: LETTER_SCALAR_CATALOGUE,
    }));
  }

  const manifest = buildManifest({
    ...selection,
    customSections,
    scalarData,
    scalarSources,
    excludedFields,
  }, LETTER_MANIFEST_CATALOGUE);

  const details = row.letter_details || {};

  return {
    id: row.id,
    documentType: LETTER_DOCUMENT_TYPE,
    clientId: row.client_id,
    clientName: row.client_name,
    clientPreferredName: row.client_preferred_name,
    therapistProfileId: row.therapist_profile_id,
    therapistName: row.therapist_name,
    templateId: row.template_id,
    templateVersion: row.template_version,
    status: row.status,
    recipient: row.letter_recipient || {},
    ccRecipients: row.letter_cc_recipients || [],
    letterDetails: {
      letterDate: details.letterDate ?? null,
      subject: details.subject ?? null,
      reportingPeriod: details.reportingPeriod ?? null,
      // Issued by Opal when the draft was created, so it is real from the
      // review step onward rather than appearing only after generation.
      documentId: scalarData.OPAL_LETTER_DOCUMENT_ID || null,
    },
    selectedSections: selection.selectedSections,
    sectionOrder: selection.sectionOrder,
    customSections,
    excludedFields,
    // The same exclusion, restated in the wizard's own field vocabulary so the
    // front end never has to know a template tag.
    excludedLetterFields: excludedLetterFields(excludedFields),
    manifest,
    missingFields,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    generatedAt: row.generated_at,
    documentId: row.generated_document_id,
  };
}

/** Own draft, in the caller's organisation, of THIS document type. Else 404. */
async function loadOwnDraft(req, id) {
  if (!isUuid(id)) return null;
  const { rows } = await pool.query(
    `SELECT * FROM fca_report_drafts
      WHERE id = $1 AND organisation_id = $2 AND created_by_user_id = $3
        AND document_type = $4`,
    [id, orgOf(req), req.user.id, LETTER_DOCUMENT_TYPE]
  );
  return rows[0] || null;
}

const sploseDown = (res) => res.status(503).json({
  error: 'splose_unavailable',
  message: 'Client data is temporarily unavailable. Please try again shortly.',
});

// ═══════════════════════════════════════════════════════════════════════════
//  Template
// ═══════════════════════════════════════════════════════════════════════════

router.get('/api/letters/template', requireClinicalRead, safe(async (req, res) => {
  res.json({ template: letterTemplateDescriptor() });
}));

// ═══════════════════════════════════════════════════════════════════════════
//  Clients (Splose, live) — the same behaviour the FCA wizard has
// ═══════════════════════════════════════════════════════════════════════════

router.get('/api/letters/clients', requireClinicalRead, safe(async (req, res) => {
  let clients;
  try {
    clients = await searchClients(orgOf(req), req.query.q);
  } catch (err) {
    log.warn('splose client list unavailable', { error: err.cause || err.message });
    return sploseDown(res);
  }
  res.json({ clients });
}));

// ═══════════════════════════════════════════════════════════════════════════
//  Contacts — recipient suggestions from the client report profile
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Turn one free-text profile detail into a contact suggestion.
 *
 * The profile stores support coordinator, nominee and referrer as free text,
 * because that is what a therapist types. NOTHING is parsed out of it beyond
 * the split every writer already intends: the FIRST line is the person, the
 * REST is their address. Role is not inferred from the words — it is the name
 * of the field the value was stored in, which is a fact rather than a guess —
 * and organisation is left null rather than invented. The therapist edits the
 * result before it goes anywhere near a document.
 */
function contactFromDetails(source, details) {
  const text = String(details || '').replace(/\r\n/g, '\n').trim();
  if (!text) return null;

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const name = lines[0] || null;
  const address = lines.length > 1 ? lines.slice(1).join('\n') : null;

  return {
    source,
    name,
    role: RECIPIENT_SOURCE_ROLE[source] || null,
    organisation: null,
    address,
    // A salutation is the recipient's own name until a therapist says otherwise.
    salutation: name,
  };
}

/** A saved contact is already structured — read it, do not reinterpret it. */
function contactFromSaved(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const name = str(entry.name, RECIPIENT_FIELD_LIMIT);
  if (!name) return null;
  return {
    source: 'saved_contact',
    name,
    role: str(entry.role, RECIPIENT_FIELD_LIMIT),
    organisation: str(entry.organisation, RECIPIENT_FIELD_LIMIT),
    address: multiline(entry.address, LETTER_MAX_OVERRIDE_CHARS),
    salutation: str(entry.salutation, RECIPIENT_FIELD_LIMIT) || name,
  };
}

router.get('/api/letters/clients/:clientId/contacts', requireClinicalRead, safe(async (req, res) => {
  const { profile } = await loadClientProfile(orgOf(req), req.params.clientId);

  const contacts = [];
  if (profile) {
    for (const [source, column] of Object.entries(RECIPIENT_PROFILE_COLUMN)) {
      const contact = contactFromDetails(source, profile[column]);
      if (contact) contacts.push(contact);
    }
    for (const entry of (profile.other_contacts || [])) {
      const contact = contactFromSaved(entry);
      if (contact) contacts.push(contact);
    }
  }

  res.json({ contacts });
}));

// ═══════════════════════════════════════════════════════════════════════════
//  Drafts
// ═══════════════════════════════════════════════════════════════════════════

router.post('/api/letters/drafts', requireClinicalWrite, safe(async (req, res) => {
  const clientId = str(req.body?.clientId, 100);
  if (!clientId) return res.status(400).json({ error: 'clientId is required' });

  let client;
  try {
    client = await loadSploseClient(clientId);
  } catch (err) {
    if (err.sploseFailure) return sploseDown(res);
    throw err;
  }
  if (!client) return res.status(404).json({ error: 'not_found' });

  const template = await activeTemplate();
  const { profile } = await loadClientProfile(orgOf(req), clientId);
  const { selectedSections, sectionOrder } = normaliseSelection({}, LETTER_MANIFEST_CATALOGUE);

  const therapistProfileId = isUuid(req.body?.therapistProfileId)
    ? req.body.therapistProfileId
    : (isUuid(req.user.therapist_profile_id) ? req.user.therapist_profile_id : null);

  const portal = await loadPortalData(req.user.id, therapistProfileId);

  // The letter date defaults to today. It is a real, known, server-side fact —
  // not an inference — and the therapist can change it before generating.
  const letterDetails = { letterDate: new Date().toISOString().slice(0, 10), subject: null, reportingPeriod: null };

  const { rows } = await pool.query(
    `INSERT INTO fca_report_drafts
       (organisation_id, document_type, client_id, client_name, client_preferred_name,
        therapist_profile_id, therapist_name, created_by_user_id,
        template_id, template_version, selected_sections, section_order, letter_details)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [orgOf(req), LETTER_DOCUMENT_TYPE, clientId, client.fullName || null, profile?.preferred_name || null,
      therapistProfileId, portal.therapistName, req.user.id,
      template.id, template.version,
      JSON.stringify(selectedSections), JSON.stringify(sectionOrder), JSON.stringify(letterDetails)]
  );

  // The document reference is ISSUED HERE, once, so it is visible in review and
  // can never be renumbered by a later generate. It is derived from the row's
  // own uuid, which the database mints — hence a second statement rather than
  // a value guessed beforehand.
  const issued = await pool.query(
    'UPDATE fca_report_drafts SET document_control = $2 WHERE id = $1 RETURNING *',
    [rows[0].id, JSON.stringify(issueDocumentControl(
      LETTER_DOCUMENT_ID_PREFIX, rows[0].id, new Date(rows[0].created_at)
    ))]
  );
  rows[0] = issued.rows[0] || rows[0];

  const draft = await composeDraft(rows[0]);
  await audit(req, 'letter.draft_created', rows[0].id, { clientId, templateVersion: template.version });
  res.status(201).json({ draft });
}));

router.get('/api/letters/drafts', requireClinicalRead, safe(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, client_id, client_name, client_preferred_name, therapist_profile_id,
            therapist_name, template_id, template_version, status, missing_fields,
            excluded_fields, selected_sections, custom_sections, letter_recipient,
            letter_details, created_at, updated_at, generated_at, generated_document_id
       FROM fca_report_drafts
      WHERE organisation_id = $1 AND created_by_user_id = $2 AND document_type = $3
      ORDER BY created_at DESC
      LIMIT 200`,
    [orgOf(req), req.user.id, LETTER_DOCUMENT_TYPE]
  );

  res.json({
    drafts: rows.map((r) => ({
      id: r.id,
      documentType: LETTER_DOCUMENT_TYPE,
      clientId: r.client_id,
      clientName: r.client_name,
      clientPreferredName: r.client_preferred_name,
      therapistProfileId: r.therapist_profile_id,
      therapistName: r.therapist_name,
      templateId: r.template_id,
      templateVersion: r.template_version,
      status: r.status,
      recipientName: (r.letter_recipient || {}).name || null,
      subject: (r.letter_details || {}).subject || null,
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

router.get('/api/letters/drafts/:id', requireClinicalRead, safe(async (req, res) => {
  const row = await loadOwnDraft(req, req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });

  try {
    res.json({ draft: await composeDraft(row, { frozen: row.status === 'generated' }) });
  } catch (err) {
    if (err.sploseFailure) return sploseDown(res);
    throw err;
  }
}));

router.patch('/api/letters/drafts/:id', requireClinicalWrite, safe(async (req, res) => {
  const row = await loadOwnDraft(req, req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  if (row.status !== 'draft') {
    return res.status(409).json({ error: 'not_editable', message: 'This letter has already been generated.' });
  }

  const body = req.body || {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);

  // ── Required blocks may not be deselected ────────────────────────────────
  // The manifest composer would silently re-add them, which is safe but not
  // honest: a therapist who believes they removed "Purpose and context" and
  // did not has been misled about what they are about to send.
  if (has('selectedSections')) {
    if (!Array.isArray(body.selectedSections)) {
      return res.status(400).json({ error: 'invalid_selection', message: 'selectedSections must be an array of block tags.' });
    }
    const requested = new Set(body.selectedSections.filter((t) => LETTER_SECTION_BY_TAG.has(t)));
    const dropped = LETTER_REQUIRED_SECTION_TAGS.filter((t) => !requested.has(t));
    if (dropped.length) {
      return res.status(400).json({
        error: 'required_section',
        message: `${dropped.map((t) => LETTER_SECTION_BY_TAG.get(t).label).join(' and ')} cannot be removed from a progress note letter.`,
        requiredSections: dropped,
      });
    }
  }

  const selection = normaliseSelection({
    selectedSections: has('selectedSections') ? body.selectedSections : row.selected_sections,
    sectionOrder: has('sectionOrder') ? body.sectionOrder : row.section_order,
  }, LETTER_MANIFEST_CATALOGUE);

  const customSections = has('customSections')
    ? normaliseCustomSections(body.customSections, randomUUID, LETTER_MANIFEST_CATALOGUE)
    : (row.custom_sections || []);

  const recipient = has('recipient')
    ? normaliseRecipient(body.recipient)
    : (row.letter_recipient || {});
  const ccRecipients = has('ccRecipients')
    ? normaliseCcRecipients(body.ccRecipients)
    : (row.letter_cc_recipients || []);
  const letterDetails = has('letterDetails')
    ? { ...(row.letter_details || {}), ...normaliseLetterDetails(body.letterDetails) }
    : (row.letter_details || {});

  // Merged, not replaced: the wizard PATCHes one field at a time.
  const overrides = has('scalarOverrides')
    ? { ...(row.scalar_overrides || {}), ...normaliseOverrides(body.scalarOverrides, LETTER_MANIFEST_CATALOGUE) }
    : (row.scalar_overrides || {});
  // An explicit null clears an override rather than storing a null value.
  for (const [k, v] of Object.entries(overrides)) if (v === null || v === '') delete overrides[k];

  // Replaced, not merged: exclusion is a SET the therapist owns outright, and
  // a merge would make un-excluding impossible to express.
  const excludedFields = has('excludedFields')
    ? normaliseExcludedFields(body.excludedFields, LETTER_MANIFEST_CATALOGUE)
    : normaliseExcludedFields(row.excluded_fields || [], LETTER_MANIFEST_CATALOGUE);

  // Excluding a field CLEARS any value typed for it, so un-excluding cannot
  // silently resurrect a value the therapist last saw struck through.
  for (const tag of excludedFields) delete overrides[tag];

  // NOTHING here writes to the client profile. Choosing a recipient is not
  // consent to change a reusable client record; only the explicit
  // save-recipient-to-profile route does that.
  const { rows } = await pool.query(
    `UPDATE fca_report_drafts
        SET selected_sections = $2, section_order = $3, custom_sections = $4,
            scalar_overrides = $5, letter_recipient = $6, letter_cc_recipients = $7,
            letter_details = $8, excluded_fields = $9, updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [row.id, JSON.stringify(selection.selectedSections), JSON.stringify(selection.sectionOrder),
      JSON.stringify(customSections), JSON.stringify(overrides),
      JSON.stringify(recipient), JSON.stringify(ccRecipients), JSON.stringify(letterDetails),
      JSON.stringify(excludedFields)]
  );

  try {
    res.json({ draft: await composeDraft(rows[0]) });
  } catch (err) {
    if (err.sploseFailure) return sploseDown(res);
    throw err;
  }
}));

router.delete('/api/letters/drafts/:id', requireClinicalWrite, safe(async (req, res) => {
  const row = await loadOwnDraft(req, req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });

  // Archive, never destroy: an issued letter and its audit trail must survive.
  await pool.query(
    "UPDATE fca_report_drafts SET status = 'archived', updated_at = NOW() WHERE id = $1",
    [row.id]
  );
  await audit(req, 'letter.draft_archived', row.id, { clientId: row.client_id });
  res.json({ ok: true });
}));

// ═══════════════════════════════════════════════════════════════════════════
//  Save the recipient back to the client profile (EXPLICIT only)
// ═══════════════════════════════════════════════════════════════════════════

/** The free-text shape the profile's detail columns store. */
function recipientToDetails(recipient) {
  return [recipient.name, recipient.organisation, recipient.address]
    .filter((v) => v && String(v).trim())
    .join('\n');
}

router.post('/api/letters/drafts/:id/save-recipient-to-profile', requireClinicalWrite, safe(async (req, res) => {
  const row = await loadOwnDraft(req, req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });

  const target = String(req.body?.target || '');
  if (!RECIPIENT_TARGETS.includes(target)) {
    return res.status(400).json({
      error: 'invalid_target',
      message: `target must be one of ${RECIPIENT_TARGETS.join(', ')}.`,
    });
  }

  const recipient = row.letter_recipient || {};
  if (!recipient.name) {
    return res.status(400).json({ error: 'no_recipient', message: 'This letter has no recipient to save.' });
  }

  const client = await pool.connect();
  let profile;
  try {
    await client.query('BEGIN');

    if (target === 'saved_contact') {
      // Appended to the profile's structured contact list, de-duplicated by
      // name so saving twice does not grow the list forever.
      const existing = await client.query(
        `SELECT id, other_contacts FROM fca_client_profiles
          WHERE organisation_id = $1 AND splose_client_id = $2`,
        [row.organisation_id, String(row.client_id)]
      );
      const current = existing.rows[0]?.other_contacts || [];
      const entry = {
        name: recipient.name,
        role: recipient.role || null,
        organisation: recipient.organisation || null,
        address: recipient.address || null,
        salutation: recipient.salutation || null,
        savedAt: new Date().toISOString(),
      };
      const next = [...current.filter((c) => c && c.name !== entry.name), entry].slice(-20);

      const upserted = await client.query(
        `INSERT INTO fca_client_profiles
           (organisation_id, splose_client_id, created_by_user_id, updated_by_user_id, other_contacts)
         VALUES ($1,$2,$3,$3,$4::jsonb)
         ON CONFLICT (organisation_id, splose_client_id)
         DO UPDATE SET other_contacts = EXCLUDED.other_contacts,
                       updated_by_user_id = EXCLUDED.updated_by_user_id,
                       updated_at = NOW()
         RETURNING *`,
        [row.organisation_id, String(row.client_id), req.user.id, JSON.stringify(next)]
      );
      profile = upserted.rows[0];
    } else {
      const column = RECIPIENT_PROFILE_COLUMN[target];
      const upserted = await client.query(
        `INSERT INTO fca_client_profiles
           (organisation_id, splose_client_id, created_by_user_id, updated_by_user_id, ${column})
         VALUES ($1,$2,$3,$3,$4)
         ON CONFLICT (organisation_id, splose_client_id)
         DO UPDATE SET ${column} = EXCLUDED.${column},
                       updated_by_user_id = EXCLUDED.updated_by_user_id,
                       updated_at = NOW()
         RETURNING *`,
        [row.organisation_id, String(row.client_id), req.user.id, recipientToDetails(recipient)]
      );
      profile = upserted.rows[0];
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // The TARGET only. The recipient's name and address are personal data and
  // never enter an audit row.
  await audit(req, 'letter.recipient_saved_to_profile', profile.id, {
    clientId: row.client_id, draftId: row.id, target,
  });

  res.json({
    profile: {
      id: profile.id,
      clientId: profile.splose_client_id,
      supportCoordinatorDetails: profile.support_coordinator_details,
      nomineeDetails: profile.nominee_details,
      referrerDetails: profile.referrer_details,
      otherContacts: profile.other_contacts || [],
      updatedAt: profile.updated_at,
    },
    saved: target,
  });
}));

// ═══════════════════════════════════════════════════════════════════════════
//  Generate
// ═══════════════════════════════════════════════════════════════════════════

function letterFilename(preferredName, fullName, generatedAt) {
  const name = String(preferredName || fullName || 'Participant').trim() || 'Participant';
  const safeName = name.replace(/[\\/:*?"<>| -]/g, '-').slice(0, 80);
  return `Progress Note Letter - ${safeName} - ${generatedAt.toISOString().slice(0, 10)}.docx`;
}

router.post('/api/letters/drafts/:id/generate', requireClinicalWrite, safe(async (req, res) => {
  const row = await loadOwnDraft(req, req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  if (row.status === 'archived') return res.status(409).json({ error: 'archived' });

  const template = await activeTemplate();

  // ── Resolve every layer ONCE, then freeze ────────────────────────────────
  let client;
  try {
    client = await loadSploseClient(row.client_id);
  } catch (err) {
    if (err.sploseFailure) return sploseDown(res);
    throw err;
  }

  const { profile, currentPlan, goals } = await loadClientProfile(row.organisation_id, row.client_id);
  const portal = await loadPortalData(row.created_by_user_id, row.therapist_profile_id);
  const organisation = await loadOrganisationSettings(row.organisation_id);
  const generatedAt = new Date();
  const excludedFields = normaliseExcludedFields(row.excluded_fields || [], LETTER_MANIFEST_CATALOGUE);
  const excludedSet = new Set(excludedFields);

  const { scalarData, scalarSources, missingFields } = resolveScalars({
    splose: client,
    profile,
    currentPlan,
    goals,
    overrides: mergedOverrides(row),
    portal,
    organisation,
    // Issued when the draft was created — read, never re-minted, so
    // regenerating a letter cannot renumber it.
    server: serverData(row),
    catalogue: LETTER_SCALAR_CATALOGUE,
  });

  // ── Required-value validation BLOCKS generation ──────────────────────────
  // Every one of these controls shares its paragraph with sentence text or a
  // literal label, so there is no way to remove it cleanly. Shipping the
  // template's own "[PORTAL — …]" placeholder to a plan manager is not an
  // option, and neither is inventing a value, so the only honest outcome is to
  // refuse and say exactly what is outstanding.
  //
  // An EXCLUDED tag is never outstanding. The therapist has said there is
  // nothing to put there, the engine writes an empty control rather than a
  // placeholder, and the finished package is still checked for "[PORTAL — …]"
  // afterwards — so the promise this validation exists to keep is kept by the
  // check that is actually about the bytes, not by refusing a request the
  // therapist has already answered.
  const outstanding = LETTER_REQUIRED_VALUE_TAGS.filter((tag) => {
    if (excludedSet.has(tag)) return false;
    const v = scalarData[tag];
    return v === null || v === undefined || String(v).trim() === '';
  });
  if (outstanding.length) {
    return res.status(400).json({
      error: 'missing_required_fields',
      message: `This letter cannot be generated yet. Please complete: ${
        outstanding.map((t) => LETTER_SCALAR_BY_TAG.get(t)?.label || t).join(', ')}.`,
      missingFields: outstanding,
    });
  }

  const manifest = buildManifest({
    selectedSections: row.selected_sections || [],
    sectionOrder: row.section_order || [],
    customSections: row.custom_sections || [],
    scalarData,
    scalarSources,
    excludedFields,
  }, LETTER_MANIFEST_CATALOGUE);

  // ── Render, validate, store ──────────────────────────────────────────────
  let buffer;
  try {
    buffer = await generateLetterDocx({ templateBuffer: readTemplateBuffer(), manifest });
    await assertNoPortalPlaceholders(buffer);
  } catch (err) {
    log.error('letter generation failed', { error: err.message, draftId: row.id });
    return res.status(500).json({ error: 'generation_failed', message: 'The letter could not be generated.' });
  }

  const warnings = (buffer.docxStats?.warnings || []).slice();
  // An excluded field is a decision, not an omission, so the two are counted
  // and reported separately.
  const unresolved = missingFields.filter((tag) => !excludedSet.has(tag));
  if (unresolved.length) {
    // Flagged, never fabricated. Only optional lines can reach here — every
    // required tag was validated above — and those lines were removed outright.
    warnings.push(`${unresolved.length} optional field${unresolved.length === 1 ? ' was' : 's were'} not supplied; their lines were removed from the letter.`);
  }
  if (excludedFields.length) {
    warnings.push(`${excludedFields.length} field${excludedFields.length === 1 ? ' was' : 's were'} excluded; nothing was inserted for ${excludedFields.length === 1 ? 'it' : 'them'}.`);
  }

  const preferredName = scalarData.OPAL_CLIENT_PREFERRED_NAME || row.client_preferred_name;
  const filename = letterFilename(preferredName, scalarData.OPAL_CLIENT_FULL_NAME || row.client_name, generatedAt);
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
      // excluded_fields is frozen with the rest of the snapshot: what was
      // deliberately omitted is part of explaining an issued letter.
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

  // ids, versions and counts. No names, no recipient, no clinical content.
  await audit(req, 'letter.generated', row.id, {
    draftId: row.id,
    clientId: row.client_id,
    therapistProfileId: row.therapist_profile_id,
    documentId,
    templateVersion: template.version,
    documentType: LETTER_DOCUMENT_TYPE,
    sectionCount,
    customSectionCount,
    ccCount: (row.letter_cc_recipients || []).length,
    missingFieldCount: missingFields.length,
    excludedFieldCount: excludedFields.length,
  });

  res.json({ documentId, filename, missingFields, excludedFields, warnings });
}));

// ── Download (authenticated, own-draft only) ────────────────────────────────

router.get('/api/letters/documents/:documentId/download', requireClinicalRead, safe(async (req, res) => {
  if (!isUuid(req.params.documentId)) return res.status(404).json({ error: 'not_found' });

  const { rows } = await pool.query(
    `SELECT gd.* FROM fca_generated_documents gd
       JOIN fca_report_drafts d ON d.id = gd.draft_id
      WHERE gd.id = $1 AND d.organisation_id = $2 AND d.created_by_user_id = $3
        AND d.document_type = $4`,
    [req.params.documentId, orgOf(req), req.user.id, LETTER_DOCUMENT_TYPE]
  );
  const doc = rows[0];
  if (!doc) return res.status(404).json({ error: 'not_found' });

  const { getBackend } = require('./storage');
  let base64;
  try {
    // The stored bytes, verbatim. Nothing is re-resolved and nothing is
    // re-rendered: an issued letter is whatever it was when it was issued.
    ({ base64 } = await getBackend(doc.storage_backend || 'db').get({
      backend: doc.storage_backend, storageKey: doc.storage_key, fileData: doc.file_data,
    }));
  } catch (err) {
    log.error('letter download failed', { error: err.message, documentId: doc.id });
    return res.status(500).json({ error: 'download_failed' });
  }
  if (!base64) return res.status(404).json({ error: 'not_found' });

  await audit(req, 'letter.downloaded', doc.draft_id, { documentId: doc.id, templateVersion: doc.template_version });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.filename)}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(Buffer.from(base64, 'base64'));
}));

module.exports = router;
