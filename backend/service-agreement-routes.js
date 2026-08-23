'use strict';

/**
 * SERVICE AGREEMENTS — API
 *
 * The Resource Hub's third document workflow. Owners manage an immutable
 * master template; staff build agreements from it, issue a participant-facing
 * fillable PDF, and email a secure completion link; participants complete and
 * sign without an account.
 *
 * ── RBAC, AND WHERE IT IS ACTUALLY ENFORCED ────────────────────────────────
 * Everything under /api/service-agreements requires a session AND the
 * `service_agreements.access` permission. That permission is in no role's
 * defaults except owner's (permissions.js), so the module does not exist for
 * anybody the Owner has not deliberately authorised. Hiding the card is a
 * courtesy; this file is the boundary.
 *
 * FOUR distinct powers, checked separately:
 *
 *   service_agreements.access         create, edit and issue agreements; email
 *                                     links; download the participant PDF.
 *                                     Sees the agreements THIS user created.
 *   service_agreements.view_all       read every agreement in the practice.
 *                                     Read only — never the right to edit
 *                                     somebody else's.
 *   manage_master + role === 'owner'  the master: clause editing, upload,
 *                                     publish, retire, republish, and the
 *                                     master Word download.
 *   role === 'owner'                  ANY Word output, master or instance.
 *
 * ── WHY WORD IS OWNER-ONLY, IN ONE SENTENCE ────────────────────────────────
 * A .docx is editable, so handing one to an employee makes the agreement's
 * wording negotiable by whoever holds the file — which is the single thing the
 * master-versioning design exists to prevent. Staff get PDF. Enforced by
 * requireOwner on every Word route, not by omitting a button.
 *
 * ── ORGANISATION ISOLATION ─────────────────────────────────────────────────
 * Every query filters organisation_id with IS NOT DISTINCT FROM, and a record
 * in another organisation is a 404 rather than a 403 — indistinguishable from
 * one that does not exist, so ids cannot be probed. Same rule as
 * interview-routes.js, whodas-routes.js and learning-routes.js.
 *
 * ── THE PUBLIC SIGNING SURFACE ─────────────────────────────────────────────
 * /api/service-agreement-signing/* is mounted OUTSIDE requireAuth and is the
 * only unauthenticated surface here. It is deliberately in this file, directly
 * beneath the routes it mirrors, so a reviewer reading the authenticated rules
 * meets the unauthenticated ones on the same screen rather than discovering
 * them in a file nobody opened.
 */

const express = require('express');
const crypto = require('crypto');

const router = express.Router();
const db = require('./database');
const { pool } = require('./database');
const {
  requireAuth, requirePermission, hasPermission, requireOwner, requireMasterAuthority,
  SERVICE_AGREEMENT_PERMISSIONS, SERVICE_AGREEMENT_PERMISSION_GROUPS,
  SERVICE_AGREEMENT_PERMISSION_LABELS,
} = require('./permissions');
const log = require('./logger').createLogger('service-agreements');
const email = require('./email');

const map = require('./service-agreements/template-map');
const sadb = require('./service-agreements/db');
const { validateMaster, DOCX_MIME } = require('./service-agreements/validate-template');
const { sanitizeDocxForDistribution, auditDocx } = require('./docx-sanitiser');
const { generateAgreementDocx } = require('./service-agreements/docx');
const { renderAgreementPdf, agreementFilename } = require('./service-agreements/pdf');
const { outlineFromDocx } = require('./service-agreements/docx-outline');
const { composeAgreementManifest, asDate, money, toCents } = require('./service-agreements/manifest');
const { resolvePortalValues, mergeUserInput } = require('./service-agreements/resolve');
const orgIdentity = require('./service-agreements/organisation');
const clauses = require('./service-agreements/clauses');
const signing = require('./service-agreements/signing');

const dataLayers = require('./fca/data-layers');
const { searchClients } = require('./fca/client-search');
const { documentReference } = require('./fca/document-id');

const fs = require('fs');
const PDF_MIME = 'application/pdf';

// ─────────────────────────────────────────────────────────────────────────────
//  House helpers
// ─────────────────────────────────────────────────────────────────────────────

const safe = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  // Message only — request bodies carry participant and clinical content.
  log.error('service agreement route error', { error: err.message, path: req.path });
  if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
});

const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));
const orgOf = (req) => req.user?.organisation_id || null;
const canViewAll = (req) => hasPermission(req.user, 'service_agreements.view_all')
  || req.user?.role === 'owner';

/** Append-only audit, via the ONE canonical table. Never breaks the request. */
async function audit(req, action, targetId, metadata) {
  await db.logAuditEvent({
    action,
    targetType: 'service_agreement',
    targetId: targetId ? String(targetId) : null,
    actorUserId: req.user?.id || null,
    organisationId: orgOf(req) || (metadata && metadata.organisationId) || null,
    ipAddress: req.ip,
    metadata: metadata || {},
  }).catch(() => {});
}

/** Audit for the anonymous signing surface, where there is no req.user. */
async function auditPublic(req, action, targetId, organisationId, metadata) {
  await db.logAuditEvent({
    action,
    targetType: 'service_agreement',
    targetId: targetId ? String(targetId) : null,
    actorUserId: null,
    organisationId: organisationId || null,
    ipAddress: req.ip,
    metadata: metadata || {},
  }).catch(() => {});
}

function sendFile(res, buffer, filename, mime, disposition = 'attachment') {
  const safeName = String(filename).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 180);
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `${disposition}; filename="${safeName}"`);
  res.end(buffer);
}

