'use strict';

/**
 * PAYROLL & XERO SETUP — the pure rules.
 *
 * No I/O. Given what onboarding gathered, what the Owner configured and what
 * Xero answered, this module decides: which state the stage is in, whether
 * the set is valid to send, what the Xero payloads are, whether a candidate
 * employee is a duplicate, whether the read-back matches, and whether the
 * employee will be picked up by the next regular pay run.
 *
 * Field names, enums and calculation types come from the Xero Payroll AU
 * OpenAPI 19.0.0 schema (Employee, HomeAddress, BankAccount, TaxDeclaration,
 * PayTemplate/EarningsLine/SuperLine/LeaveLine, SuperMembership, SuperFund,
 * PayRun). Nothing is guessed: an enum value not in the schema is a
 * validation error here, before a request is built.
 *
 * SECRETS. Only buildCreatePayload/buildConfigurationPayload ever see a TFN,
 * BSB or account number, and only through the `secrets` argument. The
 * snapshot, the verification result and every error message are built from
 * masked values.
 */

const STATES = Object.freeze([
  'NOT_STARTED', 'APPLICANT_DRAFT', 'APPLICANT_SUBMITTED', 'ADMIN_REVIEW', 'APPROVED_FOR_XERO',
  'SYNC_IN_PROGRESS', 'SYNCED', 'CHANGES_REQUESTED', 'SYNC_FAILED_RETRYABLE',
  'SYNC_FAILED_ACTION_REQUIRED', 'POSSIBLE_DUPLICATE', 'MANUAL_XERO_ACTION_REQUIRED',
]);
const STATE_LABELS = Object.freeze({
  NOT_STARTED: 'Not started', APPLICANT_DRAFT: 'Employee is entering details', APPLICANT_SUBMITTED: 'Details submitted',
  ADMIN_REVIEW: 'Ready for your review', APPROVED_FOR_XERO: 'Approved for Xero', SYNC_IN_PROGRESS: 'Creating in Xero',
  SYNCED: 'Payroll configuration verified', CHANGES_REQUESTED: 'Changes requested from the employee',
  SYNC_FAILED_RETRYABLE: 'Xero sync failed — can be retried', SYNC_FAILED_ACTION_REQUIRED: 'Xero sync failed — action required',
  POSSIBLE_DUPLICATE: 'Possible duplicate in Xero', MANUAL_XERO_ACTION_REQUIRED: 'Manual action required in Xero',
});
// States that mean "the applicant's data is locked and Xero work has begun or finished".
const POST_APPROVAL_STATES = Object.freeze(['APPROVED_FOR_XERO', 'SYNC_IN_PROGRESS', 'SYNCED', 'SYNC_FAILED_RETRYABLE', 'SYNC_FAILED_ACTION_REQUIRED', 'POSSIBLE_DUPLICATE', 'MANUAL_XERO_ACTION_REQUIRED']);
const SYNC_STARTABLE_STATES = Object.freeze(['APPROVED_FOR_XERO', 'SYNC_FAILED_RETRYABLE', 'SYNC_FAILED_ACTION_REQUIRED', 'POSSIBLE_DUPLICATE', 'MANUAL_XERO_ACTION_REQUIRED']);

const NEXT_PAY_RUN_LABELS = Object.freeze({
  UNKNOWN: 'Not checked yet', READY_FOR_NEXT_PAY_RUN: 'Ready for next regular pay run', INCLUDED_IN_DRAFT: 'Included in draft pay run',
  MANUAL_INCLUSION_REQUIRED: 'Manual inclusion in existing draft required', POSTED_PAY_RUN_REVIEW: 'Pay run already posted — payroll review required',
});

const MANUAL_ACTIONS = Object.freeze({
  include_in_draft_pay_run: 'Open the current draft pay run in Xero and add this employee, then press Recheck Xero.',
  invite_to_xero_me: 'If the employee should see payslips online, invite them to Xero Me from Xero using their payroll email. The API cannot do this.',
  create_super_fund: 'Add the employee\'s super fund in Xero (Payroll settings → Superannuation), then press Retry sync.',
  posted_pay_run_review: 'A pay run covering the start date is already posted. Review with payroll before any adjustment; nothing was changed.',
  stapled_fund_lookup: 'The employee asked for their stapled fund. Request it from the ATO, record the fund on the onboarding record, then approve again.',
});

const PRIVACY_NOTICE_VERSION = 'payroll-xero-2026-09';

