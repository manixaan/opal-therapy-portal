'use strict';

/**
 * THE PRACTICE'S SPLOSE CONNECTION — where the one API key lives.
 *
 * Splose issues one key per practice. It used to exist only as
 * SPLOSE_API_KEY in the environment, so "disconnect Splose" meant a deploy.
 * Now the Owner can connect a new key or disconnect from Settings; the row in
 * integration_connections (migration 069) wins over the environment, and an
 * explicit disconnect switches the environment key off as well.
 *
 * splose-api.js keeps a synchronous in-process key so its thirteen callers
 * need no change: this module loads the row at boot and after every change
 * and pushes the result into the client with setApiKey(). Single-instance
 * deployment is assumed (the same assumption the rate-limit queue makes).
 *
 * Nothing here logs or returns a key.
 */

const db = require('./database');
const { encrypt, decrypt } = require('./crypto-utils');
const sploseApi = require('./splose-api');

const PROVIDER = 'splose';

async function readRow() {
  const q = await db.pool.query(
    `SELECT c.secret_encrypted, c.label, c.connected_at, c.disconnected_at,
            u.display_name AS connected_by_display, u.name AS connected_by_name
       FROM integration_connections c
       LEFT JOIN users u ON u.id = c.connected_by
      WHERE c.provider = $1`,
    [PROVIDER],
  );
  return q.rows[0] || null;
}

/**
 * Resolve the effective key and a client-safe description of where it came
 * from. Never returns the key itself to a route — `apply()` is the only
 * consumer of `key`.
 */
async function resolve() {
  let row = null;
  try { row = await readRow(); } catch (err) {
    // The table arrives with migration 069; before it runs (or on a read
    // failure) the environment is the only source, as it always was.
    if (!/relation .* does not exist/i.test(err.message)) console.warn('[splose-credentials] read failed:', err.message);
  }
  if (row && row.secret_encrypted) {
    return {
      key: decrypt(row.secret_encrypted), source: 'database', connected: true,
      label: row.label || null, connectedAt: row.connected_at || null,
      connectedBy: row.connected_by_display || row.connected_by_name || null,
    };
  }
  if (row && row.disconnected_at) {
    return { key: null, source: 'disconnected', connected: false, label: null, connectedAt: null, connectedBy: null, disconnectedAt: row.disconnected_at };
  }
  const env = process.env.SPLOSE_API_KEY || null;
  return { key: env, source: env ? 'environment' : 'none', connected: !!env, label: null, connectedAt: null, connectedBy: null };
}

/** Load the effective key into the Splose client. Call at boot and after changes. */
async function apply() {
  const r = await resolve();
  sploseApi.setApiKey(r.key);
  // A different (or no) Splose account: forget the people and record fingerprints of the last one.
  require('./assist/identity-directory').invalidate();
  require('./assist/known-values').clear();
  return r;
}

/** Client-safe status: never the key, never its length. */
async function status() {
  const r = await resolve();
  const { key, ...safe } = r; // eslint-disable-line no-unused-vars
  return safe;
}

async function connect({ apiKey, label, userId }) {
  await db.pool.query(
    `INSERT INTO integration_connections (provider, secret_encrypted, label, connected_by, connected_at, disconnected_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW(), NULL, NOW())
     ON CONFLICT (provider) DO UPDATE
       SET secret_encrypted = EXCLUDED.secret_encrypted, label = EXCLUDED.label,
           connected_by = EXCLUDED.connected_by, connected_at = NOW(), disconnected_at = NULL, updated_at = NOW()`,
    [PROVIDER, encrypt(String(apiKey)), label || null, userId || null],
  );
  return apply();
}

async function disconnect({ userId }) {
  await db.pool.query(
    `INSERT INTO integration_connections (provider, secret_encrypted, label, connected_by, connected_at, disconnected_at, updated_at)
     VALUES ($1, NULL, NULL, $2, NULL, NOW(), NOW())
     ON CONFLICT (provider) DO UPDATE
       SET secret_encrypted = NULL, label = NULL, connected_by = EXCLUDED.connected_by,
           connected_at = NULL, disconnected_at = NOW(), updated_at = NOW()`,
    [PROVIDER, userId || null],
  );
  return apply();
}

module.exports = { resolve, apply, status, connect, disconnect, PROVIDER };
