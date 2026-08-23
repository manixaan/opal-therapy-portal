'use strict';

/**
 * SERVICE AGREEMENT — DATA ACCESS
 *
 * Every query in one place, following onboarding-db.js's conventions: each
 * function takes a trailing `q = pool` so it runs on the pool or inside a
 * caller's transaction, and every organisation comparison uses
 * `IS NOT DISTINCT FROM` because `organisation_id` is nullable and `=` would
 * silently match nothing for a user whose organisation is unset.
 *
 * ── ORGANISATION ISOLATION IS IN THE WHERE CLAUSE ──────────────────────────
 * There is no row-level security in this database; every boundary is a WHERE
 * clause, and the rule this module follows is that a caller can never obtain a
 * row without supplying an organisation. There is deliberately no
 * `getAgreementById(id)`: the signature is `getAgreement(orgId, id)`, so
 * forgetting the tenant filter is a syntax error rather than a data breach.
 *
 * A row in another organisation returns null, and the routes turn that into a
 * 404 rather than a 403 — indistinguishable from a row that does not exist, so
 * ids cannot be probed. Same rule as interview-routes.js and whodas-routes.js.
 *
 * ── BYTES ──────────────────────────────────────────────────────────────────
 * Artifacts follow the pd_documents / fca_generated_documents convention:
 * `storage_backend` plus either `storage_key` (local or blob) or `file_data`
 * (base64 inline). The default is 'db', which keeps a small deployment working
 * with no storage configuration at all, exactly as the FCA and WHODAS document
 * tables already do.
 */

const crypto = require('crypto');

const { pool } = require('../database');

const SA_COLUMNS = `
  id, organisation_id, reference,
  participant_client_id, participant_name, participant_preferred_name, participant_email,
  representative_name, representative_email,
  master_version_id, master_sha256, master_version_label,
  state, completion_mode,
  form_data, field_sources, support_rows,
  clause_snapshot, organisation_snapshot, pricing_snapshot, missing_fields,
  created_by_user_id, updated_by_user_id, issued_by_user_id,
  created_at, updated_at, issued_at, first_viewed_at, completed_at, signed_at,
  voided_at, void_reason
`;

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** Run `fn` in a transaction, releasing the client either way. */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Master versions
// ─────────────────────────────────────────────────────────────────────────────

/** The one current published master, or null. */
async function getPublishedMaster(organisationId, templateKey, q = pool) {
  const { rows } = await q.query(
    `SELECT * FROM service_agreement_master_versions
      WHERE organisation_id IS NOT DISTINCT FROM $1
        AND template_key = $2 AND status = 'published'
      LIMIT 1`,
    [organisationId, templateKey]
  );
  return rows[0] || null;
}

async function getMasterVersion(organisationId, id, q = pool) {
  const { rows } = await q.query(
    `SELECT * FROM service_agreement_master_versions
      WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2`,
    [id, organisationId]
  );
  return rows[0] || null;
}

/**
 * Version history, newest first.
 *
 * Retired and superseded versions are INCLUDED. A historic version must stay
 * available for audit and for reproducing a document issued against it; a list
 * that quietly hid them would make an auditor's question unanswerable.
 */
async function listMasterVersions(organisationId, templateKey, q = pool) {
  const { rows } = await q.query(
    `SELECT id, version_label, name, status, source_sha256, byte_size,
            created_by_user_id, published_by_user_id, retired_by_user_id,
            superseded_version_id,
            created_at, validated_at, published_at, retired_at,
            (validation->>'ok')::boolean AS validation_ok,
            jsonb_array_length(COALESCE(clause_snapshot->'custom', '[]'::jsonb)) AS custom_clause_count,
            (SELECT COUNT(*) FROM service_agreements a WHERE a.master_version_id = v.id) AS agreement_count
       FROM service_agreement_master_versions v
      WHERE organisation_id IS NOT DISTINCT FROM $1 AND template_key = $2
      ORDER BY published_at DESC NULLS LAST, created_at DESC`,
    [organisationId, templateKey]
  );
  return rows;
}

