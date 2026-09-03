'use strict';

/**
 * PHASE 2 — routes for the per-employee document pack.
 *
 *   pack           GET  /api/onboarding/journey/records/:id/pack
 *   prepare        POST …/pack/prepare            derive the defaults (idempotent)
 *   items          POST …/pack/items              add a document
 *                  PATCH …/pack/items/:itemId     rename / flags
 *                  POST …/pack/items/:itemId/remove | restore
 *                  POST …/pack/items/:itemId/file  replace the file (this person only)
 *                  DELETE …/pack/items/:itemId/file back to the library copy
 *                  GET  …/pack/items/:itemId/preview | download
 *                  POST …/pack/reorder
 *   zip            GET  …/pack/zip                the ZIP as it would go out
 *   email          PUT  …/pack/email  ·  POST …/pack/email/reset
 *                  POST …/pack/email/draft        build the ZIP, create the Outlook draft
 *                  POST …/pack/mark-sent  ·  POST …/pack/unmark-sent
 *
 * THE INDIVIDUAL DOCUMENTS ARE THE SOURCE OF TRUTH. The ZIP is built when
 * the email is prepared, stored through 038's starter-pack table for the
 * record, and rebuilt from the items whenever they change.
 */

const express = require('express');
const router = express.Router();

const odb = require('./onboarding-db');
const wdb = require('./onboarding-workflow-db');
const pdb = require('./onboarding-pack-db');
const pack = require('./onboarding-pack');
const packEmail = require('./onboarding-pack-email');
const graphMail = require('./graph-mail');
const { auditOnboarding } = require('./onboarding-audit');
const { requireAuth, requirePermission, hasPermission } = require('./permissions');
const log = require('./logger').createLogger('onboarding-pack');

const orgOf = (req) => req.user?.organisation_id || null;
const { isUuid, str } = odb;

const safe = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  log.error('pack route error', { error: err, path: req.path });
  if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
});
const notFound = (res) => res.status(404).json({ error: 'Not found' });
const noStore = (res) => res.set('Cache-Control', 'no-store');

async function loadRecord(req) {
  if (!isUuid(req.params.id)) return null;
  return odb.getAssignment(orgOf(req), req.params.id);
}
async function orgName(orgId) {
  try {
    const { rows } = await odb.pool.query('SELECT name FROM organisations WHERE id = $1', [orgId]);
    return rows[0]?.name || 'Opal Therapy';
  } catch (_) { return 'Opal Therapy'; }
}

/** Phase 1 must be settled before the pack exists. */
async function phase1Settled(assignment) {
  const jdb = require('./onboarding-journey-db');
  const offer = await jdb.getCurrentOffer(assignment.id);
  return !!offer && ['accepted', 'not_required'].includes(offer.status);
}

const induction = require('./onboarding-induction');

/** The two packs, one machine. Everything phase-specific lives here. */
const PHASES = {
  documentation: {
    key: 'documentation', prefix: 'pack', dispatchKind: 'onboarding_pack', email: packEmail,
    cols: { prepared: 'pack_prepared_at', subject: 'pack_email_subject', body: 'pack_email_body', draftId: 'pack_email_draft_id', webLink: 'pack_email_web_link', draftedAt: 'pack_email_drafted_at', draftedBy: 'pack_email_drafted_by', sentAt: 'starter_pack_sent_at', sentTo: 'starter_pack_sent_to', sentBy: 'pack_sent_by', dueAt: 'pack_due_at' },
    zipName: 'Onboarding Documentation Pack', auditPrefix: 'pack',
    editable: (a) => ['created', 'starter_pack_ready'].includes(a.status),
    sentLabel: 'Onboarding Documents Sent',
  },
  induction: {
    key: 'induction', prefix: 'induction', dispatchKind: 'induction_pack', email: induction,
    cols: { prepared: 'induction_pack_prepared_at', subject: 'induction_email_subject', body: 'induction_email_body', draftId: 'induction_email_draft_id', webLink: 'induction_email_web_link', draftedAt: 'induction_email_drafted_at', draftedBy: 'induction_email_drafted_by', sentAt: 'induction_sent_at', sentTo: null, sentBy: 'induction_sent_by', dueAt: 'induction_due_at' },
    zipName: 'Internal Induction Pack', auditPrefix: 'induction',
    editable: (a) => !a.induction_sent_at && !['cancelled', 'archived', 'completed'].includes(a.status),
    sentLabel: 'Internal Induction Sent',
  },
};

/** The pack is editable until it has been marked sent. */
const packEditable = (a, phase = 'documentation') => PHASES[phase].editable(a);

// ── Shaping ─────────────────────────────────────────────────────────────────