/** Artifact bytes, whichever backend holds them. */
function artifactBytes(row) {
  if (row.file_data) return Buffer.from(row.file_data, 'base64');
  throw new Error(`Artifact ${row.id} has no inline bytes and no storage backend is configured.`);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Master template: seeding and loading
// ─────────────────────────────────────────────────────────────────────────────

let seedBufferCache = null;
function readSeedTemplate() {
  if (!seedBufferCache) seedBufferCache = fs.readFileSync(map.SEED_TEMPLATE_FILE);
  return seedBufferCache;
}

/**
 * Ensure the organisation has a published master, registering the vendored
 * v1.0 the first time.
 *
 * Registration VALIDATES before publishing. A seed file that has drifted out
 * of contract must not become the practice's live agreement template just
 * because it is the one on disk — it fails loudly and the feature reports it,
 * which is the whole point of having a validator.
 */
async function ensurePublishedMaster(organisationId, userId) {
  const existing = await sadb.getPublishedMaster(organisationId, map.TEMPLATE_KEY);
  if (existing) {
    const patched = await applySafetyPatchIfNeeded(organisationId, existing, userId);
    return { master: patched || existing, seeded: false, patched: Boolean(patched) };
  }

  const buffer = readSeedTemplate();
  const validation = await validateMaster(buffer, { strictCounts: true });
  if (!validation.ok) {
    const err = new Error('The bundled service agreement master failed contract validation.');
    err.validation = validation;
    err.seedInvalid = true;
    throw err;
  }

  const orgSnapshot = await orgIdentity.snapshotFor(organisationId);

  return sadb.withTransaction(async (q) => {
    // Re-check inside the transaction: two first requests racing must not both
    // publish, and the partial unique index would reject the second anyway —
    // this turns that into a clean no-op rather than a 500.
    const again = await sadb.getPublishedMaster(organisationId, map.TEMPLATE_KEY, q);
    if (again) return { master: again, seeded: false };

    const draft = await sadb.createMasterDraft({
      organisationId,
      templateKey: map.TEMPLATE_KEY,
      versionLabel: map.SEED_VERSION,
      name: map.TEMPLATE_NAME,
      status: 'validated',
      storageBackend: 'db',
      fileData: buffer.toString('base64'),
      byteSize: buffer.length,
      sourceSha256: validation.sha256,
      tagManifest: validation.tagManifest,
      clauseSnapshot: clauses.defaultClauseSnapshot(),
      organisationSnapshot: orgSnapshot.values,
      validation: summariseValidation(validation),
      createdByUserId: userId,
      validatedAt: new Date(),
    }, q);

    const published = await sadb.publishMaster(organisationId, draft.id, userId, q);
    return { master: published, seeded: true };
  });
}

/**
 * Upgrade an organisation still on the superseded master to the safety patch.
 *
 * Publishing is normally a deliberate owner act, because it changes the legal
 * document every future agreement is built from. This one is different and the
 * difference is provable: v1.0.1 is v1.0 with a single Word SETTING removed —
 * every other part of the package is byte-for-byte identical, so no clause, no
 * schedule and no clinical content changes. Leaving it to a manual publication
 * would mean every participant kept seeing a security warning until somebody
 * happened to press a button.
 *
 * What it does NOT do is touch anything already issued. Agreements stay pinned
 * to the version they were issued against, v1.0 is retired rather than
 * rewritten, and the audit records why the patch was applied.
 *
 * Returns the new master, or null when nothing needed doing.
 */
async function applySafetyPatchIfNeeded(organisationId, current, userId) {
  if (current.source_sha256 !== map.SUPERSEDED_TEMPLATE_SHA256) return null;
  if (map.SEED_TEMPLATE_SHA256 === map.SUPERSEDED_TEMPLATE_SHA256) return null;

  const buffer = readSeedTemplate();
  const validation = await validateMaster(buffer, { strictCounts: true });
  if (!validation.ok) {
    // Never replace a working master with one that does not validate. The
    // organisation keeps v1.0 — a security prompt is better than a broken
    // contract template.
    log.error('service agreement safety patch skipped — bundled master failed validation', {
      errors: validation.errors.length,
    });
    return null;
  }

  const versions = await sadb.listMasterVersions(organisationId, map.TEMPLATE_KEY);
  if (versions.some((v) => v.version_label === map.SEED_VERSION)) return null;

  const organisation = await orgIdentity.snapshotFor(organisationId);

  const published = await sadb.withTransaction(async (q) => {
    const again = await sadb.getPublishedMaster(organisationId, map.TEMPLATE_KEY, q);
    if (!again || again.source_sha256 !== map.SUPERSEDED_TEMPLATE_SHA256) return null;

    const draft = await sadb.createMasterDraft({
      organisationId,
      templateKey: map.TEMPLATE_KEY,
      versionLabel: map.SEED_VERSION,
      name: map.TEMPLATE_NAME,
      status: 'validated',
      storageBackend: 'db',
      fileData: buffer.toString('base64'),
      byteSize: buffer.length,
      sourceSha256: validation.sha256,
      tagManifest: validation.tagManifest,
      // The clause configuration carries forward untouched: a safety patch
      // must not quietly re-enable a clause the owner switched off.
      clauseSnapshot: again.clause_snapshot,
      organisationSnapshot: organisation.values,
      validation: {
        ...summariseValidation(validation),
        source: 'safety_patch',
        patchedFromVersionId: again.id,
        patchedFromVersion: again.version_label,
        reason: map.PATCH_REASON,
      },
      createdByUserId: userId,
      validatedAt: new Date(),
    }, q);

    return sadb.publishMaster(organisationId, draft.id, userId, q);
  });

  if (!published) return null;

  await db.logAuditEvent({
    action: 'SERVICE_AGREEMENT_MASTER_SAFETY_PATCHED',
    targetType: 'service_agreement',
    targetId: String(published.id),
    actorUserId: userId || null,
    organisationId,
    metadata: {
      fromVersion: current.version_label,
      fromSha256: current.source_sha256,
      toVersion: published.version_label,
      toSha256: published.source_sha256,
      reason: map.PATCH_REASON,
      clauseOrContentChanged: false,
    },
  }).catch(() => {});

  log.info('service agreement master safety-patched', {
    organisationId, from: current.version_label, to: published.version_label,
  });

  return published;
}

/** The validation report, trimmed to what is worth storing forever. */
function summariseValidation(v) {
  return {
    ok: v.ok,
    sha256: v.sha256,
    byteSize: v.byteSize,
    matchesSeedHash: v.matchesSeedHash === true,
    counts: v.counts,
    errors: v.errors,
    warnings: v.warnings,
    validatedAt: new Date().toISOString(),
  };
}

function masterBytes(row) {
  if (row.file_data) return Buffer.from(row.file_data, 'base64');
  throw new Error(`Master version ${row.id} has no inline bytes.`);
}

/** Public shape of a master version. Never leaks the file bytes. */
function masterView(row) {
  if (!row) return null;
  return {
    id: row.id,
    versionLabel: row.version_label,
    name: row.name,
    status: row.status,
    sha256: row.source_sha256,
    byteSize: row.byte_size,
    tagManifest: row.tag_manifest,
    clauseSnapshot: row.clause_snapshot,
    validation: row.validation,
    supersededVersionId: row.superseded_version_id,
    createdAt: row.created_at,
    validatedAt: row.validated_at,
    publishedAt: row.published_at,
    retiredAt: row.retired_at,
    createdByUserId: row.created_by_user_id,
    publishedByUserId: row.published_by_user_id,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Document composition — the one path every artifact goes through
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Server-authority values. Nothing else may produce these.
 *
 * The reference, version, status and template hash are Opal's to ISSUE, not
 * facts to look up — the same reasoning as fca/document-id.js. Showing them as
 * "missing" in the wizard would ask a staff member to go and find the id of a
 * document that does not exist yet.
 */
function serverValuesFor(agreement, master, { statusLabel } = {}) {
  const reference = agreement.reference || documentReference(map.DOCUMENT_PREFIX, agreement.id);
  return {
    OPAL_AGREEMENT_ID: reference,
    OPAL_AGREEMENT_VERSION: master ? master.version_label : '',
    OPAL_AGREEMENT_STATUS: statusLabel || stateLabel(agreement.state),
    OPAL_MASTER_TEMPLATE_HASH: master ? String(master.source_sha256).slice(0, 16) : '',
    OPAL_AGREEMENT_ISSUE_DATE: agreement.issued_at ? asDate(agreement.issued_at) : '',
  };
}

const STATE_LABELS = {
  draft: 'Draft', ready: 'Ready to issue', issued: 'Issued', viewed: 'Issued — viewed',
  partially_completed: 'Partly completed', completed: 'Completed', signed: 'Signed',
  expired: 'Expired', revoked: 'Revoked', void: 'Void',
};
const stateLabel = (s) => STATE_LABELS[s] || 'Draft';

/**
 * Compose the Word document for an agreement, and the PDF from it.
 *
 * ONE function, used by the preview, the draft download, the issue step and
 * the signing surface, so those four can never disagree about what the
 * agreement says.
 *
 * @param {'participant'|'owner'} audience
 * @param {'empty'|'prompt'}      blankStyle
 */
async function composeArtifacts(agreement, master, {
  audience = 'participant',
  blankStyle = 'empty',
  lockProviderFields = false,
  signatures = {},
  withPdf = true,
  statusLabel,
} = {}) {
  const manifest = composeAgreementManifest({
    formData: agreement.form_data || {},
    supports: agreement.support_rows || [],
    serverValues: serverValuesFor(agreement, master, { statusLabel }),
    organisation: (agreement.organisation_snapshot && Object.keys(agreement.organisation_snapshot).length)
      ? agreement.organisation_snapshot
      : (await orgIdentity.snapshotFor(agreement.organisation_id)).values,
    signatures,
    clauseSnapshot: (agreement.clause_snapshot && Object.keys(agreement.clause_snapshot).length)
      ? agreement.clause_snapshot
      : (master ? master.clause_snapshot : {}),
    blankStyle,
    audience,
  });

  const docx = await generateAgreementDocx({
    templateBuffer: masterBytes(master),
    manifest,
    audience,
  });

  const meta = {
    reference: manifest.scalarData.OPAL_AGREEMENT_ID,
    versionLabel: master ? master.version_label : '',
    participantName: agreement.participant_name
      || manifest.scalarData.OPAL_PARTICIPANT_FULL_NAME || '',
  };

  let pdf = null;
  if (withPdf) {
    pdf = await renderAgreementPdf({ docxBuffer: docx, meta, lockProviderFields });
  }

  return { manifest, docx, pdf, meta };
}

/** The pricing snapshot frozen at issue: what the participant agreed to pay. */
function pricingSnapshotFrom(manifest) {
  return {
    supports: (manifest.supports || []).map((s) => ({
      itemNumber: s.OPAL_SUPPORT_ITEM_NUMBER || null,
      description: s.OPAL_SUPPORT_DESCRIPTION || null,
      unit: s.OPAL_SUPPORT_UNIT || null,
      rate: s.OPAL_SUPPORT_RATE || null,
      rateCents: toCents(s.OPAL_SUPPORT_RATE),
      quantity: s.OPAL_SUPPORT_ESTIMATED_QUANTITY || null,
      estimatedTotal: s.OPAL_SUPPORT_ESTIMATED_TOTAL || null,
      estimatedTotalCents: toCents(s.OPAL_SUPPORT_ESTIMATED_TOTAL),
    })),
    totalCents: manifest.supportTotals.cents,
    totalDisplay: manifest.supportTotals.display,
    uncountedSupports: manifest.supportTotals.uncounted,
    frozenAt: new Date().toISOString(),
  };
}

// ═════════════════════════════════════════════════════════════════════════════
//  AUTHENTICATED SURFACE
// ═════════════════════════════════════════════════════════════════════════════

router.use('/api/service-agreements', requireAuth);
router.use('/api/service-agreements', requirePermission('service_agreements.access'));

// ── Organisation identity (owner) ───────────────────────────────────────────

router.get('/api/service-agreements/settings', safe(async (req, res) => {
  const settings = await orgIdentity.getSettings(orgOf(req));
  res.json({ settings, fields: orgIdentity.SETTINGS_FIELDS, canEdit: req.user.role === 'owner' });
}));

router.put('/api/service-agreements/settings', requireOwner, safe(async (req, res) => {
  const result = await orgIdentity.saveSettings(orgOf(req), req.body || {});
  if (!result.ok) return res.status(400).json({ error: 'Validation failed', errors: result.errors });

  await audit(req, 'SERVICE_AGREEMENT_ORG_SETTINGS_UPDATED', null, {
    fields: Object.keys(req.body || {}).filter((k) => orgIdentity.SETTINGS_FIELDS.some((f) => f.key === k)),
  });
  const settings = await orgIdentity.getSettings(orgOf(req));
  res.json({ ok: true, settings });
}));

// ── Master template ─────────────────────────────────────────────────────────

router.get('/api/service-agreements/master', safe(async (req, res) => {
  let master;
  try {
    ({ master } = await ensurePublishedMaster(orgOf(req), req.user.id));
  } catch (err) {
    if (err.seedInvalid) {
      log.error('bundled master failed validation', { errors: err.validation.errors.length });
      return res.status(500).json({
        error: 'The bundled service agreement template failed validation.',
        validation: err.validation,
      });
    }
    throw err;
  }

  const settings = await orgIdentity.getSettings(orgOf(req));
  res.json({
    master: masterView(master),
    settings: { complete: settings.complete, missing: settings.missing },
    canManageMaster: req.user.role === 'owner'
      && hasPermission(req.user, 'service_agreements.manage_master'),
    canDownloadWord: req.user.role === 'owner',
  });
}));

router.get('/api/service-agreements/master/versions', safe(async (req, res) => {
  await ensurePublishedMaster(orgOf(req), req.user.id).catch(() => {});
  const versions = await sadb.listMasterVersions(orgOf(req), map.TEMPLATE_KEY);
  res.json({ versions });
}));

/** The editable master Word file. Owner only, and audited as a download. */
router.get('/api/service-agreements/master/:id/docx', requireOwner, requireMasterAuthority,
  safe(async (req, res) => {
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });
    const version = await sadb.getMasterVersion(orgOf(req), req.params.id);
    if (!version) return res.status(404).json({ error: 'Not found' });

    // A master is a WORKING file — the owner opens it in Word to edit it — so
    // the served copy goes through the distribution gate even though the
    // stored row does not change. A historic version predating the safety
    // patch would otherwise still greet its reader with the field-update
    // warning. The stored hash is recorded beside the served one so an audit
    // can see that the two differ and why.
    const stored = masterBytes(version);
    let served = stored;
    try {
      served = await sanitizeDocxForDistribution(stored, {
        label: 'Service agreement master',
        requiredTags: map.BLOCK_TAGS,
      });
    } catch (err) {
      log.error('master download refused by the distribution gate', {
        versionId: version.id, findings: (err.findings || []).map((f) => f.code),
      });
      return res.status(500).json({ error: 'This document could not be produced safely.' });
    }

    await audit(req, 'SERVICE_AGREEMENT_MASTER_DOWNLOADED', version.id, {
      versionLabel: version.version_label,
      format: 'docx',
      storedSha256: version.source_sha256,
      servedSha256: sadb.sha256(served),
      sanitised: (served.docxAudit && served.docxAudit.repaired) || [],
    });

    return sendFile(res, served,
      `Opal_Service_Agreement_Master_v${version.version_label}.docx`, DOCX_MIME);
  }));

/** A PDF preview of the master, with the owner's internal blocks retained. */
router.get('/api/service-agreements/master/:id/pdf', safe(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const version = await sadb.getMasterVersion(orgOf(req), req.params.id);
  if (!version) return res.status(404).json({ error: 'Not found' });

  // Staff may preview the PARTICIPANT-facing master. Only an owner sees the
  // governance blocks, so `audience` follows the role rather than a query
  // parameter a caller could set.
  const audience = req.user.role === 'owner' ? 'owner' : 'participant';

  const stub = {
    id: version.id,
    organisation_id: orgOf(req),
    form_data: {},
    support_rows: [{}],
    organisation_snapshot: version.organisation_snapshot,
    clause_snapshot: version.clause_snapshot,
    participant_name: '',
    state: 'draft',
    reference: `MASTER v${version.version_label}`,
  };

  const { docx } = await composeArtifacts(stub, version, {
    audience, blankStyle: 'prompt', withPdf: false, statusLabel: `Master v${version.version_label}`,
  });
  const pdf = await renderAgreementPdf({
    docxBuffer: docx,
    meta: { reference: `MASTER v${version.version_label}`, versionLabel: version.version_label },
    lockProviderFields: false,
  });

  await audit(req, 'SERVICE_AGREEMENT_MASTER_PREVIEWED', version.id, {
    versionLabel: version.version_label, format: 'pdf', audience,
  });

  sendFile(res, pdf.bytes,
    `Opal_Service_Agreement_Master_v${version.version_label}.pdf`, PDF_MIME,
    req.query.disposition === 'inline' ? 'inline' : 'attachment');
}));

