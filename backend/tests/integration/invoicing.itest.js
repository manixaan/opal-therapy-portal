'use strict';

/**
 * Invoicing — end to end over real Postgres (migration 071).
 *
 * Calendar events → eligibility → billing profile / MMM (synthetic official-
 * shaped dataset) → rate card → session + travel lines → grouped drafts →
 * finalise / PDF / pay / void & reissue, plus trips. Google is replaced by a
 * deterministic maps provider; nothing leaves the process.
 *
 * Acceptance scenarios A–L from the specification are labelled in the tests.
 */

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { db, truncateAll, seedUser, seedOrganisation, closePool } = require('./helpers');
const { setMapsProvider } = require('../../billing/maps-adapter');
const DR = require('../../billing/day-route');

const PASSWORD = 'InvPass1!';

// ── Synthetic MMM dataset: zone k is the square lng [100+2k, 101+2k], lat [-20, -19]. ──
const zonePoint = k => ({ lng: 100.5 + 2 * k, lat: -19.5 });
async function seedMmmDataset() {
  await db.pool.query(`DELETE FROM mmm_datasets WHERE version = 'TEST-SYNTH'`);
  await db.pool.query(`UPDATE mmm_datasets SET is_active = FALSE WHERE is_active`);
  const { rows: [ds] } = await db.pool.query(
    `INSERT INTO mmm_datasets (version, source, is_active) VALUES ('TEST-SYNTH', 'synthetic test squares', TRUE) RETURNING id`);
  for (let k = 1; k <= 7; k++) {
    const x0 = 100 + 2 * k, x1 = x0 + 1;
    const coords = Float64Array.from([x0, -20, x0, -19, x1, -19, x1, -20, x0, -20]);
    await db.pool.query(
      `INSERT INTO mmm_dataset_rings (dataset_id, mmm, part_index, min_lng, min_lat, max_lng, max_lat, coords)
       VALUES ($1,$2,0,$3,-20,$4,-19,$5)`, [ds.id, k, x0, x1, Buffer.from(coords.buffer)]);
  }
}

// ── Deterministic maps provider ──
const ROUTES = new Map();
function route(o, d, minutes, km) { ROUTES.set(`${o}>${d}`, { minutes, km }); }
const geocodeCalls = [];
const routeCalls = [];
setMapsProvider({
  async geocode(address) {
    geocodeCalls.push(address);
    const m = /Zone MM(\d)/.exec(address);
    if (!m) return null;
    return { ...zonePoint(Number(m[1])), precise: true, provider: 'test' };
  },
  async route(origin, destination) {
    routeCalls.push(`${origin}>${destination}`);
    if (/NOWHERE/.test(origin + destination)) return null;
    const hit = ROUTES.get(`${origin}>${destination}`);
    return hit ? { ...hit, provider: 'test_routes' } : { minutes: 10, km: 8, provider: 'test_routes' };
  },
});

function buildApp() {
  const app = express();
  app.use(bodyParser.json({ limit: '12mb' }));
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../invoicing-routes'));
  return app;
}

async function login(app, role, orgId, extra = {}) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser({ password_hash: hash, role, organisation_id: orgId, name: extra.name || `${role} user` });
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user };
}

