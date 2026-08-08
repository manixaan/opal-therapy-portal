'use strict';

/**
 * TRAVEL FEASIBILITY (Phase 8) — pure travel/interval feasibility.
 *
 * Routes are DATA handed in by the caller (travel.beforeMin / afterMin /
 * betweenMin, in minutes): this module NEVER calls a routing API, a DB, or
 * the clock. Identical inputs always produce identical outputs
 * (tests/travel-feasibility.test.js).
 *
 * It answers one question: given a proposed appointment inside an
 * 'available' segment (the Phase-3 seam that carries prevEventId /
 * nextEventId), can the therapist physically get there from the previous
 * appointment and onward to the next one?
 *
 * CENTRALISED INTERVAL RULE (both constraints use <=; equality passes):
 *   before:  prev.endMin + buffers.afterMin + travel.beforeMin
 *              <= proposed.startMin
 *   after:   proposed.endMin + travel.afterMin + buffers.beforeMin
 *              + arrivalMarginMinutes <= next.startMin
 *
 * Margins as reported:
 *   marginBeforeMin        proposed.startMin - (prev chain earliest)
 *   marginAfterMin         next.startMin - (proposed.endMin
 *                            + travel.afterMin + buffers.beforeMin)
 *                          — i.e. the RAW gap, arrival margin included
 *   remainingMarginMinutes min of the applicable slack values, where the
 *                          after-side slack nets out the arrival margin
 *                          (marginAfterMin - arrivalMarginMinutes). null
 *                          when neither neighbour constrains the slot
 *                          (unconstrained — deliberately not a fake large
 *                          number).
 *
 * Status ladder (checked in this order):
 *   not_applicable      telehealth with no physical bridge problem
 *   travel_infeasible   telehealth prev→next bridge cannot fit, or a
 *                       before/after constraint fails (remaining < 0)
 *   location_dependent  in-person proposal without a suburb — cannot assess
 *   travel_unknown      a required leg's travel time is null — manual review
 *   tight_fit           constraints pass but remaining < tightMarginMinutes
 *                       (remaining 0 IS a tight_fit, not a failure)
 *   travel_feasible     everything else, remaining >= tightMarginMinutes
 *                       (or unconstrained)
 *
 * A leg without a prev/next imposes no constraint and is narrated as
 * 'no_previous_route_constraint' / 'no_next_route_constraint'. On
 * infeasible results, practicalWindow may still be non-null: the proposal
 * as placed fails, but the clipped window shows where a fit could exist —
 * exactly what findFeasibleAlternative uses.
 */

// ── Configuration ────────────────────────────────────────────────────────────

/** Every travel threshold in one place (minutes). */
const TRAVEL_CONFIG = {
  // Safety margin the therapist must still have in hand when arriving
  // before the NEXT appointment (added inside the after-constraint).
  arrivalMarginMinutes: 10,
  // Constraints can pass with very little slack left; below this remaining
  // margin a feasible verdict is downgraded to tight_fit.
  tightMarginMinutes: 10,
};

// ── Shared helpers ───────────────────────────────────────────────────────────

const reason = (code, label) => ({ code, label });

const num = (v) => (Number.isFinite(v) ? v : null);

function normBuffers(buffers) {
  const b = buffers || {};
  return {
    beforeMin: Math.max(0, b.beforeMin || 0),
    afterMin: Math.max(0, b.afterMin || 0),
  };
}

function normSegment(segment) {
  const s = segment || {};
  return Number.isFinite(s.startMin) && Number.isFinite(s.endMin)
    ? { startMin: s.startMin, endMin: s.endMin }
    : { startMin: 0, endMin: 1440 };   // defensive: whole day
}

/** Earliest practical start given a previous appointment (interval rule). */
function earliestFromPrev(prev, afterBufMin, travelBeforeMin) {
  return prev.endMin + afterBufMin + travelBeforeMin;
}

/** Latest practical end given a next appointment (interval rule). */
function latestFromNext(next, beforeBufMin, travelAfterMin, arrivalMarginMin) {
  return next.startMin - travelAfterMin - beforeBufMin - arrivalMarginMin;
}

