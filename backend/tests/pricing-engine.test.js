'use strict';

const { priceAppointment, selectRule, specificity } = require('../pricing-engine');

const RULES = [
  { id: 'generic', name: 'Standard therapy', unit_amount: 193.99, tax_type: 'NONE', priority: 100, active: true, effective_from: '2026-01-01' },
  { id: 'ndis-therapy', name: 'NDIS therapy', splose_service_id: 'svc-ot', funding_type: 'ndis', unit_amount: 193.99, tax_type: 'EXEMPTOUTPUT', xero_account_code: '200', xero_item_code: 'OT', priority: 50, active: true, effective_from: '2026-01-01' },
  { id: 'travel', name: 'Travel', appointment_type: 'travel', unit_amount: 96.99, tax_type: 'NONE', xero_account_code: '210', priority: 60, active: true, effective_from: '2026-01-01' },
  { id: 'old-rate', name: 'Old rate', splose_service_id: 'svc-ot', funding_type: 'ndis', unit_amount: 150.00, tax_type: 'NONE', priority: 50, active: true, effective_from: '2025-01-01', effective_to: '2025-12-31' },
];

const baseCtx = {
  sploseServiceId: 'svc-ot', serviceName: 'OT Session', appointmentType: 'therapy',
  fundingType: 'ndis', appointmentDate: '2026-07-01', durationMinutes: 60,
  appointmentStatus: 'completed', xeroContactId: 'xc-1',
};

describe('rule selection', () => {
  test('most specific rule wins over generic', () => {
    const r = selectRule(RULES, baseCtx);
    expect(r.id).toBe('ndis-therapy');
  });
  test('specificity counts non-null selectors', () => {
    expect(specificity(RULES[1])).toBeGreaterThan(specificity(RULES[0]));
  });
  test('effective-date window excludes expired rate', () => {
    const r = selectRule(RULES, { ...baseCtx, appointmentDate: '2026-07-01' });
    expect(r.id).not.toBe('old-rate');
    const rOld = selectRule(RULES, { ...baseCtx, appointmentDate: '2025-06-01' });
    expect(rOld.id).toBe('old-rate');
  });
});

describe('priceAppointment', () => {
  test('prices a mapped NDIS appointment to a ready line', () => {
    const out = priceAppointment(baseCtx, RULES);
    expect(out.status).toBe('priced');
    expect(out.lines).toHaveLength(1);
    expect(out.lines[0].unitAmount).toBe(193.99);
    expect(out.lines[0].accountCode).toBe('200');
    expect(out.totalAmount).toBe(193.99);
    expect(out.warnings).not.toContain('no_pricing_rule');
  });

  test('duration drives quantity for hourly rate (90 min = 1.5)', () => {
    const out = priceAppointment({ ...baseCtx, durationMinutes: 90 }, RULES);
    expect(out.lines[0].quantity).toBe(1.5);
    expect(out.totalAmount).toBe(Math.round(193.99 * 1.5 * 100) / 100);
  });

  test('cancelled appointment produces no lines and ignored status', () => {
    const out = priceAppointment({ ...baseCtx, appointmentStatus: 'cancelled' }, RULES);
    expect(out.status).toBe('ignored');
    expect(out.lines).toHaveLength(0);
    expect(out.warnings).toContain('appointment_cancelled');
  });

  test('no matching rule → needs_pricing, never a guessed amount', () => {
    const out = priceAppointment({ ...baseCtx, sploseServiceId: 'unknown', fundingType: 'private' },
      [RULES[1]]); // only the ndis-specific rule
    expect(out.status).toBe('needs_pricing');
    expect(out.totalAmount).toBe(0);
    expect(out.warnings).toContain('no_pricing_rule');
  });

  test('unmapped contact → needs_mapping', () => {
    const out = priceAppointment({ ...baseCtx, xeroContactId: null }, RULES);
    expect(out.status).toBe('needs_mapping');
    expect(out.warnings).toContain('no_contact_mapping');
  });

  test('GST tax type estimates 10% tax; exempt does not', () => {
    const gstRule = [{ id: 'g', name: 'GST svc', unit_amount: 100, tax_type: 'OUTPUT', priority: 10, active: true, effective_from: '2026-01-01', xero_account_code: '200' }];
    const gst = priceAppointment({ ...baseCtx, sploseServiceId: null, fundingType: null }, gstRule);
    expect(gst.totalTax).toBe(10);
    const exempt = priceAppointment(baseCtx, RULES); // EXEMPTOUTPUT
    expect(exempt.totalTax).toBe(0);
  });

  test('rule without account or item code warns', () => {
    const bare = [{ id: 'b', name: 'bare', unit_amount: 50, tax_type: 'NONE', priority: 10, active: true, effective_from: '2026-01-01' }];
    const out = priceAppointment({ ...baseCtx, sploseServiceId: null, fundingType: null }, bare);
    expect(out.warnings).toContain('no_account_or_item_code');
  });
});
