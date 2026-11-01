'use strict';

/**
 * Traffic-aware travel (29 Oct 2026, Antony's spec).
 *
 *   - a future drive is priced at its own departure time (Routes API with
 *     departureTime), not on traffic at the moment the calendar is opened
 *   - right-click › Not driving this: the leg stays where it was as a marker,
 *     blocks no time, never reaches Outlook; undo restores every answer
 *   - traffic alerts: only a CHANGE that runs a drive into a CLIENT session
 *     alerts; first sight is the baseline; Ignore silences that drive;
 *     Make room is offered only when the planner can fit it
 * travel.js and travel-alerts.js run in a vm with the globals they read.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FRONT = path.join(__dirname, '../../frontend/current');
const TRAVEL = fs.readFileSync(path.join(FRONT, 'travel.js'), 'utf8');
const ALERTS = fs.readFileSync(path.join(FRONT, 'travel-alerts.js'), 'utf8');
const HOME = { id: 'home-1', label: 'Home', addr: '1 Example St, Willetton WA 6155', suburb: 'Willetton', kind: 'local' };
const OSBORNE = '10 Example Rd, Osborne Park WA 6017';
const JOONDALUP = '20 Example Ave, Joondalup WA 6027';
const MIN = { 'Willetton|Osborne Park': 25, 'Osborne Park|Joondalup': 30, 'Joondalup|Willetton': 40 };
const perth = (offset) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Perth' }).format(new Date(Date.now() + offset * 86400000));

function load(dayDate) {
  const noop = () => {};
  const mk = () => ({ style: {}, dataset: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, addEventListener: noop, appendChild: noop, remove: noop, setAttribute: noop, querySelector: () => null, querySelectorAll: () => [] });
  const store = {};
  const ctx = {
    console, setTimeout, clearTimeout, setInterval: () => 0, Promise, Map, Set, Date, Math, JSON, Intl,
    document: { addEventListener: noop, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: mk, body: Object.assign(mk(), { appended: [] }), activeElement: null, hidden: false, readyState: 'complete' },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    START_H: 0, END_H: 24, HOUR_PX: 72, WORK_S: 8, WORK_E: 18,
    tToY: (h, m = 0) => (h + m / 60) * 72,
    WORK_BASES: { office: {}, homes: [HOME] }, LOCATIONS: {},
    getBase: (id) => (id === 'home-1' ? HOME : null),
    sessionStartMin: (s) => s.startH * 60 + (s.startM || 0),
    sessionEndMin: (s) => s.endH * 60 + (s.endM || 0),
    showToast: jest.fn(),
    fetch: jest.fn(async () => ({ ok: true, json: async () => ({ ok: true }) })),
    SESSIONS: {},
    DAY_DATES: { mon: dayDate || perth(1) },
    GOOGLE_MAPS_API_KEY: '',
  };
  ctx.window = ctx;
  ctx.document.body.appendChild = (n) => ctx.document.body.appended.push(n);
  vm.createContext(ctx);
  vm.runInContext(TRAVEL, ctx);
  vm.runInContext(ALERTS, ctx);
  vm.runInContext('calendarWeekLocations = function () { return { mon: "home-1" }; };', ctx);
  ctx.travelMinutes = (a, b) => {
    if (!a || !b || a === b) return 0;
    const sa = ctx.addrSuburb(a) || a, sb = ctx.addrSuburb(b) || b;
    if (sa === sb) return 0;
    return MIN[sa + '|' + sb] || MIN[sb + '|' + sa] || 22;
  };
  ctx.store = store;
  return ctx;
}
let seq = 0;
function add(c, o) {
  const id = o.id || 'S' + (++seq);
  const [sh, sm] = o.at.split(':').map(Number), [eh, em] = o.to.split(':').map(Number);
  c.SESSIONS[id] = Object.assign({ id, day: 'mon', type: 'therapy', dbId: 'db-' + id, startH: sh, startM: sm, endH: eh, endM: em }, o.s || {});
  return c.SESSIONS[id];
}
const legs = (c) => c.computeDayTravelSegments('mon').filter((x) => x.kind !== 'gap');
/* Put a Routes answer in the cache for a drive leaving at hh:mm on the column's date. */
function priceAt(c, from, to, hhmm, minutes, source = 'routes-api') {
  const iso = c.DAY_DATES.mon + 'T' + hhmm + ':00+08:00';
  vm.runInContext(`ROUTE_CACHE.set(routeKey(${JSON.stringify(from)}, ${JSON.stringify(to)}, 'driving') + '|t' + _departureBucket(${JSON.stringify(iso)}), { durationMin: ${minutes}, source: ${JSON.stringify(source)}, fetchedAt: Date.now() })`, c);
}

