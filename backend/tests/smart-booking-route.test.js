'use strict';

/**
 * ROUTE-AWARE SMART BOOKING (2 Oct 2026) — behaviour, in a real DOM.
 *
 * jsdom runs the production travel.js and booking-route.js against a minimal
 * copy of the booking panel's WHEN & WHERE markup and one calendar column.
 * The shell's own panel functions (openBookingPanel, bspOnStartChange, …) are
 * small stand-ins with the same contract; fetch is a scripted fake, so no
 * Google, Splose or database is touched and nothing is ever booked.
 *
 * Covers: 15-minute snapping (create/move/resize share calSnapMin), the pure
 * planner, Client A → Client B travel and the proposal moving with it,
 * duration preserved, conflicts, manual moves, routing failure + Retry,
 * Unsure, cancellation, the client location selector (Splose / saved / add
 * another / duplicates), the work-location notice, Return Home and Go
 * Somewhere Else.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const FRONTEND = path.join(__dirname, '..', '..', 'frontend', 'current');
const TRAVEL = fs.readFileSync(path.join(FRONTEND, 'travel.js'), 'utf8');
const BOOKING_ROUTE = fs.readFileSync(path.join(FRONTEND, 'booking-route.js'), 'utf8');
const SHELL = fs.readFileSync(path.join(FRONTEND, 'mockup_v3.html'), 'utf8');

const A_ADDR = '12 Example St, Willetton WA 6155';
const CV_ADDR = '20 Example Rd, Canning Vale WA 6155';
const FAR_ADDR = '9 Distant Way, Armadale WA 6112';
const NEAR_ADDR = '3 Close St, Riverton WA 6148';
const HOME_ADDR = '1 Holman St, Bull Creek WA 6149';

const FIXTURE = `<!doctype html><body>
  <section class="view" id="view-calendar"></section>
  <div id="booking-side-panel">
    <div id="bsp-prefill-strip" style="display:none"><span id="bsp-prefill-text"></span></div>
    <div class="bsp-timing-section">
      <div class="bsp-wl-notice" id="bsp-wl-notice" hidden></div>
      <button class="bsp-day-chip" data-day="mon"></button><button class="bsp-day-chip" data-day="tue"></button>
      <input type="time" id="bsp-start" value="10:00"><input type="time" id="bsp-end" value="11:00">
      <input type="range" id="bsp-dur-slider" min="1" max="240" value="60">
      <div class="bsp-loc-field">
        <select id="bsp-loc-select" hidden></select>
        <input type="text" id="bsp-location">
        <div id="bsp-loc-add" hidden></div><div id="bsp-loc-meta" hidden></div>
        <input type="checkbox" id="bsp-location-unsure">
        <div id="bsp-route-status" hidden></div>
      </div>
    </div>
    <input id="patient-search">
  </div>
  <div class="cal-col" id="day-mon"></div><div class="cal-col" id="day-tue"></div>
</body>`;

/* The shell globals travel.js and booking-route.js read, as small stand-ins. */
const SHELL_STUBS = `
  var HOUR_PX = 72, START_H = 0, END_H = 24, WORK_S = 8, WORK_E = 18;
  var HOME_BASED_TYPES = new Set(['admin', 'casenote', 'report', 'cpd', 'lunch']);
  var PLACES_NEAR = {};
  var DAY_DATES = { mon: '2026-10-05', tue: '2026-10-06' };
  var SESSIONS = {};
  var BOOKING_STATE = { category: 'client', selectedPatient: null, travelFrom: null, serviceType: 'svc-1' };
  var BOOKING_LEAVES = { 'svc-1': { cat: 'client', label: 'Therapy' } };
  var _bspSelectedTherapist = null;
  var APP_USER = { id: 'me', role: 'therapist' };
  var LOCATIONS = {};
  var __week = {};
  var WORK_BASES = { office: { id: 'office', label: 'Office', addr: '', suburb: '' }, homes: [] };
  var __calls = { preview: [], toasts: [], opened: [], setWeekly: 0, places: [] };
  function getBase(id) { return id === 'office' ? WORK_BASES.office : (WORK_BASES.homes || []).find(h => h.id === id) || null; }
  function regionDistance() { return 15; }
  function sessionStartMin(s) { return s.startH * 60 + (s.startM || 0); }
  function sessionEndMin(s) { return s.endH * 60 + (s.endM || 0); }
  function tToY(h, m) { return (h * 60 + (m || 0)) / 60 * HOUR_PX; }
  function fmtTime(h, m) { return (h % 12 || 12) + ':' + String(m).padStart(2, '0') + (h < 12 ? ' AM' : ' PM'); }
  function escapeHtml(v) { return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function showToast(t, s) { __calls.toasts.push([t, s]); }
  function getSelectedPatient() { return BOOKING_STATE.selectedPatient; }
  function renderRightContext() {}
  function selectBookingCat(c) { BOOKING_STATE.category = c; }
  function selectBookingLeaf(id) { BOOKING_STATE.serviceType = id; }
  function selectBspTherapist(id) {}
  function bspSelectDay(day) { document.querySelectorAll('.bsp-day-chip').forEach(b => b.classList.toggle('active', b.dataset.day === day)); _bspUpdateLivePreview(); }
  function _bspRecomputeEnd() {
    const [h, m] = document.getElementById('bsp-start').value.split(':').map(Number);
    const e = h * 60 + m + parseInt(document.getElementById('bsp-dur-slider').value, 10);
    document.getElementById('bsp-end').value = String(Math.floor(e / 60)).padStart(2, '0') + ':' + String(e % 60).padStart(2, '0');
  }
  function clearPreviewBlocks() { document.querySelectorAll('.cal-preview-block').forEach(e => e.remove()); }
  function renderCalendarPreviewBlocks(slots) {
    clearPreviewBlocks();
    __calls.preview.push(slots[0]);
    const el = document.createElement('div'); el.className = 'cal-preview-block cal-proposed';
    document.getElementById('day-' + slots[0].day).appendChild(el);
  }
  function _bspUpdateLivePreview() {
    const [h, m] = document.getElementById('bsp-start').value.split(':').map(Number);
    renderCalendarPreviewBlocks([{ day: 'mon', startH: h, startM: m, startMin: h * 60 + m, durationMin: parseInt(document.getElementById('bsp-dur-slider').value, 10) }]);
  }
  function bspOnStartChange() { _bspRecomputeEnd(); _bspUpdateLivePreview(); }
  function openBookingPanel(opts) {
    __calls.opened.push(opts || {});
    document.getElementById('booking-side-panel').classList.add('open');
    if (opts && opts.day) bspSelectDay(opts.day);
    if (opts && opts.startH != null) document.getElementById('bsp-start').value = String(opts.startH).padStart(2, '0') + ':' + String(opts.startM || 0).padStart(2, '0');
  }
  function closeBookingPanel() { document.getElementById('booking-side-panel').classList.remove('open'); clearPreviewBlocks(); }
  function attachPlacesAutocomplete(el, cb) { __calls.places.push({ el, cb }); }
  function addSession() {}
`;

