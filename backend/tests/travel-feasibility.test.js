'use strict';

/**
 * TRAVEL FEASIBILITY — exhaustive unit tests for the pure Phase-8 interval
 * feasibility in backend/travel-feasibility.js. No DB, no network, no
 * routing API: travel times are plain data fed in by each case.
 *
 * Baseline fixture (config: arrivalMargin 10, tight 10):
 *   proposed 10:00–11:00 (600–660) in segment 9:00–1:00pm (540–780).
 */

const T = require('../travel-feasibility');

const CFG = T.TRAVEL_CONFIG;

const base = () => ({
  proposed: { startMin: 600, durationMin: 60, suburb: 'Willetton' },
  segment: { startMin: 540, endMin: 780 },
  prev: null,
  next: null,
  buffers: { beforeMin: 0, afterMin: 0 },
  travel: { beforeMin: null, afterMin: null },
  isTelehealth: false,
});

const evalT = (over = {}) => T.evaluateTravelFeasibility(Object.assign(base(), over));

const codes = (r) => r.reasons.map((x) => x.code);
const labelOf = (r, code) => {
  const found = r.reasons.find((x) => x.code === code);
  return found ? found.label : null;
};

// ── Config ───────────────────────────────────────────────────────────────────

describe('TRAVEL_CONFIG', () => {
  test('documents the mandated margins', () => {
    expect(CFG).toEqual({ arrivalMarginMinutes: 10, tightMarginMinutes: 10 });
  });
});

// ── Input validation ─────────────────────────────────────────────────────────

describe('input validation', () => {
  test('throws without numeric startMin/durationMin', () => {
    expect(() => T.evaluateTravelFeasibility({})).toThrow(/startMin and durationMin/);
    expect(() => evalT({ proposed: { startMin: 600, durationMin: 0, suburb: 'X' } })).toThrow();
    expect(() => T.findFeasibleAlternative({ proposed: {}, segmentsCtx: [] })).toThrow(/startMin and durationMin/);
  });
});

// ── Neighbour combinations ───────────────────────────────────────────────────

describe('no prev / no next', () => {
  test('unconstrained slot is feasible with null remaining margin', () => {
    const r = evalT();   // travel legs null, but no legs exist → NOT unknown
    expect(r.status).toBe('travel_feasible');
    expect(r.remainingMarginMinutes).toBeNull();
    expect(r.marginBeforeMin).toBeNull();
    expect(r.marginAfterMin).toBeNull();
    expect(r.earliestStartMin).toBe(540);
    expect(r.latestEndMin).toBe(780);
    expect(r.practicalWindow).toEqual({ startMin: 540, endMin: 780 });
    expect(codes(r)).toContain('no_previous_route_constraint');
    expect(codes(r)).toContain('no_next_route_constraint');
    expect(codes(r)).not.toContain('travel_margin_good');
  });
});

describe('prev only', () => {
  test('feasible with comfortable margin from the previous appointment', () => {
    const r = evalT({
      prev: { endMin: 540, suburb: 'Bull Creek' },
      travel: { beforeMin: 20, afterMin: null },   // afterMin null is fine: no next leg exists
    });
    expect(r.status).toBe('travel_feasible');
    expect(r.earliestStartMin).toBe(560);           // 540 + 0 buffer + 20 travel
    expect(r.marginBeforeMin).toBe(40);             // 600 - 560
    expect(r.marginAfterMin).toBeNull();
    expect(r.remainingMarginMinutes).toBe(40);
    expect(r.practicalWindow).toEqual({ startMin: 560, endMin: 780 });
    expect(labelOf(r, 'travel_before_good')).toBe('~20 min from previous appointment');
    expect(codes(r)).toContain('no_next_route_constraint');
    expect(codes(r)).not.toContain('travel_after_good');
    expect(codes(r)).not.toContain('travel_margin_good');
  });

  test('insufficient before → travel_infeasible_prev', () => {
    const r = evalT({
      prev: { endMin: 590, suburb: 'Bull Creek' },
      travel: { beforeMin: 20, afterMin: null },
    });
    expect(r.status).toBe('travel_infeasible');
    expect(r.marginBeforeMin).toBe(-10);            // 600 - (590 + 20)
    expect(r.remainingMarginMinutes).toBe(-10);
    expect(codes(r)).toEqual(['travel_infeasible_prev']);
    expect(labelOf(r, 'travel_infeasible_prev')).toBe('Cannot arrive from the previous appointment in time');
    // The proposal fails, but the clipped window still shows where a fit exists:
    expect(r.practicalWindow).toEqual({ startMin: 610, endMin: 780 });
  });
});

