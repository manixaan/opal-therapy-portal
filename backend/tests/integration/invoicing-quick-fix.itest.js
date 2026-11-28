'use strict';

/**
 * Invoicing — editing, quick fixes, every billable calendar item, background
 * runs (migration 096). Real Postgres; maps and Splose are faked.
 *
 *  - each session reads session → case noting → travel on the draft
 *  - a session with no case noting is a warning with a quick fix (add minutes /
 *    leave off — both remembered)
 *  - a missing payer is fixed from a pop-up, saved on the client, applied to the
 *    open drafts at once (no full run)
 *  - report-writing blocks are asked about once and billed when told to
 *  - travel blocks with no client and telehealth bookings are not lost
 *  - drafts can be deleted (finalised invoices cannot), runs go to the background,
 *    the nightly tick drafts the week once a day
 */

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { db, truncateAll, seedUser, seedOrganisation, closePool } = require('./helpers');
const { setMapsProvider } = require('../../billing/maps-adapter');
const DR = require('../../billing/day-route');
const RJ = require('../../billing/run-jobs');
require('../../billing/splose-billing-source').setSploseSource({ isConfigured: () => false });

const PASSWORD = 'QfPass1!';

const zonePoint = k => ({ lng: 100.5 + 2 * k, lat: -19.5 });
async function seedMmmDataset() {
  await db.pool.query(`DELETE FROM mmm_datasets WHERE version = 'TEST-SYNTH-QF'`);
  await db.pool.query(`UPDATE mmm_datasets SET is_active = FALSE WHERE is_active`);
  const { rows: [ds] } = await db.pool.query(
    `INSERT INTO mmm_datasets (version, source, is_active) VALUES ('TEST-SYNTH-QF', 'synthetic test squares', TRUE) RETURNING id`);
  for (let k = 1; k <= 7; k++) {
    const x0 = 100 + 2 * k, x1 = x0 + 1;
    const coords = Float64Array.from([x0, -20, x0, -19, x1, -19, x1, -20, x0, -20]);
    await db.pool.query(
      `INSERT INTO mmm_dataset_rings (dataset_id, mmm, part_index, min_lng, min_lat, max_lng, max_lat, coords)
       VALUES ($1,$2,0,$3,-20,$4,-19,$5)`, [ds.id, k, x0, x1, Buffer.from(coords.buffer)]);
  }
}
setMapsProvider({
  async geocode(address) { const m = /Zone MM(\d)/.exec(address); return m ? { ...zonePoint(Number(m[1])), precise: true, provider: 'test' } : null; },
  async route() { return { minutes: 10, km: 8, provider: 'test_routes' }; },
});

function buildApp() {
  const app = express();
  app.use(bodyParser.json());
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../invoicing-routes'));
  return app;
}
async function login(app, role, orgId) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser({ password_hash: hash, role, organisation_id: orgId, name: `${role} user` });
  const agent = request.agent(app);
  expect((await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD })).status).toBe(200);
  return { agent, user };
}

