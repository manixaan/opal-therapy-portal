'use strict';

/**
 * Integration-test environment — runs BEFORE any module is loaded.
 *
 * Loads the real backend/.env for local Postgres credentials, then FORCES the
 * database name to an isolated *_test database. A hard guard below makes it
 * impossible for the integration suite to touch a non-test database, no matter
 * what the surrounding environment claims.
 */

// Mirror server.js:20 — the application pins the process to UTC before any
// require so pg's timestamp (no-tz) binding is consistent. Tests must run
// under the same contract or Date round-trips shift by the local offset.
process.env.TZ = 'UTC';

require('dotenv').config();

process.env.NODE_ENV = 'test';

// Force an isolated test database, derived from (but never equal to) the dev name.
const baseName = process.env.DB_NAME || 'therapy_scheduler';
process.env.DB_NAME = baseName.endsWith('_test') ? baseName : `${baseName}_test`;

// ── HARD SAFETY GUARD ────────────────────────────────────────────────────────
// Integration tests execute real DDL/DML including TRUNCATE. Refuse to run
// against anything that does not look like a dedicated test database.
const PRODUCTION_NAME_PATTERNS = [/prod/i, /live/i];
if (!process.env.DB_NAME.endsWith('_test')) {
  throw new Error(
    `INTEGRATION-TEST SAFETY: DB_NAME "${process.env.DB_NAME}" must end in "_test".`
  );
}
if (PRODUCTION_NAME_PATTERNS.some((re) => re.test(process.env.DB_NAME))) {
  throw new Error(
    `INTEGRATION-TEST SAFETY: DB_NAME "${process.env.DB_NAME}" matches a production naming pattern.`
  );
}
const host = process.env.DB_HOST || 'localhost';
if (process.env.CI !== 'true' && !['localhost', '127.0.0.1'].includes(host)) {
  throw new Error(
    `INTEGRATION-TEST SAFETY: refusing non-local DB_HOST "${host}" outside CI.`
  );
}

// Neutralise outbound integrations for the test process.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'integration-test-secret-at-least-32-chars-long';
process.env.ALLOWED_DOMAINS = '';
process.env.ALLOWED_EMAILS = '';
process.env.EMAIL_HOST = '';
process.env.EMAIL_USER = '';
process.env.EMAIL_PASS = '';
process.env.SPLOSE_API_KEY = 'integration-test-not-real';
process.env.GOOGLE_MAPS_API_KEY = '';
process.env.WEBHOOK_BASE_URL = '';
// outlook-oauth reads these at module load; fake values let the pure URL
// builder (/auth/outlook-login) be exercised without any real credentials.
process.env.MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID || 'integration-test-client-id';
process.env.MICROSOFT_CLIENT_SECRET = 'integration-test-not-real';
process.env.MICROSOFT_REDIRECT_URI = 'http://localhost:5001/auth/oauth/callback';
