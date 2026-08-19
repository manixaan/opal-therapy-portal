// Playwright config for the LOCAL synthetic environment (tutorial E2E).
// `npm run test:e2e:local` — starts its own server against the disposable
// therapy_scheduler_capture database (see scripts/e2e-local-server.js).
// The staging config (playwright.config.js) is unchanged and staging-only.
const { defineConfig } = require('@playwright/test');

// The synthetic dev accounts (backend/setup/seed-users.js). Local only —
// these credentials exist in no deployed environment.
process.env.E2E_OWNER_EMAIL = process.env.E2E_OWNER_EMAIL || 'owner@opaltherapy.dev';
process.env.E2E_OWNER_PASSWORD = process.env.E2E_OWNER_PASSWORD || 'OwnerDev2026!';
process.env.E2E_THERAPIST_EMAIL = process.env.E2E_THERAPIST_EMAIL || 'therapist@opaltherapy.dev';
process.env.E2E_THERAPIST_PASSWORD = process.env.E2E_THERAPIST_PASSWORD || 'TherapistDev2026!';

module.exports = defineConfig({
  testDir: './e2e/tests',
  testMatch: /tutorials\.spec\.js/,
  timeout: 90000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5009',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  webServer: {
    command: 'node scripts/e2e-local-server.js',
    port: 5009,
    timeout: 120000,
    reuseExistingServer: true,
  },
});