function itemRow(row, assignmentId) {
  const file = pdb.describeItemFile(row);
  const base = `/api/onboarding/journey/records/${assignmentId}/pack/items/${row.id}`;
  return {
    id: row.id, code: row.code, title: row.title, description: row.description || null, section: row.section || null,
    sendsDocument: row.sends_document, employeeReturns: row.employee_returns,
    requiresVerification: row.requires_verification, required: row.required,
    origin: row.origin, requirementCode: row.requirement_code || null,
    status: row.status, removedReason: row.removed_reason || null, sortOrder: row.sort_order,
    library: row.document_id ? {
      documentId: row.document_id, code: row.library_code, title: row.library_title,
      contentStatus: row.library_content_status, pinnedVersionId: row.document_version_id || null,
      currentVersionId: row.current_version_id || null,
    } : null,
    officialSourceUrl: row.official_source_url || row.library_source_url || null,
    file: {
      ...file,
      ownCopy: row.file_name ? {
        fileName: row.file_name, size: row.file_size_bytes, sha256: row.file_sha256,
        uploadedAt: row.file_uploaded_at, uploadedByName: row.file_uploaded_by_name || null,
      } : null,
      previewUrl: file.source === 'none' || file.source === 'link' ? null : `${base}/preview`,
      downloadUrl: file.source === 'none' || file.source === 'link' ? null : `${base}/download`,
    },
    returnedAt: row.returned_at || null, returnedDocumentId: row.returned_document_id || null,
    verifiedAt: row.verified_at || null, verifiedByName: row.verified_by_name || null,
    verificationNote: row.verification_note || null,
    verificationStatus: row.verification_status || 'pending', verificationMode: row.verification_mode || null,
    attentionReason: row.attention_reason || null,
    phase: row.phase || 'documentation', itemKind: row.item_kind || 'document', linkedTaskCode: row.linked_task_code || null,
    completedAt: row.completed_at || null,
    // The one word the table shows.
    progress: row.status !== 'included' ? 'removed'
      : row.item_kind && row.item_kind !== 'document' ? (row.completed_at ? 'verified' : 'awaiting')
      : !row.employee_returns ? (row.sends_document ? 'sent' : 'n/a')
      : row.verification_status === 'verified' ? 'verified'
      : row.verification_status === 'attention' || row.verification_status === 'rejected' ? 'attention'
      : row.returned_at ? 'received' : 'awaiting_return',
  };
}

/** Everything the Stage 2 panel shows. */
async function packDetail(req, assignment, phase = 'documentation') {
  const P = PHASES[phase]; const C = P.cols;
  const rows = await pdb.listItems(assignment.id, undefined, phase);
  const items = rows.map((r) => itemRow(r, assignment.id));
  const included = items.filter((i) => i.status === 'included');
  const zip = await wdb.getLiveStarterPack(assignment.id);
  const zipIsOurs = zip && Array.isArray(zip.manifest) && (zip.manifest.length === 0 || zip.manifest[0].phase === phase);
  const emailDefault = phase === 'induction'
    ? induction.composeInductionEmail({ applicantName: assignment.applicant_name })
    : packEmail.composePackEmail({ applicantName: assignment.applicant_name });
  const base = `/api/onboarding/journey/records/${assignment.id}/${P.prefix}`;
  const tracked = included.filter((i) => i.employeeReturns || i.itemKind !== 'document');
  return {
    phase,
    prepared: !!assignment[C.prepared],
    preparedAt: assignment[C.prepared] || null,
    editable: packEditable(assignment, phase),
    sent: !!assignment[C.sentAt],
    sentLabel: P.sentLabel,
    items,
    tracking: {
      total: tracked.length, done: tracked.filter((i) => i.progress === 'verified').length,
      required: tracked.filter((i) => i.required).length, requiredDone: tracked.filter((i) => i.required && i.progress === 'verified').length,
    },
    counts: {
      included: included.length,
      sending: included.filter((i) => i.sendsDocument).length,
      sendable: included.filter((i) => i.sendsDocument && i.file.previewUrl).length,
      missingFiles: included.filter((i) => i.sendsDocument && !i.file.previewUrl).length,
      returns: included.filter((i) => i.employeeReturns).length,
      verifies: included.filter((i) => i.requiresVerification).length,
      removed: items.length - included.length,
      awaitingReturn: included.filter((i) => i.progress === 'awaiting_return').length,
      received: included.filter((i) => i.progress === 'received').length,
      verified: included.filter((i) => i.progress === 'verified').length,
      attention: included.filter((i) => i.progress === 'attention').length,
    },
    zip: zip && zipIsOurs ? {
      id: zip.id, fileName: zip.file_name, size: zip.file_size_bytes, documentCount: zip.document_count,
      generatedAt: zip.generated_at, manifest: zip.manifest || [], omissions: zip.omissions || [],
      downloadUrl: `${base}/zip`,
    } : null,
    email: {
      subject: assignment[C.subject] || emailDefault.subject,
      body: assignment[C.body] || emailDefault.body,
      draftId: assignment[C.draftId] || null, webLink: assignment[C.webLink] || null,
      draftedAt: assignment[C.draftedAt] || null,
      sentAt: assignment[C.sentAt] || null, sentTo: C.sentTo ? assignment[C.sentTo] || null : assignment.applicant_email,
      dueAt: assignment[C.dueAt] || null,
      outlook: { available: graphMail.isAvailable(req.user), reason: graphMail.unavailableReason(req.user) },
    },
    can: { assign: hasPermission(req.user, 'onboarding.assign'), review: hasPermission(req.user, 'onboarding.review') },
  };
}