describe('next only', () => {
  test('feasible with margin reasons', () => {
    const r = evalT({
      next: { startMin: 720, suburb: 'Leeming' },
      travel: { beforeMin: null, afterMin: 15 },
    });
    expect(r.status).toBe('travel_feasible');
    expect(r.latestEndMin).toBe(695);               // 720 - 15 - 0 - 10
    expect(r.marginBeforeMin).toBeNull();
    expect(r.marginAfterMin).toBe(45);              // 720 - (660 + 15 + 0), arrival margin included
    expect(r.remainingMarginMinutes).toBe(35);      // 45 - 10 arrival margin
    expect(r.practicalWindow).toEqual({ startMin: 540, endMin: 695 });
    expect(labelOf(r, 'travel_after_good')).toBe('~15 min to next appointment');
    expect(labelOf(r, 'travel_margin_good')).toBe('35 min schedule margin remains');
    expect(codes(r)).toContain('no_previous_route_constraint');
  });

  test('insufficient after → travel_infeasible_next', () => {
    const r = evalT({
      next: { startMin: 680, suburb: 'Leeming' },
      travel: { beforeMin: null, afterMin: 15 },
    });
    // 660 + 15 + 0 + 10 = 685 > 680 → cannot make it
    expect(r.status).toBe('travel_infeasible');
    expect(r.marginAfterMin).toBe(5);
    expect(r.remainingMarginMinutes).toBe(-5);
    expect(codes(r)).toEqual(['travel_infeasible_next']);
    expect(labelOf(r, 'travel_infeasible_next')).toBe('Would not reach the next appointment in time');
  });
});

describe('both neighbours', () => {
  const both = (over = {}) => evalT(Object.assign({
    prev: { endMin: 540, suburb: 'Bull Creek' },
    next: { startMin: 720, suburb: 'Leeming' },
    travel: { beforeMin: 20, afterMin: 15 },
  }, over));

  test('feasible: bounds, margins and reasons all line up', () => {
    const r = both();
    expect(r.status).toBe('travel_feasible');
    expect(r.earliestStartMin).toBe(560);
    expect(r.latestEndMin).toBe(695);
    expect(r.marginBeforeMin).toBe(40);
    expect(r.marginAfterMin).toBe(45);
    expect(r.remainingMarginMinutes).toBe(35);      // min(40, 45 - 10)
    expect(r.practicalWindow).toEqual({ startMin: 560, endMin: 695 });
    expect(codes(r)).toEqual(['travel_before_good', 'travel_after_good', 'travel_margin_good']);
  });

  test('both constraints failing report both reasons', () => {
    const r = both({
      prev: { endMin: 590, suburb: 'Bull Creek' },
      next: { startMin: 680, suburb: 'Leeming' },
    });
    expect(r.status).toBe('travel_infeasible');
    expect(codes(r)).toEqual(['travel_infeasible_prev', 'travel_infeasible_next']);
  });
});

// ── Boundary semantics ───────────────────────────────────────────────────────

