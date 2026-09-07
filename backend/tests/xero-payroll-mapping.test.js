'use strict';

/**
 * PAYROLL & XERO SETUP — the pure rules.
 *
 * Synthetic data only. Every payload assertion is against the field names and
 * enum values in the Xero Payroll AU OpenAPI 19.0.0 schema.
 */

const m = require('../xero-payroll-mapping');

const personal = { legal_first_name: 'Jane', middle_name: 'Ann', surname: 'Smith', date_of_birth: '1990-04-03', personal_email: 'jane@example.test', mobile: '0400000000', address_line1: '12 Wattle St', suburb: 'Fremantle', state: 'wa', postcode: '6160', country: 'Australia' };
const employment = { job_title: 'Occupational Therapist', employment_type: 'full_time', start_date: '2026-10-07', hours_per_week: 38 };
const assignment = { pay_basis: 'annual', pay_rate: 92000, hours_per_week: 38, applicant_email: 'jane@example.test' };
const payroll = {
  account_holder_name: 'Jane Smith', bsb_masked: '•••-•23', account_number_last4: '5678', bank_status: 'provided',
  tax_setup_status: 'employee_completed', residency_status: 'australian_resident', tfn_provided: true, tfn_last3: '123', claims_tax_free_threshold: true, has_study_loan: false, tax_submission_method: 'employer_electronic_form',
  super_status: 'employee_nominated', super_choice_type: 'apra_fund', super_fund_name: 'AustralianSuper', super_fund_abn: '65 714 394 898', super_fund_usi: 'STA0100AU', super_member_number: '99881234', super_account_name: 'Jane Smith',
};
const refs = {
  calendars: [{ PayrollCalendarID: 'cal-1', Name: 'Fortnightly', CalendarType: 'FORTNIGHTLY' }],
  earningsRates: [{ EarningsRateID: 'er-1', Name: 'Ordinary Hours' }],
  leaveTypes: [{ LeaveTypeID: 'lt-1', Name: 'Annual Leave' }],
  superFunds: [{ SuperFundID: 'sf-1', Type: 'REGULATED', Name: 'AustralianSuper', USI: 'STA0100AU', ABN: '65714394898' }],
};
const baseConfig = { employmentBasis: 'FULLTIME', payBasis: 'annual', annualSalary: 92000, unitsPerWeek: 38, earningsRateId: 'er-1', payrollCalendarId: 'cal-1', taxScaleType: 'REGULAR', jobTitle: 'OT' };

function snapshotFor(overrides = {}) {
  const { config } = m.validateConfig({ ...baseConfig, ...(overrides.config || {}) }, refs);
  return m.buildSnapshot({ assignment, personal: { ...personal, ...(overrides.personal || {}) }, employment, payroll: { ...payroll, ...(overrides.payroll || {}) }, config });
}

describe('state derivation', () => {
  test('follows the applicant through draft, submitted and review, then the sync row', () => {
    expect(m.deriveState({})).toBe('NOT_STARTED');
    expect(m.deriveState({ payroll: { bank_status: 'provided', tax_setup_status: 'not_started', super_status: 'not_started' } })).toBe('APPLICANT_DRAFT');
    expect(m.deriveState({ payroll, setup: { ready: false } })).toBe('APPLICANT_SUBMITTED');
    expect(m.deriveState({ payroll, setup: { ready: true } })).toBe('ADMIN_REVIEW');
    expect(m.deriveState({ payroll, setup: { ready: true, approved: true } })).toBe('APPROVED_FOR_XERO');
    expect(m.deriveState({ payroll, setup: { ready: true, approved: true }, sync: { state: 'SYNCED' } })).toBe('SYNCED');
    expect(m.deriveState({ payroll, setup: { ready: true }, sync: { state: 'CHANGES_REQUESTED' } })).toBe('CHANGES_REQUESTED');
  });
  test('every state has a label', () => {
    for (const s of m.STATES) expect(m.STATE_LABELS[s]).toBeTruthy();
  });
});

