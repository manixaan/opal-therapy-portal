'use strict';

/**
 * Travel-block delete cascade — pure selection rules.
 *
 * When a calendar event is deleted, the travel blocks that exist purely to
 * serve it should go with it. Two mechanisms decide which blocks those are:
 *
 *   1. EXPLICIT LINK — travel blocks created after migration 016 carry
 *      related_event_id = the appointment they serve. Linked blocks always
 *      cascade with their appointment.
 *
 *   2. ADJACENCY FALLBACK — travel blocks created before the linkage column
 *      existed have related_event_id = NULL. For those, a conservative
 *      adjacency rule applies: the block cascades only when it visibly
 *      "belongs" to the deleted event and to nothing else:
 *        - same user, event_type='travel', not soft-deleted, and
 *        - one end touches the deleted event (exact touch, or a gap of at
 *          most TOLERANCE_MIN minutes), and
 *        - the OTHER end does NOT touch any other surviving non-travel
 *          event. A travel block sandwiched between two surviving
 *          appointments is never deleted.
 *
 * Travel blocks explicitly linked to a DIFFERENT event never cascade,
 * regardless of adjacency.
 *
 * These functions are pure (no DB, no clock) so the rules are unit-testable;
 * the DELETE route fetches candidate rows and calls collectCascadeTravelBlocks.
 */

const TOLERANCE_MIN = 5;

/** Absolute distance between two timestamps, in minutes. */
function minutesApart(a, b) {
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (Number.isNaN(ta) || Number.isNaN(tb)) return Infinity;
  return Math.abs(ta - tb) / 60000;
}

/** True when two timestamps touch: exact, or within toleranceMin minutes. */
function touches(a, b, toleranceMin = TOLERANCE_MIN) {
  return minutesApart(a, b) <= toleranceMin;
}

/**
 * Select the travel blocks that should be deleted together with an event.
 *
 * @param {object} deletedEvent  The event being deleted:
 *                               { id, start_time, end_time }
 * @param {Array}  otherEvents   Surviving (non-deleted) events for the same
 *                               user near the deleted event — travel blocks
 *                               AND regular events. Each row needs:
 *                               { id, event_type, start_time, end_time,
 *                                 related_event_id }
 * @param {object} [opts]        { toleranceMin } — gap tolerance in minutes.
 * @returns {Array} subset of otherEvents (travel rows) that should cascade.
 */
function collectCascadeTravelBlocks(deletedEvent, otherEvents, opts = {}) {
  if (!deletedEvent || !deletedEvent.id || !Array.isArray(otherEvents)) return [];
  const tol = Number.isFinite(opts.toleranceMin) ? opts.toleranceMin : TOLERANCE_MIN;

  const survivors = otherEvents.filter((e) => e && e.id !== deletedEvent.id && !e.is_deleted);
  const travelBlocks = survivors.filter((e) => e.event_type === 'travel');
  const nonTravel   = survivors.filter((e) => e.event_type !== 'travel');

  const cascade = [];
  for (const block of travelBlocks) {
    // 1. Explicitly linked to the deleted event — always cascades.
    if (block.related_event_id === deletedEvent.id) {
      cascade.push(block);
      continue;
    }
    // Linked to a DIFFERENT event — never cascades here.
    if (block.related_event_id) continue;

    // 2. Adjacency fallback for legacy unlinked blocks.
    if (!deletedEvent.start_time || !deletedEvent.end_time) continue;
    if (!block.start_time || !block.end_time) continue;

    const touchesBefore = touches(block.end_time, deletedEvent.start_time, tol); // travel → event
    const touchesAfter  = touches(block.start_time, deletedEvent.end_time, tol); // event → travel
    if (!touchesBefore && !touchesAfter) continue;

    // The other end must be free: if it touches ANY other surviving
    // non-travel event, the block may belong to that event — keep it.
    // (A block touching the deleted event on BOTH ends checks both.)
    let claimedElsewhere = false;
    for (const ev of nonTravel) {
      if (!ev.start_time || !ev.end_time) continue;
      if (touchesBefore && (touches(ev.end_time, block.start_time, tol) || touches(ev.start_time, block.start_time, tol))) {
        claimedElsewhere = true; break;
      }
      if (touchesAfter && (touches(ev.start_time, block.end_time, tol) || touches(ev.end_time, block.end_time, tol))) {
        claimedElsewhere = true; break;
      }
    }
    if (!claimedElsewhere) cascade.push(block);
  }
  return cascade;
}

module.exports = { collectCascadeTravelBlocks, touches, minutesApart, TOLERANCE_MIN };
