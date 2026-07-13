'use strict';

/**
 * Integration tests for the guarded Outlook reconciliation (real SQL) —
 * empty-response protection, thresholds, dry-run, and legitimate deletion.
 */

const { db, truncateAll, seedUser, closePool } = require('./helpers');

beforeEach(truncateAll);
afterAll(closePool);

const OL = (n) => `AAMk-recon-${n}==`;

async function seedOutlookEvents(userId, count) {
  for (let i = 1; i <= count; i++) {
    await db.upsertOutlookEvent(userId, {
      outlookId: OL(i), title: `Event ${i}`,
      startTime: `2026-09-0${(i % 9) + 1}T01:00:00Z`,
      endTime: `2026-09-0${(i % 9) + 1}T02:00:00Z`,
    });
  }
}

const WINDOW = ['2026-09-01T00:00:00Z', '2026-09-30T23:59:59Z'];

describe('reconcileOutlookWindow (base) empty-set guard', () => {
  test('empty live-ID list is a no-op instead of a window wipe', async () => {
    const u = await seedUser();
    await seedOutlookEvents(u.id, 5);
    const pruned = await db.reconcileOutlookWindow(u.id, ...WINDOW, []);
    expect(pruned).toEqual([]);
    const { rows } = await db.pool.query(
      'SELECT COUNT(*) FROM events WHERE user_id=$1 AND is_deleted=FALSE', [u.id]);
    expect(Number(rows[0].count)).toBe(5); // nothing deleted
  });
});

describe('cleanupStaleOutlookEvents empty-set guard', () => {
  test('empty live-ID list refuses the previous sentinel full-wipe', async () => {
    const u = await seedUser();
    await seedOutlookEvents(u.id, 4);
    const removed = await db.cleanupStaleOutlookEvents(u.id, []);
    expect(removed).toEqual([]);
    const { rows } = await db.pool.query(
      'SELECT COUNT(*) FROM events WHERE user_id=$1 AND is_deleted=FALSE', [u.id]);
    expect(Number(rows[0].count)).toBe(4);
  });
});

describe('reconcileOutlookWindowSafe', () => {
  test('blocks on empty remote result (counts intact)', async () => {
    const u = await seedUser();
    await seedOutlookEvents(u.id, 6);
    const result = await db.reconcileOutlookWindowSafe(u.id, ...WINDOW, [], { fetchComplete: true });
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('empty_remote_result');
    expect(result.candidateCount).toBe(6);
    expect(result.pruned).toEqual([]);
    const { rows } = await db.pool.query(
      'SELECT COUNT(*) FROM events WHERE user_id=$1 AND is_deleted=FALSE', [u.id]);
    expect(Number(rows[0].count)).toBe(6);
  });

  test('blocks on incomplete fetch even when live IDs are present', async () => {
    const u = await seedUser();
    await seedOutlookEvents(u.id, 6);
    const live = [OL(1), OL(2), OL(3), OL(4), OL(5)];
    const result = await db.reconcileOutlookWindowSafe(u.id, ...WINDOW, live, { fetchComplete: false });
    expect(result).toMatchObject({ blocked: true, reason: 'incomplete_fetch' });
  });

  test('blocks when the drop exceeds the percentage threshold', async () => {
    const u = await seedUser();
    await seedOutlookEvents(u.id, 6);
    // Only 2 of 6 still live ⇒ 4/6 ≈ 67% > 30%
    const result = await db.reconcileOutlookWindowSafe(u.id, ...WINDOW, [OL(1), OL(2)], { fetchComplete: true });
    expect(result).toMatchObject({ blocked: true, reason: 'exceeds_delete_percentage' });
    const { rows } = await db.pool.query(
      'SELECT COUNT(*) FROM events WHERE user_id=$1 AND is_deleted=FALSE', [u.id]);
    expect(Number(rows[0].count)).toBe(6);
  });

  test('dry run reports candidates without deleting', async () => {
    const u = await seedUser();
    await seedOutlookEvents(u.id, 6);
    const live = [OL(1), OL(2), OL(3), OL(4), OL(5)]; // 1 candidate — within thresholds
    const result = await db.reconcileOutlookWindowSafe(u.id, ...WINDOW, live, { fetchComplete: true, dryRun: true });
    expect(result).toMatchObject({ blocked: false, reason: 'dry_run', candidateCount: 1 });
    const { rows } = await db.pool.query(
      'SELECT COUNT(*) FROM events WHERE user_id=$1 AND is_deleted=FALSE', [u.id]);
    expect(Number(rows[0].count)).toBe(6);
  });

  test('legitimate small deletion inside thresholds proceeds', async () => {
    const u = await seedUser();
    await seedOutlookEvents(u.id, 6);
    const live = [OL(1), OL(2), OL(3), OL(4), OL(5)]; // event 6 genuinely deleted upstream
    const result = await db.reconcileOutlookWindowSafe(u.id, ...WINDOW, live, { fetchComplete: true });
    expect(result.blocked).toBe(false);
    expect(result.pruned.map(r => r.outlook_id)).toEqual([OL(6)]);
    const { rows } = await db.pool.query(
      'SELECT outlook_id FROM events WHERE user_id=$1 AND is_deleted=TRUE', [u.id]);
    expect(rows.map(r => r.outlook_id)).toEqual([OL(6)]);
  });
});