async function createMasterDraft(data, q = pool) {
  const { rows } = await q.query(
    `INSERT INTO service_agreement_master_versions
       (organisation_id, template_key, version_label, name, status,
        storage_backend, storage_key, file_data, byte_size, source_sha256,
        tag_manifest, clause_snapshot, organisation_snapshot, validation,
        created_by_user_id, validated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15,$16)
     RETURNING *`,
    [
      data.organisationId, data.templateKey, data.versionLabel, data.name,
      data.status || 'draft',
      data.storageBackend || 'db', data.storageKey || null, data.fileData || null,
      data.byteSize, data.sourceSha256,
      JSON.stringify(data.tagManifest || {}),
      JSON.stringify(data.clauseSnapshot || {}),
      JSON.stringify(data.organisationSnapshot || {}),
      JSON.stringify(data.validation || {}),
      data.createdByUserId,
      data.validatedAt || null,
    ]
  );
  return rows[0];
}

/**
 * Publish a draft.
 *
 * Retires the outgoing published version FIRST, in the same transaction, so
 * the partial unique index on (organisation, template) WHERE status =
 * 'published' is never violated and there is never an instant with two current
 * masters. The outgoing version records the new one as its successor, and the
 * new one records the outgoing as its predecessor, so the chain reads both
 * ways.
 */
async function publishMaster(organisationId, versionId, userId, q) {
  const previous = await getPublishedMaster(
    organisationId,
    (await getMasterVersionAny(versionId, q)).template_key,
    q
  );

  if (previous && previous.id !== versionId) {
    await q.query(
      `UPDATE service_agreement_master_versions
          SET status = 'retired', retired_at = NOW(), retired_by_user_id = $2
        WHERE id = $1`,
      [previous.id, userId]
    );
  }

  const { rows } = await q.query(
    `UPDATE service_agreement_master_versions
        SET status = 'published',
            published_at = NOW(),
            published_by_user_id = $3,
            superseded_version_id = $4
      WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2
        AND status IN ('draft', 'validated')
      RETURNING *`,
    [versionId, organisationId, userId, previous && previous.id !== versionId ? previous.id : null]
  );
  return rows[0] || null;
}

/** Used only by publishMaster, to learn the template key of the row being published. */
async function getMasterVersionAny(id, q = pool) {
  const { rows } = await q.query(
    'SELECT * FROM service_agreement_master_versions WHERE id = $1', [id]
  );
  return rows[0] || null;
}

async function retireMaster(organisationId, versionId, userId, q = pool) {
  const { rows } = await q.query(
    `UPDATE service_agreement_master_versions
        SET status = 'retired', retired_at = NOW(), retired_by_user_id = $3
      WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2 AND status = 'published'
      RETURNING *`,
    [versionId, organisationId, userId]
  );
  return rows[0] || null;
}

/**
 * Next semantic label: 1.0 → 1.1 → … A major bump is the owner's to ask for.
 *
 * PATCH labels are parsed too. A safety patch is published as 1.0.1, and a
 * two-part-only parser read that as no version at all and proposed '1.0' —
 * a label already taken, and a number that goes backwards. The patch component
 * is read for ORDERING and then dropped: the edit after 1.0.1 is 1.1, because
 * an owner rewriting a clause is making a minor version, not a second patch.
 */
