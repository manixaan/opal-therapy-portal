#!/usr/bin/env node
'use strict';

/**
 * TUTORIAL SCREENSHOT CAPTURE — repeatable, synthetic-only.
 *
 *   npm run tutorials:capture            # capture everything
 *   npm run tutorials:capture -- --only portal-using-calendar   # one module's shots
 *
 * What it does:
 *   1. Prepares the dedicated SYNTHETIC capture database
 *      (therapy_scheduler_capture): migrations + dev users + demo calendar +
 *      Resource Hub seeds. It contains ZERO real client/practice data — the
 *      development database must NEVER be used here, because its events
 *      table mirrors a real Outlook mailbox.
 *   2. Starts its own server instance on CAPTURE_PORT (5008) against that
 *      database, waits for /health, then drives it with Playwright at a
 *      fixed 1440×900 viewport.
 *   3. Signs in as the synthetic accounts (owner / therapist dev accounts,
 *      demo therapists), stages each screen, and writes PNGs into
 *      frontend/current/assets/tutorials/ — the paths the induction module
 *      registry references.
 *   4. Shuts the server down. The capture DB is left in place for re-runs.
 *
 * Adding a screenshot: add an entry to CAPTURES below (see the shape doc),
 * run the script, and reference /assets/tutorials/<out> from the step.
 *
 * Never point this at staging or production, and never capture from a
 * database that has synced a real mailbox.
 */

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'frontend', 'current', 'assets', 'tutorials');
const PORT = Number(process.env.CAPTURE_PORT || 5008);
const BASE = `http://localhost:${PORT}`;
const DB = process.env.CAPTURE_DB || 'therapy_scheduler_capture';
const VIEWPORT = { width: 1440, height: 900 };

const ACCOUNTS = {
  owner: { email: 'owner@opaltherapy.dev', password: 'OwnerDev2026!' },
  therapist: { email: 'therapist@opaltherapy.dev', password: 'TherapistDev2026!' },
  admin: { email: 'admin@opaltherapy.dev', password: 'AdminDev2026!' },
  maya: { email: 'demo.maya@opaltherapy.dev', password: 'DemoDev2026!' },
};

const only = (() => {
  const i = process.argv.indexOf('--only');
  return i === -1 ? null : process.argv[i + 1];
})();

// ── DB prep ─────────────────────────────────────────────────────────────────

function sh(cmd, args, env) {
  execFileSync(cmd, args, {
    cwd: path.join(ROOT, 'backend'),
    env: { ...process.env, DB_NAME: DB, ...env },
    stdio: 'pipe',
  });
}

function prepareDb() {
  console.log(`── preparing synthetic capture database "${DB}"`);
  try { execFileSync('createdb', ['-U', process.env.DB_USER || 'postgres', DB], { stdio: 'pipe' }); }
  catch (e) { /* exists */ }
  sh('node', ['migrate.js', 'up']);
  sh('node', ['setup/seed-users.js']);
  sh('node', ['setup/seed-demo-calendar.js']);
  sh('node', ['setup/seed-resource-hub-r2.js']);
}

async function sql(text) {
  // One short-lived pg client via the backend's own dependency.
  const { Pool } = require(path.join(ROOT, 'backend', 'node_modules', 'pg'));
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: DB,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
  });
  try { return await pool.query(text); } finally { await pool.end(); }
}

// ── Server lifecycle ────────────────────────────────────────────────────────

let serverProc = null;

async function startServer() {
  console.log(`── starting capture server on :${PORT}`);
  serverProc = spawn('node', ['server.js'], {
    cwd: path.join(ROOT, 'backend'),
    env: {
      ...process.env,
      PORT: String(PORT),
      DB_NAME: DB,
      NODE_ENV: 'development',
      // Keep the capture instance quiet and side-effect free.
      ENABLE_OUTLOOK_WRITE: 'false',
      ENABLE_SPLOSE_CALENDAR_SYNC: 'false',
      WEBHOOK_BASE_URL: '',
      ALLOWED_ORIGINS: `${BASE},http://127.0.0.1:${PORT}`,
    },
    stdio: 'pipe',
  });
  serverProc.stderr.on('data', () => {});
  serverProc.stdout.on('data', () => {});
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
    } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error('capture server did not become healthy');
}

