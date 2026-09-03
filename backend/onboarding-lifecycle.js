'use strict';

/**
 * ONBOARDING LIFECYCLE — the two acts that move a record between stages.
 *
 *   releaseAssignment  — Stage 1 → Stage 2. Mints the pre-employee account,
 *                        issues the invitation, materialises the requirement
 *                        set, records the employment profile.
 *   activateAssignment — Stage 3's portal-access task. Turns the pre-employee
 *                        into staff.
 *
 * Both used to live inline in onboarding-assignment-routes.js, where only an
 * HTTP request could reach them. The three-stage journey needs to run the
 * release from a public offer-acceptance and the activation from an internal
 * task, so the logic moved here and the routes became thin callers. Nothing
 * about what the acts DO changed; the integration tests in
 * onboarding.itest.js still exercise them through the original routes.
 *
 * Failures that a route answered with a status code are thrown as
 * LifecycleError { status, body } so every caller reports them the same way.
 */

const crypto = require('crypto');
const email = require('./email');
const odb = require('./onboarding-db');
const engine = require('./onboarding-engine');
const log = require('./logger').createLogger('onboarding-lifecycle');

class LifecycleError extends Error {
  constructor(status, body) {
    super(body?.error || 'lifecycle error');
    this.status = status;
    this.body = body;
  }
}

/**
 * Materialise the requirement instances for an assignment.
 *
 * Each row copies the frozen snapshot from the package version, so what the
 * employee is shown can never shift underneath them when a template is edited.
 */
async function materialiseRequirements(q, assignment, versionContent, settings) {
  const facts = assignment.facts || {};
  const { applied } = engine.selectApplicable(versionContent, facts);

  let order = 0;
  const skipped = [];
  for (const item of applied) {
    // An optional document requirement whose document has no published version
    // is not issued at all. The blocking ones are refused at the release gate,
    // so anything reaching here is optional — and putting an un-actionable
    // item on someone's list, permanently short of 100%, is worse than
    // omitting it. It reappears automatically on the next release once the
    // Owner publishes the document.
    if (item.handler === 'document_ack' && item.document_id && !item.document_version_id) {
      skipped.push(item.template_code);
      continue;
    }
    order += 10;
    const dueAt = engine.computeDueAt(item, {
      startDate: assignment.start_date,
      assignmentDueAt: assignment.due_at,
      releasedAt: new Date(),
    });
    await q.query(
      `INSERT INTO onboarding_requirements
         (assignment_id, organisation_id, template_id, template_code, template_version,
          title, section, classification, handler, actor, requires_employer_verification,
          sensitivity, sort_order, mandatory, blocks_activation, due_at, snapshot)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (assignment_id, template_code) DO NOTHING`,
      [
        assignment.id, assignment.organisation_id, item.template_id, item.template_code,
        item.template_version, item.title, item.section, item.classification, item.handler,
        item.actor, item.requires_employer_verification === true,
        item.sensitivity || 'standard', item.sort_order || order,
        item.mandatory !== false, item.blocks_activation === true,
        dueAt, JSON.stringify(item),
      ]
    );
  }
  if (skipped.length) {
    log.info('requirements not issued — document unpublished', { skipped });
  }
  return applied.length - skipped.length;
}

/**
 * Everything that must be true before a release can happen. Throws a
 * LifecycleError carrying the same status and body the route always sent.
 * Returns the loaded package version and settings for the release itself.
 */
async function checkReleasable(assignment) {
  if (assignment.status !== 'created') {
    throw new LifecycleError(409, {
      error: `This onboarding is already ${String(assignment.status).replace(/_/g, ' ')}`,
      code: 'not_releasable',
    });
  }

  // Refuse to collect a TFN or bank account we cannot encrypt. Better to
  // block the release than to invite someone into a form that will store
  // their tax details in clear.
  if (!odb.isEncryptionConfigured() && process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
    throw new LifecycleError(503, {
      error: 'Field encryption is not configured',
      message: 'ONBOARDING_ENCRYPTION_KEY must be set before onboarding can collect tax or bank details.',
      code: 'ENCRYPTION_UNAVAILABLE',
    });
  }

  const version = await odb.getPackageVersion(assignment.package_version_id);
  if (!version) {
    throw new LifecycleError(409, { error: 'The pinned package version is missing', code: 'version_missing' });
  }
  const settings = await odb.getOnboardingSettings();

  // Refuse to ask someone to acknowledge a policy that does not exist yet.
  // Only ACTIVATION-BLOCKING acknowledgements stop a release: an optional
  // reference document is issued as a link and costs nothing.
  const facts = assignment.facts || {};
  const { applied } = engine.selectApplicable(version.content, facts);
  const unpublished = applied.filter((item) => (
    item.handler === 'document_ack'
    && item.blocks_activation === true
    && item.document_id
    && !item.document_version_id
  ));
  if (unpublished.length) {
    throw new LifecycleError(409, {
      error: 'Some required documents have not been published yet',
      code: 'documents_unpublished',
      message: 'These requirements ask the new starter to read and acknowledge a document. '
        + 'Publish a version of each before releasing, so nobody is asked to agree to an empty policy.',
      documents: unpublished.map((item) => ({
        requirementCode: item.template_code,
        title: item.title,
        documentCode: item.document?.code || item.document_code || null,
        documentId: item.document_id,
        contentStatus: item.document?.contentStatus || null,
      })),
    });
  }

  return { version, settings };
}

