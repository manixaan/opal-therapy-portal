'use strict';

module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  setupFiles: ['./tests/setup.js'],
  testTimeout: 15000,
  // Suppress noisy console.log from route handlers under test
  silent: false,
};
