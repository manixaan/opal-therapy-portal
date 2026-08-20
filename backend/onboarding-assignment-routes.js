'use strict';

/**
 * ONBOARDING ASSIGNMENTS — assign, release, review, activate.
 *
 * The employer half of the workflow. The employee half lives in
 * onboarding-employee-routes.js under /api/onboarding/me.
 *
 * THE TWO IDEAS THIS FILE ENFORCES
 * ────────────────────────────────
 * 1. TWO INDEPENDENT PROGRESS METERS. An employee's meter must reach 100% on
 *    their own actions alone. Verification work belongs to the employer and is
 *    counted separately, so nobody is told they are incomplete because someone
 *    else has not finished checking.
 *
 * 2. ACTIVATION IS A GATE, NOT A BUTTON. Activation refuses while any
 *    activation-blocking requirement is outstanding, and it says exactly which.
 *    An Owner may WAIVE an Opal requirement with a recorded reason; nothing
 *    here can turn a statutory verification status into a clearance that the
 *    issuing authority did not give.
 */

const express = require('express');
const router = express.Router();

const db = require('./database');
const email = require('./email');
const odb = require('./onboarding-db');
const engine = require('./onboarding-engine');
const { auditOnboarding, recordRequirementEvent } = require('./onboarding-audit');
const { requireAuth, requirePermission, getPermissions } = require('./permissions');
const log = require('./logger').createLogger('onboarding-assign');

const orgOf = (req) => req.user?.organisation_id || null;
const { isUuid, str } = odb;

const safe = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  log.error('assignment route error', { error: err, path: req.path });
  if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
});
const notFound = (res) => res.status(404).json({ error: 'Not found' });

/**
 * Durable in-app notification. Same indirection as learning-routes.js: the
 * helper lives in app-routes.js, and requiring it lazily avoids a circular
 * import at module-init time. Never throws — a notification is not worth
 * failing a user's action over.
 */
function notify(userId, payload) {
  if (!userId) return Promise.resolve();
  return Promise.resolve()
    .then(() => require('./app-routes').storeNotification(userId, payload))
    .catch(() => {});
}

router.use('/api/onboarding/assignments', requireAuth);

// ═════════════════════════════════════════════════════════════════════════════
//  Shaping
// ═════════════════════════════════════════════════════════════════════════════

function assignmentRow(a, { includeContact = true } = {}) {
  const pct = (done, total) => (total === 0 ? 100 : Math.round((done / total) * 100));
  return {
    id: a.id,
    applicantName: a.applicant_name,
    applicantEmail: includeContact ? a.applicant_email : undefined,
    jobTitle: a.job_title,
    proposedRole: a.proposed_role,
    isTreatingTherapist: a.is_treating_therapist,
    employmentType: a.employment_type,
    roleCategory: a.role_category,
    startDate: a.start_date,
    endDate: a.end_date,
    workLocation: a.work_location,
    managerName: a.manager_name,
    packageId: a.package_id,
    packageCode: a.package_code,
    packageTitle: a.package_title,
    packageVersionId: a.package_version_id,
    packageVersion: a.package_version,
    userId: a.user_id,
    userName: a.user_name,
    userEmail: includeContact ? a.user_email : undefined,
    userRole: a.user_role,
    status: a.status,
    facts: a.facts,
    dueAt: a.due_at,
    releasedAt: a.released_at,
    inviteAcceptedAt: a.invite_accepted_at,
    submittedAt: a.submitted_at,
    activatedAt: a.activated_at,
    cancelledAt: a.cancelled_at,
    cancelReason: a.cancel_reason,
    lastActivityAt: a.last_activity_at,
    ownerNote: a.owner_note,
    createdByName: a.created_by_name,
    createdAt: a.created_at,
    // The paper round-trip milestones (migration 038). The Active Onboarding
    // list reads these to answer "how far along is Jane?" — the requirement
    // meters below only begin once an account exists, so on their own they
    // report 0% for everybody still waiting on documents, which is the
    // opposite of the truth.
    starterPackGeneratedAt: a.starter_pack_generated_at || null,
    starterPackSentAt: a.starter_pack_sent_at || null,
    starterPackSentTo: includeContact ? (a.starter_pack_sent_to || null) : undefined,
    documentsReceivedAt: a.documents_received_at || null,
    extractionCompletedAt: a.extraction_completed_at || null,
    detailsReviewedAt: a.details_reviewed_at || null,
    accountCreatedAt: a.account_created_at || null,
    invitationSentAt: a.invitation_sent_at || null,
    firstLoginAt: a.first_login_at || null,
    loginEmail: includeContact ? (a.login_email || null) : undefined,
    progress: {
      employeeDone: a.employee_done, employeeTotal: a.employee_total,
      employeePercent: pct(a.employee_done, a.employee_total),
      employerDone: a.employer_done, employerTotal: a.employer_total,
      employerPercent: pct(a.employer_done, a.employer_total),
      blockingDone: a.blocking_done, blockingTotal: a.blocking_total,
    },
    overdue: a.due_at
      ? new Date(a.due_at) < new Date()
        && !['activated', 'completed', 'cancelled', 'archived'].includes(a.status)
      : false,
  };
}

