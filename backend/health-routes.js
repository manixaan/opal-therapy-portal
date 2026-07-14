'use strict';

/**
 * HEALTH + READINESS ENDPOINTS (Phase 8)
 *
 * /health — liveness: is the Node process alive? Never touches dependencies,
 *           so a database outage cannot make the platform kill/restart the app.
 * /ready  — readiness: can the app serve meaningful requests? Checks the
 *           database, pending migrations, and configuration. Used by the
 *           deploy pipeline gate and the load balancer; returns 503 while
 *           draining after SIGTERM.
 *
 * Both return sanitised status only — no hosts, credentials, connection
 * strings, or infrastructure details.
 */

const express = require('express');
const router = express.Router();
const { pool } = require('./database');

const pkgVersion = require('./package.json').version;

let draining = false;
function setDraining(value) { draining = !!value; }

router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: pkgVersion,
    env: process.env.NODE_ENV || 'development',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

router.get('/ready', async (req, res) => {
  if (draining) {
    return res.status(503).json({ ready: false, reason: 'shutting_down' });
  }
  const checks = {};
  let ready = true;

  // Database reachable (bounded so a hung pool can't hang the probe)
  let dbTimer;
  try {
    await Promise.race([
      pool.query('SELECT 1'),
      new Promise((_, rej) => { dbTimer = setTimeout(() => rej(new Error('timeout')), 2500); }),
    ]);
    checks.database = 'ok';
  } catch (_) {
    checks.database = 'fail';
    ready = false;
  } finally {
    clearTimeout(dbTimer); // don't leave a dangling timer per probe
  }

  // Migrations applied and unmodified
  try {
    const rows = await require('./migrate').status();
    const pending = rows.filter(r => r.state === 'pending').length;
    const drift = rows.filter(r => r.state === 'CHECKSUM-DRIFT').length;
    checks.migrations =
      drift > 0 ? `drift:${drift}` : pending > 0 ? `pending:${pending}` : 'ok';
    if (pending > 0 || drift > 0) ready = false;
  } catch (_) {
    checks.migrations = 'unknown';
    ready = false;
  }

  // Configuration valid for this environment (boot already enforced strict
  // envs; this re-reports so the probe surfaces config drift after a restart)
  try {
    const v = require('./env-validation').validateEnvironment(process.env);
    checks.config = v.ok ? 'ok' : `issues:${v.errors.length}`;
    if (!v.ok) ready = false;
  } catch (_) {
    checks.config = 'unknown';
    ready = false;
  }

  res.status(ready ? 200 : 503).json({ ready, checks });
});

module.exports = { router, setDraining };
