'use strict';

/**
 * XERO PAYROLL AU API CLIENT
 *
 * A thin, documented-endpoints-only client over https://api.xero.com/payroll.xro/1.0
 * (Xero Payroll AU OpenAPI 19.0.0). No SDK: the repository has none, and the
 * six operations this stage needs are simple enough that a hand-built client
 * with explicit headers is easier to audit than a generated one.
 *
 * Contract, in order of importance:
 *  - Every request carries `Xero-Tenant-Id`. Every POST carries a caller-
 *    supplied `Idempotency-Key` (≤128 chars) so a retry after a timeout
 *    returns Xero's original response instead of creating a second record.
 *  - 429 honours Retry-After; 429/5xx/network errors are retried with bounded
 *    exponential backoff and jitter. 400/401/403/404 are NOT retried.
 *  - A 401 invalidates the cached connection and is retried exactly once.
 *  - Xero returns validation failures as HTTP 400 with `ValidationErrors`
 *    on the element (and sometimes inside a 200). Both are parsed into a
 *    XeroPayrollError with `validationMessages` — safe strings from Xero —
 *    and never the payload that caused them.
 *  - Concurrency is capped below Xero's published limit of 5 concurrent
 *    requests per tenant; the sync itself is sequential.
 *  - Nothing sensitive is logged: not the request body (it carries a TFN and
 *    bank details), not the response body, not the token.
 */

const axios = require('axios');
const connection = require('./xero-payroll-connection');
const log = require('./logger').createLogger('xero-payroll-api');

const API_BASE = 'https://api.xero.com/payroll.xro/1.0';
const API_VERSION = 'payroll.xro/1.0 (OpenAPI 19.0.0)';
const MAX_ATTEMPTS = 4;
const MAX_CONCURRENT = 3;
const IDEMPOTENCY_MAX = 128;

class XeroPayrollError extends Error {
  constructor(message, { code, httpStatus = null, validationMessages = [], retryable = false, step = null } = {}) {
    super(message);
    this.name = 'XeroPayrollError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.validationMessages = validationMessages;
    this.retryable = retryable;
    this.step = step;
  }
  /** What may be stored or shown. No payloads. */
  toSafe() {
    return { code: this.code, httpStatus: this.httpStatus, message: this.message, validationMessages: this.validationMessages.slice(0, 10), retryable: this.retryable };
  }
}

// ── tiny semaphore ──────────────────────────────────────────────────────────
let active = 0;
const waiters = [];
async function acquire() {
  if (active < MAX_CONCURRENT) { active++; return; }
  await new Promise((resolve) => waiters.push(resolve));
  active++;
}
function release() {
  active--;
  const next = waiters.shift();
  if (next) next();
}

let sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Tests replace the wait so retry behaviour can be asserted without real delays. */
function _setSleep(fn) { sleep = fn; }

function backoffMs(attempt, retryAfterSeconds) {
  if (retryAfterSeconds) return Math.min(retryAfterSeconds, 60) * 1000;
  const base = Math.min(1000 * Math.pow(2, attempt), 16000);
  return base + Math.floor(Math.random() * 500);
}

/** Xero's validation messages, wherever it put them. */
function collectValidationMessages(data) {
  const out = [];
  const visit = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 4) return;
    if (Array.isArray(node)) { node.forEach((n) => visit(n, depth + 1)); return; }
    if (Array.isArray(node.ValidationErrors)) {
      for (const v of node.ValidationErrors) if (v && v.Message) out.push(String(v.Message).slice(0, 300));
    }
    if (Array.isArray(node.Elements)) node.Elements.forEach((n) => visit(n, depth + 1));
    for (const key of ['Employees', 'SuperFunds', 'PayrollCalendars']) if (Array.isArray(node[key])) node[key].forEach((n) => visit(n, depth + 1));
    if (node.Message && depth === 0 && !out.length && node.Type) out.push(String(node.Message).slice(0, 300));
  };
  visit(data, 0);
  return out;
}

