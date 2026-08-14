'use strict';

/**
 * EVENT DELETE → TRAVEL-BLOCK CASCADE (2026-08-09) — integration tests.
 *
 * Real SQL against the isolated *_test database (migration 016 applied by
 * globalSetup). Pins:
 *   - migration 016: events.related_event_id exists and links travel blocks
 *   - ?dryRun=1 previews the cascade accurately and deletes NOTHING
 *   - DELETE cascades: linked blocks + safe-adjacent legacy blocks tombstoned
 *   - a sandwiched block, unrelated travel, other appointments and other
 *     users' rows all survive
 *   - the delete is audited with the cascade size
 *
 * The Microsoft side is mocked — no network, no real Graph deletes.
 */

jest.mock('../../outlook-oauth', () => ({
  MICROSOFT_OAUTH_CONFIG: { scopes: ['Calendars.ReadWrite'] },
  getAuthorizationUrl: jest.fn(),
  getAccessToken: jest.fn(),
  getMicrosoftUser: jest.fn(),
  refreshAccessToken: jest.fn(),
  getOutlookCalendarEvents: jest.fn(async () => []),
  getOutlookCalendarDelta: jest.fn(async () => ({ changed: [], deleted: [], deltaToken: 't' })),
  createOutlookEvent: jest.fn(),
  updateOutlookEvent: jest.fn(),
  deleteOutlookEvent: jest.fn(),
  subscribeToCalendarChanges: jest.fn(),
}));

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { db, truncateAll, seedUser, closePool } = require('./helpers');

const PASSWORD = 'CascadePass1';

beforeEach(truncateAll);
afterAll(closePool);

function buildApp() {
  const app = express();
  app.use(bodyParser.json());
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../routes'));
  return app;
}

async function agentFor(app, overrides = {}) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser({ password_hash: hash, ...overrides });
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user };
}

/** Direct INSERT — mirrors how legacy/demo travel rows exist in production. */
async function insertEvent(userId, { title, start, end, type = 'therapy', relatedEventId = null }) {
  const { rows } = await db.pool.query(
    `INSERT INTO events (user_id, title, start_time, end_time, event_type, related_event_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [userId, title, start, end, type, relatedEventId]
  );
  return rows[0];
}

const T = (h, m = 0) => `2026-08-10T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`;

/**
 * Standard fixture:
 *   appt A 02:00-03:00  (the event we delete)
 *   tbBefore   01:45-02:00  unlinked, leads into A, other end free  → cascades
 *   tbLinked   05:00-05:15  related_event_id = A (not adjacent)     → cascades
 *   tbSandwich 03:00-03:15  unlinked, wedged between A and appt B   → survives
 *   appt B     03:15-04:15                                          → survives
 *   tbFar      07:00-07:20  unlinked, elsewhere                     → survives
 */
async function seedScenario(userId) {
  const appt = await insertEvent(userId, { title: 'Client Appointment — Casey L', start: T(2), end: T(3) });
  const tbBefore   = await insertEvent(userId, { title: 'Travel to Casey', start: T(1, 45), end: T(2), type: 'travel' });
  const tbLinked   = await insertEvent(userId, { title: 'Travel home leg', start: T(5), end: T(5, 15), type: 'travel', relatedEventId: appt.id });
  const tbSandwich = await insertEvent(userId, { title: 'Travel to next client', start: T(3), end: T(3, 15), type: 'travel' });
  const apptB      = await insertEvent(userId, { title: 'Client Appointment — Riley N', start: T(3, 15), end: T(4, 15) });
  const tbFar      = await insertEvent(userId, { title: 'Travel elsewhere', start: T(7), end: T(7, 20), type: 'travel' });
  return { appt, tbBefore, tbLinked, tbSandwich, apptB, tbFar };
}

const aliveIds = async (userId) => {
  const { rows } = await db.pool.query(
    `SELECT id FROM events WHERE user_id = $1 AND is_deleted = FALSE`, [userId]);
  return rows.map((r) => r.id);
};

describe('migration 016 linkage column', () => {
  test('events.related_event_id exists, is nullable UUID, and survives target hard-delete as NULL', async () => {
    const { rows } = await db.pool.query(`
      SELECT data_type, is_nullable FROM information_schema.columns
      WHERE table_name = 'events' AND column_name = 'related_event_id'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].data_type).toBe('uuid');
    expect(rows[0].is_nullable).toBe('YES');

    const u = await seedUser();
    const appt = await insertEvent(u.id, { title: 'A', start: T(2), end: T(3) });
    const tb   = await insertEvent(u.id, { title: 'T', start: T(1, 45), end: T(2), type: 'travel', relatedEventId: appt.id });
    await db.pool.query('DELETE FROM events WHERE id = $1', [appt.id]); // ON DELETE SET NULL
    const { rows: after } = await db.pool.query('SELECT related_event_id FROM events WHERE id = $1', [tb.id]);
    expect(after[0].related_event_id).toBeNull();
  });
});

