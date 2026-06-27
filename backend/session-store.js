/**
 * PgSessionStore
 *
 * A minimal express-session store backed by PostgreSQL.
 * Drop-in replacement for MemoryStore — no extra npm package needed.
 *
 * Table created automatically on first use:
 *
 *   CREATE TABLE IF NOT EXISTS sessions (
 *     sid     VARCHAR(255) PRIMARY KEY,
 *     sess    JSONB        NOT NULL,
 *     expire  TIMESTAMPTZ  NOT NULL
 *   );
 *
 * Implements the express-session Store contract:
 *   get(sid, cb)          — load a session
 *   set(sid, sess, cb)    — save / update a session
 *   destroy(sid, cb)      — delete a session
 *   touch(sid, sess, cb)  — refresh expiry without changing data
 *
 * Expired sessions are pruned every PRUNE_INTERVAL_MS (default 15 min).
 */

'use strict';

const { Store } = require('express-session');

const PRUNE_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

class PgSessionStore extends Store {
  /**
   * @param {import('pg').Pool} pool  — the existing pg Pool from database.js
   * @param {number} [ttlMs]          — session TTL in milliseconds (default 8 h)
   */
  constructor(pool, ttlMs = 8 * 60 * 60 * 1000) {
    super();
    this.pool  = pool;
    this.ttlMs = ttlMs;
    this._ready = this._ensureTable();

    // Prune expired rows periodically
    this._pruneTimer = setInterval(() => this._prune(), PRUNE_INTERVAL_MS);
    this._pruneTimer.unref(); // don't prevent process exit
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  async _ensureTable() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid    VARCHAR(255) PRIMARY KEY,
        sess   JSONB        NOT NULL,
        expire TIMESTAMPTZ  NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_expire_idx ON sessions (expire);
    `);
    console.log('💾 PgSessionStore: sessions table ready');
  }

  _expireAt(sess) {
    // Honour express-session's cookie.expires if present; otherwise use our TTL
    if (sess?.cookie?.expires) return new Date(sess.cookie.expires);
    return new Date(Date.now() + this.ttlMs);
  }

  async _prune() {
    try {
      const r = await this.pool.query(
        'DELETE FROM sessions WHERE expire < NOW()'
      );
      if (r.rowCount > 0) {
        console.log(`🗑️  PgSessionStore: pruned ${r.rowCount} expired session(s)`);
      }
    } catch (err) {
      console.error('PgSessionStore prune error:', err.message);
    }
  }

  // ── express-session Store interface ────────────────────────────────────────

  /** Load session by id. Calls cb(null, null) when not found or expired. */
  get(sid, cb) {
    this.pool.query(
      'SELECT sess FROM sessions WHERE sid = $1 AND expire > NOW()',
      [sid]
    ).then(r => {
      cb(null, r.rows.length ? r.rows[0].sess : null);
    }).catch(err => {
      console.error('PgSessionStore.get error:', err.message);
      cb(err);
    });
  }

  /** Save (upsert) a session. */
  set(sid, sess, cb) {
    const expire = this._expireAt(sess);
    this.pool.query(
      `INSERT INTO sessions (sid, sess, expire)
       VALUES ($1, $2, $3)
       ON CONFLICT (sid) DO UPDATE
         SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`,
      [sid, JSON.stringify(sess), expire]
    ).then(() => cb(null))
     .catch(err => {
       console.error('PgSessionStore.set error:', err.message);
       cb(err);
     });
  }

  /** Delete a session. */
  destroy(sid, cb) {
    this.pool.query('DELETE FROM sessions WHERE sid = $1', [sid])
      .then(() => cb(null))
      .catch(err => {
        console.error('PgSessionStore.destroy error:', err.message);
        cb(err);
      });
  }

  /** Refresh expiry without changing session data (called on rolling sessions). */
  touch(sid, sess, cb) {
    const expire = this._expireAt(sess);
    this.pool.query(
      'UPDATE sessions SET expire = $1 WHERE sid = $2',
      [expire, sid]
    ).then(() => cb(null))
     .catch(err => {
       console.error('PgSessionStore.touch error:', err.message);
       cb(err);
     });
  }

  /** (Optional) Return session count — useful for diagnostics. */
  length(cb) {
    this.pool.query('SELECT COUNT(*) FROM sessions WHERE expire > NOW()')
      .then(r => cb(null, parseInt(r.rows[0].count, 10)))
      .catch(err => cb(err));
  }

  /** (Optional) Delete all sessions — use with care. */
  clear(cb) {
    this.pool.query('DELETE FROM sessions')
      .then(() => cb(null))
      .catch(err => cb(err));
  }

  /** Stop the prune timer (call on graceful shutdown if desired). */
  close() {
    clearInterval(this._pruneTimer);
  }
}

module.exports = PgSessionStore;
