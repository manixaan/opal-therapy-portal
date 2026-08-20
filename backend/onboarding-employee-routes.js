'use strict';

/**
 * MY ONBOARDING — the new starter's own surface.
 *
 * Two groups of routes:
 *
 *   /api/onboarding-invite/*   PUBLIC. Accepting the invitation and setting a
 *                              password. Deliberately a top-level prefix, not
 *                              under /api/onboarding, so no router's
 *                              requireAuth can shadow it depending on mount
 *                              order.
 *
 *   /api/onboarding/me/*       AUTHENTICATED and STRICTLY SELF-SCOPED. Every
 *                              read and write resolves the assignment from
 *                              req.user.id and nothing else — there is no
 *                              route here that takes a user id, so there is
 *                              nothing for an IDOR attempt to aim at.
 *
 * WHAT THE EMPLOYEE IS AND IS NOT TOLD
 * ────────────────────────────────────
 * Their progress meter counts THEIR actions only. Employer verification is
 * shown separately and never drags their percentage down: being told you are
 * "78% complete" because someone else has not checked your registration yet is
 * both untrue and demoralising.
 *
 * Sensitive values they submit are never echoed back in full. Once a bank
 * account or tax file number is saved, the response and every later read carry
 * the masked form only — including for the person who typed it.
 */

const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();

const db = require('./database');
const odb = require('./onboarding-db');
const engine = require('./onboarding-engine');
const { auditOnboarding, recordRequirementEvent } = require('./onboarding-audit');
const { requireAuth } = require('./permissions');
const { assignmentRow, requirementRow, groupSections } = require('./onboarding-assignment-routes');
const log = require('./logger').createLogger('onboarding-me');

const { isUuid, str } = odb;
const SALT_ROUNDS = 12;

const safe = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  if (err && err.code === 'ENCRYPTION_UNAVAILABLE') {
    return res.status(503).json({
      error: 'This form cannot be saved right now',
      message: 'Secure storage is not configured. Please contact your practice owner.',
      code: 'ENCRYPTION_UNAVAILABLE',
    });
  }
  log.error('my-onboarding route error', { error: err, path: req.path });
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

// ═════════════════════════════════════════════════════════════════════════════
//  Rate limiting for the PUBLIC invitation endpoints
// ═════════════════════════════════════════════════════════════════════════════

const INVITE_WINDOW_MS = 15 * 60 * 1000;
const INVITE_MAX_ATTEMPTS = 20;
const _inviteAttempts = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of _inviteAttempts) if (entry.resetAt <= now) _inviteAttempts.delete(ip);
}, 10 * 60 * 1000).unref();

function inviteRateLimit(req, res, next) {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  const now = Date.now();
  let entry = _inviteAttempts.get(ip);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + INVITE_WINDOW_MS };
    _inviteAttempts.set(ip, entry);
  }
  entry.count += 1;
  if (entry.count > INVITE_MAX_ATTEMPTS) {
    const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
    res.set('Retry-After', String(retryAfterSec));
    return res.status(429).json({
      error: `Too many attempts. Please try again in ${Math.ceil(retryAfterSec / 60)} minute(s).`,
    });
  }
  next();
}

function _resetInviteRateLimit() { _inviteAttempts.clear(); }

// ═════════════════════════════════════════════════════════════════════════════
//  PUBLIC — invitation acceptance
// ═════════════════════════════════════════════════════════════════════════════

/** Load a usable onboarding invitation for a raw token, or null. */
async function loadInvite(token) {
  if (!token || typeof token !== 'string' || token.length > 200) return null;
  const { rows } = await odb.pool.query(
    `SELECT i.*, a.id AS assignment_id, a.applicant_name, a.job_title, a.start_date,
            a.due_at, a.status AS assignment_status, a.user_id AS assignment_user_id,
            p.title AS package_title
       FROM user_invites i
       LEFT JOIN onboarding_assignments a ON a.id = i.onboarding_assignment_id
       LEFT JOIN onboarding_packages p ON p.id = a.package_id
      WHERE i.invite_token = $1 AND i.onboarding_assignment_id IS NOT NULL
      LIMIT 1`, [token]
  );
  return rows[0] || null;
}

/**
 * Why an invitation cannot be used. Returned verbatim to the recipient — this
 * page is reached only by someone holding the token, so a precise message
 * ("this link has expired") is more useful than a vague one and leaks nothing.
 */
function inviteProblem(invite) {
  if (!invite) return { code: 'invalid', message: 'This onboarding link is not valid.' };
  if (invite.status === 'accepted') {
    return { code: 'used', message: 'This link has already been used. Please sign in instead.' };
  }
  if (invite.status === 'revoked') {
    return { code: 'revoked', message: 'This onboarding link has been cancelled. Please contact the practice.' };
  }
  if (invite.status === 'expired') {
    return { code: 'expired', message: 'This onboarding link has expired. Please ask for a new one.' };
  }
  if (invite.expires_at && new Date(invite.expires_at) <= new Date()) {
    return { code: 'expired', message: 'This onboarding link has expired. Please ask for a new one.' };
  }
  if (!invite.assignment_id) {
    return { code: 'invalid', message: 'This onboarding link is not valid.' };
  }
  if (['cancelled', 'archived'].includes(invite.assignment_status)) {
    return { code: 'cancelled', message: 'This onboarding has been cancelled. Please contact the practice.' };
  }
  return null;
}

router.post('/api/onboarding-invite/check', inviteRateLimit, safe(async (req, res) => {
  const invite = await loadInvite(req.body?.token);
  const problem = inviteProblem(invite);
  if (problem) return res.status(200).json({ ok: false, ...problem });

  const { rows: orgRows } = await odb.pool.query(
    'SELECT name FROM organisations WHERE id = $1', [invite.organisation_id]
  );

  res.json({
    ok: true,
    // Enough to make the page feel addressed to them, and nothing more. No
    // employment terms, no package contents, no other personal data.
    email: invite.email,
    displayName: invite.applicant_name || invite.display_name_hint || null,
    roleTitle: invite.job_title || invite.package_title || null,
    startDate: invite.start_date,
    dueAt: invite.due_at,
    organisationName: orgRows[0]?.name || 'Opal Therapy',
    alreadyHasPassword: false,
  });
}));