function requirementRow(r, { forEmployee = false } = {}) {
  const snap = r.snapshot || {};
  return {
    id: r.id,
    code: r.template_code,
    title: r.title,
    summary: snap.summary || null,
    instructions: snap.instructions || null,
    section: r.section,
    sectionLabel: engine.SECTION_LABELS[r.section] || r.section,
    classification: r.classification,
    handler: r.handler,
    actor: r.actor,
    requiresEmployerVerification: r.requires_employer_verification,
    sensitivity: r.sensitivity,
    sortOrder: r.sort_order,
    mandatory: r.mandatory,
    blocksActivation: r.blocks_activation,
    status: r.status,
    dueAt: r.due_at,
    formKey: snap.form_key || null,
    credentialType: snap.credential_type || null,
    externalUrl: snap.external_url || null,
    document: snap.document || null,
    documentVersionId: snap.document_version_id || null,
    compliance: snap.compliance || null,
    config: snap.config || {},
    // Non-sensitive completion data only. The employee's own values live in
    // the tiered tables and are fetched through their own permission gate.
    data: r.data || {},
    evidenceDocumentTitle: r.evidence_document_title || null,
    evidenceFileName: r.evidence_file_name || null,
    credentialId: r.credential_id || null,
    credentialName: r.credential_name || null,
    credentialExpiry: r.credential_expiry || null,
    credentialLifecycleStatus: r.credential_lifecycle_status || null,
    learningAssignmentId: r.learning_assignment_id || null,
    learningStatus: r.learning_status || null,
    learningProgress: r.learning_progress ?? null,
    submittedAt: r.submitted_at,
    completedAt: r.completed_at,
    expiresAt: r.expires_at,
    // Review detail is employer-facing. An employee sees the correction
    // reason (they must, to act on it) but not internal notes or reviewer id.
    reviewDecision: forEmployee ? undefined : r.review_decision,
    reviewReason: r.status === 'correction_required' ? r.review_reason : (forEmployee ? undefined : r.review_reason),
    reviewedAt: forEmployee ? undefined : r.reviewed_at,
    reviewedByName: forEmployee ? undefined : r.reviewed_by_name,
    waived: forEmployee ? undefined : r.waived,
    waivedReason: forEmployee ? undefined : r.waived_reason,
  };
}

/** Group requirements into the employee-facing section list. */
function groupSections(requirements, opts) {
  const bySection = new Map();
  for (const r of requirements) {
    if (!bySection.has(r.section)) bySection.set(r.section, []);
    bySection.get(r.section).push(requirementRow(r, opts));
  }
  return engine.SECTIONS
    .filter((s) => bySection.has(s))
    .map((s) => {
      const items = bySection.get(s);
      const employeeItems = items.filter((i) => i.actor === 'employee' || i.actor === 'both');
      const done = employeeItems.filter((i) => engine.isEmployeeItem({ actor: i.actor })
        && ['submitted', 'awaiting_verification', 'verified', 'complete', 'not_applicable'].includes(i.status));
      return {
        key: s,
        label: engine.SECTION_LABELS[s] || s,
        requirements: items,
        employeeTotal: employeeItems.length,
        employeeDone: done.length,
        complete: employeeItems.length > 0 && done.length >= employeeItems.length,
      };
    });
}

module.exports.assignmentRow = assignmentRow;
module.exports.requirementRow = requirementRow;
module.exports.groupSections = groupSections;

// ═════════════════════════════════════════════════════════════════════════════
//  LIST + READ
// ═════════════════════════════════════════════════════════════════════════════

router.get('/api/onboarding/assignments', requirePermission('onboarding.view'),
  safe(async (req, res) => {
    const rows = await odb.listAssignments(orgOf(req), {
      status: req.query.status,
      active: req.query.active === '1',
      packageId: req.query.packageId,
      employmentType: req.query.employmentType,
      roleCategory: req.query.roleCategory,
      assignedBy: req.query.assignedBy,
      search: req.query.search,
    });
    res.json({ ok: true, assignments: rows.map((a) => assignmentRow(a)) });
  }));

router.get('/api/onboarding/assignments/:id', requirePermission('onboarding.view'),
  safe(async (req, res) => {
    const a = await odb.getAssignment(orgOf(req), req.params.id);
    if (!a) return notFound(res);
    const requirements = await odb.listRequirements(a.id);
    const activation = engine.evaluateActivation(requirements);

    res.json({
      ok: true,
      assignment: assignmentRow(a),
      sections: groupSections(requirements, { forEmployee: false }),
      activation,
      canActivate: activation.ok
        && !['activated', 'completed', 'cancelled', 'archived'].includes(a.status),
    });
  }));

router.get('/api/onboarding/assignments/:id/history', requirePermission('onboarding.audit'),
  safe(async (req, res) => {
    const a = await odb.getAssignment(orgOf(req), req.params.id);
    if (!a) return notFound(res);
    const { rows } = await odb.pool.query(
      `SELECT e.*, u.name AS actor_name, r.title AS requirement_title, r.template_code
         FROM onboarding_requirement_events e
         LEFT JOIN users u ON u.id = e.actor_user_id
         LEFT JOIN onboarding_requirements r ON r.id = e.requirement_id
        WHERE e.assignment_id = $1 ORDER BY e.created_at DESC LIMIT 500`, [a.id]
    );
    res.json({ ok: true, events: rows });
  }));

// ═════════════════════════════════════════════════════════════════════════════
//  ASSIGN
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Create an assignment. This does NOT invite anyone — release does that.
 * Splitting the two lets the Owner review exactly what the person will be
 * asked for before an email leaves the building.
 */
