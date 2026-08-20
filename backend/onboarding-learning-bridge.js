'use strict';

/**
 * ONBOARDING ↔ LEARNING BRIDGE
 *
 * Onboarding does not contain a learning engine, and must not grow one. The
 * portal already has three layers of learning (Resource Hub paths, the
 * interactive induction, and the Owner-controlled learning workflows added in
 * migration 033), and a fourth would be the worst possible answer to
 * "where do I mark this module complete?".
 *
 * So a TRAINING_MODULE requirement is a POINTER. It either:
 *
 *   • references a learning_workflow, in which case releasing the onboarding
 *     assigns that workflow to the new starter and the requirement completes
 *     itself when the learning assignment completes; or
 *
 *   • references an external course (the NDIS Commission's own modules), in
 *     which case the employee completes it on the Commission's site and
 *     uploads their certificate. Opal links out and verifies evidence — it
 *     never reproduces a regulator's training content.
 *
 * COMPLETION FLOWS ONE WAY. Learning completing marks the onboarding
 * requirement done. Nothing here ever writes back into learning state: an
 * onboarding action must not be able to mark someone's training complete.
 */

const { pool } = require('./database');
const log = require('./logger').createLogger('onboarding-learning');

/**
 * Assign the learning workflows a released onboarding refers to.
 *
 * Best-effort by design: a missing or archived workflow leaves the requirement
 * as ordinary manual work rather than failing the release. Onboarding someone
 * must not be blocked because an induction module was archived.
 *
 * @param {object} q            pg client inside the release transaction
 * @param {object} assignment   the onboarding assignment
 * @returns {Promise<number>}   how many learning assignments were created
 */
async function assignLearningForOnboarding(q, assignment) {
  const { rows: requirements } = await q.query(
    `SELECT id, template_code, title, snapshot
       FROM onboarding_requirements
      WHERE assignment_id = $1 AND handler = 'training'
        AND learning_assignment_id IS NULL`, [assignment.id]
  );

  let created = 0;
  for (const req of requirements) {
    const workflowId = req.snapshot?.learning_workflow_id;
    if (!workflowId) continue;

    try {
      const { rows: wf } = await q.query(
        `SELECT w.id, w.title, w.status, w.current_version, w.organisation_id
           FROM learning_workflows w
          WHERE w.id = $1 AND w.organisation_id IS NOT DISTINCT FROM $2`,
        [workflowId, assignment.organisation_id]
      );
      if (!wf[0] || wf[0].status === 'archived') continue;

      // Only an already-published version is used. Onboarding must not
      // silently publish a draft the Owner has not finished editing.
      const { rows: versions } = await q.query(
        `SELECT id, content FROM learning_workflow_versions
          WHERE workflow_id = $1 ORDER BY version DESC LIMIT 1`, [workflowId]
      );
      if (!versions[0]) continue;

      const content = versions[0].content || {};
      const requiredTotal = (content.sections || [])
        .flatMap((s) => s.items || [])
        .filter((i) => i && i.required !== false).length;

      const { rows: la } = await q.query(
        `INSERT INTO learning_assignments
           (organisation_id, workflow_id, workflow_version_id, user_id, assigned_by,
            due_at, mandatory, priority, owner_note, required_total)
         VALUES ($1,$2,$3,$4,$5,$6,TRUE,'normal',$7,$8)
         ON CONFLICT (user_id, workflow_id) WHERE status IN ('assigned','in_progress')
         DO NOTHING
         RETURNING id`,
        [
          assignment.organisation_id, workflowId, versions[0].id, assignment.user_id,
          assignment.created_by, assignment.due_at,
          `Assigned as part of onboarding: ${assignment.package_title || 'new starter'}`,
          requiredTotal,
        ]
      );
      if (!la[0]) continue;

      await q.query(
        `UPDATE onboarding_requirements
            SET learning_assignment_id = $2, status = 'in_progress',
                started_at = COALESCE(started_at, NOW()), updated_at = NOW()
          WHERE id = $1`, [req.id, la[0].id]
      );
      created += 1;
    } catch (err) {
      log.warn('learning assignment for onboarding failed', {
        error: err, requirementId: req.id, workflowId,
      });
    }
  }
  return created;
}

/**
 * A learning assignment completed — complete the onboarding requirement that
 * points at it, and refresh the onboarding progress meters.
 *
 * Called from learning-routes.js after its own transaction commits, in the
 * same best-effort shape as its existing Resource Hub bridge. Returns the
 * requirement id it completed, or null.
 */
async function onLearningAssignmentCompleted(learningAssignmentId, userId) {
  if (!learningAssignmentId) return null;
  try {
    const { rows } = await pool.query(
      `SELECT r.id, r.assignment_id, r.status, r.requires_employer_verification, r.template_code
         FROM onboarding_requirements r
         JOIN onboarding_assignments a ON a.id = r.assignment_id
        WHERE r.learning_assignment_id = $1
          AND ($2::uuid IS NULL OR a.user_id = $2)
          AND r.status NOT IN ('complete', 'verified', 'not_applicable')
        LIMIT 1`, [learningAssignmentId, userId || null]
    );
    const requirement = rows[0];
    if (!requirement) return null;

    // Training that an employer must still verify goes to submitted, not
    // complete — the same rule every other employee action follows.
    const toStatus = requirement.requires_employer_verification ? 'submitted' : 'complete';

    const odb = require('./onboarding-db');
    await odb.withTransaction(async (q) => {
      await q.query(
        `UPDATE onboarding_requirements
            SET status = $2,
                data = COALESCE(data, '{}'::jsonb) || jsonb_build_object(
                  'completedVia', 'learning', 'completedAt', NOW()::text),
                submitted_at = NOW(),
                completed_at = CASE WHEN $2 = 'complete' THEN NOW() ELSE completed_at END,
                updated_at = NOW()
          WHERE id = $1`, [requirement.id, toStatus]
      );
      await q.query(
        `INSERT INTO onboarding_requirement_events
           (requirement_id, assignment_id, event_type, from_status, to_status, metadata)
         VALUES ($1, $2, 'learning_completed', $3, $4, $5)`,
        [
          requirement.id, requirement.assignment_id, requirement.status, toStatus,
          JSON.stringify({ learningAssignmentId, templateCode: requirement.template_code }),
        ]
      );
      await odb.recomputeAssignment(q, requirement.assignment_id);
    });

    log.info('onboarding requirement completed via learning', {
      requirementId: requirement.id, learningAssignmentId,
    });
    return requirement.id;
  } catch (err) {
    // Never surface into the learning request: the employee finished their
    // module, and a bridge failure must not make that look like an error.
    log.warn('learning → onboarding bridge failed', { error: err, learningAssignmentId });
    return null;
  }
}

module.exports = {
  assignLearningForOnboarding,
  onLearningAssignmentCompleted,
};
