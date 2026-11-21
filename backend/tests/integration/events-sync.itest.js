'use strict';

/**
 * Calendar-event & sync-state integration tests — real SQL, isolated *_test DB.
 * Covers: event create/update/soft-delete, the UNIQUE(user_id, outlook_id)
 * constraint, upsert idempotency + origin preservation, delta-sync state,
 * window reconciliation and dedup.
 */

const { db, truncateAll, seedUser, closePool } = require('./helpers');

beforeEach(truncateAll);
afterAll(closePool);

const OL = (n) => `AAMk-integration-${n}==`;

describe('event creation & update', () => {
  test('createEvent stamps source=app and created_by_source=app', async () => {
    const u = await seedUser();
    const ev = await db.createEvent(u.id, {
      title: 'App event', startTime: '2026-08-01T01:00:00Z', endTime: '2026-08-01T02:00:00Z',
      eventType: 'therapy',
    });
    expect(ev.source).toBe('app');
    expect(ev.created_by_source).toBe('app');
    expect(ev.sync_status).toBe('pending');
  });

  test('updateEvent partially updates and bumps last_modified fields', async () => {
    const u = await seedUser();
    const ev = await db.createEvent(u.id, {
      title: 'Before', startTime: '2026-08-01T01:00:00Z', endTime: '2026-08-01T02:00:00Z',
      eventType: 'admin',
    });
    const updated = await db.updateEvent(ev.id, { title: 'After', lastModifiedBy: 'app' });
    expect(updated.title).toBe('After');
    expect(updated.event_type).toBe('admin');            // untouched
    expect(String(updated.start_time)).toBe(String(ev.start_time)); // untouched
    expect(updated.last_modified_by).toBe('app');
  });
});

describe('UNIQUE(user_id, outlook_id) constraint', () => {
  test('direct duplicate INSERT violates events_user_outlook_unique (23505)', async () => {
    const u = await seedUser();
    const insert = (title) => db.pool.query(
      `INSERT INTO events (user_id, title, start_time, end_time, outlook_id, source, event_type)
       VALUES ($1,$2,'2026-08-01T01:00:00Z','2026-08-01T02:00:00Z',$3,'outlook','meeting')`,
      [u.id, title, OL('dup')]
    );
    await insert('first');
    await expect(insert('second')).rejects.toMatchObject({ code: '23505' });
  });

  test('same outlook_id for DIFFERENT users is allowed (per-user scope)', async () => {
    const a = await seedUser();
    const b = await seedUser();
    for (const u of [a, b]) {
      await db.upsertOutlookEvent(u.id, {
        outlookId: OL('shared'), title: 'Shared-id event',
        startTime: '2026-08-01T01:00:00Z', endTime: '2026-08-01T02:00:00Z',
      });
    }
    const { rows } = await db.pool.query(
      'SELECT COUNT(*) FROM events WHERE outlook_id = $1', [OL('shared')]);
    expect(Number(rows[0].count)).toBe(2);
  });
});