/** The clause configuration of the current published master. */
router.get('/api/service-agreements/master/clauses', safe(async (req, res) => {
  const { master } = await ensurePublishedMaster(orgOf(req), req.user.id);
  res.json({
    versionId: master.id,
    versionLabel: master.version_label,
    snapshot: master.clause_snapshot,
    catalogue: {
      clauses: map.CLAUSE_TAGS.map((t) => ({ tag: t, ...map.BLOCK_BY_TAG[t] })),
      optional: map.OPTIONAL_CLAUSE_TAGS,
      maxCustom: clauses.MAX_CUSTOM_CLAUSES,
    },
    canEdit: req.user.role === 'owner'
      && hasPermission(req.user, 'service_agreements.manage_master'),
  });
}));

/**
 * Edit clauses online.
 *
 * Produces a DRAFT version, never a change to the published one. Publishing is
 * a separate, deliberate act — it changes the legal document every future
 * agreement is built from, and that decision belongs to a person pressing a
 * button that says so.
 */
router.put('/api/service-agreements/master/clauses', requireOwner, requireMasterAuthority,
  safe(async (req, res) => {
    const { master } = await ensurePublishedMaster(orgOf(req), req.user.id);
    const result = clauses.validateClauseConfig(req.body || {}, master.clause_snapshot);
    if (!result.ok) return res.status(400).json({ error: 'Validation failed', errors: result.errors });

    const versions = await sadb.listMasterVersions(orgOf(req), map.TEMPLATE_KEY);
    const orgSnapshot = await orgIdentity.snapshotFor(orgOf(req));
    const buffer = masterBytes(master);

    const draft = await sadb.createMasterDraft({
      organisationId: orgOf(req),
      templateKey: map.TEMPLATE_KEY,
      versionLabel: sadb.nextVersionLabel(versions, false),
      name: master.name,
      status: 'validated',
      storageBackend: 'db',
      fileData: buffer.toString('base64'),
      byteSize: buffer.length,
      sourceSha256: master.source_sha256,
      tagManifest: master.tag_manifest,
      clauseSnapshot: { ...result.snapshot, revisedAt: new Date().toISOString() },
      organisationSnapshot: orgSnapshot.values,
      validation: { ...master.validation, source: 'clause_edit', basedOnVersionId: master.id },
      createdByUserId: req.user.id,
      validatedAt: new Date(),
    });

    await audit(req, 'SERVICE_AGREEMENT_MASTER_CLAUSES_EDITED', draft.id, {
      basedOnVersionId: master.id,
      newVersionLabel: draft.version_label,
      disabledClauses: result.snapshot.clauses.filter((c) => !c.enabled).map((c) => c.tag),
      customClauseCount: result.snapshot.custom.length,
    });

    res.json({ ok: true, draft: masterView(draft) });
  }));

/**
 * Upload a revised Word master.
 *
 * Becomes a DRAFT. It never overwrites the published master automatically, and
 * validation is the gate: an uploaded .docx is untrusted input that a
 * participant will later open, so macros, external references and a broken tag
 * contract are all refusals rather than warnings.
 */
router.post('/api/service-agreements/master/upload', requireOwner, requireMasterAuthority,
  safe(async (req, res) => {
    const b64 = req.body && req.body.fileBase64;
    if (typeof b64 !== 'string' || !b64) {
      return res.status(400).json({ error: 'A Word document is required.' });
    }

    let buffer;
    try {
      buffer = Buffer.from(b64, 'base64');
    } catch (_) {
      return res.status(400).json({ error: 'The upload could not be decoded.' });
    }

    const validation = await validateMaster(buffer, {
      declaredMime: req.body.mimeType,
      // An owner's revision may legitimately repeat a scalar a different
      // number of times; the contract that matters is that every tag EXISTS.
      strictCounts: false,
    });

    if (!validation.ok) {
      await audit(req, 'SERVICE_AGREEMENT_MASTER_UPLOAD_REJECTED', null, {
        sha256: validation.sha256,
        byteSize: validation.byteSize,
        errorCodes: validation.errors.map((e) => e.code),
      });
      return res.status(400).json({
        error: 'The uploaded document did not pass validation.',
        validation,
      });
    }

    const { master } = await ensurePublishedMaster(orgOf(req), req.user.id);
    const versions = await sadb.listMasterVersions(orgOf(req), map.TEMPLATE_KEY);
    const orgSnapshot = await orgIdentity.snapshotFor(orgOf(req));

    const draft = await sadb.createMasterDraft({
      organisationId: orgOf(req),
      templateKey: map.TEMPLATE_KEY,
      versionLabel: sadb.nextVersionLabel(versions, req.body.majorVersion === true),
      name: map.TEMPLATE_NAME,
      status: 'validated',
      storageBackend: 'db',
      fileData: buffer.toString('base64'),
      byteSize: buffer.length,
      sourceSha256: validation.sha256,
      tagManifest: validation.tagManifest,
      // The clause configuration carries forward: an owner uploading revised
      // wording has not asked to re-enable a clause they switched off.
      clauseSnapshot: master.clause_snapshot,
      organisationSnapshot: orgSnapshot.values,
      validation: summariseValidation(validation),
      createdByUserId: req.user.id,
      validatedAt: new Date(),
    });

    await audit(req, 'SERVICE_AGREEMENT_MASTER_UPLOADED', draft.id, {
      versionLabel: draft.version_label,
      sha256: validation.sha256,
      byteSize: validation.byteSize,
      warnings: validation.warnings.map((w) => w.code),
    });

    res.status(201).json({ ok: true, draft: masterView(draft), validation });
  }));

/** Publish a validated draft. Deliberate, owner-only, and irreversible. */
router.post('/api/service-agreements/master/:id/publish', requireOwner, requireMasterAuthority,
  safe(async (req, res) => {
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });

    const version = await sadb.getMasterVersion(orgOf(req), req.params.id);
    if (!version) return res.status(404).json({ error: 'Not found' });
    if (version.status === 'published') {
      return res.status(409).json({ error: 'That version is already published.' });
    }
    if (version.status === 'retired') {
      return res.status(409).json({
        error: 'A retired version cannot be published again. Republish it as a new version.',
      });
    }
    if (!version.validation || version.validation.ok !== true) {
      return res.status(409).json({ error: 'That version has not passed validation.' });
    }

    const published = await sadb.withTransaction((q) =>
      sadb.publishMaster(orgOf(req), version.id, req.user.id, q));

    if (!published) return res.status(409).json({ error: 'That version could not be published.' });

    await audit(req, 'SERVICE_AGREEMENT_MASTER_PUBLISHED', published.id, {
      versionLabel: published.version_label,
      sha256: published.source_sha256,
      supersededVersionId: published.superseded_version_id,
    });

    res.json({ ok: true, master: masterView(published) });
  }));

