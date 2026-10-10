'use strict';

/**
 * SESSION MMM — the zone a person set by hand for one session
 * (calendar_event_mmm, migration 074). Invoicing reads it before the
 * locality lookup (invoice-generation.js sessionZone).
 *
 *   BOOKING — chosen in the Smart Booking panel. Stored only when it differs
 *             from a confident lookup on the session address (or the lookup
 *             was not confident), so an untouched panel keeps following the
 *             address. Cleared when the session's address changes.
 *   OWNER   — set in Invoicing (manage_billing); survives an address change.
 *
 * Every write is audited in billing_audit_events.
 */

const Loc = require('./mmm-locality');
const { recordAudit } = require('./billing-audit');

function validZone(z) {
  const n = Number(z);
  return Number.isInteger(n) && n >= 1 && n <= 7 ? n : null;
}

async function eventOrg(q, eventId) {
  const { rows: [r] } = await q.query(
    `SELECT COALESCE(e.organisation_id, u.organisation_id) AS org_id
       FROM events e JOIN users u ON u.id = e.user_id WHERE e.id = $1`, [eventId]);
  return r ? r.org_id : null;
}

/** Store the panel's zone for a new booking if it is a real choice. Returns the stored zone or null. */
async function recordBookingZone(q, { eventId, zone, address, userId }) {
  const z = validZone(zone);
  if (!z) return null;
  const lookup = Loc.lookupAddress(address);
  if (lookup.confident && lookup.zone === z) return null; // the address already says so
  const orgId = await eventOrg(q, eventId);
  if (!orgId) return null;
  // An owner's zone is never overwritten by a booking.
  const { rowCount } = await q.query(
    `INSERT INTO calendar_event_mmm (event_id, organisation_id, mmm_zone, source, reason, set_by_user_id)
     VALUES ($1,$2,$3,'BOOKING',$4,$5)
     ON CONFLICT (event_id) DO UPDATE SET mmm_zone = EXCLUDED.mmm_zone, source = 'BOOKING', reason = EXCLUDED.reason,
       set_by_user_id = EXCLUDED.set_by_user_id, set_at = NOW()
     WHERE calendar_event_mmm.source = 'BOOKING'`,
    [eventId, orgId, z, lookup.confident ? `Changed at booking from MM${lookup.zone}` : `Set at booking (${Loc.reasonText(lookup.reason)})`, userId || null]);
  if (!rowCount) return null;
  await recordAudit(q, { orgId, actorUserId: userId, action: 'event.mmm_set', entityType: 'calendar_event', entityId: eventId,
    before: lookup.confident ? { lookupZone: lookup.zone } : null, after: { mmmZone: z, source: 'BOOKING' } });
  return z;
}

/** The session's address changed: a zone picked at booking no longer applies. */
async function clearBookingZone(q, { eventId, userId }) {
  const { rows } = await q.query(
    `DELETE FROM calendar_event_mmm WHERE event_id = $1 AND source = 'BOOKING' RETURNING organisation_id, mmm_zone`, [eventId]);
  if (!rows.length) return false;
  await recordAudit(q, { orgId: rows[0].organisation_id, actorUserId: userId, action: 'event.mmm_cleared', entityType: 'calendar_event',
    entityId: eventId, before: { mmmZone: rows[0].mmm_zone, source: 'BOOKING' }, after: null, reason: 'Session address changed' });
  return true;
}

/** Owner sets (zone 1–7) or clears (null) a session's zone. Run inside a transaction. */
async function setOwnerZone(tx, { orgId, eventId, zone, reason, userId }) {
  const { rows: [before] } = await tx.query(`SELECT mmm_zone, source, reason FROM calendar_event_mmm WHERE event_id = $1`, [eventId]);
  if (zone == null) await tx.query(`DELETE FROM calendar_event_mmm WHERE event_id = $1`, [eventId]);
  else {
    await tx.query(
      `INSERT INTO calendar_event_mmm (event_id, organisation_id, mmm_zone, source, reason, set_by_user_id)
       VALUES ($1,$2,$3,'OWNER',$4,$5)
       ON CONFLICT (event_id) DO UPDATE SET mmm_zone = EXCLUDED.mmm_zone, source = 'OWNER', reason = EXCLUDED.reason,
         set_by_user_id = EXCLUDED.set_by_user_id, set_at = NOW()`,
      [eventId, orgId, zone, reason, userId]);
  }
  await recordAudit(tx, { orgId, actorUserId: userId, action: zone == null ? 'event.mmm_cleared' : 'event.mmm_set',
    entityType: 'calendar_event', entityId: eventId, before: before ? { mmmZone: before.mmm_zone, source: before.source } : null,
    after: zone == null ? null : { mmmZone: zone, source: 'OWNER' }, reason });
}

/** What the session's zone is and where it comes from — for the panels. */
function describe({ setZone, setSource, setReason, address, telehealth }) {
  const lookup = telehealth ? null : Loc.lookupAddress(address);
  const out = { setZone: setZone != null ? Number(setZone) : null, setSource: setSource || null, setReason: setReason || null, telehealth: !!telehealth };
  if (lookup) {
    out.lookup = { zone: lookup.zone, confident: lookup.confident, locality: lookup.locality, postcode: lookup.postcode,
      zones: lookup.zones, suggestedZone: lookup.suggestedZone, reason: lookup.reason ? Loc.reasonText(lookup.reason) : null };
  }
  out.effectiveZone = out.setZone != null ? out.setZone : (lookup && lookup.confident ? lookup.zone : null);
  return out;
}

module.exports = { validZone, recordBookingZone, clearBookingZone, setOwnerZone, describe };
