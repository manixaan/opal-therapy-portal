'use strict';

/**
 * Integration-test configuration — real PostgreSQL, real SQL.
 *
 *   npm run test:integration
 *
 * Safety: tests/integration/env.js hard-fails unless the database name ends
 * in "_test" (and refuses non-local hosts outside CI). globalSetup creates the
 * test database and applies the application schema.
 */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/integration/**/*.itest.js'],
  setupFiles: ['<rootDir>/tests/integration/env.js'],
  globalSetup: '<rootDir>/tests/integration/globalSetup.js',
  testTimeout: 20000,
  maxWorkers: 1, // serial — test files share one database and truncate between tests
};
