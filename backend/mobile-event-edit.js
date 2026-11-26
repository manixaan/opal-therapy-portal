'use strict';

/**
 * MOBILE EVENT EDIT — change an appointment's client, session type or address
 * from the phone's calendar (25 Nov 2026).
 *
 * Two roads, both the portal's own:
 *
 *   • ADDRESS only → saved on the row in place (manual_location, as the
 *     portal's detail panel does: PATCH /api/outlook/events/:dbId/location),
 *     the MMM zone picked at booking cleared, Outlook mirrored under the
 *     user's sync settings, and the day's drives re-priced so travel follows
 *     the new place at once (calendar_travel_legs — the minutes the phone
 *     draws and invoicing bills; the portal re-prices with departure-time
 *     traffic the next time it draws the day).
 *
 *   • CLIENT or TYPE → the slot is REBOOKED, exactly like the portal's
 *     "Swap type" (mockup_v3.html bdSwapGo/__bspFinishSwap): a new booking
 *     through createBookingCore (client rule, Splose draft queue, Outlook
 *     mirror, billing metadata — everything a new booking gets), then the old
 *     event is removed with deleteEventCore(noCascade) — its Splose change is
 *     queued as a cancel, its Outlook copy removed. The travel booked around
 *     the slot is kept and re-pointed at the new booking, along with the
 *     session's own travel choices (custom_metadata.travel) and anything the
 *     phone linked to it (voice notes, case-note drafts).
 *
 * Fail-closed: only the caller's OWN live, timed, not-yet-started rows (the
 * move rule); an unknown type, a client outside the caller's caseload, a
 * client-rule breach or a stale view (expectedStart/End) is refused before
 * anything is written. Nothing here calls Splose for writing — the draft
 * queue does that, under the user's sync settings.
 *
 * The catalogue below mirrors the portal's BOOKING_LEAVES (mockup_v3.html)
 * for the types that can be booked without the Smart Booking panel's extra
 * steps: no travel blocks, flights, custom names, or Early Intervention /
 * MDU services (no fixed Splose service id).
 */

const dayRoute = require('./billing/day-route');
const { canonAddr } = require('./billing/route-facts');
const mobileCal = require('./mobile-calendar');
const { extractSuburb, VIRTUAL_RE } = require('./geo');

// [kind]: label, group, Splose service (direct only), portal session type
// (direct only), Outlook category (what classifyEventType reads).
const KINDS = Object.freeze({
  therapy:           { label: 'Therapy Session', group: 'direct', type: 'therapy', serviceId: 125320 },
  telehealth:        { label: 'Telehealth Therapy Session', group: 'direct', type: 'therapy', serviceId: 487597, virtual: true },
  assessment:        { label: 'Assessment Session', group: 'direct', type: 'assessment', serviceId: 131003 },
  initial:           { label: 'Initial Assessment / Consultation', group: 'direct', type: 'initial', serviceId: 125821 },
  mdt:               { label: 'MDT Meeting', group: 'direct', type: 'mdt', serviceId: 166733 },
  fca:               { label: 'Functional Capacity Assessment (FCA)', group: 'report', category: 'Report Writing' },
  'at-report':       { label: 'Assistive Technology (AT)', group: 'report', category: 'Report Writing' },
  'progress-report': { label: 'Progress Report', group: 'report', category: 'Report Writing' },
  'support-letter':  { label: 'Support Letter', group: 'report', category: 'Report Writing' },
  'case-noting':     { label: 'Case Noting', group: 'nf2f', category: 'Admin' },
  'case-management': { label: 'Case Management', group: 'nf2f', category: 'Case Management' },
  'resource-prep':   { label: 'Resource Preparation', group: 'nf2f', category: 'Report Writing' },
  emails:            { label: 'Emails', group: 'nf2f', category: 'Admin' },
  'phone-calls':     { label: 'Phone Calls', group: 'nf2f', category: 'Admin' },
  pd:                { label: 'Professional development', group: 'other', category: 'PD' },
  supervision:       { label: 'Supervision', group: 'other', category: 'PD' },
  lunch:             { label: 'Lunch', group: 'other', category: 'Lunch' },
});
const CLIENT_RULE = Object.freeze({ direct: 'required', report: 'required', nf2f: 'optional', other: 'none' });
const GROUP_LABEL = Object.freeze({ direct: 'Client sessions', report: 'Reports', nf2f: 'Non-face-to-face', other: 'Non-billable' });

