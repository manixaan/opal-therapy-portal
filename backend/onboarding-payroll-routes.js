'use strict';

/**
 * PAYROLL & XERO SETUP — routes.
 *
 * A review of gathered information, the Owner's pay configuration, one
 * approval, and the Xero sync with its read-back verification.
 *
 *   GET  …/payroll-setup                         the set line by line, the Xero stage, what can be done
 *   GET  …/payroll-setup/xero/health             connection health (safe summary)
 *   GET  …/payroll-setup/xero/reference          calendars, earnings rates, leave types, super funds
 *   PUT  …/payroll-setup/config                  the Owner's employment and pay configuration
 *   POST …/payroll-setup/approve                 approve the set: freezes the snapshot (APPROVED_FOR_XERO)
 *   POST …/payroll-setup/request-changes         send the payroll forms back to the employee
 *   POST …/payroll-setup/sync                    create / configure the employee in Xero and verify
 *   POST …/payroll-setup/retry                   same logical operation, same idempotency keys
 *   POST …/payroll-setup/recheck                 re-read the employee and the pay runs (no writes)
 *   POST …/payroll-setup/resolve-duplicate       link an existing Xero employee, or create a new one
 *   POST …/payroll-setup/manual-actions/:code/complete
 *
 * Every route needs onboarding.payroll. Sync, retry and duplicate resolution
 * additionally need the owner or admin role: they decrypt the TFN and bank
 * details in memory to build the Xero request, and that release is audited
 * before it happens, exactly like the payroll export.
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const odb = require('./onboarding-db');
const rdb = require('./onboarding-returns-db');
const xdb = require('./xero-payroll-db');
const sync = require('./onboarding-profile-sync');
const payrollRules = require('./onboarding-payroll');
const mapping = require('./xero-payroll-mapping');
const xeroApi = require('./xero-payroll-api');
const connection = require('./xero-payroll-connection');
const flags = require('./finance-flags');
const { createPayrollSync } = require('./xero-payroll-sync');
const { auditOnboarding } = require('./onboarding-audit');
const { requireAuth, requirePermission } = require('./permissions');
const log = require('./logger').createLogger('onboarding-payroll');

const payrollSync = createPayrollSync({ api: xeroApi, db: xdb, flags, logger: log, connection });

const orgOf = (req) => req.user?.organisation_id || null;
const { isUuid } = odb;
const safe = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  if (err && err.statusCode && err.statusCode < 500) return res.status(err.statusCode).json({ error: err.message, code: err.code || null });
  log.error('payroll route error', { error: err, path: req.path });
  if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
});
const notFound = (res) => res.status(404).json({ error: 'Not found' });
const str = (v, max) => (v === null || v === undefined ? null : String(v).trim().slice(0, max) || null);
const isOwnerOrAdmin = (req) => ['owner', 'admin'].includes(req.user?.role);

// Reference data and health are non-sensitive and change rarely; cache briefly per process.
const cache = { reference: null, referenceAt: 0, health: null, healthAt: 0 };
const REFERENCE_TTL_MS = 5 * 60 * 1000;
const HEALTH_TTL_MS = 60 * 1000;

async function cachedHealth() {
  if (cache.health && Date.now() - cache.healthAt < HEALTH_TTL_MS) return cache.health;
  cache.health = await connection.health();
  cache.healthAt = Date.now();
  return cache.health;
}
async function cachedReference() {
  if (cache.reference && Date.now() - cache.referenceAt < REFERENCE_TTL_MS) return cache.reference;
  cache.reference = await payrollSync.referenceData();
  cache.referenceAt = Date.now();
  return cache.reference;
}

async function payrollRow(userId) {
  if (!userId) return null;
  const { rows } = await odb.pool.query(
    `SELECT p.bank_status, p.bank_verified_at, p.tax_setup_status, p.super_status, p.payroll_setup_status,
            p.payroll_approved_at, p.privacy_notice_version, p.privacy_notice_accepted_at, u.name AS payroll_approved_by_name
       FROM payroll_profiles p LEFT JOIN users u ON u.id = p.payroll_approved_by WHERE p.user_id = $1`, [userId]
  );
  return rows[0] || null;
}

/** The manual actions, verification and identifiers as the screen shows them. Never a secret. */
function xeroView(row, { health, derivedState }) {
  const state = derivedState || (row && row.state) || 'NOT_STARTED';
  const nextPayRun = (row && row.next_pay_run_state) || 'UNKNOWN';
  return {
    state, label: mapping.STATE_LABELS[state] || state, reason: row ? row.state_reason : null,
    nextPayRun: { state: nextPayRun, label: mapping.NEXT_PAY_RUN_LABELS[nextPayRun] || nextPayRun, payRunId: row ? row.xero_pay_run_id : null },
    config: (row && row.config) || null, configUpdatedAt: row ? row.config_updated_at : null,
    snapshot: (row && row.approved_snapshot) || null, snapshotVersion: row ? row.snapshot_version : 0,
    approvedAt: row ? row.approved_at : null,
    xeroEmployeeId: row ? row.xero_employee_id : null, xeroSuperFundId: row ? row.xero_super_fund_id : null,
    xeroSuperMembershipId: row ? row.xero_super_membership_id : null, tenantIdSuffix: row ? row.xero_tenant_id_suffix : null,
    attempts: row ? row.attempt_count : 0, lastAttemptAt: row ? row.last_attempt_at : null, retryAfter: row ? row.retry_after : null,
    lastStep: row ? row.last_step : null, lastError: row && row.last_error_code ? { code: row.last_error_code, message: row.last_error_message } : null,
    validationMessages: (row && row.validation_messages) || [],
    verification: (row && row.verification) || null,
    manualActions: (row && row.manual_actions) || [],
    duplicateCandidates: (row && row.duplicate_candidates && row.duplicate_candidates.candidates) || null,
    duplicateResolution: row ? row.duplicate_resolution : null,
    syncedAt: row ? row.synced_at : null, lastRecheckAt: row ? row.last_recheck_at : null,
    health,
    apiVersion: xeroApi.API_VERSION,
  };
}

