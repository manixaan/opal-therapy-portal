'use strict';

// Pure rules of billing/splose-billing-source.js (no database, no Splose).
const SB = require('../billing/splose-billing-source');

const data = (invoices, contacts, patients = []) => ({
  latestInvoiceByPatient: SB.latestInvoices(invoices),
  contacts: new Map(contacts.map(c => [String(c.id), c])),
  patients: new Map(patients.map(p => [String(p.id), p])),
});
const PM = { id: 1, type: 'Plan manager', name: 'NDSP', email: 'invoices@ndsp.com.au' };
const MUM = { id: 2, type: 'Mother', name: 'Jo Parent', email: 'jo@parent.test' };
const ME = { id: 3, type: 'Client', name: 'Sam Self', email: 'not-an-email' };
const inv = (id, n, contactId, issueDate, extra = {}) => ({ id, invoiceNumber: n, patientId: 9, contactId, issueDate, ...extra });

describe('fund management', () => {
  test.each([['Plan-managed', 'PLAN_MANAGED'], ['Self-managed', 'SELF_MANAGED'], ['NDIA-managed', 'NDIA_MANAGED'],
    ['Agency managed', 'NDIA_MANAGED'], ['', null], [null, null], ['Something else', null]])('%s → %s', (f, out) => {
    expect(SB.managementFromFund(f)).toBe(out);
  });
});

describe('payer from the latest Splose invoice', () => {
  test('the latest invoice decides — by issue date, then id; archived invoices do not count', () => {
    const d = data([inv(1, 'INV-1', 2, '2026-01-01'), inv(2, 'INV-2', 1, '2026-05-01'), inv(3, 'INV-3', 2, '2026-09-01', { isArchived: true })], [PM, MUM]);
    expect(SB.payerFromSplose(d, 9, 'PLAN_MANAGED')).toMatchObject({ type: 'PLAN_MANAGER', name: 'NDSP', email: 'invoices@ndsp.com.au', detail: 'Splose invoice INV-2' });
  });
  test('plan-managed needs a Plan manager contact; anything else is no payer', () => {
    expect(SB.payerFromSplose(data([inv(1, 'INV-1', 2, '2026-01-01')], [PM, MUM]), 9, 'PLAN_MANAGED')).toBeNull();
    expect(SB.payerFromSplose(data([], [PM]), 9, 'PLAN_MANAGED')).toBeNull();
    expect(SB.payerFromSplose(data([inv(1, 'INV-1', null, '2026-01-01')], [PM]), 9, 'PLAN_MANAGED')).toBeNull();
  });
  test('self-managed: the client or a nominee, never a plan manager; an invalid email is dropped', () => {
    expect(SB.payerFromSplose(data([inv(1, 'INV-1', 2, '2026-01-01')], [MUM]), 9, 'SELF_MANAGED')).toMatchObject({ type: 'NOMINEE', email: 'jo@parent.test' });
    expect(SB.payerFromSplose(data([inv(1, 'INV-1', 3, '2026-01-01')], [ME]), 9, 'SELF_MANAGED')).toMatchObject({ type: 'PARTICIPANT', email: null });
    expect(SB.payerFromSplose(data([inv(1, 'INV-1', 1, '2026-01-01')], [PM]), 9, 'SELF_MANAGED')).toBeNull();
  });
  test('NDIA-managed is never invoiced to anyone', () => {
    expect(SB.payerFromSplose(data([inv(1, 'INV-1', 1, '2026-01-01')], [PM]), 9, 'NDIA_MANAGED')).toBeNull();
  });
  test('the fill never replaces owner data', () => {
    const d = data([inv(1, 'INV-1', 1, '2026-01-01')], [PM], [{ id: 9, fullName: 'R W', ndisNumber: '431876925', fundManagement: 'Plan-managed', formattedAddress: 'X' }]);
    const owned = { client_id: '9', participant_name: 'Owner Name', ndis_number: '111111111', management_type: 'SELF_MANAGED',
      payer_type: 'PARTICIPANT', payer_name: 'Owner Payer', service_address: 'Owner St' };
    expect(SB.sploseProfileFill(d, owned).values).toEqual({});
    const blank = { client_id: '9' };
    expect(SB.sploseProfileFill(d, blank).values).toEqual({ participantName: 'R W', ndisNumber: '431876925', serviceAddress: 'X',
      managementType: 'PLAN_MANAGED', payerType: 'PLAN_MANAGER', payerName: 'NDSP', payerEmail: 'invoices@ndsp.com.au' });
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
