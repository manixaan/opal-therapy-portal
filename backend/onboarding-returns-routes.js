'use strict';

/**
 * THE RETURN LEG — routes.
 *
 *   POST …/returns                 upload returned documents (base64), then PROCESS
 *   POST …/returns/process         read → classify → match → reconcile → apply
 *   POST …/returns/:docId/assign   the Owner says which pack item a document answers
 *   POST …/returns/:docId/archive  not one of ours
 *   POST …/fields/:fieldId/resolve the Owner settles a review or a conflict
 *   POST …/pack/items/:itemId/verify | reject
 *   POST …/payroll/approve
 *   GET  …/attention               what genuinely needs the Owner
 *
 * AUTOMATION HANDLES NORMAL ITEMS, THE OWNER HANDLES EXCEPTIONS
 * ─────────────────────────────────────────────────────────────
 * A document that is recognised, matched to its pack item, read reliably and
 * agrees with everything else is applied to the profile and the item is
 * verified — silently. Anything else lands in Requires Your Attention.
 */

const express = require('express');
const router = express.Router();

const odb = require('./onboarding-db');
const wdb = require('./onboarding-workflow-db');
const pdb = require('./onboarding-pack-db');
const rdb = require('./onboarding-returns-db');
const extraction = require('./onboarding-extraction');
const reconcile = require('./onboarding-reconcile');
const attention = require('./onboarding-attention');
const sync = require('./onboarding-profile-sync');
const gateway = require('./ai/ai-gateway');
const { auditOnboarding } = require('./onboarding-audit');
const { requireAuth, requirePermission } = require('./permissions');
const log = require('./logger').createLogger('onboarding-returns');

const orgOf = (req) => req.user?.organisation_id || null;
const { isUuid, str } = odb;
const safe = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  log.error('returns route error', { error: err, path: req.path });
  if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
});
const notFound = (res) => res.status(404).json({ error: 'Not found' });

async function loadRecord(req) {
  if (!isUuid(req.params.id)) return null;
  return odb.getAssignment(orgOf(req), req.params.id);
}

// ── Matching a document to a pack item ──────────────────────────────────────

/** document kind → pack item codes it answers, in preference order. */
const KIND_TO_CODES = {
  contract: ['PACK_CONTRACT'], new_employee_details: ['PACK_NEW_EMPLOYEE_DETAILS'], super_choice: ['PACK_SUPER_CHOICE'],
  tax_summary: ['REQ_TAX_SETUP'], fair_work_statement: ['REQ_FWIS', 'REQ_CEIS', 'REQ_FTCIS'],
  passport: ['PACK_PASSPORT_VISA', 'REQ_IDENTITY', 'REQ_RIGHT_TO_WORK'], visa: ['PACK_PASSPORT_VISA', 'REQ_RIGHT_TO_WORK'],
  drivers_licence: ['REQ_DRIVERS_LICENCE', 'REQ_IDENTITY'], police_check: ['PACK_POLICE_CHECK', 'REQ_POLICE_CHECK'],
  ndis_screening: ['REQ_NDIS_SCREENING'], wwcc: ['REQ_WWCC'], ahpra: ['REQ_AHPRA'], first_aid: ['PACK_FIRST_AID'], cpr: ['PACK_CPR'],
  vehicle: ['REQ_VEHICLE'], insurance: ['REQ_PII', 'REQ_VEHICLE'], identity_other: ['REQ_IDENTITY'],
};
const FILENAME_HINTS = [
  [/contract/i, 'contract'], [/employee.?details|new.?employee|personal.?details/i, 'new_employee_details'], [/super/i, 'super_choice'],
  [/tax|tfn|ato/i, 'tax_summary'], [/passport/i, 'passport'], [/visa|vevo/i, 'visa'], [/licen[cs]e/i, 'drivers_licence'],
  [/police|npc/i, 'police_check'], [/ndis|screening/i, 'ndis_screening'], [/wwcc|working.?with.?children/i, 'wwcc'], [/ahpra/i, 'ahpra'],
  [/first.?aid/i, 'first_aid'], [/cpr/i, 'cpr'], [/vehicle|rego|registration/i, 'vehicle'], [/insurance|indemnity/i, 'insurance'],
];