describe('configuration', () => {
  test('defaults come from the offer terms and residency, never invented', () => {
    const c = m.defaultConfig({ assignment, employment, personal, payroll });
    expect(c).toMatchObject({ employmentBasis: 'FULLTIME', payBasis: 'annual', annualSalary: 92000, unitsPerWeek: 38, taxScaleType: 'REGULAR', incomeType: 'SALARYANDWAGES', earningsRateId: null, payrollCalendarId: null });
    expect(m.defaultConfig({ payroll: { residency_status: 'working_holiday_maker' } })).toMatchObject({ incomeType: 'WORKINGHOLIDAYMAKER', taxScaleType: 'WORKINGHOLIDAYMAKER' });
  });
  test('validates enums, rates and ids against Xero', () => {
    expect(m.validateConfig(baseConfig, refs).errors).toEqual([]);
    expect(m.validateConfig({ ...baseConfig, employmentBasis: 'LABOURHIRE' }, refs).errors).toContain('Employment basis must be FULLTIME, PARTTIME or CASUAL');
    expect(m.validateConfig({ ...baseConfig, payBasis: 'hourly', hourlyRate: null }, refs).errors).toContain('An hourly rate is required');
    expect(m.validateConfig({ ...baseConfig, payrollCalendarId: 'nope' }, refs).errors).toContain('The chosen payroll calendar no longer exists in Xero');
    expect(m.validateConfig({ ...baseConfig, taxScaleType: 'MADEUP' }, refs).errors).toContain('Choose the tax scale type');
    expect(m.validateConfig({ ...baseConfig, leaveLines: [{ leaveTypeId: 'lt-1', calculationType: 'BASEDONORDINARYEARNINGS' }] }, refs).errors[0]).toMatch(/annual units and full-time units/);
    expect(m.validateConfig({ ...baseConfig, employmentType: 'CONTRACTOR' }, refs).errors[0]).toMatch(/contractors/);
  });
  test('names are filled from the reference lists', () => {
    const { config } = m.validateConfig({ ...baseConfig, leaveLines: [{ leaveTypeId: 'lt-1', annualNumberOfUnits: 152, fullTimeNumberOfUnitsPerPeriod: 76 }] }, refs);
    expect(config).toMatchObject({ payrollCalendarName: 'Fortnightly', calendarType: 'FORTNIGHTLY', earningsRateName: 'Ordinary Hours' });
    expect(config.leaveLines[0]).toMatchObject({ leaveTypeName: 'Annual Leave', calculationType: 'BASEDONORDINARYEARNINGS' });
  });
});

describe('snapshot', () => {
  test('carries masked values only, and validates the full address', () => {
    const s = snapshotFor();
    expect(JSON.stringify(s)).not.toMatch(/5678\d|STA0100AU-|99881234/);
    expect(s.bank).toEqual({ accountName: 'Jane Smith', bsbMasked: '•••-•23', accountLast4: '5678', statementText: 'Opal Therapy wages', remainder: true });
    expect(s.tax).toMatchObject({ residencyStatus: 'AUSTRALIANRESIDENT', australianResident: true, tfnProvided: true, tfnLast3: '123', tfnExemptionType: null, taxFreeThresholdClaimed: true });
    expect(s.super).toMatchObject({ choice: 'apra_fund', usi: 'STA0100AU', fundAbn: '65714394898', memberNumberMasked: '••••1234' });
    expect(s.identity.address).toMatchObject({ region: 'WA', postcode: '6160', country: 'Australia' });
    expect(m.validateSnapshot(s)).toEqual([]);
  });
  test('names what is missing, in Owner language', () => {
    const s = snapshotFor({ personal: { address_line1: null, state: 'Western Australia' }, payroll: { tfn_provided: false, super_choice_type: 'stapled' } });
    const errors = m.validateSnapshot(s);
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/home address is incomplete/), 'The home address needs an Australian state or territory',
      expect.stringMatching(/No tax file number was provided/), expect.stringMatching(/stapled fund/),
    ]));
  });
  test('a TFN exemption chosen by the Owner satisfies the tax check', () => {
    const s = snapshotFor({ payroll: { tfn_provided: false, tfn_last3: null }, config: { tfnExemptionType: 'PENDING' } });
    expect(m.validateSnapshot(s)).toEqual([]);
    expect(s.tax.tfnExemptionType).toBe('PENDING');
  });
  test('a working holiday maker needs the matching income type', () => {
    const s = snapshotFor({ payroll: { residency_status: 'working_holiday_maker' }, config: { taxScaleType: 'WORKINGHOLIDAYMAKER' } });
    expect(m.validateSnapshot(s)).toContain('A working holiday maker must have the WORKINGHOLIDAYMAKER income type');
  });
});

