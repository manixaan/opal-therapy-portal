'use strict';

/**
 * PAYROLL & XERO SETUP — the orchestration, with Xero and the database
 * replaced by in-memory fakes. Synthetic data only.
 *
 * Covers: the salaried and hourly happy paths, regulated fund reuse and
 * creation, SMSF, duplicate detection, retryable vs action-required
 * failures, idempotent retry after a timeout that had already created the
 * employee, read-back mismatch, and every next-pay-run outcome.
 */

const { createPayrollSync } = require('../xero-payroll-sync');
const mapping = require('../xero-payroll-mapping');
const { XeroPayrollError } = require('../xero-payroll-api');

const refs = {
  calendars: [{ PayrollCalendarID: 'cal-1', Name: 'Fortnightly', CalendarType: 'FORTNIGHTLY' }],
  earningsRates: [{ EarningsRateID: 'er-1', Name: 'Ordinary Hours', CurrentRecord: true }],
  leaveTypes: [{ LeaveTypeID: 'lt-1', Name: 'Annual Leave', CurrentRecord: true }],
  superFunds: [{ SuperFundID: 'sf-1', Type: 'REGULATED', Name: 'AustralianSuper', USI: 'STA0100AU', ABN: '65714394898' }],
};
const personal = { legal_first_name: 'Jane', surname: 'Smith', date_of_birth: '1990-04-03', personal_email: 'jane@example.test', mobile: '0400000000', address_line1: '12 Wattle St', suburb: 'Fremantle', state: 'WA', postcode: '6160' };
const employment = { job_title: 'OT', employment_type: 'full_time', start_date: '2026-10-07' };
const assignment = { pay_basis: 'annual', pay_rate: 92000, hours_per_week: 38, applicant_email: 'jane@example.test' };
const payroll = {
  account_holder_name: 'Jane Smith', bsb_masked: '•••-•23', account_number_last4: '5678', bank_status: 'provided',
  tax_setup_status: 'employee_completed', residency_status: 'australian_resident', tfn_provided: true, tfn_last3: '123', claims_tax_free_threshold: true, has_study_loan: false,
  super_status: 'employee_nominated', super_choice_type: 'apra_fund', super_fund_name: 'AustralianSuper', super_fund_abn: '65714394898', super_fund_usi: 'STA0100AU', super_member_number: '99881234',
};
const secrets = { tfn: '123456123', bsb: '062123', accountNumber: '12345678', superMemberNumber: '99881234' };

function snapshot(overrides = {}) {
  const { config } = mapping.validateConfig({ employmentBasis: 'FULLTIME', payBasis: 'annual', annualSalary: 92000, unitsPerWeek: 38, earningsRateId: 'er-1', payrollCalendarId: 'cal-1', taxScaleType: 'REGULAR', ...(overrides.config || {}) }, refs);
  return mapping.buildSnapshot({ assignment, personal, employment, payroll: { ...payroll, ...(overrides.payroll || {}) }, config });
}

/** An in-memory Xero that behaves like the real one for these flows. */
function fakeXero({ employees = [], funds = refs.superFunds, payRuns = [], products = [{ ABN: '65714394898', USI: 'STA0100AU', ProductName: 'AustralianSuper' }], failures = {} } = {}) {
  const store = { employees: employees.map((e) => ({ ...e })), funds: funds.map((f) => ({ ...f })), payRuns, calls: [], created: 0 };
  const fail = (step) => { const f = failures[step]; if (f) { if (typeof f === 'function') return f(); throw f; } return null; };
  const api = {
    XeroPayrollError,
    getPayrollCalendars: async () => refs.calendars,
    getPayItems: async () => ({ earningsRates: refs.earningsRates, leaveTypes: refs.leaveTypes }),
    getSuperFunds: async () => store.funds,
    getSuperFundProducts: async () => products,
    getEmployees: async () => { store.calls.push('getEmployees'); return store.employees; },
    getEmployee: async (id) => { store.calls.push(`getEmployee:${id}`); return store.employees.find((e) => e.EmployeeID === id) || null; },
    createEmployee: async (payload, { idempotencyKey }) => {
      store.calls.push(`createEmployee:${idempotencyKey}`);
      const f = fail('create'); if (f) return f;
      store.created++;
      const emp = { EmployeeID: `e-${store.created}`, Status: 'ACTIVE', ...payload };
      store.employees.push(emp);
      return emp;
    },
    updateEmployee: async (id, patch, { idempotencyKey, step }) => {
      store.calls.push(`updateEmployee:${step}:${idempotencyKey}`);
      fail(step);
      const emp = store.employees.find((e) => e.EmployeeID === id);
      Object.assign(emp, patch);
      if (patch.SuperMemberships) emp.SuperMemberships = patch.SuperMemberships.map((m, i) => ({ ...m, SuperMembershipID: `sm-${i + 1}` }));
      if (patch.PayTemplate) emp.PayTemplate = patch.PayTemplate;
      if (patch.TaxDeclaration) emp.IsSTP2Qualified = true;
      return emp;
    },
    createSuperFund: async (fund, { idempotencyKey }) => {
      store.calls.push(`createSuperFund:${idempotencyKey}`);
      const f = { SuperFundID: `sf-new-${store.funds.length}`, ...fund };
      store.funds.push(f);
      return f;
    },
    getPayRunsForCalendar: async () => store.payRuns,
    getPayRun: async (id) => store.payRuns.find((p) => p.PayRunID === id) || null,
  };
  return { api, store };
}