/** The payroll set for a record, plus the Xero stage. Shared with the record screen. */
async function payrollSetupFor(assignment, { includeXero = true } = {}) {
  const [profile, fields, payroll, row, health] = await Promise.all([
    sync.profileSummary(assignment.user_id), rdb.listResolved(assignment.id), payrollRow(assignment.user_id),
    includeXero ? xdb.getSync(assignment.id) : null, includeXero ? cachedHealth().catch(() => ({ configured: false, connected: false })) : null,
  ]);
  const setup = payrollRules.buildPayrollSetup({
    profile, payroll, assignment,
    fields: fields.map((f) => ({ key: f.field_key, outcome: f.outcome, status: f.status })),
    integration: health ? {
      available: !!health.configured, connected: !!health.connected, system: 'Xero Payroll',
      note: !health.configured ? 'The Xero payroll connection is not configured (XERO_PAYROLL_CLIENT_ID / SECRET).' : !health.connected ? `Xero payroll connection: ${health.reason || 'not connected'}` : `Connected to ${health.tenantName || 'Xero'}.`,
      syncEnabled: !!health.syncEnabled,
    } : undefined,
  });
  if (!includeXero) return setup;
  const derived = mapping.deriveState({ sync: row, payroll, setup });
  const xero = xeroView(row, { health, derivedState: derived });
  xero.privacyNotice = payroll ? { version: payroll.privacy_notice_version || null, acceptedAt: payroll.privacy_notice_accepted_at || null, required: mapping.PRIVACY_NOTICE_VERSION } : null;
  xero.can = {
    configure: !['SYNC_IN_PROGRESS', 'SYNCED'].includes(derived),
    approve: setup.ready && ['ADMIN_REVIEW', 'APPLICANT_SUBMITTED', 'CHANGES_REQUESTED', 'SYNC_FAILED_ACTION_REQUIRED'].includes(derived) && !!(row && row.config && row.config.payrollCalendarId),
    requestChanges: !['SYNC_IN_PROGRESS', 'SYNCED', 'NOT_STARTED'].includes(derived),
    sync: mapping.SYNC_STARTABLE_STATES.includes(derived) && derived !== 'POSSIBLE_DUPLICATE' && !!health && health.connected && !!health.syncEnabled,
    recheck: !!(row && row.xero_employee_id) && !!health && health.connected,
    resolveDuplicate: derived === 'POSSIBLE_DUPLICATE',
  };
  return { ...setup, xero };
}

