'use strict';

/**
 * ONBOARDING JOURNEY — routes for the three-stage workflow.
 *
 *   /api/onboarding/journey/*    the Owner's board and one record's command
 *                                centre (session + onboarding.* permission)
 *   /api/onboarding-offer/*      the candidate's response to a letter of offer
 *                                (public, token-only, rate limited)
 *
 * WHAT IS AUTOMATIC HERE
 * ──────────────────────
 *  • Start Onboarding creates the record AND the first letter-of-offer draft
 *    from the same details; the package is chosen by recommendation.
 *  • Accepting the offer performs the release (034's act) — account,
 *    invitation, requirement set — with no Owner click in between. If the
 *    release is refused (an unpublished policy, say) the acceptance is still
 *    recorded and the record's "next" line tells the Owner to release by hand.
 *  • Reaching the induction stage generates the checklist.
 *  • The last induction task closes the record.
 *
 * Every state-changing act is audited with ids only, never names or emails.
 */

const express = require('express');
const router = express.Router();

const db = require('./database');
const email = require('./email');
const odb = require('./onboarding-db');
const jdb = require('./onboarding-journey-db');
const wdb = require('./onboarding-workflow-db');
const engine = require('./onboarding-engine');
const journey = require('./onboarding-journey');
const lifecycle = require('./onboarding-lifecycle');
const letter = require('./onboarding-offer-letter');
const { auditOnboarding, safeMetadata } = require('./onboarding-audit');
const { requireAuth, requirePermission, hasPermission } = require('./permissions');
const { inviteRateLimit } = require('./onboarding-employee-routes');
const log = require('./logger').createLogger('onboarding-journey');

const orgOf = (req) => req.user?.organisation_id || null;
const { isUuid, str } = odb;

const safe = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  log.error('journey route error', { error: err, path: req.path });
  if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
});
const notFound = (res) => res.status(404).json({ error: 'Not found' });
const noStore = (res) => res.set('Cache-Control', 'no-store');

/** Durable in-app notification; never throws. */
function notify(userId, payload) {
  if (!userId) return Promise.resolve();
  return Promise.resolve()
    .then(() => require('./app-routes').storeNotification(userId, payload))
    .catch(() => {});
}

// Lazily required: assignment-routes requires lifecycle, and this file must
// not be part of that module's init graph.
const shape = () => require('./onboarding-assignment-routes');

async function orgName(orgId) {
  try {
    const { rows } = await odb.pool.query('SELECT name FROM organisations WHERE id = $1', [orgId]);
    return rows[0]?.name || 'Opal Therapy';
  } catch (_) { return 'Opal Therapy'; }
}

async function loadRecord(req) {
  if (!isUuid(req.params.id)) return null;
  return odb.getAssignment(orgOf(req), req.params.id);
}

/** Offer terms as the API shows them, from the frozen snapshot. */
function offerRow(o) {
  if (!o) return null;
  return {
    id: o.id,
    version: o.version,
    status: o.status,
    terms: o.terms || {},
    approvedAt: o.approved_at, approvedByName: o.approved_by_name || null,
    sentAt: o.sent_at, sentByName: o.sent_by_name || null, sentTo: o.sent_to || null,
    reminderCount: o.reminder_count || 0, lastReminderAt: o.last_reminder_at,
    firstViewedAt: o.first_viewed_at,
    respondedAt: o.responded_at, signedName: o.signed_name || null,
    declineReason: o.decline_reason || null,
    withdrawnAt: o.withdrawn_at, withdrawReason: o.withdraw_reason || null,
    linkExpiresAt: o.token_expires_at,
    linkLive: !!o.response_token_hash && (!o.token_expires_at || new Date(o.token_expires_at) > new Date()),
    createdAt: o.created_at,
  };
}

function taskRow(t) {
  return {
    code: t.code, title: t.title, description: t.description,
    automation: t.automation || null, status: t.status,
    assigneeUserId: t.assignee_user_id || null, assigneeName: t.assignee_name || null,
    dueAt: t.due_at, sortOrder: t.sort_order,
    completedAt: t.completed_at, completedByName: t.completed_by_name || null,
    note: t.note || null, detail: t.detail || {},
    overdue: !!t.due_at && new Date(t.due_at) < new Date() && (t.status === 'pending' || t.status === 'in_progress'),
  };
}

/** Terms snapshot from an assignment row (what Start Onboarding stored). */
function termsFromAssignment(a, manager) {
  return {
    positionTitle: a.job_title,
    employmentType: a.employment_type,
    startDate: a.start_date ? String(a.start_date instanceof Date ? a.start_date.toISOString().slice(0, 10) : a.start_date).slice(0, 10) : null,
    endDate: a.end_date ? String(a.end_date instanceof Date ? a.end_date.toISOString().slice(0, 10) : a.end_date).slice(0, 10) : null,
    payBasis: a.pay_basis || null,
    payRate: a.pay_rate != null ? Number(a.pay_rate) : null,
    hoursPerWeek: a.hours_per_week != null ? Number(a.hours_per_week) : null,
    awardClassification: a.award_classification || null,
    probationMonths: a.probation_months != null ? Number(a.probation_months) : null,
    workLocation: a.work_location || null,
    reportsTo: manager || a.manager_name || null,
  };
}

/**
 * Generate the induction checklist the first time a record reaches Stage 3.
 * Idempotent — codes are unique per assignment.
 */