describe('a drive is priced at its own departure time', () => {
  test('tomorrow 11:30 → Joondalup uses the answer for 11:30, not the plain number', () => {
    const c = load();
    add(c, { at: '09:00', to: '10:00', s: { address: OSBORNE, patient: 'A', travel: { next: 'direct' } } });
    add(c, { at: '12:00', to: '13:00', s: { address: JOONDALUP, patient: 'B' } });
    priceAt(c, OSBORNE, JOONDALUP, '11:30', 45);
    const leg = legs(c).find((x) => x.kind === 'between');
    expect([leg.travelMin, leg.routeReal]).toEqual([45, true]);
  });

  test('no answer yet → the plain number now, and a Routes request for that departure time', () => {
    const c = load();
    c.fetch.mockClear();
    add(c, { at: '09:00', to: '10:00', s: { address: OSBORNE, patient: 'A', travel: { next: 'direct' } } });
    add(c, { at: '12:00', to: '13:00', s: { address: JOONDALUP, patient: 'B' } });
    vm.runInContext('GOOGLE_MAPS_API_KEY = "k"', c);
    const leg = legs(c).find((x) => x.kind === 'between');
    expect([leg.travelMin, leg.routeReal]).toEqual([30, false]);
    const asked = c.fetch.mock.calls.filter(([u]) => u === '/api/maps/routes').map(([, o]) => JSON.parse(o.body));
    expect(asked.some((b) => b.departureTime === new Date(c.DAY_DATES.mon + 'T11:30:00+08:00').toISOString())).toBe(true);
  });

  test('a past day keeps the plain number and asks nothing timed', () => {
    const c = load(perth(-2));
    c.fetch.mockClear();
    vm.runInContext('GOOGLE_MAPS_API_KEY = "k"', c);
    add(c, { at: '09:00', to: '10:00', s: { address: OSBORNE, patient: 'A', travel: { next: 'direct' } } });
    add(c, { at: '12:00', to: '13:00', s: { address: JOONDALUP, patient: 'B' } });
    expect(legs(c).find((x) => x.kind === 'between').travelMin).toBe(30);
    const asked = c.fetch.mock.calls.filter(([u]) => u === '/api/maps/routes').map(([, o]) => JSON.parse(o.body));
    expect(asked.some((b) => b.departureTime)).toBe(false);
  });

  test('a drive more than a day ahead is kept 6 hours; a near one 10 minutes', () => {
    const c = load();
    expect(vm.runInContext('isFresh({ fetchedAt: Date.now() - 3 * 3600e3, ttlMs: FAR_ROUTE_TTL_MS })', c)).toBe(true);
    expect(vm.runInContext('isFresh({ fetchedAt: Date.now() - 11 * 60e3 })', c)).toBe(false);
  });
});

