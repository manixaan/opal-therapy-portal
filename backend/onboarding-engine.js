'use strict';

/**
 * ONBOARDING ENGINE — pure logic. No database, no express, no I/O.
 *
 * Everything here is a function of its arguments, so the rules that decide
 * which requirements a person receives, whether they may be activated, and
 * what may be shown about their bank account are unit-testable in isolation
 * and cannot drift between the API and the UI.
 *
 * THE THREE THINGS THIS FILE OWNS
 * ───────────────────────────────
 *  1. APPLICABILITY. A data-driven rule language evaluated against the facts
 *     frozen on an assignment. Rules live in the database as JSONB and are
 *     evaluated here — never inside a frontend component, where they could not
 *     be enforced.
 *
 *  2. RESOLUTION. Flattening a package's inheritance chain (base + overlays)
 *     into one ordered requirement list, applying per-package overrides, and
 *     snapshotting each template so the issued package is replayable forever.
 *
 *  3. PROGRESS + ACTIVATION. Two independent meters (employee vs employer) and
 *     a strict activation gate. Optional requirements never block activation;
 *     a waiver relaxes an Opal requirement but can never fabricate a statutory
 *     clearance.
 *
 * MASKING. maskBsb / maskAccountNumber / maskTfn produce the ONLY renderable
 * forms of those values. Nothing else in the codebase may format them.
 */

// ═════════════════════════════════════════════════════════════════════════════
//  Vocabularies — single source of truth, imported by routes and tests
// ═════════════════════════════════════════════════════════════════════════════

const SECTIONS = [
  'welcome_employment',
  'personal_details',
  'payroll_tax_super',
  'identity',
  'professional',
  'screening',
  'ndis',
  'policies',
  'training',
  'employer_compliance',
];

/** Employee-facing section labels, in the order the employee walks them. */
const SECTION_LABELS = {
  welcome_employment: 'Welcome & Employment',
  personal_details: 'Personal Details',
  payroll_tax_super: 'Payroll, Tax & Super',
  identity: 'Identity',
  professional: 'Professional Credentials',
  screening: 'Screening',
  ndis: 'NDIS Essentials',
  policies: 'Opal Policies',
  training: 'Training',
  employer_compliance: 'Employer Compliance',
};

const CLASSIFICATIONS = [
  'OFFICIAL_DOCUMENT',
  'OFFICIAL_LIVE_SOURCE',
  'OPAL_POLICY',
  'OPAL_FORM',
  'EMPLOYEE_UPLOAD',
  'EMPLOYER_VERIFICATION',
  'TRAINING_MODULE',
  'ACKNOWLEDGEMENT',
  'EMPLOYER_ONLY_COMPLIANCE',
];

const HANDLERS = [
  'info',
  'document_ack',
  'form',
  'upload',
  'credential',
  'training',
  'live_source',
  'employer_task',
];

const REQUIREMENT_STATUSES = [
  'not_started',
  'in_progress',
  'submitted',
  'awaiting_verification',
  'correction_required',
  'verified',
  'complete',
  'not_applicable',
  'expired',
];

/**
 * The assignment lifecycle, in order.
 *
 * The six states between `created` and `invite_sent` are the paper round-trip
 * added in migration 038: the starter pack goes out, the completed forms come
 * back, their contents are read and reviewed, and only then is an account
 * created. They are OPTIONAL — an Owner who does not need the round-trip goes
 * straight from `created` to an invitation, which is the original flow.
 */
const ASSIGNMENT_STATUSES = [
  'created',
  'starter_pack_ready',
  'starter_pack_sent',
  'documents_received',
  'details_extracted',
  'ready_for_account',
  'account_created',
  'invite_sent',
  'invite_accepted',
  'in_progress',
  'employee_actions_complete',
  'employer_review',
  'corrections_required',
  'ready_to_activate',
  'activated',
  'completed',
  'cancelled',
  'archived',
];

/**
 * Statuses that precede the portal account, and which recomputeAssignment must
 * therefore leave alone. See deriveAssignmentStatus.
 */
const PRE_RELEASE_STATUSES = new Set([
  'starter_pack_ready', 'starter_pack_sent', 'documents_received',
  'details_extracted', 'ready_for_account', 'account_created',
]);