router.post('/api/onboarding/assignments', requirePermission('onboarding.assign'),
  safe(async (req, res) => {
    const b = req.body || {};
    const org = orgOf(req);

    if (!b.applicantName) return res.status(400).json({ error: 'applicantName is required' });
    if (!b.applicantEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.applicantEmail).trim())) {
      return res.status(400).json({ error: 'A valid applicantEmail is required' });
    }
    if (!engine.EMPLOYMENT_TYPES.includes(b.employmentType)) {
      return res.status(400).json({ error: 'employmentType is not recognised' });
    }
    if (!isUuid(b.packageId)) return res.status(400).json({ error: 'packageId is required' });
    if (b.proposedRole && !['owner', 'admin', 'therapist', 'read_only'].includes(b.proposedRole)) {
      return res.status(400).json({ error: 'proposedRole is not recognised' });
    }

    const applicantEmail = String(b.applicantEmail).trim().toLowerCase();

    const pkg = await odb.getPackage(org, b.packageId);
    if (!pkg) return res.status(400).json({ error: 'Unknown package' });
    if (pkg.kind !== 'package') {
      return res.status(400).json({ error: 'Base and overlay packages cannot be assigned directly' });
    }
    const version = await odb.getCurrentPackageVersion(pkg.id);
    if (!version) {
      return res.status(409).json({ error: 'This package has no published version yet' });
    }

    // An existing ACTIVE account should not be sent through new-starter
    // onboarding by accident; the Owner has to deal with that deliberately.
    const existingUser = await db.getUserByEmail(applicantEmail);
    if (existingUser && existingUser.role !== 'pre_employee') {
      return res.status(409).json({
        error: 'An active account already exists for this email address.',
        code: 'account_exists',
      });
    }

    const settings = await odb.getOnboardingSettings();
    const dueDays = Number(b.dueDays) || settings.defaultDueDays || 14;

    const facts = engine.buildFacts({
      employment_type: b.employmentType,
      role_category: b.roleCategory,
      proposed_role: b.proposedRole || 'therapist',
      is_treating_therapist: b.isTreatingTherapist === true,
      child_related_work: b.childRelatedWork || 'assessment_required',
      ndis_risk_assessed_role: b.ndisRiskAssessedRole || 'requires_determination',
      mobile_community_role: b.mobileCommunityRole === true,
      uses_own_vehicle: b.usesOwnVehicle === true,
      new_graduate: b.newGraduate === true,
      work_rights_check_required: b.workRightsCheckRequired === true,
    }, settings);

    let created;
    try {
      const { rows } = await odb.pool.query(
        // login_email defaults to the address the starter pack goes to, and
        // stays changeable at account creation — §54: the personal address
        // somebody applies with and the address they eventually sign in with
        // are not always the same, and assuming they are is how a new starter
        // ends up locked out on the day their Opal mailbox is created.
        `INSERT INTO onboarding_assignments
           (organisation_id, package_id, package_version_id, applicant_name, applicant_email,
            job_title, proposed_role, is_treating_therapist, employment_type, role_category,
            start_date, end_date, manager_user_id, work_location, facts, due_at,
            owner_note, created_by, mobile, work_email, login_email)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
                 NOW() + ($16 || ' days')::INTERVAL, $17, $18, $19, $20, $21)
         RETURNING *`,
        [
          org, pkg.id, version.id, str(b.applicantName, 200), applicantEmail,
          str(b.jobTitle, 150), b.proposedRole || 'therapist', b.isTreatingTherapist === true,
          b.employmentType, str(b.roleCategory, 40),
          odb.dateOrNull(b.startDate), odb.dateOrNull(b.endDate),
          isUuid(b.managerUserId) ? b.managerUserId : null, str(b.workLocation, 150),
          JSON.stringify(facts), String(dueDays), str(b.ownerNote, 2000), req.user.id,
          str(b.mobile, 40),
          b.workEmail ? String(b.workEmail).trim().toLowerCase().slice(0, 255) : null,
          // Defaulted here rather than with COALESCE in the statement: reusing
          // $5 inside a COALESCE made Postgres deduce two types for the same
          // parameter and refuse the insert outright.
          b.loginEmail
            ? String(b.loginEmail).trim().toLowerCase().slice(0, 255)
            : applicantEmail,
        ]
      );
      created = rows[0];
    } catch (err) {
      // The partial unique index on (org, lower(email)) for live runs.
      if (err.code === '23505') {
        return res.status(409).json({
          error: 'An onboarding run is already in progress for this email address.',
          code: 'assignment_exists',
        });
      }
      throw err;
    }

    await auditOnboarding(req, 'assignment_created', {
      targetType: 'onboarding_assignment', targetId: created.id,
      metadata: {
        assignmentId: created.id, packageId: pkg.id, code: pkg.code,
        packageVersionId: version.id, version: version.version,
        employmentType: created.employment_type, roleCategory: created.role_category,
        role: created.proposed_role,
      },
    });

    const full = await odb.getAssignment(org, created.id);
    const { applied, skipped } = engine.selectApplicable(version.content, facts);
    res.status(201).json({
      ok: true,
      assignment: assignmentRow(full),
      preview: {
        willIssue: applied.length,
        skipped,
        blocking: applied.filter((r) => r.blocks_activation).length,
      },
    });
  }));

// ═════════════════════════════════════════════════════════════════════════════
//  RELEASE — create the pre-employee, materialise requirements, send the invite
// ═════════════════════════════════════════════════════════════════════════════

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

