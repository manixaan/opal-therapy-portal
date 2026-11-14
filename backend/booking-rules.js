/**
 * BOOKING RULES — which booking types need a client, and one booking per click.
 *
 * The booking panel sends `booking: { kind, clientId?, clientName? }` with
 * POST /api/outlook/events. The server derives the group from the kind (never
 * from the caller) and enforces the client rule the panel shows:
 *
 *   direct  (Direct services)      client REQUIRED
 *   report  (Requested reports)    client REQUIRED
 *   nf2f    (Non-face-to-face)     client OPTIONAL
 *   travel  (Travel block)         client OPTIONAL — billable travel, defined
 *                                  by a start and an end address (both REQUIRED)
 *           (flight, flight-checkin) no client — Calendar → Add a flight
 *                                  (flights.js); the flight's details REQUIRED
 *   other   (PD, supervision, lunch) no client
 *
 * Location is optional for every kind — an event without an address means the
 * therapist has not moved (travel.js), so nothing here looks at it.
 *
 * A request without `booking` is a legacy caller and is left alone.
 */

const DIRECT_KINDS = ['assessment', 'assessment-ei', 'initial', 'initial-ei', 'mdt', 'mdu',
  'telehealth', 'telehealth-ei', 'therapy', 'therapy-ei'];
const REPORT_KINDS = ['fca', 'at-report', 'progress-report', 'support-letter'];
const NF2F_KINDS   = ['case-noting', 'case-management', 'resource-prep', 'emails', 'phone-calls'];
const TRAVEL_KINDS = ['travel-block', 'flight', 'flight-checkin'];
const FLIGHT_KINDS = ['flight', 'flight-checkin'];
const OTHER_KINDS  = ['pd', 'supervision', 'lunch', 'custom'];
const MAX_NF2F_CLIENTS = 20;

const GROUP_BY_KIND = Object.freeze(Object.assign({},
  ...DIRECT_KINDS.map(k => ({ [k]: 'direct' })),
  ...REPORT_KINDS.map(k => ({ [k]: 'report' })),
  ...NF2F_KINDS.map(k => ({ [k]: 'nf2f' })),
  ...TRAVEL_KINDS.map(k => ({ [k]: 'travel' })),
  ...OTHER_KINDS.map(k => ({ [k]: 'other' })),
));
const CLIENT_RULE = Object.freeze({ direct: 'required', report: 'required', nf2f: 'optional', travel: 'optional', other: 'none' });

function bookingGroup(kind) {
  return Object.prototype.hasOwnProperty.call(GROUP_BY_KIND, kind) ? GROUP_BY_KIND[kind] : null;
}

function cleanClientId(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v.trim())) return v.trim();
  return null;
}

/**
 * PURE — check a POST /api/outlook/events body against the client rules.
 * Returns { ok: true, booking } (booking null for a legacy caller) or
 * { ok: false, error }.
 */
function validateBooking(body) {
  const b = body && body.booking;
  if (b === undefined || b === null) return { ok: true, booking: null };
  if (typeof b !== 'object' || typeof b.kind !== 'string') return { ok: false, error: 'booking.kind is required' };
  const group = bookingGroup(b.kind);
  if (!group) return { ok: false, error: 'Unknown booking type' };
  const rule = CLIENT_RULE[group];
  // A direct service's client also rides in the Splose draft payload.
  const splosePatient = body.splose && body.splose.patientId != null ? cleanClientId(body.splose.patientId) : null;
  let clientId = b.clientId != null && b.clientId !== '' ? cleanClientId(b.clientId) : null;
  if (b.clientId != null && b.clientId !== '' && !clientId) return { ok: false, error: 'Invalid client' };
  if (!clientId && group === 'direct') clientId = splosePatient;
  if (rule === 'required' && !clientId) {
    return { ok: false, error: group === 'direct' ? 'Choose the client for this service' : 'Choose the client this report is for' };
  }
  if (rule === 'none') clientId = null;
  const clientName = clientId && typeof b.clientName === 'string' ? b.clientName.trim().slice(0, 120) || null : null;
  if (group === 'nf2f') {
    // Non-face-to-face (11 Oct 2026): several clients, or none. With none the
    // block is not billable; with clients its timed work is split between them
    // (billing/nf2f-timer.js). `clientId` stays the first, for older readers.
    const clients = [];
    const raw = Array.isArray(b.clients) ? b.clients : (clientId ? [{ clientId, clientName }] : []);
    if (raw.length > MAX_NF2F_CLIENTS) return { ok: false, error: `At most ${MAX_NF2F_CLIENTS} clients on one block` };
    for (const c of raw) {
      const id = c && c.clientId != null && c.clientId !== '' ? cleanClientId(c.clientId) : null;
      if (!id) return { ok: false, error: 'Invalid client' };
      if (clients.some(x => x.clientId === id)) continue;
      const name = typeof c.clientName === 'string' ? c.clientName.trim().slice(0, 120) || null : null;
      clients.push({ clientId: id, clientName: name });
    }
    if (!clients.length) return { ok: true, booking: { kind: b.kind, group, clientId: null, clientName: null } };
    return { ok: true, booking: { kind: b.kind, group, clientId: clients[0].clientId, clientName: clients[0].clientName, clients } };
  }
  if (FLIGHT_KINDS.includes(b.kind)) {
    // A flight and its check-in buffer (14 Nov 2026) carry the flight they
    // belong to — what the lookup or the therapist gave — never a client.
    const flight = cleanFlight(b.flight);
    if (!flight) return { ok: false, error: 'A flight needs its number and departure time' };
    return { ok: true, booking: { kind: b.kind, group, clientId: null, clientName: null, flight } };
  }
  if (group === 'travel') {
    // A travel block (10 Nov 2026) is its start and end address; the route
    // minutes and distance are what Google gave the panel, kept for the record.
    const route = cleanTravelRoute(b.route);
    if (!route) return { ok: false, error: 'A travel block needs a start and an end location' };
    return { ok: true, booking: { kind: b.kind, group, clientId, clientName, route } };
  }
  return { ok: true, booking: { kind: b.kind, group, clientId, clientName } };
}

