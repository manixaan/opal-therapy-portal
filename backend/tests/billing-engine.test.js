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

describe('travel allocation — equal day pool, participant cap, no redistribution', () => {
  const legs3 = [
    { id: 'l1', kind: 'OUTBOUND', toEventId: 'e1', minutes: 30, km: 20 },
    { id: 'l2', kind: 'BETWEEN', fromEventId: 'e1', toEventId: 'e2', minutes: 20, km: 12 },
    { id: 'l3', kind: 'BETWEEN', fromEventId: 'e2', toEventId: 'e3', minutes: 24, km: 9.2 },
    { id: 'l4', kind: 'RETURN', fromEventId: 'e3', minutes: 40, km: 30 },
  ];

  test('A — Perth MMM1: 74 min over 3 sessions = 24.67 min each at $97/h = $39.88; vehicle ≤ $0.99/km', () => {
    const r = rateFor(1);
    const out = T.allocateDay({ returnPayable: false, legs: legs3,
      sessions: ['e1', 'e2', 'e3'].map(id => ({ eventId: id, clientId: id, mmm: 1, rule: rule(r) })) });
    expect(out.totalMinutesE2).toBe(7400);
    expect(out.legs.find(l => l.id === 'l4')).toMatchObject({ included: false, reason: 'return_travel_not_payable' });
    for (const a of out.allocations) {
      expect(a.allocatedMinutesBeforeCap).toBe(24.67);
      expect(a.capMinutes).toBe(30);
      expect(a.capApplied).toBe(false);
      expect(a.claimableMinutes).toBe(24.67);
      expect(a.labourCents).toBe(3988);
      expect(a.allocatedKm).toBe(13.73);
      expect(a.vehicleCents).toBe(1360); // 41.2 km ÷ 3 × $0.99
      expect(a.vehicleRateCents).toBeLessThanOrEqual(99);
    }
  });

  test('A — the 30-minute MMM1–3 cap is enforced', () => {
    const r = rateFor(2);
    const legs = [{ id: 'a', kind: 'OUTBOUND', toEventId: 'e1', minutes: 50, km: 45 },
      { id: 'b', kind: 'BETWEEN', fromEventId: 'e1', toEventId: 'e2', minutes: 40, km: 30 }];
    const out = T.allocateDay({ returnPayable: false, legs,
      sessions: ['e1', 'e2'].map(id => ({ eventId: id, clientId: id, mmm: 2, rule: rule(r) })) });
    for (const a of out.allocations) {
      expect(a.allocatedMinutesBeforeCap).toBe(45);
      expect(a.capApplied).toBe(true);
      expect(a.claimableMinutes).toBe(30);
      expect(a.labourCents).toBe(4850); // 0.5 h × $97
    }
  });

  test('B — MMM4–5 keeps base rates but allows up to 60 minutes', () => {
    const r = rateFor(4);
    const out = T.allocateDay({ returnPayable: false, legs: [{ id: 'a', kind: 'OUTBOUND', toEventId: 'e1', minutes: 75, km: 90 }],
      sessions: [{ eventId: 'e1', clientId: 'c', mmm: 4, rule: rule(r) }] });
    const a = out.allocations[0];
    expect(r.sessionRateCents).toBe(19399);
    expect(a.travelRateCents).toBe(9700);
    expect(a.capMinutes).toBe(60);
    expect(a.claimableMinutes).toBe(60);
    expect(a.labourCents).toBe(9700);
  });

  test.each([[6, 13580, 27159], [7, 14550, 29099]])('C/D — MM%i: remote travel rate, no time cap', (mmm, travelCents, sessionCents) => {
    const r = rateFor(mmm);
    const out = T.allocateDay({ returnPayable: false, legs: [{ id: 'a', kind: 'OUTBOUND', toEventId: 'e1', minutes: 180, km: 210 }],
      sessions: [{ eventId: 'e1', clientId: 'c', mmm, rule: rule(r) }] });
    const a = out.allocations[0];
    expect(r.sessionRateCents).toBe(sessionCents);
    expect(a.capMinutes).toBeNull();
    expect(a.capApplied).toBe(false);
    expect(a.claimableMinutes).toBe(180);
    expect(a.labourCents).toBe(travelCents * 3);
  });

  test('F — mixed-zone day: equal initial share, each participant\'s own cap and rate, no redistribution', () => {
    const legs = [{ id: 'a', kind: 'OUTBOUND', toEventId: 'e1', minutes: 60, km: 60 },
      { id: 'b', kind: 'BETWEEN', fromEventId: 'e1', toEventId: 'e2', minutes: 60, km: 60 },
      { id: 'c', kind: 'BETWEEN', fromEventId: 'e2', toEventId: 'e3', minutes: 30, km: 30 }];
    const sessions = [
      { eventId: 'e1', clientId: 'metro', mmm: 1, rule: rule(rateFor(1)) },
      { eventId: 'e2', clientId: 'town', mmm: 5, rule: rule(rateFor(5)) },
      { eventId: 'e3', clientId: 'remote', mmm: 6, rule: rule(rateFor(6)) },
    ];
    const out = T.allocateDay({ returnPayable: false, legs, sessions });
    const [m, t, r] = out.allocations;
    expect([m, t, r].map(a => a.allocatedMinutesBeforeCap)).toEqual([50, 50, 50]);
    expect(m).toMatchObject({ capApplied: true, claimableMinutes: 30, labourCents: 4850 });
    expect(t).toMatchObject({ capApplied: false, claimableMinutes: 50, labourCents: 8083 });
    // 0.8333 h (4 dp) × $135.80 = $113.16: the amount is priced from the printed quantity so qty × unit reconciles.
    expect(r).toMatchObject({ capApplied: false, claimableMinutes: 50, labourCents: 11316 });
    // The 20 minutes removed from the metro share are not given to anyone else.
    expect(m.claimableMinutes + t.claimableMinutes + r.claimableMinutes).toBe(130);
  });

  test('G — return travel excluded when not payable, included (doubling the cap) when payable', () => {
    const r = rateFor(1);
    const legs = [{ id: 'out', kind: 'OUTBOUND', toEventId: 'e1', minutes: 20, km: 15 },
      { id: 'ret', kind: 'RETURN', fromEventId: 'e1', minutes: 50, km: 40 }];
    const s = [{ eventId: 'e1', clientId: 'c', mmm: 1, rule: rule(r) }];
    const unpaid = T.allocateDay({ returnPayable: false, legs, sessions: s });
    expect(unpaid.totalMinutesE2).toBe(2000);
    expect(unpaid.totalKmE3).toBe(15000);
    expect(unpaid.allocations[0]).toMatchObject({ claimableMinutes: 20, directions: 1 });
    const paid = T.allocateDay({ returnPayable: true, legs, sessions: s });
    expect(paid.totalMinutesE2).toBe(7000);
    expect(paid.allocations[0]).toMatchObject({ directions: 2, capMinutes: 60, claimableMinutes: 60 });
  });

  test('legs without route facts are excluded and reported', () => {
    const out = T.allocateDay({ returnPayable: false, legs: [{ id: 'x', kind: 'OUTBOUND', toEventId: 'e1', minutes: null }],
      sessions: [{ eventId: 'e1', clientId: 'c', mmm: 1, rule: rule(rateFor(1)) }] });
    expect(out.issues).toEqual([{ type: 'TRAVEL_ROUTE_FAILED', eventId: 'e1', legId: 'x' }]);
  });

  test('travel lines carry the full calculation snapshot', () => {
    const r = rateFor(1);
    const out = T.allocateDay({ returnPayable: false, legs: legs3,
      sessions: ['e1', 'e2', 'e3'].map(id => ({ eventId: id, clientId: id, mmm: 1, rule: rule(r) })) });
    const lines = S.buildTravelLines({ serviceDate: '2026-09-25', allocation: out.allocations[0], rate: r, practitionerName: 'Ann Mary', legs: out.legs });
    expect(lines.map(l => l.component)).toEqual(['TRAVEL_LABOUR', 'TRAVEL_KM']);
    expect(lines[0].description).toBe('25 Sep 2026, Provider Travel');
    expect(lines[1].description).toMatch(/^25 Sep 2026, Provider Travel - Non-Labour Costs \(13\.73 km @ \$0\.99\/km\)$/);
    expect(lines[0].calculation).toMatchObject({ dayTotalMinutes: 74, billableSessions: 3, allocatedMinutesBeforeCap: 24.67,
      capMinutes: 30, claimableMinutes: 24.67, travelHourlyRate: '97.00', amount: '39.88' });
    expect(lines[0].calculation.legs).toHaveLength(4);
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
  // 30 Sep 2026 — same rule as the calendar (travel.js midDayViaBase).
  test('a gap long enough to go back to base becomes Return + Start legs', () => {
    const mins = { '1 A St, Willetton|5 Base Rd, Canning Vale WA': 12, '5 Base Rd, Canning Vale WA|2 B St, Riverton': 10 };
    const minutesFor = (o, d) => mins[o + '|' + d] ?? 15;
    const a = { ...ev('a', '1 A St, Willetton', 1), end_time: '2026-09-25T02:00:00Z' };
    const far = { ...ev('b', '2 B St, Riverton', 5), start_time: '2026-09-25T05:00:00Z' }; // 3 h gap ≥ 12 + 10 + 30
    const home = DR.buildDayLegs({ user, date: '2026-09-25', sessions: [a, far], minutesFor });
    expect(home.legs.map(l => [l.kind, l.fromEventId, l.toEventId])).toEqual([
      ['OUTBOUND', null, 'a'], ['RETURN', 'a', null], ['OUTBOUND', null, 'b'], ['RETURN', 'b', null]]);
    const near = { ...ev('b', '2 B St, Riverton', 2), start_time: '2026-09-25T02:45:00Z' }; // 45 min gap < 52
    const chain = DR.buildDayLegs({ user, date: '2026-09-25', sessions: [a, near], minutesFor });
    expect(chain.legs.map(l => l.kind)).toEqual(['OUTBOUND', 'BETWEEN', 'RETURN']);
    // Without route facts the rule cannot decide and chains (never guesses a trip home).
    expect(DR.buildDayLegs({ user, date: '2026-09-25', sessions: [a, far] }).legs.map(l => l.kind)).toEqual(['OUTBOUND', 'BETWEEN', 'RETURN']);
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