/** The catalogue as the phone shows it, in the portal's order. */
function kindList() {
  return Object.entries(KINDS).map(([kind, k]) => ({
    kind, label: k.label, group: k.group, groupLabel: GROUP_LABEL[k.group], client: CLIENT_RULE[k.group],
    ...(k.virtual ? { virtual: true } : {}),
  }));
}

const meta = (ev) => (ev && ev.custom_metadata && typeof ev.custom_metadata === 'object' ? ev.custom_metadata : {});

/** The booking type the event was made as, when the phone can rebook it as such; else null. */
function currentKind(ev) {
  const k = meta(ev).booking && meta(ev).booking.kind;
  return typeof k === 'string' && Object.prototype.hasOwnProperty.call(KINDS, k) ? k : null;
}

/** { id, name } of the event's client, or null. */
function currentClient(ev) {
  const b = meta(ev).booking || {};
  const first = Array.isArray(b.clients) && b.clients[0];
  const id = b.clientId != null ? b.clientId : first && first.clientId != null ? first.clientId : ev.client_id;
  if (id == null || id === '') return null;
  const name = b.clientName || (first && first.clientName) || ev.client_name || null;
  return { id: String(id), name: name ? String(name) : null };
}

/** May the caller edit this event from the phone? Same rule as a move. */
function canEditEvent(ev, userId, now = new Date()) {
  const v = mobileCal.canMoveEvent(ev, userId, now);
  if (!v.ok) return v;
  if (ev.event_type === 'travel') return { ok: false, reason: 'type' };
  return { ok: true };
}

/**
 * PURE — clean the requested address. undefined = not changing it;
 * { clear: true } = no address (the therapist has not moved — travel.js);
 * { address, lat, lng } otherwise. Returns { error } for bad input.
 */
function cleanAddressInput(v) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return { clear: true };
  const obj = typeof v === 'string' ? { address: v } : v;
  if (!obj || typeof obj !== 'object') return { error: 'Invalid address' };
  const address = typeof obj.address === 'string' ? obj.address.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200) : '';
  if (!address) return { clear: true };
  const lat = Number(obj.lat), lng = Number(obj.lng);
  const hasLL = obj.lat != null && obj.lng != null && Number.isFinite(lat) && Number.isFinite(lng)
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  return { address, lat: hasLL ? lat : null, lng: hasLL ? lng : null };
}

/**
 * PURE — what the rebook asks createBookingCore for, composed the way the
 * portal's confirmBooking does: a client session is 'Client Appointment —
 * Name' in 'Client Appointments' with its Splose draft; anything else is its
 * label (— client), its category, and the booking metadata.
 */
function composeBooking({ kind, client, address, startTime, endTime }) {
  const k = KINDS[kind];
  const name = client && client.name ? client.name : '';
  const body = { startTime, endTime, ...(address ? { location: address } : {}) };
  if (k.group === 'direct') {
    return { ...body,
      title: name ? `Client Appointment — ${name}` : 'Client Appointment',
      categories: ['Client Appointments'],
      booking: { kind, clientId: client.id, clientName: name || null },
      splose: { patientId: client.id, patientName: name, sessionType: k.type, serviceId: k.serviceId, caseId: null, note: '' } };
  }
  const withClient = CLIENT_RULE[k.group] !== 'none' && client;
  return { ...body,
    title: withClient && name ? `${k.label} — ${name}` : k.label,
    categories: [k.category],
    booking: k.group === 'nf2f'
      ? { kind, clients: withClient ? [{ clientId: client.id, clientName: name || null }] : [] }
      : { kind, clientId: withClient ? client.id : null, clientName: withClient ? name || null : null } };
}