describe('payloads', () => {
  const s = snapshotFor();
  test('create is minimal and uses the schema names', () => {
    expect(m.buildCreatePayload(s)).toEqual({
      FirstName: 'Jane', LastName: 'Smith', MiddleNames: 'Ann', DateOfBirth: '1990-04-03',
      HomeAddress: { AddressLine1: '12 Wattle St', City: 'Fremantle', Region: 'WA', PostalCode: '6160', Country: 'Australia' },
      StartDate: '2026-10-07', Email: 'jane@example.test', Mobile: '0400000000', JobTitle: 'OT',
    });
  });
  test('configuration carries bank, tax declaration and super membership; the TFN comes only from secrets', () => {
    const p = m.buildConfigurationPayload(s, { tfn: '123 456 123', bsb: '062-123', accountNumber: '12345678' }, { superFundId: 'sf-1', superMemberNumber: '99881234' });
    expect(p).toMatchObject({ PayrollCalendarID: 'cal-1', OrdinaryEarningsRateID: 'er-1', EmploymentType: 'EMPLOYEE', IncomeType: 'SALARYANDWAGES' });
    expect(p.BankAccounts).toEqual([{ StatementText: 'Opal Therapy wages', AccountName: 'Jane Smith', BSB: '062123', AccountNumber: '12345678', Remainder: true }]);
    expect(p.TaxDeclaration).toEqual({ EmploymentBasis: 'FULLTIME', AustralianResidentForTaxPurposes: true, ResidencyStatus: 'AUSTRALIANRESIDENT', TaxScaleType: 'REGULAR', TaxFreeThresholdClaimed: true, HasLoanOrStudentDebt: false, EligibleToReceiveLeaveLoading: false, TaxFileNumber: '123456123' });
    expect(p.SuperMemberships).toEqual([{ SuperFundID: 'sf-1', EmployeeNumber: '99881234' }]);
    const exempt = m.buildConfigurationPayload(snapshotFor({ payroll: { tfn_provided: false }, config: { tfnExemptionType: 'UNDER18' } }), { bsb: '1', accountNumber: '2' }, {});
    expect(exempt.TaxDeclaration.TFNExemptionType).toBe('UNDER18');
    expect(exempt.TaxDeclaration.TaxFileNumber).toBeUndefined();
    expect(exempt.SuperMemberships).toBeUndefined();
  });
  test('pay template: annual salary, statutory super, leave', () => {
    const withLeave = snapshotFor({ config: { leaveLines: [{ leaveTypeId: 'lt-1', annualNumberOfUnits: 152, fullTimeNumberOfUnitsPerPeriod: 76 }] } });
    expect(m.buildPayTemplatePayload(withLeave, { superMembershipId: 'sm-1' })).toEqual({ PayTemplate: {
      EarningsLines: [{ EarningsRateID: 'er-1', CalculationType: 'ANNUALSALARY', AnnualSalary: 92000, NumberOfUnitsPerWeek: 38 }],
      SuperLines: [{ SuperMembershipID: 'sm-1', ContributionType: 'SGC', CalculationType: 'STATUTORY' }],
      LeaveLines: [{ LeaveTypeID: 'lt-1', CalculationType: 'BASEDONORDINARYEARNINGS', AnnualNumberOfUnits: 152, FullTimeNumberOfUnitsPerPeriod: 76 }],
    } });
  });
  test('pay template: hourly casual has a rate and no forced units', () => {
    const casual = snapshotFor({ config: { employmentBasis: 'CASUAL', payBasis: 'hourly', hourlyRate: 38.5, annualSalary: null, unitsPerWeek: null } });
    expect(m.buildPayTemplatePayload(casual, { superMembershipId: 'sm-1' }).PayTemplate.EarningsLines).toEqual([{ EarningsRateID: 'er-1', CalculationType: 'ENTEREARNINGSRATE', RatePerUnit: 38.5 }]);
  });
  test('super fund payloads: regulated by USI from the verified product, SMSF from the profile and secrets', () => {
    expect(m.buildSuperFundPayload(s, {}, { ProductName: 'AustralianSuper', ABN: '65714394898', USI: 'STA0100AU' })).toEqual({ Type: 'REGULATED', Name: 'AustralianSuper', ABN: '65714394898', USI: 'STA0100AU' });
    const smsf = snapshotFor({ payroll: { super_choice_type: 'smsf', super_fund_name: 'Smith Family SMSF', super_fund_abn: '11 111 111 111', smsf_esa: 'SMSFDataFlow', smsf_bank_account_name: 'Smith SMSF', smsf_bank_bsb_masked: '•••-•99', smsf_bank_account_last4: '4321' } });
    expect(m.buildSuperFundPayload(smsf, { smsfBsb: '033-099', smsfAccountNumber: '00004321' })).toEqual({ Type: 'SMSF', Name: 'Smith Family SMSF', ABN: '11111111111', ElectronicServiceAddress: 'SMSFDataFlow', AccountName: 'Smith SMSF', BSB: '033099', AccountNumber: '00004321' });
    expect(m.validateSnapshot(smsf)).toEqual([]);
  });
  test('idempotency keys are stable and within 128 characters', () => {
    const k = m.idempotencyKey('0f1e2d3c-0000-4000-8000-000000000000', 'create');
    expect(k).toBe('opal-payroll-0f1e2d3c-0000-4000-8000-000000000000-create');
    expect(m.idempotencyKey('x'.repeat(200), 'create').length).toBe(128);
  });
});