// ── Xero enums (OpenAPI 19.0.0) ─────────────────────────────────────────────
const E = Object.freeze({
  EmploymentBasis: ['FULLTIME', 'PARTTIME', 'CASUAL', 'LABOURHIRE', 'SUPERINCOMESTREAM', 'NONEMPLOYEE'],
  EmploymentType: ['EMPLOYEE', 'CONTRACTOR'],
  IncomeType: ['SALARYANDWAGES', 'WORKINGHOLIDAYMAKER', 'NONEMPLOYEE', 'CLOSELYHELDPAYEES', 'LABOURHIRE'],
  TFNExemptionType: ['NOTQUOTED', 'PENDING', 'PENSIONER', 'UNDER18'],
  ResidencyStatus: ['AUSTRALIANRESIDENT', 'FOREIGNRESIDENT', 'WORKINGHOLIDAYMAKER'],
  TaxScaleType: ['REGULAR', 'ACTORSARTISTSENTERTAINERS', 'HORTICULTURISTORSHEARER', 'SENIORORPENSIONER', 'WORKINGHOLIDAYMAKER', 'FOREIGN'],
  SeniorMaritalStatus: ['MEMBEROFCOUPLE', 'MEMBEROFILLNESSSEPARATEDCOUPLE', 'SINGLE'],
  WorkCondition: ['PROMOTIONAL', 'THREELESSPERFORMANCESPERWEEK', 'NONE'],
  EarningsRateCalculationType: ['USEEARNINGSRATE', 'ENTEREARNINGSRATE', 'ANNUALSALARY'],
  LeaveLineCalculationType: ['NOCALCULATIONREQUIRED', 'FIXEDAMOUNTEACHPERIOD', 'ENTERRATEINPAYTEMPLATE', 'BASEDONORDINARYEARNINGS'],
  State: ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'],
  CalendarType: ['WEEKLY', 'FORTNIGHTLY', 'FOURWEEKLY', 'MONTHLY', 'TWICEMONTHLY', 'QUARTERLY'],
});

const EMPLOYMENT_BASIS_FROM_TYPE = Object.freeze({ full_time: 'FULLTIME', part_time: 'PARTTIME', casual: 'CASUAL', fixed_term: 'FULLTIME' });
const RESIDENCY_FROM_PROFILE = Object.freeze({ australian_resident: 'AUSTRALIANRESIDENT', foreign_resident: 'FOREIGNRESIDENT', working_holiday_maker: 'WORKINGHOLIDAYMAKER' });
const TAX_SCALE_FROM_RESIDENCY = Object.freeze({ australian_resident: 'REGULAR', foreign_resident: 'FOREIGN', working_holiday_maker: 'WORKINGHOLIDAYMAKER' });
const INCOME_FROM_RESIDENCY = Object.freeze({ australian_resident: 'SALARYANDWAGES', foreign_resident: 'SALARYANDWAGES', working_holiday_maker: 'WORKINGHOLIDAYMAKER' });

// ── helpers ─────────────────────────────────────────────────────────────────
const str = (v, max = 200) => (v === null || v === undefined ? null : String(v).trim().slice(0, max) || null);
const digits = (v) => String(v || '').replace(/\D/g, '');
const isoDate = (v) => {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  const m = s.match(/\/Date\((-?\d+)(?:[+-]\d{4})?\)\//); // Payroll AU responses use /Date(ms)/
  if (m) return new Date(Number(m[1])).toISOString().slice(0, 10);
  return s.slice(0, 10);
};
const normName = (v) => String(v || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const normEmail = (v) => String(v || '').trim().toLowerCase();
const last4 = (v) => { const d = String(v || ''); return d.length >= 4 ? d.slice(-4) : d; };
const maskMember = (v) => (v ? '••••' + last4(v) : null);
const uuidLike = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));
const money = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

// ── 1. State ────────────────────────────────────────────────────────────────

/**
 * The stage's state. Post-approval states are stored on the sync row; before
 * approval the state is DERIVED from what the applicant has supplied and
 * whether the Owner's review set is ready, so it is always truthful.
 */
function deriveState({ sync = null, payroll = null, setup = null } = {}) {
  if (sync && (POST_APPROVAL_STATES.includes(sync.state) || sync.state === 'CHANGES_REQUESTED')) return sync.state;
  if (setup && setup.approved) return 'APPROVED_FOR_XERO';
  if (!payroll) return 'NOT_STARTED';
  const bank = payroll.bank_status && payroll.bank_status !== 'not_started';
  const tax = payroll.tax_setup_status && !['not_started', 'employee_action_required'].includes(payroll.tax_setup_status);
  const sup = payroll.super_status && payroll.super_status !== 'not_started';
  if (bank && tax && sup) return setup && setup.ready ? 'ADMIN_REVIEW' : 'APPLICANT_SUBMITTED';
  if (bank || tax || sup) return 'APPLICANT_DRAFT';
  return 'NOT_STARTED';
}

// ── 2. Configuration ────────────────────────────────────────────────────────

