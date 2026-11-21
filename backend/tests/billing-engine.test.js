'use strict';

/**
 * Billing engine — pure calculation contract (no database).
 *
 * Covers the acceptance scenarios that are pure arithmetic: MMM1–3 / 4–5 / 6 /
 * 7 session + travel pricing and caps, the equal day-pool travel split with
 * per-participant caps and no redistribution, unpaid return travel, trip-cost
 * allocation that reconciles to the cent, and effective-dated rate cards.
 * The database-backed scenarios (grouping, duplicate runs, missing payer,
 * changed events, trips end to end) are in tests/integration/invoicing.itest.js.
 */

const M = require('../billing/money');
const T = require('../billing/travel-billing');
const TA = require('../billing/trip-allocation');
const RC = require('../billing/rate-cards');
const S = require('../billing/session-billing');
const DR = require('../billing/day-route');
const G = require('../billing/mmm-geometry');
const Settings = require('../billing/billing-settings');
const BP = require('../billing/billing-profiles');
const { DEFAULT_RATE_CARD } = require('../billing/default-rate-card');

const CARD = { id: 'card-1', status: 'ACTIVE', ...DEFAULT_RATE_CARD, effectiveTo: null };
const rateFor = (mmm, date = '2026-09-25', cards = [CARD]) => RC.resolveRule(cards, { serviceDate: date, mmm });
const rule = r => ({ travelRateCents: r.travelRateCents, travelCapMinutesEachWay: r.travelCapMinutesEachWay,
  vehicleRateCents: r.vehicleRateCents, rateCardId: r.card.id, rateCardVersion: r.card.version });

