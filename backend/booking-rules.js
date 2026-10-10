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
const NF2F_KINDS   = ['case-noting', 'resource-prep', 'emails', 'phone-calls'];
const OTHER_KINDS  = ['pd', 'supervision', 'lunch'];

const GROUP_BY_KIND = Object.freeze(Object.assign({},
  ...DIRECT_KINDS.map(k => ({ [k]: 'direct' })),
  ...REPORT_KINDS.map(k => ({ [k]: 'report' })),
  ...NF2F_KINDS.map(k => ({ [k]: 'nf2f' })),
  ...OTHER_KINDS.map(k => ({ [k]: 'other' })),
));
const CLIENT_RULE = Object.freeze({ direct: 'required', report: 'required', nf2f: 'optional', other: 'none' });

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
  return { ok: true, booking: { kind: b.kind, group, clientId, clientName } };
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
  DIRECT_KINDS, REPORT_KINDS, NF2F_KINDS, OTHER_KINDS, CLIENT_RULE,
  bookingGroup, validateBooking, createIdempotencyStore, cleanRequestId,
};
