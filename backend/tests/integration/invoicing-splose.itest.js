'use strict';

/**
 * Invoicing reads Splose (migration 082, billing/splose-billing-source.js):
 *   1. a blank payer is filled from the client's latest Splose invoice contact;
 *   2. Splose support activities bill as SPLOSE_ACTIVITY lines, never twice;
 *   3. numbering continues after Splose's, and a draft whose number Splose has
 *      since used is renumbered before it is finalised.
 * Splose is a deterministic in-process fake shaped like the live API
 * (probed 30 Oct 2026); nothing leaves the process.
 */

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { db, truncateAll, seedUser, seedOrganisation, closePool } = require('./helpers');
const { setMapsProvider } = require('../../billing/maps-adapter');
const SB = require('../../billing/splose-billing-source');
const DR = require('../../billing/day-route');

const PASSWORD = 'InvPass1!';

setMapsProvider({
  async geocode() { return null; },
  async route() { return { minutes: 10, km: 8, provider: 'test_routes' }; },
});

// ── Fake Splose ──
let fake;
function resetFake() {
  fake = {
    connected: true, failInvoices: false,
    patients: [], invoices: [], contacts: [], activities: [], appointments: [],
    services: [{ id: 127253, title: 'FCA', type: 'Report Writing' }, { id: 138841, title: 'Case Management', type: 'Occupational Therapy' }],
  };
}
const fail = () => { throw new Error('Splose down'); };
SB.setSploseSource({
  isConfigured: () => fake.connected,
  async getInvoices(params = {}) {
    if (fake.failInvoices) fail();
    return params.patientId ? fake.invoices.filter(i => String(i.patientId) === String(params.patientId)) : fake.invoices;
  },
  async getSupportActivities() { return fake.activities; },
  async getAppointments() { return fake.appointments; },
  async getContacts() { return fake.contacts; },
  async getPatientBillingDetails() { return fake.patients; },
  async getServices() { return fake.services; },
});

const ROBERT = { id: 5204151, fullName: 'Robert Weaver', email: null, ndisNumber: '431876925', fundManagement: 'Plan-managed',
  formattedAddress: '288 Orton Rd, Casuarina WA 6167' };
const NDSP = { id: 344246, type: 'Plan manager', name: 'NDSP', email: 'invoices@ndsp.com.au', archived: false };
const OLD_PM = { id: 900001, type: 'Plan manager', name: 'Old Plan Co', email: 'old@pm.test', archived: false };
const COORD = { id: 1333890, type: 'Support Coordinator', name: 'Ben Beckingham', email: null, archived: false };
const sploseInvoice = (id, number, patientId, contactId, issueDate) => ({ id, invoiceNumber: number, patientId, contactId, issueDate, isArchived: false });

function buildApp() {
  const app = express();
  app.use(bodyParser.json({ limit: '12mb' }));
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../invoicing-routes'));
  return app;
}

async function login(app, role, orgId) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser({ password_hash: hash, role, organisation_id: orgId, name: `${role} user` });
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user };
}

