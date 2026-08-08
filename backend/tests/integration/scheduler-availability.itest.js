'use strict';

/**
 * MASTER SCHEDULER PHASE 2 — availability endpoints (integration).
 *
 * Verifies: RBAC (owner/admin allowed, therapist/read_only fail closed),
 * correct event inclusion (cancelled/deleted excluded, private Outlook busy
 * without content), leave application, working-hours source metadata,
 * common-availability intersection, and organisation scoping.
 */

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { db, truncateAll, seedUser, closePool } = require('./helpers');

const PASSWORD = 'AvailPass1';
const DATE = '2026-08-10'; // a Monday

function buildApp() {
  const app = express();
  app.use(bodyParser.json());
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../scheduler-routes'));
  return app;
}

async function orgId() {
  const { rows } = await db.pool.query(
    "INSERT INTO organisations (name) VALUES ('Availability Org') RETURNING id");
  return rows[0].id;
}

async function agentFor(app, role, org) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser({ password_hash: hash, role });
  if (org) {
    await db.pool.query('UPDATE users SET organisation_id = $1 WHERE id = $2', [org, user.id]);
    user.organisation_id = org;
  }
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user };
}

async function seedTherapist(org, name, opts = {}) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const u = await seedUser({ password_hash: hash, role: 'therapist' });
  await db.pool.query(
    'UPDATE users SET organisation_id = $1, work_location_schedule = $2 WHERE id = $3',
    [org, opts.schedule ? JSON.stringify(opts.schedule) : null, u.id]);
  const p = await db.pool.query(
    `INSERT INTO therapist_profiles (organisation_id, user_id, display_name, colour, is_active)
     VALUES ($1, $2, $3, '#0f7c6c', TRUE) RETURNING id`, [org, u.id, name]);
  return { userId: u.id, profileId: p.rows[0].id };
}

// Perth wall-clock → UTC ISO for the fixed date
const perthIso = (hh, mm = 0, date = DATE) =>
  new Date(Date.parse(`${date}T00:00:00Z`) - 8 * 3600e3 + (hh * 60 + mm) * 60e3).toISOString();

async function seedEvent(profileId, userId, orgId, hh, hhEnd, over = {}) {
  await db.pool.query(
    `INSERT INTO events (id, user_id, title, start_time, end_time, event_type, status,
                         source, therapist_profile_id, organisation_id, is_deleted)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'manual', $7, $8, $9)`,
    [userId, over.title !== undefined ? over.title : 'Availability test event',
     perthIso(hh), perthIso(hhEnd), over.type || 'therapy', over.status || 'confirmed',
     profileId, orgId, over.deleted || false]);
}

beforeEach(async () => {
  await truncateAll();
  require('../../auth')._resetLoginRateLimit();
});
afterAll(closePool);

// ═══ RBAC — fail closed ══════════════════════════════════════════════════════

describe('availability RBAC', () => {
  test('therapist and read_only are denied org-wide availability', async () => {
    const app = buildApp();
    for (const role of ['therapist', 'read_only']) {
      const { agent } = await agentFor(app, role, await orgId());
      const r = await agent.get(`/api/scheduler/availability?date=${DATE}`);
      expect([401, 403]).toContain(r.status);
      const c = await agent.post('/api/scheduler/common-availability')
        .send({ date: DATE, therapistIds: ['a', 'b'] });
      expect([401, 403]).toContain(c.status);
    }
  });

  test('owner and admin can compute org availability', async () => {
    const app = buildApp();
    for (const role of ['owner', 'admin']) {
      const { agent } = await agentFor(app, role, await orgId());
      const r = await agent.get(`/api/scheduler/availability?date=${DATE}`);
      expect(r.status).toBe(200);
      expect(r.body.date).toBe(DATE);
      expect(Array.isArray(r.body.therapists)).toBe(true);
    }
  });

  test('organisation scoping: another org\'s therapists are invisible', async () => {
    const app = buildApp();
    const org = await orgId();
    const { agent, user } = await agentFor(app, 'owner', org);
    const otherOrg = await db.pool.query(
      `INSERT INTO organisations (name) VALUES ('Other Org') RETURNING id`);
    await seedTherapist(otherOrg.rows[0].id, 'Foreign Therapist');
    const mine = await seedTherapist(org, 'Local Therapist');
    const r = await agent.get(`/api/scheduler/availability?date=${DATE}`);
    expect(r.status).toBe(200);
    const ids = r.body.therapists.map((t) => t.therapistProfileId);
    expect(ids).toContain(mine.profileId);
    expect(r.body.therapists.some((t) => t.displayName === 'Foreign Therapist')).toBe(false);
  });
});

