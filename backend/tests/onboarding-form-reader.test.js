'use strict';

/**
 * The pack's own forms, read by fixed rules — no model. Each form is
 * recognised, every field read by name or printed label, the form's rules
 * applied (required, one-of, conditional, valid), and the values proposed.
 */

const reader = require('../onboarding-form-reader');
const forms = require('./fixtures/onboarding-forms');

const PDF = 'application/pdf';
const read = (buffer) => reader.readReturnedDocument({ buffer, mime: PDF, keepValues: true });
const messages = (r) => r.check.issues.map((i) => i.message);
const cand = (r, key) => (r.candidates.find((c) => c.key === key) || {}).value;

describe('value rules', () => {
  test('dates: day-first, written months, boxed digits; never month-first or impossible', () => {
    expect(reader.parseDate('03/04/1990')).toBe('1990-04-03');
    expect(reader.parseDate('28 September 2026')).toBe('2026-09-28');
    expect(reader.parseDate('28 Sept 2026')).toBe('2026-09-28');
    expect(reader.parseDate('1 0 0 9 2 0 2 6')).toBe('2026-09-10');
    expect(reader.parseDate('2026-09-10')).toBe('2026-09-10');
    expect(reader.parseDate('31/02/2026')).toBeNull();
    expect(reader.parseDate('September 2026')).toBeNull();
    expect(reader.parseDate('N/A')).toBeNull();
  });
  test('an expiry must be ahead, a date of birth behind and plausible, a BSB six digits, an ABN checksummed', () => {
    expect(reader.validate('future_date', '01/01/2020')).toEqual({ problem: 'has already passed' });
    expect(reader.validate('birth_date', '01/01/2020')).toEqual({ problem: 'is not a plausible date of birth' });
    expect(reader.validate('past_date', '01/01/2099')).toEqual({ problem: 'is in the future' });
    expect(reader.validate('bsb', '066 123')).toEqual({ value: '066-123' });
    expect(reader.validate('bsb', '66123')).toEqual({ problem: 'should be six digits (000-000)' });
    expect(reader.validAbn('65 714 394 898')).toBe(true);
    expect(reader.validAbn('65 714 394 899')).toBe(false);
    expect(reader.validate('employment_type', 'Fixed-term (to 27 September 2027)')).toEqual({ value: 'fixed_term', extra: { end_date: '2027-09-27' } });
    expect(reader.validate('employment_type', 'Fixed-term to sometime')).toEqual({ problem: 'names an end date that is not a valid date' });
    expect(reader.validate('address', '12 Example Street, Subiaco WA 6008').extra).toEqual({ address_line1: '12 Example Street', suburb: 'Subiaco', state: 'WA', postcode: '6008' });
  });
});

describe('the contract', () => {
  test('complete and signed: ok, and the terms are proposed as values', async () => {
    const r = await read(await forms.buildContractPdf(forms.CONTRACT_COMPLETE, { signature: 'Jane Marie Doe' }));
    expect(r.kind).toBe('contract');
    expect(r.check.status).toBe('ok');
    expect(r.signed).toBe('present');
    expect(cand(r, 'start_date')).toBe('2026-09-28');
    expect(cand(r, 'employment_type')).toBe('fixed_term');
    expect(cand(r, 'end_date')).toBe('2027-09-27');
    expect(cand(r, 'salary_annual')).toBe('80000');
    expect(cand(r, 'hours_per_week')).toBe('38');
    expect(cand(r, 'legal_first_name')).toBe('Jane');
    expect(cand(r, 'middle_name')).toBe('Marie');
    expect(cand(r, 'surname')).toBe('Doe');
    expect(cand(r, 'suburb')).toBe('Subiaco');
    expect(cand(r, 'postcode')).toBe('6008');
  });

  test('unsigned, undated: attention, signature missing, and the terms still read', async () => {
    const r = await read(await forms.buildContractPdf({ ...forms.CONTRACT_COMPLETE, signature_date: '' }));
    expect(r.check.status).toBe('attention');
    expect(r.signed).toBe('missing');
    expect(messages(r)).toEqual(['Employee signature is empty', 'Date signed is blank']);
    expect(cand(r, 'salary_annual')).toBe('80000');
  });

  test('a filled but invalid value is named, and never proposed', async () => {
    const r = await read(await forms.buildContractPdf({ ...forms.CONTRACT_COMPLETE, annual_salary_aud: 'eighty thousand', signature_date: '31/02/2026' }, { signature: 'J Doe' }));
    expect(messages(r)).toEqual(['Annual salary is not a valid amount', 'Date signed is not a valid date (dd/mm/yyyy)']);
    expect(cand(r, 'salary_annual')).toBeUndefined();
  });
});

