'use strict';

/** PAYROLL SETUP and PHASE 3 READINESS — pure rules. */

const payroll = require('../onboarding-payroll');
const induction = require('../onboarding-induction');

const fullProfile = {
  personal: { name: 'Jane Smith', dateOfBirth: '1990-04-03', address: '12 Wattle St, Fremantle, WA, 6160' },
  employment: { employmentType: 'full_time', startDate: '2026-10-07', hoursPerWeek: 38, payBasis: 'annual', payRate: 92000 },
  payroll: { bsbMasked: '•••-•23', accountLast4: '5678', bankStatus: 'provided', superFund: 'AustralianSuper' },
};

describe('Payroll Setup', () => {
  test('lays the set out line by line and is Ready for Review when nothing is missing or in conflict', () => {
    const s = payroll.buildPayrollSetup({ profile: fullProfile, payroll: { tax_setup_status: 'employee_completed' } });
    expect(s.status).toBe('ready_for_review');
    expect(s.label).toBe('Ready for Review');
    expect(s.rows.map((r) => `${r.label}: ${r.status}`)).toEqual([
      'Name: ready', 'Date of birth: ready', 'Address: ready', 'Employment Type: ready', 'Commencement: ready',
      'Hours: ready', 'Salary: ready', 'Bank Details: ready', 'Super: ready', 'Tax Details: ready',
    ]);
    expect(s.rows.find((r) => r.key === 'employment_type').value).toBe('Full-Time');
    expect(s.rows.find((r) => r.key === 'hours').value).toBe('38/week');
    expect(s.rows.find((r) => r.key === 'pay').value).toBe('$92,000 per annum');
    expect(s.integration.available).toBe(false);
  });

  test('a conflict or a missing line blocks approval and names itself', () => {
    const s = payroll.buildPayrollSetup({
      profile: { ...fullProfile, payroll: { bankStatus: 'not_started' } },
      fields: [{ key: 'hours_per_week', outcome: 'conflict', status: 'proposed' }, { key: 'date_of_birth', outcome: 'review', status: 'proposed' }],
      payroll: { tax_setup_status: 'not_started' },
    });
    expect(s.ready).toBe(false);
    expect(s.status).toBe('conflict');
    expect(s.blockers).toEqual(expect.arrayContaining(['Hours: conflicting information', 'Date of birth: needs your confirmation', 'Bank Details: missing', 'Super: missing', 'Tax Details: missing']));
  });

  test('casual hours are not missing; an hourly rate reads as one; approval is recorded', () => {
    const s = payroll.buildPayrollSetup({
      profile: { ...fullProfile, employment: { employmentType: 'casual', startDate: '2026-10-07', payBasis: 'hourly', payRate: 38.5 } },
      payroll: { tax_setup_status: 'processed', payroll_approved_at: '2026-09-20', payroll_approved_by_name: 'Ann' },
    });
    expect(s.rows.find((r) => r.key === 'hours')).toMatchObject({ status: 'ready', value: 'Casual — as rostered' });
    expect(s.rows.find((r) => r.key === 'pay')).toMatchObject({ label: 'Hourly Rate', value: '$38.50 per hour' });
    expect(s).toMatchObject({ status: 'approved', approved: true, approvedByName: 'Ann' });
  });
});

describe('Phase 3 readiness', () => {
  const a = { is_treating_therapist: true };
  const item = (code, title, over) => ({ code, title, status: 'included', employee_returns: true, required: true, verification_status: 'pending', returned_at: null, ...over });
  test('says exactly what is blocking, never just "locked"', () => {
    const r = induction.buildReadiness({
      assignment: a,
      tasks: [{ code: 'portal_account', status: 'done' }, { code: 'work_email', status: 'done' }, { code: 'systems_access', status: 'in_progress' }],
      documentation: [item('PACK_CONTRACT', 'Contract of Employment', { returned_at: '2026-09-10' }), item('REQ_WWCC', 'Working with Children Check', { returned_at: '2026-09-10' }), item('REQ_FWIS', 'FWIS', { employee_returns: false })],
    });
    expect(r.ready).toBe(false);
    expect(r.blockers).toEqual(['Splose account still needs to be set up', 'Contract of Employment has not been verified', 'Working with Children Check has not been verified against the register']);
    expect(r.checks.map((c) => `${c.label}: ${c.detail}`)).toEqual(['Opal Portal: Ready', 'Outlook: Ready', 'Splose: In progress', 'Required employment documents: 1 not yet verified', 'Required compliance items: 1 not yet verified']);
  });
  test('is ready when accounts exist and required documents are verified; Splose is not asked of an admin employee', () => {
    const r = induction.buildReadiness({
      assignment: { is_treating_therapist: false, role_category: 'administration' },
      tasks: [{ code: 'portal_account', status: 'done' }, { code: 'work_email', status: 'skipped' }],
      documentation: [item('PACK_CONTRACT', 'Contract', { returned_at: '2026-09-10', verification_status: 'verified' })],
      payroll: { approved: false, ready: true, label: 'Ready for Review' },
    });
    expect(r.ready).toBe(true);
    expect(r.checks.some((c) => c.label === 'Splose')).toBe(false);
    expect(r.checks.find((c) => c.key === 'payroll').state).toBe('in_progress');
  });
  test('completion needs every required tracked item done', () => {
    const items = [
      { status: 'included', required: true, employee_returns: true, item_kind: 'document', verification_status: 'verified' },
      { status: 'included', required: true, employee_returns: false, item_kind: 'account', completed_at: null },
      { status: 'included', required: false, employee_returns: true, item_kind: 'document', verification_status: 'pending' },
      { status: 'included', required: true, employee_returns: false, item_kind: 'document', verification_status: 'pending' },
    ];
    expect(induction.inductionComplete(items)).toMatchObject({ complete: false, required: 2, done: 1 });
    items[1].completed_at = '2026-09-20';
    expect(induction.inductionComplete(items).complete).toBe(true);
  });
  test('Email 3 fills the name and the seven-day date', () => {
    const e = induction.composeInductionEmail({ applicantName: 'Jane Smith', sentAt: new Date('2026-09-03T02:00:00Z') });
    expect(e.subject).toBe('Opal Therapy Internal Induction Pack');
    expect(e.body.startsWith('Hi Jane,')).toBe(true);
    expect(e.body).toContain('within seven days, by 10/09/2026.');
    expect(e.body).toContain('Account Setup and Security');
  });
});