describe('boundary semantics (constraints use <=)', () => {
  test('exact fit: arrival with exactly the safety margin passes but is tight (remaining 0)', () => {
    // 660 + 15 travel + 0 buffer + 10 arrival = 685 == next.startMin
    const r = evalT({
      next: { startMin: 685, suburb: 'Leeming' },
      travel: { beforeMin: null, afterMin: 15 },
    });
    expect(r.status).toBe('tight_fit');             // NOT infeasible — equality passes
    expect(r.marginAfterMin).toBe(10);
    expect(r.remainingMarginMinutes).toBe(0);
    expect(labelOf(r, 'travel_tight')).toBe('Only 0 min travel margin remains');
  });

  test('exact fit on the before side: prev chain lands exactly on the start', () => {
    const r = evalT({
      prev: { endMin: 580, suburb: 'Bull Creek' },
      travel: { beforeMin: 20, afterMin: null },
    });
    // 580 + 20 = 600 == proposed start → margin 0 → tight, not infeasible
    expect(r.status).toBe('tight_fit');
    expect(r.marginBeforeMin).toBe(0);
    expect(r.remainingMarginMinutes).toBe(0);
  });

  test('remaining == tightMarginMinutes → feasible; one minute less → tight_fit', () => {
    const atThreshold = evalT({
      next: { startMin: 695, suburb: 'Leeming' },   // remaining = 695 - 675 - 10 = 10
      travel: { beforeMin: null, afterMin: 15 },
    });
    expect(atThreshold.remainingMarginMinutes).toBe(CFG.tightMarginMinutes);
    expect(atThreshold.status).toBe('travel_feasible');

    const oneLess = evalT({
      next: { startMin: 694, suburb: 'Leeming' },   // remaining = 9
      travel: { beforeMin: null, afterMin: 15 },
    });
    expect(oneLess.remainingMarginMinutes).toBe(9);
    expect(oneLess.status).toBe('tight_fit');
    expect(labelOf(oneLess, 'travel_tight')).toBe('Only 9 min travel margin remains');
  });
});

// ── Buffers ──────────────────────────────────────────────────────────────────

describe('buffers', () => {
  test('afterMin follows the PREVIOUS appointment, beforeMin precedes the NEXT — verified numerically', () => {
    const r = evalT({
      prev: { endMin: 540, suburb: 'Bull Creek' },
      next: { startMin: 720, suburb: 'Leeming' },
      buffers: { beforeMin: 5, afterMin: 10 },
      travel: { beforeMin: 20, afterMin: 15 },
    });
    // Before chain: 540 + 10 (after-buffer of prev) + 20 travel = 570 — NOT 565
    expect(r.earliestStartMin).toBe(570);
    expect(r.marginBeforeMin).toBe(30);             // 600 - 570
    // After chain: 720 - 15 travel - 5 (before-buffer of next) - 10 arrival = 690
    expect(r.latestEndMin).toBe(690);
    expect(r.marginAfterMin).toBe(40);              // 720 - (660 + 15 + 5)
    expect(r.remainingMarginMinutes).toBe(30);      // min(30, 40 - 10)
    expect(r.practicalWindow).toEqual({ startMin: 570, endMin: 690 });
    expect(r.status).toBe('travel_feasible');
  });

  test('omitted buffers default to zero', () => {
    const r = evalT({
      buffers: undefined,
      prev: { endMin: 540, suburb: 'Bull Creek' },
      travel: { beforeMin: 20, afterMin: null },
    });
    expect(r.earliestStartMin).toBe(560);
  });
});

// ── Unknown routes ───────────────────────────────────────────────────────────