async function ensureInduction(assignment, tasks) {
  const stage3 = ['ready_to_activate', 'activated', 'completed'].includes(assignment.status);
  if (!stage3 || (tasks && tasks.length)) return tasks || [];
  const list = journey.buildInductionTasks(assignment);
  await jdb.ensureTasks(assignment.organisation_id, assignment.id, list);
  const { rows } = await odb.pool.query(
    `UPDATE onboarding_assignments SET induction_started_at = COALESCE(induction_started_at, NOW())
      WHERE id = $1 RETURNING induction_started_at`,
    [assignment.id]
  );
  // The caller's row predates the stamp; carry it forward so the response
  // shows the stage as started without a second read.
  if (rows[0]) assignment.induction_started_at = rows[0].induction_started_at;
  return jdb.listTasks(assignment.id);
}

/** The last induction task done closes the record. */
async function maybeComplete(assignment, tasks) {
  if (assignment.status !== 'activated') return assignment.status;
  const open = tasks.some((t) => t.status === 'pending' || t.status === 'in_progress' || t.status === 'failed');
  if (open) return assignment.status;
  await odb.pool.query(
    `UPDATE onboarding_assignments SET status = 'completed', completed_at = COALESCE(completed_at, NOW()),
            last_activity_at = NOW(), updated_at = NOW() WHERE id = $1 AND status = 'activated'`,
    [assignment.id]
  );
  return 'completed';
}

/** Everything the record screen shows, in one call. */
async function recordDetail(req, assignment) {
  let [offer, offers, requirements, tasks, dispatches] = await Promise.all([
    jdb.getCurrentOffer(assignment.id),
    jdb.listOffers(assignment.id),
    odb.listRequirements(assignment.id),
    jdb.listTasks(assignment.id),
    wdb.listDispatches(assignment.id),
  ]);
  tasks = await ensureInduction(assignment, tasks);

  const j = journey.projectJourney({ assignment, offer, requirements, tasks });
  const org = await orgName(assignment.organisation_id);
  const s = shape();
  const preview = offer
    ? letter.renderOfferLetter({
      terms: offer.terms, applicantName: assignment.applicant_name, orgName: org,
      issuedAt: offer.sent_at || offer.approved_at || offer.created_at,
      signatoryName: offer.approved_by_name || offer.sent_by_name || null,
      respondBy: offer.token_expires_at,
    })
    : null;

  return {
    ok: true,
    record: {
      ...s.assignmentRow(assignment),
      mobile: assignment.mobile || null,
      terms: termsFromAssignment(assignment),
      offerAcceptedAt: assignment.offer_accepted_at || null,
      offerDeclinedAt: assignment.offer_declined_at || null,
      inductionStartedAt: assignment.induction_started_at || null,
    },
    offer: offerRow(offer),
    offerHistory: offers.map(offerRow),
    letterHtml: preview ? preview.html : null,
    journey: j,
    sections: s.groupSections(requirements),
    tasks: tasks.map(taskRow),
    dispatches: dispatches.map((d) => ({
      id: d.id, kind: d.kind, toEmail: d.to_email, subject: d.subject, method: d.method,
      status: d.status, sentAt: d.sent_at || d.created_at, webLink: d.web_link || null,
    })),
    can: {
      assign: hasPermission(req.user, 'onboarding.assign'),
      review: hasPermission(req.user, 'onboarding.review'),
      verify: hasPermission(req.user, 'onboarding.verify'),
      activate: hasPermission(req.user, 'onboarding.activate'),
    },
  };
}

// ═════════════════════════════════════════════════════════════════════════════
//  OWNER SURFACE
// ═════════════════════════════════════════════════════════════════════════════

router.use('/api/onboarding/journey', requireAuth);

/** The board: every live record with its stage, next action and counts. */
router.get('/api/onboarding/journey/board', requirePermission('onboarding.view'), safe(async (req, res) => {
  const org = orgOf(req);
  const includeClosed = req.query.closed === '1';
  const all = await odb.listAssignments(org, {});
  const rows = all.filter((a) => includeClosed || !['cancelled', 'archived'].includes(a.status));
  const ids = rows.map((a) => a.id);

  const [offers, tasksMap, reqMap] = await Promise.all([
    jdb.mapCurrentOffers(ids), jdb.mapTasks(ids), jdb.mapRequirements(ids),
  ]);

  const records = [];
  for (const a of rows) {
    let tasks = tasksMap.get(a.id) || [];
    tasks = await ensureInduction(a, tasks);
    const j = journey.projectJourney({
      assignment: a, offer: offers.get(a.id) || null,
      requirements: reqMap.get(a.id) || [], tasks,
    });
    const offer = offers.get(a.id) || null;
    records.push({
      id: a.id,
      applicantName: a.applicant_name,
      applicantEmail: a.applicant_email,
      jobTitle: a.job_title,
      employmentType: a.employment_type,
      startDate: a.start_date,
      status: a.status,
      packageTitle: a.package_title,
      userId: a.user_id,
      createdAt: a.created_at,
      lastActivityAt: a.last_activity_at,
      offerStatus: offer ? offer.status : null,
      offerVersion: offer ? offer.version : null,
      stage: j.stage,
      stages: j.stages,
      next: j.next,
      counts: j.counts,
      daysToStart: j.daysToStart,
      attention: j.attention,
      closed: j.closed,
      complete: j.stage.key === 'complete',
    });
  }
  records.sort((x, y) => y.attention - x.attention
    || (x.daysToStart ?? 9999) - (y.daysToStart ?? 9999)
    || String(x.applicantName).localeCompare(String(y.applicantName)));

  const live = records.filter((r) => !r.closed && !r.complete);
  res.json({
    ok: true,
    records,
    summary: {
      live: live.length,
      needsYou: live.filter((r) => r.next.actor === 'admin').length,
      waitingOnEmployee: live.filter((r) => r.next.actor === 'employee').length,
      overdue: live.filter((r) => r.counts.overdue > 0).length,
      byStage: {
        offer: live.filter((r) => r.stage.key === 'offer').length,
        documentation: live.filter((r) => r.stage.key === 'documentation').length,
        induction: live.filter((r) => r.stage.key === 'induction').length,
      },
      complete: records.filter((r) => r.complete).length,
    },
    can: {
      assign: hasPermission(req.user, 'onboarding.assign'),
      review: hasPermission(req.user, 'onboarding.review'),
      activate: hasPermission(req.user, 'onboarding.activate'),
    },
  });
}));

