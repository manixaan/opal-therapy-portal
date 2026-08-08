'use strict';

/**
 * CANDIDATE SCORER (Phase 7) — deterministic, explainable candidate scoring.
 *
 * Pure functions only: no AI, no DB, no network, no clock. Identical inputs
 * always produce identical outputs (tests/candidate-scorer.test.js).
 *
 * Model: Phase 3 (availability-engine) decides WHO CAN take a slot;
 * this module decides, among those who can, WHO FITS BEST — and says why.
 *
 *   - A therapist whose classifyCandidate verdict is anything other than
 *     'available' is EXCLUDED here: no tier, no score, ever. Scoring never
 *     overrides availability.
 *   - internalScore is for sorting and debugging ONLY. The user-facing
 *     surface is fitTier ('best'/'good'/'possible'/'poor') plus plain-
 *     English reasons. No percentages are ever exposed.
 *   - Every reason in `reasons` corresponds to a factor that actually
 *     applied (and vice versa for the bonus factors) — explanations are
 *     built at the moment each factor is scored, never re-derived.
 *   - Geography is privacy-first suburb/centroid work (see geo.js): the
 *     scorer receives points, it never geocodes. Unknown geography is
 *     NEUTRAL — zero bonus AND zero penalty. Not knowing where someone
 *     works today must never rank them below a known-far therapist's
 *     competitor; it simply contributes nothing.
 *   - Telehealth zeroes geography entirely ('not_applicable').
 */

// ── Configuration ────────────────────────────────────────────────────────────

/**
 * Every weight and threshold in one place. Units are score points unless
 * stated otherwise. Scores are relative — only ordering and the tier
 * thresholds below give them meaning.
 */
const CONFIG = {
  WEIGHTS: {
    sameSuburb: 40,       // bonus: already servicing the client's suburb today
    nearFootprintKm: 15,  // km radius counted as 'near' the day's footprint
    near: 25,             // bonus: nearest day-point within nearFootprintKm
    farPenaltyPerKm: 0.5, // penalty per km beyond nearFootprintKm (capped)
    maxFarPenalty: 30,    // cap on the far penalty (Broome ≠ minus infinity)
    comfort: 10,          // bonus: available window >= 2x requested duration
    capacityPerHour: 4,   // bonus per remaining available hour today
    maxCapacity: 12,      // cap on the capacity bonus (3h already maxes it)
    continuity: 30,       // bonus: this is the client's existing therapist
  },
  // internalScore >= best → 'best'; >= good → 'good'; >= possible →
  // 'possible'; below → 'poor'. Boundaries are inclusive.
  TIERS: { best: 55, good: 30, possible: 10 },
};

// ── Geometry ─────────────────────────────────────────────────────────────────

const EARTH_RADIUS_KM = 6371;

/**
 * Great-circle distance in km between two {lat, lng} points (haversine).
 * Returns null when either point is missing or has non-finite coordinates.
 * (The frontend has its own copy; the backend must not reach into it.)
 */
function haversineKm(a, b) {
  if (!a || !b ||
      !Number.isFinite(a.lat) || !Number.isFinite(a.lng) ||
      !Number.isFinite(b.lat) || !Number.isFinite(b.lng)) return null;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const sinLat = Math.sin(toRad(b.lat - a.lat) / 2);
  const sinLng = Math.sin(toRad(b.lng - a.lng) / 2);
  const h = sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(Math.min(1, h)));
}

// ── Formatting ───────────────────────────────────────────────────────────────

