// Playwright E2E config — STAGING ONLY. Never point E2E_BASE_URL at
// production: these tests sign in, create an invite and read permission
// boundaries. All external write flags must stay false.
require('dotenv').config({ path: '.env.e2e' });
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e/tests',
  timeout: 60000,
  expect: { timeout: 15000 },
  fullyParallel: false,      // shared staging app + one login rate limiter
  workers: 1,
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'https://opal-portal-staging.azurewebsites.net',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
});
