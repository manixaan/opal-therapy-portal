'use strict';

/**
 * AUTOMATIC SET-UP — what the portal does by itself once Stage 2 is complete.
 *
 * The moment the last required document is verified, the portal already has
 * everything it needs to set the person up, so it does, in order:
 *
 *   1. the Internal Setup checklist exists (it is created here if not);
 *   2. "Opal Portal account" is ticked — the pre-employee login was created
 *      with the document pack;
 *   3. every requirement whose document has been verified in the pack is
 *      marked complete, so the activation gate sees what the pack saw;
 *   4. portal access is activated (the pre-employee becomes staff with the
 *      agreed role) — or, if a blocking requirement is still open, the task
 *      says exactly what it is waiting on and this runs again next time;
 *   5. if a Microsoft 365 account already exists for the person, "Create work
 *      email" is ticked and their manager is set on it in Microsoft 365.
 *
 * Nothing here creates a Microsoft 365 account: that hands out a credential
 * and commits the practice to a licence, and stays an Owner's deliberate
 * press in the Microsoft 365 step. Nothing here retries silently — a failed
 * step is a failed task with the reason on it.
 *
 * Idempotent: every step checks before it acts, so running twice is safe.
 */

const odb = require('./onboarding-db');
const jdb = require('./onboarding-journey-db');
const pdb = require('./onboarding-pack-db');
const engine = require('./onboarding-engine');
const lifecycle = require('./onboarding-lifecycle');
const email = require('./email');
const graphIdentity = require('./graph-identity');
const { auditOnboarding } = require('./onboarding-audit');
const log = require('./logger').createLogger('onboarding-autosetup');

const CLOSED = new Set(['cancelled', 'archived']);

/** Durable in-app notification; never throws. */
function notify(userId, payload) {
  if (!userId) return Promise.resolve();
  return Promise.resolve()
    .then(() => require('./app-routes').storeNotification(userId, payload))
    .catch(() => {});
}

async function taskByCode(assignmentId, code) {
  return jdb.getTask(assignmentId, code).catch(() => null);
}

/** Mark a task done only if it is not already finished (keeps who-did-it honest). */
async function finishTask(assignmentId, code, { actorId, note, detail } = {}) {
  const t = await taskByCode(assignmentId, code);
  if (!t || t.status === 'done' || t.status === 'skipped') return false;
  await jdb.setTaskStatus(assignmentId, code, { status: 'done', actorId: actorId || null, note: note || null, detail: detail || null });
  return true;
}

/**
 * Requirements the pack has verified: a pack item born from a requirement
 * carries its template code, so a verified item completes that requirement.
 */
async function syncRequirementsFromPack(assignmentId) {
  const items = await pdb.listItems(assignmentId);
  const codes = items
    .filter((i) => i.status === 'included' && i.requirement_code && i.verification_status === 'verified')
    .map((i) => i.requirement_code);
  if (!codes.length) return 0;
  const { rowCount } = await odb.pool.query(
    `UPDATE onboarding_requirements
        SET status = 'complete', completed_at = COALESCE(completed_at, NOW()), updated_at = NOW()
      WHERE assignment_id = $1 AND template_code = ANY($2::text[])
        AND status NOT IN ('verified', 'complete', 'not_applicable')`,
    [assignmentId, codes],
  );
  return rowCount;
}

/** The Microsoft 365 manager link, when both sides have an account. */
async function linkManager(assignment, { actorId } = {}) {
  if (!assignment.m365_object_id || !assignment.manager_user_id) return { linked: false, reason: 'no_account_or_manager' };
  const { rows } = await odb.pool.query('SELECT m365_object_id, name FROM users WHERE id = $1', [assignment.manager_user_id]);
  const manager = rows[0];
  if (!manager || !manager.m365_object_id) return { linked: false, reason: 'manager_has_no_m365' };
  const task = await taskByCode(assignment.id, 'work_email');
  if (task && task.detail && task.detail.managerObjectId === manager.m365_object_id) return { linked: true, reason: 'already' };
  try {
    await graphIdentity.setManager(assignment.m365_object_id, manager.m365_object_id);
  } catch (err) {
    log.warn('manager link failed', { code: err.code, assignmentId: assignment.id });
    return { linked: false, reason: err.code || 'graph_error', message: err.message };
  }
  if (task) {
    await jdb.setTaskStatus(assignment.id, 'work_email', {
      status: task.status, actorId: actorId || null, note: null,
      detail: { ...(task.detail || {}), managerObjectId: manager.m365_object_id, managerName: manager.name },
    }).catch(() => {});
  }
  return { linked: true, managerName: manager.name };
}