/** '45m' / '2h' / '2h 30m' label for a minutes duration. */
function fmtDur(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

const reason = (code, label) => ({ code, label });

// ── Geography factor ─────────────────────────────────────────────────────────

const normSuburb = (s) => String(s || '').trim().toLowerCase();

/**
 * One geography verdict: { state, delta, reasons }.
 *
 * Precedence:
 *   telehealth            → 'not_applicable', zero contribution
 *   clientPoint null      → 'unknown', zero contribution ('Location not provided')
 *   dayPoints empty       → 'unknown', zero contribution ('No existing
 *                           geographic activity today')
 *   suburb string match   → 'same_suburb' (+sameSuburb); case-insensitive
 *                           against ANY day point; duplicate points can
 *                           never double the bonus (single match test)
 *   nearest distance d    → d <= nearFootprintKm: 'near' (+near)
 *                           else 'far' (-min(maxFarPenalty,
 *                                       (d - nearFootprintKm) * farPenaltyPerKm))
 *   distance uncomputable → 'unknown', zero contribution (coordinates
 *                           missing on the client or on every day point)
 *
 * Unknown is NEUTRAL by mandate: zero penalty AND zero bonus.
 */
function evaluateGeography({ clientPoint, dayPoints, isTelehealth }) {
  const W = CONFIG.WEIGHTS;
  if (isTelehealth) {
    return {
      state: 'not_applicable', delta: 0,
      reasons: [reason('telehealth_geography_na', 'Telehealth — location not a factor')],
    };
  }
  if (!clientPoint) {
    return {
      state: 'unknown', delta: 0,
      reasons: [reason('geography_unknown', 'Location not provided')],
    };
  }
  const points = (Array.isArray(dayPoints) ? dayPoints : []).filter((p) => p);
  if (points.length === 0) {
    return {
      state: 'unknown', delta: 0,
      reasons: [reason('geography_unknown', 'No existing geographic activity today')],
    };
  }

  // Same suburb: pure string comparison — works even without coordinates.
  const clientSub = normSuburb(clientPoint.suburb);
  if (clientSub && points.some((p) => normSuburb(p.suburb) === clientSub)) {
    return {
      state: 'same_suburb', delta: W.sameSuburb,
      reasons: [reason('same_suburb', `Already servicing ${String(clientPoint.suburb).trim()} today`)],
    };
  }

  // Nearest day point by great-circle distance.
  let d = null;
  for (const p of points) {
    const km = haversineKm(clientPoint, p);
    if (km !== null && (d === null || km < d)) d = km;
  }
  if (d === null) {
    // No computable distance (missing coordinates) → neutral, never a penalty.
    const label = Number.isFinite(clientPoint.lat) && Number.isFinite(clientPoint.lng)
      ? 'No existing geographic activity today'
      : 'Location not provided';
    return { state: 'unknown', delta: 0, reasons: [reason('geography_unknown', label)] };
  }

  const km = Math.round(d);
  if (d <= W.nearFootprintKm) {
    const where = clientPoint.suburb ? String(clientPoint.suburb).trim() : 'the requested location';
    return {
      state: 'near', delta: W.near,
      reasons: [reason('near_footprint', `Already working near ${where} (~${km} km)`)],
    };
  }
  const penalty = Math.min(W.maxFarPenalty, (d - W.nearFootprintKm) * W.farPenaltyPerKm);
  return {
    state: 'far', delta: -penalty,
    reasons: [reason('far_from_footprint', `Today's appointments are ~${km} km away`)],
  };
}

// ── Scoring ──────────────────────────────────────────────────────────────────

/**
 * Score ONE therapist for ONE request.
 *
 * opts:
 *   availability       route-level day result (availability-engine output +
 *                      identity: therapistProfileId, displayName, roleTitle,
 *                      colour, availabilityConfidence, workingHoursSource,
 *                      capacity)
 *   matched            classifyCandidate output for the requested slot
 *   clientPoint        {lat, lng, suburb} | null (null = location unknown)
 *   dayPoints          [{suburb, lat, lng}] therapist's mapped points today
 *   isTelehealth       true → geography contributes NOTHING
 *   currentTherapistId profile id of the client's existing therapist | null
 *   durationMin        requested duration (also accepted as
 *                      matched.durationMin or request.durationMin)
 *   requestStartMin    requested start minute (also accepted as
 *                      request.startMin) — used only for suggestedSlot
 *
 * Returns a candidate:
 *   { therapistProfileId, displayName, roleTitle, colour,
 *     availabilityConfidence, workingHoursSource,
 *     status: 'candidate' | 'excluded', excludedReason?,
 *     fitTier: 'best'|'good'|'possible'|'poor'|null,
 *     internalScore (sorting/debug only; null when excluded),
 *     suggestedSlot: {startMin, endMin} | null,
 *     window: {startMin, endMin} | null, windowMin,
 *     reasons: [{code, label}],
 *     geographyState: 'same_suburb'|'near'|'far'|'unknown'|'not_applicable'|null }
 *
 * HARD RULE: matched.status !== 'available' → status 'excluded' with
 * excludedReason = matched.reason. Excluded candidates receive NO tier, NO
 * score, NO reasons — nothing here can rescue an unavailable therapist
 * (continuity included).
 */
function scoreCandidate(opts) {
  const o = opts || {};
  const availability = o.availability || {};
  const matched = o.matched || {};
  const W = CONFIG.WEIGHTS;

  const pick = (key) => {
    if (availability[key] !== undefined) return availability[key];
    if (matched[key] !== undefined) return matched[key];
    return null;
  };
  const base = {
    therapistProfileId: pick('therapistProfileId'),
    displayName: pick('displayName'),
    roleTitle: pick('roleTitle'),
    colour: pick('colour'),
    availabilityConfidence: pick('availabilityConfidence'),
    workingHoursSource: pick('workingHoursSource'),
  };

  // Hard exclusion — availability always wins over scoring.
  if (matched.status !== 'available') {
    return Object.assign(base, {
      status: 'excluded',
      excludedReason: matched.reason !== undefined ? matched.reason : null,
      fitTier: null,
      internalScore: null,
      suggestedSlot: null,
      window: null,
      windowMin: null,
      reasons: [],
      geographyState: null,
    });
  }

  const request = o.request || {};
  const durationMin = Number.isFinite(o.durationMin) ? o.durationMin
    : Number.isFinite(request.durationMin) ? request.durationMin
      : Number.isFinite(matched.durationMin) ? matched.durationMin : null;
  const requestStartMin = Number.isFinite(o.requestStartMin) ? o.requestStartMin
    : Number.isFinite(request.startMin) ? request.startMin : null;

  const window = matched.window
    ? { startMin: matched.window.startMin, endMin: matched.window.endMin }
    : null;
  const windowMin = Number.isFinite(matched.windowMin) ? matched.windowMin
    : (window ? window.endMin - window.startMin : null);

  let score = 0;
  const reasons = [];

  // 1) Geography (zeroed for telehealth; neutral when unknown).
  const geo = evaluateGeography({
    clientPoint: o.clientPoint || null,
    dayPoints: o.dayPoints,
    isTelehealth: Boolean(o.isTelehealth),
  });
  score += geo.delta;
  for (const r of geo.reasons) reasons.push(r);

  // 2) Availability comfort: window at least twice the requested duration.
  if (durationMin !== null && windowMin !== null && windowMin >= 2 * durationMin) {
    score += W.comfort;
    reasons.push(reason('comfortable_fit', 'Appointment fits with room around it'));
  }

  // 3) Remaining capacity today (capped). The reason only appears from 2h
  //    up — small remainders still score but aren't worth narrating.
  const availableMin = availability.capacity && Number.isFinite(availability.capacity.availableMin)
    ? availability.capacity.availableMin : 0;
  score += Math.min(W.maxCapacity, (availableMin / 60) * W.capacityPerHour);
  if (availableMin >= 120) {
    reasons.push(reason('capacity', `${fmtDur(availableMin)} available capacity remains`));
  }

  // 4) Continuity of care.
  if (o.currentTherapistId !== null && o.currentTherapistId !== undefined &&
      o.currentTherapistId === base.therapistProfileId) {
    score += W.continuity;
    reasons.push(reason('continuity', 'Existing therapist relationship'));
  }

  // 5) Provenance flag — informational only, never moves the score.
  if (base.availabilityConfidence === 'default') {
    reasons.push(reason('default_hours', 'Availability based on organisation default hours'));
  }

  // The requested slot itself is the suggestion when it fits (it does — the
  // therapist is 'available' — but requestedSlotFits is still the gate).
  const suggestedSlot = matched.requestedSlotFits &&
    requestStartMin !== null && durationMin !== null
    ? { startMin: requestStartMin, endMin: requestStartMin + durationMin }
    : null;

  return Object.assign(base, {
    status: 'candidate',
    fitTier: assignTier(score),
    internalScore: score,
    suggestedSlot,
    window,
    windowMin,
    reasons,
    geographyState: geo.state,
  });
}

// ── Tiers & ranking ──────────────────────────────────────────────────────────

/** Map an internal score onto a tier. Boundaries are inclusive (>=). */
function assignTier(score) {
  const T = CONFIG.TIERS;
  if (score >= T.best) return 'best';
  if (score >= T.good) return 'good';
  if (score >= T.possible) return 'possible';
  return 'poor';
}

const scoreOf = (c) => (c && Number.isFinite(c.internalScore) ? c.internalScore : 0);

function windowMinOf(c) {
  if (c && Number.isFinite(c.windowMin)) return c.windowMin;
  if (c && c.window && Number.isFinite(c.window.startMin) && Number.isFinite(c.window.endMin)) {
    return c.window.endMin - c.window.startMin;
  }
  return 0;
}

/**
 * Rank scored candidates. Excluded entries are dropped (they carry no
 * score by design). Tie-breakers, in order, all deterministic:
 *   1. internalScore desc (better fit first)
 *   2. windowMin desc (roomier window first)
 *   3. displayName asc (alphabetical — stable, human-predictable)
 * Array.prototype.sort is stable in Node, so fully-equal entries keep
 * their input order. Never mutates the input array.
 */
function rankCandidates(list) {
  return (Array.isArray(list) ? list : [])
    .filter((c) => c && c.status === 'candidate')
    .sort((a, b) => {
      const scoreDiff = scoreOf(b) - scoreOf(a);
      if (scoreDiff !== 0) return scoreDiff;
      const winDiff = windowMinOf(b) - windowMinOf(a);
      if (winDiff !== 0) return winDiff;
      const an = a.displayName ? String(a.displayName) : '';
      const bn = b.displayName ? String(b.displayName) : '';
      return an < bn ? -1 : (an > bn ? 1 : 0);
    });
}

module.exports = {
  CONFIG,
  haversineKm,
  scoreCandidate,
  assignTier,
  rankCandidates,
};
