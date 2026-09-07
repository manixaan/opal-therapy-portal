'use strict';

/**
 * PAYROLL & XERO SETUP — data access (migration 062).
 *
 * Two tables: payroll_xero_sync (the workflow, one per onboarding record) and
 * payroll_xero_operations (one row per request attempt). Nothing here ever
 * writes a TFN, BSB, account number, token or Xero payload — the columns do
 * not exist, and the patch allowlist below is the only way to update a row.
 */

const { pool } = require('./database');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
const str = (v, max) => (v === null || v === undefined ? null : String(v).slice(0, max));

const SYNC_COLUMNS = new Set([
  'state', 'next_pay_run_state', 'state_reason', 'config', 'config_updated_at', 'config_updated_by',
  'approved_snapshot', 'snapshot_version', 'approved_at', 'approved_by',
  'privacy_notice_version', 'privacy_notice_accepted_at', 'privacy_notice_accepted_by',
  'xero_tenant_id_suffix', 'xero_employee_id', 'xero_super_fund_id', 'xero_super_membership_id',
  'xero_payroll_calendar_id', 'xero_earnings_rate_id', 'xero_leave_type_ids', 'xero_pay_run_id',
  'operation_id', 'attempt_count', 'last_attempt_at', 'last_attempt_by', 'retry_after', 'last_step',
  'last_error_code', 'last_error_message', 'verification', 'validation_messages', 'manual_actions',
  'duplicate_candidates', 'duplicate_resolution', 'duplicate_resolved_at', 'duplicate_resolved_by',
  'synced_at', 'last_recheck_at', 'user_id',
]);
const JSON_COLUMNS = new Set(['config', 'approved_snapshot', 'verification', 'manual_actions', 'duplicate_candidates']);

async function getSync(assignmentId, q = pool) {
  if (!isUuid(assignmentId)) return null;
  const { rows } = await q.query('SELECT * FROM payroll_xero_sync WHERE assignment_id = $1', [assignmentId]);
  return rows[0] || null;
}

async function getSyncById(id, q = pool) {
  if (!isUuid(id)) return null;
  const { rows } = await q.query('SELECT * FROM payroll_xero_sync WHERE id = $1', [id]);
  return rows[0] || null;
}

/** The row for a record, created on first touch. */
async function ensureSync(assignment, q = pool) {
  const { rows } = await q.query(
    `INSERT INTO payroll_xero_sync (organisation_id, assignment_id, user_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (assignment_id) DO UPDATE SET user_id = COALESCE(payroll_xero_sync.user_id, EXCLUDED.user_id), updated_at = NOW()
     RETURNING *`,
    [assignment.organisation_id || null, assignment.id, assignment.user_id || null]
  );
  return rows[0];
}

/** Allowlisted patch. Unknown keys throw — a typo must not silently do nothing. */
async function updateSync(id, patch, q = pool) {
  const keys = Object.keys(patch || {});
  for (const k of keys) if (!SYNC_COLUMNS.has(k)) throw new Error(`payroll_xero_sync: column not updatable: ${k}`);
  if (!keys.length) return getSyncById(id, q);
  const sets = []; const vals = [id];
  keys.forEach((k, i) => {
    const v = patch[k];
    vals.push(JSON_COLUMNS.has(k) ? (v === null ? null : JSON.stringify(v)) : v);
    sets.push(`${k} = $${i + 2}${JSON_COLUMNS.has(k) ? '::jsonb' : ''}`);
  });
  const { rows } = await q.query(`UPDATE payroll_xero_sync SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING *`, vals);
  return rows[0] || null;
}