function stopServer() {
  if (serverProc) { serverProc.kill('SIGTERM'); serverProc = null; }
}

// ── Browser helpers ─────────────────────────────────────────────────────────

async function login(page, who) {
  const a = ACCOUNTS[who];
  await page.goto(`${BASE}/login`);
  await page.fill('#email', a.email);
  await page.fill('#password', a.password);
  await page.click('#login-btn');
  await page.waitForURL((u) => !String(u).includes('/login'), { timeout: 20000 });
  await page.waitForFunction(() => window.APP_USER && window.NAV_ALLOWED_TABS, { timeout: 15000 });
}

async function settle(page, ms = 900) {
  await page.waitForTimeout(ms);
}

/**
 * CAPTURE SHAPE
 *   out:    file under frontend/current/assets/tutorials/
 *   role:   ACCOUNTS key to sign in as (context is per-role, reused in order)
 *   module: induction module the shot belongs to (--only filter)
 *   prep:   async (page) — stage the screen
 *   clip:   optional {x,y,width,height} viewport region (defaults full view)
 */
const CAPTURES = [
  // ── Module thumbnails ──
  {
    out: 'portal-getting-started.png', role: 'therapist', module: 'portal-getting-started',
    prep: async (p) => { await p.evaluate(() => switchTab('calendar')); await settle(p, 1400); },
  },
  {
    out: 'portal-profile-documents.png', role: 'therapist', module: 'portal-profile-documents',
    prep: async (p) => { await p.evaluate(() => switchTab('profile')); await settle(p, 1400); },
  },
  {
    out: 'portal-connecting-outlook.png', role: 'owner', module: 'portal-connecting-outlook',
    prep: async (p) => {
      await p.evaluate(() => { switchTab('settings'); showSettingsSection('integration-settings'); });
      await settle(p, 1200);
    },
  },
  {
    out: 'portal-using-calendar.png', role: 'therapist', module: 'portal-using-calendar',
    prep: async (p) => { await p.evaluate(() => switchTab('calendar')); await settle(p, 1400); },
    clip: { x: 0, y: 60, width: 1440, height: 840 },
  },
  {
    out: 'portal-master-scheduler.png', role: 'owner', module: 'portal-master-scheduler',
    prep: async (p) => {
      await p.evaluate(() => { switchTab('calendar'); setCalendarMode('master'); });
      await p.waitForSelector('.sm-row', { timeout: 15000 });
      await settle(p, 1200);
    },
    clip: { x: 0, y: 60, width: 1440, height: 840 },
  },
  {
    out: 'portal-booking-appointment.png', role: 'owner', module: 'portal-booking-appointment',
    prep: async (p) => {
      await p.evaluate(() => switchTab('calendar'));
      await settle(p, 800);
      await p.evaluate(() => openBookingPanel());
      await settle(p, 1000);
    },
  },
  {
    out: 'portal-travel-logbook.png', role: 'therapist', module: 'portal-travel-logbook',
    prep: async (p) => { await p.evaluate(() => switchTab('logbook')); await settle(p, 1600); },
  },
  {
    out: 'portal-resource-hub.png', role: 'therapist', module: 'portal-resource-hub',
    prep: async (p) => { await p.evaluate(() => switchTab('resources')); await settle(p, 1800); },
  },
  {
    out: 'portal-notifications.png', role: 'therapist', module: 'portal-notifications',
    prep: async (p) => { await p.evaluate(() => openNotificationsPanel()); await settle(p, 1000); },
  },
  {
    out: 'portal-inviting-therapists.png', role: 'owner', module: 'portal-inviting-therapists',
    prep: async (p) => {
      await p.evaluate(() => { switchTab('settings'); showSettingsSection('user-management'); });
      await settle(p, 1400);
    },
  },
  {
    out: 'portal-opa-assistant.png', role: 'therapist', module: 'portal-opa-assistant',
    prep: async (p) => {
      await p.evaluate(() => window.Opa && Opa.open());
      await settle(p, 1000);
    },
  },

  // ── Step screenshots ──
  {
    out: 'portal-connecting-outlook/connect-banner.png', role: 'therapist', module: 'portal-connecting-outlook',
    prep: async (p) => { await p.evaluate(() => switchTab('calendar')); await settle(p, 1400); },
    clip: { x: 140, y: 60, width: 1300, height: 360 },
  },
  {
    out: 'portal-using-calendar/week-blocks.png', role: 'therapist', module: 'portal-using-calendar',
    prep: async (p) => { await p.evaluate(() => switchTab('calendar')); await settle(p, 1400); },
    clip: { x: 140, y: 100, width: 1300, height: 700 },
  },
  {
    out: 'portal-using-calendar/detail-drawer.png', role: 'therapist', module: 'portal-using-calendar',
    prep: async (p) => {
      await p.evaluate(() => switchTab('calendar'));
      await settle(p, 1400);
      await p.locator('.session').first().click();
      await settle(p, 900);
    },
  },
  {
    out: 'portal-master-scheduler/matrix.png', role: 'owner', module: 'portal-master-scheduler',
    prep: async (p) => {
      await p.evaluate(() => { switchTab('calendar'); setCalendarMode('master'); });
      await p.waitForSelector('.sm-row .sm-track', { timeout: 15000 });
      await settle(p, 1400);
    },
    clip: { x: 0, y: 130, width: 1440, height: 620 },
  },
  {
    out: 'portal-master-scheduler/status-chips.png', role: 'owner', module: 'portal-master-scheduler',
    prep: async (p) => {
      await p.evaluate(() => { switchTab('calendar'); setCalendarMode('master'); });
      await p.waitForSelector('.sm-row .sm-track', { timeout: 15000 });
      await settle(p, 1200);
      // Propose a slot by clicking clear track space (late morning).
      const track = p.locator('.sm-row .sm-track').first();
      await track.click({ position: { x: 700, y: 20 } });
      await settle(p, 1200);
    },
    clip: { x: 0, y: 60, width: 1440, height: 620 },
  },
  {
    out: 'portal-booking/booking-for-strip.png', role: 'owner', module: 'portal-booking-appointment',
    prep: async (p) => {
      await p.evaluate(() => switchTab('calendar'));
      await settle(p, 800);
      await p.evaluate(() => openBookingPanel());
      await settle(p, 1400);
    },
    clip: { x: 880, y: 0, width: 560, height: 480 },
  },
  {
    out: 'portal-notifications/sync-writeback.png', role: 'therapist', module: 'portal-notifications',
    prep: async (p) => { await p.evaluate(() => openNotificationsPanel()); await settle(p, 1000); },
    clip: { x: 880, y: 0, width: 560, height: 640 },
  },
  {
    out: 'portal-notifications/profile-notifications-card.png', role: 'therapist', module: 'portal-notifications',
    prep: async (p) => { await p.evaluate(() => switchTab('profile')); await settle(p, 1400); },
  },
  {
    out: 'portal-opa/fab.png', role: 'therapist', module: 'portal-opa-assistant',
    prep: async (p) => {
      await p.evaluate(() => {
        if (typeof closeNotificationsPanel === 'function') try { closeNotificationsPanel(); } catch (e) {}
        switchTab('calendar');
        if (window.Opa) Opa.close();
      });
      await settle(p, 1000);
    },
    clipTo: '#opa-fab', clipPad: 60,
  },
  {
    out: 'portal-opa/suggestions.png', role: 'therapist', module: 'portal-opa-assistant',
    prep: async (p) => {
      await p.evaluate(() => {
        if (typeof closeNotificationsPanel === 'function') try { closeNotificationsPanel(); } catch (e) {}
        if (window.Opa) Opa.open();
      });
      await settle(p, 1200);
    },
    clipTo: '#opa-panel', clipPad: 16,
  },
  {
    out: 'portal-inviting-therapists/register-invited.png', role: 'owner', module: 'portal-inviting-therapists',
    prep: async (p, h) => {
      // Create a throwaway synthetic invite via the API (email send may fail
      // harmlessly), read its token straight from the capture DB, and open
      // the register page with it. The capture DB is disposable.
      await p.evaluate(async () => {
        await fetch('/api/invites', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'jane.example@example.test', role: 'therapist' }),
        }).catch(() => {});
      });
      const r = await h.sql(
        `SELECT invite_token FROM user_invites WHERE email = 'jane.example@example.test'
         ORDER BY created_at DESC LIMIT 1`);
      const token = r.rows[0] && r.rows[0].invite_token;
      if (!token) throw new Error('could not create synthetic invite');
      await p.goto(`${BASE}/register?token=${token}`);
      await settle(p, 1600);
    },
  },
];

