'use strict';

/**
 * CANDIDATE SCORER — exhaustive unit tests for the pure Phase-7 scoring in
 * backend/candidate-scorer.js. No DB, no network: every case feeds plain
 * inputs and asserts scores, tiers, geography states and explanations.
 */

const S = require('../candidate-scorer');
const A = require('../availability-engine');

const W = S.CONFIG.WEIGHTS;
const TIERS = S.CONFIG.TIERS;

// ── Fixtures ─────────────────────────────────────────────────────────────────

// Real WA suburb centroids (approximate).
const WILLETTON = { suburb: 'Willetton', lat: -32.0524, lng: 115.8886 };
const BULL_CREEK = { suburb: 'Bull Creek', lat: -32.0625, lng: 115.8632 };  // ~2.5 km from Willetton
const JOONDALUP = { suburb: 'Joondalup', lat: -31.7448, lng: 115.7661 };    // ~36 km from Willetton
const PERTH = { suburb: 'Perth', lat: -31.9523, lng: 115.8613 };
const BROOME = { suburb: 'Broome', lat: -17.9614, lng: 122.2359 };          // ~1660 km from Perth

const makeAvailability = (over = {}) => Object.assign({
  therapistProfileId: 'tp-1',
  displayName: 'Alice Nguyen',
  roleTitle: 'Occupational Therapist',
  colour: '#4A90D9',
  working: true,
  workingHoursSource: 'organisation_default',
  availabilityConfidence: 'configured',
  capacity: { workingMin: 540, busyMin: 180, availableMin: 180 },
  segments: [],
}, over);

const makeMatched = (over = {}) => Object.assign({
  therapistProfileId: 'tp-1',
  status: 'available',
  reason: null,
  requestedSlotFits: true,
  window: { startMin: 540, endMin: 720 },
  windowMin: 180,
}, over);

const score = (over = {}) => S.scoreCandidate(Object.assign({
  availability: makeAvailability(),
  matched: makeMatched(),
  clientPoint: null,
  dayPoints: [],
  isTelehealth: false,
  currentTherapistId: null,
  durationMin: 60,
  requestStartMin: 600,
}, over));

const codes = (c) => c.reasons.map((r) => r.code);
const labelOf = (c, code) => {
  const r = c.reasons.find((x) => x.code === code);
  return r ? r.label : null;
};

// Default fixture: geography unknown (0) + comfort (windowMin 180 >= 120)
// + capacity min(12, 180/60*4)=12 → 22.
const BASELINE = W.comfort + Math.min(W.maxCapacity, (180 / 60) * W.capacityPerHour);

// ── haversineKm ──────────────────────────────────────────────────────────────

describe('haversineKm', () => {
  test('zero distance for identical points', () => {
    expect(S.haversineKm(PERTH, PERTH)).toBe(0);
  });

  test('symmetric', () => {
    expect(S.haversineKm(WILLETTON, JOONDALUP))
      .toBeCloseTo(S.haversineKm(JOONDALUP, WILLETTON), 10);
  });

  test('Willetton ↔ Bull Creek is a short hop (< 5 km)', () => {
    const d = S.haversineKm(WILLETTON, BULL_CREEK);
    expect(d).toBeGreaterThan(0.5);
    expect(d).toBeLessThan(5);
  });

  test('Willetton ↔ Joondalup is beyond the near footprint', () => {
    const d = S.haversineKm(WILLETTON, JOONDALUP);
    expect(d).toBeGreaterThan(W.nearFootprintKm);
    expect(d).toBeLessThan(60);
  });

  test('Perth ↔ Broome is rural-scale (great-circle ~1660 km)', () => {
    const d = S.haversineKm(PERTH, BROOME);
    expect(d).toBeGreaterThan(1500);
    expect(d).toBeLessThan(1800);
  });

  test('null for missing or non-finite coordinates', () => {
    expect(S.haversineKm(null, PERTH)).toBeNull();
    expect(S.haversineKm(PERTH, null)).toBeNull();
    expect(S.haversineKm({ lat: NaN, lng: 115 }, PERTH)).toBeNull();
    expect(S.haversineKm({ suburb: 'Willetton' }, PERTH)).toBeNull();
  });
});