// ── Practical window ─────────────────────────────────────────────────────────

/**
 * Clip an available segment to what is PRACTICALLY reachable:
 *   start' = max(segment.startMin, prev ? prev.endMin + buffers.afterMin
 *                                         + (travel.beforeMin || 0)
 *                                       : segment.startMin)
 *   end'   = min(segment.endMin,  next ? next.startMin - (travel.afterMin || 0)
 *                                         - buffers.beforeMin
 *                                         - arrivalMarginMinutes
 *                                      : segment.endMin)
 * Unknown (null) travel legs clip optimistically as 0 here — the strict
 * null → travel_unknown verdict belongs to evaluateTravelFeasibility.
 * Returns {startMin, endMin} when the clip still holds durationMin,
 * else null.
 */
function practicalWindow(opts) {
  const o = opts || {};
  const cfg = o.config || TRAVEL_CONFIG;
  const segment = normSegment(o.segment);
  const buffers = normBuffers(o.buffers);
  const travel = o.travel || {};
  const durationMin = Number.isFinite(o.durationMin) ? o.durationMin : 0;
  const prev = o.prev || null;
  const next = o.next || null;

  const start = Math.max(segment.startMin, prev
    ? earliestFromPrev(prev, buffers.afterMin, num(travel.beforeMin) || 0)
    : segment.startMin);
  const end = Math.min(segment.endMin, next
    ? latestFromNext(next, buffers.beforeMin, num(travel.afterMin) || 0, cfg.arrivalMarginMinutes)
    : segment.endMin);
  return end - start >= durationMin ? { startMin: start, endMin: end } : null;
}

// ── Feasibility evaluation ───────────────────────────────────────────────────

/**
 * Evaluate ONE proposed appointment against its neighbours.
 *
 * opts:
 *   proposed     {startMin, durationMin, suburb} (suburb may be absent for
 *                telehealth; absent + in-person → location_dependent)
 *   segment      the 'available' segment holding the proposal
 *   prev         {endMin, suburb} | null — previous appointment
 *   next         {startMin, suburb} | null — next appointment
 *   buffers      {beforeMin=0, afterMin=0} scheduling buffers; afterMin is
 *                the buffer AFTER the previous appointment, beforeMin the
 *                buffer BEFORE the next one (mirrors the interval rule)
 *   travel       {beforeMin: number|null, afterMin: number|null,
 *                 betweenMin?: number} minutes; null (or absent) on a leg
 *                that exists = route unknown → travel_unknown
 *   isTelehealth default false
 *   config       optional TRAVEL_CONFIG override (tests)
 *
 * Returns { status, earliestStartMin, latestEndMin, practicalWindow,
 *           marginBeforeMin, marginAfterMin, remainingMarginMinutes,
 *           reasons:[{code,label}] } — see module header for semantics.
 *
 * Telehealth: travel to the CLIENT is irrelevant → 'not_applicable' with
 * 'telehealth_no_travel'. One documented exception: when prev and next
 * both exist with suburbs, the proposal sits between them, and
 * travel.betweenMin (prev→next direct travel) is provided, the therapist
 * must still bridge prev→next around the call:
 *   prev.endMin + buffers.afterMin + betweenMin + buffers.beforeMin
 *     + arrivalMarginMinutes > next.startMin  →  'travel_infeasible'
 *     with 'telehealth_bridge_infeasible'.
 */
