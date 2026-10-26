'use strict';

/**
 * Sync settings + "Sync now" (migration 081). Real *_test database; Outlook
 * and Splose are mocked — nothing reaches either service, and no appointment
 * is ever written to Splose here (a Splose "create" is only QUEUED).
 *
 * Pins:
 *   - migration 081: table, scope check, one practice row per direction
 *   - GET defaults; PUT own within the Owner's limits; practice is Owner-only;
 *     read-only refused; a therapist cannot touch another calendar
 *   - booking: portal → Outlook manual-only or before the date → held, no Graph call;
 *     portal → Splose off → nothing queued
 *   - Sync now portal → Outlook: an Outlook event already at that time is LINKED,
 *     never duplicated; create writes once; forged keys are refused
 *   - Sync now Outlook → portal: links a hand-entered portal booking, imports the rest once
 *   - Sync now Splose → portal / portal → Splose: link instead of copy; create queues only
 *   - every save and apply is audited without titles or client names
 *   - the Splose watcher drops / auto-imports per the settings
 */

jest.mock('../../outlook-oauth', () => ({
  MICROSOFT_OAUTH_CONFIG: { scopes: ['Calendars.ReadWrite'] },
  getAuthorizationUrl: jest.fn(),
  getAccessToken: jest.fn(),
  getMicrosoftUser: jest.fn(),
  refreshAccessToken: jest.fn(),
  getOutlookCalendarEvents: jest.fn(async () => []),
  getOutlookCalendarDelta: jest.fn(async () => ({ changed: [], deleted: [], deltaToken: 't' })),
  createOutlookEvent: jest.fn(async () => ({ outlookId: 'OL-' + Math.random().toString(36).slice(2, 8) })),
  updateOutlookEvent: jest.fn(async () => ({})),
  deleteOutlookEvent: jest.fn(async () => ({})),
  subscribeToCalendarChanges: jest.fn(),
}));

let mockDiary = [];
const mockSplose = {
  isConfigured: () => true,
  createAppointment: jest.fn(async () => { throw new Error('no Splose writes in this test'); }),
  updateAppointment: jest.fn(async () => { throw new Error('no Splose writes in this test'); }),
  cancelAppointment: jest.fn(async () => { throw new Error('no Splose writes in this test'); }),
  getServices: jest.fn(async () => [{ id: 125320, title: 'Therapy Session' }]),
  getPatients: jest.fn(async () => [{ id: 41, fullName: 'Jane Doe' }]),
  getAppointments: jest.fn(async () => mockDiary),
  getAppointment: jest.fn(async (id) => mockDiary.find(x => String(x.id) === String(id)) || null),
};
jest.mock('../../splose-api', () => mockSplose);

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const outlook = require('../../outlook-oauth');

const { db, truncateAll, seedUser, closePool } = require('./helpers');

const PASSWORD = 'SyncSettingsPass1';
// Two weeks ahead, 9:00 Perth — always inside the default plan window.
const DAY = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
const START = `${DAY}T01:00:00.000Z`;
const END = `${DAY}T02:00:00.000Z`;
const later = (h) => `${DAY}T${String(h).padStart(2, '0')}:00:00.000Z`;

beforeEach(async () => {
  await truncateAll();
  jest.clearAllMocks();
  mockDiary = [];
  require('../../auth')._resetLoginRateLimit();
  require('../../splose-sync-routes')._resetPublisher();
  require('../../sync-settings-routes')._resetBackfill();
  process.env.ENABLE_SPLOSE_DRAFT_SYNC = 'true';
  process.env.ENABLE_SPLOSE_WRITE = 'false';
  process.env.ENABLE_OUTLOOK_WRITE = 'true';
  process.env.ENABLE_SPLOSE_AUTO_SYNC = 'false';
});
afterAll(async () => { require('../../auth')._resetLoginRateLimit(); await closePool(); });

function buildApp() {
  const app = express();
  app.use(bodyParser.json());
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../routes'));
  app.use('/', require('../../splose-sync-routes'));
  app.use('/', require('../../sync-settings-routes'));
  return app;
}