function matchDocument(doc, classification, packItems) {
  const included = packItems.filter((p) => p.status === 'included');
  let kind = classification ? classification.kind : null; let confidence = classification ? classification.confidence : 'low';
  if (!kind || kind === 'unrecognised' || kind === 'other') {
    const hint = FILENAME_HINTS.find(([re]) => re.test(`${doc.title || ''} ${doc.file_name || ''}`));
    if (hint) { kind = hint[1]; confidence = 'medium'; }
  }
  if (!kind || kind === 'unrecognised' || kind === 'other' || kind === 'policy_acknowledgement') return { kind: kind || 'unrecognised', item: null, confidence: 'low' };
  const codes = KIND_TO_CODES[kind] || [];
  const item = codes.map((c) => included.find((p) => p.code === c)).find(Boolean)
    || included.find((p) => p.employee_returns && new RegExp(kind.replace(/_/g, '.?'), 'i').test(p.title)) || null;
  return { kind, item, confidence: item ? confidence : 'low' };
}

/** Which resolved fields a pack item's verification depends on. */
const ITEM_FIELDS = {
  PACK_CONTRACT: ['employment_type', 'start_date', 'hours_per_week', 'salary_annual', 'hourly_rate'],
  PACK_NEW_EMPLOYEE_DETAILS: ['legal_first_name', 'surname', 'date_of_birth', 'mobile', 'address_line1', 'emergency_name', 'emergency_phone', 'bsb', 'account_number'],
  PACK_SUPER_CHOICE: ['super_fund_name', 'super_usi', 'super_member_number'],
  REQ_DRIVERS_LICENCE: ['drivers_licence_number', 'drivers_licence_expiry'], PACK_POLICE_CHECK: ['police_check_date'],
  REQ_NDIS_SCREENING: ['ndis_screening_number', 'ndis_screening_expiry'], REQ_WWCC: ['wwcc_number', 'wwcc_expiry'],
  REQ_AHPRA: ['ahpra_registration_number', 'ahpra_expiry'], PACK_FIRST_AID: ['first_aid_expiry'], PACK_CPR: ['cpr_expiry'],
  PACK_PASSPORT_VISA: ['passport_number', 'passport_expiry'], REQ_VEHICLE: ['vehicle_registration'], REQ_PII: ['insurance_policy_expiry'],
};

/**
 * THE PROCESS. Reads every active returned document, classifies and matches
 * them, keeps every reading as a candidate, reconciles, applies what is
 * reliable to the profile, and verifies items the automation can vouch for.
 */
