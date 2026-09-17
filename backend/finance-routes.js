'use strict';

/**
 * FINANCE PORTAL ROUTES (owner-only, READ-ONLY)
 *
 * One home for the practice's money: a financial dashboard (revenue, expenses,
 * recurring expenses, receivables/payables), payroll (Xero Payroll AU pay
 * runs and employees) and invoicing (the Splose → Xero pipeline the
 * accounting module already runs). This file adds no new writes to Xero: the
 * dashboard and invoicing read the accounting sync cache, live Xero calls
 * are GET only, and every payroll call uses the read scopes the payroll
 * Custom Connection already holds. Invoice creation stays in
 * accounting-routes.js behind its fail-closed write flags.
 *
 * Route map:
 *   GET /api/finance/status                 both Xero connections + flags
 *   GET /api/finance/dashboard              cache aggregates + live recurring bills / P&L (best effort)
 *   GET /api/finance/payroll/overview       calendars, employee count, recent pay runs
 *   GET /api/finance/payroll/pay-runs/:id   one pay run with per-employee totals
 *   GET /api/finance/invoicing/summary      overview, recent sales invoices, candidate pipeline
 *
 * Trust boundaries:
 *   - every route: requireAuth + requireRole('owner'); the frontend hide is cosmetic
 *   - the accounting connection is looked up by the SESSION's organisation
 *   - read flags (ENABLE_XERO_READ / ENABLE_FINANCE_DASHBOARD) fail closed to 403
 *   - a live Xero failure never fails the page: the section degrades with a warning
 *   - responses carry money totals and business names, never tokens or TFNs
 */

const express = require('express');
const router = express.Router();

const db = require('./database');
const adb = require('./accounting-db');
const fdb = require('./finance-db');
const xeroApi = require('./xero-api');
const payrollApi = require('./xero-payroll-api');
const payrollConn = require('./xero-payroll-connection');
const flags = require('./finance-flags');
const { requireAuth, requireRole } = require('./permissions');

const log = require('./logger').createLogger('finance');

const ownerOnly = [requireAuth, requireRole('owner')];
const safe = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  log.error('finance route error', { error: err, path: req.path });
  if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
});

function orgId(req) { return req.user?.organisation_id || null; }
function audit(req, action, metadata) {
  return db.logAuditEvent({
    actorUserId: req.user?.id, action, targetType: 'finance', targetId: null,
    ipAddress: req.ip, organisationId: orgId(req), metadata: metadata || null,
  }).catch(() => {});
}

/** Access token for the org's accounting connection, refreshing if needed. */
async function accountingToken(conn) {
  return xeroApi.ensureValidToken(conn, (refreshed) => adb.updateConnectionTokens(conn.id, refreshed));
}

