'use strict';

/**
 * DELTA PARTIAL-PAYLOAD PRESERVATION — real SQL, isolated *_test database.
 *
 * Companion to tests/outlook-delta-preserve.test.js (which pins the mapping
 * contract and the generated SQL). This file proves the end result against a
 * real Postgres: a partial delta payload must not destroy stored data.
 *
 * Original defect: `title = $1` with `const title = eventData.title || '(No title)'`
 * meant any delta touch that omitted `subject` overwrote the real title with
 * '(No title)' and blanked categories — 517 rows were damaged in dev.
 */

const { db, truncateAll, seedUser, closePool } = require('./helpers');

beforeEach(truncateAll);
afterAll(closePool);

const OL = (n) => `AAMk-delta-preserve-${n}==`;

const FULL = (outlookId) => ({
  outlookId,
  title:      'Jonathan Jose',
  startTime:  '2026-07-01T09:50:00Z',
  endTime:    '2026-07-01T10:53:00Z',
  location:   'Joondalup Clinic',
  categories: ['Therapy', 'NDIS'],
  eventType:  'therapy',
});

describe('partial delta payloads never wipe stored values', () => {
  test('THE REGRESSION: a touch with no subject/location/categories changes nothing', async () => {
    const u = await seedUser();
    const before = await db.upsertOutlookEvent(u.id, FULL(OL(1)));
    expect(before.title).toBe('Jonathan Jose');
    expect(before.categories).toEqual(['Therapy', 'NDIS']);

    // Exactly what Graph re-emits for an unchanged recurring occurrence:
    // identity + timing only, every other property absent.
    const after = await db.upsertOutlookEvent(u.id, {
      outlookId: OL(1),
      startTime: '2026-07-01T09:50:00Z',
      endTime:   '2026-07-01T10:53:00Z',
      type:      'occurrence',
    });

    expect(after.id).toBe(before.id);              // same row, updated in place
    expect(after.title).toBe('Jonathan Jose');     // was '(No title)' before the fix
    expect(after.location).toBe('Joondalup Clinic');
    expect(after.categories).toEqual(['Therapy', 'NDIS']); // was [] before the fix
  });

  test('repeated partial touches stay stable (the recurring-occurrence case)', async () => {
    const u = await seedUser();
    await db.upsertOutlookEvent(u.id, FULL(OL(2)));
    let row;
    for (let i = 0; i < 5; i++) {
      row = await db.upsertOutlookEvent(u.id, {
        outlookId: OL(2),
        startTime: '2026-07-01T09:50:00Z',
        endTime:   '2026-07-01T10:53:00Z',
      });
    }
    expect(row.title).toBe('Jonathan Jose');
    expect(row.categories).toEqual(['Therapy', 'NDIS']);
  });

  test('a payload that DOES carry values still updates them', async () => {
    const u = await seedUser();
    await db.upsertOutlookEvent(u.id, FULL(OL(3)));
    const after = await db.upsertOutlookEvent(u.id, {
      outlookId:  OL(3),
      title:      'Renamed Session',
      location:   'Perth CBD',
      categories: ['Admin'],
      startTime:  '2026-07-01T11:00:00Z',
      endTime:    '2026-07-01T12:00:00Z',
    });
    expect(after.title).toBe('Renamed Session');
    expect(after.location).toBe('Perth CBD');
    expect(after.categories).toEqual(['Admin']);
    expect(after.start_time.toISOString()).toBe('2026-07-01T11:00:00.000Z');
  });

  test('a deliberate category clear from Graph is honoured', async () => {
    const u = await seedUser();
    await db.upsertOutlookEvent(u.id, FULL(OL(4)));
    const after = await db.upsertOutlookEvent(u.id, {
      outlookId: OL(4), title: 'Jonathan Jose', categories: [],
      startTime: '2026-07-01T09:50:00Z', endTime: '2026-07-01T10:53:00Z',
    });
    expect(after.categories).toEqual([]);
  });

  test('an explicitly empty subject overwrites, and stays distinct from absent', async () => {
    const u = await seedUser();
    await db.upsertOutlookEvent(u.id, FULL(OL(5)));

    const cleared = await db.upsertOutlookEvent(u.id, {
      outlookId: OL(5), title: '',
      startTime: '2026-07-01T09:50:00Z', endTime: '2026-07-01T10:53:00Z',
    });
    expect(cleared.title).toBe('');

    // A subsequent partial touch must not resurrect a placeholder either.
    const untouched = await db.upsertOutlookEvent(u.id, {
      outlookId: OL(5),
      startTime: '2026-07-01T09:50:00Z', endTime: '2026-07-01T10:53:00Z',
    });
    expect(untouched.title).toBe('');
  });

  test('manual location override survives a partial AND a full payload', async () => {
    const u = await seedUser();
    const row = await db.upsertOutlookEvent(u.id, FULL(OL(6)));
    await db.pool.query(
      `UPDATE events SET location = $1, is_manual_location_override = TRUE WHERE id = $2`,
      ['12 Router Street, Perth', row.id]
    );

    const afterPartial = await db.upsertOutlookEvent(u.id, {
      outlookId: OL(6), startTime: '2026-07-01T09:50:00Z', endTime: '2026-07-01T10:53:00Z',
    });
    expect(afterPartial.location).toBe('12 Router Street, Perth');

    const afterFull = await db.upsertOutlookEvent(u.id, {
      outlookId: OL(6), title: 'Jonathan Jose', location: 'Joondalup Clinic',
      startTime: '2026-07-01T09:50:00Z', endTime: '2026-07-01T10:53:00Z',
    });
    expect(afterFull.location).toBe('12 Router Street, Perth');
  });

  test('an app-created row keeps its title and origin under a partial delta echo', async () => {
    const u = await seedUser();
    const created = await db.upsertOutlookEvent(u.id, {
      ...FULL(OL(7)), title: 'App Booking', createdBySource: 'app',
    });
    expect(created.created_by_source).toBe('app');

    const echoed = await db.upsertOutlookEvent(u.id, {
      outlookId: OL(7), startTime: '2026-07-01T09:50:00Z', endTime: '2026-07-01T10:53:00Z',
    });
    expect(echoed.title).toBe('App Booking');
    expect(echoed.created_by_source).toBe('app');
    expect(echoed.source).toBe('app');
  });
});

describe('new-row insert semantics', () => {
  test('a genuinely absent subject inserts the NOT NULL placeholder', async () => {
    const u = await seedUser();
    const row = await db.upsertOutlookEvent(u.id, {
      outlookId: OL(8),
      startTime: '2026-07-01T09:00:00Z', endTime: '2026-07-01T10:00:00Z',
    });
    expect(row.title).toBe('(No title)');
  });

  test('an explicitly empty subject inserts as empty', async () => {
    const u = await seedUser();
    const row = await db.upsertOutlookEvent(u.id, {
      outlookId: OL(9), title: '',
      startTime: '2026-07-01T09:00:00Z', endTime: '2026-07-01T10:00:00Z',
    });
    expect(row.title).toBe('');
  });
});
