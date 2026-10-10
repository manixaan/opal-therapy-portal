'use strict';

/**
 * Work-location gate (27 Sep 2026): only a base the therapist chose anchors a
 * day's travel, and a day without one blocks booking. travel.js runs in a vm
 * with just the globals these functions read.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '../../frontend/current/travel.js'), 'utf8');

function load(week, bases) {
  const noop = () => {};
  const el = () => ({ addEventListener: noop, appendChild: noop, querySelector: () => null, querySelectorAll: () => [], classList: { add: noop, remove: noop }, style: {} });
  const ctx = {
    console, setTimeout, clearTimeout, Promise, Map, Set, Date, Math, JSON,
    document: { addEventListener: noop, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: el, body: el() },
    WORK_BASES: bases,
    LOCATIONS: {},
    getBase: (id) => (id === 'office' ? bases.office : (bases.homes || []).find((h) => h.id === id) || null),
    suburbRegion: () => 'central',
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  vm.runInContext('calendarWeekLocations = function () { return __week; };', Object.assign(ctx, { __week: week }));
  return ctx;
}

const BASES = {
  office: { id: 'office', label: 'Perth metro office', addr: '64 Talbot Ave, Como WA 6152', suburb: 'Como' },
  homes: [{ id: 'home-1', label: 'Home', addr: '1 Holman St, Derby WA 6728', suburb: 'Derby', kind: 'local' },
          { id: 'home-2', label: 'Unaddressed', addr: '', suburb: '', kind: 'local' }],
};

describe('work-location gate', () => {
  test('a day set to a real home base is ready and anchors travel there', () => {
    const c = load({ mon: 'home-1' }, BASES);
    expect(c.dayWorkLocationStatus('mon')).toBe('set');
    expect(c.dayAnchorBase('mon')).toMatchObject({ suburb: 'Derby', addr: '1 Holman St, Derby WA 6728' });
  });

  test('a blank day is unset and has no anchor — no fallback to another base', () => {
    const c = load({}, BASES);
    expect(c.dayWorkLocationStatus('tue')).toBe('unset');
    const b = c.dayAnchorBase('tue');
    expect(b.unset).toBe(true);
    expect(b.addr).toBeNull();
    expect(b.suburb).toBeNull();
  });

  test('the coming-soon office never anchors travel, even with a saved address', () => {
    const c = load({ wed: 'office' }, BASES);
    expect(c.dayWorkLocationStatus('wed')).toBe('unset');
    expect(c.dayAnchorBase('wed').suburb).toBeNull();
  });

  test('a home base with no address does not count as set', () => {
    const c = load({ thu: 'home-2' }, BASES);
    expect(c.dayWorkLocationStatus('thu')).toBe('unset');
  });

  test('leave is its own status, so booking warns instead of blocking', async () => {
    const c = load({ fri: 'leave' }, BASES);
    expect(c.dayWorkLocationStatus('fri')).toBe('leave');
    await expect(c.ensureDayBase('fri')).resolves.toBe('leave');
  });

  test('ensureDayBase resolves null (do not book) when the chooser is dismissed', async () => {
    const c = load({}, BASES);
    c.travelChooser = () => Promise.resolve(null);
    await expect(c.ensureDayBase('mon')).resolves.toBeNull();
  });

  test('ensureDayBase offers only real bases, plus the set-up link', async () => {
    const c = load({}, BASES);
    c.LOCATIONS = { office: { label: 'Office', comingSoon: true }, 'home-1': { label: 'Home' }, 'home-2': { label: 'Unaddressed' }, leave: {} };
    let offered;
    c.travelChooser = (t, m, opts) => { offered = opts.map((o) => o.key); return Promise.resolve(null); };
    await c.ensureDayBase('mon');
    expect(offered).toEqual(['home-1', '__setup']);
  });

  // 29 Sep 2026: the saved schedule used to load only when My Profile opened,
  // so a fresh calendar saw every day as "not set" and the gate stopped every
  // booking. The gate now waits for the start-up load before deciding.
  test('ensureDayBase waits for the saved work locations before prompting', async () => {
    const week = {};
    const c = load(week, BASES);
    let prompted = false;
    c.travelChooser = () => { prompted = true; return Promise.resolve(null); };
    let loaded = false;
    c.workScheduleLoaded = () => loaded;
    c.workScheduleReady = () => new Promise((resolve) => setTimeout(() => { week.tue = 'home-1'; loaded = true; resolve(true); }, 10));
    await expect(c.ensureDayBase('tue')).resolves.toBe('home-1');
    expect(prompted).toBe(false);
  });

  test('a failed schedule load still lets the gate ask rather than hang', async () => {
    const c = load({}, BASES);
    c.workScheduleLoaded = () => false;
    c.workScheduleReady = () => Promise.resolve(false); // profile.js answers false when the load failed
    c.travelChooser = () => Promise.resolve(null);
    await expect(c.ensureDayBase('wed')).resolves.toBeNull();
  });

});

// 10 Oct 2026: the day-header picker's undo held the week OBJECT it changed.
// Opening My Profile runs loadWorkSchedule, whose Object.assign(WORK_LOCATION,
// server copy) swaps in fresh week objects, so Cmd+Z edited a detached copy:
// nothing changed, nothing saved, yet the toast said "Undone". The undo now
// carries the week KEY and looks the week up when it runs.
describe('work-location undo survives a schedule reload', () => {
  function loadWeek() {
    const noop = () => {};
    const el = () => ({ addEventListener: noop, appendChild: noop, querySelector: () => null, querySelectorAll: () => [], classList: { add: noop, remove: noop }, style: {} });
    const undo = [];
    const ctx = {
      console, setTimeout, clearTimeout, Promise, Map, Set, Date, Math, JSON,
      document: { addEventListener: noop, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: el, body: el() },
      WORK_BASES: BASES, LOCATIONS: {}, getBase: () => null, suburbRegion: () => 'central',
      WORK_LOCATION: {},
      weekKeyFor: (m) => m.getFullYear() + '-' + (m.getMonth() + 1) + '-' + m.getDate(),   // opaque, like the shell's
      __currentWeekMonday: new Date(Date.UTC(2026, 9, 5)),
      OpalUndo: { register: (e) => undo.push(e) },
      saves: 0,
      renderWorkLocationEditor: noop,
    };
    ctx.window = ctx;
    ctx.debouncedSaveWorkSchedule = () => { ctx.saves++; };
    vm.createContext(ctx);
    vm.runInContext(SRC, ctx);
    ctx.refreshAllOverlays = noop;   // the DOM redraw is not under test
    return { c: ctx, undo };
  }
  // What loadWorkSchedule does with the GET response.
  const reloadFromServer = (c) => Object.assign(c.WORK_LOCATION, JSON.parse(JSON.stringify(c.WORK_LOCATION)));

  test('Cmd+Z after My Profile reloaded the schedule still reverts the day and saves', async () => {
    const { c, undo } = loadWeek();
    const key = c.weekKeyFor(new Date(2026, 9, 5));   // the week the calendar shows
    c.WORK_LOCATION[key] = { tue: 'home-1' };
    c.setDayWorkLocation('mon', 'home-1');
    expect(c.WORK_LOCATION[key].mon).toBe('home-1');
    expect(undo).toHaveLength(1);

    const held = c.WORK_LOCATION[key];
    reloadFromServer(c);
    expect(c.WORK_LOCATION[key]).not.toBe(held);   // the old object is detached

    await undo[0].undo();
    expect(c.WORK_LOCATION[key].mon).toBeUndefined();
    expect(c.WORK_LOCATION[key].tue).toBe('home-1');
    expect(c.saves).toBe(2);
    expect(undo).toHaveLength(1);   // the replay registers nothing
  });

  test('the undo still targets the week it changed after the calendar moves on', async () => {
    const { c, undo } = loadWeek();
    const first = c.weekKeyFor(new Date(2026, 9, 5));
    c.setDayWorkLocation('wed', 'home-1');
    expect(c.WORK_LOCATION[first].wed).toBe('home-1');
    c.__currentWeekMonday = new Date(Date.UTC(2026, 9, 12));
    const next = c.weekKeyFor(new Date(2026, 9, 12));
    c.WORK_LOCATION[next] = { wed: 'home-2' };
    reloadFromServer(c);

    await undo[0].undo();
    expect(c.WORK_LOCATION[first].wed).toBeUndefined();
    expect(c.WORK_LOCATION[next].wed).toBe('home-2');
  });

  test('the calendar reads and writes the same week object the key names', () => {
    const { c } = loadWeek();
    expect(c.calendarWeekKey()).toBe('2026-10-5');
    expect(c.calendarWeekLocations()).toBe(c.WORK_LOCATION['2026-10-5']);
  });
});
// The mid-day trip home is betweenTravelPlan's rule (travel-physical-route.test.js).