/** A starting configuration from the offer terms and the profile. Owner confirms every line. */
function defaultConfig({ assignment = {}, employment = {}, personal = {}, payroll = {} } = {}) {
  const type = employment.employment_type || assignment.employment_type || null;
  const residency = payroll.residency_status || null;
  return {
    employeeNumber: null,
    jobTitle: employment.job_title || assignment.job_title || null,
    employmentBasis: EMPLOYMENT_BASIS_FROM_TYPE[type] || null,
    employmentType: 'EMPLOYEE',
    incomeType: INCOME_FROM_RESIDENCY[residency] || 'SALARYANDWAGES',
    payBasis: employment.pay_basis || assignment.pay_basis || null,
    annualSalary: (employment.pay_basis || assignment.pay_basis) === 'annual' ? money(employment.pay_rate != null ? employment.pay_rate : assignment.pay_rate) : null,
    hourlyRate: (employment.pay_basis || assignment.pay_basis) === 'hourly' ? money(employment.pay_rate != null ? employment.pay_rate : assignment.pay_rate) : null,
    unitsPerWeek: assignment.hours_per_week != null ? Number(assignment.hours_per_week) : (employment.hours_per_week != null ? Number(employment.hours_per_week) : null),
    earningsRateId: null, earningsRateName: null,
    payrollCalendarId: null, payrollCalendarName: null, calendarType: null,
    employeeGroupName: null,
    leaveLines: [],
    taxScaleType: TAX_SCALE_FROM_RESIDENCY[residency] || null,
    tfnExemptionType: null,
    eligibleToReceiveLeaveLoading: false,
    upwardVariationTaxWithholdingAmount: null,
    statementText: 'Opal Therapy wages',
    payrollEmail: null,
    defaultSuperFundId: null,
    warnings: type === 'fixed_term' ? ['Fixed-term maps to FULLTIME for Xero; choose PARTTIME if the hours are part-time.'] : [],
  };
}

/**
 * Validate and normalise the Owner's configuration. `refs` (calendars,
 * earnings rates, leave types, super funds from Xero) makes id checks real;
 * without it only shape and enum checks run.
 */
function validateConfig(input = {}, refs = null) {
  const errors = [];
  const c = {
    employeeNumber: str(input.employeeNumber, 60),
    jobTitle: str(input.jobTitle, 150),
    employmentBasis: str(input.employmentBasis, 30),
    employmentType: str(input.employmentType, 20) || 'EMPLOYEE',
    incomeType: str(input.incomeType, 30) || 'SALARYANDWAGES',
    payBasis: str(input.payBasis, 10),
    annualSalary: money(input.annualSalary),
    hourlyRate: money(input.hourlyRate),
    unitsPerWeek: money(input.unitsPerWeek),
    earningsRateId: str(input.earningsRateId, 60), earningsRateName: str(input.earningsRateName, 100),
    payrollCalendarId: str(input.payrollCalendarId, 60), payrollCalendarName: str(input.payrollCalendarName, 100), calendarType: str(input.calendarType, 20),
    employeeGroupName: str(input.employeeGroupName, 100),
    leaveLines: Array.isArray(input.leaveLines) ? input.leaveLines.slice(0, 10).map((l) => ({
      leaveTypeId: str(l && l.leaveTypeId, 60), leaveTypeName: str(l && l.leaveTypeName, 100),
      calculationType: str(l && l.calculationType, 40) || 'BASEDONORDINARYEARNINGS',
      annualNumberOfUnits: money(l && l.annualNumberOfUnits), fullTimeNumberOfUnitsPerPeriod: money(l && l.fullTimeNumberOfUnitsPerPeriod),
    })) : [],
    taxScaleType: str(input.taxScaleType, 40),
    tfnExemptionType: str(input.tfnExemptionType, 20),
    eligibleToReceiveLeaveLoading: input.eligibleToReceiveLeaveLoading === true,
    upwardVariationTaxWithholdingAmount: money(input.upwardVariationTaxWithholdingAmount),
    statementText: str(input.statementText, 18) || 'Opal Therapy wages',
    payrollEmail: str(input.payrollEmail, 255),
    defaultSuperFundId: str(input.defaultSuperFundId, 60),
  };
  if (!E.EmploymentBasis.includes(c.employmentBasis) || ['LABOURHIRE', 'SUPERINCOMESTREAM', 'NONEMPLOYEE'].includes(c.employmentBasis)) errors.push('Employment basis must be FULLTIME, PARTTIME or CASUAL');
  if (c.employmentType !== 'EMPLOYEE') errors.push('Only EMPLOYEE is supported for onboarding; contractors are not set up through payroll');
  if (!['SALARYANDWAGES', 'WORKINGHOLIDAYMAKER'].includes(c.incomeType)) errors.push('Income type must be SALARYANDWAGES or WORKINGHOLIDAYMAKER');
  if (!['annual', 'hourly'].includes(c.payBasis)) errors.push('Pay basis must be annual or hourly');
  if (c.payBasis === 'annual' && !(c.annualSalary > 0)) errors.push('An annual salary is required');
  if (c.payBasis === 'hourly' && !(c.hourlyRate > 0)) errors.push('An hourly rate is required');
  if (c.payBasis === 'annual' && !(c.unitsPerWeek > 0)) errors.push('Ordinary hours per week are required for a salary');
  if (c.unitsPerWeek != null && (c.unitsPerWeek < 0 || c.unitsPerWeek > 168)) errors.push('Ordinary hours per week must be between 0 and 168');
  if (!c.earningsRateId) errors.push('Choose the Xero ordinary earnings rate');
  if (!c.payrollCalendarId) errors.push('Choose the Xero payroll calendar');
  if (!E.TaxScaleType.includes(c.taxScaleType)) errors.push('Choose the tax scale type');
  if (c.tfnExemptionType && !E.TFNExemptionType.includes(c.tfnExemptionType)) errors.push('TFN exemption type is not one Xero accepts');
  if (c.upwardVariationTaxWithholdingAmount != null && c.upwardVariationTaxWithholdingAmount < 0) errors.push('Additional withholding cannot be negative');
  if (c.payrollEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.payrollEmail)) errors.push('The payroll email does not look like an email address');
  for (const l of c.leaveLines) {
    if (!l.leaveTypeId) errors.push('A leave line is missing its leave type');
    if (!E.LeaveLineCalculationType.includes(l.calculationType)) errors.push('A leave line has a calculation type Xero does not accept');
    if (l.calculationType === 'BASEDONORDINARYEARNINGS' && !(l.annualNumberOfUnits > 0 && l.fullTimeNumberOfUnitsPerPeriod > 0)) errors.push(`Leave line ${l.leaveTypeName || l.leaveTypeId}: annual units and full-time units per period are required`);
  }
  if (refs) {
    if (c.payrollCalendarId && !(refs.calendars || []).some((x) => x.PayrollCalendarID === c.payrollCalendarId)) errors.push('The chosen payroll calendar no longer exists in Xero');
    if (c.earningsRateId && !(refs.earningsRates || []).some((x) => x.EarningsRateID === c.earningsRateId)) errors.push('The chosen earnings rate no longer exists in Xero');
    for (const l of c.leaveLines) if (l.leaveTypeId && !(refs.leaveTypes || []).some((x) => x.LeaveTypeID === l.leaveTypeId)) errors.push('A chosen leave type no longer exists in Xero');
    const cal = (refs.calendars || []).find((x) => x.PayrollCalendarID === c.payrollCalendarId);
    if (cal) { c.payrollCalendarName = cal.Name || c.payrollCalendarName; c.calendarType = cal.CalendarType || c.calendarType; }
    const er = (refs.earningsRates || []).find((x) => x.EarningsRateID === c.earningsRateId);
    if (er) c.earningsRateName = er.Name || c.earningsRateName;
    for (const l of c.leaveLines) { const lt = (refs.leaveTypes || []).find((x) => x.LeaveTypeID === l.leaveTypeId); if (lt) l.leaveTypeName = lt.Name || l.leaveTypeName; }
  }
  return { errors, config: c };
}

