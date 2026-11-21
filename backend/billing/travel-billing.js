'use strict';

/**
 * TRAVEL BILLING — the owner's NDIS provider-travel rule book (21 Nov 2026).
 * Converts one practitioner-day of travel legs into per-client travel time.
 * Pure: no DB, no network.
 *
 * Inputs: the day's legs (minutes from the calendar, migration 090) and the
 * billable in-person sessions in time order, each with its client, MMM zone,
 * address and rate rule.
 *
 * Always from the day's TOTAL travel T — never leg by leg.
 *   T     = first drive + drives between clients + the trip home (client-to-
 *           client driving only; day-route.js clientToClient). A leg marked
 *           "Not driving this" is not in T (rule 2).
 *   N     = clients seen (a client seen twice counts once).
 *   CAP   = 30 min (MMM1–3), 60 min (MMM4–5) — the rate card's cap.
 *   Rule 6: T ≤ N×CAP  → each client T÷N; no return charged.
 *   Rule 7: T > N×CAP  → each client CAP, plus return R = min(T − N×CAP, CAP).
 *   Rule 8: R goes — MMM4–5: equally to all; MMM1–3 all at one address:
 *           equally; MMM1–3 different addresses: all to the LAST client.
 *   Rule 9: daily ceiling (N×CAP)+CAP; anything above it is unbilled, reported.
 *   Rule 2: never more than T.
 *   Rule 11: MMM6–7 has no cap: T÷N.
 *   Rule 10 (owner, 21 Nov 2026): a day mixing MMM1–3 and MMM4–5 — each metro
 *           client gets the LESSER of the drive actually made into them and
 *           their normal commute from base (then the 30-min cap); the MMM4–5
 *           clients share the rest of T by the rule book. Every comparison is a
 *           reviewer note and the day is flagged for review. A day mixing
 *           MMM6–7 with capped zones uses the smallest cap and is flagged.
 *   Rule 3: billed at the rate card's travel rate (50% of the session rate;
 *           MMM6–7 the remote loaded rate), on its own line.
 *   Rule 12/13: no non-labour (km) line in any zone here. MMM6–7 non-labour
 *           is actual trip costs ÷ clients, billed through Trips.
 *   Rule 4: no check (owner decision).
 *
 * Everything that produced the numbers is returned for the line snapshot.
 */

const M = require('./money');
const { canonAddr } = require('./route-facts');

const LEG_KIND = Object.freeze({ OUTBOUND: 'OUTBOUND', BETWEEN: 'BETWEEN', RETURN: 'RETURN' });
const METHOD = 'ndis_rule_book_2026_11';

/** minutes arrive as Numbers or NUMERIC strings; keep 2 dp. */
function e2(v) { return Math.round(Number(v) * 100); }

/** Zone group: 'A' MMM1–3, 'B' MMM4–5, 'R' MMM6–7 (no cap). */
function zoneGroup(mmm) {
  const z = Number(mmm);
  if (z >= 6) return 'R';
  if (z >= 4) return 'B';
  return 'A';
}

/**
 * Which legs make up T. A leg counts when it has minutes and touches a
 * billable session: a drive into one (start / between), or the trip home from
 * one. `returnPayable` is no longer used — the rule book decides return.
 */
function classifyLegs(legs, billableEventIds) {
  return legs.map(leg => {
    const out = { ...leg, included: false, reason: null };
    const mins = Number(leg.minutes);
    if (!(mins >= 0) || leg.minutes == null) { out.reason = 'no_route_facts'; return out; }
    if (leg.kind === LEG_KIND.RETURN) {
      if (!billableEventIds.has(String(leg.fromEventId))) { out.reason = 'origin_not_billable'; return out; }
      out.included = true; out.reason = leg.midday ? 'trip_away_from_client' : 'trip_home';
      return out;
    }
    if (!billableEventIds.has(String(leg.toEventId))) { out.reason = 'destination_not_billable'; return out; }
    out.included = true;
    out.reason = leg.kind === LEG_KIND.OUTBOUND ? 'travel_to_first_client' : 'travel_between_clients';
    return out;
  });
}

/** A rational number of minutes {n, d} (BigInt). */
const R = (n, d = 1n) => ({ n: BigInt(n), d: BigInt(d) });
const add = (a, b) => R(a.n * b.d + b.n * a.d, a.d * b.d);
const lt = (a, b) => a.n * b.d < b.n * a.d;
const toFixed2 = r => M.rationalToFixed(r.n, r.d, 2);

/**
 * @param {object} day
 * @param {Array}  day.legs
 * @param {Array}  day.sessions  in time order: [{eventId, clientId, mmm, address,
 *                               rule:{travelRateCents, travelCapMinutesEachWay, rateCardId, rateCardVersion}}]
 * @returns {{legs, totalMinutesE2, allocations, report, issues}}
 */
