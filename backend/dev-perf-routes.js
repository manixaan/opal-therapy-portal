'use strict';

/**
 * DEVELOPMENT-ONLY client performance beacon.
 *
 * The shell (mockup_v3.html, first inline script) records the long
 * main-thread tasks during page load and posts a summary here, so a
 * "the page freezes for ten seconds after a refresh" report can be read off
 * the server log instead of guessed at. Mounted only when NODE_ENV is
 * 'development' (server.js), requires a session, accepts counts and script
 * names only, and stores nothing.
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('./permissions');

router.post('/api/dev/perf', requireAuth, express.json({ limit: '32kb' }), (req, res) => {
  const b = req.body || {};
  const nav = b.nav || {};
  const tasks = Array.isArray(b.longTasks) ? b.longTasks.slice(0, 15) : [];
  const lines = [
    `[perf] page=${String(b.path || '').slice(0, 60)} user=${req.user?.role || '?'}`,
    `[perf] parse→interactive ${nav.domInteractive}ms · DCL handlers ${nav.dclHandlers}ms · load ${nav.loadEnd}ms · resources ${b.resources} (${b.transferKB} KB)`,
    `[perf] long tasks: ${tasks.length}, total blocking ${b.blockingMs}ms, longest ${b.longestMs}ms`,
  ];
  tasks.forEach((t) => lines.push(`[perf]   ${String(t.start).padStart(6)}ms  ${String(t.dur).padStart(5)}ms  ${String(t.src || t.name || '?').slice(0, 90)}`));
  console.log(lines.join('\n'));
  res.status(204).end();
});

module.exports = router;
