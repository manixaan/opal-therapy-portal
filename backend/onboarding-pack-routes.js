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

/** The pack is editable until it has been marked sent. */
const packEditable = (a) => ['created', 'starter_pack_ready'].includes(a.status);

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
  };
}

/** Everything the Stage 2 panel shows. */
async function packDetail(req, assignment) {
  const rows = await pdb.listItems(assignment.id);
  const items = rows.map((r) => itemRow(r, assignment.id));
  const included = items.filter((i) => i.status === 'included');
  const zip = await wdb.getLiveStarterPack(assignment.id);
  const emailDefault = packEmail.composePackEmail({ applicantName: assignment.applicant_name });
  const base = `/api/onboarding/journey/records/${assignment.id}/pack`;
  return {
    prepared: !!assignment.pack_prepared_at,
    preparedAt: assignment.pack_prepared_at || null,
    editable: packEditable(assignment),
    items,
    counts: {
      included: included.length,
      sending: included.filter((i) => i.sendsDocument).length,
      sendable: included.filter((i) => i.sendsDocument && i.file.previewUrl).length,
      missingFiles: included.filter((i) => i.sendsDocument && !i.file.previewUrl).length,
      returns: included.filter((i) => i.employeeReturns).length,
      verifies: included.filter((i) => i.requiresVerification).length,
      removed: items.length - included.length,
    },
    zip: zip ? {
      id: zip.id, fileName: zip.file_name, size: zip.file_size_bytes, documentCount: zip.document_count,
      generatedAt: zip.generated_at, manifest: zip.manifest || [], omissions: zip.omissions || [],
      downloadUrl: `${base}/zip`,
    } : null,
    email: {
      subject: assignment.pack_email_subject || emailDefault.subject,
      body: assignment.pack_email_body || emailDefault.body,
      draftId: assignment.pack_email_draft_id || null, webLink: assignment.pack_email_web_link || null,
      draftedAt: assignment.pack_email_drafted_at || null,
      sentAt: assignment.starter_pack_sent_at || null, sentTo: assignment.starter_pack_sent_to || null,
      dueAt: assignment.pack_due_at || null,
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
  const existing = await pdb.listItems(assignment.id);
  if (existing.length) { await pdb.setPackPrepared(assignment.id); return { inserted: 0, total: existing.length }; }
  const version = await odb.getPackageVersion(assignment.package_version_id);
  const library = await odb.listDocuments(assignment.organisation_id);
  const byCode = new Map(library.map((d) => [d.code, d]));
  const items = pack.buildDefaultItems(version ? version.content : {}, assignment.facts || {}, byCode);
  const inserted = await pdb.insertDefaults(assignment.organisation_id, assignment.id, items);
  await pdb.setPackPrepared(assignment.id);
  return { inserted, total: items.length };
}

/** Resolve every included, sendable item to bytes and build the ZIP. */
async function buildZipForRecord(req, assignment) {
  const rows = (await pdb.listItems(assignment.id)).filter((r) => r.status === 'included');
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
  return pack.buildPackZip(resolved, {
    orgName: org, employeeName: assignment.applicant_name, roleTitle: assignment.job_title,
    dueDate: assignment.pack_due_at, returnEmail: req.user.email,
  });
}

async function respond(req, res, assignment, status = 200) {
  const fresh = await odb.getAssignment(orgOf(req), assignment.id);
  res.status(status).json({ ok: true, pack: await packDetail(req, fresh) });
}

// ═════════════════════════════════════════════════════════════════════════════

router.use('/api/onboarding/journey', requireAuth);

router.get('/api/onboarding/journey/records/:id/pack', requirePermission('onboarding.view'), safe(async (req, res) => {
  const assignment = await loadRecord(req);
  if (!assignment) return notFound(res);
  res.json({ ok: true, pack: await packDetail(req, assignment) });
}));

router.post('/api/onboarding/journey/records/:id/pack/prepare', requirePermission('onboarding.assign'), safe(async (req, res) => {
  const assignment = await loadRecord(req);
  if (!assignment) return notFound(res);
  if (!(await phase1Settled(assignment))) return res.status(409).json({ error: 'The letter of offer has not been verified yet.', code: 'phase1_open' });
  const out = await preparePack(assignment);
  await auditOnboarding(req, 'pack_prepared', { targetType: 'onboarding_assignment', targetId: assignment.id, metadata: { assignmentId: assignment.id, inserted: out.inserted, total: out.total } });
  await respond(req, res, assignment);
}));

/** Library documents the Owner can add. */
router.get('/api/onboarding/journey/records/:id/pack/library', requirePermission('onboarding.view'), safe(async (req, res) => {
  const assignment = await loadRecord(req);
  if (!assignment) return notFound(res);
  const docs = await odb.listDocuments(orgOf(req), { audience: 'employee' });
  const inPack = new Set((await pdb.listItems(assignment.id)).filter((r) => r.status === 'included').map((r) => r.document_id).filter(Boolean));
  res.json({
    ok: true,
    documents: docs.filter((d) => d.status !== 'archived').map((d) => ({
      id: d.id, code: d.code, title: d.title, category: d.category, contentStatus: d.content_status,
      hasFile: !!d.current_file_name, hasContent: d.has_content === true, currentVersionId: d.current_version_id || null,
      alreadyInPack: inPack.has(d.id),
    })),
  });
}));

router.post('/api/onboarding/journey/records/:id/pack/items', requirePermission('onboarding.assign'), safe(async (req, res) => {
  const assignment = await loadRecord(req);
  if (!assignment) return notFound(res);
  if (!packEditable(assignment)) return res.status(409).json({ error: 'The pack has been sent and can no longer be changed.', code: 'sent' });
  const b = req.body || {};
  let title = str(b.title, 250); let doc = null;
  if (b.documentId) {
    if (!isUuid(b.documentId)) return res.status(400).json({ error: 'documentId is not valid' });
    doc = await odb.getDocument(orgOf(req), b.documentId);
    if (!doc) return res.status(400).json({ error: 'Unknown library document' });
    const dup = (await pdb.listItems(assignment.id)).find((r) => r.document_id === doc.id && r.status === 'included');
    if (dup) return res.status(409).json({ error: `"${dup.title}" is already in this pack.`, code: 'already_in_pack' });
    title = title || doc.title;
  }
  if (!title) return res.status(400).json({ error: 'A document name is required' });
  const version = doc ? await odb.getCurrentDocumentVersion(doc.id) : null;
  const row = await pdb.addItem({
    organisationId: orgOf(req), assignmentId: assignment.id, title, description: b.description,
    sends: b.sendsDocument !== false, returns: b.employeeReturns === true, verifies: b.requiresVerification === true,
    required: b.required !== false, documentId: doc ? doc.id : null, documentVersionId: version ? version.id : null,
    officialSourceUrl: doc ? doc.official_source_url : null,
  });
  let stored = row;
  if (b.fileData) {
    const up = readUpload(b);
    if (up.error) return res.status(400).json({ error: up.error });
    stored = await pdb.setItemFile(assignment.id, row.id, { ...up, uploadedBy: req.user.id });
  }
  await pdb.clearPackDraft(assignment.id);
  await auditOnboarding(req, 'pack_item_added', { targetType: 'onboarding_assignment', targetId: assignment.id, metadata: { assignmentId: assignment.id, itemId: stored.id, documentId: doc ? doc.id : null } });
  await respond(req, res, assignment, 201);
}));

router.patch('/api/onboarding/journey/records/:id/pack/items/:itemId', requirePermission('onboarding.assign'), safe(async (req, res) => {
  const assignment = await loadRecord(req);
  if (!assignment) return notFound(res);
  if (!packEditable(assignment)) return res.status(409).json({ error: 'The pack has been sent and can no longer be changed.', code: 'sent' });
  const item = await pdb.getItem(assignment.id, req.params.itemId);
  if (!item) return notFound(res);
  const b = req.body || {};
  if (b.title !== undefined && !str(b.title, 250)) return res.status(400).json({ error: 'A document name is required' });
  await pdb.updateItem(assignment.id, item.id, {
    title: b.title, description: b.description, required: b.required, returns: b.employeeReturns,
    verifies: b.requiresVerification, sends: b.sendsDocument,
  });
  await pdb.clearPackDraft(assignment.id);
  await auditOnboarding(req, 'pack_item_updated', { targetType: 'onboarding_assignment', targetId: assignment.id, metadata: { assignmentId: assignment.id, itemId: item.id, fields: Object.keys(b) } });
  await respond(req, res, assignment);
}));

for (const [verb, status] of [['remove', 'removed'], ['restore', 'included']]) {
  router.post(`/api/onboarding/journey/records/:id/pack/items/:itemId/${verb}`, requirePermission('onboarding.assign'), safe(async (req, res) => {
    const assignment = await loadRecord(req);
    if (!assignment) return notFound(res);
    if (!packEditable(assignment)) return res.status(409).json({ error: 'The pack has been sent and can no longer be changed.', code: 'sent' });
    const item = await pdb.getItem(assignment.id, req.params.itemId);
    if (!item) return notFound(res);
    await pdb.setItemStatus(assignment.id, item.id, status, req.body?.reason);
    await pdb.clearPackDraft(assignment.id);
    await auditOnboarding(req, `pack_item_${status}`, { targetType: 'onboarding_assignment', targetId: assignment.id, metadata: { assignmentId: assignment.id, itemId: item.id, code: item.code } });
    await respond(req, res, assignment);
  }));
}

router.post('/api/onboarding/journey/records/:id/pack/reorder', requirePermission('onboarding.assign'), safe(async (req, res) => {
  const assignment = await loadRecord(req);
  if (!assignment) return notFound(res);
  if (!packEditable(assignment)) return res.status(409).json({ error: 'The pack has been sent and can no longer be changed.', code: 'sent' });
  const ids = Array.isArray(req.body?.itemIds) ? req.body.itemIds.filter(isUuid) : [];
  if (!ids.length || ids.length > 200) return res.status(400).json({ error: 'itemIds is required' });
  await pdb.reorderItems(assignment.id, ids);
  await respond(req, res, assignment);
}));

// ── Files ───────────────────────────────────────────────────────────────────

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

/** Replace the file for THIS person only. The library copy is untouched. */
router.post('/api/onboarding/journey/records/:id/pack/items/:itemId/file', requirePermission('onboarding.assign'), safe(async (req, res) => {
  const assignment = await loadRecord(req);
  if (!assignment) return notFound(res);
  if (!packEditable(assignment)) return res.status(409).json({ error: 'The pack has been sent and can no longer be changed.', code: 'sent' });
  const item = await pdb.getItem(assignment.id, req.params.itemId);
  if (!item) return notFound(res);
  const up = readUpload(req.body);
  if (up.error) return res.status(400).json({ error: up.error });
  const stored = await pdb.setItemFile(assignment.id, item.id, { ...up, uploadedBy: req.user.id });
  await pdb.clearPackDraft(assignment.id);
  await auditOnboarding(req, 'pack_item_file_replaced', { targetType: 'onboarding_assignment', targetId: assignment.id, metadata: { assignmentId: assignment.id, itemId: item.id, sha256: stored.file_sha256, bytes: stored.file_size_bytes } });
  await respond(req, res, assignment, 201);
}));

router.delete('/api/onboarding/journey/records/:id/pack/items/:itemId/file', requirePermission('onboarding.assign'), safe(async (req, res) => {
  const assignment = await loadRecord(req);
  if (!assignment) return notFound(res);
  if (!packEditable(assignment)) return res.status(409).json({ error: 'The pack has been sent and can no longer be changed.', code: 'sent' });
  const item = await pdb.getItem(assignment.id, req.params.itemId);
  if (!item) return notFound(res);
  await pdb.clearItemFile(assignment.id, item.id);
  await pdb.clearPackDraft(assignment.id);
  await auditOnboarding(req, 'pack_item_file_reverted', { targetType: 'onboarding_assignment', targetId: assignment.id, metadata: { assignmentId: assignment.id, itemId: item.id } });
  await respond(req, res, assignment);
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
router.get('/api/onboarding/journey/records/:id/pack/items/:itemId/preview', requirePermission('onboarding.view'), safe((req, res) => serveItem(req, res, 'inline')));
router.get('/api/onboarding/journey/records/:id/pack/items/:itemId/download', requirePermission('onboarding.view'), safe((req, res) => serveItem(req, res, 'attachment')));

/** The ZIP as it stands: the stored one once drafted, else built on the fly. */
router.get('/api/onboarding/journey/records/:id/pack/zip', requirePermission('onboarding.view'), safe(async (req, res) => {
  const assignment = await loadRecord(req);
  if (!assignment) return notFound(res);
  let bytes; let fileName;
  const live = await wdb.getLiveStarterPack(assignment.id);
  if (live && assignment.pack_email_draft_id) {
    bytes = await wdb.readStarterPackBytes(live); fileName = live.file_name;
  } else {
    const built = await buildZipForRecord(req, assignment);
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

router.put('/api/onboarding/journey/records/:id/pack/email', requirePermission('onboarding.assign'), safe(async (req, res) => {
  const assignment = await loadRecord(req);
  if (!assignment) return notFound(res);
  if (!packEditable(assignment)) return res.status(409).json({ error: 'The pack has been sent.', code: 'sent' });
  const subject = str(req.body?.subject, 250);
  const body = typeof req.body?.body === 'string' ? req.body.body.slice(0, 20000) : null;
  if (!subject) return res.status(400).json({ error: 'A subject is required.' });
  if (!body || !body.trim()) return res.status(400).json({ error: 'The email body cannot be empty.' });
  await pdb.savePackEmail(assignment.id, { subject, body });
  await respond(req, res, assignment);
}));

router.post('/api/onboarding/journey/records/:id/pack/email/reset', requirePermission('onboarding.assign'), safe(async (req, res) => {
  const assignment = await loadRecord(req);
  if (!assignment) return notFound(res);
  await pdb.savePackEmail(assignment.id, { subject: null, body: null });
  await respond(req, res, assignment);
}));

/**
 * PREPARE ONBOARDING EMAIL → the Outlook draft. Builds the ZIP from the
 * items as they stand, stores it, fixes the due date (today + 7) into the
 * body, and creates the draft with the ZIP attached. Nothing is sent.
 */
router.post('/api/onboarding/journey/records/:id/pack/email/draft', requirePermission('onboarding.assign'), safe(async (req, res) => {
  const assignment = await loadRecord(req);
  if (!assignment) return notFound(res);
  if (!packEditable(assignment)) return res.status(409).json({ error: 'The pack has already been sent.', code: 'sent' });
  if (!(await phase1Settled(assignment))) return res.status(409).json({ error: 'The letter of offer has not been verified yet.', code: 'phase1_open' });
  if (!assignment.pack_prepared_at) await preparePack(assignment);

  const reason = graphMail.unavailableReason(req.user);
  if (reason) return res.status(409).json({ error: reason, code: 'graph_unavailable' });
  const accessToken = await graphMail.getAccessToken(req.user);
  if (!accessToken) return res.status(409).json({ error: 'Your Microsoft connection needs renewing. Reconnect Outlook in Settings and try again.', code: 'graph_no_token' });

  const now = new Date();
  const dueAt = packEmail.dueDateFrom(now);
  const d = packEmail.composePackEmail({ applicantName: assignment.applicant_name, sentAt: now });
  const subject = str(req.body?.subject, 250) || assignment.pack_email_subject || d.subject;
  const rawBody = (typeof req.body?.body === 'string' && req.body.body.trim()) ? req.body.body.slice(0, 20000) : (assignment.pack_email_body || d.body);
  const body = packEmail.restampDueDate(rawBody, assignment.pack_due_at, dueAt);

  const built = await buildZipForRecord(req, { ...assignment, pack_due_at: dueAt });
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
    organisationId: orgOf(req), assignmentId: assignment.id, starterPackId: stored.id, kind: 'onboarding_pack',
    toEmail: assignment.applicant_email, subject, method: 'graph_draft', status: draft.ok ? 'draft_created' : 'failed',
    attachmentIncluded: true, attachmentBytes: built.buffer.length,
    providerDraftId: draft.ok ? draft.id : null, webLink: draft.ok ? draft.webLink : null,
    errorReason: draft.ok ? null : draft.code, requestedBy: req.user.id,
  });
  if (!draft.ok) {
    await auditOnboarding(req, 'pack_email_draft_failed', { targetType: 'onboarding_assignment', targetId: assignment.id, metadata: { assignmentId: assignment.id, reason: draft.code } });
    return res.status(502).json({ error: draft.reason || 'Outlook did not accept the draft.', code: draft.code || 'graph_error' });
  }
  await pdb.markPackDrafted(assignment.id, { actorId: req.user.id, draftId: draft.id, webLink: draft.webLink, subject, body, dueAt });
  await auditOnboarding(req, 'pack_email_drafted', {
    targetType: 'onboarding_assignment', targetId: assignment.id,
    metadata: { assignmentId: assignment.id, starterPackId: stored.id, documents: built.manifest.length, omissions: built.omissions.length, attachmentBytes: built.buffer.length },
  });
  const fresh = await odb.getAssignment(orgOf(req), assignment.id);
  res.status(201).json({
    ok: true, pack: await packDetail(req, fresh),
    delivery: { status: 'draft_created', webLink: draft.webLink, omissions: built.omissions, message: 'A draft is waiting in your Outlook with the pack attached. Read it over and press Send, then mark it as sent here.' },
  });
}));

router.post('/api/onboarding/journey/records/:id/pack/mark-sent', requirePermission('onboarding.assign'), safe(async (req, res) => {
  const assignment = await loadRecord(req);
  if (!assignment) return notFound(res);
  if (!packEditable(assignment)) return res.status(409).json({ error: 'This pack is not waiting to be sent.', code: 'not_sendable' });
  if (!(await phase1Settled(assignment))) return res.status(409).json({ error: 'The letter of offer has not been verified yet.', code: 'phase1_open' });
  const dueAt = assignment.pack_due_at || packEmail.dueDateFrom(new Date());
  await pdb.markPackSent(assignment.id, { actorId: req.user.id, toEmail: assignment.applicant_email, dueAt });
  await wdb.recordDispatch({
    organisationId: orgOf(req), assignmentId: assignment.id, kind: 'onboarding_pack', toEmail: assignment.applicant_email,
    subject: assignment.pack_email_subject || packEmail.SUBJECT, method: 'manual', status: 'sent', attachmentIncluded: true, requestedBy: req.user.id,
  });
  await auditOnboarding(req, 'pack_marked_sent', { targetType: 'onboarding_assignment', targetId: assignment.id, metadata: { assignmentId: assignment.id, hadOutlookDraft: !!assignment.pack_email_draft_id } });
  await respond(req, res, assignment);
}));

router.post('/api/onboarding/journey/records/:id/pack/unmark-sent', requirePermission('onboarding.assign'), safe(async (req, res) => {
  const assignment = await loadRecord(req);
  if (!assignment) return notFound(res);
  if (assignment.status !== 'starter_pack_sent') return res.status(409).json({ error: 'This pack is not marked as sent.', code: 'not_sent' });
  await pdb.unmarkPackSent(assignment.id);
  await auditOnboarding(req, 'pack_unmarked_sent', { targetType: 'onboarding_assignment', targetId: assignment.id, metadata: { assignmentId: assignment.id } });
  await respond(req, res, assignment);
}));

module.exports = router;
module.exports._internals = { preparePack, packDetail, buildZipForRecord, itemRow, readUpload, packEditable };