// ── Hard exclusions ──────────────────────────────────────────────────────────

describe('hard exclusions — unavailable therapists are never scored', () => {
  const EXCLUSION_REASONS = ['busy', 'leave', 'not_working', 'outside_hours', 'too_short'];

  test.each(EXCLUSION_REASONS)('reason %s → excluded, no tier, no score', (why) => {
    const c = score({
      matched: makeMatched({
        status: 'unavailable', reason: why,
        requestedSlotFits: false, window: null, windowMin: null,
      }),
      // Even a perfect geography + continuity setup cannot rescue them:
      clientPoint: WILLETTON,
      dayPoints: [WILLETTON],
      currentTherapistId: 'tp-1',
    });
    expect(c.status).toBe('excluded');
    expect(c.excludedReason).toBe(why);
    expect(c.fitTier).toBeNull();
    expect(c.internalScore).toBeNull();
    expect(c.suggestedSlot).toBeNull();
    expect(c.window).toBeNull();
    expect(c.reasons).toEqual([]);
    expect(c.geographyState).toBeNull();
  });

  test('excluded candidates still carry identity/provenance', () => {
    const c = score({
      matched: makeMatched({ status: 'unavailable', reason: 'busy', window: null, windowMin: null }),
    });
    expect(c.therapistProfileId).toBe('tp-1');
    expect(c.displayName).toBe('Alice Nguyen');
    expect(c.roleTitle).toBe('Occupational Therapist');
    expect(c.colour).toBe('#4A90D9');
    expect(c.availabilityConfidence).toBe('configured');
    expect(c.workingHoursSource).toBe('organisation_default');
  });
});

// ── Geography ────────────────────────────────────────────────────────────────

