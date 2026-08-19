#!/usr/bin/env node
'use strict';

/**
 * Local E2E server — the synthetic environment the tutorial Playwright suite
 * runs against (playwright.local.config.js starts this via webServer).
 *
 * Uses the SAME dedicated synthetic database as the screenshot capture
 * (therapy_scheduler_capture): migrations + dev users + demo calendar + hub
 * seeds, zero real practice data. Never point this at the development
 * database — its events table mirrors a real mailbox.
 */

const { execFileSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DB = process.env.E2E_LOCAL_DB || 'therapy_scheduler_capture';
const PORT = process.env.E2E_LOCAL_PORT || '5009';

function sh(cmd, args) {
  execFileSync(cmd, args, {
    cwd: path.join(ROOT, 'backend'),
    env: { ...process.env, DB_NAME: DB },
    stdio: 'pipe',
  });
}

try { execFileSync('createdb', ['-U', process.env.DB_USER || 'postgres', DB], { stdio: 'pipe' }); } catch (e) { /* exists */ }
sh('node', ['migrate.js', 'up']);
sh('node', ['setup/seed-users.js']);
sh('node', ['setup/seed-demo-calendar.js']);
sh('node', ['setup/seed-resource-hub-r2.js']);
console.log(`── synthetic E2E database "${DB}" ready; starting server on :${PORT}`);

process.env.PORT = PORT;
process.env.DB_NAME = DB;
process.env.NODE_ENV = 'development';
process.env.ENABLE_OUTLOOK_WRITE = 'false';
process.env.ENABLE_SPLOSE_CALENDAR_SYNC = 'false';
process.env.WEBHOOK_BASE_URL = '';
process.env.ALLOWED_ORIGINS = `http://localhost:${PORT},http://127.0.0.1:${PORT}`;

require(path.join(ROOT, 'backend', 'server.js'));