/** What the Start Onboarding form needs to draw itself. */
router.get('/api/onboarding/journey/options', requirePermission('onboarding.view'), safe(async (req, res) => {
  const org = orgOf(req);
  const [packages, staff, settings] = await Promise.all([
    odb.listPackages(org, { kind: 'package' }), jdb.listAssignableStaff(org), odb.getOnboardingSettings(),
  ]);
  const assignable = packages.filter((p) => p.status === 'published' && Number(p.current_version) > 0);
  const roleCategories = [...new Set(assignable.map((p) => p.role_category).filter(Boolean))];
  res.json({
    ok: true,
    employmentTypes: engine.EMPLOYMENT_TYPES,
    roleCategories,
    portalRoles: ['therapist', 'admin', 'read_only', 'owner'],
    payBases: ['annual', 'hourly'],
    packages: assignable.map((p) => ({
      id: p.id, title: p.title, roleCategory: p.role_category, employmentType: p.employment_type,
    })),
    staff: staff.map((u) => ({ id: u.id, name: u.name, role: u.role })),
    defaults: {
      dueDays: settings.defaultDueDays || 14,
      offerLinkDays: 14,
      workLocation: settings.defaultWorkLocation || null,
    },
  });
}));

/**
 * START ONBOARDING. One form, one record, one offer draft.
 *
 * The package is chosen for the Owner from role and employment type. They can
 * override with packageId, but they are not asked to.
 */
router.post('/api/onboarding/journey/records', requirePermission('onboarding.assign'), safe(async (req, res) => {
  const b = req.body || {};
  const org = orgOf(req);

  const name = str(b.name, 200);
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const emailAddr = String(b.personalEmail || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddr)) return res.status(400).json({ error: 'A valid personal email is required' });

  const { terms, errors } = letter.normaliseTerms({
    positionTitle: b.position, employmentType: b.employmentType, startDate: b.startDate, endDate: b.endDate,
    payBasis: b.payBasis, payRate: b.payRate, hoursPerWeek: b.hoursPerWeek,
    awardClassification: b.awardClassification, probationMonths: b.probationMonths,
    workLocation: b.workLocation, reportsTo: b.reportsTo, additionalTerms: b.additionalTerms,
  }, engine.EMPLOYMENT_TYPES);
  if (errors.length) return res.status(400).json({ error: errors[0], errors });

  const proposedRole = ['owner', 'admin', 'therapist', 'read_only'].includes(b.proposedRole) ? b.proposedRole : 'therapist';
  const roleCategory = str(b.roleCategory, 40);

  // Package: an explicit choice, else the best recommendation.
  const packages = (await odb.listPackages(org, { kind: 'package' }))
    .filter((p) => p.status === 'published' && Number(p.current_version) > 0);
  let pkg = null;
  if (isUuid(b.packageId)) pkg = packages.find((p) => p.id === b.packageId) || null;
  if (!pkg) {
    const { scorePackage } = require('./onboarding-workflow-routes')._internals;
    const ranked = packages
      .map((p) => ({ p, score: scorePackage(p, { roleCategory, employmentType: terms.employmentType }).score }))
      .sort((x, y) => y.score - x.score);
    pkg = ranked[0] && ranked[0].score > 0 ? ranked[0].p : (packages.length === 1 ? packages[0] : null);
  }
  if (!pkg) {
    return res.status(409).json({
      error: 'No published onboarding package matches this role and employment type.',
      code: 'no_package',
    });
  }
  const version = await odb.getCurrentPackageVersion(pkg.id);
  if (!version) return res.status(409).json({ error: 'This package has no published version yet', code: 'no_package' });

  const existingUser = await db.getUserByEmail(emailAddr);
  if (existingUser && existingUser.role !== 'pre_employee') {
    return res.status(409).json({ error: 'An active account already exists for this email address.', code: 'account_exists' });
  }

  const settings = await odb.getOnboardingSettings();
  const dueDays = Number(b.dueDays) || settings.defaultDueDays || 14;
  const managerId = isUuid(b.managerUserId) ? b.managerUserId : null;
  if (managerId && !terms.reportsTo) {
    const { rows } = await odb.pool.query('SELECT name FROM users WHERE id = $1', [managerId]);
    terms.reportsTo = rows[0]?.name || null;
  }

  const facts = engine.buildFacts({
    employment_type: terms.employmentType,
    role_category: roleCategory,
    proposed_role: proposedRole,
    is_treating_therapist: b.isTreatingTherapist === true,
    child_related_work: b.childRelatedWork || 'assessment_required',
    ndis_risk_assessed_role: b.ndisRiskAssessedRole || 'requires_determination',
    mobile_community_role: b.mobileCommunityRole === true,
    uses_own_vehicle: b.usesOwnVehicle === true,
    new_graduate: b.newGraduate === true,
    work_rights_check_required: b.workRightsCheckRequired === true,
  }, settings);

  let created; let offer;
  try {
    ({ created, offer } = await odb.withTransaction(async (q) => {
      const { rows } = await q.query(
        `INSERT INTO onboarding_assignments
           (organisation_id, package_id, package_version_id, applicant_name, applicant_email,
            job_title, proposed_role, is_treating_therapist, employment_type, role_category,
            start_date, end_date, manager_user_id, work_location, facts, due_at,
            owner_note, created_by, mobile, login_email,
            pay_basis, pay_rate, hours_per_week, award_classification, probation_months)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
                 NOW() + ($16 || ' days')::INTERVAL, $17, $18, $19, $20, $21, $22, $23, $24, $25)
         RETURNING *`,
        [
          org, pkg.id, version.id, name, emailAddr,
          terms.positionTitle, proposedRole, b.isTreatingTherapist === true,
          terms.employmentType, roleCategory,
          terms.startDate, terms.endDate, managerId, terms.workLocation,
          JSON.stringify(facts), String(dueDays), str(b.notes, 2000), req.user.id,
          str(b.mobile, 40), emailAddr,
          terms.payBasis, terms.payRate, terms.hoursPerWeek, terms.awardClassification, terms.probationMonths,
        ]
      );
      const a = rows[0];
      const o = await jdb.createOfferDraft({
        organisationId: org, assignmentId: a.id, terms, createdBy: req.user.id,
      }, q);
      return { created: a, offer: o };
    }));
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({
        error: 'An onboarding run is already in progress for this email address.', code: 'assignment_exists',
      });
    }
    throw err;
  }

  await auditOnboarding(req, 'journey_started', {
    targetType: 'onboarding_assignment', targetId: created.id,
    metadata: {
      assignmentId: created.id, packageId: pkg.id, packageVersionId: version.id,
      offerId: offer.id, employmentType: created.employment_type, roleCategory, role: proposedRole,
    },
  });

  const full = await odb.getAssignment(org, created.id);
  res.status(201).json(await recordDetail(req, full));
}));

