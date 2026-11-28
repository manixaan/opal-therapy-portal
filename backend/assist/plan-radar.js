'use strict';

/**
 * OPAL ASSIST — the plan review radar. Read-only, no model call.
 *
 * "Whose NDIS plan ends soon, how much of the funding is used, and is the
 * progress report started?" — one row per open Splose CASE whose expiry
 * date falls in the next WINDOW_DAYS (or ended up to GRACE_DAYS ago, so a
 * missed one does not vanish the day it lapses).
 *
 * Where each number comes from, and its honest limits:
 *   - plan dates: the Splose case's issueDate / expiryDate (calendar dates);
 *     the client's billing profile plan_end only when the case has none.
 *   - funding used: Splose's case lists its appointment and support-activity
 *     connections (case.items); Splose invoice lines name the appointment or
 *     activity they bill (invoiceItems[].type + typeId). Used = the sum of
 *     those lines (unitPrice × quantity, before any discount) on non-draft
 *     invoices, plus the portal's own issued invoices for this client dated
 *     inside the plan when the client has only that one plan then. Splose
 *     exposes no "used" figure of its own.
 *   - tracking: the case's trackType — Budget ($), Hours (invoiced line
 *     quantities), or Appointments (connected appointments, booked ones
 *     included) — against the case's budget / hours / appointmentCount.
 *   - pace: share used vs share of the plan's time gone.
 *   - report: a Progress Report started in Templates for this client within
 *     REPORT_LOOKBACK_DAYS of the plan end; the caller's own case notes since
 *     the plan began.
 *
 * Scoping is the caller's: a set of patient ids (therapist) or null (owner/
 * admin, practice-wide); a therapist sees only cases assigned to their own
 * Splose practitioner. Pure except loadExtras (parameterised SQL).
 */

const WINDOW_DAYS = 56;
const GRACE_DAYS = 14;
const REPORT_LOOKBACK_DAYS = 120;
const PORTAL_BILLED = ['READY', 'SENT', 'PART_PAID', 'PAID'];
const DAY_MS = 86400000;

/** "2026-11-26 00:00:00" | "2026-11-26" | Date → epoch ms of that calendar day (UTC midnight), or null. */
function dayMs(v) {
  if (v instanceof Date) return isNaN(v) ? null : Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate());
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
}
const isoDay = (ms) => (ms == null ? null : new Date(ms).toISOString().slice(0, 10));
/** Today in Perth, as a calendar-day epoch. */
function todayMs(now) { const p = new Date(now.getTime() + 8 * 3600000); return Date.UTC(p.getUTCFullYear(), p.getUTCMonth(), p.getUTCDate()); }
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const round2 = (n) => Math.round(n * 100) / 100;

/** The cases on the radar for this caller. */
function radarCases(cases, { allowed, practitionerId, now, billingPlanEnds = {} }) {
  const today = todayMs(now);
  return (Array.isArray(cases) ? cases : []).filter((c) => {
    if (!c || c.archived || c.deletedAt || c.isOpen === false) return false;
    if (allowed && !allowed.has(String(c.patientId))) return false;
    if (practitionerId && String(c.practitionerId) !== String(practitionerId)) return false;
    return true;
  }).map((c) => {
    const end = dayMs(c.expiryDate) ?? dayMs(billingPlanEnds[String(c.patientId)]);
    return { c, end, start: dayMs(c.issueDate), endSource: dayMs(c.expiryDate) != null ? 'splose_case' : 'billing_profile' };
  }).filter((x) => x.end != null && x.end >= today - GRACE_DAYS * DAY_MS && x.end <= today + WINDOW_DAYS * DAY_MS);
}

/** Splose case connections, split by kind. */
function connections(c) {
  const appts = new Set(); const acts = new Set();
  (Array.isArray(c.items) ? c.items : []).forEach((i) => {
    if (!i || i.typeId == null) return;
    if (i.type === 'Appointment') appts.add(String(i.typeId));
    else if (i.type === 'SupportActivity' || i.type === 'SupportingActivity') acts.add(String(i.typeId));
  });
  return { appts, acts };
}