/* Scripted fetch: routes by "origin|destination", everything else by URL. */
function makeFetch(win, cfg) {
  const log = [];
  win.fetch = async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    const body = opts.body ? JSON.parse(opts.body) : null;
    log.push({ url, method, body });
    const reply = (status, json) => ({ ok: status < 400, status, json: async () => json });
    if (url === '/api/maps/routes') {
      const min = cfg.routes[body.origin + '|' + body.destination];
      if (min === undefined || min === 'fail') return reply(502, { error: 'Routes API error' });
      return reply(200, { routes: [{ duration: (min * 60) + 's', distanceMeters: min * 900 }] });
    }
    const handler = (cfg.api || {})[method + ' ' + url];
    if (handler) { const [st, j] = typeof handler === 'function' ? handler(body) : handler; return reply(st, j); }
    if (/\/travel$/.test(url) && method === 'PATCH') return reply(200, { ok: true, travel: body });
    return reply(404, { error: 'not found' });
  };
  return log;
}

function makeEnv(cfg = {}) {
  const dom = new JSDOM(FIXTURE, { runScripts: 'outside-only', url: 'http://localhost/' });
  const win = dom.window;
  const log = makeFetch(win, { routes: cfg.routes || {}, api: cfg.api || {} });
  win.eval(SHELL_STUBS);
  if (cfg.week) win.eval('__week = ' + JSON.stringify(cfg.week));
  if (cfg.homes) win.eval('WORK_BASES.homes = ' + JSON.stringify(cfg.homes));
  win.eval(TRAVEL);
  win.eval('calendarWeekLocations = function () { return __week; }; SMART_ROUTE_CONFIG.debounceMs = 0;');
  win.eval(BOOKING_ROUTE);
  win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
  const $ = (id) => win.document.getElementById(id);
  const ev = (expr) => win.eval(expr);
  const routeCalls = () => log.filter((c) => c.url === '/api/maps/routes');
  return { dom, win, log, $, ev, routeCalls };
}

const flush = (ms = 30) => new Promise((r) => setTimeout(r, ms));

/* Client A booked 9:00–10:00 at Willetton; continue the route from it. */
function continueFrom(env, { aAddr = A_ADDR } = {}) {
  env.ev(`SESSIONS.A = { id: 'A', day: 'mon', type: 'therapy', startH: 9, startM: 0, endH: 10, endM: 0,
    address: ${JSON.stringify(aAddr)}, patient: 'Ada Client', dbId: 'db-A' }`);
  env.ev(`document.getElementById('booking-side-panel').classList.add('open'); bspSelectDay('mon');
    BOOKING_ROUTE.context = { dbId: 'db-A', day: 'mon', endMin: 600, label: 'Ada Client', address: ${JSON.stringify(aAddr)} };
    BOOKING_ROUTE.manualStart = false;`);
}
async function chooseLocation(env, addr) {
  const input = env.$('bsp-location');
  input.value = addr;
  input.dispatchEvent(new env.win.Event('change', { bubbles: true }));
  await flush();
}
const start = (env) => env.$('bsp-start').value;
const end = (env) => env.$('bsp-end').value;
const status = (env) => env.$('bsp-route-status');
const legs = (env) => Array.from(env.win.document.querySelectorAll('#day-mon .travel-overlay.preview:not(.placeholder)'));

// ─────────────────────────────────────────────────────────────────────────────