// ═══ Availability semantics through the API ══════════════════════════════════

describe('availability computation', () => {
  test('busy events subtract; cancelled/deleted do not; private busy leaks no content', async () => {
    const app = buildApp();
    const org = await orgId();
    const { agent, user } = await agentFor(app, 'owner', org);
    const t = await seedTherapist(org, 'Semantics Therapist', {
      schedule: { '2026-W33': { mon: 'office', tue: 'office', wed: 'office', thu: 'office', fri: 'office' } },
    });
    await seedEvent(t.profileId, t.userId, org, 9, 10);                                  // busy
    await seedEvent(t.profileId, t.userId, org, 10, 11, { status: 'cancelled' });        // ignored
    await seedEvent(t.profileId, t.userId, org, 11, 12, { deleted: true });              // ignored
    await seedEvent(t.profileId, t.userId, org, 14, 15,
      { type: 'outlook', title: 'PRIVATE — psychiatrist appointment' });                                  // busy, content private

    const r = await agent.get(`/api/scheduler/availability?date=${DATE}`);
    expect(r.status).toBe(200);
    const me = r.body.therapists.find((x) => x.therapistProfileId === t.profileId);
    expect(me.working).toBe(true);
    expect(me.availabilityConfidence).toBe('configured');
    expect(me.workingHoursSource).toBe('organisation_default');

    const seg = (min) => me.segments.find((s) => s.startMin <= min && s.endMin > min);
    expect(seg(9 * 60 + 30).type).toBe('busy');       // 9–10 busy
    expect(seg(10 * 60 + 30).type).toBe('available'); // cancelled 10–11 does not block
    expect(seg(11 * 60 + 30).type).toBe('available'); // deleted 11–12 does not block
    expect(seg(14 * 60 + 30).type).toBe('busy');      // private outlook blocks

    // No event content anywhere in the payload
    const raw = JSON.stringify(r.body);
    expect(raw).not.toContain('PRIVATE');
    expect(raw).not.toContain('psychiatrist');
    expect(raw).not.toContain('Availability test event');
  });

  test('approved leave overrides the day; unknown schedule reports default confidence', async () => {
    const app = buildApp();
    const org = await orgId();
    const { agent, user } = await agentFor(app, 'owner', org);
    const onLeave = await seedTherapist(org, 'Leave Therapist', {
      schedule: { '2026-W33': { mon: 'office' } },
    });
    await db.pool.query(
      `INSERT INTO leave_requests (user_id, organisation_id, leave_type, start_date, end_date, status)
       VALUES ($1, $2, 'annual', $3, $3, 'approved')`, [onLeave.userId, org, DATE]);
    const noSchedule = await seedTherapist(org, 'Default Hours Therapist');

    const r = await agent.get(`/api/scheduler/availability?date=${DATE}`);
    const leaveT = r.body.therapists.find((x) => x.therapistProfileId === onLeave.profileId);
    const defT = r.body.therapists.find((x) => x.therapistProfileId === noSchedule.profileId);

    expect(leaveT.working).toBe(false);
    expect(leaveT.segments.some((s) => s.type === 'leave' || s.type === 'not_working')).toBe(true);
    expect(leaveT.capacity.availableMin).toBe(0);

    expect(defT.availabilityConfidence).toBe('default');   // assumed Mon-Fri, flagged honestly
    expect(defT.working).toBe(true);                       // Monday under the assumption
  });
});

// ═══ Common availability ═════════════════════════════════════════════════════

describe('common availability', () => {
  test('intersects true availability across therapists with minimum duration', async () => {
    const app = buildApp();
    const org = await orgId();
    const { agent, user } = await agentFor(app, 'owner', org);
    const week = { '2026-W33': { mon: 'office' } };
    const a = await seedTherapist(org, 'Ann X', { schedule: week });
    const b = await seedTherapist(org, 'Sarah X', { schedule: week });

    // Org default window 08:00–17:00.
    // Ann busy 8-10 and 12-17  → free 10:00–12:00
    await seedEvent(a.profileId, a.userId, org, 8, 10);
    await seedEvent(a.profileId, a.userId, org, 12, 17);
    // Sarah busy 8-10:30 and 14-17 → free 10:30–14:00
    await seedEvent(b.profileId, b.userId, org, 8, 10.5);
    await seedEvent(b.profileId, b.userId, org, 14, 17);

    const r = await agent.post('/api/scheduler/common-availability')
      .send({ date: DATE, therapistIds: [a.profileId, b.profileId], minDurationMin: 30 });
    expect(r.status).toBe(200);
    expect(r.body.slots).toEqual([
      { startMin: 10.5 * 60, endMin: 12 * 60, durationMin: 90 },
    ]);

    // Raise the bar beyond the window → no slots
    const r2 = await agent.post('/api/scheduler/common-availability')
      .send({ date: DATE, therapistIds: [a.profileId, b.profileId], minDurationMin: 120 });
    expect(r2.body.slots).toEqual([]);
  });

  test('requires at least two known therapists', async () => {
    const app = buildApp();
    const org = await orgId();
    const { agent, user } = await agentFor(app, 'owner', org);
    const a = await seedTherapist(org, 'Solo X');
    const r = await agent.post('/api/scheduler/common-availability')
      .send({ date: DATE, therapistIds: [a.profileId] });
    expect(r.status).toBe(400);
  });
});

