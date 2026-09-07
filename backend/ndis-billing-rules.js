'use strict';

/**
 * NDIS BILLING RULES — Occupational Therapy
 *
 * Pure functions that turn a calendar event into NDIS-compliant claim lines
 * and validate an agreed rate against the price limit. No DB, no network.
 *
 * Division of labour with the existing accounting module:
 *   • `finance_pricing_rules` (owner-managed) still says what the practice
 *     CHARGES. `pricing-engine.js` still selects that rate.
 *   • THIS module says what the NDIS ALLOWS: which line item, the ceiling for
 *     that item on that date in that MMM zone, the travel cap, whether a
 *     cancellation is short-notice, how a group divides. It emits warnings
 *     rather than silently changing amounts — every deviation is a finding
 *     for the owner to review.
 *
 * Fail-closed: an unresolved question yields `null` / a `blocked` warning,
 * never a guessed figure.
 */

const G = require('./ndis/ot-price-guide');

const MS_PER_DAY = 86400000;

// ── Helpers ────────────────────────────────────────────────────────────────
// Half-up to cents with a float guard so 271.59 × 0.5 = 135.795 → 135.80 (published figure).
function round2(n) { return Math.round(n * 100 + 1e-9) / 100; }

function isoDate(d) {
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return null;
  return x.toISOString().slice(0, 10);
}

/** Financial-year key for a service date, or null when out of range. */
function financialYearFor(date) {
  const d = isoDate(date);
  if (!d) return null;
  const fy = G.FINANCIAL_YEARS.find(f => d >= f.from && d <= f.to);
  return fy ? fy.key : null;
}

/** p.16 — partial units are claimed pro rata by time. */
function hoursFromMinutes(minutes) {
  if (!(minutes > 0)) return 0;
  return round2(minutes / 60);
}

/** Amount for `minutes` at an hourly rate, rounded to cents (matches PAPL table p.16). */
function amountForMinutes(minutes, hourlyRate) {
  if (!(minutes > 0) || !(hourlyRate >= 0)) return 0;
  return round2((hourlyRate * minutes) / 60);
}

function mmmZone(mmm) {
  const z = G.MMM_ZONES[Number(mmm)];
  return z || null;
}

function priceBandForMmm(mmm) {
  const z = mmmZone(mmm);
  if (!z) return null;
  if (z.zone === 'remote') return 'remote';
  if (z.zone === 'very_remote') return 'veryRemote';
  return 'national';
}

// ── Item resolution ────────────────────────────────────────────────────────
/**
 * Pick the support item for a service.
 * @param {object} q
 * @param {string} q.profession  occupational_therapist | therapy_assistant_1 | therapy_assistant_2
 * @param {number} [q.participantAge]   years at date of service
 * @param {string} [q.ageBand]          '9_plus' | 'under_9' (overrides age)
 * @param {string} [q.budget]           capacity_building (default) | core | employment
 */
function resolveSupportItem(q) {
  const ageBand = q.ageBand || (q.participantAge != null ? (q.participantAge < 9 ? 'under_9' : '9_plus') : null);
  if (!q.profession || !ageBand) return null;
  const budget = q.budget === 'employment' ? 'capacity_building' : (q.budget || 'capacity_building');
  const category = q.budget === 'employment' ? '10' : null;
  return G.SUPPORT_ITEMS.find(i =>
    i.profession === q.profession &&
    i.ageBand === ageBand &&
    i.budget === budget &&
    (category ? i.supportCategory === category : i.supportCategory !== '10')
  ) || null;
}

/**
 * Price limit for an item / claim type / MMM / date.
 * Returns { itemCode, claimCode, claimType, fy, band, limit } or null.
 */
function resolvePriceLimit({ itemCode, claimType = 'direct', mmm = 1, date }) {
  const item = G.SUPPORT_ITEMS.find(i => i.code === itemCode);
  const ct = G.CLAIM_TYPES[claimType];
  if (!item || !ct) return null;
  if (!item.claimable.includes(claimType)) return null;
  const fy = financialYearFor(date);
  if (!fy) return null;
  const band = priceBandForMmm(mmm);
  if (!band) return null;
  const p = item.prices[fy];
  if (!p || p[band] == null) return null;
  const limit = round2(p[band] * ct.rateFactor);
  return { itemCode: item.code, claimCode: `${item.code}${ct.suffix}`, claimType, fy, band, limit, item };
}

