'use strict';

/**
 * ONBOARDING JOURNEY — the three-stage projection. Pure: no I/O, no clock of
 * its own (callers pass `now`), so every rule here is unit-testable.
 *
 *   Stage 1  Letter of Offer              onboarding_offers
 *   Stage 2  Onboarding Documentation     onboarding_requirements + the 034/038 ladder
 *   Stage 3  Internal Induction & Access  onboarding_internal_tasks
 *
 * projectJourney() answers the six questions the Owner's screen asks of every
 * record — what stage, what is done, what is waiting on the employee, what
 * internal setup is open, what needs review, what is overdue — and one more:
 * WHAT HAPPENS NEXT, as a single line with a named actor. The portal manages
 * the run; the Owner is only asked to step in when `next.actor === 'admin'`.
 */

const STAGES = [
  { key: 'offer', number: 1, label: 'Letter of Offer' },
  { key: 'documentation', number: 2, label: 'Onboarding Documentation' },
  { key: 'induction', number: 3, label: 'Internal Setup & Induction' },
];

const OFFER_STATUSES = ['draft', 'email_drafted', 'sent', 'signed_received', 'accepted', 'declined', 'withdrawn', 'not_required'];
const TASK_STATUSES = ['pending', 'in_progress', 'done', 'skipped', 'failed'];

/** Days after sending with no signed letter back before the record is flagged. The email asks for 48 hours. */
const OFFER_CHASE_DAYS = 3;

const REQ_EMPLOYEE_OPEN = new Set(['not_started', 'in_progress', 'correction_required', 'expired']);
const REQ_NEEDS_REVIEW = new Set(['submitted', 'awaiting_verification']);
const REQ_DONE = new Set(['verified', 'complete', 'not_applicable']);

const STAGE2_STATUSES = new Set([
  'invite_sent', 'invite_accepted', 'in_progress', 'employee_actions_complete',
  'employer_review', 'corrections_required',
  // the paper round-trip (038) counts as documentation in progress
  'starter_pack_ready', 'starter_pack_sent', 'documents_received',
  'details_extracted', 'ready_for_account', 'account_created',
]);
const STAGE3_STATUSES = new Set(['ready_to_activate', 'activated', 'completed']);

const toDate = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const daysBetween = (a, b) => Math.floor((b.getTime() - a.getTime()) / 86400000);
const isOverdue = (dueAt, now) => { const d = toDate(dueAt); return !!d && d.getTime() < now.getTime(); };

const isEmployeeActor = (r) => r.actor === 'employee' || r.actor === 'both';
const isEmployerActor = (r) => r.actor === 'employer' || r.actor === 'both';

/**
 * The induction checklist for a role. Codes are stable: a task is upserted by
 * (assignment, code), so re-running generation never duplicates.
 *
 * `automation` names an act the portal performs itself when the task is run;
 * every other task is done by a named person and ticked off.
 */
