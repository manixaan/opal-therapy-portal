'use strict';

/**
 * SNAPSHOT HOURS (25 Nov 2026) — the Daily & Weekly Snapshot's hours, counted
 * the way invoicing counts them (owner: "whatever we are invoicing is
 * billable hours"). READ-ONLY: no Google, no Splose, no writes — invoicing's
 * own prepare() creates stub profiles, geocodes and syncs payers, so it is
 * not run here; its building blocks are, with the same rules:
 *
 *   Billable work   sessions invoicing would bill — loadCandidateEvents +
 *                   evaluateEvent (a session held only by a data issue still
 *                   counts: it is billed once fixed) — plus each client's
 *                   share of non-face-to-face blocks (timer / resolution,
 *                   nf2f-timer.clientParts). Not over yet: the booked length.
 *   Client travel   the rule book's allocation (travel-billing.allocateDay)
 *                   over the day's legs (day-route.buildDayLegs), priced from
 *                   the minutes the calendar recorded (migration 090). A leg
 *                   the calendar has not recorded is not guessed — counted in
 *                   unpricedLegs. Telehealth has no travel.
 *   Cancellations   client sessions cancelled or marked Did not attend: their
 *                   booked length, never billable here.
 *
 * Not included: Splose support activities (report writing done in Splose) —
 * reading them needs Splose; remote-trip travel hours (billed per trip).
 */

const S = require('./session-billing');
const NF = require('./nf2f-timer');
const CTM = require('./calendar-travel-minutes');
const T = require('./travel-billing');
const DR = require('./day-route');
const RC = require('./rate-cards');
const IG = require('./invoice-generation');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 31;
const DEFAULT_CAP = { A: 30, B: 60, R: null };   // the default rate card's caps

function daysBetween(from, to) {
  const out = [];
  const d = new Date(from + 'T00:00:00Z'), end = new Date(to + 'T00:00:00Z');
  while (d <= end && out.length <= MAX_DAYS) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}

function validRange(from, to) {
  if (!DATE_RE.test(String(from || '')) || !DATE_RE.test(String(to || '')) || from > to) return false;
  return daysBetween(from, to).length <= MAX_DAYS;
}

const r1 = n => Math.round(n * 10) / 10;

/**
 * PURE — one event's place in the snapshot.
 * @returns {{bucket:'work'|'cancelled'|null, minutes:number, delivered:boolean, issue:boolean, dna?:boolean}}
 */
function classifySession(ev, { now, completionRule }) {
  const minutes = Math.max(0, Math.round((new Date(ev.end_time) - new Date(ev.start_time)) / 60000)) || 0;
  const delivered = new Date(ev.end_time).getTime() <= now.getTime();
  if (ev.is_deleted) return { bucket: null, minutes: 0, delivered, issue: false };
  const mark = ev.attendance || null;
  if (String(ev.status || '').toLowerCase() === 'cancelled' || mark === 'CANCELLED') return { bucket: 'cancelled', minutes, delivered, issue: false };
  if (mark === 'DID_NOT_ATTEND') return { bucket: 'cancelled', minutes, delivered, issue: false, dna: true };
  // Booked but not over: judged as if delivered (the snapshot shows the plan too).
  const at = delivered ? now : new Date(new Date(ev.end_time).getTime() + 1000);
  const res = S.evaluateEvent(ev, { now: at, completionRule: delivered ? completionRule : 'PAST_CONFIRMED', hasLocation: !!DR.eventAddress(ev) });
  if (res.state === 'SKIP') return { bucket: null, minutes: 0, delivered, issue: false, reason: res.reason };
  return { bucket: 'work', minutes: res.minutes || minutes, delivered, issue: res.state === 'ISSUE', telehealth: !!res.telehealth };
}