router.get('/api/onboarding/journey/records/:id', requirePermission('onboarding.view'), safe(async (req, res) => {
  const assignment = await loadRecord(req);
  if (!assignment) return notFound(res);
  res.json(await recordDetail(req, assignment));
}));

// ── Stage 1: the letter of offer ────────────────────────────────────────────

/** Edit the terms. Allowed while the offer is a draft or approved-but-unsent. */
router.put('/api/onboarding/journey/records/:id/offer', requirePermission('onboarding.assign'), safe(async (req, res) => {
  const assignment = await loadRecord(req);
  if (!assignment) return notFound(res);
  if (assignment.status !== 'created') {
    return res.status(409).json({ error: 'The offer terms are fixed once the onboarding documentation is released.', code: 'released' });
  }

  const { terms, errors } = letter.normaliseTerms(req.body?.terms || req.body, engine.EMPLOYMENT_TYPES);
  if (errors.length) return res.status(400).json({ error: errors[0], errors });

  const current = await jdb.getCurrentOffer(assignment.id);
  let offer;
  if (current && ['draft', 'approved'].includes(current.status)) {
    offer = await jdb.updateOfferTerms(current.id, terms);
  } else if (!current || ['declined', 'withdrawn'].includes(current.status)) {
    offer = await jdb.createOfferDraft({
      organisationId: orgOf(req), assignmentId: assignment.id, terms, createdBy: req.user.id,
    });
  } else {
    return res.status(409).json({
      error: `The offer has been ${current.status}. Withdraw it before changing the terms.`, code: 'offer_' + current.status,
    });
  }

  // The record mirrors the terms so every later stage reads one set of facts.
  await odb.pool.query(
    `UPDATE onboarding_assignments
        SET job_title = $2, employment_type = $3, start_date = $4, end_date = $5,
            pay_basis = $6, pay_rate = $7, hours_per_week = $8, award_classification = $9,
            probation_months = $10, work_location = $11,
            last_activity_at = NOW(), updated_at = NOW()
      WHERE id = $1`,
    [assignment.id, terms.positionTitle, terms.employmentType, terms.startDate, terms.endDate,
      terms.payBasis, terms.payRate, terms.hoursPerWeek, terms.awardClassification,
      terms.probationMonths, terms.workLocation]
  );

  await auditOnboarding(req, 'offer_terms_updated', {
    targetType: 'onboarding_offer', targetId: offer.id,
    metadata: { assignmentId: assignment.id, version: offer.version },
  });
  res.json(await recordDetail(req, await odb.getAssignment(orgOf(req), assignment.id)));
}));

