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
const guard = require('./onboarding-account-guard');
const log = require('./logger').createLogger('onboarding-lifecycle');

/**
 * The roles an onboarding may hand out on activation. Never 'owner': the
 * onboarding permissions are delegable to an Admin, and "granting is
 * owner-only" (permissions.js) would mean nothing if an onboarding record
 * could carry the Owner role through activation (audit H-2).
 */
const ONBOARDING_ROLES = Object.freeze(['therapist', 'admin', 'read_only']);

class LifecycleError extends Error {
  constructor(status, body) {
    super(body?.error || 'lifecycle error');
    this.status = status;
    this.body = body;
  }
}

/**
 * The account guard's refusal as the LifecycleError every caller already
 * answers with. `account_exists` stays the code for "a live account uses this
 * email" so existing clients keep their handling; `reason` says which rule.
 */
function guardRefusal(out, act) {
  const error = out.code === 'not_pre_employee'
    ? `An account already uses this email address, so this onboarding cannot be ${act}. `
      + 'Change the applicant email, or manage the existing account from Settings → Users & Roles.'
    : out.error;
  return new LifecycleError(409, { error, code: out.code === 'no_account' ? 'not_released' : 'account_exists', reason: out.code });
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

  // Owner decision 4: nothing with gaps in it reaches a starter. (A contract
  // or position description not yet attached does not stop the release — the
  // starter cannot acknowledge it, and activation waits, until it is; audit B-5.)
  const documentProblems = await documentProblemsFor(assignment, applied, { requireAttachments: false });
  if (documentProblems.length) {
    throw new LifecycleError(409, {
      error: `These documents are not ready to send: ${documentProblems.map((d) => d.message).join('; ')}.`,
      code: 'documents_not_ready',
      message: 'Supply the practice\'s final wording for each, publish it, then release again.',
      documents: documentProblems,
    });
  }

  return { version, settings };
}

/**
 * Every acknowledgement this record would issue whose document is missing,
 * a placeholder, or still holds "[TO CONFIRM …]" gaps. Named, so the Owner
 * knows exactly which document to finish.
 */
async function documentProblemsFor(assignment, applied, { requireAttachments = true } = {}) {
  const placeholder = require('./onboarding-placeholder-check');
  const recordDocs = require('./onboarding-record-documents');
  const problems = [];
  for (const item of applied) {
    if (item.handler !== 'document_ack') continue;
    const title = item.document?.title || item.title;
    if (item.document_id) {
      if (!item.document_version_id) continue; // unpublished: refused above, or not issued if optional
      const version = await odb.getDocumentVersion(item.document_version_id);
      const why = await placeholder.versionProblem(version);
      if (why) problems.push({ requirementCode: item.template_code, title, reason: why, message: placeholder.describe(title, why) });
      continue;
    }
    // No library document: only the record's own contract / position description can answer it.
    // (The older account route has no offer to attach them to; there the
    // acknowledgement itself refuses until a document exists.)
    if (!requireAttachments) continue;
    const kind = recordDocs.kindFor(item.template_code);
    const attached = kind ? await recordDocs.liveDocument(assignment.id, kind) : null;
    if (!attached) {
      const why = kind ? 'has not been attached to this record' : 'has no document behind it';
      problems.push({ requirementCode: item.template_code, title, reason: why, message: placeholder.describe(title, why), attachKind: kind });
    }
  }
  return problems;
}

// ═════════════════════════════════════════════════════════════════════════════
//  ACTIVATION READINESS — owner decision 2 (Oct 2026)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * The statutory checks that can never be set aside — waived or marked not
 * applicable — for a clinician (owner decision 3).
 */
const CLINICAL_STATUTORY_CODES = Object.freeze(['REQ_AHPRA', 'REQ_NDIS_SCREENING', 'REQ_WWCC']);

/** A clinician / treating role: the record says so, or its role category or portal role does. */
function isClinicalRole(assignment) {
  return assignment.is_treating_therapist === true
    || assignment.role_category === 'occupational_therapist'
    || assignment.proposed_role === 'therapist';
}

