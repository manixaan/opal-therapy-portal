'use strict';

/**
 * ONBOARDING JOURNEY — routes for the three-stage workflow.
 *
 *   /api/onboarding/journey/*    the Owner's board and one record's command
 *                                centre (session + onboarding.* permission)
 *
 * PHASE 1 — THE LETTER OF OFFER
 * ─────────────────────────────
 *   terms → letter (.docx, from the template, regenerated whenever the terms
 *   change) → preview / download / edit in Word / upload back → Email 1
 *   (Opal's wording, editable) → an Outlook DRAFT with the letter attached →
 *   the Owner sends it from Outlook and marks it sent → stage 1.5, waiting →
 *   the signed letter is uploaded and stored → the Owner verifies it → the
 *   release (034's act) runs by itself and Stage 2 begins.
 *
 * WHAT IS AUTOMATIC HERE
 * ──────────────────────
 *  • Start Onboarding creates the record AND the letter from the same
 *    details; the package is chosen by recommendation.
 *  • Verifying the signed letter performs the release — account, invitation,
 *    requirement set — with no further click. If the release is refused (an
 *    unpublished policy, say) the record's "next" line says so.
 *  • Reaching the induction stage generates the checklist; the last task
 *    closes the record.
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
const offerPdf = require('./onboarding-offer-pdf');
const journey = require('./onboarding-journey');
const lifecycle = require('./onboarding-lifecycle');
const letter = require('./onboarding-offer-letter');
const offerDocx = require('./onboarding-offer-docx');
const offerEmail = require('./onboarding-offer-email');
const graphMail = require('./graph-mail');
const { auditOnboarding } = require('./onboarding-audit');
const { requireAuth, requirePermission, hasPermission } = require('./permissions');
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
    email: {
      subject: o.email_subject || null, body: o.email_body || null,
      draftId: o.email_draft_id || null, webLink: o.email_web_link || null,
      draftedAt: o.email_drafted_at || null, sentAt: o.email_sent_at || null,
    },
    signedReceivedAt: o.signed_received_at || null,
    verifiedAt: o.verified_at || null,
    createdAt: o.created_at,
  };
}

function documentRow(d) {
  if (!d) return null;
  return {
    id: d.id, kind: d.kind, fileName: d.file_name, mime: d.file_mime, size: d.file_size_bytes,
    sha256: d.file_sha256, uploadedAt: d.uploaded_at, uploadedByName: d.uploaded_by_name || null,
    previewKind: d.file_mime === 'application/pdf' ? 'pdf' : (d.file_mime === offerDocx.DOCX_MIME ? 'docx' : null),
  };
}

/** The practice signatory for the letter: settings first, then the module default. */
function signatoryFrom(settings) {
  const st = settings || {};
  return {
    name: st.offerSignatoryName || offerDocx.DEFAULT_SIGNATORY.name,
    title: st.offerSignatoryTitle || offerDocx.DEFAULT_SIGNATORY.title,
    email: st.offerSignatoryEmail || offerDocx.DEFAULT_SIGNATORY.email,
    phone: st.offerSignatoryPhone || offerDocx.DEFAULT_SIGNATORY.phone,
  };
}

/**
 * The letter as it stands: the uploaded edit if there is one, else composed
 * fresh from the terms — so a change to the terms is always a change to the
 * letter, and an edit made in Word is never silently overwritten.
 */