router.post('/api/onboarding/journey/records/:id/offer/approve', requirePermission('onboarding.assign'), safe(async (req, res) => {
  const assignment = await loadRecord(req);
  if (!assignment) return notFound(res);
  const current = await jdb.getCurrentOffer(assignment.id);
  if (!current || current.status !== 'draft') {
    return res.status(409).json({ error: 'There is no draft letter of offer to approve.', code: 'no_draft' });
  }
  const offer = await jdb.approveOffer(current.id, req.user.id);
  await auditOnboarding(req, 'offer_approved', {
    targetType: 'onboarding_offer', targetId: offer.id,
    metadata: { assignmentId: assignment.id, version: offer.version },
  });
  res.json(await recordDetail(req, assignment));
}));

/** Send (or re-send) the approved letter. Mints a fresh response link each time. */
router.post('/api/onboarding/journey/records/:id/offer/send', requirePermission('onboarding.assign'), safe(async (req, res) => {
  const assignment = await loadRecord(req);
  if (!assignment) return notFound(res);
  const current = await jdb.getCurrentOffer(assignment.id);
  if (!current || !['approved', 'sent'].includes(current.status)) {
    return res.status(409).json({ error: 'Approve the letter of offer before sending it.', code: 'not_approved' });
  }
  const isReminder = current.status === 'sent';
  const days = Number(req.body?.days) || 14;
  const minted = await jdb.markOfferSent(current.id, { actorId: req.user.id, toEmail: assignment.applicant_email, days });
  if (!minted) return res.status(409).json({ error: 'The offer could not be sent.', code: 'not_sendable' });

  const org = await orgName(assignment.organisation_id);
  let outcome;
  try {
    const r = await email.sendOfferEmail({
      toEmail: assignment.applicant_email, token: minted.token,
      displayName: assignment.applicant_name, roleTitle: assignment.job_title,
      orgName: org, expiresAt: minted.offer.token_expires_at, isReminder,
    });
    outcome = r.skipped
      ? { status: 'skipped', message: 'Email is not configured. Copy the link and send it yourself.', subject: r.subject }
      : { status: 'sent', messageId: r.messageId, message: `Letter of offer sent to ${assignment.applicant_email}.`, subject: r.subject };
  } catch (err) {
    log.warn('offer email failed', { error: err, assignmentId: assignment.id });
    outcome = { status: 'failed', message: 'The email could not be sent. The link below still works — you can deliver it yourself.', subject: null };
  }

  await wdb.recordDispatch({
    organisationId: orgOf(req), assignmentId: assignment.id,
    kind: isReminder ? 'offer_reminder' : 'letter_of_offer', toEmail: assignment.applicant_email,
    subject: outcome.subject || 'Letter of offer', method: 'smtp', status: outcome.status,
    providerMessageId: outcome.messageId || null,
    errorReason: outcome.status === 'failed' ? 'smtp_error' : null,
    requestedBy: req.user.id,
  });
  await auditOnboarding(req, isReminder ? 'offer_reminder_sent' : 'offer_sent', {
    targetType: 'onboarding_offer', targetId: minted.offer.id,
    metadata: {
      assignmentId: assignment.id, version: minted.offer.version,
      emailSent: outcome.status === 'sent', emailSkipped: outcome.status === 'skipped', emailFailed: outcome.status === 'failed',
    },
  });

  noStore(res);
  const detail = await recordDetail(req, assignment);
  res.status(outcome.status === 'failed' ? 502 : 200).json({
    ...detail, ok: outcome.status !== 'failed',
    delivery: { status: outcome.status, message: outcome.message },
    // Returned only to the person who sent it, this once.
    offerUrl: email.buildOfferUrl(minted.token),
  });
}));

router.post('/api/onboarding/journey/records/:id/offer/withdraw', requirePermission('onboarding.assign'), safe(async (req, res) => {
  const assignment = await loadRecord(req);
  if (!assignment) return notFound(res);
  const current = await jdb.getCurrentOffer(assignment.id);
  if (!current || !['draft', 'approved', 'sent'].includes(current.status)) {
    return res.status(409).json({ error: 'There is no open offer to withdraw.', code: 'no_open_offer' });
  }
  const offer = await jdb.withdrawOffer(current.id, req.user.id, req.body?.reason);
  await auditOnboarding(req, 'offer_withdrawn', {
    targetType: 'onboarding_offer', targetId: offer.id, metadata: { assignmentId: assignment.id, version: offer.version },
  });
  res.json(await recordDetail(req, assignment));
}));

/**
 * Skip the letter (already signed on paper, say) and go straight to the
 * documentation stage.
 */
router.post('/api/onboarding/journey/records/:id/offer/skip', requirePermission('onboarding.assign'), safe(async (req, res) => {
  const assignment = await loadRecord(req);
  if (!assignment) return notFound(res);
  const current = await jdb.getCurrentOffer(assignment.id);
  if (!current || !['draft', 'approved'].includes(current.status)) {
    return res.status(409).json({ error: 'Only an unsent offer can be marked as not required.', code: 'not_skippable' });
  }
  const offer = await jdb.markOfferNotRequired(current.id);
  await odb.pool.query(
    `UPDATE onboarding_assignments SET offer_accepted_at = COALESCE(offer_accepted_at, NOW()), last_activity_at = NOW() WHERE id = $1`,
    [assignment.id]
  );
  await auditOnboarding(req, 'offer_not_required', {
    targetType: 'onboarding_offer', targetId: offer.id, metadata: { assignmentId: assignment.id },
  });
  const release = await tryRelease(req, await odb.getAssignment(orgOf(req), assignment.id));
  res.json({ ...(await recordDetail(req, await odb.getAssignment(orgOf(req), assignment.id))), release });
}));