function perthYmd(d) { return new Date(d.getTime() + 8 * 3600000).toISOString().slice(0, 10); }
const anchor = new Date(Date.now() - 21 * 86400000);
const dow = new Date(perthYmd(anchor) + 'T00:00:00Z').getUTCDay();
const MON = new Date(Date.parse(perthYmd(anchor) + 'T00:00:00Z') - ((dow + 6) % 7) * 86400000).toISOString().slice(0, 10);
const day = n => new Date(Date.parse(MON + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const utc = (date, hm) => new Date(`${date}T${hm}:00+08:00`).toISOString();
const displayDate = ymd => { const [y, m, d] = ymd.split('-').map(Number); return `${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}`; };

/** A practitioner linked to Splose practitioner `sploseId` (Users & Roles). */
async function practitioner(orgId, name, dates, sploseId = '19521') {
  const u = await seedUser({ role: 'therapist', organisation_id: orgId, name });
  const schedule = {};
  for (const d of dates) {
    const wk = DR.weekKeyForDate(d);
    schedule[wk] = schedule[wk] || {};
    schedule[wk][DR.dayKeyForDate(d)] = 'home-1';
  }
  await db.pool.query(`UPDATE users SET default_work_location = $2, work_location_schedule = $3 WHERE id = $1`,
    [u.id, JSON.stringify({ homes: [{ id: 'home-1', label: 'Home', kind: 'local', addr: 'Base, Perth WA 6000' }] }), JSON.stringify(schedule)]);
  if (sploseId) {
    await db.pool.query(`INSERT INTO therapist_profiles (organisation_id, user_id, display_name, splose_practitioner_id) VALUES ($1,$2,$3,$4)`,
      [orgId, u.id, name, sploseId]);
  }
  return u;
}

async function event(user, { clientId, clientName, date, start = '09:00', minutes = 60, sploseId = null }) {
  const startIso = utc(date, start);
  const { rows: [e] } = await db.pool.query(
    `INSERT INTO events (user_id, title, start_time, end_time, location, event_type, status, client_id, client_name, organisation_id, splose_id)
     VALUES ($1,$2,$3,$4,'288 Orton Rd, Casuarina WA 6167','therapy','confirmed',$5,$6,$7,$8) RETURNING id`,
    [user.id, clientName, startIso, new Date(Date.parse(startIso) + minutes * 60000).toISOString(), clientId, clientName, user.organisation_id, sploseId]);
  return e.id;
}

function activity(id, { date, start = '12:30', minutes = 150, patientId = ROBERT.id, practitionerId = 19521, serviceId = 127253,
  itemCode = '15_617_0128_1_3_RR', invoiceId = null, doNotInvoice = false }) {
  const s = utc(date, start);
  return { id, start: s, end: new Date(Date.parse(s) + minutes * 60000).toISOString(), patientId, practitionerId, serviceId,
    itemCode, pricing: 193.99, invoiceId, doNotInvoice, archived: false, deletedAt: null };
}

async function run(agent, from, to) {
  const res = await agent.post('/api/invoicing/runs').send({ from, to });
  expect(res.status).toBe(201);
  return res.body.summary;
}
async function invoices(agent) { return (await agent.get('/api/invoicing/invoices')).body.invoices; }
async function detail(agent, id) { return (await agent.get(`/api/invoicing/invoices/${id}`)).body; }
async function allLines(agent) {
  const out = [];
  for (const inv of await invoices(agent)) out.push(...(await detail(agent, inv.id)).lines);
  return out;
}
const live = (lines, c) => lines.filter(l => l.line_status === 'ACTIVE' && (!c || l.component === c));
async function openIssues(orgId, type) {
  const { rows } = await db.pool.query(`SELECT * FROM billing_issues WHERE organisation_id = $1 AND status = 'OPEN' AND issue_type = $2`, [orgId, type]);
  return rows;
}

beforeEach(async () => {
  await truncateAll();
  require('../../auth')._resetLoginRateLimit();
  resetFake();
});
afterAll(async () => { await closePool(); });

describe('1 — the payer comes from the client\'s latest Splose invoice', () => {
  test('a blank profile is filled: plan manager + email from the latest invoice, NDIS number, management, address; audited without values', async () => {
    const app = buildApp();
    const org = await seedOrganisation();
    const { agent } = await login(app, 'owner', org.id);
    const pr = await practitioner(org.id, 'Ann Mary Mathew', [day(0)]);
    fake.patients = [ROBERT];
    fake.contacts = [NDSP, OLD_PM, COORD];
    fake.invoices = [sploseInvoice(1, 'INV-1500', ROBERT.id, OLD_PM.id, '2026-01-10T16:00:00.000Z'),
      sploseInvoice(2, 'INV-2006', ROBERT.id, NDSP.id, '2026-10-28T16:00:00.000Z')];
    await event(pr, { clientId: String(ROBERT.id), clientName: 'Robert Weaver', date: day(0) });

    const s = await run(agent, day(0), day(0));
    expect(s.splose).toBe('OK');
    const [inv] = await invoices(agent);
    expect(inv).toMatchObject({ payer_name: 'NDSP', payer_type: 'PLAN_MANAGER', status: 'DRAFT', ndis_number: '431876925' });
    const { invoice } = await detail(agent, inv.id);
    expect(invoice.payer_email).toBe('invoices@ndsp.com.au');

    const prof = (await agent.get(`/api/invoicing/clients/${ROBERT.id}`)).body.profile;
    expect(prof).toMatchObject({ management_type: 'PLAN_MANAGED', payer_source: 'SPLOSE_INVOICE', payer_source_detail: 'Splose invoice INV-2006',
      service_address: '288 Orton Rd, Casuarina WA 6167' });
    const { rows: [a] } = await db.pool.query(`SELECT * FROM billing_audit_events WHERE action = 'billing_profile.imported_from_splose'`);
    expect(a.after_state.fields).toEqual(expect.arrayContaining(['ndisNumber', 'managementType', 'payerType', 'payerName', 'payerEmail']));
    expect(JSON.stringify(a.after_state)).not.toMatch(/ndsp\.com\.au|431876925/);   // field names only, never the values

    // An owner edit replaces the payer, is remembered as the owner's choice, and joins the directory.
    const put = await agent.put(`/api/invoicing/clients/${ROBERT.id}`).send({ payerName: 'Owner Chosen PM', payerEmail: 'owner@pm.test' });
    expect(put.status).toBe(200);
    expect(put.body.profile).toMatchObject({ payer_name: 'Owner Chosen PM', payer_source: 'OWNER', payer_source_detail: null });
    // …and Splose never overwrites it.
    await run(agent, day(0), day(0));
    expect((await agent.get(`/api/invoicing/clients/${ROBERT.id}`)).body.profile.payer_name).toBe('Owner Chosen PM');
  });

  test('fail-closed: a plan-managed client whose latest invoice went to a non-plan-manager, or who has none, gets no payer', async () => {
    const app = buildApp();
    const org = await seedOrganisation();
    const { agent } = await login(app, 'owner', org.id);
    const pr = await practitioner(org.id, 'Ann', [day(0)]);
    const NOINV = { ...ROBERT, id: 7000002, fullName: 'No Invoices', ndisNumber: '431876926' };
    fake.patients = [ROBERT, NOINV];
    fake.contacts = [NDSP, COORD];
    fake.invoices = [sploseInvoice(1, 'INV-1500', ROBERT.id, NDSP.id, '2026-01-10T16:00:00.000Z'),
      sploseInvoice(2, 'INV-2006', ROBERT.id, COORD.id, '2026-10-28T16:00:00.000Z')];   // latest went to the coordinator
    await event(pr, { clientId: String(ROBERT.id), clientName: 'Robert Weaver', date: day(0) });
    await event(pr, { clientId: String(NOINV.id), clientName: 'No Invoices', date: day(0), start: '11:00' });
    await run(agent, day(0), day(0));
    for (const inv of await invoices(agent)) expect(inv).toMatchObject({ status: 'NEEDS_ATTENTION', payer_name: null });
    expect((await openIssues(org.id, 'CLIENT_MISSING_PAYER')).map(i => i.client_id).sort()).toEqual([String(ROBERT.id), String(NOINV.id)].sort());
  });

  test('"Fill blanks from Splose" uses the same rule; it needs manage_billing', async () => {
    const app = buildApp();
    const org = await seedOrganisation();
    const { agent } = await login(app, 'owner', org.id);
    fake.patients = [ROBERT]; fake.contacts = [NDSP];
    fake.invoices = [sploseInvoice(2, 'INV-2006', ROBERT.id, NDSP.id, '2026-10-28T16:00:00.000Z')];
    const res = await agent.post(`/api/invoicing/clients/${ROBERT.id}/import-splose`);
    expect(res.status).toBe(200);
    expect(res.body.profile).toMatchObject({ payer_name: 'NDSP', payer_email: 'invoices@ndsp.com.au', participant_name: 'Robert Weaver' });
    const { agent: therapist } = await login(app, 'therapist', org.id);
    expect((await therapist.post(`/api/invoicing/clients/${ROBERT.id}/import-splose`)).status).toBe(403);
    // With Splose off the button still answers from the payer directory.
    fake.connected = false;
    const off = await agent.post(`/api/invoicing/clients/${ROBERT.id}/import-splose`);
    expect(off.status).toBe(200);
    expect(off.body.splose).toBe('NOT_CONNECTED');
  });
});

describe('2 — Splose support activities', () => {
  async function setup() {
    const app = buildApp();
    const org = await seedOrganisation();
    const { agent } = await login(app, 'owner', org.id);
    const pr = await practitioner(org.id, 'Ann Mary Mathew', [day(0), day(1)]);
    fake.patients = [ROBERT]; fake.contacts = [NDSP];
    fake.invoices = [sploseInvoice(2, 'INV-2006', ROBERT.id, NDSP.id, '2026-10-28T16:00:00.000Z')];
    return { app, org, agent, pr };
  }

  test('report writing bills like INV-2006: date + service, 2.5 h × $193.99 = $484.98, Splose\'s item code; never twice', async () => {
    const { agent, pr } = await setup();
    fake.activities = [activity(11997060, { date: day(1) })];
    const s = await run(agent, day(0), day(4));
    expect(s.sploseActivitiesIncluded).toBe(1);
    const [line] = live(await allLines(agent), 'SPLOSE_ACTIVITY');
    expect(line).toMatchObject({ item_code: '15_617_0128_1_3_RR', description: `${displayDate(day(1))}, FCA (Report Writing)`,
      quantity: '2.5000', unit_price: '193.99', amount: '484.98', mmm_zone: 1, practitioner_user_id: pr.id, splose_activity_id: '11997060' });
    const [inv] = await invoices(agent);
    expect(inv).toMatchObject({ payer_name: 'NDSP', total: '484.98', practitioner_names: 'Ann Mary Mathew' });

    const again = await run(agent, day(0), day(4));
    expect(again).toMatchObject({ linesAdded: 0, invoicesCreated: 0 });
    expect(live(await allLines(agent), 'SPLOSE_ACTIVITY')).toHaveLength(1);
  });

  test('already invoiced in Splose or marked do-not-invoice: not billed; an Opal draft line leaves when Splose invoices it', async () => {
    const { agent } = await setup();
    fake.activities = [activity(1, { date: day(1) }), activity(2, { date: day(1), start: '15:00', invoiceId: 999 }),
      activity(3, { date: day(1), start: '16:00', doNotInvoice: true })];
    const s = await run(agent, day(0), day(4));
    expect(s).toMatchObject({ sploseActivitiesIncluded: 1, invoicedInSplose: 1 });
    expect(s.skipped).toMatchObject({ invoiced_in_splose: 1, splose_do_not_invoice: 1 });

    fake.activities[0].invoiceId = 20075348;   // Splose invoiced it after Opal drafted it
    await run(agent, day(0), day(4));
    const lines = await allLines(agent);
    expect(live(lines, 'SPLOSE_ACTIVITY')).toHaveLength(0);
    expect(lines.find(l => l.splose_activity_id === '1')).toMatchObject({ line_status: 'VOIDED' });
  });

  test('held, not billed: an unlinked Splose practitioner, an item the rate card does not price, Splose unreadable', async () => {
    const { org, agent } = await setup();
    fake.activities = [activity(1, { date: day(1), practitionerId: 55555 }),
      activity(2, { date: day(1), start: '15:00', itemCode: '15_617_0118_1_3_NF' })];
    await run(agent, day(0), day(4));
    expect(live(await allLines(agent), 'SPLOSE_ACTIVITY')).toHaveLength(0);
    expect(await openIssues(org.id, 'SPLOSE_ACTIVITY_PRACTITIONER_UNMAPPED')).toHaveLength(1);
    expect(await openIssues(org.id, 'SPLOSE_ACTIVITY_ITEM_UNSUPPORTED')).toHaveLength(1);

    // A billed draft line is left alone (not voided) while Splose cannot be read.
    fake.activities = [activity(3, { date: day(1) })];
    await run(agent, day(0), day(4));
    expect(live(await allLines(agent), 'SPLOSE_ACTIVITY')).toHaveLength(1);
    fake.failInvoices = true;
    const s = await run(agent, day(0), day(4));
    expect(s.splose).toBe('UNAVAILABLE');
    expect(live(await allLines(agent), 'SPLOSE_ACTIVITY')).toHaveLength(1);
    expect(await openIssues(org.id, 'SPLOSE_UNAVAILABLE')).toHaveLength(1);
  });

  test('an activity overlapping a timed Opal non-face-to-face block for the same client is the same work: only the timer bills', async () => {
    const { org, agent, pr } = await setup();
    await agent.put(`/api/invoicing/clients/${ROBERT.id}`).send({ serviceAddress: ROBERT.formattedAddress });
    await db.pool.query(`UPDATE billing_profiles SET mmm_manual_override = 1, mmm_override_reason = 'test' WHERE client_id = $1`, [String(ROBERT.id)]);
    const startIso = utc(day(1), '12:00');
    const booking = { kind: 'case-management', group: 'nf2f', clientId: String(ROBERT.id), clientName: 'Robert Weaver',
      clients: [{ clientId: String(ROBERT.id), clientName: 'Robert Weaver' }] };
    const { rows: [e] } = await db.pool.query(
      `INSERT INTO events (user_id, title, start_time, end_time, location, event_type, status, organisation_id, custom_metadata)
       VALUES ($1,'Report','${startIso}','${new Date(Date.parse(startIso) + 3 * 3600000).toISOString()}','','report','confirmed',$2,$3) RETURNING id`,
      [pr.id, org.id, JSON.stringify({ booking })]);
    await db.pool.query(`INSERT INTO event_billing_timers (event_id, organisation_id, user_id, status, accumulated_seconds, limit_seconds)
                         VALUES ($1,$2,$3,'STOPPED',5400,10800)`, [e.id, org.id, pr.id]);
    fake.activities = [activity(1, { date: day(1), start: '12:30' })];
    const s = await run(agent, day(0), day(4));
    expect(s).toMatchObject({ nf2fIncluded: 1, sploseActivitiesIncluded: 0 });
    expect(await openIssues(org.id, 'SPLOSE_ACTIVITY_DUPLICATES_NF2F')).toHaveLength(1);
  });
});

describe('sessions synced from Splose that Splose has already invoiced', () => {
  test('are skipped; unknown when Splose cannot be read (held, not billed); finalised in Opal and later invoiced in Splose → flagged', async () => {
    const app = buildApp();
    const org = await seedOrganisation();
    const { agent } = await login(app, 'owner', org.id);
    await agent.put('/api/invoicing/settings').send({ abn: '49699791958' });
    const pr = await practitioner(org.id, 'Ann', [day(0), day(1)]);
    fake.patients = [ROBERT]; fake.contacts = [NDSP];
    fake.invoices = [sploseInvoice(2, 'INV-2006', ROBERT.id, NDSP.id, '2026-10-28T16:00:00.000Z')];
    const cid = String(ROBERT.id);
    fake.appointments = [
      { id: 'A1', patients: [{ patientId: ROBERT.id, invoiceId: 777, doNotInvoice: false }] },
      { id: 'A2', patients: [{ patientId: ROBERT.id, invoiceId: null, doNotInvoice: false }] }];
    await event(pr, { clientId: cid, clientName: 'Robert Weaver', date: day(0), sploseId: 'A1' });
    await event(pr, { clientId: cid, clientName: 'Robert Weaver', date: day(1), sploseId: 'A2' });

    let s = await run(agent, day(0), day(1));
    expect(s).toMatchObject({ sessionsIncluded: 1, invoicedInSplose: 1 });
    expect(live(await allLines(agent), 'SESSION').map(l => l.service_date.slice(0, 10))).toEqual([day(1)]);

    // Finalise A2's invoice in Opal; Splose then invoices A2 too → double billing is flagged, never rewritten.
    const [inv] = await invoices(agent);
    expect((await agent.post(`/api/invoicing/invoices/${inv.id}/finalise`)).status).toBe(200);
    fake.appointments[1].patients[0].invoiceId = 888;
    s = await run(agent, day(0), day(1));
    const dbl = await openIssues(org.id, 'SPLOSE_DOUBLE_BILLED');
    expect(dbl).toHaveLength(1);
    expect(dbl[0].invoice_id).toBe(inv.id);
    expect((await detail(agent, inv.id)).invoice.status).toBe('READY');

    // Splose unreadable: a new Splose-synced session is held back with an attention item.
    await event(pr, { clientId: cid, clientName: 'Robert Weaver', date: day(1), start: '13:00', sploseId: 'A3' });
    fake.failInvoices = true;
    s = await run(agent, day(1), day(1));
    expect(s.sessionsIncluded).toBe(0);
    expect(await openIssues(org.id, 'SPLOSE_UNAVAILABLE')).toHaveLength(1);
  });
});

describe('3 — numbering continues after Splose', () => {
  test('the first Opal number follows Splose\'s highest; a number Splose used since is replaced at finalise; unreadable → refused', async () => {
    const app = buildApp();
    const org = await seedOrganisation();
    const { agent } = await login(app, 'owner', org.id);
    await agent.put('/api/invoicing/settings').send({ abn: '49699791958' });
    const pr = await practitioner(org.id, 'Ann', [day(0), day(1)]);
    fake.patients = [ROBERT, { ...ROBERT, id: 7000003, fullName: 'Second Client', ndisNumber: '431876927' }];
    fake.contacts = [NDSP];
    fake.invoices = [sploseInvoice(2, 'INV-2006', ROBERT.id, NDSP.id, '2026-10-28T16:00:00.000Z'),
      sploseInvoice(3, 'INV-2005', 7000003, NDSP.id, '2026-10-27T16:00:00.000Z'),
      sploseInvoice(4, 'INV - 9999', ROBERT.id, NDSP.id, '2020-01-01T00:00:00.000Z')];   // another prefix: ignored
    await event(pr, { clientId: String(ROBERT.id), clientName: 'Robert Weaver', date: day(0) });
    await event(pr, { clientId: '7000003', clientName: 'Second Client', date: day(1) });
    await run(agent, day(0), day(1));
    expect((await invoices(agent)).map(i => i.invoice_number).sort()).toEqual(['INV-2007', 'INV-2008']);
    const st = (await agent.get('/api/invoicing/settings')).body;
    expect(st.settings.sploseInvoiceNumberHigh).toBe(2006);
    expect(st.nextInvoiceNumberPreview).toBe('INV-2009');

    // Splose issues INV-2007 meanwhile; finalising the Opal draft INV-2007 renumbers it first.
    const draft = (await invoices(agent)).find(i => i.invoice_number === 'INV-2007');
    fake.invoices.push(sploseInvoice(5, 'INV-2007', 7000003, NDSP.id, '2026-10-29T16:00:00.000Z'));
    const fin = await agent.post(`/api/invoicing/invoices/${draft.id}/finalise`);
    expect(fin.status).toBe(200);
    const after = await detail(agent, draft.id);
    expect(after.invoice).toMatchObject({ status: 'READY', invoice_number: 'INV-2009' });
    const { rows: [audit] } = await db.pool.query(`SELECT * FROM billing_audit_events WHERE action = 'invoice.renumbered'`);
    expect(audit).toMatchObject({ reason: 'Number already used in Splose' });
    expect(audit.before_state.invoiceNumber).toBe('INV-2007');

    // Splose connected but unreadable: finalising is refused; the draft stays a draft.
    const other = (await invoices(agent)).find(i => i.invoice_number === 'INV-2008');
    fake.failInvoices = true;
    const refused = await agent.post(`/api/invoicing/invoices/${other.id}/finalise`);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('SPLOSE_UNAVAILABLE');
    expect((await detail(agent, other.id)).invoice.status).toBe('DRAFT');
  });
});

describe('the payer directory — Opal\'s own memory of where invoices go (migration 083)', () => {
  const NDSP_DUP = { id: 1529505, type: 'Plan manager', name: 'NDSP ', email: null, archived: false };   // Splose's duplicate, no email

  test('importing every Splose invoice: duplicate contacts are one payer, history per client, idempotent', async () => {
    const app = buildApp();
    const org = await seedOrganisation();
    const { agent } = await login(app, 'owner', org.id);
    const SAM = { id: 7000010, fullName: 'Sam Self', ndisNumber: '431876930', fundManagement: 'Self-managed', formattedAddress: 'A home, Perth WA 6000' };
    const MUM = { id: 55, type: 'Mother', name: 'Jo Self', email: 'jo@self.test', archived: false };
    fake.patients = [ROBERT, SAM];
    fake.contacts = [NDSP, NDSP_DUP, OLD_PM, MUM];
    fake.invoices = [sploseInvoice(1, 'INV-1500', ROBERT.id, OLD_PM.id, '2026-01-10T16:00:00.000Z'),
      sploseInvoice(2, 'INV-1990', ROBERT.id, NDSP_DUP.id, '2026-09-01T16:00:00.000Z'),
      sploseInvoice(3, 'INV-2006', ROBERT.id, NDSP.id, '2026-10-28T16:00:00.000Z'),
      sploseInvoice(4, 'INV-2001', SAM.id, MUM.id, '2026-10-20T16:00:00.000Z'),
      sploseInvoice(5, 'INV-2002', SAM.id, null, '2026-10-21T16:00:00.000Z'),          // no contact: not a payer record
      { ...sploseInvoice(6, 'INV-2003', SAM.id, OLD_PM.id, '2026-10-22T16:00:00.000Z'), isArchived: true }];

    const imp = await agent.post('/api/invoicing/payers/import-splose');
    expect(imp.status).toBe(200);
    expect(imp.body).toMatchObject({ invoices: 4, clients: 2, payers: 3, newPayers: 3, newInvoices: 4 });
    const again = await agent.post('/api/invoicing/payers/import-splose');
    expect(again.body).toMatchObject({ newPayers: 0, newInvoices: 0 });

    const { payers } = (await agent.get('/api/invoicing/payers')).body;
    const ndsp = payers.find(p => p.name_key === 'ndsp');
    expect(payers.filter(p => p.name_key === 'ndsp')).toHaveLength(1);
    expect(ndsp).toMatchObject({ payer_type: 'PLAN_MANAGER', email: 'invoices@ndsp.com.au', invoices: 2, source: 'SPLOSE_IMPORT' });
    expect(ndsp.splose_contact_ids.sort()).toEqual(['1529505', '344246']);
    expect(payers.find(p => p.name === 'Jo Self')).toMatchObject({ payer_type: 'NOMINEE' });

    // The client's history, newest first; the self-managed client is invoiced to the nominee.
    await agent.post(`/api/invoicing/clients/${ROBERT.id}/import-splose`);
    const rob = (await agent.get(`/api/invoicing/clients/${ROBERT.id}`)).body;
    expect(rob.payerHistory.map(h => [h.name, h.invoices, h.last_invoice_number])).toEqual([['NDSP', 2, 'INV-2006'], ['Old Plan Co', 1, 'INV-1500']]);
    expect(rob.payerHistory[0].last_issue_date.slice(0, 10)).toBe('2026-10-29');   // Splose's UTC midnight is 29 Oct in Perth
    const sam = (await agent.post(`/api/invoicing/clients/${SAM.id}/import-splose`)).body.profile;
    expect(sam).toMatchObject({ management_type: 'SELF_MANAGED', payer_type: 'NOMINEE', payer_name: 'Jo Self', payer_email: 'jo@self.test' });

    // Editing a payer is audited by field name and reaches every linked profile.
    const put = await agent.put(`/api/invoicing/payers/${ndsp.id}`).send({ email: 'accounts@ndsp.com.au' });
    expect(put.body).toMatchObject({ linkedProfilesUpdated: 1 });
    expect((await agent.get(`/api/invoicing/clients/${ROBERT.id}`)).body.profile.payer_email).toBe('accounts@ndsp.com.au');
    const { rows: [a] } = await db.pool.query(`SELECT * FROM billing_audit_events WHERE action = 'payer.updated'`);
    expect(a.after_state.fields).toEqual(['email']);
    // A re-import never overwrites what the owner changed.
    await agent.post('/api/invoicing/payers/import-splose');
    expect((await agent.get('/api/invoicing/payers')).body.payers.find(p => p.id === ndsp.id).email).toBe('accounts@ndsp.com.au');
  });

  test('with Splose switched off, a client is still invoiced to the payer their history remembers', async () => {
    const app = buildApp();
    const org = await seedOrganisation();
    const { agent } = await login(app, 'owner', org.id);
    const pr = await practitioner(org.id, 'Ann', [day(0)]);
    fake.patients = [ROBERT]; fake.contacts = [NDSP];
    fake.invoices = [sploseInvoice(3, 'INV-2006', ROBERT.id, NDSP.id, '2026-10-28T16:00:00.000Z')];
    await agent.post('/api/invoicing/payers/import-splose');
    // Profile knows the client but not the payer (e.g. typed in by hand before Splose was turned off).
    await agent.put(`/api/invoicing/clients/${ROBERT.id}`).send({ participantName: 'Robert Weaver', ndisNumber: '431876925',
      managementType: 'PLAN_MANAGED', serviceAddress: ROBERT.formattedAddress });
    fake.connected = false;
    await event(pr, { clientId: String(ROBERT.id), clientName: 'Robert Weaver', date: day(0) });
    await run(agent, day(0), day(0));
    const [inv] = await invoices(agent);
    expect(inv).toMatchObject({ payer_name: 'NDSP', status: 'DRAFT' });
    expect((await agent.get(`/api/invoicing/clients/${ROBERT.id}`)).body.profile).toMatchObject({ payer_source_detail: 'Splose invoice INV-2006' });
  });

  test('a new client with no invoices: the owner enters the payer once, it joins the directory, is reused, and finalised invoices extend the history', async () => {
    const app = buildApp();
    const org = await seedOrganisation();
    const { agent } = await login(app, 'owner', org.id);
    await agent.put('/api/invoicing/settings').send({ abn: '49699791958' });
    const pr = await practitioner(org.id, 'Ann', [day(0)]);
    fake.connected = false;
    await event(pr, { clientId: 'new-1', clientName: 'New Client', date: day(0) });
    await run(agent, day(0), day(0));
    expect(await openIssues(org.id, 'CLIENT_MISSING_PAYER')).toHaveLength(1);

    // Entered by hand: the payer is added to the directory and linked.
    const saved = await agent.put('/api/invoicing/clients/new-1').send({ participantName: 'New Client', ndisNumber: '431876940',
      managementType: 'PLAN_MANAGED', payerType: 'PLAN_MANAGER', payerName: 'Fresh Plan Co', payerEmail: 'inv@fresh.test',
      serviceAddress: '288 Orton Rd, Casuarina WA 6167' });
    expect(saved.status).toBe(200);
    const { payers } = (await agent.get('/api/invoicing/payers')).body;
    expect(payers).toHaveLength(1);
    expect(payers[0]).toMatchObject({ name: 'Fresh Plan Co', email: 'inv@fresh.test', source: 'OWNER', linked_clients: 1 });
    expect(saved.body.profile).toMatchObject({ payer_id: payers[0].id, payer_source: 'OWNER' });

    // A second client picks it from the directory instead of retyping it.
    const pick = await agent.put('/api/invoicing/clients/new-2').send({ participantName: 'Second New', payerId: payers[0].id });
    expect(pick.body.profile).toMatchObject({ payer_name: 'Fresh Plan Co', payer_email: 'inv@fresh.test', payer_type: 'PLAN_MANAGER', payer_id: payers[0].id });
    expect((await agent.put('/api/invoicing/clients/new-2').send({ payerId: '00000000-0000-0000-0000-000000000000' })).status).toBe(404);

    // The draft picks the payer up; finalising it records it in the history.
    await run(agent, day(0), day(0));
    const [inv] = await invoices(agent);
    expect(inv.payer_name).toBe('Fresh Plan Co');
    expect((await agent.post(`/api/invoicing/invoices/${inv.id}/finalise`)).status).toBe(200);
    const hist = (await agent.get('/api/invoicing/clients/new-1')).body.payerHistory;
    expect(hist).toEqual([expect.objectContaining({ name: 'Fresh Plan Co', invoices: 1, last_source: 'OPAL', last_invoice_number: inv.invoice_number })]);

    // Duplicates are refused; the directory needs manage_billing.
    expect((await agent.post('/api/invoicing/payers').send({ name: 'fresh plan co', payerType: 'PLAN_MANAGER' })).status).toBe(409);
    const { agent: therapist } = await login(app, 'therapist', org.id);
    expect((await therapist.get('/api/invoicing/payers')).status).toBe(403);
    expect((await therapist.post('/api/invoicing/payers').send({ name: 'X', payerType: 'OTHER' })).status).toBe(403);
  });
});