async function loadAssignment(req, res) {
  if (!isUuid(req.params.id)) { notFound(res); return null; }
  const assignment = await odb.getAssignment(orgOf(req), req.params.id);
  if (!assignment) { notFound(res); return null; }
  return assignment;
}

router.use('/api/onboarding/journey', requireAuth);

router.get('/api/onboarding/journey/records/:id/payroll-setup', requirePermission('onboarding.payroll'), safe(async (req, res) => {
  const assignment = await loadAssignment(req, res); if (!assignment) return;
  await auditOnboarding(req, 'payroll_setup_viewed', { targetType: 'onboarding_assignment', targetId: assignment.id, metadata: { assignmentId: assignment.id } });
  const payroll = await payrollSetupFor(assignment);
  const row = await xdb.getSync(assignment.id);
  payroll.xero.operations = row ? (await xdb.listOperations(row.id, { limit: 20 })) : [];
  if (!payroll.xero.config && assignment.user_id) {
    const [employment, personal, prof] = await Promise.all([odb.getEmploymentProfile(assignment.user_id), odb.getPersonalDetails(assignment.user_id), odb.getPayrollProfileMasked(assignment.user_id)]);
    payroll.xero.defaultConfig = mapping.defaultConfig({ assignment, employment: employment || {}, personal: personal || {}, payroll: prof || {} });
  }
  res.json({ ok: true, payroll });
}));

router.get('/api/onboarding/journey/records/:id/payroll-setup/xero/health', requirePermission('onboarding.payroll'), safe(async (req, res) => {
  const assignment = await loadAssignment(req, res); if (!assignment) return;
  cache.healthAt = 0;
  res.json({ ok: true, health: await cachedHealth() });
}));

router.get('/api/onboarding/journey/records/:id/payroll-setup/xero/reference', requirePermission('onboarding.payroll'), safe(async (req, res) => {
  const assignment = await loadAssignment(req, res); if (!assignment) return;
  if (!connection.isConfigured()) return res.status(503).json({ error: 'The Xero payroll connection is not configured', code: 'XERO_PAYROLL_NOT_CONFIGURED' });
  const ref = await cachedReference();
  res.json({ ok: true, reference: { calendars: ref.calendars, earningsRates: ref.earningsRates, leaveTypes: ref.leaveTypes, superFunds: ref.superFunds } });
}));