describe('geography factor', () => {
  test('telehealth zeroes geography even with a same-suburb match on the table', () => {
    const c = score({ clientPoint: WILLETTON, dayPoints: [WILLETTON], isTelehealth: true });
    expect(c.geographyState).toBe('not_applicable');
    expect(c.internalScore).toBe(BASELINE);
    expect(codes(c)).toContain('telehealth_geography_na');
    expect(labelOf(c, 'telehealth_geography_na')).toBe('Telehealth — location not a factor');
    expect(codes(c)).not.toContain('same_suburb');
    expect(codes(c)).not.toContain('near_footprint');
    expect(codes(c)).not.toContain('far_from_footprint');
  });

  test('clientPoint null → unknown, neutral, "Location not provided"', () => {
    const c = score({ clientPoint: null, dayPoints: [WILLETTON] });
    expect(c.geographyState).toBe('unknown');
    expect(c.internalScore).toBe(BASELINE);
    expect(labelOf(c, 'geography_unknown')).toBe('Location not provided');
  });

  test('dayPoints empty → unknown, neutral, "No existing geographic activity today"', () => {
    const c = score({ clientPoint: WILLETTON, dayPoints: [] });
    expect(c.geographyState).toBe('unknown');
    expect(c.internalScore).toBe(BASELINE);
    expect(labelOf(c, 'geography_unknown')).toBe('No existing geographic activity today');
  });

  test('unknown geography is NEUTRAL: equals the no-geo baseline and the telehealth score', () => {
    const unknownClient = score({ clientPoint: null, dayPoints: [WILLETTON] });
    const unknownDay = score({ clientPoint: WILLETTON, dayPoints: [] });
    const telehealth = score({ clientPoint: WILLETTON, dayPoints: [WILLETTON], isTelehealth: true });
    expect(unknownClient.internalScore).toBe(BASELINE);
    expect(unknownDay.internalScore).toBe(BASELINE);
    expect(telehealth.internalScore).toBe(BASELINE);
  });

  test('unknown is NOT poor: an unknown therapist outranks a known-far one', () => {
    const unknown = score({ clientPoint: WILLETTON, dayPoints: [] });
    const far = score({ clientPoint: WILLETTON, dayPoints: [JOONDALUP] });
    expect(unknown.internalScore).toBeGreaterThan(far.internalScore);
  });

  test('same suburb (case-insensitive) → +sameSuburb with servicing reason', () => {
    const c = score({
      clientPoint: WILLETTON,
      dayPoints: [{ suburb: 'WILLETTON', lat: -32.05, lng: 115.89 }],
    });
    expect(c.geographyState).toBe('same_suburb');
    expect(c.internalScore).toBe(BASELINE + W.sameSuburb);
    expect(labelOf(c, 'same_suburb')).toBe('Already servicing Willetton today');
  });

  test('same-suburb match works on suburb strings alone (no coordinates)', () => {
    const c = score({
      clientPoint: { suburb: 'Willetton' },
      dayPoints: [{ suburb: 'willetton' }],
    });
    expect(c.geographyState).toBe('same_suburb');
    expect(c.internalScore).toBe(BASELINE + W.sameSuburb);
  });

  test('duplicate same-suburb day points never double the bonus', () => {
    const single = score({ clientPoint: WILLETTON, dayPoints: [WILLETTON] });
    const dupes = score({
      clientPoint: WILLETTON,
      dayPoints: [WILLETTON, Object.assign({}, WILLETTON), { suburb: 'willetton', lat: -32.05, lng: 115.888 }],
    });
    expect(dupes.internalScore).toBe(single.internalScore);
    expect(dupes.reasons.filter((r) => r.code === 'same_suburb')).toHaveLength(1);
  });

  test('near footprint (distance <= nearFootprintKm) → +near with rounded km', () => {
    const d = S.haversineKm(WILLETTON, BULL_CREEK);
    const c = score({ clientPoint: WILLETTON, dayPoints: [BULL_CREEK] });
    expect(c.geographyState).toBe('near');
    expect(c.internalScore).toBe(BASELINE + W.near);
    expect(labelOf(c, 'near_footprint'))
      .toBe(`Already working near Willetton (~${Math.round(d)} km)`);
  });

  test('far → capped linear penalty with rounded km', () => {
    const d = S.haversineKm(WILLETTON, JOONDALUP);
    const expectedPenalty = Math.min(W.maxFarPenalty, (d - W.nearFootprintKm) * W.farPenaltyPerKm);
    const c = score({ clientPoint: WILLETTON, dayPoints: [JOONDALUP] });
    expect(c.geographyState).toBe('far');
    expect(c.internalScore).toBeCloseTo(BASELINE - expectedPenalty, 10);
    expect(labelOf(c, 'far_from_footprint'))
      .toBe(`Today's appointments are ~${Math.round(d)} km away`);
  });

  test('rural distances (Broome day, Perth client) cap the penalty at maxFarPenalty', () => {
    const d = S.haversineKm(PERTH, BROOME);
    expect((d - W.nearFootprintKm) * W.farPenaltyPerKm).toBeGreaterThan(W.maxFarPenalty);
    const c = score({ clientPoint: PERTH, dayPoints: [BROOME] });
    expect(c.geographyState).toBe('far');
    expect(c.internalScore).toBe(BASELINE - W.maxFarPenalty);
    expect(c.fitTier).toBe('poor');   // 22 - 30 = -8
  });

  test('nearest day point wins: a far point cannot mask a near one', () => {
    const c = score({ clientPoint: WILLETTON, dayPoints: [BROOME, JOONDALUP, BULL_CREEK] });
    expect(c.geographyState).toBe('near');
    expect(c.internalScore).toBe(BASELINE + W.near);
  });

  test('ordering: same suburb beats near beats far beats capped-far', () => {
    const same = score({ clientPoint: WILLETTON, dayPoints: [WILLETTON] });
    const near = score({ clientPoint: WILLETTON, dayPoints: [BULL_CREEK] });
    const far = score({ clientPoint: WILLETTON, dayPoints: [JOONDALUP] });
    const rural = score({ clientPoint: PERTH, dayPoints: [BROOME] });
    expect(same.internalScore).toBeGreaterThan(near.internalScore);
    expect(near.internalScore).toBeGreaterThan(far.internalScore);
    expect(far.internalScore).toBeGreaterThan(rural.internalScore);
    expect(same.fitTier).toBe('best');       // 22 + 40 = 62
    expect(near.fitTier).toBe('good');       // 22 + 25 = 47
    expect(far.fitTier).toBe('possible');    // 22 - ~10.5 ≈ 11.5
  });
});