describe('money — decimal-safe', () => {
  test('parses NUMERIC strings without float error and rounds half-up', () => {
    expect(M.toCents('193.99')).toBe(19399);
    expect(M.toCents('0.1')).toBe(10);
    expect(M.toCents('135.795')).toBe(13580);
    expect(M.fromCents(19399)).toBe('193.99');
    expect(M.fromCents(-5)).toBe('-0.05');
  });
  test('a line amount is quantity × unit, half-up, no accumulation drift', () => {
    expect(M.lineAmount(5000, 29099)).toBe(14550); // 0.5 h × 290.99 = 145.495 → 145.50 (matches the CRM invoice)
    expect(M.lineAmount(M.minutesToHoursQty(40), 19399)).toBe(12933);
    let sum = 0; for (let i = 0; i < 1000; i++) sum += M.toCents('0.10');
    expect(sum).toBe(10000);
  });
  test('allocateCents always sums exactly to the total', () => {
    const parts = M.allocateCents(1000, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(parts).toEqual([334, 333, 333]);
  });
});

describe('rate cards — effective-dated, versioned (scenario K)', () => {
  const A = { ...CARD, id: 'A', version: 1, effectiveFrom: '2025-07-01', effectiveTo: '2026-10-31' };
  const B = { ...CARD, id: 'B', version: 2, effectiveFrom: '2026-11-01', effectiveTo: null,
    rules: CARD.rules.map(r => ({ ...r, sessionHourlyRate: r.mmmMin === 1 ? '200.00' : r.sessionHourlyRate })) };

  test('a service before X uses card A, on/after X uses card B', () => {
    expect(rateFor(1, '2026-10-31', [A, B]).card.id).toBe('A');
    expect(rateFor(1, '2026-10-31', [A, B]).sessionRateCents).toBe(19399);
    expect(rateFor(1, '2026-11-01', [A, B]).card.id).toBe('B');
    expect(rateFor(1, '2026-11-01', [A, B]).sessionRateCents).toBe(20000);
  });
  test('no card for the date → null (never a guessed price)', () => {
    expect(rateFor(1, '2024-01-01', [A, B])).toBeNull();
    expect(rateFor(9, '2026-01-01', [A])).toBeNull();
  });
  test('retired and draft cards are ignored', () => {
    expect(rateFor(1, '2026-01-01', [{ ...A, status: 'RETIRED' }])).toBeNull();
    expect(rateFor(1, '2026-01-01', [{ ...A, status: 'DRAFT' }])).toBeNull();
  });
  test('card validation rejects overlapping zones and negative rates', () => {
    expect(RC.validateCardInput({ ...DEFAULT_RATE_CARD, rules: [...DEFAULT_RATE_CARD.rules, DEFAULT_RATE_CARD.rules[0]] }))
      .toContain('MMM zones overlap between rules');
    expect(RC.validateCardInput({ ...DEFAULT_RATE_CARD, rules: [{ ...DEFAULT_RATE_CARD.rules[0], sessionHourlyRate: '-1' }] }).join(' '))
      .toMatch(/sessionHourlyRate/);
    expect(RC.validateCardInput(DEFAULT_RATE_CARD)).toEqual([]);
  });
});

describe('session pricing by zone (scenarios A–D)', () => {
  test.each([
    [1, 19399, 9700, 30], [3, 19399, 9700, 30], [4, 19399, 9700, 60], [5, 19399, 9700, 60],
    [6, 27159, 13580, null], [7, 29099, 14550, null],
  ])('MM%i → session %i c/h, travel %i c/h, cap %p', (mmm, session, travel, cap) => {
    const r = rateFor(mmm);
    expect(r.sessionRateCents).toBe(session);
    expect(r.travelRateCents).toBe(travel);
    expect(r.travelCapMinutesEachWay).toBe(cap);
    expect(r.vehicleRateCents).toBeLessThanOrEqual(99);
  });

  test('a session line uses actual minutes ÷ 60, no invented rounding', () => {
    const line = S.buildSessionLine({ serviceDate: '2026-09-25', minutes: 30, rate: rateFor(7), mmm: 7 });
    expect(line.description).toBe('25 Sep 2026, 30 minutes, Therapy Session');
    expect(M.qtyToString(line.quantityE4)).toBe('0.5000');
    expect(line.amountCents).toBe(14550);
    expect(line.itemCode).toBe('15_617_0128_1_3');
    expect(line.calculation.rateCard.version).toBe(1);
  });

  test('no weekend loading — a Saturday session prices like a weekday', () => {
    const sat = S.buildSessionLine({ serviceDate: '2026-09-26', minutes: 60, rate: rateFor(1, '2026-09-26'), mmm: 1 });
    const tue = S.buildSessionLine({ serviceDate: '2026-09-22', minutes: 60, rate: rateFor(1, '2026-09-22'), mmm: 1 });
    expect(sat.amountCents).toBe(tue.amountCents);
  });
});

describe('travel allocation — the owner\'s NDIS rule book (21 Nov 2026)', () => {
  // One day = total T split into legs (the split does not matter: always from the TOTAL).
  const day = (T, ids) => [
    { id: 'out', kind: 'OUTBOUND', toEventId: ids[0], minutes: T / 2 },
    { id: 'home', kind: 'RETURN', fromEventId: ids[ids.length - 1], minutes: T / 2 },
  ];
  const alloc = (total, mmm, n, { sameAddress = false } = {}) => {
    const ids = Array.from({ length: n }, (_, i) => 'e' + (i + 1));
    const r = rateFor(mmm);
    return T.allocateDay({ legs: day(total, ids), sessions: ids.map((id, i) => ({ eventId: id, clientId: 'c' + (i + 1), mmm,
      address: sameAddress ? '1 Same St, Perth WA 6000' : `${i + 1} Client St, Perth WA 6000`, rule: rule(r) })) });
  };
  const mins = out => out.allocations.map(a => a.claimableMinutes);

  test('metro 90 min, 3 clients → 30/30/30, no return', () => {
    const out = alloc(90, 1, 3);
    expect(mins(out)).toEqual([30, 30, 30]);
    expect(out.report).toMatchObject({ rule: 'rule_6_within_caps', returnMinutes: 0, unbilledMinutes: 0, ceiling: 120 });
  });
  test('metro 120 min, 2 clients at different addresses → 30/60, 30 unbilled', () => {
    const out = alloc(120, 1, 2);
    expect(mins(out)).toEqual([30, 60]);
    expect(out.allocations[1]).toMatchObject({ cappedMinutes: 30, returnMinutes: 30 });
    expect(out.report).toMatchObject({ rule: 'rule_7_capped_with_return/rule_8c_last_client', billedMinutes: 90, unbilledMinutes: 30, flags: ['UNBILLED_MINUTES'] });
  });
  test('metro 90 min, 2 clients at the same address → 45/45', () => {
    expect(mins(alloc(90, 1, 2, { sameAddress: true }))).toEqual([45, 45]);
  });
  test('wheatbelt (MMM4–5) 250 min, 3 clients → 80/80/80, 10 unbilled', () => {
    const out = alloc(250, 4, 3);
    expect(mins(out)).toEqual([80, 80, 80]);
    expect(out.report).toMatchObject({ rule: 'rule_7_capped_with_return/rule_8a_equal', ceiling: 240, billedMinutes: 240, unbilledMinutes: 10 });
  });
  test('wheatbelt 255 min, 4 clients → 63.75 each', () => {
    const out = alloc(255, 5, 4);
    expect(mins(out)).toEqual([63.75, 63.75, 63.75, 63.75]);
    expect(out.allocations[0].hoursQtyE4).toBe(10625);                // 1.0625 h exactly
    expect(out.report.unbilledMinutes).toBe(0);
  });
  test('remote (MMM6–7) 20 h, 20 clients → 1 h each, no cap, at the remote travel rate', () => {
    const out = alloc(1200, 7, 20);
    expect(mins(out).every(m => m === 60)).toBe(true);
    expect(out.allocations[0]).toMatchObject({ travelRateCents: 14550, labourCents: 14550 });
    expect(out.report).toMatchObject({ rule: 'rule_11_uncapped_remote', cap: null, unbilledMinutes: 0 });
  });
  test('rule 2: never more than the minutes travelled; one client alone gets up to CAP + return', () => {
    expect(mins(alloc(20, 1, 1))).toEqual([20]);
    expect(mins(alloc(75, 1, 1))).toEqual([60]);                     // 30 + return 30, 15 unbilled
  });
  test('a client seen twice counts once; the second session carries no travel', () => {
    const r = rateFor(1);
    const out = T.allocateDay({ legs: day(90, ['e1', 'e3']), sessions: [
      { eventId: 'e1', clientId: 'a', mmm: 1, address: 'X', rule: rule(r) },
      { eventId: 'e2', clientId: 'b', mmm: 1, address: 'Y', rule: rule(r) },
      { eventId: 'e3', clientId: 'a', mmm: 1, address: 'X', rule: rule(r) }] });
    // 90 > 2×30: each 30, plus return 30 to the LAST client seen (a, whose line sits on its first session e1).
    expect(out.allocations.map(a => [a.eventId, a.claimableMinutes])).toEqual([['e1', 60], ['e2', 30]]);
    expect(out.report).toMatchObject({ clients: 2, unbilledMinutes: 0 });
  });
  test('rule 10 (owner answer): metro client at the lesser of the drive in and the normal commute; rural clients share the rest', () => {
    // 150 min: 75 out to the metro client, 75 home from the wheatbelt client.
    const sessions = (commute) => [
      { eventId: 'e1', clientId: 'a', clientName: 'Metro', mmm: 1, address: 'X', commuteMinutes: commute, rule: rule(rateFor(1)) },
      { eventId: 'e2', clientId: 'b', clientName: 'Rural', mmm: 4, address: 'Y', rule: rule(rateFor(4)) }];
    let out = T.allocateDay({ legs: day(150, ['e1', 'e2']), sessions: sessions(20) });
    expect(out.report).toMatchObject({ rule: 'rule_10_mixed_metro_lesser_rural_pool', mixedZones: true });
    expect(out.report.flags).toContain('MIXED_ZONES');
    // Metro: lesser of 75 in and 20 commute = 20. Rural pool 150 − 75 = 75 > 60: 60 + return 15.
    expect(out.allocations.map(x => x.claimableMinutes)).toEqual([20, 75]);
    expect(out.report.unbilledMinutes).toBe(55);
    expect(out.reviewNotes[0]).toMatch(/drive in 75 min, normal commute from base 20 min; billed the lesser \(20 min\)/);
    // A long commute: the drive in (75) is less, then the 30-min metro cap.
    out = T.allocateDay({ legs: day(150, ['e1', 'e2']), sessions: sessions(90) });
    expect(out.allocations[0].claimableMinutes).toBe(30);
    expect(out.reviewNotes[0]).toMatch(/capped at 30/);
    // Never more than T, never more than each zone's cap.
    expect(out.allocations.reduce((x, a) => x + a.claimableMinutes, 0)).toBeLessThanOrEqual(150);
  });
  test('the trip home is always part of T; legs without route facts are excluded and reported', () => {
    const out = alloc(60, 1, 2);
    expect(out.legs.find(l => l.id === 'home')).toMatchObject({ included: true, reason: 'trip_home' });
    const bad = T.allocateDay({ legs: [{ id: 'x', kind: 'OUTBOUND', toEventId: 'e1', minutes: null }],
      sessions: [{ eventId: 'e1', clientId: 'c', mmm: 1, rule: rule(rateFor(1)) }] });
    expect(bad.issues).toEqual([{ type: 'TRAVEL_ROUTE_FAILED', eventId: 'e1', legId: 'x' }]);
  });
  test('rule 13: no non-labour (km) line in any zone; the travel line carries the rule-book snapshot', () => {
    const r = rateFor(1);
    const out = alloc(120, 1, 2);
    const lines = S.buildTravelLines({ serviceDate: '2026-09-25', allocation: out.allocations[1], rate: r, practitionerName: 'Ann Mary', legs: out.legs });
    expect(lines.map(l => l.component)).toEqual(['TRAVEL_LABOUR']);
    expect(lines[0]).toMatchObject({ description: '25 Sep 2026, Provider Travel', durationMinutes: 60 });
    expect(lines[0].calculation).toMatchObject({ method: 'ndis_rule_book_2026_11', cappedMinutes: 30, returnMinutes: 30,
      claimableMinutes: 60, travelHourlyRate: '97.00', amount: '97.00', dayReport: { unbilledMinutes: 30 } });
    for (const z of [4, 6, 7]) {
      const o = alloc(60, z, 1);
      expect(S.buildTravelLines({ serviceDate: '2026-09-25', allocation: o.allocations[0], rate: rateFor(z), legs: o.legs }).map(l => l.component)).toEqual(['TRAVEL_LABOUR']);
    }
  });
});

describe('trip allocation (scenario J)', () => {
  test('$6,000 eligible over 15 unique clients = $400 each, reconciling exactly', () => {
    const clients = Array.from({ length: 15 }, (_, i) => ({ clientId: `c${String(i).padStart(2, '0')}`, sessionCount: 1 + (i % 3) }));
    const out = TA.allocate({ eligibleCents: 600000, method: 'EQUAL_PER_CLIENT', clients });
    expect(out.allocations.every(a => a.amountCents === 40000)).toBe(true);
    expect(out.allocatedCents).toBe(600000);
    expect(out.unallocatedCents).toBe(0);
  });
  test('an uneven pool never over-allocates and is deterministic', () => {
    const clients = ['b', 'a', 'c'].map(clientId => ({ clientId }));
    const one = TA.allocate({ eligibleCents: 100001, clients });
    const two = TA.allocate({ eligibleCents: 100001, clients: [...clients].reverse() });
    expect(one.allocatedCents).toBe(100001);
    expect(one.allocations).toEqual(two.allocations);
  });
  test('per-session and manual weighted methods', () => {
    const per = TA.allocate({ eligibleCents: 90000, method: 'PER_SESSION', clients: [{ clientId: 'a', sessionCount: 1 }, { clientId: 'b', sessionCount: 2 }] });
    expect(per.allocations.map(a => a.amountCents)).toEqual([30000, 60000]);
    const man = TA.allocate({ eligibleCents: 10000, method: 'MANUAL_WEIGHTED', clients: [{ clientId: 'a', weight: 0.5 }, { clientId: 'b', weight: 1.5 }] });
    expect(man.allocations.map(a => a.amountCents)).toEqual([2500, 7500]);
  });
  test('only SHARED_BILLABLE costs enter the pool', () => {
    const s = TA.summariseCosts([
      { id: 1, amount: '4500.00', billableMode: 'SHARED_BILLABLE' },
      { id: 2, amount: '1500.00', billableMode: 'SHARED_BILLABLE' },
      { id: 3, amount: '320.50', billableMode: 'NON_BILLABLE' },
    ]);
    expect(s).toMatchObject({ totalCents: 632050, nonBillableCents: 32050, eligibleCents: 600000, eligibleCostIds: [1, 2] });
  });
});

describe('eligibility', () => {
  const past = { start_time: '2026-09-25T01:00:00Z', end_time: '2026-09-25T02:00:00Z', event_type: 'therapy', status: 'confirmed',
    client_id: '123', location: '1 Test St, Willetton WA' };
  const now = new Date('2026-09-29T00:00:00Z');
  test('a past confirmed therapy session is billable by default', () => {
    expect(S.evaluateEvent(past, { now })).toMatchObject({ state: 'BILLABLE', minutes: 60 });
  });
  test('cancelled, DNA, future and awaiting-completion sessions are skipped', () => {
    expect(S.evaluateEvent({ ...past, status: 'cancelled' }, { now }).reason).toBe('cancelled');
    expect(S.evaluateEvent({ ...past, attendance: 'DID_NOT_ATTEND' }, { now }).reason).toBe('did_not_attend');
    expect(S.evaluateEvent(past, { now: new Date('2026-09-25T01:30:00Z') }).reason).toBe('not_yet_delivered');
    expect(S.evaluateEvent(past, { now, completionRule: 'EXPLICIT_ONLY' }).reason).toBe('awaiting_completion');
    expect(S.evaluateEvent({ ...past, attendance: 'COMPLETED' }, { now, completionRule: 'EXPLICIT_ONLY' }).state).toBe('BILLABLE');
  });
  test('missing inputs become issues, never guesses', () => {
    expect(S.evaluateEvent({ ...past, client_id: null, location: null, event_type: 'outlook' }, { now }).issues)
      .toEqual(['EVENT_NO_CLIENT', 'EVENT_NO_SERVICE_TYPE', 'EVENT_NO_LOCATION']);
    expect(S.evaluateEvent({ ...past, end_time: past.start_time }, { now }).issues).toEqual(['INVALID_DURATION']);
    expect(S.evaluateEvent({ ...past, location: null, is_teams_meeting: true }, { now }).state).toBe('BILLABLE');
  });
});

describe('payer resolution — never invent a recipient', () => {
  test('plan-managed without a plan manager has no payer', () => {
    expect(BP.resolvePayer({ management_type: 'PLAN_MANAGED', participant_name: 'A' })).toBeNull();
    expect(BP.payerKey(null)).toBe('MISSING');
  });
  test('self-managed defaults to the participant', () => {
    expect(BP.resolvePayer({ management_type: 'SELF_MANAGED', participant_name: 'Trevor' })).toMatchObject({ type: 'PARTICIPANT', name: 'Trevor' });
  });
  test('different payers give different grouping keys', () => {
    const a = BP.resolvePayer({ payer_type: 'PLAN_MANAGER', payer_name: 'MARS Plan Manager', payer_email: 'a@mars.test' });
    const b = BP.resolvePayer({ payer_type: 'PLAN_MANAGER', payer_name: '24 Seven', payer_email: 'b@24.test' });
    expect(BP.payerKey(a)).not.toBe(BP.payerKey(b));
  });
});

describe('day route mirrors the calendar\'s travel rules', () => {
  test('week key replicates mockup weekKeyFor (not ISO)', () => {
    // 2026-01-01 is a Thursday; its Monday is 2025-12-29 → week 52 of 2025.
    expect(DR.weekKeyForDate('2026-01-01')).toBe('2025-W52');
    expect(DR.weekKeyForDate('2026-09-25')).toBe('2026-W38');
    expect(DR.dayKeyForDate('2026-09-25')).toBe('fri');
  });
  const user = {
    default_work_location: { homes: [{ id: 'home-1', label: 'Home', kind: 'local', addr: '5 Base Rd, Canning Vale WA' },
      { id: 'home-r', label: 'Kununurra motel', kind: 'remote' }] },
    work_location_schedule: { '2026-W38': { fri: 'home-1', thu: 'office', wed: 'home-r' } },
  };
  const ev = (id, loc, h) => ({ id, location: loc, start_time: `2026-09-25T0${h}:00:00Z`, custom_metadata: {} });
  test('base → first, between, last → base', () => {
    const { legs, baseUnset } = DR.buildDayLegs({ user, date: '2026-09-25', sessions: [ev('a', '1 A St, Willetton', 1), ev('b', '2 B St, Riverton', 3)] });
    expect(baseUnset).toBe(false);
    expect(legs.map(l => l.kind)).toEqual(['OUTBOUND', 'BETWEEN', 'RETURN']);
  });
  test('the office and unset days never anchor travel; a remote base has no start/end leg', () => {
    const thu = DR.buildDayLegs({ user, date: '2026-09-24', sessions: [ev('a', 'X', 1), ev('b', 'Y', 2)] });
    expect(thu.legs.map(l => l.kind)).toEqual(['BETWEEN']);
    expect(thu.baseUnset).toBe(true);
    const wed = DR.buildDayLegs({ user, date: '2026-09-23', sessions: [ev('a', 'X', 1)] });
    expect(wed.legs).toEqual([]);
  });
  // 19 Nov 2026 — same rule as the calendar: a long gap is a direct drive
  // unless the therapist chose Via home (travel.next 'home').
  test('a long gap is billed direct unless Via home was chosen', () => {
    const mins = { '1 A St, Willetton|5 Base Rd, Canning Vale WA': 12, '5 Base Rd, Canning Vale WA|2 B St, Riverton': 10 };
    const minutesFor = (o, d) => mins[o + '|' + d] ?? 15;
    const a = { ...ev('a', '1 A St, Willetton', 1), end_time: '2026-09-25T02:00:00Z' };
    const far = { ...ev('b', '2 B St, Riverton', 5), start_time: '2026-09-25T05:00:00Z' }; // 3 h gap ≥ 12 + 10 + 30
    expect(DR.buildDayLegs({ user, date: '2026-09-25', sessions: [a, far], minutesFor }).legs.map(l => l.kind)).toEqual(['OUTBOUND', 'BETWEEN', 'RETURN']);
    const aHome = { ...a, custom_metadata: { travel: { next: 'home' } } };
    const home = DR.buildDayLegs({ user, date: '2026-09-25', sessions: [aHome, far], minutesFor });
    expect(home.legs.map(l => [l.kind, l.fromEventId, l.toEventId])).toEqual([
      ['OUTBOUND', null, 'a'], ['RETURN', 'a', null], ['OUTBOUND', null, 'b'], ['RETURN', 'b', null]]);
    const near = { ...ev('b', '2 B St, Riverton', 2), start_time: '2026-09-25T02:45:00Z' }; // 45 min gap < 52
    const chain = DR.buildDayLegs({ user, date: '2026-09-25', sessions: [a, near], minutesFor });
    expect(chain.legs.map(l => l.kind)).toEqual(['OUTBOUND', 'BETWEEN', 'RETURN']);
    // Without route facts the rule cannot decide and chains (never guesses a trip home).
    expect(DR.buildDayLegs({ user, date: '2026-09-25', sessions: [a, far] }).legs.map(l => l.kind)).toEqual(['OUTBOUND', 'BETWEEN', 'RETURN']);
  });

  // 5 Oct 2026 — the therapist's choice on the calendar wins over the gap.
  test('travel.next: "direct" never bills a trip home; "home" always does', () => {
    const mins = { '1 A St, Willetton|5 Base Rd, Canning Vale WA': 12, '5 Base Rd, Canning Vale WA|2 B St, Riverton': 10 };
    const minutesFor = (o, d) => mins[o + '|' + d] ?? 15;
    const withNext = (next, endIso) => ({ ...ev('a', '1 A St, Willetton', 1), end_time: endIso, custom_metadata: { travel: { next } } });
    const far = { ...ev('b', '2 B St, Riverton', 5), start_time: '2026-09-25T05:00:00Z' };
    const near = { ...ev('b', '2 B St, Riverton', 2), start_time: '2026-09-25T02:45:00Z' };
    const kinds = (sessions, mf) => DR.buildDayLegs({ user, date: '2026-09-25', sessions, minutesFor: mf }).legs.map(l => l.kind);
    expect(kinds([withNext('direct', '2026-09-25T02:00:00Z'), far], minutesFor)).toEqual(['OUTBOUND', 'BETWEEN', 'RETURN']);
    expect(kinds([withNext('home', '2026-09-25T02:00:00Z'), near], minutesFor)).toEqual(['OUTBOUND', 'RETURN', 'OUTBOUND', 'RETURN']);
    // "home" stands even without route facts — the legs are routed later.
    expect(kinds([withNext('home', '2026-09-25T02:00:00Z'), near])).toEqual(['OUTBOUND', 'RETURN', 'OUTBOUND', 'RETURN']);
  });

  // 11 Oct 2026 — "Go somewhere else in between" (travel.after purpose 'elsewhere').
  test('a place between sessions bills Return to it + Outbound from it; Direct / Home chosen since wins', () => {
    const place = { kind: 'address', address: '7 Cafe Lane, Fremantle WA 6160', label: 'Cafe', purpose: 'elsewhere' };
    const a = (travel) => ({ ...ev('a', '1 A St, Willetton', 1), end_time: '2026-09-25T02:00:00Z', custom_metadata: { travel } });
    const b = { ...ev('b', '2 B St, Riverton', 2), start_time: '2026-09-25T02:45:00Z' };
    const legs = s => DR.buildDayLegs({ user, date: '2026-09-25', sessions: s }).legs;
    expect(legs([a({ after: place }), b]).map(l => [l.kind, l.origin, l.destination, !!l.midday])).toEqual([
      ['OUTBOUND', '5 Base Rd, Canning Vale WA', '1 A St, Willetton', false],
      ['RETURN', '1 A St, Willetton', place.address, true],
      ['OUTBOUND', place.address, '2 B St, Riverton', true],
      ['RETURN', '2 B St, Riverton', '5 Base Rd, Canning Vale WA', false]]);
    expect(legs([a({ after: place, next: 'direct' }), b]).map(l => l.kind)).toEqual(['OUTBOUND', 'BETWEEN', 'RETURN']);
    // A plain end-of-day answer (no purpose) is not a stop between sessions.
    expect(legs([a({ after: { kind: 'address', address: '7 Cafe Lane, Fremantle WA 6160' } }), b]).map(l => l.kind)).toEqual(['OUTBOUND', 'BETWEEN', 'RETURN']);
    // The place is the next client's own address: no drive out of it.
    expect(legs([a({ after: { ...place, address: '2 B St, Riverton' } }), b]).map(l => l.kind)).toEqual(['OUTBOUND', 'RETURN', 'RETURN']);
  });

  // 19 Nov 2026 — before/after answered in "Blocks to review" bill the route the calendar draws.
  test('review answers between two stops: "Home" bills a trip home, an address bills a stop there', () => {
    const home = { kind: 'address', address: '', label: 'Home', purpose: 'home', source: 'block_review' };
    const school = { kind: 'address', address: '9 School Rd, Como WA', label: 'School', purpose: 'elsewhere', source: 'block_review' };
    const a = (travel) => ({ ...ev('a', '1 A St, Willetton', 1), end_time: '2026-09-25T02:00:00Z', custom_metadata: { travel } });
    const b = (travel) => ({ ...ev('b', '2 B St, Riverton', 2), start_time: '2026-09-25T02:45:00Z', custom_metadata: { travel } });
    const kinds = s => DR.buildDayLegs({ user, date: '2026-09-25', sessions: s }).legs.map(l => l.kind);
    const legs = s => DR.buildDayLegs({ user, date: '2026-09-25', sessions: s }).legs;
    expect(kinds([a({}), b({ before: home })])).toEqual(['OUTBOUND', 'RETURN', 'OUTBOUND', 'RETURN']);
    expect(kinds([a({ after: home }), b({})])).toEqual(['OUTBOUND', 'RETURN', 'OUTBOUND', 'RETURN']);
    expect(legs([a({}), b({ before: school })]).map(l => l.destination).slice(1, 2)).toEqual([school.address]);
    // Direct chosen since wins; Smart Booking's own "after: home" mid-day stays a direct drive.
    expect(kinds([a({ after: home, next: 'direct' }), b({})])).toEqual(['OUTBOUND', 'BETWEEN', 'RETURN']);
    expect(kinds([a({ after: { kind: 'base', id: 'x', purpose: 'home' } }), b({})])).toEqual(['OUTBOUND', 'BETWEEN', 'RETURN']);
  });

  test('Return Home (purpose home) ends at the day\'s base, not the base saved with the answer', () => {
    const u = { ...user, default_work_location: { homes: [...user.default_work_location.homes,
      { id: 'parents', label: "Parent's Home", kind: 'local', addr: '11 Rostrata Ave, Willetton WA 6155' }] } };
    const last = { ...ev('a', '1 A St, Willetton', 1), custom_metadata: { travel: { after: { kind: 'base', id: 'parents', purpose: 'home' } } } };
    const legs = DR.buildDayLegs({ user: u, date: '2026-09-25', sessions: [last] }).legs;
    expect(legs[legs.length - 1]).toMatchObject({ kind: 'RETURN', destination: '5 Base Rd, Canning Vale WA' });
    // A place chosen on purpose (no "home" purpose) still stands.
    const fixed = { ...last, custom_metadata: { travel: { after: { kind: 'base', id: 'parents' } } } };
    const legs2 = DR.buildDayLegs({ user: u, date: '2026-09-25', sessions: [fixed] }).legs;
    expect(legs2[legs2.length - 1]).toMatchObject({ kind: 'RETURN', destination: '11 Rostrata Ave, Willetton WA 6155' });
  });

  test('a manual pin beats the Outlook location', () => {
    expect(DR.eventAddress({ location: 'Outlook text', manual_location: { address: '9 Pin St' } })).toBe('9 Pin St');
  });
});

describe('MMM geometry', () => {
  // Two zones: MM1 square with an MM7 hole in the middle.
  const square = (x0, y0, x1, y1) => Float64Array.from([x0, y0, x0, y1, x1, y1, x1, y0, x0, y0]);
  const rings = [
    { mmm: 1, bbox: [0, 0, 10, 10], coords: square(0, 0, 10, 10) },
    { mmm: 1, bbox: [4, 4, 6, 6], coords: square(4, 4, 6, 6) },    // hole in MM1
    { mmm: 7, bbox: [4, 4, 6, 6], coords: square(4, 4, 6, 6) },
  ];
  test('points classify with hole parity', () => {
    expect(G.classifyPoint(rings, 1, 1)).toBe(1);
    expect(G.classifyPoint(rings, 5, 5)).toBe(7);
    expect(G.classifyPoint(rings, 20, 20)).toBeNull();
  });
  test('a point near a boundary is low confidence', () => {
    expect(G.classifyWithConfidence(rings, 1, 1, 1000)).toMatchObject({ mmm: 1, confident: true });
    const near = G.classifyWithConfidence(rings, 3.999, 5, 1000); // ~0.009° probe crosses into the MM7 square
    expect(near).toMatchObject({ mmm: 1, confident: false, reason: 'near_boundary' });
  });
});

describe('invoice numbering + display status', () => {
  test('uses the organisation prefix and padding', () => {
    expect(Settings.formatInvoiceNumber('INV-', 1923, 0)).toBe('INV-1923');
    expect(Settings.formatInvoiceNumber('OT', 7, 5)).toBe('OT00007');
  });
  test('overdue is derived, not stored', () => {
    expect(S.displayStatus({ status: 'SENT', total: '100.00', amount_paid: '0.00', due_date: '2026-09-01' }, '2026-09-29')).toBe('OVERDUE');
    expect(S.displayStatus({ status: 'SENT', total: '100.00', amount_paid: '100.00', due_date: '2026-09-01' }, '2026-09-29')).toBe('SENT');
    expect(S.displayStatus({ status: 'DRAFT', total: '100.00', amount_paid: '0.00', due_date: '2026-09-01' }, '2026-09-29')).toBe('DRAFT');
  });
});
