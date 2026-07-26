'use strict';

const { suggestMatches } = require('../reconciliation-engine');

const invoices = [
  { xero_invoice_id: 'inv-1', invoice_number: 'INV-001', type: 'ACCREC', status: 'AUTHORISED', total: 193.99, amount_due: 0, contact_name: 'Client A' },
  { xero_invoice_id: 'inv-2', invoice_number: 'INV-002', type: 'ACCREC', status: 'AUTHORISED', total: 300.00, amount_due: 300.00, contact_name: 'Client B', due_date: '2020-01-01' },
  { xero_invoice_id: 'inv-3', invoice_number: 'INV-003', type: 'ACCREC', status: 'AUTHORISED', total: 100.00, amount_due: 100.00, contact_name: 'Client C' },
];

describe('suggestMatches', () => {
  test('exact linked payment → exact/high', () => {
    const s = suggestMatches([{ xero_payment_id: 'p1', xero_invoice_id: 'inv-1', amount: 193.99, contact_name: 'Client A' }], invoices);
    const m = s.find(x => x.xeroPaymentId === 'p1');
    expect(m.matchType).toBe('exact');
    expect(m.confidence).toBe('high');
  });

  test('reference-number match without direct link is medium', () => {
    const s = suggestMatches([{ xero_payment_id: 'p2', reference: 'INV-003', amount: 100.00, contact_name: 'Client C' }], invoices);
    const m = s.find(x => x.xeroPaymentId === 'p2');
    expect(m.xeroInvoiceId).toBe('inv-3');
    expect(m.confidence).toBe('medium');
    expect(m.reasons).toContain('reference_matches_invoice_number');
  });

  test('partial payment flagged', () => {
    const s = suggestMatches([{ xero_payment_id: 'p3', xero_invoice_id: 'inv-2', amount: 100.00 }], invoices);
    const m = s.find(x => x.xeroPaymentId === 'p3');
    expect(m.matchType).toBe('partial');
    expect(m.reasons).toContain('amount_less_than_invoice');
  });

  test('overpayment flagged', () => {
    const s = suggestMatches([{ xero_payment_id: 'p4', xero_invoice_id: 'inv-3', amount: 150.00 }], invoices);
    const m = s.find(x => x.xeroPaymentId === 'p4');
    expect(m.matchType).toBe('overpayment');
  });

  test('contact-name mismatch lowers confidence', () => {
    const s = suggestMatches([{ xero_payment_id: 'p5', xero_invoice_id: 'inv-1', amount: 193.99, contact_name: 'Someone Else' }], invoices);
    const m = s.find(x => x.xeroPaymentId === 'p5');
    expect(m.reasons).toContain('contact_name_mismatch');
    expect(m.confidence).not.toBe('high');
  });

  test('unmatched payment → manual_review_required', () => {
    const s = suggestMatches([{ xero_payment_id: 'p6', amount: 55.00, reference: 'nope' }], invoices);
    const m = s.find(x => x.xeroPaymentId === 'p6');
    expect(m.matchType).toBe('unmatched_payment');
    expect(m.confidence).toBe('manual_review_required');
  });

  test('unmatched authorised invoice with balance surfaces; overdue flagged', () => {
    const s = suggestMatches([], invoices);
    const inv2 = s.find(x => x.xeroInvoiceId === 'inv-2' && x.matchType === 'unmatched_invoice');
    expect(inv2).toBeTruthy();
    expect(inv2.reasons).toContain('overdue');
  });

  test('fully paid invoice (amount_due 0) is not surfaced as unmatched', () => {
    const s = suggestMatches([], invoices);
    expect(s.find(x => x.xeroInvoiceId === 'inv-1' && x.matchType === 'unmatched_invoice')).toBeFalsy();
  });
});
