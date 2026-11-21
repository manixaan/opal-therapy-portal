/**
 * C-13 / P-04: a reload redraws only the days whose events — or tiles —
 * changed; nothing at all when nothing changed. A booking on a visible day
 * no longer re-renders the whole week from the stale cache first.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML = fs.readFileSync(path.join(__dirname, '../../frontend/current/mockup_v3.html'), 'utf8');
function fnSrc(head) {
  const at = HTML.indexOf(head);
  expect(at).toBeGreaterThan(-1);
  return HTML.slice(at, HTML.indexOf('\n}\n', at) + 2);
}

function load() {
  const dom = new JSDOM('<!doctype html><body><div id="cal-grid">' +
    ['mon', 'tue', 'wed'].map(d => `<div id="allday-${d}"></div><div class="cal-col" id="day-${d}"></div>`).join('') +
    '</div></body>', { runScripts: 'outside-only' });
  const w = dom.window;
  w.eval(`
    var SESSIONS = {}; var DAY_DATA = { mon: { sessions: [] }, tue: { sessions: [] }, wed: { sessions: [] } };
    var __ALL_DAYS = ['mon', 'tue', 'wed']; var START_H = 6; var HOUR_PX = 72;
    var EVENTS = { mon: [{ dbId: 1, start: '09:00' }], tue: [{ dbId: 2, start: '10:00' }], wed: [] };
    var log = [];
    window.__currentWeekMonday = new Date('2026-11-23T00:00:00Z');
    function __ymd(d) { return d.toISOString().slice(0, 10); }
    function __weekDayOrder() { return __ALL_DAYS; }
    function __weekStartDate(m) { return new Date(m); }
    function __eventsInVisibleWeek() { return []; }
    function groupEventsByDay() { return JSON.parse(JSON.stringify(EVENTS)); }
    function __renderWeekHeader() {} function updateNowLine() {} function renderToday() {} function __openPendingEventDetail() {}
    function detectAndMarkCalendarConflicts() {} function detectAndMarkRuralTrips() {}
    function refreshDayOverlays(d) { log.push('legs:' + d); }
    function refreshAllOverlays() { log.push('legs:all'); }
    function requestAnimationFrame(f) { f(); }
    function addTile(day, s) {
      const el = document.createElement('div'); el.className = 'session'; el.dataset.id = 'E-' + s.dbId; el.dataset.outlookTile = '1';
      el.style.top = s.start; document.getElementById('day-' + day).appendChild(el);
      SESSIONS['E-' + s.dbId] = { id: 'E-' + s.dbId, day, element: el, outlookSynced: true, startH: +s.start.slice(0, 2) };
    }
    function mergeEventsIntoDayData(byDay, only) { log.push('merge:' + (only ? only.join(',') : 'all')); Object.keys(byDay).forEach(d => byDay[d].forEach(s => addTile(d, s))); }
    function renderCurrentWeek() {
      log.push('full');
      Object.keys(SESSIONS).forEach(id => { SESSIONS[id].element.remove(); delete SESSIONS[id]; });
      const byDay = groupEventsByDay(); const sigs = __weekEventSigs(byDay); mergeEventsIntoDayData(byDay); __recordWeekDrawn(sigs);
    }
  `);
  w.eval('var __overlapBatch = null; function reflowDayOverlaps() {}');
  ['var __weekDrawn = null;', 'function __withOverlapBatch(fn) {', 'function __weekDrawKey() {', 'function __weekEventSigs(', 'function __dayTilesSig(',
    'function __recordWeekDrawn(', 'function __clearOutlookTilesForDay(', 'function renderWeekChanges() {', 'function __isVisibleWeekDate(']
    .forEach(h => w.eval(h.startsWith('var') ? h : fnSrc(h)));
  return w;
}

describe('renderWeekChanges', () => {
  test('first call (nothing drawn yet) is the full render', () => {
    const w = load();
    w.eval('renderWeekChanges()');
    expect(w.log).toEqual(['full', 'merge:all']);
  });
  test('unchanged data and tiles: no tile is touched, no legs redrawn', () => {
    const w = load();
    w.eval('renderCurrentWeek(); log.length = 0; window.__mon = SESSIONS["E-1"].element; renderWeekChanges();');
    expect(w.log).toEqual([]);
    expect(w.eval('__mon.isConnected')).toBe(true);
  });
  test('one day changed: only that day is rebuilt and its legs redrawn', () => {
    const w = load();
    w.eval('renderCurrentWeek(); log.length = 0; window.__mon = SESSIONS["E-1"].element; EVENTS.tue.push({ dbId: 3, start: "13:00" }); renderWeekChanges();');
    expect(w.log).toEqual(['merge:tue', 'legs:tue']);
    expect(w.eval('__mon.isConnected')).toBe(true);
    expect(w.eval('Object.keys(SESSIONS).sort().join()')).toBe('E-1,E-2,E-3');
    expect(w.document.querySelectorAll('#day-tue [data-outlook-tile]')).toHaveLength(2);
  });
  test('a column changed by hand (failed delete, optimistic tile) is redrawn even with the same data', () => {
    const w = load();
    w.eval('renderCurrentWeek(); log.length = 0; SESSIONS["E-2"].element.remove(); renderWeekChanges();');
    expect(w.log).toEqual(['merge:tue', 'legs:tue']);
    expect(w.document.querySelectorAll('#day-tue [data-outlook-tile]')).toHaveLength(1);
    w.eval('log.length = 0; addTile("wed", { dbId: 9, start: "15:00" }); renderWeekChanges();');
    expect(w.log).toEqual(['merge:wed', 'legs:wed']);
    expect(w.eval('!!SESSIONS["E-9"]')).toBe(false);
  });
  test('another week or a different hour scale is a full render', () => {
    const w = load();
    w.eval('renderCurrentWeek(); log.length = 0; START_H = 7; renderWeekChanges();');
    expect(w.log[0]).toBe('full');
    w.eval('log.length = 0; window.__currentWeekMonday = new Date("2026-11-30T00:00:00Z"); renderWeekChanges();');
    expect(w.log[0]).toBe('full');
  });
  test('__isVisibleWeekDate covers the seven columns on screen', () => {
    const w = load();
    expect(w.eval('__isVisibleWeekDate("2026-11-23")')).toBe(true);
    expect(w.eval('__isVisibleWeekDate("2026-11-29")')).toBe(true);
    expect(w.eval('__isVisibleWeekDate("2026-11-30")')).toBe(false);
  });
});

describe('wiring', () => {
  test('the reload redraws changes only, in week and day views', () => {
    const load = fnSrc('async function loadOutlookEventsToCalendar() {');
    expect(load).toContain('renderWeekChanges();   // the day view is the week grid');
    expect(load).not.toMatch(/\n\s+renderCurrentWeek\(\);/);
  });
  test('a booking jumps weeks only when its day is not on screen, and redraws only its day\'s legs', () => {
    const cb = HTML.slice(HTML.indexOf('async function confirmBooking()'), HTML.indexOf('/* ---------- Reset wizard'));
    expect(cb).toContain("gotoWeekOf === 'function' && !__isVisibleWeekDate(t.dateStr)) gotoWeekOf(t.dateStr);");
    expect(cb).toContain("gotoWeekOf === 'function' && !__isVisibleWeekDate(DAY_DATES[slot.day])) {");
    expect(cb).not.toContain('refreshAllOverlays');
    expect(cb).toContain('setTimeout(() => refreshDayOverlays(slot.day), 100);');
    expect(cb).toContain('setTimeout(() => refreshDayOverlays(t.day), 100);');
    expect(HTML).toContain('.session.tile-new { animation: tileIn var(--t-fast) var(--ease-out); }');
  });
  test('the full render records what it drew', () => {
    const r = fnSrc('function renderCurrentWeek() {');
    expect(r.indexOf('__weekEventSigs(eventsByDay)')).toBeLessThan(r.indexOf('mergeEventsIntoDayData(eventsByDay)'));
    expect(r).toContain('__recordWeekDrawn(_sigs);');
  });
});

describe('P-01 / P-02 render cost', () => {
  test('a Day/Week/Workweek toggle redraws only what changed', () => {
    const m = fnSrc('function setCalendarMode(mode) {');
    expect(m).toContain('renderWeekChanges();');
    expect(m).not.toMatch(/\n  renderCurrentWeek\(\);/);
  });
  test('a render lays each column out once, after its tiles are in', () => {
    expect(fnSrc('function renderCurrentWeek() {')).toContain('__withOverlapBatch(() => mergeEventsIntoDayData(eventsByDay));');
    expect(fnSrc('function renderWeekChanges() {')).toContain('__withOverlapBatch(() => mergeEventsIntoDayData(only, changed));');
    const dom = new JSDOM('<!doctype html><body><div class="cal-col" id="c1"></div><div class="cal-col" id="c2"></div></body>', { runScripts: 'outside-only' });
    const w = dom.window;
    w.eval('var calls = []; var __overlapBatch = null;' + fnSrc('function __withOverlapBatch(fn) {')
      + 'function reflowDayOverlaps(col) { if (__overlapBatch) { __overlapBatch.add(col); return; } calls.push(col.id); }');
    w.eval(`const a = document.getElementById('c1'), b = document.getElementById('c2');
      __withOverlapBatch(() => { reflowDayOverlaps(a); reflowDayOverlaps(a); reflowDayOverlaps(b); __withOverlapBatch(() => reflowDayOverlaps(a)); });
      reflowDayOverlaps(b);`);
    expect(w.calls).toEqual(['c1', 'c2', 'c2']);
    expect(w.eval('__overlapBatch')).toBe(null);
    expect(fnSrc('function reflowDayOverlaps(col) {')).toContain('if (__overlapBatch) { __overlapBatch.add(col); return; }');
  });
  test('Perth dates are memoised per start time, declared before use', () => {
    expect(HTML.indexOf('var __perthYmdMemo = new Map();')).toBeLessThan(HTML.indexOf('function __eventsInVisibleWeek() {'));
    expect(HTML.indexOf('var __perthPartsMemo = new Map();')).toBeLessThan(HTML.indexOf('function groupEventsByDay(events) {'));
    expect(fnSrc('function groupEventsByDay(events) {')).not.toContain('console.log(`📍');
  });
});

describe('P-03 windowed event reloads', () => {
  function win() {
    const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
    const w = dom.window;
    w.eval(`function __ymd(d) { return d.toISOString().slice(0, 10); } function __weekStartDate(m) { return new Date(m); }`);
    ['var EVENTS_FULL_EVERY_MS', 'function __perthMidnightIso(', 'function __eventsFetchWindow() {', 'function __mergeEventsWindow(']
      .forEach(h => w.eval(h.startsWith('var') ? HTML.slice(HTML.indexOf(h), HTML.indexOf('\n', HTML.indexOf('var EVENTS_FRESH_MS'))) + '\nwindow.__eventsFresh = { full: 0, win: null };' : fnSrc(h)));
    return w;
  }
  test('first load, month view, scheduler and a stale history are full loads; otherwise the weeks around the one shown', () => {
    const w = win();
    expect(w.eval('__eventsFetchWindow()')).toBe(null);                       // not loaded yet
    w.eval('window.__eventsLoadedOnce = true; window.__currentWeekMonday = new Date("2026-11-23T00:00:00Z"); window.__eventsFresh.full = Date.now(); window.__calendarMode = "week";');
    expect(w.eval('JSON.stringify(__eventsFetchWindow())')).toBe(JSON.stringify({ from: '2026-11-16T00:00:00+08:00', to: '2026-12-14T00:00:00+08:00' }));
    w.eval('window.__calendarMode = "month"');
    expect(w.eval('__eventsFetchWindow()')).toBe(null);
    w.eval('window.__calendarMode = "master"');
    expect(w.eval('__eventsFetchWindow()')).toBe(null);
    w.eval('window.__calendarMode = "day"; window.__eventsFresh.full = Date.now() - EVENTS_FULL_EVERY_MS - 1;');
    expect(w.eval('__eventsFetchWindow()')).toBe(null);
  });
  test('the merge replaces exactly the window (deletions inside it are seen) and keeps the rest', () => {
    const w = win();
    const cache = [
      { id: 1, start_time: '2025-01-01T01:00:00Z' },
      { id: 2, start_time: '2026-11-15T16:00:00Z' },   // first instant of the window
      { id: 3, start_time: '2026-11-25T01:00:00Z' },   // deleted on the server
      { id: 4, start_time: '2026-12-13T16:00:00Z' },   // the window's end: outside
    ];
    const fresh = [{ id: 2, start_time: '2026-11-15T16:00:00Z', title: 'new' }, { id: 5, start_time: '2026-11-20T01:00:00Z' },
      { id: 9, start_time: '2030-01-01T00:00:00Z' }];   // a server answering outside the window is ignored
    const out = JSON.parse(w.eval(`JSON.stringify(__mergeEventsWindow(${JSON.stringify(cache)}, ${JSON.stringify(fresh)}, { from: '2026-11-16T00:00:00+08:00', to: '2026-12-14T00:00:00+08:00' }))`));
    expect(out.map(e => e.id)).toEqual([1, 2, 5, 4]);
    expect(out[1].title).toBe('new');
  });
  test('the loader asks for the window and merges; a navigated-to week not freshly loaded is asked for', () => {
    const l = fnSrc('async function loadOutlookEventsToCalendar() {');
    expect(l).toContain("const url = win ? '/api/events?from=' + encodeURIComponent(win.from) + '&to=' + encodeURIComponent(win.to) : '/api/events';");
    expect(l).toContain('window.__outlookEventsCache = __mergeEventsWindow(window.__outlookEventsCache || [], _fresh, win);');
    expect(fnSrc('function renderCurrentWeek() {')).toContain('__ensureVisibleWeekFresh();');
  });
});