function perthYmd(d) { return new Date(d.getTime() + 8 * 3600000).toISOString().slice(0, 10); }
const anchor = new Date(Date.now() - 21 * 86400000);
const dow = new Date(perthYmd(anchor) + 'T00:00:00Z').getUTCDay();
const MON = new Date(Date.parse(perthYmd(anchor) + 'T00:00:00Z') - ((dow + 6) % 7) * 86400000).toISOString().slice(0, 10);
const day = n => new Date(Date.parse(MON + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const utc = (date, hm) => new Date(`${date}T${hm}:00+08:00`).toISOString();

async function practitioner(orgId, dates) {
  const u = await seedUser({ role: 'therapist', organisation_id: orgId, name: 'Pat Practitioner' });
  const schedule = {};
  for (const d of dates) { const wk = DR.weekKeyForDate(d); schedule[wk] = schedule[wk] || {}; schedule[wk][DR.dayKeyForDate(d)] = 'home-1'; }
  await db.pool.query(`UPDATE users SET default_work_location = $2, work_location_schedule = $3 WHERE id = $1`,
    [u.id, JSON.stringify({ homes: [{ id: 'home-1', label: 'Home', kind: 'local', addr: 'Base, Perth WA 6000' }] }), JSON.stringify(schedule)]);
  return u;
}
async function session_(user, { clientId, clientName, date, start = '09:00', minutes = 60, location, booking = null }) {
  const s = utc(date, start), e = new Date(Date.parse(s) + minutes * 60000).toISOString();
  const { rows: [r] } = await db.pool.query(
    `INSERT INTO events (user_id, title, start_time, end_time, location, event_type, status, client_id, client_name, organisation_id, custom_metadata)
     VALUES ($1,$2,$3,$4,$5,'therapy','confirmed',$6,$7,$8,$9) RETURNING id`,
    [user.id, clientName, s, e, location ?? `${clientName} home, Perth WA 6000`, clientId, clientName, user.organisation_id,
      JSON.stringify(booking ? { booking } : {})]);
  return r.id;
}
async function block(user, { date, start = '14:00', minutes = 30, booking, eventType = 'report', timerSeconds = null }) {
  const s = utc(date, start), e = new Date(Date.parse(s) + minutes * 60000).toISOString();
  const { rows: [r] } = await db.pool.query(
    `INSERT INTO events (user_id, title, start_time, end_time, location, event_type, status, organisation_id, custom_metadata)
     VALUES ($1,$2,$3,$4,'',$5,'confirmed',$6,$7) RETURNING id`,
    [user.id, booking.kind || 'Travel', s, e, eventType, user.organisation_id, JSON.stringify({ booking })]);
  if (timerSeconds != null) {
    await db.pool.query(
      `INSERT INTO event_billing_timers (event_id, organisation_id, user_id, status, accumulated_seconds, limit_seconds) VALUES ($1,$2,$3,'STOPPED',$4,$5)`,
      [r.id, user.organisation_id, user.id, timerSeconds, minutes * 60]);
  }
  return r.id;
}
const caseNote = (clientId, clientName) => ({ kind: 'case-noting', group: 'nf2f', clientId, clientName, clients: [{ clientId, clientName }] });
const planManaged = (name, zone) => ({ participantName: name, ndisNumber: '431793102', managementType: 'PLAN_MANAGED', payerType: 'PLAN_MANAGER',
  payerName: 'MARS Plan Manager', payerEmail: 'mars@pm.test', serviceAddress: `${name} home, Zone MM${zone}` });

async function profile(agent, clientId, body) { const r = await agent.put(`/api/invoicing/clients/${clientId}`).send(body); expect(r.status).toBe(200); return r.body; }
async function run(agent, from, to) { const r = await agent.post('/api/invoicing/runs').send({ from, to }); if (r.status !== 201) console.warn('RUN', r.status, JSON.stringify(r.body)); expect(r.status).toBe(201); return r.body.summary; }
async function invoices(agent) { const r = await agent.get('/api/invoicing/invoices'); expect(r.status).toBe(200); return r.body.invoices; }
async function detail(agent, id) { const r = await agent.get(`/api/invoicing/invoices/${id}`); expect(r.status).toBe(200); return r.body; }
async function openIssues(agent, type) { const r = await agent.get('/api/invoicing/issues'); return r.body.issues.filter(i => i.issue_type === type && i.status === 'OPEN'); }
async function waitJob(agent, jobId) {
  for (let i = 0; i < 100; i++) {
    const r = await agent.get(`/api/invoicing/runs/jobs/${jobId}`);
    expect(r.status).toBe(200);
    if (r.body.state !== 'RUNNING') return r.body;
    await new Promise(res => setTimeout(res, 100));
  }
  throw new Error('job did not finish');
}
const active = lines => lines.filter(l => l.line_status === 'ACTIVE');

beforeAll(async () => { await seedMmmDataset(); });
beforeEach(async () => { await truncateAll(); require('../../auth')._resetLoginRateLimit(); });
afterAll(async () => {
  for (let i = 0; i < 50 && [...RJ._jobs.values()].some(j => j.state === 'RUNNING'); i++) await new Promise(r => setTimeout(r, 100));
  await db.pool.query(`DELETE FROM mmm_datasets WHERE version = 'TEST-SYNTH-QF'`);
  await closePool();
});

describe('each session carries its case noting', () => {
  test('lines read session → case noting → travel, per session', async () => {
    const app = buildApp(); const org = await seedOrganisation();
    const { agent } = await login(app, 'owner', org.id);
    const pr = await practitioner(org.id, [day(0), day(1)]);
    await profile(agent, 'k1', planManaged('Kim One', 1));
    await session_(pr, { clientId: 'k1', clientName: 'Kim One', date: day(0), start: '09:00' });
    await session_(pr, { clientId: 'k1', clientName: 'Kim One', date: day(1), start: '09:00' });
    // Case noting written later each day (block at 16:00), timed 15 min.
    await block(pr, { date: day(0), start: '16:00', minutes: 30, booking: caseNote('k1', 'Kim One'), timerSeconds: 900 });
    await block(pr, { date: day(1), start: '16:00', minutes: 30, booking: caseNote('k1', 'Kim One'), timerSeconds: 900 });
    await run(agent, day(0), day(4));
    const [inv] = await invoices(agent);
    const lines = active((await detail(agent, inv.id)).lines);
    const order = lines.map(l => `${l.service_date}:${l.component}`);
    const firstNf = order.indexOf(`${day(0)}:NF2F`);
    expect(order[0]).toBe(`${day(0)}:SESSION`);
    expect(firstNf).toBe(1); // straight after its session, not at the end of the week
    expect(order.indexOf(`${day(1)}:SESSION`)).toBeGreaterThan(firstNf);
    expect(await openIssues(agent, 'CASE_NOTE_MISSING')).toHaveLength(0);
  });

  test('no case noting → a warning; Quick fix adds minutes after the session; "leave it off" is remembered', async () => {
    const app = buildApp(); const org = await seedOrganisation();
    const { agent } = await login(app, 'owner', org.id);
    const pr = await practitioner(org.id, [day(0), day(1)]);
    await profile(agent, 'm1', planManaged('Mo One', 1));
    const s1 = await session_(pr, { clientId: 'm1', clientName: 'Mo One', date: day(0) });
    const s2 = await session_(pr, { clientId: 'm1', clientName: 'Mo One', date: day(1) });
    await run(agent, day(0), day(4));
    const warn = await openIssues(agent, 'CASE_NOTE_MISSING');
    expect(warn.map(w => w.calendar_event_id).sort()).toEqual([s1, s2].sort());
    const [inv] = await invoices(agent);
    expect(inv.status).toBe('DRAFT'); // a warning never holds the invoice

    const w1 = warn.find(w => w.calendar_event_id === s1);
    expect((await agent.post(`/api/invoicing/issues/${w1.id}/quick-fix`).send({ minutes: 0 })).status).toBe(400);
    const add = await agent.post(`/api/invoicing/issues/${w1.id}/quick-fix`).send({ minutes: 20 });
    expect(add.status).toBe(200);
    const lines = active((await detail(agent, inv.id)).lines);
    const iSess = lines.findIndex(l => l.calendar_event_id === s1);
    const cn = lines[iSess + 1];
    expect(cn.calculation).toMatchObject({ method: 'case_note', caseNoteFor: s1, minutes: 20 });
    expect(Number(cn.quantity)).toBeCloseTo(0.3333, 4);
    expect(cn.unit_price).toBe(lines[iSess].unit_price);
    expect((await agent.post(`/api/invoicing/issues/${w1.id}/quick-fix`).send({ minutes: 20 })).status).toBe(409); // never twice

    const w2 = warn.find(w => w.calendar_event_id === s2);
    expect((await agent.post(`/api/invoicing/issues/${w2.id}/quick-fix`).send({ leaveOff: true })).status).toBe(200);
    // A fresh run raises neither again.
    await run(agent, day(0), day(4));
    expect(await openIssues(agent, 'CASE_NOTE_MISSING')).toHaveLength(0);
  });
});

describe('quick fix: recipient', () => {
  test('a missing payer is fixed from the pop-up, remembered on the client, and the draft leaves Needs attention at once', async () => {
    const app = buildApp(); const org = await seedOrganisation();
    const { agent } = await login(app, 'owner', org.id);
    const pr = await practitioner(org.id, [day(0)]);
    await profile(agent, 'p1', { participantName: 'Pia One', ndisNumber: '431793102', managementType: 'PLAN_MANAGED', serviceAddress: 'Pia home, Zone MM1' });
    await session_(pr, { clientId: 'p1', clientName: 'Pia One', date: day(0) });
    await block(pr, { date: day(0), booking: caseNote('p1', 'Pia One'), timerSeconds: 600 });
    await run(agent, day(0), day(4));
    let [inv] = await invoices(agent);
    expect(inv.status).toBe('NEEDS_ATTENTION');
    const [issue] = await openIssues(agent, 'CLIENT_MISSING_PAYER');
    await profile(agent, 'p1', { payerType: 'PLAN_MANAGER', payerName: 'Leap In', payerEmail: 'accounts@leapin.test' });
    const qf = await agent.post(`/api/invoicing/issues/${issue.id}/quick-fix`).send({});
    expect(qf.status).toBe(200);
    expect(qf.body).toMatchObject({ draftsUpdated: 1, stillMissing: [] });
    const d = await detail(agent, inv.id);
    expect(d.invoice).toMatchObject({ status: 'DRAFT', payer_name: 'Leap In', payer_email: 'accounts@leapin.test' });
    expect(await openIssues(agent, 'CLIENT_MISSING_PAYER')).toHaveLength(0);
    // Remembered: the payer is in the directory for other clients.
    const { rows } = await db.pool.query(`SELECT email FROM billing_payers WHERE organisation_id = $1 AND name = 'Leap In'`, [org.id]);
    expect(rows[0].email).toBe('accounts@leapin.test');
  });
});

describe('every billable calendar item is accounted for', () => {
  test('a report-writing block is asked about once; "Bill it" bills its minutes in the background; "Billed in Splose" is remembered', async () => {
    const app = buildApp(); const org = await seedOrganisation();
    const { agent } = await login(app, 'owner', org.id);
    const pr = await practitioner(org.id, [day(0)]);
    await profile(agent, 'r1', planManaged('Rae One', 1));
    await profile(agent, 'r2', planManaged('Rob Two', 1));
    const fca = await block(pr, { date: day(0), start: '10:00', minutes: 90, booking: { kind: 'fca', group: 'report', clientId: 'r1', clientName: 'Rae One' } });
    const pr2 = await block(pr, { date: day(0), start: '13:00', minutes: 60, booking: { kind: 'progress-report', group: 'report', clientId: 'r2', clientName: 'Rob Two' } });
    await run(agent, day(0), day(4));
    const asks = await openIssues(agent, 'REPORT_NOT_BILLED');
    expect(asks.map(a => a.calendar_event_id).sort()).toEqual([fca, pr2].sort());
    const a1 = asks.find(a => a.calendar_event_id === fca);
    expect(a1.fix_target).toMatchObject({ kind: 'report', label: 'FCA report', minutes: 90 });
    const bill = await agent.post(`/api/invoicing/issues/${a1.id}/quick-fix`).send({ decision: 'BILL' });
    expect(bill.status).toBe(202);
    expect((await waitJob(agent, bill.body.job.jobId)).state).toBe('DONE');
    const rae = (await invoices(agent)).find(i => i.client_id === 'r1');
    const lines = active((await detail(agent, rae.id)).lines);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ component: 'NF2F', calendar_event_id: fca });
    expect(Number(lines[0].quantity)).toBeCloseTo(1.5, 4);
    const a2 = asks.find(a => a.calendar_event_id === pr2);
    expect((await agent.post(`/api/invoicing/issues/${a2.id}/quick-fix`).send({ decision: 'SPLOSE' })).status).toBe(200);
    await run(agent, day(0), day(4));
    expect(await openIssues(agent, 'REPORT_NOT_BILLED')).toHaveLength(0);
    expect((await invoices(agent)).find(i => i.client_id === 'r2')).toBeUndefined();
  });

  test('a travel block with no client is asked about; a telehealth booking with no address is telehealth, not "no location"', async () => {
    const app = buildApp(); const org = await seedOrganisation();
    const { agent } = await login(app, 'owner', org.id);
    const pr = await practitioner(org.id, [day(0)]);
    await profile(agent, 't1', planManaged('Tia One', 1));
    await session_(pr, { clientId: 't1', clientName: 'Tia One', date: day(0), location: '',
      booking: { kind: 'telehealth', group: 'direct', clientId: 't1', clientName: 'Tia One' } });
    const tb = await block(pr, { date: day(0), start: '15:00', minutes: 40, eventType: 'travel', booking: { kind: 'travel-block', group: 'travel' } });
    await run(agent, day(0), day(4));
    expect(await openIssues(agent, 'EVENT_NO_LOCATION')).toHaveLength(0);
    const [inv] = await invoices(agent);
    expect(active((await detail(agent, inv.id)).lines).filter(l => l.component === 'SESSION')).toHaveLength(1);
    const [ask] = await openIssues(agent, 'TRAVEL_BLOCK_NO_CLIENT');
    expect(ask.calendar_event_id).toBe(tb);
    expect((await agent.post(`/api/invoicing/issues/${ask.id}/quick-fix`).send({ decision: 'NOT_BILLABLE' })).status).toBe(200);
    await run(agent, day(0), day(4));
    expect(await openIssues(agent, 'TRAVEL_BLOCK_NO_CLIENT')).toHaveLength(0);
  });
});