/** PURE — billable minutes of one non-face-to-face block (all its clients together). */
function nf2fMinutes(block, timer, now) {
  const clients = NF.blockClients(block);
  if (!clients.length) return { minutes: 0, untimed: false };
  if (String(block.status || '').toLowerCase() === 'cancelled' || ['CANCELLED', 'NOT_BILLABLE', 'DID_NOT_ATTEND'].includes(block.attendance)) return { minutes: 0, untimed: false };
  const blockSecs = NF.blockSeconds(block);
  if (new Date(block.end_time) > now) {
    // Not over: what is timed so far, else the booked length.
    const t = timer ? NF.elapsedSeconds(timer, now) : 0;
    return { minutes: Math.round((t > 0 ? Math.min(t, blockSecs) : blockSecs) / 60), untimed: false, booked: !(t > 0) };
  }
  const row = timer ? NF.settled(timer, now) : null;
  if (row && row.resolution === 'DID_NOT_HAPPEN') return { minutes: 0, untimed: false };
  if (NF.needsResolution(row, clients, block.end_time, now, blockSecs)) return { minutes: 0, untimed: true };
  const timed = row && row.resolution === 'FULL_BLOCK' ? blockSecs : Math.min(row ? NF.elapsedSeconds(row, now) : 0, blockSecs);
  if (timed <= 0) return { minutes: 0, untimed: false };
  const secs = NF.clientParts(row, clients, timed, blockSecs).reduce((a, p) => a + (p.seconds > 0 ? p.seconds : 0), 0);
  return { minutes: Math.round(secs / 60), untimed: false };
}

function capFor(rule, mmm) {
  if (rule && rule.travelCapMinutesEachWay !== undefined) return rule.travelCapMinutesEachWay;
  return DEFAULT_CAP[T.zoneGroup(mmm)];
}

/** PURE — one practitioner-day's billable client travel, in minutes. */
function dayTravel({ user, date, sessions, dayCal, deskHome = [], cards = [] }) {
  const ordered = sessions.slice().sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
  if (!ordered.length) return { minutes: 0, unpricedLegs: 0 };
  const minutesFor = (o, d) => CTM.minutesFor(dayCal, o, d);
  const route = DR.buildDayLegs({ user, date, sessions: ordered, minutesFor, clientToClient: true, deskHome });
  let unpriced = 0;
  for (const leg of route.legs) {
    const m = minutesFor(leg.origin, leg.destination);
    leg.minutes = m != null ? m : null;
    if (leg.detour) {
      // Mid-day detour: the lesser of the direct drive and the detour driven.
      const parts = leg.detour.legs.map(l => minutesFor(l.origin, l.destination));
      const detourMin = parts.some(x => x == null) ? null : parts.reduce((a, b) => a + b, 0);
      if (detourMin != null && (leg.minutes == null || detourMin < leg.minutes)) leg.minutes = detourMin;
    }
    if (leg.minutes == null) unpriced++;
  }
  const base = route.base && route.base.address && !route.base.remote ? route.base.address : null;
  const alloc = T.allocateDay({
    legs: route.legs,
    sessions: ordered.map(ev => {
      const zone = IG.sessionZone(ev, { telehealth: false }, null);
      const mmm = zone.mmm != null ? zone.mmm : 1;           // unresolved zone: metro (most clients)
      const rate = cards.length ? RC.resolveRule(cards, { serviceDate: date, mmm, discipline: 'OT' }) : null;
      return { eventId: ev.id, clientId: ev.client_id, clientName: ev.client_name || null, mmm, address: DR.eventAddress(ev),
        commuteMinutes: base ? minutesFor(base, DR.eventAddress(ev)) : null,
        commuteHomeMinutes: base ? minutesFor(DR.eventAddress(ev), base) : null,
        rule: { travelRateCents: null, travelCapMinutesEachWay: capFor(rate, mmm) } };
    }),
  });
  return { minutes: Number(alloc.report.billedMinutes) || 0, unpricedLegs: unpriced };
}

/**
 * The viewer's own hours for each day in [from, to] (Perth dates).
 * @returns {{days: Object<string, {workMin, travelMin, cancelledMin, cancelledCount, dnaCount, issueCount, untimedBlocks, unpricedLegs}>}}
 */
