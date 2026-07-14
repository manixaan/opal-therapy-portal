'use strict';

/**
 * Migration-runner integration tests (real DB).
 * The globalSetup already ran INIT_QUERIES; here we exercise the tracked
 * runner on top of it.
 */

const { db, closePool } = require('./helpers');
const migrate = require('../../migrate');

afterAll(async () => {
  // Leave a clean, correctly-recorded ledger for any suite that runs after us
  // (the drift test deliberately corrupts a checksum).
  await db.pool.query('DROP TABLE IF EXISTS schema_migrations');
  await migrate.migrate();
  await closePool();
});

describe('migration runner', () => {
  beforeEach(async () => {
    // Start each test from a clean migration ledger; the underlying schema
    // (from globalSetup) stays in place.
    await db.pool.query('DROP TABLE IF EXISTS schema_migrations');
  });

  test('applies baseline + real migrations and records them', async () => {
    const result = await migrate.migrate();
    expect(result.applied).toEqual(expect.arrayContaining([
      '000_baseline.sql', '001_perf_indexes_and_blob_storage.sql',
    ]));

    const { rows } = await db.pool.query('SELECT id FROM schema_migrations ORDER BY id');
    expect(rows.map(r => r.id)).toEqual(['000', '001']);
  });

  test('is idempotent — a second run applies nothing', async () => {
    await migrate.migrate();
    const second = await migrate.migrate();
    expect(second.applied).toEqual([]);
  });

  test('status reports applied vs pending', async () => {
    await migrate.migrate();
    const rows = await migrate.status();
    expect(rows.every(r => r.state === 'applied')).toBe(true);
    expect(rows.find(r => r.id === '001')).toBeTruthy();
  });

  test('the perf index and storage columns exist after migration', async () => {
    await migrate.migrate();
    const idx = await db.pool.query(
      "SELECT indexname FROM pg_indexes WHERE indexname = 'idx_events_user_active_start'");
    expect(idx.rows).toHaveLength(1);

    const cols = await db.pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name='pd_documents' AND column_name IN ('storage_backend','storage_key')`);
    expect(cols.rows.map(r => r.column_name).sort()).toEqual(['storage_backend', 'storage_key']);
  });

  test('checksum drift on an applied migration is refused', async () => {
    await migrate.migrate();
    // Corrupt the recorded checksum to simulate an edited applied migration.
    await db.pool.query("UPDATE schema_migrations SET checksum = 'deadbeef' WHERE id='001'");
    await expect(migrate.migrate()).rejects.toThrow(/modified after being applied/i);
  });
});