// ── Travel: price the day's drives after an address changes ─────────────────

const MAX_PRICED = 10;

/**
 * Re-price a Perth day's legs and store them as the calendar's minutes.
 * Stored minutes are reused; only drives the day has never priced go to the
 * maps provider (at most MAX_PRICED). Never throws — travel is a follow-on.
 * @returns {Promise<{priced:number, recorded:boolean}>}
 */
async function repriceDay({ pool, userId, date, now = new Date(), provider, minutesStore }) {
  try {
    const [u, ev] = await Promise.all([
      pool.query('SELECT id, work_location_schedule, default_work_location FROM users WHERE id = $1', [userId]),
      pool.query(
        `SELECT * FROM events WHERE user_id = $1 AND (is_deleted IS NULL OR is_deleted = FALSE)
            AND ((start_time AT TIME ZONE 'UTC') AT TIME ZONE 'Australia/Perth')::date = $2::date`, [userId, date]),
    ]);
    const user = u.rows[0];
    if (!user) return { priced: 0, recorded: false };
    const sessions = ev.rows.filter((e) => mobileCal.isPhysicalStop(e, VIRTUAL_RE))
      .sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
    if (!sessions.length) return { priced: 0, recorded: false };

    const stored = (await minutesStore.loadForDays(pool, [{ userId, date }])).get(`${userId}|${date}`) || new Map();
    const known = new Map(stored);
    const key = (o, d) => `${canonAddr(o)}|${canonAddr(d)}`;
    const lookup = (o, d) => { const v = known.get(key(o, d)); return Number.isInteger(v) && v > 0 ? v : null; };

    // Every drive the day might need: the direct legs and the trips home.
    const want = [...dayRoute.candidatePairs({ user, date, sessions }),
      ...dayRoute.buildDayLegs({ user, date, sessions, minutesFor: lookup }).legs]
      .map((p) => ({ origin: p.origin, destination: p.destination }))
      .filter((p) => p.origin && p.destination && canonAddr(p.origin) !== canonAddr(p.destination));
    const missing = [];
    const seen = new Set();
    for (const p of want) {
      const k = key(p.origin, p.destination);
      if (seen.has(k) || lookup(p.origin, p.destination) != null) continue;
      seen.add(k);
      missing.push(p);
    }
    const toPrice = missing.slice(0, MAX_PRICED);
    const answers = await Promise.all(toPrice.map((p) => Promise.resolve(provider.route(p.origin, p.destination)).catch(() => null)));
    let priced = 0;
    toPrice.forEach((p, i) => {
      const m = answers[i] && Number(answers[i].minutes);
      if (Number.isFinite(m) && m > 0) { known.set(key(p.origin, p.destination), Math.max(1, Math.round(m))); priced += 1; }
    });

    const route = dayRoute.buildDayLegs({ user, date, sessions, minutesFor: lookup });
    const legs = route.legs.map((l) => {
      const into = l.kind !== 'RETURN';
      return { origin: l.origin, destination: l.destination, minutes: lookup(l.origin, l.destination),
        ownerEventId: String(into ? l.toEventId : l.fromEventId), side: into ? 'before' : 'after' };
    }).filter((l) => l.minutes != null && l.ownerEventId && l.ownerEventId !== 'null');
    if (!legs.length) return { priced, recorded: false };
    const r = await minutesStore.recordDays(pool, userId, [{ date, legs }], now);
    const day = r.body && r.body.results && r.body.results[0];
    return { priced, recorded: !!(day && day.status === 200 && day.body && day.body.recorded != null) };
  } catch (err) {
    return { priced: 0, recorded: false, error: err.message };
  }
}

module.exports = {
  KINDS, CLIENT_RULE, kindList, currentKind, currentClient, canEditEvent,
  cleanAddressInput, composeBooking, repriceDay, extractSuburb,
};