// ── 3. The approved snapshot ────────────────────────────────────────────────

/**
 * Everything non-secret that will be sent, plus masked forms of what is
 * secret. This is what the Owner approves, what read-back is compared to,
 * and what is stored.
 */
function buildSnapshot({ assignment = {}, personal = {}, employment = {}, payroll = {}, config = {} } = {}) {
  const residency = payroll.residency_status || null;
  const startDate = isoDate(employment.start_date || assignment.start_date);
  return {
    version: 1,
    identity: {
      firstName: str(personal.legal_first_name, 100), middleNames: str(personal.middle_name, 100), lastName: str(personal.surname, 100),
      dateOfBirth: isoDate(personal.date_of_birth),
      email: config.payrollEmail || str(personal.personal_email, 255) || str(assignment.applicant_email, 255),
      personalEmail: str(personal.personal_email, 255) || str(assignment.applicant_email, 255),
      mobile: str(personal.mobile, 40),
      address: {
        line1: str(personal.address_line1, 200), line2: str(personal.address_line2, 200), city: str(personal.suburb, 100),
        region: personal.state ? String(personal.state).toUpperCase().trim() : null, postcode: str(personal.postcode, 10),
        country: str(personal.country, 60) || 'AUSTRALIA',
      },
    },
    employment: {
      employeeNumber: config.employeeNumber || null, jobTitle: config.jobTitle || null, startDate,
      employmentBasis: config.employmentBasis, employmentType: config.employmentType, incomeType: config.incomeType,
      payBasis: config.payBasis, annualSalary: config.annualSalary, hourlyRate: config.hourlyRate, unitsPerWeek: config.unitsPerWeek,
      earningsRateId: config.earningsRateId, earningsRateName: config.earningsRateName,
      payrollCalendarId: config.payrollCalendarId, payrollCalendarName: config.payrollCalendarName, calendarType: config.calendarType,
      employeeGroupName: config.employeeGroupName || null,
      leaveLines: config.leaveLines || [],
    },
    bank: {
      accountName: str(payroll.account_holder_name, 200), bsbMasked: payroll.bsb_masked || null, accountLast4: payroll.account_number_last4 || null,
      statementText: config.statementText, remainder: true,
    },
    tax: {
      residencyStatus: RESIDENCY_FROM_PROFILE[residency] || null,
      australianResident: residency === 'australian_resident',
      taxScaleType: config.taxScaleType,
      tfnProvided: !!payroll.tfn_provided, tfnLast3: payroll.tfn_last3 || null,
      tfnExemptionType: payroll.tfn_provided ? null : (config.tfnExemptionType || null),
      taxFreeThresholdClaimed: payroll.claims_tax_free_threshold === true,
      hasLoanOrStudentDebt: payroll.has_study_loan === true,
      eligibleToReceiveLeaveLoading: config.eligibleToReceiveLeaveLoading === true,
      upwardVariationTaxWithholdingAmount: config.upwardVariationTaxWithholdingAmount || null,
      submissionMethod: payroll.tax_submission_method || null,
    },
    super: {
      choice: payroll.super_choice_type || null,
      fundName: str(payroll.super_fund_name, 200), fundAbn: digits(payroll.super_fund_abn) || null, usi: str(payroll.super_fund_usi, 40),
      memberNumberMasked: maskMember(payroll.super_member_number), accountName: str(payroll.super_account_name, 200),
      smsfEsa: str(payroll.smsf_esa, 80), smsfBankAccountName: str(payroll.smsf_bank_account_name, 200),
      smsfBsbMasked: payroll.smsf_bank_bsb_masked || null, smsfAccountLast4: payroll.smsf_bank_account_last4 || null,
      defaultSuperFundId: config.defaultSuperFundId || null,
    },
  };
}