/** Approval: freeze the snapshot, bump the version, start a fresh logical operation. */
async function approve(id, { snapshot, actorId, operationId }, q = pool) {
  const { rows } = await q.query(
    `UPDATE payroll_xero_sync
        SET state = 'APPROVED_FOR_XERO', approved_snapshot = $2::jsonb, snapshot_version = snapshot_version + 1,
            approved_at = NOW(), approved_by = $3, operation_id = $4, attempt_count = 0, retry_after = NULL,
            last_step = NULL, last_error_code = NULL, last_error_message = NULL, verification = NULL,
            validation_messages = '{}', duplicate_candidates = NULL, state_reason = NULL, updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [id, JSON.stringify(snapshot), actorId || null, operationId]
  );
  return rows[0] || null;
}

/** Append one request attempt. Safe strings only. */
async function recordOperation({ syncId, operationId, attempt, step, method, resource, idempotencyKey, httpStatus, outcome, errorCode, errorMessage, xeroId, actorId }, q = pool) {
  const { rows } = await q.query(
    `INSERT INTO payroll_xero_operations
       (sync_id, operation_id, attempt, step, method, resource, idempotency_key, finished_at, http_status, outcome, error_code, error_message, xero_id, actor_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8, $9, $10, $11, $12, $13) RETURNING id`,
    [syncId, operationId, attempt || 0, str(step, 60), str(method, 8), str(resource, 120), str(idempotencyKey, 128),
      httpStatus || null, outcome || 'ok', str(errorCode, 80), str(errorMessage, 500), str(xeroId, 60), actorId || null]
  );
  return rows[0];
}

async function listOperations(syncId, { limit = 50 } = {}, q = pool) {
  const { rows } = await q.query(
    `SELECT id, operation_id, attempt, step, method, resource, started_at, http_status, outcome, error_code, error_message, xero_id
       FROM payroll_xero_operations WHERE sync_id = $1 ORDER BY started_at DESC LIMIT $2`, [syncId, limit]
  );
  return rows;
}

/** Has a create ever been attempted for this operation without a recorded ok? */
async function hasUnconfirmedCreate(syncId, operationId, q = pool) {
  const { rows } = await q.query(
    `SELECT outcome FROM payroll_xero_operations WHERE sync_id = $1 AND operation_id = $2 AND step = 'create_employee' ORDER BY started_at DESC LIMIT 1`,
    [syncId, operationId]
  );
  return rows.length > 0 && rows[0].outcome !== 'ok';
}

/** The applicant accepted the payroll privacy notice with their payroll data. */
async function recordPrivacyNotice(userId, version, q = pool) {
  await q.query(
    `UPDATE payroll_profiles SET privacy_notice_version = $2, privacy_notice_accepted_at = NOW(), updated_at = NOW() WHERE user_id = $1`,
    [userId, str(version, 40)]
  );
}

async function getPrivacyNotice(userId, q = pool) {
  const { rows } = await q.query('SELECT privacy_notice_version, privacy_notice_accepted_at FROM payroll_profiles WHERE user_id = $1', [userId]);
  return rows[0] || null;
}

/**
 * Request changes: the payroll forms go back to the applicant as
 * correction_required, and the Owner's approval is withdrawn.
 */
async function reopenPayrollForms(assignmentId, userId, { reason, actorId }, q = pool) {
  const { rows } = await q.query(
    `UPDATE onboarding_requirements
        SET status = 'correction_required', review_reason = $2, reviewed_by = $3, reviewed_at = NOW(), updated_at = NOW()
      WHERE assignment_id = $1 AND handler = 'form'
        AND (snapshot->>'form_key') IN ('bank_details', 'tax_setup', 'super_setup')
        AND status NOT IN ('not_applicable', 'expired')
      RETURNING id, title`,
    [assignmentId, str(reason, 1000), actorId || null]
  );
  if (userId) {
    await q.query(
      `UPDATE payroll_profiles SET payroll_approved_at = NULL, payroll_approved_by = NULL, updated_at = NOW(), updated_by = $2 WHERE user_id = $1`,
      [userId, actorId || null]
    );
  }
  return rows;
}

/** After a verified sync, the profile and the induction task both say so. */
async function markProfileConfigured(userId, employeeId, actorId, q = pool) {
  if (!userId) return;
  await q.query(
    `UPDATE payroll_profiles
        SET payroll_setup_status = 'configured', payroll_system = 'xero', payroll_employee_ref = $2,
            payroll_setup_at = NOW(), payroll_setup_by = $3, super_status = CASE WHEN super_status = 'not_started' THEN super_status ELSE 'payroll_configured' END,
            updated_at = NOW(), updated_by = $3
      WHERE user_id = $1`,
    [userId, str(employeeId, 120), actorId || null]
  );
}

module.exports = {
  pool, isUuid, SYNC_COLUMNS,
  getSync, getSyncById, ensureSync, updateSync, approve,
  recordOperation, listOperations, hasUnconfirmedCreate,
  recordPrivacyNotice, getPrivacyNotice, reopenPayrollForms, markProfileConfigured,
};
