'use strict';

/**
 * TRAVEL BILLING — converts one practitioner-day of travel legs (already
 * computed by the Opal travel engine) into per-session claimable allocations.
 * Pure: no DB, no network, no Google calls.
 *
 * Method (Opal business rule, see docs/accounting/INVOICING_ARCHITECTURE.md):
 *   1. Eligible legs = travel to the first client + client-to-client legs
 *      + the return leg ONLY when return travel is payable to the clinician.
 *      Legs that end at a non-billable event, or have no route facts, are
 *      excluded and each exclusion carries a reason.
 *   2. Day pool = Σ eligible minutes (and, separately, Σ eligible km).
 *   3. Each billable session on the route gets an equal share of the pool.
 *   4. The share is capped by THAT participant's cap (per direction, from the
 *      rate card for their MMM zone); directions = 1, or 2 when a payable
 *      return leg is in the pool. Minutes removed by a cap are NOT
 *      redistributed to other participants.
 *   5. Labour amount = capped hours × the participant's travel hourly rate.
 *      Vehicle amount = equal km share × the participant's $/km rate. Vehicle
 *      is a separate component and is not time-capped.
 *
 * Everything that produced the numbers is returned so it can be snapshotted
 * onto the invoice line.
 */

const M = require('./money');

const LEG_KIND = Object.freeze({ OUTBOUND: 'OUTBOUND', BETWEEN: 'BETWEEN', RETURN: 'RETURN' });

/** minutes / km arrive as Numbers or NUMERIC strings; keep 2 dp for minutes, 3 dp for km. */
function e2(v) { return Math.round(Number(v) * 100); }
function e3(v) { return Math.round(Number(v) * 1000); }

/**
 * Decide, leg by leg, what enters the day pool.
 * @param {Array} legs  [{id, kind, fromEventId, toEventId, minutes, km, source}]
 * @param {Set<string>} billableEventIds
 * @param {boolean} returnPayable
 */
function classifyLegs(legs, billableEventIds, returnPayable) {
  return legs.map(leg => {
    const out = { ...leg, included: false, reason: null };
    const mins = Number(leg.minutes);
    if (!(mins >= 0) || leg.minutes == null) { out.reason = 'no_route_facts'; return out; }
    if (leg.kind === LEG_KIND.RETURN) {
      if (!returnPayable) { out.reason = 'return_travel_not_payable'; return out; }
      if (!billableEventIds.has(String(leg.fromEventId))) { out.reason = 'origin_not_billable'; return out; }
      out.included = true; out.reason = 'return_travel_payable';
      return out;
    }
    if (!billableEventIds.has(String(leg.toEventId))) { out.reason = 'destination_not_billable'; return out; }
    out.included = true;
    out.reason = leg.kind === LEG_KIND.OUTBOUND ? 'travel_to_first_client' : 'travel_between_clients';
    return out;
  });
}

/**
 * @param {object} day
 * @param {string} day.practitionerId
 * @param {string} day.date                YYYY-MM-DD
 * @param {boolean} day.returnPayable
 * @param {Array}  day.legs
 * @param {Array}  day.sessions  [{eventId, clientId, mmm, rule:{travelRateCents,
 *                                 travelCapMinutesEachWay|null, vehicleRateCents,
 *                                 rateCardId, rateCardVersion}}]
 * @returns {{legs:Array, totalMinutesE2:number, totalKmE3:number, allocations:Array, issues:Array}}
 */
function allocateDay(day) {
  const sessions = day.sessions || [];
  const billable = new Set(sessions.map(s => String(s.eventId)));
  const legs = classifyLegs(day.legs || [], billable, !!day.returnPayable);
  const included = legs.filter(l => l.included);
  const issues = legs
    .filter(l => l.reason === 'no_route_facts' && billable.has(String(l.toEventId)))
    .map(l => ({ type: 'TRAVEL_ROUTE_FAILED', eventId: l.toEventId, legId: l.id }));

  const totalMinutesE2 = included.reduce((a, l) => a + e2(l.minutes), 0);
  const totalKmE3 = included.reduce((a, l) => a + (l.km == null ? 0 : e3(l.km)), 0);
  const n = sessions.length;
  const returnInPool = included.some(l => l.kind === LEG_KIND.RETURN);
  const directions = returnInPool ? 2 : 1;

  const allocations = sessions.map(s => {
    const r = s.rule || {};
    // share = totalMinutesE2 / (100 n)  — kept rational until rounding.
    const shareNum = BigInt(totalMinutesE2);
    const shareDen = BigInt(100 * Math.max(n, 1));
    let capMinutes = null;
    let capApplied = false;
    let claimNum = shareNum, claimDen = shareDen;
    if (r.travelCapMinutesEachWay != null) {
      capMinutes = Number(r.travelCapMinutesEachWay) * directions;
      if (shareNum > BigInt(capMinutes) * shareDen) {
        capApplied = true;
        claimNum = BigInt(capMinutes); claimDen = 1n;
      }
    }
    const hoursQtyE4 = M.minutesToHoursQty(claimNum, claimDen);
    const labourCents = r.travelRateCents != null ? M.lineAmount(hoursQtyE4, r.travelRateCents) : null;
    const kmNum = BigInt(totalKmE3), kmDen = BigInt(1000 * Math.max(n, 1));
    const vehicleCents = r.vehicleRateCents != null
      ? M.rationalTimesCents(kmNum, kmDen, r.vehicleRateCents) : null;
    return {
      eventId: s.eventId,
      clientId: s.clientId,
      mmm: s.mmm,
      sessionsInDay: n,
      dayTotalMinutes: totalMinutesE2 / 100,
      dayTotalKm: totalKmE3 / 1000,
      directions,
      allocatedMinutesBeforeCap: M.rationalToFixed(shareNum, shareDen, 2),
      capMinutes,
      capApplied,
      claimableMinutes: M.rationalToFixed(claimNum, claimDen, 2),
      hoursQtyE4,
      travelRateCents: r.travelRateCents ?? null,
      labourCents,
      allocatedKm: M.rationalToFixed(kmNum, kmDen, 2),
      vehicleRateCents: r.vehicleRateCents ?? null,
      vehicleCents,
      rateCardId: r.rateCardId || null,
      rateCardVersion: r.rateCardVersion ?? null,
      sourceLegIds: included.map(l => l.id),
    };
  });

  return { legs, totalMinutesE2, totalKmE3, allocations, issues, returnInPool };
}

module.exports = { LEG_KIND, classifyLegs, allocateDay };