function evaluateTravelFeasibility(opts) {
  const o = opts || {};
  const cfg = o.config || TRAVEL_CONFIG;
  const proposed = o.proposed || {};
  if (!Number.isFinite(proposed.startMin) || !Number.isFinite(proposed.durationMin) ||
      proposed.durationMin <= 0) {
    throw new Error('evaluateTravelFeasibility: proposed needs numeric startMin and durationMin > 0');
  }
  const segment = normSegment(o.segment);
  const buffers = normBuffers(o.buffers);
  const travel = o.travel || {};
  const prev = o.prev || null;
  const next = o.next || null;
  const proposedEnd = proposed.startMin + proposed.durationMin;
  const arrival = cfg.arrivalMarginMinutes;

  const result = {
    status: null,
    earliestStartMin: segment.startMin,
    latestEndMin: segment.endMin,
    practicalWindow: null,
    marginBeforeMin: null,
    marginAfterMin: null,
    remainingMarginMinutes: null,
    reasons: [],
  };

  // 1) Telehealth — no travel to the client; only the prev→next bridge can
  //    fail, and only when we were actually given that route.
  if (o.isTelehealth) {
    const betweenMin = num(travel.betweenMin);
    const bridged = prev && next && prev.suburb && next.suburb &&
      Number.isFinite(prev.endMin) && Number.isFinite(next.startMin) &&
      prev.endMin <= proposed.startMin && proposedEnd <= next.startMin;
    if (betweenMin !== null && bridged &&
        prev.endMin + buffers.afterMin + betweenMin + buffers.beforeMin + arrival > next.startMin) {
      result.status = 'travel_infeasible';
      result.reasons.push(reason('telehealth_bridge_infeasible',
        'Surrounding appointments leave no time to travel between them'));
      return result;
    }
    result.status = 'not_applicable';
    result.practicalWindow = practicalWindow({
      segment, prev: null, next: null, buffers, travel: {},
      durationMin: proposed.durationMin, config: cfg,
    });
    result.reasons.push(reason('telehealth_no_travel', 'Telehealth — no travel required'));
    return result;
  }

  // 2) In-person without a location — nothing to assess yet.
  if (!proposed.suburb) {
    result.status = 'location_dependent';
    result.reasons.push(reason('location_dependent',
      'Client location not provided — travel cannot be assessed'));
    return result;
  }

  // 3) Required legs with unknown routes → manual review, no numbers
  //    asserted. A leg only exists where a neighbour exists.
  const travelBefore = prev ? num(travel.beforeMin) : 0;
  const travelAfter = next ? num(travel.afterMin) : 0;
  if ((prev && travelBefore === null) || (next && travelAfter === null)) {
    result.status = 'travel_unknown';
    result.reasons.push(reason('travel_unknown',
      'Travel time could not be confirmed — manual review required'));
    return result;
  }

  // 4) Practical bounds (clamped to the segment) + margins.
  result.earliestStartMin = Math.max(segment.startMin,
    prev ? earliestFromPrev(prev, buffers.afterMin, travelBefore) : segment.startMin);
  result.latestEndMin = Math.min(segment.endMin,
    next ? latestFromNext(next, buffers.beforeMin, travelAfter, arrival) : segment.endMin);
  result.practicalWindow = practicalWindow({
    segment, prev, next, buffers, travel,
    durationMin: proposed.durationMin, config: cfg,
  });

  const marginBefore = prev
    ? proposed.startMin - earliestFromPrev(prev, buffers.afterMin, travelBefore)
    : null;
  const marginAfter = next
    ? next.startMin - (proposedEnd + travelAfter + buffers.beforeMin)
    : null;
  result.marginBeforeMin = marginBefore;
  result.marginAfterMin = marginAfter;

  // Slack per side: the after side nets out the required arrival margin,
  // so slack 0 means "arrives with exactly the safety margin".
  const slackBefore = marginBefore;
  const slackAfter = marginAfter === null ? null : marginAfter - arrival;
  const applicable = [slackBefore, slackAfter].filter((v) => v !== null);
  const remaining = applicable.length > 0 ? Math.min.apply(null, applicable) : null;
  result.remainingMarginMinutes = remaining;

  // 5) Verdict. Equality passes (<=): slack < 0 is the only failure.
  const beforeFails = slackBefore !== null && slackBefore < 0;
  const afterFails = slackAfter !== null && slackAfter < 0;
  if (beforeFails || afterFails) {
    result.status = 'travel_infeasible';
    if (beforeFails) {
      result.reasons.push(reason('travel_infeasible_prev',
        'Cannot arrive from the previous appointment in time'));
    }
    if (afterFails) {
      result.reasons.push(reason('travel_infeasible_next',
        'Would not reach the next appointment in time'));
    }
    return result;
  }

  if (!prev) result.reasons.push(reason('no_previous_route_constraint', 'No earlier appointment constrains this slot'));
  if (!next) result.reasons.push(reason('no_next_route_constraint', 'No later appointment constrains this slot'));

  if (remaining !== null && remaining < cfg.tightMarginMinutes) {
    result.status = 'tight_fit';
    result.reasons.push(reason('travel_tight', `Only ${remaining} min travel margin remains`));
    return result;
  }

  result.status = 'travel_feasible';
  if (prev) {
    result.reasons.push(reason('travel_before_good',
      `~${Math.round(travelBefore)} min from previous appointment`));
  }
  if (next) {
    result.reasons.push(reason('travel_after_good',
      `~${Math.round(travelAfter)} min to next appointment`));
    result.reasons.push(reason('travel_margin_good',
      `${remaining} min schedule margin remains`));
  }
  return result;
}