describe('15-minute snapping — one grid for every calendar gesture', () => {
  const grab = (re) => { const m = SHELL.match(re); expect(m).not.toBeNull(); return m[0]; };
  const ctx = { HOUR_PX: 72, START_H: 0, END_H: 24, Math };
  vm.createContext(ctx);
  vm.runInContext(grab(/const SLOT_SNAP_MIN = 15;/), ctx);
  vm.runInContext(grab(/function calSnapMin\(minutes\) \{[\s\S]*?\n\}/), ctx);
  vm.runInContext(grab(/function calYToMinutes\(col, clientY\) \{[\s\S]*?\n\}/), ctx);
  const col = { getBoundingClientRect: () => ({ top: 0 }) };
  const at = (h, m) => ((h * 60 + m) / 60) * 72;

  test.each([[10, 2, 600], [10, 8, 615], [10, 22, 615], [10, 24, 630]])('create: %i:%i snaps to minute %i', (h, m, want) => {
    expect(ctx.calYToMinutes(col, at(h, m))).toBe(want);
    expect(ctx.calSnapMin(h * 60 + m)).toBe(want);
  });

  test('move and resize go through the same snap, and drag-to-create ignores proposed blocks', () => {
    expect(SHELL).toContain('Math.min(END_H * 60 - drag.durationMin, calSnapMin(rawMinutes))');
    expect(SHELL).toContain('let target = calSnapMin(resize.origStartMin + dMin);');
    expect(SHELL).toContain("e.target.closest('.cal-preview-block') ||");
  });

  test('typed start times land on the grid too', async () => {
    const env = makeEnv();
    env.$('bsp-start').value = '10:08';
    env.$('bsp-start').dispatchEvent(new env.win.Event('change'));
    expect(start(env)).toBe('10:15');
  });

  test('the proposed block is the session shape, without the star', () => {
    expect(SHELL).not.toMatch(/idx===0\?'★ '/);
    expect(SHELL).toMatch(/el\.className = 'cal-preview-block cal-proposed'/);
    expect(SHELL).toMatch(/block\.className = 'drag-block cal-proposed';/);
    const css = SHELL.slice(SHELL.indexOf('.cal-proposed {'), SHELL.indexOf('.cal-proposed {') + 900);
    expect(css).toMatch(/border: 1px dashed/);
    expect(css).toMatch(/border-radius: 4px;/);
  });
});

describe('planNextStop — the pure earliest-feasible-start rule', () => {
  const env = makeEnv();
  const plan = (o) => env.win.planNextStop(Object.assign({ prevEndMin: 600, durationMin: 60, busy: [] }, o));

  test.each([[25, 630], [15, 615], [8, 615], [35, 645], [0, 600]])('%i min of travel from 10:00 → first slot at minute %i', (travel, want) => {
    const p = plan({ travelMin: travel });
    expect(p.startMin).toBe(want);
    // The drive sits against the appointment it leads to (4 Oct 2026), and the
    // block shows the real duration, not the whole gap.
    expect(p.travelEndMin).toBe(want);
    expect(p.travelStartMin).toBe(want - travel);
  });

  test('route minutes, buffer and the booking grid are kept apart', () => {
    const p = plan({ travelMin: 21, bufferMin: 5 });
    expect([p.travelMin, p.bufferMin, p.earliestStartMin, p.travelEndMin]).toEqual([21, 5, 630, 625]); // arrive, 5 min buffer, start
  });

  test('a confirmed appointment in the way moves the proposal to the next slot that fits, duration kept', () => {
    const p = plan({ travelMin: 20, busy: [{ id: 'X', startMin: 630, endMin: 660, label: 'Existing' }] });
    expect([p.startMin, p.endMin, p.durationMin]).toEqual([660, 720, 60]);
    // The drive never covers the appointment in the way: it goes before it.
    expect([p.travelStartMin, p.travelEndMin]).toEqual([610, 630]);
    expect(p.movedForConflicts.map((b) => b.id)).toEqual(['X']);
  });

  test('a later start the clinician chose is kept; an earlier one is clamped and reported', () => {
    expect(plan({ travelMin: 25, desiredStartMin: 660 })).toMatchObject({ startMin: 660, clampedFromMin: null });
    expect(plan({ travelMin: 25, desiredStartMin: 615 })).toMatchObject({ startMin: 630, clampedFromMin: 615 });
  });

  test('a chosen start that collides is reported, not silently moved', () => {
    const p = plan({ travelMin: 10, desiredStartMin: 660, busy: [{ id: 'Y', startMin: 690, endMin: 720 }] });
    expect(p.startMin).toBe(660);
    expect(p.conflicts.map((b) => b.id)).toEqual(['Y']);
  });

  test('no room left in the day is flagged', () => {
    expect(plan({ prevEndMin: 23 * 60, travelMin: 30 }).fits).toBe(false);
  });
});

