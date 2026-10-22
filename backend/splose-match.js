'use strict';

/**
 * SPLOSE MATCH — "is this portal booking already in Splose?" (migration 080)
 *
 * A calendar entered into the portal by hand queues a Splose create for every
 * client booking, though most already exist in Splose. Before anything is
 * sent, each queued create is compared with the practitioner's Splose diary
 * so the owner can LINK it to the appointment that is already there instead
 * of writing a duplicate.
 *
 * findMatches() is the pure rule (unit-tested, no database or network):
 *
 *   • the appointment must hold the same Splose client (patient) — a slot
 *     holding another client is never offered;
 *   • it must be the same practice-local day, starting within ±windowMinutes;
 *   • cancelled appointments, and appointments already held by a portal
 *     event, are never offered;
 *   • when the practitioner is known on both sides they must agree;
 *   • 'exact' = same client and the same start (under a minute apart);
 *     'likely' = same client, start within the window.
 *
 * computeMatches() is the reader: one getAppointments() list per call (the
 * splose-api list cache and rate-limit queue apply), plus the cached patient,
 * service and location lists for names. It never writes to Splose.
 */

const { isCancelledAppointment } = require('./splose-draft-sync');

const MATCH_WINDOW_MINUTES = 30;
const PRACTICE_TIME_ZONE = 'Australia/Perth';

const _dayFmt = {};
function localDay(iso, timeZone) {
  const t = new Date(iso);
  if (isNaN(t.getTime())) return null;
  const tz = timeZone || PRACTICE_TIME_ZONE;
  if (!_dayFmt[tz]) _dayFmt[tz] = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  return _dayFmt[tz].format(t);
}

function minutesBetween(a, b) {
  const x = new Date(a).getTime(), y = new Date(b).getTime();
  if (isNaN(x) || isNaN(y)) return Infinity;
  return Math.abs(x - y) / 60000;
}

function patientIdsOf(appt) {
  return (appt.patients || appt.appointmentPatients || []).map(p => String(p.patientId));
}

/**
 * Candidates for one queued create.
 *   row           { start, end, patientId, practitionerId? }
 *   appointments  normalised Splose appointments (splose-api shape)
 *   linkedIds     Set of Splose ids already held by a portal event
 *   names         { patients: Map, services: Map, locations: Map } id → name (optional)
 * Returns [{ sploseAppointmentId, start, end, patientName, serviceName,
 *            locationName, confidence, minutesApart }], exact first, nearest first.
 */
function findMatches({ row, appointments, linkedIds, names, windowMinutes = MATCH_WINDOW_MINUTES, timeZone = PRACTICE_TIME_ZONE }) {
  if (!row || !row.start || row.patientId === undefined || row.patientId === null || row.patientId === '') return [];
  const linked = linkedIds || new Set();
  const n = names || {};
  const pick = (m, id) => (m && id !== undefined && id !== null && m.get(String(id))) || null;
  const day = localDay(row.start, timeZone);
  const patient = String(row.patientId);
  const out = [];
  for (const a of appointments || []) {
    if (!a || a.id === undefined || a.id === null || !a.start) continue;
    if (linked.has(String(a.id))) continue;
    if (isCancelledAppointment(a)) continue;
    if (row.practitionerId && a.practitionerId && String(row.practitionerId) !== String(a.practitionerId)) continue;
    if (!patientIdsOf(a).includes(patient)) continue;
    if (localDay(a.start, timeZone) !== day) continue;
    const apart = minutesBetween(row.start, a.start);
    if (apart > windowMinutes) continue;
    out.push({
      sploseAppointmentId: String(a.id),
      start: a.start, end: a.end || null,
      patientName: pick(n.patients, patient),
      serviceName: pick(n.services, a.serviceId),
      locationName: pick(n.locations, a.locationId),
      confidence: apart < 1 ? 'exact' : 'likely',
      minutesApart: Math.round(apart),
    });
  }
  return out.sort((x, y) => (x.confidence === y.confidence ? x.minutesApart - y.minutesApart : x.confidence === 'exact' ? -1 : 1));
}