/** Is the snapshot complete enough to send? Every error is Owner-readable. */
function validateSnapshot(s) {
  const errors = [];
  const i = s.identity || {}; const a = i.address || {}; const e = s.employment || {}; const b = s.bank || {}; const t = s.tax || {}; const su = s.super || {};
  if (!i.firstName) errors.push('Legal first name is missing');
  if (!i.lastName) errors.push('Legal last name is missing');
  if (!i.dateOfBirth) errors.push('Date of birth is missing');
  if (!a.line1 || !a.city || !a.postcode) errors.push('The home address is incomplete (Xero requires a full address to create an employee)');
  if (!E.State.includes(a.region)) errors.push('The home address needs an Australian state or territory');
  if (a.postcode && !/^\d{4}$/.test(a.postcode)) errors.push('The postcode must be four digits');
  if (!i.email) errors.push('An email address for payroll is required');
  if (!e.startDate) errors.push('The start date is missing');
  if (!e.payrollCalendarId) errors.push('The Xero payroll calendar has not been chosen');
  if (!e.earningsRateId) errors.push('The Xero ordinary earnings rate has not been chosen');
  if (!E.EmploymentBasis.includes(e.employmentBasis)) errors.push('Employment basis is not set');
  if (e.payBasis === 'annual' && !(e.annualSalary > 0)) errors.push('Annual salary is missing');
  if (e.payBasis === 'hourly' && !(e.hourlyRate > 0)) errors.push('Hourly rate is missing');
  if (!b.bsbMasked || !b.accountLast4 || !b.accountName) errors.push('Bank account details are missing');
  if (!t.residencyStatus) errors.push('Residency status for tax is missing');
  if (!E.TaxScaleType.includes(t.taxScaleType)) errors.push('Tax scale type is not set');
  if (!t.tfnProvided && !t.tfnExemptionType) errors.push('No tax file number was provided: choose the TFN exemption type Xero should record');
  if (t.residencyStatus === 'WORKINGHOLIDAYMAKER' && e.incomeType !== 'WORKINGHOLIDAYMAKER') errors.push('A working holiday maker must have the WORKINGHOLIDAYMAKER income type');
  switch (su.choice) {
    case 'apra_fund':
      if (!su.usi) errors.push('The super fund USI is missing');
      if (!su.fundAbn) errors.push('The super fund ABN is missing');
      if (!su.memberNumberMasked) errors.push('The super member number is missing');
      break;
    case 'smsf':
      if (!su.fundAbn || !su.smsfEsa || !su.smsfBsbMasked || !su.smsfAccountLast4 || !su.smsfBankAccountName) errors.push('The SMSF details are incomplete (ABN, ESA, bank account)');
      break;
    case 'employer_default':
      if (!su.defaultSuperFundId) errors.push('The employee chose the employer default fund: select the default fund from Xero');
      break;
    case 'stapled':
      errors.push('The employee asked for their stapled fund. Look it up with the ATO and record it as an APRA fund before approving');
      break;
    default:
      errors.push('Superannuation choice is missing');
  }
  return errors;
}

// ── 4. Payloads ─────────────────────────────────────────────────────────────

