'use strict';

/**
 * Finance-flag unit tests. The load-bearing property: writes fail closed in
 * EVERY environment (unlike the Outlook/Splose flags which default on in dev).
 */

const ORIGINAL_ENV = { ...process.env };

function fresh(env) {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV };
  for (const k of Object.keys(process.env)) if (k.startsWith('ENABLE_XERO') || k === 'ENABLE_FINANCE_DASHBOARD') delete process.env[k];
  Object.assign(process.env, env);
  return require('../finance-flags');
}

afterEach(() => { process.env = { ...ORIGINAL_ENV }; jest.resetModules(); });

describe('read flags', () => {
  test('default ON when unset', () => {
    const f = fresh({ NODE_ENV: 'production' });
    expect(f.isXeroReadEnabled()).toBe(true);
    expect(f.isFinanceDashboardEnabled()).toBe(true);
  });
  test('explicit false turns read off', () => {
    const f = fresh({ ENABLE_XERO_READ: 'false' });
    expect(f.isXeroReadEnabled()).toBe(false);
  });
  test('exception dashboard defaults ON, explicit false turns it off', () => {
    let f = fresh({});
    expect(f.isExceptionDashboardEnabled()).toBe(true);
    f = fresh({ ENABLE_ACCOUNTING_EXCEPTION_DASHBOARD: 'false' });
    expect(f.isExceptionDashboardEnabled()).toBe(false);
  });
});

describe('write flags fail closed in every environment', () => {
  for (const NODE_ENV of ['development', 'test', 'staging', 'production']) {
    test(`unset write flags are OFF in ${NODE_ENV}`, () => {
      const f = fresh({ NODE_ENV });
      expect(f.isXeroWriteEnabled()).toBe(false);
      expect(f.isDraftInvoiceCreateEnabled()).toBe(false);
      expect(f.isApproveInvoiceEnabled()).toBe(false);
      expect(f.isSendInvoiceEnabled()).toBe(false);
      expect(f.isPaymentCreateEnabled()).toBe(false);
      expect(f.isAutoReconciliationEnabled()).toBe(false);
      expect(f.isWebhooksEnabled()).toBe(false);
    });
  }

  test('anything other than "true" is OFF', () => {
    const f = fresh({ NODE_ENV: 'development', ENABLE_XERO_WRITE: 'yes', ENABLE_XERO_DRAFT_INVOICE_CREATE: '1' });
    expect(f.isXeroWriteEnabled()).toBe(false);
    expect(f.isDraftInvoiceCreateEnabled()).toBe(false);
  });

  test('draft create requires BOTH master gate AND specific flag', () => {
    // Specific flag on, master gate off → still off.
    let f = fresh({ ENABLE_XERO_DRAFT_INVOICE_CREATE: 'true' });
    expect(f.isDraftInvoiceCreateEnabled()).toBe(false);
    // Master gate on, specific off → still off.
    f = fresh({ ENABLE_XERO_WRITE: 'true' });
    expect(f.isDraftInvoiceCreateEnabled()).toBe(false);
    // Both on → enabled.
    f = fresh({ ENABLE_XERO_WRITE: 'true', ENABLE_XERO_DRAFT_INVOICE_CREATE: 'true' });
    expect(f.isDraftInvoiceCreateEnabled()).toBe(true);
  });

  test('contact create requires BOTH master gate AND specific flag (hard rule)', () => {
    // The accidental-misconfiguration case the hard rule exists for:
    // specific flag true, master gate false → MUST stay blocked.
    let f = fresh({ ENABLE_XERO_CONTACT_CREATE: 'true' });
    expect(f.isContactCreateEnabled()).toBe(false);
    f = fresh({ ENABLE_XERO_WRITE: 'true' });
    expect(f.isContactCreateEnabled()).toBe(false);
    f = fresh({ ENABLE_XERO_WRITE: 'true', ENABLE_XERO_CONTACT_CREATE: 'true' });
    expect(f.isContactCreateEnabled()).toBe(true);
  });

  test('EVERY specific write helper is blocked by the global gate alone', () => {
    // All specific flags true, global gate off → everything still off.
    const f = fresh({
      ENABLE_XERO_DRAFT_INVOICE_CREATE: 'true', ENABLE_XERO_CONTACT_CREATE: 'true',
      ENABLE_XERO_APPROVE_INVOICE: 'true', ENABLE_XERO_SEND_INVOICE: 'true',
      ENABLE_XERO_PAYMENT_CREATE: 'true', ENABLE_XERO_AUTO_RECONCILIATION: 'true',
    });
    expect(f.isDraftInvoiceCreateEnabled()).toBe(false);
    expect(f.isContactCreateEnabled()).toBe(false);
    expect(f.isApproveInvoiceEnabled()).toBe(false);
    expect(f.isSendInvoiceEnabled()).toBe(false);
    expect(f.isPaymentCreateEnabled()).toBe(false);
    expect(f.isAutoReconciliationEnabled()).toBe(false);
  });

  test('webhooks flag is independent of the write master gate', () => {
    const f = fresh({ ENABLE_XERO_WEBHOOKS: 'true' });
    expect(f.isWebhooksEnabled()).toBe(true);
    expect(f.isXeroWriteEnabled()).toBe(false);
  });
});

describe('financeDisabledError', () => {
  test('names the flag, carries 403 + code, no secrets', () => {
    const f = fresh({});
    const err = f.financeDisabledError('ENABLE_XERO_DRAFT_INVOICE_CREATE', 'Draft invoice creation');
    expect(err.code).toBe('FINANCE_DISABLED');
    expect(err.statusCode).toBe(403);
    expect(err.message).toContain('ENABLE_XERO_DRAFT_INVOICE_CREATE');
    expect(err.message).not.toMatch(/secret|token|key=/i);
  });
});

describe('financeFlagState snapshot', () => {
  test('reports all flags', () => {
    const f = fresh({ ENABLE_XERO_WRITE: 'true', ENABLE_XERO_DRAFT_INVOICE_CREATE: 'true' });
    const s = f.financeFlagState();
    expect(s.xeroRead).toBe(true);
    expect(s.draftInvoiceCreate).toBe(true);
    expect(s.sendInvoice).toBe(false);
    expect(Object.keys(s)).toContain('autoReconciliation');
  });
});