describe('right-click › Not driving this', () => {
  test('the leg is kept as a marker, blocks no time and never reaches Outlook', () => {
    const c = load();
    const a = add(c, { at: '09:00', to: '10:00', s: { address: OSBORNE, patient: 'A', travel: { next: 'direct' } } });
    const b = add(c, { at: '12:00', to: '13:00', s: { address: JOONDALUP, patient: 'B', travel: { noDriveBefore: true } } });
    const L = legs(c);
    const leg = L.find((x) => x.kind === 'between');
    expect([leg.skipped, leg.ownerSessionId, leg.ownerSide]).toEqual([true, b.id, 'before']);
    expect(L.find((x) => x.kind === 'start').skipped).toBeUndefined();
    const payload = c.travelOutlookPayload('mon', c.computeDayTravelSegments('mon'));
    expect(payload.legs.map((x) => x.key)).toEqual(['db-' + a.id + '|before', 'db-' + b.id + '|after']);
    // The free window now runs through where the drive was.
    const gaps = c.computeDayTravelSegments('mon').filter((x) => x.kind === 'gap');
    expect(gaps.some((g) => g.startMin === 600 && g.endMin === 720)).toBe(true);
  });

  test('saving it PATCHes only that side; undo puts back every answer, desk work included', async () => {
    const c = load();
    const undo = [];
    c.OpalUndo = { register: (x) => undo.push(x) };
    add(c, { at: '09:00', to: '10:00', s: { address: OSBORNE, patient: 'A', travel: { next: 'direct' } } });
    const b = add(c, { at: '12:00', to: '13:00', s: { address: JOONDALUP, patient: 'B', travel: { desk: 'here', next: 'direct' } } });
    const leg = legs(c).find((x) => x.kind === 'between');
    c.fetch.mockClear();
    expect(await c.setLegNotDriven(leg, true)).toBe(true);
    expect(JSON.parse(c.fetch.mock.calls[0][1].body)).toEqual({ noDriveBefore: true });
    expect(c.SESSIONS[b.id].travel).toEqual({ desk: 'here', next: 'direct', noDriveBefore: true });
    await undo[0].undo();
    expect(JSON.parse(c.fetch.mock.calls[1][1].body)).toMatchObject({ desk: 'here', next: 'direct', noDriveBefore: null, noDriveAfter: null });
    expect(c.SESSIONS[b.id].travel).toEqual({ desk: 'here', next: 'direct' });
  });
});