/** Stage 1 → 2 by hand, for when the automatic release after acceptance was refused. */
router.post('/api/onboarding/journey/records/:id/release', requirePermission('onboarding.assign'), safe(async (req, res) => {
  const assignment = await loadRecord(req);
  if (!assignment) return notFound(res);
  const current = await jdb.getCurrentOffer(assignment.id);
  if (!current || !['accepted', 'not_required'].includes(current.status)) {
    return res.status(409).json({ error: 'The letter of offer has not been accepted yet.', code: 'offer_open' });
  }
  const release = await tryRelease(req, assignment);
  if (release.status === 'refused') return res.status(release.httpStatus).json({ ...release.body, release });
  res.status(201).json({ ...(await recordDetail(req, await odb.getAssignment(orgOf(req), assignment.id))), release });
}));

/**
 * Attempt the 034 release for a record whose offer is settled. A refusal is
 * returned, not thrown: the caller decides whether it is an error.
 */
async function tryRelease(req, assignment) {
  if (assignment.status !== 'created') return { status: 'already', message: 'Already released.' };
  try {
    const outcome = await lifecycle.releaseAssignment({
      org: assignment.organisation_id, assignment,
      actor: { id: req.user.id, name: req.user.name, email: req.user.email },
    });
    await auditOnboarding(req, 'assignment_released', {
      targetType: 'onboarding_assignment', targetId: assignment.id,
      metadata: {
        assignmentId: assignment.id, subjectUserId: outcome.userId, inviteId: outcome.invite.id,
        requirementCount: outcome.issued, emailSent: outcome.emailResult?.sent || false,
        emailSkipped: outcome.emailResult?.skipped || false, emailFailed: outcome.emailResult?.failed || false,
        trigger: 'journey',
      },
    });
    return {
      status: 'released', requirementsIssued: outcome.issued,
      emailSent: outcome.emailResult?.sent || false, emailSkipped: outcome.emailResult?.skipped || false,
      emailFailed: outcome.emailResult?.failed || false, onboardingUrl: outcome.onboardingUrl,
      message: 'Onboarding documentation released and the invitation sent.',
    };
  } catch (err) {
    if (err instanceof lifecycle.LifecycleError) {
      return { status: 'refused', httpStatus: err.status, body: err.body, message: err.body?.message || err.body?.error };
    }
    throw err;
  }
}

// ── Stage 3: induction tasks ────────────────────────────────────────────────

const TASK_VERBS = {
  complete: { status: 'done', perm: 'onboarding.review', audit: 'induction_task_completed' },
  skip: { status: 'skipped', perm: 'onboarding.review', audit: 'induction_task_skipped' },
  reopen: { status: 'pending', perm: 'onboarding.review', audit: 'induction_task_reopened' },
  start: { status: 'in_progress', perm: 'onboarding.review', audit: 'induction_task_started' },
};

for (const [verb, spec] of Object.entries(TASK_VERBS)) {
  router.post(`/api/onboarding/journey/records/:id/tasks/:code/${verb}`, requirePermission(spec.perm), safe(async (req, res) => {
    const assignment = await loadRecord(req);
    if (!assignment) return notFound(res);
    const task = await jdb.getTask(assignment.id, req.params.code);
    if (!task) return notFound(res);
    if (task.automation && verb === 'complete' && task.status !== 'done') {
      return res.status(409).json({ error: 'This task is performed by the portal. Run it instead of ticking it.', code: 'automated' });
    }
    await jdb.setTaskStatus(assignment.id, task.code, { status: spec.status, actorId: req.user.id, note: req.body?.note });
    const tasks = await jdb.listTasks(assignment.id);
    const status = await maybeComplete(assignment, tasks);
    await auditOnboarding(req, spec.audit, {
      targetType: 'onboarding_assignment', targetId: assignment.id,
      metadata: { assignmentId: assignment.id, taskCode: task.code, recordStatus: status },
    });
    res.json(await recordDetail(req, await odb.getAssignment(orgOf(req), assignment.id)));
  }));
}

router.patch('/api/onboarding/journey/records/:id/tasks/:code', requirePermission('onboarding.review'), safe(async (req, res) => {
  const assignment = await loadRecord(req);
  if (!assignment) return notFound(res);
  const task = await jdb.getTask(assignment.id, req.params.code);
  if (!task) return notFound(res);
  const b = req.body || {};
  let dueAt = null;
  if (b.dueAt) { const d = new Date(b.dueAt); if (Number.isNaN(d.getTime())) return res.status(400).json({ error: 'dueAt is not a valid date' }); dueAt = d; }
  if (b.assigneeUserId && !isUuid(b.assigneeUserId)) return res.status(400).json({ error: 'assigneeUserId is not valid' });
  if (b.assigneeUserId) {
    const staff = await jdb.listAssignableStaff(orgOf(req));
    if (!staff.some((u) => u.id === b.assigneeUserId)) return res.status(400).json({ error: 'That person cannot be assigned an induction task' });
  }
  await jdb.assignTask(assignment.id, task.code, { assigneeUserId: b.assigneeUserId || null, dueAt });
  if (b.assigneeUserId && b.assigneeUserId !== task.assignee_user_id) {
    notify(b.assigneeUserId, {
      type: `onboarding_task_${assignment.id}_${task.code}`,
      title: 'Induction task assigned to you',
      message: `${task.title} for a new starter${dueAt ? `, due ${dueAt.toLocaleDateString('en-AU')}` : ''}.`,
      severity: 'info', relatedEntity: 'onboarding_assignment',
      actionPayload: { assignmentId: assignment.id, taskCode: task.code },
    });
  }
  await auditOnboarding(req, 'induction_task_assigned', {
    targetType: 'onboarding_assignment', targetId: assignment.id,
    metadata: { assignmentId: assignment.id, taskCode: task.code, assigneeUserId: b.assigneeUserId || null },
  });
  res.json(await recordDetail(req, assignment));
}));