describe('Book Another Client — Client A → travel → proposed Client B', () => {
  const routes = { [A_ADDR + '|' + CV_ADDR]: 25, [A_ADDR + '|' + FAR_ADDR]: 35, [A_ADDR + '|' + NEAR_ADDR]: 8 };

  test('travel is routed from A\'s confirmed location and B lands on the next 15-minute slot', async () => {
    const env = makeEnv({ routes });
    continueFrom(env);
    await chooseLocation(env, CV_ADDR);
    expect(start(env)).toBe('10:30');
    expect(end(env)).toBe('11:30');
    const call = env.routeCalls()[0].body;
    expect([call.origin, call.destination]).toEqual([A_ADDR, CV_ADDR]);
    expect(call.departureTime).toBe(new Date('2026-10-05T10:00:00+08:00').toISOString()); // leaves when A ends
    const leg = legs(env)[0];
    expect(leg.style.top).toBe(env.ev('tToY(10, 5)') + 'px');   // 10:05–10:30, arriving as B starts
    expect(leg.textContent).toMatch(/25 min/);
    expect(status(env).textContent).toMatch(/25 min drive from Ada Client/);
    expect(env.ev('__calls.preview[__calls.preview.length - 1]')).toMatchObject({ startMin: 630, durationMin: 60 });
  });

  test('changing B\'s location re-routes and moves the whole appointment, never shrinking it', async () => {
    const env = makeEnv({ routes });
    continueFrom(env);
    await chooseLocation(env, CV_ADDR);
    expect([start(env), end(env)]).toEqual(['10:30', '11:30']);
    await chooseLocation(env, FAR_ADDR);
    expect([start(env), end(env)]).toEqual(['10:45', '11:45']);
    await chooseLocation(env, NEAR_ADDR);
    expect([start(env), end(env)]).toEqual(['10:15', '11:15']);
    expect(legs(env)[0].textContent).toMatch(/8 min/);
  });

  test('a cached route is not asked for again', async () => {
    const env = makeEnv({ routes });
    continueFrom(env);
    await chooseLocation(env, CV_ADDR);
    await chooseLocation(env, FAR_ADDR);
    await chooseLocation(env, CV_ADDR);
    expect(env.routeCalls().filter((c) => c.body.destination === CV_ADDR)).toHaveLength(1);
  });

  test('an existing appointment in the earliest slot pushes B to the next feasible one', async () => {
    const env = makeEnv({ routes });
    continueFrom(env);
    env.ev("SESSIONS.X = { id: 'X', day: 'mon', type: 'therapy', startH: 10, startM: 30, endH: 11, endM: 0, address: 'x', patient: 'Busy Client' }");
    await chooseLocation(env, CV_ADDR);
    expect(start(env)).toBe('11:00');
    expect(status(env).textContent).toMatch(/Busy Client is already booked then/);
  });

  test('the clinician may move B later; earlier than the drive allows is clamped with a warning', async () => {
    const env = makeEnv({ routes });
    continueFrom(env);
    await chooseLocation(env, CV_ADDR);
    env.$('bsp-start').value = '11:00'; env.ev('bspOnStartChange()'); await flush();
    expect(start(env)).toBe('11:00');
    env.$('bsp-start').value = '10:00'; env.ev('bspOnStartChange()'); await flush();
    expect(start(env)).toBe('10:30');
    expect(status(env).className).toMatch(/warn/);
    expect(status(env).textContent).toMatch(/earlier than the drive allows/);
  });

  test('a routing failure keeps the booking, invents no duration, and Retry recovers', async () => {
    const env = makeEnv({ routes: { [A_ADDR + '|' + CV_ADDR]: 'fail' } });
    continueFrom(env);
    await chooseLocation(env, CV_ADDR);
    expect(start(env)).toBe('10:00');                 // nothing moved on a guess
    expect(env.$('bsp-location').value).toBe(CV_ADDR); // the choice is kept
    expect(legs(env)).toHaveLength(0);                 // no fake travel block
    expect(status(env).className).toMatch(/error/);
    expect(status(env).textContent).toMatch(/Unable to calculate travel right now/);
    // The route comes back: Retry asks again (bypassing the cached failure).
    const fixed = makeFetch(env.win, { routes });
    status(env).querySelector('[data-route="retry"]').click();
    await flush();
    expect(fixed.filter((c) => c.url === '/api/maps/routes')).toHaveLength(1);
    expect(start(env)).toBe('10:30');
  });

  test('continue with manual timing stops auto-moving and says so', async () => {
    const env = makeEnv({ routes: {} });
    continueFrom(env);
    await chooseLocation(env, CV_ADDR);
    status(env).querySelector('[data-route="manual"]').click();
    await flush();
    expect(status(env).textContent).toMatch(/Manual timing/);
    expect(start(env)).toBe('10:00');
  });

  test('Unsure means no route at all — not one from the client\'s address on file', async () => {
    const env = makeEnv({ routes });
    continueFrom(env);
    env.ev(`BOOKING_STATE.selectedPatient = { id: 501, first: 'Bo', last: 'B', address: ${JSON.stringify(CV_ADDR)} }`);
    env.$('bsp-location-unsure').checked = true;
    env.$('bsp-location-unsure').dispatchEvent(new env.win.Event('change', { bubbles: true }));
    await flush();
    expect(env.routeCalls()).toHaveLength(0);
    expect(status(env).textContent).toMatch(/Smart Travel is off/);
    expect(env.ev('_bspTargetAddress()')).toBe('');
  });

  test('no location yet asks for one instead of drawing a drive', async () => {
    const env = makeEnv({ routes });
    continueFrom(env);
    env.ev('bspTravelPreview()'); await flush();
    expect(status(env).textContent).toMatch(/choose the location/);
    expect(env.routeCalls()).toHaveLength(0);
    // Nothing on the calendar until there is a location to route to.
    expect(env.win.document.querySelectorAll('.travel-overlay.preview')).toHaveLength(0);
  });

  test('closing the panel cancels the route preview and forgets the context', async () => {
    const env = makeEnv({ routes });
    continueFrom(env);
    env.ev("BOOKING_STATE.travelFrom = BOOKING_ROUTE.context");
    await chooseLocation(env, CV_ADDR);
    expect(legs(env)).toHaveLength(1);
    env.ev('closeBookingPanel(true)');
    expect(env.ev('BOOKING_ROUTE.context')).toBeNull();
    expect(env.ev('BOOKING_STATE.travelFrom')).toBeNull();
    expect(env.win.document.querySelectorAll('.travel-overlay.preview')).toHaveLength(0);
    expect(status(env).hidden).toBe(true);
  });

  test('the previous stop is found by its saved event id after the calendar re-renders it', () => {
    const env = makeEnv({ routes });
    env.ev(`SESSIONS.renderedAgain = { id: 'renderedAgain', day: 'mon', type: 'therapy', startH: 9, startM: 0, endH: 10, endM: 15, address: ${JSON.stringify(A_ADDR)}, dbId: 'db-A', patient: 'Ada Client' };
      BOOKING_ROUTE.context = { sessionId: 'gone', dbId: 'db-A', day: 'mon', endMin: 600 };`);
    const p = env.ev('_bspPredecessor("mon", 660)');
    expect(p).toMatchObject({ explicit: true, endMin: 615, fromKey: A_ADDR });
  });

  test('a client session with no location is not routed from a guessed place', () => {
    const env = makeEnv();
    const loc = env.ev("sploseLocationForSession({ type: 'therapy', day: 'mon', patient: 'Ada' })");
    expect(loc).toMatchObject({ kind: 'unknown', address: null, suburb: null });
  });
});