/** An in-memory payroll_xero_sync + operations table. */
function fakeDb(row) {
  const state = { row: { manual_actions: [], attempt_count: 0, snapshot_version: 1, ...row }, ops: [], profile: null };
  return {
    state,
    updateSync: async (id, patch) => { Object.assign(state.row, patch); return { ...state.row }; },
    recordOperation: async (op) => { state.ops.push(op); },
    hasUnconfirmedCreate: async () => state.ops.some((o) => o.step === 'create_employee' && o.outcome !== 'ok'),
    markProfileConfigured: async (userId, employeeId) => { state.profile = { userId, employeeId }; },
  };
}

const flagsOn = { isPayrollSyncEnabled: () => true, isPayrollSuperFundCreateEnabled: () => false };
const connection = { getConnection: async () => ({ tenantId: 'tenant-abcdef' }) };
const baseRow = (s = snapshot()) => ({ id: 'sync-1', user_id: 'user-1', state: 'APPROVED_FOR_XERO', operation_id: 'op-1', approved_snapshot: s, config: s.employment });

describe('happy paths', () => {
  test('salaried full-time: create → configure → membership → pay template → read-back → ready for next pay run', async () => {
    const { api, store } = fakeXero();
    const db = fakeDb(baseRow());
    const svc = createPayrollSync({ api, db, flags: flagsOn, connection });
    const out = await svc.run(db.state.row, { secrets, actorId: 'owner' });
    expect(out.state).toBe('SYNCED');
    expect(out.next_pay_run_state).toBe('READY_FOR_NEXT_PAY_RUN');
    expect(out).toMatchObject({ xero_employee_id: 'e-1', xero_super_fund_id: 'sf-1', xero_super_membership_id: 'sm-1', xero_payroll_calendar_id: 'cal-1', xero_earnings_rate_id: 'er-1', xero_tenant_id_suffix: 'abcdef' });
    expect(out.verification.ok).toBe(true);
    expect(out.manual_actions.map((a) => a.code)).toEqual(['invite_to_xero_me']);
    expect(store.calls).toEqual(['getEmployees', 'createEmployee:opal-payroll-op-1-create', 'updateEmployee:configure_employee:opal-payroll-op-1-configure-1', 'getEmployee:e-1', 'updateEmployee:pay_template:opal-payroll-op-1-paytemplate-1', 'getEmployee:e-1']);
    expect(db.state.profile).toEqual({ userId: 'user-1', employeeId: 'e-1' });
    const emp = store.employees[0];
    expect(emp.TaxDeclaration.TaxFileNumber).toBe('123456123');
    expect(emp.BankAccounts[0]).toMatchObject({ BSB: '062123', AccountNumber: '12345678', Remainder: true });
    expect(emp.PayTemplate.EarningsLines[0]).toMatchObject({ CalculationType: 'ANNUALSALARY', AnnualSalary: 92000 });
    expect(emp.PayTemplate.SuperLines[0]).toEqual({ SuperMembershipID: 'sm-1', ContributionType: 'SGC', CalculationType: 'STATUTORY' });
    // Nothing secret on the stored row or in the operation log.
    expect(JSON.stringify([db.state.row, db.state.ops])).not.toMatch(/123456123|12345678|062123/);
  });
  test('hourly casual with no fixed hours', async () => {
    const s = snapshot({ config: { employmentBasis: 'CASUAL', payBasis: 'hourly', hourlyRate: 38.5, annualSalary: null, unitsPerWeek: null } });
    const { api, store } = fakeXero();
    const db = fakeDb(baseRow(s));
    const out = await createPayrollSync({ api, db, flags: flagsOn, connection }).run(db.state.row, { secrets });
    expect(out.state).toBe('SYNCED');
    expect(store.employees[0].PayTemplate.EarningsLines[0]).toEqual({ EarningsRateID: 'er-1', CalculationType: 'ENTEREARNINGSRATE', RatePerUnit: 38.5 });
  });
});

