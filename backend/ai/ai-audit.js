'use strict';

/**
 * AI AUDIT — metadata only, structurally incapable of carrying content.
 *
 * Every gateway call writes one `ai_interactions` row, allowed or denied.
 * What it records is who asked, which feature, which classification and
 * output type, which provider and model, where the request was sourced from,
 * whether human review is required, and the outcome.
 *
 * What it must NEVER record: prompts, transcripts, generated notes, client
 * names, request or response bodies. The clinical record lives in the
 * clinical tables; an audit log that also holds clinical narrative doubles
 * the surface area of every breach and creates a second copy to secure,
 * retain and dispose of under APP 11.
 *
 * That rule is enforced rather than documented. `buildEvent` builds from a
 * fixed field allowlist — unknown keys are dropped, not passed through — and
 * every value must be a bounded primitive. A caller cannot leak a transcript
 * into the audit trail even by accident, because there is no field for it and
 * no path for an arbitrary object to survive. Proven in tests/ai-gateway.test.js.
 *
 * The row id IS the event id the gateway hands back, so a clinical draft can
 * link to the interaction that produced it (`case_note_drafts.ai_interaction_id`)
 * and the practice can answer "which notes were AI-assisted, and who approved
 * them" without storing the conversation.
 *
 * On failure to write: the event is logged and generation CONTINUES. An
 * unauditable AI call is a real problem, but failing a therapist's clinical
 * work because an audit table is unreachable is a worse one. Write failures
 * are surfaced loudly so they cannot pass unnoticed.
 */

const crypto = require('crypto');

/**
 * The complete set of fields an AI audit event may contain. Adding a field
 * here is a deliberate decision — check it cannot carry clinical content.
 */
const ALLOWED_FIELDS = Object.freeze([
  'eventId',
  'feature',
  'classification',
  'outputType',
  'provider',
  'model',          // the approved model id — not a secret, and needed for provenance
  'modelKey',       // registry key
  'sourceRegion',   // where the request was SENT FROM, not where it ran
  'providerRequestId',
  'humanReviewRequired',
  'status',         // 'generated' | 'denied' | 'provider_error'
  'denyReason',     // short machine-ish code, never free text from a user
  'latencyMs',
  'auditCategory',
]);

/** Values are truncated to this; nothing legitimate here is long. */
const MAX_VALUE_CHARS = 200;

let _sink = null;

/**
 * Reduce an arbitrary value to something safe to persist. Objects and arrays
 * are rejected outright rather than serialised — serialising is precisely how
 * a transcript would end up in an audit row.
 */
function safeValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.slice(0, MAX_VALUE_CHARS);
  return null;
}

/**
 * Build a sanitised event. Only ALLOWED_FIELDS survive; everything else is
 * dropped silently, which is the safe direction — a dropped field is a
 * missing audit detail, a passed-through field could be clinical narrative.
 */
function buildEvent(input = {}) {
  const event = { eventId: crypto.randomUUID() };
  for (const field of ALLOWED_FIELDS) {
    if (field === 'eventId') continue;
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      const value = safeValue(input[field]);
      if (value !== null) event[field] = value;
    }
  }
  return event;
}

/**
 * Persist to `ai_interactions`, and mirror a lightweight entry into the
 * general audit stream so AI activity appears alongside everything else a
 * reviewer looks at. Both are metadata-only.
 *
 * Uses the pool directly rather than adding helpers to database.js — that
 * file is large and shared, and AI concerns belong in backend/ai/.
 */