async function snapshotHours(q, { userId, orgId, from, to, now = new Date() }) {
  const { rows: [st] } = await q.query(
    'SELECT completion_rule, timezone FROM billing_settings WHERE organisation_id = $1', [orgId]);
  const completionRule = (st && st.completion_rule) || 'PAST_CONFIRMED';
  const tz = (st && st.timezone) || 'Australia/Perth';

  const days = {};
  for (const d of daysBetween(from, to)) {
    days[d] = { workMin: 0, travelMin: 0, cancelledMin: 0, cancelledCount: 0, dnaCount: 0, issueCount: 0, untimedBlocks: 0, unpricedLegs: 0 };
  }

  // 1. Sessions — the very rows invoicing reads, this user only.
  const events = await IG.loadCandidateEvents(q, orgId, { from, to, practitionerIds: [userId], tz });
  const inPerson = new Map();       // date → billable in-person sessions with a client
  for (const ev of events) {
    const day = days[ev.local_date];
    if (!day) continue;
    const c = classifySession(ev, { now, completionRule });
    if (c.bucket === 'cancelled') {
      day.cancelledMin += c.minutes; day.cancelledCount++; if (c.dna) day.dnaCount++;
    } else if (c.bucket === 'work') {
      day.workMin += c.minutes;
      if (c.issue) day.issueCount++;
      if (!c.telehealth && ev.client_id && DR.eventAddress(ev)) {
        if (!inPerson.has(ev.local_date)) inPerson.set(ev.local_date, []);
        inPerson.get(ev.local_date).push(ev);
      }
    }
  }

  // 2. Non-face-to-face blocks naming clients (read-only twin of invoicing's loadNf2fBlocks).
  const { rows: blocks } = await q.query(
    `SELECT e.id, e.title, e.start_time, e.end_time, e.status, e.custom_metadata,
            to_char(((e.start_time AT TIME ZONE 'UTC') AT TIME ZONE $4)::date, 'YYYY-MM-DD') AS local_date,
            ceb.attendance,
            t.event_id AS t_event_id, t.status AS t_status, t.run_started_at, t.accumulated_seconds, t.limit_seconds,
            t.auto_stopped, t.stopped_at, t.non_billable_percent, t.allocation, t.resolution, t.client_seconds
       FROM events e
       LEFT JOIN event_billing_timers t ON t.event_id = e.id
       LEFT JOIN calendar_event_billing ceb ON ceb.event_id = e.id
      WHERE e.user_id = $1
        AND ((e.start_time AT TIME ZONE 'UTC') AT TIME ZONE $4)::date BETWEEN $2::date AND $3::date
        AND COALESCE(e.is_deleted, FALSE) = FALSE
        AND e.custom_metadata->'booking'->>'group' = 'nf2f'
        AND NOT EXISTS (SELECT 1 FROM event_block_reviews br WHERE br.event_id = e.id AND br.status IN ('guessed', 'needs_input'))`,
    [userId, from, to, tz]);
  for (const b of blocks) {
    const day = days[b.local_date];
    if (!day) continue;
    const timer = b.t_event_id ? { event_id: b.t_event_id, status: b.t_status, run_started_at: b.run_started_at,
      accumulated_seconds: b.accumulated_seconds, limit_seconds: b.limit_seconds, auto_stopped: b.auto_stopped,
      stopped_at: b.stopped_at, non_billable_percent: b.non_billable_percent, allocation: b.allocation,
      resolution: b.resolution, client_seconds: b.client_seconds } : null;
    const r = nf2fMinutes(b, timer, now);
    day.workMin += r.minutes;
    if (r.untimed) day.untimedBlocks++;
  }

  // 3. Client travel — the rule book over the calendar's recorded minutes.
  if (inPerson.size) {
    const dates = [...inPerson.keys()];
    const calendarMinutes = await CTM.loadForDays(q, dates.map(date => ({ userId, date })));
    const { rows: desk } = await q.query(
      `SELECT e.user_id, e.start_time, e.end_time,
              to_char(((e.start_time AT TIME ZONE 'UTC') AT TIME ZONE $4)::date, 'YYYY-MM-DD') AS local_date
         FROM events e
        WHERE e.user_id = $1 AND COALESCE(e.is_deleted, FALSE) = FALSE
          AND e.custom_metadata->'travel'->>'desk' = 'home'
          AND ((e.start_time AT TIME ZONE 'UTC') AT TIME ZONE $4)::date BETWEEN $2::date AND $3::date`,
      [userId, from, to, tz]);
    const cards = await RC.loadRateCards(q, orgId);
    for (const date of dates) {
      const list = inPerson.get(date);
      const t = dayTravel({ user: list[0], date, sessions: list, dayCal: calendarMinutes.get(`${userId}|${date}`) || null,
        deskHome: desk.filter(r => r.local_date === date), cards });
      days[date].travelMin += t.minutes;
      days[date].unpricedLegs += t.unpricedLegs;
    }
  }

  for (const d of Object.values(days)) d.travelMin = r1(d.travelMin);
  return { from, to, days, method: 'invoicing-rules', excludes: ['splose_support_activities', 'remote_trip_travel'] };
}

module.exports = { snapshotHours, classifySession, nf2fMinutes, dayTravel, validRange, daysBetween };