describe('super funds', () => {
  test('a regulated fund missing from Xero stops for manual action when creation is not enabled', async () => {
    const { api, store } = fakeXero({ funds: [] });
    const db = fakeDb(baseRow());
    const out = await createPayrollSync({ api, db, flags: flagsOn, connection }).run(db.state.row, { secrets });
    expect(out.state).toBe('MANUAL_XERO_ACTION_REQUIRED');
    expect(out.manual_actions.map((a) => a.code)).toEqual(['create_super_fund']);
    expect(store.created).toBe(0);
  });
  test('…and is created through POST /Superfunds with the verified USI when enabled', async () => {
    const { api, store } = fakeXero({ funds: [] });
    const db = fakeDb(baseRow());
    const out = await createPayrollSync({ api, db, flags: { ...flagsOn, isPayrollSuperFundCreateEnabled: () => true }, connection }).run(db.state.row, { secrets });
    expect(out.state).toBe('SYNCED');
    expect(store.funds[0]).toMatchObject({ Type: 'REGULATED', USI: 'STA0100AU', ABN: '65714394898', Name: 'AustralianSuper' });
    expect(store.calls).toContain('createSuperFund:opal-payroll-op-1-superfund');
  });
  test('an unrecognised USI is an action-required stop, not a guess', async () => {
    const { api } = fakeXero({ funds: [], products: [] });
    const db = fakeDb(baseRow());
    const out = await createPayrollSync({ api, db, flags: { ...flagsOn, isPayrollSuperFundCreateEnabled: () => true }, connection }).run(db.state.row, { secrets });
    expect(out.state).toBe('SYNC_FAILED_ACTION_REQUIRED');
    expect(out.last_error_message).toMatch(/does not recognise USI/);
  });
  test('SMSF is created with Type SMSF from the profile and the decrypted bank details', async () => {
    const s = snapshot({ payroll: { super_choice_type: 'smsf', super_fund_name: 'Smith SMSF', super_fund_abn: '11111111111', super_fund_usi: null, smsf_esa: 'SMSFDataFlow', smsf_bank_account_name: 'Smith SMSF', smsf_bank_bsb_masked: '•••-•99', smsf_bank_account_last4: '4321' } });
    const { api, store } = fakeXero({ funds: [] });
    const db = fakeDb(baseRow(s));
    const out = await createPayrollSync({ api, db, flags: { ...flagsOn, isPayrollSuperFundCreateEnabled: () => true }, connection }).run(db.state.row, { secrets: { ...secrets, smsfBsb: '033099', smsfAccountNumber: '00004321' } });
    expect(out.state).toBe('SYNCED');
    expect(store.funds[0]).toEqual(expect.objectContaining({ Type: 'SMSF', ABN: '11111111111', ElectronicServiceAddress: 'SMSFDataFlow', BSB: '033099', AccountNumber: '00004321' }));
  });
});

