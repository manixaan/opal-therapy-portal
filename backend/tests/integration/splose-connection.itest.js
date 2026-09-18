'use strict';

/**
 * PRACTICE SPLOSE CONNECTION (migration 069) — integration tests.
 *
 * The one Splose API key can now live in integration_connections, encrypted
 * at rest, replaceable and disconnectable by the Owner. Under test against a
 * real database: the table exists after migrations; a stored key round-trips
 * through encryption and wins over the environment; an explicit disconnect
 * switches the environment key off; status never carries the key.
 * No Splose call is made — the client is only told which key it holds.
 */

const db = require('../../database');
const { truncateAll, seedUser, closePool } = require('./helpers');
const creds = require('../../splose-credentials');
const sploseApi = require('../../splose-api');

beforeEach(async () => { await truncateAll(); sploseApi.setApiKey(null); });
afterAll(async () => { await closePool(); });

test('migration 069 created integration_connections with its provider check', async () => {
  const cols = await db.pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'integration_connections' ORDER BY ordinal_position`);
  expect(cols.rows.map((r) => r.column_name)).toEqual(
    expect.arrayContaining(['provider', 'secret_encrypted', 'label', 'connected_by', 'connected_at', 'disconnected_at']));
  await expect(db.pool.query(`INSERT INTO integration_connections (provider) VALUES ('xero')`)).rejects.toThrow(/provider_chk/);
});

test('no row → environment key; a connected row wins and round-trips through encryption', async () => {
  const env = await creds.resolve();
  expect(env.source).toBe('environment');
  expect(env.key).toBe(process.env.SPLOSE_API_KEY);

  const owner = await seedUser({ role: 'owner', name: 'Ann Owner' });
  const conn = await creds.connect({ apiKey: 'itest-splose-key-not-real-000001', label: 'Practice 2026', userId: owner.id });
  expect(conn.source).toBe('database');
  expect(sploseApi.getApiKey()).toBe('itest-splose-key-not-real-000001');

  const stored = await db.pool.query(`SELECT secret_encrypted FROM integration_connections WHERE provider = 'splose'`);
  expect(stored.rows[0].secret_encrypted).toMatch(/^enc:/);
  expect(stored.rows[0].secret_encrypted).not.toContain('not-real');

  const st = await creds.status();
  expect(st.connected).toBe(true);
  expect(st.connectedBy).toBe('Ann Owner');
  expect(st.label).toBe('Practice 2026');
  expect(JSON.stringify(st)).not.toContain('not-real');
});

test('disconnect switches the environment key off until a new key is connected', async () => {
  const owner = await seedUser({ role: 'owner' });
  const off = await creds.disconnect({ userId: owner.id });
  expect(off.source).toBe('disconnected');
  expect(sploseApi.isConfigured()).toBe(false);
  expect(() => sploseApi.getApiKey()).not.toThrow();

  const on = await creds.connect({ apiKey: 'itest-splose-key-not-real-000002', userId: owner.id });
  expect(on.source).toBe('database');
  expect(sploseApi.isConfigured()).toBe(true);
});