router.post('/api/onboarding-invite/accept', inviteRateLimit, safe(async (req, res) => {
  const { token, password, name } = req.body || {};
  const invite = await loadInvite(token);
  const problem = inviteProblem(invite);
  if (problem) return res.status(400).json({ error: problem.message, code: problem.code });

  // The SAME policy every other password path enforces, imported rather than
  // re-stated. A new starter's first password should not be held to a weaker
  // standard than the one they will be asked for when they later change it.
  if (String(password || '').length > 200) {
    return res.status(400).json({ error: 'That password is too long.' });
  }
  const policyProblem = require('./auth').validatePassword(password);
  if (policyProblem) return res.status(400).json({ error: policyProblem });

  const userId = invite.assignment_user_id;
  if (!userId) return res.status(409).json({ error: 'This onboarding is not ready yet.' });

  const passwordHash = await bcrypt.hash(String(password), SALT_ROUNDS);

  await odb.withTransaction(async (q) => {
    // Single-use: only a still-pending invitation can be spent, and spending
    // it is the same statement that checks it — so two simultaneous accepts
    // cannot both succeed.
    const { rows } = await q.query(
      `UPDATE user_invites
          SET status = 'accepted', accepted_at = NOW(), updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND status = 'pending'
          AND (expires_at IS NULL OR expires_at > NOW())
        RETURNING id`, [invite.id]
    );
    if (!rows[0]) {
      const err = new Error('invite_spent');
      err.code = 'INVITE_SPENT';
      throw err;
    }

    await q.query(
      `UPDATE users
          SET password_hash = $2, name = COALESCE($3, name),
              email_verified = TRUE, account_status = 'active', is_active = TRUE,
              -- They chose this password themselves, so the forced-change gate
              -- has nothing left to force. Clearing it here matters because an
              -- Owner may have issued a temporary password first and then sent
              -- the invitation link instead.
              password_is_temporary = FALSE, must_change_password = FALSE,
              temp_password_expires_at = NULL, password_changed_at = NOW(),
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [userId, passwordHash, str(name, 200)]
    );

    await q.query(
      `UPDATE onboarding_assignments
          SET status = CASE WHEN status = 'invite_sent' THEN 'invite_accepted' ELSE status END,
              invite_accepted_at = COALESCE(invite_accepted_at, NOW()),
              first_login_at = COALESCE(first_login_at, NOW()),
              last_activity_at = NOW(), updated_at = NOW()
        WHERE id = $1`, [invite.assignment_id]
    );
  }).catch((err) => {
    if (err.code === 'INVITE_SPENT') {
      res.status(409).json({
        error: 'This link has already been used. Please sign in instead.', code: 'used',
      });
      return null;
    }
    throw err;
  });
  if (res.headersSent) return undefined;

  await db.logAuditEvent({
    actorUserId: userId, action: 'onboarding.invitation_accepted',
    targetType: 'invite', targetId: invite.id,
    organisationId: invite.organisation_id, ipAddress: req.ip,
    metadata: { assignmentId: invite.assignment_id },
  }).catch(() => {});

  // Sign them straight in — asking someone to set a password and then log in
  // with it immediately is friction with no security benefit.
  req.session.userId = userId;
  return res.json({ ok: true, redirect: '/#onboarding' });
}));

// ═════════════════════════════════════════════════════════════════════════════
//  AUTHENTICATED — strictly self-scoped
// ═════════════════════════════════════════════════════════════════════════════

router.use('/api/onboarding/me', requireAuth);

/** The caller's own live assignment, or null. Never takes an id. */
async function myAssignment(req) {
  return odb.getMyAssignment(req.user.id);
}

/** The caller's own requirement by id. A foreign id is a 404, not a 403. */
async function myRequirement(req, assignment) {
  if (!assignment || !isUuid(req.params.rid)) return null;
  return odb.getRequirement(assignment.id, req.params.rid);
}

router.get('/api/onboarding/me', safe(async (req, res) => {
  const assignment = await myAssignment(req);
  if (!assignment) {
    return res.json({ ok: true, hasOnboarding: false });
  }

  // FIRST SIGN-IN, recorded once. This is the honest place for it: reaching
  // this endpoint is the employee actually arriving at their onboarding, which
  // is what the Owner's progress panel claims when it says "employee
  // reviewing". Authenticating and then closing the tab is not that.
  //
  // Also the point where an account created through the temporary-password
  // path leaves the pre-account states — the run is now genuinely in the
  // employee's hands. COALESCE keeps it a first login rather than a last one.
  if (!assignment.first_login_at) {
    await odb.pool.query(
      `UPDATE onboarding_assignments
          SET first_login_at = NOW(),
              invite_accepted_at = COALESCE(invite_accepted_at, NOW()),
              status = CASE WHEN status IN ('account_created', 'invite_sent')
                            THEN 'invite_accepted' ELSE status END,
              last_activity_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND first_login_at IS NULL`,
      [assignment.id]
    ).catch(() => {});
    assignment.first_login_at = new Date();
  }

  const requirements = await odb.listRequirements(assignment.id);
  const progress = engine.computeProgress(requirements);

  const { rows: orgRows } = await odb.pool.query(
    'SELECT name FROM organisations WHERE id = $1', [assignment.organisation_id]
  );

  res.json({
    ok: true,
    hasOnboarding: true,
    welcome: {
      name: req.user.name || assignment.applicant_name,
      organisationName: orgRows[0]?.name || 'Opal Therapy',
      roleTitle: assignment.job_title || assignment.package_title,
      employmentType: assignment.employment_type,
      startDate: assignment.start_date,
      dueAt: assignment.due_at,
      contactName: assignment.manager_name || assignment.created_by_name,
      ownerNote: assignment.owner_note,
    },
    status: assignment.status,
    // The employee's OWN meter. Employer review is reported separately and
    // never subtracted from this figure.
    yourProgress: {
      done: progress.employeeDone,
      total: progress.employeeTotal,
      percent: progress.employeePercent,
      complete: progress.employeeComplete,
    },
    employerReview: {
      done: progress.employerDone,
      total: progress.employerTotal,
      remaining: Math.max(0, progress.employerTotal - progress.employerDone),
      complete: progress.employerComplete,
    },
    actionRequired: progress.correctionsOpen,
    sections: groupSections(requirements, { forEmployee: true }),
    // `employee_actions_complete` is deliberately NOT excluded — that is
    // exactly the state where submitting is the next thing to do. What is
    // excluded is everything from employer_review onward: a run already handed
    // over must not offer the Submit button again.
    canSubmit: progress.employeeComplete && progress.correctionsOpen === 0
      && !['employer_review', 'ready_to_activate',
        'activated', 'completed', 'cancelled', 'archived'].includes(assignment.status),
  });
}));

router.get('/api/onboarding/me/requirements/:rid', safe(async (req, res) => {
  const assignment = await myAssignment(req);
  const requirement = await myRequirement(req, assignment);
  if (!requirement) return notFound(res);

  const rows = await odb.listRequirements(assignment.id);
  const full = rows.find((r) => r.id === requirement.id);
  const payload = { ok: true, requirement: requirementRow(full, { forEmployee: true }) };

  // A form requirement returns the caller's OWN saved values, in the masked
  // form. Even the person who typed a TFN does not get it back.
  const snap = requirement.snapshot || {};
  if (requirement.handler === 'form') {
    if (snap.form_key === 'personal_details' || snap.form_key === 'emergency_contact') {
      payload.values = await odb.getPersonalDetails(req.user.id);
    } else if (['bank_details', 'tax_setup', 'super_setup'].includes(snap.form_key)) {
      payload.values = odb.payrollView(await odb.getPayrollProfileMasked(req.user.id));
    } else if (['identity', 'right_to_work'].includes(snap.form_key)) {
      payload.values = await odb.listIdentityRecordsMasked(req.user.id);
    }
  }
  if (requirement.handler === 'credential' && requirement.credential_id) {
    const creds = await odb.listCredentialsForUser(req.user.id);
    payload.credential = creds.find((c) => c.id === requirement.credential_id) || null;
  }

  // PROVENANCE for anything we filled in on their behalf.
  //
  // The values above are already pre-populated — the Owner's review step wrote
  // the confirmed details straight into the same tables this reads. What is
  // missing without this block is WHY a form the employee has never opened
  // already has their date of birth in it, and an unexplained pre-filled field
  // reads as a mistake or a leak rather than a convenience.
  //
  // Deliberately plain: which fields, and which document they came off. No
  // confidence scores, no model, no mention of AI — the employee is being
  // asked to check their own handwriting, not to audit ours.
  if (requirement.handler === 'form') {
    payload.prefill = await buildPrefillNotice(assignment.id, snap.form_key);
  }

  res.json(payload);
}));

/**
 * Which of a form's fields were taken from the documents this person returned.
 *
 * Reads only field NAMES and source labels — never a value, so this is safe on
 * a form the employee is about to see masked values in anyway.
 */
async function buildPrefillNotice(assignmentId, formKey) {
  const FORM_GROUPS = {
    personal_details: ['identity', 'contact'],
    emergency_contact: ['emergency'],
    bank_details: ['payroll'],
    super_setup: ['super'],
  };
  const groups = FORM_GROUPS[formKey];
  if (!groups) return null;

  try {
    const { rows } = await odb.pool.query(
      `SELECT f.label, f.field_group, COALESCE(f.source_label, d.file_name) AS source
         FROM onboarding_extracted_fields f
         LEFT JOIN onboarding_returned_documents d ON d.id = f.source_document_id
        WHERE f.assignment_id = $1
          AND f.field_group = ANY($2::text[])
          AND f.status = 'applied'
        ORDER BY f.field_group, f.label`,
      [assignmentId, groups]
    );
    if (!rows.length) return null;

    const sources = [...new Set(rows.map((r) => r.source).filter(Boolean))];
    return {
      fieldCount: rows.length,
      fields: rows.map((r) => r.label),
      sources,
      // Starts with the SOURCE, not with "we filled this in" — the interface
      // already says that in bold immediately before this sentence, and
      // hearing it twice reads like a stutter.
      message: sources.length
        ? `Taken from ${sources.length === 1 ? sources[0] : 'the forms you returned'}. `
          + 'Please check everything is correct and change anything that is not.'
        : 'Taken from the forms you returned. Please check everything is correct.',
    };
  } catch (err) {
    // A missing prefill notice is cosmetic; a 500 on a form the employee needs
    // is not. This is the one place in the file where swallowing is right.
    log.warn('prefill notice unavailable', { error: err });
    return null;
  }
}

/**
 * Move a requirement forward for the employee.
 * Centralises the transition check, the history event and the recompute.
 */
async function advanceRequirement(req, assignment, requirement, {
  data, documentId, credentialId, learningAssignmentId, acknowledgementId, expiresAt, eventType,
}) {
  const toStatus = engine.statusAfterEmployeeAction(requirement);
  if (!engine.canTransition(requirement.status, toStatus)) {
    const err = new Error('bad_transition');
    err.code = 'BAD_TRANSITION';
    err.toStatus = toStatus;
    throw err;
  }

  return odb.withTransaction(async (q) => {
    await q.query(
      // $2 is cast: Postgres otherwise deduces varchar from `status = $2`
      // and text from the CASE comparison below, and refuses the statement.
      `UPDATE onboarding_requirements SET
         status = $2::text,
         data = COALESCE($3, data),
         document_id = COALESCE($4, document_id),
         credential_id = COALESCE($5, credential_id),
         learning_assignment_id = COALESCE($6, learning_assignment_id),
         acknowledgement_id = COALESCE($7, acknowledgement_id),
         expires_at = COALESCE($8, expires_at),
         started_at = COALESCE(started_at, NOW()),
         submitted_at = NOW(), submitted_by = $9,
         completed_at = CASE WHEN $2::text = 'complete' THEN NOW() ELSE completed_at END,
         -- A correction that has been actioned clears its reason so the
         -- employee is not left staring at old feedback on a fixed item.
         review_reason = CASE WHEN status = 'correction_required' THEN NULL ELSE review_reason END,
         updated_at = NOW()
       WHERE id = $1`,
      [
        requirement.id, toStatus, data ? JSON.stringify(data) : null,
        documentId || null, credentialId || null, learningAssignmentId || null,
        acknowledgementId || null, expiresAt || null, req.user.id,
      ]
    );
    await recordRequirementEvent(q, {
      requirementId: requirement.id, assignmentId: assignment.id,
      actorUserId: req.user.id, actorRole: req.user.role,
      eventType, fromStatus: requirement.status, toStatus,
      metadata: { templateCode: requirement.template_code },
    });
    return odb.recomputeAssignment(q, assignment.id);
  });
}

/** Standard success shape after any employee action. */
async function respondAdvanced(req, res, assignment, requirementId, extra = {}) {
  const rows = await odb.listRequirements(assignment.id);
  const progress = engine.computeProgress(rows);
  const updated = rows.find((r) => r.id === requirementId);
  res.json({
    ok: true,
    requirement: updated ? requirementRow(updated, { forEmployee: true }) : null,
    yourProgress: {
      done: progress.employeeDone, total: progress.employeeTotal,
      percent: progress.employeePercent, complete: progress.employeeComplete,
    },
    ...extra,
  });
}

router.post('/api/onboarding/me/requirements/:rid/start', safe(async (req, res) => {
  const assignment = await myAssignment(req);
  const requirement = await myRequirement(req, assignment);
  if (!requirement) return notFound(res);
  if (requirement.status !== 'not_started') return respondAdvanced(req, res, assignment, requirement.id);

  await odb.pool.query(
    `UPDATE onboarding_requirements
        SET status = 'in_progress', started_at = COALESCE(started_at, NOW()), updated_at = NOW()
      WHERE id = $1 AND status = 'not_started'`, [requirement.id]
  );
  return respondAdvanced(req, res, assignment, requirement.id);
}));

// ── Acknowledge a document ──────────────────────────────────────────────────

router.post('/api/onboarding/me/requirements/:rid/acknowledge', safe(async (req, res) => {
  const assignment = await myAssignment(req);
  const requirement = await myRequirement(req, assignment);
  if (!requirement) return notFound(res);
  // `info` shares this endpoint: an information item is completed by
  // confirming you have read it, which is the same act as acknowledging a
  // document minus the document. Without this an info requirement had no
  // completion path at all and quietly capped everyone below 100%.
  if (!['document_ack', 'info'].includes(requirement.handler)) {
    return res.status(400).json({ error: 'This requirement is not an acknowledgement' });
  }
  if (req.body?.acknowledged !== true) {
    return res.status(400).json({ error: 'The acknowledgement must be explicitly confirmed' });
  }

  const snap = requirement.snapshot || {};
  const typedName = str(req.body?.typedLegalName, 200);
  if (snap.config?.requiresTypedName && !typedName) {
    return res.status(400).json({ error: 'Please type your full legal name to confirm' });
  }

  // A document requirement with no published version cannot be acknowledged:
  // there is nothing to have read. Release refuses to issue these for
  // activation-blocking items, so this is the backstop for an optional one
  // whose content was withdrawn after issue.
  if (requirement.handler === 'document_ack' && snap.document_id && !snap.document_version_id) {
    return res.status(409).json({
      error: 'This document has not been published yet',
      message: 'The practice still needs to publish this document. You do not need to do anything.',
      code: 'document_unpublished',
    });
  }

  let acknowledgement = null;
  if (snap.document_version_id && snap.document_id) {
    acknowledgement = await odb.recordAcknowledgement({
      organisationId: assignment.organisation_id,
      userId: req.user.id,
      documentId: snap.document_id,
      documentVersionId: snap.document_version_id,
      documentCode: snap.document?.code || snap.document_code,
      documentTitle: snap.document?.title || requirement.title,
      documentVersion: snap.document_version,
      requirementId: requirement.id,
      assignmentId: assignment.id,
      packageVersionId: assignment.package_version_id,
      // Hash rather than a second copy of the statement: proves the wording
      // without creating a version of it that can drift from the document.
      statementSha256: crypto.createHash('sha256')
        .update(String(snap.config?.ackStatement || requirement.title), 'utf8').digest('hex'),
      typedLegalName: typedName,
      viewedAt: odb.dateOrNull(req.body?.viewedAt) || new Date(),
      ipAddress: req.ip,
    });
  }

  // Statutory statements additionally record an ISSUANCE — the employer's
  // obligation is to have GIVEN it, which is a different fact from the
  // employee having agreed.
  let issuance = null;
  if (snap.config?.recordIssuance && snap.config?.statementCode) {
    issuance = await odb.recordStatementIssuance({
      organisationId: assignment.organisation_id,
      userId: req.user.id,
      assignmentId: assignment.id,
      requirementId: requirement.id,
      statementCode: snap.config.statementCode,
      sourceVersionLabel: snap.document?.sourceVersionLabel || snap.compliance?.sourceVersionLabel,
      documentVersionId: snap.document_version_id,
      triggerKind: 'commencement',
      deliveryMethod: 'portal',
      // The FTCIS may only be delivered electronically with agreement. Reading
      // it in the portal and confirming IS that agreement, recorded here.
      electronicDeliveryAgreed: snap.config?.electronicDeliveryRequiresAgreement ? true : null,
      issuedBy: assignment.created_by,
      acknowledgedAt: new Date(),
    });
  }

  try {
    await advanceRequirement(req, assignment, requirement, {
      data: { acknowledged: true, typedLegalName: typedName || undefined },
      acknowledgementId: acknowledgement?.id || null,
      eventType: 'acknowledged',
    });
  } catch (err) {
    if (err.code === 'BAD_TRANSITION') {
      return res.status(409).json({ error: 'This requirement cannot be acknowledged in its current state' });
    }
    throw err;
  }

  await auditOnboarding(req, 'acknowledgement_recorded', {
    targetType: 'onboarding_requirement', targetId: requirement.id,
    metadata: {
      assignmentId: assignment.id, requirementId: requirement.id,
      templateCode: requirement.template_code,
      documentCode: snap.document?.code, version: snap.document_version,
      acknowledgementId: acknowledgement?.id, issuanceId: issuance?.id,
    },
  });

  return respondAdvanced(req, res, assignment, requirement.id);
}));

// ── Confirm an official live source was used ────────────────────────────────

router.post('/api/onboarding/me/requirements/:rid/confirm-live-source', safe(async (req, res) => {
  const assignment = await myAssignment(req);
  const requirement = await myRequirement(req, assignment);
  if (!requirement) return notFound(res);
  if (requirement.handler !== 'live_source') {
    return res.status(400).json({ error: 'This requirement is not a live-source confirmation' });
  }
  if (req.body?.confirmed !== true) {
    return res.status(400).json({ error: 'Please confirm you have completed this step' });
  }
  try {
    await advanceRequirement(req, assignment, requirement, {
      data: { confirmed: true, confirmedAt: new Date().toISOString(), note: str(req.body?.note, 500) },
      eventType: 'live_source_confirmed',
    });
  } catch (err) {
    if (err.code === 'BAD_TRANSITION') return res.status(409).json({ error: 'Cannot confirm in the current state' });
    throw err;
  }
  return respondAdvanced(req, res, assignment, requirement.id);
}));

// ── Forms ───────────────────────────────────────────────────────────────────

const AU_STATES = ['WA', 'SA', 'NT', 'QLD', 'NSW', 'ACT', 'VIC', 'TAS'];

function validateForm(formKey, b) {
  switch (formKey) {
    case 'personal_details':
      if (!b.legalFirstName) return 'Your legal first name is required';
      if (!b.surname) return 'Your surname is required';
      if (!b.dateOfBirth) return 'Your date of birth is required';
      if (!b.mobile) return 'A mobile number is required';
      if (!b.addressLine1 || !b.suburb || !b.postcode) return 'A residential address is required';
      if (b.state && !AU_STATES.includes(String(b.state).toUpperCase())) return 'State is not recognised';
      return null;
    case 'emergency_contact':
      if (!b.emergencyName) return 'An emergency contact name is required';
      if (!b.emergencyPhone) return 'An emergency contact phone number is required';
      if (!b.emergencyRelationship) return 'Please tell us their relationship to you';
      return null;
    case 'bank_details':
      if (!b.accountHolderName) return 'The account holder name is required';
      if (!engine.isValidBsb(b.bsb)) return 'A BSB is six digits, for example 062-000';
      if (!engine.isValidAccountNumber(b.accountNumber)) return 'An account number is between 5 and 10 digits';
      return null;
    case 'tax_setup': {
      const method = b.taxSubmissionMethod;
      if (!['employer_electronic_form', 'ato_online_services', 'paper_form', 'exemption'].includes(method)) {
        return 'Please choose how you are providing your tax details';
      }
      if (method === 'employer_electronic_form') {
        if (!b.residencyStatus) return 'Please tell us your residency status for tax purposes';
        if (!b.tfn) return 'Please enter your tax file number, or choose a different option';
        // A local check catches a typo before the value is encrypted and
        // stored. It is data quality, not authentication.
        if (!engine.isValidTfn(b.tfn)) return 'That tax file number does not look right — please check it';
      }
      if (method === 'exemption' && !b.tfnExemptionReason) {
        return 'Please tell us why you are exempt from quoting a tax file number';
      }
      return null;
    }
    case 'super_setup': {
      const choice = b.superChoiceType;
      if (!['apra_fund', 'smsf', 'employer_default', 'stapled'].includes(choice)) {
        return 'Please choose how your superannuation should be paid';
      }
      if (choice === 'apra_fund') {
        if (!b.superFundName) return 'Your fund name is required';
        if (!b.superFundAbn || !engine.isValidAbn(b.superFundAbn)) return 'A valid fund ABN is required';
        if (!b.superFundUsi) return 'The Unique Superannuation Identifier (USI) is required';
        if (!b.superMemberNumber) return 'Your member account number is required';
        if (!b.superAccountName) return 'The name as it appears on your super account is required';
      }
      if (choice === 'smsf') {
        // An SMSF has no USI and no member number — it is identified by ABN
        // and electronic service address, and paid to its bank account.
        if (!b.superFundName) return 'Your SMSF name is required';
        if (!b.superFundAbn || !engine.isValidAbn(b.superFundAbn)) return 'A valid SMSF ABN is required';
        if (!b.smsfEsa) return 'The SMSF electronic service address (ESA) is required';
        if (!b.smsfBankAccountName) return 'The SMSF bank account name is required';
        if (!engine.isValidBsb(b.smsfBankBsb)) return 'A valid SMSF BSB is required';
        if (!engine.isValidAccountNumber(b.smsfBankAccount)) return 'A valid SMSF account number is required';
      }
      return null;
    }
    case 'identity':
      if (!b.evidenceType) return 'Please tell us which document you will present';
      if (!b.nameOnDocument) return 'The name exactly as it appears on the document is required';
      return null;
    case 'right_to_work':
      if (!b.rightToWorkBasis) return 'Please tell us the basis of your right to work';
      if (b.rightToWorkBasis === 'visa_with_work_rights') {
        if (!b.travelDocumentType) return 'Your travel document type is required';
        if (!b.documentNumber) return 'Your travel document number is required';
        if (!b.countryOfIssue) return 'The country that issued the document is required';
        if (b.vevoConsent !== true) return 'We need your consent to check your work rights online';
      }
      return null;
    case 'vehicle_details':
      if (!b.registration) return 'Your vehicle registration is required';
      if (b.businessUseConfirmed !== true) {
        return 'Please confirm your insurance covers use of the vehicle for work';
      }
      return null;
    default:
      return null;
  }
}

router.post('/api/onboarding/me/requirements/:rid/form', safe(async (req, res) => {
  const assignment = await myAssignment(req);
  const requirement = await myRequirement(req, assignment);
  if (!requirement) return notFound(res);
  if (requirement.handler !== 'form') {
    return res.status(400).json({ error: 'This requirement is not a form' });
  }
  const formKey = requirement.snapshot?.form_key;
  if (!engine.FORM_KEYS.includes(formKey)) {
    return res.status(500).json({ error: 'This form is not configured correctly' });
  }

  const b = req.body || {};
  const error = validateForm(formKey, b);
  if (error) return res.status(400).json({ error });

  const org = assignment.organisation_id;
  const uid = req.user.id;
  // `summary` is what goes into requirement.data — deliberately never a
  // sensitive value, because that column is read by every employer view.
  let summary = {};

  switch (formKey) {
    case 'personal_details':
      await odb.upsertPersonalDetails(uid, org, { ...b, assignmentId: assignment.id });
      summary = { provided: true };
      break;
    case 'emergency_contact':
      await odb.upsertPersonalDetails(uid, org, { ...b, assignmentId: assignment.id });
      summary = { provided: true };
      break;
    case 'bank_details': {
      const saved = await odb.savePayrollBank(uid, org, { ...b, assignmentId: assignment.id }, uid);
      summary = { provided: true, accountNumberLast4: saved.account_number_last4 };
      break;
    }
    case 'tax_setup': {
      const status = b.taxSubmissionMethod === 'exemption' ? 'exemption_recorded'
        : (b.taxSubmissionMethod === 'employer_electronic_form' ? 'employee_completed' : 'payroll_action_required');
      await odb.savePayrollTax(uid, org, {
        ...b, assignmentId: assignment.id, taxSetupStatus: status,
      }, uid);
      summary = { provided: true, method: b.taxSubmissionMethod, status };
      break;
    }
    case 'super_setup': {
      await odb.savePayrollSuper(uid, org, {
        ...b, assignmentId: assignment.id,
        superStatus: b.superChoiceType === 'employer_default' ? 'default_fund_applied' : 'employee_nominated',
      }, uid);
      summary = { provided: true, choice: b.superChoiceType };
      break;
    }
    case 'identity':
    case 'right_to_work': {
      await odb.saveIdentityRecord(uid, org, {
        ...b,
        assignmentId: assignment.id,
        requirementId: requirement.id,
        recordKind: formKey === 'identity' ? 'identity' : 'right_to_work',
        evidenceType: b.evidenceType || (b.rightToWorkBasis === 'visa_with_work_rights' ? 'visa' : 'other'),
        // The employee declares; the employer verifies. Nothing an employee
        // submits may set itself to verified.
        verificationStatus: 'verification_required',
      });
      summary = { provided: true, evidenceType: b.evidenceType || null, basis: b.rightToWorkBasis || null };
      break;
    }
    case 'vehicle_details':
      summary = {
        provided: true,
        registration: str(b.registration, 20),
        make: str(b.make, 60), model: str(b.model, 60),
        registrationExpiry: b.registrationExpiry || null,
        businessUseConfirmed: true,
      };
      break;
    default:
      summary = { provided: true };
  }

  try {
    await advanceRequirement(req, assignment, requirement, {
      data: summary, eventType: 'form_submitted',
    });
  } catch (err) {
    if (err.code === 'BAD_TRANSITION') {
      return res.status(409).json({ error: 'This form cannot be submitted in its current state' });
    }
    throw err;
  }

  await auditOnboarding(req, 'form_submitted', {
    targetType: 'onboarding_requirement', targetId: requirement.id,
    metadata: {
      assignmentId: assignment.id, requirementId: requirement.id,
      templateCode: requirement.template_code, formKey,
      sensitivity: requirement.sensitivity,
    },
  });

  return respondAdvanced(req, res, assignment, requirement.id);
}));

// ── Evidence upload ─────────────────────────────────────────────────────────

/**
 * The employee-document allowlist, copied from profile-routes.js so onboarding
 * accepts exactly what CPD evidence already accepts. Executables, HTML and SVG
 * (script-capable) are refused, and the extension must agree with the declared
 * MIME type.
 */
const UPLOAD_ALLOWED = {
  'application/pdf': ['pdf'],
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'application/msword': ['doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
};
const MAX_UPLOAD_BASE64 = 7 * 1024 * 1024; // ≈ 5 MB binary

function validateUpload({ fileName, fileMime, fileData }) {
  if (!fileData) return 'A file is required';
  if (fileData.length > MAX_UPLOAD_BASE64) return 'That file is larger than 5 MB';
  const exts = UPLOAD_ALLOWED[String(fileMime || '').toLowerCase()];
  if (!exts) return 'File type not allowed. Accepted: PDF, PNG, JPEG, DOC, DOCX';
  const ext = String(fileName || '').split('.').pop().toLowerCase();
  if (!exts.includes(ext)) return `A ".${ext}" file does not match the declared type`;
  if (/[/\\]|\.\./.test(String(fileName))) return 'That file name is not allowed';
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(String(fileData).slice(0, 1000))) {
    return 'File content must be base64-encoded';
  }
  return null;
}

/** Store an uploaded file as a pd_document linked to this requirement. */
async function storeEvidence(req, assignment, requirement, body) {
  const { getBackend, getBackendName } = require('./storage');
  const backend = getBackend();
  const sha256 = crypto.createHash('sha256')
    .update(Buffer.from(body.fileData, 'base64')).digest('hex');

  const common = {
    userId: req.user.id, organisationId: assignment.organisation_id,
    title: str(body.title, 255) || requirement.title,
    documentType: requirement.template_code,
    fileName: str(body.fileName, 255), fileMime: str(body.fileMime, 100),
    fileSizeBytes: body.fileSizeBytes || null,
  };

  let record;
  if (getBackendName() === 'db') {
    record = await db.createPDDocument({ ...common, fileData: body.fileData, storageBackend: 'db' });
  } else {
    record = await db.createPDDocument({ ...common, fileData: null, storageBackend: getBackendName() });
    try {
      const { backend: bname, storageKey } = await backend.put({
        userId: req.user.id, docId: record.id,
        fileName: common.fileName, mime: common.fileMime, base64: body.fileData,
      });
      await db.setPDDocumentStorage(record.id, { storageBackend: bname, storageKey, clearInline: true });
    } catch (putErr) {
      // No orphaned "document" with no content survives a storage failure.
      await db.deletePDDocument(record.id, req.user.id).catch(() => {});
      throw putErr;
    }
  }

  await odb.pool.query(
    `UPDATE pd_documents
        SET onboarding_requirement_id = $2, onboarding_assignment_id = $3,
            sensitivity = $4, file_sha256 = $5
      WHERE id = $1`,
    [record.id, requirement.id, assignment.id, requirement.sensitivity || 'standard', sha256]
  );
  return { record, sha256 };
}

router.post('/api/onboarding/me/requirements/:rid/upload', safe(async (req, res) => {
  const assignment = await myAssignment(req);
  const requirement = await myRequirement(req, assignment);
  if (!requirement) return notFound(res);
  if (!['upload', 'credential', 'training', 'form'].includes(requirement.handler)) {
    return res.status(400).json({ error: 'This requirement does not take a file' });
  }

  const error = validateUpload(req.body || {});
  if (error) return res.status(415).json({ error });

  const { record, sha256 } = await storeEvidence(req, assignment, requirement, req.body);

  // An upload against a credential or training requirement is evidence, not
  // the whole submission — those advance through their own endpoints.
  const advance = requirement.handler === 'upload';
  if (advance) {
    try {
      await advanceRequirement(req, assignment, requirement, {
        data: { fileName: record.file_name, uploadedAt: new Date().toISOString() },
        documentId: record.id, eventType: 'evidence_uploaded',
      });
    } catch (err) {
      if (err.code === 'BAD_TRANSITION') {
        return res.status(409).json({ error: 'This requirement cannot be submitted in its current state' });
      }
      throw err;
    }
  } else {
    await odb.pool.query(
      'UPDATE onboarding_requirements SET document_id = $2, updated_at = NOW() WHERE id = $1',
      [requirement.id, record.id]
    );
  }

  await auditOnboarding(req, 'evidence_uploaded', {
    targetType: 'onboarding_requirement', targetId: requirement.id,
    metadata: {
      assignmentId: assignment.id, requirementId: requirement.id,
      documentId: record.id, templateCode: requirement.template_code,
      fileName: record.file_name, mimeType: record.file_mime,
      sizeBytes: record.file_size_bytes, sha256,
    },
  });

  return respondAdvanced(req, res, assignment, requirement.id, {
    document: { id: record.id, fileName: record.file_name },
  });
}));

/** Download evidence the caller uploaded themselves. Self-scoped by user id. */
router.get('/api/onboarding/me/documents/:docId', safe(async (req, res) => {
  if (!isUuid(req.params.docId)) return notFound(res);
  const doc = await db.getPDDocumentForDownload(req.params.docId, req.user.id);
  if (!doc || doc.user_id !== req.user.id) return notFound(res);

  const { getBackend } = require('./storage');
  let base64 = null;
  try {
    ({ base64 } = await getBackend(doc.storage_backend || 'db').get({
      backend: doc.storage_backend, storageKey: doc.storage_key, fileData: doc.file_data,
    }));
  } catch (err) {
    log.warn('evidence unreadable', { documentId: doc.id });
  }
  if (!base64) return res.status(404).json({ error: 'Document content unavailable' });

  res.setHeader('Content-Type', doc.file_mime || 'application/octet-stream');
  res.setHeader('Content-Disposition',
    `attachment; filename="${encodeURIComponent(doc.file_name || 'document')}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  res.send(Buffer.from(base64, 'base64'));
}));

// ── Credentials ─────────────────────────────────────────────────────────────

router.post('/api/onboarding/me/requirements/:rid/credential', safe(async (req, res) => {
  const assignment = await myAssignment(req);
  const requirement = await myRequirement(req, assignment);
  if (!requirement) return notFound(res);
  if (requirement.handler !== 'credential') {
    return res.status(400).json({ error: 'This requirement is not a credential' });
  }

  const b = req.body || {};
  const snap = requirement.snapshot || {};
  const type = snap.credential_type || requirement.template_code;

  if (!b.registrationNumber && !b.applicationNumber) {
    return res.status(400).json({ error: 'A registration, card or application number is required' });
  }
  // Deliberately NO regex on a WWCC card number: no official WA source
  // publishes the format, so validating one would reject valid cards.

  const detail = {};
  if (type === 'ahpra_registration') {
    detail.profession = str(b.profession, 80) || 'Occupational therapist';
  }
  if (type === 'ndis_worker_screening') {
    detail.jurisdiction = str(b.jurisdiction, 20);
    detail.applicationNumber = str(b.applicationNumber, 100);
    detail.declaredStatus = str(b.declaredStatus, 40);
  }
  if (type === 'wwcc') {
    detail.applicationNumber = str(b.applicationNumber, 100);
    detail.familyName = str(b.familyName, 100);
  }
  if (type === 'professional_indemnity') {
    const arrangements = snap.config?.arrangements || [];
    if (!arrangements.includes(b.arrangement)) {
      return res.status(400).json({ error: 'Please choose which indemnity arrangement applies to you' });
    }
    detail.arrangement = b.arrangement;
    detail.insurer = str(b.insurer, 200);
    detail.policyNumber = str(b.policyNumber, 120);
  }
  if (type === 'qualification') {
    detail.institution = str(b.institution, 200);
    detail.completionYear = b.completionYear ? Number(b.completionYear) : null;
  }
  if (type === 'drivers_licence') {
    detail.licenceClass = str(b.licenceClass, 20);
    detail.jurisdiction = str(b.jurisdiction, 20);
  }

  const credential = await odb.upsertCredential(req.user.id, assignment.organisation_id, {
    id: requirement.credential_id || undefined,
    credentialType: type,
    credentialName: str(b.credentialName, 255) || requirement.title,
    issuingBody: str(b.issuingBody, 255) || snap.compliance?.sourceOrg || null,
    registrationNumber: str(b.registrationNumber || b.applicationNumber, 100),
    issueDate: b.issueDate, expiryDate: b.expiryDate,
    documentId: requirement.document_id || null,
    jurisdiction: str(b.jurisdiction, 20),
    // The employee's own account of their status is a DECLARATION. The
    // authoritative lifecycle_status is written only by employer verification.
    lifecycleStatus: 'employer_verification_required',
    detail,
    onboardingRequirementId: requirement.id,
    reminderDays: snap.expiry_rule?.reminderDays,
    status: 'pending_review',
  });

  try {
    await advanceRequirement(req, assignment, requirement, {
      data: {
        provided: true,
        registrationNumber: str(b.registrationNumber || b.applicationNumber, 100),
        expiryDate: b.expiryDate || null,
      },
      credentialId: credential.id,
      expiresAt: odb.dateOrNull(b.expiryDate),
      eventType: 'credential_submitted',
    });
  } catch (err) {
    if (err.code === 'BAD_TRANSITION') {
      return res.status(409).json({ error: 'This credential cannot be submitted in its current state' });
    }
    throw err;
  }

  await auditOnboarding(req, 'credential_submitted', {
    targetType: 'onboarding_requirement', targetId: requirement.id,
    metadata: {
      assignmentId: assignment.id, requirementId: requirement.id,
      credentialId: credential.id, credentialType: type,
      templateCode: requirement.template_code, expiryDate: b.expiryDate || undefined,
    },
  });

  return respondAdvanced(req, res, assignment, requirement.id, {
    credential: { id: credential.id, type, status: credential.status },
  });
}));

// ── Training ────────────────────────────────────────────────────────────────

router.post('/api/onboarding/me/requirements/:rid/training', safe(async (req, res) => {
  const assignment = await myAssignment(req);
  const requirement = await myRequirement(req, assignment);
  if (!requirement) return notFound(res);
  if (requirement.handler !== 'training') {
    return res.status(400).json({ error: 'This requirement is not a training module' });
  }
  // Internal learning completes itself through the learning bridge; there is
  // nothing for the employee to declare here.
  if (requirement.learning_assignment_id) {
    return res.status(409).json({
      error: 'This training completes automatically when you finish it in My Learning',
    });
  }
  if (!requirement.document_id) {
    return res.status(400).json({ error: 'Please upload your completion certificate first' });
  }
  const completedAt = odb.dateOrNull(req.body?.completedAt);
  if (!completedAt) return res.status(400).json({ error: 'Please tell us when you completed it' });

  try {
    await advanceRequirement(req, assignment, requirement, {
      data: { completedAt: completedAt.toISOString(), external: true },
      eventType: 'training_evidence_submitted',
    });
  } catch (err) {
    if (err.code === 'BAD_TRANSITION') {
      return res.status(409).json({ error: 'Cannot submit training in the current state' });
    }
    throw err;
  }
  return respondAdvanced(req, res, assignment, requirement.id);
}));

// ── Submit the whole thing ──────────────────────────────────────────────────

router.post('/api/onboarding/me/submit', safe(async (req, res) => {
  const assignment = await myAssignment(req);
  if (!assignment) return notFound(res);
  if (['activated', 'completed', 'cancelled', 'archived'].includes(assignment.status)) {
    return res.status(409).json({ error: 'This onboarding is already finished' });
  }

  const requirements = await odb.listRequirements(assignment.id);
  const progress = engine.computeProgress(requirements);

  if (progress.correctionsOpen > 0) {
    return res.status(409).json({
      error: 'Some items still need your attention',
      outstanding: requirements
        .filter((r) => r.status === 'correction_required')
        .map((r) => ({ id: r.id, title: r.title, reason: r.review_reason })),
    });
  }
  if (!progress.employeeComplete) {
    return res.status(409).json({
      error: 'Some items are still incomplete',
      outstanding: requirements
        .filter((r) => engine.isEmployeeItem(r)
          && !['submitted', 'awaiting_verification', 'verified', 'complete', 'not_applicable'].includes(r.status))
        .map((r) => ({ id: r.id, title: r.title, section: r.section })),
    });
  }

  // Stamp the submission FIRST, then recompute: submitted_at is what moves the
  // run into employer review, so the recompute has to see it already set.
  const { assignment: updated } = await odb.withTransaction(async (q) => {
    await q.query(
      `UPDATE onboarding_assignments
          SET submitted_at = COALESCE(submitted_at, NOW()), updated_at = NOW()
        WHERE id = $1`, [assignment.id]
    );
    return odb.recomputeAssignment(q, assignment.id);
  });

  await auditOnboarding(req, 'employee_submitted', {
    targetType: 'onboarding_assignment', targetId: assignment.id,
    metadata: {
      assignmentId: assignment.id,
      employeeDone: progress.employeeDone, employeeTotal: progress.employeeTotal,
    },
  });

  // Tell whoever is responsible that there is review work waiting.
  const notifyIds = new Set();
  if (assignment.created_by) notifyIds.add(assignment.created_by);
  if (assignment.manager_user_id) notifyIds.add(assignment.manager_user_id);
  for (const id of notifyIds) {
    await notify(id, {
      type: `onboarding_submitted_${assignment.id}`,
      title: 'Onboarding submitted',
      message: `${assignment.applicant_name} has completed their onboarding actions and is ready for review.`,
      severity: 'info',
      relatedEntity: 'onboarding_assignment',
      actionPayload: { assignmentId: assignment.id },
    }).catch(() => {});
  }

  res.json({
    ok: true,
    status: updated.status,
    yourProgress: {
      done: progress.employeeDone, total: progress.employeeTotal,
      percent: progress.employeePercent, complete: true,
    },
    employerReview: {
      remaining: Math.max(0, progress.employerTotal - progress.employerDone),
    },
    message: 'Thank you — your onboarding has been submitted. '
      + 'The practice will review your documents and let you know if anything is needed.',
  });
}));

// ── Read a policy or official document ──────────────────────────────────────

/**
 * Serve a document version the caller has actually been issued.
 *
 * Access is derived from their OWN requirements, not from a document id they
 * supplied: asking for a version that is not in their package is a 404.
 */
router.get('/api/onboarding/me/documents/version/:versionId', safe(async (req, res) => {
  const assignment = await myAssignment(req);
  if (!assignment || !isUuid(req.params.versionId)) return notFound(res);

  const { rows } = await odb.pool.query(
    `SELECT 1 FROM onboarding_requirements
      WHERE assignment_id = $1 AND snapshot->>'document_version_id' = $2 LIMIT 1`,
    [assignment.id, req.params.versionId]
  );
  if (!rows.length) return notFound(res);

  const version = await odb.getDocumentVersion(req.params.versionId);
  if (!version) return notFound(res);

  const doc = (await odb.pool.query(
    'SELECT code, title, official_source_url, content_status FROM onboarding_documents WHERE id = $1',
    [version.document_id]
  )).rows[0];

  res.json({
    ok: true,
    document: {
      code: doc?.code, title: version.title || doc?.title,
      version: version.version, summary: version.summary,
      body: version.body, effectiveDate: version.effective_date,
      sourceVersionLabel: version.source_version_label,
      officialSourceUrl: version.source_url || doc?.official_source_url,
      contentStatus: doc?.content_status,
      hasFile: !!(version.file_data || version.storage_key),
      fileName: version.file_name, fileMime: version.file_mime,
    },
  });
}));

router.get('/api/onboarding/me/documents/version/:versionId/download', safe(async (req, res) => {
  const assignment = await myAssignment(req);
  if (!assignment || !isUuid(req.params.versionId)) return notFound(res);

  const { rows } = await odb.pool.query(
    `SELECT 1 FROM onboarding_requirements
      WHERE assignment_id = $1 AND snapshot->>'document_version_id' = $2 LIMIT 1`,
    [assignment.id, req.params.versionId]
  );
  if (!rows.length) return notFound(res);

  const version = await odb.getDocumentVersion(req.params.versionId);
  if (!version) return notFound(res);

  let base64 = version.file_data;
  if (!base64 && version.storage_key) {
    try {
      const { getBackend } = require('./storage');
      ({ base64 } = await getBackend(version.storage_backend).get({
        backend: version.storage_backend, storageKey: version.storage_key,
      }));
    } catch (err) {
      log.warn('document version unreadable', { versionId: version.id });
    }
  }
  if (!base64) return res.status(404).json({ error: 'Document content unavailable' });

  res.setHeader('Content-Type', version.file_mime || 'application/pdf');
  res.setHeader('Content-Disposition',
    `inline; filename="${encodeURIComponent(version.file_name || 'document.pdf')}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(Buffer.from(base64, 'base64'));
}));

/**
 * The New Starter Reference Pack.
 *
 * Safe, non-sensitive reading only — welcome material, position description,
 * statements, policies. It deliberately contains NOTHING the employee
 * submitted: no tax details, no bank details, no identity evidence, no
 * screening records. Sensitive onboarding lives in the portal, not in a file
 * that can be forwarded.
 */
router.get('/api/onboarding/me/reference-pack', safe(async (req, res) => {
  const assignment = await myAssignment(req);
  if (!assignment) return notFound(res);

  const requirements = await odb.listRequirements(assignment.id);
  const items = requirements
    .filter((r) => ['document_ack', 'info'].includes(r.handler))
    .filter((r) => (r.sensitivity || 'standard') === 'standard')
    .map((r) => {
      const snap = r.snapshot || {};
      return {
        code: r.template_code,
        title: r.title,
        section: r.section,
        sectionLabel: engine.SECTION_LABELS[r.section] || r.section,
        documentVersionId: snap.document_version_id || null,
        officialSourceUrl: snap.document?.officialSourceUrl || snap.external_url || null,
        contentStatus: snap.document?.contentStatus || null,
        sourceVersionLabel: snap.document?.sourceVersionLabel || null,
        acknowledged: ['complete', 'verified'].includes(r.status),
      };
    });

  res.json({
    ok: true,
    packTitle: 'New Starter Reference Pack',
    note: 'Reference reading only. Nothing you have submitted — tax, bank, identity or '
      + 'screening details — is included here or in any downloadable file.',
    items,
  });
}));

module.exports = router;
module.exports._resetInviteRateLimit = _resetInviteRateLimit;
module.exports.validateForm = validateForm;
module.exports.validateUpload = validateUpload;
module.exports.inviteProblem = inviteProblem;