router.post('/api/service-agreements/master/:id/retire', requireOwner, requireMasterAuthority,
  safe(async (req, res) => {
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });

    // Existence is checked FIRST, organisation-scoped. Without this a version
    // belonging to another organisation answers 409 ("cannot be retired")
    // rather than 404, and the difference between those two replies tells the
    // caller the id exists — which is precisely what tenant isolation is for.
    const version = await sadb.getMasterVersion(orgOf(req), req.params.id);
    if (!version) return res.status(404).json({ error: 'Not found' });

    const retired = await sadb.retireMaster(orgOf(req), req.params.id, req.user.id);
    if (!retired) {
      return res.status(409).json({ error: 'Only the current published version can be retired.' });
    }
    await audit(req, 'SERVICE_AGREEMENT_MASTER_RETIRED', retired.id, {
      versionLabel: retired.version_label,
    });
    res.json({ ok: true, master: masterView(retired) });
  }));

/**
 * Republish a historic version AS A NEW VERSION.
 *
 * Never by reactivating the old row: an issued agreement points at a version
 * id, and mutating that row's status would rewrite what those agreements say
 * they were issued against. A copy with a new label and a new id leaves
 * history intact.
 */
router.post('/api/service-agreements/master/:id/republish', requireOwner, requireMasterAuthority,
  safe(async (req, res) => {
    if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });
    const source = await sadb.getMasterVersion(orgOf(req), req.params.id);
    if (!source) return res.status(404).json({ error: 'Not found' });

    const versions = await sadb.listMasterVersions(orgOf(req), map.TEMPLATE_KEY);
    const orgSnapshot = await orgIdentity.snapshotFor(orgOf(req));

    const result = await sadb.withTransaction(async (q) => {
      const draft = await sadb.createMasterDraft({
        organisationId: orgOf(req),
        templateKey: map.TEMPLATE_KEY,
        versionLabel: sadb.nextVersionLabel(versions, false),
        name: source.name,
        status: 'validated',
        storageBackend: 'db',
        fileData: source.file_data,
        byteSize: source.byte_size,
        sourceSha256: source.source_sha256,
        tagManifest: source.tag_manifest,
        clauseSnapshot: source.clause_snapshot,
        organisationSnapshot: orgSnapshot.values,
        validation: { ...source.validation, source: 'republish', republishedFromVersionId: source.id },
        createdByUserId: req.user.id,
        validatedAt: new Date(),
      }, q);
      return sadb.publishMaster(orgOf(req), draft.id, req.user.id, q);
    });

    await audit(req, 'SERVICE_AGREEMENT_MASTER_REPUBLISHED', result.id, {
      versionLabel: result.version_label,
      republishedFromVersionId: source.id,
      republishedFromLabel: source.version_label,
    });

    res.json({ ok: true, master: masterView(result) });
  }));

// ── Delegation (owner) ──────────────────────────────────────────────────────
//
// DECLARED BEFORE '/:id'. Express matches in declaration order, so a literal
// segment that sits after a parameterised one is unreachable: '/access' was
// being captured by '/:id', failing the uuid test and 404ing for everybody,
// owner included. Literal routes come first.

