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
  vm.runInContext(grab(/function calYToMinutes\(col, clientY, mode\) \{[\s\S]*?\n\}/), ctx);
  const col = { getBoundingClientRect: () => ({ top: 0 }) };
  const at = (h, m) => ((h * 60 + m) / 60) * 72;

  test.each([[10, 2, 600], [10, 8, 615], [10, 22, 615], [10, 24, 630]])('create: %i:%i snaps to minute %i', (h, m, want) => {
    expect(ctx.calYToMinutes(col, at(h, m))).toBe(want);
    expect(ctx.calSnapMin(h * 60 + m)).toBe(want);
  });

  // A single click books the slot it is in (30 Sep 2026); drags and the end of a drag still round.
  test('a click floors to the slot clicked', () => {
    expect(ctx.calYToMinutes(col, at(10, 8), 'floor')).toBe(600);
    expect(ctx.calYToMinutes(col, at(10, 22), 'floor')).toBe(615);
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

describe('Smart Booking: straight on from the last client, or home in between', () => {
  const HOME = { week: { mon: 'home-1' }, homes: [{ id: 'home-1', label: 'Home', addr: HOME_ADDR, suburb: 'Bull Creek' }] };
  const routes = { [A_ADDR + '|' + CV_ADDR]: 25, [HOME_ADDR + '|' + CV_ADDR]: 20 };
  function laterBooking(env, at) {
    env.ev(`SESSIONS.A = { id: 'A', day: 'mon', type: 'therapy', startH: 9, startM: 0, endH: 10, endM: 0,
      address: ${JSON.stringify(A_ADDR)}, patient: 'Ada Client', dbId: 'db-A' }`);
    env.ev(`document.getElementById('booking-side-panel').classList.add('open'); bspSelectDay('mon');
      document.getElementById('bsp-start').value = '${at}';`);
  }

  test('a long gap after the last client: the proposal is routed from home', async () => {
    const env = makeEnv(Object.assign({ routes }, HOME));
    laterBooking(env, '14:00');
    await chooseLocation(env, CV_ADDR);
    const call = env.routeCalls().pop().body;
    expect([call.origin, call.destination]).toEqual([HOME_ADDR, CV_ADDR]);
    expect(status(env).textContent).toMatch(/Home after Ada Client/);
    expect(status(env).textContent).toMatch(/20 min drive from Home/);
    expect(status(env).querySelector('[data-route="direct"]')).not.toBeNull();
  });

  test('"Go direct instead" routes from the client, and Create keeps that choice on the earlier session', async () => {
    const env = makeEnv(Object.assign({ routes }, HOME));
    laterBooking(env, '14:00');
    await chooseLocation(env, CV_ADDR);
    status(env).querySelector('[data-route="direct"]').click();
    await flush();
    const call = env.routeCalls().pop().body;
    expect([call.origin, call.destination]).toEqual([A_ADDR, CV_ADDR]);
    expect(status(env).textContent).toMatch(/25 min drive from Ada Client/);
    expect(status(env).querySelector('[data-route="home"]')).not.toBeNull();
    await env.ev('bspCommitBetweenChoice()');
    const patch = env.log.filter((c) => c.method === 'PATCH' && c.url === '/api/events/db-A/travel').pop();
    expect(patch.body).toEqual({ next: 'direct', afterOffsetMin: null });
    expect(env.ev('BOOKING_ROUTE.viaMode')).toBe('auto');
  });

  // The day's drive home is never deleted, only moved (6 Oct 2026).
  const realLeg = (env, sel) => env.win.document.querySelector('#day-mon .travel-overlay' + sel + ':not(.preview)');
  const homeAfter = (env) => env.win.document.querySelector('#day-mon .travel-overlay.preview.home-after');

  test('before a location is chosen, the drive home after the last client stays on the calendar', async () => {
    const env = makeEnv(Object.assign({ routes }, HOME));
    laterBooking(env, '10:30');
    env.ev("refreshDayOverlays('mon')");
    env.ev('runBspRoutePreview()');
    await flush();
    expect(realLeg(env, '.end')).not.toBeNull();
    expect(realLeg(env, '.end').classList.contains('suppressed')).toBe(false);
    expect(homeAfter(env)).toBeNull();
  });

  test('direct: the drive home moves to after the proposed session', async () => {
    const env = makeEnv(Object.assign({ routes }, HOME));
    laterBooking(env, '10:30');
    env.ev("refreshDayOverlays('mon')");
    await chooseLocation(env, CV_ADDR);
    expect(status(env).querySelector('.bsp-route-switch').textContent).toBe('Direct ⇄');
    expect(realLeg(env, '.end').classList.contains('suppressed')).toBe(true);
    expect(homeAfter(env)).not.toBeNull();
    expect(homeAfter(env).style.top).toBe(env.ev('tToY(11, 30)') + 'px');   // 10:30 + 60 min
  });

  test('via home: the drive home after the earlier client stays, and the day still ends with one', async () => {
    const env = makeEnv(Object.assign({ routes }, HOME));
    laterBooking(env, '14:00');
    env.ev("refreshDayOverlays('mon')");
    await chooseLocation(env, CV_ADDR);
    expect(status(env).querySelector('.bsp-route-switch').textContent).toBe('Via home ⇄');
    expect(realLeg(env, '.end').classList.contains('suppressed')).toBe(false);
    expect(homeAfter(env)).not.toBeNull();
  });

  // The split moment while the route is still being calculated (6 Oct 2026).
  const calculating = (env, at) => {
    laterBooking(env, at);
    env.ev("refreshDayOverlays('mon')");
    env.$('bsp-location').value = CV_ADDR;              // chosen, not yet routed
    env.ev('runBspRoutePreview({ cachedOnly: true })');
    return env.win.document.querySelector('#day-mon .travel-overlay.preview.placeholder');
  };

  test('while calculating, via home: the drive home stays put and the new travel waits below it', () => {
    const env = makeEnv(Object.assign({ routes }, HOME));
    const ph = calculating(env, '14:00');
    const home = realLeg(env, '.end');
    expect(home.classList.contains('suppressed')).toBe(false);
    expect(ph).not.toBeNull();
    expect(parseFloat(ph.style.top)).toBeGreaterThanOrEqual(parseFloat(home.style.top) + parseFloat(home.style.height));
  });

  test('while calculating, direct: the drive home goes at once and the new travel takes its place', () => {
    const env = makeEnv(Object.assign({ routes }, HOME));
    const ph = calculating(env, '10:30');
    expect(realLeg(env, '.end').classList.contains('suppressed')).toBe(true);
    expect(ph.style.top).toBe(env.ev('tToY(10, 0)') + 'px');   // where the drive home began
  });

  test('Create keeps what the preview showed, even when it was only the suggestion', async () => {
    const env = makeEnv(Object.assign({ routes }, HOME));
    laterBooking(env, '14:00');
    await chooseLocation(env, CV_ADDR);
    await env.ev('bspCommitBetweenChoice()');
    const patch = env.log.filter((c) => c.method === 'PATCH' && c.url === '/api/events/db-A/travel').pop();
    expect(patch.body).toEqual({ next: 'home', afterOffsetMin: null });
  });

  test('the calendar leg between two clients is the switch: Direct ⇄ flips to Via home ⇄', async () => {
    const env = makeEnv(Object.assign({ routes }, HOME));
    env.ev(`SESSIONS.A = { id: 'A', day: 'mon', type: 'therapy', startH: 9, startM: 0, endH: 10, endM: 0,
      address: ${JSON.stringify(A_ADDR)}, patient: 'Ada Client', dbId: 'db-A' };
      SESSIONS.B = { id: 'B', day: 'mon', type: 'therapy', startH: 10, startM: 30, endH: 11, endM: 30,
      address: ${JSON.stringify(CV_ADDR)}, patient: 'Ben Client', dbId: 'db-B' };`);
    env.ev("refreshDayOverlays('mon')");
    const sw = () => env.win.document.querySelector('#day-mon .travel-overlay .t-switch');
    expect(sw().textContent).toBe('Direct ⇄');
    sw().click();
    await flush();
    const patch = env.log.filter((c) => c.method === 'PATCH' && c.url === '/api/events/db-A/travel').pop();
    expect(patch.body).toEqual({ next: 'home', afterOffsetMin: null });
    expect(sw().textContent).toBe('Via home ⇄');
    expect(env.win.document.querySelectorAll('#day-mon .travel-overlay .t-switch')).toHaveLength(1);   // one switch per gap
  });

  test('the travel panel offers exactly two options — no "Automatic"', () => {
    expect(TRAVEL).not.toContain('>Automatic</button>');
    expect(TRAVEL).toContain("Travel from ' + stopAt(gapFrom) + ' to ' + stopAt(gapTo)");
  });

  test('too early for the drive: it says when the client CAN be seen, and one click moves the proposal there', async () => {
    const env = makeEnv(Object.assign({ routes }, HOME));
    laterBooking(env, '10:15');                         // 25 min drive after a 10:00 finish
    env.ev("BOOKING_STATE.selectedPatient = { id: 'p1', first: 'Sean', last: 'Hickey' }");
    await chooseLocation(env, CV_ADDR);
    expect(status(env).textContent).toMatch(/Not enough time to get here from Ada Client/);
    expect(status(env).textContent).toMatch(/Earliest you can see Sean Hickey: 10:30 AM \(direct\)/);
    status(env).querySelector('[data-route="earliest"]').click();
    await flush();
    expect(start(env)).toBe('10:30');
    expect(status(env).textContent).not.toMatch(/Not enough time/);
  });

  test('the suggested time follows the switch: via home is later than direct', async () => {
    const env = makeEnv(Object.assign({ routes }, HOME));
    laterBooking(env, '10:15');
    await chooseLocation(env, CV_ADDR);
    const direct = env.ev('BOOKING_ROUTE.suggestedStartMin');
    status(env).querySelector('[data-route="home"]').click();
    await flush();
    expect(status(env).textContent).toMatch(/\(via home\)/);
    expect(env.ev('BOOKING_ROUTE.suggestedStartMin')).toBeGreaterThan(direct);
    expect(status(env).querySelector('[data-route="earliest"]').textContent)
      .toBe('Move to ' + env.ev('fmtTime(Math.floor(BOOKING_ROUTE.suggestedStartMin / 60), BOOKING_ROUTE.suggestedStartMin % 60)'));
  });

  test('no time to go home: straight on, with the option to go home anyway', async () => {
    const env = makeEnv(Object.assign({ routes }, HOME));
    laterBooking(env, '10:30');
    await chooseLocation(env, CV_ADDR);
    expect(env.routeCalls().pop().body.origin).toBe(A_ADDR);
    expect(status(env).querySelector('[data-route="home"]')).not.toBeNull();
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

  test('Book Another Client carries only the route — no booking type or client is pre-selected', async () => {
    const env = booked({ week: { mon: 'home-1' }, homes: [{ id: 'home-1', addr: HOME_ADDR }] });
    env.ev("window.__leafCalls = 0; var __sbl = selectBookingLeaf; selectBookingLeaf = function (id) { __leafCalls++; return __sbl(id); }; BOOKING_STATE.selectedPatient = null;");
    dialog(env).querySelector('[data-next="another"]').click();
    await flush(100);
    expect(env.ev('__leafCalls')).toBe(0);                 // the last booking's type is not re-picked
    expect(env.ev('BOOKING_STATE.category')).toBe('client'); // the client list is shown to choose from
    expect(env.ev('BOOKING_STATE.selectedPatient')).toBeNull();
    expect(env.ev('BOOKING_STATE.travelFrom.dbId')).toBe('db-A');
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

  test('Go Somewhere Else with an appointment later that day: the place becomes the way there, replacing an earlier Direct', async () => {
    const SUP = 'Mobility Supplies, 5 Supply Rd, Bibra Lake WA 6163';
    const env = booked({ routes: { [A_ADDR + '|' + SUP]: 14 }, api: {
      'GET /api/travel-destinations': [200, { destinations: [] }],
      'POST /api/travel-destinations': (b) => [201, { duplicate: false, destination: { id: 'd-3', label: b.label, address: b.address } }],
    } });
    env.ev(`SESSIONS.A.travel = { next: 'direct' };
      SESSIONS.B = { id: 'B', day: 'mon', type: 'therapy', startH: 16, startM: 0, endH: 17, endM: 0, address: ${JSON.stringify(CV_ADDR)}, patient: 'Ben Client', dbId: 'db-B' };`);
    dialog(env).querySelector('[data-next="elsewhere"]').click();
    await flush();
    const places = env.ev('__calls.places');
    const ac = places[places.length - 1];
    ac.el.value = SUP;
    ac.cb(SUP, '-32.09', '115.82', 'ChIJsup');
    dialog(env).querySelector('#br-else-name').value = 'Supplier';
    dialog(env).querySelector('[data-br-act="else-go"]').click();
    await flush();
    const p = patches(env);
    expect(p[0].body.after).toMatchObject({ address: SUP, purpose: 'elsewhere' });
    expect(p[1].body).toEqual({ next: null, afterOffsetMin: null });     // the Direct choice is cleared
    const L = env.ev("computeDayTravelSegments('mon')").filter((x) => x.kind === 'between');
    expect(L.map((x) => x.via)).toEqual(['place-in', 'place-out']);
    expect(L[0].toLoc.label).toBe('Supplier');
  });

  test('Return Home with an appointment later that day means home in between', async () => {
    const HOMEB = { week: { mon: 'home-1' }, homes: [{ id: 'home-1', label: 'Home', addr: HOME_ADDR, suburb: 'Bull Creek' }] };
    const env = booked(Object.assign({ routes: { [A_ADDR + '|' + HOME_ADDR]: 18 } }, HOMEB));
    env.ev(`SESSIONS.B = { id: 'B', day: 'mon', type: 'therapy', startH: 16, startM: 0, endH: 17, endM: 0, address: ${JSON.stringify(CV_ADDR)}, patient: 'Ben Client', dbId: 'db-B' };`);
    dialog(env).querySelector('[data-next="home"]').click();
    await flush();
    const p = patches(env);
    expect(p[0].body.after).toMatchObject({ kind: 'base', id: 'home-1', purpose: 'home' });
    expect(p[1].body).toEqual({ next: 'home', afterOffsetMin: null });
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

describe('Where am I working? — the calendar day picker and the saved week (6 Oct 2026)', () => {
  const HOME = { week: { mon: 'home-1' }, homes: [{ id: 'home-1', label: 'Home', addr: HOME_ADDR, suburb: 'Bull Creek', kind: 'local' }] };
  function withHeads(env, loaded) {
    env.ev(`var WL_DAYS = ['mon','tue']; var WL_DAY_LABEL = { mon: 'Mon', tue: 'Tue' };
      var __saves = 0; function debouncedSaveWorkSchedule() { __saves++; }
      var __undo = []; window.OpalUndo = { register: function (e) { __undo.push(e); return e; } };
      var __loaded = ${loaded ? 'true' : 'false'};
      window.workScheduleLoaded = function () { return __loaded; };
      function rebuildLocationCatalogue() {
        LOCATIONS = { office: { label: 'Office (coming soon)', comingSoon: true } };
        WORK_BASES.homes.forEach(function (h) { LOCATIONS[h.id] = { label: h.label, color: '#9a5f0e' }; });
        LOCATIONS.leave = { label: 'On leave' };
      }
      ['mon','tue'].forEach(function (d) { var h = document.createElement('div'); h.className = 'cal-head'; h.dataset.day = d; document.body.appendChild(h); });`);
  }
  const pick = (env, d) => env.win.document.querySelector('.cal-head[data-day="' + d + '"] select.day-loc');

  test('each weekday shows the saved location; an unset day says so', () => {
    const env = makeEnv(HOME);
    withHeads(env, true);
    env.ev('renderDayLocationPickers()');
    expect(pick(env, 'mon').value).toBe('home-1');
    expect(pick(env, 'mon').disabled).toBe(false);
    expect(pick(env, 'tue').value).toBe('');
    expect(pick(env, 'tue').closest('.day-loc-wrap').classList.contains('unset')).toBe(true);
    expect(pick(env, 'tue').closest('.day-loc-wrap').querySelector('.day-loc-text').textContent).toBe('Set location');
    expect(pick(env, 'mon').closest('.day-loc-wrap').querySelector('.day-loc-text').textContent).toBe('Home');
    // the coming-soon office cannot be chosen
    expect(pick(env, 'tue').querySelector('option[value="office"]').disabled).toBe(true);
  });

  test('before the saved week arrives the picker waits — it never claims "Not set"', () => {
    const env = makeEnv(HOME);
    withHeads(env, false);
    env.ev('renderDayLocationPickers()');
    expect(pick(env, 'mon').disabled).toBe(true);
    expect(pick(env, 'mon').options[0].textContent).toBe('Loading…');
  });

  test('a change writes the same week My Profile edits, saves it, and is one Cmd+Z step', async () => {
    const env = makeEnv(HOME);
    withHeads(env, true);
    env.ev('renderDayLocationPickers()');
    pick(env, 'tue').value = 'home-1';
    pick(env, 'tue').dispatchEvent(new env.win.Event('change'));
    expect(env.ev('__week.tue')).toBe('home-1');
    expect(env.ev('__saves')).toBe(1);
    expect(env.ev('__undo.length')).toBe(1);
    await env.ev('__undo[0].undo()');
    expect(env.ev('__week.tue')).toBeUndefined();
    expect(pick(env, 'tue').value).toBe('');
  });

  test('"Where are you working?" waits for the saved week instead of asking about a day that is set', async () => {
    const env = makeEnv({ homes: HOME.homes });
    withHeads(env, false);
    env.ev(`window.workScheduleReady = function () { __week.mon = 'home-1'; __loaded = true; return Promise.resolve(true); };`);
    const key = await env.ev("ensureDayBase('mon')");
    expect(key).toBe('home-1');
  });

  test('the page never saves its empty week over the stored one before it has loaded', () => {
    const prof = fs.readFileSync(path.join(FRONTEND, 'profile.js'), 'utf8');
    const save = prof.slice(prof.indexOf('async function saveWorkSchedule()'), prof.indexOf('function debouncedSaveWorkSchedule'));
    expect(save).toContain('if (!_wsLoaded) { workScheduleReady()');
    expect(prof).toMatch(/\(function bootWorkSchedule\(tries\)/);
  });
});

describe('Splose sync never pops up (6 Oct 2026)', () => {
  const SYNC = fs.readFileSync(path.join(FRONTEND, 'splose-sync.js'), 'utf8');
  test('no idle nudge, no tab-leave prompt, no page-close warning', () => {
    expect(SYNC).not.toMatch(/Unsynced changes/);
    expect(SYNC).not.toMatch(/title: 'Sync Splose\?'/);
    expect(SYNC).not.toMatch(/addEventListener\('beforeunload'/);
    expect(SYNC).not.toMatch(/installTabGuard/);
  });
  test('the Sync Splose button and the server\'s auto-sync status stay', () => {
    expect(SYNC).toMatch(/function ensureButton\(/);
    expect(SYNC).toMatch(/S\.autoSync = r\.json\.autoSyncEnabled === true;/);
  });
});

// 10 Oct 2026: decorateTiles rewrote every pending chip's text on each pass. A
// same-text textContent write still replaces the text node, which re-fired the
// #cal-grid observer that calls decorateTiles — a permanent ~8 Hz loop. The real
// module boots here against a scripted fetch and one pending tile.
describe('Splose tile chips settle — decorating never re-triggers itself', () => {
  const SYNC = fs.readFileSync(path.join(FRONTEND, 'splose-sync.js'), 'utf8');
  const GRID = `<!doctype html><body>
    <section id="view-calendar"><div class="cal-topbar"></div></section>
    <div id="cal-grid"><div class="cal-col" id="day-mon"><div class="session" id="tile-1"></div></div></div>
  </body>`;
  const open = [];
  afterEach(() => { while (open.length) open.pop().close(); });   // stops the module's polls

  async function boot(row) {
    const dom = new JSDOM(GRID, { runScripts: 'outside-only', url: 'http://localhost/' });
    const win = dom.window;
    open.push(win);
    const state = { row };
    const reply = (json) => ({ ok: true, status: 200, json: async () => json });
    win.fetch = async (url) => {
      if (url === '/api/splose/sync-status') return reply({ draftSyncEnabled: true });
      if (url === '/api/splose-sync/pending') return reply({ changes: [state.row] });
      if (url === '/api/splose-sync/alerts') return reply({ alerts: [] });
      return reply({});
    };
    win.eval(`var APP_USER = { id: 'me', role: 'therapist' };
      var SESSIONS = { s1: { id: 's1', dbId: 'db-1', element: document.getElementById('tile-1') } };`);
    win.eval(SYNC);
    await flush(400);   // boot → first decorate → chip appended → one more pass
    return { win, state, chip: () => win.document.querySelector('#tile-1 .splose-chip') };
  }
  function watch(win) {
    const recs = [];
    new win.MutationObserver((list) => recs.push(...list)).observe(win.document.getElementById('cal-grid'),
      { childList: true, subtree: true, attributes: true, characterData: true });
    return recs;
  }

  test('once the chip is drawn, the grid goes quiet — no further mutations of any kind', async () => {
    const env = await boot({ eventId: 'db-1', status: 'pending', action: 'update' });
    expect(env.chip().textContent).toBe('↑');
    const recs = watch(env.win);
    await flush(500);   // four debounce windows: the old code rewrote the chip in each
    expect(recs).toHaveLength(0);
  });

  test('a second pass over the same queue writes nothing; a status change still updates the chip', async () => {
    const env = await boot({ eventId: 'db-1', status: 'pending', action: 'update' });
    const recs = watch(env.win);
    await env.win.SploseSync.refresh();
    await flush(300);
    expect(recs).toHaveLength(0);

    env.state.row = { eventId: 'db-1', status: 'failed', action: 'update', error: 'rate limited' };
    await env.win.SploseSync.refresh();
    expect(env.chip().textContent).toBe('!');
    expect(env.chip().title).toBe('Splose sync failed: rate limited');
    expect(env.chip().classList.contains('failed')).toBe(true);
    await flush(300);
    const settled = recs.length;
    await flush(400);
    expect(recs.length).toBe(settled);
  });
});

describe('deleting a session re-plans the travel either side (6 Oct 2026)', () => {
  const HOME = { week: { mon: 'home-1' }, homes: [{ id: 'home-1', label: 'Home', addr: HOME_ADDR, suburb: 'Bull Creek', kind: 'local' }] };
  const popup = (env) => env.win.document.querySelector('.pd-backdrop .pd-dialog');
  const travelPatches = (env, db) => env.log.filter((c) => c.method === 'PATCH' && c.url === '/api/events/' + db + '/travel');
  function day(env) {
    // Noah 7:45 (chose Direct to Sean), Sean 9:30, Noah again 16:00 at the same address.
    env.ev(`SESSIONS.N1 = { id: 'N1', day: 'mon', type: 'therapy', startH: 7, startM: 45, endH: 8, endM: 45, address: ${JSON.stringify(A_ADDR)}, patient: 'Noah Mathew', dbId: 'db-N1', travel: { next: 'direct' } };
      SESSIONS.S  = { id: 'S',  day: 'mon', type: 'therapy', startH: 9, startM: 30, endH: 10, endM: 30, address: ${JSON.stringify(CV_ADDR)}, patient: 'Sean Hickey', dbId: 'db-S' };
      SESSIONS.N2 = { id: 'N2', day: 'mon', type: 'therapy', startH: 16, startM: 0, endH: 17, endM: 0, address: ${JSON.stringify(A_ADDR)}, patient: 'Noah Mathew', dbId: 'db-N2' };`);
  }

  test('the stale Direct is cleared and the new gap is asked about — Via home is the suggestion for a long gap', async () => {
    const env = makeEnv(HOME);
    day(env);
    env.ev("var __ctx = travelNeighboursOf('S'); delete SESSIONS.S; var __done = travelReplanAfterDelete(__ctx);");
    await flush();
    expect(travelPatches(env, 'db-N1')[0].body).toEqual({ next: null, afterOffsetMin: null });
    expect(popup(env).textContent).toMatch(/Travel after removing Sean Hickey/);
    expect(popup(env).textContent).toMatch(/Noah Mathew 7:45am and Noah Mathew 4:00pm are now back to back/);
    const opts = Array.from(popup(env).querySelectorAll('.tc-opt')).map((b) => b.textContent);
    expect(opts[0]).toMatch(/^Go direct to Noah Mathew · same place, no drive$/);
    expect(opts[1]).toMatch(/^Go home in between · \d+ min home, \d+ min out \(suggested\)$/);
    popup(env).querySelector('[data-key="home"]').click();
    expect(await env.ev('__done')).toBe('home');
    expect(travelPatches(env, 'db-N1').pop().body).toEqual({ next: 'home', afterOffsetMin: null });
    const L = env.ev("computeDayTravelSegments('mon')").filter((x) => x.kind === 'between');
    expect(L.map((x) => x.via)).toEqual(['home-return', 'home-out']);
  });

  test('a session that now ends the day: keep the drive home, or change where the day ends', async () => {
    const env = makeEnv(HOME);
    day(env);
    env.ev("delete SESSIONS.N2; var __opened = null; openTravelPanel = function (seg) { __opened = seg.kind; };");
    env.ev("var __ctx = travelNeighboursOf('S'); delete SESSIONS.S; var __done = travelReplanAfterDelete(__ctx);");
    await flush();
    expect(popup(env).textContent).toMatch(/Noah Mathew 7:45am is now the last stop on Monday\. The day ends with the drive to Home/);
    popup(env).querySelector('[data-key="change"]').click();
    expect(await env.ev('__done')).toBe('change');
    expect(env.ev('__opened')).toBe('end');
  });

  test('deleting a telehealth (no address) changes no travel and asks nothing', () => {
    const env = makeEnv(HOME);
    day(env);
    env.ev("SESSIONS.T = { id: 'T', day: 'mon', type: 'therapy', startH: 11, startM: 0, endH: 11, endM: 30, patient: 'Tele Client', dbId: 'db-T' };");
    expect(env.ev("travelNeighboursOf('T')")).toBeNull();
  });

  test('the shell reads the neighbours before the tile goes and re-plans after the delete succeeds', () => {
    const del = SHELL.slice(SHELL.indexOf('async function performDeleteEvent('), SHELL.indexOf('/* ---------- Detail drawer'));
    expect(del.indexOf('travelNeighboursOf(id)')).toBeLessThan(del.indexOf('__removeSessionTile(id, cols)'));
    expect(del.indexOf('travelReplanAfterDelete(replan)')).toBeGreaterThan(del.indexOf("if (!r.ok) {"));
  });
});

describe('same place twice in a day: the choice stays visible (6 Oct 2026)', () => {
  const HOME = { week: { mon: 'home-1' }, homes: [{ id: 'home-1', label: 'Home', addr: HOME_ADDR, suburb: 'Bull Creek', kind: 'local' }] };
  test('a "Direct" between two sessions at one address draws a slim Same place marker with the switch', async () => {
    const env = makeEnv(HOME);
    env.ev(`SESSIONS.N1 = { id: 'N1', day: 'mon', type: 'therapy', startH: 7, startM: 45, endH: 8, endM: 45, address: ${JSON.stringify(A_ADDR)}, patient: 'Noah Mathew', dbId: 'db-N1', travel: { next: 'direct' } };
      SESSIONS.N2 = { id: 'N2', day: 'mon', type: 'therapy', startH: 16, startM: 0, endH: 17, endM: 0, address: ${JSON.stringify(A_ADDR)}, patient: 'Noah Mathew', dbId: 'db-N2' };`);
    env.ev("refreshDayOverlays('mon')");
    const stay = env.win.document.querySelector('#day-mon .travel-overlay.stay');
    expect(stay.textContent).toMatch(/Same place/);
    expect(stay.querySelector('.t-switch').textContent).toBe('Direct ⇄');
    // it is not a drive: not mirrored to Outlook, not a badge's "travel linked"
    expect(env.ev("travelOutlookPayload('mon', computeDayTravelSegments('mon')).legs.some(function (l) { return / 0 min /.test(l.title); })")).toBe(false);
    expect(env.ev("travelBadgeState(SESSIONS.N1, computeDayTravelSegments('mon')).text")).not.toMatch(/\b0 min\b/);
    stay.querySelector('.t-switch').click();
    await flush();
    expect(env.win.document.querySelector('#day-mon .travel-overlay .t-switch').textContent).toBe('Via home ⇄');
  });
});

describe('travel follows a dragged session (6 Oct 2026)', () => {
  const HOME = { week: { mon: 'home-1' }, homes: [{ id: 'home-1', label: 'Home', addr: HOME_ADDR, suburb: 'Bull Creek', kind: 'local' }] };
  const leg = (env, sel) => env.win.document.querySelector('#day-mon .travel-overlay' + sel);
  function day(env) {
    env.ev(`SESSIONS.A = { id: 'A', day: 'mon', type: 'therapy', startH: 9, startM: 0, endH: 10, endM: 0, address: ${JSON.stringify(A_ADDR)}, patient: 'Ada Client', dbId: 'db-A' };
      SESSIONS.B = { id: 'B', day: 'mon', type: 'therapy', startH: 11, startM: 0, endH: 12, endM: 0, address: ${JSON.stringify(CV_ADDR)}, patient: 'Ben Client', dbId: 'db-B' };`);
    env.ev("refreshDayOverlays('mon')");
  }

  test('while dragged, the session\'s own legs move with it — and its real times are untouched', () => {
    const env = makeEnv(HOME);
    day(env);
    const before = parseFloat(leg(env, '.end').style.top);
    env.ev("previewTravelForMove('B', 'mon', 13 * 60, 60)");          // drag B from 11:00 to 13:00
    expect(parseFloat(leg(env, '.end').style.top)).toBeCloseTo(before + 2 * env.ev('HOUR_PX'), 0);   // the drive home follows
    expect(leg(env, '.end').classList.contains('drag-preview')).toBe(true);
    expect(env.ev('[SESSIONS.B.startH, SESSIONS.B.endH]')).toEqual([11, 12]);
  });

  test('a drag never mirrors to Outlook; a cancel puts the real legs back', async () => {
    const env = makeEnv(HOME);
    day(env);
    const real = parseFloat(leg(env, '.end').style.top);
    await flush(2600);                                                   // the real day's own redraw + sync go first
    const syncsBefore = env.log.filter((c) => c.url === '/api/travel/outlook-sync').length;
    env.ev("previewTravelForMove('B', 'mon', 14 * 60, 60)");
    await flush(1700);                                                   // past the Outlook sync debounce
    expect(env.log.filter((c) => c.url === '/api/travel/outlook-sync').length).toBe(syncsBefore);
    env.ev('endTravelPreview(true)');
    expect(parseFloat(leg(env, '.end').style.top)).toBeCloseTo(real, 0);
    expect(leg(env, '.end').classList.contains('drag-preview')).toBe(false);
  });

  test('the shell wires it: drag and resize preview on a slot change, revert and commit end it', () => {
    expect(SHELL).toMatch(/if \(slotChanged && typeof previewTravelForMove === 'function'\) previewTravelForMove\(drag\.id, day, snappedStart, drag\.durationMin\);/);
    expect(SHELL).toMatch(/if \(edgesChanged && typeof previewTravelForMove === 'function'\) previewTravelForMove\(resize\.id, resize\.s\.day, newStart, newDur\);/);
    const revert = SHELL.slice(SHELL.indexOf('function revertDragVisuals()'), SHELL.indexOf('function revertDragVisuals()') + 200);
    expect(revert).toMatch(/endTravelPreview\(true\)/);
    const commit = SHELL.slice(SHELL.indexOf('function commitMove()'), SHELL.indexOf('function commitMove()') + 300);
    expect(commit).toMatch(/endTravelPreview\(false\)/);
  });
});

describe('a move that leaves no time for the travel is blocked, like an overlap (6 Oct 2026)', () => {
  const HOME = { week: { mon: 'home-1' }, homes: [{ id: 'home-1', label: 'Home', addr: HOME_ADDR, suburb: 'Bull Creek', kind: 'local' }] };
  function day(env, next) {
    env.ev(`SESSIONS.A = { id: 'A', day: 'mon', type: 'therapy', startH: 8, startM: 0, endH: 9, endM: 0, address: ${JSON.stringify(A_ADDR)}, patient: 'Ada Client', dbId: 'db-A', travel: ${next ? `{ next: '${next}' }` : '{}'} };
      SESSIONS.B = { id: 'B', day: 'mon', type: 'therapy', startH: 10, startM: 15, endH: 11, endM: 15, address: ${JSON.stringify(CV_ADDR)}, patient: 'Ed Client', dbId: 'db-B' };`);
  }

  test('via home chosen, and the move leaves too little time to go home and back out: blocked, with the way out named', () => {
    const env = makeEnv(HOME);
    day(env, 'home');
    const legs = env.ev("travelConflictsForMove('A', 'mon', 8 * 60 + 55, 60)");   // ends 9:55, Ed at 10:15
    expect(legs.length).toBeGreaterThan(0);
    expect(legs[0].ttl).toMatch(/^Not enough time for travel: \d+ min /);
    expect(legs.map((l) => l.sub).join(' ')).toMatch(/Switch the gap to Direct/);
    // nothing about the session itself changed
    expect(env.ev('[SESSIONS.A.startH, SESSIONS.A.endH]')).toEqual([8, 9]);
  });

  test('the same move with the gap on Direct (or the suggestion) fits — no block', () => {
    const env = makeEnv(HOME);
    day(env, null);
    expect(env.ev("travelConflictsForMove('A', 'mon', 8 * 60 + 55, 60)")).toEqual([]);
  });

  test('evaluateMove turns those legs into blockers', () => {
    const ev = SHELL.slice(SHELL.indexOf('function evaluateMove('), SHELL.indexOf('// 4. Day intensity alternation'));
    expect(ev).toMatch(/const legs = travelConflictsForMove\(id, newDay, newStartMin, durationMin\);/);
    expect(ev).toMatch(/legs\.forEach\(l => impacts\.push\(\{ sev: 'blocker', ttl: l\.ttl, sub: l\.sub \}\)\);\s+verdict = 'blocker';/);
  });
});

describe('precision move — right-click, ↑/↓ by the minute, Enter to lock (6 Oct 2026)', () => {
  const fnBody = (name) => SHELL.slice(SHELL.indexOf('function ' + name + '('), SHELL.indexOf('\n}', SHELL.indexOf('function ' + name + '(')));
  test('the right-click menu offers it for movable, live sessions only', () => {
    expect(fnBody('showCalContextMenu')).toMatch(/MOVABLE_TYPES\.has\(s\.type\) && !s\.cancelled \? `<div class="cal-ctx-menu-item" onclick="startPreciseMove\('\$\{id\}'\)">/);
  });
  test('↑/↓ step one minute, Shift five, inside the calendar window; the travel follows', () => {
    const start = fnBody('startPreciseMove');
    expect(start).toMatch(/const step = \(e\.shiftKey \? 5 : 1\) \* \(e\.key === 'ArrowUp' \? -1 : 1\);/);
    // one shared offset, clamped so EVERY session stays inside the window
    expect(start).toMatch(/precise\.delta = Math\.max\(lo, Math\.min\(hi, precise\.delta \+ step\)\);/);
    expect(start).toMatch(/precise\.items\.map\(i => START_H \* 60 - i\.orig\)/);
    expect(fnBody('renderPreciseMove')).toMatch(/previewTravelForMoves\(p\.items\.map\(i => \(\{ id: i\.id, day: i\.s\.day, startMin: i\.orig \+ p\.delta, dur: i\.dur \}\)\)\)/);
  });
  test('Enter goes through the same checks as a drop; Esc or a click elsewhere puts it back', () => {
    const finish = fnBody('finishPreciseMove');
    expect(finish).toMatch(/commitGroupMove\(moves, \(\) => \{/);
    // a single session keeps the usual path inside commitGroupMove
    expect(fnBody('commitGroupMove')).toMatch(/if \(moves\.length === 1\) \{\s+const m = moves\[0\];\s+openMoveImpact\(m\.id, m\.day, m\.startMin, m\.dur, evaluateMove\(m\.id, m\.day, m\.startMin, m\.dur\)\);/);
    expect(fnBody('startPreciseMove')).toMatch(/e\.key === 'Escape'[\s\S]*endPreciseMove\(false\)/);
    expect(fnBody('startPreciseMove')).toMatch(/precise\.onDown = \(e\) => \{ if \(precise && !precise\.items\.some\(i => i\.el\.contains\(e\.target\)\)\) endPreciseMove\(false\); \};/);
    const end = fnBody('endPreciseMove');
    expect(end).toMatch(/if \(!keep\) \{[\s\S]*endTravelPreview\(true\)/);
  });
});

describe('Shift+click multi-select — move a selection together (6 Oct 2026)', () => {
  const fnBody = (name) => SHELL.slice(SHELL.indexOf('function ' + name + '('), SHELL.indexOf('\n}', SHELL.indexOf('function ' + name + '(')));
  test('Shift+click toggles a session into the selection — no drag, no details; a plain press elsewhere starts over', () => {
    const down = fnBody('onBlockPointerDown');
    expect(down).toMatch(/if \(e\.shiftKey\) \{ e\.preventDefault\(\); toggleCalSelection\(id\); return; \}/);
    expect(down).toMatch(/if \(!CAL_SELECTION\.has\(id\)\) clearCalSelection\(\);/);
    expect(fnBody('toggleCalSelection')).toMatch(/MOVABLE_TYPES\.has\(s\.type\)/);
  });
  test('a reload never leaves an invisible selection behind', () => {
    expect(fnBody('pruneCalSelection')).toMatch(/!x\.element\.classList\.contains\('multi-selected'\)\) CAL_SELECTION\.delete\(id\)/);
  });
  test('right-click names the selection; precision move and drag both carry it', () => {
    expect(fnBody('showCalContextMenu')).toMatch(/Precision move\$\{CAL_SELECTION\.has\(id\) && CAL_SELECTION\.size > 1 \? ` \(\$\{CAL_SELECTION\.size\} sessions\)` : ''\}/);
    expect(fnBody('startPreciseMove')).toMatch(/calMoveSet\(id\)/);
    expect(fnBody('onBlockPointerDown')).toMatch(/group: draggable && CAL_SELECTION\.has\(id\) && CAL_SELECTION\.size > 1/);
    expect(SHELL).toMatch(/if \(slotChanged && drag\.group\) \{\s+_dragCarryGroup\(drag, day, snappedStart\);/);
  });
  test('a group is checked with every member already in place; one blocker moves nothing; commits never collide', () => {
    const c = fnBody('commitGroupMove');
    // all members placed before any evaluateMove, and put back after
    expect(c.indexOf('moves.forEach(m => { const e = m.startMin + m.dur; Object.assign(SESSIONS[m.id]')).toBeLessThan(c.indexOf('const impact = evaluateMove(m.id'));
    expect(c).toMatch(/finally \{\s+real\.forEach\(\(\[x, r\]\) => Object\.assign\(x, r\)\);/);
    expect(c).toMatch(/if \(blocked\) \{\s+if \(onBlocked\) onBlocked\(\);[\s\S]*openMoveImpact\(b\.id/);
    expect(c).toMatch(/sort\(\(a, b\) => \(later \? -1 : 1\)/);
    expect(c).toMatch(/window\.commitMove\(\);/);
  });
});