describe('answers are remembered', () => {
  test('a session zone answered once is kept for the address: the next session there is zoned without asking', async () => {
    const app = buildApp(); const org = await seedOrganisation();
    const { agent } = await login(app, 'owner', org.id);
    const pr = await practitioner(org.id, [day(0), day(7)]);
    await profile(agent, 'z1', planManaged('Zed One', 1));
    const where = '1 Unknown Track, Nowhereville WA';
    await session_(pr, { clientId: 'z1', clientName: 'Zed One', date: day(0), location: where });
    await run(agent, day(0), day(0));
    const [ask] = await openIssues(agent, 'SESSION_MMM_UNRESOLVED');
    expect(ask.fix_target).toMatchObject({ address: where });
    expect((await agent.post(`/api/invoicing/issues/${ask.id}/quick-fix`).send({ zone: 9 })).status).toBe(400);
    const fx = await agent.post(`/api/invoicing/issues/${ask.id}/quick-fix`).send({ zone: 2 });
    expect(fx.status).toBe(202);
    expect((await waitJob(agent, fx.body.job.jobId)).state).toBe('DONE');
    expect(await openIssues(agent, 'SESSION_MMM_UNRESOLVED')).toHaveLength(0);
    // A week later, same address (typed differently): no question, zone 2.
    const later = await session_(pr, { clientId: 'z1', clientName: 'Zed One', date: day(7), location: '1 unknown track,  NOWHEREVILLE wa' });
    await run(agent, day(7), day(7));
    expect(await openIssues(agent, 'SESSION_MMM_UNRESOLVED')).toHaveLength(0);
    const { rows: [line] } = await db.pool.query(`SELECT mmm_zone FROM invoice_lines WHERE calendar_event_id = $1 AND component = 'SESSION'`, [later]);
    expect(Number(line.mmm_zone)).toBe(2);
  });

  test('every invoice carries the bank and contact details unless Billing settings says otherwise', async () => {
    const app = buildApp(); const org = await seedOrganisation();
    const { agent } = await login(app, 'owner', org.id);
    const pr = await practitioner(org.id, [day(0)]);
    await profile(agent, 'f1', planManaged('Fay One', 1));
    await session_(pr, { clientId: 'f1', clientName: 'Fay One', date: day(0) });
    await run(agent, day(0), day(0));
    const [inv] = await invoices(agent);
    const d = await detail(agent, inv.id);
    expect(d.business.abn).toBe('49 699 791 958'); // the practice ABN, with nothing typed in Billing settings
    expect(d.business.paymentDetails).toMatch(/BSB: 067-873/);
    expect(d.business.paymentDetails).toMatch(/24820381/);
    expect(d.business.paymentDetails).toMatch(/ann\.matthew@opaltherapy\.com\.au/);
    await agent.put('/api/invoicing/settings').send({ paymentDetails: 'Pay by EFT only' });
    expect((await detail(agent, inv.id)).business.paymentDetails).toBe('Pay by EFT only');
  });
});