router.put('/api/onboarding/journey/records/:id/payroll-setup/config', requirePermission('onboarding.payroll'), safe(async (req, res) => {
  const assignment = await loadAssignment(req, res); if (!assignment) return;
  const existing = await xdb.getSync(assignment.id);
  if (existing && ['SYNC_IN_PROGRESS', 'SYNCED'].includes(existing.state)) return res.status(409).json({ error: 'The configuration is locked once the employee is created in Xero.', code: 'locked' });
  let refs = null;
  if (connection.isConfigured()) { try { refs = (await cachedReference()).raw; } catch (_) { refs = null; } }
  const { errors, config } = mapping.validateConfig(req.body || {}, refs);
  if (errors.length) return res.status(400).json({ error: errors[0], errors, code: 'invalid_config' });
  const row = await xdb.ensureSync(assignment);
  const patch = { config, config_updated_at: new Date(), config_updated_by: req.user.id };
  // A configuration change after approval means the approval no longer describes what will be sent.
  if (mapping.POST_APPROVAL_STATES.includes(row.state)) Object.assign(patch, { state: 'ADMIN_REVIEW', approved_snapshot: null, state_reason: 'The configuration changed after approval; approve again.' });
  await xdb.updateSync(row.id, patch);
  if (mapping.POST_APPROVAL_STATES.includes(row.state) && assignment.user_id) {
    await odb.pool.query('UPDATE payroll_profiles SET payroll_approved_at = NULL, payroll_approved_by = NULL, updated_at = NOW() WHERE user_id = $1', [assignment.user_id]);
  }
  await auditOnboarding(req, 'payroll_config_saved', { targetType: 'onboarding_assignment', targetId: assignment.id, metadata: { assignmentId: assignment.id, syncId: row.id, employmentType: config.employmentBasis } });
  res.json({ ok: true, payroll: await payrollSetupFor(assignment) });
}));

router.post('/api/onboarding/journey/records/:id/payroll-setup/approve', requirePermission('onboarding.payroll'), safe(async (req, res) => {
  const assignment = await loadAssignment(req, res); if (!assignment) return;
  if (!assignment.user_id) return res.status(409).json({ error: 'No profile exists for this person yet.', code: 'no_user' });
  const setup = await payrollSetupFor(assignment);
  if (!setup.ready) {
    return res.status(409).json({ error: 'Payroll cannot proceed until every line is ready.', code: 'not_ready', blockers: setup.blockers, payroll: setup });
  }
  const row = await xdb.ensureSync(assignment);
  if (['SYNC_IN_PROGRESS', 'SYNCED'].includes(row.state)) return res.status(409).json({ error: 'This employee is already created in Xero.', code: 'already_synced' });
  // With no Xero payroll connection configured, approval keeps its original meaning: the set is
  // approved and the induction task tells the Owner to create the employee in Xero by hand.
  const xeroConfigured = connection.isConfigured();
  if (xeroConfigured && (!row.config || !row.config.payrollCalendarId)) return res.status(409).json({ error: 'Save the employment and pay configuration before approving.', code: 'no_config' });

  const [personal, employment, prof, notice] = await Promise.all([odb.getPersonalDetails(assignment.user_id), odb.getEmploymentProfile(assignment.user_id), odb.getPayrollProfileMasked(assignment.user_id), xdb.getPrivacyNotice(assignment.user_id)]);
  const snapshot = mapping.buildSnapshot({ assignment, personal: personal || {}, employment: employment || {}, payroll: prof || {}, config: row.config || {} });
  const errors = xeroConfigured ? mapping.validateSnapshot(snapshot) : [];
  if (errors.length) return res.status(409).json({ error: errors[0], errors, code: 'snapshot_invalid', payroll: setup });
  if (!notice || !notice.privacy_notice_accepted_at) {
    // Existing profiles collected before the notice existed: recorded as a warning on the approval, not a block.
    log.warn('payroll approved without a recorded privacy notice acceptance', { assignmentId: assignment.id });
  }

  await rdb.approvePayroll(assignment.user_id, req.user.id);
  await odb.pool.query(
    `UPDATE payroll_profiles SET payroll_approved_at = NOW(), payroll_approved_by = $2,
            payroll_setup_status = CASE WHEN payroll_setup_status = 'not_required' THEN 'setup_required' ELSE payroll_setup_status END,
            payroll_system = COALESCE(payroll_system, 'xero'), updated_at = NOW(), updated_by = $2
      WHERE user_id = $1`, [assignment.user_id, req.user.id]
  );
  const updated = await xdb.approve(row.id, { snapshot, actorId: req.user.id, operationId: crypto.randomUUID() });
  await xdb.updateSync(row.id, { privacy_notice_version: notice ? notice.privacy_notice_version : null, privacy_notice_accepted_at: notice ? notice.privacy_notice_accepted_at : null, privacy_notice_accepted_by: notice && notice.privacy_notice_accepted_at ? assignment.user_id : null });
  try {
    const jdb = require('./onboarding-journey-db');
    await jdb.setTaskStatus(assignment.id, 'payroll_setup', { status: 'in_progress', actorId: req.user.id, note: xeroConfigured ? 'Payroll set approved for Xero. Press Sync to Xero on the record to create the employee.' : 'Payroll set approved — create the employee in Xero from the approved details (integration not connected).' });
  } catch (_) { /* the task may not exist on older records */ }
  await auditOnboarding(req, 'payroll_setup_approved', { targetType: 'user', targetId: assignment.user_id, metadata: { assignmentId: assignment.id, syncId: row.id, snapshotVersion: updated.snapshot_version, operationId: updated.operation_id, lines: setup.total } });
  res.json({ ok: true, payroll: await payrollSetupFor(assignment) });
}));

