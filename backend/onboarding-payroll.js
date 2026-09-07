'use strict';

/**
 * PAYROLL SETUP — a review of what onboarding already gathered.
 *
 * Pure. Given the profile as it stands and the open reconciliation items,
 * lay the payroll set out one line at a time — Name, Employment Type, Hours,
 * Salary, Bank Details, Super, Tax — each Ready, Missing, Conflict or
 * Review — and say whether the set is ready for the Owner to approve.
 *
 * Payroll does not proceed while anything on it is missing or in conflict;
 * the Owner resolves that in Requires Your Attention, not here.
 */

const LINES = [
  { key: 'name', label: 'Name', fields: ['legal_first_name', 'surname'] },
  { key: 'dob', label: 'Date of birth', fields: ['date_of_birth'] },
  { key: 'address', label: 'Address', fields: ['address_line1', 'suburb', 'state', 'postcode'] },
  { key: 'employment_type', label: 'Employment Type', fields: ['employment_type'] },
  { key: 'start_date', label: 'Commencement', fields: ['start_date'] },
  { key: 'hours', label: 'Hours', fields: ['hours_per_week'] },
  { key: 'pay', label: 'Salary', fields: ['salary_annual', 'hourly_rate'] },
  { key: 'bank', label: 'Bank Details', fields: ['bsb', 'account_number', 'account_holder_name'] },
  { key: 'super', label: 'Super', fields: ['super_fund_name', 'super_usi', 'super_member_number', 'super_choice_type'] },
  { key: 'tax', label: 'Tax Details', fields: [] },
];

const TYPE_LABELS = { full_time: 'Full-Time', part_time: 'Part-Time', casual: 'Casual', fixed_term: 'Fixed-Term', contractor: 'Contractor' };
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : null);
const money = (n) => (n == null ? null : `$${Number(n).toLocaleString('en-AU', { minimumFractionDigits: Number.isInteger(Number(n)) ? 0 : 2, maximumFractionDigits: 2 })}`);

/**
 * @param {object} p
 * @param {object|null} p.profile   profileSummary() output
 * @param {object[]} p.fields       resolved fields (key, outcome, status)
 * @param {object|null} p.payroll   raw payroll row bits { bank_status, bank_verified_at, tax_setup_status, super_status, payroll_approved_at, payroll_approved_by_name }
 * @param {object} p.assignment
 */
function buildPayrollSetup({ profile, fields = [], payroll = null, assignment = {}, integration = null }) {
  const pe = (profile && profile.personal) || {};
  const e = (profile && profile.employment) || {};
  const pay = (profile && profile.payroll) || {};
  const open = new Map(fields.filter((f) => f.status === 'proposed').map((f) => [f.key, f.outcome]));

  const state = (keys, present) => {
    if (keys.some((k) => open.get(k) === 'conflict')) return 'conflict';
    if (keys.some((k) => open.get(k) === 'review')) return 'review';
    return present ? 'ready' : 'missing';
  };

  const rows = [];
  const push = (line, value, present, extra) => rows.push({ key: line.key, label: line.label, value: value || null, status: state(line.fields, present), ...extra });

  const byKey = Object.fromEntries(LINES.map((l) => [l.key, l]));
  push(byKey.name, pe.name, !!pe.name);
  push(byKey.dob, pe.dateOfBirth ? fmtDate(pe.dateOfBirth) : null, !!pe.dateOfBirth);
  push(byKey.address, pe.address, !!pe.address);
  push(byKey.employment_type, TYPE_LABELS[e.employmentType] || null, !!e.employmentType);
  push(byKey.start_date, e.startDate ? fmtDate(e.startDate) : null, !!e.startDate);
  const casual = e.employmentType === 'casual';
  push(byKey.hours, e.hoursPerWeek != null ? `${e.hoursPerWeek}/week` : (casual ? 'Casual — as rostered' : null), e.hoursPerWeek != null || casual);
  push(byKey.pay, e.payRate != null ? `${money(e.payRate)}${e.payBasis === 'hourly' ? ' per hour' : ' per annum'}` : null, e.payRate != null, { label: e.payBasis === 'hourly' ? 'Hourly Rate' : 'Salary' });
  const bankPresent = !!(pay.bsbMasked && pay.accountLast4);
  push(byKey.bank, bankPresent ? `BSB ${pay.bsbMasked} · account ••••${pay.accountLast4}${pay.bankStatus === 'verified' ? ' · approved' : ''}` : null, bankPresent);
  const superPresent = !!pay.superFund || (payroll && payroll.super_status === 'default_fund_applied');
  push(byKey.super, pay.superFund || (payroll && payroll.super_status === 'default_fund_applied' ? 'Employer default fund' : null), superPresent);
  const taxStatus = payroll ? payroll.tax_setup_status : null;
  const taxReady = ['employee_completed', 'processed', 'exemption_recorded', 'payroll_action_required'].includes(taxStatus);
  push(byKey.tax, taxReady ? (taxStatus === 'processed' ? 'Processed' : 'Employee Tax Details Summary received') : 'Awaiting the Employee Tax Details Summary (myGov)', taxReady);

  const blockers = rows.filter((r) => r.status !== 'ready').map((r) => `${r.label}: ${r.status === 'conflict' ? 'conflicting information' : r.status === 'review' ? 'needs your confirmation' : 'missing'}`);
  const approved = !!(payroll && payroll.payroll_approved_at);
  const ready = blockers.length === 0;
  const status = approved ? 'approved' : ready ? 'ready_for_review' : rows.some((r) => r.status === 'conflict') ? 'conflict' : rows.some((r) => r.status === 'review') ? 'review' : 'gathering';
  const labels = { approved: 'Approved', ready_for_review: 'Ready for Review', conflict: 'Blocked — conflicting information', review: 'Blocked — needs confirmation', gathering: 'Gathering information' };
  return {
    status, label: labels[status], ready, approved, rows, blockers,
    approvedAt: approved ? payroll.payroll_approved_at : null, approvedByName: approved ? payroll.payroll_approved_by_name || null : null,
    integration: integration || { available: false, system: 'Xero Payroll', note: 'The Xero payroll connection is not configured. Once approved, create the employee in Xero from these details; the internal task records it.' },
    readyCount: rows.filter((r) => r.status === 'ready').length, total: rows.length,
  };
}

module.exports = { LINES, TYPE_LABELS, buildPayrollSetup };
