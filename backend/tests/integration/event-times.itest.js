
'use strict';

/**
 * Event times are UTC wall-clock in TIMESTAMP (no-tz) columns. Postgres drops
 * an offset on input to such a column, so "…T11:15:00+08:00" — what the
 * calendar sends for a drag — used to be stored as 11:15 and read back eight
 * hours late; that shifted time was then published to Splose (7 Sep 2026).
 */

const { db, truncateAll, seedUser, closePool } = require('./helpers');

beforeEach(truncateAll);
afterAll(closePool);

describe('event times normalise to UTC on write', () => {
  test('updateEvent stores a +08:00 time as its UTC instant', async () => {
    const u = await seedUser();
    const ev = await db.createEvent(u.id, { title: 'T', startTime: '2026-09-08T07:45:00+08:00', endTime: '2026-09-08T08:45:00+08:00', eventType: 'therapy' });
    expect(ev.start_time.toISOString()).toBe('2026-09-07T23:45:00.000Z');
    const moved = await db.updateEvent(ev.id, { startTime: '2026-09-10T11:15:00+08:00', endTime: '2026-09-10T12:15:00+08:00', lastModifiedBy: 'app' });
    expect(moved.start_time.toISOString()).toBe('2026-09-10T03:15:00.000Z');
    expect(moved.end_time.toISOString()).toBe('2026-09-10T04:15:00.000Z');
  });

  test('the Outlook upsert (the booking route\'s save path) normalises a +08:00 time too', async () => {
    const u = await seedUser();
    const row = await db.upsertOutlookEvent(u.id, { outlookId: 'OL-book-1', title: 'Client Appointment — Casey L', startTime: '2026-09-08T09:00:00+08:00', endTime: '2026-09-08T10:00:00+08:00', createdBySource: 'app', eventType: 'therapy' });
    expect(row.start_time.toISOString()).toBe('2026-09-08T01:00:00.000Z');
    expect(row.end_time.toISOString()).toBe('2026-09-08T02:00:00.000Z');
    const again = await db.upsertOutlookEvent(u.id, { outlookId: 'OL-book-1', startTime: '2026-09-08T11:00:00+08:00', endTime: '2026-09-08T12:00:00+08:00' });
    expect(again.start_time.toISOString()).toBe('2026-09-08T03:00:00.000Z');
  });

  test('Z strings and Date objects are unchanged; absent times are preserved', async () => {
    const u = await seedUser();
    const ev = await db.createEvent(u.id, { title: 'T', startTime: new Date('2026-09-08T01:00:00Z'), endTime: '2026-09-08T02:00:00.000Z', eventType: 'therapy' });
    expect(ev.start_time.toISOString()).toBe('2026-09-08T01:00:00.000Z');
    const same = await db.updateEvent(ev.id, { title: 'Renamed' });
    expect(same.start_time.toISOString()).toBe('2026-09-08T01:00:00.000Z');
    expect(same.end_time.toISOString()).toBe('2026-09-08T02:00:00.000Z');
  });
});