describe('duplicates and idempotency', () => {
  test('an existing employee with the same name and DOB stops the sync before any write', async () => {
    const { api, store } = fakeXero({ employees: [{ EmployeeID: 'e-old', FirstName: 'Jane', LastName: 'Smith', DateOfBirth: '/Date(639100800000+0000)/', Status: 'TERMINATED' }] });
    const db = fakeDb(baseRow());
    const out = await createPayrollSync({ api, db, flags: flagsOn, connection }).run(db.state.row, { secrets });
    expect(out.state).toBe('POSSIBLE_DUPLICATE');
    expect(out.duplicate_candidates.candidates[0]).toMatchObject({ employeeId: 'e-old', reasons: ['same legal name and date of birth'] });
    expect(store.created).toBe(0);
  });
  test('link_existing continues against the chosen employee; create_new skips the check', async () => {
    const existing = { EmployeeID: 'e-old', FirstName: 'Jane', LastName: 'Smith', DateOfBirth: '1990-04-03', Status: 'ACTIVE' };
    let x = fakeXero({ employees: [existing] });
    let db = fakeDb({ ...baseRow(), duplicate_resolution: 'link_existing', duplicate_candidates: { candidates: [{ employeeId: 'e-old' }], linkedEmployeeId: 'e-old' } });
    let out = await createPayrollSync({ api: x.api, db, flags: flagsOn, connection }).run(db.state.row, { secrets });
    expect(out.state).toBe('SYNCED'); expect(out.xero_employee_id).toBe('e-old'); expect(x.store.created).toBe(0);
    x = fakeXero({ employees: [existing] });
    db = fakeDb({ ...baseRow(), duplicate_resolution: 'create_new' });
    out = await createPayrollSync({ api: x.api, db, flags: flagsOn, connection }).run(db.state.row, { secrets });
    expect(out.state).toBe('SYNCED'); expect(out.xero_employee_id).toBe('e-1'); expect(x.store.calls).not.toContain('getEmployees');
  });
  test('a retry after a timed-out create adopts the employee Xero already made, and reuses the same keys', async () => {
    let first = true;
    const { api, store } = fakeXero({ failures: { create: () => { if (first) { first = false; store.created++; store.employees.push({ EmployeeID: 'e-1', Status: 'ACTIVE', FirstName: 'Jane', LastName: 'Smith', DateOfBirth: '1990-04-03' }); throw new XeroPayrollError('timed out', { code: 'XERO_TIMEOUT', retryable: true, step: 'create_employee' }); } return null; } } });
    const db = fakeDb(baseRow());
    const svc = createPayrollSync({ api, db, flags: flagsOn, connection });
    db.state.ops.push({ step: 'create_employee', outcome: 'timeout' }); // what the hook would have written
    let out = await svc.run(db.state.row, { secrets });
    expect(out.state).toBe('SYNC_FAILED_RETRYABLE');
    expect(out.retry_after).toBeInstanceOf(Date);
    expect(out.xero_employee_id).toBeUndefined();
    out = await svc.run(db.state.row, { secrets });
    expect(out.state).toBe('SYNCED');
    expect(out.xero_employee_id).toBe('e-1');
    expect(store.created).toBe(1);
    expect(store.calls.filter((c) => c.startsWith('createEmployee'))).toEqual(['createEmployee:opal-payroll-op-1-create']);
    expect(out.attempt_count).toBe(2);
  });
});