router.post('/api/onboarding/journey/records/:id/payroll-setup/request-changes', requirePermission('onboarding.payroll'), safe(async (req, res) => {
  const assignment = await loadAssignment(req, res); if (!assignment) return;
  const reason = str(req.body?.reason, 1000);
  if (!reason) return res.status(400).json({ error: 'Tell the employee what needs to change.', code: 'reason_required' });
  const row = await xdb.ensureSync(assignment);
  if (['SYNC_IN_PROGRESS', 'SYNCED'].includes(row.state)) return res.status(409).json({ error: 'The employee is already created in Xero; changes now go through Xero and the profile.', code: 'already_synced' });
  const reopened = await xdb.reopenPayrollForms(assignment.id, assignment.user_id, { reason, actorId: req.user.id });
  await xdb.updateSync(row.id, { state: 'CHANGES_REQUESTED', state_reason: reason, approved_snapshot: null });
  if (assignment.user_id) {
    try {
      await require('./app-routes').storeNotification(assignment.user_id, {
        type: `onboarding_payroll_changes_${assignment.id}`, title: 'Your payroll details need attention',
        message: reason, severity: 'warning', relatedEntity: 'onboarding_assignment', actionPayload: { assignmentId: assignment.id },
      });
    } catch (_) { /* notification is best-effort */ }
  }
  await auditOnboarding(req, 'payroll_changes_requested', { targetType: 'onboarding_assignment', targetId: assignment.id, metadata: { assignmentId: assignment.id, syncId: row.id, reason: reason.slice(0, 200), requirementCount: reopened.length } });
  res.json({ ok: true, reopened: reopened.length, payroll: await payrollSetupFor(assignment) });
}));

