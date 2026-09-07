'use strict';

/**
 * XERO PAYROLL AU CLIENT — the HTTP contract, with axios replaced by a stub.
 *
 * Headers, idempotency, 429 with Retry-After, transient 5xx, retry
 * exhaustion, the single 401 retry, validation errors inside an HTTP 200,
 * and redaction: no secret ever appears in an error or a log line.
 */

const connection = require('../xero-payroll-connection');
const api = require('../xero-payroll-api');
const flags = require('../finance-flags');

jest.mock('../logger', () => {
  const lines = [];
  const logger = { info: (m, x) => lines.push(['info', m, x]), warn: (m, x) => lines.push(['warn', m, x]), error: (m, x) => lines.push(['error', m, x]) };
  return { createLogger: () => logger, redact: (v) => v, _lines: lines };
});
const logLines = require('../logger')._lines;

const sleeps = [];
api._setSleep(async (ms) => { sleeps.push(ms); });

function stubHttp(responses) {
  const calls = [];
  const http = {
    post: jest.fn(async () => ({ data: { access_token: 'tok-secret-value', expires_in: 1800, scope: 'payroll.employees payroll.settings.read payroll.payruns.read' } })),
    get: jest.fn(async () => ({ data: [{ tenantId: 'tenant-0000-1234-abcdef', tenantName: 'Opal Demo', tenantType: 'ORGANISATION' }] })),
    request: jest.fn(async (cfg) => {
      calls.push(cfg);
      const r = responses.shift();
      if (r instanceof Error) throw r;
      return { status: r.status, data: r.data, headers: r.headers || {} };
    }),
  };
  return { http, calls };
}

beforeEach(() => {
  process.env.XERO_PAYROLL_CLIENT_ID = 'id'; process.env.XERO_PAYROLL_CLIENT_SECRET = 'secret-value';
  delete process.env.ENABLE_XERO_WRITE; delete process.env.ENABLE_XERO_PAYROLL_SYNC; delete process.env.ENABLE_XERO_PAYROLL_SUPERFUND_CREATE;
  connection.invalidate();
  logLines.length = 0;
  sleeps.length = 0;
});

// Real timers are fine: backoff is stubbed to 0.
describe('connection', () => {
  test('fails closed when unconfigured and never falls back to the accounting tokens', async () => {
    delete process.env.XERO_PAYROLL_CLIENT_ID;
    await expect(connection.getConnection()).rejects.toMatchObject({ code: 'XERO_PAYROLL_NOT_CONFIGURED', statusCode: 503 });
    expect((await connection.health()).configured).toBe(false);
  });
  test('requests least-privilege scopes; payroll.settings only with fund creation on', () => {
    expect(connection.scopes()).toEqual(['payroll.employees', 'payroll.settings.read', 'payroll.payruns.read']);
    process.env.ENABLE_XERO_WRITE = 'true'; process.env.ENABLE_XERO_PAYROLL_SYNC = 'true'; process.env.ENABLE_XERO_PAYROLL_SUPERFUND_CREATE = 'true';
    expect(connection.scopes()).toContain('payroll.settings');
    expect(connection.scopes()).not.toContain('payroll.payruns');
    expect(connection.scopes()).not.toContain('payroll.payslip');
    expect(flags.isPayrollSyncEnabled()).toBe(true);
  });
  test('caches the token for its lifetime and exposes only a tenant suffix', async () => {
    const { http } = stubHttp([]);
    const a = await connection.getConnection({ http }); const b = await connection.getConnection({ http });
    expect(a).toBe(b);
    expect(http.post).toHaveBeenCalledTimes(1);
    const h = await connection.health({ http });
    expect(h).toMatchObject({ configured: true, connected: true, tenantIdSuffix: 'abcdef', tenantName: 'Opal Demo' });
    expect(JSON.stringify(h)).not.toContain('tok-secret-value');
    expect(JSON.stringify(h)).not.toContain('tenant-0000-1234-abcdef');
  });
});