/**
 * Rows a bulk "link all exact matches" may link: exactly one candidate, and
 * it is exact, and no other row claims the same Splose appointment.
 * matchesByRow: { queueId: matches[] } → [{ queueId, sploseAppointmentId }]
 */
function planBulkLink(matchesByRow) {
  const singles = [];
  const claims = new Map();
  for (const [queueId, list] of Object.entries(matchesByRow || {})) {
    if (!Array.isArray(list) || list.length !== 1 || list[0].confidence !== 'exact') continue;
    singles.push({ queueId, sploseAppointmentId: list[0].sploseAppointmentId });
    claims.set(list[0].sploseAppointmentId, (claims.get(list[0].sploseAppointmentId) || 0) + 1);
  }
  return singles.filter(s => claims.get(s.sploseAppointmentId) === 1);
}

function ymd(ms) { return new Date(ms).toISOString().slice(0, 10); }

async function practitionerFor(db, userId) {
  const { rows } = await db.pool.query(
    'SELECT splose_practitioner_id FROM therapist_profiles WHERE user_id = $1 LIMIT 1', [userId]);
  return rows[0] && rows[0].splose_practitioner_id ? String(rows[0].splose_practitioner_id) : null;
}

async function nameMaps(sploseApi) {
  const out = { patients: new Map(), services: new Map(), locations: new Map() };
  const load = async (fn, map, label) => {
    if (typeof sploseApi[fn] !== 'function') return;
    try { for (const x of (await sploseApi[fn]()) || []) map.set(String(x.id), label(x)); } catch (_) { /* names are a nicety */ }
  };
  await load('getPatients', out.patients, p => p.fullName || [p.firstname, p.lastname].filter(Boolean).join(' ') || null);
  await load('getServices', out.services, s => s.title || s.name || null);
  await load('getLocations', out.locations, l => l.title || l.name || null);
  return out;
}

/**
 * Candidates for every live queued create of one user.
 *   rows   queue rows joined to their event (listPending shape)
 *   opts.fresh  bypass the 10-minute Splose list cache (bulk link verifies)
 * Returns { matches: { queueId: [...] }, appointments } — appointments is the
 * filtered list read, for callers that verify against it.
 */
async function computeMatches({ db, sploseApi, userId, rows, fresh = false, withNames = true }) {
  const creates = (rows || []).filter(r => r.action === 'create' && ['pending', 'failed'].includes(r.status) && !r.splose_id);
  if (!creates.length) return { matches: {}, appointments: [] };
  const starts = creates.map(r => new Date((r.payload && r.payload.start) || r.start_time).getTime()).filter(t => !isNaN(t));
  if (!starts.length) return { matches: {}, appointments: [] };
  // One read for the whole span, a day of margin each side for the time zone.
  const from = ymd(Math.min(...starts) - 86400000), to = ymd(Math.max(...starts) + 86400000);
  const appts = await sploseApi.getAppointments(from, to, null, fresh ? { fresh: true } : {});
  const ids = (appts || []).map(a => String(a.id));
  const linked = new Set();
  if (ids.length) {
    // Any portal row — live or cancelled — holding the id owns it.
    const { rows: held } = await db.pool.query(
      `SELECT DISTINCT splose_id FROM events WHERE splose_id = ANY($1::text[])`, [ids]);
    for (const h of held) linked.add(String(h.splose_id));
  }
  const userPractitioner = await practitionerFor(db, userId);
  const names = withNames ? await nameMaps(sploseApi) : null;
  const matches = {};
  for (const r of creates) {
    const p = r.payload || {};
    matches[r.id] = findMatches({
      row: { start: p.start || r.start_time, end: p.end || r.end_time, patientId: p.patientId || r.client_id, practitionerId: p.practitionerId || userPractitioner },
      appointments: appts, linkedIds: linked, names,
    });
  }
  return { matches, appointments: appts || [], linkedIds: linked, practitionerId: userPractitioner };
}

module.exports = {
  MATCH_WINDOW_MINUTES,
  PRACTICE_TIME_ZONE,
  findMatches,
  planBulkLink,
  computeMatches,
  localDay,
  _practitionerFor: practitionerFor,
};