/**
 * Run the chain. `actor` is whoever's action completed the stage (the
 * verifier); `req` is passed through for the audit trail. Returns a summary.
 */
async function afterDocumentationComplete({ req, assignment, actor }) {
  const summary = { activated: false, blockers: [], m365: null };
  if (!assignment || CLOSED.has(assignment.status)) return summary;
  const actorId = actor && actor.id ? actor.id : null;

  // 1. The checklist, and 2. the account that already exists.
  const journeyRoutes = require('./onboarding-journey-routes');
  let tasks = await jdb.listTasks(assignment.id);
  tasks = await journeyRoutes._internals.ensureInduction(assignment, tasks, { force: true });
  if (assignment.user_id) await finishTask(assignment.id, 'portal_account', { note: 'Pre-employee account created with the profile' });

  // 3. What the pack verified, the gate must see.
  await syncRequirementsFromPack(assignment.id);

  // 4. Activation.
  if (!['activated', 'completed'].includes(assignment.status)) {
    const requirements = await odb.listRequirements(assignment.id);
    const gate = engine.evaluateActivation(requirements);
    if (!gate.ok) {
      summary.blockers = gate.blockers.map((b) => b.title || b.code);
      const t = await taskByCode(assignment.id, 'portal_access');
      if (t && t.status !== 'done') {
        const shown = summary.blockers.slice(0, 3).join(', ') + (summary.blockers.length > 3 ? ` and ${summary.blockers.length - 3} more` : '');
        await jdb.setTaskStatus(assignment.id, 'portal_access', {
          status: 'pending', actorId: null,
          note: `Waiting on ${summary.blockers.length === 1 ? '' : summary.blockers.length + ' items: '}${shown}`.replace('Waiting on 1 items: ', 'Waiting on: '),
          detail: { blockers: gate.blockers.map((b) => b.code), waitingSince: new Date().toISOString() },
        }).catch(() => {});
      }
    } else {
      try {
        const outcome = await lifecycle.activateAssignment({ assignment, actor: actor || { id: null, name: 'Opal Portal', email: null } });
        summary.activated = true;
        await jdb.setTaskStatus(assignment.id, 'portal_access', {
          status: 'done', actorId, note: 'Activated by the portal when the documentation was complete', detail: { activatedRole: outcome.user.role, trigger: 'documentation_complete' },
        }).catch(() => {});
        if (req) {
          await auditOnboarding(req, 'employee_activated', {
            targetType: 'user', targetId: assignment.user_id,
            metadata: { assignmentId: assignment.id, subjectUserId: assignment.user_id, role: assignment.proposed_role, previousRole: 'pre_employee', employmentType: assignment.employment_type, trigger: 'documentation_complete' },
          });
        }
        await notify(assignment.user_id, {
          type: `onboarding_activated_${assignment.id}`,
          title: 'Your Opal Therapy account is active',
          message: 'Your onboarding documentation is complete and your portal access is now active.',
          severity: 'success', relatedEntity: 'onboarding_assignment', actionPayload: { assignmentId: assignment.id },
        });
        try { await email.sendAccountApprovedEmail({ toEmail: outcome.user.email, name: outcome.user.name, role: outcome.user.role }); } catch (err) { log.warn('activation email failed', { error: err, assignmentId: assignment.id }); }
      } catch (err) {
        if (err instanceof lifecycle.LifecycleError) {
          summary.blockers = (err.body?.blockers || []).map((b) => b.title || b.code);
          await jdb.setTaskStatus(assignment.id, 'portal_access', { status: 'failed', actorId: null, note: err.body?.error || 'Activation refused', detail: { blockers: (err.body?.blockers || []).map((b) => b.code) } }).catch(() => {});
        } else if (err && err.code === 'ALREADY_ACTIVATED') {
          summary.activated = true;
        } else {
          throw err;
        }
      }
    }
  }

  // 5. Microsoft 365, when the Owner has already created the account.
  if (assignment.m365_object_id) {
    await finishTask(assignment.id, 'work_email', { actorId, note: `Microsoft 365 account ${assignment.m365_upn || ''}`.trim(), detail: { m365ObjectId: assignment.m365_object_id, upn: assignment.m365_upn || null } });
    summary.m365 = await linkManager(assignment, { actorId });
  }
  return summary;
}

module.exports = { afterDocumentationComplete, linkManager, syncRequirementsFromPack, _internals: { finishTask } };
