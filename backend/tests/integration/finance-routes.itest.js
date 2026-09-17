'use strict';

/**
 * Finance portal — real SQL over the Xero cache. Seeds sales invoices
 * (ACCREC) and bills (ACCPAY) for one connection and checks the dashboard
 * and invoicing aggregates, plus org scoping: a second organisation's
 * connection never leaks into the first owner's numbers. Xero HTTP is mocked;
 * the live best-effort reads fail and must degrade to warnings, not errors.
 */

jest.mock('../../xero-api', () => {
  const actual = jest.requireActual('../../xero-api');
  return {
    ...actual,
    isConfigured: jest.fn(() => true),
    apiGet: jest.fn(async () => { throw new Error('xero offline in test'); }),
    ensureValidToken: jest.fn(async () => 'plaintext-access-token'),
  };
});
jest.mock('../../xero-payroll-connection', () => ({
  health: jest.fn().mockResolvedValue({ configured: false, connected: false, reason: 'not configured' }),
}));

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { db, truncateAll, seedUser, seedOrganisation, closePool } = require('./helpers');
const adb = require('../../accounting-db');

const PASSWORD = 'FinPass1';

function buildApp() {
  const app = express();
  app.use(bodyParser.json());
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../finance-routes'));
  return app;
}

async function ownerFor(app, organisationId) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser({ password_hash: hash, role: 'owner', organisation_id: organisationId });
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user };
}

async function connect(user, tenantId) {
  return adb.upsertConnection({
    organisationId: user.organisation_id, tenantId, tenantName: 'Tenant ' + tenantId, tenantType: 'ORGANISATION',
    connectedByUserId: user.id, accessToken: 'at', refreshToken: 'rt', tokenExpiresAt: new Date(Date.now() + 1e6), baseCurrency: 'AUD',
  });
}

const today = new Date();
const ymd = (d) => d.toISOString().slice(0, 10);
const thisMonth = ymd(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 2)));
const lastMonth = ymd(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 2)));
const pastDue = ymd(new Date(Date.now() - 10 * 86400000));
const futureDue = ymd(new Date(Date.now() + 10 * 86400000));

function inv(id, type, status, date, total, due, extra = {}) {
  return { xero_invoice_id: id, invoice_number: id.toUpperCase(), contact_name: extra.contact || 'Someone', type, status,
    invoice_date: date, due_date: due, currency_code: 'AUD', sub_total: total, total_tax: 0, total, amount_due: extra.due ?? (status === 'PAID' ? 0 : total),
    amount_paid: status === 'PAID' ? total : 0, reference: null, updated_date_utc: new Date() };
}

beforeEach(async () => { await truncateAll(); require('../../auth')._resetLoginRateLimit(); });
afterAll(closePool);

describe('finance dashboard and invoicing over the cache', () => {
  test('aggregates revenue, bills, receivables and payables — scoped to the owner\'s organisation', async () => {
    const app = buildApp();
    const orgA = await seedOrganisation();
    const orgB = await seedOrganisation();
    const { agent, user } = await ownerFor(app, orgA.id);
    const { user: otherOwner } = await ownerFor(app, orgB.id);
    const connA = await connect(user, 'tenant-a');
    const connB = await connect(otherOwner, 'tenant-b');

    await adb.upsertCache('invoices', connA.id, [
      inv('inv-1', 'ACCREC', 'AUTHORISED', thisMonth, 300, futureDue, { contact: 'NDIA' }),
      inv('inv-2', 'ACCREC', 'AUTHORISED', lastMonth, 200, pastDue, { contact: 'Plan manager' }),
      inv('inv-3', 'ACCREC', 'PAID', lastMonth, 150, pastDue),
      inv('inv-4', 'ACCREC', 'DRAFT', thisMonth, 999, futureDue),
      inv('bill-1', 'ACCPAY', 'AUTHORISED', thisMonth, 120, pastDue, { contact: 'Rent Co' }),
      inv('bill-2', 'ACCPAY', 'PAID', lastMonth, 80, pastDue, { contact: 'Rent Co' }),
      inv('bill-3', 'ACCPAY', 'AUTHORISED', thisMonth, 40, futureDue, { contact: 'Telco' }),
    ]);
    await adb.upsertCache('invoices', connB.id, [
      inv('other-1', 'ACCREC', 'AUTHORISED', thisMonth, 10000, futureDue),
      inv('other-b', 'ACCPAY', 'AUTHORISED', thisMonth, 5000, pastDue),
    ]);

    const res = await agent.get('/api/finance/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
    const f = res.body.financials;
    expect(f.month).toEqual({ revenue: 300, expenses: 160, net: 140 });          // drafts excluded, org B excluded
    expect(f.receivable).toEqual({ outstanding: 500, overdue: 200 });
    expect(f.payable).toEqual({ outstanding: 160, overdue: 120, billsUnpaid: 2, billsOverdue: 1 });
    expect(f.topSuppliers[0]).toEqual({ name: 'Rent Co', total: 200, bills: 2 });
    expect(f.recentBills).toHaveLength(3);
    const months = Object.fromEntries(f.series.map((m) => [m.month, m]));
    expect(months[thisMonth.slice(0, 7)]).toEqual({ month: thisMonth.slice(0, 7), revenue: 300, expenses: 160, net: 140 });
    expect(months[lastMonth.slice(0, 7)]).toEqual({ month: lastMonth.slice(0, 7), revenue: 350, expenses: 80, net: 270 });
    // Live Xero is down in this test: the page still renders, with warnings.
    expect(res.body.recurring).toEqual([]);
    expect(res.body.profitAndLoss).toBeNull();
    expect(res.body.warnings.length).toBeGreaterThan(0);

    const inv$ = await agent.get('/api/finance/invoicing/summary');
    expect(inv$.status).toBe(200);
    expect(inv$.body.invoices.map((i) => i.xero_invoice_id).sort()).toEqual(['inv-1', 'inv-2', 'inv-3', 'inv-4']);
    expect(inv$.body.overview.outstandingBalance).toBe(500);
    const drafts = await agent.get('/api/finance/invoicing/summary?status=DRAFT');
    expect(drafts.body.invoices.map((i) => i.xero_invoice_id)).toEqual(['inv-4']);
  });

  test('payroll overview degrades honestly when the Custom Connection is not configured', async () => {
    const app = buildApp();
    const org = await seedOrganisation();
    const { agent } = await ownerFor(app, org.id);
    const res = await agent.get('/api/finance/payroll/overview');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ connected: false, configured: false, payRuns: [], calendars: [] });
    const run = await agent.get('/api/finance/payroll/pay-runs/11111111-2222-4333-8444-555555555555');
    expect(run.status).toBe(409);
  });

  test('non-owners are refused with real sessions', async () => {
    const app = buildApp();
    const org = await seedOrganisation();
    const hash = await bcrypt.hash(PASSWORD, 4);
    for (const role of ['admin', 'therapist', 'read_only']) {
      const user = await seedUser({ password_hash: hash, role, organisation_id: org.id });
      const agent = request.agent(app);
      await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
      for (const path of ['/api/finance/status', '/api/finance/dashboard', '/api/finance/payroll/overview', '/api/finance/invoicing/summary']) {
        expect(`${role} ${path} ${(await agent.get(path)).status}`).toBe(`${role} ${path} 403`);
      }
    }
    expect(db).toBeTruthy();
  });
});
