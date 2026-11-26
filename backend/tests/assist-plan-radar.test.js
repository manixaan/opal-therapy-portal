'use strict';

/**
 * Opal Assist — the plan review radar.
 *   - backend/assist/plan-radar.js: which plans, funding used (Splose invoice
 *     lines for the case's own appointments/activities + unambiguous portal
 *     invoices), track types, pace, report and note checks;
 *   - GET /api/assist/plan-reviews: caseload scoping (therapist = own
 *     practitioner's cases), Splose down, invoices down, audit by counts,
 *     never a model call;
 *   - frontend/current/assist-plan-radar.js: wording, the panel, Start report.
 * Synthetic data only.
 */

jest.mock('../database', () => ({
  pool:               { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) },
  getUserByEmail:     jest.fn(),
  getUser:            jest.fn(),
  logAuditEvent:      jest.fn().mockResolvedValue(null),
  recordLogin:        jest.fn().mockResolvedValue(null),
  initializeDatabase: jest.fn().mockResolvedValue(null),
}));
jest.mock('../email', () => ({ sendVerificationEmail: jest.fn(), sendPasswordResetEmail: jest.fn() }));
jest.mock('../outlook-oauth', () => ({}));
jest.mock('../splose-api', () => ({
  isConfigured: () => true, getContacts: jest.fn(), getPractitioners: jest.fn(),
  fetchAllCases: jest.fn(), getPatients: jest.fn(), getInvoices: jest.fn(), peekPatient: jest.fn(), getPatient: jest.fn(),
}));

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const db = require('../database');
const sploseApi = require('../splose-api');
const provider = require('../assist/assist-provider');
const routes = require('../assist-routes');
const R = require('../assist/plan-radar');
const ui = require('../../frontend/current/assist-plan-radar.js');

const NOW = new Date('2026-11-26T02:00:00Z'); // 26 Nov 2026 in Perth

const kase = (over) => ({
  id: 1, caseNumber: 'C-1', patientId: 101, practitionerId: 'P1', isOpen: true,
  issueDate: '2026-02-01 00:00:00', expiryDate: '2026-12-31 00:00:00', trackType: 'Budget', budget: 10000, hours: null, appointmentCount: null,
  items: [{ type: 'Appointment', typeId: 11 }, { type: 'Appointment', typeId: 12 }, { type: 'SupportActivity', typeId: 21 }],
  ...over,
});
const invoice = (over) => ({
  id: 900, patientId: 101, status: 'Paid', isArchived: false,
  invoiceItems: [
    { type: 'appointment', typeId: 11, unitPrice: 193.99, quantity: 1 },
    { type: 'appointment', typeId: 12, unitPrice: 193.99, quantity: 1.5 },
    { type: 'supportActivity', typeId: 21, unitPrice: 193.99, quantity: 0.5 },
    { type: 'appointment', typeId: 99, unitPrice: 500, quantity: 1 }, // another case's appointment
  ],
  ...over,
});

// ── pure ─────────────────────────────────────────────────────────────────────
describe('which plans', () => {
  test('window: next 8 weeks and 2 weeks past; open, not archived; scoped', () => {
    const cases = [
      kase({ id: 1, expiryDate: '2026-12-31' }),                       // in 5 weeks
      kase({ id: 2, expiryDate: '2027-03-01' }),                       // too far
      kase({ id: 3, expiryDate: '2026-11-15' }),                       // ended 11 days ago
      kase({ id: 4, expiryDate: '2026-11-01' }),                       // ended too long ago
      kase({ id: 5, expiryDate: '2026-12-01', isOpen: false }),
      kase({ id: 6, expiryDate: '2026-12-01', archived: true }),
      kase({ id: 7, expiryDate: '2026-12-01', patientId: 999 }),       // not on caseload
      kase({ id: 8, expiryDate: '2026-12-01', practitionerId: 'P2' }), // someone else's case
      kase({ id: 9, expiryDate: null }),                               // no end anywhere
    ];
    const ids = (r) => r.map((x) => x.c.id).sort();
    expect(ids(R.radarCases(cases, { allowed: new Set(['101']), practitionerId: 'P1', now: NOW }))).toEqual([1, 3]);
    expect(ids(R.radarCases(cases, { allowed: null, practitionerId: null, now: NOW }))).toEqual([1, 3, 7, 8]);
    // The billing profile's plan end is the fallback.
    const fb = R.radarCases([kase({ id: 9, expiryDate: null })], { now: NOW, billingPlanEnds: { 101: new Date('2026-12-10T00:00:00Z') } });
    expect(fb).toHaveLength(1);
    expect(fb[0].endSource).toBe('billing_profile');
  });
});

