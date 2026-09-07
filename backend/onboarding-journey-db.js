'use strict';

/**
 * DATA ACCESS for the three-stage journey (migration 047): letters of offer
 * and internal induction tasks. Everything shared — the pool, `str`, `isUuid`,
 * withTransaction — comes from onboarding-db.js so there is one pool and one
 * sanitiser.
 *
 * Files (the edited letter, the signed copy) go through backend/storage like
 * every other stored document; only the sha256 and size are ever listed.
 */

const crypto = require('crypto');
const odb = require('./onboarding-db');

const { pool, isUuid, str } = odb;

const OFFER_SELECT = `
  SELECT o.*, ab.name AS approved_by_name, sb.name AS sent_by_name
    FROM onboarding_offers o
    LEFT JOIN users ab ON ab.id = o.approved_by
    LEFT JOIN users sb ON sb.id = o.sent_by`;

// ═════════════════════════════════════════════════════════════════════════════
//  OFFERS
// ═════════════════════════════════════════════════════════════════════════════

/** The open offer (draft/approved/sent) or, failing that, the latest version. */
async function getCurrentOffer(assignmentId, q = pool) {
  if (!isUuid(assignmentId)) return null;
  const { rows } = await q.query(
    `${OFFER_SELECT}
      WHERE o.assignment_id = $1
      ORDER BY (o.status IN ('draft','approved','email_drafted','sent','signed_received')) DESC, o.version DESC
      LIMIT 1`, [assignmentId]
  );
  return rows[0] || null;
}

async function listOffers(assignmentId, q = pool) {
  if (!isUuid(assignmentId)) return [];
  const { rows } = await q.query(
    `${OFFER_SELECT} WHERE o.assignment_id = $1 ORDER BY o.version DESC`, [assignmentId]
  );
  return rows;
}

async function getOffer(assignmentId, offerId, q = pool) {
  if (!isUuid(assignmentId) || !isUuid(offerId)) return null;
  const { rows } = await q.query(
    `${OFFER_SELECT} WHERE o.id = $1 AND o.assignment_id = $2`, [offerId, assignmentId]
  );
  return rows[0] || null;
}

/** Current offers for many assignments at once, keyed by assignment id. */
async function mapCurrentOffers(assignmentIds, q = pool) {
  const ids = (assignmentIds || []).filter(isUuid);
  const out = new Map();
  if (!ids.length) return out;
  const { rows } = await q.query(
    `SELECT DISTINCT ON (o.assignment_id) o.*
       FROM onboarding_offers o
      WHERE o.assignment_id = ANY($1::uuid[])
      ORDER BY o.assignment_id, (o.status IN ('draft','approved','email_drafted','sent','signed_received')) DESC, o.version DESC`,
    [ids]
  );
  for (const r of rows) out.set(r.assignment_id, r);
  return out;
}

/** Create the next version of an offer for an assignment, as a draft. */
async function createOfferDraft({ organisationId, assignmentId, terms, createdBy, status = 'draft' }, q = pool) {
  const { rows } = await q.query(
    `INSERT INTO onboarding_offers (organisation_id, assignment_id, version, status, terms, created_by)
     VALUES ($1, $2,
             COALESCE((SELECT MAX(version) FROM onboarding_offers WHERE assignment_id = $2), 0) + 1,
             $3, $4, $5)
     RETURNING *`,
    [organisationId, assignmentId, status, JSON.stringify(terms || {}), createdBy || null]
  );
  return rows[0];
}

async function updateOfferTerms(offerId, terms, q = pool) {
  const { rows } = await q.query(
    `UPDATE onboarding_offers
        SET terms = $2, status = 'draft', approved_at = NULL, approved_by = NULL,
            email_draft_id = NULL, email_web_link = NULL, email_drafted_at = NULL, email_drafted_by = NULL,
            updated_at = NOW()
      WHERE id = $1 AND status IN ('draft', 'approved', 'email_drafted')
      RETURNING *`,
    [offerId, JSON.stringify(terms || {})]
  );
  return rows[0] || null;
}