function buildInductionTasks(assignment, { now = new Date() } = {}) {
  const start = toDate(assignment.start_date);
  const onStart = start ? new Date(start) : null;
  const afterStart = (days) => {
    if (!start) return null;
    const d = new Date(start); d.setDate(d.getDate() + days); return d;
  };
  const beforeStart = (days) => afterStart(-days);
  const soonest = (d) => (d && d.getTime() > now.getTime() ? d : afterStart(2) || null);

  const treating = assignment.is_treating_therapist === true
    || assignment.role_category === 'occupational_therapist';

  const tasks = [
    {
      code: 'portal_account', sortOrder: 5,
      title: 'Opal Portal account',
      description: 'The pre-employee account and employment profile, created with the document pack. Portal access (the staff role) is granted at activation.',
      automation: 'portal_account',
      dueAt: soonest(beforeStart(14)),
    },
    {
      code: 'portal_access', sortOrder: 10,
      title: 'Activate portal access',
      description: 'Turns the pre-employee account into a staff account with the agreed portal role. The portal does this itself.',
      automation: 'activate_portal_access',
      dueAt: soonest(beforeStart(1)),
    },
    {
      code: 'work_email', sortOrder: 20,
      title: 'Create work email and Microsoft 365 account',
      description: 'Mailbox, calendar and Teams access in the practice tenant. Record the address on the onboarding record once created.',
      dueAt: soonest(beforeStart(2)),
    },
    {
      code: 'payroll_setup', sortOrder: 30,
      title: 'Set up in payroll (Xero)',
      description: 'Employee record, pay template from the agreed rate and hours, tax and super details from the onboarding documentation.',
      dueAt: soonest(beforeStart(1)),
    },
    {
      code: 'systems_access', sortOrder: 40,
      title: treating ? 'Grant practice management and clinical system access' : 'Grant system access',
      description: treating
        ? 'Practice management system login, calendar publishing and case note access appropriate to the role.'
        : 'Logins for the systems the position uses.',
      dueAt: soonest(beforeStart(1)),
    },
    {
      code: 'equipment', sortOrder: 50,
      title: 'Issue equipment',
      description: 'Laptop, phone, ID badge, keys or access card as the position requires.',
      dueAt: onStart,
    },
    {
      code: 'induction_walkthrough', sortOrder: 60,
      title: 'Assign the portal induction walkthrough',
      description: 'The interactive induction in the Learning module, so the first day starts with a guided tour rather than a manual.',
      dueAt: onStart,
    },
  ];

  return tasks;
}

// ── Stage 1 ─────────────────────────────────────────────────────────────────

function projectOffer(assignment, offer, now) {
  const out = { state: 'active', summary: '', completedAt: null, items: [], next: null, substage: null };

  if (!offer) {
    out.summary = 'No letter of offer yet.';
    out.next = { actor: 'admin', action: 'edit_offer', label: 'Enter the offer details' };
    return out;
  }

  switch (offer.status) {
    case 'draft':
    case 'approved':
      out.summary = `Letter of offer v${offer.version} ready to preview — Email 1 not yet drafted.`;
      out.next = { actor: 'admin', action: 'prepare_email', label: 'Preview the letter, then prepare Email 1 and create the Outlook draft' };
      out.items.push({ kind: 'review', label: 'Letter of offer — preview and prepare Email 1', at: offer.created_at });
      break;
    case 'email_drafted':
      out.summary = 'Email 1 is waiting in Outlook with the letter attached.';
      out.next = { actor: 'admin', action: 'send_in_outlook', label: 'Open the draft in Outlook, send it, then mark it as sent' };
      out.items.push({ kind: 'review', label: 'Email 1 drafted in Outlook — send it and mark as sent', at: offer.email_drafted_at });
      break;
    case 'sent': {
      const sentAt = toDate(offer.email_sent_at || offer.sent_at);
      const stale = sentAt ? daysBetween(sentAt, now) >= OFFER_CHASE_DAYS : false;
      out.substage = 'waiting';
      out.summary = `Letter of offer sent${sentAt ? ` ${daysBetween(sentAt, now)} day(s) ago` : ''} — waiting for the signed copy.`;
      out.items.push({
        kind: 'employee', label: 'Sign and return the letter of offer',
        dueAt: sentAt ? new Date(sentAt.getTime() + 2 * 86400000) : null, overdue: stale,
        detail: stale ? 'No signed letter yet — consider following up' : '48 hours requested',
      });
      out.next = { actor: 'employee', action: null, label: 'Waiting for the signed letter of offer to come back' };
      break;
    }
    case 'signed_received':
      out.summary = 'The signed letter is in — waiting for you to verify it.';
      out.items.push({ kind: 'review', label: 'Verify the signed letter of offer', at: offer.signed_received_at });
      out.next = { actor: 'admin', action: 'verify_offer', label: 'Check the signed letter and verify it' };
      break;
    case 'accepted':
      out.state = 'complete';
      out.completedAt = offer.verified_at || offer.responded_at || null;
      out.summary = 'Signed letter of offer verified.';
      break;
    case 'not_required':
      out.state = 'complete';
      out.completedAt = offer.responded_at || offer.updated_at || null;
      out.summary = 'Letter of offer not required for this record.';
      break;
    case 'declined':
      out.state = 'blocked';
      out.summary = 'The offer was declined.';
      out.items.push({ kind: 'review', label: 'Offer declined — decide whether to revise or close', at: offer.responded_at });
      out.next = { actor: 'admin', action: 'reissue_offer', label: 'Offer declined — issue a revised offer or close the record' };
      break;
    case 'withdrawn':
      out.state = 'blocked';
      out.summary = 'The offer was withdrawn.';
      out.next = { actor: 'admin', action: 'reissue_offer', label: 'Offer withdrawn — issue a new offer or close the record' };
      break;
    default:
      out.summary = `Offer status: ${offer.status}`;
  }
  return out;
}