/** Xero's /Date(1234567890000+0000)/ or ISO → YYYY-MM-DD, else null. */
function xeroDate(v) {
  if (!v) return null;
  const m = /\/Date\((\d+)/.exec(String(v));
  const d = m ? new Date(Number(m[1])) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// ── Status ───────────────────────────────────────────────────────────────────

router.get('/api/finance/status', ...ownerOnly, safe(async (req, res) => {
  const conn = await adb.getConnection(orgId(req));
  const payroll = await payrollConn.health();
  res.json({
    accounting: {
      configured: xeroApi.isConfigured(),
      connected: !!conn,
      organisation: conn ? conn.xero_tenant_name : null,
      baseCurrency: conn?.base_currency || 'AUD',
      lastConnectedAt: conn?.connected_at || null,
    },
    payroll: {
      configured: payroll.configured, connected: payroll.connected,
      tenantName: payroll.tenantName || null, reason: payroll.connected ? null : (payroll.reason || null),
      syncEnabled: payroll.syncEnabled,
    },
    flags: flags.financeFlagState(),
  });
}));

// ── Dashboard ────────────────────────────────────────────────────────────────

router.get('/api/finance/dashboard', ...ownerOnly, safe(async (req, res) => {
  if (!flags.isFinanceDashboardEnabled() || !flags.isXeroReadEnabled()) {
    return res.status(403).json({ error: 'Finance dashboard disabled', code: 'dashboard_disabled' });
  }
  const conn = await adb.getConnection(orgId(req));
  if (!conn) return res.json({ connected: false, financials: null, recurring: [], profitAndLoss: null, warnings: [] });

  const financials = await fdb.computeFinancials(conn.id, { months: 6 });
  const warnings = [];
  let recurring = [];
  let profitAndLoss = null;

  // Live, best-effort reads. The page must render from the cache alone.
  try {
    const token = await accountingToken(conn);
    const tenant = conn.xero_tenant_id;
    try {
      const data = await xeroApi.apiGet(token, tenant, '/RepeatingInvoices', {});
      recurring = (data?.RepeatingInvoices || [])
        .filter((r) => r.Type === 'ACCPAY' && r.Status === 'AUTHORISED')
        .map((r) => ({
          id: r.RepeatingInvoiceID, contact: r.Contact?.Name || null, reference: r.Reference || null,
          total: Number(r.Total || 0), currency: r.CurrencyCode || null,
          period: r.Schedule ? `${r.Schedule.Period} ${String(r.Schedule.Unit || '').toLowerCase()}` : null,
          nextDate: xeroDate(r.Schedule?.NextScheduledDate),
        }))
        .sort((a, b) => (a.nextDate || '') < (b.nextDate || '') ? -1 : 1);
    } catch (err) {
      log.warn('recurring invoices unavailable', { error: err.message });
      warnings.push('Recurring expenses could not be read from Xero right now.');
    }
    try {
      const data = await xeroApi.apiGet(token, tenant, '/Reports/ProfitAndLoss', { periods: 1, timeframe: 'MONTH' });
      const report = data?.Reports?.[0];
      if (report) {
        const rows = [];
        for (const section of report.Rows || []) {
          for (const row of section.Rows || []) {
            if (row.RowType !== 'SummaryRow') continue;
            const cells = row.Cells || [];
            rows.push({ label: cells[0]?.Value || section.Title || '', value: Number(cells[1]?.Value || 0) });
          }
        }
        profitAndLoss = { title: report.ReportTitles?.slice(0, 3).join(' · ') || 'Profit and Loss', rows };
      }
    } catch (err) {
      log.warn('profit and loss unavailable', { error: err.message });
      warnings.push('The Profit and Loss report could not be read from Xero right now.');
    }
  } catch (err) {
    log.warn('accounting token unavailable', { error: err.message });
    warnings.push('Xero needs reconnecting before live figures can be shown.');
  }

  res.json({
    connected: true, organisation: conn.xero_tenant_name, currency: conn.base_currency || 'AUD',
    financials, recurring, profitAndLoss, warnings,
  });
}));

// ── Payroll (Xero Payroll AU, read scopes only) ──────────────────────────────

function payRunSummary(r) {
  return {
    id: r.PayRunID, calendarId: r.PayrollCalendarID || null, status: r.PayRunStatus || null,
    periodStart: xeroDate(r.PayRunPeriodStartDate), periodEnd: xeroDate(r.PayRunPeriodEndDate),
    paymentDate: xeroDate(r.PaymentDate),
    wages: Number(r.Wages || 0), deductions: Number(r.Deductions || 0), tax: Number(r.Tax || 0),
    super: Number(r.Super || 0), reimbursement: Number(r.Reimbursement || 0), netPay: Number(r.NetPay || 0),
  };
}

router.get('/api/finance/payroll/overview', ...ownerOnly, safe(async (req, res) => {
  const health = await payrollConn.health();
  if (!health.connected) {
    return res.json({ connected: false, configured: health.configured, reason: health.reason || null, calendars: [], employees: null, payRuns: [] });
  }
  const warnings = [];
  let calendars = [];
  let employees = null;
  let payRuns = [];
  try {
    calendars = (await payrollApi.getPayrollCalendars()).map((c) => ({
      id: c.PayrollCalendarID, name: c.Name, type: c.CalendarType, startDate: xeroDate(c.StartDate), paymentDate: xeroDate(c.PaymentDate),
    }));
  } catch (err) { log.warn('payroll calendars unavailable', { error: err.message }); warnings.push('Payroll calendars could not be read.'); }
  try {
    const list = await payrollApi.getEmployees({ step: 'finance.employees' });
    const active = list.filter((e) => e.Status !== 'TERMINATED');
    employees = {
      total: list.length, active: active.length,
      list: active.map((e) => ({ id: e.EmployeeID, name: [e.FirstName, e.LastName].filter(Boolean).join(' '), status: e.Status || null, calendarId: e.PayrollCalendarID || null }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  } catch (err) { log.warn('payroll employees unavailable', { error: err.message }); warnings.push('Employees could not be read from Xero Payroll.'); }
  try {
    for (const cal of calendars) {
      const runs = await payrollApi.getPayRunsForCalendar(cal.id);
      payRuns.push(...runs.map((r) => ({ ...payRunSummary(r), calendarName: cal.name })));
    }
    payRuns.sort((a, b) => ((b.periodEnd || '') > (a.periodEnd || '') ? 1 : -1));
    payRuns = payRuns.slice(0, 12);
  } catch (err) { log.warn('pay runs unavailable', { error: err.message }); warnings.push('Pay runs could not be read.'); }

  await audit(req, 'finance.payroll.viewed', { calendars: calendars.length, payRuns: payRuns.length });
  res.json({ connected: true, tenantName: health.tenantName || null, calendars, employees, payRuns, warnings });
}));

router.get('/api/finance/payroll/pay-runs/:id', ...ownerOnly, safe(async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'Invalid pay run id' });
  const health = await payrollConn.health();
  if (!health.connected) return res.status(409).json({ error: 'Xero Payroll is not connected', code: 'payroll_disconnected' });
  const run = await payrollApi.getPayRun(id);
  if (!run) return res.status(404).json({ error: 'Not found' });
  const payslips = (run.Payslips || []).map((p) => ({
    id: p.PayslipID, name: [p.FirstName, p.LastName].filter(Boolean).join(' '),
    wages: Number(p.Wages || 0), tax: Number(p.Tax || 0), super: Number(p.Super || 0),
    deductions: Number(p.Deductions || 0), reimbursements: Number(p.Reimbursements || 0), netPay: Number(p.NetPay || 0),
  }));
  await audit(req, 'finance.payroll.pay_run.viewed', { payRunId: id, payslips: payslips.length });
  res.json({ payRun: payRunSummary(run), payslips });
}));

// ── Invoicing ────────────────────────────────────────────────────────────────

router.get('/api/finance/invoicing/summary', ...ownerOnly, safe(async (req, res) => {
  if (!flags.isXeroReadEnabled()) return res.status(403).json({ error: 'Xero read disabled' });
  const org = orgId(req);
  const conn = await adb.getConnection(org);
  const pipeline = await fdb.candidatePipeline(org);
  if (!conn) return res.json({ connected: false, overview: null, invoices: [], pipeline, flags: flags.financeFlagState() });
  const status = ['DRAFT', 'AUTHORISED', 'PAID', 'SUBMITTED', 'VOIDED'].includes(String(req.query.status || '').toUpperCase())
    ? String(req.query.status).toUpperCase() : undefined;
  const [overview, invoices] = await Promise.all([
    adb.computeOverview(conn.id),
    fdb.listRecentSalesInvoices(conn.id, { limit: 40, status }),
  ]);
  res.json({ connected: true, organisation: conn.xero_tenant_name, overview, invoices, pipeline, flags: flags.financeFlagState() });
}));

module.exports = router;