describe('client location selector', () => {
  const PAT = { id: 501, first: 'Ada', last: 'Client', address: '12 Example St, Willetton, WA, 6155', suburb: 'Willetton' };
  const LIST = { locations: [
    { id: null, label: 'Home', address: '12 Example Street, Willetton WA 6155', source: 'splose' },
    { id: 'loc-school', label: 'School', address: 'Example Primary School, Willetton WA 6155', placeId: 'ChIJschool', source: 'manual' },
    { id: null, label: 'Previously used', address: '45 Example Avenue, Como WA 6152', source: 'previous_booking' },
  ] };

  async function withPatient(api) {
    const env = makeEnv({ api: Object.assign({ 'GET /api/client-locations/501': [200, LIST] }, api || {}) });
    env.ev('document.getElementById("booking-side-panel").classList.add("open"); bspSelectDay("mon");');
    env.ev('BOOKING_STATE.selectedPatient = ' + JSON.stringify(PAT));
    env.ev('renderRightContext()');
    await flush();
    return env;
  }
  const options = (env) => Array.from(env.$('bsp-loc-select').options).map((o) => o.textContent);

  test('Splose, saved and previously used locations appear, plus Add another', async () => {
    const env = await withPatient();
    expect(env.$('bsp-loc-select').hidden).toBe(false);
    expect(options(env)).toEqual([
      'No address — I stay where I am',
      'Home — 12 Example Street, Willetton WA 6155',
      'School — Example Primary School, Willetton WA 6155',
      'Previously used — 45 Example Avenue, Como WA 6152',
      '+ Add another address',
    ]);
    // The Splose address is selected by default and fills the existing field.
    expect(env.$('bsp-location').value).toBe('12 Example Street, Willetton WA 6155');
  });

  // Address is optional for every booking (4 Oct 2026). "No address" means
  // the therapist stays where they were, and is the default where the client's
  // address would be a guess — a telehealth or an MDT/MDU.
  const TELE = "BOOKING_LEAVES.tele = { cat: 'client', label: 'Telehealth Therapy Session', noDefaultAddress: true };";
  test('a telehealth defaults to No address — never the client\'s address on file', async () => {
    const env = makeEnv({ api: { 'GET /api/client-locations/501': [200, LIST] } });
    env.ev(TELE + " BOOKING_STATE.serviceType = 'tele';");
    env.ev('document.getElementById("booking-side-panel").classList.add("open"); bspSelectDay("mon");');
    env.ev('BOOKING_STATE.selectedPatient = ' + JSON.stringify(PAT) + '; renderRightContext();');
    await flush();
    expect(env.$('bsp-loc-select').value).toBe('__none');
    expect(env.$('bsp-location').value).toBe('');
  });

  test('switching type re-picks the default until the therapist chooses; their choice then stays', async () => {
    const env = await withPatient();
    expect(env.$('bsp-location').value).toBe('12 Example Street, Willetton WA 6155');   // therapy: Splose address
    env.ev(TELE + " BOOKING_STATE.serviceType = 'tele'; selectBookingCat('client');");
    expect(env.$('bsp-loc-select').value).toBe('__none');
    env.ev("BOOKING_STATE.serviceType = 'svc-1'; selectBookingCat('client');");
    expect(env.$('bsp-location').value).toBe('12 Example Street, Willetton WA 6155');
    const sel = env.$('bsp-loc-select');
    sel.value = '__none'; sel.dispatchEvent(new env.win.Event('change'));                // the therapist's choice
    expect(env.$('bsp-location').value).toBe('');
    env.ev("BOOKING_STATE.serviceType = 'svc-1'; selectBookingCat('client');");
    expect(env.$('bsp-loc-select').value).toBe('__none');
  });

  test('picking a saved location fills the field with its id for the booking', async () => {
    const env = await withPatient();
    const sel = env.$('bsp-loc-select');
    sel.value = '1'; sel.dispatchEvent(new env.win.Event('change'));
    expect(env.$('bsp-location').value).toBe('Example Primary School, Willetton WA 6155');
    expect(env.$('bsp-location').dataset.locId).toBe('loc-school');
    expect(env.$('bsp-location').dataset.placeId).toBe('ChIJschool');
  });

  test('without the server the Splose address on file is still offered', async () => {
    const env = makeEnv({ api: { 'GET /api/client-locations/501': [502, { error: 'x' }] } });
    env.ev('document.getElementById("booking-side-panel").classList.add("open"); BOOKING_STATE.selectedPatient = ' + JSON.stringify(PAT) + '; renderRightContext();');
    await flush();
    expect(options(env)[1]).toBe('Home — ' + PAT.address);
    expect(env.$('bsp-loc-meta').textContent).toMatch(/unavailable/);
  });

  test('Add another: a Google pick is saved to the client with its place id and selected', async () => {
    let posted;
    const env = await withPatient({ 'POST /api/client-locations/501': (b) => { posted = b; return [201, { duplicate: false, location: { id: 'loc-new', label: 'Day Program', address: b.address, placeId: b.placeId, source: 'manual' } }]; } });
    const sel = env.$('bsp-loc-select');
    sel.value = '__add'; sel.dispatchEvent(new env.win.Event('change'));
    expect(env.$('bsp-location').hidden).toBe(false);
    env.$('bsp-loc-add').querySelector('[data-br-label="Day Program"]').click();
    const input = env.$('bsp-location');
    input.value = '20 Example Road, Canning Vale WA 6155'; input.dataset.placeId = 'ChIJday'; input.dataset.lat = '-32.06'; input.dataset.lng = '115.92';
    input.dispatchEvent(new env.win.Event('change', { bubbles: true }));
    await flush();
    expect(posted).toMatchObject({ address: '20 Example Road, Canning Vale WA 6155', label: 'Day Program', placeId: 'ChIJday', lat: -32.06, lng: 115.92 });
    expect(options(env)).toContain('Day Program — 20 Example Road, Canning Vale WA 6155');
    expect(input.dataset.locId).toBe('loc-new');
    expect(env.$('bsp-loc-meta').textContent).toMatch(/Saved as Day Program/);
  });

  test('a duplicate selects the existing location instead of adding a second', async () => {
    const env = await withPatient({ 'POST /api/client-locations/501': [200, { duplicate: true, of: 'saved', location: LIST.locations[1] }] });
    const sel = env.$('bsp-loc-select');
    sel.value = '__add'; sel.dispatchEvent(new env.win.Event('change'));
    const input = env.$('bsp-location');
    input.value = 'Example Primary School, Willetton'; input.dataset.placeId = 'ChIJschool';
    input.dispatchEvent(new env.win.Event('change', { bubbles: true }));
    await flush();
    expect(options(env).filter((t) => /^School/.test(t))).toHaveLength(1);
    expect(env.$('bsp-loc-meta').textContent).toMatch(/Already saved as School/);
  });
});

