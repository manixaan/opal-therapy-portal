'use strict';

/**
 * Invoicing module integration tests — real routes, real sessions, real SQL
 * (migration 063). Focus: owner-only RBAC on every route, client settings
 * roundtrip, calendar events → invoice, the one-live-claim-per-event guard,
 * batch grouping, status flow and void releasing the events.
 */

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { db, truncateAll, seedUser, seedOrganisation, closePool } = require('./helpers');

const PASSWORD = 'InvPass1';

function buildApp() {
  const app = express();
  app.use(bodyParser.json());
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../invoicing-routes'));
  return app;
}

async function agentFor(app, role, organisation_id) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser({ password_hash: hash, role, organisation_id });
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user };
}

async function seedTherapist(org, user, name = 'Paulita Xavier') {
  const { rows } = await db.pool.query(
    `INSERT INTO therapist_profiles (organisation_id, user_id, display_name) VALUES ($1,$2,$3) RETURNING *`,
    [org.id, user.id, name]
  );
  return rows[0];
}

async function seedEvent(user, tp, { start, minutes = 60, clientId = 'c1', clientName = 'Client One', status = 'confirmed', eventType = 'therapy' }) {
  const s = new Date(start); const e = new Date(s.getTime() + minutes * 60000);
  const { rows } = await db.pool.query(
    `INSERT INTO events (user_id, therapist_profile_id, organisation_id, title, start_time, end_time, event_type, status, client_id, client_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [user.id, tp.id, tp.organisation_id, 'OT session', s.toISOString(), e.toISOString(), eventType, status, clientId, clientName]
  );
  return rows[0];
}

const SETTINGS = { clientName: 'Client One', fundingType: 'plan_managed', ageBand: '9_plus', budget: 'capacity_building', mmm: 1,
  agreedHourlyRate: 193.99, perKmRate: 0.99, agreement: { telehealth: true, nonF2f: true, ndiaReports: true, cancellations: true, travel: true },
  invoiceToName: 'Plan Manager Pty Ltd' };

let app;
beforeAll(() => { app = buildApp(); });
beforeEach(async () => {
  await truncateAll();
  require('../../auth')._resetLoginRateLimit();
});
afterAll(closePool);

describe('RBAC — owner only', () => {
  const routes = [
    ['get', '/api/invoicing/week?start=2026-09-07'],
    ['get', '/api/invoicing/clients'],
    ['put', '/api/invoicing/clients/c1'],
    ['post', '/api/invoicing/preview'],
    ['post', '/api/invoicing/invoices'],
    ['post', '/api/invoicing/batch'],
    ['get', '/api/invoicing/invoices'],
    ['get', '/api/invoicing/rulebook'],
    ['post', '/api/invoicing/simulate'],
  ];
  test.each(['therapist', 'admin', 'read_only'])('%s is refused on every route', async (role) => {
    const { agent } = await agentFor(app, role);
    for (const [m, path] of routes) {
      const r = await agent[m](path).send({});
      expect([401, 403]).toContain(r.status);
    }
  });
  test('anonymous is refused', async () => {
    const r = await request(app).get('/api/invoicing/invoices');
    expect(r.status).toBe(401);
  });
});

describe('client settings', () => {
  test('roundtrip and validation', async () => {
    const org = await seedOrganisation();
    const { agent } = await agentFor(app, 'owner', org.id);
    const put = await agent.put('/api/invoicing/clients/c1').send(SETTINGS);
    expect(put.status).toBe(200);
    expect(put.body.settings.mmm).toBe(1);
    expect(put.body.settings.agreement.travel).toBe(true);
    const get = await agent.get('/api/invoicing/clients/c1');
    expect(get.body.settings.invoice_to_name).toBe('Plan Manager Pty Ltd');
    const bad = await agent.put('/api/invoicing/clients/c1').send({ ...SETTINGS, agreedHourlyRate: 99999 });
    expect(bad.status).toBe(400);
    const list = await agent.get('/api/invoicing/clients');
    expect(list.body.clients).toHaveLength(1);
  });
});

describe('week board → invoice', () => {
  test('events from an employee calendar are claimed, invoiced once, and released on void', async () => {
    const org = await seedOrganisation();
    const { agent, user: owner } = await agentFor(app, 'owner', org.id);
    const employee = await seedUser({ role: 'therapist', organisation_id: org.id });
    const tp = await seedTherapist(org, employee);
    await seedTherapist(org, owner, 'Owner');
    const ev1 = await seedEvent(employee, tp, { start: '2026-09-08T01:00:00Z', minutes: 60 });
    const ev2 = await seedEvent(employee, tp, { start: '2026-09-09T01:00:00Z', minutes: 45 });
    await agent.put('/api/invoicing/clients/c1').send(SETTINGS);

    const week = await agent.get('/api/invoicing/week?start=2026-09-07');
    expect(week.status).toBe(200);
    expect(week.body.events).toHaveLength(2);
    expect(week.body.claims.every(c => c.status === 'ready')).toBe(true);
    expect(week.body.therapists).toHaveLength(2);

    // Preview with pooled travel: 30 min / 20 km shared by the one session of the day.
    const prev = await agent.post('/api/invoicing/preview').send({
      eventIds: [ev1.id, ev2.id],
      days: [{ sessions: [{ eventId: ev1.id, legMinutes: 20, legKm: 15 }], returnMinutes: 20, returnKm: 15, returnPaid: true }],
    });
    expect(prev.status).toBe(200);
    const c1 = prev.body.claims.find(c => c.eventId === ev1.id);
    expect(c1.lines.map(l => l.kind)).toEqual(['direct', 'travel_labour', 'travel_non_labour']);
    expect(c1.total).toBe(193.99 + 48.50 + 29.70);

    const create = await agent.post('/api/invoicing/invoices').send({ clientId: 'c1', eventIds: [ev1.id, ev2.id], issueDate: '2026-09-14',
      days: [{ sessions: [{ eventId: ev1.id, legMinutes: 20, legKm: 15 }], returnMinutes: 20, returnKm: 15, returnPaid: true }] });
    expect(create.status).toBe(201);
    const inv = create.body.invoice;
    expect(inv.invoice_number).toBe('INV-000001');
    expect(inv.lines).toHaveLength(4);
    expect(Number(inv.total)).toBe(193.99 + 48.50 + 29.70 + 145.49);
    expect(inv.practitioner_name).toBe('Paulita Xavier');

    // Same events again → refused.
    const dup = await agent.post('/api/invoicing/invoices').send({ clientId: 'c1', eventIds: [ev1.id] });
    expect(dup.status).toBe(409);

    // The week board now shows the invoice number on the events.
    const week2 = await agent.get('/api/invoicing/week?start=2026-09-07');
    expect(week2.body.events.every(e => e.invoicedNumber === 'INV-000001')).toBe(true);

    // Status flow: draft → approved → sent → paid; paid cannot be voided.
    for (const s of ['approved', 'sent', 'paid']) {
      const r = await agent.post(`/api/invoicing/invoices/${inv.id}/status`).send({ status: s });
      expect(r.status).toBe(200);
    }
    const noVoid = await agent.post(`/api/invoicing/invoices/${inv.id}/status`).send({ status: 'void' });
    expect(noVoid.status).toBe(409);

    // A second invoice on new events can be voided, which frees the events.
    const ev3 = await seedEvent(employee, tp, { start: '2026-09-10T01:00:00Z' });
    const inv2 = await agent.post('/api/invoicing/invoices').send({ clientId: 'c1', eventIds: [ev3.id] });
    expect(inv2.body.invoice.invoice_number).toBe('INV-000002');
    const v = await agent.post(`/api/invoicing/invoices/${inv2.body.invoice.id}/status`).send({ status: 'void' });
    expect(v.body.invoice.status).toBe('void');
    const again = await agent.post('/api/invoicing/invoices').send({ clientId: 'c1', eventIds: [ev3.id] });
    expect(again.status).toBe(201);

    const audit = await db.pool.query(`SELECT action FROM audit_logs WHERE action LIKE 'invoicing.%' ORDER BY created_at`);
    expect(audit.rows.map(r => r.action)).toEqual(expect.arrayContaining(['invoicing.client_settings_saved', 'invoicing.invoice_created', 'invoicing.invoice_status']));
  });

  test('missing settings block; cancelled with notice is not claimable; other org is invisible', async () => {
    const org = await seedOrganisation();
    const other = await seedOrganisation('Other');
    const { agent, user: owner } = await agentFor(app, 'owner', org.id);
    const tp = await seedTherapist(org, owner);
    const ev = await seedEvent(owner, tp, { start: '2026-09-08T01:00:00Z', clientId: 'c9', clientName: 'No Settings' });
    const r = await agent.post('/api/invoicing/invoices').send({ clientId: 'c9', eventIds: [ev.id] });
    expect(r.status).toBe(422);
    expect(r.body.claims[0].warnings).toContain('client_billing_settings_missing');

    await agent.put('/api/invoicing/clients/c9').send({ ...SETTINGS, clientName: 'No Settings' });
    const cancelled = await seedEvent(owner, tp, { start: '2026-09-15T01:00:00Z', clientId: 'c9', status: 'cancelled' });
    const prev = await agent.post('/api/invoicing/preview').send({ eventIds: [cancelled.id], inputs: { [cancelled.id]: { cancelledAt: '2026-09-01T00:00:00Z' } } });
    expect(prev.body.claims[0].status).toBe('not_claimable');
    const short = await agent.post('/api/invoicing/preview').send({ eventIds: [cancelled.id], inputs: { [cancelled.id]: { cancelledAt: '2026-09-14T20:00:00Z' } } });
    expect(short.body.claims[0].lines[0].kind).toBe('cancellation');

    const otherOwner = await seedUser({ role: 'owner', organisation_id: other.id });
    const otp = await seedTherapist(other, otherOwner, 'Elsewhere');
    const foreign = await seedEvent(otherOwner, otp, { start: '2026-09-08T03:00:00Z', clientId: 'zz' });
    const week = await agent.get('/api/invoicing/week?start=2026-09-07');
    expect(week.body.events.some(e => e.id === foreign.id)).toBe(false);
    const steal = await agent.post('/api/invoicing/preview').send({ eventIds: [foreign.id] });
    expect(steal.body.claims).toHaveLength(0);
    expect(steal.body.missingEvents).toEqual([foreign.id]);
  });

  test('batch creates one invoice per client and skips what it cannot bill', async () => {
    const org = await seedOrganisation();
    const { agent, user: owner } = await agentFor(app, 'owner', org.id);
    const tp = await seedTherapist(org, owner);
    const a1 = await seedEvent(owner, tp, { start: '2026-09-08T01:00:00Z', clientId: 'A', clientName: 'Client A' });
    const a2 = await seedEvent(owner, tp, { start: '2026-09-10T01:00:00Z', clientId: 'A', clientName: 'Client A' });
    const b1 = await seedEvent(owner, tp, { start: '2026-09-08T03:00:00Z', clientId: 'B', clientName: 'Client B' });
    const c1 = await seedEvent(owner, tp, { start: '2026-09-08T05:00:00Z', clientId: 'C', clientName: 'Client C' });
    await agent.put('/api/invoicing/clients/A').send({ ...SETTINGS, clientName: 'Client A' });
    await agent.put('/api/invoicing/clients/B').send({ ...SETTINGS, clientName: 'Client B', agreedHourlyRate: 200 });

    const r = await agent.post('/api/invoicing/batch').send({
      eventIds: [a1.id, a2.id, b1.id, c1.id], issueDate: '2026-09-14',
      days: [{ sessions: [{ eventId: a1.id, legMinutes: 20, legKm: 15 }, { eventId: b1.id, legMinutes: 15, legKm: 10 }, { eventId: c1.id, legMinutes: 25, legKm: 20 }], returnMinutes: 30, returnKm: 25 }],
    });
    expect(r.status).toBe(201);
    expect(r.body.created).toHaveLength(2);
    const a = r.body.created.find(x => x.clientId === 'A');
    const b = r.body.created.find(x => x.clientId === 'B');
    expect(a.needsReview).toBe(false);
    expect(b.needsReview).toBe(true); // $200 is above the $193.99 limit
    expect(r.body.skipped).toEqual([expect.objectContaining({ clientId: 'C', reason: 'blocked' })]);
    const list = await agent.get('/api/invoicing/invoices');
    expect(list.body.invoices).toHaveLength(2);
    expect(list.body.invoices.every(i => i.batch_id === r.body.batchId)).toBe(true);
    // Pooled travel: 90 min / 3 = 30 min at $97 → $48.50 on each of the three day sessions (C's is skipped).
    const detail = await agent.get(`/api/invoicing/invoices/${a.id}`);
    const travel = detail.body.invoice.lines.find(l => l.kind === 'travel_labour');
    expect(Number(travel.amount)).toBe(48.5);
  });
});

describe('rule book and simulator', () => {
  test('rule book carries the OT price and a computed three-client example', async () => {
    const org = await seedOrganisation();
    const { agent } = await agentFor(app, 'owner', org.id);
    const r = await agent.get('/api/invoicing/rulebook');
    expect(r.status).toBe(200);
    expect(r.body.otPrices['FY2026-27'].national).toBe(193.99);
    const ex = r.body.examples.threeClientRun;
    expect(ex.plan.pooledMinutes).toBe(90);
    expect(ex.clients[0].claim.total).toBe(265.59);
    const sim = await agent.post('/api/invoicing/simulate').send({ mmm: 4, sessions: [{ minutes: 60, legMinutes: 70, legKm: 60 }], returnMinutes: 0 });
    expect(sim.body.clients[0].claim.lines[1].minutes).toBe(60); // MMM4 cap
  });
});