function allocateDay(day) {
  const sessions = day.sessions || [];
  const billable = new Set(sessions.map(s => String(s.eventId)));
  const legs = classifyLegs(day.legs || [], billable);
  const included = legs.filter(l => l.included);
  const issues = legs
    .filter(l => l.reason === 'no_route_facts' && billable.has(String(l.toEventId)))
    .map(l => ({ type: 'TRAVEL_ROUTE_FAILED', eventId: l.toEventId, legId: l.id }));

  const totalMinutesE2 = included.reduce((a, l) => a + e2(l.minutes), 0);
  const T = R(totalMinutesE2, 100);

  // Clients in order of first appearance; the LAST client is the one whose session is last.
  const clients = [];
  const byClient = new Map();
  for (const s of sessions) {
    const k = String(s.clientId);
    if (!byClient.has(k)) { byClient.set(k, { clientId: s.clientId, first: s, sessions: [] }); clients.push(byClient.get(k)); }
    byClient.get(k).sessions.push(s);
  }
  const N = clients.length;
  const lastClientId = sessions.length ? String(sessions[sessions.length - 1].clientId) : null;

  const groups = new Set(sessions.map(s => zoneGroup(s.mmm)));
  const mixedZones = groups.size > 1;
  const reviewNotes = [];
  const per = new Map();          // clientId → { base: R, ret: R }
  let returnMinutes = R(0), rule = null, ceiling = null, CAP = null;
  const capOf = list => { const c = list.filter(s => s.rule && s.rule.travelCapMinutesEachWay != null); return c.length ? Math.min(...c.map(s => Number(s.rule.travelCapMinutesEachWay))) : null; };

  if (N === 0) {
    rule = 'no_clients';
  } else if (mixedZones && groups.has('A') && groups.has('B') && !groups.has('R')) {
    // Rule 10, owner's answer (21 Nov 2026): a metro client is never charged for
    // the therapist's choice to go rural that day. Each MMM1–3 client gets the
    // LESSER of the drive actually made into them and their normal commute from
    // the day's base, then the MMM1–3 cap. The MMM4–5 clients share the rest of
    // the day's travel by the rule book (60-min cap + return, split equally).
    rule = 'rule_10_mixed_metro_lesser_rural_pool';
    const metro = clients.filter(c => zoneGroup(c.first.mmm) === 'A');
    const rural = clients.filter(c => zoneGroup(c.first.mmm) === 'B');
    const capA = capOf(metro.map(c => c.first)), capB = capOf(rural.map(c => c.first));
    CAP = capB;
    let metroTaken = R(0);
    for (const c of metro) {
      const ids = new Set(c.sessions.map(x => String(x.eventId)));
      const inLegs = included.filter(l => l.kind !== LEG_KIND.RETURN && ids.has(String(l.toEventId)));
      const outLegs = included.filter(l => l.kind === LEG_KIND.RETURN && ids.has(String(l.fromEventId)));
      const inbound = inLegs.reduce((x, l) => x + e2(l.minutes), 0);
      const away = outLegs.reduce((x, l) => x + e2(l.minutes), 0);
      metroTaken = add(metroTaken, R(inbound + away, 100));      // these legs leave the rural pool either way
      const commute = c.first.commuteMinutes != null ? e2(c.first.commuteMinutes) : null;
      const lesser = commute != null && commute < inbound ? commute : inbound;
      const capped = capA != null && lesser > capA * 100 ? capA * 100 : lesser;
      per.set(String(c.clientId), { base: R(capped, 100), ret: R(0) });
      reviewNotes.push(`${c.first.clientName || 'Metro client'} (MMM1–3): drive in ${inbound / 100} min${commute != null ? `, normal commute from base ${commute / 100} min` : ', no commute to compare'}; billed the lesser${capped < lesser ? `, capped at ${capA}` : ''} (${capped / 100} min).${away ? ` The drive home from this client (${away / 100} min) is not billed on a mixed day.` : ''}`);
    }
    const poolB = R(T.n * metroTaken.d - metroTaken.n * T.d, T.d * metroTaken.d);
    const nb = rural.length;
    ceiling = capB != null ? nb * capB + capB : null;
    const nCap = R(nb * capB);
    if (!lt(nCap, poolB)) {
      for (const c of rural) per.set(String(c.clientId), { base: R(poolB.n, poolB.d * BigInt(nb)), ret: R(0) });
      reviewNotes.push(`MMM4–5 clients share the remaining ${toFixed2(poolB)} min of travel: ${toFixed2(R(poolB.n, poolB.d * BigInt(nb)))} min each (within the ${capB}-min cap).`);
    } else {
      const over = R(poolB.n * nCap.d - nCap.n * poolB.d, poolB.d * nCap.d);
      returnMinutes = lt(over, R(capB)) ? over : R(capB);
      for (const c of rural) per.set(String(c.clientId), { base: R(capB), ret: R(returnMinutes.n, returnMinutes.d * BigInt(nb)) });
      reviewNotes.push(`MMM4–5 clients share the remaining ${toFixed2(poolB)} min: ${capB} min each plus a ${toFixed2(returnMinutes)}-min return split equally.`);
    }
  } else {
    const capped = sessions.filter(s => zoneGroup(s.mmm) !== 'R');
    // A day mixing remote (MMM6–7) with capped zones: the most conservative cap present.
    CAP = capOf(capped);
    const group = CAP == null ? 'R' : (capped.some(s => zoneGroup(s.mmm) === 'A') ? 'A' : 'B');
    const sameAddress = new Set(sessions.map(s => canonAddr(s.address || ''))).size <= 1;
    if (mixedZones) reviewNotes.push(`Mixed day including MMM6–7: drafted at the ${CAP}-min cap; check by hand.`);
    if (CAP == null) {
      rule = 'rule_11_uncapped_remote';
      for (const c of clients) per.set(String(c.clientId), { base: R(T.n, T.d * BigInt(N)), ret: R(0) });
    } else {
      const nCap = R(N * CAP);
      ceiling = N * CAP + CAP;
      if (!lt(nCap, T)) {
        rule = 'rule_6_within_caps';
        for (const c of clients) per.set(String(c.clientId), { base: R(T.n, T.d * BigInt(N)), ret: R(0) });
      } else {
        // Rule 7: each CAP, plus return R = min(T − N×CAP, CAP).
        const over = R(T.n * nCap.d - nCap.n * T.d, T.d * nCap.d);
        returnMinutes = lt(over, R(CAP)) ? over : R(CAP);
        let split;
        if (group === 'B') split = 'rule_8a_equal';
        else if (sameAddress) split = 'rule_8b_same_address_equal';
        else split = 'rule_8c_last_client';
        rule = 'rule_7_capped_with_return/' + split;
        for (const c of clients) {
          let ret = R(0);
          if (split === 'rule_8c_last_client') { if (String(c.clientId) === lastClientId) ret = returnMinutes; }
          else ret = R(returnMinutes.n, returnMinutes.d * BigInt(N));
          per.set(String(c.clientId), { base: R(CAP), ret });
        }
      }
    }
  }

  let billed = R(0);
  const allocations = [];
  for (const c of clients) {
    const p = per.get(String(c.clientId)) || { base: R(0), ret: R(0) };
    const mins = add(p.base, p.ret);
    billed = add(billed, mins);
    const s = c.first;
    const r = s.rule || {};
    const hoursQtyE4 = M.minutesToHoursQty(mins.n, mins.d);
    const labourCents = r.travelRateCents != null ? M.lineAmount(hoursQtyE4, r.travelRateCents) : null;
    allocations.push({
      eventId: s.eventId,                      // the client's first session that day carries the line
      clientId: c.clientId,
      mmm: s.mmm,
      sessionsInDay: sessions.length,
      clientsInDay: N,
      dayTotalMinutes: totalMinutesE2 / 100,
      dayTotalKm: 0,
      directions: lt(R(0), p.ret) ? 2 : 1,
      allocatedMinutesBeforeCap: N ? M.rationalToFixed(T.n, T.d * BigInt(N), 2) : 0,
      capMinutes: CAP,
      capApplied: rule != null && (rule.startsWith('rule_7') || rule.startsWith('rule_10')),
      cappedMinutes: toFixed2(p.base),
      returnMinutes: toFixed2(p.ret),
      claimableMinutes: toFixed2(mins),
      hoursQtyE4,
      travelRateCents: r.travelRateCents ?? null,
      labourCents,
      allocatedKm: 0,
      vehicleRateCents: null,
      vehicleCents: 0,
      rateCardId: r.rateCardId || null,
      rateCardVersion: r.rateCardVersion ?? null,
      rule, method: METHOD,
      sourceLegIds: included.map(l => l.id),
    });
  }
  const unbilled = R(T.n * billed.d - billed.n * T.d, T.d * billed.d);
  const flags = [];
  if (mixedZones) flags.push('MIXED_ZONES');
  if (lt(R(0), unbilled)) flags.push('UNBILLED_MINUTES');
  const report = {
    method: METHOD, rule, totalMinutes: totalMinutesE2 / 100, clients: N, cap: CAP, ceiling,
    returnMinutes: toFixed2(returnMinutes), billedMinutes: toFixed2(billed), unbilledMinutes: toFixed2(unbilled),
    zoneGroups: [...groups], mixedZones, flags, reviewNotes,
  };
  for (const a of allocations) a.dayReport = report;
  return { legs, totalMinutesE2, totalKmE3: 0, allocations, issues, report, reviewNotes, returnInPool: lt(R(0), returnMinutes) };
}

module.exports = { LEG_KIND, METHOD, zoneGroup, classifyLegs, allocateDay };