// ── Business-day arithmetic (cancellations) ────────────────────────────────
function isBusinessDay(d, holidays) {
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !holidays.has(d.toISOString().slice(0, 10));
}

/**
 * Walk back `n` business days from `start`, keeping the time of day.
 * Matches the PAPL example (p.27): 10am Tuesday after a Monday public
 * holiday → deadline 10am the previous Thursday.
 */
function subtractBusinessDays(start, n, holidays) {
  const d = new Date(start.getTime());
  let remaining = n;
  while (remaining > 0) {
    d.setTime(d.getTime() - MS_PER_DAY);
    if (isBusinessDay(d, holidays)) remaining -= 1;
  }
  return d;
}

/**
 * p.26-27 — Short Notice Cancellation, 2 clear business days.
 * @param {object} q
 * @param {string|Date} q.scheduledStart
 * @param {string|Date} [q.cancelledAt]  omit for a no-show
 * @param {boolean} [q.noShow]
 * @param {string[]} [q.publicHolidays] ISO dates
 * @param {boolean} [q.serviceAgreementAllowsCancellationFee]
 * @param {boolean} [q.alternativeBillableWorkFound]
 */
function assessCancellation(q) {
  const warnings = [];
  const start = new Date(q.scheduledStart);
  if (Number.isNaN(start.getTime())) return { claimable: false, shortNotice: false, warnings: ['invalid_scheduled_start'] };
  const holidays = new Set(q.publicHolidays || []);
  if (!q.publicHolidays) warnings.push('public_holidays_not_supplied');

  const deadline = subtractBusinessDays(start, G.CLAIMING_RULES.cancellation.noticeBusinessDays, holidays);
  let shortNotice;
  if (q.noShow || q.cancelledAt == null) {
    shortNotice = true;
  } else {
    const c = new Date(q.cancelledAt);
    if (Number.isNaN(c.getTime())) return { claimable: false, shortNotice: false, warnings: ['invalid_cancelled_at'] };
    shortNotice = c.getTime() > deadline.getTime();
  }

  if (!shortNotice) return { claimable: false, shortNotice: false, deadline: deadline.toISOString(), warnings, reason: 'sufficient_notice' };

  let claimable = true;
  if (q.serviceAgreementAllowsCancellationFee !== true) { claimable = false; warnings.push('service_agreement_cancellation_term_not_confirmed'); }
  if (q.alternativeBillableWorkFound === true) { claimable = false; warnings.push('alternative_billable_work_found'); }
  return { claimable, shortNotice: true, deadline: deadline.toISOString(), maxFraction: G.CLAIMING_RULES.cancellation.maxClaimFraction, warnings };
}

// ── Travel ─────────────────────────────────────────────────────────────────
/**
 * p.21-25 — Provider travel (labour + non-labour) for one participant.
 * @param {object} q
 * @param {string} q.itemCode          primary support item
 * @param {number} q.mmm               participant location MMM
 * @param {string|Date} q.date
 * @param {number} [q.minutesTo]       travel to participant
 * @param {number} [q.minutesReturn]   return to usual place of work (only if worker is paid for it)
 * @param {number} [q.participantsOnTrip=1]  apportionment divisor (agreed in advance)
 * @param {number} [q.kilometres]
 * @param {number} [q.perKmRate]       agreed; guide max 0.99
 * @param {number} [q.otherCosts]      tolls, parking at cost
 * @param {number} [q.agreedHourlyRate] for the travel line; defaults to the travel limit
 * @param {boolean} [q.primarySupportFaceToFace=true]
 * @param {boolean} [q.agreedInAdvance]
 */