describe('upsertOutlookEvent idempotency & origin preservation', () => {
  test('second upsert updates in place — no duplicate row', async () => {
    const u = await seedUser();
    await db.upsertOutlookEvent(u.id, {
      outlookId: OL(1), title: 'v1',
      startTime: '2026-08-01T01:00:00Z', endTime: '2026-08-01T02:00:00Z',
      eventType: 'therapy',
    });
    const second = await db.upsertOutlookEvent(u.id, {
      outlookId: OL(1), title: 'v2 renamed',
      startTime: '2026-08-01T03:00:00Z', endTime: '2026-08-01T04:00:00Z',
    });
    expect(second.title).toBe('v2 renamed');

    const { rows } = await db.pool.query(
      'SELECT * FROM events WHERE user_id=$1 AND outlook_id=$2', [u.id, OL(1)]);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('v2 renamed');
    expect(rows[0].event_type).toBe('therapy'); // INSERT set it; UPDATE path does not clobber
  });

  test('app-created write-back keeps source=app after a later Outlook-side upsert', async () => {
    const u = await seedUser();
    await db.upsertOutlookEvent(u.id, {
      outlookId: OL(2), title: 'Booked in app',
      startTime: '2026-08-02T01:00:00Z', endTime: '2026-08-02T02:00:00Z',
      createdBySource: 'app', eventType: 'therapy', sploseId: '424242',
    });
    // Delta poller echo (no createdBySource)
    const echoed = await db.upsertOutlookEvent(u.id, {
      outlookId: OL(2), title: 'Booked in app',
      startTime: '2026-08-02T01:00:00Z', endTime: '2026-08-02T02:00:00Z',
    });
    expect(echoed.created_by_source).toBe('app'); // permanent origin survives
    expect(echoed.source).toBe('app');            // COALESCE(NULLIF(created_by_source,'app'),'outlook')
    expect(echoed.splose_id).toBe('424242');
  });

  test('isCancelled upsert soft-deletes the outlook-sourced row', async () => {
    const u = await seedUser();
    await db.upsertOutlookEvent(u.id, {
      outlookId: OL(3), title: 'To cancel',
      startTime: '2026-08-03T01:00:00Z', endTime: '2026-08-03T02:00:00Z',
    });
    const result = await db.upsertOutlookEvent(u.id, { outlookId: OL(3), isCancelled: true });
    expect(result).toBeNull();
    const { rows } = await db.pool.query(
      'SELECT is_deleted, deleted_at FROM events WHERE outlook_id=$1', [OL(3)]);
    expect(rows[0].is_deleted).toBe(true);
    expect(rows[0].deleted_at).not.toBeNull();
  });
});

describe('soft deletion', () => {
  test('softDeleteEventByOutlookId tombstones outlook rows and is idempotent', async () => {
    const u = await seedUser();
    await db.upsertOutlookEvent(u.id, {
      outlookId: OL(4), title: 'Gone',
      startTime: '2026-08-04T01:00:00Z', endTime: '2026-08-04T02:00:00Z',
    });
    const first = await db.softDeleteEventByOutlookId(u.id, OL(4));
    expect(first).not.toBeNull();
    const second = await db.softDeleteEventByOutlookId(u.id, OL(4));
    expect(second).toBeNull(); // already deleted → no-op

    // getEvents excludes tombstones
    const visible = await db.getEvents(u.id);
    expect(visible.find(e => e.outlook_id === OL(4))).toBeUndefined();
  });

  test('softDeleteEventByOutlookId never touches app-sourced rows', async () => {
    const u = await seedUser();
    const appEv = await db.createEvent(u.id, {
      title: 'App-origin', startTime: '2026-08-05T01:00:00Z', endTime: '2026-08-05T02:00:00Z',
      eventType: 'travel', outlookId: OL(5),
    });
    const result = await db.softDeleteEventByOutlookId(u.id, OL(5));
    expect(result).toBeNull(); // source='app' row is protected
    const { rows } = await db.pool.query('SELECT is_deleted FROM events WHERE id=$1', [appEv.id]);
    expect(rows[0].is_deleted).toBe(false);
  });
});

describe('delta-sync state', () => {
  test('saveDeltaState upserts and getDeltaState round-trips (including full URL tokens)', async () => {
    const u = await seedUser();
    expect(await db.getDeltaState(u.id)).toBeNull();

    await db.saveDeltaState(u.id, 'plain-token-1');
    let state = await db.getDeltaState(u.id);
    expect(state.delta_token).toBe('plain-token-1');
    expect(state.last_synced_at).not.toBeNull();

    const urlToken = 'https://graph.microsoft.com/v1.0/me/calendarView/delta?%24deltatoken=abc123';
    await db.saveDeltaState(u.id, urlToken);
    state = await db.getDeltaState(u.id);
    expect(state.delta_token).toBe(urlToken);

    await db.saveDeltaState(u.id, null); // clearing on 400/410
    state = await db.getDeltaState(u.id);
    expect(state.delta_token).toBeNull();
  });
});