/** What Splose invoiced against this case: { amount, hours, lines, discounted }. */
function sploseUsage(c, invoices) {
  const { appts, acts } = connections(c);
  const out = { amount: 0, hours: 0, lines: 0, discounted: false };
  if (!appts.size && !acts.size) return out;
  (Array.isArray(invoices) ? invoices : []).forEach((inv) => {
    if (!inv || inv.isArchived || String(inv.patientId) !== String(c.patientId) || inv.status === 'Draft') return;
    (Array.isArray(inv.invoiceItems) ? inv.invoiceItems : []).forEach((it) => {
      if (!it || it.typeId == null) return;
      const id = String(it.typeId);
      const hit = (it.type === 'appointment' && appts.has(id)) || (it.type === 'supportActivity' && acts.has(id));
      if (!hit) return;
      const qty = num(it.quantity) ?? 0; const price = num(it.unitPrice) ?? 0;
      out.amount += price * qty; out.hours += qty; out.lines += 1;
      if (it.discount && !/^0+(\.0+)?%?$/.test(String(it.discount).trim())) out.discounted = true;
    });
  });
  out.amount = round2(out.amount); out.hours = round2(out.hours);
  return out;
}

/**
 * Portal invoices for one client inside this plan — counted only when no
 * other open plan of theirs covers the same date (otherwise it is ambiguous
 * which plan paid, and it is left out rather than guessed).
 */
function portalUsage(row, clientCases, portalInvoices) {
  let amount = 0; let count = 0;
  (portalInvoices || []).forEach((inv) => {
    if (String(inv.client_id) !== String(row.c.patientId)) return;
    const d = dayMs(inv.issue_date);
    if (d == null || row.start == null || d < row.start || d > row.end) return;
    const covering = clientCases.filter((o) => o.start != null && o.end != null && d >= o.start && d <= o.end);
    if (covering.length !== 1) return;
    amount += num(inv.total) ?? 0; count += 1;
  });
  return { amount: round2(amount), count };
}

/** Used vs allowance for the case's track type → { track, allowed, used, unit, pct } (nulls when unknown). */
function tracking(c, splose, portal) {
  const track = c.trackType || null;
  if (track === 'Budget' || (!track && num(c.budget) != null)) {
    const allowed = num(c.budget);
    const used = round2(splose.amount + portal.amount);
    return { track: 'Budget', unit: '$', allowed, used, pct: allowed ? Math.round((used / allowed) * 100) : null };
  }
  if (track === 'Hours') {
    const allowed = num(c.hours);
    return { track: 'Hours', unit: 'hours', allowed, used: splose.hours, pct: allowed ? Math.round((splose.hours / allowed) * 100) : null };
  }
  if (track === 'Appointments') {
    const allowed = num(c.appointmentCount);
    const used = connections(c).appts.size;
    return { track: 'Appointments', unit: 'appointments', allowed, used, pct: allowed ? Math.round((used / allowed) * 100) : null };
  }
  return { track, unit: null, allowed: null, used: null, pct: null };
}

/** Funding pace against time: over | fast | slow | on_track | unknown. */
function pace(pct, start, end, today) {
  if (pct == null || start == null || end == null || end <= start) return { pace: 'unknown', timePct: null };
  const timePct = Math.max(0, Math.min(100, Math.round(((today - start) / (end - start)) * 100)));
  if (pct >= 100) return { pace: 'over', timePct };
  if (pct > timePct + 15) return { pace: 'fast', timePct };
  if (pct < timePct - 25) return { pace: 'slow', timePct };
  return { pace: 'on_track', timePct };
}

/**
 * The radar rows, soonest plan end first.
 * extras: { names: {patientId: name}, portalInvoices, reports: {patientId: {startedAt}}, notes: {patientId: count} }
 */
function buildRadar({ cases, invoices, invoicesComplete = true, allowed = null, practitionerId = null, now = new Date(), billingPlanEnds = {}, extras = {} }) {
  const today = todayMs(now);
  const rows = radarCases(cases, { allowed, practitionerId, now, billingPlanEnds });
  // Every open plan of each radar client, for the portal-invoice ambiguity rule.
  const byClient = {};
  (Array.isArray(cases) ? cases : []).filter((c) => c && !c.archived && !c.deletedAt && c.isOpen !== false).forEach((c) => {
    (byClient[String(c.patientId)] = byClient[String(c.patientId)] || []).push({ start: dayMs(c.issueDate), end: dayMs(c.expiryDate) });
  });
  return rows.map((row) => {
    const c = row.c; const id = String(c.patientId);
    const splose = invoicesComplete ? sploseUsage(c, invoices) : null;
    const portal = portalUsage(row, byClient[id] || [], extras.portalInvoices);
    const t = splose ? tracking(c, splose, portal) : { track: c.trackType || null, unit: null, allowed: null, used: null, pct: null };
    const p = pace(t.pct, row.start, row.end, today);
    const report = (extras.reports || {})[id] || null;
    return {
      clientRef: `splose:patient:${id}`,
      clientName: (extras.names || {})[id] || null,
      caseNumber: c.caseNumber || null,
      planStart: isoDay(row.start),
      planEnd: isoDay(row.end),
      planEndSource: row.endSource,
      daysLeft: Math.round((row.end - today) / DAY_MS),
      funding: {
        track: t.track, unit: t.unit, allowed: t.allowed, used: t.used, pct: t.pct,
        remaining: t.allowed != null && t.used != null ? round2(t.allowed - t.used) : null,
        pace: p.pace, timePct: p.timePct,
        available: !!splose,
        linkedSessions: connections(c).appts.size,
        portalInvoices: portal.count,
        approximate: !!(splose && splose.discounted),
      },
      report: report ? { started: true, startedAt: report.startedAt } : { started: false, startedAt: null },
      notesThisPlan: (extras.notes || {})[id] || 0,
    };
  }).sort((a, b) => a.daysLeft - b.daysLeft);
}