// ── Special: Microsoft sign-in page (network-dependent, skipped on failure) ──

async function captureMicrosoftPage(browser) {
  const file = 'portal-connecting-outlook/account-picker.png';
  if (only && only !== 'portal-connecting-outlook') return;
  try {
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    const r = await fetch(`${BASE}/auth/outlook-login?returnUrl=${encodeURIComponent(BASE + '/')}`);
    const d = await r.json();
    if (!d.authUrl) throw new Error('no authUrl');
    await page.goto(d.authUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1500);
    const out = path.join(OUT_DIR, file);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await page.screenshot({ path: out });
    console.log(`  ✓ ${file} (Microsoft sign-in page)`);
    await ctx.close();
  } catch (e) {
    console.log(`  ~ skipped ${file}: ${e.message} (offline or OAuth unconfigured — the step degrades to its text)`);
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

(async () => {
  prepareDb();

  // Synthetic notification for the notifications-panel screenshots.
  await sql(`
    INSERT INTO user_notifications (user_id, type, title, message, severity, status, action_payload)
    SELECT id, 'outlook_writeback_failed',
           'Outlook write-back failed',
           'A travel time block could not be added to your Outlook calendar (Travel: Example Clinic → Fictional Client). Try reconnecting Outlook.',
           'warning', 'unread', '{"action":"reconnect_outlook"}'::jsonb
    FROM users WHERE email = 'therapist@opaltherapy.dev'
      AND NOT EXISTS (SELECT 1 FROM user_notifications n2, users u2
                       WHERE n2.user_id = u2.id AND u2.email = 'therapist@opaltherapy.dev'
                         AND n2.type = 'outlook_writeback_failed')`);

  await startServer();
  const browser = await chromium.launch();
  const contexts = {}; // role → {ctx, page}

  // Ordered so the "not connected" banner shot happens BEFORE we fake the
  // therapist's Outlook connection for the clean calendar shots.
  const jobs = CAPTURES.filter((c) => !only || c.module === only);
  let done = 0, failed = 0;

  async function pageFor(role) {
    if (!contexts[role]) {
      const ctx = await browser.newContext({ viewport: VIEWPORT });
      const page = await ctx.newPage();
      await login(page, role);
      contexts[role] = { ctx, page };
    }
    return contexts[role].page;
  }

  for (const cap of jobs) {
    // Fake the connection AFTER the banner capture so later calendar shots
    // are banner-free. Purely local: a placeholder token in the capture DB.
    if (cap.out === 'portal-using-calendar/week-blocks.png' || cap.out === 'portal-using-calendar.png') {
      await sql(`UPDATE users SET access_token = 'capture-placeholder',
                 outlook_connected_email = email
                 WHERE email IN ('therapist@opaltherapy.dev') AND access_token IS NULL`);
      if (contexts.therapist) { await contexts.therapist.page.reload(); await contexts.therapist.page.waitForFunction(() => window.APP_USER, { timeout: 15000 }); await settle(contexts.therapist.page, 1200); }
    }
    try {
      const page = await pageFor(cap.role);
      await cap.prep(page, { sql });
      const out = path.join(OUT_DIR, cap.out);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      let clip = cap.clip;
      if (cap.clipTo) {
        // Element-anchored crop, padded and clamped to the viewport.
        const box = await page.locator(cap.clipTo).boundingBox();
        if (!box) throw new Error(`clipTo "${cap.clipTo}" not visible`);
        const pad = cap.clipPad || 12;
        const x = Math.max(0, box.x - pad), y = Math.max(0, box.y - pad);
        clip = {
          x, y,
          width: Math.min(VIEWPORT.width - x, box.width + pad * 2),
          height: Math.min(VIEWPORT.height - y, box.height + pad * 2),
        };
      }
      await page.screenshot({ path: out, clip });
      const kb = Math.round(fs.statSync(out).size / 1024);
      console.log(`  ✓ ${cap.out} (${cap.role}, ${kb} KB)`);
      done++;
    } catch (e) {
      console.log(`  ✗ ${cap.out}: ${e.message.split('\n')[0]}`);
      failed++;
    }
  }

  await captureMicrosoftPage(browser);

  await browser.close();
  stopServer();
  console.log(`\n${done} captured, ${failed} failed.`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); stopServer(); process.exit(1); });
