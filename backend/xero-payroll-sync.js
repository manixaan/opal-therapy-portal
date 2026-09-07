'use strict';

/**
 * PAYROLL & XERO SETUP — the orchestration.
 *
 * One approved snapshot → one employee in Xero, verified by reading it back.
 * Each run is a sequence of explicit, resumable steps; every step records
 * what it did on the sync row before moving on, so a retry after a crash or
 * a timeout picks up from the identifiers already captured rather than
 * repeating a write. Xero's Idempotency-Key backs that up on its side.
 *
 *   1. guards           flag, state, snapshot
 *   2. reference data   calendars, pay items, super funds — ids re-validated
 *   3. duplicate check  stored EmployeeID first, then name+DOB / email
 *   4. super fund       reuse by USI/ABN, create if authorised, else stop
 *   5. create           POST /Employees (minimal)            → EmployeeID
 *   6. configure        POST /Employees/{id}: calendar, rate, types, bank,
 *                       tax declaration, super membership
 *   7. membership id    GET /Employees/{id}                  → SuperMembershipID
 *   8. pay template     POST /Employees/{id}: earnings, statutory super, leave
 *   9. read-back        GET /Employees/{id} compared with the snapshot
 *  10. pay runs         GET /PayRuns for the calendar → readiness
 *
 * Secrets (TFN, BSB, account number, SMSF bank details) are decrypted by the
 * caller through the audited export path, handed in as `secrets`, used to
 * build two request bodies, and never stored, logged or returned.
 *
 * Injectable dependencies keep it unit-testable without Xero:
 *   createPayrollSync({ api, db, flags, logger })
 */

const mapping = require('./xero-payroll-mapping');

const RETRY_DELAY_MS = [60, 300, 900, 1800].map((s) => s * 1000);