describe('unknown routes (null travel on an existing leg)', () => {
  test('prev exists with null beforeMin → travel_unknown', () => {
    const r = evalT({
      prev: { endMin: 540, suburb: 'Bull Creek' },
      travel: { beforeMin: null, afterMin: null },
    });
    expect(r.status).toBe('travel_unknown');
    expect(codes(r)).toEqual(['travel_unknown']);
    expect(labelOf(r, 'travel_unknown')).toBe('Travel time could not be confirmed — manual review required');
    expect(r.marginBeforeMin).toBeNull();
    expect(r.remainingMarginMinutes).toBeNull();
    expect(r.practicalWindow).toBeNull();
  });

  test('next exists with null afterMin → travel_unknown', () => {
    const r = evalT({
      next: { startMin: 720, suburb: 'Leeming' },
      travel: { beforeMin: null, afterMin: null },
    });
    expect(r.status).toBe('travel_unknown');
  });

  test('one known and one unknown leg is still unknown', () => {
    const r = evalT({
      prev: { endMin: 540, suburb: 'Bull Creek' },
      next: { startMin: 720, suburb: 'Leeming' },
      travel: { beforeMin: 10, afterMin: null },
    });
    expect(r.status).toBe('travel_unknown');
  });

  test('travel object omitted entirely with a neighbour present → unknown', () => {
    const r = evalT({ prev: { endMin: 540, suburb: 'Bull Creek' }, travel: undefined });
    expect(r.status).toBe('travel_unknown');
  });

  test('a zero-minute route is a KNOWN route (same location), not unknown', () => {
    const r = evalT({
      prev: { endMin: 590, suburb: 'Willetton' },
      travel: { beforeMin: 0, afterMin: null },
    });
    expect(r.status).not.toBe('travel_unknown');
    expect(r.marginBeforeMin).toBe(10);
  });
});

// ── Location dependent ───────────────────────────────────────────────────────

describe('location_dependent', () => {
  test('in-person proposal without a suburb cannot be assessed', () => {
    for (const suburb of [undefined, null, '']) {
      const r = evalT({ proposed: { startMin: 600, durationMin: 60, suburb } });
      expect(r.status).toBe('location_dependent');
      expect(codes(r)).toEqual(['location_dependent']);
      expect(r.remainingMarginMinutes).toBeNull();
      expect(r.practicalWindow).toBeNull();
    }
  });

  test('telehealth takes precedence: no suburb + telehealth is not location_dependent', () => {
    const r = evalT({
      proposed: { startMin: 600, durationMin: 60 },
      isTelehealth: true,
    });
    expect(r.status).toBe('not_applicable');
  });
});

// ── Telehealth ───────────────────────────────────────────────────────────────

describe('telehealth', () => {
  test('no physical legs → not_applicable with telehealth_no_travel', () => {
    const r = evalT({ isTelehealth: true });
    expect(r.status).toBe('not_applicable');
    expect(codes(r)).toEqual(['telehealth_no_travel']);
    expect(labelOf(r, 'telehealth_no_travel')).toBe('Telehealth — no travel required');
    expect(r.practicalWindow).toEqual({ startMin: 540, endMin: 780 });
    expect(r.remainingMarginMinutes).toBeNull();
  });

  test('physical neighbours without a betweenMin route stay not_applicable', () => {
    const r = evalT({
      isTelehealth: true,
      prev: { endMin: 590, suburb: 'Bull Creek' },
      next: { startMin: 700, suburb: 'Joondalup' },
      travel: { beforeMin: null, afterMin: null },
    });
    expect(r.status).toBe('not_applicable');
  });

  test('bridge fits: prev→next direct travel squeezes around the call → not_applicable', () => {
    const r = evalT({
      isTelehealth: true,
      prev: { endMin: 590, suburb: 'Bull Creek' },
      next: { startMin: 700, suburb: 'Joondalup' },
      travel: { beforeMin: null, afterMin: null, betweenMin: 90 },
    });
    // 590 + 0 + 90 + 0 + 10 = 690 <= 700 → bridgeable
    expect(r.status).toBe('not_applicable');
  });

  test('bridge infeasible: the call sits between two visits that cannot be bridged', () => {
    const r = evalT({
      isTelehealth: true,
      prev: { endMin: 590, suburb: 'Bull Creek' },
      next: { startMin: 700, suburb: 'Joondalup' },
      travel: { beforeMin: null, afterMin: null, betweenMin: 120 },
    });
    // 590 + 120 + 10 = 720 > 700 → cannot bridge around the session
    expect(r.status).toBe('travel_infeasible');
    expect(codes(r)).toEqual(['telehealth_bridge_infeasible']);
  });

  test('bridge check needs BOTH neighbours to be physical (have suburbs)', () => {
    const r = evalT({
      isTelehealth: true,
      prev: { endMin: 590 },                          // no suburb → not a physical visit
      next: { startMin: 700, suburb: 'Joondalup' },
      travel: { betweenMin: 120 },
    });
    expect(r.status).toBe('not_applicable');
  });

  test('bridge check only applies when the session actually sits between them', () => {
    const r = evalT({
      isTelehealth: true,
      proposed: { startMin: 600, durationMin: 60 },
      prev: { endMin: 610, suburb: 'Bull Creek' },    // overlaps the proposal → not between
      next: { startMin: 700, suburb: 'Joondalup' },
      travel: { betweenMin: 120 },
    });
    expect(r.status).toBe('not_applicable');
  });
});

