'use strict';

/**
 * DATA ACCESS for the return leg (migration 050): per-document candidates,
 * resolved fields with an outcome, returned-document matching, and the
 * profile tables the reliable values flow into.
 *
 * The same rule as onboarding-workflow-db.js: a sensitive value is written
 * encrypted and read masked, and the only function that decrypts —
 * revealCandidate / revealResolved — exists for the apply step and is never
 * wired to a response.
 */

const crypto = require('crypto');
const odb = require('./onboarding-db');
const db = require('./database');
const { encryptField, decryptField, isEncryptionConfigured } = require('./onboarding-crypto');
const extraction = require('./onboarding-extraction');
const log = require('./logger').createLogger('onboarding-returns-db');

const { pool, isUuid, str } = odb;

// ═════════════════════════════════════════════════════════════════════════════
//  CANDIDATES
// ═════════════════════════════════════════════════════════════════════════════

/** Store one reading of one field from one document. Replaces an earlier reading of the same document. */
async function upsertCandidate({ organisationId, assignmentId, runId, field }, q = pool) {
  const def = extraction.FIELDS[field.key];
  if (!def) return null;
  const sensitive = def.sensitive === true;
  if (sensitive && !isEncryptionConfigured()) {
    const err = new Error('encryption unavailable'); err.code = 'ENCRYPTION_UNAVAILABLE'; throw err;
  }
  const { rows } = await q.query(
    `INSERT INTO onboarding_field_candidates
       (organisation_id, assignment_id, run_id, field_key, sensitivity, value_text, value_encrypted, value_masked,
        confidence, source_kind, source_document_id, source_label, source_page)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'document',$10,$11,$12)
     ON CONFLICT (assignment_id, field_key, source_kind, COALESCE(source_document_id, '00000000-0000-0000-0000-000000000000'::uuid))
     DO UPDATE SET run_id = EXCLUDED.run_id, value_text = EXCLUDED.value_text, value_encrypted = EXCLUDED.value_encrypted,
                   value_masked = EXCLUDED.value_masked, confidence = EXCLUDED.confidence,
                   source_label = EXCLUDED.source_label, source_page = EXCLUDED.source_page
     RETURNING *`,
    [organisationId, assignmentId, runId || null, field.key, sensitive ? 'sensitive' : 'standard',
      sensitive ? null : field.value, sensitive ? encryptField(field.value) : null,
      sensitive ? extraction.maskValue(field.key, field.value) : null,
      field.confidence, field.sourceDocumentId || null, str(field.sourceLabel, 250), field.sourcePage || null]
  );
  return rows[0];
}

async function listCandidates(assignmentId, q = pool) {
  const { rows } = await q.query(
    `SELECT c.*, d.file_name AS source_file_name, d.title AS source_title, d.pack_item_id, p.title AS pack_item_title
       FROM onboarding_field_candidates c
       LEFT JOIN onboarding_returned_documents d ON d.id = c.source_document_id
       LEFT JOIN onboarding_pack_items p ON p.id = d.pack_item_id
      WHERE c.assignment_id = $1 AND (d.id IS NULL OR d.status = 'active')
      ORDER BY c.field_key, c.created_at`, [assignmentId]
  );
  return rows;
}

