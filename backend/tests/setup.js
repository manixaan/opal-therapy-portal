'use strict';

// Set all environment variables BEFORE any modules are loaded.
// Some modules (register-routes.js) read env vars at require-time.
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-session-secret-must-be-at-least-32-chars-long';
process.env.ALLOWED_DOMAINS = '';   // No domain allowlist in tests — invite required
process.env.ALLOWED_EMAILS  = '';   // No email allowlist in tests
process.env.APP_BASE_URL    = 'http://localhost:5001';
process.env.PORT            = '0';

// Prevent pg from attempting real connections
process.env.DB_HOST     = 'test-host-not-real';
process.env.DB_NAME     = 'test-db-not-real';
process.env.DB_USER     = 'test-user';
process.env.DB_PASSWORD = 'test-password';

// Prevent email module from failing on missing credentials
process.env.EMAIL_HOST = 'smtp.test.invalid';
process.env.EMAIL_PORT = '587';
process.env.EMAIL_USER = 'test@test.invalid';
process.env.EMAIL_PASS = 'test-pass';
process.env.EMAIL_FROM = 'Test <test@test.invalid>';