async function currentLetter(assignment, offer) {
  const edited = await jdb.getLiveOfferDocument(offer.id, 'letter');
  if (edited) {
    const bytes = await jdb.readOfferDocumentBytes(edited);
    if (bytes) return { bytes, fileName: edited.file_name, source: 'uploaded', document: edited };
  }
  const settings = await odb.getOnboardingSettings();
  const issuedAt = offer.email_sent_at || offer.email_drafted_at || new Date();
  const bytes = await offerDocx.buildOfferDocx({
    terms: offer.terms || {}, issuedAt, signatory: signatoryFrom(settings),
    applicant: { name: assignment.applicant_name, email: assignment.applicant_email, mobile: assignment.mobile },
    isTreatingTherapist: assignment.is_treating_therapist === true || assignment.role_category === 'occupational_therapist',
  });
  return { bytes, fileName: offerDocx.offerFileName(assignment.applicant_name, issuedAt), source: 'generated', document: null };
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
async function ensureInduction(assignment, tasks, { force = false } = {}) {
  // Internal setup starts the moment Phase 1 settles (force, from the pack),
  // and in any case once the record reaches the induction statuses.
  const stage3 = ['ready_to_activate', 'activated', 'completed'].includes(assignment.status);
  if ((!stage3 && !force) || (tasks && tasks.length)) return tasks || [];
  const list = journey.buildInductionTasks(assignment);
  await jdb.ensureTasks(assignment.organisation_id, assignment.id, list);
  // The portal account itself exists as soon as the profile does.
  if (assignment.user_id) await jdb.setTaskStatus(assignment.id, 'portal_account', { status: 'done', actorId: null, note: 'Pre-employee account created with the profile' }).catch(() => {});
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

const trackingOf = (c) => (c ? { total: c.tracked, done: c.done, required: c.required, requiredDone: c.requiredDone } : null);

/** What the projection needs to know about the pack. */
function packSummary(a, counts, tracking) {
  return {
    prepared: !!a.pack_prepared_at, draftId: a.pack_email_draft_id || null,
    sentAt: a.starter_pack_sent_at || null, dueAt: a.pack_due_at || null, counts: counts || {}, tracking: tracking || null,
    completedAt: a.documentation_completed_at || null,
  };
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

  const packRoutes = require('./onboarding-pack-routes');
  const packDetail = await packRoutes._internals.packDetail(req, assignment, 'documentation');
  const inductionDetail = await packRoutes._internals.packDetail(req, assignment, 'induction');
  const readiness = await packRoutes._internals.readinessFor(req, assignment);
  let payrollSetup = null;
  if (hasPermission(req.user, 'onboarding.payroll')) {
    try { payrollSetup = await require('./onboarding-payroll-routes')._internals.payrollSetupFor(assignment); } catch (err) { log.warn('payroll setup unavailable', { error: err }); }
  }
  const returns = require('./onboarding-returns-routes')._internals;
  const attentionList = await returns.attentionFor(assignment);
  const profile = await require('./onboarding-profile-sync').profileSummary(assignment.user_id);
  const returnedDocs = (await require('./onboarding-returns-db').listReturns(assignment.id, { includeArchived: true })).map((d) => ({
    id: d.id, title: d.title, fileName: d.file_name, mime: d.file_mime, size: d.file_size_bytes, status: d.status, uploadedAt: d.uploaded_at,
    textStatus: d.text_status, packItemId: d.pack_item_id || null, matchStatus: d.match_status || 'pending', documentKind: d.document_kind || null,
    signatureStatus: d.signature_status || 'unknown',
    previewKind: d.file_mime === 'application/pdf' ? 'pdf' : String(d.file_mime || '').includes('wordprocessingml') ? 'docx' : null,
    previewUrl: `/api/onboarding/assignments/${assignment.id}/returned-documents/${d.id}/preview`,
    downloadUrl: `/api/onboarding/assignments/${assignment.id}/returned-documents/${d.id}/download`,
  }));
  const j = journey.projectJourney({
    assignment, offer, requirements, tasks, pack: packSummary(assignment, packDetail.counts, packDetail.tracking), attention: attentionList,
    induction: { prepared: !!assignment.induction_pack_prepared_at, draftId: assignment.induction_email_draft_id || null, sentAt: assignment.induction_sent_at || null, dueAt: assignment.induction_due_at || null, completedAt: assignment.induction_completed_at || null, tracking: inductionDetail.tracking, readiness },
    payroll: payrollSetup ? { status: payrollSetup.status, label: payrollSetup.label, ready: payrollSetup.ready, approved: payrollSetup.approved } : null,
  });
  const s = shape();
  const [editedLetter, signed] = offer
    ? await Promise.all([jdb.getLiveOfferDocument(offer.id, 'letter'), jdb.getLiveOfferDocument(offer.id, 'signed')])
    : [null, null];
  const emailDefault = offerEmail.composeOfferEmail({
    applicantName: assignment.applicant_name, positionTitle: assignment.job_title,
  });

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
    letter: offer ? {
      source: editedLetter ? 'uploaded' : 'generated',
      fileName: editedLetter ? editedLetter.file_name : offerDocx.offerFileName(assignment.applicant_name, offer.email_sent_at || new Date()),
      uploaded: documentRow(editedLetter),
      templateVersion: offerDocx.TEMPLATE_VERSION,
      previewUrl: `/api/onboarding/journey/records/${assignment.id}/offer/letter/preview.docx`,
      downloadUrl: `/api/onboarding/journey/records/${assignment.id}/offer/letter/download`,
      pdfUrl: `/api/onboarding/journey/records/${assignment.id}/offer/letter/download.pdf`,
    } : null,
    emailDefault,
    email: offer ? {
      subject: offer.email_subject || emailDefault.subject,
      body: offer.email_body || emailDefault.body,
      draftId: offer.email_draft_id || null, webLink: offer.email_web_link || null,
      draftedAt: offer.email_drafted_at || null, sentAt: offer.email_sent_at || null,
      outlook: { available: graphMail.isAvailable(req.user), reason: graphMail.unavailableReason(req.user) },
    } : null,
    signed: signed ? {
      ...documentRow(signed),
      previewUrl: `/api/onboarding/journey/records/${assignment.id}/offer/signed/preview`,
      downloadUrl: `/api/onboarding/journey/records/${assignment.id}/offer/signed/download`,
    } : null,
    journey: j,
    pack: packDetail,
    induction: { ...inductionDetail, readiness },
    payroll: payrollSetup,
    attention: attentionList,
    profile,
    returnedDocuments: returnedDocs,
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
  const all = await odb.listAssignments(org, {});
  const rows = all;
  const ids = rows.map((a) => a.id);

  const pdb = require('./onboarding-pack-db');
  const [offers, tasksMap, reqMap, packCounts, phaseCounts] = await Promise.all([
    jdb.mapCurrentOffers(ids), jdb.mapTasks(ids), jdb.mapRequirements(ids), pdb.countItems(ids), pdb.countItemsByPhase(ids),
  ]);

  const records = [];
  for (const a of rows) {
    let tasks = tasksMap.get(a.id) || [];
    tasks = await ensureInduction(a, tasks);
    const j = journey.projectJourney({
      assignment: a, offer: offers.get(a.id) || null,
      requirements: reqMap.get(a.id) || [], tasks,
      pack: packSummary(a, packCounts.get(a.id) || {}, trackingOf((phaseCounts.get(a.id) || {}).documentation)),
      induction: { prepared: !!a.induction_pack_prepared_at, draftId: a.induction_email_draft_id || null, sentAt: a.induction_sent_at || null, dueAt: a.induction_due_at || null, completedAt: a.induction_completed_at || null, tracking: trackingOf((phaseCounts.get(a.id) || {}).induction), readiness: null },
      attention: ['documents_received', 'starter_pack_sent', 'details_extracted'].includes(a.status) || a.induction_sent_at
        ? await require('./onboarding-returns-routes')._internals.attentionFor(a) : [],
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
      summary: j.summary,
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
      archived: records.filter((r) => r.closed).length,
    },
    can: {
      assign: hasPermission(req.user, 'onboarding.assign'),
      review: hasPermission(req.user, 'onboarding.review'),
      activate: hasPermission(req.user, 'onboarding.activate'),
    },
  });
}));