// ── Alternative finder ───────────────────────────────────────────────────────

/**
 * Snap a suggested start to 5-minute granularity, preferring the side
 * toward the requested time; falls back to the far side, then the raw
 * minute — whichever stays a valid start within [lo, hi]. (Same rule as
 * availability-engine's private snapStart — duplicated because it is not
 * exported there and these four files must stand alone.)
 */
function snapStart(s, lo, hi, reqStart) {
  if (s % 5 === 0) return s;
  const down = s - (s % 5);
  const up = down + 5;
  const toward = s > reqStart ? down : up;
  const away = s > reqStart ? up : down;
  if (toward >= lo && toward <= hi) return toward;
  if (away >= lo && away <= hi) return away;
  return s;
}

/**
 * Find the feasible start NEAREST to the proposed start across the day's
 * available segments.
 *
 * opts:
 *   segmentsCtx  [{segment, prev, next, travel}] — one entry per
 *                'available' segment, with that segment's own neighbour
 *                and travel context precomputed by the caller
 *   proposed     {startMin, durationMin}
 *   buffers      {beforeMin, afterMin}
 *   durationMin  overrides proposed.durationMin when given
 *   config       optional TRAVEL_CONFIG override
 *
 * Per segment: practicalWindow → clamp the proposed start into
 * [window.start, window.end - duration] → snap to 5-minute granularity.
 * Winner: smallest |start - proposed.startMin|; ties go to the EARLIER
 * start (deterministic). Returns {startMin, endMin} or null when no
 * segment can hold the duration.
 */
function findFeasibleAlternative(opts) {
  const o = opts || {};
  const proposed = o.proposed || {};
  const durationMin = Number.isFinite(o.durationMin) ? o.durationMin : proposed.durationMin;
  if (!Number.isFinite(proposed.startMin) || !Number.isFinite(durationMin) || durationMin <= 0) {
    throw new Error('findFeasibleAlternative: proposed needs numeric startMin and durationMin > 0');
  }
  const list = Array.isArray(o.segmentsCtx) ? o.segmentsCtx : [];
  let best = null;
  for (const ctx of list) {
    if (!ctx || !ctx.segment) continue;
    const pw = practicalWindow({
      segment: ctx.segment,
      prev: ctx.prev || null,
      next: ctx.next || null,
      buffers: o.buffers,
      travel: ctx.travel || {},
      durationMin,
      config: o.config,
    });
    if (!pw) continue;
    const lo = pw.startMin;
    const hi = pw.endMin - durationMin;
    const s = snapStart(Math.min(Math.max(proposed.startMin, lo), hi), lo, hi, proposed.startMin);
    const delta = Math.abs(s - proposed.startMin);
    if (!best || delta < best.delta || (delta === best.delta && s < best.startMin)) {
      best = { startMin: s, delta };
    }
  }
  return best ? { startMin: best.startMin, endMin: best.startMin + durationMin } : null;
}

module.exports = {
  TRAVEL_CONFIG,
  evaluateTravelFeasibility,
  practicalWindow,
  findFeasibleAlternative,
};