describe('matching', () => {
  const s = snapshotFor();
  test('super fund reuse by USI (regulated), ABN (SMSF), id (default)', () => {
    expect(m.matchSuperFund(s, refs.superFunds).SuperFundID).toBe('sf-1');
    expect(m.matchSuperFund(snapshotFor({ payroll: { super_fund_usi: 'OTHER' } }), refs.superFunds)).toBeNull();
    expect(m.matchSuperFund(snapshotFor({ payroll: { super_choice_type: 'employer_default' }, config: { defaultSuperFundId: 'sf-1' } }), refs.superFunds).SuperFundID).toBe('sf-1');
  });
  test('duplicates: name + DOB or email, with Xero /Date()/ dates', () => {
    const employees = [
      { EmployeeID: 'e-1', FirstName: 'JANE', LastName: 'smith', DateOfBirth: '/Date(639100800000+0000)/', Email: 'other@example.test', Status: 'ACTIVE' },
      { EmployeeID: 'e-2', FirstName: 'Bob', LastName: 'Jones', DateOfBirth: '1980-01-01', Email: 'JANE@example.test' },
      { EmployeeID: 'e-3', FirstName: 'Jane', LastName: 'Smith', DateOfBirth: '1991-01-01', Email: 'x@example.test' },
    ];
    const d = m.findDuplicates(employees, s);
    expect(d.map((x) => [x.employeeId, x.reasons])).toEqual([['e-1', ['same legal name and date of birth']], ['e-2', ['same email address']]]);
  });
});