/**
 * Owner decision 3: a waiver — "not applicable" included — is the Owner's
 * alone (by role, not by a delegable permission), and Ahpra registration,
 * NDIS Worker Screening and the Working with Children Check can never be set
 * aside for a clinician. Returns { status, body } to refuse, or null.
 */
function waiverRefusal(user, assignment, templateCode) {
  if (!user || user.role !== 'owner') {
    return { status: 403, body: { error: 'Only the practice owner can set an onboarding item aside.', code: 'owner_only' } };
  }
  if (CLINICAL_STATUTORY_CODES.includes(templateCode) && isClinicalRole(assignment)) {
    return {
      status: 409,
      body: {
        error: 'Ahpra registration, NDIS Worker Screening and the Working with Children Check cannot be waived or marked not applicable for a clinician. Verify it instead.',
        message: 'These checks record what the issuing authority actually says; for a clinician they are always required.',
        code: 'statutory_not_waivable',
      },
    };
  }
  return null;
}

/**
 * Everything that must be true before the Owner may press Activate, as a
 * list the screen can show. Nothing activates by itself any more: this is
 * the gate the one Activate button passes through.
 *
 * @returns {Promise<{ ok: boolean, blockers: object[] }>}
 */
async function activationReadiness(assignment, q = odb.pool) {
  const blockers = [];
  const add = (code, title, reason, extra = {}) => blockers.push({ code, title, reason, ...extra });

  // 1. The starter can sign in with a password they chose.
  if (!assignment.user_id) {
    add('not_released', 'Release the onboarding', 'The starter has not been invited yet');
  } else {
    const own = await guard.loadAndAssess(q, assignment, assignment.user_id);
    if (!own.ok) add('account_not_owned', 'Portal account', own.error);
    else if (!own.user.password_hash) add('password_not_set', 'Starter sets their password', 'The starter has not accepted the invitation and set their password yet');
    else if (own.user.must_change_password || own.user.password_is_temporary) add('password_not_set', 'Starter sets their password', 'The starter is still on a temporary password and has not chosen their own');
  }

  // 2. The letter of offer, where the record has one.
  const offer = await require('./onboarding-journey-db').getCurrentOffer(assignment.id).catch(() => null);
  if (offer && !['accepted', 'not_required'].includes(offer.status)) {
    add('offer_open', 'Letter of offer', 'The signed letter of offer has not been verified');
  }

  // 3. Every activation-blocking requirement: documents verified, policies
  //    acknowledged, training complete.
  const requirements = await odb.listRequirements(assignment.id);
  if (!requirements.length && !assignment.pack_prepared_at) {
    add('no_requirements', 'Onboarding items', 'No onboarding items have been issued — release the onboarding first');
  }
  const recordDocs = require('./onboarding-record-documents');
  for (const b of engine.evaluateActivation(requirements).blockers) {
    let reason = b.reason;
    const kind = recordDocs.kindFor(b.code);
    if (kind && !(await recordDocs.liveDocument(assignment.id, kind))) {
      reason = `Attach the ${recordDocs.LABELS[kind].toLowerCase()} to the record — the starter acknowledges it in the portal`;
    }
    add(b.code, b.title, reason, { requirementId: b.id, section: b.section, attachKind: kind || undefined });
  }
  // A statutory check set aside on a clinician (by an old route, or by hand)
  // still blocks: it can only be satisfied by verification.
  if (isClinicalRole(assignment)) {
    for (const r of requirements) {
      if (CLINICAL_STATUTORY_CODES.includes(r.template_code) && (r.status === 'not_applicable' || r.waived === true)) {
        add(r.template_code, r.title, 'Cannot be set aside for a clinician — it must be verified', { requirementId: r.id });
      }
    }
  }

  // 4. The paper pack, for a record on that route: every required return verified.
  if (assignment.pack_prepared_at) {
    const items = await require('./onboarding-pack-db').listItems(assignment.id, undefined, 'documentation');
    for (const it of items) {
      if (it.status !== 'included' || !it.required || !it.employee_returns) continue;
      if (['verified', 'not_applicable'].includes(it.verification_status)) continue;
      add(it.code, it.title, 'Returned document not yet verified', { packItemId: it.id });
    }
  }

  // 5. The induction walkthrough.
  const tasks = await require('./onboarding-journey-db').listTasks(assignment.id).catch(() => []);
  const walk = tasks.find((t) => t.code === 'induction_walkthrough');
  if (walk && !['done', 'skipped'].includes(walk.status)) {
    add('induction_walkthrough', walk.title, 'Tick it once the induction walkthrough is assigned');
  }

  return { ok: blockers.length === 0, blockers };
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
    //
    //    An account that ALREADY uses this email is never converted (audit
    //    H-3): this used to be ON CONFLICT … DO UPDATE SET role =
    //    'pre_employee', which silently demoted a live therapist — or owner —
    //    whose account had appeared since the onboarding was created. The
    //    only existing account a release may adopt is a pre-employee that no
    //    other open onboarding is using, in the same organisation; adopting
    //    it changes nothing about the account.
    let userId = assignment.user_id;
    if (userId) {
      // Re-checked at the moment of release, not trusted from when the link
      // was made (audit B-1): the linked account must still be this record's
      // own pre-employee. A live staff or Owner account is never invited.
      const own = await guard.loadAndAssess(q, assignment, userId, { lock: true });
      if (!own.ok) throw guardRefusal(own, 'released');
    } else {
      const found = await guard.adoptableByEmail(q, assignment, assignment.applicant_email, { lock: true });
      if (found.exists) {
        if (!found.ok) throw guardRefusal(found, 'released');
        userId = found.user.id;
      } else {
        const { rows } = await q.query(
          `INSERT INTO users
             (email, name, role, organisation_id, is_active, account_status, email_verified,
              profile_completed, is_treating_therapist)
           VALUES (LOWER($1), $2, 'pre_employee', $3, TRUE, 'active', FALSE, TRUE, $4)
           RETURNING id`,
          [assignment.applicant_email, assignment.applicant_name, org, assignment.is_treating_therapist]
        );
        userId = rows[0].id;
      }
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
  // Defence in depth for H-2: the create routes refuse 'owner', but a row
  // written before that fix (or by SQL) must still never activate into one.
  // Covers the automatic activation in onboarding-autosetup.js too, which
  // calls this function.
  if (!ONBOARDING_ROLES.includes(assignment.proposed_role)) {
    throw new LifecycleError(409, {
      error: 'This onboarding proposes a role that onboarding cannot grant. '
        + 'Activate them with a staff role, then change the role in Settings → Users & Roles if needed.',
      code: 'role_not_grantable',
    });
  }

  // Owner decision 2: the Owner's deliberate press, and only when everything
  // required is done — the starter's own password, the documents verified,
  // the policies acknowledged, the induction complete. Says exactly what is left.
  const readiness = await activationReadiness(assignment);
  if (!readiness.ok) {
    throw new LifecycleError(409, {
      error: 'Outstanding items must be resolved before activation',
      code: 'activation_blocked',
      blockers: readiness.blockers,
    });
  }

  const outcome = await odb.withTransaction(async (q) => {
    // A concurrent second activation waits on this lock, then finds the stamp.
    const { rows: stamp } = await q.query(
      'SELECT activated_from_onboarding_at FROM users WHERE id = $1 FOR UPDATE', [assignment.user_id]
    );
    if (stamp[0] && stamp[0].activated_from_onboarding_at) {
      const err = new Error('already_activated');
      err.code = 'ALREADY_ACTIVATED';
      throw err;
    }
    // The account must still be this record's own pre-employee (audit B-1):
    // activation must never change the role of a live staff or Owner account
    // that happens to share the applicant's email.
    const own = await guard.loadAndAssess(q, assignment, assignment.user_id, { lock: true });
    if (!own.ok) throw guardRefusal(own, 'activated');

    // Guard against a concurrent second activation: the stamp is set only
    // where it is still null, so exactly one call can win.
    const { rows: userRows } = await q.query(
      `UPDATE users
          SET role = $2, is_active = TRUE, account_status = 'active',
              is_treating_therapist = $3,
              activated_from_onboarding_at = NOW(), updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND activated_from_onboarding_at IS NULL AND role = 'pre_employee'
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
    // Credentials whose requirement the practice verified are verified
    // credential records on My Profile → Credentials (audit B-9; the old
    // statement here could never match a row).
    await q.query(
      `UPDATE credentials c
          SET status = 'verified', verified_at = COALESCE(c.verified_at, r.reviewed_at, NOW()),
              verified_by_user_id = COALESCE(c.verified_by_user_id, r.reviewed_by), updated_at = NOW()
         FROM onboarding_requirements r
        WHERE c.user_id = $1 AND c.source = 'onboarding' AND c.status = 'pending_review'
          AND r.id = c.onboarding_requirement_id AND r.assignment_id = $2 AND r.status = 'verified'`,
      [assignment.user_id, assignment.id]
    );
    await q.query(
      `UPDATE user_invites SET status = 'accepted', accepted_at = COALESCE(accepted_at, NOW()),
                               updated_at = CURRENT_TIMESTAMP
        WHERE onboarding_assignment_id = $1 AND status = 'pending'`, [assignment.id]
    );

    const { rows } = await q.query(
      `UPDATE onboarding_assignments
          SET status = 'activated', activated_at = NOW(), activated_by = $2,
              last_activity_at = NOW(), updated_at = NOW()
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

  // The checklist follows the act, wherever it was pressed from (audit B-11):
  // portal access is done, and so is the account the starter now signs in to.
  // The record completes only when every other setup task is done too (B-8).
  try {
    const jdb = require('./onboarding-journey-db');
    const tasks = await jdb.listTasks(assignment.id);
    for (const code of ['portal_access', 'portal_account']) {
      const t = tasks.find((x) => x.code === code);
      if (t && t.status !== 'done' && t.status !== 'skipped') {
        await jdb.setTaskStatus(assignment.id, code, {
          status: 'done', actorId: actor.id || null,
          note: code === 'portal_access' ? 'Activated by the Owner' : 'The starter signs in with their own password',
          detail: code === 'portal_access' ? { activatedRole: outcome.user.role } : null,
        });
      }
    }
    await completeIfFinished(assignment.id);
  } catch (err) {
    log.warn('post-activation checklist update failed', { error: err, assignmentId: assignment.id });
  }
  return outcome;
}

/**
 * An activated record is COMPLETE only when every internal setup task is
 * done or skipped — never while payroll or equipment is still open (B-8).
 */
async function completeIfFinished(assignmentId) {
  const jdb = require('./onboarding-journey-db');
  const tasks = await jdb.listTasks(assignmentId);
  // No checklist (a record from the older assignment route): it stays activated.
  if (!tasks.length) return false;
  const open = tasks.some((t) => !['done', 'skipped'].includes(t.status));
  if (open) return false;
  const { rowCount } = await odb.pool.query(
    `UPDATE onboarding_assignments SET status = 'completed', completed_at = COALESCE(completed_at, NOW()),
            last_activity_at = NOW(), updated_at = NOW() WHERE id = $1 AND status = 'activated'`,
    [assignmentId]
  );
  return rowCount > 0;
}

module.exports = {
  ONBOARDING_ROLES,
  CLINICAL_STATUTORY_CODES,
  LifecycleError,
  materialiseRequirements,
  checkReleasable,
  documentProblemsFor,
  releaseAssignment,
  activationReadiness,
  activateAssignment,
  completeIfFinished,
  isClinicalRole,
  waiverRefusal,
};