async function agentFor(app, overrides = {}, practitioner = '88167') {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser({ password_hash: hash, ...overrides });
  await db.pool.query(
    `UPDATE users SET access_token = 'tok', refresh_token = 'ref', token_expires_at = NOW() + interval '1 hour' WHERE id = $1`, [user.id]);
  await db.pool.query(
    `INSERT INTO therapist_profiles (user_id, display_name, splose_practitioner_id) VALUES ($1, 'Test Therapist', $2)`, [user.id, practitioner]);
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user };
}

async function book(agent, extra = {}) {
  const res = await agent.post('/api/outlook/events').send({
    title: 'Client Appointment — Jane D', startTime: START, endTime: END, categories: ['Client Appointments'],
    splose: { patientId: 41, patientName: 'Jane Doe', sessionType: 'therapy', serviceId: 125320 }, ...extra,
  });
  expect(res.status).toBe(201);
  return res.body;
}

const appt = (id, start, extra = {}) => ({
  id, start, end: new Date(new Date(start).getTime() + 3600000).toISOString(),
  practitionerId: 88167, serviceId: 125320, patients: [{ patientId: 41, status: 'Booked' }],
  createdAt: new Date().toISOString(), ...extra,
});

describe('migration 081', () => {
  test('table, scope check and one practice row per direction', async () => {
    const cols = await db.pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'sync_settings'`);
    expect(cols.rows.map(r => r.column_name)).toEqual(expect.arrayContaining(
      ['scope', 'user_id', 'direction', 'enabled', 'sync_from', 'auto', 'allowed', 'allow_auto', 'earliest_from']));
    await expect(db.pool.query(
      `INSERT INTO sync_settings (scope, user_id, direction) VALUES ('user', NULL, 'portal_to_outlook')`)).rejects.toThrow();
    await expect(db.pool.query(
      `INSERT INTO sync_settings (scope, direction) VALUES ('practice', 'sideways')`)).rejects.toThrow();
    await db.pool.query(`INSERT INTO sync_settings (scope, direction, allowed) VALUES ('practice', 'portal_to_outlook', true)`);
    await expect(db.pool.query(
      `INSERT INTO sync_settings (scope, direction, allowed) VALUES ('practice', 'portal_to_outlook', false)`)).rejects.toThrow();
  });
});

describe('settings routes', () => {
  test('GET defaults; PUT own; Owner limits refuse; practice is Owner-only; audited', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app);
    const g = await agent.get('/api/sync-settings');
    expect(g.status).toBe(200);
    expect(g.body.effective.portal_to_outlook).toMatchObject({ enabled: true, auto: true, runs: true });
    expect(g.body.isOwner).toBe(false);

    const put = await agent.put('/api/sync-settings').send({ directions: { outlook_to_portal: { syncFrom: '2026-11-01', auto: false } } });
    expect(put.status).toBe(200);
    expect(put.body.effective.outlook_to_portal).toMatchObject({ syncFrom: '2026-11-01', auto: false, runsAutomatically: false });

    expect((await agent.put('/api/sync-settings/practice').send({ directions: { portal_to_outlook: { allowed: false } } })).status).toBe(403);

    const owner = await agentFor(app, { role: 'owner' }, '19521');
    const lim = await owner.agent.put('/api/sync-settings/practice').send({ directions: { portal_to_outlook: { allowed: false }, splose_to_portal: { earliestFrom: '2026-10-01' } } });
    expect(lim.status).toBe(200);

    const refused = await agent.put('/api/sync-settings').send({ directions: { portal_to_outlook: { enabled: true } } });
    expect(refused.status).toBe(400);
    const early = await agent.put('/api/sync-settings').send({ directions: { splose_to_portal: { syncFrom: '2026-01-01' } } });
    expect(early.status).toBe(400);
    expect((await agent.get('/api/sync-settings')).body.effective.portal_to_outlook.enabled).toBe(false);

    const audits = await db.pool.query(`SELECT action, metadata FROM audit_logs WHERE action LIKE 'sync_settings.%' ORDER BY created_at`);
    expect(audits.rows.map(r => r.action)).toEqual(['sync_settings.user_updated', 'sync_settings.practice_updated']);
    expect(JSON.stringify(audits.rows)).not.toMatch(/Jane|Client Appointment/);
    expect(audits.rows[0].metadata.forUser).toBe(user.id);
  });

  test('read-only refused; a therapist cannot read another calendar; an Owner can', async () => {
    const app = buildApp();
    const ro = await agentFor(app, { role: 'read_only' });
    expect((await ro.agent.get('/api/sync-settings')).status).toBe(403);
    const t1 = await agentFor(app);
    const t2 = await agentFor(app, {}, '82913');
    expect((await t1.agent.get('/api/sync-settings').query({ userId: t2.user.id })).status).toBe(403);
    expect((await t1.agent.post('/api/sync-settings/portal_to_outlook/plan').query({ userId: t2.user.id })).status).toBe(403);
    const owner = await agentFor(app, { role: 'owner' }, '19521');
    const g = await owner.agent.get('/api/sync-settings').query({ userId: t2.user.id });
    expect(g.status).toBe(200);
    expect(g.body.userId).toBe(t2.user.id);
  });
});

describe('the everyday sync honours the settings', () => {
  test('portal → Outlook manual-only: the booking is held, Graph is not called', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app);
    await agent.put('/api/sync-settings').send({ directions: { portal_to_outlook: { auto: false } } });
    const b = await book(agent);
    expect(b.outlookStatus).toBe('held');
    expect(outlook.createOutlookEvent).not.toHaveBeenCalled();
  });

  test('portal → Outlook before the sync-from date: held; on or after: written', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app);
    const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    await agent.put('/api/sync-settings').send({ directions: { portal_to_outlook: { syncFrom: future } } });
    expect((await book(agent)).outlookStatus).toBe('held');
    await agent.put('/api/sync-settings').send({ directions: { portal_to_outlook: { syncFrom: null } } });
    expect((await book(agent, { startTime: later(3), endTime: later(4) })).outlookStatus).toBe('synced');
    expect(outlook.createOutlookEvent).toHaveBeenCalledTimes(1);
  });

  test('portal → Splose off: nothing is queued', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app);
    await agent.put('/api/sync-settings').send({ directions: { portal_to_splose: { enabled: false } } });
    const b = await book(agent);
    expect(b.sploseQueued).toBeNull();
    const q = await db.pool.query(`SELECT COUNT(*)::int AS n FROM splose_sync_queue`);
    expect(q.rows[0].n).toBe(0);
  });
});

describe('Sync now — no duplicates', () => {
  test('portal → Outlook: links the Outlook event at the same time, creates the other once, refuses forged keys', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app);
    await agent.put('/api/sync-settings').send({ directions: { portal_to_outlook: { auto: false } } });
    const a = await book(agent);
    const b = await book(agent, { startTime: later(3), endTime: later(4) });
    outlook.getOutlookCalendarEvents.mockResolvedValue([
      { outlookId: 'OL-EXISTING', title: 'Jane (typed in Outlook)', startTime: START, endTime: END, type: 'singleInstance' },
    ]);

    const plan = await agent.post('/api/sync-settings/portal_to_outlook/plan');
    expect(plan.status).toBe(200);
    const by = Object.fromEntries(plan.body.items.map(i => [i.key, i.action]));
    expect(by['local:' + a.dbId]).toBe('link');
    expect(by['local:' + b.dbId]).toBe('create');
    expect(outlook.createOutlookEvent).not.toHaveBeenCalled(); // planning writes nothing

    const apply = await agent.post('/api/sync-settings/portal_to_outlook/apply').send({
      decisions: [...plan.body.defaults, { key: 'local:not-a-real-id', action: 'create' }],
    });
    expect(apply.status).toBe(200);
    expect(apply.body.done).toHaveLength(2);
    expect(apply.body.failed).toEqual([{ key: 'local:not-a-real-id', code: 'no_longer_offered' }]);
    expect(outlook.createOutlookEvent).toHaveBeenCalledTimes(1);

    const rows = await db.pool.query(`SELECT id, outlook_id FROM events WHERE user_id = $1 AND is_deleted IS NOT TRUE ORDER BY start_time`, [user.id]);
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0].outlook_id).toBe('OL-EXISTING');
    expect(rows.rows[1].outlook_id).toMatch(/^OL-/);

    // A second Sync now finds nothing left to do.
    outlook.getOutlookCalendarEvents.mockResolvedValue([
      { outlookId: 'OL-EXISTING', startTime: START, endTime: END },
      { outlookId: rows.rows[1].outlook_id, startTime: later(3), endTime: later(4) },
    ]);
    expect((await agent.post('/api/sync-settings/portal_to_outlook/plan')).body.items).toEqual([]);

    const audit = await db.pool.query(`SELECT metadata FROM audit_logs WHERE action = 'sync_settings.applied'`);
    expect(audit.rows[0].metadata).toMatchObject({ direction: 'portal_to_outlook', done: { link: 1, create: 1 }, failed: 1 });
  });

  test('Outlook → portal: a hand-entered portal booking is linked, not duplicated; the rest is imported once', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app);
    process.env.ENABLE_OUTLOOK_WRITE = 'false'; // hand entry: nothing goes to Outlook
    const a = await book(agent);
    outlook.getOutlookCalendarEvents.mockResolvedValue([
      { outlookId: 'OL-SAME', title: 'Jane', startTime: START, endTime: END, categories: [], type: 'singleInstance' },
      { outlookId: 'OL-MEETING', title: 'Team meeting', startTime: later(5), endTime: later(6), categories: [], type: 'singleInstance' },
    ]);
    const plan = await agent.post('/api/sync-settings/outlook_to_portal/plan');
    expect(plan.status).toBe(200);
    expect(plan.body.counts).toEqual({ link: 1, create: 1 });
    const apply = await agent.post('/api/sync-settings/outlook_to_portal/apply').send({ decisions: plan.body.defaults });
    expect(apply.body.done).toHaveLength(2);
    const rows = await db.pool.query(
      `SELECT id, outlook_id FROM events WHERE user_id = $1 AND is_deleted IS NOT TRUE ORDER BY start_time`, [user.id]);
    expect(rows.rows).toEqual([{ id: a.dbId, outlook_id: 'OL-SAME' }, { id: expect.any(String), outlook_id: 'OL-MEETING' }]);
    expect((await agent.post('/api/sync-settings/outlook_to_portal/plan')).body.items).toEqual([]);
  });

  test('Splose → portal: links the matching portal booking; imports the other; never writes Splose', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app);
    await agent.put('/api/sync-settings').send({ directions: { portal_to_splose: { enabled: false } } });
    const a = await book(agent);
    mockDiary = [appt(5001, START), appt(5002, later(5)), appt(5003, later(7), { practitionerId: 19521 })];
    const plan = await agent.post('/api/sync-settings/splose_to_portal/plan');
    expect(plan.status).toBe(200);
    expect(plan.body.items.map(i => [i.key, i.action])).toEqual([['remote:5001', 'link'], ['remote:5002', 'create']]);
    const apply = await agent.post('/api/sync-settings/splose_to_portal/apply').send({ decisions: plan.body.defaults });
    expect(apply.body.done).toHaveLength(2);
    const rows = await db.pool.query(
      `SELECT id, splose_id, source FROM events WHERE user_id = $1 AND is_deleted IS NOT TRUE ORDER BY start_time`, [user.id]);
    expect(rows.rows).toEqual([
      { id: a.dbId, splose_id: '5001', source: 'app' },
      { id: expect.any(String), splose_id: '5002', source: 'splose' },
    ]);
    expect(mockSplose.createAppointment).not.toHaveBeenCalled();
  });

  test('portal → Splose: link adopts the Splose id; create only queues', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app);
    await agent.put('/api/sync-settings').send({ directions: { portal_to_splose: { enabled: false } } });
    const a = await book(agent);
    const b = await book(agent, { startTime: later(3), endTime: later(4) });
    await agent.put('/api/sync-settings').send({ directions: { portal_to_splose: { enabled: true } } });
    mockDiary = [appt(6001, START)];
    const plan = await agent.post('/api/sync-settings/portal_to_splose/plan');
    expect(plan.status).toBe(200);
    const by = Object.fromEntries(plan.body.items.map(i => [i.key, i.action]));
    expect(by).toEqual({ ['local:' + a.dbId]: 'link', ['local:' + b.dbId]: 'create' });
    const apply = await agent.post('/api/sync-settings/portal_to_splose/apply').send({ decisions: plan.body.defaults });
    expect(apply.body.done).toHaveLength(2);
    const ev = await db.pool.query(`SELECT id, splose_id FROM events WHERE id = $1`, [a.dbId]);
    expect(ev.rows[0].splose_id).toBe('6001');
    const q = await db.pool.query(`SELECT event_id, action, status FROM splose_sync_queue WHERE user_id = $1`, [user.id]);
    expect(q.rows).toEqual([{ event_id: b.dbId, action: 'create', status: 'pending' }]);
    expect(mockSplose.createAppointment).not.toHaveBeenCalled();
  });

  test('a switched-off direction cannot be planned or applied', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app);
    await agent.put('/api/sync-settings').send({ directions: { splose_to_portal: { enabled: false } } });
    expect((await agent.post('/api/sync-settings/splose_to_portal/plan')).status).toBe(409);
    expect((await agent.post('/api/sync-settings/splose_to_portal/apply').send({ decisions: [{ key: 'remote:1', action: 'create' }] })).status).toBe(409);
    expect((await agent.post('/api/sync-settings/sideways/plan')).status).toBe(400);
  });
});

describe('the Splose watcher honours the settings', () => {
  async function runWatcher() {
    const syncPrefs = require('../../sync-preferences');
    const { createWatcher } = require('../../splose-draft-sync');
    const w = createWatcher({
      db, sploseApi: mockSplose,
      decideAlert: async (a, userId) => (userId ? syncPrefs.alertDecision(await syncPrefs.effectiveOrNull(db, userId), a) : 'keep'),
      autoApply: (a, userId) => require('../../sync-settings-routes')._backfill().autoImport(userId, a.sploseAppointmentId),
    });
    return w.run();
  }

  test('off → not recorded; automatic → brought in once and closed; default → asked', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app);
    const soon = new Date(Date.now() + 2 * 86400000).toISOString();
    mockDiary = [appt(7001, soon)];

    await agent.put('/api/sync-settings').send({ directions: { splose_to_portal: { enabled: false } } });
    await runWatcher();
    expect((await db.pool.query(`SELECT COUNT(*)::int AS n FROM splose_change_alerts`)).rows[0].n).toBe(0);

    await agent.put('/api/sync-settings').send({ directions: { splose_to_portal: { enabled: true, auto: true } } });
    await runWatcher();
    const alerts = await db.pool.query(`SELECT kind, acknowledged_at, verdict FROM splose_change_alerts`);
    expect(alerts.rows).toEqual([{ kind: 'created', acknowledged_at: expect.any(Date), verdict: 'valid' }]);
    const ev = await db.pool.query(`SELECT splose_id FROM events WHERE user_id = $1 AND is_deleted IS NOT TRUE`, [user.id]);
    expect(ev.rows).toEqual([{ splose_id: '7001' }]);
    await runWatcher(); // the appointment is now held — not imported twice
    expect((await db.pool.query(`SELECT COUNT(*)::int AS n FROM events WHERE splose_id = '7001'`)).rows[0].n).toBe(1);

    mockDiary.push(appt(7002, new Date(Date.now() + 3 * 86400000).toISOString()));
    await agent.put('/api/sync-settings').send({ directions: { splose_to_portal: { auto: false } } });
    await runWatcher();
    const open = await db.pool.query(`SELECT splose_appointment_id FROM splose_change_alerts WHERE acknowledged_at IS NULL`);
    expect(open.rows).toEqual([{ splose_appointment_id: '7002' }]);
  });
});
