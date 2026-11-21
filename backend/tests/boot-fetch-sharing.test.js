/**
 * P-07 (21 Nov 2026): faster boot.
 *
 * - The calendar's categories and events are asked for together as soon as
 *   auth has resolved (bootStep 'calendar prefetch'), and the loader fetches
 *   them in parallel instead of categories → events.
 * - Duplicate boot GETs share one response through a small fetch layer in
 *   <head>: exact URLs only, each caller gets its own clone, sharing ends at
 *   the first write or after 10 s, /api/events is reused once only.
 * Harness fix/tech/p07/boot.js at 4x CPU, median of 7: first tile painted
 * 1426 → 1334 ms (80 ms API latency), 1554 → 1346 ms (200 ms); boot GETs
 * 36 → 29, no duplicates. mirror.js: tiles, legs, mirror PUT identical.
 */
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '../../frontend/current/mockup_v3.html'), 'utf8');

function sharingScript() {
  const at = HTML.indexOf('/* P-07 — boot GET sharing.');
  expect(at).toBeGreaterThan(-1);
  return HTML.slice(at, HTML.indexOf('</script>', at));
}

function install(search) {
  const calls = [];
  const nativeFetch = (url, init) => {
    calls.push(((init && init.method) || 'GET') + ' ' + url);
    const n = calls.length;
    return Promise.resolve({ ok: !String(url).includes('fail'), n, clone() { return { n, cloned: true }; } });
  };
  const window = { fetch: nativeFetch };
  new Function('window', 'location', sharingScript())(window, { search: search || '' });
  return { fetch: window.fetch, calls };
}

describe('boot GET sharing (P-07)', () => {
  test('a repeated boot GET is one request; each caller gets its own clone', async () => {
    const w = install();
    const a = await w.fetch('/api/outlook/categories', { credentials: 'include' });
    const b = await w.fetch('/api/outlook/categories', { credentials: 'include' });
    const c = await w.fetch('/api/outlook/categories');
    expect(w.calls).toEqual(['GET /api/outlook/categories']);
    expect([a.cloned, b.cloned, c.cloned]).toEqual([true, true, true]);
  });

  test('only the listed exact URLs are shared; a query string is a different read', async () => {
    const w = install();
    await w.fetch('/api/notifications'); await w.fetch('/api/notifications');
    await w.fetch('/api/events?from=a&to=b'); await w.fetch('/api/events?from=a&to=b');
    expect(w.calls).toHaveLength(4);
  });

  test('/api/events is reused once (prefetch → first load), then asks again', async () => {
    const w = install();
    await w.fetch('/api/events'); await w.fetch('/api/events'); await w.fetch('/api/events');
    expect(w.calls).toEqual(['GET /api/events', 'GET /api/events']);
  });

  test('the first write ends sharing for good; route pricing does not count as a write', async () => {
    const w = install();
    await w.fetch('/api/sync-status');
    await w.fetch('/api/maps/routes', { method: 'POST' });
    await w.fetch('/api/sync-status');
    expect(w.calls.filter(c => c === 'GET /api/sync-status')).toHaveLength(1);
    await w.fetch('/api/outlook/events/9', { method: 'PATCH' });
    await w.fetch('/api/sync-status');
    expect(w.calls.filter(c => c === 'GET /api/sync-status')).toHaveLength(2);
  });

  test('a failed answer is not kept, and an OAuth return never shares', async () => {
    const w = install('?auth=complete');
    await w.fetch('/api/sync-status'); await w.fetch('/api/sync-status');
    expect(w.calls).toHaveLength(2);
    // a non-ok answer is dropped once it settles, so the next caller asks again
    const shared = new Function('window', 'location', sharingScript());
    const calls = [];
    const win = { fetch: (u) => { calls.push(u); return Promise.resolve({ ok: false, clone() { return {}; } }); } };
    shared(win, { search: '' });
    await win.fetch('/api/splose/services'); await new Promise(r => setTimeout(r, 0));
    await win.fetch('/api/splose/services');
    expect(calls).toHaveLength(2);
  });

  test('wiring: prefetch after auth, loader fetches categories and events together', () => {
    const auth = HTML.slice(HTML.indexOf('(async function initAuth() {'));
    const pre = auth.indexOf("bootStep('calendar prefetch'");
    expect(pre).toBeGreaterThan(auth.indexOf("fetch('/api/auth/me'"));
    expect(auth.slice(pre, pre + 300)).toContain("fetch('/api/events', { credentials: 'include' })");
    const load = HTML.slice(HTML.indexOf('async function loadOutlookEventsToCalendar() {'));
    const body = load.slice(0, load.indexOf('\n}\n'));
    expect(body).toMatch(/const _categoriesReady = [^;]*\? loadOutlookCategories\(\) : null;/);
    expect(body.indexOf('const _eventsResponse = fetch(url')).toBeLessThan(body.indexOf('if (_categoriesReady) await _categoriesReady;'));
    expect(body).not.toContain('await loadOutlookCategories();');
    // the loader is still started at window 'load', after the grid is set up
    expect(HTML).toMatch(/__renderWeekHeader\(\);[^\n]*\n\n  \/\/ Load Outlook events to calendar\n  loadOutlookEventsToCalendar\(\);/);
  });
});
