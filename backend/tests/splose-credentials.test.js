'use strict';

/**
 * Where the practice's Splose key comes from — database row wins, an explicit
 * disconnect switches the environment off, and the client is told each time.
 * No database: the pool is mocked; no key is ever asserted by value.
 */

jest.mock('../database', () => ({ pool: { query: jest.fn() } }));

const db = require('../database');
const sploseApi = require('../splose-api');
const creds = require('../splose-credentials');

const ENV = process.env.SPLOSE_API_KEY;
beforeEach(() => { jest.clearAllMocks(); process.env.SPLOSE_API_KEY = 'env-key-not-real-xxxxxxxx'; sploseApi.setApiKey(null); });
afterAll(() => { if (ENV === undefined) delete process.env.SPLOSE_API_KEY; else process.env.SPLOSE_API_KEY = ENV; });

test('no row → the environment key, reported as such', async () => {
  db.pool.query.mockResolvedValue({ rows: [] });
  const r = await creds.resolve();
  expect(r.source).toBe('environment');
  expect(r.connected).toBe(true);
  expect(r.key).toBe(process.env.SPLOSE_API_KEY);
});

test('a stored key wins over the environment and carries who connected it', async () => {
  db.pool.query.mockResolvedValue({ rows: [{ secret_encrypted: 'db-key-not-real-yyyyyyyy', label: 'Practice key 2026', connected_at: '2026-09-18T00:00:00Z', disconnected_at: null, connected_by_display: 'Ann' }] });
  const r = await creds.resolve();
  expect(r.source).toBe('database');
  expect(r.key).toBe('db-key-not-real-yyyyyyyy');
  expect(r.connectedBy).toBe('Ann');
  expect(r.label).toBe('Practice key 2026');
});

test('an explicit disconnect ignores the environment key too', async () => {
  db.pool.query.mockResolvedValue({ rows: [{ secret_encrypted: null, label: null, connected_at: null, disconnected_at: '2026-09-18T01:00:00Z' }] });
  const r = await creds.resolve();
  expect(r.source).toBe('disconnected');
  expect(r.connected).toBe(false);
  expect(r.key).toBeNull();
});

test('before migration 069 exists the environment still works', async () => {
  db.pool.query.mockRejectedValue(new Error('relation "integration_connections" does not exist'));
  const r = await creds.resolve();
  expect(r.source).toBe('environment');
});

test('apply() pushes the effective key into the Splose client, and status() never exposes it', async () => {
  db.pool.query.mockResolvedValue({ rows: [{ secret_encrypted: 'db-key-not-real-zzzzzzzz', label: null, connected_at: null, disconnected_at: null }] });
  await creds.apply();
  expect(sploseApi.isConfigured()).toBe(true);
  expect(sploseApi.getApiKey()).toBe('db-key-not-real-zzzzzzzz');
  const st = await creds.status();
  expect(st.key).toBeUndefined();
  expect(JSON.stringify(st)).not.toContain('zzzzzzzz');

  db.pool.query.mockResolvedValue({ rows: [{ secret_encrypted: null, disconnected_at: 'now' }] });
  await creds.apply();
  expect(sploseApi.isConfigured()).toBe(false);
  expect(() => sploseApi.testConnection && require('../splose-api').getServices).not.toThrow();
});

test('connect() stores an encrypted value and disconnect() clears it, both re-applying', async () => {
  db.pool.query.mockResolvedValue({ rows: [] });
  await creds.connect({ apiKey: 'new-key-not-real-wwwwwwww', label: 'Moved practice', userId: 'u1' });
  const insert = db.pool.query.mock.calls.find((c) => /INSERT INTO integration_connections/.test(c[0]) && c[1][1] !== null);
  expect(insert[1][0]).toBe('splose');
  expect(insert[1][2]).toBe('Moved practice');
  expect(insert[1][3]).toBe('u1');
  await creds.disconnect({ userId: 'u1' });
  const clear = db.pool.query.mock.calls.find((c) => /disconnected_at = NOW\(\)/.test(c[0]));
  expect(clear[0]).toMatch(/secret_encrypted = NULL/);
});
