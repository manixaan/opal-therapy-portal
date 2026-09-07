#!/usr/bin/env node
'use strict';

/**
 * dev-setup — bring a fresh clone to a running localhost in one command.
 *
 *   npm run setup            # install deps, write backend/.env, create + migrate
 *                            # the local database, seed the dev logins
 *   npm run setup -- --demo  # also seed a demo calendar for the current week
 *   npm run setup -- --check # report what is missing, change nothing
 *
 * Idempotent: an existing backend/.env is never overwritten, an existing
 * database is migrated forward, the seed is upsert-only. Safe to re-run after
 * every `git pull`.
 *
 * What it deliberately does NOT do: it never writes a real Splose, Microsoft
 * or Xero credential, and it pins every remote-write flag to false. A second
 * machine set up with this script cannot touch the practice's live calendars
 * even if someone later pastes a key in — those flags have to be flipped on
 * purpose. See docs/TWO_MACHINE_DEV_WORKFLOW.md.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BACKEND = path.join(ROOT, 'backend');
const ENV_FILE = path.join(BACKEND, '.env');
const ENV_EXAMPLE = path.join(BACKEND, '.env.example');

const args = new Set(process.argv.slice(2));
const CHECK_ONLY = args.has('--check');
const WITH_DEMO = args.has('--demo');
const DB_USER = process.env.DB_USER || 'postgres';
const DB_NAME = process.env.DB_NAME || 'therapy_scheduler';
const DB_PASSWORD = process.env.DB_PASSWORD || '';

let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const info = (m) => console.log(`  · ${m}`);
const bad = (m, fix) => { failures++; console.log(`  ✗ ${m}`); if (fix) console.log(`      → ${fix}`); };
const step = (m) => console.log(`\n${m}`);

function have(cmd) {
  const r = spawnSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'pipe' });
  return r.status === 0;
}
function run(cmd, cmdArgs, opts = {}) {
  execFileSync(cmd, cmdArgs, { stdio: 'inherit', cwd: opts.cwd || BACKEND, env: { ...process.env, ...(opts.env || {}) } });
}

// ── 1. Toolchain ──────────────────────────────────────────────────────────────
step('1/6  Toolchain');
const major = Number(process.versions.node.split('.')[0]);
if (major >= 20 && major < 27) ok(`node ${process.versions.node}`);
else bad(`node ${process.versions.node} is outside the supported range (>=20 <27)`, 'nvm install 26 && nvm use 26   (the repo has an .nvmrc)');

if (have('npm')) ok('npm'); else bad('npm not found', 'install Node.js — npm ships with it');

for (const tool of ['psql', 'createdb']) {
  if (have(tool)) ok(tool);
  else bad(`${tool} not found`, 'brew install postgresql@14 && brew services start postgresql@14 && brew link --force postgresql@14');
}

// ── 2. PostgreSQL reachable ──────────────────────────────────────────────────
step('2/6  PostgreSQL');
const pgEnv = { ...process.env, PGPASSWORD: DB_PASSWORD };
const ping = spawnSync('psql', ['-U', DB_USER, '-d', 'postgres', '-Atc', 'select 1'], { stdio: 'pipe', env: pgEnv });
if (ping.status === 0) ok(`connected as ${DB_USER}@localhost`);
else bad(`cannot connect to PostgreSQL as "${DB_USER}"`,
  `is the service running? brew services list · does the role exist? createuser -s ${DB_USER} · wrong password? DB_PASSWORD=... npm run setup`);

// ── 3. backend/.env ───────────────────────────────────────────────────────────
step('3/6  backend/.env');
if (fs.existsSync(ENV_FILE)) {
  ok('backend/.env already exists — left untouched');
} else if (CHECK_ONLY) {
  bad('backend/.env is missing', 'npm run setup   (generates it with fresh secrets)');
} else {
  let env = fs.readFileSync(ENV_EXAMPLE, 'utf8');
  const set = (key, value) => {
    const re = new RegExp(`^${key}=.*$`, 'm');
    env = re.test(env) ? env.replace(re, `${key}=${value}`) : env + `\n${key}=${value}`;
  };
  const hex = (n) => crypto.randomBytes(n).toString('hex');

  set('DB_USER', DB_USER);
  set('DB_NAME', DB_NAME);
  set('DB_PASSWORD', DB_PASSWORD);
  set('SESSION_SECRET', hex(48));
  set('TOKEN_ENCRYPTION_KEY', hex(32));
  set('ONBOARDING_ENCRYPTION_KEY', hex(32));

  // No live integration credentials on a freshly set-up machine. Blank beats
  // the REPLACE_ME placeholder: a blank key switches the feature off, a
  // placeholder makes the app send garbage to a real API.
  for (const k of ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET', 'MICROSOFT_TENANT_ID',
                   'SPLOSE_API_KEY', 'GOOGLE_MAPS_API_KEY']) set(k, '');

  // Remote-write flags pinned off. Turning any of these on is a deliberate,
  // documented act — never a side effect of setup.
  for (const k of ['ENABLE_OUTLOOK_WRITE', 'ENABLE_SPLOSE_WRITE', 'ENABLE_SPLOSE_DRAFT_SYNC',
                   'ENABLE_AUTOMATIC_REMOTE_DELETE', 'ENABLE_XERO_WRITE']) set(k, 'false');
  set('ENABLE_SPLOSE_CALENDAR_SYNC', 'false');

  fs.writeFileSync(ENV_FILE, env, { mode: 0o600 });
  ok('wrote backend/.env with fresh random secrets and every remote-write flag off');
  info('(edit it later to add integration keys — it is gitignored and never leaves this machine)');
}

// ── 4. Dependencies ───────────────────────────────────────────────────────────
step('4/6  Dependencies');
const backendReady = fs.existsSync(path.join(BACKEND, 'node_modules', 'express'));
const rootReady = fs.existsSync(path.join(ROOT, 'node_modules', 'dotenv'));
if (CHECK_ONLY) {
  backendReady ? ok('backend/node_modules present') : bad('backend/node_modules missing', 'npm run setup');
  rootReady ? ok('root node_modules present (e2e tooling)') : info('root node_modules missing — only needed for Playwright e2e');
} else {
  if (!backendReady) run('npm', ['install']); else ok('backend/node_modules present');
  if (!rootReady) run('npm', ['install'], { cwd: ROOT }); else ok('root node_modules present');
}

// ── 5. Database create + migrate ──────────────────────────────────────────────
step('5/6  Database');
if (ping.status !== 0) {
  bad('skipped — PostgreSQL is not reachable (see step 2)');
} else {
  const exists = spawnSync('psql', ['-U', DB_USER, '-d', 'postgres', '-Atc',
    `select 1 from pg_database where datname='${DB_NAME}'`], { stdio: 'pipe', env: pgEnv });
  const dbExists = String(exists.stdout).trim() === '1';
  if (dbExists) ok(`database "${DB_NAME}" exists`);
  else if (CHECK_ONLY) bad(`database "${DB_NAME}" does not exist`, 'npm run setup');
  else { run('createdb', ['-U', DB_USER, DB_NAME], { env: { PGPASSWORD: DB_PASSWORD } }); ok(`created database "${DB_NAME}"`); }

  if (dbExists || !CHECK_ONLY) {
    if (CHECK_ONLY) {
      run('node', ['migrate.js', 'status'], { env: { DB_NAME, DB_USER, DB_PASSWORD } });
    } else {
      run('node', ['migrate.js', 'up'], { env: { DB_NAME, DB_USER, DB_PASSWORD } });
      ok('migrations applied');
    }
  }
}

// ── 6. Dev logins ─────────────────────────────────────────────────────────────
step('6/6  Development logins');
if (CHECK_ONLY || ping.status !== 0) {
  info('skipped');
} else {
  run('node', ['setup/seed-users.js'], { env: { DB_NAME, DB_USER, DB_PASSWORD } });
  ok('seeded owner@opaltherapy.dev / admin@opaltherapy.dev / therapist@opaltherapy.dev');
  if (WITH_DEMO) {
    run('node', ['setup/seed-demo-calendar.js'], { env: { DB_NAME, DB_USER, DB_PASSWORD } });
    ok('seeded a demo calendar for the current week');
  } else {
    info('add --demo for a populated week of demo appointments');
  }
}

// ── Done ──────────────────────────────────────────────────────────────────────
console.log('');
if (failures) {
  console.log(`${failures} item(s) need attention (marked ✗ above).`);
  process.exit(1);
}
if (CHECK_ONLY) {
  console.log('Everything checks out.');
} else {
  console.log('Ready.  Start the portal with:\n\n    npm start\n\nthen open http://localhost:5001 and sign in as owner@opaltherapy.dev (password OwnerDev2026!).');
  console.log('Daily workflow and the git rules for two machines: docs/TWO_MACHINE_DEV_WORKFLOW.md');
}