// ═══ Phase 3: find-availability ══════════════════════════════════════════════

describe('find-availability', () => {
  test('therapist role is denied; owner searches in one aggregated request', async () => {
    const app = buildApp();
    const { agent: tAgent } = await agentFor(app, 'therapist', await orgId());
    expect([401, 403]).toContain((await tAgent.post('/api/scheduler/find-availability')
      .send({ date: DATE, startMin: 600, durationMin: 60 })).status);
  });

  test('exact-time search: fits, too-short, busy-until, discipline + id filters, privacy', async () => {
    const app = buildApp();
    const org = await orgId();
    const { agent } = await agentFor(app, 'owner', org);
    const week = { '2026-W33': { mon: 'office' } };

    const free = await seedTherapist(org, 'Free OT', { schedule: week });
    await db.pool.query('UPDATE therapist_profiles SET role_title = $1 WHERE id = $2',
      ['Occupational Therapist', free.profileId]);

    const busy = await seedTherapist(org, 'Busy OT', { schedule: week });
    await db.pool.query('UPDATE therapist_profiles SET role_title = $1 WHERE id = $2',
      ['Occupational Therapist', busy.profileId]);
    await seedEvent(busy.profileId, busy.userId, org, 9, 11.5,
      { type: 'outlook', title: 'SECRET dentist appointment' }); // private busy across request

    const speechie = await seedTherapist(org, 'Speech Person', { schedule: week });
    await db.pool.query('UPDATE therapist_profiles SET role_title = $1 WHERE id = $2',
      ['Speech Pathologist', speechie.profileId]);

    // 10:00–11:00 request
    const r = await agent.post('/api/scheduler/find-availability')
      .send({ date: DATE, startMin: 600, durationMin: 60, discipline: 'occupational therapist' });
    expect(r.status).toBe(200);
    const names = r.body.available.map((c) => c.displayName);
    expect(names).toContain('Free OT');
    expect(names).not.toContain('Speech Person'); // discipline filter
    const busyRow = r.body.unavailable.find((u) => u.displayName === 'Busy OT');
    expect(busyRow.reason).toBe('busy');
    expect(busyRow.busyUntilMin).toBe(11.5 * 60); // busy until 11:30
    expect(JSON.stringify(r.body)).not.toContain('SECRET'); // no private content

    // available window metadata is present and factual
    const freeRow = r.body.available.find((c) => c.displayName === 'Free OT');
    expect(freeRow.window.startMin).toBeLessThanOrEqual(600);
    expect(freeRow.window.endMin).toBeGreaterThanOrEqual(660);
    expect(freeRow.workingHoursSource).toBe('organisation_default');

    // therapistIds filter narrows the set
    const r2 = await agent.post('/api/scheduler/find-availability')
      .send({ date: DATE, startMin: 600, durationMin: 60, therapistIds: [busy.profileId] });
    expect(r2.body.counts.available).toBe(0);
    expect(r2.body.counts.unavailable).toBe(1);
    expect(r2.body.suggestions.length).toBeGreaterThan(0); // nearest alternative offered
  });

  test('range mode returns windows, not permutations', async () => {
    const app = buildApp();
    const org = await orgId();
    const { agent } = await agentFor(app, 'owner', org);
    const t = await seedTherapist(org, 'Range OT', { schedule: { '2026-W33': { mon: 'office' } } });
    await seedEvent(t.profileId, t.userId, org, 10, 11); // free 8-10 and 11-17 within org hours

    const r = await agent.post('/api/scheduler/find-availability')
      .send({ date: DATE, mode: 'range', rangeStartMin: 9 * 60, rangeEndMin: 13 * 60, durationMin: 60 });
    expect(r.status).toBe(200);
    const row = r.body.available.find((c) => c.displayName === 'Range OT');
    expect(row.windows).toEqual([
      { startMin: 9 * 60, endMin: 10 * 60, durationMin: 60 },
      { startMin: 11 * 60, endMin: 13 * 60, durationMin: 120 },
    ]);
  });
});