function revealCandidate(row) {
  if (row.sensitivity !== 'sensitive') return row.value_text;
  try { return row.value_encrypted ? decryptField(row.value_encrypted) : null; } catch (err) {
    log.error('candidate could not be decrypted', { error: err, id: row.id }); return null;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  RESOLVED FIELDS (onboarding_extracted_fields, 038 + 050)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Write the reconciled result for one field. A row the Owner has already
 * decided (accepted/corrected/rejected/applied by an owner) is left alone.
 */
async function upsertResolved({ organisationId, assignmentId, runId, key, outcome, value, confidence, reason, options, source }, q = pool) {
  const def = extraction.FIELDS[key];
  if (!def) return null;
  const sensitive = def.sensitive === true;
  const status = outcome === 'reliable' ? 'accepted' : 'proposed';
  const hasValue = value != null && String(value) !== '';
  const maskedOptions = (options || []).map((o) => ({
    candidateId: o.candidateId || null, sourceKind: o.sourceKind, sourceLabel: o.sourceLabel, sourceDocumentId: o.sourceDocumentId || null,
    confidence: o.confidence, display: sensitive ? extraction.maskValue(key, o.value) : o.display,
  }));
  const { rows } = await q.query(
    `INSERT INTO onboarding_extracted_fields
       (organisation_id, assignment_id, run_id, field_group, field_key, label, sensitivity,
        value_text, value_encrypted, value_masked, confidence, source_document_id, source_label, source_page,
        status, value_source, outcome, outcome_reason, resolution, conflict_options, reviewed)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'extraction',$16,$17,$18,$19::jsonb, FALSE)
     ON CONFLICT (assignment_id, field_key) DO UPDATE SET
       run_id = EXCLUDED.run_id, value_text = EXCLUDED.value_text, value_encrypted = EXCLUDED.value_encrypted,
       value_masked = EXCLUDED.value_masked, confidence = EXCLUDED.confidence,
       source_document_id = EXCLUDED.source_document_id, source_label = EXCLUDED.source_label, source_page = EXCLUDED.source_page,
       status = EXCLUDED.status, outcome = EXCLUDED.outcome, outcome_reason = EXCLUDED.outcome_reason,
       resolution = EXCLUDED.resolution, conflict_options = EXCLUDED.conflict_options, updated_at = NOW()
     WHERE onboarding_extracted_fields.resolution IS DISTINCT FROM 'owner'
       AND onboarding_extracted_fields.status IN ('proposed', 'accepted')
       AND onboarding_extracted_fields.value_source = 'extraction'
     RETURNING *`,
    [organisationId, assignmentId, runId || null, def.group, key, def.label, sensitive ? 'sensitive' : 'standard',
      hasValue && !sensitive ? String(value) : null, hasValue && sensitive ? encryptField(String(value)) : null,
      hasValue && sensitive ? extraction.maskValue(key, value) : null, confidence || 'medium',
      source && source.sourceDocumentId ? source.sourceDocumentId : null, str(source && source.sourceLabel, 250), (source && source.sourcePage) || null,
      status, outcome, str(reason, 250), outcome === 'reliable' ? 'auto' : null, JSON.stringify(maskedOptions)]
  );
  return rows[0] || null;
}

const FIELD_COLUMNS = `id, assignment_id, run_id, field_group, field_key, label, sensitivity, value_text, value_masked, confidence,
  source_document_id, source_label, source_page, status, reviewed, reviewed_at, value_source, applied_at, applied_to,
  outcome, outcome_reason, resolution, conflict_options`;

async function listResolved(assignmentId, q = pool) {
  const { rows } = await q.query(`SELECT ${FIELD_COLUMNS} FROM onboarding_extracted_fields WHERE assignment_id = $1 ORDER BY field_group, field_key`, [assignmentId]);
  return rows;
}

async function getResolvedRaw(assignmentId, fieldId, q = pool) {
  if (!isUuid(fieldId)) return null;
  const { rows } = await q.query('SELECT * FROM onboarding_extracted_fields WHERE id = $1 AND assignment_id = $2', [fieldId, assignmentId]);
  return rows[0] || null;
}

function revealResolved(row) {
  if (row.sensitivity !== 'sensitive') return row.value_text;
  try { return row.value_encrypted ? decryptField(row.value_encrypted) : null; } catch (err) {
    log.error('field could not be decrypted', { error: err, id: row.id }); return null;
  }
}

/** The Owner settles a field: chose a candidate, typed a value, or rejected it. */
async function resolveByOwner(assignmentId, fieldId, { value, actorId, decision }, q = pool) {
  const row = await getResolvedRaw(assignmentId, fieldId, q);
  if (!row) return null;
  const def = extraction.FIELDS[row.field_key];
  const sensitive = def && def.sensitive === true;
  if (decision === 'reject') {
    const { rows } = await q.query(
      `UPDATE onboarding_extracted_fields SET status = 'rejected', resolution = 'owner', reviewed = TRUE, reviewed_by = $3, reviewed_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND assignment_id = $2 RETURNING *`, [fieldId, assignmentId, actorId]
    );
    return rows[0];
  }
  const normalised = extraction.normaliseValue(row.field_key, value);
  if (normalised === null) { const err = new Error('invalid value'); err.code = 'INVALID_VALUE'; throw err; }
  if (sensitive && !isEncryptionConfigured()) { const err = new Error('encryption unavailable'); err.code = 'ENCRYPTION_UNAVAILABLE'; throw err; }
  const { rows } = await q.query(
    `UPDATE onboarding_extracted_fields
        SET value_text = $4, value_encrypted = $5, value_masked = $6, status = 'corrected', resolution = 'owner', value_source = 'owner',
            outcome = 'reliable', outcome_reason = $7, reviewed = TRUE, reviewed_by = $3, reviewed_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND assignment_id = $2 RETURNING *`,
    [fieldId, assignmentId, actorId, sensitive ? null : normalised, sensitive ? encryptField(normalised) : null,
      sensitive ? extraction.maskValue(row.field_key, normalised) : null, decision === 'accept' ? 'Confirmed by the practice' : 'Chosen by the practice']
  );
  return rows[0];
}

async function markFieldsApplied(ids, target, q = pool) {
  if (!ids.length) return;
  await q.query(`UPDATE onboarding_extracted_fields SET status = 'applied', applied_at = NOW(), applied_to = $2, updated_at = NOW() WHERE id = ANY($1::uuid[])`, [ids, str(target, 60)]);
}

// ═════════════════════════════════════════════════════════════════════════════
//  RETURNED DOCUMENTS ↔ PACK ITEMS
// ═════════════════════════════════════════════════════════════════════════════

/** Active returned documents with the 050 matching columns (038's list omits them). No bytes. */
async function listReturns(assignmentId, { includeArchived = false } = {}, q = pool) {
  if (!isUuid(assignmentId)) return [];
  const { rows } = await q.query(
    `SELECT id, organisation_id, assignment_id, title, file_name, file_mime, file_size_bytes, file_sha256, storage_backend, storage_key,
            page_count, text_status, text_chars, sensitivity, status, uploaded_by, uploaded_at, archived_at,
            pack_item_id, match_status, match_confidence, document_kind, signature_status, pd_document_id
       FROM onboarding_returned_documents
      WHERE assignment_id = $1 ${includeArchived ? '' : "AND status = 'active'"}
      ORDER BY uploaded_at ASC, id ASC`, [assignmentId]
  );
  return rows;
}

async function setDocumentMatch(docId, { packItemId, matchStatus, matchConfidence, documentKind, signatureStatus }, q = pool) {
  const { rows } = await q.query(
    `UPDATE onboarding_returned_documents
        SET pack_item_id = COALESCE($2, pack_item_id), match_status = $3, match_confidence = $4,
            document_kind = COALESCE($5, document_kind), signature_status = COALESCE($6, signature_status)
      WHERE id = $1 RETURNING *`,
    [docId, isUuid(packItemId) ? packItemId : null, matchStatus, matchConfidence || null, str(documentKind, 40), signatureStatus || null]
  );
  return rows[0] || null;
}

async function assignDocumentToItem(docId, packItemId, q = pool) {
  const { rows } = await q.query(
    `UPDATE onboarding_returned_documents SET pack_item_id = $2, match_status = 'manual', match_confidence = 'high' WHERE id = $1 RETURNING *`,
    [docId, packItemId]
  );
  return rows[0] || null;
}

async function markItemReturned(itemId, docId, q = pool) {
  await q.query(
    `UPDATE onboarding_pack_items SET returned_document_id = $2, returned_at = COALESCE(returned_at, NOW()), updated_at = NOW() WHERE id = $1`,
    [itemId, docId]
  );
}

async function setItemVerification(itemId, { status, mode, actorId, reason, note }, q = pool) {
  const { rows } = await q.query(
    `UPDATE onboarding_pack_items
        SET verification_status = $2::text, verification_mode = $3,
            verified_at = CASE WHEN $2::text = 'verified' THEN NOW() ELSE NULL END,
            verified_by = CASE WHEN $2::text = 'verified' THEN $4::uuid ELSE NULL END,
            attention_reason = $5, verification_note = COALESCE($6, verification_note), updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [itemId, status, mode || null, actorId || null, str(reason, 250), str(note, 1000)]
  );
  return rows[0] || null;
}

// ═════════════════════════════════════════════════════════════════════════════
//  THE PROFILE — where reliable values land
// ═════════════════════════════════════════════════════════════════════════════

/** Copy a returned document into pd_documents once, so a credential keeps its evidence attached. */
async function attachOriginal(returnedDoc, { userId, organisationId, title, documentType }) {
  if (!returnedDoc || !userId) return null;
  if (returnedDoc.pd_document_id) return returnedDoc.pd_document_id;
  const wdb = require('./onboarding-workflow-db');
  // The listing rows carry no bytes; read the full row for them.
  const full = await wdb.getReturnedDocument(returnedDoc.assignment_id, returnedDoc.id);
  const bytes = full ? await wdb.readReturnedDocumentBytes(full).catch(() => null) : null;
  if (!bytes) return null;
  const created = await db.createPDDocument({
    userId, organisationId, title: title || returnedDoc.title || returnedDoc.file_name, documentType: documentType || 'onboarding_return',
    fileName: returnedDoc.file_name, fileMime: returnedDoc.file_mime, fileSizeBytes: bytes.length, fileData: bytes.toString('base64'),
  });
  await pool.query(
    `UPDATE pd_documents SET onboarding_assignment_id = $2, sensitivity = 'sensitive', file_sha256 = $3 WHERE id = $1`,
    [created.id, returnedDoc.assignment_id, returnedDoc.file_sha256 || crypto.createHash('sha256').update(bytes).digest('hex')]
  );
  await pool.query('UPDATE onboarding_returned_documents SET pd_document_id = $2 WHERE id = $1', [returnedDoc.id, created.id]);
  return created.id;
}

/** One credential row per (user, type) from onboarding; updated in place as readings improve. */
async function upsertCredentialByType(userId, orgId, { credentialType, credentialName, registrationNumber, issueDate, expiryDate, documentId, detail, status }) {
  const { rows } = await pool.query(
    `SELECT id FROM credentials WHERE user_id = $1 AND credential_type = $2 ORDER BY created_at DESC LIMIT 1`, [userId, credentialType]
  );
  if (rows[0]) {
    const { rows: upd } = await pool.query(
      `UPDATE credentials
          SET credential_name = COALESCE($3, credential_name), registration_number = COALESCE($4, registration_number),
              issue_date = COALESCE($5, issue_date), expiry_date = COALESCE($6, expiry_date), document_id = COALESCE($7, document_id),
              detail = COALESCE(detail, '{}'::jsonb) || $8::jsonb,
              status = CASE WHEN status IN ('missing', 'pending_review') THEN $9 ELSE status END, updated_at = NOW()
        WHERE id = $1 AND user_id = $2 RETURNING *`,
      [rows[0].id, userId, str(credentialName, 255), str(registrationNumber, 100), odb.dateOrNull(issueDate), odb.dateOrNull(expiryDate),
        isUuid(documentId) ? documentId : null, JSON.stringify(detail || {}), status || 'pending_review']
    );
    return upd[0];
  }
  return odb.upsertCredential(userId, orgId, {
    credentialType, credentialName, registrationNumber, issueDate, expiryDate, documentId, detail: detail || {},
    status: status || 'pending_review', lifecycleStatus: 'employer_verification_required',
  });
}

async function upsertIdentity(userId, orgId, { assignmentId, recordKind, evidenceType, nameOnDocument, documentNumber, countryOfIssue, expiryDate, documentId, visaSubclass, workRightsExpiry }) {
  const { rows } = await pool.query(
    `SELECT id FROM employee_identity_records WHERE user_id = $1 AND evidence_type = $2 AND record_kind = $3 ORDER BY created_at DESC LIMIT 1`,
    [userId, evidenceType, recordKind || 'identity']
  );
  if (rows[0]) {
    const encrypted = documentNumber && isEncryptionConfigured() ? encryptField(String(documentNumber)) : null;
    const { rows: upd } = await pool.query(
      `UPDATE employee_identity_records
          SET name_on_document = COALESCE($3, name_on_document), document_number_encrypted = COALESCE($4, document_number_encrypted),
              document_number_last4 = COALESCE($5, document_number_last4), country_of_issue = COALESCE($6, country_of_issue),
              expiry_date = COALESCE($7, expiry_date), document_id = COALESCE($8, document_id), visa_subclass = COALESCE($9, visa_subclass),
              work_rights_expiry = COALESCE($10, work_rights_expiry), copy_retained = copy_retained OR $8 IS NOT NULL, updated_at = NOW()
        WHERE id = $1 AND user_id = $2 RETURNING id`,
      [rows[0].id, userId, str(nameOnDocument, 200), encrypted, documentNumber ? String(documentNumber).slice(-4) : null, str(countryOfIssue, 60),
        odb.dateOrNull(expiryDate), isUuid(documentId) ? documentId : null, str(visaSubclass, 20), odb.dateOrNull(workRightsExpiry)]
    );
    return upd[0];
  }
  return odb.saveIdentityRecord(userId, orgId, {
    assignmentId, recordKind: recordKind || 'identity', evidenceType, nameOnDocument, documentNumber, countryOfIssue, expiryDate, documentId,
    copyRetained: !!documentId, visaSubclass, workRightsExpiry, verificationStatus: 'verification_required',
  });
}

async function upsertVehicle(userId, orgId, { assignmentId, registration, make, model, registrationExpiry, insurancePolicyNumber, insuranceExpiry, documentId }) {
  const { rows } = await pool.query(
    `INSERT INTO employee_vehicles (user_id, organisation_id, assignment_id, registration, make, model, registration_expiry, insurance_policy_number, insurance_expiry, document_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (user_id) DO UPDATE SET
       registration = COALESCE(EXCLUDED.registration, employee_vehicles.registration), make = COALESCE(EXCLUDED.make, employee_vehicles.make),
       model = COALESCE(EXCLUDED.model, employee_vehicles.model), registration_expiry = COALESCE(EXCLUDED.registration_expiry, employee_vehicles.registration_expiry),
       insurance_policy_number = COALESCE(EXCLUDED.insurance_policy_number, employee_vehicles.insurance_policy_number),
       insurance_expiry = COALESCE(EXCLUDED.insurance_expiry, employee_vehicles.insurance_expiry),
       document_id = COALESCE(EXCLUDED.document_id, employee_vehicles.document_id), updated_at = NOW()
     RETURNING *`,
    [userId, orgId, assignmentId || null, str(registration, 20), str(make, 60), str(model, 60), odb.dateOrNull(registrationExpiry),
      str(insurancePolicyNumber, 80), odb.dateOrNull(insuranceExpiry), isUuid(documentId) ? documentId : null]
  );
  return rows[0];
}

async function getVehicle(userId, q = pool) {
  const { rows } = await q.query('SELECT * FROM employee_vehicles WHERE user_id = $1', [userId]);
  return rows[0] || null;
}

async function setEmploymentPay(userId, { payBasis, payRate, hoursPerWeek, employmentType, startDate, endDate }, q = pool) {
  await q.query(
    `UPDATE employment_profiles
        SET pay_basis = COALESCE($2, pay_basis), pay_rate = COALESCE($3, pay_rate), hours_per_week = COALESCE($4, hours_per_week),
            employment_type = COALESCE($5, employment_type), start_date = COALESCE($6, start_date), end_date = COALESCE($7, end_date), updated_at = NOW()
      WHERE user_id = $1`,
    [userId, payBasis || null, payRate == null ? null : Number(payRate), hoursPerWeek == null ? null : Number(hoursPerWeek),
      employmentType || null, odb.dateOrNull(startDate), odb.dateOrNull(endDate)]
  );
}

async function approvePayroll(userId, actorId, q = pool) {
  const { rows } = await q.query(
    `UPDATE payroll_profiles SET bank_status = 'verified', bank_verified_by = $2, bank_verified_at = NOW(), updated_at = NOW(), updated_by = $2
      WHERE user_id = $1 AND bank_status = 'provided' RETURNING user_id, bank_status`, [userId, actorId]
  );
  return rows[0] || null;
}

async function getPayrollApproval(userId, q = pool) {
  const { rows } = await q.query('SELECT bank_status, bank_verified_at, bsb_masked, account_number_last4 FROM payroll_profiles WHERE user_id = $1', [userId]);
  return rows[0] || null;
}

module.exports = {
  upsertCandidate, listCandidates, revealCandidate,
  upsertResolved, listResolved, getResolvedRaw, revealResolved, resolveByOwner, markFieldsApplied,
  listReturns, setDocumentMatch, assignDocumentToItem, markItemReturned, setItemVerification,
  attachOriginal, upsertCredentialByType, upsertIdentity, upsertVehicle, getVehicle, setEmploymentPay,
  approvePayroll, getPayrollApproval,
};