// ── Comfort, capacity, continuity, provenance ────────────────────────────────

describe('comfort factor', () => {
  test('window >= 2x duration → +comfort with reason', () => {
    const c = score({ matched: makeMatched({ window: { startMin: 600, endMin: 720 }, windowMin: 120 }) });
    expect(codes(c)).toContain('comfortable_fit');
    expect(labelOf(c, 'comfortable_fit')).toBe('Appointment fits with room around it');
  });

  test('exact boundary: windowMin == 2x duration applies; one minute less does not', () => {
    const at = score({ matched: makeMatched({ window: { startMin: 600, endMin: 720 }, windowMin: 120 }) });
    const below = score({ matched: makeMatched({ window: { startMin: 600, endMin: 719 }, windowMin: 119 }) });
    expect(at.internalScore - below.internalScore).toBe(W.comfort);
    expect(codes(at)).toContain('comfortable_fit');
    expect(codes(below)).not.toContain('comfortable_fit');
  });
});

describe('capacity factor', () => {
  const withAvailable = (availableMin, over = {}) => score(Object.assign({
    availability: makeAvailability({ capacity: { workingMin: 540, busyMin: 0, availableMin } }),
  }, over));

  test('scales with available hours below the cap', () => {
    const c90 = withAvailable(90);    // 1.5h * 4 = 6
    const c120 = withAvailable(120);  // 2h * 4 = 8
    expect(c120.internalScore - c90.internalScore).toBe(2);
  });

  test('capped at maxCapacity: 3h and 10h score identically', () => {
    const c180 = withAvailable(180);
    const c600 = withAvailable(600);
    expect(c180.internalScore).toBe(c600.internalScore);
    expect(c180.internalScore).toBe(BASELINE);   // 180 min hits the cap exactly
  });

  test('reason only appears from 120 min (bonus still applies below)', () => {
    const c119 = withAvailable(119);
    const c120 = withAvailable(120);
    expect(codes(c119)).not.toContain('capacity');
    expect(codes(c120)).toContain('capacity');
    expect(c119.internalScore).toBeCloseTo(W.comfort + (119 / 60) * W.capacityPerHour, 10);
  });

  test('reason label uses h/m formatting', () => {
    expect(labelOf(withAvailable(120), 'capacity')).toBe('2h available capacity remains');
    expect(labelOf(withAvailable(150), 'capacity')).toBe('2h 30m available capacity remains');
    expect(labelOf(withAvailable(600), 'capacity')).toBe('10h available capacity remains');
  });
});

describe('continuity factor', () => {
  test('existing therapist → +continuity with reason', () => {
    const c = score({ currentTherapistId: 'tp-1' });
    expect(c.internalScore).toBe(BASELINE + W.continuity);
    expect(labelOf(c, 'continuity')).toBe('Existing therapist relationship');
  });

  test('a different current therapist gets no bonus and no reason', () => {
    const c = score({ currentTherapistId: 'tp-2' });
    expect(c.internalScore).toBe(BASELINE);
    expect(codes(c)).not.toContain('continuity');
  });

  test('null currentTherapistId never matches a null profile id', () => {
    const c = score({
      availability: makeAvailability({ therapistProfileId: null }),
      matched: makeMatched({ therapistProfileId: null }),
      currentTherapistId: null,
    });
    expect(codes(c)).not.toContain('continuity');
  });

  test('the continuity therapist stays excluded when unavailable — no rescue', () => {
    const c = score({
      matched: makeMatched({ status: 'unavailable', reason: 'leave', window: null, windowMin: null }),
      currentTherapistId: 'tp-1',
    });
    expect(c.status).toBe('excluded');
    expect(c.excludedReason).toBe('leave');
    expect(c.internalScore).toBeNull();
    expect(c.reasons).toEqual([]);
  });
});

