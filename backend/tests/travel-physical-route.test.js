'use strict';

/**
 * Last known physical location + movable travel (4 Oct 2026).
 *
 *   an event WITH an address   → the therapist is now there
 *   an event WITHOUT one       → the therapist has not moved
 *
 * so travel runs between the PHYSICAL stops of the day, never between merely
 * consecutive events; and a leg's time is the therapist's (a drag stores an
 * offset on the appointment it belongs to) while its association — owner,
 * client, origin, destination, duration — stays computed. travel.js runs in a
 * vm with just the globals the engine reads.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '../../frontend/current/travel.js'), 'utf8');
const HOME = { id: 'home-1', label: 'Home', addr: '1 Example St, Willetton WA 6155', suburb: 'Willetton', kind: 'local' };
const OSBORNE = '10 Example Rd, Osborne Park WA 6017';
const JOONDALUP = '20 Example Ave, Joondalup WA 6027';
const SCHOOL = '5 Example Cres, Scarborough WA 6019';
const MIN = { 'Willetton|Osborne Park': 25, 'Osborne Park|Joondalup': 30, 'Joondalup|Willetton': 40,
  'Osborne Park|Scarborough': 15, 'Scarborough|Joondalup': 20, 'Osborne Park|Willetton': 25 };

function load() {
  const noop = () => {};
  const el = () => ({ style: {}, dataset: {}, classList: { add: noop, remove: noop, toggle: noop }, addEventListener: noop, appendChild: noop, querySelector: () => null, querySelectorAll: () => [], setAttribute: noop });
  const ctx = {
    console, setTimeout, clearTimeout, Promise, Map, Set, Date, Math, JSON,
    document: { addEventListener: noop, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: el, body: el(), activeElement: null },
    START_H: 0, END_H: 24, HOUR_PX: 72, WORK_S: 8, WORK_E: 18,
    tToY: (h, m = 0) => (h + m / 60) * 72,
    WORK_BASES: { office: {}, homes: [HOME] }, LOCATIONS: {},
    getBase: (id) => (id === 'home-1' ? HOME : null),
    sessionStartMin: (s) => s.startH * 60 + (s.startM || 0),
    sessionEndMin: (s) => s.endH * 60 + (s.endM || 0),
    showToast: jest.fn(),
    fetch: jest.fn(async () => ({ ok: true, json: async () => ({ ok: true }) })),
    SESSIONS: {},
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  vm.runInContext('calendarWeekLocations = function () { return { mon: "home-1" }; };', ctx);
  // Drive times by suburb, both directions — the engine never routes here.
  ctx.travelMinutes = (a, b) => {
    if (!a || !b || a === b) return 0;
    const sa = ctx.addrSuburb(a) || a, sb = ctx.addrSuburb(b) || b;
    if (sa === sb) return 0;
    return MIN[sa + '|' + sb] || MIN[sb + '|' + sa] || 22;
  };
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
const hhmm = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');

describe('where an event puts the therapist', () => {
  test('an address is a place; no address — whatever the type — is "not moved"', () => {
    const c = load();
    expect(c.isPhysicalLocation(c.sploseLocationForSession({ type: 'therapy', address: OSBORNE, patient: 'A' }))).toBe(true);
    for (const type of ['therapy', 'mdt', 'admin', 'report', 'cpd', 'lunch', 'outlook', 'meeting']) {
      const loc = c.sploseLocationForSession({ type, patient: type === 'therapy' ? 'A' : undefined });
      expect(c.isPhysicalLocation(loc)).toBe(false);
      expect(loc.address).toBeNull();
    }
  });

  test('a meeting link is not a street — "Microsoft Teams Meeting" never routes', () => {
    const c = load();
    for (const a of ['Microsoft Teams Meeting', 'Zoom', 'Phone call', 'https://teams.microsoft.com/l/x', 'Online']) {
      expect(c.isPhysicalLocation(c.sploseLocationForSession({ type: 'meeting', address: a }))).toBe(false);
    }
  });
});

describe('travel runs between physical stops', () => {
  test('Osborne Park → telehealth (no address) → Joondalup routes Osborne Park → Joondalup', () => {
    const c = load();
    const a = add(c, { at: '10:00', to: '11:00', s: { type: 'assessment', address: OSBORNE, patient: 'Client A' } });
    const t = add(c, { at: '11:30', to: '12:00', s: { patient: 'Client T' } });          // telehealth, no address
    const b = add(c, { at: '12:30', to: '13:30', s: { address: JOONDALUP, patient: 'Client B' } });
    const L = legs(c);
    expect(L.map((x) => x.kind)).toEqual(['start', 'between', 'end']);
    const mid = L[1];
    expect([mid.fromSessionId, mid.toSessionId]).toEqual([a.id, b.id]);
    expect(mid.fromLoc.suburb).toBe('Osborne Park');
    expect(mid.toLoc.suburb).toBe('Joondalup');
    expect(mid.travelMin).toBe(30);
    expect([hhmm(mid.startMin), hhmm(mid.endMin)]).toEqual(['12:00', '12:30']); // arrives as B starts
    expect(L.some((x) => x.fromSessionId === t.id || x.toSessionId === t.id)).toBe(false);
  });

  test('telehealth after the last visit: the drive home still starts from that visit', () => {
    const c = load();
    const a = add(c, { at: '10:00', to: '11:00', s: { address: OSBORNE, patient: 'Client A' } });
    add(c, { at: '11:00', to: '11:30', s: { patient: 'Client T' } });
    const end = legs(c).find((x) => x.kind === 'end');
    expect(end.fromSessionId).toBe(a.id);
    expect(end.fromLoc.suburb).toBe('Osborne Park');   // not "home" during the telehealth
    expect(end.toLoc.suburb).toBe('Willetton');
  });

  test('MDT with an address is a stop; the same MDT without one changes nothing', () => {
    const c = load();
    const a = add(c, { at: '09:00', to: '10:00', s: { address: OSBORNE, patient: 'Client A' } });
    const m = add(c, { at: '10:30', to: '11:30', s: { type: 'mdt', address: SCHOOL, patient: 'Client M' } });
    const b = add(c, { at: '12:00', to: '13:00', s: { address: JOONDALUP, patient: 'Client B' } });
    let between = legs(c).filter((x) => x.kind === 'between');
    expect(between.map((x) => [x.fromSessionId, x.toSessionId])).toEqual([[a.id, m.id], [m.id, b.id]]);
    expect(between.map((x) => x.travelMin)).toEqual([15, 20]);

    delete c.SESSIONS[m.id].address;                  // the remote MDT
    delete c.SESSIONS[m.id].__loc;
    c.SESSIONS[a.id].travel = { next: 'direct' };     // a 2 h gap would otherwise go home (tested below)
    between = legs(c).filter((x) => x.kind === 'between');
    expect(between.map((x) => [x.fromSessionId, x.toSessionId])).toEqual([[a.id, b.id]]);
    expect(between[0].travelMin).toBe(30);
  });

  test('admin, lunch and emails without an address, and persisted travel blocks, are not stops', () => {
    const c = load();
    const a = add(c, { at: '09:00', to: '10:00', s: { address: OSBORNE, patient: 'A' } });
    add(c, { at: '10:00', to: '10:30', s: { type: 'admin', title: 'Emails' } });
    add(c, { at: '10:30', to: '11:00', s: { type: 'lunch', title: 'Lunch' } });
    add(c, { at: '11:00', to: '11:30', s: { type: 'travel', title: 'Travel to Joondalup', address: JOONDALUP } });
    const b = add(c, { at: '11:30', to: '12:30', s: { address: JOONDALUP, patient: 'B' } });   // 90 min: too short to go home
    const between = legs(c).filter((x) => x.kind === 'between');
    expect(between).toHaveLength(1);
    expect([between[0].fromSessionId, between[0].toSessionId]).toEqual([a.id, b.id]);
  });

  test('a day with no physical stop has no travel at all', () => {
    const c = load();
    add(c, { at: '09:00', to: '10:00', s: { patient: 'Telehealth client' } });
    add(c, { at: '10:00', to: '11:00', s: { type: 'admin', title: 'Case Noting' } });
    expect(legs(c)).toHaveLength(0);
  });
});

describe('between two sessions: straight on, or home in between', () => {
  // Home is Willetton: Osborne Park ↔ home 25 min, Joondalup ↔ home 40 min.
  test('enough time to go home (drive + 30 min + drive) → two legs: home, then from home', () => {
    const c = load();
    const a = add(c, { at: '19:45', to: '20:45', s: { address: OSBORNE, patient: 'A' } });
    const b = add(c, { at: '22:15', to: '23:15', s: { address: SCHOOL, patient: 'B' } });
    // 90-minute gap ≥ 25 home + 30 there + 22 out (Scarborough)
    const L = legs(c).filter((x) => x.kind === 'between');
    expect(L.map((x) => x.via)).toEqual(['home-return', 'home-out']);
    expect([L[0].fromSessionId, L[0].toLoc.suburb, hhmm(L[0].startMin), hhmm(L[0].endMin)]).toEqual([a.id, 'Willetton', '20:45', '21:10']);
    expect([L[1].toSessionId, L[1].fromLoc.suburb, hhmm(L[1].startMin), hhmm(L[1].endMin)]).toEqual([b.id, 'Willetton', '21:53', '22:15']);
    expect(L.every((x) => x.auto && x.plan === 'home')).toBe(true);   // the suggestion is one of the two options
  });

  test('not enough time to go home → one direct leg', () => {
    const c = load();
    add(c, { at: '10:00', to: '11:00', s: { address: OSBORNE, patient: 'A' } });
    add(c, { at: '12:00', to: '13:00', s: { address: JOONDALUP, patient: 'B' } });   // 60 min < 25 + 30 + 40
    const L = legs(c).filter((x) => x.kind === 'between');
    expect(L).toHaveLength(1);
    expect([L[0].via, L[0].homeAvailable]).toEqual([null, true]);
  });

  test('the session\'s choice wins: "direct" keeps a long gap direct, "home" goes home anyway', () => {
    const c = load();
    const a = add(c, { at: '09:00', to: '10:00', s: { address: OSBORNE, patient: 'A', travel: { next: 'direct' } } });
    add(c, { at: '14:00', to: '15:00', s: { address: JOONDALUP, patient: 'B' } });
    expect(legs(c).filter((x) => x.kind === 'between').map((x) => x.via)).toEqual([null]);
    c.SESSIONS[a.id].travel = { next: 'home' };
    c.SESSIONS[a.id].endH = 11; c.SESSIONS[a.id].endM = 45;                        // now only 135 min… still home, by choice
    const L = legs(c).filter((x) => x.kind === 'between');
    expect(L.map((x) => [x.via, x.plan, x.auto])).toEqual([['home-return', 'home', false], ['home-out', 'home', false]]);
  });

  test('no home base for the day → always direct', () => {
    const c = load();
    vm.runInContext('calendarWeekLocations = function () { return {}; };', c);
    add(c, { at: '09:00', to: '10:00', s: { address: OSBORNE, patient: 'A' } });
    add(c, { at: '15:00', to: '16:00', s: { address: JOONDALUP, patient: 'B' } });
    const L = legs(c).filter((x) => x.kind === 'between');
    expect(L.map((x) => [x.via, x.homeAvailable])).toEqual([[null, false]]);
  });

  test('saving the choice PATCHes travel.next on the earlier session and resets its moved leg', async () => {
    const c = load();
    const a = add(c, { at: '09:00', to: '10:00', s: { address: OSBORNE, patient: 'A', travel: { afterOffsetMin: 15 } } });
    expect(await c.setBetweenTravel(a.id, 'home')).toBe(true);
    expect(JSON.parse(c.fetch.mock.calls[0][1].body)).toEqual({ next: 'home', afterOffsetMin: null });
    expect(c.SESSIONS[a.id].travel).toEqual({ next: 'home' });
    await c.setBetweenTravel(a.id, null);
    expect(JSON.parse(c.fetch.mock.calls[1][1].body)).toEqual({ next: null, afterOffsetMin: null });
  });
});

describe('movable travel', () => {
  test('telehealth before the drive home: move the leg to 12:30 — association intact, no duplicate', () => {
    const c = load();
    const s = add(c, { at: '11:00', to: '12:00', s: { address: OSBORNE, patient: 'Client A' } });
    let end = legs(c).find((x) => x.kind === 'end');
    expect([hhmm(end.startMin), hhmm(end.endMin)]).toEqual(['12:00', '12:25']);   // calculated: leave as it ends
    add(c, { at: '12:00', to: '12:30', s: { patient: 'Client T' } });              // telehealth from the car
    c.SESSIONS[s.id].travel = { afterOffsetMin: 30 };                                // the drag's result
    const all = legs(c);
    const ends = all.filter((x) => x.kind === 'end');
    expect(ends).toHaveLength(1);                                                    // never duplicated
    end = ends[0];
    expect([hhmm(end.startMin), hhmm(end.endMin)]).toEqual(['12:30', '12:55']);
    expect(end.moved).toBe(true);
    expect(end.ownerSessionId).toBe(s.id);
    expect(end.ownerSide).toBe('after');
    expect(end.travelMin).toBe(25);                                                  // duration intact
    expect(end.fromLoc.suburb).toBe('Osborne Park');                                 // origin intact
    expect(end.toLoc.suburb).toBe('Willetton');                                      // destination intact
    expect([c.SESSIONS[s.id].startH, c.SESSIONS[s.id].endH]).toEqual([11, 12]);      // appointment unchanged
  });

  test('a moved leg keeps its offset when its appointment moves — no snap back', () => {
    const c = load();
    const s = add(c, { at: '11:00', to: '12:00', s: { address: OSBORNE, patient: 'A', travel: { afterOffsetMin: 30 } } });
    Object.assign(c.SESSIONS[s.id], { startH: 13, endH: 14 });
    const end = legs(c).find((x) => x.kind === 'end');
    expect(hhmm(end.startMin)).toBe('14:30');
  });

  test('an arrival leg moves by its offset from the appointment start', () => {
    const c = load();
    add(c, { at: '09:00', to: '10:00', s: { address: OSBORNE, patient: 'A', travel: { next: 'direct' } } });
    const b = add(c, { at: '12:00', to: '13:00', s: { address: JOONDALUP, patient: 'B', travel: { beforeOffsetMin: -90 } } });
    const mid = legs(c).find((x) => x.kind === 'between');
    expect([hhmm(mid.startMin), hhmm(mid.endMin), mid.moved, mid.ownerSessionId]).toEqual(['10:30', '11:00', true, b.id]);
  });

  test('11:30 → 12:00 with a 10-minute drive: the leg is 11:50–12:00, not the whole gap', () => {
    const c = load();
    add(c, { at: '10:30', to: '11:30', s: { address: OSBORNE, patient: 'A' } });
    const b = add(c, { at: '12:00', to: '13:00', s: { address: SCHOOL, patient: 'B' } });
    MIN['Osborne Park|Scarborough'] = 10;
    try {
      const mid = legs(c).find((x) => x.kind === 'between');
      expect([hhmm(mid.startMin), hhmm(mid.endMin), mid.travelMin, mid.toSessionId]).toEqual(['11:50', '12:00', 10, b.id]);
      const end = legs(c).find((x) => x.kind === 'end');
      expect(hhmm(end.startMin)).toBe('13:00');                                     // home right after the last session
    } finally { MIN['Osborne Park|Scarborough'] = 15; }
  });

  test('an automatic leg steps around an event in the gap — the closest free slot', () => {
    const c = load();
    add(c, { at: '10:00', to: '11:00', s: { address: OSBORNE, patient: 'A' } });
    add(c, { at: '11:40', to: '12:00', s: { patient: 'Telehealth' } });            // no address, in the gap
    add(c, { at: '12:00', to: '13:00', s: { address: SCHOOL, patient: 'B' } });
    const mid = legs(c).find((x) => x.kind === 'between');
    expect([hhmm(mid.startMin), hhmm(mid.endMin), mid.tight]).toEqual(['11:25', '11:40', false]);
  });

  test('telehealth straight after the last visit: the drive home follows it on its own', () => {
    const c = load();
    const s = add(c, { at: '11:00', to: '12:00', s: { address: OSBORNE, patient: 'A' } });
    add(c, { at: '12:00', to: '12:30', s: { patient: 'Telehealth' } });
    const end = legs(c).find((x) => x.kind === 'end');
    expect([hhmm(end.startMin), hhmm(end.endMin), end.moved, end.fromSessionId]).toEqual(['12:30', '12:55', false, s.id]);
  });

  test('no free slot long enough: the leg hugs its appointment and is flagged tight', () => {
    const c = load();
    add(c, { at: '10:00', to: '11:45', s: { address: OSBORNE, patient: 'A' } });
    add(c, { at: '12:00', to: '13:00', s: { address: JOONDALUP, patient: 'B' } });  // 15 min gap, 30 min drive
    const mid = legs(c).find((x) => x.kind === 'between');
    expect([hhmm(mid.startMin), mid.tight]).toEqual(['11:45', true]);
  });

  test('placeTravelLeg: calculated arrival, the floor, and a manual time', () => {
    const c = load();
    expect(c.placeTravelLeg({ kind: 'between', anchorMin: 720, floorMin: 600, travelMin: 30 })).toMatchObject({ startMin: 690, endMin: 720, moved: false, tight: false });
    // Not enough room: starts as the previous stop ends and is flagged tight.
    expect(c.placeTravelLeg({ kind: 'between', anchorMin: 720, floorMin: 705, travelMin: 30 })).toMatchObject({ startMin: 705, tight: true });
    expect(c.placeTravelLeg({ kind: 'end', anchorMin: 720, travelMin: 25, offsetMin: 30 })).toMatchObject({ startMin: 750, endMin: 775, moved: true });
    expect(c.placeTravelLeg({ kind: 'end', anchorMin: 720, travelMin: 25, offsetMin: -10 }).tight).toBe(true);
  });

  test('saving a move PATCHes only the offset on the owning event; failure restores it', async () => {
    const c = load();
    const s = add(c, { at: '11:00', to: '12:00', s: { address: OSBORNE, patient: 'A', travel: { after: { kind: 'base', id: 'home-1' } } } });
    expect(await c.setTravelTiming(s.id, 'after', 30)).toBe(true);
    const [url, opts] = c.fetch.mock.calls[0];
    expect(url).toBe('/api/events/db-' + s.id + '/travel');
    expect(JSON.parse(opts.body)).toEqual({ afterOffsetMin: 30 });                   // where-to answer untouched
    expect(c.SESSIONS[s.id].travel).toEqual({ after: { kind: 'base', id: 'home-1' }, afterOffsetMin: 30 });

    c.fetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: 'nope' }) });
    expect(await c.setTravelTiming(s.id, 'after', 45)).toBe(false);
    expect(c.SESSIONS[s.id].travel.afterOffsetMin).toBe(30);
  });

  test('dropping a leg back on its calculated time clears the manual time', () => {
    const c = load();
    const s = add(c, { at: '11:00', to: '12:00', s: { address: OSBORNE, patient: 'A', travel: { afterOffsetMin: 30 } } });
    const end = legs(c).find((x) => x.kind === 'end');
    c._commitLegMove(end, 12 * 60);
    expect(JSON.parse(c.fetch.mock.calls[0][1].body)).toEqual({ afterOffsetMin: null });

  });
});

describe('travel legs mirrored to Outlook', () => {
  test('the day\'s legs are sent keyed by their appointment, with the day\'s own event ids', () => {
    const c = load();
    vm.runInContext("DAY_DATES = { mon: '2030-03-04' };", c);
    const a = add(c, { at: '10:00', to: '11:00', s: { address: OSBORNE, patient: 'A' } });
    add(c, { at: '11:00', to: '11:30', s: { patient: 'Telehealth' } });
    const b = add(c, { at: '12:00', to: '13:00', s: { address: JOONDALUP, patient: 'B' } });
    add(c, { at: '13:00', to: '13:30', s: { patient: 'No db row', dbId: null } });
    const p = c.travelOutlookPayload('mon', c.computeDayTravelSegments('mon'));
    expect(p.date).toBe('2030-03-04');
    expect(p.seenEventIds).toEqual(['db-' + a.id, 'db-S' + (Number(a.id.slice(1)) + 1), 'db-' + b.id]);
    expect(p.legs.map((l) => l.key)).toEqual(['db-' + a.id + '|before', 'db-' + b.id + '|before', 'db-' + b.id + '|after']);
    const mid = p.legs[1];
    expect([mid.start, mid.end]).toEqual(['2030-03-04T11:30:00+08:00', '2030-03-04T12:00:00+08:00']);
    expect(mid.title).toBe('Travel · 30 min · Osborne Park → Joondalup');
    expect(p.legs[0].title).toMatch(/^Travel from home/);
    expect(p.legs[2].title).toMatch(/^Travel home/);
    // No client names in what reaches Outlook.
    expect(JSON.stringify(p.legs)).not.toMatch(/"A"|Telehealth|patient/);
  });
});

describe('travel badge on each event', () => {
  test('linked, no drive needed, or no address', () => {
    const c = load();
    const a = add(c, { at: '10:00', to: '11:00', s: { address: OSBORNE, patient: 'A' } });
    const a2 = add(c, { at: '11:00', to: '11:30', s: { address: OSBORNE, patient: 'A2' } });
    const t = add(c, { at: '11:30', to: '12:00', s: { patient: 'T' } });
    const segs = c.computeDayTravelSegments('mon');
    expect(c.travelBadgeState(a, segs).state).toBe('on');      // start leg into it
    expect(c.travelBadgeState(t, segs).state).toBe('add');
    // A2 is the last stop: the drive home leaves from it.
    expect(c.travelBadgeState(a2, segs).state).toBe('on');
    delete c.SESSIONS[a2.id];
    const segs2 = c.computeDayTravelSegments('mon');
    add(c, { id: 'X', at: '12:00', to: '12:30', s: { address: OSBORNE, patient: 'X' } });
    expect(c.travelBadgeState(c.SESSIONS.X, segs2).state).toBe('here');
  });
});
