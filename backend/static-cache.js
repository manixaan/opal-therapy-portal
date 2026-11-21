'use strict';

/**
 * Cache headers for the static frontend (audit P-06 part 2, 21 Nov 2026).
 *
 * Every <script>/<link> in mockup_v3.html carries a ?v=N pin (asserted by
 * tests/assessment-surface-guards.test.js and scripts/check-asset-pins.js),
 * and a changed file gets a new N. So a request WITH ?v= names one exact
 * version of the file and may be cached for a year without revalidation —
 * that is what removes ~70 conditional requests from every shell load.
 *
 *   asset requested with ?v=…   → public, max-age=31536000, immutable
 *   any .html file              → no-cache (always revalidated, so a deploy
 *                                 is picked up — the Azure staging proxy does
 *                                 not revalidate on its own)
 *   everything else             → express.static's default (public, max-age=0
 *                                 + ETag), unchanged
 *
 * Risk: a file changed WITHOUT bumping its ?v= pin is served stale for up to
 * a year to anyone who already has it. The pin guard test and
 * check-asset-pins.js are the mitigation; they must stay in the commit flow.
 */

const path = require('path');

const IMMUTABLE = 'public, max-age=31536000, immutable';
const NO_CACHE = 'no-cache';

function hasVersionPin(url) {
  const q = String(url || '').split('?')[1];
  if (!q) return false;
  return q.split('&').some((kv) => /^v=[^&]+$/.test(kv));
}

/** serve-static `setHeaders(res, filePath)` — runs before send's default Cache-Control. */
function setStaticCacheHeaders(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html' || ext === '.htm') {
    res.setHeader('Cache-Control', NO_CACHE);
    return;
  }
  const req = res.req;
  if (req && hasVersionPin(req.originalUrl || req.url)) res.setHeader('Cache-Control', IMMUTABLE);
}

module.exports = { setStaticCacheHeaders, hasVersionPin, IMMUTABLE, NO_CACHE };