/** Sync and retry share one implementation: the same operation id, the same idempotency keys. */
async function runSync(req, res, { retry }) {
  const assignment = await loadAssignment(req, res); if (!assignment) return;
  if (!isOwnerOrAdmin(req)) return res.status(403).json({ error: 'Only the practice owner or an admin can create employees in Xero', code: 'role_required' });
  if (!flags.isPayrollSyncEnabled()) return res.status(403).json({ error: 'Creating employees in Xero is switched off (ENABLE_XERO_PAYROLL_SYNC).', code: 'PAYROLL_SYNC_DISABLED' });
  if (!assignment.user_id) return res.status(409).json({ error: 'No profile exists for this person yet.', code: 'no_user' });
  const row = await xdb.getSync(assignment.id);
  if (!row) return res.status(409).json({ error: 'Approve the payroll set first.', code: 'not_approved' });
  if (row.state === 'SYNC_IN_PROGRESS' && row.last_attempt_at && Date.now() - new Date(row.last_attempt_at).getTime() < 5 * 60 * 1000) {
    return res.status(409).json({ error: 'A sync is already running for this record.', code: 'in_progress' });
  }
  if (row.state === 'SYNC_IN_PROGRESS') {
    // A crashed run: allow a resume as a retry.
    await xdb.updateSync(row.id, { state: 'SYNC_FAILED_RETRYABLE', state_reason: 'The previous run did not finish.' });
    row.state = 'SYNC_FAILED_RETRYABLE';
  }
  if (!mapping.SYNC_STARTABLE_STATES.includes(row.state)) return res.status(409).json({ error: `The sync cannot start from "${mapping.STATE_LABELS[row.state] || row.state}".`, code: 'not_startable' });
  if (row.state === 'POSSIBLE_DUPLICATE' && !row.duplicate_resolution) return res.status(409).json({ error: 'Resolve the possible duplicate first.', code: 'duplicate_unresolved' });
  if (retry && row.retry_after && new Date(row.retry_after).getTime() > Date.now() && !req.body?.force) {
    return res.status(429).json({ error: `Xero asked us to wait. Retry after ${new Date(row.retry_after).toISOString()}.`, code: 'retry_after', retryAfter: row.retry_after });
  }

  // Audited BEFORE the decrypt, exactly like the payroll export.
  await auditOnboarding(req, retry ? 'payroll_xero_sync_retried' : 'payroll_xero_sync_started', {
    targetType: 'user', targetId: assignment.user_id,
    metadata: { assignmentId: assignment.id, syncId: row.id, operationId: row.operation_id, snapshotVersion: row.snapshot_version, attempt: Number(row.attempt_count || 0) + 1 },
  });
  const secretsRow = await odb.decryptPayrollForExport(assignment.user_id);
  if (!secretsRow) return res.status(409).json({ error: 'No payroll record for this employee', code: 'no_payroll' });
  const secrets = { tfn: secretsRow.tfn, bsb: secretsRow.bsb, accountNumber: secretsRow.accountNumber, smsfBsb: secretsRow.smsfBankBsb, smsfAccountNumber: secretsRow.smsfBankAccount, superMemberNumber: secretsRow.superMemberNumber };

  const result = await payrollSync.run(row, { secrets, actorId: req.user.id });
  await auditOnboarding(req, 'payroll_xero_sync_result', {
    targetType: 'user', targetId: assignment.user_id,
    metadata: { assignmentId: assignment.id, syncId: row.id, operationId: row.operation_id, toStatus: result.state, nextPayRunState: result.next_pay_run_state, xeroEmployeeId: result.xero_employee_id || undefined, step: result.last_step || undefined, errorCode: result.last_error_code || undefined },
  });
  if (result.state === 'SYNCED') {
    try {
      const jdb = require('./onboarding-journey-db');
      await jdb.setTaskStatus(assignment.id, 'payroll_setup', { status: 'done', actorId: req.user.id, note: `Employee created in Xero and verified (${mapping.NEXT_PAY_RUN_LABELS[result.next_pay_run_state] || result.next_pay_run_state}).`, detail: { xeroEmployeeId: result.xero_employee_id } });
    } catch (_) { /* older records */ }
  }
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, payroll: await payrollSetupFor(assignment) });
}

router.post('/api/onboarding/journey/records/:id/payroll-setup/sync', requirePermission('onboarding.payroll'), safe((req, res) => runSync(req, res, { retry: false })));
router.post('/api/onboarding/journey/records/:id/payroll-setup/retry', requirePermission('onboarding.payroll'), safe((req, res) => runSync(req, res, { retry: true })));

router.post('/api/onboarding/journey/records/:id/payroll-setup/recheck', requirePermission('onboarding.payroll'), safe(async (req, res) => {
  const assignment = await loadAssignment(req, res); if (!assignment) return;
  const row = await xdb.getSync(assignment.id);
  if (!row || !row.xero_employee_id) return res.status(409).json({ error: 'The employee has not been created in Xero yet.', code: 'not_synced' });
  const result = await payrollSync.recheck(row);
  await auditOnboarding(req, 'payroll_xero_rechecked', { targetType: 'onboarding_assignment', targetId: assignment.id, metadata: { assignmentId: assignment.id, syncId: row.id, xeroEmployeeId: row.xero_employee_id, toStatus: result.state, nextPayRunState: result.next_pay_run_state } });
  res.json({ ok: true, payroll: await payrollSetupFor(assignment) });
}));