describe('traffic alerts', () => {
  test('decide: first sight is the baseline; a rise that runs into a session alerts; Ignore is final', () => {
    const c = load(perth(0));
    const d = c.TravelAlerts._decide;
    expect(d(undefined, { min: 30, overlap: 0 })).toEqual({ action: 'baseline', record: { min: 30, overlap: 0 } });
    expect(d({ min: 30, overlap: 0 }, { min: 41, overlap: 11 }).action).toBe('alert');
    expect(d({ min: 30, overlap: 0 }, { min: 31, overlap: 1 }).action).toBe('update');           // under 2 min is noise
    expect(d({ min: 41, overlap: 11 }, { min: 41, overlap: 11 }).action).toBe('none');
    expect(d({ min: 41, overlap: 11, status: 'ack' }, { min: 44, overlap: 14 }).action).toBe('alert'); // worse after an ack
    expect(d({ min: 41, overlap: 11, status: 'ack' }, { min: 40, overlap: 10 }).record.status).toBe('ack');
    expect(d({ min: 41, overlap: 11, status: 'ignore' }, { min: 60, overlap: 30 }).action).toBe('none');
    expect(d({ min: 30, overlap: 12 }, { min: 30, overlap: 15 }).action).toBe('update');        // moved, not traffic
  });

  // Osborne Park client, then Resource Preparation at home (10:40–11:30), then
  // Sam Pell in Joondalup at 12:15: home → Joondalup is 40 min, leaving 11:35.
  function day(c) {
    const a = add(c, { at: '09:00', to: '10:00', s: { address: OSBORNE, patient: 'A' } });
    const desk = add(c, { at: '10:40', to: '11:30', s: { title: 'Resource Preparation', type: 'custom', booking: { kind: 'resource-prep', group: 'nf2f' } } });
    const b = add(c, { at: '12:15', to: '13:15', s: { address: JOONDALUP, patient: 'Sam Pell' } });
    return { a, desk, b };
  }

  test('only a change alerts, only into a client session, and only from a real Routes answer', () => {
    const c = load(perth(1)); // tomorrow: still watched, and always in the future — a
    // day of today failed every afternoon, once the 12:15 session had passed;
    day(c);
    priceAt(c, HOME.addr, JOONDALUP, '11:35', 40);
    c.TravelAlerts.check('mon', c.computeDayTravelSegments('mon'));        // baseline, no alert
    expect(c.TravelAlerts._queue().showing).toBeNull();
    vm.runInContext('ROUTE_CACHE.clear()', c);
    priceAt(c, HOME.addr, JOONDALUP, '11:35', 70, 'estimate');              // an estimate never alerts
    c.TravelAlerts.check('mon', c.computeDayTravelSegments('mon'));
    expect(c.TravelAlerts._queue().showing).toBeNull();
    vm.runInContext('ROUTE_CACHE.clear()', c);
    priceAt(c, HOME.addr, JOONDALUP, '11:35', 70);                          // leaves 11:30 (desk ends), arrives 12:40
    c.TravelAlerts.check('mon', c.computeDayTravelSegments('mon'));
    const shown = c.TravelAlerts._queue().showing;
    expect(shown).not.toBeNull();
    expect([shown.session.patient, shown.overlapMin, shown.wasMin, shown.seg.travelMin]).toEqual(['Sam Pell', 25, 40, 70]);
    expect(c.document.body.appended.some((n) => n.id === 'tr-alert')).toBe(true);
  });

  test('a drive running into desk work or a meeting never alerts', () => {
    const c = load(perth(0));
    add(c, { at: '09:00', to: '10:00', s: { address: OSBORNE, patient: 'A', travel: { next: 'direct' } } });
    add(c, { at: '12:00', to: '13:00', s: { address: JOONDALUP, title: 'Team meeting', type: 'custom' } });
    priceAt(c, OSBORNE, JOONDALUP, '11:30', 30);
    c.TravelAlerts.check('mon', c.computeDayTravelSegments('mon'));
    vm.runInContext('ROUTE_CACHE.clear()', c);
    priceAt(c, OSBORNE, JOONDALUP, '11:30', 150);
    c.TravelAlerts.check('mon', c.computeDayTravelSegments('mon'));
    expect(c.TravelAlerts._queue().showing).toBeNull();
  });

  test('with storage blocked the baseline is kept in memory, so a change still alerts', () => {
    const c = load(perth(1)); // tomorrow: still watched, and always in the future — a
    // day of today failed every afternoon, once the 12:15 session had passed;
    c.localStorage.getItem = () => { throw new Error('SecurityError'); };
    c.localStorage.setItem = () => { throw new Error('SecurityError'); };
    day(c);
    priceAt(c, HOME.addr, JOONDALUP, '11:35', 40);
    c.TravelAlerts.check('mon', c.computeDayTravelSegments('mon'));
    vm.runInContext('ROUTE_CACHE.clear()', c);
    priceAt(c, HOME.addr, JOONDALUP, '11:35', 70);
    c.TravelAlerts.check('mon', c.computeDayTravelSegments('mon'));
    expect(c.TravelAlerts._queue().showing).not.toBeNull();
  });

  test('days other than today and tomorrow are not watched', () => {
    const c = load(perth(3));
    day(c);
    priceAt(c, HOME.addr, JOONDALUP, '11:35', 40);
    c.TravelAlerts.check('mon', c.computeDayTravelSegments('mon'));
    expect(c.store['opal.travelAlerts.v1']).toBeUndefined();
  });

  test('Make room: the flexible block before the session moves up when that fits; a client right before means Acknowledge', () => {
    const c = load(perth(0));
    const { desk, b } = day(c);
    const leg = { seg: { travelMin: 70, toSessionId: b.id }, session: b, day: 'mon' };
    const room = c.TravelAlerts._roomFor(leg, {});
    expect(room.ok).toBe(true);
    expect(room.blocks.map((x) => [x.id, x.newStartMin, x.newEndMin])).toEqual([[desk.id, 10 * 60 + 40, 11 * 60 + 5]]);   // leave by 11:05
    // Nothing flexible between the client and the drive: no room to make.
    const c2 = load(perth(0));
    add(c2, { at: '09:00', to: '11:00', s: { address: OSBORNE, patient: 'A' } });
    const b2 = add(c2, { at: '11:30', to: '12:30', s: { address: JOONDALUP, patient: 'B' } });
    expect(c2.TravelAlerts._roomFor({ seg: { travelMin: 45, toSessionId: b2.id }, session: b2, day: 'mon' }, {}).ok).toBe(false);
  });
});
