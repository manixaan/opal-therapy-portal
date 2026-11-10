'use strict';

/**
 * TRAVEL BLOCK (10 Nov 2026) — the Smart Booking travel block, in a real DOM.
 *
 * jsdom runs the production travel-block.js against the panel markup it uses.
 * fetchRoute, bspSetDur and the other shell globals are small stand-ins with
 * the same contract — no Google, no server, nothing booked. The shell wiring
 * (picker, leaf, Create appointment, detail panel) is pinned by source checks,
 * as is the retired Local/Remote home-base picker and the panel's client name.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const FRONTEND = path.join(__dirname, '..', '..', 'frontend', 'current');
const TB_SRC = fs.readFileSync(path.join(FRONTEND, 'travel-block.js'), 'utf8');
const SHELL = fs.readFileSync(path.join(FRONTEND, 'mockup_v3.html'), 'utf8');
const PROFILE = fs.readFileSync(path.join(FRONTEND, 'profile.js'), 'utf8');

function load({ route, here } = {}) {
  const dom = new JSDOM(`<!doctype html><body>
    <input id="travel-from"><input id="travel-to"><div id="travel-route-status" hidden></div>
    <div class="bsp-loc-field"></div></body>`, { runScripts: 'outside-only' });
  const w = dom.window;
  const calls = { route: [], dur: [] };
  w.currentBookingLeaf = () => ({ group: 'travel' });
  w._getBspTiming = () => ({ day: 'mon', startH: 10, startM: 0, startISO: '2026-11-09T10:00:00+08:00' });
  w.bspSetDur = (m) => calls.dur.push(m);
  w.whereAtMin = () => (here ? { address: here } : null);
  w.attachPlacesAutocomplete = () => {};
  w.fetchRoute = async (o, d, mode, opts) => { calls.route.push({ o, d, mode, opts }); return route === undefined ? { durationMin: 21, distanceMeters: 14800, source: 'routes-api' } : route; };
  vm.runInContext(TB_SRC, dom.getInternalVMContext());
  return { w, calls, TB: w.TravelBlock, $: (id) => w.document.getElementById(id) };
}

describe('travel-block.js', () => {
  test('both ends → Google route at the start time sets the length (rounded up to 5 min)', async () => {
    const { TB, calls, $ } = load();
    $('travel-from').value = '1 A St, Willetton WA'; $('travel-to').value = '2 B Rd, Bull Creek WA';
    await TB.recalc();
    expect(calls.route[0]).toMatchObject({ o: '1 A St, Willetton WA', d: '2 B Rd, Bull Creek WA', mode: 'driving',
      opts: { departureTime: '2026-11-09T10:00:00+08:00' } });
    expect(calls.dur).toEqual([25]);
    expect(TB.route()).toEqual({ from: '1 A St, Willetton WA', to: '2 B Rd, Bull Creek WA', minutes: 21, distanceKm: 14.8 });
    expect($('travel-route-status').textContent).toMatch(/21 min · 14.8 km/);
  });

  test('one end missing: no route, nothing to book', async () => {
    const { TB, calls, $ } = load();
    $('travel-from').value = '1 A St';
    await TB.recalc();
    expect(calls.route).toHaveLength(0);
    expect(TB.route()).toBeNull();
  });

  test('an unroutable drive warns and leaves the length alone', async () => {
    const { TB, calls, $ } = load({ route: null });
    $('travel-from').value = 'A'; $('travel-to').value = 'B';
    await TB.recalc();
    expect(calls.dur).toHaveLength(0);
    expect($('travel-route-status').textContent).toMatch(/Could not work out/);
    expect(TB.route()).toEqual({ from: 'A', to: 'B' });
  });

  test('choosing it starts from where you are, hides Location; leaving brings it back', () => {
    const { TB, $, w } = load({ here: '9 Here St, Riverton WA' });
    TB.onSelect();
    expect($('travel-from').value).toBe('9 Here St, Riverton WA');
    expect(w.document.querySelector('.bsp-loc-field').hidden).toBe(true);
    TB.onLeave();
    expect(w.document.querySelector('.bsp-loc-field').hidden).toBe(false);
  });

  test('title and detail rows', () => {
    const { TB } = load();
    expect(TB.titleFor('1 A St, Willetton WA', 'Willetton Library, 1 Rd')).toBe('Travel: 1 A St → Willetton Library');
    const row = (k, v) => k + '=' + v;
    expect(TB.detailRows({ booking: { group: 'travel', route: { from: 'A<', to: 'B', minutes: 20, distanceKm: 12 } } }, row))
      .toEqual(expect.arrayContaining(['From=A&lt;', 'To=B', 'Drive=20 min · 12 km']));
    expect(TB.detailRows({ booking: { group: 'nf2f' } }, row)).toEqual([]);
  });
});

describe('shell wiring', () => {
  test('Travel block is a billable booking type, saved as Travel with its route', () => {
    expect(SHELL).toMatch(/data-leaf="travel-block" onclick="selectBookingLeaf\('travel-block'\)"/);
    expect(SHELL).toMatch(/'travel-block':\s+\{ cat: 'travel', group: 'travel', client: 'optional'/);
    expect(SHELL).toMatch(/'travel-block': \['Travel', 'travel'\]/);
    expect(SHELL).toMatch(/\.\.\.\(_travelRoute \? \{ route: _travelRoute \} : \{\}\)/);
    expect(SHELL).toMatch(/TravelBlock\.detailRows\(s, row\)/);
  });

  test('home bases have no Local/Remote picker; a saved remote base loads as local', () => {
    expect(SHELL).not.toMatch(/<option value="remote"/);
    expect(SHELL).not.toMatch(/setHomeBase\('\$\{h\.id\}','kind'/);
    expect(PROFILE).toMatch(/kind: 'local', color: '#9a5f0e'/);
  });

  test('the event panel names the client from the event row or its booking', () => {
    expect(SHELL).toMatch(/clientName: event\.client_name \|\| null/);
    const src = SHELL.slice(SHELL.indexOf('function bdClientNames(s)'));
    const body = src.slice(0, src.indexOf('\n}\n') + 2);
    const bdClientNames = new Function(body + '; return bdClientNames;')();
    expect(bdClientNames({ patient: 'Al A' })).toEqual(['Al A']);
    expect(bdClientNames({ clientName: 'Bo B' })).toEqual(['Bo B']);
    expect(bdClientNames({ booking: { clientName: 'Cy C' } })).toEqual(['Cy C']);
    expect(bdClientNames({ booking: { clients: [{ clientName: 'D' }, { clientName: 'E' }] } })).toEqual(['D', 'E']);
    expect(bdClientNames({ title: 'Lunch' })).toEqual([]);
  });
});
