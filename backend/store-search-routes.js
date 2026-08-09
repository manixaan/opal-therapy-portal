/**
 * THERAPY STORE — supplier product search (Google Programmable Search Engine).
 *
 * A small search engine scoped to vetted OT-supply sites. The allowlist of
 * sites is configured in the Google PSE console (the engine ID *is* the
 * curation); this route is a thin authenticated proxy so the API key never
 * reaches the browser. Recommended engine site list (10 suppliers):
 *
 *   amazon.com.au              — general marketplace (AU)
 *   sensorytools.net           — Sensory Tools Australia
 *   specialneedstoys.com       — TFH Special Needs Toys (AUS store)
 *   teaching.com.au            — Modern Teaching Aids (educational/special needs)
 *   thetherapystore.com.au     — The Therapy Store (AU)
 *   sensoryoasisforkids.com.au — Sensory Oasis for Kids (AU)
 *   ilsau.com.au               — Independent Living Specialists (AT/equipment)
 *   aidacare.com.au            — Aidacare (equipment/DME)
 *   performancehealth.com.au   — Performance Health (hand therapy/rehab)
 *   pearsonclinical.com.au     — Pearson Clinical (assessment kits)
 *
 * Config (server-side only): GOOGLE_CSE_KEY + GOOGLE_CSE_CX. Absent config
 * degrades gracefully ({enabled:false}) — the curated catalogue still works.
 * Search snippets may mention prices; they are never treated as current —
 * the purchase request keeps its own approximate-cost + date-checked fields.
 * Purchasing itself remains human: search -> request -> owner approval.
 */

'use strict';

const express = require('express');
const axios = require('axios');
const { requireAuth } = require('./permissions');

const router = express.Router();

function enabled() {
  return !!(process.env.GOOGLE_CSE_KEY && process.env.GOOGLE_CSE_CX);
}

// Light per-user limiter (quota protection: 100 free queries/day upstream).
const _hits = new Map();
const WINDOW_MS = 5 * 60 * 1000;
const MAX_IN_WINDOW = 30;
function rateLimited(userId) {
  const now = Date.now();
  for (const [k, v] of _hits) { if (v.resetAt <= now) _hits.delete(k); }
  let e = _hits.get(userId);
  if (!e || e.resetAt <= now) { e = { n: 0, resetAt: now + WINDOW_MS }; _hits.set(userId, e); }
  e.n += 1;
  return e.n > MAX_IN_WINDOW;
}
function _resetStoreSearchRateLimit() { _hits.clear(); }

// In-memory result cache — identical queries within an hour cost no quota.
const _cache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000;

function mapItems(items) {
  return (items || []).slice(0, 8).map((it) => {
    const thumb = it.pagemap && it.pagemap.cse_thumbnail && it.pagemap.cse_thumbnail[0];
    return {
      title: String(it.title || '').slice(0, 200),
      link: /^https:\/\//i.test(it.link || '') ? it.link : null,
      snippet: String(it.snippet || '').slice(0, 300),
      site: String(it.displayLink || '').replace(/^www\./, ''),
      thumbnail: thumb && /^https:\/\//i.test(thumb.src || '') ? thumb.src : null,
    };
  }).filter((r) => r.link);
}

router.get('/api/store/search/config', requireAuth, (req, res) => {
  res.json({ enabled: enabled() });
});

router.get('/api/store/search', requireAuth, async (req, res) => {
  try {
    if (!enabled()) return res.json({ enabled: false, results: [] });
    const q = String(req.query.q || '').trim().slice(0, 120);
    if (q.length < 2) return res.status(400).json({ error: 'query_too_short' });
    if (rateLimited(req.user.id)) {
      return res.status(429).json({ error: 'rate_limited', message: 'Please wait a moment between searches.' });
    }

    const key = q.toLowerCase();
    const hit = _cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      return res.json({ enabled: true, cached: true, results: hit.results });
    }

    const resp = await axios.get('https://www.googleapis.com/customsearch/v1', {
      params: {
        key: process.env.GOOGLE_CSE_KEY,
        cx: process.env.GOOGLE_CSE_CX,
        q: q,
        num: 8,
        gl: 'au',
        safe: 'active',
      },
      timeout: 8000,
    });
    const results = mapItems(resp.data && resp.data.items);
    _cache.set(key, { at: Date.now(), results });
    res.json({ enabled: true, results });
  } catch (err) {
    const status = err.response && err.response.status;
    console.warn('store-search failed:', status || err.message);
    res.status(502).json({ error: 'search_unavailable', message: 'Product search is unavailable right now. The catalogue still works.' });
  }
});

const isHttpsUrl = (u) => { try { return new URL(u).protocol === 'https:'; } catch (e) { return false; } };

// Owner action: set/clear a product thumbnail directly.
router.post('/api/store/products/:id/thumbnail', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'owner') return res.status(403).json({ error: 'role_denied' });
    const url = req.body && req.body.url ? String(req.body.url).slice(0, 2000) : null;
    if (url && !isHttpsUrl(url)) return res.status(400).json({ error: 'invalid_url' });
    const db = require('./database');
    const r = await db.pool.query(
      `UPDATE resources SET thumbnail_url = $1, updated_at = NOW()
        WHERE id = $2 AND resource_type = 'product_link' RETURNING id`,
      [url, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'server_error' }); }
});

// Owner action: backfill missing catalogue thumbnails from supplier search.
// Explicit button press only — one PSE query per product without a photo.
router.post('/api/store/backfill-thumbnails', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'owner') return res.status(403).json({ error: 'role_denied' });
    if (!enabled()) return res.json({ enabled: false, updated: 0 });
    const db = require('./database');
    const rows = (await db.pool.query(
      `SELECT id, title FROM resources
        WHERE resource_type = 'product_link' AND status = 'approved'
          AND (thumbnail_url IS NULL OR thumbnail_url = '') LIMIT 20`)).rows;
    let updated = 0; const misses = [];
    for (const row of rows) {
      try {
        const resp = await axios.get('https://www.googleapis.com/customsearch/v1', {
          params: { key: process.env.GOOGLE_CSE_KEY, cx: process.env.GOOGLE_CSE_CX,
                    q: row.title, num: 3, gl: 'au', safe: 'active' },
          timeout: 8000,
        });
        const hit = mapItems(resp.data && resp.data.items).find((r2) => r2.thumbnail);
        if (hit) {
          await db.pool.query('UPDATE resources SET thumbnail_url = $1 WHERE id = $2', [hit.thumbnail, row.id]);
          updated += 1;
        } else misses.push(row.title);
      } catch (e) { misses.push(row.title); }
    }
    res.json({ enabled: true, scanned: rows.length, updated, misses });
  } catch (e) { res.status(500).json({ error: 'server_error' }); }
});

module.exports = router;
module.exports.mapItems = mapItems;
module.exports._resetStoreSearchRateLimit = _resetStoreSearchRateLimit;