// ── Stage 2 ─────────────────────────────────────────────────────────────────

/**
 * Stage 2. Two models coexist underneath:
 *   • the DOCUMENT PACK (Phase 2): defaults derived, edited, ZIPped, drafted
 *     in Outlook, marked sent, returned and verified — `pack` carries it;
 *   • the 034 portal wizard, once a release has issued requirements.
 * The projection reads whichever the record is actually using.
 */
function projectDocumentation(assignment, requirements, now, stage1Complete, pack) {
  const out = { state: 'pending', summary: 'Starts when the signed letter of offer is verified.', completedAt: null, items: [], next: null };
  if (!stage1Complete) return out;

  const status = assignment.status;
  const p = pack || {};

  if (STAGE3_STATUSES.has(status) || (p.completedAt && ['documents_received', 'starter_pack_sent'].includes(status))) {
    out.state = 'complete';
    out.completedAt = p.completedAt || assignment.submitted_at || assignment.activated_at || null;
    out.summary = 'All onboarding documentation approved.';
    for (const r of requirements) {
      if (REQ_DONE.has(r.status)) out.items.push({ kind: 'done', label: r.title, at: r.completed_at || r.reviewed_at || null });
    }
    return out;
  }

  out.state = 'active';

  // ── The pack, before and after sending ──
  if (status === 'created' || status === 'starter_pack_ready' || status === 'starter_pack_sent' || status === 'documents_received') {
    const c = p.counts || {};
    if (status === 'created' && !p.prepared) {
      out.summary = 'Preparing the onboarding documentation pack.';
      out.next = { actor: 'system', action: 'prepare_pack', label: 'Preparing the document pack from the role and employment type' };
      return out;
    }
    if (status === 'created' && !p.draftId) {
      out.summary = `Document pack ready to review — ${c.included || 0} document(s), ${c.returns || 0} to come back.`;
      out.items.push({ kind: 'review', label: 'Review the document pack and prepare the onboarding email', at: assignment.pack_prepared_at });
      out.next = { actor: 'admin', action: 'review_pack', label: 'Review the document pack, then prepare the onboarding email' };
      if (c.missingFiles) out.items.push({ kind: 'review', label: `${c.missingFiles} document(s) in the pack have no file behind them`, at: null });
      return out;
    }
    if (status === 'created' || status === 'starter_pack_ready') {
      out.summary = 'The onboarding email is waiting in Outlook with the pack attached.';
      out.items.push({ kind: 'review', label: 'Onboarding email drafted in Outlook — send it and mark as sent', at: assignment.pack_email_drafted_at });
      out.next = { actor: 'admin', action: 'send_pack_in_outlook', label: 'Open the draft in Outlook, send it, then mark it as sent' };
      return out;
    }
    if (status === 'starter_pack_sent') {
      const due = toDate(assignment.pack_due_at);
      const overdue = isOverdue(assignment.pack_due_at, now);
      out.summary = `Onboarding documents sent${due ? ` — due ${due.toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Australia/Perth' })}` : ''}.`;
      out.items.push({
        kind: 'employee', label: `Complete and return the onboarding documentation (${c.returns || 0} item(s))`,
        dueAt: assignment.pack_due_at || null, overdue, detail: overdue ? 'Past the seven days requested' : null,
      });
      out.next = { actor: 'employee', action: null, label: 'Waiting for the completed onboarding documentation to come back' };
      return out;
    }
    // documents_received: read, reconciled and applied by the portal; what is
    // left is whatever Requires Your Attention holds, or the outstanding returns.
    const returnsOpen = (c.returns || 0) - (c.received || 0) - (c.verified || 0);
    out.summary = `Returned documents are in — ${c.verified || 0} verified, ${c.received || 0} received, ${Math.max(0, returnsOpen)} still to come.`;
    if (returnsOpen > 0) {
      out.items.push({ kind: 'employee', label: `${returnsOpen} document(s) still to be returned`, dueAt: assignment.pack_due_at || null, overdue: isOverdue(assignment.pack_due_at, now) });
    }
    out.next = { actor: 'admin', action: 'review_returns', label: 'Work through Requires Your Attention, then finish the documentation' };
    return out;
  }

  if (status === 'invite_sent' || status === 'account_created') {
    out.summary = 'Invitation sent — waiting for the employee to sign in and start.';
    out.items.push({
      kind: 'employee', label: 'Accept the onboarding invitation and set a password',
      dueAt: assignment.due_at || null, overdue: isOverdue(assignment.due_at, now),
    });
    out.next = { actor: 'employee', action: null, label: 'Waiting for the employee to accept the invitation' };
    return out;
  }

  if (['details_extracted', 'ready_for_account'].includes(status)) {
    out.summary = `Paper round-trip in progress (${status.replace(/_/g, ' ')}).`;
    out.next = { actor: 'admin', action: 'open_record', label: 'Continue the paper round-trip on the record' };
    return out;
  }

  let employeeOpen = 0; let review = 0; let employerOpen = 0; let done = 0;
  for (const r of requirements) {
    if (REQ_DONE.has(r.status)) {
      done += 1;
      out.items.push({ kind: 'done', label: r.title, at: r.completed_at || r.reviewed_at || null });
      continue;
    }
    if (REQ_NEEDS_REVIEW.has(r.status)) {
      review += 1;
      out.items.push({ kind: 'review', label: `${r.title} — submitted, needs ${r.requires_employer_verification ? 'verification' : 'review'}`, at: r.submitted_at || null, requirementId: r.id });
      continue;
    }
    if (isEmployeeActor(r) && REQ_EMPLOYEE_OPEN.has(r.status)) {
      employeeOpen += 1;
      out.items.push({
        kind: 'employee',
        label: r.status === 'correction_required' ? `${r.title} — correction requested` : r.title,
        dueAt: r.due_at || null, overdue: isOverdue(r.due_at, now), requirementId: r.id,
      });
      continue;
    }
    if (isEmployerActor(r)) {
      employerOpen += 1;
      out.items.push({
        kind: 'internal', label: r.title, dueAt: r.due_at || null,
        overdue: isOverdue(r.due_at, now), requirementId: r.id,
      });
    }
  }

  const total = requirements.length;
  if (status === 'employee_actions_complete' || status === 'employer_review') {
    out.summary = `Employee has finished their part — ${review + employerOpen} item(s) to review or verify.`;
    out.next = { actor: 'admin', action: 'review', label: `Review ${review + employerOpen} submitted item(s)` };
  } else if (status === 'corrections_required') {
    out.summary = 'Corrections requested — waiting on the employee.';
    out.next = { actor: 'employee', action: null, label: 'Waiting for the employee to supply corrections' };
  } else if (review > 0) {
    out.summary = `${done} of ${total} complete — ${review} awaiting your review.`;
    out.next = { actor: 'admin', action: 'review', label: `Review ${review} submitted item(s)` };
  } else {
    out.summary = `${done} of ${total} complete — ${employeeOpen} waiting on the employee.`;
    out.next = { actor: 'employee', action: null, label: 'Waiting for the employee to complete their documentation' };
  }
  return out;
}

// ── Stage 3 ─────────────────────────────────────────────────────────────────

function projectInduction(assignment, tasks, now, stage2Complete, induction) {
  const out = { state: 'pending', summary: 'Starts when the documentation is approved.', completedAt: null, items: [], next: null };
  const I = induction || {};
  // ── The induction PACK (Phase 3) once it has been sent ──
  if (I.sentAt) {
    const tr = I.tracking || { total: 0, done: 0, required: 0, requiredDone: 0 };
    if (I.completedAt || assignment.status === 'completed') {
      out.state = 'complete'; out.completedAt = I.completedAt || assignment.completed_at || null;
      out.summary = 'Induction complete. Employee active and ready for commencement.';
      return out;
    }
    out.state = 'active';
    const overdue = isOverdue(I.dueAt, now);
    out.summary = `Internal Induction Sent — due ${I.dueAt ? new Date(I.dueAt).toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Australia/Perth' }) : ''}. ${tr.done} of ${tr.total} induction items complete.`;
    out.items.push({ kind: 'employee', label: `Complete the induction items (${Math.max(0, tr.total - tr.done)} remaining)`, dueAt: I.dueAt || null, overdue, detail: overdue ? 'Past the seven days requested' : null });
    out.next = { actor: 'employee', action: null, label: 'Waiting for the employee to complete the induction items' };
    return out;
  }
  // Internal setup runs ALONGSIDE the documentation: once tasks exist the
  // stage is live, but it only becomes the record's current stage after
  // the documentation is done.
  if (!stage2Complete && !(tasks && tasks.length)) return out;
  if (!stage2Complete) {
    const sorted = [...tasks].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    for (const t of sorted) {
      if (t.status === 'done' || t.status === 'skipped') out.items.push({ kind: 'done', label: t.title, at: t.completed_at || null, taskCode: t.code });
      else out.items.push({ kind: 'internal', label: t.status === 'failed' ? `${t.title} — failed` : t.title, dueAt: t.due_at || null, overdue: isOverdue(t.due_at, now), assigneeUserId: t.assignee_user_id || null, assigneeName: t.assignee_name || null, taskCode: t.code, automation: t.automation || null, status: t.status });
    }
    const done = sorted.filter((t) => t.status === 'done' || t.status === 'skipped').length;
    out.state = 'parallel';
    const R = I.readiness;
    out.summary = R && !R.ready
      ? `Internal setup under way (${done} of ${sorted.length} ready). Phase 3 is not ready because: ${R.blockers.slice(0, 3).join('; ')}${R.blockers.length > 3 ? '…' : ''}`
      : `Internal setup under way alongside the documentation — ${done} of ${sorted.length} ready.`;
    return out;
  }

  const status = assignment.status;
  const sorted = [...tasks].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const open = sorted.filter((t) => t.status === 'pending' || t.status === 'in_progress');
  const failed = sorted.filter((t) => t.status === 'failed');
  const finished = sorted.filter((t) => t.status === 'done' || t.status === 'skipped');

  for (const t of finished) out.items.push({ kind: 'done', label: t.title, at: t.completed_at || null, taskCode: t.code });
  // Failed tasks are raised by Requires Your Attention (account set-up failed); here they stay in the internal list.
  for (const t of [...open, ...failed]) {
    out.items.push({
      kind: 'internal', label: t.title, dueAt: t.due_at || null, overdue: isOverdue(t.due_at, now),
      assigneeUserId: t.assignee_user_id || null, assigneeName: t.assignee_name || null,
      taskCode: t.code, automation: t.automation || null, status: t.status,
    });
  }

  if (status === 'completed' || (status === 'activated' && tasks.length > 0 && open.length === 0 && failed.length === 0)) {
    out.state = 'complete';
    out.completedAt = assignment.completed_at || null;
    out.summary = 'Induction complete. The employee is active.';
    return out;
  }

  out.state = 'active';
  if (!tasks.length) {
    out.summary = 'Ready for induction — the checklist has not been generated yet.';
    out.next = { actor: 'system', action: 'generate_tasks', label: 'Generating the induction checklist' };
    return out;
  }

  // Phase 3 pack not yet sent: the readiness check decides the next line.
  // (A record on the portal-wizard path — ready_to_activate — keeps the
  // activation flow below instead.)
  if (I.prepared !== undefined && !STAGE3_STATUSES.has(status)) {
    const R = I.readiness;
    if (R && !R.ready) {
      out.summary = `Phase 3 is not ready because: ${R.blockers.slice(0, 3).join('; ')}${R.blockers.length > 3 ? '…' : ''}`;
      out.items.push({ kind: 'review', label: `Phase 3 is not ready: ${R.blockers[0]}`, at: null });
      out.next = { actor: 'admin', action: 'unblock_induction', label: `Phase 3 is not ready — ${R.blockers[0]}` };
      return out;
    }
    if (I.draftId) {
      out.summary = 'The induction email is waiting in Outlook with the pack attached.';
      out.next = { actor: 'admin', action: 'send_induction_in_outlook', label: 'Open the induction draft in Outlook, send it, then mark it as sent' };
      return out;
    }
    out.summary = 'Ready to send the Internal Induction Pack.';
    out.next = { actor: 'admin', action: 'prepare_induction', label: 'Review the induction pack and prepare the Phase 3 email' };
    return out;
  }

  const portal = sorted.find((t) => t.code === 'portal_access');
  if (portal && portal.status !== 'done' && portal.status !== 'skipped' && status === 'ready_to_activate') {
    out.summary = `${finished.length} of ${tasks.length} induction tasks done — portal access not yet activated.`;
    out.next = { actor: 'admin', action: 'activate', label: 'Activate portal access', taskCode: 'portal_access' };
    return out;
  }

  if (failed.length) {
    out.summary = `${failed.length} induction task(s) failed.`;
    out.next = { actor: 'admin', action: 'task', label: `Resolve: ${failed[0].title}`, taskCode: failed[0].code };
    return out;
  }

  const first = open[0];
  out.summary = `${finished.length} of ${tasks.length} induction tasks done.`;
  out.next = {
    actor: 'admin', action: 'task', taskCode: first.code,
    label: `${first.title}${first.assignee_name ? ` (${first.assignee_name})` : ''}`,
  };
  return out;
}

// ── The projection ──────────────────────────────────────────────────────────

/**
 * @param {object} p
 * @param {object} p.assignment   an onboarding_assignments row (with joins)
 * @param {object|null} p.offer   the live or latest onboarding_offers row
 * @param {object[]} p.requirements onboarding_requirements rows
 * @param {object[]} p.tasks      onboarding_internal_tasks rows (assignee_name joined)
 * @param {object|null} p.pack    { prepared, draftId, counts:{included,returns,missingFiles} } for the document pack
 * @param {Date} p.now
 */
function projectJourney({ assignment, offer = null, requirements = [], tasks = [], pack = null, attention = [], induction = null, payroll = null, now = new Date() }) {
  const closed = assignment.status === 'cancelled' || assignment.status === 'archived';

  const s1 = projectOffer(assignment, offer, now);
  const s2 = projectDocumentation(assignment, requirements, now, s1.state === 'complete', pack);
  const s3 = projectInduction(assignment, tasks, now, s2.state === 'complete', induction);

  const stages = [
    { ...STAGES[0], ...pick(s1) },
    { ...STAGES[1], ...pick(s2) },
    { ...STAGES[2], ...pick(s3) },
  ];

  let current;
  if (closed) current = { key: 'closed', number: 0, label: assignment.status === 'cancelled' ? 'Cancelled' : 'Archived' };
  else if (s3.state === 'complete') current = { key: 'complete', number: 4, label: 'Complete' };
  else if (s3.state === 'active') current = STAGES[2];
  else if (s2.state === 'active') current = STAGES[1];
  else if (s1.substage === 'waiting') current = { ...STAGES[0], number: 1.5, label: 'Awaiting signed offer' };
  else current = STAGES[0];

  const all = [...s1.items, ...s2.items, ...s3.items];
  const completed = all.filter((i) => i.kind === 'done');
  const waitingOnEmployee = all.filter((i) => i.kind === 'employee');
  const internalOpen = all.filter((i) => i.kind === 'internal');
  // Requires Your Attention: the exceptions the automation could not settle,
  // plus the stage-level asks (approve the letter, send the draft).
  const adminReview = [
    ...(attention || []).map((a) => ({ kind: 'review', label: a.title, detail: a.detail, severity: a.severity, action: a.action, attentionKind: a.kind, options: a.options })),
    ...all.filter((i) => i.kind === 'review'),
  ];
  const overdue = all.filter((i) => i.overdue === true);

  // The commencement date itself is a deadline for the whole run.
  const start = toDate(assignment.start_date);
  if (!closed && start && current.key !== 'complete' && start.getTime() < now.getTime()) {
    overdue.push({ kind: 'record', label: 'Commencement date has passed with onboarding incomplete', dueAt: assignment.start_date, overdue: true });
  }

  let next;
  if (closed) next = { actor: 'none', action: null, label: `Record ${assignment.status}` };
  else if (current.key === 'complete') next = { actor: 'none', action: null, label: 'Onboarding complete — nothing further to do' };
  else next = (s3.state === 'active' ? s3.next : s2.state === 'active' ? s2.next : s1.next)
    || { actor: 'system', action: null, label: 'In progress' };

  const daysToStart = start ? daysBetween(now, start) : null;

  // The one-screen summary: six lines, each a state and a count.
  const p2 = (pack && pack.tracking) || null;
  const setupTasks = (tasks || []).filter((t) => t.code !== 'portal_access');
  const setupReady = setupTasks.filter((t) => t.status === 'done' || t.status === 'skipped').length;
  const I = induction || {};
  const summary = {
    offer: { state: s1.state === 'complete' ? 'complete' : s1.state === 'blocked' ? 'blocked' : s1.substage === 'waiting' ? 'waiting' : 'in_progress', label: s1.state === 'complete' ? 'Complete' : s1.substage === 'waiting' ? 'Awaiting signed offer' : s1.state === 'blocked' ? 'Declined / withdrawn' : 'In progress' },
    documentation: {
      state: s2.state, done: p2 ? p2.done : 0, total: p2 ? p2.total : 0,
      label: s2.state === 'complete' ? 'Complete' : s2.state === 'pending' ? 'Not yet started' : p2 && p2.total ? `${p2.done} of ${p2.total} items complete` : (pack && pack.sentAt ? 'Awaiting employee' : 'Preparing the pack'),
      detail: s2.state === 'active' ? (s2.next && s2.next.actor === 'employee' ? 'Awaiting employee' : s2.next ? s2.next.label : '') : '',
    },
    setup: { ready: setupReady, total: setupTasks.length, label: setupTasks.length ? `${setupReady} of ${setupTasks.length} items ready` : 'Not yet started' },
    payroll: { state: payroll ? payroll.status : 'unknown', label: payroll ? payroll.label : '—' },
    induction: {
      state: s3.state, done: I.tracking ? I.tracking.done : 0, total: I.tracking ? I.tracking.total : 0,
      label: I.completedAt ? 'Complete' : I.sentAt ? `Sent — ${I.tracking ? `${I.tracking.done} of ${I.tracking.total} complete` : 'tracking'}` : I.draftId ? 'Draft in Outlook' : s2.state !== 'complete' ? 'Not yet sent' : I.readiness && !I.readiness.ready ? 'Not ready' : 'Ready to send',
    },
    attention: (attention || []).length,
    employee: current.key === 'complete' ? 'Active — ready for commencement' : null,
  };

  return {
    stage: current,
    summary,
    stages,
    next,
    completed,
    waitingOnEmployee,
    internalOpen,
    adminReview,
    overdue,
    daysToStart,
    closed,
    counts: {
      completed: completed.length,
      waitingOnEmployee: waitingOnEmployee.length,
      internalOpen: internalOpen.length,
      adminReview: adminReview.length,
      overdue: overdue.length,
    },
    // Higher = needs the Owner sooner. Used to sort the board.
    attention: (closed || current.key === 'complete') ? 0
      : overdue.length * 100 + adminReview.length * 10 + (next.actor === 'admin' ? 5 : 0),
  };
}

function pick(s) {
  return { state: s.state, summary: s.summary, completedAt: s.completedAt };
}

module.exports = {
  STAGES,
  OFFER_STATUSES,
  TASK_STATUSES,
  OFFER_CHASE_DAYS,
  buildInductionTasks,
  projectJourney,
};