// Dates: a Monday–Friday week that finished well before "now".
function perthYmd(d) { return new Date(d.getTime() + 8 * 3600000).toISOString().slice(0, 10); }
const now = new Date();
const anchor = new Date(now.getTime() - 21 * 86400000);
const dow = new Date(perthYmd(anchor) + 'T00:00:00Z').getUTCDay();
const MON = new Date(Date.parse(perthYmd(anchor) + 'T00:00:00Z') - ((dow + 6) % 7) * 86400000).toISOString().slice(0, 10);
const day = n => new Date(Date.parse(MON + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const utc = (date, hm) => new Date(`${date}T${hm}:00+08:00`).toISOString();

async function practitioner(orgId, name, baseAddr, dates, { remote = false } = {}) {
  const u = await seedUser({ role: 'therapist', organisation_id: orgId, name });
  const schedule = {};
  for (const d of dates) {
    const wk = DR.weekKeyForDate(d);
    schedule[wk] = schedule[wk] || {};
    schedule[wk][DR.dayKeyForDate(d)] = 'home-1';
  }
  await db.pool.query(`UPDATE users SET default_work_location = $2, work_location_schedule = $3 WHERE id = $1`,
    [u.id, JSON.stringify({ homes: [{ id: 'home-1', label: 'Home', kind: remote ? 'remote' : 'local', addr: baseAddr }] }), JSON.stringify(schedule)]);
  return u;
}

async function event(user, { clientId, clientName, date, start = '09:00', minutes = 60, location, extra = {} }) {
  const startIso = utc(date, start);
  const endIso = new Date(Date.parse(startIso) + minutes * 60000).toISOString();
  const { rows: [e] } = await db.pool.query(
    `INSERT INTO events (user_id, title, start_time, end_time, location, event_type, status, client_id, client_name, organisation_id, is_teams_meeting)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [user.id, `${clientName || 'Session'}`, startIso, endIso, location ?? `${clientName} home`, extra.eventType || 'therapy',
      extra.status || 'confirmed', clientId, clientName, user.organisation_id, !!extra.teams]);
  return e.id;
}

async function profile(agent, clientId, body) {
  const res = await agent.put(`/api/invoicing/clients/${clientId}`).send(body);
  expect(res.status).toBe(200);
  return res.body;
}
const planManaged = (name, zone, pm = 'MARS Plan Manager') => ({
  participantName: name, ndisNumber: '431793102', managementType: 'PLAN_MANAGED', payerType: 'PLAN_MANAGER',
  payerName: pm, payerEmail: `${pm.split(' ')[0].toLowerCase()}@pm.test`, serviceAddress: `${name} home, Zone MM${zone}`,
});

async function invoices(agent, q = '') {
  const res = await agent.get(`/api/invoicing/invoices${q}`);
  expect(res.status).toBe(200);
  return res.body.invoices;
}
async function detail(agent, id) {
  const res = await agent.get(`/api/invoicing/invoices/${id}`);
  expect(res.status).toBe(200);
  return res.body;
}
async function run(agent, from, to, practitionerId) {
  const res = await agent.post('/api/invoicing/runs').send({ from, to, practitionerId });
  expect(res.status).toBe(201);
  return res.body.summary;
}
const active = lines => lines.filter(l => l.line_status === 'ACTIVE');
const byComp = (lines, c) => active(lines).filter(l => l.component === c);

beforeAll(async () => { await seedMmmDataset(); });
beforeEach(async () => {
  await truncateAll();
  require('../../auth')._resetLoginRateLimit();
  ROUTES.clear(); geocodeCalls.length = 0; routeCalls.length = 0;
});
afterAll(async () => {
  await db.pool.query(`DELETE FROM mmm_datasets WHERE version = 'TEST-SYNTH'`);
  await closePool();
});

describe('guards and tenancy', () => {
  test('a practitioner (therapist) is refused even for their own events; unauthenticated is 401', async () => {
    const app = buildApp();
    const org = await seedOrganisation();
    const { agent } = await login(app, 'therapist', org.id);
    expect((await agent.get('/api/invoicing/invoices')).status).toBe(403);
    expect((await agent.post('/api/invoicing/runs').send({ from: day(0), to: day(4) })).status).toBe(403);
    expect((await request(app).get('/api/invoicing/overview')).status).toBe(401);
    const admin = await login(app, 'admin', org.id);
    expect((await admin.agent.get('/api/invoicing/overview')).status).toBe(403);
  });

  test('an owner of another organisation cannot see or act on an invoice', async () => {
    const app = buildApp();
    const orgA = await seedOrganisation('A'), orgB = await seedOrganisation('B');
    const a = await login(app, 'owner', orgA.id);
    const b = await login(app, 'owner', orgB.id);
    const pr = await practitioner(orgA.id, 'Ann Mary', 'Base St, Zone MM1', [day(0)]);
    await profile(a.agent, 'c1', planManaged('Trevor Sampi', 1));
    await event(pr, { clientId: 'c1', clientName: 'Trevor Sampi', date: day(0) });
    await run(a.agent, day(0), day(4));
    const [inv] = await invoices(a.agent);
    expect((await b.agent.get(`/api/invoicing/invoices/${inv.id}`)).status).toBe(404);
    expect((await b.agent.post(`/api/invoicing/invoices/${inv.id}/finalise`)).status).toBe(404);
    expect(await invoices(b.agent)).toHaveLength(0);
    // Org B's run does not see org A's events.
    const s = await run(b.agent, day(0), day(4));
    expect(s.eventsExamined).toBe(0);
  });
});

describe('normal invoicing', () => {
  test('A — Perth MMM1 day: three sessions, travel split evenly with the 30-minute cap, return unpaid', async () => {
    const app = buildApp();
    const org = await seedOrganisation();
    const { agent } = await login(app, 'owner', org.id);
    const d = day(0);
    const pr = await practitioner(org.id, 'Ann Mary Mathew', 'Base Rd, Canning Vale', [d]);
    for (const [id, name] of [['c1', 'Trevor Sampi'], ['c2', 'Rosemary Carey'], ['c3', 'Dorothy Cox']]) await profile(agent, id, planManaged(name, 1));
    route('Base Rd, Canning Vale', 'A home', 30, 20);
    route('A home', 'B home', 20, 12);
    route('B home', 'C home', 24, 9.2);
    route('C home', 'Base Rd, Canning Vale', 40, 30);
    await event(pr, { clientId: 'c1', clientName: 'Trevor Sampi', date: d, start: '09:00', location: 'A home' });
    await event(pr, { clientId: 'c2', clientName: 'Rosemary Carey', date: d, start: '11:00', location: 'B home' });
    await event(pr, { clientId: 'c3', clientName: 'Dorothy Cox', date: d, start: '13:00', location: 'C home' });

    const s = await run(agent, day(0), day(4));
    expect(s).toMatchObject({ invoicesCreated: 3, sessionsIncluded: 3, travelAllocations: 3, itemsNeedAttention: 0 });
    const list = await invoices(agent);
    expect(list).toHaveLength(3);
    for (const inv of list) {
      expect(inv.invoice_number).toMatch(/^INV-\d+$/);
      const { lines, invoice } = await detail(agent, inv.id);
      const [sess] = byComp(lines, 'SESSION');
      expect(sess).toMatchObject({ unit_price: '193.99', quantity: '1.0000', amount: '193.99', mmm_zone: 1 });
      const [lab] = byComp(lines, 'TRAVEL_LABOUR');
      expect(lab).toMatchObject({ unit_price: '97.00', amount: '39.88' });
      expect(lab.calculation).toMatchObject({ dayTotalMinutes: 74, billableSessions: 3, allocatedMinutesBeforeCap: 24.67, capMinutes: 30, claimableMinutes: 24.67 });
      expect(lab.calculation.legs.find(l => l.kind === 'RETURN')).toMatchObject({ included: false, reason: 'return_travel_not_payable' });
      const [km] = byComp(lines, 'TRAVEL_KM');
      expect(km.amount).toBe('13.60');
      expect(km.calculation.vehicleRatePerKm).toBe('0.99');
      expect(invoice.total).toBe('247.47');
      expect(invoice.payer_name).toBe('MARS Plan Manager');
      expect(invoice.status).toBe('DRAFT');
    }
  });

  test('E + H — one client three days → one invoice; re-running never duplicates', async () => {
    const app = buildApp();
    const org = await seedOrganisation();
    const { agent } = await login(app, 'owner', org.id);
    const pr = await practitioner(org.id, 'Ann Mary', 'Base', [day(0), day(2), day(4)]);
    await profile(agent, 'cA', planManaged('Client A', 1));
    for (const n of [0, 2, 4]) await event(pr, { clientId: 'cA', clientName: 'Client A', date: day(n), location: 'A home' });

    const first = await run(agent, day(0), day(4));
    expect(first).toMatchObject({ invoicesCreated: 1, sessionsIncluded: 3 });
    const [inv] = await invoices(agent);
    let d = await detail(agent, inv.id);
    expect(byComp(d.lines, 'SESSION')).toHaveLength(3);
    expect(byComp(d.lines, 'TRAVEL_LABOUR')).toHaveLength(3);
    const total = d.invoice.total;

    const second = await run(agent, day(0), day(4));
    expect(second).toMatchObject({ invoicesCreated: 0, invoicesUpdated: 1, linesAdded: 0 });
    expect(await invoices(agent)).toHaveLength(1);
    d = await detail(agent, inv.id);
    expect(active(d.lines)).toHaveLength(9);
    expect(d.invoice.total).toBe(total);
    const { rows: [{ n }] } = await db.pool.query(`SELECT COUNT(*)::int AS n FROM invoice_lines WHERE line_status IN ('ACTIVE','REMOVED')`);
    expect(n).toBe(9);
    // Google is asked once per distinct route, then the persisted facts are reused.
    const callsAfterFirstTwoRuns = routeCalls.length;
    await run(agent, day(0), day(4));
    expect(routeCalls.length).toBe(callsAfterFirstTwoRuns);

    // After finalisation the events are skipped and reported, not re-billed.
    await agent.put('/api/invoicing/settings').send({ abn: '49699791958' });
    expect((await agent.post(`/api/invoicing/invoices/${inv.id}/finalise`)).status).toBe(200);
    const third = await run(agent, day(0), day(4));
    expect(third).toMatchObject({ invoicesCreated: 0, alreadyInvoiced: 3, linesAdded: 0 });
    expect(await invoices(agent)).toHaveLength(1);
  });

  test('B/C/D — MM4 base rates with 60-min cap; MM6 and MM7 remote rates, uncapped', async () => {
    const app = buildApp();
    const org = await seedOrganisation();
    const { agent } = await login(app, 'owner', org.id);
    const pr4 = await practitioner(org.id, 'P4', 'Base4', [day(1)]);
    const pr6 = await practitioner(org.id, 'P6', 'Base6', [day(1)]);
    const pr7 = await practitioner(org.id, 'P7', 'Base7', [day(1)]);
    await profile(agent, 'z4', planManaged('Zone Four', 4));
    await profile(agent, 'z6', planManaged('Zone Six', 6));
    await profile(agent, 'z7', planManaged('Zone Seven', 7));
    route('Base4', 'z4 home', 75, 90); route('Base6', 'z6 home', 150, 180); route('Base7', 'z7 home', 200, 240);
    await event(pr4, { clientId: 'z4', clientName: 'Zone Four', date: day(1), location: 'z4 home' });
    await event(pr6, { clientId: 'z6', clientName: 'Zone Six', date: day(1), location: 'z6 home' });
    await event(pr7, { clientId: 'z7', clientName: 'Zone Seven', date: day(1), location: 'z7 home' });
    await run(agent, day(0), day(4));
    const got = {};
    for (const inv of await invoices(agent)) {
      const d = await detail(agent, inv.id);
      got[inv.client_id] = { s: byComp(d.lines, 'SESSION')[0], t: byComp(d.lines, 'TRAVEL_LABOUR')[0] };
    }
    expect(got.z4.s.unit_price).toBe('193.99');
    expect(got.z4.t).toMatchObject({ unit_price: '97.00', amount: '97.00' });
    expect(got.z4.t.calculation).toMatchObject({ capMinutes: 60, capApplied: true, claimableMinutes: 60 });
    expect(got.z6.s.unit_price).toBe('271.59');
    expect(got.z6.t).toMatchObject({ unit_price: '135.80', amount: '339.50' });
    expect(got.z6.t.calculation.capMinutes).toBeNull();
    expect(got.z7.s.unit_price).toBe('290.99');
    expect(got.z7.t).toMatchObject({ unit_price: '145.50', amount: '485.00' });
  });

  test('G — return travel only when payable', async () => {
    const app = buildApp();
    const org = await seedOrganisation();
    const { agent } = await login(app, 'owner', org.id);
    const pr = await practitioner(org.id, 'P', 'Base', [day(0)]);
    await profile(agent, 'c', planManaged('Client', 1));
    route('Base', 'c home', 10, 5); route('c home', 'Base', 12, 6);
    await event(pr, { clientId: 'c', clientName: 'Client', date: day(0), location: 'c home' });
    await run(agent, day(0), day(0));
    let [inv] = await invoices(agent);
    let lab = byComp((await detail(agent, inv.id)).lines, 'TRAVEL_LABOUR')[0];
    expect(lab.calculation).toMatchObject({ dayTotalMinutes: 10, claimableMinutes: 10, directions: 1 });

    await agent.put('/api/invoicing/settings').send({ returnTravelPayable: true });
    await run(agent, day(0), day(0));
    [inv] = await invoices(agent);
    lab = byComp((await detail(agent, inv.id)).lines, 'TRAVEL_LABOUR')[0];
    expect(lab.calculation).toMatchObject({ dayTotalMinutes: 22, claimableMinutes: 22, directions: 2 });
  });

  test('I — missing payer: attention issue, draft left unaddressed, finalise refused', async () => {
    const app = buildApp();
    const org = await seedOrganisation();
    const { agent } = await login(app, 'owner', org.id);
    const pr = await practitioner(org.id, 'P', 'Base', [day(0)]);
    await profile(agent, 'np', { participantName: 'No Payer', ndisNumber: '430000000', managementType: 'PLAN_MANAGED', serviceAddress: 'x, Zone MM1' });
    await event(pr, { clientId: 'np', clientName: 'No Payer', date: day(0) });
    const s = await run(agent, day(0), day(0));
    expect(s.itemsNeedAttention).toBeGreaterThanOrEqual(1);
    const issues = (await agent.get('/api/invoicing/issues')).body.issues;
    expect(issues.map(i => i.issue_type)).toContain('CLIENT_MISSING_PAYER');
    const [inv] = await invoices(agent);
    expect(inv.status).toBe('NEEDS_ATTENTION');
    expect(inv.payer_name).toBeNull();
    await agent.put('/api/invoicing/settings').send({ abn: '49699791958' });
    const fin = await agent.post(`/api/invoicing/invoices/${inv.id}/finalise`);
    expect(fin.status).toBe(409);

    // Fix the record → Reprocess resolves the issue and addresses the draft.
    await profile(agent, 'np', { payerType: 'PLAN_MANAGER', payerName: '24 Seven Plan Management', payerEmail: 'inv@24seven.test' });
    const issue = issues.find(i => i.issue_type === 'CLIENT_MISSING_PAYER');
    const rep = await agent.post(`/api/invoicing/issues/${issue.id}/reprocess`);
    expect(rep.status).toBe(200);
    expect(rep.body.issueStatus).toBe('RESOLVED');
    const [after] = await invoices(agent);
    expect(after.id).toBe(inv.id);
    expect(after).toMatchObject({ status: 'DRAFT', payer_name: '24 Seven Plan Management' });
  });

  test('unresolvable inputs are queued, not billed: no MMM, no location, failed route', async () => {
    const app = buildApp();
    const org = await seedOrganisation();
    const { agent } = await login(app, 'owner', org.id);
    const pr = await practitioner(org.id, 'P', 'Base', [day(0), day(1)]);
    await profile(agent, 'nomm', { ...planManaged('Nowhere', 1), serviceAddress: 'an address the geocoder cannot place' });
    await profile(agent, 'ok', planManaged('Fine', 1));
    await event(pr, { clientId: 'nomm', clientName: 'Nowhere', date: day(0) });
    await event(pr, { clientId: 'ok', clientName: 'Fine', date: day(1), location: 'NOWHERE street' });
    await run(agent, day(0), day(1));
    const types = (await agent.get('/api/invoicing/issues')).body.issues.map(i => i.issue_type);
    expect(types).toEqual(expect.arrayContaining(['MMM_UNRESOLVED', 'TRAVEL_ROUTE_FAILED']));
    const list = await invoices(agent);
    expect(list.map(i => i.client_id)).toEqual(['ok']);
    const d = await detail(agent, list[0].id);
    expect(byComp(d.lines, 'SESSION')).toHaveLength(1);
    expect(byComp(d.lines, 'TRAVEL_LABOUR')).toHaveLength(0); // travel held back, never estimated
  });

  test('K — rate card B from date X; history stays on A; a used card is frozen', async () => {
    const app = buildApp();
    const org = await seedOrganisation();
    const { agent } = await login(app, 'owner', org.id);
    const pr = await practitioner(org.id, 'P', 'Base', [day(0), day(3)]);
    await profile(agent, 'k', planManaged('Kay', 1));
    await event(pr, { clientId: 'k', clientName: 'Kay', date: day(0), location: 'Base' });
    await event(pr, { clientId: 'k', clientName: 'Kay', date: day(3), location: 'Base' });
    const cards = (await agent.get('/api/invoicing/rate-cards')).body.rateCards;
    const A = cards[0];
    const B = { ...A, name: 'Price rise', effectiveFrom: day(2), rules: A.rules.map(r => ({ ...r, sessionHourlyRate: r.mmmMin === 1 ? '200.00' : r.sessionHourlyRate })) };
    expect((await agent.put(`/api/invoicing/rate-cards/${A.id}`).send({ effectiveTo: day(1) })).status).toBe(200);
    expect((await agent.post('/api/invoicing/rate-cards').send(B)).status).toBe(201);
    await run(agent, day(0), day(4));
    const [inv] = await invoices(agent);
    const sessions = byComp((await detail(agent, inv.id)).lines, 'SESSION').sort((a, b) => a.service_date.localeCompare(b.service_date));
    expect(sessions.map(s => [s.unit_price, s.rate_card_version])).toEqual([['193.99', 1], ['200.00', 2]]);

    await agent.put('/api/invoicing/settings').send({ abn: '49699791958' });
    expect((await agent.post(`/api/invoicing/invoices/${inv.id}/finalise`)).status).toBe(200);
    // Editing a card that priced a finalised invoice is refused; the invoice is unchanged either way.
    const edit = await agent.put(`/api/invoicing/rate-cards/${A.id}`).send({ rules: A.rules.map(r => ({ ...r, sessionHourlyRate: '1.00' })) });
    expect(edit.status).toBe(409);
    const after = byComp((await detail(agent, inv.id)).lines, 'SESSION');
    expect(after.map(s => s.unit_price).sort()).toEqual(['193.99', '200.00']);
  });

  test('L — event change: draft goes stale and regenerates; finalised is flagged, never rewritten', async () => {
    const app = buildApp();
    const org = await seedOrganisation();
    const { agent } = await login(app, 'owner', org.id);
    await agent.put('/api/invoicing/settings').send({ abn: '49699791958' });
    const pr = await practitioner(org.id, 'P', 'Base', [day(0), day(1)]);
    await profile(agent, 'd', planManaged('Draft Client', 1));
    await profile(agent, 'f', planManaged('Final Client', 1));
    const eDraft = await event(pr, { clientId: 'd', clientName: 'Draft Client', date: day(0), location: 'Base', minutes: 60 });
    const eFinal = await event(pr, { clientId: 'f', clientName: 'Final Client', date: day(1), location: 'Base', minutes: 60 });
    await run(agent, day(0), day(1));
    const list = await invoices(agent);
    const draft = list.find(i => i.client_id === 'd');
    const fin = list.find(i => i.client_id === 'f');
    expect((await agent.post(`/api/invoicing/invoices/${fin.id}/finalise`)).status).toBe(200);
    const finalBefore = await detail(agent, fin.id);

    await db.pool.query(`UPDATE events SET end_time = end_time - INTERVAL '15 minutes' WHERE id = ANY($1::uuid[])`, [[eDraft, eFinal]]);

    let d = await detail(agent, draft.id);
    expect(d.invoice.is_stale).toBe(true);
    expect((await agent.post(`/api/invoicing/invoices/${draft.id}/finalise`)).body.code).toBe('STALE');
    const regen = await agent.post(`/api/invoicing/invoices/${draft.id}/regenerate`);
    expect(regen.status).toBe(200);
    d = await detail(agent, draft.id);
    expect(d.invoice.is_stale).toBe(false);
    expect(byComp(d.lines, 'SESSION')[0]).toMatchObject({ quantity: '0.7500', amount: '145.49' });

    const f = await detail(agent, fin.id);
    expect(f.invoice.source_changed_after_finalise).toBe(true);
    expect(f.invoice.total).toBe(finalBefore.invoice.total);
    expect(byComp(f.lines, 'SESSION')[0].amount).toBe('193.99');
    expect(f.issues.map(i => i.issue_type)).toContain('SOURCE_CHANGED_AFTER_FINALISE');
  });
});

describe('lifecycle: edit, PDF, finalise, pay, void & reissue, calendar link', () => {
  test('audited override, immutable final PDF, payments to PAID, void frees claims for reissue', async () => {
    const app = buildApp();
    const org = await seedOrganisation();
    const { agent } = await login(app, 'owner', org.id);
    const pr = await practitioner(org.id, 'Ann Mary', 'Base', [day(0)]);
    await profile(agent, 't', planManaged('Trevor Sampi', 1, '24 Seven Plan Management'));
    const ev = await event(pr, { clientId: 't', clientName: 'Trevor Sampi', date: day(0), location: 'Base', minutes: 30 });
    await run(agent, day(0), day(0));
    const [inv] = await invoices(agent);
    let d = await detail(agent, inv.id);
    const line = byComp(d.lines, 'SESSION')[0];

    // Financial override without a reason is refused; with one it is audited.
    expect((await agent.patch(`/api/invoicing/invoices/${inv.id}/lines/${line.id}`).send({ quantity: '0.25' })).status).toBe(400);
    const ov = await agent.patch(`/api/invoicing/invoices/${inv.id}/lines/${line.id}`).send({ quantity: '0.25', reason: 'Session ended early' });
    expect(ov.status).toBe(200);
    d = await detail(agent, inv.id);
    expect(byComp(d.lines, 'SESSION')[0]).toMatchObject({ quantity: '0.2500', amount: '48.50', is_overridden: true });
    const audit = (await agent.get(`/api/invoicing/invoices/${inv.id}/audit`)).body.events;
    expect(audit.find(a => a.action === 'invoice.line_overridden')).toMatchObject({ reason: 'Session ended early' });
    expect(audit.find(a => a.action === 'invoice.line_overridden').before_state.quantity).toBe('0.5000');
    // Re-running keeps the owner's override.
    await run(agent, day(0), day(0));
    expect(byComp((await detail(agent, inv.id)).lines, 'SESSION')[0].quantity).toBe('0.2500');

    // Draft PDF renders; finalise needs an ABN, then writes one immutable final PDF.
    const draftPdf = await agent.get(`/api/invoicing/invoices/${inv.id}/pdf?disposition=inline`);
    expect(draftPdf.status).toBe(200);
    expect(draftPdf.headers['content-type']).toBe('application/pdf');
    expect(Buffer.from(draftPdf.body).slice(0, 4).toString()).toBe('%PDF');
    expect((await agent.post(`/api/invoicing/invoices/${inv.id}/finalise`)).body.code).toBe('NO_ABN');
    await agent.put('/api/invoicing/settings').send({ abn: '49 699 791 958' });
    expect((await agent.post(`/api/invoicing/invoices/${inv.id}/finalise`)).status).toBe(200);
    const p1 = await agent.get(`/api/invoicing/invoices/${inv.id}/pdf`).buffer(true);
    const p2 = await agent.get(`/api/invoicing/invoices/${inv.id}/pdf`).buffer(true);
    expect(Buffer.compare(Buffer.from(p1.body), Buffer.from(p2.body))).toBe(0);
    const { rows: docs } = await db.pool.query(`SELECT is_final FROM invoice_documents WHERE invoice_id = $1 AND is_final`, [inv.id]);
    expect(docs).toHaveLength(1);
    // Locked: no edits after finalisation.
    expect((await agent.patch(`/api/invoicing/invoices/${inv.id}/lines/${line.id}`).send({ description: 'x' })).status).toBe(409);

    // Calendar shows the invoice number.
    const links = (await agent.post('/api/invoicing/events/links').send({ eventIds: [ev] })).body.links;
    expect(links[ev].invoices[0].invoiceNumber).toBe(inv.invoice_number);

    // Payments: part then full.
    d = await detail(agent, inv.id);
    const total = d.invoice.total;
    expect((await agent.post(`/api/invoicing/invoices/${inv.id}/payments`).send({ amount: '999999', paidOn: day(5) })).status).toBe(400);
    expect((await agent.post(`/api/invoicing/invoices/${inv.id}/payments`).send({ amount: '10.00', paidOn: day(5) })).body.status).toBe('PART_PAID');
    const rest = (Math.round(Number(total) * 100) - 1000) / 100;
    const paid = await agent.post(`/api/invoicing/invoices/${inv.id}/payments`).send({ amount: rest.toFixed(2), paidOn: day(6), method: 'EFT' });
    expect(paid.body).toMatchObject({ status: 'PAID', outstanding: '0.00' });

    // A paid invoice cannot be voided until payments are reversed.
    expect((await agent.post(`/api/invoicing/invoices/${inv.id}/void`).send({ reason: 'wrong client' })).status).toBe(409);
  });

  test('void & reissue produces a fresh draft for the same events', async () => {
    const app = buildApp();
    const org = await seedOrganisation();
    const { agent } = await login(app, 'owner', org.id);
    await agent.put('/api/invoicing/settings').send({ abn: '49699791958' });
    const pr = await practitioner(org.id, 'P', 'Base', [day(0)]);
    await profile(agent, 'r', planManaged('Reissue Client', 1));
    await event(pr, { clientId: 'r', clientName: 'Reissue Client', date: day(0), location: 'Base' });
    await run(agent, day(0), day(0));
    const [inv] = await invoices(agent);
    await agent.post(`/api/invoicing/invoices/${inv.id}/finalise`);
    expect((await agent.post(`/api/invoicing/invoices/${inv.id}/reissue`).send({})).status).toBe(400);
    const re = await agent.post(`/api/invoicing/invoices/${inv.id}/reissue`).send({ reason: 'Plan manager changed' });
    expect(re.status).toBe(200);
    expect(re.body.reissued.invoice_number).not.toBe(inv.invoice_number);
    const list = await invoices(agent);
    expect(list.find(i => i.id === inv.id).status).toBe('VOID');
    const fresh = await detail(agent, re.body.reissued.id);
    expect(fresh.invoice.reissue_of_invoice_id).toBe(inv.id);
    expect(byComp(fresh.lines, 'SESSION')).toHaveLength(1);
  });

  test('attendance mark removes a session from its draft and is audited', async () => {
    const app = buildApp();
    const org = await seedOrganisation();
    const { agent } = await login(app, 'owner', org.id);
    const pr = await practitioner(org.id, 'P', 'Base', [day(0), day(1)]);
    await profile(agent, 'm', planManaged('Marked', 1));
    const e1 = await event(pr, { clientId: 'm', clientName: 'Marked', date: day(0), location: 'Base' });
    await event(pr, { clientId: 'm', clientName: 'Marked', date: day(1), location: 'Base' });
    await run(agent, day(0), day(1));
    expect((await agent.put(`/api/invoicing/events/${e1}/attendance`).send({ attendance: 'DID_NOT_ATTEND', reason: 'No-show' })).status).toBe(200);
    const [inv] = await invoices(agent);
    expect((await detail(agent, inv.id)).invoice.is_stale).toBe(true);
    await run(agent, day(0), day(1));
    const d = await detail(agent, inv.id);
    expect(byComp(d.lines, 'SESSION')).toHaveLength(1);
  });
});

describe('J — rural trip', () => {
  test('15 clients, $6,000 eligible → $400 each, grouped per client, reconciles, no duplicates', async () => {
    const app = buildApp();
    const org = await seedOrganisation();
    const { agent } = await login(app, 'owner', org.id);
    const start = day(0), end = day(13);
    const dates = Array.from({ length: 14 }, (_, i) => day(i));
    const pr = await practitioner(org.id, 'Ann Mary', 'Kununurra motel', dates, { remote: true });
    for (let i = 0; i < 15; i++) {
      const id = `k${String(i).padStart(2, '0')}`;
      await profile(agent, id, planManaged(`Kimberley Client ${i}`, 7));
      await event(pr, { clientId: id, clientName: `Kimberley Client ${i}`, date: day(i % 10), start: `${String(8 + (i % 3) * 2).padStart(2, '0')}:00`, location: `${id} community` });
    }
    // Client 0 is seen twice — still one invoice and one share.
    await event(pr, { clientId: 'k00', clientName: 'Kimberley Client 0', date: day(11), location: 'k00 community' });

    const t = await agent.post('/api/invoicing/trips').send({ name: 'East Kimberley – October 2026', destination: 'Kununurra', startDate: start, endDate: end, practitionerIds: [pr.id] });
    expect(t.status).toBe(201);
    const tripId = t.body.trip.id;
    const cost = async (category, amount, billableMode) => {
      const r = await agent.post(`/api/invoicing/trips/${tripId}/costs`).send({ category, amount, billableMode, description: category, supplier: 'Test' });
      expect(r.status).toBe(201); return r.body.id;
    };
    await cost('FLIGHTS', '3200.00', 'SHARED_BILLABLE');
    await cost('ACCOMMODATION', '2100.00', 'SHARED_BILLABLE');
    await cost('CAR_HIRE', '700.00', 'SHARED_BILLABLE');
    const unclassified = await cost('OTHER', '180.00');

    // Unclassified cost blocks the allocation (sessions still invoice).
    let gen = await agent.post(`/api/invoicing/trips/${tripId}/generate`);
    expect(gen.status).toBe(201);
    let issues = (await agent.get('/api/invoicing/issues')).body.issues;
    expect(issues.map(i => i.issue_type)).toContain('TRIP_COST_INCOMPLETE');
    expect((await db.pool.query(`SELECT COUNT(*)::int AS n FROM invoice_lines WHERE component = 'TRIP_COST'`)).rows[0].n).toBe(0);

    await agent.put(`/api/invoicing/trips/${tripId}/costs/${unclassified}`).send({ billableMode: 'NON_BILLABLE' });
    gen = await agent.post(`/api/invoicing/trips/${tripId}/generate`);
    expect(gen.status).toBe(201);
    expect(gen.body.summary.trip).toMatchObject({ totalCosts: '6180.00', nonBillableCosts: '180.00', eligibleSharedCosts: '6000.00', clientCount: 15, allocated: '6000.00', unallocated: '0.00' });

    const list = await invoices(agent, `?tripId=${tripId}`);
    expect(list).toHaveLength(15);
    let sum = 0;
    for (const inv of list) {
      const d = await detail(agent, inv.id);
      const tc = byComp(d.lines, 'TRIP_COST');
      expect(tc).toHaveLength(1);
      expect(tc[0].amount).toBe('400.00');
      expect(tc[0].description).toBe('Remote Trip Shared Travel Cost – East Kimberley – October 2026');
      expect(tc[0].calculation).toMatchObject({ method: 'EQUAL_PER_CLIENT', eligiblePool: '6000.00', clientCount: 15 });
      expect(byComp(d.lines, 'SESSION').every(s => s.unit_price === '290.99')).toBe(true);
      sum += Math.round(Number(tc[0].amount) * 100);
    }
    expect(sum).toBe(600000);
    expect(byComp((await detail(agent, list.find(i => i.client_id === 'k00').id)).lines, 'SESSION')).toHaveLength(2);

    // Regenerating does not duplicate anything.
    const again = await agent.post(`/api/invoicing/trips/${tripId}/generate`);
    expect(again.body.summary.invoicesCreated).toBe(0);
    const { rows: [{ n }] } = await db.pool.query(`SELECT COUNT(*)::int AS n FROM invoice_lines WHERE component = 'TRIP_COST' AND line_status = 'ACTIVE'`);
    expect(n).toBe(15);
    const { rows: [{ total }] } = await db.pool.query(`SELECT SUM(amount) AS total FROM trip_allocations WHERE trip_id = $1 AND is_current`, [tripId]);
    expect(total).toBe('6000.00');

    const detailRes = await agent.get(`/api/invoicing/trips/${tripId}`);
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.allocationPreview.totals.allocated).toBe('6000.00');
    expect(detailRes.body.sessions).toHaveLength(16);
  });
});

describe('client billing profile + MMM', () => {
  test('MMM is geocoded once, reused, and a manual override needs a reason and is audited', async () => {
    const app = buildApp();
    const org = await seedOrganisation();
    const { agent } = await login(app, 'owner', org.id);
    const p = await profile(agent, 'x', planManaged('Ex', 3));
    expect(p.profile).toMatchObject({ mmm_zone: 3, mmm_source: 'dataset', mmm_dataset_version: 'TEST-SYNTH', mmm_confidence: 'CONFIDENT' });
    expect(p.effectiveMmm).toBe(3);
    const calls = geocodeCalls.length;
    await profile(agent, 'x', { billingNotes: 'n' });
    expect(geocodeCalls.length).toBe(calls);
    expect((await agent.put('/api/invoicing/clients/x/mmm-override').send({ zone: 6 })).status).toBe(400);
    const ov = await agent.put('/api/invoicing/clients/x/mmm-override').send({ zone: 6, reason: 'Service delivered at remote community clinic' });
    expect(ov.body.effectiveMmm).toBe(6);
    const audit = (await agent.get('/api/invoicing/audit?entityType=billing_profile&entityId=x')).body.events;
    expect(audit.map(a => a.action)).toContain('billing_profile.mmm_override');
    // The audit trail is append-only at the database level.
    await expect(db.pool.query(`UPDATE billing_audit_events SET action = 'x'`)).rejects.toThrow(/append-only/);
  });
});