/** Run an automated task. Today: portal_access → activation. */
router.post('/api/onboarding/journey/records/:id/tasks/:code/run', requirePermission('onboarding.activate'), safe(async (req, res) => {
  const assignment = await loadRecord(req);
  if (!assignment) return notFound(res);
  const task = await jdb.getTask(assignment.id, req.params.code);
  if (!task) return notFound(res);
  if (task.automation !== 'activate_portal_access') {
    return res.status(409).json({ error: 'This task is done by a person, not the portal.', code: 'manual' });
  }
  if (task.status === 'done') return res.status(409).json({ error: 'Portal access is already active.', code: 'already_done' });

  let outcome;
  try {
    outcome = await lifecycle.activateAssignment({
      assignment, actor: { id: req.user.id, name: req.user.name, email: req.user.email },
    });
  } catch (err) {
    if (err instanceof lifecycle.LifecycleError) {
      await jdb.setTaskStatus(assignment.id, task.code, {
        status: 'failed', actorId: req.user.id, note: err.body?.error || 'Activation refused',
        detail: { blockers: (err.body?.blockers || []).map((x) => x.code) },
      });
      return res.status(err.status).json(err.body);
    }
    throw err;
  }
  await jdb.setTaskStatus(assignment.id, task.code, { status: 'done', actorId: req.user.id, note: null, detail: { activatedRole: outcome.user.role } });

  await auditOnboarding(req, 'employee_activated', {
    targetType: 'user', targetId: assignment.user_id,
    metadata: {
      assignmentId: assignment.id, subjectUserId: assignment.user_id,
      role: assignment.proposed_role, previousRole: 'pre_employee', employmentType: assignment.employment_type,
      trigger: 'induction_task',
    },
  });
  await notify(assignment.user_id, {
    type: `onboarding_activated_${assignment.id}`,
    title: 'Your Opal Therapy account is active',
    message: 'Your onboarding documentation is complete and your portal access is now active.',
    severity: 'success', relatedEntity: 'onboarding_assignment', actionPayload: { assignmentId: assignment.id },
  });
  try {
    await email.sendAccountApprovedEmail({ toEmail: outcome.user.email, name: outcome.user.name, role: outcome.user.role });
  } catch (err) {
    log.warn('activation email failed', { error: err, assignmentId: assignment.id });
  }

  const fresh = await odb.getAssignment(orgOf(req), assignment.id);
  const tasks = await jdb.listTasks(assignment.id);
  await maybeComplete(fresh, tasks);
  res.json(await recordDetail(req, await odb.getAssignment(orgOf(req), assignment.id)));
}));

// ═════════════════════════════════════════════════════════════════════════════
//  PUBLIC — the candidate's response
// ═════════════════════════════════════════════════════════════════════════════

function offerProblem(o) {
  if (!o) return { status: 404, code: 'invalid', message: 'This offer link is not valid.' };
  if (o.status === 'accepted') return { status: 410, code: 'answered', message: 'This offer has already been accepted. Thank you!' };
  if (o.status === 'declined') return { status: 410, code: 'answered', message: 'This offer has already been answered.' };
  if (o.status === 'withdrawn') return { status: 410, code: 'withdrawn', message: 'This offer has been withdrawn. Please contact the practice.' };
  if (o.status !== 'sent') return { status: 410, code: 'invalid', message: 'This offer link is not valid.' };
  if (o.token_expires_at && new Date(o.token_expires_at) <= new Date()) {
    return { status: 410, code: 'expired', message: 'This offer link has expired. Please ask the practice to send it again.' };
  }
  if (['cancelled', 'archived'].includes(o.assignment_status)) {
    return { status: 410, code: 'cancelled', message: 'This offer is no longer open. Please contact the practice.' };
  }
  return null;
}

async function publicAudit(o, action, metadata, req) {
  try {
    await db.logAuditEvent({
      actorUserId: null, action: `onboarding.${action}`, targetType: 'onboarding_offer', targetId: o.id,
      organisationId: o.org_id || null, ipAddress: req.ip, metadata: safeMetadata(metadata),
    });
  } catch (err) { log.warn('audit write failed', { error: err, action }); }
}