function computeTravel(q) {
  const warnings = [];
  const lim = resolvePriceLimit({ itemCode: q.itemCode, claimType: 'travel', mmm: q.mmm, date: q.date });
  if (!lim) return { lines: [], warnings: ['travel_limit_unresolved'], blocked: true };
  if (q.primarySupportFaceToFace === false) return { lines: [], warnings: ['travel_requires_face_to_face_primary_support'], blocked: true };
  if (q.agreedInAdvance !== true) warnings.push('travel_agreement_not_confirmed');

  const zone = mmmZone(q.mmm);
  const cap = zone.travelTimeCapMinutes; // null = no cap (MMM6-7)
  const divisor = Math.max(1, Number(q.participantsOnTrip) || 1);

  const capMinutes = (m) => {
    const v = Math.max(0, Number(m) || 0);
    if (cap == null) return v;
    if (v > cap) warnings.push('travel_minutes_capped');
    return Math.min(v, cap);
  };
  const to = capMinutes(q.minutesTo);
  const ret = capMinutes(q.minutesReturn);
  const totalMinutes = round2((to + ret) / divisor);

  const rate = q.agreedHourlyRate != null ? Number(q.agreedHourlyRate) : lim.limit;
  if (rate > lim.limit) warnings.push('travel_rate_above_limit');

  const lines = [];
  if (totalMinutes > 0) {
    lines.push({
      kind: 'travel_labour',
      itemCode: lim.claimCode,
      portalOption: G.CLAIM_TYPES.travel.portalOption,
      minutes: totalMinutes,
      quantityHours: hoursFromMinutes(totalMinutes),
      unitAmount: rate,
      priceLimit: lim.limit,
      amount: amountForMinutes(totalMinutes, rate),
    });
  }

  const km = Math.max(0, Number(q.kilometres) || 0);
  const perKm = q.perKmRate != null ? Number(q.perKmRate) : 0;
  if (km > 0 && perKm > G.CLAIMING_RULES.travel.nonLabour.vehiclePerKmGuide) warnings.push('per_km_rate_above_guide');
  const nonLabour = round2((km * perKm + (Number(q.otherCosts) || 0)) / divisor);
  if (nonLabour > 0) {
    const nlItem = lim.item.nonLabourTravelItem;
    if (!nlItem) warnings.push('non_labour_travel_item_missing');
    lines.push({
      kind: 'travel_non_labour',
      itemCode: nlItem || null,
      quantity: nonLabour,   // $1 notional unit → quantity is the dollar amount
      unitAmount: 1.0,
      amount: nonLabour,
    });
  }
  return { lines, warnings, blocked: false, capMinutes: cap, divisor };
}

// ── Day travel pooling (multi-client runs) ─────────────────────────────────
/**
 * PAPL p.25 method for a therapist's day: pool every leg (to the first
 * client, between clients, and the return if paid), divide by the number of
 * clients seen, then let computeTravel apply the per-participant cap.
 *
 * @param {object} q
 * @param {Array}  q.sessions  time-ordered: [{ eventId, legMinutes, legKm, billable }]
 *                             legMinutes/legKm = the leg ARRIVING at that session
 * @param {number} [q.returnMinutes]  last client → usual place of work
 * @param {number} [q.returnKm]
 * @param {boolean} [q.returnPaid=true]  worker is paid for the return leg
 * @returns { shares: {eventId → {minutes, km}}, pooledMinutes, pooledKm, divisor, warnings }
 */
function planDayTravel(q) {
  const warnings = [];
  const sessions = Array.isArray(q.sessions) ? q.sessions : [];
  const billable = sessions.filter(s => s.billable !== false);
  const shares = {};
  if (!billable.length) return { shares, pooledMinutes: 0, pooledKm: 0, divisor: 0, warnings: ['no_billable_sessions'] };

  let minutes = 0, km = 0;
  sessions.forEach((s, i) => {
    // A leg that arrives at a non-billable session (cancelled, admin) still
    // had to be driven; it is only claimable if the NEXT billable session
    // absorbs it. Keep it in the pool and flag it for review.
    const m = Math.max(0, Number(s.legMinutes) || 0);
    const k = Math.max(0, Number(s.legKm) || 0);
    if (s.billable === false && (m > 0 || k > 0)) warnings.push('leg_to_non_billable_session_pooled');
    minutes += m; km += k;
  });
  if (q.returnPaid !== false) {
    minutes += Math.max(0, Number(q.returnMinutes) || 0);
    km += Math.max(0, Number(q.returnKm) || 0);
  } else if ((Number(q.returnMinutes) || 0) > 0) {
    warnings.push('return_leg_unpaid_not_claimed');
  }
  const divisor = billable.length;
  const shareMin = round2(minutes / divisor);
  const shareKm = round2(km / divisor);
  billable.forEach(s => { shares[s.eventId] = { minutes: shareMin, km: shareKm }; });
  return { shares, pooledMinutes: minutes, pooledKm: round2(km), divisor, warnings };
}