async function processReturns(req, assignment) {
  const out = { read: 0, unreadable: 0, matched: 0, unrecognised: 0, candidates: 0, reliable: 0, review: 0, conflict: 0, applied: [], autoVerified: 0, aiUsed: false };
  const docs = await rdb.listReturns(assignment.id);
  const packItems = await pdb.listItems(assignment.id);
  if (!docs.length) return out;

  // 1. Read.
  const readable = [];
  for (const d of docs) {
    const full = await wdb.getReturnedDocument(assignment.id, d.id);
    const bytes = await wdb.readReturnedDocumentBytes(full).catch(() => null);
    if (!bytes) { out.unreadable += 1; continue; }
    const text = await extraction.readDocumentText(bytes, full.file_mime);
    if (text.status !== full.text_status) await wdb.setReturnedDocumentText(full.id, { textStatus: text.status, textChars: text.chars, pageCount: text.pages.length });
    if (text.status === 'extracted') { readable.push({ index: readable.length + 1, id: full.id, title: full.title || full.file_name, pages: text.pages, row: full }); out.read += 1; } else out.unreadable += 1;
  }

  // 2. Classify + transcribe, one model call, when the gateway allows.
  let classifications = new Map(); let candidates = []; let runId = null;
  if (readable.length && gateway.isAvailable(extraction.AI_FEATURE)) {
    const run = await wdb.startRun({ organisationId: assignment.organisation_id, assignmentId: assignment.id, documentCount: readable.length, requestedBy: req.user.id });
    runId = run.id;
    try {
      const corpus = extraction.buildCorpus(readable);
      const answer = await extraction.callModel({ corpus: corpus.text, userId: req.user.id, organisationId: assignment.organisation_id });
      const byIndex = new Map(readable.map((d) => [d.index, d]));
      classifications = extraction.normaliseClassifications(answer.documents, byIndex);
      const norm = extraction.normaliseCandidates(answer.fields, byIndex);
      for (const f of norm.fields) { await rdb.upsertCandidate({ organisationId: assignment.organisation_id, assignmentId: assignment.id, runId, field: f }); out.candidates += 1; }
      await wdb.finishRun(run.id, { status: 'succeeded', readableCount: readable.length, fieldCount: out.candidates, modelKey: answer.meta?.modelKey, provider: answer.meta?.provider, aiAuditId: answer.meta?.interactionId });
      out.aiUsed = true;
    } catch (err) {
      await wdb.finishRun(run.id, { status: 'failed', readableCount: readable.length, errorReason: String(err.code || err.message).slice(0, 200) });
      if (err.code === 'ENCRYPTION_UNAVAILABLE') throw err;
      log.warn('extraction failed; documents matched by name only', { error: err, assignmentId: assignment.id });
    }
  }

  // 3. Match every active document to its pack item.
  for (const d of docs) {
    const c = classifications.get(d.id) || null;
    const m = matchDocument(d, c, packItems);
    if (m.item) {
      await rdb.setDocumentMatch(d.id, { packItemId: m.item.id, matchStatus: d.match_status === 'manual' ? 'manual' : 'matched', matchConfidence: m.confidence, documentKind: m.kind, signatureStatus: c ? c.signed : null });
      await rdb.markItemReturned(m.item.id, d.id);
      out.matched += 1;
    } else if (d.match_status === 'manual' && d.pack_item_id) {
      await rdb.setDocumentMatch(d.id, { matchStatus: 'manual', matchConfidence: 'high', documentKind: m.kind, signatureStatus: c ? c.signed : null });
      out.matched += 1;
    } else {
      await rdb.setDocumentMatch(d.id, { matchStatus: 'unrecognised', matchConfidence: 'low', documentKind: m.kind, signatureStatus: c ? c.signed : null });
      out.unrecognised += 1;
    }
  }

  // 4. Reconcile every field that has a document reading.
  candidates = await rdb.listCandidates(assignment.id);
  const cands = candidates.map((c) => ({
    key: c.field_key, value: rdb.revealCandidate(c), confidence: c.confidence, sourceKind: 'document',
    sourceLabel: c.pack_item_title || c.source_title || c.source_file_name || 'Returned document', sourceDocumentId: c.source_document_id, candidateId: c.id,
  })).filter((c) => c.value != null);
  const results = reconcile.reconcileAll(cands, assignment);
  for (const r of results) {
    const best = r.options.find((o) => o.value === r.value) || r.options[0] || {};
    await rdb.upsertResolved({
      organisationId: assignment.organisation_id, assignmentId: assignment.id, runId, key: r.key, outcome: r.outcome, value: r.value,
      confidence: r.confidence, reason: r.reason, options: r.options, source: { sourceDocumentId: best.sourceDocumentId, sourceLabel: best.sourceLabel },
    });
    out[r.outcome] += 1;
  }

  // 5. Apply what is reliable or settled.
  const fresh = await odb.getAssignment(assignment.organisation_id, assignment.id);
  const docsNow = await rdb.listReturns(assignment.id);
  const synced = await sync.syncProfile({ assignment: fresh, returnedDocuments: docsNow });
  out.applied = synced.written;

  // 6. Verify items the automation can vouch for.
  const resolved = await rdb.listResolved(assignment.id);
  const byKey = new Map(resolved.map((r) => [r.field_key, r]));
  const docsByItem = new Map(docsNow.filter((d) => d.pack_item_id).map((d) => [d.pack_item_id, d]));
  // Every field a document contributed to: an item is not settled while any of them is.
  const keysByDoc = new Map();
  for (const c of candidates) { if (!keysByDoc.has(c.source_document_id)) keysByDoc.set(c.source_document_id, new Set()); keysByDoc.get(c.source_document_id).add(c.field_key); }
  for (const item of await pdb.listItems(assignment.id)) {
    if (item.status !== 'included' || !item.employee_returns) continue;
    const doc = docsByItem.get(item.id);
    if (!doc) continue;
    if (item.verification_status === 'verified' && item.verification_mode === 'owner') continue;
    const keys = [...new Set([...(ITEM_FIELDS[item.code] || []), ...(keysByDoc.get(doc.id) || [])])];
    const readings = keys.map((k) => byKey.get(k)).filter(Boolean);
    const unsettled = readings.some((r) => r.status === 'proposed');
    const signatureMissing = doc.signature_status === 'missing';
    const statutory = attention.STATUTORY.has(item.code);
    // A missing signature is reported against the document (Requires Your
    // Attention → missing signature); the item simply stays unverified.
    if (signatureMissing) { if (item.verification_status !== 'pending') await rdb.setItemVerification(item.id, { status: 'pending', mode: null, reason: null }); continue; }
    if (unsettled) { await rdb.setItemVerification(item.id, { status: 'pending', mode: null, reason: null }); continue; }
    if (!item.requires_verification || (!statutory && (readings.length > 0 || !keys.length))) {
      if (item.verification_status !== 'verified') { await rdb.setItemVerification(item.id, { status: 'verified', mode: 'auto', reason: null, note: 'Verified automatically: recognised, read reliably, nothing in conflict' }); out.autoVerified += 1; }
    }
  }

  // 7. The record moves.
  await odb.pool.query(
    `UPDATE onboarding_assignments SET status = CASE WHEN status = 'starter_pack_sent' THEN 'documents_received' ELSE status END,
        documents_received_at = COALESCE(documents_received_at, NOW()), extraction_completed_at = CASE WHEN $2::boolean THEN NOW() ELSE extraction_completed_at END,
        last_activity_at = NOW(), updated_at = NOW() WHERE id = $1`, [assignment.id, out.aiUsed]
  );
  return out;
}

