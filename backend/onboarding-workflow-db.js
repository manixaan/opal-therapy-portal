'use strict';

/**
 * DATA ACCESS for the onboarding paper round-trip (migration 038).
 *
 * Separate from onboarding-db.js only because that file is already the whole
 * of 034 and this is a self-contained addition — starter packs, email
 * dispatches, returned documents and extraction proposals. Everything shared
 * (the pool, the sanitisers, withTransaction, the crypto helpers) is imported
 * from there rather than re-implemented, so there is exactly one connection
 * pool and one definition of `str()`.
 *
 * ── THE RULE THIS FILE EXISTS TO ENFORCE ───────────────────────────────────
 * A sensitive extracted value is written encrypted and read masked, and there
 * is no function here that returns one in clear. `listExtractedFields` builds
 * its output from an EXPLICIT column list, never a snake-to-camel mapper: an
 * auto-mapper would happily expose `value_encrypted` the first time somebody
 * added a column, and would do it silently. The one function that decrypts —
 * `revealFieldValue` — exists solely so the apply step can write the real
 * value into payroll_profiles, and it is never wired to a response.
 */

const crypto = require('crypto');
const odb = require('./onboarding-db');
const { encryptField, decryptField, isEncryptionConfigured } = require('./onboarding-crypto');
const extraction = require('./onboarding-extraction');
const log = require('./logger').createLogger('onboarding-workflow-db');

const { pool, isUuid, str, withTransaction } = odb;

/** sha256 hex — the only form in which a download token is ever stored. */
function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

// ═════════════════════════════════════════════════════════════════════════════
//  STARTER PACKS
// ═════════════════════════════════════════════════════════════════════════════

/** The live pack for an assignment, or null. At most one exists (unique index). */
async function getLiveStarterPack(assignmentId, q = pool) {
  if (!isUuid(assignmentId)) return null;
  const { rows } = await q.query(
    `SELECT * FROM onboarding_starter_packs
      WHERE assignment_id = $1 AND superseded_at IS NULL AND status <> 'failed'
      ORDER BY generated_at DESC LIMIT 1`,
    [assignmentId]
  );
  return rows[0] || null;
}

async function getStarterPack(id, q = pool) {
  if (!isUuid(id)) return null;
  const { rows } = await q.query('SELECT * FROM onboarding_starter_packs WHERE id = $1', [id]);
  return rows[0] || null;
}

async function listStarterPacks(assignmentId, q = pool) {
  if (!isUuid(assignmentId)) return [];
  const { rows } = await q.query(
    `SELECT id, package_version, document_count, file_name, file_size_bytes, file_sha256,
            status, error_reason, generated_at, generated_by, superseded_at,
            download_count, last_downloaded_at, omissions
       FROM onboarding_starter_packs
      WHERE assignment_id = $1
      ORDER BY generated_at DESC`,
    [assignmentId]
  );
  return rows;
}

/**
 * Store a generated pack, superseding any previous live one.
 *
 * Both statements run in one transaction so the unique index on
 * (assignment_id) WHERE superseded_at IS NULL can never see two live rows —
 * which is what makes a double-clicked Generate safe.
 */
async function createStarterPack({
  organisationId, assignmentId, packageId, packageVersionId, packageVersion,
  manifest, omissions, fileName, buffer, generatedBy,
}, q = pool) {
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const { getBackend, getBackendName } = require('./storage');
  const backendName = getBackendName();

  const run = async (client) => {
    await client.query(
      `UPDATE onboarding_starter_packs SET superseded_at = NOW()
        WHERE assignment_id = $1 AND superseded_at IS NULL`,
      [assignmentId]
    );

    const { rows } = await client.query(
      `INSERT INTO onboarding_starter_packs
         (organisation_id, assignment_id, package_id, package_version_id, package_version,
          manifest, omissions, document_count, file_name, file_mime, file_size_bytes,
          file_sha256, storage_backend, file_data, status, generated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'application/zip',$10,$11,$12,$13,'ready',$14)
       RETURNING *`,
      [
        organisationId, assignmentId, packageId, packageVersionId, packageVersion || 1,
        JSON.stringify(manifest || []), JSON.stringify(omissions || []),
        (manifest || []).length, str(fileName, 255), buffer.length, sha256,
        backendName === 'db' ? 'db' : backendName,
        backendName === 'db' ? buffer.toString('base64') : null,
        generatedBy || null,
      ]
    );
    const row = rows[0];

    // Off-database backends hold the bytes under a key; the row records where.
    // Written after the INSERT so the key can name the pack's own id, and
    // rolled back with it if the put fails — no row ever survives pointing at
    // bytes that were never stored.
    if (backendName !== 'db') {
      const { backend, storageKey } = await getBackend().put({
        userId: 'onboarding-starter-pack',
        docId: row.id,
        fileName: row.file_name || 'starter-pack.zip',
        mime: 'application/zip',
        base64: buffer.toString('base64'),
      });
      await client.query(
        'UPDATE onboarding_starter_packs SET storage_backend = $2, storage_key = $3 WHERE id = $1',
        [row.id, backend, storageKey]
      );
      row.storage_backend = backend;
      row.storage_key = storageKey;
    }
    return row;
  };

  return q === pool ? withTransaction(run) : run(q);
}