/**
 * The database extras for the rows' clients, in three parameterised reads:
 * billing-profile plan ends (fallback), portal invoices, started progress
 * reports, and the caller's own note counts since each plan began.
 */
async function loadPlanEnds(pool, orgId) {
  if (!orgId) return {};
  const { rows } = await pool.query(
    'SELECT client_id, plan_end FROM billing_profiles WHERE organisation_id = $1 AND plan_end IS NOT NULL', [orgId]);
  const out = {}; rows.forEach((r) => { out[String(r.client_id)] = r.plan_end; });
  return out;
}

async function loadExtras(pool, { orgId, userId, rows }) {
  const ids = rows.map((r) => r.patientId);
  if (!ids.length) return { portalInvoices: [], reports: {}, notes: {} };
  const earliest = rows.reduce((m, r) => (r.planStart && (!m || r.planStart < m) ? r.planStart : m), null) || '1970-01-01';
  const [inv, rep, notes] = await Promise.all([
    orgId ? pool.query(
      `SELECT client_id, issue_date, total FROM invoices
        WHERE organisation_id = $1 AND client_id = ANY($2::text[]) AND status = ANY($3::text[]) AND issue_date >= $4::date`,
      [orgId, ids, PORTAL_BILLED, earliest]) : { rows: [] },
    pool.query(
      `SELECT splose_client_id AS client_id, MAX(created_at) AS started_at FROM template_documents
        WHERE template_id = 'progress_report' AND splose_client_id = ANY($1::text[])
          AND ($2::uuid IS NULL OR organisation_id = $2::uuid)
          AND created_at >= NOW() - ($3 || ' days')::interval
        GROUP BY splose_client_id`,
      [ids, orgId || null, String(REPORT_LOOKBACK_DAYS + WINDOW_DAYS)]),
    pool.query(
      `SELECT COALESCE(c.splose_patient_id, e.client_id) AS client_id, c.created_at, e.start_time
         FROM case_note_drafts c LEFT JOIN events e ON e.id = c.linked_event_id
        WHERE c.user_id = $1 AND c.status <> 'archived' AND c.review_status <> 'rejected'
          AND COALESCE(c.splose_patient_id, e.client_id) = ANY($2::text[])`,
      [userId, ids]),
  ]);
  const reports = {};
  const endById = {}; rows.forEach((r) => { endById[r.patientId] = r.planEnd; });
  rep.rows.forEach((r) => {
    const endMs = dayMs(endById[String(r.client_id)]);
    const started = new Date(r.started_at);
    // Only a report begun for THIS review counts (within the lookback before the plan end).
    if (endMs == null || isNaN(started) || started.getTime() < endMs - REPORT_LOOKBACK_DAYS * DAY_MS) return;
    reports[String(r.client_id)] = { startedAt: started.toISOString() };
  });
  const startById = {}; rows.forEach((r) => { startById[r.patientId] = dayMs(r.planStart); });
  const counts = {};
  notes.rows.forEach((r) => {
    const id = String(r.client_id); const when = dayMs(new Date(r.start_time || r.created_at));
    if (startById[id] != null && when != null && when < startById[id]) return;
    counts[id] = (counts[id] || 0) + 1;
  });
  return { portalInvoices: inv.rows, reports, notes: counts };
}

module.exports = {
  WINDOW_DAYS, GRACE_DAYS, REPORT_LOOKBACK_DAYS,
  dayMs, isoDay, radarCases, connections, sploseUsage, portalUsage, tracking, pace, buildRadar, loadPlanEnds, loadExtras,
};