/**
 * Derive this person's default pack from the pinned package version and the
 * engine facts, once. Called when Phase 1 settles; safe to call again.
 */
async function preparePack(assignment) {
  // The profile is the source of truth from here on, so the person it belongs
  // to exists now: a pre-employee account with no password (the invitation,
  // when it comes, is what sets one) and an employment profile from the offer.
  await ensureProfileOwner(assignment);
  const version = await odb.getPackageVersion(assignment.package_version_id);
  const library = await odb.listDocuments(assignment.organisation_id);
  const byCode = new Map(library.map((d) => [d.code, d]));
  const out = { inserted: 0, total: 0 };
  for (const phase of ['documentation', 'induction']) {
    const existing = await pdb.listItems(assignment.id, undefined, phase);
    if (existing.length) { if (phase === 'documentation') out.total += existing.length; continue; }
    const derived = pack.buildDefaultItems(version ? version.content : {}, assignment.facts || {}, byCode, phase);
    const items = pack.applyDefaults(derived, await pdb.listPackDefaults(assignment.package_id), phase);
    const n = await pdb.insertDefaults(assignment.organisation_id, assignment.id, items);
    if (phase === 'documentation') { out.inserted += n; out.total += items.length; }
  }
  await pdb.setPackPrepared(assignment.id);
  await odb.pool.query('UPDATE onboarding_assignments SET induction_pack_prepared_at = COALESCE(induction_pack_prepared_at, NOW()) WHERE id = $1', [assignment.id]);
  return out;
}

/** A users row for the record, created once; the employment profile from the offer terms. */
async function ensureProfileOwner(assignment) {
  if (!assignment.user_id) {
    const { rows } = await odb.pool.query(
      `INSERT INTO users (email, name, role, organisation_id, is_active, account_status, email_verified, profile_completed, is_treating_therapist)
       VALUES (LOWER($1), $2, 'pre_employee', $3, TRUE, 'active', FALSE, TRUE, $4)
       ON CONFLICT (email) DO UPDATE SET role = CASE WHEN users.role = 'pre_employee' THEN 'pre_employee' ELSE users.role END, organisation_id = COALESCE(users.organisation_id, $3)
       RETURNING id, role`,
      [assignment.applicant_email, assignment.applicant_name, assignment.organisation_id, assignment.is_treating_therapist === true]
    );
    await odb.pool.query('UPDATE onboarding_assignments SET user_id = $2, updated_at = NOW() WHERE id = $1 AND user_id IS NULL', [assignment.id, rows[0].id]);
    assignment.user_id = rows[0].id;
  }
  await odb.upsertEmploymentProfile(assignment.user_id, assignment.organisation_id, {
    assignmentId: assignment.id, jobTitle: assignment.job_title, employmentType: assignment.employment_type, roleCategory: assignment.role_category,
    startDate: assignment.start_date, endDate: assignment.end_date, hoursPerWeek: assignment.hours_per_week ?? undefined,
    awardClassification: assignment.award_classification ?? undefined, managerUserId: assignment.manager_user_id, workLocation: assignment.work_location,
    childRelatedWork: assignment.facts?.child_related_work || 'assessment_required', ndisRiskAssessedRole: assignment.facts?.ndis_risk_assessed_role || 'requires_determination',
    mobileCommunityRole: assignment.facts?.mobile_community_role === true, usesOwnVehicle: assignment.facts?.uses_own_vehicle === true, status: 'onboarding',
  });
  if (assignment.pay_basis && assignment.pay_rate != null) {
    await require('./onboarding-returns-db').setEmploymentPay(assignment.user_id, { payBasis: assignment.pay_basis, payRate: assignment.pay_rate });
  }
  // Internal setup begins now, alongside the documentation — not after it.
  await require('./onboarding-journey-routes')._internals.ensureInduction(assignment, [], { force: true });
}

/** Resolve every included, sendable item to bytes and build the ZIP. */
async function buildZipForRecord(req, assignment, phase = 'documentation') {
  const rows = (await pdb.listItems(assignment.id, undefined, phase)).filter((r) => r.status === 'included');
  const resolved = [];
  for (const r of rows) {
    let file = null; let unavailableReason = null;
    if (r.sends_document) {
      try { file = await pdb.readItemFile(r); } catch (err) { log.warn('pack item unreadable', { error: err, itemId: r.id }); }
      if (!file) unavailableReason = pdb.describeItemFile(r).unavailableReason || 'No file behind this document';
    }
    resolved.push({ ...r, file, unavailableReason });
  }
  const org = await orgName(assignment.organisation_id);
  const built = await pack.buildPackZip(resolved, {
    orgName: org, employeeName: assignment.applicant_name, roleTitle: assignment.job_title,
    dueDate: assignment[PHASES[phase].cols.dueAt], returnEmail: req.user.email, packName: PHASES[phase].zipName,
  });
  built.manifest = built.manifest.map((m) => ({ ...m, phase }));
  built.fileName = built.fileName.replace('Onboarding Documentation Pack', PHASES[phase].zipName);
  return built;
}