router.post('/api/onboarding/assignments/:id/release', requirePermission('onboarding.assign'),
  safe(async (req, res) => {
    const org = orgOf(req);
    const assignment = await odb.getAssignment(org, req.params.id);
    if (!assignment) return notFound(res);
    if (assignment.status !== 'created') {
      return res.status(409).json({ error: `This onboarding is already ${assignment.status.replace(/_/g, ' ')}` });
    }

    // Refuse to collect a TFN or bank account we cannot encrypt. Better to
    // block the release than to invite someone into a form that will store
    // their tax details in clear.
    if (!odb.isEncryptionConfigured() && process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
      return res.status(503).json({
        error: 'Field encryption is not configured',
        message: 'ONBOARDING_ENCRYPTION_KEY must be set before onboarding can collect tax or bank details.',
        code: 'ENCRYPTION_UNAVAILABLE',
      });
    }

    const version = await odb.getPackageVersion(assignment.package_version_id);
    if (!version) return res.status(409).json({ error: 'The pinned package version is missing' });
    const settings = await odb.getOnboardingSettings();

    // Refuse to ask someone to acknowledge a policy that does not exist yet.
    //
    // Opal's policy library seeds as slots awaiting real content — the feature
    // deliberately does not fabricate authoritative-looking policies. The
    // consequence is that a package can name a policy nobody has written, and
    // issuing that requirement would let an employee "acknowledge" an empty
    // document and produce a compliance record that means nothing.
    //
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
      return res.status(409).json({
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

    const outcome = await odb.withTransaction(async (q) => {
      // 1. Pre-employee account. Created without a password: the invitation is
      //    what lets them set one. No temporary password is ever generated or
      //    emailed.
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
      const inviteDays = Math.max(1, Math.min(Number(req.body?.expiresInDays) || 14, 60));
      const token = require('crypto').randomBytes(32).toString('hex');
      const { rows: invRows } = await q.query(
        `INSERT INTO user_invites
           (organisation_id, email, role, invited_by_user_id, is_treating_therapist,
            display_name_hint, invite_token, expires_at, onboarding_assignment_id, metadata)
         VALUES ($1, LOWER($2), 'pre_employee', $3, $4, $5, $6,
                 NOW() + ($7 || ' days')::INTERVAL, $8, $9)
         RETURNING *`,
        [
          org, assignment.applicant_email, req.user.id, assignment.is_treating_therapist,
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
      await odb.upsertEmploymentProfile(userId, org, {
        assignmentId: assignment.id,
        jobTitle: assignment.job_title,
        employmentType: assignment.employment_type,
        roleCategory: assignment.role_category,
        startDate: assignment.start_date,
        endDate: assignment.end_date,
        managerUserId: assignment.manager_user_id,
        workLocation: assignment.work_location,
        childRelatedWork: assignment.facts?.child_related_work || 'assessment_required',
        ndisRiskAssessedRole: assignment.facts?.ndis_risk_assessed_role || 'requires_determination',
        mobileCommunityRole: assignment.facts?.mobile_community_role === true,
        usesOwnVehicle: assignment.facts?.uses_own_vehicle === true,
        determinedBy: req.user.id,
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
    //    Owner still gets the link back so they can deliver it another way.
    let emailResult = null;
    try {
      emailResult = await email.sendOnboardingInviteEmail({
        toEmail: assignment.applicant_email,
        inviteToken: outcome.invite.invite_token,
        displayName: assignment.applicant_name,
        roleTitle: assignment.job_title || assignment.package_title,
        startDate: assignment.start_date,
        dueAt: assignment.due_at,
        invitedBy: req.user.name || req.user.email,
      });
    } catch (err) {
      log.warn('onboarding invite email failed', { error: err, assignmentId: assignment.id });
      emailResult = { failed: true, onboardingUrl: email.buildOnboardingInviteUrl(outcome.invite.invite_token) };
    }

    await auditOnboarding(req, 'assignment_released', {
      targetType: 'onboarding_assignment', targetId: assignment.id,
      metadata: {
        assignmentId: assignment.id, subjectUserId: outcome.userId,
        inviteId: outcome.invite.id, requirementCount: outcome.issued,
        emailSent: emailResult?.sent || false,
        emailSkipped: emailResult?.skipped || false,
        emailFailed: emailResult?.failed || false,
      },
    });
    await auditOnboarding(req, 'invitation_sent', {
      targetType: 'invite', targetId: outcome.invite.id,
      metadata: { assignmentId: assignment.id, subjectUserId: outcome.userId },
    });

    const full = await odb.getAssignment(org, assignment.id);
    res.status(201).json({
      ok: true,
      assignment: assignmentRow(full),
      requirementsIssued: outcome.issued,
      emailSent: emailResult?.sent || false,
      emailSkipped: emailResult?.skipped || false,
      emailFailed: emailResult?.failed || false,
      // Returned only on release, and only to the person who released it.
      onboardingUrl: emailResult?.onboardingUrl
        || email.buildOnboardingInviteUrl(outcome.invite.invite_token),
    });
  }));

/** Re-send the invitation for a released, not-yet-accepted onboarding. */
router.post('/api/onboarding/assignments/:id/resend-invite', requirePermission('onboarding.assign'),
  safe(async (req, res) => {
    const assignment = await odb.getAssignment(orgOf(req), req.params.id);
    if (!assignment) return notFound(res);
    if (assignment.status !== 'invite_sent') {
      return res.status(409).json({ error: 'This onboarding is not awaiting invitation acceptance' });
    }
    const { rows } = await odb.pool.query(
      `SELECT * FROM user_invites
        WHERE onboarding_assignment_id = $1 AND status = 'pending'
          AND (expires_at IS NULL OR expires_at > NOW())
        ORDER BY invited_at DESC LIMIT 1`, [assignment.id]
    );
    const invite = rows[0];
    if (!invite) return res.status(409).json({ error: 'No valid pending invitation — release again to issue a new one' });

    const result = await email.sendOnboardingInviteEmail({
      toEmail: invite.email,
      inviteToken: invite.invite_token,
      displayName: assignment.applicant_name,
      roleTitle: assignment.job_title || assignment.package_title,
      startDate: assignment.start_date,
      dueAt: assignment.due_at,
      invitedBy: req.user.name || req.user.email,
    }).catch((err) => ({ failed: true, error: err.message }));

    await auditOnboarding(req, 'invitation_resent', {
      targetType: 'invite', targetId: invite.id,
      metadata: { assignmentId: assignment.id, emailSent: result?.sent || false },
    });
    res.json({
      ok: true,
      emailSent: result?.sent || false,
      emailSkipped: result?.skipped || false,
      emailFailed: result?.failed || false,
    });
  }));

/**
 * Retrieve the invitation link for manual delivery.
 * Explicit, audited, and the only post-release way to obtain the token —
 * mirroring the existing /api/invites/:id/link precedent.
 */
router.get('/api/onboarding/assignments/:id/invite-link', requirePermission('onboarding.assign'),
  safe(async (req, res) => {
    const assignment = await odb.getAssignment(orgOf(req), req.params.id);
    if (!assignment) return notFound(res);
    const { rows } = await odb.pool.query(
      `SELECT * FROM user_invites
        WHERE onboarding_assignment_id = $1 AND status = 'pending'
          AND (expires_at IS NULL OR expires_at > NOW())
        ORDER BY invited_at DESC LIMIT 1`, [assignment.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'No valid pending invitation' });

    await auditOnboarding(req, 'invitation_link_retrieved', {
      targetType: 'invite', targetId: rows[0].id, metadata: { assignmentId: assignment.id },
    });
    res.json({
      ok: true,
      onboardingUrl: email.buildOnboardingInviteUrl(rows[0].invite_token),
      expiresAt: rows[0].expires_at,
    });
  }));

// ═════════════════════════════════════════════════════════════════════════════
//  EMPLOYER REVIEW
// ═════════════════════════════════════════════════════════════════════════════

/** Load an assignment + requirement pair, or null. */
async function loadPair(req) {
  const assignment = await odb.getAssignment(orgOf(req), req.params.id);
  if (!assignment) return null;
  const requirement = await odb.getRequirement(assignment.id, req.params.rid);
  if (!requirement) return null;
  return { assignment, requirement };
}

/** Apply a reviewed status change with transition checking and history. */
async function applyReview(req, res, {
  toStatus, decision, reasonRequired, eventType, extra = {},
}) {
  const pair = await loadPair(req);
  if (!pair) return notFound(res);
  const { assignment, requirement } = pair;

  const reason = str(req.body?.reason, 1000);
  if (reasonRequired && !reason) {
    return res.status(400).json({ error: 'A reason is required' });
  }
  if (!engine.canTransition(requirement.status, toStatus)) {
    return res.status(409).json({
      error: `Cannot move this requirement from ${requirement.status.replace(/_/g, ' ')} to ${toStatus.replace(/_/g, ' ')}`,
    });
  }

  const result = await odb.withTransaction(async (q) => {
    await q.query(
      // $2 cast for the same reason as above: assignment infers varchar, the
      // CASE comparison infers text, and an uncast parameter is refused.
      `UPDATE onboarding_requirements SET
         status = $2::text, review_decision = $3, review_reason = $4,
         reviewed_by = $5, reviewed_at = NOW(),
         waived = COALESCE($6, waived),
         waived_reason = COALESCE($7, waived_reason),
         waived_by = CASE WHEN $6 = TRUE THEN $5 ELSE waived_by END,
         waived_at = CASE WHEN $6 = TRUE THEN NOW() ELSE waived_at END,
         completed_at = CASE WHEN $2::text IN ('verified','complete','not_applicable')
                             THEN NOW() ELSE completed_at END,
         expires_at = COALESCE($8, expires_at),
         updated_at = NOW()
       WHERE id = $1`,
      [
        requirement.id, toStatus, decision, reason, req.user.id,
        extra.waived === undefined ? null : extra.waived,
        extra.waivedReason || null,
        extra.expiresAt || null,
      ]
    );
    await recordRequirementEvent(q, {
      requirementId: requirement.id, assignmentId: assignment.id,
      actorUserId: req.user.id, actorRole: req.user.role,
      eventType, fromStatus: requirement.status, toStatus, reason,
      metadata: { templateCode: requirement.template_code, decision },
    });
    return odb.recomputeAssignment(q, assignment.id);
  });

  await auditOnboarding(req, eventType, {
    targetType: 'onboarding_requirement', targetId: requirement.id,
    metadata: {
      assignmentId: assignment.id, requirementId: requirement.id,
      templateCode: requirement.template_code,
      fromStatus: requirement.status, toStatus, decision,
      reason: reason ? reason.slice(0, 200) : undefined,
    },
  });

  // Tell the employee when they have something to do again.
  if (toStatus === 'correction_required' && assignment.user_id) {
    await notify(assignment.user_id, {
      type: `onboarding_correction_${requirement.id}`,
      title: 'Action required on your onboarding',
      message: `"${requirement.title}" needs your attention: ${reason}`,
      severity: 'warning',
      relatedEntity: 'onboarding_requirement',
      actionPayload: { assignmentId: assignment.id, requirementId: requirement.id },
    }).catch(() => {});
  }

  const requirements = await odb.listRequirements(assignment.id);
  const activation = engine.evaluateActivation(requirements);
  res.json({
    ok: true,
    requirement: requirementRow(requirements.find((r) => r.id === requirement.id)),
    assignment: assignmentRow(await odb.getAssignment(orgOf(req), assignment.id)),
    activation,
  });
}

router.post('/api/onboarding/assignments/:id/requirements/:rid/approve',
  requirePermission('onboarding.review'), safe((req, res) => applyReview(req, res, {
    toStatus: 'complete', decision: 'approved', reasonRequired: false,
    eventType: 'requirement_approved',
  })));

router.post('/api/onboarding/assignments/:id/requirements/:rid/verify',
  requirePermission('onboarding.verify'), safe((req, res) => applyReview(req, res, {
    toStatus: 'verified', decision: 'verified', reasonRequired: false,
    eventType: 'requirement_verified',
    extra: { expiresAt: odb.dateOrNull(req.body?.expiresAt) },
  })));

router.post('/api/onboarding/assignments/:id/requirements/:rid/request-correction',
  requirePermission('onboarding.review'), safe((req, res) => applyReview(req, res, {
    toStatus: 'correction_required', decision: 'correction_requested', reasonRequired: true,
    eventType: 'correction_requested',
  })));

router.post('/api/onboarding/assignments/:id/requirements/:rid/not-applicable',
  requirePermission('onboarding.review'), safe((req, res) => applyReview(req, res, {
    toStatus: 'not_applicable', decision: 'not_applicable', reasonRequired: true,
    eventType: 'requirement_marked_not_applicable',
  })));

/**
 * Waive an activation-blocking requirement.
 *
 * Owner-only, and refused outright for statutory verifications. Waiving
 * "Police check — role has no participant contact" is a legitimate
 * organisational decision. Waiving an NDIS worker screening exclusion is not a
 * decision Opal is entitled to make, so the route says no rather than
 * recording a comfortable fiction.
 */
const STATUTORY_CODES = new Set(['REQ_NDIS_SCREENING', 'REQ_WWCC', 'REQ_AHPRA', 'REQ_RIGHT_TO_WORK']);

router.post('/api/onboarding/assignments/:id/requirements/:rid/waive',
  requirePermission('onboarding.activate'), safe(async (req, res) => {
    if (req.user.role !== 'owner') {
      return res.status(403).json({ error: 'Only the practice owner can waive a requirement' });
    }
    const pair = await loadPair(req);
    if (!pair) return notFound(res);
    if (STATUTORY_CODES.has(pair.requirement.template_code)) {
      return res.status(409).json({
        error: 'This requirement cannot be waived',
        message: 'Registration, screening and work-rights checks record what the issuing '
          + 'authority actually says. Mark it not applicable with a reason if the role '
          + 'genuinely does not require it.',
      });
    }
    const reason = str(req.body?.reason, 1000);
    if (!reason) return res.status(400).json({ error: 'A reason is required to waive a requirement' });

    return applyReview(req, res, {
      toStatus: 'complete', decision: 'waived', reasonRequired: true,
      eventType: 'requirement_waived',
      extra: { waived: true, waivedReason: reason },
    });
  }));

/** An internal note. Visible to reviewers, never to the employee. */
router.post('/api/onboarding/assignments/:id/requirements/:rid/note',
  requirePermission('onboarding.review'), safe(async (req, res) => {
    const pair = await loadPair(req);
    if (!pair) return notFound(res);
    const note = str(req.body?.note, 1000);
    if (!note) return res.status(400).json({ error: 'note is required' });

    await recordRequirementEvent(odb.pool, {
      requirementId: pair.requirement.id, assignmentId: pair.assignment.id,
      actorUserId: req.user.id, actorRole: req.user.role,
      eventType: 'note_added', reason: note,
      metadata: { templateCode: pair.requirement.template_code },
    });
    res.status(201).json({ ok: true });
  }));

// ═════════════════════════════════════════════════════════════════════════════
//  ACTIVATION
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Convert a pre-employee into staff.
 *
 * Refuses while anything blocking is outstanding, and returns the blockers so
 * the Owner can see precisely what is missing rather than a bare "cannot
 * activate". Idempotent: an already-activated assignment answers 409 and the
 * activated_from_onboarding_at stamp makes a double-run impossible.
 */
router.post('/api/onboarding/assignments/:id/activate', requirePermission('onboarding.activate'),
  safe(async (req, res) => {
    const org = orgOf(req);
    const assignment = await odb.getAssignment(org, req.params.id);
    if (!assignment) return notFound(res);

    if (['activated', 'completed'].includes(assignment.status)) {
      return res.status(409).json({ error: 'This employee has already been activated' });
    }
    if (['cancelled', 'archived'].includes(assignment.status)) {
      return res.status(409).json({ error: `This onboarding is ${assignment.status}` });
    }
    if (!assignment.user_id) {
      return res.status(409).json({ error: 'This onboarding has not been released yet' });
    }

    const requirements = await odb.listRequirements(assignment.id);
    const activation = engine.evaluateActivation(requirements);
    if (!activation.ok) {
      return res.status(409).json({
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

      // Employment profile becomes live staff data.
      await q.query(
        `UPDATE employment_profiles SET status = 'active', updated_at = NOW() WHERE user_id = $1`,
        [assignment.user_id]
      );

      // Payroll setup task, where payroll data exists but is not yet configured.
      await q.query(
        `UPDATE payroll_profiles
            SET payroll_setup_status = CASE WHEN payroll_setup_status = 'not_required'
                                            THEN 'setup_required' ELSE payroll_setup_status END,
                updated_at = NOW()
          WHERE user_id = $1`, [assignment.user_id]
      );

      // Credentials collected during onboarding join the ongoing compliance
      // register rather than staying inside a finished onboarding run.
      await q.query(
        `UPDATE credentials SET status = CASE WHEN status = 'pending_review' THEN 'active' ELSE status END,
                                updated_at = NOW()
          WHERE user_id = $1 AND source = 'onboarding' AND status = 'verified'`,
        [assignment.user_id]
      );

      // Any invitation still outstanding is spent.
      await q.query(
        `UPDATE user_invites SET status = 'accepted', accepted_at = COALESCE(accepted_at, NOW()),
                                 updated_at = CURRENT_TIMESTAMP
          WHERE onboarding_assignment_id = $1 AND status = 'pending'`, [assignment.id]
      );

      const { rows } = await q.query(
        `UPDATE onboarding_assignments
            SET status = 'activated', activated_at = NOW(), activated_by = $2,
                completed_at = NOW(), last_activity_at = NOW(), updated_at = NOW()
          WHERE id = $1 RETURNING *`, [assignment.id, req.user.id]
      );
      return { user: userRows[0], assignment: rows[0] };
    }).catch((err) => {
      if (err.code === 'ALREADY_ACTIVATED') return null;
      throw err;
    });

    if (!outcome) {
      return res.status(409).json({ error: 'This employee has already been activated' });
    }

    await auditOnboarding(req, 'employee_activated', {
      targetType: 'user', targetId: assignment.user_id,
      metadata: {
        assignmentId: assignment.id, subjectUserId: assignment.user_id,
        role: assignment.proposed_role, previousRole: 'pre_employee',
        employmentType: assignment.employment_type,
      },
    });

    // Welcome the person and tell the Owner it is done.
    await notify(assignment.user_id, {
      type: `onboarding_activated_${assignment.id}`,
      title: 'Your Opal Therapy account is active',
      message: 'Your onboarding is complete and your portal access is now active.',
      severity: 'success',
      relatedEntity: 'onboarding_assignment',
      actionPayload: { assignmentId: assignment.id },
    }).catch(() => {});

    let emailResult = null;
    try {
      emailResult = await email.sendAccountApprovedEmail({
        toEmail: outcome.user.email,
        name: outcome.user.name,
        role: outcome.user.role,
      });
    } catch (err) {
      log.warn('activation email failed', { error: err, assignmentId: assignment.id });
    }

    const full = await odb.getAssignment(org, assignment.id);
    res.json({
      ok: true,
      assignment: assignmentRow(full),
      user: outcome.user,
      emailSent: emailResult?.sent || false,
    });
  }));

// ═════════════════════════════════════════════════════════════════════════════
//  CANCEL / ARCHIVE
// ═════════════════════════════════════════════════════════════════════════════

router.post('/api/onboarding/assignments/:id/cancel', requirePermission('onboarding.assign'),
  safe(async (req, res) => {
    const assignment = await odb.getAssignment(orgOf(req), req.params.id);
    if (!assignment) return notFound(res);
    if (['activated', 'completed', 'cancelled', 'archived'].includes(assignment.status)) {
      return res.status(409).json({ error: `This onboarding is already ${assignment.status}` });
    }
    const reason = str(req.body?.reason, 500);
    if (!reason) return res.status(400).json({ error: 'A reason is required' });

    await odb.withTransaction(async (q) => {
      await q.query(
        `UPDATE onboarding_assignments
            SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = $2,
                cancel_reason = $3, updated_at = NOW()
          WHERE id = $1`, [assignment.id, req.user.id, reason]
      );
      // Revoke the invitation so the link stops working immediately.
      await q.query(
        `UPDATE user_invites SET status = 'revoked', revoked_at = NOW(),
                                 revoked_by_user_id = $2, updated_at = CURRENT_TIMESTAMP
          WHERE onboarding_assignment_id = $1 AND status = 'pending'`,
        [assignment.id, req.user.id]
      );
      // A pre-employee who never became staff loses access at the same moment.
      if (assignment.user_id) {
        await q.query(
          `UPDATE users SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND role = 'pre_employee'`, [assignment.user_id]
        );
      }
    });

    await auditOnboarding(req, 'assignment_cancelled', {
      targetType: 'onboarding_assignment', targetId: assignment.id,
      metadata: { assignmentId: assignment.id, reason: reason.slice(0, 200) },
    });
    res.json({ ok: true });
  }));

router.post('/api/onboarding/assignments/:id/archive', requirePermission('onboarding.assign'),
  safe(async (req, res) => {
    const assignment = await odb.getAssignment(orgOf(req), req.params.id);
    if (!assignment) return notFound(res);
    if (!['activated', 'completed', 'cancelled'].includes(assignment.status)) {
      return res.status(409).json({ error: 'Only a finished onboarding can be archived' });
    }
    await odb.pool.query(
      `UPDATE onboarding_assignments SET status = 'archived', archived_at = NOW(), updated_at = NOW()
        WHERE id = $1`, [assignment.id]
    );
    await auditOnboarding(req, 'assignment_archived', {
      targetType: 'onboarding_assignment', targetId: assignment.id,
      metadata: { assignmentId: assignment.id },
    });
    res.json({ ok: true });
  }));

// ═════════════════════════════════════════════════════════════════════════════
//  EMPLOYER-SIDE DATA VIEWS  (tiered, each with its own permission)
// ═════════════════════════════════════════════════════════════════════════════

router.get('/api/onboarding/assignments/:id/personal-details',
  requirePermission('onboarding.review'), safe(async (req, res) => {
    const a = await odb.getAssignment(orgOf(req), req.params.id);
    if (!a || !a.user_id) return notFound(res);
    const details = await odb.getPersonalDetails(a.user_id);
    await auditOnboarding(req, 'personal_details_viewed', {
      targetType: 'user', targetId: a.user_id,
      metadata: { assignmentId: a.id, subjectUserId: a.user_id },
    });
    res.json({ ok: true, personalDetails: details });
  }));

router.get('/api/onboarding/assignments/:id/payroll',
  requirePermission('onboarding.payroll'), safe(async (req, res) => {
    const a = await odb.getAssignment(orgOf(req), req.params.id);
    if (!a || !a.user_id) return notFound(res);
    const payroll = await odb.getPayrollProfileMasked(a.user_id);
    await auditOnboarding(req, 'payroll_viewed', {
      targetType: 'user', targetId: a.user_id,
      metadata: { assignmentId: a.id, subjectUserId: a.user_id },
    });
    res.json({ ok: true, payroll: odb.payrollView(payroll) });
  }));

router.get('/api/onboarding/assignments/:id/identity',
  requirePermission('onboarding.sensitive_identity'), safe(async (req, res) => {
    const a = await odb.getAssignment(orgOf(req), req.params.id);
    if (!a || !a.user_id) return notFound(res);
    const records = await odb.listIdentityRecordsMasked(a.user_id);
    await auditOnboarding(req, 'identity_viewed', {
      targetType: 'user', targetId: a.user_id,
      metadata: { assignmentId: a.id, subjectUserId: a.user_id },
    });
    res.json({ ok: true, identityRecords: records });
  }));

/**
 * Payroll handoff export — the ONE path that decrypts.
 *
 * Owner-only on top of onboarding.payroll, audited before the data is read,
 * and returned once rather than stored anywhere. This is the boundary a Xero
 * (or any payroll) integration consumes; it is deliberately a structured
 * export rather than a screen, because nothing should render these values.
 */
router.post('/api/onboarding/assignments/:id/payroll-export',
  requirePermission('onboarding.payroll'), safe(async (req, res) => {
    if (req.user.role !== 'owner') {
      return res.status(403).json({ error: 'Only the practice owner can export payroll data' });
    }
    const a = await odb.getAssignment(orgOf(req), req.params.id);
    if (!a || !a.user_id) return notFound(res);

    const reason = str(req.body?.reason, 500);
    if (!reason) {
      return res.status(400).json({ error: 'A reason is required to export payroll data' });
    }

    // Audited BEFORE the decrypt, so an export that then fails still leaves a
    // record that the attempt was made.
    await auditOnboarding(req, 'payroll_exported', {
      targetType: 'user', targetId: a.user_id,
      metadata: { assignmentId: a.id, subjectUserId: a.user_id, reason: reason.slice(0, 200) },
    });

    const [payroll, personal, employment] = await Promise.all([
      odb.decryptPayrollForExport(a.user_id),
      odb.getPersonalDetails(a.user_id),
      odb.getEmploymentProfile(a.user_id),
    ]);
    if (!payroll) return res.status(404).json({ error: 'No payroll record for this employee' });

    await odb.setPayrollStatus(a.user_id, { payrollSetupStatus: 'exported' }, req.user.id);

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      exportedAt: new Date().toISOString(),
      employee: {
        legalFirstName: personal?.legal_first_name,
        middleName: personal?.middle_name,
        surname: personal?.surname,
        preferredName: personal?.preferred_name,
        dateOfBirth: personal?.date_of_birth,
        email: a.applicant_email,
        mobile: personal?.mobile,
        address: personal ? {
          line1: personal.address_line1, line2: personal.address_line2,
          suburb: personal.suburb, state: personal.state,
          postcode: personal.postcode, country: personal.country,
        } : null,
      },
      employment: employment ? {
        jobTitle: employment.job_title, employmentType: employment.employment_type,
        startDate: employment.start_date, endDate: employment.end_date,
        hoursPerWeek: employment.hours_per_week,
        awardClassification: employment.award_classification,
      } : null,
      payroll,
    });
  }));

/**
 * HR archive of a completed onboarding.
 *
 * Deliberately EXCLUDES the tax file number and full bank details: an archive
 * is a record of what was collected and verified, not a second copy of the
 * most sensitive values sitting in someone's downloads folder. Masked forms
 * carry every bit of meaning an HR file actually needs.
 */
router.post('/api/onboarding/assignments/:id/archive-export',
  requirePermission('onboarding.audit'), safe(async (req, res) => {
    const a = await odb.getAssignment(orgOf(req), req.params.id);
    if (!a || !a.user_id) return notFound(res);

    const [requirements, credentials, acks, issuances, employment, personal, payroll, identity, events] =
      await Promise.all([
        odb.listRequirements(a.id),
        odb.listCredentialsForUser(a.user_id),
        odb.listAcknowledgements(a.user_id),
        odb.listStatementIssuances(a.user_id),
        odb.getEmploymentProfile(a.user_id),
        odb.getPersonalDetails(a.user_id),
        odb.getPayrollProfileMasked(a.user_id),
        odb.listIdentityRecordsMasked(a.user_id),
        odb.pool.query(
          `SELECT event_type, from_status, to_status, reason, created_at, actor_user_id
             FROM onboarding_requirement_events WHERE assignment_id = $1
            ORDER BY created_at`, [a.id]
        ).then((r) => r.rows),
      ]);

    await auditOnboarding(req, 'archive_exported', {
      targetType: 'onboarding_assignment', targetId: a.id,
      metadata: {
        assignmentId: a.id, subjectUserId: a.user_id,
        packageVersionId: a.package_version_id, version: a.package_version,
      },
    });

    const perms = getPermissions(req.user.role, req.user.permissions || []);

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      generatedBy: { id: req.user.id, name: req.user.name },
      note: 'Tax file numbers and full bank account numbers are deliberately excluded from this archive.',
      assignment: assignmentRow(a),
      package: { code: a.package_code, title: a.package_title, version: a.package_version },
      employment,
      personalDetails: perms.includes('onboarding.review') ? personal : undefined,
      payrollSummary: perms.includes('onboarding.payroll') ? {
        bankStatus: payroll?.bank_status,
        bsbMasked: payroll?.bsb_masked,
        accountNumberLast4: payroll?.account_number_last4,
        taxSetupStatus: payroll?.tax_setup_status,
        taxSubmissionMethod: payroll?.tax_submission_method,
        tfnProvided: payroll?.tfn_provided,
        superStatus: payroll?.super_status,
        superFundName: payroll?.super_fund_name,
        payrollSetupStatus: payroll?.payroll_setup_status,
      } : undefined,
      identityRecords: perms.includes('onboarding.sensitive_identity') ? identity : undefined,
      requirements: requirements.map((r) => ({
        code: r.template_code, title: r.title, section: r.section,
        classification: r.classification, status: r.status,
        mandatory: r.mandatory, blocksActivation: r.blocks_activation,
        submittedAt: r.submitted_at, reviewedAt: r.reviewed_at,
        reviewedByName: r.reviewed_by_name, reviewDecision: r.review_decision,
        reviewReason: r.review_reason, waived: r.waived, waivedReason: r.waived_reason,
        compliance: r.snapshot?.compliance || null,
      })),
      credentials: credentials.map((c) => ({
        type: c.credential_type, name: c.credential_name, registrationNumber: c.registration_number,
        expiryDate: c.expiry_date, status: c.status, lifecycleStatus: c.lifecycle_status,
        verificationMethod: c.verification_method, verifiedAt: c.verified_at,
        verifiedByName: c.verified_by_name,
      })),
      acknowledgements: acks,
      statementIssuances: issuances,
      history: events,
    });
  }));

module.exports = router;

/**
 * Shared with onboarding-workflow-routes.js, which creates a portal account by
 * a different route (a temporary password rather than an invitation link) but
 * must issue EXACTLY the same requirement list from the same pinned snapshot.
 *
 * Exported rather than duplicated: two definitions of "what this onboarding
 * asks for" would drift, and the one that drifted would be the one nobody was
 * testing.
 */
module.exports._materialiseRequirements = materialiseRequirements;
module.exports.assignmentRow = assignmentRow;
module.exports.requirementRow = requirementRow;
module.exports.groupSections = groupSections;
