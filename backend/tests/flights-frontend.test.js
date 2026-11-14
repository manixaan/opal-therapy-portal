'use strict';

/**
 * Add a flight (frontend/current/flights.js, 14 Nov 2026): the block plan,
 * the live-status badge, revised-time shifts, manual time zones, and the
 * dialog's lookup → manual fallback and booking calls.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const SRC = fs.readFileSync(path.join(__dirname, '../../frontend/current/flights.js'), 'utf8');

const WINDOWS = [];
afterAll(() => WINDOWS.forEach((w) => w.close()));

function env({ lookup = { status: 503, body: { error: 'flight_lookup_unconfigured' } }, failCreateAt = -1 } = {}) {
  const dom = new JSDOM(`<section id="view-calendar" class="view active"></section><aside id="cal-sidebar"><button id="cal-add-flight"></button></aside>
    <div id="bd-body"></div>`, { runScripts: 'outside-only', url: 'http://localhost/' });
  const w = dom.window;
  WINDOWS.push(w);
  const log = [];
  w.SESSIONS = {};
  w.showToast = (...a) => log.push(['toast', ...a]);
  w.loadOutlookEventsToCalendar = () => log.push(['reload']);
  w.gotoWeekOf = (d) => log.push(['goto', d]);
  w.switchTab = () => {};
  w.fetchRoute = async (from, to, mode, o) => { log.push(['route', from, to, o && o.departureTime]); return { durationMin: 32, distanceMeters: 25400, source: 'routes-api' }; };
  w.eval('var WORK_BASES = { homes: [{ addr: "1 Home St, Willetton WA" }] };');
  let creates = 0;
  w.fetch = async (url, o) => {
    const body = o && o.body ? JSON.parse(o.body) : null;
    log.push([(o && o.method) || 'GET', url, body]);
    const json = (x, status = 200) => ({ ok: status < 400, status, json: async () => x });
    if (url.startsWith('/api/flights/lookup')) return json(lookup.body, lookup.status);
    if (url === '/api/outlook/events') {
      const n = creates++;
      return n === failCreateAt ? json({ error: 'Outlook said no' }, 500) : json({ ok: true, dbId: 'db-' + n }, 201);
    }
    if (/DELETE/.test((o && o.method) || '')) return json({ ok: true });
    return json({}, 404);
  };
  w.eval(SRC);
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); };
  return { w, log, flush, $: (id) => w.document.getElementById(id) };
}

describe('FlightTrack._plan', () => {
  const FT = env().w.FlightTrack;
  const base = { depUtc: '2026-11-20T01:35:00Z', arrUtc: '2026-11-20T05:45:00Z' };

  test('drive → check-in → flight → drive, back to back; drives rounded up to 5 min', () => {
    const p = FT._plan({ ...base, bufferMin: 90, afterLandingMin: 20, driveToMin: 32, driveFromMin: 41 });
    expect(p.map((b) => [b.role, b.start, b.end, b.minutes])).toEqual([
      ['drive-to', '2026-11-19T23:30:00.000Z', '2026-11-20T00:05:00.000Z', 35],
      ['checkin', '2026-11-20T00:05:00.000Z', '2026-11-20T01:35:00.000Z', 90],
      ['flight', '2026-11-20T01:35:00.000Z', '2026-11-20T05:45:00.000Z', 250],
      ['drive-from', '2026-11-20T06:05:00.000Z', '2026-11-20T06:50:00.000Z', 45],
    ]);
  });

  test('no drive, no buffer: only the flight; nonsense times give nothing', () => {
    expect(FT._plan({ ...base, bufferMin: 0, driveToMin: 0, driveFromMin: null }).map((b) => b.role)).toEqual(['flight']);
    expect(FT._plan({ depUtc: base.arrUtc, arrUtc: base.depUtc, bufferMin: 60 })).toEqual([]);
    expect(FT._plan({ depUtc: 'soon', arrUtc: base.arrUtc })).toEqual([]);
  });

  test('ceil5', () => {
    expect([0, 1, 5, 6, 32, -4, 'x'].map(FT._ceil5)).toEqual([0, 5, 5, 10, 35, 0, 0]);
  });
});

describe('live status badge and revised shifts', () => {
  const FT = env().w.FlightTrack;
  const leg = (status, sched, rev) => ({ status, departure: { scheduledUtc: sched, revisedUtc: rev }, arrival: {} });
  test('badges', () => {
    expect(FT._badge(leg('Expected', '2026-11-20T01:35:00Z', '2026-11-20T02:00:00Z'))).toEqual({ text: 'Delayed +25m', cls: 'warn' });
    expect(FT._badge(leg('Delayed', '2026-11-20T01:35:00Z', '2026-11-20T03:05:00Z')).text).toBe('Delayed +1h30');
    expect(FT._badge(leg('Expected', '2026-11-20T01:35:00Z', '2026-11-20T01:37:00Z')).text).toBe('On time');
    expect(FT._badge(leg('EnRoute')).text).toBe('Departed');
    expect(FT._badge(leg('Arrived')).text).toBe('Landed');
    expect(FT._badge(leg('Canceled')).cls).toBe('bad');
    expect(FT._badge(null)).toBeNull();
  });
  test('shift plan: departure delay moves drive-to, check-in and the flight start; arrival delay the flight end and drive-from', () => {
    const blocks = [
      { dbId: 'a', role: 'drive-to', start: '2026-11-19T23:30:00Z', end: '2026-11-20T00:05:00Z' },
      { dbId: 'b', role: 'checkin', start: '2026-11-20T00:05:00Z', end: '2026-11-20T01:35:00Z' },
      { dbId: 'c', role: 'flight', start: '2026-11-20T01:35:00Z', end: '2026-11-20T05:45:00Z' },
      { dbId: 'd', role: 'drive-from', start: '2026-11-20T06:05:00Z', end: '2026-11-20T06:50:00Z' },
    ];
    const m = FT._shiftPlan(blocks, 25 * 60000, 15 * 60000);
    expect(m).toEqual([
      { dbId: 'a', start: '2026-11-19T23:55:00.000Z', end: '2026-11-20T00:30:00.000Z' },
      { dbId: 'b', start: '2026-11-20T00:30:00.000Z', end: '2026-11-20T02:00:00.000Z' },
      { dbId: 'c', start: '2026-11-20T02:00:00.000Z', end: '2026-11-20T06:00:00.000Z' },
      { dbId: 'd', start: '2026-11-20T06:20:00.000Z', end: '2026-11-20T07:05:00.000Z' },
    ]);
  });
  test('manual local times convert through the time zone', () => {
    expect(FT._zonedToUtc('2026-11-20T09:35', 'Australia/Perth')).toBe('2026-11-20T01:35:00.000Z');
    expect(FT._zonedToUtc('2026-11-20T16:45', 'Australia/Sydney')).toBe('2026-11-20T05:45:00.000Z'); // AEDT
    expect(FT._zonedToUtc('nope', 'Australia/Perth')).toBeNull();
  });
  test('only flights departing within 36 h (or in the air) with a lookup date are tracked', () => {
    const now = Date.parse('2026-11-19T00:00:00Z');
    const fl = { number: 'QF643', date: '2026-11-20', depUtc: '2026-11-20T01:35:00Z', arrUtc: '2026-11-20T05:45:00Z' };
    expect(FT._trackable(fl, now)).toBe(true);
    expect(FT._trackable(fl, Date.parse('2026-11-17T00:00:00Z'))).toBe(false);
    expect(FT._trackable(fl, Date.parse('2026-11-20T08:00:00Z'))).toBe(false);
    expect(FT._trackable({ ...fl, date: undefined }, now)).toBe(false);
  });
});

describe('the dialog', () => {
  test('no key on the server: manual entry, buffer required, four blocks booked in order', async () => {
    const { w, log, flush, $ } = env();
    $('cal-add-flight').click();
    $('flt-number').value = 'qf643';
    $('flt-date').value = '2026-11-20';
    w.document.querySelector('[data-act="find"]').click();
    await flush();
    expect($('flt-manual').hidden).toBe(false);
    expect($('flt-find-status').textContent).toMatch(/not set up/);
    $('flt-m-from').value = 'PER'; $('flt-m-to').value = 'Melbourne';
    $('flt-m-dep').value = '2026-11-20T09:35'; $('flt-m-arr').value = '2026-11-20T16:45';
    $('flt-m-arrtz').value = 'Australia/Melbourne';
    $('flt-m-arr').dispatchEvent(new w.Event('change', { bubbles: true }));
    await flush();
    const add = w.document.querySelector('[data-act="add"]');
    expect($('flt-buffer').value).toBe('');               // no built-in default
    expect(add.disabled).toBe(true);
    expect($('flt-plan').textContent).toMatch(/Set your check-in/);
    expect($('flt-from').value).toBe('1 Home St, Willetton WA');
    $('flt-buffer').value = '90';
    $('flt-buffer').dispatchEvent(new w.Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 400)); await flush();
    expect(add.disabled).toBe(false);
    // The drive to the airport is priced twice: an estimate, then at the time it will be driven.
    const toAirport = log.filter((l) => l[0] === 'route' && l[2] === 'PER Airport');
    expect(toAirport.length).toBe(2);
    expect(toAirport[1][3]).toBe('2026-11-19T23:30:00.000Z');
    add.click();
    await flush();
    const posts = log.filter((l) => l[0] === 'POST').map((l) => l[2]);
    expect(posts.map((p) => p.booking.kind)).toEqual(['travel-block', 'flight-checkin', 'flight', 'travel-block']);
    expect(posts.map((p) => p.title)).toEqual(['Travel: Home → PER Airport', 'Check-in & boarding · QF643', 'Flight QF643 PER→Melbourne', 'Travel: Melbourne Airport → Home']);
    expect(posts.every((p) => p.categories[0] === 'Travel' && /^flt-/.test(p.requestId))).toBe(true);
    expect(posts[2].booking.flight).toMatchObject({ number: 'QF643', depUtc: '2026-11-20T01:35:00.000Z', arrUtc: '2026-11-20T05:45:00.000Z', bufferMin: 90, source: 'manual' });
    expect(posts[0].booking.route).toMatchObject({ from: '1 Home St, Willetton WA', to: 'PER Airport', minutes: 35 });
    expect(w.localStorage.getItem('opal.flight.bufferMin')).toBe('90');
    expect(log.some((l) => l[0] === 'goto' && l[1] === '2026-11-20')).toBe(true);
    expect(w.document.querySelector('.flt-backdrop')).toBeNull();
  });

  test('a failed create stops, says what was added, and can remove it', async () => {
    const lookup = { status: 200, body: { flights: [{ number: 'QF643', airline: 'Qantas', status: 'Expected',
      departure: { iata: 'PER', name: 'Perth', city: 'Perth', scheduledUtc: '2026-11-20T01:35:00.000Z' },
      arrival: { iata: 'SYD', name: 'Sydney', city: 'Sydney', scheduledUtc: '2026-11-20T05:45:00.000Z' } }] } };
    const { w, log, flush, $ } = env({ lookup, failCreateAt: 1 });
    w.localStorage.setItem('opal.flight.bufferMin', '60');
    $('cal-add-flight').click();
    expect($('flt-buffer').value).toBe('60');             // remembered from last time
    $('flt-number').value = 'QF643'; $('flt-date').value = '2026-11-20';
    w.document.querySelector('[data-act="find"]').click();
    await flush();
    expect($('flt-results').textContent).toMatch(/PER → SYD/);
    $('flt-to').value = ''; $('flt-to').dispatchEvent(new w.Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 800)); await flush();
    w.document.querySelector('[data-act="add"]').click();
    await flush();
    const posts = log.filter((l) => l[0] === 'POST');
    expect(posts).toHaveLength(2);                         // stopped at the failure
    expect(posts[1][2].booking.flight).toMatchObject({ source: 'lookup', date: '2026-11-20', from: { iata: 'PER', name: 'Perth' } });
    expect($('flt-result').textContent).toMatch(/Not everything was added.*Check-in & boarding · QF643.*Outlook said no/);
    expect($('flt-result').textContent).toMatch(/Added: “Travel: Home → Perth Airport”/);
    w.document.querySelector('[data-act="undo-partial"]').click();
    await flush();
    expect(log.some((l) => l[0] === 'DELETE' && l[1] === '/api/outlook/events/db-0')).toBe(true);
    expect($('flt-result').textContent).toMatch(/Removed/);
  });

  test('the event panel shows the flight and offers revised times without moving anything', async () => {
    const lookup = { status: 200, body: { flights: [{ number: 'QF643', status: 'Delayed',
      departure: { iata: 'PER', scheduledUtc: '2026-11-20T01:35:00.000Z', revisedUtc: '2026-11-20T02:00:00.000Z', terminal: '3', gate: '12' },
      arrival: { iata: 'SYD', scheduledUtc: '2026-11-20T05:45:00.000Z', revisedUtc: '2026-11-20T06:00:00.000Z' } }] } };
    const { w, log, flush, $ } = env({ lookup });
    const fl = { number: 'QF643', date: '2026-11-20', depUtc: '2026-11-20T01:35:00.000Z', arrUtc: '2026-11-20T05:45:00.000Z', from: { iata: 'PER' }, to: { iata: 'SYD' } };
    const el = w.document.createElement('div');
    w.SESSIONS.s1 = { id: 's1', dbId: 'db-9', element: el, booking: { kind: 'flight', flight: fl }, startTimeIso: fl.depUtc, endTimeIso: fl.arrUtc };
    // Force a refresh rather than depend on today's date.
    w.flightDecorateDetail(w.SESSIONS.s1);
    $('flt-detail').querySelector('[data-flt-refresh]').click();
    await flush();
    expect($('flt-detail').textContent).toMatch(/Delayed \+25m/);
    expect($('flt-detail').textContent).toMatch(/T3 · Gate 12/);
    expect($('flt-detail').querySelector('[data-flt-revise]')).not.toBeNull();
    expect(log.some((l) => l[0] === 'PATCH')).toBe(false);
    expect(el.querySelector('.flt-badge').textContent).toBe('Delayed +25m');
    $('flt-detail').querySelector('[data-flt-revise]').click();
    await flush();
    const patch = log.find((l) => l[0] === 'PATCH');
    expect(patch[1]).toBe('/api/outlook/events/db-9');
    expect(patch[2]).toEqual({ startTime: '2026-11-20T02:00:00.000Z', endTime: '2026-11-20T06:00:00.000Z' });
  });
});