async function respond(req, res, assignment, status = 200, phase = 'documentation') {
  const fresh = await odb.getAssignment(orgOf(req), assignment.id);
  res.status(status).json({ ok: true, pack: await packDetail(req, fresh, phase) });
}

// ═════════════════════════════════════════════════════════════════════════════

router.use('/api/onboarding/journey', requireAuth);

const UPLOAD_MIMES = {
  'application/pdf': ['pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'application/msword': ['doc'],
  'image/png': ['png'], 'image/jpeg': ['jpg', 'jpeg'],
};
const MAX_UPLOAD_BASE64 = 14 * 1024 * 1024;

function readUpload(body) {
  const f = body || {};
  if (!f.fileData || typeof f.fileData !== 'string') return { error: 'No file was received.' };
  if (f.fileData.length > MAX_UPLOAD_BASE64) return { error: 'That file is too large (10 MB limit).' };
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(f.fileData.slice(0, 1000))) return { error: 'The file could not be read.' };
  const fileMime = String(f.fileMime || '').toLowerCase();
  const exts = UPLOAD_MIMES[fileMime];
  if (!exts) return { error: 'That file type is not accepted. Use PDF, Word, PNG or JPEG.' };
  const fileName = String(f.fileName || '').trim().slice(0, 255);
  if (!fileName || /[/\\]|\.\./.test(fileName)) return { error: 'The file name is not valid.' };
  if (!exts.includes(fileName.split('.').pop().toLowerCase())) return { error: 'The file name does not match its type.' };
  const buffer = Buffer.from(f.fileData, 'base64');
  if (!buffer.length) return { error: 'The file is empty.' };
  return { buffer, fileName, fileMime };
}