describe('work location before Smart Scheduling', () => {
  test('a client booking on a day without a base shows the inline notice with Set weekly location', async () => {
    const env = makeEnv({ week: {} });
    env.ev("openBookingPanel({ day: 'mon', startH: 9, startM: 0 })");
    await flush(80);
    const n = env.$('bsp-wl-notice');
    expect(n.hidden).toBe(false);
    expect(n.textContent).toMatch(/Work location required for Smart Scheduling/);
    expect(n.querySelector('[data-br="set-weekly"]').textContent).toBe('Set weekly location');
  });

  test('a day with a real base needs no notice', async () => {
    const env = makeEnv({ week: { mon: 'home-1' }, homes: [{ id: 'home-1', label: 'Home', addr: HOME_ADDR, suburb: 'Bull Creek' }] });
    env.ev("openBookingPanel({ day: 'mon', startH: 9, startM: 0 })");
    await flush(80);
    expect(env.$('bsp-wl-notice').hidden).toBe(true);
  });

  test('Set weekly location keeps the unfinished booking and reopens it on return', async () => {
    const env = makeEnv({ week: {} });
    env.ev("openWorkLocationsForCalendarWeek = function () { __calls.setWeekly++; closeBookingPanel(false); }");
    env.ev("openBookingPanel({ day: 'mon', startH: 11, startM: 15 })");
    await flush(80);
    env.$('bsp-location').value = CV_ADDR;
    env.$('bsp-wl-notice').querySelector('[data-br="set-weekly"]').click();
    expect(env.ev('__calls.setWeekly')).toBe(1);
    env.$('view-calendar').classList.add('active'); // back on the calendar
    await flush(300);
    const reopened = env.ev('__calls.opened[__calls.opened.length - 1]');
    expect(reopened).toMatchObject({ day: 'mon', startH: 11, startM: 15 });
  });

  test('another clinician\'s base is read for them, not the signed-in user', () => {
    const env = makeEnv({ week: { mon: 'home-1' }, homes: [{ id: 'home-1', addr: HOME_ADDR }] });
    const r = env.ev(`BookingRoute.baseFromSchedule({ '2026-W40': { mon: 'h9' } }, { homes: [{ id: 'h9', addr: '5 Their St, Como WA', label: 'Their home' }] }, '2026-W40', 'mon')`);
    expect(r).toMatchObject({ status: 'set', key: 'h9', base: { addr: '5 Their St, Como WA' } });
    expect(env.ev(`BookingRoute.baseFromSchedule({}, {}, '2026-W40', 'mon')`).status).toBe('unset');
    expect(env.ev(`BookingRoute.baseFromSchedule({ w: { mon: 'office' } }, { office: { addr: 'x' } }, 'w', 'mon')`).status).toBe('unset');
  });
});