describe('request contract', () => {
  test('sends the tenant header, the idempotency key and a bearer token', async () => {
    const { http, calls } = stubHttp([{ status: 200, data: { Employees: [{ EmployeeID: 'e-1' }] }, headers: {} }]);
    const emp = await api.createEmployee({ FirstName: 'A' }, { idempotencyKey: 'opal-payroll-op-create', http });
    expect(emp.EmployeeID).toBe('e-1');
    expect(calls[0].headers).toMatchObject({ 'Xero-Tenant-Id': 'tenant-0000-1234-abcdef', 'Idempotency-Key': 'opal-payroll-op-create', Authorization: 'Bearer tok-secret-value', 'Content-Type': 'application/json' });
    expect(calls[0].url).toBe('https://api.xero.com/payroll.xro/1.0/Employees');
    expect(calls[0].data).toEqual([{ FirstName: 'A' }]);
  });
  test('refuses a POST without an idempotency key or with one over 128 characters', async () => {
    const { http } = stubHttp([]);
    await expect(api.createEmployee({}, { http })).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
    await expect(api.createEmployee({}, { idempotencyKey: 'k'.repeat(129), http })).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_TOO_LONG' });
  });
  test('429 honours Retry-After then succeeds; 5xx is retried; exhaustion surfaces as retryable', async () => {
    const { http } = stubHttp([{ status: 429, data: {}, headers: { 'retry-after': '1' } }, { status: 503, data: {} }, { status: 200, data: { Employees: [{ EmployeeID: 'e-2' }] } }]);
    const emp = await api.getEmployee('e-2', { http });
    expect(emp.EmployeeID).toBe('e-2');
    expect(sleeps[0]).toBe(1000); // Retry-After: 1
    expect(sleeps[1]).toBeGreaterThanOrEqual(2000); // exponential backoff with jitter
    const exhausted = stubHttp(Array.from({ length: api.MAX_ATTEMPTS }, () => ({ status: 500, data: {} })));
    await expect(api.getEmployee('e-2', { http: exhausted.http })).rejects.toMatchObject({ code: 'XERO_UNAVAILABLE', retryable: true, httpStatus: 500 });
    expect(exhausted.http.request).toHaveBeenCalledTimes(api.MAX_ATTEMPTS);
  });
  test('a 401 invalidates the token and retries exactly once', async () => {
    const { http } = stubHttp([{ status: 401, data: {} }, { status: 401, data: {} }]);
    await expect(api.getEmployee('e-3', { http })).rejects.toMatchObject({ code: 'XERO_UNAUTHORISED', retryable: false });
    expect(http.request).toHaveBeenCalledTimes(2);
    expect(http.post).toHaveBeenCalledTimes(2); // re-authorised after the first 401
  });
  test('validation errors are not retried, and are parsed from a 400 and from inside a 200', async () => {
    const bad = stubHttp([{ status: 400, data: { Elements: [{ ValidationErrors: [{ Message: 'BSB is invalid' }] }] } }]);
    await expect(api.createEmployee({}, { idempotencyKey: 'k', http: bad.http })).rejects.toMatchObject({ code: 'XERO_VALIDATION', validationMessages: ['BSB is invalid'], retryable: false });
    expect(bad.http.request).toHaveBeenCalledTimes(1);
    const sneaky = stubHttp([{ status: 200, data: { Employees: [{ EmployeeID: 'e-4', ValidationErrors: [{ Message: 'Payroll calendar is required' }] }] } }]);
    await expect(api.updateEmployee('e-4', {}, { idempotencyKey: 'k2', http: sneaky.http })).rejects.toMatchObject({ code: 'XERO_VALIDATION', validationMessages: ['Payroll calendar is required'] });
  });
  test('timeouts and network failures are retryable and reported without the payload', async () => {
    const t = Object.assign(new Error('timeout of 30000ms exceeded'), { code: 'ECONNABORTED' });
    const { http } = stubHttp([t, t, t, t]);
    const err = await api.createEmployee({ TaxDeclaration: { TaxFileNumber: '123456789' }, BankAccounts: [{ AccountNumber: '99887766' }] }, { idempotencyKey: 'k3', http }).catch((e) => e);
    expect(err).toMatchObject({ code: 'XERO_TIMEOUT', retryable: true });
    const everything = JSON.stringify([err.toSafe(), err.message, logLines]);
    expect(everything).not.toContain('123456789');
    expect(everything).not.toContain('99887766');
    expect(everything).not.toContain('tok-secret-value');
    expect(everything).not.toContain('secret-value');
  });
  test('the operation hook sees each attempt with a safe outcome only', async () => {
    const seen = [];
    const { http } = stubHttp([{ status: 503, data: {} }, { status: 200, data: { Employees: [{ EmployeeID: 'e-5' }] } }]);
    await api.createEmployee({ TaxDeclaration: { TaxFileNumber: '123456789' } }, { idempotencyKey: 'k4', http, onAttempt: (x) => seen.push(x) });
    expect(seen.map((x) => [x.attempt, x.outcome, x.httpStatus])).toEqual([[0, 'retryable_error', 503], [1, 'ok', 200]]);
    expect(JSON.stringify(seen)).not.toContain('123456789');
  });
  test('pay runs are filtered by calendar id in the where clause and pages are followed', async () => {
    const page = (n) => ({ status: 200, data: { PayRuns: Array.from({ length: n }, (_, i) => ({ PayRunID: `p${i}` })) } });
    const { http, calls } = stubHttp([page(100), page(3)]);
    const runs = await api.getPayRunsForCalendar('cal-1', { http });
    expect(runs).toHaveLength(103);
    expect(calls[0].params).toEqual({ where: 'PayrollCalendarID==Guid("cal-1")', page: 1 });
    expect(calls[1].params.page).toBe(2);
  });
});