const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'casual', 'fixed_term', 'contractor'];

/** Statuses in which a requirement counts as DONE for its actor's meter. */
const EMPLOYEE_DONE_STATUSES = new Set([
  'submitted', 'awaiting_verification', 'verified', 'complete', 'not_applicable',
]);
const EMPLOYER_DONE_STATUSES = new Set(['verified', 'complete', 'not_applicable']);

/** Statuses that satisfy an activation-blocking requirement. */
const BLOCKING_SATISFIED_STATUSES = new Set(['verified', 'complete', 'not_applicable']);

/** Form keys the portal knows how to render and validate. */
const FORM_KEYS = [
  'welcome',
  'personal_details',
  'emergency_contact',
  'bank_details',
  'tax_setup',
  'super_setup',
  'identity',
  'right_to_work',
  'vehicle_details',
];

// ═════════════════════════════════════════════════════════════════════════════
//  1. APPLICABILITY RULES
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Facts a rule may reference. Anything outside this list is a rule authoring
 * error and evaluates to FALSE rather than silently matching — an unknown fact
 * must never accidentally hand someone a requirement set they should not have,
 * nor silently drop one they should.
 */
const KNOWN_FACTS = [
  'employment_type',
  'role_category',
  'proposed_role',
  'is_treating_therapist',
  'child_related_work',
  'ndis_risk_assessed_role',
  'mobile_community_role',
  'uses_own_vehicle',
  'provider_status',
  'works_with_participants',
  'new_graduate',
  'requires_worker_screening',
  'work_rights_check_required',
];

const OPERATORS = ['eq', 'neq', 'in', 'not_in', 'is_true', 'is_false', 'exists'];

function normaliseFactValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value;
  return String(value).trim().toLowerCase();
}

/**
 * Evaluate one leaf condition.
 * Unknown fact or unknown operator → false (fail closed, never fail open).
 */
function evaluateCondition(cond, facts) {
  if (!cond || typeof cond !== 'object') return false;
  const fact = String(cond.fact || '');
  if (!KNOWN_FACTS.includes(fact)) return false;

  const op = String(cond.op || 'eq');
  if (!OPERATORS.includes(op)) return false;

  const actual = normaliseFactValue(facts ? facts[fact] : undefined);

  switch (op) {
    case 'exists':
      return actual !== null && actual !== '';
    case 'is_true':
      return actual === true || actual === 'true' || actual === 'yes';
    case 'is_false':
      return actual === false || actual === 'false' || actual === 'no' || actual === null;
    case 'eq':
      return actual === normaliseFactValue(cond.value);
    case 'neq':
      return actual !== normaliseFactValue(cond.value);
    case 'in':
      return Array.isArray(cond.value) && cond.value.map(normaliseFactValue).includes(actual);
    case 'not_in':
      return Array.isArray(cond.value) && !cond.value.map(normaliseFactValue).includes(actual);
    default:
      return false;
  }
}

/**
 * Evaluate a rule tree.
 *
 *   {}                                        → always applies
 *   { all: [c, …] }                           → every child must pass
 *   { any: [c, …] }                           → at least one child passes
 *   { not: rule }                             → negation
 *   { fact, op, value }                       → a bare leaf condition
 *
 * Nesting is allowed to a bounded depth; beyond it the rule is treated as
 * unsatisfied rather than recursing without limit on attacker-supplied JSON.
 */
function evaluateRule(rule, facts, depth = 0) {
  if (depth > 8) return false;
  if (rule === null || rule === undefined) return true;
  if (typeof rule !== 'object' || Array.isArray(rule)) return false;

  const keys = Object.keys(rule);
  if (keys.length === 0) return true; // {} = unconditional

  if (Array.isArray(rule.all)) {
    return rule.all.every((r) => evaluateRule(r, facts, depth + 1));
  }
  if (Array.isArray(rule.any)) {
    return rule.any.length > 0 && rule.any.some((r) => evaluateRule(r, facts, depth + 1));
  }
  if (rule.not !== undefined) {
    return !evaluateRule(rule.not, facts, depth + 1);
  }
  if (rule.fact !== undefined) {
    return evaluateCondition(rule, facts);
  }
  return false;
}