/** The minimal valid POST /Employees body (one element). */
function buildCreatePayload(s) {
  const i = s.identity; const a = i.address; const e = s.employment;
  const out = {
    FirstName: i.firstName, LastName: i.lastName, DateOfBirth: i.dateOfBirth,
    HomeAddress: { AddressLine1: a.line1, ...(a.line2 ? { AddressLine2: a.line2 } : {}), City: a.city, Region: a.region, PostalCode: a.postcode, Country: a.country || 'AUSTRALIA' },
    StartDate: e.startDate, Email: i.email,
  };
  if (i.middleNames) out.MiddleNames = i.middleNames;
  if (i.mobile) out.Mobile = i.mobile;
  if (e.jobTitle) out.JobTitle = e.jobTitle;
  return out;
}

/**
 * The first configuration update: calendar, earnings rate, types, bank,
 * tax declaration and super membership. `secrets` = { tfn, bsb, accountNumber }.
 * `superFundId` is the resolved Xero fund.
 */
function buildConfigurationPayload(s, secrets = {}, { superFundId, superMemberNumber } = {}) {
  const e = s.employment; const b = s.bank; const t = s.tax;
  const tax = {
    EmploymentBasis: e.employmentBasis,
    AustralianResidentForTaxPurposes: t.australianResident === true,
    ResidencyStatus: t.residencyStatus,
    TaxScaleType: t.taxScaleType,
    TaxFreeThresholdClaimed: t.taxFreeThresholdClaimed === true,
    HasLoanOrStudentDebt: t.hasLoanOrStudentDebt === true,
    EligibleToReceiveLeaveLoading: t.eligibleToReceiveLeaveLoading === true,
  };
  if (secrets.tfn) tax.TaxFileNumber = digits(secrets.tfn);
  else if (t.tfnExemptionType) tax.TFNExemptionType = t.tfnExemptionType;
  if (t.upwardVariationTaxWithholdingAmount) tax.UpwardVariationTaxWithholdingAmount = Number(t.upwardVariationTaxWithholdingAmount);

  const out = {
    PayrollCalendarID: e.payrollCalendarId,
    OrdinaryEarningsRateID: e.earningsRateId,
    EmploymentType: e.employmentType,
    IncomeType: e.incomeType,
    ...(e.employeeGroupName ? { EmployeeGroupName: e.employeeGroupName } : {}),
    BankAccounts: [{ StatementText: b.statementText, AccountName: b.accountName, BSB: digits(secrets.bsb), AccountNumber: digits(secrets.accountNumber), Remainder: true }],
    TaxDeclaration: tax,
  };
  if (superFundId) {
    out.SuperMemberships = [{ SuperFundID: superFundId, ...(superMemberNumber ? { EmployeeNumber: String(superMemberNumber).slice(0, 60) } : {}) }];
  }
  return out;
}

/** The pay template: earnings, statutory super, leave. Needs the SuperMembershipID Xero returned. */
function buildPayTemplatePayload(s, { superMembershipId } = {}) {
  const e = s.employment;
  const earnings = e.payBasis === 'annual'
    ? { EarningsRateID: e.earningsRateId, CalculationType: 'ANNUALSALARY', AnnualSalary: Number(e.annualSalary), NumberOfUnitsPerWeek: Number(e.unitsPerWeek) }
    : { EarningsRateID: e.earningsRateId, CalculationType: 'ENTEREARNINGSRATE', RatePerUnit: Number(e.hourlyRate), ...(e.unitsPerWeek > 0 ? { NumberOfUnitsPerWeek: Number(e.unitsPerWeek) } : {}) };
  const template = { EarningsLines: [earnings] };
  if (superMembershipId) template.SuperLines = [{ SuperMembershipID: superMembershipId, ContributionType: 'SGC', CalculationType: 'STATUTORY' }];
  if (e.leaveLines && e.leaveLines.length) {
    template.LeaveLines = e.leaveLines.map((l) => ({
      LeaveTypeID: l.leaveTypeId, CalculationType: l.calculationType,
      ...(l.annualNumberOfUnits != null ? { AnnualNumberOfUnits: Number(l.annualNumberOfUnits) } : {}),
      ...(l.fullTimeNumberOfUnitsPerPeriod != null ? { FullTimeNumberOfUnitsPerPeriod: Number(l.fullTimeNumberOfUnitsPerPeriod) } : {}),
    }));
  }
  return { PayTemplate: template };
}

/** A regulated super fund from a verified product (USI). SMSF from the profile + secrets. */
function buildSuperFundPayload(s, secrets = {}, product = null) {
  const su = s.super;
  if (su.choice === 'smsf') {
    return { Type: 'SMSF', Name: su.fundName, ABN: su.fundAbn, ElectronicServiceAddress: su.smsfEsa, AccountName: su.smsfBankAccountName, BSB: digits(secrets.smsfBsb), AccountNumber: digits(secrets.smsfAccountNumber) };
  }
  return { Type: 'REGULATED', Name: (product && product.ProductName) || su.fundName, ABN: (product && product.ABN) || su.fundAbn, USI: (product && product.USI) || su.usi };
}