describe('after Create appointment — What would you like to do next?', () => {
  const INFO = { dbId: 'db-A', day: 'mon', startMin: 540, endMin: 600, durationMin: 60, location: A_ADDR, patientName: 'Ada Client', patientId: 501, serviceLeaf: 'svc-1' };
  function booked(cfg) {
    const env = makeEnv(cfg);
    env.ev(`SESSIONS.A = { id: 'A', day: 'mon', type: 'therapy', startH: 9, startM: 0, endH: 10, endM: 0, address: ${JSON.stringify(A_ADDR)}, patient: 'Ada Client', dbId: 'db-A' }`);
    env.ev('BookingRoute.showContinuation(' + JSON.stringify(INFO) + ')');
    return env;
  }
  const dialog = (env) => env.win.document.querySelector('.br-next');
  const patches = (env) => env.log.filter((c) => c.method === 'PATCH' && /\/api\/events\/db-A\/travel$/.test(c.url));
  const appointmentWrites = (env) => env.log.filter((c) => /\/api\/outlook\/events/.test(c.url));

  test('offers exactly the three choices', () => {
    const env = booked();
    expect(dialog(env).querySelector('#br-next-title').textContent).toBe('What would you like to do next?');
    expect(Array.from(dialog(env).querySelectorAll('.br-choice strong')).map((s) => s.textContent))
      .toEqual(['Return Home', 'Book Another Client', 'Go Somewhere Else']);
  });

  test('Return Home routes client → the clinician\'s own base for that day and saves the leg', async () => {
    const env = booked({ week: { mon: 'home-1' }, homes: [{ id: 'home-1', label: 'Home', addr: HOME_ADDR, suburb: 'Bull Creek' }],
      routes: { [A_ADDR + '|' + HOME_ADDR]: 22 } });
    dialog(env).querySelector('[data-next="home"]').click();
    await flush();
    expect(env.routeCalls()[0].body).toMatchObject({ origin: A_ADDR, destination: HOME_ADDR });
    expect(patches(env)).toHaveLength(1);
    expect(patches(env)[0].body.after).toMatchObject({ kind: 'base', id: 'home-1', purpose: 'home', travelMin: 22 });
    expect(dialog(env)).toBeNull();
    expect(appointmentWrites(env)).toHaveLength(0);
  });

  test('Return Home with no base for the day says what to do and invents nothing', async () => {
    const env = booked({ week: {} });
    dialog(env).querySelector('[data-next="home"]').click();
    await flush();
    expect(dialog(env).querySelector('.br-msg').textContent).toMatch(/No home\/base set for Monday/);
    expect(dialog(env).querySelector('[data-next="set-weekly"]')).not.toBeNull();
    expect(patches(env)).toHaveLength(0);
    expect(env.routeCalls()).toHaveLength(0);
  });

  test('Return Home when routing fails offers Retry and never saves a made-up time', async () => {
    const env = booked({ week: { mon: 'home-1' }, homes: [{ id: 'home-1', label: 'Home', addr: HOME_ADDR }], routes: {} });
    dialog(env).querySelector('[data-next="home"]').click();
    await flush();
    expect(dialog(env).querySelector('.br-msg').textContent).toMatch(/Unable to calculate travel/);
    expect(patches(env)).toHaveLength(0);
    dialog(env).querySelector('[data-br-act="home-plain"]').click();
    await flush();
    expect(patches(env)[0].body.after).toEqual({ kind: 'base', id: 'home-1', purpose: 'home' }); // no travelMin
  });

  test('Book Another Client keeps A as the previous stop and reopens the same panel after it', async () => {
    const env = booked({ week: { mon: 'home-1' }, homes: [{ id: 'home-1', addr: HOME_ADDR }] });
    dialog(env).querySelector('[data-next="another"]').click();
    await flush(100);
    expect(dialog(env)).toBeNull();
    expect(env.ev('__calls.opened[__calls.opened.length - 1]')).toMatchObject({ day: 'mon', startH: 10, startM: 0, endH: 11, endM: 0 });
    expect(env.ev('BOOKING_ROUTE.context')).toMatchObject({ dbId: 'db-A', endMin: 600, address: A_ADDR, label: 'Ada Client' });
    expect(env.ev('BOOKING_STATE.travelFrom.dbId')).toBe('db-A');
    expect(appointmentWrites(env)).toHaveLength(0);
  });

  test('Go Somewhere Else: a remembered destination is routed and saved as the leg — no appointment', async () => {
    const FSH = 'Fiona Stanley Hospital, 11 Robin Warren Dr, Murdoch WA 6150';
    const env = booked({ routes: { [A_ADDR + '|' + FSH]: 18 }, api: {
      'GET /api/travel-destinations': [200, { destinations: [{ id: 'd-1', label: 'Fiona Stanley Hospital', address: FSH, placeId: 'ChIJfsh' }] }],
      'POST /api/travel-destinations': (b) => [200, { duplicate: true, destination: { id: 'd-1', label: b.label, address: b.address } }],
    } });
    dialog(env).querySelector('[data-next="elsewhere"]').click();
    await flush();
    expect(dialog(env).querySelector('.br-else-title').textContent).toBe('Where are you going next?');
    dialog(env).querySelector('[data-else="0"]').click();
    await flush();
    expect(patches(env)[0].body.after).toMatchObject({ kind: 'address', address: FSH, label: 'Fiona Stanley Hospital', purpose: 'elsewhere', travelMin: 18, placeId: 'ChIJfsh', destinationId: 'd-1' });
    expect(appointmentWrites(env)).toHaveLength(0);
    expect(env.log.some((c) => /client-locations/.test(c.url))).toBe(false); // never tied to the client
  });

  test('Go Somewhere Else: a new place from Google autocomplete is routed, remembered and saved', async () => {
    const SUP = 'Mobility Supplies, 5 Supply Rd, Bibra Lake WA 6163';
    let remembered;
    const env = booked({ routes: { [A_ADDR + '|' + SUP]: 14 }, api: {
      'GET /api/travel-destinations': [200, { destinations: [] }],
      'POST /api/travel-destinations': (b) => { remembered = b; return [201, { duplicate: false, destination: { id: 'd-2', label: b.label, address: b.address } }]; },
    } });
    dialog(env).querySelector('[data-next="elsewhere"]').click();
    await flush();
    const places = env.ev('__calls.places');
    const ac = places[places.length - 1];
    ac.el.value = SUP;
    ac.cb(SUP, '-32.09', '115.82', 'ChIJsup');
    dialog(env).querySelector('#br-else-name').value = 'Equipment supplier';
    dialog(env).querySelector('[data-br-act="else-go"]').click();
    await flush();
    expect(remembered).toMatchObject({ address: SUP, label: 'Equipment supplier', placeId: 'ChIJsup' });
    expect(patches(env)[0].body.after).toMatchObject({ kind: 'address', address: SUP, label: 'Equipment supplier', placeId: 'ChIJsup', lat: -32.09, travelMin: 14, destinationId: 'd-2' });
    expect(appointmentWrites(env)).toHaveLength(0);
  });

  test('a booking that did not save offers no continuation', async () => {
    const env = makeEnv();
    env.ev('onBookingCreated(' + JSON.stringify(Object.assign({}, INFO, { dbId: null })) + ')');
    await flush(200);
    expect(env.win.document.querySelector('.br-next')).toBeNull();
  });
});