function classify(err, step) {
  const status = err.response?.status || null;
  const data = err.response?.data;
  const validation = collectValidationMessages(data);
  if (status === 400) {
    return new XeroPayrollError(validation.length ? 'Xero rejected the request' : 'Xero could not process the request', { code: 'XERO_VALIDATION', httpStatus: status, validationMessages: validation, step });
  }
  if (status === 401) return new XeroPayrollError('Xero rejected the payroll connection token', { code: 'XERO_UNAUTHORISED', httpStatus: status, step });
  if (status === 403) return new XeroPayrollError('The Xero payroll connection does not have permission for this operation', { code: 'XERO_FORBIDDEN', httpStatus: status, step });
  if (status === 404) return new XeroPayrollError('Xero could not find that record', { code: 'XERO_NOT_FOUND', httpStatus: status, step });
  if (status === 429) return new XeroPayrollError('Xero rate limit reached', { code: 'XERO_RATE_LIMITED', httpStatus: status, retryable: true, step });
  if (status && status >= 500) return new XeroPayrollError('Xero is temporarily unavailable', { code: 'XERO_UNAVAILABLE', httpStatus: status, retryable: true, step });
  if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') return new XeroPayrollError('The request to Xero timed out', { code: 'XERO_TIMEOUT', httpStatus: null, retryable: true, step });
  if (!status) return new XeroPayrollError('Could not reach Xero', { code: 'XERO_NETWORK', httpStatus: null, retryable: true, step });
  return new XeroPayrollError('Xero returned an unexpected response', { code: 'XERO_ERROR', httpStatus: status, step });
}

/**
 * One request with the full retry/backoff/401 contract.
 * @param {object} p
 * @param {'GET'|'POST'} p.method
 * @param {string} p.path             e.g. '/Employees'
 * @param {object} [p.params]
 * @param {object} [p.body]
 * @param {string} [p.idempotencyKey] required for POST
 * @param {string} [p.step]           label for errors and the operation log
 * @param {function} [p.onAttempt]    ({attempt, httpStatus, outcome}) — the operation log hook
 */
async function request({ method, path, params, body, idempotencyKey, step = null, onAttempt = null, http = axios }) {
  if (method === 'POST') {
    if (!idempotencyKey) throw new XeroPayrollError('An idempotency key is required for every write', { code: 'IDEMPOTENCY_KEY_REQUIRED', step });
    if (idempotencyKey.length > IDEMPOTENCY_MAX) throw new XeroPayrollError('Idempotency key exceeds 128 characters', { code: 'IDEMPOTENCY_KEY_TOO_LONG', step });
  }
  let unauthorisedRetried = false;
  let lastErr = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const conn = await connection.getConnection({ http });
    await acquire();
    try {
      const res = await http.request({
        method, url: `${API_BASE}${path}`, params, data: body,
        headers: {
          Authorization: `Bearer ${conn.accessToken}`,
          'Xero-Tenant-Id': conn.tenantId,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        timeout: 30000,
        validateStatus: () => true,
      });
      const status = res.status;
      if (status >= 200 && status < 300) {
        // Xero can answer 200 while flagging ValidationErrors on the element.
        const validation = collectValidationMessages(res.data);
        if (validation.length) {
          if (onAttempt) onAttempt({ attempt, httpStatus: status, outcome: 'validation_error', errorCode: 'XERO_VALIDATION', errorMessage: validation[0] });
          throw new XeroPayrollError('Xero accepted the request but reported validation errors', { code: 'XERO_VALIDATION', httpStatus: status, validationMessages: validation, step });
        }
        if (onAttempt) onAttempt({ attempt, httpStatus: status, outcome: 'ok' });
        return res.data;
      }
      const fake = new Error(`HTTP ${status}`);
      fake.response = { status, data: res.data, headers: res.headers || {} };
      throw fake;
    } catch (raw) {
      if (raw instanceof XeroPayrollError) throw raw;
      const err = classify(raw, step);
      lastErr = err;
      if (onAttempt) onAttempt({ attempt, httpStatus: err.httpStatus, outcome: err.retryable ? 'retryable_error' : (err.code === 'XERO_VALIDATION' ? 'validation_error' : 'error'), errorCode: err.code, errorMessage: err.message });
      if (err.code === 'XERO_UNAUTHORISED' && !unauthorisedRetried) {
        unauthorisedRetried = true;
        connection.invalidate();
        continue;
      }
      if (!err.retryable || attempt === MAX_ATTEMPTS - 1) throw err;
      const retryAfter = Number(raw.response?.headers?.['retry-after']) || 0;
      log.warn('Xero payroll request will be retried', { step, attempt, httpStatus: err.httpStatus, code: err.code });
      await sleep(backoffMs(attempt, retryAfter));
    } finally {
      release();
    }
  }
  throw lastErr || new XeroPayrollError('Xero request failed', { code: 'XERO_ERROR', step });
}

