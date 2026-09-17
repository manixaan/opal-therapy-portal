'use strict';

/**
 * Finance portal routes — permission-boundary unit tests (no database).
 *
 * The invariant: every /api/finance route is owner-only and read-only. A
 * session is required, admin/therapist/read_only are refused, and nothing
 * here can reach Xero for a non-owner — the API modules are mocked and must
 * stay uncalled on every denial.
 */

jest.mock('../database', () => ({
  pool:               { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }), connect: jest.fn() },
  getUserByEmail:     jest.fn(),
  getUser:            jest.fn(),
  logAuditEvent:      jest.fn().mockResolvedValue(null),
  recordLogin:        jest.fn().mockResolvedValue(null),
  initializeDatabase: jest.fn().mockResolvedValue(null),
}));
jest.mock('../email', () => ({ sendVerificationEmail: jest.fn(), sendPasswordResetEmail: jest.fn() }));
jest.mock('../outlook-oauth', () => ({}));
jest.mock('../splose-api', () => ({}));
jest.mock('../accounting-db', () => ({
  getConnection: jest.fn().mockResolvedValue(null),
  updateConnectionTokens: jest.fn(),
  computeOverview: jest.fn(),
}));
jest.mock('../finance-db', () => ({
  computeFinancials: jest.fn(),
  listRecentSalesInvoices: jest.fn().mockResolvedValue([]),
  candidatePipeline: jest.fn().mockResolvedValue([]),
}));
jest.mock('../xero-api', () => ({ isConfigured: jest.fn(() => false), ensureValidToken: jest.fn(), apiGet: jest.fn() }));
jest.mock('../xero-payroll-api', () => ({
  getPayrollCalendars: jest.fn(), getEmployees: jest.fn(), getPayRunsForCalendar: jest.fn(), getPayRun: jest.fn(),
}));
jest.mock('../xero-payroll-connection', () => ({
  health: jest.fn().mockResolvedValue({ configured: false, connected: false, reason: 'not set' }),
}));

const request = require('supertest');
const bcrypt = require('bcryptjs');
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const db = require('../database');
const payrollApi = require('../xero-payroll-api');
const payrollConn = require('../xero-payroll-connection');
const fdb = require('../finance-db');

function buildApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(bodyParser.json());
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false, httpOnly: true } }));
  app.use('/', require('../auth'));
  app.use('/', require('../finance-routes'));
  return app;
}

const TEST_PASS = 'ValidPass1';
let TEST_HASH;
const ORG = 'cccccccc-2222-4222-8222-222222222222';
const mkUser = (role, n) => ({
  id: `${n}${n}${n}${n}${n}${n}${n}${n}-1111-4111-8111-11111111111${n}`,
  email: `${role}.${n}@opaltherapy.com.au`,
  role, is_active: true, account_status: 'active', email_verified: true,
  organisation_id: ORG, permissions: null, name: `${role} ${n}`,
});
const OWNER = mkUser('owner', 'a');
const OTHERS = [mkUser('admin', 'b'), mkUser('therapist', 'c'), mkUser('read_only', 'd')];
const USERS = Object.fromEntries([OWNER, ...OTHERS].map((u) => [u.id, u]));

let app;
let ipCounter = 0;
beforeAll(async () => {
  TEST_HASH = await bcrypt.hash(TEST_PASS, 1);
  app = buildApp();
  db.getUser.mockImplementation(async (id) => USERS[id] || null);
});
beforeEach(() => { jest.clearAllMocks(); db.getUser.mockImplementation(async (id) => USERS[id] || null); });

async function loginAs(user) {
  db.getUserByEmail.mockResolvedValueOnce({ ...user, password_hash: TEST_HASH });
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login')
    .set('X-Forwarded-For', `10.9.${Math.floor(ipCounter / 200)}.${(ipCounter++ % 200) + 10}`)
    .send({ email: user.email, password: TEST_PASS });
  expect(res.status).toBe(200);
  return agent;
}

const PAY_RUN = '11111111-2222-4333-8444-555555555555';
const ROUTES = [
  '/api/finance/status',
  '/api/finance/dashboard',
  '/api/finance/payroll/overview',
  `/api/finance/payroll/pay-runs/${PAY_RUN}`,
  '/api/finance/invoicing/summary',
];