describe('?dryRun=1 preview', () => {
  test('reports the accurate cascade and deletes nothing', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app);
    const s = await seedScenario(user.id);

    const res = await agent.delete(`/api/outlook/events/${s.appt.id}?dryRun=1`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, dryRun: true, deleted: 0, travelBlocksDeleted: 2 });
    expect(res.body.travelBlockIds.sort()).toEqual([s.tbBefore.id, s.tbLinked.id].sort());
    expect(res.body.travelBlockTitles.sort()).toEqual(['Travel home leg', 'Travel to Casey'].sort());

    // Nothing tombstoned — all six rows still alive
    expect((await aliveIds(user.id)).length).toBe(6);
  });
});

describe('DELETE cascade', () => {
  test('linked + safe-adjacent travel gone; sandwiched, unrelated and appt B intact', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app);
    const s = await seedScenario(user.id);

    const res = await agent.delete(`/api/outlook/events/${s.appt.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, deleted: 1, travelBlocksDeleted: 2 });
    expect(res.body.travelBlockIds.sort()).toEqual([s.tbBefore.id, s.tbLinked.id].sort());

    const alive = await aliveIds(user.id);
    expect(alive).not.toContain(s.appt.id);       // the event itself
    expect(alive).not.toContain(s.tbBefore.id);   // adjacent legacy block
    expect(alive).not.toContain(s.tbLinked.id);   // explicitly linked block
    expect(alive).toContain(s.tbSandwich.id);     // sandwiched — never cascades
    expect(alive).toContain(s.apptB.id);          // neighbouring appointment untouched
    expect(alive).toContain(s.tbFar.id);          // unrelated travel untouched

    // Tombstones carry deleted_at
    const { rows } = await db.pool.query(
      'SELECT deleted_at FROM events WHERE id = ANY($1)', [[s.appt.id, s.tbBefore.id, s.tbLinked.id]]);
    rows.forEach((r) => expect(r.deleted_at).not.toBeNull());

    // getEvents (the calendar feed) no longer returns any of them
    const feed = await db.getEvents(user.id);
    const feedIds = feed.map((e) => e.id);
    [s.appt.id, s.tbBefore.id, s.tbLinked.id].forEach((id) => expect(feedIds).not.toContain(id));
  });

  test('the delete is audited with the cascade size', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app);
    const s = await seedScenario(user.id);

    await agent.delete(`/api/outlook/events/${s.appt.id}`);

    const { rows } = await db.pool.query(
      `SELECT * FROM audit_logs WHERE action = 'calendar.event_deleted' AND target_id = $1`, [s.appt.id]);
    expect(rows).toHaveLength(1);
    const meta = typeof rows[0].metadata === 'string' ? JSON.parse(rows[0].metadata) : rows[0].metadata;
    expect(meta.travelBlocksDeleted).toBe(2);
  });

  test('deleting an event with NO travel blocks reports a zero cascade', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app);
    const solo = await insertEvent(user.id, { title: 'Standalone admin', start: T(9), end: T(10), type: 'admin' });

    const res = await agent.delete(`/api/outlook/events/${solo.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, deleted: 1, travelBlocksDeleted: 0 });
    expect(res.body.travelBlockIds).toEqual([]);
  });

  test("another user's rows are invisible: foreign event 404s and nothing is touched", async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app);
    const other = await seedUser();
    const sOther = await seedScenario(other.id);
    await seedScenario(user.id);

    const res = await agent.delete(`/api/outlook/events/${sOther.appt.id}`);
    expect(res.status).toBe(404);
    expect((await aliveIds(other.id)).length).toBe(6);
  });

  test('cross-user adjacency never leaks: my delete leaves an identically-timed foreign travel row alone', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app);
    const s = await seedScenario(user.id);
    const other = await seedUser();
    const foreignTb = await insertEvent(other.id, { title: 'Foreign travel', start: T(1, 45), end: T(2), type: 'travel' });

    const res = await agent.delete(`/api/outlook/events/${s.appt.id}`);
    expect(res.status).toBe(200);
    expect(res.body.travelBlockIds).not.toContain(foreignTb.id);
    expect(await aliveIds(other.id)).toContain(foreignTb.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  Cmd+Z undo — POST /api/outlook/events/:dbId/restore (2026-08-09)
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/outlook/events/:dbId/restore — delete → restore round-trip', () => {
  test('event + cascaded travel rows live again; unrelated and foreign rows untouched; restore audited', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app);
    const s = await seedScenario(user.id);
    const other = await seedUser();
    await seedScenario(other.id);

    // Delete with cascade — three of six rows tombstoned
    const del = await agent.delete(`/api/outlook/events/${s.appt.id}`);
    expect(del.status).toBe(200);
    expect(del.body.travelBlocksDeleted).toBe(2);
    expect((await aliveIds(user.id)).length).toBe(3);

    // Restore, feeding back exactly the cascade ids the delete reported
    const res = await agent.post(`/api/outlook/events/${s.appt.id}/restore`)
      .send({ travelBlockIds: del.body.travelBlockIds });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, restored: 1, travelBlocksRestored: 2 });
    expect(res.body.travelBlockIds.sort()).toEqual([s.tbBefore.id, s.tbLinked.id].sort());

    // All six of the caller's rows are alive again, tombstones fully cleared
    const alive = await aliveIds(user.id);
    expect(alive.sort()).toEqual(
      [s.appt.id, s.tbBefore.id, s.tbLinked.id, s.tbSandwich.id, s.apptB.id, s.tbFar.id].sort());
    const { rows: cleared } = await db.pool.query(
      'SELECT deleted_at FROM events WHERE id = ANY($1)', [[s.appt.id, s.tbBefore.id, s.tbLinked.id]]);
    cleared.forEach((r) => expect(r.deleted_at).toBeNull());

    // The calendar feed serves them again
    const feedIds = (await db.getEvents(user.id)).map((e) => e.id);
    [s.appt.id, s.tbBefore.id, s.tbLinked.id].forEach((id) => expect(feedIds).toContain(id));

    // No row ever had an outlook_id → no Graph re-creates attempted
    const outlookApi = require('../../outlook-oauth');
    expect(outlookApi.createOutlookEvent).not.toHaveBeenCalled();

    // The other user's world is untouched
    expect((await aliveIds(other.id)).length).toBe(6);

    // Audited with counts
    const { rows } = await db.pool.query(
      `SELECT * FROM audit_logs WHERE action = 'calendar.event_restored' AND target_id = $1`, [s.appt.id]);
    expect(rows).toHaveLength(1);
    const meta = typeof rows[0].metadata === 'string' ? JSON.parse(rows[0].metadata) : rows[0].metadata;
    expect(meta.travelBlocksRestored).toBe(2);
    expect(meta.travelBlockIds.sort()).toEqual([s.tbBefore.id, s.tbLinked.id].sort());
  });

  test('travel-id validation: foreign, non-travel, and not-deleted ids are dropped; 409 when the event is alive; 404 cross-user', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app);
    const s = await seedScenario(user.id);
    const other = await seedUser();
    const foreignTb = await insertEvent(other.id, { title: 'Foreign travel', start: T(6), end: T(6, 15), type: 'travel' });
    await db.pool.query('UPDATE events SET is_deleted = TRUE, deleted_at = CURRENT_TIMESTAMP WHERE id = $1', [foreignTb.id]);

    // Restoring an event that is not deleted conflicts
    const conflict = await agent.post(`/api/outlook/events/${s.appt.id}/restore`).send({});
    expect(conflict.status).toBe(409);

    // A foreign event id is invisible
    const foreign = await agent.post(`/api/outlook/events/${foreignTb.id}/restore`).send({});
    expect(foreign.status).toBe(404);

    // Real delete, then a restore that smuggles in ids that must not check out:
    // a foreign deleted travel row, a live sandwiched travel row, a non-travel appt
    const del = await agent.delete(`/api/outlook/events/${s.appt.id}`);
    const res = await agent.post(`/api/outlook/events/${s.appt.id}/restore`)
      .send({ travelBlockIds: [...del.body.travelBlockIds, foreignTb.id, s.tbSandwich.id, s.apptB.id] });

    expect(res.status).toBe(200);
    expect(res.body.travelBlocksRestored).toBe(2);
    expect(res.body.travelBlockIds.sort()).toEqual([s.tbBefore.id, s.tbLinked.id].sort());

    // The foreign tombstone is still a tombstone
    expect(await aliveIds(other.id)).not.toContain(foreignTb.id);
  });
});
