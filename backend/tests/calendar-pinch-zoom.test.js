/**
 * Pinch to zoom the calendar's time axis (25 Nov 2026): a trackpad pinch over
 * the week grid changes HOUR_PX — spreading stretches the hours and every
 * event, pinching squeezes them — keeping the time under the pointer still.
 */
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '../../frontend/current/mockup_v3.html'), 'utf8');
function fnSrc(name) {
  const at = HTML.indexOf('function ' + name + '(');
  expect(at).toBeGreaterThan(-1);
  const rest = HTML.slice(at);
  return rest.slice(0, rest.indexOf('\n}\n') + 2);
}

/* A tile element just real enough for applySessionDensity. */
function fakeTile(sub = '64 Talbot Ave, Como') {
  const cls = new Set(), vars = {};
  return {
    isConnected: true, closest: () => true, cls, vars,
    classList: { add: (...c) => c.forEach(x => cls.add(x)), remove: (...c) => c.forEach(x => cls.delete(x)) },
    style: { setProperty: (k, v) => { vars[k] = v; } },
    querySelector: () => ({ textContent: sub }),
  };
}

/* setCalendarHourPx in a tiny world: one grid (scrollable), one column, tiles. */
function world({ hourPx = 72, colTop = 100, scrollTop = 500 } = {}) {
  const grid = { scrollTop, getBoundingClientRect: () => ({ top: 0, height: 600 }) };
  const col = { getBoundingClientRect: () => ({ top: colTop - grid.scrollTop }) };
  const tile = (startH, startM, dur, extra = {}) => ({
    startH, startM, endH: startH + Math.floor((startM + dur) / 60), endM: (startM + dur) % 60,
    element: fakeTile(), ...extra,
  });
  const SESSIONS = { a: tile(9, 0, 60), b: tile(13, 30, 30), all: tile(0, 0, 60, { allDay: true }) };
  const store = {};
  const rebuilt = { n: 0 };
  const make = new Function('env', `
    const HOUR_PX_MIN = 36, HOUR_PX_MAX = 216, START_H = 0;
    let HOUR_PX = env.hourPx;
    const { SESSIONS, document, localStorage, rebuilt } = env;
    function rebuildCalendarGrid() { rebuilt.n++; }
    function tToY(h, m = 0) { return ((h - START_H) + m / 60) * HOUR_PX; }
    function durMin(s) { return (s.endH - s.startH) * 60 + ((s.endM || 0) - (s.startM || 0)); }
    function sessionStartMin(s) { return s.startH * 60 + (s.startM || 0); }
    ${fnSrc('sessionTileHeight')}
    ${fnSrc('applySessionDensity')}
    ${fnSrc('setCalendarHourPx')}
    return { set: setCalendarHourPx, px: () => HOUR_PX, density: applySessionDensity };
  `);
  const api = make({
    hourPx, SESSIONS, rebuilt,
    document: { getElementById: () => grid, querySelector: () => col },
    localStorage: { setItem: (k, v) => { store[k] = v; } },
  });
  return { api, grid, col, SESSIONS, store, rebuilt, colTop };
}