describe('default-hours provenance', () => {
  test("confidence 'default' adds the reason without moving the score", () => {
    const configured = score({});
    const dflt = score({ availability: makeAvailability({ availabilityConfidence: 'default' }) });
    expect(dflt.internalScore).toBe(configured.internalScore);
    expect(labelOf(dflt, 'default_hours')).toBe('Availability based on organisation default hours');
    expect(codes(configured)).not.toContain('default_hours');
  });
});

// ── Slot, window, output shape ───────────────────────────────────────────────

describe('suggestedSlot and window', () => {
  test('the requested slot is suggested when it fits', () => {
    const c = score({ requestStartMin: 600, durationMin: 60 });
    expect(c.suggestedSlot).toEqual({ startMin: 600, endMin: 660 });
  });

  test('no requested start supplied → suggestedSlot null (documented)', () => {
    const c = score({ requestStartMin: undefined });
    expect(c.suggestedSlot).toBeNull();
  });

  test('window is copied from the match, never shared by reference', () => {
    const matched = makeMatched();
    const c = score({ matched });
    expect(c.window).toEqual({ startMin: 540, endMin: 720 });
    expect(c.window).not.toBe(matched.window);
    expect(c.windowMin).toBe(180);
  });
});

// ── Explanation-factor consistency ───────────────────────────────────────────

describe('explanation-factor consistency (reason present ⟺ factor applied)', () => {
  // Each case pairs a 'with' scenario against a 'without' control; the
  // score difference must equal EXACTLY the factor's weight, and the
  // reason code must toggle with it — proving explanations derive from
  // actually-applied factors in both directions.
  const cases = [
    ['same_suburb', W.sameSuburb,
      { clientPoint: WILLETTON, dayPoints: [WILLETTON] },
      { clientPoint: WILLETTON, dayPoints: [] }],
    ['near_footprint', W.near,
      { clientPoint: WILLETTON, dayPoints: [BULL_CREEK] },
      { clientPoint: WILLETTON, dayPoints: [] }],
    ['comfortable_fit', W.comfort,
      { matched: makeMatched({ window: { startMin: 540, endMin: 720 }, windowMin: 180 }) },
      { matched: makeMatched({ window: { startMin: 540, endMin: 650 }, windowMin: 110 }) }],
    ['continuity', W.continuity,
      { currentTherapistId: 'tp-1' },
      { currentTherapistId: 'tp-9' }],
  ];

  test.each(cases)('%s: reason toggles with a delta of exactly its weight', (code, weight, withOver, withoutOver) => {
    const withC = score(withOver);
    const withoutC = score(withoutOver);
    expect(codes(withC)).toContain(code);
    expect(codes(withoutC)).not.toContain(code);
    expect(withC.internalScore - withoutC.internalScore).toBeCloseTo(weight, 10);
  });

  test('far penalty: reason present ⟺ penalty applied', () => {
    const far = score({ clientPoint: WILLETTON, dayPoints: [JOONDALUP] });
    const control = score({ clientPoint: WILLETTON, dayPoints: [] });
    expect(codes(far)).toContain('far_from_footprint');
    expect(codes(control)).not.toContain('far_from_footprint');
    expect(far.internalScore).toBeLessThan(control.internalScore);
    // And never alongside a bonus reason:
    expect(codes(far)).not.toContain('same_suburb');
    expect(codes(far)).not.toContain('near_footprint');
  });

  test('no same_suburb reason without the bonus (near case pays near, not sameSuburb)', () => {
    const near = score({ clientPoint: WILLETTON, dayPoints: [BULL_CREEK] });
    expect(codes(near)).not.toContain('same_suburb');
    expect(near.internalScore).toBe(BASELINE + W.near);   // not + sameSuburb
  });

  test('geography reasons are mutually exclusive — exactly one per candidate', () => {
    const geoCodes = ['same_suburb', 'near_footprint', 'far_from_footprint',
      'geography_unknown', 'telehealth_geography_na'];
    const scenarios = [
      score({ clientPoint: WILLETTON, dayPoints: [WILLETTON] }),
      score({ clientPoint: WILLETTON, dayPoints: [BULL_CREEK] }),
      score({ clientPoint: WILLETTON, dayPoints: [JOONDALUP] }),
      score({ clientPoint: null, dayPoints: [] }),
      score({ clientPoint: WILLETTON, dayPoints: [WILLETTON], isTelehealth: true }),
    ];
    for (const c of scenarios) {
      expect(c.reasons.filter((r) => geoCodes.indexOf(r.code) !== -1)).toHaveLength(1);
    }
  });
});

