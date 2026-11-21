'use strict';

/**
 * One address, one place (21 Nov 2026 audit T-02 / T-04 / T-16).
 *
 * Smart Booking stores a Splose client address as "7 Mock St, Thornlie, WA,
 * 6108". addrSuburb read "" from it, so leg labels fell back to the street,
 * the Outlook travel title carried the client's street address, and a failed
 * route estimated 0 minutes ("Same place · no drive"). canonAddr left the
 * empty segments in ("…, thornlie, ,"), so one place had several cache keys.
 *
 * The browser (travel.js) and billing (route-facts.js) must canonicalise the
 * same way — this file runs both over the same strings.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const RF = require('../billing/route-facts');

const SRC = fs.readFileSync(path.join(__dirname, '../../frontend/current/travel.js'), 'utf8');

function load() {
  const noop = () => {};
  const el = () => ({ style: {}, dataset: {}, classList: { add: noop, remove: noop, toggle: noop }, addEventListener: noop, appendChild: noop, querySelector: () => null, querySelectorAll: () => [], setAttribute: noop });
  const ctx = {
    console, setTimeout, clearTimeout, Promise, Map, Set, Date, Math, JSON,
    document: { addEventListener: noop, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: el, body: el(), activeElement: null },
    START_H: 0, END_H: 24, HOUR_PX: 72, WORK_S: 8, WORK_E: 18,
    tToY: (h, m = 0) => (h + m / 60) * 72,
    WORK_BASES: { office: {}, homes: [] }, LOCATIONS: {},
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    SESSIONS: {},
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return ctx;
}
const c = load();

const SPELLINGS = [
  '7 Mock Street, Thornlie, WA, 6108',
  '7 Mock Street, Thornlie WA 6108',
  '7 Mock Street, Thornlie WA 6108, Australia',
  '7 Mock Street, Thornlie, Western Australia 6108',
  '7 Mock Street, Thornlie, Western Australia, 6108',
];

describe('addrSuburb', () => {
  test.each(SPELLINGS)('reads the suburb from %s', (a) => {
    expect(c.addrSuburb(a)).toBe('Thornlie');
  });
  test.each([
    ['100 Burrendah Blvd, Willetton WA 6155', 'Willetton'],
    ['4 Jarrah Ln, Mount Claremont WA 6010, Australia', 'Mount Claremont'],
    ['3 Fixture Close, Riverton, WA, 6148', 'Riverton'],
    ['Willetton', 'Willetton'],
    ['Willetton WA', 'Willetton'],
    ['Canning Vale', 'Canning Vale'],
  ])('%s → %s', (a, want) => {
    expect(c.addrSuburb(a)).toBe(want);
  });
  test('a failed route between two Splose-format suburbs is still a drive, not "same place"', () => {
    expect(c.estimateTravelMinFromTable('3 Fixture Close, Applecross, WA, 6153', '9 Example Rd, Melville, WA, 6156')).toBe(6);
  });
});

describe('canonAddr — one key per place, browser and server alike', () => {
  test('every spelling of one place is one key', () => {
    const keys = new Set(SPELLINGS.map((a) => c.canonAddr(a)));
    expect([...keys]).toEqual(['7 mock street, thornlie']);
  });
  test.each([
    ...SPELLINGS,
    '100 Burrendah Blvd, Willetton WA 6155',
    'Unit 1, 5 Smith St, Bull Creek WA 6153',
    'Willetton', '  Canning  Vale ', '', 'Level 2/10 Example Rd, Osborne Park WA 6017',
  ])('travel.js and route-facts.js agree on %j', (a) => {
    expect(c.canonAddr(a)).toBe(RF.canonAddr(a));
  });
  test('an address that was already clean keeps its key (stored facts still match)', () => {
    expect(RF.routeKey('100 Burrendah Blvd, Willetton WA 6155', 'Willetton')).toBe(RF.legacyRouteKey('100 Burrendah Blvd, Willetton WA 6155', 'Willetton'));
  });
});

describe('billing still finds a fact stored under the old key', () => {
  test('a manual fact under the pre-21-Nov key is used, not re-fetched', async () => {
    const o = '3 Fixture Close, Riverton, WA, 6148', d = '9 Example Rd, Melville, WA, 6156';
    const oldKey = RF.legacyRouteKey(o, d);
    expect(oldKey).not.toBe(RF.routeKey(o, d));
    const q = { query: jest.fn(async (sql, params) => {
      if (/^\s*SELECT/.test(sql)) {
        expect(params[1]).toEqual(expect.arrayContaining([RF.routeKey(o, d), oldKey]));
        return { rows: [{ route_key: oldKey, minutes: 17, km: 9, provider: 'manual', status: 'ok', fetched_at: new Date() }] };
      }
      throw new Error('no write expected');
    }) };
    const out = await RF.resolveRouteFacts(q, 1, [{ origin: o, destination: d }]);
    expect(out.get(RF.routeKey(o, d))).toMatchObject({ minutes: 17, provider: 'manual', status: 'ok', cached: true });
  });
});

describe('Outlook travel titles carry suburbs only', () => {
  test('a Splose-format destination is titled by suburb, never the street', () => {
    vm.runInContext("DAY_DATES = { wed: '2030-03-06' };", c);
    c.SESSIONS = { S1: { id: 'S1', dbId: 'db-1', day: 'wed' } };
    const seg = (fromLoc, toLoc) => ({ kind: 'between', ownerSessionId: 'S1', ownerSide: 'before', travelMin: 13, startMin: 600, endMin: 613, fromLoc, toLoc });
    const p = c.travelOutlookPayload('wed', [
      seg({ suburb: 'Palmyra', label: 'Palmyra' }, { suburb: 'Thornlie', label: 'Client · 7 Mock Street, Thornlie, WA, 6108', address: '7 Mock Street, Thornlie, WA, 6108' }),
    ]);
    expect(p.legs[0].title).toBe('Travel · 13 min · Palmyra → Thornlie');
    // A point whose "suburb" is really a whole address is cut back to the suburb;
    // with no suburb at all the title says "next stop", never the label.
    const q = c.travelOutlookPayload('wed', [
      seg({ suburb: '12 Example St, Palmyra WA 6157', label: 'x' }, { suburb: null, label: 'Client · 7 Mock Street' }),
    ]);
    expect(q.legs[0].title).toBe('Travel · 13 min · Palmyra → next stop');
    expect(JSON.stringify([p.legs[0].title, q.legs[0].title])).not.toMatch(/Mock Street|Example St/);
  });
});