/** Read a pack's bytes back through whichever backend holds them. */
async function readStarterPackBytes(pack) {
  if (!pack) return null;
  if (pack.storage_backend === 'db' || !pack.storage_key) {
    return pack.file_data ? Buffer.from(pack.file_data, 'base64') : null;
  }
  const { getBackend } = require('./storage');
  const out = await getBackend(pack.storage_backend).get({
    backend: pack.storage_backend,
    storageKey: pack.storage_key,
    fileData: pack.file_data,
  });
  return out && out.base64 ? Buffer.from(out.base64, 'base64') : null;
}

/**
 * Mint a download token for the secure-link fallback.
 *
 * The raw token is returned once, to be put in the link, and only its sha256
 * is stored — so a database read cannot produce a working link. Mirrors the
 * signing-session pattern rather than user_invites, which stores its token
 * raw.
 */
async function issueDownloadToken(packId, { days = 21 } = {}, q = pool) {
  const token = crypto.randomBytes(32).toString('base64url');
  const ttl = Math.max(1, Math.min(Number(days) || 21, 90));
  await q.query(
    `UPDATE onboarding_starter_packs
        SET download_token_hash = $2,
            download_token_expires_at = NOW() + ($3 || ' days')::INTERVAL
      WHERE id = $1`,
    [packId, hashToken(token), String(ttl)]
  );
  return token;
}

/**
 * Resolve a download token to its pack, or null.
 *
 * Constant work regardless of outcome is not attempted here — the token is a
 * 256-bit random value looked up by an indexed hash, so there is no guessable
 * space for a timing signal to narrow.
 */
async function redeemDownloadToken(token, q = pool) {
  if (!token || typeof token !== 'string' || token.length > 200) return null;
  const { rows } = await q.query(
    `SELECT * FROM onboarding_starter_packs
      WHERE download_token_hash = $1
        AND download_token_expires_at IS NOT NULL
        AND download_token_expires_at > NOW()
        AND status = 'ready'
      LIMIT 1`,
    [hashToken(token)]
  );
  return rows[0] || null;
}