/** Human-readable rendering of a rule, for the package builder and audit. */
function describeRule(rule, depth = 0) {
  if (!rule || typeof rule !== 'object' || Object.keys(rule).length === 0) return 'Always';
  if (depth > 8) return '…';
  if (Array.isArray(rule.all)) return rule.all.map((r) => describeRule(r, depth + 1)).join(' AND ');
  if (Array.isArray(rule.any)) return rule.any.map((r) => describeRule(r, depth + 1)).join(' OR ');
  if (rule.not !== undefined) return `NOT (${describeRule(rule.not, depth + 1)})`;
  if (rule.fact !== undefined) {
    const f = String(rule.fact);
    switch (rule.op) {
      case 'is_true': return `${f} is yes`;
      case 'is_false': return `${f} is no`;
      case 'exists': return `${f} is set`;
      case 'in': return `${f} is one of ${(rule.value || []).join(', ')}`;
      case 'not_in': return `${f} is not one of ${(rule.value || []).join(', ')}`;
      case 'neq': return `${f} is not ${rule.value}`;
      default: return `${f} is ${rule.value}`;
    }
  }
  return 'Always';
}

/**
 * Build the fact set for an assignment from its stored columns plus the
 * organisation's current configuration.
 *
 * `works_with_participants` and `requires_worker_screening` are DERIVED, and
 * deliberately conservative: an undetermined risk-assessed role still triggers
 * the screening requirement, because "we have not decided yet" must surface as
 * work to do, not as an exemption.
 */