/** The attention list for a record, assembled from every source. */
async function attentionFor(assignment) {
  const [docs, items, fields, tasks] = await Promise.all([
    rdb.listReturns(assignment.id), pdb.listItems(assignment.id), rdb.listResolved(assignment.id),
    require('./onboarding-journey-db').listTasks(assignment.id),
  ]);
  const credentials = assignment.user_id ? await odb.listCredentialsForUser(assignment.user_id) : [];
  const payrollRow = assignment.user_id ? await rdb.getPayrollApproval(assignment.user_id) : null;
  const payroll = payrollRow ? { bankStatus: payrollRow.bank_status, bankVerifiedAt: payrollRow.bank_verified_at, bsbMasked: payrollRow.bsb_masked, accountLast4: payrollRow.account_number_last4 } : null;
  const shaped = fields.map((f) => ({
    id: f.id, key: f.field_key, label: f.label, outcome: f.outcome, status: f.status, reason: f.outcome_reason,
    value: f.sensitivity === 'sensitive' ? f.value_masked : f.value_text, conflict_options: f.conflict_options || [],
    title: f.outcome === 'conflict' ? reconcile.conflictTitle(f.field_key) : null,
  }));
  return attention.buildAttention({ returnedDocuments: docs, packItems: items, fields: shaped, credentials, payroll, tasks, assignment });
}

// ═════════════════════════════════════════════════════════════════════════════

router.use('/api/onboarding/journey', requireAuth);