describe('finance routes — owner only', () => {
  test('no session → 401 on every route', async () => {
    for (const path of ROUTES) expect((await request(app).get(path)).status).toBe(401);
  });

  test('admin, therapist and read_only → 403 on every route, and Xero is never called', async () => {
    for (const user of OTHERS) {
      const agent = await loginAs(user);
      for (const path of ROUTES) expect(`${user.role} ${path} ${(await agent.get(path)).status}`).toBe(`${user.role} ${path} 403`);
    }
    expect(payrollApi.getPayRun).not.toHaveBeenCalled();
    expect(payrollApi.getEmployees).not.toHaveBeenCalled();
    expect(fdb.computeFinancials).not.toHaveBeenCalled();
  });

  test('owner sees an honest disconnected state before anything is connected', async () => {
    const agent = await loginAs(OWNER);
    const status = await agent.get('/api/finance/status');
    expect(status.status).toBe(200);
    expect(status.body.accounting.connected).toBe(false);
    expect(status.body.payroll.connected).toBe(false);
    expect(status.body.flags.xeroWrite).toBe(false);

    const dash = await agent.get('/api/finance/dashboard');
    expect(dash.status).toBe(200);
    expect(dash.body.connected).toBe(false);
    expect(fdb.computeFinancials).not.toHaveBeenCalled();

    const payroll = await agent.get('/api/finance/payroll/overview');
    expect(payroll.status).toBe(200);
    expect(payroll.body.connected).toBe(false);
    expect(payrollApi.getEmployees).not.toHaveBeenCalled();

    const inv = await agent.get('/api/finance/invoicing/summary');
    expect(inv.status).toBe(200);
    expect(inv.body.connected).toBe(false);
    expect(Array.isArray(inv.body.pipeline)).toBe(true);
  });

  test('a pay run id that is not a GUID is rejected before any Xero call', async () => {
    const agent = await loginAs(OWNER);
    const res = await agent.get('/api/finance/payroll/pay-runs/not-a-guid');
    expect(res.status).toBe(400);
    expect(payrollConn.health).not.toHaveBeenCalled();
    expect(payrollApi.getPayRun).not.toHaveBeenCalled();
  });

  test('payroll overview summarises pay runs without leaking employee detail beyond name and status', async () => {
    payrollConn.health.mockResolvedValueOnce({ configured: true, connected: true, tenantName: 'Opal' });
    payrollApi.getPayrollCalendars.mockResolvedValueOnce([{ PayrollCalendarID: 'cal-1', Name: 'Fortnightly', CalendarType: 'FORTNIGHTLY' }]);
    payrollApi.getEmployees.mockResolvedValueOnce([
      { EmployeeID: 'e1', FirstName: 'Ann', LastName: 'Lee', Status: 'ACTIVE', PayrollCalendarID: 'cal-1', TaxFileNumber: '123456782', Email: 'ann@x' },
      { EmployeeID: 'e2', FirstName: 'Old', LastName: 'Hand', Status: 'TERMINATED' },
    ]);
    payrollApi.getPayRunsForCalendar.mockResolvedValueOnce([
      { PayRunID: PAY_RUN, PayrollCalendarID: 'cal-1', PayRunStatus: 'POSTED', PayRunPeriodStartDate: '/Date(1757289600000+0000)/', PayRunPeriodEndDate: '/Date(1758412800000+0000)/', PaymentDate: '/Date(1758585600000+0000)/', Wages: 5000, Tax: 900, Super: 575, NetPay: 4100 },
    ]);
    const agent = await loginAs(OWNER);
    const res = await agent.get('/api/finance/payroll/overview');
    expect(res.status).toBe(200);
    expect(res.body.employees).toEqual({ total: 2, active: 1, list: [{ id: 'e1', name: 'Ann Lee', status: 'ACTIVE', calendarId: 'cal-1' }] });
    expect(JSON.stringify(res.body)).not.toContain('123456782');
    expect(res.body.payRuns[0]).toMatchObject({ id: PAY_RUN, status: 'POSTED', netPay: 4100, super: 575, calendarName: 'Fortnightly', periodEnd: '2025-09-21' });
    expect(db.logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'finance.payroll.viewed' }));
  });

  test('read flags fail closed: dashboard is 403 when the finance dashboard is disabled', async () => {
    process.env.ENABLE_FINANCE_DASHBOARD = 'false';
    try {
      const agent = await loginAs(OWNER);
      expect((await agent.get('/api/finance/dashboard')).status).toBe(403);
    } finally { delete process.env.ENABLE_FINANCE_DASHBOARD; }
  });
});