// ── 5. Matching ─────────────────────────────────────────────────────────────

/** Find an existing organisation super fund for the snapshot's choice. */
function matchSuperFund(s, funds = []) {
  const su = s.super || {};
  if (su.choice === 'employer_default') return funds.find((f) => f.SuperFundID === su.defaultSuperFundId) || null;
  if (su.choice === 'smsf') return funds.find((f) => f.Type === 'SMSF' && digits(f.ABN) === su.fundAbn) || null;
  if (su.choice === 'apra_fund') {
    const usi = String(su.usi || '').trim().toUpperCase();
    return funds.find((f) => f.Type === 'REGULATED' && String(f.USI || '').trim().toUpperCase() === usi) || null;
  }
  return null;
}

/**
 * Conservative duplicate check. A stored EmployeeID is matched first by the
 * caller; here any employee with the same normalised legal name AND date of
 * birth, or the same email, is a candidate. Any candidate stops the sync.
 */
function findDuplicates(employees = [], s) {
  const i = s.identity;
  const fn = normName(i.firstName); const ln = normName(i.lastName); const dob = i.dateOfBirth;
  const emails = new Set([normEmail(i.email), normEmail(i.personalEmail)].filter(Boolean));
  const out = [];
  for (const emp of employees) {
    if (!emp || !emp.EmployeeID) continue;
    const reasons = [];
    if (normName(emp.FirstName) === fn && normName(emp.LastName) === ln && isoDate(emp.DateOfBirth) === dob) reasons.push('same legal name and date of birth');
    if (emp.Email && emails.has(normEmail(emp.Email))) reasons.push('same email address');
    if (reasons.length) out.push({ employeeId: emp.EmployeeID, name: `${emp.FirstName || ''} ${emp.LastName || ''}`.trim(), status: emp.Status || null, startDate: isoDate(emp.StartDate), reasons });
  }
  return out;
}

// ── 6. Read-back verification ───────────────────────────────────────────────

/**
 * Compare GET /Employees/{id} with the approved snapshot. Only non-secret
 * fields are compared, and only booleans/labels are returned — never the
 * bank or TFN values Xero echoes.
 */
function verifyReadBack(emp, s, { superMembershipId = null, bankLast4 = null } = {}) {
  const checks = [];
  const add = (key, label, ok, detail) => checks.push({ key, label, ok: !!ok, ...(detail ? { detail } : {}) });
  if (!emp) { add('exists', 'Employee exists in Xero', false); return { ok: false, checks, stp2Qualified: null }; }
  const e = s.employment; const i = s.identity; const t = s.tax;
  add('status', 'Employee is active', emp.Status === 'ACTIVE', emp.Status || 'no status');
  add('name', 'Legal name matches', normName(emp.FirstName) === normName(i.firstName) && normName(emp.LastName) === normName(i.lastName));
  add('dob', 'Date of birth matches', isoDate(emp.DateOfBirth) === i.dateOfBirth);
  add('start_date', 'Start date matches', isoDate(emp.StartDate) === e.startDate, `${isoDate(emp.StartDate) || '—'} vs ${e.startDate}`);
  add('email', 'Payroll email matches', normEmail(emp.Email) === normEmail(i.email));
  add('calendar', 'Payroll calendar assigned', emp.PayrollCalendarID === e.payrollCalendarId);
  add('earnings_rate', 'Ordinary earnings rate assigned', emp.OrdinaryEarningsRateID === e.earningsRateId);
  const lines = (emp.PayTemplate && emp.PayTemplate.EarningsLines) || [];
  const line = lines.find((l) => l.EarningsRateID === e.earningsRateId);
  const payOk = !!line && (e.payBasis === 'annual'
    ? line.CalculationType === 'ANNUALSALARY' && Number(line.AnnualSalary) === Number(e.annualSalary)
    : Number(line.RatePerUnit) === Number(e.hourlyRate));
  add('pay_template', e.payBasis === 'annual' ? 'Pay template: annual salary' : 'Pay template: hourly rate', payOk);
  const banks = emp.BankAccounts || [];
  const bank = banks.find((b) => b.Remainder === true) || banks[0];
  add('bank', 'Bank account with remainder allocation', !!bank && bank.Remainder === true && (!bankLast4 || last4(bank.AccountNumber) === bankLast4));
  const td = emp.TaxDeclaration || {};
  add('tax_declaration', 'Tax declaration present', td.EmploymentBasis === e.employmentBasis && (t.tfnProvided ? !!td.TaxFileNumber || td.TaxFileNumber === undefined : !!td.TFNExemptionType || td.TaxFileNumber === undefined) && td.TaxFreeThresholdClaimed === t.taxFreeThresholdClaimed);
  const memberships = emp.SuperMemberships || [];
  add('super_membership', 'Super membership present', memberships.length > 0 && (!superMembershipId || memberships.some((m) => m.SuperMembershipID === superMembershipId)));
  const superLines = (emp.PayTemplate && emp.PayTemplate.SuperLines) || [];
  add('super_line', 'Statutory super line on the pay template', superLines.some((l) => l.ContributionType === 'SGC' && l.CalculationType === 'STATUTORY' && (!superMembershipId || l.SuperMembershipID === superMembershipId)));
  if (e.leaveLines && e.leaveLines.length) {
    const ll = (emp.PayTemplate && emp.PayTemplate.LeaveLines) || [];
    add('leave', 'Leave lines on the pay template', e.leaveLines.every((x) => ll.some((y) => y.LeaveTypeID === x.leaveTypeId)));
  }
  const stp2 = typeof emp.IsSTP2Qualified === 'boolean' ? emp.IsSTP2Qualified : null;
  add('stp2', 'STP Phase 2 qualified (informational)', stp2 === true, stp2 === null ? 'not reported' : String(stp2));
  const blocking = checks.filter((c) => c.key !== 'stp2');
  return { ok: blocking.every((c) => c.ok), checks, stp2Qualified: stp2 };
}