async function recordDownload(packId, q = pool) {
  await q.query(
    `UPDATE onboarding_starter_packs
        SET download_count = download_count + 1, last_downloaded_at = NOW()
      WHERE id = $1`,
    [packId]
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  EMAIL DISPATCHES
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Record an email attempt — sent, prepared, skipped or failed.
 *
 * Called on EVERY outcome. A failure that leaves no row is indistinguishable
 * from an email nobody tried to send, which is exactly the ambiguity an Owner
 * asking "did Jane get her pack?" cannot afford.
 */
async function recordDispatch({
  organisationId, assignmentId, starterPackId, kind, toEmail, subject, method,
  status, attachmentIncluded, attachmentBytes, downloadLinkUsed,
  providerMessageId, providerDraftId, webLink, errorReason, requestedBy,
}, q = pool) {
  const { rows: prior } = await q.query(
    'SELECT COALESCE(MAX(attempt), 0) AS n FROM onboarding_email_dispatches WHERE assignment_id = $1 AND kind = $2',
    [assignmentId, kind]
  );
  const attempt = Number(prior[0]?.n || 0) + 1;

  const { rows } = await q.query(
    `INSERT INTO onboarding_email_dispatches
       (organisation_id, assignment_id, starter_pack_id, kind, to_email, subject, method,
        status, attachment_included, attachment_bytes, download_link_used,
        provider_message_id, provider_draft_id, web_link, error_reason, attempt, requested_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING *`,
    [
      organisationId, assignmentId, starterPackId || null, kind,
      str(toEmail, 255), str(subject, 500), method || 'smtp', status || 'prepared',
      attachmentIncluded === true, attachmentBytes || null, downloadLinkUsed === true,
      str(providerMessageId, 500), str(providerDraftId, 500), webLink || null,
      str(errorReason, 500), attempt, requestedBy || null,
    ]
  );
  return rows[0];
}

async function listDispatches(assignmentId, q = pool) {
  if (!isUuid(assignmentId)) return [];
  const { rows } = await q.query(
    `SELECT id, kind, to_email, subject, method, status, attachment_included,
            attachment_bytes, download_link_used, web_link, error_reason,
            attempt, created_at, requested_by
       FROM onboarding_email_dispatches
      WHERE assignment_id = $1
      ORDER BY created_at DESC LIMIT 50`,
    [assignmentId]
  );
  return rows;
}

// ═════════════════════════════════════════════════════════════════════════════
//  RETURNED DOCUMENTS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Store one returned document.
 *
 * Returns { row, duplicate }. A file whose sha256 already exists on this
 * assignment is NOT stored twice — the existing row comes back with
 * duplicate:true, which is what makes a retried upload harmless and a
 * double-click a no-op rather than two copies of the same signed form.
 */
async function createReturnedDocument({
  organisationId, assignmentId, title, fileName, fileMime, buffer, uploadedBy,
  pageCount, textStatus, textChars,
}, q = pool) {
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

  const { rows: existing } = await q.query(
    `SELECT * FROM onboarding_returned_documents
      WHERE assignment_id = $1 AND file_sha256 = $2 AND status = 'active' LIMIT 1`,
    [assignmentId, sha256]
  );
  if (existing[0]) return { row: existing[0], duplicate: true };

  const { getBackend, getBackendName } = require('./storage');
  const backendName = getBackendName();

  const run = async (client) => {
    const { rows } = await client.query(
      `INSERT INTO onboarding_returned_documents
         (organisation_id, assignment_id, title, file_name, file_mime, file_size_bytes,
          file_sha256, storage_backend, file_data, page_count, text_status, text_chars,
          uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        organisationId, assignmentId, str(title, 250), str(fileName, 255),
        str(fileMime, 100), buffer.length, sha256,
        backendName === 'db' ? 'db' : backendName,
        backendName === 'db' ? buffer.toString('base64') : null,
        pageCount || null, textStatus || 'pending', textChars || null,
        uploadedBy || null,
      ]
    );
    const row = rows[0];

    if (backendName !== 'db') {
      const { backend, storageKey } = await getBackend().put({
        userId: 'onboarding-returned',
        docId: row.id,
        fileName: row.file_name,
        mime: row.file_mime,
        base64: buffer.toString('base64'),
      });
      await client.query(
        'UPDATE onboarding_returned_documents SET storage_backend = $2, storage_key = $3 WHERE id = $1',
        [row.id, backend, storageKey]
      );
      row.storage_backend = backend;
      row.storage_key = storageKey;
    }
    return row;
  };

  const row = q === pool ? await withTransaction(run) : await run(q);
  return { row, duplicate: false };
}

async function listReturnedDocuments(assignmentId, { includeArchived = false } = {}, q = pool) {
  if (!isUuid(assignmentId)) return [];
  const { rows } = await q.query(
    `SELECT id, title, file_name, file_mime, file_size_bytes, file_sha256,
            page_count, text_status, text_chars, status, uploaded_at, uploaded_by,
            archived_at
       FROM onboarding_returned_documents
      WHERE assignment_id = $1 ${includeArchived ? '' : "AND status = 'active'"}
      ORDER BY uploaded_at ASC`,
    [assignmentId]
  );
  return rows;
}

async function getReturnedDocument(assignmentId, id, q = pool) {
  if (!isUuid(assignmentId) || !isUuid(id)) return null;
  const { rows } = await q.query(
    'SELECT * FROM onboarding_returned_documents WHERE assignment_id = $1 AND id = $2',
    [assignmentId, id]
  );
  return rows[0] || null;
}

async function readReturnedDocumentBytes(doc) {
  if (!doc) return null;
  if (doc.storage_backend === 'db' || !doc.storage_key) {
    return doc.file_data ? Buffer.from(doc.file_data, 'base64') : null;
  }
  const { getBackend } = require('./storage');
  const out = await getBackend(doc.storage_backend).get({
    backend: doc.storage_backend, storageKey: doc.storage_key, fileData: doc.file_data,
  });
  return out && out.base64 ? Buffer.from(out.base64, 'base64') : null;
}

async function setReturnedDocumentText(id, { textStatus, textChars, pageCount }, q = pool) {
  await q.query(
    `UPDATE onboarding_returned_documents
        SET text_status = $2, text_chars = $3,
            page_count = COALESCE($4, page_count)
      WHERE id = $1`,
    [id, textStatus, textChars || null, pageCount || null]
  );
}

/**
 * Archive rather than delete.
 *
 * A returned form is employment evidence. Removing the row would destroy the
 * only record that the practice ever received it, which is the opposite of
 * what an HR archive is for. Archiving frees the sha256 for a corrected
 * re-upload while keeping the original addressable.
 */
async function archiveReturnedDocument(assignmentId, id, actorId, q = pool) {
  const { rows } = await q.query(
    `UPDATE onboarding_returned_documents
        SET status = 'archived', archived_at = NOW(), archived_by = $3
      WHERE assignment_id = $1 AND id = $2 AND status = 'active'
      RETURNING id`,
    [assignmentId, id, actorId || null]
  );
  return !!rows[0];
}

// ═════════════════════════════════════════════════════════════════════════════
//  EXTRACTION RUNS
// ═════════════════════════════════════════════════════════════════════════════

async function getLiveRun(assignmentId, q = pool) {
  if (!isUuid(assignmentId)) return null;
  const { rows } = await q.query(
    `SELECT * FROM onboarding_extraction_runs
      WHERE assignment_id = $1 AND status IN ('queued', 'running')
      ORDER BY created_at DESC LIMIT 1`,
    [assignmentId]
  );
  return rows[0] || null;
}

async function getLatestRun(assignmentId, q = pool) {
  if (!isUuid(assignmentId)) return null;
  const { rows } = await q.query(
    `SELECT * FROM onboarding_extraction_runs
      WHERE assignment_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [assignmentId]
  );
  return rows[0] || null;
}

/**
 * Start a run, or return the one already in flight.
 *
 * The unique partial index does the arbitration: two simultaneous requests
 * both attempt the INSERT and exactly one wins, so "already running" is a fact
 * established by the database rather than a race between two SELECTs.
 */
async function startRun({ organisationId, assignmentId, documentCount, requestedBy }, q = pool) {
  try {
    const { rows } = await q.query(
      `INSERT INTO onboarding_extraction_runs
         (organisation_id, assignment_id, status, document_count, requested_by, started_at)
       VALUES ($1,$2,'running',$3,$4,NOW())
       RETURNING *`,
      [organisationId, assignmentId, documentCount || 0, requestedBy || null]
    );
    return { run: rows[0], joined: false };
  } catch (err) {
    if (err.code === '23505') {
      const live = await getLiveRun(assignmentId, q);
      if (live) return { run: live, joined: true };
    }
    throw err;
  }
}

async function finishRun(id, {
  status, readableCount, fieldCount, modelKey, provider, aiAuditId, errorReason,
}, q = pool) {
  const { rows } = await q.query(
    `UPDATE onboarding_extraction_runs
        SET status = $2, readable_count = COALESCE($3, readable_count),
            field_count = COALESCE($4, field_count),
            model_key = COALESCE($5, model_key), provider = COALESCE($6, provider),
            ai_audit_id = COALESCE($7, ai_audit_id),
            error_reason = $8, finished_at = NOW()
      WHERE id = $1 RETURNING *`,
    [
      id, status, readableCount ?? null, fieldCount ?? null,
      str(modelKey, 60), str(provider, 30),
      isUuid(aiAuditId) ? aiAuditId : null, str(errorReason, 200),
    ]
  );
  return rows[0] || null;
}

// ═════════════════════════════════════════════════════════════════════════════
//  EXTRACTED FIELDS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Store one proposal.
 *
 * ON CONFLICT deliberately refuses to overwrite a value a human has already
 * touched: `WHERE ... status = 'proposed' AND value_source = 'extraction'`. A
 * second extraction run must never undo the Owner's correction, and this is
 * the only place that rule can be enforced without a race.
 */
async function upsertProposedField({
  organisationId, assignmentId, runId, field,
}, q = pool) {
  const def = extraction.FIELDS[field.key];
  if (!def) return null;
  const sensitive = def.sensitive === true;

  if (sensitive && !isEncryptionConfigured()) {
    // Refusing beats storing a bank account in clear. The caller turns this
    // into the same 503 the release route already uses.
    const err = new Error('ENCRYPTION_UNAVAILABLE');
    err.code = 'ENCRYPTION_UNAVAILABLE';
    throw err;
  }

  const { rows } = await q.query(
    `INSERT INTO onboarding_extracted_fields
       (organisation_id, assignment_id, run_id, field_group, field_key, label,
        sensitivity, value_text, value_encrypted, value_masked, confidence,
        source_document_id, source_label, source_page, status, value_source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'proposed','extraction')
     ON CONFLICT (assignment_id, field_key) DO UPDATE SET
       run_id = EXCLUDED.run_id,
       value_text = EXCLUDED.value_text,
       value_encrypted = EXCLUDED.value_encrypted,
       value_masked = EXCLUDED.value_masked,
       confidence = EXCLUDED.confidence,
       source_document_id = EXCLUDED.source_document_id,
       source_label = EXCLUDED.source_label,
       source_page = EXCLUDED.source_page,
       updated_at = NOW()
     WHERE onboarding_extracted_fields.status = 'proposed'
       AND onboarding_extracted_fields.value_source = 'extraction'
     RETURNING *`,
    [
      organisationId, assignmentId, runId, def.group, field.key, def.label,
      sensitive ? 'sensitive' : 'standard',
      sensitive ? null : str(field.value, 300),
      sensitive ? encryptField(field.value) : null,
      sensitive ? extraction.maskValue(field.key, field.value) : null,
      field.confidence || 'low',
      isUuid(field.sourceDocumentId) ? field.sourceDocumentId : null,
      str(field.sourceLabel, 250),
      Number.isInteger(field.sourcePage) ? field.sourcePage : null,
    ]
  );
  // No row means the conflict target existed and was human-owned. That is a
  // successful no-op, not a failure.
  return rows[0] || null;
}

/**
 * Every proposal for an assignment, in a form that is SAFE TO SEND.
 *
 * The column list is explicit and `value_encrypted` is not in it. That is the
 * whole point of writing this out longhand instead of `SELECT *` plus a
 * mapper: the safe shape is visible in the source, and a future column has to
 * be added here deliberately before it can ever reach a response.
 *
 * @param {object} caps  { payroll:boolean, sensitiveIdentity:boolean } — the
 *   reader's permission tiers. A field they may not see is returned as a
 *   placeholder rather than omitted, so the review UI can still say "there is
 *   a bank account on file, and you cannot see it".
 */
async function listExtractedFields(assignmentId, caps = {}, q = pool) {
  if (!isUuid(assignmentId)) return [];
  const { rows } = await q.query(
    `SELECT f.id, f.field_group, f.field_key, f.label, f.sensitivity,
            f.value_text, f.value_masked, f.confidence,
            f.source_document_id, f.source_label, f.source_page,
            f.status, f.reviewed, f.reviewed_by, f.reviewed_at, f.value_source,
            f.applied_at, f.applied_to, f.created_at, f.updated_at,
            d.file_name AS source_file_name
       FROM onboarding_extracted_fields f
       LEFT JOIN onboarding_returned_documents d ON d.id = f.source_document_id
      WHERE f.assignment_id = $1
      ORDER BY f.field_group, f.field_key`,
    [assignmentId]
  );

  return rows.map((r) => {
    const needed = extraction.requiredPermissionFor(r.field_key);
    const permitted = needed === 'onboarding.payroll' ? caps.payroll === true
      : needed === 'onboarding.sensitive_identity' ? caps.sensitiveIdentity === true
        : true;

    return {
      id: r.id,
      group: r.field_group,
      groupLabel: extraction.GROUP_LABELS[r.field_group] || r.field_group,
      key: r.field_key,
      label: r.label,
      sensitive: r.sensitivity === 'sensitive',
      // Masked for a sensitive field, hidden entirely without the tier.
      value: permitted ? (r.sensitivity === 'sensitive' ? r.value_masked : r.value_text) : null,
      visible: permitted,
      requiredPermission: needed,
      confidence: r.confidence,
      source: {
        documentId: r.source_document_id,
        label: r.source_label || r.source_file_name || null,
        page: r.source_page,
      },
      status: r.status,
      reviewed: r.reviewed,
      reviewedAt: r.reviewed_at,
      valueSource: r.value_source,
      appliedAt: r.applied_at,
      appliedTo: r.applied_to,
    };
  });
}

async function getExtractedField(assignmentId, fieldId, q = pool) {
  if (!isUuid(assignmentId) || !isUuid(fieldId)) return null;
  const { rows } = await q.query(
    'SELECT * FROM onboarding_extracted_fields WHERE assignment_id = $1 AND id = $2',
    [assignmentId, fieldId]
  );
  return rows[0] || null;
}

/**
 * The ONE function that returns a sensitive value in clear.
 *
 * Used only by the apply step, which writes it straight into payroll_profiles
 * through the existing encrypted writers. It is deliberately not reachable
 * from any route: nothing here serialises its return value into a response.
 */
function revealFieldValue(row) {
  if (!row) return null;
  if (row.sensitivity !== 'sensitive') return row.value_text;
  if (!row.value_encrypted) return null;
  try {
    return decryptField(row.value_encrypted);
  } catch (err) {
    log.error('extracted value could not be decrypted', { fieldId: row.id });
    return null;
  }
}

/** Decision verb -> the past-tense event name written to the history table. */
const EVENT_FOR_DECISION = Object.freeze({
  accept: 'field_accepted',
  correct: 'field_corrected',
  reject: 'field_rejected',
});

/** Record a decision on one field, and append the history entry. */
async function reviewField(assignmentId, fieldId, {
  decision, value, actorUserId, actorRole,
}, q = pool) {
  const existing = await getExtractedField(assignmentId, fieldId, q);
  if (!existing) return null;

  const sensitive = existing.sensitivity === 'sensitive';
  let next = { status: existing.status, valueText: existing.value_text, encrypted: existing.value_encrypted, masked: existing.value_masked };

  if (decision === 'accept') {
    next.status = 'accepted';
  } else if (decision === 'reject') {
    next.status = 'rejected';
  } else if (decision === 'correct') {
    const normalised = extraction.normaliseValue(existing.field_key, value);
    if (normalised === null) {
      const err = new Error('INVALID_VALUE');
      err.code = 'INVALID_VALUE';
      err.field = existing.field_key;
      throw err;
    }
    if (sensitive && !isEncryptionConfigured()) {
      const err = new Error('ENCRYPTION_UNAVAILABLE');
      err.code = 'ENCRYPTION_UNAVAILABLE';
      throw err;
    }
    next = {
      status: 'corrected',
      valueText: sensitive ? null : normalised,
      encrypted: sensitive ? encryptField(normalised) : null,
      masked: sensitive ? extraction.maskValue(existing.field_key, normalised) : null,
    };
  } else {
    const err = new Error('UNKNOWN_DECISION');
    err.code = 'UNKNOWN_DECISION';
    throw err;
  }

  const { rows } = await q.query(
    // $3 is cast: Postgres deduces varchar from `status = $3` and text from the
    // CASE comparison below, then refuses the statement for the inconsistency.
    // The same trap onboarding-employee-routes documents on its own UPDATE.
    `UPDATE onboarding_extracted_fields
        SET status = $3::text, value_text = $4, value_encrypted = $5, value_masked = $6,
            reviewed = TRUE, reviewed_by = $7, reviewed_at = NOW(),
            value_source = CASE WHEN $3::text = 'corrected' THEN $8 ELSE value_source END,
            updated_at = NOW()
      WHERE assignment_id = $1 AND id = $2
      RETURNING *`,
    [
      assignmentId, fieldId, next.status, next.valueText, next.encrypted, next.masked,
      actorUserId || null,
      actorRole === 'employee' ? 'employee' : 'owner',
    ]
  );

  await recordFieldEvent(q, {
    fieldId,
    assignmentId,
    actorUserId,
    actorRole,
    eventType: EVENT_FOR_DECISION[decision],
    fromStatus: existing.status,
    toStatus: next.status,
  });

  return rows[0] || null;
}

/** Append-only field history. Never carries a value — see migration 038. */
async function recordFieldEvent(q, {
  fieldId, assignmentId, actorUserId, actorRole, eventType, fromStatus, toStatus, note,
}) {
  try {
    await q.query(
      `INSERT INTO onboarding_extracted_field_events
         (field_id, assignment_id, actor_user_id, actor_role, event_type,
          from_status, to_status, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        fieldId, assignmentId, actorUserId || null, str(actorRole, 20),
        str(eventType, 40), str(fromStatus, 20), str(toStatus, 20), str(note, 500),
      ]
    );
  } catch (err) {
    log.warn('field event write failed', { error: err, eventType });
  }
}

async function listFieldEvents(assignmentId, q = pool) {
  if (!isUuid(assignmentId)) return [];
  const { rows } = await q.query(
    `SELECT e.*, f.field_key, f.label, u.name AS actor_name
       FROM onboarding_extracted_field_events e
       JOIN onboarding_extracted_fields f ON f.id = e.field_id
       LEFT JOIN users u ON u.id = e.actor_user_id
      WHERE e.assignment_id = $1
      ORDER BY e.created_at DESC LIMIT 200`,
    [assignmentId]
  );
  return rows;
}

/** Mark a field as written through to the canonical employee record. */
async function markApplied(fieldId, target, q = pool) {
  await q.query(
    `UPDATE onboarding_extracted_fields
        SET status = 'applied', applied_at = NOW(), applied_to = $2, updated_at = NOW()
      WHERE id = $1`,
    [fieldId, str(target, 60)]
  );
}

/**
 * A summary the Owner's review screen reads directly.
 *
 * Counts only — no values — so this is safe to compute for a reader who holds
 * no sensitive tier at all.
 */
async function reviewSummary(assignmentId, q = pool) {
  if (!isUuid(assignmentId)) return null;
  const { rows } = await q.query(
    `SELECT field_group,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'proposed')::int AS proposed,
            COUNT(*) FILTER (WHERE status IN ('accepted', 'corrected'))::int AS confirmed,
            COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected,
            COUNT(*) FILTER (WHERE status = 'applied')::int AS applied,
            COUNT(*) FILTER (WHERE confidence = 'low')::int AS low_confidence
       FROM onboarding_extracted_fields
      WHERE assignment_id = $1
      GROUP BY field_group`,
    [assignmentId]
  );
  const byGroup = {};
  let total = 0; let needsReview = 0; let confirmed = 0;
  for (const r of rows) {
    byGroup[r.field_group] = {
      label: extraction.GROUP_LABELS[r.field_group] || r.field_group,
      total: r.total,
      proposed: r.proposed,
      confirmed: r.confirmed,
      rejected: r.rejected,
      applied: r.applied,
      lowConfidence: r.low_confidence,
    };
    total += r.total;
    needsReview += r.proposed;
    confirmed += r.confirmed + r.applied;
  }
  return { total, needsReview, confirmed, byGroup };
}

/**
 * The accepted/corrected values, in clear, grouped by where they must be
 * written. Used only by the apply step.
 */
async function collectApplicable(assignmentId, q = pool) {
  const { rows } = await q.query(
    `SELECT * FROM onboarding_extracted_fields
      WHERE assignment_id = $1 AND status IN ('accepted', 'corrected')`,
    [assignmentId]
  );

  const byTarget = { personal: {}, payroll: {}, employment: {} };
  const applied = [];

  for (const row of rows) {
    const def = extraction.FIELDS[row.field_key];
    if (!def || !def.target) continue;
    const value = revealFieldValue(row);
    if (value === null || value === undefined || value === '') continue;
    byTarget[def.target] = byTarget[def.target] || {};
    byTarget[def.target][def.column] = value;
    applied.push({ id: row.id, key: row.field_key, target: def.target, column: def.column });
  }
  return { byTarget, applied };
}

module.exports = {
  hashToken,
  // starter packs
  getLiveStarterPack,
  getStarterPack,
  listStarterPacks,
  createStarterPack,
  readStarterPackBytes,
  issueDownloadToken,
  redeemDownloadToken,
  recordDownload,
  // dispatches
  recordDispatch,
  listDispatches,
  // returned documents
  createReturnedDocument,
  listReturnedDocuments,
  getReturnedDocument,
  readReturnedDocumentBytes,
  setReturnedDocumentText,
  archiveReturnedDocument,
  // extraction
  getLiveRun,
  getLatestRun,
  startRun,
  finishRun,
  upsertProposedField,
  listExtractedFields,
  getExtractedField,
  revealFieldValue,
  reviewField,
  recordFieldEvent,
  listFieldEvents,
  markApplied,
  reviewSummary,
  collectApplicable,
};