describe('setCalendarHourPx', () => {
  test('spreading stretches the hours and every timed tile with them', () => {
    const w = world();
    expect(w.api.set(144, 300)).toBe(true);
    expect(w.api.px()).toBe(144);
    expect(w.rebuilt.n).toBe(1);
    expect(w.SESSIONS.a.element.style.top).toBe(9 * 144 + 'px');
    expect(w.SESSIONS.a.element.style.height).toBe(144 - 4 + 'px');
    expect(w.SESSIONS.b.element.style.top).toBe(13.5 * 144 + 'px');
    expect(w.SESSIONS.all.element.style.top).toBeUndefined(); // all-day chips are not on the time axis
    expect(w.store['opal.calendar.hourPx']).toBe('144');
  });

  test('the time under the pointer stays under the pointer', () => {
    const w = world({ scrollTop: 500 });
    const y = 300;
    const minBefore = (y - w.col.getBoundingClientRect().top) / 72 * 60;
    w.api.set(120, y);
    const minAfter = (y - w.col.getBoundingClientRect().top) / 120 * 60;
    expect(minAfter).toBeCloseTo(minBefore, 6);
  });

  test('pinching is bounded: never below 36 px nor above 216 px an hour', () => {
    const w = world();
    w.api.set(5, 100); expect(w.api.px()).toBe(36);
    w.api.set(9999, 100); expect(w.api.px()).toBe(216);
  });

  test('stretched tiles show more: a 30-min tile gains its title lines and its location', () => {
    const w = world();
    const b = w.SESSIONS.b.element;               // 13:30, 30 min
    b.style.height = '26px'; w.api.density(b, 30); // as drawn at 72 px/h
    expect(b.cls.has('s-compact')).toBe(true);
    w.api.set(216, 300);
    expect(b.cls.has('s-compact')).toBe(false);
    expect(b.cls.has('s-med')).toBe(false);        // location line now shows
    expect(Number(b.vars['--lines'])).toBeGreaterThan(2);
    expect(b.vars['--sub-lines']).toBe('2');
    w.api.set(36, 300);                            // squeezed back: tidy again
    expect(b.cls.has('s-compact')).toBe(true);
  });

  test('default zoom keeps the old duration thresholds exactly', () => {
    const w = world();
    const t = fakeTile();
    const at = (min) => { t.style.height = (min / 60 * 72 - 4) + 'px'; w.api.density(t, min); return [...t.cls].sort().join(' '); };
    expect(at(10)).toBe('s-compact s-tiny');
    expect(at(39)).toBe('s-compact');
    expect(at(40)).toBe('s-med');
    expect(at(65)).toBe('s-med');
    expect(at(66)).toBe('');
  });

  test('no change → nothing redrawn', () => {
    const w = world({ hourPx: 36 });
    expect(w.api.set(20, 100)).toBe(false);
    expect(w.rebuilt.n).toBe(0);
  });
});

describe('the gesture wiring', () => {
  test('HOUR_PX is adjustable, starts from the remembered scale, and keys the full redraw', () => {
    expect(HTML).toMatch(/let HOUR_PX = \(function \(\) \{/);
    expect(HTML).toContain("localStorage.getItem('opal.calendar.hourPx')");
    expect(HTML).not.toMatch(/const HOUR_PX = 72/);
    expect(HTML).toContain("typeof HOUR_PX !== 'undefined' ? HOUR_PX : ''].join('~')");
  });
  test('only a pinch (ctrl+wheel) zooms; a plain two-finger scroll still scrolls', () => {
    const src = HTML.slice(HTML.indexOf('(function initCalendarPinchZoom()'));
    expect(src).toContain("if (!e.ctrlKey) return;");
    expect(src).toContain("e.preventDefault();                // not the browser's page zoom");
    expect(src).toMatch(/addEventListener\('wheel', e => \{[\s\S]*?\}, \{ passive: false \}\);/);
  });
  test('travel legs follow the pinch live, from cache, with no easing lag', () => {
    expect(fnSrc('setCalendarHourPx')).toContain('redrawTravelLegsFromCache()');
    expect(HTML).toContain('#cal-grid.cal-zooming .travel-overlay { transition: none !important; }');
    const travel = fs.readFileSync(path.join(__dirname, '../../frontend/current/travel.js'), 'utf8');
    const at = travel.indexOf('function redrawTravelLegsFromCache(');
    expect(at).toBeGreaterThan(-1);
    const body = travel.slice(at, travel.indexOf('\n}\n', at));
    expect(body).toContain('DAY_SEGMENTS.get(col.dataset.day)');   // cached segments: no routing
    expect(body).not.toMatch(/computeDayTravelSegments|scheduleCalendarMinutes|scheduleTravelOutlookSync/);
  });
  test('Safari pinch (gesture events) scales from where the pinch began', () => {
    expect(HTML).toContain("schedule(gestureStart * e.scale, e.clientY)");
  });
});
