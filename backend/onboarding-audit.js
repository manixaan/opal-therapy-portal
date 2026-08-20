'use strict';

/**
 * ONBOARDING AUDIT — events that cannot carry sensitive content by construction.
 *
 * Onboarding writes tax file numbers, bank details and identity documents into
 * the portal for the first time. The logger's redaction is a backstop, not a
 * control, so this module removes the possibility rather than filtering for it:
 * an audit payload is built from a FROZEN FIELD ALLOWLIST, and there is simply
 * no field for a TFN, an account number or a document number to land in.
 *
 * The pattern is lifted from ai/ai-audit.js, which solved the same problem for
 * model prompts: allowlist the keys, reject objects and arrays outright rather
 * than serialising them, and truncate strings.
 *
 * Every event goes to the ONE canonical table (audit_logs, via
 * db.logAuditEvent) so onboarding history sits in the same place as every
 * other sensitive action, and additionally to onboarding_requirement_events
 * where it belongs to a specific requirement's review trail.
 */

const db = require('./database');
const log = require('./logger').createLogger('onboarding-audit');

/**
 * The ONLY keys permitted in onboarding audit metadata.
 *
 * Adding a key here is a deliberate act with a review attached. Note what is
 * absent and must stay absent: anything holding a value the employee supplied
 * in confidence. `field` names WHICH field changed; it never carries the value.
 */
const ALLOWED_FIELDS = Object.freeze([
  // identifiers
  'assignmentId', 'requirementId', 'packageId', 'packageVersionId', 'templateId',
  'documentId', 'documentVersionId', 'credentialId', 'importId', 'inviteId',
  'learningAssignmentId', 'acknowledgementId', 'issuanceId', 'recordId',
  'subjectUserId', 'targetUserId', 'actorUserId', 'organisationId',
  // codes and classifications — vocabulary, never content
  'code', 'templateCode', 'documentCode', 'statementCode', 'complianceCode',
  'section', 'classification', 'handler', 'actor', 'formKey', 'credentialType',
  'recordType', 'permission', 'permissions', 'role', 'previousRole',
  'employmentType', 'roleCategory', 'trigger', 'triggerKind', 'deliveryMethod',
  'verificationMethod', 'lifecycleStatus', 'arrangement', 'evidenceType',
  // state
  'fromStatus', 'toStatus', 'status', 'decision', 'version', 'previousVersion',
  'blocked', 'blockerCount', 'waived', 'mandatory', 'blocksActivation',
  'employeeDone', 'employeeTotal', 'employerDone', 'employerTotal',
  'requirementCount', 'entryCount', 'acceptedCount', 'rejectedCount',
  'expiryDate', 'windowDays', 'dueAt', 'sensitivity',
  // free text that is deliberately operator-authored, not employee-supplied
  'reason', 'note', 'changeNote', 'error',
  // file metadata (never file content)
  'fileName', 'mimeType', 'sizeBytes', 'sha256', 'storageBackend',
  // booleans describing what happened
  'emailSent', 'emailSkipped', 'emailFailed', 'copyRetained', 'encrypted',
]);

const ALLOWED = new Set(ALLOWED_FIELDS);
const MAX_STRING = 200;
const MAX_ARRAY = 20;

/**
 * Build a safe metadata object.
 *
 * Unknown keys are dropped silently — an audit write must never fail or throw
 * because a caller passed an extra field, but neither may that field survive.
 * Objects are rejected rather than serialised: a nested object is exactly how
 * a whole form payload would otherwise slip in.
 */
function safeMetadata(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;

  for (const [key, value] of Object.entries(input)) {
    if (!ALLOWED.has(key)) continue;
    if (value === null || value === undefined) continue;

    if (typeof value === 'boolean' || typeof value === 'number') {
      out[key] = value;
    } else if (typeof value === 'string') {
      out[key] = value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
    } else if (Array.isArray(value)) {
      // Arrays of scalars only (a permission list). Anything else is dropped.
      const scalars = value
        .filter((v) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
        .slice(0, MAX_ARRAY)
        .map((v) => (typeof v === 'string' && v.length > MAX_STRING ? v.slice(0, MAX_STRING) : v));
      if (scalars.length) out[key] = scalars;
    } else if (value instanceof Date) {
      out[key] = value.toISOString();
    }
    // Objects and functions: deliberately dropped.
  }
  return out;
}

/**
 * Record an onboarding audit event.
 *
 * Never throws and never fails a request: an audit write that rejects must not
 * roll back the user's action, but the failure is logged so it is visible.
 */
async function auditOnboarding(req, action, { targetType, targetId, metadata } = {}) {
  try {
    await db.logAuditEvent({
      actorUserId: req.user?.id || null,
      action: `onboarding.${action}`,
      targetType: targetType || 'onboarding',
      // target_id is kept to UUIDs for onboarding records — never an email or
      // any other identifier that is itself personal information.
      targetId: targetId || null,
      organisationId: req.user?.organisation_id || null,
      ipAddress: req.ip,
      metadata: safeMetadata(metadata),
    });
  } catch (err) {
    log.warn('audit write failed', { error: err, action });
  }
}

/**
 * Append to a requirement's own review trail, in the same shape.
 *
 * @param {object} client  a pg client when inside a transaction, else the pool
 */
async function recordRequirementEvent(client, {
  requirementId, assignmentId, actorUserId, actorRole,
  eventType, fromStatus, toStatus, reason, metadata,
}) {
  try {
    await client.query(
      `INSERT INTO onboarding_requirement_events
         (requirement_id, assignment_id, actor_user_id, actor_role,
          event_type, from_status, to_status, reason, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        requirementId, assignmentId, actorUserId || null, actorRole || null,
        eventType, fromStatus || null, toStatus || null,
        reason ? String(reason).slice(0, 1000) : null,
        JSON.stringify(safeMetadata(metadata)),
      ]
    );
  } catch (err) {
    log.warn('requirement event write failed', { error: err, eventType });
  }
}

module.exports = {
  ALLOWED_FIELDS,
  safeMetadata,
  auditOnboarding,
  recordRequirementEvent,
};