describe('read-back verification', () => {
  const s = snapshotFor();
  const good = {
    EmployeeID: 'e-1', Status: 'ACTIVE', FirstName: 'Jane', LastName: 'Smith', DateOfBirth: '/Date(639100800000+0000)/', StartDate: '/Date(1791331200000+0000)/', Email: 'jane@example.test',
    PayrollCalendarID: 'cal-1', OrdinaryEarningsRateID: 'er-1', IsSTP2Qualified: true,
    PayTemplate: { EarningsLines: [{ EarningsRateID: 'er-1', CalculationType: 'ANNUALSALARY', AnnualSalary: 92000 }], SuperLines: [{ SuperMembershipID: 'sm-1', ContributionType: 'SGC', CalculationType: 'STATUTORY' }] },
    BankAccounts: [{ AccountNumber: '12345678', Remainder: true }], TaxDeclaration: { EmploymentBasis: 'FULLTIME', TaxFileNumber: '123456123', TaxFreeThresholdClaimed: true },
    SuperMemberships: [{ SuperMembershipID: 'sm-1', SuperFundID: 'sf-1' }],
  };
  test('passes when every configured field is present', () => {
    const v = m.verifyReadBack(good, s, { superMembershipId: 'sm-1', bankLast4: '5678' });
    expect(v.ok).toBe(true);
    expect(v.stp2Qualified).toBe(true);
    expect(JSON.stringify(v)).not.toContain('12345678');
    expect(JSON.stringify(v)).not.toContain('123456123');
  });
  test('reports each mismatch and does not treat HTTP 200 as success', () => {
    const v = m.verifyReadBack({ ...good, PayrollCalendarID: 'other', PayTemplate: { EarningsLines: [{ EarningsRateID: 'er-1', CalculationType: 'ANNUALSALARY', AnnualSalary: 90000 }] }, IsSTP2Qualified: false }, s, { superMembershipId: 'sm-1' });
    expect(v.ok).toBe(false);
    const failed = v.checks.filter((c) => !c.ok).map((c) => c.key);
    expect(failed).toEqual(expect.arrayContaining(['calendar', 'pay_template', 'super_line', 'stp2']));
    expect(m.verifyReadBack(null, s).ok).toBe(false);
  });
  test('STP2 is informational, never blocking', () => {
    expect(m.verifyReadBack({ ...good, IsSTP2Qualified: false }, s, { superMembershipId: 'sm-1' }).ok).toBe(true);
  });
});

describe('next pay run readiness', () => {
  const start = '2026-10-07';
  test('no relevant pay run → ready for the next regular pay run', () => {
    expect(m.payRunReadiness([], { employeeId: 'e-1', startDate: start }).state).toBe('READY_FOR_NEXT_PAY_RUN');
    expect(m.payRunReadiness([{ PayRunID: 'p0', PayRunStatus: 'POSTED', PayRunPeriodStartDate: '2026-09-07', PayRunPeriodEndDate: '2026-09-20' }], { employeeId: 'e-1', startDate: start }).state).toBe('READY_FOR_NEXT_PAY_RUN');
  });
  test('draft including the employee → included; draft without → manual inclusion', () => {
    const draft = { PayRunID: 'p1', PayRunStatus: 'DRAFT', PayRunPeriodStartDate: '2026-10-05', PayRunPeriodEndDate: '2026-10-18', PaymentDate: '2026-10-21', Payslips: [{ EmployeeID: 'e-1' }] };
    expect(m.payRunReadiness([draft], { employeeId: 'e-1', startDate: start })).toMatchObject({ state: 'INCLUDED_IN_DRAFT', payRunId: 'p1', period: { start: '2026-10-05', end: '2026-10-18' } });
    expect(m.payRunReadiness([{ ...draft, Payslips: [] }], { employeeId: 'e-1', startDate: start }).state).toBe('MANUAL_INCLUSION_REQUIRED');
  });
  test('a posted pay run covering the start date is escalated, never altered', () => {
    const posted = { PayRunID: 'p2', PayRunStatus: 'POSTED', PayRunPeriodStartDate: '2026-10-05', PayRunPeriodEndDate: '2026-10-18', Payslips: [] };
    expect(m.payRunReadiness([posted], { employeeId: 'e-1', startDate: start }).state).toBe('POSTED_PAY_RUN_REVIEW');
    expect(m.payRunReadiness([{ ...posted, Payslips: [{ EmployeeID: 'e-1' }] }], { employeeId: 'e-1', startDate: start }).state).toBe('READY_FOR_NEXT_PAY_RUN');
  });
  test('manual actions are named precisely and never duplicated', () => {
    const a = m.manualActionsFor({ nextPayRunState: 'MANUAL_INCLUSION_REQUIRED' });
    expect(a.map((x) => x.code)).toEqual(['include_in_draft_pay_run', 'invite_to_xero_me']);
    expect(m.manualActionsFor({ nextPayRunState: 'INCLUDED_IN_DRAFT', existing: a }).map((x) => x.code)).toEqual(['include_in_draft_pay_run', 'invite_to_xero_me']);
    for (const x of a) expect(x.text).toBeTruthy();
  });
});
