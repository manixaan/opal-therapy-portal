'use strict';

/**
 * PHASE 3 — readiness, Email 3, and completion. Pure.
 *
 * Phase 3 does not "lock". It says exactly what is not ready:
 *   Phase 3 is not ready because:
 *     • Splose account still needs to be created
 *     • Contract of Employment has not been verified
 */

const SUBJECT = 'Opal Therapy Internal Induction Pack';

const BODY = `Hi [Name],

Thank you for completing and returning your onboarding documentation. We're now pleased to move forward with the final stage of your induction with Opal Therapy.

Attached as a ZIP folder is your Opal Therapy Internal Induction Pack. The pack includes the information and instructions required to set up and access your Splose, Outlook and Opal Portal accounts, together with Opal Therapy's internal policies, procedures and other induction documentation relevant to your role.

Please download and extract the ZIP folder, carefully review each document, and complete, sign or acknowledge all items applicable to you. Please complete and return the required documentation within seven days, by [DD/MM/YYYY].

Account Setup and Security

Please follow the instructions provided in the pack to activate or access each account. Keep all login details confidential and do not share your credentials with anyone. If a temporary password has been provided, please change it when you first sign in.

Please take the time to read the internal documentation carefully, as it outlines the professional standards, responsibilities and processes that apply during your employment with Opal Therapy. If you have any questions, cannot access an account, or require clarification about any document, please contact us as soon as possible.

Once your internal induction documentation has been completed, we'll confirm any remaining orientation, training and commencement arrangements with you.

Warmly,
Ann
Director | Opal Therapy`;

const RETURN_DAYS = 7;
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'there';
const ddmmyyyy = (d) => new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Australia/Perth' });
function dueDateFrom(from = new Date()) { const d = new Date(from); d.setDate(d.getDate() + RETURN_DAYS); return d; }

function composeInductionEmail({ applicantName, sentAt = new Date() }) {
  const dueAt = dueDateFrom(sentAt);
  return { subject: SUBJECT, body: BODY.replace(/\[Name\]/g, firstName(applicantName)).replace(/\[DD\/MM\/YYYY\]/g, ddmmyyyy(dueAt)), dueAt };
}
function restampDueDate(body, previousDueAt, dueAt) {
  let out = String(body || '').replace(/\[DD\/MM\/YYYY\]/g, ddmmyyyy(dueAt));
  if (previousDueAt) out = out.split(ddmmyyyy(previousDueAt)).join(ddmmyyyy(dueAt));
  return out;
}

/** The internal set-up tasks Phase 3 needs done before the pack goes. */
const REQUIRED_TASKS = [
  { code: 'portal_account', label: 'Opal Portal' },
  { code: 'work_email', label: 'Outlook' },
  { code: 'systems_access', label: 'Splose', when: (a) => a.is_treating_therapist === true || a.role_category === 'occupational_therapist' },
];
const STATUTORY = new Set(['REQ_AHPRA', 'REQ_NDIS_SCREENING', 'REQ_WWCC', 'PACK_POLICE_CHECK']);

/**
 * @param {object} p
 * @param {object} p.assignment
 * @param {object[]} p.tasks           internal tasks
 * @param {object[]} p.documentation   Phase 2 pack items (rows)
 * @param {object} [p.payroll]         buildPayrollSetup() output
 * @returns {{ ready, checks:[{key,label,state,detail}], blockers:string[] }}
 */
function buildReadiness({ assignment = {}, tasks = [], documentation = [], payroll = null }) {
  const checks = []; const blockers = [];
  const taskDone = (code) => tasks.some((t) => t.code === code && (t.status === 'done' || t.status === 'skipped'));
  const taskState = (code) => { const t = tasks.find((x) => x.code === code); return t ? t.status : 'missing'; };

  for (const r of REQUIRED_TASKS) {
    if (r.when && !r.when(assignment)) continue;
    const ok = taskDone(r.code);
    checks.push({ key: r.code, label: r.label, state: ok ? 'ready' : taskState(r.code) === 'in_progress' ? 'in_progress' : 'pending', detail: ok ? 'Ready' : taskState(r.code) === 'in_progress' ? 'In progress' : 'Not yet created' });
    if (!ok) blockers.push(`${r.label} account still needs to be ${r.code === 'portal_account' ? 'created' : 'set up'}`);
  }

  const included = documentation.filter((d) => d.status === 'included' && d.employee_returns && d.required);
  const employment = included.filter((d) => !STATUTORY.has(d.code));
  const compliance = included.filter((d) => STATUTORY.has(d.code));
  const outstanding = (list) => list.filter((d) => d.verification_status !== 'verified');
  const empOut = outstanding(employment); const compOut = outstanding(compliance);
  checks.push({ key: 'employment_docs', label: 'Required employment documents', state: empOut.length ? 'pending' : 'ready', detail: empOut.length ? `${empOut.length} not yet verified` : 'Ready' });
  checks.push({ key: 'compliance', label: 'Required compliance items', state: compOut.length ? 'pending' : 'ready', detail: compOut.length ? `${compOut.length} not yet verified` : 'Ready' });
  for (const d of empOut) blockers.push(`${d.title} has not been ${d.returned_at ? 'verified' : 'returned'}`);
  for (const d of compOut) blockers.push(`${d.title} has not been ${d.returned_at ? 'verified against the register' : 'returned'}`);

  if (payroll) {
    checks.push({ key: 'payroll', label: 'Payroll setup', state: payroll.approved ? 'ready' : payroll.ready ? 'in_progress' : 'pending', detail: payroll.label });
    // Payroll is shown, not a gate: the pack can go while payroll is still being approved.
  }

  return { ready: blockers.length === 0, checks, blockers };
}

/** Phase 3 completion: every required induction item done. */
function inductionComplete(items) {
  const required = items.filter((i) => i.status === 'included' && i.required && (i.employee_returns || i.item_kind !== 'document'));
  const open = required.filter((i) => !(i.verification_status === 'verified' || i.completed_at));
  return { complete: required.length > 0 && open.length === 0, required: required.length, done: required.length - open.length, open };
}

module.exports = { SUBJECT, BODY, RETURN_DAYS, composeInductionEmail, restampDueDate, dueDateFrom, ddmmyyyy, REQUIRED_TASKS, buildReadiness, inductionComplete };