/** Terms edited: the letter regenerates, and any Outlook draft is stale. */
async function resetOfferToDraft(offerId, q = pool) {
  const { rows } = await q.query(
    `UPDATE onboarding_offers
        SET status = 'draft', email_draft_id = NULL, email_web_link = NULL, email_drafted_at = NULL,
            email_drafted_by = NULL, updated_at = NOW()
      WHERE id = $1 AND status IN ('draft', 'approved', 'email_drafted')
      RETURNING *`, [offerId]
  );
  return rows[0] || null;
}

async function saveOfferEmail(offerId, { subject, body }, q = pool) {
  const { rows } = await q.query(
    `UPDATE onboarding_offers SET email_subject = $2, email_body = $3, updated_at = NOW()
      WHERE id = $1 AND status IN ('draft', 'email_drafted') RETURNING *`,
    [offerId, str(subject, 250), body == null ? null : String(body).slice(0, 20000)]
  );
  return rows[0] || null;
}

/** An Outlook draft now holds Email 1 with the letter attached. */
async function markEmailDrafted(offerId, { actorId, draftId, webLink, subject, body, templateVersion }, q = pool) {
  const { rows } = await q.query(
    `UPDATE onboarding_offers
        SET status = 'email_drafted', email_draft_id = $2, email_web_link = $3, email_drafted_at = NOW(),
            email_drafted_by = $4, email_subject = $5, email_body = $6, template_version = $7,
            sent_to = $8, updated_at = NOW()
      WHERE id = $1 AND status IN ('draft', 'email_drafted')
      RETURNING *`,
    [offerId, str(draftId, 300), webLink ? String(webLink).slice(0, 2000) : null, actorId,
      str(subject, 250), body == null ? null : String(body).slice(0, 20000), templateVersion || null, null]
  );
  return rows[0] || null;
}

/** The Owner pressed Send in Outlook and says so. Stage 1.5 begins. */
async function markOfferSent(offerId, { actorId, toEmail }, q = pool) {
  const { rows } = await q.query(
    `UPDATE onboarding_offers
        SET status = 'sent', sent_at = COALESCE(sent_at, NOW()), sent_by = COALESCE(sent_by, $2), sent_to = $3,
            email_sent_at = NOW(), email_sent_by = $2, updated_at = NOW()
      WHERE id = $1 AND status IN ('email_drafted', 'draft')
      RETURNING *`, [offerId, actorId, toEmail]
  );
  return rows[0] || null;
}

/** Undo a mistaken "sent" while nothing has come back. */
async function unmarkOfferSent(offerId, q = pool) {
  const { rows } = await q.query(
    `UPDATE onboarding_offers
        SET status = CASE WHEN email_draft_id IS NULL THEN 'draft' ELSE 'email_drafted' END,
            sent_at = NULL, sent_by = NULL, email_sent_at = NULL, email_sent_by = NULL, updated_at = NOW()
      WHERE id = $1 AND status = 'sent'
      RETURNING *`, [offerId]
  );
  return rows[0] || null;
}

async function markSignedReceived(offerId, q = pool) {
  const { rows } = await q.query(
    `UPDATE onboarding_offers
        SET status = 'signed_received', signed_received_at = COALESCE(signed_received_at, NOW()), updated_at = NOW()
      WHERE id = $1 AND status IN ('sent', 'signed_received', 'email_drafted', 'draft')
      RETURNING *`, [offerId]
  );
  return rows[0] || null;
}

/** Verified by the Owner: the signed letter is the acceptance. */
async function verifyOffer(offerId, actorId, q = pool) {
  const { rows } = await q.query(
    `UPDATE onboarding_offers
        SET status = 'accepted', verified_at = NOW(), verified_by = $2, responded_at = COALESCE(responded_at, NOW()),
            updated_at = NOW()
      WHERE id = $1 AND status = 'signed_received'
      RETURNING *`, [offerId, actorId]
  );
  return rows[0] || null;
}

async function declineOffer(offerId, reason, q = pool) {
  const { rows } = await q.query(
    `UPDATE onboarding_offers
        SET status = 'declined', responded_at = NOW(), decline_reason = $2, updated_at = NOW()
      WHERE id = $1 AND status IN ('sent', 'signed_received', 'email_drafted')
      RETURNING *`, [offerId, str(reason, 1000)]
  );
  return rows[0] || null;
}