describe('review fixes', () => {
  test('a dismissed item stays dismissed on the next run; Opal\'s own travel legs are never asked about', async () => {
    const app = buildApp(); const org = await seedOrganisation();
    const { agent } = await login(app, 'owner', org.id);
    const pr = await practitioner(org.id, [day(0)]);
    await profile(agent, 'x1', planManaged('Xi One', 1));
    await session_(pr, { clientId: 'x1', clientName: 'Xi One', date: day(0) });
    // An auto travel leg (Outlook "Travel" category, no Smart Booking kind) and a booked one.
    await block(pr, { date: day(0), start: '11:00', minutes: 20, eventType: 'travel', booking: {} });
    await block(pr, { date: day(0), start: '15:00', minutes: 20, eventType: 'travel', booking: { kind: 'travel-block', group: 'travel' } });
    await run(agent, day(0), day(4));
    expect(await openIssues(agent, 'TRAVEL_BLOCK_NO_CLIENT')).toHaveLength(1);
    const [cn] = await openIssues(agent, 'CASE_NOTE_MISSING');
    expect((await agent.post(`/api/invoicing/issues/${cn.id}/dismiss`).send({ reason: 'not needed' })).status).toBe(200);
    await run(agent, day(0), day(4));
    expect(await openIssues(agent, 'CASE_NOTE_MISSING')).toHaveLength(0);
  });

  test('a recipient typed on the invoice (and saved on the client) takes it out of Needs attention', async () => {
    const app = buildApp(); const org = await seedOrganisation();
    const { agent } = await login(app, 'owner', org.id);
    const pr = await practitioner(org.id, [day(0)]);
    await profile(agent, 'y1', { participantName: 'Yu One', ndisNumber: '431793102', managementType: 'PLAN_MANAGED', serviceAddress: 'Yu home, Zone MM1' });
    await session_(pr, { clientId: 'y1', clientName: 'Yu One', date: day(0) });
    await run(agent, day(0), day(4));
    const [inv] = await invoices(agent);
    expect(inv.status).toBe('NEEDS_ATTENTION');
    await profile(agent, 'y1', { payerType: 'PLAN_MANAGER', payerName: 'Plan Partners' });
    const r = await agent.patch(`/api/invoicing/invoices/${inv.id}`).send({ payerName: 'Plan Partners', payerType: 'PLAN_MANAGER', reason: 'Edited on the invoice', remember: true });
    expect(r.status).toBe(200);
    expect((await detail(agent, inv.id)).invoice).toMatchObject({ status: 'DRAFT', payer_name: 'Plan Partners' });
  });

  test('a case-noting block booked after a quick-fix line replaces it — never both', async () => {
    const app = buildApp(); const org = await seedOrganisation();
    const { agent } = await login(app, 'owner', org.id);
    const pr = await practitioner(org.id, [day(0), day(1)]);
    await profile(agent, 'w1', planManaged('Wen One', 1));
    const s1 = await session_(pr, { clientId: 'w1', clientName: 'Wen One', date: day(0) });
    await run(agent, day(0), day(4));
    const [w] = await openIssues(agent, 'CASE_NOTE_MISSING');
    expect((await agent.post(`/api/invoicing/issues/${w.id}/quick-fix`).send({ minutes: 15 })).status).toBe(200);
    await block(pr, { date: day(1), booking: caseNote('w1', 'Wen One'), timerSeconds: 900 });
    await run(agent, day(0), day(4));
    const [inv] = await invoices(agent);
    const lines = active((await detail(agent, inv.id)).lines);
    expect(lines.filter(l => l.calculation && l.calculation.caseNoteFor === s1)).toHaveLength(0);
    expect(lines.filter(l => l.component === 'NF2F')).toHaveLength(1);
  });
});