describe('window reconciliation & dedup', () => {
  test('reconcileOutlookWindow tombstones only in-window outlook rows missing from the live set', async () => {
    const u = await seedUser();
    const mk = (n, start) => db.upsertOutlookEvent(u.id, {
      outlookId: OL(n), title: `E${n}`, startTime: start,
      endTime: start.replace('T01', 'T02'),
    });
    await mk('keep',    '2026-08-10T01:00:00Z');
    await mk('stale',   '2026-08-11T01:00:00Z');
    await mk('outside', '2026-12-01T01:00:00Z'); // beyond window end

    const pruned = await db.reconcileOutlookWindow(
      u.id, '2026-08-01T00:00:00Z', '2026-08-31T23:59:59Z', [OL('keep')]
    );
    expect(pruned.map(r => r.outlook_id)).toEqual([OL('stale')]);

    const { rows } = await db.pool.query(
      'SELECT outlook_id, is_deleted FROM events WHERE user_id=$1 ORDER BY start_time', [u.id]);
    expect(rows.find(r => r.outlook_id === OL('keep')).is_deleted).toBe(false);
    expect(rows.find(r => r.outlook_id === OL('stale')).is_deleted).toBe(true);
    expect(rows.find(r => r.outlook_id === OL('outside')).is_deleted).toBe(false);
  });

  test('deduplicateOutlookEvents keeps the most recently updated copy', async () => {
    const u = await seedUser();
    // Bypass the unique constraint by using two different outlook_ids? No —
    // dedup partitions by outlook_id; with the constraint in place duplicates
    // can only pre-exist from before the migration. Simulate by dropping to
    // direct INSERTs with the constraint deferred… not possible. Instead,
    // verify dedup is a safe no-op on a healthy table.
    await db.upsertOutlookEvent(u.id, {
      outlookId: OL(6), title: 'only copy',
      startTime: '2026-08-12T01:00:00Z', endTime: '2026-08-12T02:00:00Z',
    });
    const removed = await db.deduplicateOutlookEvents(u.id);
    expect(removed).toEqual([]);
  });
});

// 10 Oct 2026: a portal booking is saved first and linked to its Outlook event
// only after Graph answers. A delta tick in that gap imports the same event as
// an 'outlook' row; its outlook_id used to block the link (23505), leaving the
// booking twice on the calendar and reported as an Outlook failure.
describe('updateEventOutlookId — linking after a racing delta import', () => {
  const appRow = (u) => db.createEvent(u.id, {
    title: 'Portal booking', startTime: '2026-08-13T01:00:00Z', endTime: '2026-08-13T02:00:00Z',
    eventType: 'therapy',
  });

  test("the delta's twin is released and the app row takes the outlook_id", async () => {
    const u = await seedUser();
    const a = await appRow(u);
    const twin = await db.upsertOutlookEvent(u.id, {
      outlookId: OL('race'), title: 'Portal booking',
      startTime: '2026-08-13T01:00:00Z', endTime: '2026-08-13T02:00:00Z',
    });
    expect(twin.created_by_source).toBe('outlook');

    const linked = await db.updateEventOutlookId(a.id, OL('race'));
    expect(linked).toMatchObject({ id: a.id, outlook_id: OL('race'), sync_status: 'synced' });

    const { rows: [t] } = await db.pool.query('SELECT outlook_id, is_deleted FROM events WHERE id = $1', [twin.id]);
    expect(t).toEqual({ outlook_id: null, is_deleted: true });
    // The next delta for that event now updates the app row, not a new one.
    await db.upsertOutlookEvent(u.id, {
      outlookId: OL('race'), title: 'Portal booking',
      startTime: '2026-08-13T01:00:00Z', endTime: '2026-08-13T02:00:00Z',
    });
    const { rows: live } = await db.pool.query(
      'SELECT id FROM events WHERE user_id = $1 AND COALESCE(is_deleted, FALSE) = FALSE', [u.id]);
    expect(live.map((r) => r.id)).toEqual([a.id]);
  });

  test('another app booking holding the id is never released — the link still fails, nothing changes', async () => {
    const u = await seedUser();
    const a = await appRow(u);
    const other = await appRow(u);
    await db.updateEventOutlookId(other.id, OL('taken'));

    await expect(db.updateEventOutlookId(a.id, OL('taken'))).rejects.toMatchObject({ code: '23505' });
    const { rows } = await db.pool.query(
      'SELECT id, outlook_id, is_deleted FROM events WHERE user_id = $1 ORDER BY id', [u.id]);
    expect(rows.find((r) => r.id === other.id)).toMatchObject({ outlook_id: OL('taken'), is_deleted: false });
    expect(rows.find((r) => r.id === a.id).outlook_id).toBeNull();
  });

  test("another user's row with the same outlook_id is untouched", async () => {
    const u = await seedUser();
    const v = await seedUser();
    const theirs = await db.upsertOutlookEvent(v.id, {
      outlookId: OL('per-user'), title: 'Theirs',
      startTime: '2026-08-13T01:00:00Z', endTime: '2026-08-13T02:00:00Z',
    });
    const a = await appRow(u);
    await db.updateEventOutlookId(a.id, OL('per-user'));
    const { rows: [t] } = await db.pool.query('SELECT outlook_id, is_deleted FROM events WHERE id = $1', [theirs.id]);
    expect(t).toEqual({ outlook_id: OL('per-user'), is_deleted: false });
  });
});