// ── practicalWindow ──────────────────────────────────────────────────────────

describe('practicalWindow', () => {
  const seg = { startMin: 540, endMin: 780 };

  test('no neighbours → the whole segment', () => {
    expect(T.practicalWindow({ segment: seg, prev: null, next: null, travel: {}, durationMin: 60 }))
      .toEqual({ startMin: 540, endMin: 780 });
  });

  test('clips both ends by travel, buffers and arrival margin', () => {
    expect(T.practicalWindow({
      segment: seg,
      prev: { endMin: 540 },
      next: { startMin: 720 },
      buffers: { beforeMin: 5, afterMin: 10 },
      travel: { beforeMin: 20, afterMin: 15 },
      durationMin: 60,
    })).toEqual({ startMin: 570, endMin: 690 });
  });

  test('null travel legs clip optimistically as zero', () => {
    expect(T.practicalWindow({
      segment: seg,
      prev: { endMin: 600 },
      next: { startMin: 700 },
      travel: { beforeMin: null, afterMin: null },
      durationMin: 60,
    })).toEqual({ startMin: 600, endMin: 690 });   // 700 - 0 - 0 - 10
  });

  test('window shorter than durationMin → null; equal → kept', () => {
    const tight = {
      segment: { startMin: 540, endMin: 660 },
      prev: { endMin: 540 },
      next: { startMin: 700 },
      travel: { beforeMin: 30, afterMin: 20 },
    };
    // start' = 570, end' = min(660, 700 - 20 - 0 - 10 = 670) = 660 → 90 min window
    expect(T.practicalWindow(Object.assign({}, tight, { durationMin: 120 }))).toBeNull();
    expect(T.practicalWindow(Object.assign({}, tight, { durationMin: 90 })))
      .toEqual({ startMin: 570, endMin: 660 });
  });

  test('honours a config override for the arrival margin', () => {
    const args = {
      segment: seg,
      prev: null,
      next: { startMin: 700 },
      travel: { afterMin: 20 },
      durationMin: 60,
    };
    expect(T.practicalWindow(args)).toEqual({ startMin: 540, endMin: 670 });
    expect(T.practicalWindow(Object.assign({}, args, {
      config: { arrivalMarginMinutes: 0, tightMarginMinutes: 10 },
    }))).toEqual({ startMin: 540, endMin: 680 });
  });
});

// ── findFeasibleAlternative ──────────────────────────────────────────────────