function createPayrollSync({ api, db, flags, logger, connection }) {
  const log = logger || { info() {}, warn() {}, error() {} };

  function opLogger(sync, actorId, method, resource) {
    return ({ attempt, httpStatus, outcome, errorCode, errorMessage, xeroId, step }) =>
      db.recordOperation({
        syncId: sync.id, operationId: sync.operation_id, attempt, step: step || resource, method, resource,
        idempotencyKey: null, httpStatus, outcome, errorCode, errorMessage, xeroId, actorId,
      }).catch((err) => log.warn('operation log write failed', { error: err }));
  }

  async function fail(sync, err, step, actorId) {
    const safe = typeof err.toSafe === 'function' ? err.toSafe() : { code: err.code || 'INTERNAL', message: 'The sync stopped unexpectedly', validationMessages: [], retryable: false };
    const retryable = !!safe.retryable;
    const attempt = Number(sync.attempt_count || 1);
    const patch = {
      state: retryable ? 'SYNC_FAILED_RETRYABLE' : 'SYNC_FAILED_ACTION_REQUIRED',
      last_step: step, last_error_code: safe.code, last_error_message: String(safe.message || '').slice(0, 500),
      validation_messages: safe.validationMessages || [],
      retry_after: retryable ? new Date(Date.now() + RETRY_DELAY_MS[Math.min(attempt - 1, RETRY_DELAY_MS.length - 1)]) : null,
      state_reason: retryable ? 'Xero was unavailable or rate-limited; retry after the delay.' : (safe.validationMessages && safe.validationMessages[0]) || safe.message,
    };
    log[retryable ? 'warn' : 'error']('payroll sync failed', { syncId: sync.id, step, code: safe.code, httpStatus: safe.httpStatus, retryable });
    return db.updateSync(sync.id, patch);
  }

  /** Reference data for the Owner's configuration screen. Non-sensitive; cached briefly by the route. */
  async function referenceData() {
    const [calendars, payItems, superFunds] = await Promise.all([api.getPayrollCalendars(), api.getPayItems(), api.getSuperFunds()]);
    return {
      calendars: calendars.map((c) => ({ id: c.PayrollCalendarID, name: c.Name, calendarType: c.CalendarType, startDate: mapping.isoDate(c.StartDate), paymentDate: mapping.isoDate(c.PaymentDate) })),
      earningsRates: payItems.earningsRates.filter((r) => r.CurrentRecord !== false).map((r) => ({ id: r.EarningsRateID, name: r.Name, rateType: r.RateType, earningsType: r.EarningsType })),
      leaveTypes: payItems.leaveTypes.filter((l) => l.CurrentRecord !== false).map((l) => ({ id: l.LeaveTypeID, name: l.Name, normalEntitlement: l.NormalEntitlement, typeOfUnits: l.TypeOfUnits, isPaidLeave: l.IsPaidLeave })),
      superFunds: superFunds.map((f) => ({ id: f.SuperFundID, name: f.Name, type: f.Type, usi: f.USI || null, abn: f.ABN || null })),
      raw: { calendars, earningsRates: payItems.earningsRates, leaveTypes: payItems.leaveTypes, superFunds },
    };
  }

  /**
   * Resolve the super fund: an existing organisation fund, a new one when the
   * scope is granted, or a stop.
   * @returns {{ fundId?: string, stop?: object }}
   */
  async function resolveSuperFund(sync, snapshot, secrets, funds, actorId) {
    const existing = mapping.matchSuperFund(snapshot, funds);
    if (existing) return { fundId: existing.SuperFundID };
    const su = snapshot.super;
    if (su.choice === 'employer_default') return { stop: { state: 'SYNC_FAILED_ACTION_REQUIRED', reason: 'The configured employer default fund was not found in Xero. Choose it again from the Xero list.' } };
    let product = null;
    if (su.choice === 'apra_fund') {
      const products = await api.getSuperFundProducts({ usi: su.usi });
      product = products.find((p) => String(p.USI || '').toUpperCase() === String(su.usi).toUpperCase()) || null;
      if (!product) return { stop: { state: 'SYNC_FAILED_ACTION_REQUIRED', reason: `Xero does not recognise USI ${su.usi}. Check the fund details with the employee.` } };
      if (su.fundAbn && product.ABN && mapping.normName(product.ABN) !== mapping.normName(su.fundAbn)) {
        return { stop: { state: 'SYNC_FAILED_ACTION_REQUIRED', reason: `The fund ABN the employee gave does not match Xero's record for USI ${su.usi}.` } };
      }
    }
    if (!flags.isPayrollSuperFundCreateEnabled()) {
      return { stop: { state: 'MANUAL_XERO_ACTION_REQUIRED', reason: `${su.fundName || 'The employee\'s super fund'} is not set up in this Xero organisation, and creating funds from the portal is not enabled.`, manualAction: 'create_super_fund' } };
    }
    const payload = mapping.buildSuperFundPayload(snapshot, secrets, product);
    const fund = await api.createSuperFund(payload, { idempotencyKey: mapping.idempotencyKey(sync.operation_id, 'superfund'), onAttempt: opLogger(sync, actorId, 'POST', '/Superfunds') });
    if (!fund || !fund.SuperFundID) throw new api.XeroPayrollError('Xero did not return a super fund id', { code: 'XERO_NO_ID', step: 'create_superfund' });
    return { fundId: fund.SuperFundID };
  }

  /** Query the calendar's pay runs and decide readiness. Reads only. */
  async function checkPayRuns(sync, snapshot) {
    const runs = await api.getPayRunsForCalendar(snapshot.employment.payrollCalendarId);
    const start = snapshot.employment.startDate;
    const relevant = runs.filter((p) => mapping.isoDate(p.PayRunPeriodEndDate) >= start);
    const detailed = [];
    for (const p of relevant.slice(0, 6)) {
      const full = await api.getPayRun(p.PayRunID);
      detailed.push(full || p);
    }
    return mapping.payRunReadiness(detailed, { employeeId: sync.xero_employee_id, startDate: start });
  }

  /**
   * Run (or resume) the sync for one record.
   * @param {object} sync      payroll_xero_sync row
   * @param {object} p
   * @param {object} p.secrets { tfn, bsb, accountNumber, smsfBsb, smsfAccountNumber, superMemberNumber }
   * @param {string} p.actorId
   */
  async function run(sync, { secrets = {}, actorId = null } = {}) {
    if (!flags.isPayrollSyncEnabled()) {
      const err = new Error('Creating employees in Xero is disabled (ENABLE_XERO_WRITE and ENABLE_XERO_PAYROLL_SYNC must both be true)');
      err.code = 'PAYROLL_SYNC_DISABLED'; err.statusCode = 403; throw err;
    }
    if (!mapping.SYNC_STARTABLE_STATES.includes(sync.state)) {
      const err = new Error(`The sync cannot start from state ${sync.state}`);
      err.code = 'SYNC_NOT_STARTABLE'; err.statusCode = 409; throw err;
    }
    const snapshot = sync.approved_snapshot;
    if (!snapshot || !sync.operation_id) {
      const err = new Error('There is no approved snapshot to send'); err.code = 'NO_SNAPSHOT'; err.statusCode = 409; throw err;
    }
    const snapErrors = mapping.validateSnapshot(snapshot);
    if (snapErrors.length) {
      return db.updateSync(sync.id, { state: 'SYNC_FAILED_ACTION_REQUIRED', last_step: 'validate', last_error_code: 'SNAPSHOT_INVALID', last_error_message: snapErrors[0], validation_messages: snapErrors, state_reason: snapErrors[0] });
    }

    sync = await db.updateSync(sync.id, { state: 'SYNC_IN_PROGRESS', attempt_count: Number(sync.attempt_count || 0) + 1, last_attempt_at: new Date(), last_attempt_by: actorId, retry_after: null, last_error_code: null, last_error_message: null, validation_messages: [], state_reason: null });
    let step = 'reference';
    try {
      // 2. Reference data and id re-validation.
      const refs = await referenceData();
      // Re-validate what the SNAPSHOT says against Xero's current lists — the snapshot is what will be sent.
      const { errors: cfgErrors } = mapping.validateConfig({
        ...(sync.config || {}), ...snapshot.employment, leaveLines: snapshot.employment.leaveLines,
        taxScaleType: snapshot.tax.taxScaleType, tfnExemptionType: snapshot.tax.tfnExemptionType,
        eligibleToReceiveLeaveLoading: snapshot.tax.eligibleToReceiveLeaveLoading, upwardVariationTaxWithholdingAmount: snapshot.tax.upwardVariationTaxWithholdingAmount,
        statementText: snapshot.bank.statementText, defaultSuperFundId: snapshot.super.defaultSuperFundId, payrollEmail: snapshot.identity.email,
      }, refs.raw);
      if (cfgErrors.length) {
        return db.updateSync(sync.id, { state: 'SYNC_FAILED_ACTION_REQUIRED', last_step: step, last_error_code: 'CONFIG_INVALID', last_error_message: cfgErrors[0], validation_messages: cfgErrors, state_reason: cfgErrors[0] });
      }
      try {
        const conn = await connection.getConnection();
        sync = await db.updateSync(sync.id, { xero_tenant_id_suffix: String(conn.tenantId).slice(-6) });
      } catch (_) { /* recorded for the screen only */ }

      // 3. Duplicate check.
      step = 'duplicate_check';
      if (!sync.xero_employee_id) {
        let skipCheck = false;
        if (sync.duplicate_resolution === 'link_existing' && sync.duplicate_candidates && sync.duplicate_candidates.linkedEmployeeId) {
          sync = await db.updateSync(sync.id, { xero_employee_id: sync.duplicate_candidates.linkedEmployeeId });
          skipCheck = true;
        } else if (sync.duplicate_resolution === 'create_new') {
          skipCheck = true;
        }
        if (!skipCheck) {
          const employees = await api.getEmployees();
          const dups = mapping.findDuplicates(employees, snapshot);
          if (dups.length) {
            // A create that timed out may already have succeeded: adopt an exact match rather than duplicating it.
            const unconfirmed = await db.hasUnconfirmedCreate(sync.id, sync.operation_id);
            const exact = dups.filter((d) => d.reasons.includes('same legal name and date of birth'));
            if (unconfirmed && exact.length === 1) {
              sync = await db.updateSync(sync.id, { xero_employee_id: exact[0].employeeId, state_reason: 'An earlier create attempt had already succeeded in Xero; the record was adopted.' });
              log.info('adopted employee from an unconfirmed create', { syncId: sync.id });
            } else {
              return db.updateSync(sync.id, { state: 'POSSIBLE_DUPLICATE', last_step: step, duplicate_candidates: { candidates: dups, checkedAt: new Date().toISOString() }, state_reason: `${dups.length} existing Xero employee${dups.length === 1 ? '' : 's'} could be the same person. Decide before continuing.` });
            }
          }
        }
      }

      // 4. Super fund.
      step = 'super_fund';
      let superFundId = sync.xero_super_fund_id;
      if (!superFundId) {
        const r = await resolveSuperFund(sync, snapshot, secrets, refs.raw.superFunds, actorId);
        if (r.stop) {
          const manual = [...(sync.manual_actions || [])];
          if (r.stop.manualAction && !manual.some((a) => a.code === r.stop.manualAction)) manual.push({ code: r.stop.manualAction, text: mapping.MANUAL_ACTIONS[r.stop.manualAction], completedAt: null, completedBy: null });
          return db.updateSync(sync.id, { state: r.stop.state, last_step: step, last_error_code: 'SUPER_FUND_UNRESOLVED', last_error_message: r.stop.reason, state_reason: r.stop.reason, manual_actions: manual });
        }
        superFundId = r.fundId;
        sync = await db.updateSync(sync.id, { xero_super_fund_id: superFundId });
      }

      // 5. Create.
      step = 'create_employee';
      if (!sync.xero_employee_id) {
        const created = await api.createEmployee(mapping.buildCreatePayload(snapshot), { idempotencyKey: mapping.idempotencyKey(sync.operation_id, 'create'), onAttempt: opLogger(sync, actorId, 'POST', '/Employees') });
        if (!created || !created.EmployeeID) throw new api.XeroPayrollError('Xero did not return an employee id', { code: 'XERO_NO_ID', step });
        sync = await db.updateSync(sync.id, { xero_employee_id: created.EmployeeID });
        await db.recordOperation({ syncId: sync.id, operationId: sync.operation_id, attempt: sync.attempt_count, step, method: 'POST', resource: '/Employees', idempotencyKey: mapping.idempotencyKey(sync.operation_id, 'create'), httpStatus: 200, outcome: 'ok', xeroId: created.EmployeeID, actorId });
      }
      const employeeId = sync.xero_employee_id;

      // 6. Configure.
      step = 'configure_employee';
      // Identity fields are re-sent with the configuration so a LINKED existing employee ends up matching the approved set too.
      const configure = { ...mapping.buildCreatePayload(snapshot), ...mapping.buildConfigurationPayload(snapshot, secrets, { superFundId, superMemberNumber: secrets.superMemberNumber || null }) };
      await api.updateEmployee(employeeId, configure, { idempotencyKey: mapping.idempotencyKey(sync.operation_id, `configure-${sync.snapshot_version}`), step, onAttempt: opLogger(sync, actorId, 'POST', `/Employees/{id}`) });
      sync = await db.updateSync(sync.id, { xero_payroll_calendar_id: snapshot.employment.payrollCalendarId, xero_earnings_rate_id: snapshot.employment.earningsRateId, last_step: step });

      // 7. Membership id.
      step = 'super_membership';
      let emp = await api.getEmployee(employeeId, { step });
      const membership = ((emp && emp.SuperMemberships) || []).find((m) => m.SuperFundID === superFundId);
      if (!membership || !membership.SuperMembershipID) throw new api.XeroPayrollError('Xero did not record the super membership', { code: 'XERO_NO_MEMBERSHIP', step });
      sync = await db.updateSync(sync.id, { xero_super_membership_id: membership.SuperMembershipID });

      // 8. Pay template.
      step = 'pay_template';
      await api.updateEmployee(employeeId, mapping.buildPayTemplatePayload(snapshot, { superMembershipId: membership.SuperMembershipID }), { idempotencyKey: mapping.idempotencyKey(sync.operation_id, `paytemplate-${sync.snapshot_version}`), step, onAttempt: opLogger(sync, actorId, 'POST', `/Employees/{id}`) });
      sync = await db.updateSync(sync.id, { xero_leave_type_ids: (snapshot.employment.leaveLines || []).map((l) => l.leaveTypeId), last_step: step });

      // 9. Read-back.
      step = 'read_back';
      emp = await api.getEmployee(employeeId, { step });
      const verification = mapping.verifyReadBack(emp, snapshot, { superMembershipId: membership.SuperMembershipID, bankLast4: snapshot.bank.accountLast4 });
      if (!verification.ok) {
        const failed = verification.checks.filter((c) => !c.ok && c.key !== 'stp2').map((c) => c.label);
        return db.updateSync(sync.id, { state: 'SYNC_FAILED_ACTION_REQUIRED', last_step: step, last_error_code: 'READ_BACK_MISMATCH', last_error_message: `Read-back did not match: ${failed.join(', ')}`, verification, state_reason: `Xero's record does not match the approved set: ${failed.join(', ')}.` });
      }

      // 10. Pay runs.
      step = 'pay_run_check';
      const readiness = await checkPayRuns(sync, snapshot);
      const manual = mapping.manualActionsFor({ nextPayRunState: readiness.state, existing: sync.manual_actions || [] });
      sync = await db.updateSync(sync.id, {
        state: 'SYNCED', next_pay_run_state: readiness.state, xero_pay_run_id: readiness.payRunId, verification, manual_actions: manual,
        synced_at: new Date(), last_recheck_at: new Date(), last_step: 'done', last_error_code: null, last_error_message: null, state_reason: null,
      });
      await db.markProfileConfigured(sync.user_id, employeeId, actorId);
      log.info('payroll sync verified', { syncId: sync.id, nextPayRun: readiness.state });
      return sync;
    } catch (err) {
      return fail(sync, err, step, actorId);
    }
  }

  /** Re-read the employee and the pay runs without writing anything. */
  async function recheck(sync) {
    if (!sync.xero_employee_id || !sync.approved_snapshot) {
      const err = new Error('Nothing to recheck: the employee has not been created in Xero'); err.code = 'NOT_SYNCED'; err.statusCode = 409; throw err;
    }
    try {
      const emp = await api.getEmployee(sync.xero_employee_id, { step: 'recheck' });
      const verification = mapping.verifyReadBack(emp, sync.approved_snapshot, { superMembershipId: sync.xero_super_membership_id, bankLast4: sync.approved_snapshot.bank.accountLast4 });
      const readiness = await checkPayRuns(sync, sync.approved_snapshot);
      const merged = mapping.manualActionsFor({ nextPayRunState: readiness.state, existing: sync.manual_actions || [] });
      if (readiness.state === 'INCLUDED_IN_DRAFT') for (const a of merged) if (a.code === 'include_in_draft_pay_run' && !a.completedAt) { a.completedAt = new Date().toISOString(); a.completedBy = 'xero'; }
      return db.updateSync(sync.id, {
        verification, next_pay_run_state: readiness.state, xero_pay_run_id: readiness.payRunId, manual_actions: merged, last_recheck_at: new Date(),
        ...(sync.state === 'SYNCED' && !verification.ok ? { state: 'SYNC_FAILED_ACTION_REQUIRED', last_error_code: 'READ_BACK_MISMATCH', last_error_message: 'The Xero record no longer matches the approved set', state_reason: 'The Xero record no longer matches the approved set.' } : {}),
      });
    } catch (err) {
      return fail(sync, err, 'recheck', null);
    }
  }

  return { run, recheck, referenceData, checkPayRuns, resolveSuperFund };
}

module.exports = { createPayrollSync, RETRY_DELAY_MS };