/** Register the pack routes for one phase under its own prefix. */
function registerPackRoutes(phase) {
  const P = PHASES[phase]; const C = P.cols;
  const BASE = `/api/onboarding/journey/records/:id/${P.prefix}`;

router.get(`${BASE}`, requirePermission('onboarding.view'), safe(async (req, res) => {
    const assignment = await loadRecord(req);
    if (!assignment) return notFound(res);
    res.json({ ok: true, pack: await packDetail(req, assignment, phase) });
  }));
  
  router.post(`${BASE}/prepare`, requirePermission('onboarding.assign'), safe(async (req, res) => {
    const assignment = await loadRecord(req);
    if (!assignment) return notFound(res);
    if (!(await phase1Settled(assignment))) return res.status(409).json({ error: 'The letter of offer has not been verified yet.', code: 'phase1_open' });
    const out = await preparePack(assignment);
    await auditOnboarding(req, P.auditPrefix + '_prepared', { targetType: 'onboarding_assignment', targetId: assignment.id, metadata: { assignmentId: assignment.id, inserted: out.inserted, total: out.total } });
    await respond(req, res, assignment, 200, phase);
  }));
  
  /** Library documents the Owner can add. */
  router.get(`${BASE}/library`, requirePermission('onboarding.view'), safe(async (req, res) => {
    const assignment = await loadRecord(req);
    if (!assignment) return notFound(res);
    const docs = await odb.listDocuments(orgOf(req), { audience: 'employee' });
    const inPack = new Set((await pdb.listItems(assignment.id, undefined, phase)).filter((r) => r.status === 'included').map((r) => r.document_id).filter(Boolean));
    res.json({
      ok: true,
      documents: docs.filter((d) => d.status !== 'archived').map((d) => ({
        id: d.id, code: d.code, title: d.title, category: d.category, contentStatus: d.content_status,
        hasFile: !!d.current_file_name, hasContent: d.has_content === true, currentVersionId: d.current_version_id || null,
        alreadyInPack: inPack.has(d.id),
      })),
    });
  }));
  
  router.post(`${BASE}/items`, requirePermission('onboarding.assign'), safe(async (req, res) => {
    const assignment = await loadRecord(req);
    if (!assignment) return notFound(res);
    if (!packEditable(assignment, phase)) return res.status(409).json({ error: 'The pack has been sent and can no longer be changed.', code: 'sent' });
    const b = req.body || {};
    let title = str(b.title, 250); let doc = null;
    if (b.documentId) {
      if (!isUuid(b.documentId)) return res.status(400).json({ error: 'documentId is not valid' });
      doc = await odb.getDocument(orgOf(req), b.documentId);
      if (!doc) return res.status(400).json({ error: 'Unknown library document' });
      const dup = (await pdb.listItems(assignment.id, undefined, phase)).find((r) => r.document_id === doc.id && r.status === 'included');
      if (dup) return res.status(409).json({ error: `"${dup.title}" is already in this pack.`, code: 'already_in_pack' });
      title = title || doc.title;
    }
    if (!title) return res.status(400).json({ error: 'A document name is required' });
    const version = doc ? await odb.getCurrentDocumentVersion(doc.id) : null;
    const row = await pdb.addItem({
      organisationId: orgOf(req), assignmentId: assignment.id, title, description: b.description,
      sends: b.sendsDocument !== false, returns: b.employeeReturns === true, verifies: b.requiresVerification === true,
      required: b.required !== false, documentId: doc ? doc.id : null, documentVersionId: version ? version.id : null,
      officialSourceUrl: doc ? doc.official_source_url : null, phase,
    });
    let stored = row;
    if (b.fileData) {
      const up = readUpload(b);
      if (up.error) return res.status(400).json({ error: up.error });
      stored = await pdb.setItemFile(assignment.id, row.id, { ...up, uploadedBy: req.user.id });
    }
    await clearDraft(assignment.id, phase);
    await auditOnboarding(req, P.auditPrefix + '_item_added', { targetType: 'onboarding_assignment', targetId: assignment.id, metadata: { assignmentId: assignment.id, itemId: stored.id, documentId: doc ? doc.id : null } });
    await respond(req, res, assignment, 201, phase);
  }));
  
  router.patch(`${BASE}/items/:itemId`, requirePermission('onboarding.assign'), safe(async (req, res) => {
    const assignment = await loadRecord(req);
    if (!assignment) return notFound(res);
    if (!packEditable(assignment, phase)) return res.status(409).json({ error: 'The pack has been sent and can no longer be changed.', code: 'sent' });
    const item = await pdb.getItem(assignment.id, req.params.itemId);
    if (!item) return notFound(res);
    const b = req.body || {};
    if (b.title !== undefined && !str(b.title, 250)) return res.status(400).json({ error: 'A document name is required' });
    await pdb.updateItem(assignment.id, item.id, {
      title: b.title, description: b.description, required: b.required, returns: b.employeeReturns,
      verifies: b.requiresVerification, sends: b.sendsDocument,
    });
    await clearDraft(assignment.id, phase);
    await auditOnboarding(req, P.auditPrefix + '_item_updated', { targetType: 'onboarding_assignment', targetId: assignment.id, metadata: { assignmentId: assignment.id, itemId: item.id, fields: Object.keys(b) } });
    await respond(req, res, assignment, 200, phase);
  }));
  
  for (const [verb, status] of [['remove', 'removed'], ['restore', 'included']]) {
    router.post(`${BASE}/items/:itemId/${verb}`, requirePermission('onboarding.assign'), safe(async (req, res) => {
      const assignment = await loadRecord(req);
      if (!assignment) return notFound(res);
      if (!packEditable(assignment, phase)) return res.status(409).json({ error: 'The pack has been sent and can no longer be changed.', code: 'sent' });
      const item = await pdb.getItem(assignment.id, req.params.itemId);
      if (!item) return notFound(res);
      await pdb.setItemStatus(assignment.id, item.id, status, req.body?.reason);
      await clearDraft(assignment.id, phase);
      await auditOnboarding(req, `pack_item_${status}`, { targetType: 'onboarding_assignment', targetId: assignment.id, metadata: { assignmentId: assignment.id, itemId: item.id, code: item.code } });
      await respond(req, res, assignment, 200, phase);
    }));
  }
  
  router.post(`${BASE}/reorder`, requirePermission('onboarding.assign'), safe(async (req, res) => {
    const assignment = await loadRecord(req);
    if (!assignment) return notFound(res);
    if (!packEditable(assignment, phase)) return res.status(409).json({ error: 'The pack has been sent and can no longer be changed.', code: 'sent' });
    const ids = Array.isArray(req.body?.itemIds) ? req.body.itemIds.filter(isUuid) : [];
    if (!ids.length || ids.length > 200) return res.status(400).json({ error: 'itemIds is required' });
    await pdb.reorderItems(assignment.id, ids);
    await respond(req, res, assignment, 200, phase);
  }));
  
  // ── Files ───────────────────────────────────────────────────────────────────
  
  /** Replace the file for THIS person only. The library copy is untouched. */
  router.post(`${BASE}/items/:itemId/file`, requirePermission('onboarding.assign'), safe(async (req, res) => {
    const assignment = await loadRecord(req);
    if (!assignment) return notFound(res);
    if (!packEditable(assignment, phase)) return res.status(409).json({ error: 'The pack has been sent and can no longer be changed.', code: 'sent' });
    const item = await pdb.getItem(assignment.id, req.params.itemId);
    if (!item) return notFound(res);
    const up = readUpload(req.body);
    if (up.error) return res.status(400).json({ error: up.error });
    const stored = await pdb.setItemFile(assignment.id, item.id, { ...up, uploadedBy: req.user.id });
    await clearDraft(assignment.id, phase);
    await auditOnboarding(req, P.auditPrefix + '_item_file_replaced', { targetType: 'onboarding_assignment', targetId: assignment.id, metadata: { assignmentId: assignment.id, itemId: item.id, sha256: stored.file_sha256, bytes: stored.file_size_bytes } });
    await respond(req, res, assignment, 201, phase);
  }));
  
  router.delete(`${BASE}/items/:itemId/file`, requirePermission('onboarding.assign'), safe(async (req, res) => {
    const assignment = await loadRecord(req);
    if (!assignment) return notFound(res);
    if (!packEditable(assignment, phase)) return res.status(409).json({ error: 'The pack has been sent and can no longer be changed.', code: 'sent' });
    const item = await pdb.getItem(assignment.id, req.params.itemId);
    if (!item) return notFound(res);
    await pdb.clearItemFile(assignment.id, item.id);
    await clearDraft(assignment.id, phase);
    await auditOnboarding(req, P.auditPrefix + '_item_file_reverted', { targetType: 'onboarding_assignment', targetId: assignment.id, metadata: { assignmentId: assignment.id, itemId: item.id } });
    await respond(req, res, assignment, 200, phase);
  }));
  
  async function serveItem(req, res, disposition) {
    const assignment = await loadRecord(req);
    if (!assignment) return notFound(res);
    const item = await pdb.getItem(assignment.id, req.params.itemId);
    if (!item) return notFound(res);
    let file = null;
    try { file = await pdb.readItemFile(item); } catch (err) { log.warn('pack item unreadable', { error: err, itemId: item.id }); }
    if (!file) return res.status(404).json({ error: 'There is no file behind this document yet.' });
    noStore(res);
    res.set('Content-Type', file.mime);
    res.set('Content-Length', String(file.bytes.length));
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Disposition', `${disposition}; filename="${encodeURIComponent(file.fileName)}"`);
    res.send(file.bytes);
  }
  router.get(`${BASE}/items/:itemId/preview`, requirePermission('onboarding.view'), safe((req, res) => serveItem(req, res, 'inline')));
  router.get(`${BASE}/items/:itemId/download`, requirePermission('onboarding.view'), safe((req, res) => serveItem(req, res, 'attachment')));
  
  /** The ZIP as it stands: the stored one once drafted, else built on the fly. */
  router.get(`${BASE}/zip`, requirePermission('onboarding.view'), safe(async (req, res) => {
    const assignment = await loadRecord(req);
    if (!assignment) return notFound(res);
    let bytes; let fileName;
    const live = await wdb.getLiveStarterPack(assignment.id);
    if (live && assignment[C.draftId] && Array.isArray(live.manifest) && live.manifest[0] && live.manifest[0].phase === phase) {
      bytes = await wdb.readStarterPackBytes(live); fileName = live.file_name;
    } else {
      const built = await buildZipForRecord(req, assignment, phase);
      bytes = built.buffer; fileName = built.fileName;
    }
    if (!bytes) return res.status(404).json({ error: 'The pack could not be read.' });
    noStore(res);
    res.set('Content-Type', 'application/zip');
    res.set('Content-Length', String(bytes.length));
    res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.send(bytes);
  }));
  
  // ── Email 2 ─────────────────────────────────────────────────────────────────
  
  router.put(`${BASE}/email`, requirePermission('onboarding.assign'), safe(async (req, res) => {
    const assignment = await loadRecord(req);
    if (!assignment) return notFound(res);
    if (!packEditable(assignment, phase)) return res.status(409).json({ error: 'The pack has been sent.', code: 'sent' });
    const subject = str(req.body?.subject, 250);
    const body = typeof req.body?.body === 'string' ? req.body.body.slice(0, 20000) : null;
    if (!subject) return res.status(400).json({ error: 'A subject is required.' });
    if (!body || !body.trim()) return res.status(400).json({ error: 'The email body cannot be empty.' });
    await saveEmail(assignment.id, phase, { subject, body });
    await respond(req, res, assignment, 200, phase);
  }));
  
  router.post(`${BASE}/email/reset`, requirePermission('onboarding.assign'), safe(async (req, res) => {
    const assignment = await loadRecord(req);
    if (!assignment) return notFound(res);
    await saveEmail(assignment.id, phase, { subject: null, body: null });
    await respond(req, res, assignment, 200, phase);
  }));
  
  /**
   * PREPARE ONBOARDING EMAIL → the Outlook draft. Builds the ZIP from the
   * items as they stand, stores it, fixes the due date (today + 7) into the
   * body, and creates the draft with the ZIP attached. Nothing is sent.
   */
  router.post(`${BASE}/email/draft`, requirePermission('onboarding.assign'), safe(async (req, res) => {
    const assignment = await loadRecord(req);
    if (!assignment) return notFound(res);
    if (!packEditable(assignment, phase)) return res.status(409).json({ error: 'The pack has already been sent.', code: 'sent' });
    if (!(await phase1Settled(assignment))) return res.status(409).json({ error: 'The letter of offer has not been verified yet.', code: 'phase1_open' });
    if (!assignment[C.prepared]) await preparePack(assignment);
    if (phase === 'induction') {
      const readiness = await readinessFor(req, assignment);
      if (!readiness.ready) return res.status(409).json({ error: 'Phase 3 is not ready.', code: 'not_ready', blockers: readiness.blockers, readiness });
    }
  
    const reason = graphMail.unavailableReason(req.user);
    if (reason) return res.status(409).json({ error: reason, code: 'graph_unavailable' });
    const accessToken = await graphMail.getAccessToken(req.user);
    if (!accessToken) return res.status(409).json({ error: 'Your Microsoft connection needs renewing. Reconnect Outlook in Settings and try again.', code: 'graph_no_token' });
  
    const now = new Date();
    const E = P.email;
    const dueAt = E.dueDateFrom(now);
    const d = phase === 'induction' ? E.composeInductionEmail({ applicantName: assignment.applicant_name, sentAt: now }) : E.composePackEmail({ applicantName: assignment.applicant_name, sentAt: now });
    const subject = str(req.body?.subject, 250) || assignment[C.subject] || d.subject;
    const rawBody = (typeof req.body?.body === 'string' && req.body.body.trim()) ? req.body.body.slice(0, 20000) : (assignment[C.body] || d.body);
    const body = E.restampDueDate(rawBody, assignment[C.dueAt], dueAt);
  
    const built = await buildZipForRecord(req, { ...assignment, [C.dueAt]: dueAt }, phase);
    if (!built.manifest.length) {
      return res.status(409).json({ error: 'None of the documents in the pack has a file to send. Upload files or remove those items first.', code: 'empty_pack', omissions: built.omissions });
    }
    if (built.buffer.length > graphMail.MAX_SIMPLE_ATTACHMENT_BYTES) {
      return res.status(413).json({ error: `The pack is ${Math.round(built.buffer.length / 1048576)} MB, too large to attach through Outlook (3 MB limit). Remove or shrink some documents.`, code: 'attachment_too_large' });
    }
  
    const version = await odb.getPackageVersion(assignment.package_version_id);
    const stored = await wdb.createStarterPack({
      organisationId: orgOf(req), assignmentId: assignment.id, packageId: assignment.package_id,
      packageVersionId: assignment.package_version_id, packageVersion: version ? version.version : null,
      manifest: built.manifest, omissions: built.omissions, fileName: built.fileName, buffer: built.buffer, generatedBy: req.user.id,
    });
  
    const draft = await graphMail.createDraft({
      accessToken, to: assignment.applicant_email, subject, html: packEmail.bodyToHtml(body),
      attachment: built.buffer, attachmentName: built.fileName, attachmentMime: 'application/zip',
    });
    await wdb.recordDispatch({
      organisationId: orgOf(req), assignmentId: assignment.id, starterPackId: stored.id, kind: P.dispatchKind,
      toEmail: assignment.applicant_email, subject, method: 'graph_draft', status: draft.ok ? 'draft_created' : 'failed',
      attachmentIncluded: true, attachmentBytes: built.buffer.length,
      providerDraftId: draft.ok ? draft.id : null, webLink: draft.ok ? draft.webLink : null,
      errorReason: draft.ok ? null : draft.code, requestedBy: req.user.id,
    });
    if (!draft.ok) {
      await auditOnboarding(req, P.auditPrefix + '_email_draft_failed', { targetType: 'onboarding_assignment', targetId: assignment.id, metadata: { assignmentId: assignment.id, reason: draft.code } });
      return res.status(502).json({ error: draft.reason || 'Outlook did not accept the draft.', code: draft.code || 'graph_error' });
    }
    await markDrafted(assignment.id, phase, { actorId: req.user.id, draftId: draft.id, webLink: draft.webLink, subject, body, dueAt });
    await auditOnboarding(req, P.auditPrefix + '_email_drafted', {
      targetType: 'onboarding_assignment', targetId: assignment.id,
      metadata: { assignmentId: assignment.id, starterPackId: stored.id, documents: built.manifest.length, omissions: built.omissions.length, attachmentBytes: built.buffer.length },
    });
    const fresh = await odb.getAssignment(orgOf(req), assignment.id);
    res.status(201).json({
      ok: true, pack: await packDetail(req, fresh, phase),
      delivery: { status: 'draft_created', webLink: draft.webLink, omissions: built.omissions, message: 'A draft is waiting in your Outlook with the pack attached. Read it over and press Send, then mark it as sent here.' },
    });
  }));
  
  router.post(`${BASE}/mark-sent`, requirePermission('onboarding.assign'), safe(async (req, res) => {
    const assignment = await loadRecord(req);
    if (!assignment) return notFound(res);
    if (!packEditable(assignment, phase)) return res.status(409).json({ error: 'This pack is not waiting to be sent.', code: 'not_sendable' });
    if (!(await phase1Settled(assignment))) return res.status(409).json({ error: 'The letter of offer has not been verified yet.', code: 'phase1_open' });
    const dueAt = assignment[C.dueAt] || P.email.dueDateFrom(new Date());
    await markSent(assignment.id, phase, { actorId: req.user.id, toEmail: assignment.applicant_email, dueAt });
    await wdb.recordDispatch({
      organisationId: orgOf(req), assignmentId: assignment.id, kind: P.dispatchKind, toEmail: assignment.applicant_email,
      subject: assignment[C.subject] || P.email.SUBJECT, method: 'manual', status: 'sent', attachmentIncluded: true, requestedBy: req.user.id,
    });
    await auditOnboarding(req, P.auditPrefix + '_marked_sent', { targetType: 'onboarding_assignment', targetId: assignment.id, metadata: { assignmentId: assignment.id, hadOutlookDraft: !!assignment.pack_email_draft_id } });
    await respond(req, res, assignment, 200, phase);
  }));
  
  router.post(`${BASE}/unmark-sent`, requirePermission('onboarding.assign'), safe(async (req, res) => {
    const assignment = await loadRecord(req);
    if (!assignment) return notFound(res);
    if (phase === 'documentation' ? assignment.status !== 'starter_pack_sent' : !assignment.induction_sent_at) return res.status(409).json({ error: 'This pack is not marked as sent.', code: 'not_sent' });
    await unmarkSent(assignment.id, phase);
    await auditOnboarding(req, P.auditPrefix + '_unmarked_sent', { targetType: 'onboarding_assignment', targetId: assignment.id, metadata: { assignmentId: assignment.id } });
    await respond(req, res, assignment, 200, phase);
  }));
  
  
  router.post(`${BASE}/restore-defaults`, requirePermission('onboarding.assign'), safe(async (req, res) => {
    const assignment = await loadRecord(req);
    if (!assignment) return notFound(res);
    if (!packEditable(assignment, phase)) return res.status(409).json({ error: 'The pack has been sent and can no longer be changed.', code: 'sent' });
    const out = await pdb.restoreDefaults(assignment.id, phase);
    await clearDraft(assignment.id, phase);
    await auditOnboarding(req, P.auditPrefix + '_defaults_restored', { targetType: 'onboarding_assignment', targetId: assignment.id, metadata: { assignmentId: assignment.id, ...out } });
    await respond(req, res, assignment, 200, phase);
  }));

  if (phase === 'induction') {
    router.get(`${BASE}/readiness`, requirePermission('onboarding.view'), safe(async (req, res) => {
      const assignment = await loadRecord(req);
      if (!assignment) return notFound(res);
      res.json({ ok: true, readiness: await readinessFor(req, assignment) });
    }));
  }
}