/** What the Start Onboarding form needs to draw itself. */
// ── Start Onboarding drafts ──────────────────────────────────────────────
// The unsubmitted Start form, saved as it is typed so a timeout loses nothing.
// A draft carries a name, an email and pay figures, so it is behind the same
// permission as starting an onboarding, never the wider view permission.

const DRAFT_FORM_LIMIT = 16 * 1024;

function draftFormOf(req) {
  const form = req.body?.form;
  if (!form || typeof form !== 'object' || Array.isArray(form)) return null;
  if (JSON.stringify(form).length > DRAFT_FORM_LIMIT) return null;
  return form;
}

router.get('/api/onboarding/journey/drafts', requirePermission('onboarding.assign'), safe(async (req, res) => {
  noStore(res);
  res.json({ drafts: await jdb.listStartDrafts(orgOf(req)) });
}));

router.get('/api/onboarding/journey/drafts/:id', requirePermission('onboarding.assign'), safe(async (req, res) => {
  noStore(res);
  const draft = await jdb.getStartDraft(orgOf(req), req.params.id);
  if (!draft) return notFound(res);
  res.json({ draft });
}));

router.post('/api/onboarding/journey/drafts', requirePermission('onboarding.assign'), safe(async (req, res) => {
  const form = draftFormOf(req);
  if (!form) return res.status(400).json({ error: 'A draft is the form as an object' });
  const draft = await jdb.createStartDraft({ organisationId: orgOf(req), userId: req.user.id, form });
  await auditOnboarding(req, 'start_draft_saved', { targetType: 'onboarding_start_draft', targetId: draft.id });
  res.status(201).json({ draft });
}));

router.put('/api/onboarding/journey/drafts/:id', requirePermission('onboarding.assign'), safe(async (req, res) => {
  const form = draftFormOf(req);
  if (!form) return res.status(400).json({ error: 'A draft is the form as an object' });
  const draft = await jdb.updateStartDraft(orgOf(req), req.params.id, { userId: req.user.id, form });
  if (!draft) return notFound(res);
  res.json({ draft });
}));