describe('failures', () => {
  test('a validation error from Xero is action-required with the safe messages', async () => {
    const { api } = fakeXero({ failures: { configure_employee: new XeroPayrollError('Xero rejected the request', { code: 'XERO_VALIDATION', httpStatus: 400, validationMessages: ['BSB is invalid'], step: 'configure_employee' }) } });
    const db = fakeDb(baseRow());
    const out = await createPayrollSync({ api, db, flags: flagsOn, connection }).run(db.state.row, { secrets });
    expect(out).toMatchObject({ state: 'SYNC_FAILED_ACTION_REQUIRED', last_step: 'configure_employee', last_error_code: 'XERO_VALIDATION', validation_messages: ['BSB is invalid'], retry_after: null });
    expect(out.xero_employee_id).toBe('e-1'); // kept, so the retry updates rather than re-creates
  });
  test('a read-back mismatch is never reported as synced', async () => {
    const { api } = fakeXero();
    const orig = api.getEmployee;
    let n = 0;
    api.getEmployee = async (id) => { const e = await orig(id); n++; return n === 2 ? { ...e, PayrollCalendarID: 'someone-changed-it' } : e; };
    const db = fakeDb(baseRow());
    const out = await createPayrollSync({ api, db, flags: flagsOn, connection }).run(db.state.row, { secrets });
    expect(out.state).toBe('SYNC_FAILED_ACTION_REQUIRED');
    expect(out.last_error_code).toBe('READ_BACK_MISMATCH');
    expect(out.verification.checks.find((c) => c.key === 'calendar').ok).toBe(false);
  });
  test('the flag and the state are enforced before anything is decrypted or sent', async () => {
    const { api, store } = fakeXero();
    const db = fakeDb(baseRow());
    await expect(createPayrollSync({ api, db, flags: { ...flagsOn, isPayrollSyncEnabled: () => false }, connection }).run(db.state.row, { secrets })).rejects.toMatchObject({ code: 'PAYROLL_SYNC_DISABLED', statusCode: 403 });
    await expect(createPayrollSync({ api, db, flags: flagsOn, connection }).run({ ...db.state.row, state: 'ADMIN_REVIEW' }, { secrets })).rejects.toMatchObject({ code: 'SYNC_NOT_STARTABLE' });
    expect(store.calls).toEqual([]);
  });
  test('an invalid snapshot never reaches Xero', async () => {
    const s = snapshot(); s.identity.address.line1 = null;
    const { api, store } = fakeXero();
    const db = fakeDb(baseRow(s));
    const out = await createPayrollSync({ api, db, flags: flagsOn, connection }).run(db.state.row, { secrets });
    expect(out.state).toBe('SYNC_FAILED_ACTION_REQUIRED');
    expect(out.last_error_code).toBe('SNAPSHOT_INVALID');
    expect(store.calls).toEqual([]);
  });
});

describe('next pay run', () => {
  const draft = { PayRunID: 'p1', PayRunStatus: 'DRAFT', PayrollCalendarID: 'cal-1', PayRunPeriodStartDate: '2026-10-05', PayRunPeriodEndDate: '2026-10-18', PaymentDate: '2026-10-21', Payslips: [] };
  test('employee missing from an existing draft → manual action, with no unsupported API call', async () => {
    const { api, store } = fakeXero({ payRuns: [draft] });
    const db = fakeDb(baseRow());
    const out = await createPayrollSync({ api, db, flags: flagsOn, connection }).run(db.state.row, { secrets });
    expect(out.state).toBe('SYNCED');
    expect(out.next_pay_run_state).toBe('MANUAL_INCLUSION_REQUIRED');
    expect(out.xero_pay_run_id).toBe('p1');
    expect(out.manual_actions.map((a) => a.code)).toEqual(['include_in_draft_pay_run', 'invite_to_xero_me']);
    expect(store.calls.some((c) => /createPayRun|updatePayRun|Payslip/.test(c))).toBe(false);
  });
  test('employee already in the draft → included; a posted run → escalated; recheck clears the manual action once Xero confirms', async () => {
    const x = fakeXero({ payRuns: [{ ...draft, Payslips: [{ EmployeeID: 'e-1' }] }] });
    let db = fakeDb(baseRow());
    let out = await createPayrollSync({ api: x.api, db, flags: flagsOn, connection }).run(db.state.row, { secrets });
    expect(out.next_pay_run_state).toBe('INCLUDED_IN_DRAFT');
    const y = fakeXero({ payRuns: [{ ...draft, PayRunStatus: 'POSTED' }] });
    db = fakeDb(baseRow());
    out = await createPayrollSync({ api: y.api, db, flags: flagsOn, connection }).run(db.state.row, { secrets });
    expect(out.next_pay_run_state).toBe('POSTED_PAY_RUN_REVIEW');
    expect(out.manual_actions.map((a) => a.code)).toContain('posted_pay_run_review');
    // Owner adds them in Xero, then rechecks.
    const z = fakeXero({ payRuns: [draft] });
    db = fakeDb(baseRow());
    const svc = createPayrollSync({ api: z.api, db, flags: flagsOn, connection });
    out = await svc.run(db.state.row, { secrets });
    expect(out.next_pay_run_state).toBe('MANUAL_INCLUSION_REQUIRED');
    z.store.payRuns[0].Payslips = [{ EmployeeID: 'e-1' }];
    out = await svc.recheck(db.state.row);
    expect(out.next_pay_run_state).toBe('INCLUDED_IN_DRAFT');
    expect(out.manual_actions.find((a) => a.code === 'include_in_draft_pay_run').completedAt).toBeTruthy();
    expect(out.state).toBe('SYNCED');
  });
});