router.post('/api/onboarding-offer/check', inviteRateLimit, safe(async (req, res) => {
  noStore(res);
  const o = await jdb.getOfferByToken(req.body?.token);
  const problem = offerProblem(o);
  if (problem) return res.status(problem.status).json({ ok: false, code: problem.code, error: problem.message });

  await jdb.markOfferViewed(o.id);
  const { rows } = await odb.pool.query('SELECT name FROM users WHERE id = $1', [o.approved_by || o.sent_by]);
  const rendered = letter.renderOfferLetter({
    terms: o.terms, applicantName: o.applicant_name, orgName: o.organisation_name,
    issuedAt: o.sent_at, signatoryName: rows[0]?.name || null, respondBy: o.token_expires_at,
  });
  res.json({
    ok: true,
    applicantName: o.applicant_name,
    organisationName: o.organisation_name || 'Opal Therapy',
    positionTitle: o.terms?.positionTitle || null,
    expiresAt: o.token_expires_at,
    letterHtml: rendered.html,
  });
}));

router.post('/api/onboarding-offer/respond', inviteRateLimit, safe(async (req, res) => {
  noStore(res);
  const b = req.body || {};
  const o = await jdb.getOfferByToken(b.token);
  const problem = offerProblem(o);
  if (problem) return res.status(problem.status).json({ ok: false, code: problem.code, error: problem.message });

  const decision = b.decision === 'accept' ? 'accept' : (b.decision === 'decline' ? 'decline' : null);
  if (!decision) return res.status(400).json({ ok: false, error: 'Please choose accept or decline.' });
  const signedName = str(b.signedName, 200);
  if (decision === 'accept' && (!signedName || signedName.length < 2)) {
    return res.status(400).json({ ok: false, error: 'Please type your full name to accept the offer.' });
  }

  const answered = await jdb.respondToOffer(o.id, { decision, signedName, reason: b.reason });
  if (!answered) return res.status(409).json({ ok: false, code: 'answered', error: 'This offer has already been answered.' });

  await odb.pool.query(
    decision === 'accept'
      ? `UPDATE onboarding_assignments SET offer_accepted_at = NOW(), last_activity_at = NOW(), updated_at = NOW() WHERE id = $1`
      : `UPDATE onboarding_assignments SET offer_declined_at = NOW(), last_activity_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [o.assignment_id]
  );
  await publicAudit(o, decision === 'accept' ? 'offer_accepted' : 'offer_declined',
    { assignmentId: o.assignment_id, version: o.version, hasReason: !!b.reason }, req);

  // Whoever sent the offer hears about the answer.
  const owner = o.sent_by || o.approved_by || null;

  if (decision === 'decline') {
    await notify(owner, {
      type: `onboarding_offer_declined_${o.assignment_id}`,
      title: 'A letter of offer was declined',
      message: `${o.applicant_name} has declined the offer. Open the onboarding record to revise or close it.`,
      severity: 'warning', relatedEntity: 'onboarding_assignment', actionPayload: { assignmentId: o.assignment_id },
    });
    return res.json({ ok: true, decision: 'declined', message: 'Thank you for letting us know. The practice has been informed.' });
  }

  // ACCEPTED → Stage 2 begins by itself. The release is recorded against the
  // person who sent the offer: they are the one who authorised it.
  let release = { status: 'pending' };
  try {
    const assignment = await odb.getAssignment(o.org_id, o.assignment_id);
    const { rows } = await odb.pool.query('SELECT id, name, email FROM users WHERE id = $1', [owner]);
    const actor = rows[0] ? { id: rows[0].id, name: rows[0].name, email: rows[0].email } : null;
    if (assignment && actor) {
      const outcome = await lifecycle.releaseAssignment({ org: o.org_id, assignment, actor });
      release = { status: 'released', emailSent: outcome.emailResult?.sent || false };
      await db.logAuditEvent({
        actorUserId: actor.id, action: 'onboarding.assignment_released', targetType: 'onboarding_assignment',
        targetId: assignment.id, organisationId: o.org_id, ipAddress: req.ip,
        metadata: safeMetadata({
          assignmentId: assignment.id, subjectUserId: outcome.userId, inviteId: outcome.invite.id,
          requirementCount: outcome.issued, emailSent: outcome.emailResult?.sent || false, trigger: 'offer_accepted',
        }),
      });
    } else {
      release = { status: 'refused', reason: 'no_actor' };
    }
  } catch (err) {
    if (err instanceof lifecycle.LifecycleError) {
      release = { status: 'refused', reason: err.body?.code || 'refused' };
      log.warn('automatic release refused after acceptance', { assignmentId: o.assignment_id, code: err.body?.code });
    } else {
      log.error('automatic release failed after acceptance', { error: err, assignmentId: o.assignment_id });
      release = { status: 'failed' };
    }
  }

  await notify(owner, {
    type: `onboarding_offer_accepted_${o.assignment_id}`,
    title: 'A letter of offer was accepted',
    message: release.status === 'released'
      ? `${o.applicant_name} accepted the offer. Their onboarding documentation has been released automatically.`
      : `${o.applicant_name} accepted the offer. The onboarding documentation could not be released automatically — open the record to release it.`,
    severity: release.status === 'released' ? 'success' : 'warning',
    relatedEntity: 'onboarding_assignment', actionPayload: { assignmentId: o.assignment_id },
  });

  res.json({
    ok: true, decision: 'accepted',
    message: release.status === 'released'
      ? 'Thank you — your acceptance has been recorded. A separate email with a secure link to complete your onboarding is on its way.'
      : 'Thank you — your acceptance has been recorded. The practice will be in touch with your onboarding details shortly.',
  });
}));

module.exports = router;
module.exports._internals = { tryRelease, ensureInduction, maybeComplete, offerProblem };