describe('findFeasibleAlternative', () => {
  // Morning segment ends before the proposal; afternoon starts after it.
  const MORNING = {
    segment: { startMin: 480, endMin: 570 },
    prev: null,
    next: { startMin: 580, suburb: 'Leeming' },
    travel: { afterMin: 10 },
    // window: 480..min(570, 580-10-0-10=560) = 480..560 → latest 60-min start 500
  };
  const AFTERNOON = {
    segment: { startMin: 620, endMin: 780 },
    prev: { endMin: 600, suburb: 'Bull Creek' },
    next: null,
    travel: { beforeMin: 15 },
    // window: max(620, 615)..780 = 620..780 → earliest start 620
  };
  const proposed = { startMin: 600, durationMin: 60 };

  test('picks the start nearest to the proposal (later wins here)', () => {
    const alt = T.findFeasibleAlternative({
      segmentsCtx: [MORNING, AFTERNOON], proposed, buffers: {}, durationMin: 60,
    });
    expect(alt).toEqual({ startMin: 620, endMin: 680 });   // |620-600| = 20 beats |500-600| = 100
  });

  test('earlier-only day → clamps back into the morning window', () => {
    const alt = T.findFeasibleAlternative({
      segmentsCtx: [MORNING], proposed, buffers: {}, durationMin: 60,
    });
    expect(alt).toEqual({ startMin: 500, endMin: 560 });
  });

  test('later-only day → earliest reachable afternoon start', () => {
    const alt = T.findFeasibleAlternative({
      segmentsCtx: [AFTERNOON], proposed, buffers: {}, durationMin: 60,
    });
    expect(alt).toEqual({ startMin: 620, endMin: 680 });
  });

  test('no segment can hold the duration → null', () => {
    expect(T.findFeasibleAlternative({
      segmentsCtx: [MORNING, AFTERNOON], proposed, buffers: {}, durationMin: 200,
    })).toBeNull();
    expect(T.findFeasibleAlternative({ segmentsCtx: [], proposed, buffers: {}, durationMin: 60 }))
      .toBeNull();
  });

  test('equidistant alternatives tie-break to the EARLIER start', () => {
    const earlier = {
      segment: { startMin: 480, endMin: 610 },
      prev: null,
      next: { startMin: 620, suburb: 'X' },
      travel: { afterMin: 0 },
      // window 480..610 → latest start 550 → delta 50
    };
    const later = {
      segment: { startMin: 650, endMin: 780 },
      prev: { endMin: 640, suburb: 'X' },
      next: null,
      travel: { beforeMin: 10 },
      // window 650..780 → earliest start 650 → delta 50
    };
    const alt = T.findFeasibleAlternative({
      segmentsCtx: [later, earlier], proposed, buffers: {}, durationMin: 60,
    });
    expect(alt).toEqual({ startMin: 550, endMin: 610 });
  });

  test('snaps off-grid starts to 5-minute granularity inside the window', () => {
    const ctx = {
      segment: { startMin: 540, endMin: 700 },
      prev: { endMin: 600, suburb: 'X' },
      next: null,
      travel: { beforeMin: 12 },
      // window 612..700; clamp(600) → 612; snap: 610 < window start → 615
    };
    const alt = T.findFeasibleAlternative({
      segmentsCtx: [ctx], proposed, buffers: {}, durationMin: 60,
    });
    expect(alt).toEqual({ startMin: 615, endMin: 675 });
  });

  test('a proposal already inside a window comes back unchanged', () => {
    const alt = T.findFeasibleAlternative({
      segmentsCtx: [{ segment: { startMin: 540, endMin: 780 }, prev: null, next: null, travel: {} }],
      proposed, buffers: {}, durationMin: 60,
    });
    expect(alt).toEqual({ startMin: 600, endMin: 660 });
  });

  test('buffers flow through to the window computation', () => {
    const alt = T.findFeasibleAlternative({
      segmentsCtx: [AFTERNOON],
      proposed,
      buffers: { beforeMin: 0, afterMin: 10 },      // prev chain: 600 + 10 + 15 = 625
      durationMin: 60,
    });
    expect(alt).toEqual({ startMin: 625, endMin: 685 });
  });
});