describe('funding used', () => {
  test('only this case\'s appointment and activity lines; no drafts, archived or other clients', () => {
    const u = R.sploseUsage(kase(), [
      invoice(),
      invoice({ id: 901, status: 'Draft' }),
      invoice({ id: 902, isArchived: true }),
      invoice({ id: 903, patientId: 202 }),
    ]);
    expect(u).toEqual({ amount: 581.97, hours: 3, lines: 3, discounted: false });
    expect(R.sploseUsage(kase(), [invoice({ invoiceItems: [{ type: 'appointment', typeId: 11, unitPrice: 100, quantity: 1, discount: '10%' }] })]).discounted).toBe(true);
    expect(R.sploseUsage(kase({ items: [] }), [invoice()]).amount).toBe(0);
  });

  test('portal invoices count only when one plan covers the date', () => {
    const row = { c: kase(), start: R.dayMs('2026-02-01'), end: R.dayMs('2026-12-31') };
    const inv = [
      { client_id: '101', issue_date: '2026-11-25', total: '300.00' },
      { client_id: '101', issue_date: '2026-01-10', total: '50.00' },  // before the plan
      { client_id: '202', issue_date: '2026-11-25', total: '70.00' },  // someone else
    ];
    expect(R.portalUsage(row, [{ start: row.start, end: row.end }], inv)).toEqual({ amount: 300, count: 1 });
    const overlapping = [{ start: row.start, end: row.end }, { start: R.dayMs('2026-10-01'), end: R.dayMs('2027-09-30') }];
    expect(R.portalUsage(row, overlapping, inv)).toEqual({ amount: 0, count: 0 });
  });

  test('track types and pace', () => {
    const s = { amount: 6000, hours: 30, lines: 1 }; const p = { amount: 1000, count: 1 };
    expect(R.tracking(kase(), s, p)).toEqual({ track: 'Budget', unit: '$', allowed: 10000, used: 7000, pct: 70 });
    expect(R.tracking(kase({ trackType: 'Hours', hours: 40 }), s, p)).toEqual({ track: 'Hours', unit: 'hours', allowed: 40, used: 30, pct: 75 });
    expect(R.tracking(kase({ trackType: 'Appointments', appointmentCount: 4 }), s, p)).toEqual({ track: 'Appointments', unit: 'appointments', allowed: 4, used: 2, pct: 50 });
    expect(R.tracking(kase({ trackType: 'Budget', budget: null }), s, p).pct).toBeNull();
    const start = R.dayMs('2026-01-01'); const end = R.dayMs('2026-12-31'); const half = R.dayMs('2026-07-02');
    expect(R.pace(100, start, end, half).pace).toBe('over');
    expect(R.pace(80, start, end, half).pace).toBe('fast');
    expect(R.pace(20, start, end, half).pace).toBe('slow');
    expect(R.pace(55, start, end, half)).toEqual({ pace: 'on_track', timePct: 50 });
    expect(R.pace(null, start, end, half).pace).toBe('unknown');
  });

  test('buildRadar: soonest first; no invoices → funding not available', () => {
    const cases = [kase({ id: 1, patientId: 101, expiryDate: '2027-01-10' }), kase({ id: 2, patientId: 102, expiryDate: '2026-12-05', items: [] })];
    const rows = R.buildRadar({ cases, invoices: [invoice()], now: NOW, extras: { names: { 101: 'Test One', 102: 'Test Two' }, reports: { 101: { startedAt: '2026-11-20T00:00:00.000Z' } }, notes: { 101: 4 } } });
    expect(rows.map((r) => r.clientName)).toEqual(['Test Two', 'Test One']);
    expect(rows[1]).toEqual(expect.objectContaining({ clientRef: 'splose:patient:101', planEnd: '2027-01-10', planStart: '2026-02-01', daysLeft: 45, notesThisPlan: 4, report: { started: true, startedAt: '2026-11-20T00:00:00.000Z' } }));
    expect(rows[1].funding).toEqual(expect.objectContaining({ used: 581.97, allowed: 10000, pct: 6, pace: 'slow', available: true, linkedSessions: 2 }));
    const none = R.buildRadar({ cases, invoices: null, invoicesComplete: false, now: NOW });
    expect(none[0].funding).toEqual(expect.objectContaining({ available: false, used: null, pct: null }));
  });

  test('loadExtras: bound parameters; a report counts only for this review; notes only since the plan began', async () => {
    const pool = { query: jest.fn(async (sql) => {
      if (/FROM invoices/.test(sql)) return { rows: [{ client_id: '101', issue_date: '2026-11-25', total: '10' }] };
      if (/FROM template_documents/.test(sql)) return { rows: [{ client_id: '101', started_at: '2026-11-20T00:00:00Z' }, { client_id: '102', started_at: '2026-01-05T00:00:00Z' }] };
      return { rows: [
        { client_id: '101', created_at: '2026-03-01T00:00:00Z', start_time: null },
        { client_id: '101', created_at: '2026-01-01T00:00:00Z', start_time: null },   // before the plan
        { client_id: '102', created_at: '2026-11-01T00:00:00Z', start_time: '2026-10-30T00:00:00Z' },
      ] };
    }) };
    const rows = [{ patientId: '101', planStart: '2026-02-01', planEnd: '2026-12-31' }, { patientId: '102', planStart: '2026-06-01', planEnd: '2026-12-05' }];
    const x = await R.loadExtras(pool, { orgId: 'org-1', userId: 'u-1', rows });
    expect(x.reports).toEqual({ 101: { startedAt: '2026-11-20T00:00:00.000Z' } });
    expect(x.notes).toEqual({ 101: 1, 102: 1 });
    const invCall = pool.query.mock.calls.find((c) => /FROM invoices/.test(c[0]));
    expect(invCall[1]).toEqual(['org-1', ['101', '102'], ['READY', 'SENT', 'PART_PAID', 'PAID'], '2026-02-01']);
    const notesCall = pool.query.mock.calls.find((c) => /case_note_drafts/.test(c[0]));
    expect(notesCall[1]).toEqual(['u-1', ['101', '102']]);
    pool.query.mock.calls.forEach(([sql]) => expect(sql).not.toMatch(/101|org-1|u-1/));
  });
});