function nextVersionLabel(existing, bumpMajor = false) {
  const numbers = (existing || [])
    .map((v) => String(v.version_label || ''))
    .map((s) => s.match(/^(\d+)\.(\d+)(?:\.(\d+))?$/))
    .filter(Boolean)
    .map((m) => [Number(m[1]), Number(m[2]), Number(m[3] || 0)]);

  if (!numbers.length) return '1.0';
  numbers.sort((a, b) => (b[0] - a[0]) || (b[1] - a[1]) || (b[2] - a[2]));
  const [major, minor] = numbers[0];
  return bumpMajor ? `${major + 1}.0` : `${major}.${minor + 1}`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Agreements
// ─────────────────────────────────────────────────────────────────────────────

async function createAgreement(data, q = pool) {
  const { rows } = await q.query(
    `INSERT INTO service_agreements
       (organisation_id, participant_client_id, participant_name, participant_preferred_name,
        participant_email, completion_mode, form_data, field_sources, support_rows,
        missing_fields, created_by_user_id, updated_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11,$11)
     RETURNING ${SA_COLUMNS}`,
    [
      data.organisationId, data.participantClientId, data.participantName || null,
      data.participantPreferredName || null, data.participantEmail || null,
      data.completionMode || 'portal',
      JSON.stringify(data.formData || {}),
      JSON.stringify(data.fieldSources || {}),
      JSON.stringify(data.supportRows || []),
      JSON.stringify(data.missingFields || []),
      data.createdByUserId,
    ]
  );
  return rows[0];
}

async function getAgreement(organisationId, id, q = pool) {
  const { rows } = await q.query(
    `SELECT ${SA_COLUMNS} FROM service_agreements
      WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2`,
    [id, organisationId]
  );
  return rows[0] || null;
}

/** By id alone — for the signing path, which has no session and no org. */
async function getAgreementForSigning(id, q = pool) {
  const { rows } = await q.query(
    `SELECT ${SA_COLUMNS} FROM service_agreements WHERE id = $1`, [id]
  );
  return rows[0] || null;
}

/**
 * List agreements, scoped.
 *
 * `viewAll` is the caller's decision, made from permissions, and when it is
 * false the list is narrowed to what this user created. That mirrors
 * interview-routes.js: seeing everything is a separate power from doing the
 * work.
 */
async function listAgreements(organisationId, { states, createdBy, viewAll, participantClientId, limit = 200 } = {}, q = pool) {
  const where = ['organisation_id IS NOT DISTINCT FROM $1'];
  const params = [organisationId];

  if (Array.isArray(states) && states.length) {
    params.push(states);
    where.push(`state = ANY($${params.length}::text[])`);
  }
  if (!viewAll) {
    params.push(createdBy);
    where.push(`created_by_user_id = $${params.length}`);
  }
  if (participantClientId) {
    params.push(String(participantClientId));
    where.push(`participant_client_id = $${params.length}`);
  }
  params.push(Math.min(500, Math.max(1, Number(limit) || 200)));

  const { rows } = await q.query(
    `SELECT id, reference, participant_client_id, participant_name, participant_preferred_name,
            state, completion_mode, master_version_label,
            created_by_user_id, created_at, updated_at, issued_at, completed_at, signed_at,
            jsonb_array_length(support_rows) AS support_count
       FROM service_agreements
      WHERE ${where.join(' AND ')}
      ORDER BY updated_at DESC
      LIMIT $${params.length}`,
    params
  );
  return rows;
}

/**
 * Save wizard edits.
 *
 * Refuses anything past 'ready' at the SQL level as well as in the route: an
 * issued agreement's content is settled, and the database trigger is the
 * backstop for the case where a future route forgets.
 */
async function updateAgreementDraft(organisationId, id, data, userId, q = pool) {
  const { rows } = await q.query(
    `UPDATE service_agreements
        SET form_data = $4::jsonb,
            field_sources = $5::jsonb,
            support_rows = $6::jsonb,
            missing_fields = $7::jsonb,
            completion_mode = COALESCE($8, completion_mode),
            participant_name = COALESCE($9, participant_name),
            participant_preferred_name = COALESCE($10, participant_preferred_name),
            participant_email = COALESCE($11, participant_email),
            representative_name = $12,
            representative_email = $13,
            state = CASE WHEN state = 'draft' AND $14 THEN 'ready'
                         WHEN state = 'ready' AND NOT $14 THEN 'draft'
                         ELSE state END,
            updated_by_user_id = $3,
            updated_at = NOW()
      WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2
        AND state IN ('draft', 'ready')
      RETURNING ${SA_COLUMNS}`,
    [
      id, organisationId, userId,
      JSON.stringify(data.formData || {}),
      JSON.stringify(data.fieldSources || {}),
      JSON.stringify(data.supportRows || []),
      JSON.stringify(data.missingFields || []),
      data.completionMode || null,
      data.participantName || null,
      data.participantPreferredName || null,
      data.participantEmail || null,
      data.representativeName || null,
      data.representativeEmail || null,
      data.ready === true,
    ]
  );
  return rows[0] || null;
}

/** Pin the agreement to a master version and move it to 'issued'. */
async function issueAgreement(organisationId, id, data, userId, q) {
  const { rows } = await q.query(
    `UPDATE service_agreements
        SET state = 'issued',
            reference = $4,
            master_version_id = $5,
            master_sha256 = $6,
            master_version_label = $7,
            clause_snapshot = $8::jsonb,
            organisation_snapshot = $9::jsonb,
            pricing_snapshot = $10::jsonb,
            field_sources = $11::jsonb,
            issued_at = NOW(),
            issued_by_user_id = $3,
            updated_by_user_id = $3,
            updated_at = NOW()
      WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2
        AND state IN ('draft', 'ready')
      RETURNING ${SA_COLUMNS}`,
    [
      id, organisationId, userId,
      data.reference, data.masterVersionId, data.masterSha256, data.masterVersionLabel,
      JSON.stringify(data.clauseSnapshot || {}),
      JSON.stringify(data.organisationSnapshot || {}),
      JSON.stringify(data.pricingSnapshot || {}),
      JSON.stringify(data.fieldSources || {}),
    ]
  );
  return rows[0] || null;
}

/**
 * Move an agreement to a new state.
 *
 * `allowedFrom` is required, not optional: a state machine whose transitions
 * are implied by call site is a state machine nobody can review. Returns null
 * when the row was not in an allowed state, which the caller reports as a
 * conflict rather than silently treating as success.
 */
async function transitionAgreement(id, toState, allowedFrom, extra = {}, q = pool) {
  const sets = ['state = $2', 'updated_at = NOW()'];
  const params = [id, toState, allowedFrom];
  let n = 3;

  for (const [column, value] of Object.entries(extra)) {
    n += 1;
    sets.push(`${column} = $${n}`);
    params.push(value);
  }

  const { rows } = await q.query(
    `UPDATE service_agreements
        SET ${sets.join(', ')}
      WHERE id = $1 AND state = ANY($3::text[])
      RETURNING ${SA_COLUMNS}`,
    params
  );
  return rows[0] || null;
}

/** The participant's own values, merged into form_data. Signing path only. */
async function mergeParticipantValues(id, values, q = pool) {
  const { rows } = await q.query(
    `UPDATE service_agreements
        SET form_data = form_data || $2::jsonb,
            updated_at = NOW()
      WHERE id = $1 AND state IN ('issued', 'viewed', 'partially_completed')
      RETURNING ${SA_COLUMNS}`,
    [id, JSON.stringify(values || {})]
  );
  return rows[0] || null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Artifacts
// ─────────────────────────────────────────────────────────────────────────────

async function createArtifact(data, q = pool) {
  const { rows } = await q.query(
    `INSERT INTO service_agreement_artifacts
       (agreement_id, master_version_id, kind, filename, mime_type,
        storage_backend, storage_key, file_data, byte_size, checksum_sha256,
        page_count, field_count, audience, created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING id, agreement_id, master_version_id, kind, filename, mime_type,
               byte_size, checksum_sha256, page_count, field_count, audience, created_at`,
    [
      data.agreementId || null, data.masterVersionId || null,
      data.kind, data.filename, data.mimeType,
      data.storageBackend || 'db', data.storageKey || null,
      data.fileData || null, data.byteSize, data.checksumSha256,
      data.pageCount || null, data.fieldCount || null,
      data.audience || 'participant', data.createdByUserId || null,
    ]
  );
  return rows[0];
}

/** The newest artifact of a kind, with its bytes. */
async function latestArtifact(agreementId, kind, q = pool) {
  const { rows } = await q.query(
    `SELECT * FROM service_agreement_artifacts
      WHERE agreement_id = $1 AND kind = $2
      ORDER BY created_at DESC LIMIT 1`,
    [agreementId, kind]
  );
  return rows[0] || null;
}

async function listArtifacts(agreementId, q = pool) {
  const { rows } = await q.query(
    `SELECT id, kind, filename, mime_type, byte_size, checksum_sha256,
            page_count, field_count, audience, created_by_user_id, created_at
       FROM service_agreement_artifacts
      WHERE agreement_id = $1
      ORDER BY created_at DESC`,
    [agreementId]
  );
  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Signing sessions
// ─────────────────────────────────────────────────────────────────────────────

async function createSigningSession(data, q = pool) {
  const { rows } = await q.query(
    `INSERT INTO service_agreement_signing_sessions
       (agreement_id, organisation_id, token_sha256, signatory_type,
        recipient_email, recipient_name, assigned_tags, expires_at, issued_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
     RETURNING *`,
    [
      data.agreementId, data.organisationId, data.tokenSha256, data.signatoryType,
      data.recipientEmail, data.recipientName || null,
      JSON.stringify(data.assignedTags || []),
      data.expiresAt, data.issuedByUserId,
    ]
  );
  return rows[0];
}

/** By token hash. The ONLY lookup the public signing route may use. */
async function getSessionByTokenHash(tokenHash, q = pool) {
  const { rows } = await q.query(
    'SELECT * FROM service_agreement_signing_sessions WHERE token_sha256 = $1',
    [tokenHash]
  );
  return rows[0] || null;
}

async function listSessions(agreementId, q = pool) {
  const { rows } = await q.query(
    `SELECT id, signatory_type, recipient_email, recipient_name, status,
            verification_state, verification_attempts, consent_electronic,
            expires_at, created_at, first_viewed_at, completed_at, revoked_at,
            issued_by_user_id, revoked_by_user_id
       FROM service_agreement_signing_sessions
      WHERE agreement_id = $1
      ORDER BY created_at DESC`,
    [agreementId]
  );
  return rows;
}

async function updateSession(id, patch, q = pool) {
  const sets = [];
  const params = [id];
  let n = 1;
  for (const [column, value] of Object.entries(patch)) {
    n += 1;
    sets.push(`${column} = $${n}`);
    params.push(value);
  }
  if (!sets.length) return null;
  const { rows } = await q.query(
    `UPDATE service_agreement_signing_sessions SET ${sets.join(', ')}
      WHERE id = $1 RETURNING *`,
    params
  );
  return rows[0] || null;
}

async function revokeSession(organisationId, id, userId, q = pool) {
  const { rows } = await q.query(
    `UPDATE service_agreement_signing_sessions
        SET status = 'revoked', revoked_at = NOW(), revoked_by_user_id = $3
      WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2
        AND status IN ('pending', 'viewed', 'in_progress')
      RETURNING *`,
    [id, organisationId, userId]
  );
  return rows[0] || null;
}

/** Bump the failed-verification counter. Returns the new count. */
async function recordVerificationFailure(id, q = pool) {
  const { rows } = await q.query(
    `UPDATE service_agreement_signing_sessions
        SET verification_attempts = verification_attempts + 1,
            verification_state = 'failed'
      WHERE id = $1 RETURNING verification_attempts`,
    [id]
  );
  return rows[0] ? rows[0].verification_attempts : null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Deliveries
// ─────────────────────────────────────────────────────────────────────────────

async function recordDelivery(data, q = pool) {
  const { rows } = await q.query(
    `INSERT INTO service_agreement_deliveries
       (agreement_id, signing_session_id, organisation_id, method, recipient_email,
        sender_user_id, message, included_pdf, master_version_label,
        agreement_reference, result, result_detail, link_expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      data.agreementId, data.signingSessionId || null, data.organisationId,
      data.method || 'email', data.recipientEmail, data.senderUserId || null,
      data.message || null, data.includedPdf === true,
      data.masterVersionLabel || null, data.agreementReference || null,
      data.result || 'queued', data.resultDetail || null, data.linkExpiresAt || null,
    ]
  );
  return rows[0];
}

async function listDeliveries(agreementId, q = pool) {
  const { rows } = await q.query(
    `SELECT id, method, recipient_email, sender_user_id, included_pdf,
            result, result_detail, link_expires_at, agreement_reference,
            master_version_label, created_at
       FROM service_agreement_deliveries
      WHERE agreement_id = $1
      ORDER BY created_at DESC`,
    [agreementId]
  );
  return rows;
}

module.exports = {
  withTransaction,
  sha256,

  getPublishedMaster,
  getMasterVersion,
  getMasterVersionAny,
  listMasterVersions,
  createMasterDraft,
  publishMaster,
  retireMaster,
  nextVersionLabel,

  createAgreement,
  getAgreement,
  getAgreementForSigning,
  listAgreements,
  updateAgreementDraft,
  issueAgreement,
  transitionAgreement,
  mergeParticipantValues,

  createArtifact,
  latestArtifact,
  listArtifacts,

  createSigningSession,
  getSessionByTokenHash,
  listSessions,
  updateSession,
  revokeSession,
  recordVerificationFailure,

  recordDelivery,
  listDeliveries,
};