// ── Group ──────────────────────────────────────────────────────────────────
/** p.32 — per-participant limit is the item limit divided by group size. */
function groupPerParticipantLimit(limit, groupSize, item) {
  const n = Math.max(1, Number(groupSize) || 1);
  if (item && item.groupPricing === 'per_participant_flat') return round2(limit);
  return round2(limit / n);
}

// ── Main: event → claim ────────────────────────────────────────────────────
/**
 * Build the claim for one calendar event.
 * @param {object} ev
 * @param {string} ev.id
 * @param {string|Date} ev.start
 * @param {string|Date} ev.end
 * @param {string} ev.status         completed | cancelled | no_show | scheduled
 * @param {string} ev.deliveryMode   in_person | telehealth | non_f2f | ndia_report
 * @param {string} ev.profession
 * @param {number} [ev.participantAge]
 * @param {string} [ev.ageBand]
 * @param {string} [ev.budget]       capacity_building | core | employment
 * @param {number} [ev.mmm=1]        participant MMM (provider MMM for TH/NF/RR)
 * @param {number} [ev.providerMmm]
 * @param {string} [ev.fundingType]  ndia_managed | plan_managed | self_managed
 * @param {number} [ev.groupSize=1]
 * @param {number} [ev.agreedHourlyRate]  from finance_pricing_rules
 * @param {object} [ev.agreement]    { telehealth, nonF2f, ndiaReports, cancellations, travel }
 * @param {object} [ev.cancellation] { cancelledAt, publicHolidays, alternativeBillableWorkFound }
 * @param {object} [ev.travel]       passthrough to computeTravel
 */