describe('the New Employee Details form', () => {
  test('complete: ok, signed, every profile value proposed, a compound member/USI split', async () => {
    const r = await read(await forms.buildEmployeeDetailsPdf(forms.NED_COMPLETE));
    expect(r.kind).toBe('new_employee_details');
    expect(messages(r)).toEqual([]);
    expect(r.check.status).toBe('ok');
    expect(r.signed).toBe('present');
    expect(cand(r, 'date_of_birth')).toBe('1998-03-14');
    expect(cand(r, 'bsb')).toBe('066-000');
    expect(cand(r, 'account_number')).toBe('00000001');
    expect(cand(r, 'super_usi')).toBe('STA0100AU');
    expect(cand(r, 'super_member_number')).toBe('TEST0000001');
    expect(cand(r, 'drivers_licence_expiry')).toBe('2031-03-14');
    expect(cand(r, 'wwcc_number')).toBe('WWC0000001');
    expect(cand(r, 'police_check_date')).toBe('2026-08-15');
    expect(cand(r, 'emergency_phone')).toBe('0400 000 002');
    // The identity group reads as one answer, not five boxes.
    expect(r.check.fields.find((f) => f.label === 'Identifies as')).toMatchObject({ filled: true, preview: 'Female' });
    // Sensitive values are never previewed.
    expect(r.check.fields.find((f) => f.label === 'BSB').preview).toBeUndefined();
    expect(r.check.fields.find((f) => f.label === 'Date of birth').preview).toBeUndefined();
  });

  test('an unticked box in a ticked group is not a blank; an unticked group is; a conditional field applies only when its answer does', async () => {
    const ticks = forms.NED_COMPLETE.ticks.filter((t) => t !== 'p2_interpreter_required_no');
    const r = await read(await forms.buildEmployeeDetailsPdf({ values: { ...forms.NED_COMPLETE.values, p6_signature: '' }, ticks }));
    expect(messages(r)).toEqual(['Interpreter required: nothing is ticked', 'Signature is empty']);
    expect(r.signed).toBe('missing');
    // A visa is not asked of a citizen; it is of a temporary resident.
    const visa = await read(await forms.buildEmployeeDetailsPdf({ values: forms.NED_COMPLETE.values, ticks: [...forms.NED_COMPLETE.ticks.filter((t) => t !== 'p2_australian_citizen_yes'), 'p2_australian_citizen_no', 'p2_are_you_a_permanent_resident_yes_no'] }));
    expect(messages(visa)).toEqual(['Visa type is blank', 'Visa expiry is blank', 'Visa grant number / VEVO is blank']);
  });

  test('an expired credential and a malformed BSB are named, and the rest still proposed', async () => {
    const r = await read(await forms.buildEmployeeDetailsPdf({ values: { ...forms.NED_COMPLETE.values, p5_registration_expiry_date: '30/11/2020', p4_bsb: '12345' }, ticks: forms.NED_COMPLETE.ticks }));
    expect(messages(r)).toEqual(['BSB should be six digits (000-000)', 'AHPRA registration expiry has already passed']);
    expect(cand(r, 'bsb')).toBeUndefined();
    expect(cand(r, 'ahpra_expiry')).toBeUndefined();
    expect(cand(r, 'ahpra_registration_number')).toBe('OCC0000000001');
  });
});

describe('the ATO super choice form (no fields: read beneath its printed labels)', () => {
  test('Section B completed and signed: ok, fund details proposed as an employee choice', async () => {
    const r = await read(await forms.buildSuperChoicePdf(forms.SUPER_COMPLETE, { signature: 'Jane Marie Doe', signedDate: '10092026' }));
    expect(r.kind).toBe('super_choice');
    expect(r.check.section).toBe('B');
    expect(messages(r)).toEqual([]);
    expect(r.signed).toBe('present');
    expect(cand(r, 'super_fund_name')).toBe('AustralianSuper');
    expect(cand(r, 'super_usi')).toBe('STA0100AU');
    expect(cand(r, 'super_member_number')).toBe('TEST0000001');
    expect(cand(r, 'super_choice_type')).toBe('employee_choice');
    expect(r.check.fields.find((f) => f.label === 'Super fund ABN (Section B)')).toMatchObject({ filled: true, valid: true, preview: '65714394898' });
  });

  test('Section B without a signature or member number: both named; a wrong ABN is named', async () => {
    const r = await read(await forms.buildSuperChoicePdf({ ...forms.SUPER_COMPLETE, Member: '', ABN: '65714394899' }, { signedDate: '10092026' }));
    expect(r.check.status).toBe('attention');
    expect(r.signed).toBe('missing');
    expect(messages(r)).toEqual(['Super fund ABN (Section B) is not a valid ABN', 'Member account number (Section B) is blank', 'Signature (Section B) is empty']);
  });

  test('nothing completed: the form is not a choice at all', async () => {
    const r = await read(await forms.buildSuperChoicePdf({ 'Full name': 'Jane Marie Doe' }));
    expect(messages(r)).toEqual(['No section is completed — choose Section B (existing fund), C (employer default) or D (SMSF) and complete it']);
    expect(r.candidates.map((c) => c.key)).not.toContain('super_fund_name');
  });
});

describe('recognition', () => {
  test('the statements are recognised for reading only, the contract-type ones ahead of the FWIS they cite', async () => {
    const fwis = await read(await forms.buildStatementPdf('Fair Work Information Statement'));
    expect(fwis).toMatchObject({ kind: 'fair_work_statement', signed: 'unknown' });
    expect(fwis.check.status).toBe('unchecked');
    const ftcis = await read(await forms.buildStatementPdf('Fixed Term Contract Information Statement — read with the Fair Work Information Statement'));
    expect(ftcis.kind).toBe('ftcis');
    const ceis = await read(await forms.buildStatementPdf('Casual Employment Information Statement'));
    expect(ceis.kind).toBe('ceis');
  });
  test('a document that is none of ours, or not a PDF, is left to the generic check', async () => {
    const { PDFDocument, StandardFonts } = require('pdf-lib');
    const doc = await PDFDocument.create(); const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage().drawText('WORKING WITH CHILDREN CHECK WWC1234567 valid to 30/06/2028', { x: 40, y: 700, size: 12, font });
    expect(await read(Buffer.from(await doc.save()))).toBeNull();
    expect(await reader.readReturnedDocument({ buffer: Buffer.from('hello'), mime: 'text/plain' })).toBeNull();
  });
});
