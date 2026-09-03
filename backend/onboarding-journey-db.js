'use strict';

/**
 * DATA ACCESS for the three-stage journey (migration 047): letters of offer
 * and internal induction tasks. Everything shared — the pool, `str`, `isUuid`,
 * withTransaction — comes from onboarding-db.js so there is one pool and one
 * sanitiser.
 *
 * A response token is stored only as its sha256; the clear token exists in
 * memory for the one request that mints it and in the email that carries it.
 */

const crypto = require('crypto');
const odb = require('./onboarding-db');

const { pool, isUuid, str } = odb;

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

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
      ORDER BY (o.status IN ('draft','approved','sent')) DESC, o.version DESC
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
      ORDER BY o.assignment_id, (o.status IN ('draft','approved','sent')) DESC, o.version DESC`,
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
        SET terms = $2, status = 'draft', approved_at = NULL, approved_by = NULL, updated_at = NOW()
      WHERE id = $1 AND status IN ('draft', 'approved')
      RETURNING *`,
    [offerId, JSON.stringify(terms || {})]
  );
  return rows[0] || null;
}

async function approveOffer(offerId, actorId, q = pool) {
  const { rows } = await q.query(
    `UPDATE onboarding_offers
        SET status = 'approved', approved_at = NOW(), approved_by = $2, updated_at = NOW()
      WHERE id = $1 AND status = 'draft'
      RETURNING *`, [offerId, actorId]
  );
  return rows[0] || null;
}

/**
 * Mark an approved (or already sent) offer as sent, minting a fresh response
 * token. Returns { offer, token } — the clear token is returned exactly once.
 */
async function markOfferSent(offerId, { actorId, toEmail, days = 14 }, q = pool) {
  const token = crypto.randomBytes(32).toString('hex');
  const { rows } = await q.query(
    `UPDATE onboarding_offers
        SET status = 'sent',
            sent_at = COALESCE(sent_at, NOW()),
            sent_by = COALESCE(sent_by, $2),
            sent_to = $3,
            reminder_count = CASE WHEN status = 'sent' THEN reminder_count + 1 ELSE reminder_count END,
            last_reminder_at = CASE WHEN status = 'sent' THEN NOW() ELSE last_reminder_at END,
            response_token_hash = $4,
            token_expires_at = NOW() + ($5 || ' days')::INTERVAL,
            updated_at = NOW()
      WHERE id = $1 AND status IN ('approved', 'sent')
      RETURNING *`,
    [offerId, actorId, toEmail, hashToken(token), String(Math.max(1, Math.min(Number(days) || 14, 60)))]
  );
  return rows[0] ? { offer: rows[0], token } : null;
}

async function withdrawOffer(offerId, actorId, reason, q = pool) {
  const { rows } = await q.query(
    `UPDATE onboarding_offers
        SET status = 'withdrawn', withdrawn_at = NOW(), withdrawn_by = $2, withdraw_reason = $3,
            response_token_hash = NULL, token_expires_at = NULL, updated_at = NOW()
      WHERE id = $1 AND status IN ('draft', 'approved', 'sent')
      RETURNING *`, [offerId, actorId, str(reason, 500)]
  );
  return rows[0] || null;
}

async function markOfferNotRequired(offerId, q = pool) {
  const { rows } = await q.query(
    `UPDATE onboarding_offers
        SET status = 'not_required', responded_at = NOW(),
            response_token_hash = NULL, token_expires_at = NULL, updated_at = NOW()
      WHERE id = $1 AND status IN ('draft', 'approved')
      RETURNING *`, [offerId]
  );
  return rows[0] || null;
}

/** Public: the offer behind a response token, joined to its assignment. */
async function getOfferByToken(token, q = pool) {
  if (!token || typeof token !== 'string' || token.length > 200) return null;
  const { rows } = await q.query(
    `SELECT o.*, a.applicant_name, a.applicant_email, a.status AS assignment_status,
            a.organisation_id AS org_id, org.name AS organisation_name
       FROM onboarding_offers o
       JOIN onboarding_assignments a ON a.id = o.assignment_id
       LEFT JOIN organisations org ON org.id = a.organisation_id
      WHERE o.response_token_hash = $1
      LIMIT 1`, [hashToken(token)]
  );
  return rows[0] || null;
}

async function markOfferViewed(offerId, q = pool) {
  await q.query(
    `UPDATE onboarding_offers SET first_viewed_at = COALESCE(first_viewed_at, NOW()) WHERE id = $1`,
    [offerId]
  );
}

/**
 * Record the employee's decision. Single-use: only a 'sent' offer with a live
 * token can be answered. The hash is kept so a second visit to the same link
 * can be told "already answered" rather than "not valid".
 */
async function respondToOffer(offerId, { decision, signedName, reason }, q = pool) {
  const status = decision === 'accept' ? 'accepted' : 'declined';
  const { rows } = await q.query(
    `UPDATE onboarding_offers
        SET status = $2, responded_at = NOW(), signed_name = $3, decline_reason = $4,
            updated_at = NOW()
      WHERE id = $1 AND status = 'sent'
        AND (token_expires_at IS NULL OR token_expires_at > NOW())
      RETURNING *`,
    [offerId, status, str(signedName, 200), str(reason, 1000)]
  );
  return rows[0] || null;
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

module.exports = {
  hashToken,
  getCurrentOffer,
  listOffers,
  getOffer,
  mapCurrentOffers,
  createOfferDraft,
  updateOfferTerms,
  approveOffer,
  markOfferSent,
  withdrawOffer,
  markOfferNotRequired,
  getOfferByToken,
  markOfferViewed,
  respondToOffer,
  listTasks,
  mapTasks,
  getTask,
  ensureTasks,
  setTaskStatus,
  assignTask,
  mapRequirements,
  listAssignableStaff,
};