async function withdrawOffer(offerId, actorId, reason, q = pool) {
  const { rows } = await q.query(
    `UPDATE onboarding_offers
        SET status = 'withdrawn', withdrawn_at = NOW(), withdrawn_by = $2, withdraw_reason = $3, updated_at = NOW()
      WHERE id = $1 AND status IN ('draft', 'approved', 'email_drafted', 'sent', 'signed_received')
      RETURNING *`, [offerId, actorId, str(reason, 500)]
  );
  return rows[0] || null;
}

async function markOfferNotRequired(offerId, q = pool) {
  const { rows } = await q.query(
    `UPDATE onboarding_offers
        SET status = 'not_required', responded_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND status IN ('draft', 'approved', 'email_drafted')
      RETURNING *`, [offerId]
  );
  return rows[0] || null;
}

// ═════════════════════════════════════════════════════════════════════════════
//  OFFER DOCUMENTS — the edited letter and the signed copy
// ═════════════════════════════════════════════════════════════════════════════

const { getBackend, getBackendName } = require('./storage');

/** Store a file against an offer, superseding the live one of the same kind. */
async function storeOfferDocument({ organisationId, offerId, assignmentId, kind, fileName, fileMime, buffer, uploadedBy }) {
  const sha = crypto.createHash('sha256').update(buffer).digest('hex');
  const backendName = getBackendName();
  return odb.withTransaction(async (q) => {
    await q.query(
      `UPDATE onboarding_offer_documents SET status = 'superseded', superseded_at = NOW()
        WHERE offer_id = $1 AND kind = $2 AND status = 'active'`, [offerId, kind]
    );
    const { rows } = await q.query(
      `INSERT INTO onboarding_offer_documents
         (organisation_id, offer_id, assignment_id, kind, file_name, file_mime, file_size_bytes, file_sha256,
          storage_backend, file_data, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [organisationId, offerId, assignmentId, kind, str(fileName, 255), str(fileMime, 100), buffer.length, sha,
        backendName === 'db' ? 'db' : backendName, backendName === 'db' ? buffer.toString('base64') : null, uploadedBy || null]
    );
    const row = rows[0];
    if (backendName !== 'db') {
      const put = await getBackend(backendName).put({
        userId: 'onboarding-offer', docId: row.id, fileName: row.file_name, mime: row.file_mime, base64: buffer.toString('base64'),
      });
      await q.query('UPDATE onboarding_offer_documents SET storage_backend = $2, storage_key = $3 WHERE id = $1',
        [row.id, put.backend, put.storageKey]);
      row.storage_backend = put.backend; row.storage_key = put.storageKey;
    }
    return row;
  });
}

/** The portal's reading of an uploaded document — kept beside it. */
async function setOfferDocumentCheck(docId, check, q = pool) {
  await q.query(`UPDATE onboarding_offer_documents SET check_result = $2 WHERE id = $1`, [docId, check ? JSON.stringify(check) : null]);
}

async function getLiveOfferDocument(offerId, kind, q = pool) {
  if (!isUuid(offerId)) return null;
  const { rows } = await q.query(
    `SELECT d.*, u.name AS uploaded_by_name FROM onboarding_offer_documents d
       LEFT JOIN users u ON u.id = d.uploaded_by
      WHERE d.offer_id = $1 AND d.kind = $2 AND d.status = 'active' LIMIT 1`, [offerId, kind]
  );
  return rows[0] || null;
}

async function removeOfferDocument(offerId, kind, q = pool) {
  const { rowCount } = await q.query(
    `UPDATE onboarding_offer_documents SET status = 'superseded', superseded_at = NOW()
      WHERE offer_id = $1 AND kind = $2 AND status = 'active'`, [offerId, kind]
  );
  return rowCount;
}

async function readOfferDocumentBytes(doc) {
  if (!doc) return null;
  if (doc.storage_backend === 'db' || !doc.storage_key) {
    return doc.file_data ? Buffer.from(doc.file_data, 'base64') : null;
  }
  const out = await getBackend(doc.storage_backend).get({
    backend: doc.storage_backend, storageKey: doc.storage_key, fileData: doc.file_data,
  });
  return out && out.base64 ? Buffer.from(out.base64, 'base64') : null;
}

// ═════════════════════════════════════════════════════════════════════════════
//  INTERNAL TASKS
// ═════════════════════════════════════════════════════════════════════════════

const TASK_SELECT = `
  SELECT t.*, au.name AS assignee_name, cu.name AS completed_by_name
    FROM onboarding_internal_tasks t
    LEFT JOIN users au ON au.id = t.assignee_user_id
    LEFT JOIN users cu ON cu.id = t.completed_by`;

async function listTasks(assignmentId, q = pool) {
  if (!isUuid(assignmentId)) return [];
  const { rows } = await q.query(
    `${TASK_SELECT} WHERE t.assignment_id = $1 ORDER BY t.sort_order, t.title`, [assignmentId]
  );
  return rows;
}

async function mapTasks(assignmentIds, q = pool) {
  const ids = (assignmentIds || []).filter(isUuid);
  const out = new Map();
  if (!ids.length) return out;
  const { rows } = await q.query(
    `${TASK_SELECT} WHERE t.assignment_id = ANY($1::uuid[]) ORDER BY t.sort_order`, [ids]
  );
  for (const r of rows) {
    if (!out.has(r.assignment_id)) out.set(r.assignment_id, []);
    out.get(r.assignment_id).push(r);
  }
  return out;
}

async function getTask(assignmentId, code, q = pool) {
  if (!isUuid(assignmentId)) return null;
  const { rows } = await q.query(
    `${TASK_SELECT} WHERE t.assignment_id = $1 AND t.code = $2`, [assignmentId, str(code, 60)]
  );
  return rows[0] || null;
}

/** Insert the checklist; existing (assignment, code) rows are left untouched. */
async function ensureTasks(organisationId, assignmentId, tasks, q = pool) {
  let inserted = 0;
  for (const t of tasks) {
    const { rowCount } = await q.query(
      `INSERT INTO onboarding_internal_tasks
         (organisation_id, assignment_id, code, title, description, automation,
          assignee_user_id, due_at, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (assignment_id, code) DO NOTHING`,
      [
        organisationId, assignmentId, str(t.code, 60), str(t.title, 200), str(t.description, 1000),
        str(t.automation, 40), isUuid(t.assigneeUserId) ? t.assigneeUserId : null,
        t.dueAt || null, Number(t.sortOrder) || 0,
      ]
    );
    inserted += rowCount;
  }
  return inserted;
}

async function setTaskStatus(assignmentId, code, { status, actorId, note, detail }, q = pool) {
  const finished = status === 'done' || status === 'skipped';
  const { rows } = await q.query(
    `UPDATE onboarding_internal_tasks
        SET status = $3,
            completed_at = CASE WHEN $4::boolean THEN NOW() ELSE NULL END,
            completed_by = CASE WHEN $4::boolean THEN $5::uuid ELSE NULL END,
            note = COALESCE($6, note),
            detail = COALESCE($7::jsonb, detail),
            updated_at = NOW()
      WHERE assignment_id = $1 AND code = $2
      RETURNING *`,
    [assignmentId, str(code, 60), status, finished, actorId || null, str(note, 1000),
      detail ? JSON.stringify(detail) : null]
  );
  return rows[0] || null;
}

async function assignTask(assignmentId, code, { assigneeUserId, dueAt }, q = pool) {
  const { rows } = await q.query(
    `UPDATE onboarding_internal_tasks
        SET assignee_user_id = $3, due_at = COALESCE($4, due_at), updated_at = NOW()
      WHERE assignment_id = $1 AND code = $2
      RETURNING *`,
    [assignmentId, str(code, 60), isUuid(assigneeUserId) ? assigneeUserId : null, dueAt || null]
  );
  return rows[0] || null;
}

/** Requirements for many assignments, the columns the projection needs only. */
async function mapRequirements(assignmentIds, q = pool) {
  const ids = (assignmentIds || []).filter(isUuid);
  const out = new Map();
  if (!ids.length) return out;
  const { rows } = await q.query(
    `SELECT id, assignment_id, title, section, actor, status, due_at, blocks_activation,
            requires_employer_verification, submitted_at, completed_at, reviewed_at, sort_order
       FROM onboarding_requirements
      WHERE assignment_id = ANY($1::uuid[])
      ORDER BY section, sort_order`, [ids]
  );
  for (const r of rows) {
    if (!out.has(r.assignment_id)) out.set(r.assignment_id, []);
    out.get(r.assignment_id).push(r);
  }
  return out;
}

/** Staff who can be handed an induction task. Names and ids only. */
async function listAssignableStaff(organisationId, q = pool) {
  const { rows } = await q.query(
    `SELECT id, name, role FROM users
      WHERE organisation_id IS NOT DISTINCT FROM $1 AND is_active = TRUE
        AND role IN ('owner', 'admin', 'therapist')
      ORDER BY name`, [organisationId]
  );
  return rows;
}

// ═══════════════════════════════════════════════════════════════════════════
//  START ONBOARDING DRAFTS — the unsubmitted form, saved as it is typed
// ═══════════════════════════════════════════════════════════════════════════

const DRAFT_SELECT = `
  SELECT id, organisation_id AS "organisationId", created_by AS "createdBy", updated_by AS "updatedBy",
         applicant_name AS "applicantName", position_title AS "positionTitle", form,
         created_at AS "createdAt", updated_at AS "updatedAt"
    FROM onboarding_start_drafts`;

/** Plain-object form only; anything else is stored as an empty form. */
function cleanForm(form) {
  return form && typeof form === 'object' && !Array.isArray(form) ? form : {};
}

async function listStartDrafts(organisationId, q = pool) {
  const r = await q.query(`${DRAFT_SELECT} WHERE organisation_id = $1 ORDER BY updated_at DESC`, [organisationId]);
  return r.rows;
}

async function getStartDraft(organisationId, id, q = pool) {
  if (!isUuid(id)) return null;
  const r = await q.query(`${DRAFT_SELECT} WHERE organisation_id = $1 AND id = $2`, [organisationId, id]);
  return r.rows[0] || null;
}

async function createStartDraft({ organisationId, userId, form }, q = pool) {
  const f = cleanForm(form);
  const r = await q.query(
    `INSERT INTO onboarding_start_drafts (organisation_id, created_by, updated_by, applicant_name, position_title, form)
     VALUES ($1, $2, $2, $3, $4, $5) RETURNING id`,
    [organisationId, userId || null, str(f.name, 200) || null, str(f.position, 150) || null, JSON.stringify(f)],
  );
  return getStartDraft(organisationId, r.rows[0].id, q);
}

async function updateStartDraft(organisationId, id, { userId, form }, q = pool) {
  if (!isUuid(id)) return null;
  const f = cleanForm(form);
  const r = await q.query(
    `UPDATE onboarding_start_drafts
        SET form = $4, applicant_name = $5, position_title = $6, updated_by = $3, updated_at = NOW()
      WHERE organisation_id = $1 AND id = $2 RETURNING id`,
    [organisationId, id, userId || null, JSON.stringify(f), str(f.name, 200) || null, str(f.position, 150) || null],
  );
  return r.rowCount ? getStartDraft(organisationId, id, q) : null;
}

async function deleteStartDraft(organisationId, id, q = pool) {
  if (!isUuid(id)) return false;
  const r = await q.query('DELETE FROM onboarding_start_drafts WHERE organisation_id = $1 AND id = $2', [organisationId, id]);
  return r.rowCount > 0;
}

module.exports = {
  setOfferDocumentCheck,
  listStartDrafts,
  getStartDraft,
  createStartDraft,
  updateStartDraft,
  deleteStartDraft,
  getCurrentOffer,
  listOffers,
  getOffer,
  mapCurrentOffers,
  createOfferDraft,
  updateOfferTerms,
  resetOfferToDraft,
  saveOfferEmail,
  markEmailDrafted,
  markOfferSent,
  unmarkOfferSent,
  markSignedReceived,
  verifyOffer,
  declineOffer,
  withdrawOffer,
  markOfferNotRequired,
  storeOfferDocument,
  getLiveOfferDocument,
  removeOfferDocument,
  readOfferDocumentBytes,
  listTasks,
  mapTasks,
  getTask,
  ensureTasks,
  setTaskStatus,
  assignTask,
  mapRequirements,
  listAssignableStaff,
};
