'use strict';
/** Regression: recurring-series MASTER records must never be stored as events
 *  (staging reconciliation 2026-07-27 — phantom blocks at pattern time). */
const { db, truncateAll, seedUser, closePool } = require('./helpers');
beforeEach(truncateAll);
afterAll(closePool);

test('upsertOutlookEvent skips seriesMaster; occurrences still stored', async () => {
  const user = await seedUser({});
  const master = await db.upsertOutlookEvent(user.id, {
    type: 'seriesMaster', outlookId: 'MASTER-1', title: 'Weekly thing',
    startTime: '2026-07-27T01:00:00Z', endTime: '2026-07-27T02:00:00Z',
  });
  expect(master.skipped).toBe('seriesMaster');
  const occ = await db.upsertOutlookEvent(user.id, {
    type: 'occurrence', outlookId: 'OCC-1', title: 'Weekly thing',
    startTime: '2026-07-27T01:00:00Z', endTime: '2026-07-27T02:00:00Z',
    eventType: 'meeting',
  });
  expect(occ.skipped).toBeUndefined();
  const rows = await db.pool.query('SELECT outlook_id FROM events WHERE user_id=$1', [user.id]);
  expect(rows.rows.map(r => r.outlook_id)).toEqual(['OCC-1']);
});