// ── 7. Next pay run readiness ───────────────────────────────────────────────

/**
 * Decide the next-pay-run state from the calendar's pay runs. `payRuns` must
 * carry Payslips for DRAFT runs (the caller fetches GET /PayRuns/{id}).
 */
function payRunReadiness(payRuns = [], { employeeId, startDate }) {
  const relevant = payRuns.filter((p) => p && isoDate(p.PayRunPeriodEndDate) && isoDate(p.PayRunPeriodEndDate) >= startDate);
  const drafts = relevant.filter((p) => p.PayRunStatus === 'DRAFT').sort((a, b) => isoDate(b.PayRunPeriodStartDate).localeCompare(isoDate(a.PayRunPeriodStartDate)));
  if (drafts.length) {
    const d = drafts[0];
    const included = (d.Payslips || []).some((p) => p.EmployeeID === employeeId);
    return { state: included ? 'INCLUDED_IN_DRAFT' : 'MANUAL_INCLUSION_REQUIRED', payRunId: d.PayRunID || null, period: { start: isoDate(d.PayRunPeriodStartDate), end: isoDate(d.PayRunPeriodEndDate), paymentDate: isoDate(d.PaymentDate) } };
  }
  const posted = relevant.filter((p) => p.PayRunStatus === 'POSTED');
  if (posted.length) {
    const p = posted.sort((a, b) => isoDate(b.PayRunPeriodStartDate).localeCompare(isoDate(a.PayRunPeriodStartDate)))[0];
    const included = (p.Payslips || []).some((x) => x.EmployeeID === employeeId);
    return { state: included ? 'READY_FOR_NEXT_PAY_RUN' : 'POSTED_PAY_RUN_REVIEW', payRunId: p.PayRunID || null, period: { start: isoDate(p.PayRunPeriodStartDate), end: isoDate(p.PayRunPeriodEndDate), paymentDate: isoDate(p.PaymentDate) } };
  }
  return { state: 'READY_FOR_NEXT_PAY_RUN', payRunId: null, period: null };
}

/** The Owner-facing manual action list after a sync, deduplicated by code. */
function manualActionsFor({ nextPayRunState, existing = [] }) {
  const codes = new Set(existing.filter((a) => a && a.code).map((a) => a.code));
  const out = existing.filter((a) => a && a.code).map((a) => ({ ...a }));
  const push = (code) => { if (!codes.has(code)) { codes.add(code); out.push({ code, text: MANUAL_ACTIONS[code], completedAt: null, completedBy: null }); } };
  if (nextPayRunState === 'MANUAL_INCLUSION_REQUIRED') push('include_in_draft_pay_run');
  if (nextPayRunState === 'POSTED_PAY_RUN_REVIEW') push('posted_pay_run_review');
  push('invite_to_xero_me');
  return out;
}

/** ≤128 chars, stable per operation and step. */
function idempotencyKey(operationId, step) {
  return `opal-payroll-${operationId}-${step}`.slice(0, 128);
}

module.exports = {
  STATES, STATE_LABELS, POST_APPROVAL_STATES, SYNC_STARTABLE_STATES, NEXT_PAY_RUN_LABELS, MANUAL_ACTIONS, PRIVACY_NOTICE_VERSION, ENUMS: E,
  deriveState, defaultConfig, validateConfig, buildSnapshot, validateSnapshot,
  buildCreatePayload, buildConfigurationPayload, buildPayTemplatePayload, buildSuperFundPayload,
  matchSuperFund, findDuplicates, verifyReadBack, payRunReadiness, manualActionsFor, idempotencyKey,
  isoDate, maskMember, normName,
};