// ── Reference data (read scopes) ────────────────────────────────────────────

async function getAllPages(path, key, opts = {}) {
  const items = [];
  for (let page = 1; page <= 50; page++) {
    const data = await request({ method: 'GET', path, params: { ...(opts.params || {}), page }, step: opts.step, http: opts.http });
    const batch = (data && data[key]) || [];
    items.push(...batch);
    if (batch.length < 100) break;
  }
  return items;
}

const getPayrollCalendars = (o = {}) => getAllPages('/PayrollCalendars', 'PayrollCalendars', { ...o, step: 'reference.calendars' });
const getSuperFunds = (o = {}) => getAllPages('/Superfunds', 'SuperFunds', { ...o, step: 'reference.superfunds' });
const getEmployees = (o = {}) => getAllPages('/Employees', 'Employees', { ...o, step: o.step || 'duplicate_check' });
async function getPayItems(o = {}) {
  const data = await request({ method: 'GET', path: '/PayItems', step: 'reference.payitems', http: o.http });
  const p = (data && data.PayItems) || {};
  return { earningsRates: p.EarningsRates || [], leaveTypes: p.LeaveTypes || [], deductionTypes: p.DeductionTypes || [], reimbursementTypes: p.ReimbursementTypes || [] };
}
async function getSuperFundProducts({ abn, usi, http } = {}) {
  const data = await request({ method: 'GET', path: '/SuperfundProducts', params: { ...(abn ? { ABN: abn } : {}), ...(usi ? { USI: usi } : {}) }, step: 'reference.superfundproducts', http });
  return (data && data.SuperFundProducts) || [];
}

// ── Employees ───────────────────────────────────────────────────────────────

async function getEmployee(employeeId, o = {}) {
  const data = await request({ method: 'GET', path: `/Employees/${encodeURIComponent(employeeId)}`, step: o.step || 'read_back', http: o.http, onAttempt: o.onAttempt });
  return ((data && data.Employees) || [])[0] || null;
}
async function createEmployee(employee, { idempotencyKey, onAttempt, http } = {}) {
  const data = await request({ method: 'POST', path: '/Employees', body: [employee], idempotencyKey, step: 'create_employee', onAttempt, http });
  return ((data && data.Employees) || [])[0] || null;
}
async function updateEmployee(employeeId, patch, { idempotencyKey, step = 'update_employee', onAttempt, http } = {}) {
  const data = await request({ method: 'POST', path: `/Employees/${encodeURIComponent(employeeId)}`, body: [patch], idempotencyKey, step, onAttempt, http });
  return ((data && data.Employees) || [])[0] || null;
}

// ── Super funds (write only when the scope is granted) ──────────────────────

async function createSuperFund(fund, { idempotencyKey, onAttempt, http } = {}) {
  const data = await request({ method: 'POST', path: '/Superfunds', body: [fund], idempotencyKey, step: 'create_superfund', onAttempt, http });
  return ((data && data.SuperFunds) || [])[0] || null;
}

// ── Pay runs (read only) ────────────────────────────────────────────────────

async function getPayRunsForCalendar(payrollCalendarId, o = {}) {
  return getAllPages('/PayRuns', 'PayRuns', { params: { where: `PayrollCalendarID==Guid("${payrollCalendarId}")` }, step: 'pay_run_check', http: o.http });
}
async function getPayRun(payRunId, o = {}) {
  const data = await request({ method: 'GET', path: `/PayRuns/${encodeURIComponent(payRunId)}`, step: 'pay_run_check', http: o.http });
  return ((data && data.PayRuns) || [])[0] || null;
}

module.exports = {
  API_BASE, API_VERSION, MAX_ATTEMPTS, MAX_CONCURRENT, IDEMPOTENCY_MAX,
  XeroPayrollError, request, collectValidationMessages, backoffMs, _setSleep,
  getPayrollCalendars, getPayItems, getSuperFunds, getSuperFundProducts, getEmployees,
  getEmployee, createEmployee, updateEmployee, createSuperFund,
  getPayRunsForCalendar, getPayRun,
};
