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
  ['var __weekDrawn = null;', 'function __weekDrawKey() {', 'function __weekEventSigs(', 'function __dayTilesSig(',
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
