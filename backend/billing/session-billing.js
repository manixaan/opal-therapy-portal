'use strict';

/**
 * ELIGIBILITY + SESSION BILLING + INVOICE CALCULATION — pure functions.
 *
 * BillingEligibility decides whether one calendar event is a billable session.
 * The calendar holds no attendance status (Splose owns it), so completion is
 * a billing setting:
 *   PAST_CONFIRMED (default) — a confirmed therapy event whose end time has
 *     passed is treated as delivered unless the owner marked it otherwise
 *     (Did not attend / Cancelled / Not billable) on the event.
 *   EXPLICIT_ONLY — only events the owner marked Completed are billed.
 *
 * SessionBilling prices a session: quantity = actual minutes / 60 (4 dp, no
 * invented rounding), unit = the rate card's session hourly rate for the
 * client's MMM on the service date, amount = quantity × unit, half-up cents.
 */

const M = require('./money');

const MAX_SESSION_MINUTES = 8 * 60;

function isTelehealth(ev) {
  return !!ev.is_teams_meeting || ev.event_type === 'teams_meeting';
}

function durationMinutes(ev) {
  const s = new Date(ev.start_time).getTime();
  const e = new Date(ev.end_time).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e)) return null;
  return Math.round((e - s) / 60000);
}

/**
 * @returns {{state:'BILLABLE'|'SKIP'|'ISSUE', reason?:string, issues?:string[], minutes?:number, telehealth?:boolean}}
 */