/** Base64 upload → { buffer, fileName, fileMime } or { error }. Returned documents may be scans, Word files or text. */
function readReturn(f) {
  if (!f || !f.fileData || typeof f.fileData !== 'string') return { error: 'No file was received.' };
  if (f.fileData.length > 14 * 1024 * 1024) return { error: 'That file is too large (10 MB limit).' };
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(f.fileData.slice(0, 1000))) return { error: 'The file could not be read.' };
  const fileMime = String(f.fileMime || '').toLowerCase();
  const exts = RETURN_MIMES[fileMime];
  if (!exts) return { error: 'That file type is not accepted. Use PDF, Word, PNG, JPEG or text.' };
  const fileName = String(f.fileName || '').trim().slice(0, 255);
  if (!fileName || /[/\\]|\.\./.test(fileName)) return { error: 'The file name is not valid.' };
  if (!exts.includes(fileName.split('.').pop().toLowerCase())) return { error: 'The file name does not match its type.' };
  const buffer = Buffer.from(f.fileData, 'base64');
  if (!buffer.length) return { error: 'The file is empty.' };
  return { buffer, fileName, fileMime };
}
const RETURN_MIMES = { 'application/pdf': ['pdf'], 'image/png': ['png'], 'image/jpeg': ['jpg', 'jpeg'], 'application/msword': ['doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'], 'text/plain': ['txt'] };

/** Upload one or more returned documents, then process everything. */
router.post('/api/onboarding/journey/records/:id/returns', requirePermission('onboarding.review'), safe(async (req, res) => {
  const assignment = await loadRecord(req);
  if (!assignment) return notFound(res);
  const files = Array.isArray(req.body?.files) ? req.body.files : (req.body?.fileData ? [req.body] : []);
  if (!files.length) return res.status(400).json({ error: 'No files were received.' });
  if (files.length > 12) return res.status(413).json({ error: 'Upload at most 12 files at a time.' });
  const stored = []; const rejected = [];
  for (const f of files) {
    const up = readReturn(f);
    if (up.error) { rejected.push({ fileName: f.fileName, reason: up.error }); continue; }
    const { row, duplicate } = await wdb.createReturnedDocument({
      organisationId: orgOf(req), assignmentId: assignment.id, title: str(f.title, 250) || up.fileName, fileName: up.fileName, fileMime: up.fileMime,
      buffer: up.buffer, uploadedBy: req.user.id, textStatus: 'pending',
    });
    if (f.packItemId && isUuid(f.packItemId) && !duplicate) await rdb.assignDocumentToItem(row.id, f.packItemId);
    stored.push({ id: row.id, fileName: row.file_name, duplicate });
    if (!duplicate) await auditOnboarding(req, 'returned_document_uploaded', { targetType: 'onboarding_assignment', targetId: assignment.id, metadata: { assignmentId: assignment.id, documentId: row.id, sha256: row.file_sha256, bytes: row.file_size_bytes } });
  }
  let processed = null;
  try { processed = await processReturns(req, assignment); } catch (err) {
    if (err.code === 'ENCRYPTION_UNAVAILABLE') return res.status(503).json({ error: 'Field encryption is not configured.', code: 'ENCRYPTION_UNAVAILABLE' });
    throw err;
  }
  await auditOnboarding(req, 'returns_processed', { targetType: 'onboarding_assignment', targetId: assignment.id, metadata: { assignmentId: assignment.id, ...summaryMeta(processed) } });
  res.status(201).json({ ok: true, stored, rejected, processed, attention: await attentionFor(await odb.getAssignment(orgOf(req), assignment.id)) });
}));

const summaryMeta = (p) => (p ? { read: p.read, matched: p.matched, unrecognised: p.unrecognised, candidates: p.candidates, reliable: p.reliable, review: p.review, conflict: p.conflict, autoVerified: p.autoVerified, applied: p.applied.length, aiUsed: p.aiUsed } : {});

router.post('/api/onboarding/journey/records/:id/returns/process', requirePermission('onboarding.review'), safe(async (req, res) => {
  const assignment = await loadRecord(req);
  if (!assignment) return notFound(res);
  let processed;
  try { processed = await processReturns(req, assignment); } catch (err) {
    if (err.code === 'ENCRYPTION_UNAVAILABLE') return res.status(503).json({ error: 'Field encryption is not configured.', code: 'ENCRYPTION_UNAVAILABLE' });
    throw err;
  }
  await auditOnboarding(req, 'returns_processed', { targetType: 'onboarding_assignment', targetId: assignment.id, metadata: { assignmentId: assignment.id, ...summaryMeta(processed) } });
  res.json({ ok: true, processed, attention: await attentionFor(await odb.getAssignment(orgOf(req), assignment.id)) });
}));