describe('static wiring in the shell', () => {
  test('confirmBooking hands the saved booking to the continuation and Unsure carries no address', () => {
    const cb = SHELL.slice(SHELL.indexOf('async function confirmBooking()'), SHELL.indexOf('/* ---------- Reset wizard'));
    // Location is optional and never filled from the client's file behind the user.
    expect(cb).toMatch(/const _outlookLocation = _unsure \? '' : _typedLoc;/);
    expect(cb).not.toMatch(/patient\?\.address \|\| ''/);
    expect(cb).toMatch(/onBookingCreated\(\{\s+dbId: newDbId/);
    // No address → no place: never a stop at the client's suburb.
    expect(cb).toMatch(/locationUnknown: !_outlookLocation/);
    expect(cb).toMatch(/suburb: _outlookLocation \? \(patient\?\.suburb \|\| ''\) : ''/);
  });

  test('opening the panel no longer pops the work-location chooser; booking still asks before saving', () => {
    expect(SHELL).not.toMatch(/ensureDayBase\(opts\.day\)/);
    expect(SHELL).toMatch(/await ensureDayBase\(slot\.day\)/);
  });

  test('booking-route.js loads after travel.js and escapes what it renders', () => {
    expect(SHELL.indexOf('/travel.js?v=')).toBeLessThan(SHELL.indexOf('/booking-route.js?v='));
    expect(SHELL.indexOf('/booking-route.js?v=')).toBeLessThan(SHELL.indexOf('/navigation.js?v='));
    expect(BOOKING_ROUTE).not.toMatch(/innerHTML\s*=\s*[^;]*\+\s*(l|d|it|info|dest)\.(address|label|patientName)\b/);
    expect(BOOKING_ROUTE).not.toMatch(/fetch\(['"]https?:/); // only the portal's own API
  });
});