function buildFacts(assignment, orgConfig = {}) {
  const a = assignment || {};
  const employmentType = String(a.employment_type || '').toLowerCase();
  const roleCategory = String(a.role_category || '').toLowerCase();
  const childRelated = String(a.child_related_work || 'assessment_required').toLowerCase();
  const riskAssessed = String(a.ndis_risk_assessed_role || 'requires_determination').toLowerCase();
  const providerStatus = String(orgConfig.ndisProviderStatus || 'unregistered').toLowerCase();

  const treating = a.is_treating_therapist === true || roleCategory === 'occupational_therapist';

  return {
    employment_type: employmentType,
    role_category: roleCategory,
    proposed_role: String(a.proposed_role || '').toLowerCase(),
    is_treating_therapist: treating,
    child_related_work: childRelated,
    ndis_risk_assessed_role: riskAssessed,
    mobile_community_role: a.mobile_community_role === true,
    uses_own_vehicle: a.uses_own_vehicle === true,
    provider_status: providerStatus,
    new_graduate: a.new_graduate === true,
    works_with_participants: treating || riskAssessed === 'yes',
    // Screening is required when the role is risk-assessed, and also while the
    // determination is outstanding. Never silently "no".
    requires_worker_screening: riskAssessed === 'yes' || riskAssessed === 'requires_determination',
    work_rights_check_required: a.work_rights_check_required === true,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
//  2. PACKAGE RESOLUTION
// ═════════════════════════════════════════════════════════════════════════════

const SECTION_ORDER = SECTIONS.reduce((acc, s, i) => { acc[s] = i; return acc; }, {});

/**
 * Flatten a package's inheritance chain into one ordered composition list.
 *
 * @param {object}   pkg        the package being resolved
 * @param {Function} lookup     code → { package, requirements: [row…] }
 * @param {object[]} ownRows    this package's own composition rows
 * @returns {{ rows: object[], chain: string[], warnings: string[] }}
 *
 * Later entries win: a package may re-declare an inherited requirement to
 * change mandatory / blocks_activation / condition. Cycles are detected and
 * reported rather than followed.
 */
function resolveComposition(pkg, ownRows, lookup) {
  const warnings = [];
  const chain = [];
  const byTemplate = new Map();
  const seen = new Set();

  function walk(code, depth) {
    if (depth > 6) { warnings.push(`Inheritance too deep at "${code}"`); return; }
    if (seen.has(code)) { warnings.push(`Circular or repeated inheritance: "${code}"`); return; }
    seen.add(code);

    const parent = lookup(code);
    if (!parent) { warnings.push(`Package "${code}" not found — skipped`); return; }

    const parentExtends = Array.isArray(parent.package.extends_codes)
      ? parent.package.extends_codes
      : [];
    for (const c of parentExtends) walk(String(c), depth + 1);

    chain.push(code);
    for (const row of parent.requirements || []) {
      byTemplate.set(String(row.template_id), { ...row, inherited_from: code });
    }
  }

  const extendsCodes = Array.isArray(pkg.extends_codes) ? pkg.extends_codes : [];
  for (const c of extendsCodes) walk(String(c), 1);

  chain.push(pkg.code);
  for (const row of ownRows || []) {
    byTemplate.set(String(row.template_id), { ...row, inherited_from: null });
  }

  const rows = [...byTemplate.values()].sort((a, b) => {
    const sa = SECTION_ORDER[a.section] ?? 99;
    const sb = SECTION_ORDER[b.section] ?? 99;
    if (sa !== sb) return sa - sb;
    const oa = Number(a.sort_order ?? 0);
    const ob = Number(b.sort_order ?? 0);
    if (oa !== ob) return oa - ob;
    return String(a.title || '').localeCompare(String(b.title || ''));
  });

  return { rows, chain, warnings };
}

/**
 * Freeze one resolved composition row + its template into the immutable form
 * stored on a package version and copied onto each issued requirement.
 *
 * Everything the employee will ever see is captured here. Later edits to the
 * template, the document or the compliance record cannot alter it.
 */
function snapshotRequirement(row, template, extras = {}) {
  const t = template || {};
  const pick = (rowVal, tplVal) => (rowVal === null || rowVal === undefined ? tplVal : rowVal);

  return {
    template_id: t.id || row.template_id || null,
    template_code: t.code || row.template_code,
    template_version: Number(t.version || 1),
    title: t.title || row.title,
    summary: t.summary || null,
    instructions: t.instructions || null,
    section: t.section || row.section,
    classification: t.classification || row.classification,
    handler: t.handler || row.handler,
    actor: t.actor || 'employee',
    requires_employer_verification: t.requires_employer_verification === true,
    sensitivity: t.sensitivity || 'standard',
    form_key: t.form_key || null,
    credential_type: t.credential_type || null,
    document_id: t.document_id || null,
    document_version_id: extras.documentVersionId || null,
    document_version: extras.documentVersion || null,
    document_code: extras.documentCode || null,
    learning_workflow_id: t.learning_workflow_id || null,
    external_url: t.external_url || null,
    compliance_requirement_id: t.compliance_requirement_id || null,
    compliance: extras.compliance || null,
    config: t.config || {},
    expiry_rule: t.expiry_rule || {},
    applicability: pick(row.condition, t.applicability) || {},
    mandatory: pick(row.mandatory, t.default_mandatory) !== false,
    blocks_activation: pick(row.blocks_activation, t.default_blocks_activation) === true,
    due_offset_days: pick(row.due_offset_days, t.default_due_offset_days),
    sort_order: Number(row.sort_order ?? t.sort_hint ?? 0),
    inherited_from: row.inherited_from || null,
  };
}

/**
 * Select the requirements from a package version that apply to these facts.
 * Non-applicable requirements are simply not issued — they are not created as
 * "not applicable" rows, because an employee should never be shown a list of
 * things that were never asked of them.
 */
function selectApplicable(versionContent, facts) {
  const items = Array.isArray(versionContent?.requirements) ? versionContent.requirements : [];
  const applied = [];
  const skipped = [];
  for (const item of items) {
    if (evaluateRule(item.applicability, facts)) applied.push(item);
    else skipped.push({ code: item.template_code, title: item.title, rule: describeRule(item.applicability) });
  }
  return { applied, skipped };
}

/** Due date for one requirement: assignment due date, or start_date + offset. */
function computeDueAt(item, { startDate, assignmentDueAt, releasedAt }) {
  const offset = item?.due_offset_days;
  if (offset === null || offset === undefined || Number.isNaN(Number(offset))) {
    return assignmentDueAt || null;
  }
  const anchor = startDate ? new Date(startDate) : (releasedAt ? new Date(releasedAt) : new Date());
  if (Number.isNaN(anchor.getTime())) return assignmentDueAt || null;
  const due = new Date(anchor.getTime());
  due.setUTCDate(due.getUTCDate() + Number(offset));
  return due;
}

// ═════════════════════════════════════════════════════════════════════════════
//  3. PROGRESS, STATUS AND ACTIVATION
// ═════════════════════════════════════════════════════════════════════════════

/** Does this requirement place work on the EMPLOYEE? */
function isEmployeeItem(r) {
  return r.actor === 'employee' || r.actor === 'both';
}

/** Does this requirement place work on the EMPLOYER? */
function isEmployerItem(r) {
  return r.actor === 'employer' || r.actor === 'both' || r.requires_employer_verification === true;
}

/**
 * Two independent meters.
 *
 * This separation is the whole point of the review stage: the employee's meter
 * must reach 100% on their own actions alone, and must not be dragged down by
 * verification work that is not theirs to do.
 */
function computeProgress(requirements) {
  const rows = Array.isArray(requirements) ? requirements : [];
  let employeeTotal = 0, employeeDone = 0;
  let employerTotal = 0, employerDone = 0;
  let blockingTotal = 0, blockingDone = 0;
  let correctionsOpen = 0;
  let expired = 0;

  for (const r of rows) {
    const status = String(r.status || 'not_started');
    if (status === 'correction_required') correctionsOpen += 1;
    if (status === 'expired') expired += 1;

    if (isEmployeeItem(r) && status !== 'not_applicable') {
      employeeTotal += 1;
      if (EMPLOYEE_DONE_STATUSES.has(status)) employeeDone += 1;
    } else if (isEmployeeItem(r) && status === 'not_applicable') {
      employeeTotal += 1;
      employeeDone += 1;
    }

    if (isEmployerItem(r)) {
      employerTotal += 1;
      if (EMPLOYER_DONE_STATUSES.has(status)) employerDone += 1;
    }

    if (r.blocks_activation === true) {
      blockingTotal += 1;
      if (BLOCKING_SATISFIED_STATUSES.has(status) || r.waived === true) blockingDone += 1;
    }
  }

  const pct = (done, total) => (total === 0 ? 100 : Math.round((done / total) * 100));

  return {
    employeeTotal,
    employeeDone,
    employeePercent: pct(employeeDone, employeeTotal),
    employerTotal,
    employerDone,
    employerPercent: pct(employerDone, employerTotal),
    blockingTotal,
    blockingDone,
    correctionsOpen,
    expired,
    employeeComplete: employeeTotal > 0 ? employeeDone >= employeeTotal : true,
    employerComplete: employerTotal > 0 ? employerDone >= employerTotal : true,
    readyToActivate: blockingTotal === 0 ? false : blockingDone >= blockingTotal,
  };
}

/**
 * Derive the assignment status from its requirements.
 *
 * Terminal statuses are never re-derived: once activated / completed /
 * cancelled / archived, an assignment's status is a historical fact.
 *
 * SUBMISSION IS AN ACT, NOT A SIDE EFFECT. Finishing the last item moves the
 * run to `employee_actions_complete` and stops there. It becomes
 * `employer_review` only once the employee has actually pressed Submit
 * (flags.submitted). Deriving straight past that would make the Submit button
 * vanish the moment it became relevant, and would take the decision to hand
 * the pack over out of the employee's hands — they may well want to re-read
 * what they entered first.
 */
function deriveAssignmentStatus(current, progress, flags = {}) {
  const terminal = ['activated', 'completed', 'cancelled', 'archived'];
  if (terminal.includes(current)) return current;

  // PRE-RELEASE STATES ARE SET BY ACTS, NOT DERIVED FROM PROGRESS.
  //
  // "The starter pack has been sent" and "the returned documents are in" are
  // facts about the paper round-trip; no requirement meter can observe them.
  // Without this guard the fall-through below would see the requirements that
  // already exist, decide the run is `in_progress`, and quietly erase the one
  // piece of state the Owner's next action depends on.
  //
  // These statuses end when an account is created, which is a deliberate act
  // that sets `invite_sent` itself.
  if (PRE_RELEASE_STATUSES.has(current)) return current;

  if (progress.correctionsOpen > 0) return 'corrections_required';

  if (progress.employeeComplete && progress.employeeTotal > 0) {
    if (!flags.submitted) return 'employee_actions_complete';
    if (progress.blockingTotal > 0 && progress.blockingDone >= progress.blockingTotal
        && progress.employerComplete) {
      return 'ready_to_activate';
    }
    if (!progress.employerComplete || progress.blockingDone < progress.blockingTotal) {
      return 'employer_review';
    }
    return 'employee_actions_complete';
  }

  if (flags.hasActivity || progress.employeeDone > 0) return 'in_progress';
  if (current === 'invite_accepted' || flags.inviteAccepted) return 'invite_accepted';
  if (current === 'invite_sent' || flags.inviteSent) return 'invite_sent';
  return current || 'created';
}

/**
 * Activation gate. Returns { ok, blockers } — never a bare boolean, because a
 * refusal has to be explainable to the Owner in the UI.
 *
 * A requirement blocks activation unless it is verified / complete /
 * not_applicable, or the Owner has explicitly waived it with a reason.
 */
function evaluateActivation(requirements) {
  const rows = Array.isArray(requirements) ? requirements : [];
  const blockers = [];
  for (const r of rows) {
    if (r.blocks_activation !== true) continue;
    const status = String(r.status || 'not_started');
    if (BLOCKING_SATISFIED_STATUSES.has(status)) continue;
    if (r.waived === true) continue;
    blockers.push({
      id: r.id,
      code: r.template_code,
      title: r.title,
      section: r.section,
      status,
      actor: r.actor,
      reason: status === 'correction_required'
        ? 'Correction requested — awaiting the employee'
        : (isEmployerItem(r) && EMPLOYEE_DONE_STATUSES.has(status)
          ? 'Awaiting employer verification'
          : 'Outstanding'),
    });
  }
  return { ok: blockers.length === 0, blockers };
}

/**
 * Legal transitions for a requirement. Enforced server-side so a crafted
 * request cannot, for example, jump straight from not_started to verified.
 */
const REQUIREMENT_TRANSITIONS = {
  not_started: ['in_progress', 'submitted', 'complete', 'not_applicable', 'expired'],
  in_progress: ['submitted', 'not_started', 'complete', 'not_applicable', 'expired'],
  submitted: ['awaiting_verification', 'verified', 'complete', 'correction_required', 'not_applicable', 'expired'],
  awaiting_verification: ['verified', 'complete', 'correction_required', 'not_applicable', 'expired'],
  // 'complete' belongs here: a requirement with no employer verification (a
  // policy acknowledgement, a form the practice does not check) completes
  // outright when the employee acts. Without it, asking someone to correct
  // such an item left them permanently unable to resubmit.
  correction_required: ['in_progress', 'submitted', 'complete', 'not_applicable', 'expired'],
  verified: ['complete', 'correction_required', 'expired', 'not_applicable'],
  complete: ['expired', 'correction_required', 'not_applicable'],
  not_applicable: ['not_started', 'in_progress'],
  expired: ['in_progress', 'submitted', 'not_started'],
};

function canTransition(from, to) {
  if (from === to) return true;
  const allowed = REQUIREMENT_TRANSITIONS[String(from)] || [];
  return allowed.includes(String(to));
}

/**
 * The status an employee action should produce.
 *
 * A requirement the employer must verify goes to `submitted` and waits.
 * One that is purely the employee's (reading a policy, acknowledging) goes
 * straight to `complete` — making them wait for a verification that will never
 * come would be a lie about their progress.
 */
function statusAfterEmployeeAction(requirement) {
  if (requirement.requires_employer_verification === true) return 'submitted';
  if (requirement.actor === 'employer') return 'submitted';
  return 'complete';
}

// ═════════════════════════════════════════════════════════════════════════════
//  4. MASKING — the only permitted renderings of sensitive values
// ═════════════════════════════════════════════════════════════════════════════

function digitsOnly(v) {
  return String(v === null || v === undefined ? '' : v).replace(/\D/g, '');
}

/** BSB 062-000 → "•••-•00". Enough to recognise, not enough to reuse. */
function maskBsb(bsb) {
  const d = digitsOnly(bsb);
  if (d.length < 6) return null;
  return `•••-•${d.slice(4, 6)}`;
}

/** Account number → last 4 only. */
function maskAccountNumber(acct) {
  const d = digitsOnly(acct);
  if (d.length < 4) return null;
  return `••••${d.slice(-4)}`;
}

/**
 * TFN → last 3 only, and never more. A TFN is the single most restricted value
 * in the system: the Privacy Act TFN Rule limits its use, disclosure and
 * retention, so no code path may render more than this.
 */
function maskTfn(tfn) {
  const d = digitsOnly(tfn);
  if (d.length < 3) return null;
  return `•••-•••-${d.slice(-3)}`;
}

function lastN(value, n) {
  const d = digitsOnly(value);
  return d.length >= n ? d.slice(-n) : null;
}

/** BSB must be 6 digits. */
function isValidBsb(bsb) {
  return digitsOnly(bsb).length === 6;
}

/** Australian account numbers run 5–10 digits (institution dependent). */
function isValidAccountNumber(acct) {
  const d = digitsOnly(acct);
  return d.length >= 5 && d.length <= 10;
}

/**
 * TFN check: 8 or 9 digits AND the ATO weighted modulus-11 checksum.
 * Validating locally means an obvious typo is caught before the value is
 * encrypted and stored — the point is data quality, not authentication.
 */
function isValidTfn(tfn) {
  const d = digitsOnly(tfn);
  if (d.length !== 8 && d.length !== 9) return false;
  const weights = d.length === 9 ? [1, 4, 3, 7, 5, 8, 6, 9, 10] : [1, 4, 3, 7, 5, 8, 6, 9];
  let sum = 0;
  for (let i = 0; i < d.length; i += 1) sum += Number(d[i]) * weights[i];
  return sum % 11 === 0;
}

/** ABN check: 11 digits and the ATO modulus-89 checksum. */
function isValidAbn(abn) {
  const d = digitsOnly(abn);
  if (d.length !== 11) return false;
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  let sum = 0;
  for (let i = 0; i < 11; i += 1) {
    const digit = Number(d[i]) - (i === 0 ? 1 : 0);
    sum += digit * weights[i];
  }
  return sum % 89 === 0;
}

// ═════════════════════════════════════════════════════════════════════════════
//  5. EXPIRY
// ═════════════════════════════════════════════════════════════════════════════

const DEFAULT_REMINDER_WINDOWS = [90, 60, 30, 7];

/**
 * Which reminder window (if any) an expiry date falls into today.
 * Returns 0 for "expires today or has expired", null when nothing is due.
 */
function expiryWindow(expiryDate, today, windows = DEFAULT_REMINDER_WINDOWS) {
  if (!expiryDate) return null;
  const exp = expiryDate instanceof Date ? expiryDate : new Date(expiryDate);
  if (Number.isNaN(exp.getTime())) return null;
  const now = today instanceof Date ? today : new Date(today);
  const days = Math.floor((Date.UTC(exp.getUTCFullYear(), exp.getUTCMonth(), exp.getUTCDate())
    - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / 86400000);

  if (days <= 0) return 0;
  const sorted = [...windows].map(Number).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  for (const w of sorted) if (days <= w) return w;
  return null;
}

function expirySeverity(windowDays) {
  if (windowDays === 0) return 'error';
  if (windowDays !== null && windowDays <= 30) return 'warning';
  return 'info';
}

// ═════════════════════════════════════════════════════════════════════════════

module.exports = {
  // vocabularies
  SECTIONS,
  SECTION_LABELS,
  CLASSIFICATIONS,
  HANDLERS,
  REQUIREMENT_STATUSES,
  ASSIGNMENT_STATUSES,
  PRE_RELEASE_STATUSES,
  EMPLOYMENT_TYPES,
  FORM_KEYS,
  KNOWN_FACTS,
  OPERATORS,
  DEFAULT_REMINDER_WINDOWS,
  // rules
  evaluateCondition,
  evaluateRule,
  describeRule,
  buildFacts,
  // resolution
  resolveComposition,
  snapshotRequirement,
  selectApplicable,
  computeDueAt,
  // progress + activation
  isEmployeeItem,
  isEmployerItem,
  computeProgress,
  deriveAssignmentStatus,
  evaluateActivation,
  canTransition,
  statusAfterEmployeeAction,
  REQUIREMENT_TRANSITIONS,
  // masking + validation
  maskBsb,
  maskAccountNumber,
  maskTfn,
  lastN,
  digitsOnly,
  isValidBsb,
  isValidAccountNumber,
  isValidTfn,
  isValidAbn,
  // expiry
  expiryWindow,
  expirySeverity,
};