/**
 * Release: pre-employee account, invitation, requirement set, employment
 * profile, and the invitation email (after commit, never fatal).
 *
 * `actor` is whoever the act is recorded against — the Owner pressing the
 * button, or, when an accepted offer triggers it, the person who sent the
 * offer. `actor.id` must be a real user id: it becomes invited_by_user_id.
 */
async function releaseAssignment({ org, assignment, actor, expiresInDays }) {
  const { version, settings } = await checkReleasable(assignment);

  const outcome = await odb.withTransaction(async (q) => {
    // 1. Pre-employee account. Created without a password: the invitation is
    //    what lets them set one. No temporary password is ever generated.
    let userId = assignment.user_id;
    if (!userId) {
      const { rows } = await q.query(
        `INSERT INTO users
           (email, name, role, organisation_id, is_active, account_status, email_verified,
            profile_completed, is_treating_therapist)
         VALUES (LOWER($1), $2, 'pre_employee', $3, TRUE, 'active', FALSE, TRUE, $4)
         ON CONFLICT (email) DO UPDATE SET role = 'pre_employee', organisation_id = $3
         RETURNING id`,
        [assignment.applicant_email, assignment.applicant_name, org, assignment.is_treating_therapist]
      );
      userId = rows[0].id;
    }

    // 2. Invitation, reusing the proven user_invites mechanism: 32 random
    //    bytes, single use via status, time limited, revocable.
    const inviteDays = Math.max(1, Math.min(Number(expiresInDays) || 14, 60));
    const token = crypto.randomBytes(32).toString('hex');
    const { rows: invRows } = await q.query(
      `INSERT INTO user_invites
         (organisation_id, email, role, invited_by_user_id, is_treating_therapist,
          display_name_hint, invite_token, expires_at, onboarding_assignment_id, metadata)
       VALUES ($1, LOWER($2), 'pre_employee', $3, $4, $5, $6,
               NOW() + ($7 || ' days')::INTERVAL, $8, $9)
       RETURNING *`,
      [
        org, assignment.applicant_email, actor.id, assignment.is_treating_therapist,
        assignment.applicant_name, token, String(inviteDays), assignment.id,
        JSON.stringify({ onboarding: true, packageCode: assignment.package_code }),
      ]
    );
    const invite = invRows[0];

    // 3. Requirements.
    const issued = await materialiseRequirements(q, assignment, version.content, settings);

    // 3b. Any training requirement that points at a learning workflow is
    //     assigned through the learning module rather than duplicated here.
    const learningAssigned = await require('./onboarding-learning-bridge')
      .assignLearningForOnboarding(q, { ...assignment, user_id: userId });

    // 4. Employment profile — the determinations that drove the rule engine
    //    are recorded against the person, not left only in the assignment.
    //    The offer terms (047) travel with them so nobody re-types hours or
    //    award at induction.
    await odb.upsertEmploymentProfile(userId, org, {
      assignmentId: assignment.id,
      jobTitle: assignment.job_title,
      employmentType: assignment.employment_type,
      roleCategory: assignment.role_category,
      startDate: assignment.start_date,
      endDate: assignment.end_date,
      managerUserId: assignment.manager_user_id,
      workLocation: assignment.work_location,
      hoursPerWeek: assignment.hours_per_week ?? undefined,
      awardClassification: assignment.award_classification ?? undefined,
      probationEndDate: probationEnd(assignment),
      childRelatedWork: assignment.facts?.child_related_work || 'assessment_required',
      ndisRiskAssessedRole: assignment.facts?.ndis_risk_assessed_role || 'requires_determination',
      mobileCommunityRole: assignment.facts?.mobile_community_role === true,
      usesOwnVehicle: assignment.facts?.uses_own_vehicle === true,
      determinedBy: actor.id,
      determinedAt: new Date(),
      status: 'onboarding',
    }, q);

    await q.query(
      `UPDATE onboarding_assignments
          SET user_id = $2, invite_id = $3, status = 'invite_sent',
              released_at = NOW(), last_activity_at = NOW(), updated_at = NOW()
        WHERE id = $1`,
      [assignment.id, userId, invite.id]
    );

    const recomputed = await odb.recomputeAssignment(q, assignment.id);
    return { userId, invite, issued, learningAssigned, recomputed };
  });

  // 5. Invitation email — after commit, and never fatal. If SMTP is down the
  //    caller still gets the link back so it can be delivered another way.
  let emailResult = null;
  try {
    emailResult = await email.sendOnboardingInviteEmail({
      toEmail: assignment.applicant_email,
      inviteToken: outcome.invite.invite_token,
      displayName: assignment.applicant_name,
      roleTitle: assignment.job_title || assignment.package_title,
      startDate: assignment.start_date,
      dueAt: assignment.due_at,
      invitedBy: actor.name || actor.email,
    });
  } catch (err) {
    log.warn('onboarding invite email failed', { error: err, assignmentId: assignment.id });
    emailResult = { failed: true };
  }
  const onboardingUrl = email.buildOnboardingInviteUrl(outcome.invite.invite_token);

  return { ...outcome, emailResult, onboardingUrl };
}