// ── Tiers ────────────────────────────────────────────────────────────────────

describe('assignTier — exact boundaries (inclusive >=)', () => {
  test.each([
    [TIERS.best, 'best'],           // 55
    [TIERS.best + 40, 'best'],
    [TIERS.best - 0.001, 'good'],   // 54.999
    [TIERS.good, 'good'],           // 30
    [TIERS.good - 0.001, 'possible'],
    [TIERS.possible, 'possible'],   // 10
    [TIERS.possible - 0.001, 'poor'],
    [0, 'poor'],
    [-8, 'poor'],
  ])('score %p → %s', (value, tier) => {
    expect(S.assignTier(value)).toBe(tier);
  });

  test('scoreCandidate uses assignTier on its own internalScore', () => {
    const c = score({ clientPoint: WILLETTON, dayPoints: [WILLETTON], currentTherapistId: 'tp-1' });
    expect(c.fitTier).toBe(S.assignTier(c.internalScore));
    expect(c.fitTier).toBe('best');   // 22 + 40 + 30 = 92
  });
});

// ── Ranking ──────────────────────────────────────────────────────────────────

describe('rankCandidates', () => {
  const named = (name, over = {}) => score(Object.assign({
    availability: makeAvailability({ therapistProfileId: `tp-${name}`, displayName: name }),
    matched: makeMatched({ therapistProfileId: `tp-${name}` }),
  }, over));

  test('sorts by internalScore desc first', () => {
    const same = named('Cara', { clientPoint: WILLETTON, dayPoints: [WILLETTON] });
    const near = named('Amir', { clientPoint: WILLETTON, dayPoints: [BULL_CREEK] });
    const far = named('Beth', { clientPoint: WILLETTON, dayPoints: [JOONDALUP] });
    const ranked = S.rankCandidates([far, near, same]);
    expect(ranked.map((c) => c.displayName)).toEqual(['Cara', 'Amir', 'Beth']);
  });

  test('score tie → windowMin desc', () => {
    const roomy = named('Zara', {
      matched: makeMatched({ therapistProfileId: 'tp-Zara', window: { startMin: 480, endMin: 780 }, windowMin: 300 }),
    });
    const snug = named('Andy', {
      matched: makeMatched({ therapistProfileId: 'tp-Andy', window: { startMin: 540, endMin: 720 }, windowMin: 180 }),
    });
    expect(roomy.internalScore).toBe(snug.internalScore);   // comfort applies to both
    const ranked = S.rankCandidates([snug, roomy]);
    expect(ranked.map((c) => c.displayName)).toEqual(['Zara', 'Andy']);
  });

  test('score and window tie → displayName asc', () => {
    const beth = named('Beth');
    const amir = named('Amir');
    const ranked = S.rankCandidates([beth, amir]);
    expect(ranked.map((c) => c.displayName)).toEqual(['Amir', 'Beth']);
  });

  test('fully equal keys keep insertion order (stable sort)', () => {
    const a = named('Sam');
    const b = named('Sam');
    b.therapistProfileId = 'tp-Sam-2';
    const ranked = S.rankCandidates([a, b]);
    expect(ranked[0]).toBe(a);
    expect(ranked[1]).toBe(b);
  });

  test('excluded entries are dropped, never ranked', () => {
    const excluded = score({
      matched: makeMatched({ status: 'unavailable', reason: 'busy', window: null, windowMin: null }),
    });
    const ok = named('Amir');
    const ranked = S.rankCandidates([excluded, ok]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].displayName).toBe('Amir');
  });

  test('never mutates the input array', () => {
    const low = named('Beth', { clientPoint: WILLETTON, dayPoints: [JOONDALUP] });
    const high = named('Amir', { clientPoint: WILLETTON, dayPoints: [WILLETTON] });
    const input = [low, high];
    S.rankCandidates(input);
    expect(input[0]).toBe(low);
    expect(input[1]).toBe(high);
  });

  test('non-array input → empty list', () => {
    expect(S.rankCandidates(null)).toEqual([]);
    expect(S.rankCandidates(undefined)).toEqual([]);
  });
});