// ── Phase-specific column writes ────────────────────────────────────────────
async function saveEmail(assignmentId, phase, { subject, body }) {
  const C = PHASES[phase].cols;
  await odb.pool.query(`UPDATE onboarding_assignments SET ${C.subject} = $2, ${C.body} = $3, updated_at = NOW() WHERE id = $1`, [assignmentId, str(subject, 250), body == null ? null : String(body).slice(0, 20000)]);
}
async function clearDraft(assignmentId, phase) {
  const C = PHASES[phase].cols;
  await odb.pool.query(`UPDATE onboarding_assignments SET ${C.draftId} = NULL, ${C.webLink} = NULL, ${C.draftedAt} = NULL, ${C.draftedBy} = NULL, updated_at = NOW() WHERE id = $1`, [assignmentId]);
}
async function markDrafted(assignmentId, phase, { actorId, draftId, webLink, subject, body, dueAt }) {
  if (phase === 'documentation') return pdb.markPackDrafted(assignmentId, { actorId, draftId, webLink, subject, body, dueAt });
  const C = PHASES[phase].cols;
  await odb.pool.query(
    `UPDATE onboarding_assignments SET ${C.draftId} = $2, ${C.webLink} = $3, ${C.draftedAt} = NOW(), ${C.draftedBy} = $4, ${C.subject} = $5, ${C.body} = $6, ${C.dueAt} = $7, last_activity_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [assignmentId, str(draftId, 300), webLink ? String(webLink).slice(0, 2000) : null, actorId, str(subject, 250), body == null ? null : String(body).slice(0, 20000), dueAt || null]
  );
}
async function markSent(assignmentId, phase, { actorId, toEmail, dueAt }) {
  if (phase === 'documentation') return pdb.markPackSent(assignmentId, { actorId, toEmail, dueAt });
  await odb.pool.query(`UPDATE onboarding_assignments SET induction_sent_at = NOW(), induction_sent_by = $2, induction_due_at = COALESCE(induction_due_at, $3), last_activity_at = NOW(), updated_at = NOW() WHERE id = $1`, [assignmentId, actorId, dueAt || null]);
}
async function unmarkSent(assignmentId, phase) {
  if (phase === 'documentation') return pdb.unmarkPackSent(assignmentId);
  await odb.pool.query('UPDATE onboarding_assignments SET induction_sent_at = NULL, induction_sent_by = NULL, updated_at = NOW() WHERE id = $1', [assignmentId]);
}

/** Phase 3 readiness: exactly what is blocking, if anything. */
async function readinessFor(req, assignment) {
  const jdb = require('./onboarding-journey-db');
  const [tasks, documentation] = await Promise.all([jdb.listTasks(assignment.id), pdb.listItems(assignment.id, undefined, 'documentation')]);
  let payroll = null;
  try { payroll = await require('./onboarding-payroll-routes')._internals.payrollSetupFor(assignment); } catch (_) { payroll = null; }
  return induction.buildReadiness({ assignment, tasks, documentation, payroll });
}

registerPackRoutes('documentation');
registerPackRoutes('induction');

module.exports = router;
module.exports._internals = { PHASES, preparePack, ensureProfileOwner, packDetail, buildZipForRecord, itemRow, readUpload, packEditable, readinessFor };