describe('draft buttons and background runs', () => {
  test('a draft can be deleted (audited); a finalised invoice cannot; a therapist cannot', async () => {
    const app = buildApp(); const org = await seedOrganisation();
    const { agent } = await login(app, 'owner', org.id);
    const ther = await login(app, 'therapist', org.id);
    const pr = await practitioner(org.id, [day(0), day(1)]);
    await profile(agent, 'd1', planManaged('Dee One', 1));
    await profile(agent, 'd2', planManaged('Dan Two', 1));
    await session_(pr, { clientId: 'd1', clientName: 'Dee One', date: day(0) });
    await session_(pr, { clientId: 'd2', clientName: 'Dan Two', date: day(1) });
    await run(agent, day(0), day(4));
    const list = await invoices(agent);
    const a = list.find(i => i.client_id === 'd1'), b = list.find(i => i.client_id === 'd2');
    expect((await ther.agent.delete(`/api/invoicing/invoices/${a.id}`)).status).toBe(403);
    expect((await agent.delete(`/api/invoicing/invoices/${a.id}`)).status).toBe(200);
    expect((await agent.get(`/api/invoicing/invoices/${a.id}`)).status).toBe(404);
    const { rows } = await db.pool.query(`SELECT action FROM billing_audit_events WHERE invoice_id = $1`, [a.id]);
    expect(rows.map(r => r.action)).toContain('invoice.draft_deleted');
    await agent.put('/api/invoicing/settings').send({ abn: '49699791958' });
    expect((await agent.post(`/api/invoicing/invoices/${b.id}/finalise`)).status).toBe(200);
    expect((await agent.delete(`/api/invoicing/invoices/${b.id}`)).status).toBe(409);
  });

  test('Create drafts in the background returns at once and reports its stage, then the summary', async () => {
    const app = buildApp(); const org = await seedOrganisation();
    const { agent } = await login(app, 'owner', org.id);
    const pr = await practitioner(org.id, [day(0)]);
    await profile(agent, 'b1', planManaged('Bea One', 1));
    await session_(pr, { clientId: 'b1', clientName: 'Bea One', date: day(0) });
    const r = await agent.post('/api/invoicing/runs').send({ from: day(0), to: day(4), background: true });
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ state: 'RUNNING' });
    const done = await waitJob(agent, r.body.jobId);
    expect(done.state).toBe('DONE');
    expect(done.result.summary.sessionsIncluded).toBe(1);
    // Another organisation cannot read the job.
    const other = await seedOrganisation('Other');
    const o = await login(app, 'owner', other.id);
    expect((await o.agent.get(`/api/invoicing/runs/jobs/${r.body.jobId}`)).status).toBe(404);
  });

  test('the nightly tick drafts the week so far once a day, after the hour, and only when switched on', async () => {
    const org = await seedOrganisation();
    const app = buildApp();
    const { agent } = await login(app, 'owner', org.id);
    await agent.get('/api/invoicing/settings'); // creates the settings row
    const calls = [];
    const fake = async (o) => { calls.push(o); return { runId: null, summary: { invoicesCreated: 0, invoicesUpdated: 0, itemsNeedAttention: 0 } }; };
    // Wednesday 22:00 Perth = 14:00 UTC.
    const wedNight = new Date(`${day(2)}T14:00:00Z`);
    await RJ.autoDraftsTick({ pool: db.pool, now: new Date(`${day(2)}T05:00:00Z`), run: fake }); // 1 pm: too early
    expect(calls).toHaveLength(0);
    await RJ.autoDraftsTick({ pool: db.pool, now: wedNight, run: fake });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ orgId: org.id, from: day(0), to: day(2), userId: null });
    await RJ.autoDraftsTick({ pool: db.pool, now: new Date(wedNight.getTime() + 3600000), run: fake });
    expect(calls).toHaveLength(1); // once a day
    const s = (await agent.get('/api/invoicing/settings')).body;
    const st = s.settings || s;
    expect(st.autoDraftsLastPeriod).toMatchObject({ from: day(0), to: day(2) });
    expect((await agent.put('/api/invoicing/settings').send({ autoDraftsEnabled: false })).status).toBe(200);
    await RJ.autoDraftsTick({ pool: db.pool, now: new Date(`${day(3)}T14:00:00Z`), run: fake });
    expect(calls).toHaveLength(1);
  });
});