router.get('/api/onboarding/journey/records/:id/attention', requirePermission('onboarding.view'), safe(async (req, res) => {
  const assignment = await loadRecord(req);
  if (!assignment) return notFound(res);
  res.json({ ok: true, attention: await attentionFor(assignment) });
}));

/** The Owner says what a document is. */
router.post('/api/onboarding/journey/records/:id/returns/:docId/assign', requirePermission('onboarding.review'), safe(async (req, res) => {
  const assignment = await loadRecord(req);
  if (!assignment) return notFound(res);
  const doc = await wdb.getReturnedDocument(assignment.id, req.params.docId);
  const item = await pdb.getItem(assignment.id, req.body?.packItemId);
  if (!doc || !item) return notFound(res);
  await rdb.assignDocumentToItem(doc.id, item.id);
  await rdb.markItemReturned(item.id, doc.id);
  await auditOnboarding(req, 'returned_document_assigned', { targetType: 'onboarding_assignment', targetId: assignment.id, metadata: { assignmentId: assignment.id, documentId: doc.id, itemId: item.id } });
  const processed = await processReturns(req, assignment).catch((err) => { log.warn('reprocess after assign failed', { error: err }); return null; });
  res.json({ ok: true, processed, attention: await attentionFor(await odb.getAssignment(orgOf(req), assignment.id)) });
}));

router.post('/api/onboarding/journey/records/:id/returns/:docId/archive', requirePermission('onboarding.review'), safe(async (req, res) => {
  const assignment = await loadRecord(req);
  if (!assignment) return notFound(res);
  const doc = await wdb.archiveReturnedDocument(assignment.id, req.params.docId, req.user.id);
  if (!doc) return notFound(res);
  await auditOnboarding(req, 'returned_document_archived', { targetType: 'onboarding_assignment', targetId: assignment.id, metadata: { assignmentId: assignment.id, documentId: req.params.docId } });
  res.json({ ok: true, attention: await attentionFor(assignment) });
}));

/** The Owner settles a field: { decision: 'choose', candidateId } | { decision: 'accept' } | { decision: 'correct', value } | { decision: 'reject' } */
router.post('/api/onboarding/journey/records/:id/fields/:fieldId/resolve', requirePermission('onboarding.review'), safe(async (req, res) => {
  const assignment = await loadRecord(req);
  if (!assignment) return notFound(res);
  const raw = await rdb.getResolvedRaw(assignment.id, req.params.fieldId);
  if (!raw) return notFound(res);
  const perm = extraction.requiredPermissionFor(raw.field_key);
  if (perm !== 'onboarding.review' && !require('./permissions').hasPermission(req.user, perm)) return res.status(403).json({ error: `Missing permission: ${perm}` });
  const b = req.body || {};
  let value = null; let decision = b.decision;
  if (decision === 'choose') {
    const cand = (await rdb.listCandidates(assignment.id)).find((c) => c.id === b.candidateId);
    if (!cand) return res.status(400).json({ error: 'Choose one of the listed values.' });
    value = rdb.revealCandidate(cand); decision = 'correct';
  } else if (decision === 'accept') {
    value = rdb.revealResolved(raw);
    if (value == null) return res.status(400).json({ error: 'There is no value to accept — choose or type one.' });
  } else if (decision === 'correct') {
    value = b.value;
  } else if (decision !== 'reject') return res.status(400).json({ error: 'decision must be choose, accept, correct or reject' });
  let row;
  try { row = await rdb.resolveByOwner(assignment.id, raw.id, { value, actorId: req.user.id, decision }); } catch (err) {
    if (err.code === 'INVALID_VALUE') return res.status(400).json({ error: 'That value is not valid for this field.', code: 'invalid_value' });
    if (err.code === 'ENCRYPTION_UNAVAILABLE') return res.status(503).json({ error: 'Field encryption is not configured.', code: 'ENCRYPTION_UNAVAILABLE' });
    throw err;
  }
  await auditOnboarding(req, 'field_resolved', { targetType: 'onboarding_assignment', targetId: assignment.id, metadata: { assignmentId: assignment.id, fieldId: row.id, fieldKey: row.field_key, decision } });
  const processed = await processReturns(req, assignment).catch((err) => { log.warn('reprocess after resolve failed', { error: err }); return null; });
  const after = (await rdb.getResolvedRaw(assignment.id, row.id)) || row;
  res.json({ ok: true, field: { id: after.id, key: after.field_key, status: after.status, outcome: after.outcome }, processed, attention: await attentionFor(await odb.getAssignment(orgOf(req), assignment.id)) });
}));