async function insertInteraction({ actorUserId, organisationId, event }) {
  // eslint-disable-next-line global-require
  const db = require('../database');

  await db.pool.query(
    `INSERT INTO ai_interactions
       (id, user_id, organisation_id, feature, classification, output_type,
        audit_category, provider, model_id, source_region, provider_request_id,
        status, deny_reason, latency_ms, review_required, review_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      event.eventId,
      actorUserId || null,
      organisationId || null,
      event.feature || 'unknown',
      event.classification || 'clinical',
      event.outputType || null,
      event.auditCategory || null,
      event.provider || null,
      event.model || null,
      event.sourceRegion || null,
      event.providerRequestId || null,
      event.status || 'generated',
      event.denyReason || null,
      typeof event.latencyMs === 'number' ? event.latencyMs : null,
      event.humanReviewRequired !== false,
      // Review starts unstarted; a clinical output moves to 'review_required'
      // so it shows up in a "needs attention" list rather than looking done.
      event.humanReviewRequired === true ? 'review_required' : 'ai_generated',
    ]
  );
}

async function persist({ actorUserId, organisationId, event }) {
  // eslint-disable-next-line global-require
  const db = require('../database');
  await insertInteraction({ actorUserId, organisationId, event });
  await db.logAuditEvent({
    actorUserId: actorUserId || null,
    action: `ai.${event.status || 'unknown'}`,
    targetType: 'ai_interaction',
    targetId: event.eventId,
    metadata: event,
    organisationId: organisationId || null,
  });
}

/**
 * Reserve an interaction row BEFORE the model is called, for outputs that
 * must not exist unattributably.
 *
 * This inverts the usual ordering on purpose. Recording after the fact is
 * fine for an assistant answer — if the write fails you have lost a log line.
 * It is not fine for a clinical document: a note in a client's file that
 * cannot be traced to a model, a region or a person is worse than no note,
 * and by then the data has already left the building.
 *
 * So for clinical documents the audit layer is a PRECONDITION. If this write
 * fails, generation is denied and nothing is transmitted.
 *
 * THROWS on failure — that is the entire point.
 */
async function reserve({ actorUserId, organisationId, event } = {}) {
  const safe = buildEvent({ ...event, status: 'pending' });
  if (_sink) {
    await _sink({ op: 'reserve', actorUserId, organisationId, event: safe });
    return safe;
  }
  await insertInteraction({ actorUserId, organisationId, event: safe });
  return safe;
}

/**
 * Complete a reserved row once the outcome is known. Best effort: by this
 * point the call has happened, and failing the therapist's work because an
 * UPDATE did not land would help nobody. A row left at 'pending' is itself
 * informative — it says the call was made but its outcome was never
 * confirmed.
 */
async function finalise(eventId, patch = {}) {
  const safe = buildEvent(patch);
  try {
    if (_sink) {
      await _sink({ op: 'finalise', event: { ...safe, eventId } });
      return true;
    }
    // eslint-disable-next-line global-require
    const db = require('../database');
    await db.pool.query(
      `UPDATE ai_interactions
          SET status = $1,
              provider_request_id = COALESCE($2, provider_request_id),
              latency_ms = COALESCE($3, latency_ms)
        WHERE id = $4`,
      [
        safe.status || 'generated',
        safe.providerRequestId || null,
        typeof safe.latencyMs === 'number' ? safe.latencyMs : null,
        eventId,
      ]
    );
    return true;
  } catch (err) {
    console.warn(`[ai-audit] failed to finalise interaction (reason: ${err?.message || 'unknown'})`);
    return false;
  }
}

/**
 * Record a boundary-level security event — the kill switch flipping, or the
 * policy/model registry changing between deployments.
 *
 * Separate from interactions because during an incident you want one obvious
 * place that answers "what changed, when, who and why" without filtering a
 * general audit stream. Never throws.
 */
async function securityEvent({ eventType, actorUserId, previousState, newState, reason, detail } = {}) {
  const payload = {
    eventType,
    previousState: previousState === undefined ? null : String(previousState).slice(0, 64),
    newState: newState === undefined ? null : String(newState).slice(0, 64),
    reason: reason ? String(reason).slice(0, 500) : null,
    detail: detail ? String(detail).slice(0, 200) : null,
  };
  try {
    if (_sink) {
      await _sink({ op: 'securityEvent', actorUserId, event: payload });
      return payload;
    }
    // eslint-disable-next-line global-require
    const db = require('../database');
    await db.pool.query(
      `INSERT INTO ai_security_events
         (event_type, actor_user_id, previous_state, new_state, reason, detail)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [payload.eventType, actorUserId || null, payload.previousState,
       payload.newState, payload.reason, payload.detail]
    );
    await db.logAuditEvent({
      actorUserId: actorUserId || null,
      action: `ai.security.${eventType}`,
      targetType: 'ai_security_event',
      targetId: null,
      metadata: payload,
    });
  } catch (err) {
    console.warn(`[ai-audit] failed to record security event (reason: ${err?.message || 'unknown'})`);
  }
  return payload;
}

/**
 * Record an event. `actorUserId` is passed separately because it belongs to
 * the audit envelope rather than the AI metadata.
 *
 * Never throws — see the module note on why audit failure does not block
 * clinical work.
 */
async function record({ actorUserId, organisationId, event } = {}) {
  const safe = buildEvent(event);
  try {
    if (_sink) {
      await _sink({ actorUserId, organisationId, event: safe });
      return safe;
    }
    await persist({ actorUserId, organisationId, event: safe });
  } catch (err) {
    // Message only — an audit failure must not itself leak anything, and the
    // event we were trying to write is already sanitised.
    console.warn(`[ai-audit] failed to record interaction (reason: ${err?.message || 'unknown'})`);
  }
  return safe;
}

/**
 * Mark an interaction reviewed. Called when a therapist accepts or rejects an
 * AI-assisted document — the moment a draft stops being a draft.
 *
 * Scoped to the acting user so one therapist cannot approve another's work.
 */
async function markReviewed({ interactionId, reviewedBy, decision } = {}) {
  if (!['approved', 'rejected'].includes(decision)) {
    throw new Error('invalid_review_decision');
  }
  if (!interactionId || !reviewedBy) throw new Error('invalid_review_target');

  if (_sink) {
    await _sink({ actorUserId: reviewedBy, event: { eventId: interactionId, status: decision } });
    return true;
  }
  // eslint-disable-next-line global-require
  const db = require('../database');
  const { rowCount } = await db.pool.query(
    `UPDATE ai_interactions
        SET review_status = $1, reviewed_by = $2, reviewed_at = NOW()
      WHERE id = $3 AND user_id = $2`,
    [decision, reviewedBy, interactionId]
  );
  return rowCount > 0;
}

/** Test seam. Pass a function to capture events, or null to restore. */
function _setSinkForTests(fn) {
  _sink = typeof fn === 'function' ? fn : null;
}

module.exports = {
  ALLOWED_FIELDS,
  MAX_VALUE_CHARS,
  buildEvent,
  record,
  reserve,
  finalise,
  securityEvent,
  markReviewed,
  _setSinkForTests,
};
