'use strict';

/**
 * PAYROLL SETUP — routes. A review of gathered information, then one approval.
 *
 *   GET  …/payroll-setup          the set, line by line, and whether it is ready
 *   POST …/payroll-setup/approve  the Owner approves; refused while anything is missing or in conflict
 */

const express = require('express');
const router = express.Router();

const odb = require('./onboarding-db');
const rdb = require('./onboarding-returns-db');
const sync = require('./onboarding-profile-sync');
const payrollRules = require('./onboarding-payroll');
const { auditOnboarding } = require('./onboarding-audit');
const { requireAuth, requirePermission } = require('./permissions');
const log = require('./logger').createLogger('onboarding-payroll');

const orgOf = (req) => req.user?.organisation_id || null;
const { isUuid } = odb;
const safe = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  log.error('payroll route error', { error: err, path: req.path });
  if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
});
const notFound = (res) => res.status(404).json({ error: 'Not found' });

async function payrollRow(userId) {
  if (!userId) return null;
  const { rows } = await odb.pool.query(
    `SELECT p.bank_status, p.bank_verified_at, p.tax_setup_status, p.super_status, p.payroll_setup_status,
            p.payroll_approved_at, u.name AS payroll_approved_by_name
       FROM payroll_profiles p LEFT JOIN users u ON u.id = p.payroll_approved_by WHERE p.user_id = $1`, [userId]
  );
  return rows[0] || null;
}

/** The payroll set for a record. Shared with the record screen. */
async function payrollSetupFor(assignment) {
  const [profile, fields, payroll] = await Promise.all([
    sync.profileSummary(assignment.user_id), rdb.listResolved(assignment.id), payrollRow(assignment.user_id),
  ]);
  return payrollRules.buildPayrollSetup({
    profile, payroll, assignment,
    fields: fields.map((f) => ({ key: f.field_key, outcome: f.outcome, status: f.status })),
  });
}

router.use('/api/onboarding/journey', requireAuth);

router.get('/api/onboarding/journey/records/:id/payroll-setup', requirePermission('onboarding.payroll'), safe(async (req, res) => {
  if (!isUuid(req.params.id)) return notFound(res);
  const assignment = await odb.getAssignment(orgOf(req), req.params.id);
  if (!assignment) return notFound(res);
  await auditOnboarding(req, 'payroll_setup_viewed', { targetType: 'onboarding_assignment', targetId: assignment.id, metadata: { assignmentId: assignment.id } });
  res.json({ ok: true, payroll: await payrollSetupFor(assignment) });
}));

router.post('/api/onboarding/journey/records/:id/payroll-setup/approve', requirePermission('onboarding.payroll'), safe(async (req, res) => {
  if (!isUuid(req.params.id)) return notFound(res);
  const assignment = await odb.getAssignment(orgOf(req), req.params.id);
  if (!assignment) return notFound(res);
  if (!assignment.user_id) return res.status(409).json({ error: 'No profile exists for this person yet.', code: 'no_user' });
  const setup = await payrollSetupFor(assignment);
  if (!setup.ready) {
    return res.status(409).json({ error: 'Payroll cannot proceed until every line is ready.', code: 'not_ready', blockers: setup.blockers, payroll: setup });
  }
  // Bank details are approved with the set; the payroll set-up task is told what to do.
  await rdb.approvePayroll(assignment.user_id, req.user.id);
  await odb.pool.query(
    `UPDATE payroll_profiles SET payroll_approved_at = NOW(), payroll_approved_by = $2,
            payroll_setup_status = CASE WHEN payroll_setup_status = 'not_required' THEN 'setup_required' ELSE payroll_setup_status END,
            payroll_system = COALESCE(payroll_system, 'xero'), updated_at = NOW(), updated_by = $2
      WHERE user_id = $1`, [assignment.user_id, req.user.id]
  );
  try {
    const jdb = require('./onboarding-journey-db');
    await jdb.setTaskStatus(assignment.id, 'payroll_setup', { status: 'in_progress', actorId: req.user.id, note: 'Payroll set approved — create the employee in Xero from the approved details (integration not connected).' });
  } catch (_) { /* the task may not exist on older records */ }
  await auditOnboarding(req, 'payroll_setup_approved', { targetType: 'user', targetId: assignment.user_id, metadata: { assignmentId: assignment.id, lines: setup.total } });
  res.json({ ok: true, payroll: await payrollSetupFor(assignment) });
}));

module.exports = router;
module.exports._internals = { payrollSetupFor, payrollRow };
