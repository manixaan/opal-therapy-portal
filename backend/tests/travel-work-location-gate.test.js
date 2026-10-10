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
// The mid-day trip home is betweenTravelPlan's rule (travel-physical-route.test.js).