router.get('/api/service-agreements/access', requireOwner, safe(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, email, role, permissions FROM users
      WHERE organisation_id IS NOT DISTINCT FROM $1 AND is_active = TRUE
        AND role IN ('owner','admin','therapist')
      ORDER BY name`,
    [orgOf(req)]
  );
  res.json({
    users: rows.map((u) => ({
      id: u.id, name: u.name, email: u.email, role: u.role,
      permissions: (Array.isArray(u.permissions) ? u.permissions : [])
        .filter((p) => SERVICE_AGREEMENT_PERMISSIONS.includes(p)),
    })),
    groups: SERVICE_AGREEMENT_PERMISSION_GROUPS,
    labels: SERVICE_AGREEMENT_PERMISSION_LABELS,
  });
}));

router.put('/api/service-agreements/access/:userId', requireOwner, safe(async (req, res) => {
  if (!isUuid(req.params.userId)) return res.status(404).json({ error: 'Not found' });

  const requested = (Array.isArray(req.body?.permissions) ? req.body.permissions : [])
    .filter((p) => SERVICE_AGREEMENT_PERMISSIONS.includes(p));

  const { rows } = await pool.query(
    'SELECT id, role, permissions FROM users WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2',
    [req.params.userId, orgOf(req)]
  );
  const target = rows[0];
  if (!target) return res.status(404).json({ error: 'Not found' });

  const existing = Array.isArray(target.permissions) ? target.permissions : [];
  const kept = existing.filter((p) => !SERVICE_AGREEMENT_PERMISSIONS.includes(p));
  const next = [...new Set([...kept, ...requested])];

  await pool.query(
    'UPDATE users SET permissions = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
    [target.id, JSON.stringify(next)]
  );

  const before = existing.filter((p) => SERVICE_AGREEMENT_PERMISSIONS.includes(p));
  await audit(req, 'SERVICE_AGREEMENT_ACCESS_CHANGED', target.id, {
    targetUserId: target.id,
    role: target.role,
    granted: requested,
    revoked: before.filter((p) => !requested.includes(p)),
  });

  res.json({ ok: true, userId: target.id, permissions: requested });
}));


// ── Participant lookup ──────────────────────────────────────────────────────

router.get('/api/service-agreements/clients', safe(async (req, res) => {
  try {
    const clients = await searchClients(orgOf(req), String(req.query.q || ''));
    res.json({ clients });
  } catch (err) {
    if (err.sploseFailure) {
      // An empty list would read as "this participant does not exist", which is
      // a different and much worse statement than "we cannot reach the system
      // of record right now".
      return res.status(503).json({ error: 'splose_unavailable' });
    }
    throw err;
  }
}));

// ── Agreements ──────────────────────────────────────────────────────────────

router.get('/api/service-agreements', safe(async (req, res) => {
  const states = typeof req.query.states === 'string' && req.query.states
    ? req.query.states.split(',').map((s) => s.trim()).filter(Boolean)
    : null;

  const agreements = await sadb.listAgreements(orgOf(req), {
    states,
    createdBy: req.user.id,
    viewAll: canViewAll(req),
    participantClientId: req.query.participant || null,
  });
  res.json({ agreements, viewAll: canViewAll(req) });
}));

router.post('/api/service-agreements', safe(async (req, res) => {
  const clientId = String(req.body?.participantClientId || '').trim();
  if (!clientId) return res.status(400).json({ error: 'A participant is required.' });

  // The master must exist before an agreement can be created against it, and
  // the organisation must have said who it is. An agreement that cannot name
  // the provider is not a contract.
  const settings = await orgIdentity.getSettings(orgOf(req));
  if (!settings.complete) {
    return res.status(409).json({
      error: 'The practice details for service agreements are incomplete.',
      missing: settings.missing,
    });
  }
  await ensurePublishedMaster(orgOf(req), req.user.id);

  const agreement = await sadb.createAgreement({
    organisationId: orgOf(req),
    participantClientId: clientId,
    participantName: req.body?.participantName || null,
    participantPreferredName: req.body?.participantPreferredName || null,
    participantEmail: req.body?.participantEmail || null,
    completionMode: req.body?.completionMode === 'manual' ? 'manual' : 'portal',
    createdByUserId: req.user.id,
  });

  await audit(req, 'SERVICE_AGREEMENT_CREATED', agreement.id, {
    participantClientId: clientId,
    completionMode: agreement.completion_mode,
  });

  res.status(201).json({ agreement });
}));

/** Load an agreement the caller is entitled to see. */
async function loadAgreement(req, res) {
  if (!isUuid(req.params.id)) { res.status(404).json({ error: 'Not found' }); return null; }
  const agreement = await sadb.getAgreement(orgOf(req), req.params.id);
  if (!agreement) { res.status(404).json({ error: 'Not found' }); return null; }
  if (agreement.created_by_user_id !== req.user.id && !canViewAll(req)) {
    // A 404, not a 403: whether an agreement exists is itself information.
    res.status(404).json({ error: 'Not found' });
    return null;
  }
  return agreement;
}

/** Editing is narrower than reading: only the author, or an owner, may write. */
function canEdit(req, agreement) {
  return agreement.created_by_user_id === req.user.id || req.user.role === 'owner';
}

router.get('/api/service-agreements/:id', safe(async (req, res) => {
  const agreement = await loadAgreement(req, res);
  if (!agreement) return;

  const master = agreement.master_version_id
    ? await sadb.getMasterVersion(orgOf(req), agreement.master_version_id)
    : (await ensurePublishedMaster(orgOf(req), req.user.id)).master;

  const [artifacts, sessions, deliveries] = await Promise.all([
    sadb.listArtifacts(agreement.id),
    sadb.listSessions(agreement.id),
    sadb.listDeliveries(agreement.id),
  ]);

  res.json({
    agreement,
    master: masterView(master),
    artifacts,
    sessions,
    deliveries,
    fields: map.SCALARS,
    canEdit: canEdit(req, agreement),
    canDownloadWord: req.user.role === 'owner',
  });
}));

/** Autosave. */
router.patch('/api/service-agreements/:id', safe(async (req, res) => {
  const agreement = await loadAgreement(req, res);
  if (!agreement) return;
  if (!canEdit(req, agreement)) {
    return res.status(403).json({ error: 'Only the author or the owner can edit this agreement.' });
  }
  if (!['draft', 'ready'].includes(agreement.state)) {
    return res.status(409).json({
      error: `This agreement is ${stateLabel(agreement.state).toLowerCase()} and can no longer be edited.`,
    });
  }

  // Authority is enforced here: a posted signature, ABN or agreement reference
  // is discarded rather than stored.
  const merged = mergeUserInput(
    { values: agreement.form_data || {}, sources: agreement.field_sources || {} },
    req.body?.formData || {}
  );

  const supports = Array.isArray(req.body?.supports)
    ? req.body.supports.map((row) => {
      const out = {};
      for (const tag of map.SUPPORT_ROW_TAGS) {
        if (row && Object.prototype.hasOwnProperty.call(row, tag)) out[tag] = row[tag];
      }
      return out;
    })
    : (agreement.support_rows || []);

  const missing = map.SCALAR_TAGS.filter((t) => {
    const f = map.SCALAR_BY_TAG[t];
    if (f.authority !== map.AUTHORITY.PORTAL) return false;
    if (f.repeatRow || f.detail) return false;
    const v = merged.values[t];
    return v === null || v === undefined || String(v).trim() === '';
  });

  const updated = await sadb.updateAgreementDraft(orgOf(req), agreement.id, {
    formData: merged.values,
    fieldSources: merged.sources,
    supportRows: supports,
    missingFields: missing,
    completionMode: req.body?.completionMode === 'manual' ? 'manual'
      : (req.body?.completionMode === 'portal' ? 'portal' : null),
    participantName: req.body?.participantName || null,
    participantPreferredName: req.body?.participantPreferredName || null,
    participantEmail: req.body?.participantEmail || null,
    representativeName: merged.values.OPAL_REPRESENTATIVE_FULL_NAME || null,
    representativeEmail: merged.values.OPAL_REPRESENTATIVE_EMAIL || null,
    ready: req.body?.ready === true,
  }, req.user.id);

  if (!updated) return res.status(409).json({ error: 'This agreement can no longer be edited.' });

  res.json({
    agreement: updated,
    // Named explicitly so the wizard can tell the user their signature field
    // was not saved, rather than silently dropping it.
    rejectedFields: merged.rejected,
  });
}));

/** Mode A: resolve everything the portal knows about this participant. */
router.post('/api/service-agreements/:id/resolve', safe(async (req, res) => {
  const agreement = await loadAgreement(req, res);
  if (!agreement) return;
  if (!canEdit(req, agreement)) return res.status(403).json({ error: 'Forbidden' });
  if (!['draft', 'ready'].includes(agreement.state)) {
    return res.status(409).json({ error: 'An issued agreement is no longer resolved from the portal.' });
  }

  let splose = null;
  let sploseFailed = false;
  try {
    splose = await dataLayers.loadSploseClient(agreement.participant_client_id);
  } catch (err) {
    if (!err.sploseFailure) throw err;
    sploseFailed = true;
  }

  const [{ profile, currentPlan, goals }, organisation] = await Promise.all([
    dataLayers.loadClientProfile(orgOf(req), agreement.participant_client_id),
    orgIdentity.snapshotFor(orgOf(req)),
  ]);

  const resolved = resolvePortalValues({
    splose, profile, currentPlan, goals, user: req.user, organisation,
  });

  // Existing manual edits WIN over a re-resolve. A staff member who corrected
  // a phone number must not have it overwritten by pressing "refill".
  const manualTags = Object.entries(agreement.field_sources || {})
    .filter(([, src]) => src === 'manual')
    .map(([tag]) => tag);
  for (const tag of manualTags) {
    if (agreement.form_data && agreement.form_data[tag] !== undefined) {
      resolved.values[tag] = agreement.form_data[tag];
      resolved.sources[tag] = 'manual';
    }
  }

  await audit(req, 'SERVICE_AGREEMENT_PREFILLED', agreement.id, {
    resolvedFields: Object.keys(resolved.values).length,
    missingFields: resolved.missing.length,
    sploseUnavailable: sploseFailed,
  });

  res.json({
    values: resolved.values,
    sources: resolved.sources,
    missing: resolved.missing,
    sploseUnavailable: sploseFailed,
    participant: splose ? {
      fullName: splose.fullName, ndisNumber: splose.ndisNumber, email: splose.email,
    } : null,
  });
}));

/** The live preview: the composed document as a renderable outline. */
router.get('/api/service-agreements/:id/preview', safe(async (req, res) => {
  const agreement = await loadAgreement(req, res);
  if (!agreement) return;

  const master = agreement.master_version_id
    ? await sadb.getMasterVersion(orgOf(req), agreement.master_version_id)
    : (await ensurePublishedMaster(orgOf(req), req.user.id)).master;

  const { docx, manifest } = await composeArtifacts(agreement, master, {
    audience: 'participant', blankStyle: 'empty', withPdf: false,
  });
  const outline = await outlineFromDocx(docx);

  res.json({
    blocks: outline.blocks,
    fieldCount: outline.fields.length,
    blanks: manifest.blanks,
    supportTotals: manifest.supportTotals,
    warnings: manifest.warnings,
  });
}));

/**
 * Issue the agreement.
 *
 * The moment everything is PINNED: the master version, its hash, the clause
 * snapshot, the organisation snapshot, the pricing snapshot and the field
 * sources. From here a new master publication cannot alter this document.
 */
router.post('/api/service-agreements/:id/issue', safe(async (req, res) => {
  const agreement = await loadAgreement(req, res);
  if (!agreement) return;
  if (!canEdit(req, agreement)) return res.status(403).json({ error: 'Forbidden' });
  if (!['draft', 'ready'].includes(agreement.state)) {
    return res.status(409).json({ error: 'This agreement has already been issued.' });
  }

  const settings = await orgIdentity.getSettings(orgOf(req));
  if (!settings.complete) {
    return res.status(409).json({
      error: 'The practice details for service agreements are incomplete.',
      missing: settings.missing,
    });
  }

  const { master } = await ensurePublishedMaster(orgOf(req), req.user.id);
  const organisation = await orgIdentity.snapshotFor(orgOf(req));
  const reference = documentReference(map.DOCUMENT_PREFIX, agreement.id);

  const pinned = {
    ...agreement,
    reference,
    issued_at: new Date(),
    organisation_snapshot: organisation.values,
    clause_snapshot: master.clause_snapshot,
  };

  const { manifest, docx, pdf } = await composeArtifacts(pinned, master, {
    audience: 'participant',
    blankStyle: 'empty',
    lockProviderFields: true,
    statusLabel: 'Issued',
  });

  const issued = await sadb.withTransaction(async (q) => {
    const row = await sadb.issueAgreement(orgOf(req), agreement.id, {
      reference,
      masterVersionId: master.id,
      masterSha256: master.source_sha256,
      masterVersionLabel: master.version_label,
      clauseSnapshot: master.clause_snapshot,
      organisationSnapshot: organisation.values,
      pricingSnapshot: pricingSnapshotFrom(manifest),
      fieldSources: { ...(agreement.field_sources || {}), ...manifest.sources },
    }, req.user.id, q);

    if (!row) return null;

    await sadb.createArtifact({
      agreementId: row.id,
      kind: 'issued_pdf',
      filename: agreementFilename({ reference, participantName: row.participant_name }),
      mimeType: PDF_MIME,
      fileData: pdf.bytes.toString('base64'),
      byteSize: pdf.bytes.length,
      checksumSha256: sadb.sha256(pdf.bytes),
      pageCount: pdf.pageCount,
      fieldCount: pdf.fieldCount,
      audience: 'participant',
      createdByUserId: req.user.id,
    }, q);

    // The Word copy is retained for the owner even though staff can never
    // download it: reproducing an issued agreement in Word later is an owner
    // capability, and regenerating it then would use whatever the code says at
    // that point rather than what it said today.
    await sadb.createArtifact({
      agreementId: row.id,
      kind: 'issued_docx',
      filename: `${agreementFilename({ reference, participantName: row.participant_name }).replace(/\.pdf$/, '')}.docx`,
      mimeType: DOCX_MIME,
      fileData: docx.toString('base64'),
      byteSize: docx.length,
      checksumSha256: sadb.sha256(docx),
      audience: 'owner',
      createdByUserId: req.user.id,
    }, q);

    return row;
  });

  if (!issued) return res.status(409).json({ error: 'This agreement could not be issued.' });

  await audit(req, 'SERVICE_AGREEMENT_ISSUED', issued.id, {
    reference,
    masterVersionId: master.id,
    masterVersionLabel: master.version_label,
    masterSha256: master.source_sha256,
    pdfSha256: sadb.sha256(pdf.bytes),
    pageCount: pdf.pageCount,
    fieldCount: pdf.fieldCount,
    supportCount: manifest.supports.length,
    totalDisplay: manifest.supportTotals.display,
  });

  res.json({ ok: true, agreement: issued, warnings: manifest.warnings });
}));

/** The fillable PDF. Available at any state; composed fresh before issue. */
router.get('/api/service-agreements/:id/pdf', safe(async (req, res) => {
  const agreement = await loadAgreement(req, res);
  if (!agreement) return;

  const stored = await sadb.latestArtifact(agreement.id,
    agreement.state === 'signed' || agreement.state === 'completed' ? 'final_pdf' : 'issued_pdf');

  if (stored) {
    await audit(req, 'SERVICE_AGREEMENT_DOWNLOADED', agreement.id, {
      format: 'pdf', kind: stored.kind, checksum: stored.checksum_sha256,
    });
    return sendFile(res, artifactBytes(stored), stored.filename, PDF_MIME,
      req.query.disposition === 'inline' ? 'inline' : 'attachment');
  }

  // Not yet issued: compose a working copy. `manual` mode leaves every field
  // open, which is what a blank printable form is for.
  const master = (await ensurePublishedMaster(orgOf(req), req.user.id)).master;
  const manualMode = agreement.completion_mode === 'manual' || req.query.blank === '1';
  const { pdf, meta } = await composeArtifacts(agreement, master, {
    audience: 'participant',
    blankStyle: 'empty',
    lockProviderFields: false,
    statusLabel: manualMode ? 'Draft — for completion' : 'Draft',
  });

  await audit(req, 'SERVICE_AGREEMENT_DOWNLOADED', agreement.id, {
    format: 'pdf', kind: 'draft_pdf', pageCount: pdf.pageCount, fieldCount: pdf.fieldCount,
  });

  sendFile(res, pdf.bytes, agreementFilename(meta, 'draft'), PDF_MIME,
    req.query.disposition === 'inline' ? 'inline' : 'attachment');
}));

/**
 * The Word copy of one agreement. OWNER ONLY.
 *
 * `?blank=1` produces the manual copy: every unknown field carries its
 * human-readable prompt rather than an empty box, because this file exists to
 * be completed in Word and an unlabelled cell is a question nobody can answer.
 */
router.get('/api/service-agreements/:id/docx', requireOwner, safe(async (req, res) => {
  const agreement = await loadAgreement(req, res);
  if (!agreement) return;

  const blank = req.query.blank === '1';
  const stored = blank ? null : await sadb.latestArtifact(agreement.id, 'issued_docx');

  if (stored) {
    // Served EXACTLY as issued. An issued agreement is a record, and its
    // recorded checksum is what proves the bytes are the bytes — sanitising
    // here would break that for the sake of a warning on a document nobody
    // should be editing anyway. Agreements issued before the safety patch keep
    // the warning in their Word copy; their PDF never had it. The audit says
    // which, so the state is visible rather than assumed.
    const bytes = artifactBytes(stored);
    const asIssued = await auditDocx(bytes);
    await audit(req, 'SERVICE_AGREEMENT_DOWNLOADED', agreement.id, {
      format: 'docx', kind: 'issued_docx', checksum: stored.checksum_sha256,
      servedAsIssued: true,
      updateFieldsEnabled: asIssued.updateFields === true,
    });
    return sendFile(res, bytes, stored.filename, DOCX_MIME);
  }

  const master = agreement.master_version_id
    ? await sadb.getMasterVersion(orgOf(req), agreement.master_version_id)
    : (await ensurePublishedMaster(orgOf(req), req.user.id)).master;

  const source = blank
    ? { ...agreement, form_data: {}, support_rows: agreement.support_rows?.length ? agreement.support_rows : [{}] }
    : agreement;

  const { docx, meta } = await composeArtifacts(source, master, {
    audience: 'participant',
    blankStyle: blank ? 'prompt' : 'empty',
    withPdf: false,
    statusLabel: blank ? 'Blank — for completion' : stateLabel(agreement.state),
  });

  await audit(req, 'SERVICE_AGREEMENT_DOWNLOADED', agreement.id, {
    format: 'docx', kind: blank ? 'blank_docx' : 'populated_docx', sha256: sadb.sha256(docx),
  });

  sendFile(res, docx,
    `${agreementFilename(meta, blank ? 'blank' : '').replace(/\.pdf$/, '')}.docx`, DOCX_MIME);
}));

// ── Email and signing sessions ──────────────────────────────────────────────

router.post('/api/service-agreements/:id/email', safe(async (req, res) => {
  const agreement = await loadAgreement(req, res);
  if (!agreement) return;
  if (!canEdit(req, agreement)) return res.status(403).json({ error: 'Forbidden' });
  if (!['issued', 'viewed', 'partially_completed'].includes(agreement.state)) {
    return res.status(409).json({ error: 'Issue the agreement before sending it.' });
  }

  const recipient = String(req.body?.recipientEmail || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    return res.status(400).json({ error: 'A valid recipient email address is required.' });
  }
  const signatoryType = signing.SIGNATORY_TYPES.includes(req.body?.signatoryType)
    ? req.body.signatoryType : 'participant';

  const { token, tokenHash } = signing.mintToken();
  const expiresAt = signing.expiryFrom(new Date(), req.body?.expiryDays);

  let session;
  try {
    session = await sadb.createSigningSession({
      agreementId: agreement.id,
      organisationId: agreement.organisation_id,
      tokenSha256: tokenHash,
      signatoryType,
      recipientEmail: recipient,
      recipientName: req.body?.recipientName || agreement.participant_name || null,
      assignedTags: signing.assignedTagsFor(signatoryType),
      expiresAt,
      issuedByUserId: req.user.id,
    });
  } catch (err) {
    // The partial unique index refuses a second live link for the same
    // signatory. Revoking the first is a deliberate act, not a side effect of
    // pressing Send twice.
    if (err.code === '23505') {
      return res.status(409).json({
        error: 'A completion link is already outstanding for this signatory. Revoke it first.',
      });
    }
    throw err;
  }

  const baseUrl = email.getBaseUrl();
  const url = signing.buildSigningUrl(baseUrl, token);

  let result;
  try {
    result = await sendSigningEmail({
      to: recipient,
      recipientName: session.recipient_name,
      url,
      message: String(req.body?.message || '').slice(0, 1200),
      agreement,
      expiresAt,
    });
  } catch (err) {
    await sadb.recordDelivery({
      agreementId: agreement.id,
      signingSessionId: session.id,
      organisationId: agreement.organisation_id,
      recipientEmail: recipient,
      senderUserId: req.user.id,
      message: req.body?.message || null,
      masterVersionLabel: agreement.master_version_label,
      agreementReference: agreement.reference,
      result: 'failed',
      resultDetail: String(err.message).slice(0, 500),
      linkExpiresAt: expiresAt,
    });
    await audit(req, 'SERVICE_AGREEMENT_EMAIL_FAILED', agreement.id, {
      recipient, sessionId: session.id, error: err.message,
    });
    return res.status(502).json({ error: 'The email could not be sent.' });
  }

  const delivery = await sadb.recordDelivery({
    agreementId: agreement.id,
    signingSessionId: session.id,
    organisationId: agreement.organisation_id,
    recipientEmail: recipient,
    senderUserId: req.user.id,
    message: req.body?.message || null,
    includedPdf: false,
    masterVersionLabel: agreement.master_version_label,
    agreementReference: agreement.reference,
    result: result.skipped ? 'skipped' : 'sent',
    resultDetail: result.skipped ? 'Email is not configured in this environment.' : null,
    linkExpiresAt: expiresAt,
  });

  await audit(req, 'SERVICE_AGREEMENT_EMAILED', agreement.id, {
    recipient,
    sessionId: session.id,
    signatoryType,
    reference: agreement.reference,
    masterVersionLabel: agreement.master_version_label,
    expiresAt: expiresAt.toISOString(),
    result: delivery.result,
  });

  res.json({
    ok: true,
    delivery,
    session: { id: session.id, signatoryType, recipientEmail: recipient, expiresAt },
    // In development, where no SMTP is configured, the link is returned so the
    // flow is testable. email.getBaseUrl() already refuses to build a localhost
    // link outside development/test, so this cannot leak a live token via a
    // misconfigured production box.
    signingUrl: result.skipped ? url : undefined,
  });
}));

/**
 * The completion email.
 *
 * Inline HTML plus a plain-text alternative, matching every other templated
 * email in email.js. Deliberately says almost nothing: the recipient's name,
 * that there is an agreement to review, and the link. A service agreement
 * carries NDIS numbers, disability information and prices, and an email is not
 * a private channel.
 */
async function sendSigningEmail({ to, recipientName, url, message, agreement, expiresAt }) {
  const esc = email.escapeHtml;
  const who = recipientName ? esc(recipientName) : 'Hello';
  const expiry = expiresAt.toLocaleDateString('en-AU', { timeZone: 'UTC' });
  const note = message ? `<p style="margin:0 0 16px">${esc(message)}</p>` : '';

  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1F2A28;max-width:560px">
    <p style="margin:0 0 16px">${who},</p>
    <p style="margin:0 0 16px">Opal Therapy has prepared a service agreement for you to review,
      complete and sign.</p>
    ${note}
    <p style="margin:0 0 24px"><a href="${esc(url)}"
      style="background:#2F5651;color:#fff;padding:12px 20px;border-radius:6px;
             text-decoration:none;display:inline-block">Open your agreement</a></p>
    <p style="margin:0 0 8px;font-size:13px;color:#566E70">
      This link is personal to you and stops working on ${esc(expiry)}.</p>
    <p style="margin:0;font-size:13px;color:#566E70">
      If you did not expect this, please contact Opal Therapy before opening it.</p>
  </div>`;

  const text = [
    `${recipientName || 'Hello'},`,
    '',
    'Opal Therapy has prepared a service agreement for you to review, complete and sign.',
    message ? `\n${message}\n` : '',
    url,
    '',
    `This link is personal to you and stops working on ${expiry}.`,
    'If you did not expect this, please contact Opal Therapy before opening it.',
  ].filter((l) => l !== '').join('\n');

  return email.sendTemplated({
    to, subject: 'Your Opal Therapy service agreement', html, text,
  });
}

router.post('/api/service-agreements/:id/sessions/:sessionId/revoke', safe(async (req, res) => {
  const agreement = await loadAgreement(req, res);
  if (!agreement) return;
  if (!canEdit(req, agreement)) return res.status(403).json({ error: 'Forbidden' });
  if (!isUuid(req.params.sessionId)) return res.status(404).json({ error: 'Not found' });

  const revoked = await sadb.revokeSession(orgOf(req), req.params.sessionId, req.user.id);
  if (!revoked) return res.status(409).json({ error: 'That link is no longer outstanding.' });

  await audit(req, 'SERVICE_AGREEMENT_LINK_REVOKED', agreement.id, {
    sessionId: revoked.id, recipient: revoked.recipient_email,
  });
  res.json({ ok: true });
}));

// ── Returned PDF, finalisation, voiding ─────────────────────────────────────

/**
 * A completed PDF the participant returned by hand.
 *
 * The original file is STORED as it arrived and its hash recorded alongside
 * the issued document's, so a later reader can see whether they match. What is
 * deliberately NOT done is claim the signature inside it was verified: nothing
 * here can validate a PKCS#7 signature, and an image of a signature is an
 * image. The audit record says exactly that.
 */
router.post('/api/service-agreements/:id/returned-pdf', safe(async (req, res) => {
  const agreement = await loadAgreement(req, res);
  if (!agreement) return;
  if (!canEdit(req, agreement)) return res.status(403).json({ error: 'Forbidden' });
  if (!['issued', 'viewed', 'partially_completed'].includes(agreement.state)) {
    return res.status(409).json({ error: 'Only an outstanding agreement can accept a returned copy.' });
  }

  const b64 = req.body?.fileBase64;
  if (typeof b64 !== 'string' || !b64) {
    return res.status(400).json({ error: 'A completed PDF is required.' });
  }
  const buffer = Buffer.from(b64, 'base64');
  if (buffer.length === 0 || buffer.length > 25 * 1024 * 1024) {
    return res.status(400).json({ error: 'The file must be between 1 byte and 25 MB.' });
  }
  if (buffer.slice(0, 5).toString('latin1') !== '%PDF-') {
    return res.status(400).json({ error: 'That file is not a PDF.' });
  }

  const issued = await sadb.latestArtifact(agreement.id, 'issued_pdf');
  const returnedSha = sadb.sha256(buffer);

  // Can we still read it as a form? A returned file that no longer parses is
  // stored anyway — it is evidence — but the fact is recorded.
  let readable = false;
  let filledFields = 0;
  try {
    const { PDFDocument } = require('pdf-lib');
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const form = doc.getForm();
    filledFields = form.getFields().filter((f) => {
      try { return typeof f.getText === 'function' && String(f.getText() || '').trim() !== ''; }
      catch (_) { return false; }
    }).length;
    readable = true;
  } catch (_) { readable = false; }

  const artifact = await sadb.createArtifact({
    agreementId: agreement.id,
    kind: 'returned_pdf',
    filename: String(req.body?.filename || 'returned-agreement.pdf').slice(0, 180),
    mimeType: PDF_MIME,
    fileData: buffer.toString('base64'),
    byteSize: buffer.length,
    checksumSha256: returnedSha,
    fieldCount: filledFields,
    audience: 'internal',
    createdByUserId: req.user.id,
  });

  await audit(req, 'SERVICE_AGREEMENT_RETURNED_PDF_UPLOADED', agreement.id, {
    artifactId: artifact.id,
    returnedSha256: returnedSha,
    issuedSha256: issued ? issued.checksum_sha256 : null,
    matchesIssuedDocument: issued ? issued.checksum_sha256 === returnedSha : null,
    byteSize: buffer.length,
    readableAsForm: readable,
    filledFieldCount: filledFields,
    // Stated in the record itself so nobody reading it later infers otherwise.
    cryptographicSignatureValidated: false,
    signatureAssurance: 'not_verified',
  });

  res.status(201).json({
    ok: true,
    artifact,
    comparison: {
      returnedSha256: returnedSha,
      issuedSha256: issued ? issued.checksum_sha256 : null,
      identical: issued ? issued.checksum_sha256 === returnedSha : null,
      readableAsForm: readable,
      filledFieldCount: filledFields,
      cryptographicSignatureValidated: false,
    },
  });
}));

/**
 * Finalise: produce the immutable final PDF and lock the agreement.
 *
 * Every field is made read-only in the final document — including the
 * signature fields, which by this point hold their values. "Flatten" is
 * deliberately NOT used: flattening discards the form structure, and with it
 * the ability to show later that a particular value sat in a particular named
 * field.
 */
router.post('/api/service-agreements/:id/finalise', safe(async (req, res) => {
  const agreement = await loadAgreement(req, res);
  if (!agreement) return;
  if (!canEdit(req, agreement)) return res.status(403).json({ error: 'Forbidden' });
  if (!['issued', 'viewed', 'partially_completed', 'completed'].includes(agreement.state)) {
    return res.status(409).json({ error: 'This agreement cannot be finalised from its current state.' });
  }

  const master = await sadb.getMasterVersion(orgOf(req), agreement.master_version_id);
  if (!master) return res.status(409).json({ error: 'The pinned master version is unavailable.' });

  const result = await finaliseAgreement({
    agreement, master, actorUserId: req.user.id, reason: 'staff_finalised',
  });

  await audit(req, 'SERVICE_AGREEMENT_FINALISED', agreement.id, {
    finalSha256: result.sha256,
    pageCount: result.pageCount,
    artifactId: result.artifact.id,
    reference: agreement.reference,
  });

  res.json({ ok: true, agreement: result.agreement, artifact: result.artifact });
}));

/**
 * Build and store the final locked PDF, and move the agreement to 'signed'.
 * Shared by the staff finalise route and the participant signing route so the
 * two cannot produce different final documents.
 */
async function finaliseAgreement({ agreement, master, actorUserId, signatures = {}, reason }) {
  const { docx, meta } = await composeArtifacts(agreement, master, {
    audience: 'participant',
    blankStyle: 'empty',
    withPdf: false,
    signatures,
    statusLabel: 'Signed',
  });

  const pdf = await renderAgreementPdf({
    docxBuffer: docx, meta, lockProviderFields: true,
  });

  // Lock EVERY field. The document is now a record, not a form.
  const { PDFDocument } = require('pdf-lib');
  const doc = await PDFDocument.load(pdf.bytes);
  const form = doc.getForm();
  for (const field of form.getFields()) {
    try { field.enableReadOnly(); } catch (_) { /* a field that cannot lock is still recorded */ }
  }
  const finalBytes = Buffer.from(await doc.save({ updateFieldAppearances: false }));
  const sha256 = sadb.sha256(finalBytes);

  const out = await sadb.withTransaction(async (q) => {
    const artifact = await sadb.createArtifact({
      agreementId: agreement.id,
      kind: 'final_pdf',
      filename: agreementFilename(meta, 'signed'),
      mimeType: PDF_MIME,
      fileData: finalBytes.toString('base64'),
      byteSize: finalBytes.length,
      checksumSha256: sha256,
      pageCount: pdf.pageCount,
      fieldCount: pdf.fieldCount,
      audience: 'participant',
      createdByUserId: actorUserId,
    }, q);

    const row = await sadb.transitionAgreement(
      agreement.id, 'signed',
      ['issued', 'viewed', 'partially_completed', 'completed'],
      { completed_at: new Date(), signed_at: new Date() },
      q
    );

    return { artifact, agreement: row };
  });

  return { ...out, sha256, pageCount: pdf.pageCount, reason };
}

router.post('/api/service-agreements/:id/void', safe(async (req, res) => {
  const agreement = await loadAgreement(req, res);
  if (!agreement) return;
  if (!canEdit(req, agreement)) return res.status(403).json({ error: 'Forbidden' });

  const reason = String(req.body?.reason || '').trim().slice(0, 500);
  if (!reason) return res.status(400).json({ error: 'A reason is required to void an agreement.' });

  // A SIGNED agreement can be voided, and that is deliberate. Voiding is not
  // editing: an agreement signed in error, superseded by a renegotiated plan,
  // or withdrawn from by the participant has to be markable as no longer in
  // force, and refusing would leave a practice with a live contract it cannot
  // retire. What voiding must NOT do is rewrite history — and it cannot: the
  // database trigger freezes a signed agreement's content, its snapshots and
  // its pin, and every artifact is immutable. The signature, the final PDF and
  // the audit trail all survive, with the reason recorded beside them.
  const voided = await sadb.transitionAgreement(
    agreement.id, 'void',
    ['draft', 'ready', 'issued', 'viewed', 'partially_completed', 'completed', 'signed'],
    { voided_at: new Date(), void_reason: reason }
  );
  if (!voided) return res.status(409).json({ error: 'This agreement cannot be voided.' });

  // Any live link dies with the agreement.
  await pool.query(
    `UPDATE service_agreement_signing_sessions
        SET status = 'revoked', revoked_at = NOW(), revoked_by_user_id = $2
      WHERE agreement_id = $1 AND status IN ('pending','viewed','in_progress')`,
    [agreement.id, req.user.id]
  );

  await audit(req, 'SERVICE_AGREEMENT_VOIDED', agreement.id, { reason, reference: agreement.reference });
  res.json({ ok: true, agreement: voided });
}));

/** The agreement's own audit trail. */
router.get('/api/service-agreements/:id/audit', safe(async (req, res) => {
  const agreement = await loadAgreement(req, res);
  if (!agreement) return;

  const { rows } = await pool.query(
    `SELECT id, action, actor_user_id, metadata, ip_address, created_at
       FROM audit_logs
      WHERE target_type = 'service_agreement' AND target_id = $1
        AND organisation_id IS NOT DISTINCT FROM $2
      ORDER BY created_at ASC`,
    [String(agreement.id), orgOf(req)]
  );
  res.json({ events: rows });
}));

// ═════════════════════════════════════════════════════════════════════════════
//  PUBLIC SIGNING SURFACE — no session, token only
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Load the session behind a token.
 *
 * Every failure returns the SAME shape and the same status. Distinguishing
 * "revoked" from "expired" from "never existed" in a public response tells
 * somebody probing tokens which of their guesses was close, and none of those
 * distinctions helps a genuine recipient, who can only contact the practice
 * either way.
 */
async function loadSession(req, res) {
  const token = String(req.params.token || '');
  if (token.length < 20 || token.length > 200) {
    res.status(404).json({ error: 'This link cannot be used.' });
    return null;
  }

  const session = await sadb.getSessionByTokenHash(signing.hashToken(token));
  const reason = signing.sessionUnusableReason(session);
  if (reason) {
    res.status(reason === 'completed' ? 409 : 404).json({
      error: reason === 'completed'
        ? 'This agreement has already been signed.'
        : 'This link cannot be used.',
    });
    return null;
  }
  return session;
}

/** Has the recipient proved they are the addressee? */
function verified(session) {
  return session.verification_state === 'verified';
}

router.get('/api/service-agreement-signing/:token', safe(async (req, res) => {
  const session = await loadSession(req, res);
  if (!session) return;

  if (!session.first_viewed_at) {
    await sadb.updateSession(session.id, { first_viewed_at: new Date(), status: 'viewed' });
    await pool.query(
      `UPDATE service_agreements SET state = 'viewed', first_viewed_at = NOW()
        WHERE id = $1 AND state = 'issued'`,
      [session.agreement_id]
    );
    await auditPublic(req, 'SERVICE_AGREEMENT_LINK_VIEWED', session.agreement_id,
      session.organisation_id, { sessionId: session.id, signatoryType: session.signatory_type });
  }

  // Before verification the response carries NOTHING about the participant or
  // the agreement — only that a link exists and which address it went to, and
  // that address is masked. Anyone holding the token already knows they were
  // sent something; they should not learn a participant's name from it.
  if (!verified(session)) {
    return res.json({
      state: 'verify',
      emailHint: maskEmail(session.recipient_email),
      signatoryType: session.signatory_type,
      expiresAt: session.expires_at,
    });
  }

  const agreement = await sadb.getAgreementForSigning(session.agreement_id);
  if (!agreement) return res.status(404).json({ error: 'This link cannot be used.' });

  res.json({
    state: 'ready',
    signatoryType: session.signatory_type,
    recipientName: session.recipient_name,
    expiresAt: session.expires_at,
    consentGiven: session.consent_electronic,
    agreement: {
      reference: agreement.reference,
      participantName: agreement.participant_name,
      masterVersionLabel: agreement.master_version_label,
      issuedAt: agreement.issued_at,
      state: agreement.state,
    },
    assignedFields: (session.assigned_tags || []).map((tag) => {
      const f = map.SCALAR_BY_TAG[tag];
      return f ? {
        tag, kind: f.kind, prompt: f.prompt, choices: f.choices, group: f.group,
        value: (agreement.form_data || {})[tag] || '',
      } : null;
    }).filter(Boolean),
  });
}));

/** "jordan.whitlock@example.com" → "j••••••••k@example.com" */
function maskEmail(value) {
  const s = String(value || '');
  const at = s.indexOf('@');
  if (at < 1) return '•••';
  const local = s.slice(0, at);
  const domain = s.slice(at);
  if (local.length <= 2) return `${local[0]}•${domain}`;
  return `${local[0]}${'•'.repeat(Math.max(1, local.length - 2))}${local[local.length - 1]}${domain}`;
}

router.post('/api/service-agreement-signing/:token/verify', safe(async (req, res) => {
  const session = await loadSession(req, res);
  if (!session) return;

  if (!signing.recipientMatches(req.body?.email, session.recipient_email)) {
    const attempts = await sadb.recordVerificationFailure(session.id);
    await auditPublic(req, 'SERVICE_AGREEMENT_VERIFICATION_FAILED', session.agreement_id,
      session.organisation_id, { sessionId: session.id, attempts });
    return res.status(403).json({
      error: 'That email address does not match the one this link was sent to.',
      attemptsRemaining: Math.max(0, signing.MAX_VERIFICATION_ATTEMPTS - (attempts || 0)),
    });
  }

  await sadb.updateSession(session.id, {
    verification_state: 'verified',
    status: session.status === 'pending' ? 'viewed' : session.status,
  });
  await auditPublic(req, 'SERVICE_AGREEMENT_VERIFIED', session.agreement_id,
    session.organisation_id, { sessionId: session.id });

  res.json({ ok: true });
}));

router.post('/api/service-agreement-signing/:token/save', safe(async (req, res) => {
  const session = await loadSession(req, res);
  if (!session) return;
  if (!verified(session)) return res.status(403).json({ error: 'Confirm your email address first.' });

  const { accepted, rejected } = signing.filterSubmission(
    req.body?.values || {}, session.assigned_tags || []
  );

  const updated = await sadb.mergeParticipantValues(session.agreement_id, accepted);
  if (!updated) return res.status(409).json({ error: 'This agreement can no longer be changed.' });

  await sadb.updateSession(session.id, { status: 'in_progress' });
  await pool.query(
    `UPDATE service_agreements SET state = 'partially_completed'
      WHERE id = $1 AND state IN ('issued','viewed')`,
    [session.agreement_id]
  );

  await auditPublic(req, 'SERVICE_AGREEMENT_PARTICIPANT_SAVED', session.agreement_id,
    session.organisation_id, {
      sessionId: session.id,
      fieldsSaved: Object.keys(accepted).length,
      fieldsRejected: rejected.length,
    });

  res.json({ ok: true, saved: Object.keys(accepted).length, rejected });
}));

/**
 * Sign.
 *
 * The signature values come from the SESSION and the server's clock, never
 * from the request body — see signing.signatureValuesFor. The request supplies
 * the typed name, the capacity and an explicit statement of intent, and all
 * three are recorded.
 */
router.post('/api/service-agreement-signing/:token/sign', safe(async (req, res) => {
  const session = await loadSession(req, res);
  if (!session) return;
  if (!verified(session)) return res.status(403).json({ error: 'Confirm your email address first.' });

  const name = String(req.body?.signatureName || '').trim();
  if (name.length < 2) {
    return res.status(400).json({ error: 'Type your full name to sign.' });
  }
  if (req.body?.intent !== true) {
    return res.status(400).json({ error: 'You must confirm that you intend to sign this agreement.' });
  }
  if (req.body?.consentElectronic !== true && !session.consent_electronic) {
    return res.status(400).json({
      error: 'You must agree to sign electronically before you can sign.',
    });
  }

  const agreement = await sadb.getAgreementForSigning(session.agreement_id);
  if (!agreement) return res.status(404).json({ error: 'This link cannot be used.' });
  if (!['issued', 'viewed', 'partially_completed', 'completed'].includes(agreement.state)) {
    return res.status(409).json({ error: 'This agreement can no longer be signed.' });
  }

  const master = await sadb.getMasterVersionAny(agreement.master_version_id);
  if (!master) return res.status(409).json({ error: 'This agreement cannot be produced right now.' });

  const signedAt = new Date();
  const capacity = String(req.body?.capacity || '').trim().slice(0, 120);

  // The signatory's own name and capacity go in as ORDINARY portal values; the
  // signature and its date are produced from the session.
  const identityValues = {};
  if (session.signatory_type !== 'witness') {
    identityValues.OPAL_PARTICIPANT_SIGNATORY_NAME = name;
    if (capacity) identityValues.OPAL_PARTICIPANT_SIGNATORY_CAPACITY = capacity;
  } else {
    identityValues.OPAL_WITNESS_NAME = name;
  }
  await sadb.mergeParticipantValues(agreement.id, identityValues);

  const refreshed = await sadb.getAgreementForSigning(agreement.id);
  const signatures = signing.signatureValuesFor(
    { ...session, signature_name: name }, signedAt, asDate
  );

  const result = await finaliseAgreement({
    agreement: refreshed, master, actorUserId: null, signatures, reason: 'participant_signed',
  });

  await sadb.updateSession(session.id, {
    status: 'completed',
    completed_at: signedAt,
    signature_name: name,
    signature_capacity: capacity || null,
    signature_intent: true,
    consent_electronic: true,
    consent_recorded_at: session.consent_recorded_at || signedAt,
    final_document_sha256: result.sha256,
    signature_metadata: JSON.stringify(signing.signatureMetadata({
      ip: req.ip,
      userAgent: req.get('user-agent'),
      signedAt,
      documentSha256: result.sha256,
      capacity,
      intent: true,
    })),
  });

  await auditPublic(req, 'SERVICE_AGREEMENT_SIGNED', agreement.id, session.organisation_id, {
    sessionId: session.id,
    signatoryType: session.signatory_type,
    signatoryName: name,
    capacity: capacity || null,
    signedAt: signedAt.toISOString(),
    finalDocumentSha256: result.sha256,
    // Said plainly, in the record, so nobody later reads more into it.
    cryptographicSignatureApplied: false,
    signatureAssurance: 'portal_typed_signature',
  });

  res.json({
    ok: true,
    signedAt,
    reference: agreement.reference,
    finalDocumentSha256: result.sha256,
  });
}));

/** The participant's own copy. Their agreement, and no other. */
router.get('/api/service-agreement-signing/:token/pdf', safe(async (req, res) => {
  const token = String(req.params.token || '');
  const session = await sadb.getSessionByTokenHash(signing.hashToken(token));

  // A COMPLETED session may still download: the participant must be able to
  // keep a copy of what they signed. Only revoked and expired links are dead.
  if (!session || session.status === 'revoked'
      || (session.expires_at && new Date(session.expires_at) <= new Date()
          && session.status !== 'completed')) {
    return res.status(404).json({ error: 'This link cannot be used.' });
  }
  if (!verified(session)) return res.status(403).json({ error: 'Confirm your email address first.' });

  const agreement = await sadb.getAgreementForSigning(session.agreement_id);
  if (!agreement) return res.status(404).json({ error: 'This link cannot be used.' });

  const artifact = await sadb.latestArtifact(agreement.id, 'final_pdf')
    || await sadb.latestArtifact(agreement.id, 'issued_pdf');
  if (!artifact) return res.status(404).json({ error: 'No document is available yet.' });

  await auditPublic(req, 'SERVICE_AGREEMENT_PARTICIPANT_DOWNLOADED', agreement.id,
    session.organisation_id, {
      sessionId: session.id, kind: artifact.kind, checksum: artifact.checksum_sha256,
    });

  sendFile(res, artifactBytes(artifact), artifact.filename, PDF_MIME,
    req.query.disposition === 'inline' ? 'inline' : 'attachment');
}));

module.exports = router;
module.exports.ensurePublishedMaster = ensurePublishedMaster;
module.exports.composeArtifacts = composeArtifacts;
module.exports.finaliseAgreement = finaliseAgreement;
module.exports.maskEmail = maskEmail;
module.exports.serverValuesFor = serverValuesFor;
module.exports.pricingSnapshotFrom = pricingSnapshotFrom;