function evaluateEvent(ev, { now = new Date(), completionRule = 'PAST_CONFIRMED', hasLocation } = {}) {
  if (ev.is_deleted) return { state: 'SKIP', reason: 'deleted' };
  if (String(ev.status || '').toLowerCase() === 'cancelled') return { state: 'SKIP', reason: 'cancelled' };
  const mark = ev.attendance || null;
  if (mark === 'DID_NOT_ATTEND') return { state: 'SKIP', reason: 'did_not_attend' };
  if (mark === 'CANCELLED') return { state: 'SKIP', reason: 'cancelled' };
  if (mark === 'NOT_BILLABLE') return { state: 'SKIP', reason: 'not_billable' };
  if (new Date(ev.end_time).getTime() > now.getTime()) return { state: 'SKIP', reason: 'not_yet_delivered' };
  if (completionRule === 'EXPLICIT_ONLY' && mark !== 'COMPLETED') return { state: 'SKIP', reason: 'awaiting_completion' };

  const issues = [];
  if (!ev.client_id) issues.push('EVENT_NO_CLIENT');
  if (ev.event_type !== 'therapy') issues.push('EVENT_NO_SERVICE_TYPE');
  const minutes = durationMinutes(ev);
  if (!(minutes > 0) || minutes > MAX_SESSION_MINUTES) issues.push('INVALID_DURATION');
  const telehealth = isTelehealth(ev);
  const located = hasLocation != null ? hasLocation : !!(ev.location || (ev.manual_location && ev.manual_location.address));
  if (!telehealth && !located) issues.push('EVENT_NO_LOCATION');
  if (issues.length) return { state: 'ISSUE', issues, minutes, telehealth };
  return { state: 'BILLABLE', minutes, telehealth };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function displayDate(ymd) {
  if (!ymd) return '';
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function gstFor(amountCents, taxTreatment) {
  if (taxTreatment === 'GST_10_EXCLUSIVE') return { rate: '0.1000', cents: Number(M.divRound(BigInt(amountCents), 10n)) };
  return { rate: '0.0000', cents: 0 };
}

/**
 * @param {object} p
 * @param {string} p.serviceDate   YYYY-MM-DD local
 * @param {number} p.minutes
 * @param {object} p.rate          resolveRule() result
 * @param {number} p.mmm
 * @param {string} p.sessionLabel  e.g. 'Therapy Session'
 */
function buildSessionLine({ serviceDate, minutes, rate, mmm, sessionLabel = 'Therapy Session', telehealth = false, mmmSnapshot = null }) {
  const qtyE4 = M.minutesToHoursQty(minutes, 1);
  const unitCents = rate.sessionRateCents;
  const amountCents = M.lineAmount(qtyE4, unitCents);
  return {
    component: 'SESSION',
    itemCode: rate.rule.sessionItemCode || null,
    description: `${displayDate(serviceDate)}, ${minutes} minutes, ${sessionLabel}${telehealth ? ' (telehealth)' : ''}`,
    serviceDate,
    durationMinutes: minutes,
    quantityE4: qtyE4,
    unitCents,
    amountCents,
    mmm,
    rateCardId: rate.card.id,
    rateCardVersion: rate.card.version,
    calculation: {
      method: 'actual_minutes_div_60',
      serviceDate,
      durationMinutes: minutes,
      quantityHours: M.qtyToString(qtyE4),
      mmm,
      mmmSource: mmmSnapshot,
      rateCard: rate.card,
      zone: rate.rule.zoneLabel,
      sessionHourlyRate: M.fromCents(unitCents),
      amount: M.fromCents(amountCents),
      telehealth,
    },
  };
}

/**
 * A client's share of a non-face-to-face block's timed work (billing/nf2f-timer.js).
 * Priced like a session — the rate card's session hourly rate for the
 * client's MMM zone, same support item, NDIS non-face-to-face claim — with
 * quantity = the client's seconds ÷ 3600 (4 dp) so the face reconciles.
 */
function buildNf2fLine({ serviceDate, seconds, rate, mmm, activity, sharePercent, timedSeconds, clientsOnBlock, nonBillablePercent, mmmSnapshot = null }) {
  const qtyE4 = M.minutesToHoursQty(seconds, 60);
  const unitCents = rate.sessionRateCents;
  const amountCents = M.lineAmount(qtyE4, unitCents);
  const minutes = Math.round(seconds / 60);
  return {
    component: 'NF2F',
    itemCode: rate.rule.sessionItemCode || null,
    description: `${displayDate(serviceDate)}, ${minutes} minutes, Non-Face-to-Face Support${activity ? ' (' + activity + ')' : ''}`,
    serviceDate,
    durationMinutes: minutes,
    quantityE4: qtyE4,
    unitCents,
    amountCents,
    mmm,
    rateCardId: rate.card.id,
    rateCardVersion: rate.card.version,
    calculation: {
      method: 'timed_nf2f_share',
      serviceDate,
      timedSeconds,
      clientsOnBlock,
      sharePercent,
      nonBillablePercent,
      clientSeconds: seconds,
      quantityHours: M.qtyToString(qtyE4),
      mmm,
      mmmSource: mmmSnapshot,
      rateCard: rate.card,
      zone: rate.rule.zoneLabel,
      hourlyRate: M.fromCents(unitCents),
      amount: M.fromCents(amountCents),
      claimType: 'NON_FACE_TO_FACE',
    },
  };
}

function buildTravelLines({ serviceDate, allocation, rate, practitionerName, legs }) {
  const lines = [];
  const snapshot = {
    serviceDate,
    practitioner: practitionerName || null,
    mmm: allocation.mmm,
    rateCard: rate.card,
    zone: rate.rule.zoneLabel,
    dayTotalMinutes: allocation.dayTotalMinutes,
    dayTotalKm: allocation.dayTotalKm,
    billableSessions: allocation.sessionsInDay,
    directions: allocation.directions,
    allocatedMinutesBeforeCap: allocation.allocatedMinutesBeforeCap,
    capMinutesEachWay: rate.travelCapMinutesEachWay,
    capMinutes: allocation.capMinutes,
    capApplied: allocation.capApplied,
    claimableMinutes: allocation.claimableMinutes,
    allocatedKm: allocation.allocatedKm,
    legs: (legs || []).map(l => ({ id: l.id, kind: l.kind, included: l.included, reason: l.reason,
      minutes: l.minutes, km: l.km, provider: l.provider || null })),
    method: 'equal_share_of_day_pool_then_participant_cap_no_redistribution',
  };
  if (allocation.labourCents > 0) {
    lines.push({
      component: 'TRAVEL_LABOUR',
      itemCode: rate.rule.travelItemCode || null,
      description: `${displayDate(serviceDate)}, Provider Travel`,
      serviceDate,
      durationMinutes: allocation.claimableMinutes,
      quantityE4: allocation.hoursQtyE4,
      unitCents: allocation.travelRateCents,
      amountCents: allocation.labourCents,
      mmm: allocation.mmm,
      rateCardId: rate.card.id,
      rateCardVersion: rate.card.version,
      calculation: { ...snapshot, travelHourlyRate: M.fromCents(allocation.travelRateCents),
        quantityHours: M.qtyToString(allocation.hoursQtyE4), amount: M.fromCents(allocation.labourCents) },
    });
  }
  if (allocation.vehicleCents > 0) {
    lines.push({
      component: 'TRAVEL_KM',
      itemCode: rate.rule.vehicleItemCode || null,
      description: `${displayDate(serviceDate)}, Provider Travel - Non-Labour Costs (${allocation.allocatedKm.toFixed(2)} km @ $${M.fromCents(allocation.vehicleRateCents)}/km)`,
      serviceDate,
      durationMinutes: null,
      quantityE4: 10000,
      unitCents: allocation.vehicleCents,
      amountCents: allocation.vehicleCents,
      mmm: allocation.mmm,
      rateCardId: rate.card.id,
      rateCardVersion: rate.card.version,
      calculation: { ...snapshot, vehicleRatePerKm: M.fromCents(allocation.vehicleRateCents),
        amount: M.fromCents(allocation.vehicleCents) },
    });
  }
  return lines;
}

/** Totals over ACTIVE lines only. */
function invoiceTotals(lines) {
  let subtotal = 0, gst = 0;
  for (const l of lines) {
    if (l.line_status && l.line_status !== 'ACTIVE') continue;
    subtotal += M.toCents(l.amount);
    gst += M.toCents(l.gst_amount || 0);
  }
  return { subtotalCents: subtotal, gstCents: gst, totalCents: subtotal + gst };
}

function addDays(ymd, days) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + days * 86400000);
  return t.toISOString().slice(0, 10);
}

function todayInTz(tz, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Australia/Perth', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now);
  const get = t => parts.find(p => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Display status: OVERDUE is derived (sent/part-paid, past due, money owing). */
function displayStatus(inv, today) {
  const outstanding = M.toCents(inv.total) - M.toCents(inv.amount_paid);
  if (['SENT', 'PART_PAID', 'READY'].includes(inv.status) && inv.due_date && outstanding > 0) {
    const due = typeof inv.due_date === 'string' ? inv.due_date.slice(0, 10) : new Date(inv.due_date).toISOString().slice(0, 10);
    if (due < today && inv.status !== 'READY') return 'OVERDUE';
  }
  return inv.status;
}

module.exports = {
  MAX_SESSION_MINUTES, isTelehealth, durationMinutes, evaluateEvent, displayDate, gstFor,
  buildSessionLine, buildNf2fLine, buildTravelLines, invoiceTotals, addDays, todayInTz, displayStatus,
};