router.delete('/api/onboarding/journey/drafts/:id', requirePermission('onboarding.assign'), safe(async (req, res) => {
  const gone = await jdb.deleteStartDraft(orgOf(req), req.params.id);
  if (!gone) return notFound(res);
  await auditOnboarding(req, 'start_draft_discarded', { targetType: 'onboarding_start_draft', targetId: req.params.id });
  res.json({ ok: true });
}));

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

  // The draft this form was resumed from has become the record.
  if (isUuid(b.draftId)) await jdb.deleteStartDraft(org, b.draftId);

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
  if (current && ['draft', 'approved', 'email_drafted'].includes(current.status)) {
    // The letter regenerates from the new terms; an Outlook draft made from
    // the old letter is forgotten so it cannot be sent by mistake.
    offer = await jdb.updateOfferTerms(current.id, terms);
  } else if (!current || ['declined', 'withdrawn'].includes(current.status)) {
    offer = await jdb.createOfferDraft({
      organisationId: orgOf(req), assignmentId: assignment.id, terms, createdBy: req.user.id,
    });
  } else {
    return res.status(409).json({
      error: `The letter has been ${current.status.replace(/_/g, ' ')}. Withdraw it before changing the terms.`, code: 'offer_' + current.status,
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

// ── The letter itself ───────────────────────────────────────────────────────

/** The letter as a .docx — a preview stream (inline) or a download. */
async function serveLetter(req, res, disposition, format = 'docx') {
  const assignment = await loadRecord(req);
  if (!assignment) return notFound(res);
  const offer = await jdb.getCurrentOffer(assignment.id);
  if (!offer) return res.status(409).json({ error: 'There is no letter of offer on this record yet.', code: 'no_offer' });
  let out;
  try {
    out = await currentLetter(assignment, offer);
  } catch (err) {
    log.error('letter of offer could not be composed', { error: err, assignmentId: assignment.id });
    return res.status(500).json({ error: 'The letter could not be generated.', code: 'generation_failed' });
  }
  let bytes = out.bytes;
  let fileName = out.fileName;
  let mime = offerDocx.DOCX_MIME;
  if (format === 'pdf') {
    // The PDF is read from the same bytes — generated or uploaded — so it
    // cannot say something the Word file does not.
    try {
      bytes = await offerPdf.offerPdfFromDocx(bytes, { title: `Letter of Offer — ${assignment.applicant_name || ''}`.trim() });
    } catch (err) {
      log.error('letter of offer could not be rendered as PDF', { error: err, assignmentId: assignment.id });
      return res.status(500).json({ error: 'The PDF could not be generated.', code: 'pdf_failed' });
    }
    fileName = offerPdf.pdfFileName(out.fileName);
    mime = offerPdf.PDF_MIME;
  } else if (disposition === 'inline' && out.source === 'generated') {
    // Explicit page breaks for the browser preview only; the download is untouched.
    try { bytes = await require('./fca/preview-pagination').paginateForPreview(bytes); } catch (_) { /* preview only */ }
  }
  noStore(res);
  res.set('Content-Type', mime);
  res.set('Content-Length', String(bytes.length));
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Content-Disposition', `${disposition}; filename="${encodeURIComponent(fileName)}"`);
  res.send(bytes);
}
router.get('/api/onboarding/journey/records/:id/offer/letter/preview.docx', requirePermission('onboarding.view'), safe((req, res) => serveLetter(req, res, 'inline')));
router.get('/api/onboarding/journey/records/:id/offer/letter/download', requirePermission('onboarding.view'), safe((req, res) => serveLetter(req, res, 'attachment')));
router.get('/api/onboarding/journey/records/:id/offer/letter/download.pdf', requirePermission('onboarding.view'), safe((req, res) => serveLetter(req, res, 'attachment', 'pdf')));

const UPLOAD_MIMES = {
  [offerDocx.DOCX_MIME]: ['docx'],
  'application/pdf': ['pdf'],
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
};
const MAX_UPLOAD_BASE64 = 14 * 1024 * 1024;

/** Validate a base64 upload; returns { buffer, fileName, fileMime } or { error }. */
function readUpload(body, allowedMimes) {
  const f = body || {};
  if (!f.fileData || typeof f.fileData !== 'string') return { error: 'No file was received.' };
  if (f.fileData.length > MAX_UPLOAD_BASE64) return { error: 'That file is too large (10 MB limit).' };
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(f.fileData.slice(0, 1000))) return { error: 'The file could not be read.' };
  const fileMime = String(f.fileMime || '').toLowerCase();
  const exts = allowedMimes[fileMime];
  if (!exts) return { error: `That file type is not accepted. Use ${Object.values(allowedMimes).flat().map((e) => e.toUpperCase()).join(', ')}.` };
  const fileName = String(f.fileName || '').trim().slice(0, 255);
  if (!fileName || /[/\\]|\.\./.test(fileName)) return { error: 'The file name is not valid.' };
  const ext = fileName.split('.').pop().toLowerCase();
  if (!exts.includes(ext)) return { error: 'The file name does not match its type.' };
  const buffer = Buffer.from(f.fileData, 'base64');
  if (!buffer.length) return { error: 'The file is empty.' };
  return { buffer, fileName, fileMime };
}

/** Upload a letter edited in Word. It becomes the attachment until the terms change. */
router.post('/api/onboarding/journey/records/:id/offer/letter', requirePermission('onboarding.assign'), safe(async (req, res) => {
  const assignment = await loadRecord(req);
  if (!assignment) return notFound(res);
  const offer = await jdb.getCurrentOffer(assignment.id);
  if (!offer || !['draft', 'approved', 'email_drafted'].includes(offer.status)) {
    return res.status(409).json({ error: 'The letter can only be replaced before it is sent.', code: 'not_editable' });
  }
  const up = readUpload(req.body, { [offerDocx.DOCX_MIME]: ['docx'] });
  if (up.error) return res.status(400).json({ error: up.error });
  // It must still be a Word package; a renamed file is refused.
  try { await require('jszip').loadAsync(up.buffer); } catch (_) { return res.status(400).json({ error: 'That is not a Word document.' }); }

  const doc = await jdb.storeOfferDocument({
    organisationId: orgOf(req), offerId: offer.id, assignmentId: assignment.id, kind: 'letter',
    fileName: up.fileName, fileMime: up.fileMime, buffer: up.buffer, uploadedBy: req.user.id,
  });
  // A draft in Outlook carries the old letter; it has to be made again.
  if (offer.status === 'email_drafted') await jdb.resetOfferToDraft(offer.id);
  await auditOnboarding(req, 'offer_letter_uploaded', {
    targetType: 'onboarding_offer', targetId: offer.id,
    metadata: { assignmentId: assignment.id, documentId: doc.id, sha256: doc.file_sha256, bytes: doc.file_size_bytes },
  });
  res.status(201).json(await recordDetail(req, assignment));
}));

/** Discard the uploaded edit and go back to the generated letter. */
router.delete('/api/onboarding/journey/records/:id/offer/letter', requirePermission('onboarding.assign'), safe(async (req, res) => {
  const assignment = await loadRecord(req);
  if (!assignment) return notFound(res);
  const offer = await jdb.getCurrentOffer(assignment.id);
  if (!offer || !['draft', 'approved', 'email_drafted'].includes(offer.status)) {
    return res.status(409).json({ error: 'The letter can only be changed before it is sent.', code: 'not_editable' });
  }
  const removed = await jdb.removeOfferDocument(offer.id, 'letter');
  if (removed && offer.status === 'email_drafted') await jdb.resetOfferToDraft(offer.id);
  await auditOnboarding(req, 'offer_letter_upload_discarded', { targetType: 'onboarding_offer', targetId: offer.id, metadata: { assignmentId: assignment.id } });
  res.json(await recordDetail(req, assignment));
}));

// ── Email 1 ─────────────────────────────────────────────────────────────────

/** Save the Owner's edits to Email 1 (subject and body) without drafting yet. */
router.put('/api/onboarding/journey/records/:id/offer/email', requirePermission('onboarding.assign'), safe(async (req, res) => {
  const assignment = await loadRecord(req);
  if (!assignment) return notFound(res);
  const offer = await jdb.getCurrentOffer(assignment.id);
  if (!offer || !['draft', 'approved', 'email_drafted'].includes(offer.status)) {
    return res.status(409).json({ error: 'Email 1 can only be edited before it is sent.', code: 'not_editable' });
  }
  const subject = str(req.body?.subject, 250);
  const body = typeof req.body?.body === 'string' ? req.body.body.slice(0, 20000) : null;
  if (!subject) return res.status(400).json({ error: 'A subject is required.' });
  if (!body || !body.trim()) return res.status(400).json({ error: 'The email body cannot be empty.' });
  await jdb.saveOfferEmail(offer.id, { subject, body });
  res.json(await recordDetail(req, assignment));
}));

/** Reset Email 1 to Opal's template wording. */
router.post('/api/onboarding/journey/records/:id/offer/email/reset', requirePermission('onboarding.assign'), safe(async (req, res) => {
  const assignment = await loadRecord(req);
  if (!assignment) return notFound(res);
  const offer = await jdb.getCurrentOffer(assignment.id);
  if (!offer) return notFound(res);
  await jdb.saveOfferEmail(offer.id, { subject: null, body: null });
  res.json(await recordDetail(req, assignment));
}));

/**
 * THE ONE BUTTON. Create the Outlook draft: Email 1 as it stands, the current
 * letter attached. Nothing is sent — the Owner reads it in Outlook and presses
 * Send there.
 */
router.post('/api/onboarding/journey/records/:id/offer/email/draft', requirePermission('onboarding.assign'), safe(async (req, res) => {
  const assignment = await loadRecord(req);
  if (!assignment) return notFound(res);
  const offer = await jdb.getCurrentOffer(assignment.id);
  if (!offer || !['draft', 'approved', 'email_drafted'].includes(offer.status)) {
    return res.status(409).json({ error: 'This offer has already been sent.', code: 'already_sent' });
  }

  const reason = graphMail.unavailableReason(req.user);
  if (reason) return res.status(409).json({ error: reason, code: 'graph_unavailable' });
  const accessToken = await graphMail.getAccessToken(req.user);
  if (!accessToken) {
    return res.status(409).json({ error: 'Your Microsoft connection needs renewing. Reconnect Outlook in Settings and try again.', code: 'graph_no_token' });
  }

  // The body may arrive edited with this click, or have been saved earlier.
  const d = offerEmail.composeOfferEmail({ applicantName: assignment.applicant_name, positionTitle: assignment.job_title });
  const subject = str(req.body?.subject, 250) || offer.email_subject || d.subject;
  const body = (typeof req.body?.body === 'string' && req.body.body.trim()) ? req.body.body.slice(0, 20000) : (offer.email_body || d.body);

  let letterOut;
  try {
    letterOut = await currentLetter(assignment, offer);
  } catch (err) {
    log.error('letter of offer could not be composed for the draft', { error: err, assignmentId: assignment.id });
    return res.status(500).json({ error: 'The letter could not be generated.', code: 'generation_failed' });
  }
  if (letterOut.bytes.length > graphMail.MAX_SIMPLE_ATTACHMENT_BYTES) {
    return res.status(413).json({ error: 'The letter is too large to attach through Outlook.', code: 'attachment_too_large' });
  }

  const draft = await graphMail.createDraft({
    accessToken, to: assignment.applicant_email, subject, html: offerEmail.bodyToHtml(body),
    attachment: letterOut.bytes, attachmentName: letterOut.fileName, attachmentMime: offerDocx.DOCX_MIME,
  });

  await wdb.recordDispatch({
    organisationId: orgOf(req), assignmentId: assignment.id, kind: 'letter_of_offer',
    toEmail: assignment.applicant_email, subject, method: 'graph_draft',
    status: draft.ok ? 'draft_created' : 'failed', attachmentIncluded: true, attachmentBytes: letterOut.bytes.length,
    providerDraftId: draft.ok ? draft.id : null, webLink: draft.ok ? draft.webLink : null,
    errorReason: draft.ok ? null : draft.code, requestedBy: req.user.id,
  });

  if (!draft.ok) {
    await auditOnboarding(req, 'offer_email_draft_failed', {
      targetType: 'onboarding_offer', targetId: offer.id, metadata: { assignmentId: assignment.id, reason: draft.code },
    });
    return res.status(502).json({ error: draft.reason || 'Outlook did not accept the draft.', code: draft.code || 'graph_error' });
  }

  await jdb.markEmailDrafted(offer.id, {
    actorId: req.user.id, draftId: draft.id, webLink: draft.webLink, subject, body,
    templateVersion: letterOut.source === 'generated' ? offerDocx.TEMPLATE_VERSION : null,
  });
  await auditOnboarding(req, 'offer_email_drafted', {
    targetType: 'onboarding_offer', targetId: offer.id,
    metadata: { assignmentId: assignment.id, version: offer.version, letterSource: letterOut.source, attachmentBytes: letterOut.bytes.length },
  });
  res.status(201).json({
    ...(await recordDetail(req, assignment)),
    delivery: { status: 'draft_created', webLink: draft.webLink, message: 'A draft is waiting in your Outlook. Read it over and press Send, then mark it as sent here.' },
  });
}));

/** The Owner sent it from Outlook. Stage 1.5 — waiting for the signed copy. */
router.post('/api/onboarding/journey/records/:id/offer/mark-sent', requirePermission('onboarding.assign'), safe(async (req, res) => {
  const assignment = await loadRecord(req);
  if (!assignment) return notFound(res);
  const offer = await jdb.getCurrentOffer(assignment.id);
  if (!offer || !['email_drafted', 'draft', 'approved'].includes(offer.status)) {
    return res.status(409).json({ error: 'This offer is not waiting to be sent.', code: 'not_sendable' });
  }
  const updated = await jdb.markOfferSent(offer.id, { actorId: req.user.id, toEmail: assignment.applicant_email });
  await wdb.recordDispatch({
    organisationId: orgOf(req), assignmentId: assignment.id, kind: 'letter_of_offer',
    toEmail: assignment.applicant_email, subject: offer.email_subject || offerEmail.SUBJECT, method: 'manual',
    status: 'sent', attachmentIncluded: true, requestedBy: req.user.id,
  });
  await auditOnboarding(req, 'offer_marked_sent', {
    targetType: 'onboarding_offer', targetId: offer.id, metadata: { assignmentId: assignment.id, version: updated.version, hadOutlookDraft: !!offer.email_draft_id },
  });
  res.json(await recordDetail(req, assignment));
}));

router.post('/api/onboarding/journey/records/:id/offer/unmark-sent', requirePermission('onboarding.assign'), safe(async (req, res) => {
  const assignment = await loadRecord(req);
  if (!assignment) return notFound(res);
  const offer = await jdb.getCurrentOffer(assignment.id);
  if (!offer || offer.status !== 'sent') return res.status(409).json({ error: 'This offer is not marked as sent.', code: 'not_sent' });
  await jdb.unmarkOfferSent(offer.id);
  await auditOnboarding(req, 'offer_unmarked_sent', { targetType: 'onboarding_offer', targetId: offer.id, metadata: { assignmentId: assignment.id } });
  res.json(await recordDetail(req, assignment));
}));

// ── The signed letter ───────────────────────────────────────────────────────

router.post('/api/onboarding/journey/records/:id/offer/signed', requirePermission('onboarding.assign'), safe(async (req, res) => {
  const assignment = await loadRecord(req);
  if (!assignment) return notFound(res);
  const offer = await jdb.getCurrentOffer(assignment.id);
  if (!offer || !['sent', 'signed_received', 'email_drafted', 'draft', 'approved'].includes(offer.status)) {
    return res.status(409).json({ error: 'This offer is not waiting for a signed letter.', code: 'not_waiting' });
  }
  const up = readUpload(req.body, UPLOAD_MIMES);
  if (up.error) return res.status(400).json({ error: up.error });

  const doc = await jdb.storeOfferDocument({
    organisationId: orgOf(req), offerId: offer.id, assignmentId: assignment.id, kind: 'signed',
    fileName: up.fileName, fileMime: up.fileMime, buffer: up.buffer, uploadedBy: req.user.id,
  });
  await jdb.markSignedReceived(offer.id);
  await auditOnboarding(req, 'offer_signed_received', {
    targetType: 'onboarding_offer', targetId: offer.id,
    metadata: { assignmentId: assignment.id, documentId: doc.id, sha256: doc.file_sha256, bytes: doc.file_size_bytes },
  });
  // The stored signed letter IS the acceptance: Phase 1 settles and the
  // document pack is prepared without a separate verification click.
  const verified = await jdb.verifyOffer(offer.id, req.user.id);
  await odb.pool.query(
    `UPDATE onboarding_assignments SET offer_accepted_at = COALESCE(offer_accepted_at, NOW()), last_activity_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [assignment.id]
  );
  await auditOnboarding(req, 'offer_verified', {
    targetType: 'onboarding_offer', targetId: offer.id, metadata: { assignmentId: assignment.id, version: verified ? verified.version : offer.version, trigger: 'signed_upload' },
  });
  const prepared = await preparePackFor(req, assignment);
  res.status(201).json({ ...(await recordDetail(req, await odb.getAssignment(orgOf(req), assignment.id))), prepared });
}));

async function serveSigned(req, res, disposition) {
  const assignment = await loadRecord(req);
  if (!assignment) return notFound(res);
  const offer = await jdb.getCurrentOffer(assignment.id);
  const doc = offer ? await jdb.getLiveOfferDocument(offer.id, 'signed') : null;
  const bytes = doc ? await jdb.readOfferDocumentBytes(doc).catch(() => null) : null;
  if (!bytes) return res.status(404).json({ error: 'No signed letter has been stored.' });
  noStore(res);
  res.set('Content-Type', doc.file_mime);
  res.set('Content-Length', String(bytes.length));
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Content-Disposition', `${disposition}; filename="${encodeURIComponent(doc.file_name)}"`);
  res.send(bytes);
}
router.get('/api/onboarding/journey/records/:id/offer/signed/preview', requirePermission('onboarding.view'), safe((req, res) => serveSigned(req, res, 'inline')));
router.get('/api/onboarding/journey/records/:id/offer/signed/download', requirePermission('onboarding.view'), safe((req, res) => serveSigned(req, res, 'attachment')));

/**
 * VERIFY. The Owner has looked at the signed letter and it is right. Phase 1
 * is complete, and the release (Stage 2) runs by itself.
 */
router.post('/api/onboarding/journey/records/:id/offer/verify', requirePermission('onboarding.assign'), safe(async (req, res) => {
  const assignment = await loadRecord(req);
  if (!assignment) return notFound(res);
  const offer = await jdb.getCurrentOffer(assignment.id);
  if (!offer || offer.status !== 'signed_received') {
    return res.status(409).json({ error: 'Upload the signed letter before verifying it.', code: 'no_signed_letter' });
  }
  const verified = await jdb.verifyOffer(offer.id, req.user.id);
  await odb.pool.query(
    `UPDATE onboarding_assignments SET offer_accepted_at = COALESCE(offer_accepted_at, NOW()), last_activity_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [assignment.id]
  );
  await auditOnboarding(req, 'offer_verified', {
    targetType: 'onboarding_offer', targetId: offer.id, metadata: { assignmentId: assignment.id, version: verified.version },
  });
  // Phase 2 begins by itself: this person's document pack is derived from
  // the role, employment type and determinations, ready for the Owner to review.
  const prepared = await preparePackFor(req, assignment);
  res.json({ ...(await recordDetail(req, await odb.getAssignment(orgOf(req), assignment.id))), prepared });
}));

/** The candidate said no (by email, by phone). Recorded so the record does not sit in 1.5 forever. */
router.post('/api/onboarding/journey/records/:id/offer/decline', requirePermission('onboarding.assign'), safe(async (req, res) => {
  const assignment = await loadRecord(req);
  if (!assignment) return notFound(res);
  const offer = await jdb.getCurrentOffer(assignment.id);
  if (!offer || !['sent', 'signed_received', 'email_drafted'].includes(offer.status)) {
    return res.status(409).json({ error: 'There is no outstanding offer to decline.', code: 'not_open' });
  }
  const declined = await jdb.declineOffer(offer.id, req.body?.reason);
  await odb.pool.query(`UPDATE onboarding_assignments SET offer_declined_at = NOW(), last_activity_at = NOW() WHERE id = $1`, [assignment.id]);
  await auditOnboarding(req, 'offer_declined', {
    targetType: 'onboarding_offer', targetId: offer.id, metadata: { assignmentId: assignment.id, version: declined.version, hasReason: !!req.body?.reason },
  });
  res.json(await recordDetail(req, assignment));
}));

router.post('/api/onboarding/journey/records/:id/offer/withdraw', requirePermission('onboarding.assign'), safe(async (req, res) => {
  const assignment = await loadRecord(req);
  if (!assignment) return notFound(res);
  const current = await jdb.getCurrentOffer(assignment.id);
  if (!current || !['draft', 'approved', 'email_drafted', 'sent', 'signed_received'].includes(current.status)) {
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
  if (!current || !['draft', 'approved', 'email_drafted'].includes(current.status)) {
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
  const prepared = await preparePackFor(req, assignment);
  res.json({ ...(await recordDetail(req, await odb.getAssignment(orgOf(req), assignment.id))), prepared });
}));

/** Derive the document pack for a record whose offer has just settled. Never fatal. */
async function preparePackFor(req, assignment) {
  try {
    const out = await require('./onboarding-pack-routes')._internals.preparePack(assignment);
    await auditOnboarding(req, 'pack_prepared', { targetType: 'onboarding_assignment', targetId: assignment.id, metadata: { assignmentId: assignment.id, inserted: out.inserted, total: out.total } });
    return { status: 'prepared', ...out };
  } catch (err) {
    log.error('document pack could not be prepared', { error: err, assignmentId: assignment.id });
    return { status: 'failed' };
  }
}

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
    await require('./onboarding-returns-routes')._internals.syncProgress(req, await odb.getAssignment(orgOf(req), assignment.id));
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

module.exports = router;
module.exports._internals = { tryRelease, ensureInduction, maybeComplete, currentLetter, readUpload };