/** Probation end date from start date + probation months, or null. */
function probationEnd(assignment) {
  const months = Number(assignment.probation_months);
  if (!assignment.start_date || !Number.isFinite(months) || months <= 0) return undefined;
  const d = new Date(assignment.start_date);
  if (Number.isNaN(d.getTime())) return undefined;
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

/**
 * Activation: the pre-employee becomes staff. Refuses while any
 * activation-blocking requirement is outstanding, and says exactly which.
 *
 * Returns { user, assignment } or throws a LifecycleError. Notifications and
 * the welcome email are the caller's job — they differ by surface.
 */
async function activateAssignment({ assignment, actor }) {
  if (['activated', 'completed'].includes(assignment.status)) {
    throw new LifecycleError(409, { error: 'This employee has already been activated', code: 'already_activated' });
  }
  if (['cancelled', 'archived'].includes(assignment.status)) {
    throw new LifecycleError(409, { error: `This onboarding is ${assignment.status}`, code: 'closed' });
  }
  if (!assignment.user_id) {
    throw new LifecycleError(409, { error: 'This onboarding has not been released yet', code: 'not_released' });
  }

  const requirements = await odb.listRequirements(assignment.id);
  const activation = engine.evaluateActivation(requirements);
  if (!activation.ok) {
    throw new LifecycleError(409, {
      error: 'Outstanding requirements must be resolved before activation',
      code: 'activation_blocked',
      blockers: activation.blockers,
    });
  }

  const outcome = await odb.withTransaction(async (q) => {
    // Guard against a concurrent second activation: the stamp is set only
    // where it is still null, so exactly one call can win.
    const { rows: userRows } = await q.query(
      `UPDATE users
          SET role = $2, is_active = TRUE, account_status = 'active',
              is_treating_therapist = $3,
              activated_from_onboarding_at = NOW(), updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND activated_from_onboarding_at IS NULL
        RETURNING id, name, email, role`,
      [assignment.user_id, assignment.proposed_role, assignment.is_treating_therapist]
    );
    if (!userRows[0]) {
      const err = new Error('already_activated');
      err.code = 'ALREADY_ACTIVATED';
      throw err;
    }

    await q.query(
      `UPDATE employment_profiles SET status = 'active', updated_at = NOW() WHERE user_id = $1`,
      [assignment.user_id]
    );
    await q.query(
      `UPDATE payroll_profiles
          SET payroll_setup_status = CASE WHEN payroll_setup_status = 'not_required'
                                          THEN 'setup_required' ELSE payroll_setup_status END,
              updated_at = NOW()
        WHERE user_id = $1`, [assignment.user_id]
    );
    await q.query(
      `UPDATE credentials SET status = CASE WHEN status = 'pending_review' THEN 'active' ELSE status END,
                              updated_at = NOW()
        WHERE user_id = $1 AND source = 'onboarding' AND status = 'verified'`,
      [assignment.user_id]
    );
    await q.query(
      `UPDATE user_invites SET status = 'accepted', accepted_at = COALESCE(accepted_at, NOW()),
                               updated_at = CURRENT_TIMESTAMP
        WHERE onboarding_assignment_id = $1 AND status = 'pending'`, [assignment.id]
    );

    const { rows } = await q.query(
      `UPDATE onboarding_assignments
          SET status = 'activated', activated_at = NOW(), activated_by = $2,
              completed_at = NOW(), last_activity_at = NOW(), updated_at = NOW()
        WHERE id = $1 RETURNING *`, [assignment.id, actor.id]
    );
    return { user: userRows[0], assignment: rows[0] };
  }).catch((err) => {
    if (err.code === 'ALREADY_ACTIVATED') return null;
    throw err;
  });

  if (!outcome) {
    throw new LifecycleError(409, { error: 'This employee has already been activated', code: 'already_activated' });
  }
  return outcome;
}

module.exports = {
  LifecycleError,
  materialiseRequirements,
  checkReleasable,
  releaseAssignment,
  activateAssignment,
};