function cleanAddress(v) {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 300) || null : null;
}

/* PURE — { from, to, minutes?, distanceKm? } or null when either end is missing. */
function cleanTravelRoute(r) {
  if (!r || typeof r !== 'object') return null;
  const from = cleanAddress(r.from), to = cleanAddress(r.to);
  if (!from || !to) return null;
  const out = { from, to };
  const min = Number(r.minutes);
  if (Number.isFinite(min) && min > 0 && min <= 24 * 60) out.minutes = Math.round(min);
  const km = Number(r.distanceKm);
  if (Number.isFinite(km) && km >= 0 && km <= 5000) out.distanceKm = Math.round(km * 10) / 10;
  return out;
}

function cleanText(v, max) {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  return String(v).replace(/[\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) || null;
}
function cleanIso(v) {
  if (typeof v !== 'string' || v.length > 40) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
function cleanAirport(a) {
  if (!a || typeof a !== 'object') return null;
  const iata = typeof a.iata === 'string' && /^[A-Za-z0-9]{3}$/.test(a.iata.trim()) ? a.iata.trim().toUpperCase() : null;
  const name = cleanText(a.name, 120);
  if (!iata && !name) return null;
  return { iata, name };
}

/* PURE — the flight a flight / check-in block belongs to: a fixed set of
   short fields (no free-form blobs), or null without a number and a
   departure time. */
function cleanFlight(f) {
  if (!f || typeof f !== 'object') return null;
  const number = typeof f.number === 'string' ? f.number.replace(/\s+/g, '').toUpperCase() : '';
  if (!/^[A-Z0-9]{2,3}\d{1,4}[A-Z]?$/.test(number)) return null;
  const depUtc = cleanIso(f.depUtc);
  if (!depUtc) return null;
  const out = { number, depUtc };
  const arrUtc = cleanIso(f.arrUtc);
  if (arrUtc && Date.parse(arrUtc) > Date.parse(depUtc)) out.arrUtc = arrUtc;
  for (const k of ['revisedDepUtc', 'revisedArrUtc']) { const v = cleanIso(f[k]); if (v) out[k] = v; }
  const airline = cleanText(f.airline, 80); if (airline) out.airline = airline;
  const from = cleanAirport(f.from); if (from) out.from = from;
  const to = cleanAirport(f.to); if (to) out.to = to;
  for (const k of ['terminal', 'gate', 'arrTerminal']) { const v = cleanText(f[k], 20); if (v) out[k] = v; }
  const status = cleanText(f.status, 40); if (status) out.status = status;
  if (f.source === 'lookup' || f.source === 'manual') out.source = f.source;
  // The lookup date (the flight's local departure date) lets live status find it again.
  if (typeof f.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f.date)) out.date = f.date;
  // The therapist's own buffers, so "Update times to revised" finds the drives.
  for (const k of ['bufferMin', 'afterLandingMin']) {
    const n = Number(f[k]);
    if (f[k] !== null && f[k] !== '' && Number.isInteger(n) && n >= 0 && n <= 600) out[k] = n;
  }
  return out;
}

/**
 * One booking per deliberate click. The panel sends a fresh `requestId` per
 * Create; a repeat of the same id (double-click, network retry) gets the first
 * request's answer instead of a second Outlook event. Only successful answers
 * are kept — a failed request can be retried. In memory and per instance: it
 * guards the seconds around a click, it is not a ledger.
 */
function createIdempotencyStore({ ttlMs = 10 * 60 * 1000, max = 5000 } = {}) {
  const entries = new Map(); // key → { at, promise, resolve }
  function sweep(now) {
    for (const [k, e] of entries) if (now - e.at > ttlMs) entries.delete(k);
    while (entries.size > max) entries.delete(entries.keys().next().value);
  }
  return {
    /* { fresh: true, settle(status, body) } or { fresh: false, wait } where wait
       resolves to the first answer, or null if that one failed. */
    claim(key, now = Date.now()) {
      sweep(now);
      const hit = entries.get(key);
      if (hit) return { fresh: false, wait: hit.promise };
      let resolve;
      const promise = new Promise(r => { resolve = r; });
      entries.set(key, { at: now, promise, resolve });
      return {
        fresh: true,
        settle(status, body) {
          const ok = status >= 200 && status < 300;
          if (!ok) entries.delete(key);
          resolve(ok ? { status, body } : null);
        },
      };
    },
    size() { return entries.size; },
  };
}

function cleanRequestId(v) {
  return typeof v === 'string' && /^[A-Za-z0-9-]{8,80}$/.test(v) ? v : null;
}

module.exports = {
  DIRECT_KINDS, REPORT_KINDS, NF2F_KINDS, TRAVEL_KINDS, FLIGHT_KINDS, OTHER_KINDS, CLIENT_RULE, MAX_NF2F_CLIENTS,
  bookingGroup, validateBooking, cleanFlight, createIdempotencyStore, cleanRequestId,
};
