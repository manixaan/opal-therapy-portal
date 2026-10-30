'use strict';

// Pure rules of billing/splose-billing-source.js (no database, no Splose).
const SB = require('../billing/splose-billing-source');

const PD = require('../billing/payer-directory');
const PM = { id: 1, type: 'Plan manager', name: 'NDSP', email: 'invoices@ndsp.com.au' };
const PM_DUP = { id: 4, type: 'Plan manager', name: 'N.D.S.P ', email: null };
const MUM = { id: 2, type: 'Mother', name: 'Jo Parent', email: 'jo@parent.test' };
const ME = { id: 3, type: 'Client', name: 'Sam Self', email: 'not-an-email' };
const inv = (id, n, contactId, issueDate, extra = {}) => ({ id, invoiceNumber: n, patientId: 9, contactId, issueDate, ...extra });

describe('fund management', () => {
  test.each([['Plan-managed', 'PLAN_MANAGED'], ['Self-managed', 'SELF_MANAGED'], ['NDIA-managed', 'NDIA_MANAGED'],
    ['Agency managed', 'NDIA_MANAGED'], ['', null], [null, null], ['Something else', null]])('%s → %s', (f, out) => {
    expect(SB.managementFromFund(f)).toBe(out);
  });
});

describe('payer directory from Splose invoices', () => {
  test('same type + name is one payer, whatever the spelling; email from the most recent invoiced contact', () => {
    const { payers, records } = PD.buildFromSplose(
      [inv(1, 'INV-1', 4, '2026-01-01'), inv(2, 'INV-2', 1, '2026-05-01'), inv(3, 'INV-3', 2, '2026-09-01', { isArchived: true }),
        inv(4, 'INV-4', null, '2026-09-02'), inv(5, 'INV-5', 99, '2026-09-03')], [PM, PM_DUP, MUM]);
    expect([...payers.values()].map(p => [p.type, p.nameKey, p.email, p.invoiceCount, [...p.contactIds].sort()]))
      .toEqual([['PLAN_MANAGER', 'ndsp', 'invoices@ndsp.com.au', 2, ['1', '4']]]);   // Jo's only invoice is archived: not a payer
    expect(records.map(r => r.invoiceNumber)).toEqual(['INV-2', 'INV-1']);   // archived, contact-less and unknown-contact invoices left out
  });
  test('name keys', () => {
    expect(PD.nameKey('  NDSP ')).toBe('ndsp');
    expect(PD.nameKey('My Care Plan-Manager')).toBe('my care plan manager');
    expect(PD.nameKey('')).toBe('');
  });
  test('contact type → payer type', () => {
    expect([PM, MUM, ME, { type: 'Support Coordinator' }, {}].map(PD.payerTypeForContact)).toEqual(['PLAN_MANAGER', 'NOMINEE', 'PARTICIPANT', 'OTHER', 'OTHER']);
  });
  test('a payer must fit the plan management — fail-closed', () => {
    expect(PD.fitsManagement('PLAN_MANAGER', 'PLAN_MANAGED')).toBe(true);
    expect(PD.fitsManagement('NOMINEE', 'PLAN_MANAGED')).toBe(false);
    expect(PD.fitsManagement('NOMINEE', 'SELF_MANAGED')).toBe(true);
    expect(PD.fitsManagement('PLAN_MANAGER', 'SELF_MANAGED')).toBe(false);
    expect(PD.fitsManagement('PLAN_MANAGER', 'NDIA_MANAGED')).toBe(false);
    expect(PD.fitsManagement('PLAN_MANAGER', null)).toBe(false);
  });
  test('Splose\'s UTC midnight is the Perth calendar date', () => {
    expect(PD.isoDay('2026-10-28T16:00:00.000Z')).toBe('2026-10-29');
    expect(PD.isoDay('2026-10-28')).toBe('2026-10-28');
    expect(PD.isoDay(null)).toBeNull();
  });
  test('validation', () => {
    expect(PD.validatePayer({ name: ' ', payerType: 'PLAN_MANAGER' }).errors).toContain('A payer name is required');
    expect(PD.validatePayer({ name: 'X', payerType: 'BANK' }).errors).toContain('payerType is invalid');
    expect(PD.validatePayer({ name: 'X', payerType: 'OTHER', email: 'nope' }).errors).toContain('email is invalid');
    expect(PD.validatePayer({ email: '' }, { partial: true })).toEqual({ errors: [], values: { email: null } });
  });
});

describe('client fields from the Splose patient record', () => {
  const data = { patients: new Map([['9', { id: 9, fullName: 'R W', ndisNumber: '431876925', fundManagement: 'Plan-managed', formattedAddress: 'X' }]]) };
  test('blanks only; never owner data; no payer (that comes from the directory)', () => {
    expect(SB.sploseProfileFill(data, { client_id: '9', participant_name: 'Owner', ndis_number: '111111111', management_type: 'SELF_MANAGED', service_address: 'Owner St' })).toEqual({});
    expect(SB.sploseProfileFill(data, { client_id: '9' })).toEqual({ participantName: 'R W', ndisNumber: '431876925', serviceAddress: 'X', managementType: 'PLAN_MANAGED' });
    expect(SB.sploseProfileFill(null, { client_id: '9' })).toEqual({});
  });
});

describe('numbering and item codes', () => {
  test('highest number counts only exact prefix + digits', () => {
    expect(SB.highestNumber(['INV-2006', 'INV-99', 'INV - 9999', 'INV-12a', 'X-5000'], 'INV-')).toBe(2006);
    expect(SB.highestNumber([], 'INV-')).toBe(0);
  });
  test('Splose\'s claim-type suffix is stripped to the support item', () => {
    expect(SB.baseItemCode('15_617_0128_1_3_RR')).toBe('15_617_0128_1_3');
    expect(SB.baseItemCode('15_617_0128_1_3')).toBe('15_617_0128_1_3');
    expect(SB.baseItemCode('15_617_0118_1_3_NF')).toBe('15_617_0118_1_3');
  });
});

describe('support activities in range', () => {
  const services = new Map([['127253', { id: 127253, title: 'FCA', type: 'Report Writing' }]]);
  const act = (o) => ({ id: 1, start: '2026-10-28T04:30:00.000Z', end: '2026-10-28T07:00:00.000Z', patientId: 5, practitionerId: 19521,
    serviceId: 127253, itemCode: '15_617_0128_1_3_RR', invoiceId: null, doNotInvoice: false, archived: false, deletedAt: null, ...o });
  const run = (acts) => SB.activitiesInRange({ activities: acts, services }, { from: '2026-10-28', to: '2026-10-28', tz: 'Australia/Perth' });
  test('local date, minutes and service title', () => {
    expect(run([act({})])[0]).toMatchObject({ id: '1', clientId: '5', date: '2026-10-28', minutes: 150, serviceTitle: 'FCA (Report Writing)', skip: null });
  });
  test('invoiced, do-not-invoice and bad durations are skipped; archived, deleted and out-of-range are not candidates', () => {
    expect(run([act({ invoiceId: 7 })])[0].skip).toBe('invoiced_in_splose');
    expect(run([act({ doNotInvoice: true })])[0].skip).toBe('splose_do_not_invoice');
    expect(run([act({ end: '2026-10-28T04:30:00.000Z' })])[0].skip).toBe('invalid_duration');
    expect(run([act({ archived: true }), act({ deletedAt: 'x' }), act({ start: '2026-10-28T17:00:00.000Z', end: '2026-10-28T18:00:00.000Z' })])).toEqual([]);
  });
});