// ── Integration with the real availability engine ────────────────────────────

describe('integration: computeDayAvailability → classifyCandidate → scoreCandidate', () => {
  const perthIso = (ymd, hh, mm = 0) =>
    new Date(Date.parse(`${ymd}T00:00:00Z`) - 480 * 60000 + (hh * 60 + mm) * 60000).toISOString();
  const MON = '2026-08-10';

  test('end-to-end candidate for a 10:00 request after a 9–10 appointment', () => {
    const day = A.computeDayAvailability({
      date: MON,
      events: [{ id: 'e1', start: perthIso(MON, 9), end: perthIso(MON, 10), eventType: 'therapy' }],
      scheduleKnown: true,
    });
    const therapistResult = Object.assign({}, day, {
      therapistProfileId: 'tp-9',
      displayName: 'Ivy Chen',
      roleTitle: 'Speech Pathologist',
      colour: '#AA3366',
    });
    const matched = A.classifyCandidate(therapistResult, { startMin: 600, durationMin: 60 });
    expect(matched.status).toBe('available');

    const c = S.scoreCandidate({
      availability: therapistResult,
      matched,
      clientPoint: WILLETTON,
      dayPoints: [BULL_CREEK],
      isTelehealth: false,
      currentTherapistId: 'tp-9',
      durationMin: 60,
      requestStartMin: 600,
    });
    expect(c.status).toBe('candidate');
    expect(c.geographyState).toBe('near');
    expect(c.window).toEqual({ startMin: 600, endMin: 1020 });   // 10:00 → 5:00pm
    expect(c.suggestedSlot).toEqual({ startMin: 600, endMin: 660 });
    // near 25 + comfort 10 + capacity capped 12 + continuity 30 = 77 → best
    expect(c.internalScore).toBe(W.near + W.comfort + W.maxCapacity + W.continuity);
    expect(c.fitTier).toBe('best');
    expect(labelOf(c, 'capacity')).toBe('8h available capacity remains');   // 60 + 420 min free
    expect(c.availabilityConfidence).toBe('configured');
    expect(codes(c)).not.toContain('default_hours');
  });

  test('an engine-classified busy therapist flows through as excluded', () => {
    const day = A.computeDayAvailability({
      date: MON,
      events: [{ id: 'e1', start: perthIso(MON, 10), end: perthIso(MON, 11), eventType: 'therapy' }],
    });
    const therapistResult = Object.assign({}, day, {
      therapistProfileId: 'tp-9', displayName: 'Ivy Chen', roleTitle: 'SP', colour: '#AA3366',
    });
    const matched = A.classifyCandidate(therapistResult, { startMin: 600, durationMin: 60 });
    expect(matched.status).toBe('unavailable');

    const c = S.scoreCandidate({ availability: therapistResult, matched });
    expect(c.status).toBe('excluded');
    expect(c.excludedReason).toBe('busy');
    expect(c.internalScore).toBeNull();
    // Default Mon–Fri assumption surfaces as 'default' confidence — but
    // excluded candidates still get no reasons at all:
    expect(c.availabilityConfidence).toBe('default');
    expect(c.reasons).toEqual([]);
  });
});

// ── CONFIG sanity ────────────────────────────────────────────────────────────

describe('CONFIG', () => {
  test('documents the mandated weights and tiers', () => {
    expect(W).toEqual({
      sameSuburb: 40,
      nearFootprintKm: 15,
      near: 25,
      farPenaltyPerKm: 0.5,
      maxFarPenalty: 30,
      comfort: 10,
      capacityPerHour: 4,
      maxCapacity: 12,
      continuity: 30,
    });
    expect(TIERS).toEqual({ best: 55, good: 30, possible: 10 });
  });
});