for (const [verb, status] of [['verify', 'verified'], ['reject', 'rejected']]) {
  router.post(`/api/onboarding/journey/records/:id/pack/items/:itemId/${verb}`, requirePermission('onboarding.verify'), safe(async (req, res) => {
    const assignment = await loadRecord(req);
    if (!assignment) return notFound(res);
    const item = await pdb.getItem(assignment.id, req.params.itemId);
    if (!item) return notFound(res);
    await rdb.setItemVerification(item.id, { status, mode: 'owner', actorId: req.user.id, reason: status === 'rejected' ? str(req.body?.reason, 250) || 'Rejected by the practice' : null, note: str(req.body?.note, 1000) });
    // A statutory item verified against the register marks its credential verified too.
    if (status === 'verified' && assignment.user_id) {
      const type = { REQ_AHPRA: 'ahpra_registration', REQ_NDIS_SCREENING: 'ndis_worker_screening', REQ_WWCC: 'wwcc', PACK_POLICE_CHECK: 'police_check', REQ_DRIVERS_LICENCE: 'drivers_licence', PACK_FIRST_AID: 'first_aid', PACK_CPR: 'cpr' }[item.code];
      if (type) {
        const { rows } = await odb.pool.query('SELECT id FROM credentials WHERE user_id = $1 AND credential_type = $2 ORDER BY created_at DESC LIMIT 1', [assignment.user_id, type]);
        if (rows[0]) await odb.verifyCredential(rows[0].id, assignment.user_id, { status: 'verified', lifecycleStatus: 'current', verificationMethod: 'document_sighted', verificationReference: str(req.body?.reference, 200) }, req.user.id);
      }
    }
    await auditOnboarding(req, `pack_item_${status}`, { targetType: 'onboarding_assignment', targetId: assignment.id, metadata: { assignmentId: assignment.id, itemId: item.id, code: item.code } });
    res.json({ ok: true, attention: await attentionFor(assignment) });
  }));
}

router.post('/api/onboarding/journey/records/:id/payroll/approve', requirePermission('onboarding.payroll'), safe(async (req, res) => {
  const assignment = await loadRecord(req);
  if (!assignment) return notFound(res);
  if (!assignment.user_id) return res.status(409).json({ error: 'No profile exists for this person yet.', code: 'no_user' });
  const row = await rdb.approvePayroll(assignment.user_id, req.user.id);
  if (!row) return res.status(409).json({ error: 'There are no bank details waiting for approval.', code: 'nothing_to_approve' });
  await auditOnboarding(req, 'payroll_bank_approved', { targetType: 'user', targetId: assignment.user_id, metadata: { assignmentId: assignment.id } });
  res.json({ ok: true, attention: await attentionFor(assignment) });
}));

/** The employee profile as it now stands. */
router.get('/api/onboarding/journey/records/:id/profile', requirePermission('onboarding.view'), safe(async (req, res) => {
  const assignment = await loadRecord(req);
  if (!assignment) return notFound(res);
  res.json({ ok: true, profile: await sync.profileSummary(assignment.user_id) });
}));

module.exports = router;
module.exports._internals = { processReturns, attentionFor, matchDocument, KIND_TO_CODES, ITEM_FIELDS };