function buildClaim(ev) {
  const warnings = [];
  const agreement = ev.agreement || {};
  const start = new Date(ev.start);
  const end = new Date(ev.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return { status: 'blocked', lines: [], warnings: ['invalid_event_times'] };
  }
  const minutes = Math.round((end - start) / 60000);
  const date = isoDate(start);

  const item = resolveSupportItem(ev);
  if (!item) return { status: 'blocked', lines: [], warnings: ['support_item_unresolved'] };

  const status = String(ev.status || '').toLowerCase();
  const isCancelled = status === 'cancelled' || status === 'no_show';

  // Claim type
  let claimType = 'direct';
  const mode = String(ev.deliveryMode || 'in_person');
  if (mode === 'telehealth') { claimType = 'telehealth'; if (agreement.telehealth !== true) warnings.push('telehealth_agreement_not_confirmed'); }
  else if (mode === 'non_f2f') { claimType = 'non_f2f'; if (agreement.nonF2f !== true) warnings.push('non_f2f_agreement_not_confirmed'); }
  else if (mode === 'ndia_report') { claimType = 'ndia_report'; if (agreement.ndiaReports !== true) warnings.push('ndia_report_agreement_not_confirmed'); if (ev.ndiaRequested !== true) warnings.push('ndia_report_request_not_confirmed'); }
  if (isCancelled) claimType = 'cancellation';

  // Which location sets the limit (p.32)
  const locationMmm = (claimType === 'direct' || claimType === 'cancellation')
    ? (ev.mmm ?? 1)
    : (ev.providerMmm ?? ev.mmm ?? 1);

  const lim = resolvePriceLimit({ itemCode: item.code, claimType, mmm: locationMmm, date });
  if (!lim) return { status: 'blocked', lines: [], warnings: [...warnings, 'price_limit_unresolved'] };

  if (ev.fundingType === 'self_managed') warnings.push('self_managed_limits_not_binding');
  if (String(ev.fundingType || '') === 'ndia_managed' && ev.providerRegistered === false) {
    return { status: 'blocked', lines: [], warnings: [...warnings, 'agency_managed_requires_registered_provider'] };
  }

  // Cancellation gate
  let cancellationAssessment = null;
  if (isCancelled) {
    cancellationAssessment = assessCancellation({
      scheduledStart: ev.start,
      cancelledAt: ev.cancellation && ev.cancellation.cancelledAt,
      noShow: status === 'no_show',
      publicHolidays: ev.cancellation && ev.cancellation.publicHolidays,
      serviceAgreementAllowsCancellationFee: agreement.cancellations === true,
      alternativeBillableWorkFound: ev.cancellation && ev.cancellation.alternativeBillableWorkFound,
    });
    warnings.push(...cancellationAssessment.warnings);
    if (!cancellationAssessment.claimable) {
      return { status: 'not_claimable', lines: [], warnings, item: item.code, cancellation: cancellationAssessment };
    }
  }

  // Group division
  const groupSize = Math.max(1, Number(ev.groupSize) || 1);
  const perParticipantLimit = groupPerParticipantLimit(lim.limit, groupSize, item);

  // Rate: agreed if given, else the limit. Never silently clamp — warn.
  const rate = ev.agreedHourlyRate != null ? Number(ev.agreedHourlyRate) : perParticipantLimit;
  if (ev.agreedHourlyRate == null) warnings.push('no_agreed_rate_using_price_limit');
  if (rate > perParticipantLimit && ev.fundingType !== 'self_managed') warnings.push('rate_above_price_limit');

  const lines = [{
    kind: claimType,
    itemCode: lim.claimCode,
    baseItemCode: item.code,
    portalOption: G.CLAIM_TYPES[claimType].portalOption,
    minutes,
    quantityHours: hoursFromMinutes(minutes),
    unitAmount: rate,
    priceLimit: perParticipantLimit,
    amount: amountForMinutes(minutes, rate),
    fy: lim.fy,
    band: lim.band,
  }];

  // Travel only rides on a delivered face-to-face support
  if (!isCancelled && claimType === 'direct' && ev.travel) {
    const t = computeTravel({ ...ev.travel, itemCode: item.code, mmm: ev.mmm ?? 1, date, agreedInAdvance: agreement.travel === true });
    warnings.push(...t.warnings);
    lines.push(...t.lines);
  } else if (ev.travel && (isCancelled || claimType !== 'direct')) {
    warnings.push('travel_not_claimable_for_this_claim_type');
  }

  const total = round2(lines.reduce((s, l) => s + l.amount, 0));
  const hard = warnings.some(w => /above_limit|above_price_limit/.test(w));
  return {
    status: hard ? 'needs_review' : 'ready',
    eventId: ev.id,
    item: item.code,
    claimType,
    fy: lim.fy,
    lines,
    total,
    warnings,
    cancellation: cancellationAssessment,
  };
}

/** Build claims for a week of events and summarise per participant. */
function buildWeeklyClaims(events) {
  const claims = (events || []).map(buildClaim);
  const byParticipant = {};
  claims.forEach((c, i) => {
    const pid = events[i].participantId || 'unknown';
    byParticipant[pid] = byParticipant[pid] || { participantId: pid, claims: [], total: 0 };
    byParticipant[pid].claims.push(c);
    byParticipant[pid].total = round2(byParticipant[pid].total + (c.total || 0));
  });
  return { claims, byParticipant };
}

module.exports = {
  financialYearFor,
  hoursFromMinutes,
  amountForMinutes,
  priceBandForMmm,
  resolveSupportItem,
  resolvePriceLimit,
  assessCancellation,
  subtractBusinessDays,
  computeTravel,
  planDayTravel,
  groupPerParticipantLimit,
  buildClaim,
  buildWeeklyClaims,
};