// ── the route ────────────────────────────────────────────────────────────────
function buildApp() {
  const app = express();
  app.use(bodyParser.json());
  app.use(session({ secret: 'test', resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use('/', require('../auth'));
  app.use('/', routes);
  return app;
}
const PASS = 'ValidPass1';
let HASH;
const user = (over) => ({
  id: 'aaaaaaaa-1111-4111-8111-111111111111', email: 'sam@opal.test', name: 'Sam Okafor', display_name: null,
  role: 'therapist', organisation_id: null, is_active: true, account_status: 'active', email_verified: true, password_hash: HASH, permissions: null,
  tp_splose_practitioner_id: 'P1', therapist_profile_id: 'bbbbbbbb-2222-4222-8222-222222222222', ...over,
});
async function login(app, u) {
  db.getUserByEmail.mockResolvedValue(u); db.getUser.mockResolvedValue(u);
  const agent = request.agent(app);
  expect((await agent.post('/api/auth/login').send({ email: u.email, password: PASS })).status).toBe(200);
  return agent;
}
const soon = () => { const d = new Date(Date.now() + 20 * 86400000); return d.toISOString().slice(0, 10); };

beforeAll(async () => { HASH = await bcrypt.hash(PASS, 4); });
beforeEach(() => {
  jest.clearAllMocks();
  require('../auth')._resetLoginRateLimit();
  routes._resetRateLimitForTests();
  sploseApi.fetchAllCases.mockResolvedValue([
    kase({ id: 1, patientId: 101, practitionerId: 'P1', expiryDate: soon() }),
    kase({ id: 2, patientId: 102, practitionerId: 'P2', expiryDate: soon() }),
  ]);
  sploseApi.getPatients.mockResolvedValue([{ id: 101, fullName: 'Test One' }, { id: 102, fullName: 'Test Two' }, { id: 103, fullName: 'Not On Radar' }]);
  sploseApi.getInvoices.mockResolvedValue([invoice()]);
  db.pool.query.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe('GET /api/assist/plan-reviews', () => {
  test('401 without a session; read-only and unlinked therapists refused', async () => {
    expect((await request(buildApp()).get('/api/assist/plan-reviews')).status).toBe(401);
    const ro = await login(buildApp(), user({ role: 'read_only' }));
    expect((await ro.get('/api/assist/plan-reviews')).status).toBe(403);
    const unlinked = await login(buildApp(), user({ tp_splose_practitioner_id: null }));
    expect((await unlinked.get('/api/assist/plan-reviews')).status).toBe(403);
  });

  test('a therapist sees only their own cases; never a model call; audited by counts', async () => {
    const spy = jest.fn(); provider._setProviderForTests(spy);
    const agent = await login(buildApp(), user());
    const r = await agent.get('/api/assist/plan-reviews');
    expect(r.status).toBe(200);
    expect(r.body.scope).toBe('caseload');
    expect(r.body.rows.map((x) => x.clientName)).toEqual(['Test One']);
    expect(r.body.rows[0].funding.used).toBe(581.97);
    expect(JSON.stringify(r.body)).not.toMatch(/Not On Radar|Test Two/);
    expect(spy).not.toHaveBeenCalled();
    const audit = db.logAuditEvent.mock.calls.find((c) => c[0].action === 'assist.plan_reviews_viewed')[0];
    expect(audit.metadata).toEqual({ plans: 1, scope: 'caseload', fundingAvailable: true });
    provider._setProviderForTests(null);
  });

  test('the owner sees the practice', async () => {
    const agent = await login(buildApp(), user({ role: 'owner', tp_splose_practitioner_id: null }));
    const r = await agent.get('/api/assist/plan-reviews');
    expect(r.body.scope).toBe('practice');
    expect(r.body.rows.map((x) => x.clientName).sort()).toEqual(['Test One', 'Test Two']);
  });

  test('Splose down is 502; invoices down still lists the plans', async () => {
    const agent = await login(buildApp(), user({ role: 'owner' }));
    sploseApi.getInvoices.mockRejectedValueOnce(new Error('rate limited'));
    const r = await agent.get('/api/assist/plan-reviews');
    expect(r.status).toBe(200);
    expect(r.body.fundingAvailable).toBe(false);
    expect(r.body.rows[0].funding.available).toBe(false);
    sploseApi.fetchAllCases.mockRejectedValueOnce(new Error('down'));
    const down = await agent.get('/api/assist/plan-reviews');
    expect(down.status).toBe(502);
    expect(down.body.message).toMatch(/Splose could not be reached/);
  });
});

// ── frontend ─────────────────────────────────────────────────────────────────
describe('radar wording', () => {
  test('labels', () => {
    expect(ui.whenLabel(0)).toBe('ends today');
    expect(ui.whenLabel(5)).toBe('in 5 days');
    expect(ui.whenLabel(35)).toBe('in 5 weeks');
    expect(ui.whenLabel(-3)).toBe('ended 3 days ago');
    expect(ui.buttonLabel(2)).toBe('Plan reviews · 2');
    expect(ui.fundingLine({ available: true, unit: '$', allowed: 12000, used: 8200.5, pct: 68, timePct: 75 })).toBe('$8,201 of $12,000 used (68%) · 75% of the plan\'s time gone');
    expect(ui.fundingLine({ available: true, unit: 'hours', allowed: 40, used: 30.25, pct: 76, timePct: null })).toBe('30.3 of 40 hours used (76%)');
    expect(ui.fundingLine({ available: false })).toMatch(/could not be read/);
    expect(ui.fundingLine({ available: true, track: 'Budget', allowed: null, used: 0 })).toMatch(/no allowance set/);
    expect(ui.reportPeriod({ planStart: '2026-02-01', planEnd: '2026-12-31' }, '2026-11-26')).toEqual({ from: '2026-02-01', to: '2026-11-26' });
    expect(ui.reportPeriod({ planStart: '2025-12-01', planEnd: '2026-11-15' }, '2026-11-26')).toEqual({ from: '2025-12-01', to: '2026-11-15' });
    expect(ui.reportPeriod({ planStart: null, planEnd: '2026-12-31' }, '2026-11-26')).toBeNull();
  });

  test('the panel lists plans and Start report hands over the plan\'s period', async () => {
    const w = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'http://localhost/assist' }).window;
    w.eval(fs.readFileSync(path.join(__dirname, '../../frontend/current/assist-plan-radar.js'), 'utf8'));
    const rows = R.buildRadar({ cases: [kase({ expiryDate: '2026-12-31' })], invoices: [invoice()], now: NOW, extras: { names: { 101: 'Test One' } } });
    const counts = []; let started = null;
    w.OpalAssistPlanRadar.open({
      api: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ rows, fundingAvailable: true, windowDays: 56 }) }),
      onCount: (n) => counts.push(n), startReport: (r, p) => { started = { r, p }; },
    });
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0));
    const text = w.document.querySelector('#oa-pr').textContent;
    expect(text).toMatch(/Test One/);
    expect(text).toMatch(/\$582 of \$10,000 used \(6%\)/);
    expect(text).toMatch(/Underused/);
    expect(text).toMatch(/Progress report not started/);
    expect(counts).toEqual([1]);
    w.document.querySelector('[data-pr="report"]').click();
    expect(started.r.clientRef).toBe('splose:patient:101');
    expect(started.p.from).toBe('2026-02-01');
    expect(w.document.querySelector('#oa-pr')).toBeNull();
  });

  test('page wiring', () => {
    const html = fs.readFileSync(path.join(__dirname, '../../frontend/current/assist.html'), 'utf8');
    const js = fs.readFileSync(path.join(__dirname, '../../frontend/current/assist.js'), 'utf8');
    const src = fs.readFileSync(path.join(__dirname, '../../frontend/current/assist-plan-radar.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(html).toMatch(/<script src="\/assist-plan-radar\.js\?v=\d+"><\/script>[\s\S]*<script src="\/assist\.js\?v=\d+">/);
    expect(html).toMatch(/id="oa-plans"[^>]*hidden/);
    expect(js).toMatch(/S\.surface === 'web' && global\.OpalAssistPlanRadar/);
    expect(src).not.toMatch(/localStorage|sessionStorage|console\./);
    expect([...new Set(src.match(/'\/api\/[^']*'/g))]).toEqual(["'/api/assist/plan-reviews'"]);
  });
});
