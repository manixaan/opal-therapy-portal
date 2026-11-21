'use strict';

/**
 * CALENDAR TRAVEL MINUTES (migration 090, 21 Nov 2026).
 *
 * The calendar prices each travel leg with traffic at departure time
 * (frontend travel.js). Invoicing bills those same minutes, so the invoice
 * matches the calendar the therapist saw (owner decision 21 Nov 2026).
 *
 *   recordDays(q, userId, days, now)  the calendar's legs for up to 7 days
 *   loadForDays(q, keys)              Map "<userId>|<date>" → Map "<o>|<d>" → minutes
 *
 * Rules (fail-closed):
 *   • a leg must belong to one of the user's own live events on that date;
 *   • today or later: the day's set replaces what was stored;
 *   • a past day is frozen: written only when nothing is stored for it yet,
 *     so a later redraw (with different traffic) never changes billed minutes;
 *   • a day already on a finalised invoice is never rewritten;
 *   • at most 60 days back and 14 ahead. Rows hold addresses and minutes only.
 */

const { canonAddr } = require('./route-facts');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TZ = 'Australia/Perth';
const MAX_DAYS = 7, MAX_LEGS = 40, BACK_DAYS = 60, AHEAD_DAYS = 14;

function perthDate(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function text(v, max) { return typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : ''; }

/** PURE — validate one day. Returns { ok, date, legs } or { ok:false, error }. */
function validateDay(body, now = new Date()) {
  const date = body && body.date;
  if (!DATE_RE.test(String(date))) return { ok: false, error: 'date must be YYYY-MM-DD' };
  const today = perthDate(now);
  if (date < perthDate(new Date(now.getTime() - BACK_DAYS * 86400e3)) || date > perthDate(new Date(now.getTime() + AHEAD_DAYS * 86400e3))) {
    return { ok: false, error: 'date out of range' };
  }
  const raw = Array.isArray(body.legs) ? body.legs : null;
  if (!raw || raw.length > MAX_LEGS) return { ok: false, error: 'legs must be a list of up to 40' };
  const legs = [], seen = new Set();
  for (const l of raw) {
    const origin = text(l && l.origin, 300), destination = text(l && l.destination, 300);
    const minutes = Number(l && l.minutes);
    if (!origin || !destination || !Number.isInteger(minutes) || minutes <= 0 || minutes > 1440) return { ok: false, error: 'each leg needs origin, destination and whole minutes' };
    if (!UUID_RE.test(String(l.ownerEventId || ''))) return { ok: false, error: 'each leg needs its event' };
    const oc = canonAddr(origin), dc = canonAddr(destination);
    if (!oc || !dc || oc === dc) continue;
    const k = oc + '|' + dc;
    if (seen.has(k)) continue;                     // the same drive twice in a day: first one wins
    seen.add(k);
    legs.push({ origin, destination, originCanon: oc, destinationCanon: dc, minutes,
      ownerEventId: String(l.ownerEventId), side: l.side === 'before' || l.side === 'after' ? l.side : null });
  }
  return { ok: true, date, legs, past: date < today };
}

async function recordDay(q, userId, day) {
  const owners = [...new Set(day.legs.map(l => l.ownerEventId))];
  if (owners.length) {
    const { rows } = await q.query(
      `SELECT id FROM events WHERE id = ANY($1::uuid[]) AND user_id = $2 AND COALESCE(is_deleted, FALSE) = FALSE
          AND ((start_time AT TIME ZONE 'UTC') AT TIME ZONE '${TZ}')::date = $3::date`, [owners, userId, day.date]);
    if (rows.length !== owners.length) return { date: day.date, status: 409, body: { error: 'A leg does not belong to your calendar on this day' } };
  }
  const { rows: fin } = await q.query(
    `SELECT 1 FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id JOIN events e ON e.id = l.calendar_event_id
      WHERE e.user_id = $1 AND l.component IN ('TRAVEL_LABOUR','TRAVEL_KM') AND l.line_status = 'ACTIVE'
        AND l.service_date = $2::date AND i.status NOT IN ('DRAFT','NEEDS_ATTENTION') LIMIT 1`, [userId, day.date]);
  if (fin.length) return { date: day.date, status: 200, body: { kept: true, reason: 'invoiced' } };
  if (day.past) {
    const { rows: had } = await q.query(`SELECT 1 FROM calendar_travel_legs WHERE user_id = $1 AND local_date = $2 LIMIT 1`, [userId, day.date]);
    if (had.length) return { date: day.date, status: 200, body: { kept: true, reason: 'past' } };
  }
  await q.query(`DELETE FROM calendar_travel_legs WHERE user_id = $1 AND local_date = $2`, [userId, day.date]);
  for (const l of day.legs) {
    await q.query(
      `INSERT INTO calendar_travel_legs (user_id, local_date, origin_canon, destination_canon, origin, destination, minutes, owner_event_id, side)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (user_id, local_date, origin_canon, destination_canon) DO NOTHING`,
      [userId, day.date, l.originCanon, l.destinationCanon, l.origin, l.destination, l.minutes, l.ownerEventId, l.side]);
  }
  await q.query(`SELECT billing_flag_event_change_for($1, $2)`, [day.legs[0] ? day.legs[0].ownerEventId : null, 'calendar travel minutes changed']).catch(() => {});
  return { date: day.date, status: 200, body: { recorded: day.legs.length } };
}

/** Record up to 7 days for a user, each in its own transaction. */
async function recordDays(pool, userId, days, now = new Date()) {
  if (!Array.isArray(days) || !days.length || days.length > MAX_DAYS) return { status: 400, body: { error: 'Send 1–7 days' } };
  const results = [];
  for (const d of days) {
    const v = validateDay(d, now);
    if (!v.ok) { results.push({ date: d && d.date, status: 400, body: { error: v.error } }); continue; }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`ctl:${userId}:${v.date}`]);
      const r = await recordDay(client, userId, v);
      await client.query(r.status === 200 ? 'COMMIT' : 'ROLLBACK');
      results.push(r);
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Calendar travel minutes error:', e.message);
      results.push({ date: v.date, status: 500, body: { error: 'Could not record travel minutes' } });
    } finally { client.release(); }
  }
  return { status: 200, body: { results } };
}

/** keys: [{ userId, date }]. Returns Map "<userId>|<date>" → Map "<originCanon>|<destCanon>" → minutes. */
async function loadForDays(q, keys) {
  const out = new Map();
  if (!keys.length) return out;
  const { rows } = await q.query(
    `SELECT user_id, to_char(local_date, 'YYYY-MM-DD') AS d, origin_canon, destination_canon, minutes
       FROM calendar_travel_legs
      WHERE (user_id, local_date) IN (SELECT * FROM unnest($1::uuid[], $2::date[]))`,
    [keys.map(k => k.userId), keys.map(k => k.date)]);
  for (const r of rows) {
    const k = `${r.user_id}|${r.d}`;
    if (!out.has(k)) out.set(k, new Map());
    out.get(k).set(`${r.origin_canon}|${r.destination_canon}`, Number(r.minutes));
  }
  return out;
}

function minutesFor(dayMap, origin, destination) {
  if (!dayMap) return null;
  const v = dayMap.get(`${canonAddr(origin)}|${canonAddr(destination)}`);
  return Number.isInteger(v) && v > 0 ? v : null;
}

module.exports = { validateDay, recordDays, loadForDays, minutesFor, perthDate };