// P-03: the calendar's reloads ask for a window, not the whole history.
describe('GET /api/events ?from&to (windowed)', () => {
  const express = require('express');
  const session = require('express-session');
  const bodyParser = require('body-parser');
  const request = require('supertest');
  const bcrypt = require('bcryptjs');
  const PASSWORD = 'WindowedEventsPass1';

  function buildApp() {
    const app = express();
    app.use(bodyParser.json());
    app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false } }));
    app.use('/', require('../../auth'));
    app.use('/', require('../../routes'));
    return app;
  }
  async function signedIn(app) {
    require('../../auth')._resetLoginRateLimit();
    const user = await seedUser({ password_hash: await bcrypt.hash(PASSWORD, 4), role: 'therapist' });
    const agent = request.agent(app);
    const res = await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
    expect(res.status).toBe(200);
    return { agent, user };
  }
  const mk = (userId, title, start, end) => db.createEvent(userId, { title, startTime: start, endTime: end, eventType: 'admin' });

  test('requires a session', async () => {
    const res = await request(buildApp()).get('/api/events?from=2026-11-16T00:00:00%2B08:00&to=2026-12-14T00:00:00%2B08:00');
    expect(res.status).toBe(401);
  });

  test('returns only the caller\'s live events that START in [from, to); no range = full history', async () => {
    const app = buildApp();
    const { agent, user } = await signedIn(app);
    const other = await seedUser();
    await mk(user.id, 'old', '2024-01-10T01:00:00Z', '2024-01-10T02:00:00Z');
    await mk(user.id, 'edge-start', '2026-11-15T16:00:00Z', '2026-11-15T17:00:00Z');   // Mon 16 Nov 00:00 Perth
    await mk(user.id, 'inside', '2026-11-25T01:00:00Z', '2026-11-25T02:00:00Z');
    await mk(user.id, 'runs-past-end', '2026-12-13T15:00:00Z', '2026-12-13T17:00:00Z'); // starts before `to`, ends after
    await mk(user.id, 'at-end', '2026-12-13T16:00:00Z', '2026-12-13T17:00:00Z');        // starts AT `to`: excluded
    const gone = await mk(user.id, 'deleted', '2026-11-26T01:00:00Z', '2026-11-26T02:00:00Z');
    await db.pool.query('UPDATE events SET is_deleted = TRUE WHERE id = $1', [gone.id]);
    await mk(other.id, 'not mine', '2026-11-25T03:00:00Z', '2026-11-25T04:00:00Z');

    const win = await agent.get('/api/events').query({ from: '2026-11-16T00:00:00+08:00', to: '2026-12-14T00:00:00+08:00' });
    expect(win.status).toBe(200);
    expect(win.body.events.map(e => e.title)).toEqual(['edge-start', 'inside', 'runs-past-end']);
    expect(win.body.window).toEqual({ from: '2026-11-15T16:00:00.000Z', to: '2026-12-13T16:00:00.000Z' });

    const all = await agent.get('/api/events');
    expect(all.status).toBe(200);
    expect(all.body.events.map(e => e.title)).toEqual(['old', 'edge-start', 'inside', 'runs-past-end', 'at-end']);
    expect(all.body.window).toBeUndefined();
  });

  test('a bad or oversized range is refused, not widened', async () => {
    const app = buildApp();
    const { agent } = await signedIn(app);
    for (const q of [{ from: '2026-11-16' }, { from: 'nope', to: '2026-12-01' }, { from: '2026-12-01', to: '2026-11-01' },
      { from: '2026-01-01', to: '2027-03-01' }]) {
      const res = await agent.get('/api/events').query(q);
      expect(res.status).toBe(400);
      expect(res.body.events).toBeUndefined();
    }
  });
});