router.post('/api/onboarding/journey/records/:id/payroll-setup/resolve-duplicate', requirePermission('onboarding.payroll'), safe(async (req, res) => {
  const assignment = await loadAssignment(req, res); if (!assignment) return;
  if (!isOwnerOrAdmin(req)) return res.status(403).json({ error: 'Only the practice owner or an admin can resolve a possible duplicate', code: 'role_required' });
  const row = await xdb.getSync(assignment.id);
  if (!row || row.state !== 'POSSIBLE_DUPLICATE') return res.status(409).json({ error: 'There is no possible duplicate to resolve.', code: 'no_duplicate' });
  const resolution = req.body?.resolution;
  const employeeId = str(req.body?.employeeId, 60);
  if (!['link_existing', 'create_new'].includes(resolution)) return res.status(400).json({ error: 'Choose to link the existing employee or create a new one.', code: 'invalid_resolution' });
  const candidates = (row.duplicate_candidates && row.duplicate_candidates.candidates) || [];
  if (resolution === 'link_existing' && !candidates.some((c) => c.employeeId === employeeId)) return res.status(400).json({ error: 'That employee was not one of the candidates.', code: 'not_a_candidate' });
  await xdb.updateSync(row.id, {
    state: 'APPROVED_FOR_XERO', duplicate_resolution: resolution, duplicate_resolved_at: new Date(), duplicate_resolved_by: req.user.id,
    duplicate_candidates: { ...row.duplicate_candidates, linkedEmployeeId: resolution === 'link_existing' ? employeeId : null },
    ...(resolution === 'link_existing' ? { xero_employee_id: employeeId } : {}), state_reason: null,
  });
  await auditOnboarding(req, 'payroll_duplicate_resolved', { targetType: 'onboarding_assignment', targetId: assignment.id, metadata: { assignmentId: assignment.id, syncId: row.id, duplicateResolution: resolution, xeroEmployeeId: resolution === 'link_existing' ? employeeId : undefined } });
  res.json({ ok: true, payroll: await payrollSetupFor(assignment) });
}));

router.post('/api/onboarding/journey/records/:id/payroll-setup/manual-actions/:code/complete', requirePermission('onboarding.payroll'), safe(async (req, res) => {
  const assignment = await loadAssignment(req, res); if (!assignment) return;
  const code = str(req.params.code, 60);
  if (!mapping.MANUAL_ACTIONS[code]) return notFound(res);
  const row = await xdb.getSync(assignment.id);
  if (!row) return notFound(res);
  const actions = (row.manual_actions || []).map((a) => (a.code === code ? { ...a, completedAt: new Date().toISOString(), completedBy: req.user.id } : a));
  if (!actions.some((a) => a.code === code)) return res.status(409).json({ error: 'That action is not on this record.', code: 'not_listed' });
  const patch = { manual_actions: actions };
  if (code === 'include_in_draft_pay_run' && row.next_pay_run_state === 'MANUAL_INCLUSION_REQUIRED') patch.state_reason = 'Manual inclusion recorded by the Owner; press Recheck Xero to confirm through the API.';
  if (code === 'create_super_fund' && row.state === 'MANUAL_XERO_ACTION_REQUIRED') Object.assign(patch, { state: 'APPROVED_FOR_XERO', state_reason: null });
  await xdb.updateSync(row.id, patch);
  await auditOnboarding(req, 'payroll_manual_action_completed', { targetType: 'onboarding_assignment', targetId: assignment.id, metadata: { assignmentId: assignment.id, syncId: row.id, manualAction: code } });
  res.json({ ok: true, payroll: await payrollSetupFor(assignment) });
}));

module.exports = router;
module.exports._internals = { payrollSetupFor, payrollRow, xeroView, cache };
