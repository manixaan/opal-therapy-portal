'use strict';

/**
 * Shared helpers for PostgreSQL integration tests.
 *
 * Every test file:
 *   const { db, truncateAll, seedUser, closePool } = require('./helpers');
 *   beforeEach(truncateAll);
 *   afterAll(closePool);
 */

const db = require('../../database'); // env.js (setupFiles) has already forced *_test

// Runtime double-check on the LIVE pool config — belt and braces on top of env.js.
const poolDbName = db.pool.options.database;
if (!poolDbName || !poolDbName.endsWith('_test')) {
  throw new Error(`INTEGRATION-TEST SAFETY: pool is connected to "${poolDbName}", not a *_test database`);
}

const ALL_TABLES = [
  'sync_log', 'conflicts', 'events',
  'user_notifications', 'user_settings', 'org_settings',
  'leave_requests', 'cpd_activities', 'credentials', 'pd_documents',
  'user_invites', 'therapist_profiles',
  'outlook_delta_state', 'sessions', 'audit_logs',
  'users', 'organisations',
];

async function truncateAll() {
  await db.pool.query(`TRUNCATE ${ALL_TABLES.join(', ')} RESTART IDENTITY CASCADE`);
}

/** Insert a minimal active user and return the row. */
async function seedUser(overrides = {}) {
  const defaults = {
    email: `user-${Math.random().toString(36).slice(2, 8)}@test.invalid`,
    name: 'Test User',
    role: 'therapist',
    password_hash: '$2a$04$testhashnotreal000000000000000000000000000000000000000',
    account_status: 'active',
    email_verified: true,
    is_active: true,
  };
  const u = { ...defaults, ...overrides };
  const { rows } = await db.pool.query(
    `INSERT INTO users (email, name, role, password_hash, account_status, email_verified, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [u.email, u.name, u.role, u.password_hash, u.account_status, u.email_verified, u.is_active]
  );
  return rows[0];
}

/** Insert an organisation row and return it. */
async function seedOrganisation(name = 'Test Org') {
  const { rows } = await db.pool.query(
    'INSERT INTO organisations (name) VALUES ($1) RETURNING *', [name]
  );
  return rows[0];
}

/** Insert a session row for a user (mirrors PgSessionStore's shape). */
async function seedSession(userId, sid = `sid-${Math.random().toString(36).slice(2, 10)}`) {
  await db.pool.query(
    `INSERT INTO sessions (sid, sess, expire)
     VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
    [sid, JSON.stringify({ userId, cookie: {} })]
  );
  return sid;
}

async function closePool() {
  await db.pool.end();
}

module.exports = { db, truncateAll, seedUser, seedOrganisation, seedSession, closePool };
