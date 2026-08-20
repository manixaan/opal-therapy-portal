'use strict';

/**
 * COMPLIANCE EXPIRY ENGINE
 *
 * Onboarding does not end at activation. A Working with Children Check lapses
 * after three years, an NDIS clearance after five, a driver licence and an
 * insurance policy on their own dates, and Ahpra registration every 30
 * November. Collecting those once and never looking again is how a practice
 * ends up with a lapsed clinician on the roster.
 *
 * This sweep runs daily and does three things:
 *
 *   1. WARNS at 90 / 60 / 30 / 7 days and on expiry. Each (subject, window)
 *      pair is claimed through a UNIQUE constraint, so a restart, a second web
 *      instance or a manual re-run cannot send the same warning twice. The
 *      database enforces that, not a flag in memory.
 *
 *   2. MARKS credentials expired once their date passes — except during the
 *      Ahpra late period. Between 1 and 31 December an occupational therapist
 *      may legitimately show "Registered" with a 30 November expiry already
 *      behind them, because the National Law allows a month to renew while the
 *      application is assessed. Flagging that clinician as lapsed would be
 *      wrong, so those rows move to 'renewal_late_period' instead.
 *
 *   3. SCHEDULES RECURRING STATUTORY RE-ISSUES. The Casual Employment
 *      Information Statement is not an onboarding tick-box: it must be given
 *      again at 6 and 12 months and every 12 months after (12-monthly only for
 *      a small business employer). A system that ticks it off at commencement
 *      and never fires again puts the employer in breach from month six.
 *
 * WHY IN-PROCESS. The portal has no job runner. This follows the existing
 * poller pattern in server.js: a single unref'd interval, guarded so two ticks
 * cannot overlap, doing small bounded work. If the app is ever scaled beyond
 * one instance this needs an advisory lock — noted here rather than assumed
 * away.
 */

const { pool } = require('./database');
const odb = require('./onboarding-db');
const engine = require('./onboarding-engine');
const log = require('./logger').createLogger('onboarding-expiry');

const notify = (userId, payload) => Promise.resolve()
  .then(() => require('./app-routes').storeNotification(userId, payload))
  .catch(() => {});

/** Ahpra registration falls due 30 November; renewal is open through December. */
function inAhpraLatePeriod(today, settings) {
  const month = today.getUTCMonth() + 1;
  const day = today.getUTCDate();
  const [endMonth, endDay] = String(settings.ahpraLatePeriodEndsMonthDay || '12-31')
    .split('-').map(Number);
  return month === endMonth && day <= endDay;
}

/** Credentials whose date has passed become expired — with the one exception. */
async function markExpired(orgId, settings, today) {
  const lateWindow = inAhpraLatePeriod(today, settings);

  const { rowCount: expired } = await pool.query(
    `UPDATE credentials
        SET status = 'expired',
            lifecycle_status = CASE
              WHEN credential_type = 'ahpra_registration' AND $2 THEN 'renewal_late_period'
              WHEN lifecycle_status IN ('exclusion', 'suspension', 'interim_bar') THEN lifecycle_status
              ELSE 'expired' END,
            updated_at = NOW()
      WHERE organisation_id IS NOT DISTINCT FROM $1
        AND expiry_date IS NOT NULL AND expiry_date < CURRENT_DATE
        AND status <> 'expired'
        -- Never overwrite a statutory status the authority set. An excluded
        -- worker is excluded, not merely expired.
        AND (lifecycle_status IS NULL
             OR lifecycle_status NOT IN ('exclusion', 'suspension', 'interim_bar'))`,
    [orgId, lateWindow]
  );

  // A requirement whose evidence expired reopens as work to do.
  const { rowCount: reopened } = await pool.query(
    `UPDATE onboarding_requirements
        SET status = 'expired', updated_at = NOW()
      WHERE organisation_id IS NOT DISTINCT FROM $1
        AND expires_at IS NOT NULL AND expires_at < CURRENT_DATE
        AND status IN ('complete', 'verified')`,
    [orgId]
  );

  const { rowCount: orgExpired } = await pool.query(
    `UPDATE organisation_compliance_records
        SET status = 'expired', updated_at = NOW()
      WHERE organisation_id IS NOT DISTINCT FROM $1
        AND expiry_date IS NOT NULL AND expiry_date < CURRENT_DATE
        AND status <> 'expired'`,
    [orgId]
  );

  return { expired, reopened, orgExpired };
}

/** Emit reminders for anything inside a configured window. */
async function sendExpiryReminders(orgId, settings, today) {
  const windows = settings.reminderWindowsDays || engine.DEFAULT_REMINDER_WINDOWS;
  const horizon = Math.max(...windows.map(Number).filter(Number.isFinite), 90);
  const items = await odb.listExpiringItems(orgId, horizon);

  // One digest per owner/admin rather than one message per expiring item.
  const { rows: managers } = await pool.query(
    `SELECT id, permissions, role FROM users
      WHERE organisation_id IS NOT DISTINCT FROM $1 AND is_active = TRUE
        AND role IN ('owner', 'admin')`, [orgId]
  );
  const watchers = managers.filter((u) => u.role === 'owner'
    || (Array.isArray(u.permissions) && u.permissions.includes('onboarding.view')));

  let sent = 0;
  const forManagers = [];

  for (const item of items) {
    const window = engine.expiryWindow(
      item.expiry_date, today, item.reminder_days || windows
    );
    if (window === null) continue;

    const claimed = await odb.claimExpiryNotice({
      organisationId: orgId,
      subjectType: item.subject_type,
      subjectId: item.subject_id,
      userId: item.user_id,
      expiryDate: item.expiry_date,
      windowDays: window,
      severity: engine.expirySeverity(window),
    });
    if (!claimed) continue; // already warned for this window
    sent += 1;

    const label = item.title || item.kind;
    const when = window === 0 ? 'has expired' : `expires in ${window} day${window === 1 ? '' : 's'}`;

    // Tell the person whose credential it is.
    if (item.user_id) {
      await notify(item.user_id, {
        type: `credential_expiry_${item.subject_id}_${window}`,
        title: window === 0 ? 'A credential has expired' : 'A credential is expiring',
        message: `Your ${label} ${when}. Please provide an updated record.`,
        severity: engine.expirySeverity(window),
        relatedEntity: 'credential',
        actionPayload: { subjectType: item.subject_type, subjectId: item.subject_id },
      });
    }
    forManagers.push({ ...item, window, label, when });
  }

  if (forManagers.length) {
    const urgent = forManagers.filter((i) => i.window === 0);
    const summary = urgent.length
      ? `${urgent.length} credential(s) have expired and ${forManagers.length - urgent.length} are approaching expiry.`
      : `${forManagers.length} credential(s) are approaching expiry.`;
    for (const m of watchers) {
      await notify(m.id, {
        // Date in the type so the daily digest is not swallowed by the
        // storeNotification 24-hour de-duplication.
        type: `onboarding_expiry_digest_${today.toISOString().slice(0, 10)}`,
        title: urgent.length ? 'Credentials have expired' : 'Credentials expiring soon',
        message: summary,
        severity: urgent.length ? 'error' : 'warning',
        relatedEntity: 'onboarding_compliance',
        actionPayload: { view: 'expiring' },
      });
    }
  }

  return sent;
}

/**
 * Recurring statutory re-issues.
 *
 * Currently the CEIS. Rather than hardcoding its cadence, the schedule is read
 * from the compliance registry's `recurrence` field, so a change to the rule is
 * a data edit rather than a deploy.
 */
async function scheduleRecurringStatements(orgId, settings, today) {
  const ceis = await odb.getComplianceRequirementByCode(orgId, 'CEIS');
  if (!ceis || !ceis.recurrence || !ceis.recurrence.kind) return 0;
  if (ceis.recurrence.kind !== 'months_since_start') return 0;

  const smallBusiness = settings.smallBusinessEmployer === true;
  const milestones = smallBusiness
    ? (ceis.recurrence.smallBusinessMonths || [12])
    : (ceis.recurrence.months || [6, 12]);
  const thereafter = smallBusiness
    ? (ceis.recurrence.smallBusinessThenEveryMonths || 12)
    : (ceis.recurrence.thenEveryMonths || 12);

  // Every casual employee with a start date.
  const { rows: casuals } = await pool.query(
    `SELECT u.id AS user_id, u.name, e.start_date
       FROM employment_profiles e JOIN users u ON u.id = e.user_id
      WHERE e.organisation_id IS NOT DISTINCT FROM $1
        AND e.employment_type = 'casual' AND e.status = 'active'
        AND e.start_date IS NOT NULL AND u.is_active = TRUE`, [orgId]
  );

  let due = 0;
  for (const c of casuals) {
    const start = new Date(c.start_date);
    if (Number.isNaN(start.getTime())) continue;

    const monthsElapsed = Math.floor(
      (today.getUTCFullYear() - start.getUTCFullYear()) * 12
      + (today.getUTCMonth() - start.getUTCMonth())
    );

    // Which milestone is now reached but not yet issued?
    const reached = milestones.filter((m) => monthsElapsed >= m);
    if (thereafter > 0) {
      const last = milestones[milestones.length - 1] || 0;
      for (let m = last + thereafter; m <= monthsElapsed; m += thereafter) reached.push(m);
    }
    if (!reached.length) continue;
    const milestone = Math.max(...reached);

    const dueDate = new Date(Date.UTC(
      start.getUTCFullYear(), start.getUTCMonth() + milestone, start.getUTCDate()
    ));

    const { rows: already } = await pool.query(
      `SELECT 1 FROM onboarding_statement_issuances
        WHERE user_id = $1 AND statement_code = 'CEIS' AND trigger_due_at = $2 LIMIT 1`,
      [c.user_id, dueDate]
    );
    if (already.length) continue;

    const claimed = await odb.claimExpiryNotice({
      organisationId: orgId,
      subjectType: 'statement_reissue',
      subjectId: c.user_id,
      userId: c.user_id,
      expiryDate: dueDate,
      windowDays: milestone,
      severity: 'warning',
    });
    if (!claimed) continue;
    due += 1;

    const { rows: managers } = await pool.query(
      `SELECT id FROM users WHERE organisation_id IS NOT DISTINCT FROM $1
         AND role = 'owner' AND is_active = TRUE`, [orgId]
    );
    for (const m of managers) {
      await notify(m.id, {
        type: `ceis_reissue_${c.user_id}_${milestone}`,
        title: 'Casual Employment Information Statement due',
        message: `${c.name} has reached ${milestone} months of casual employment. `
          + 'The Casual Employment Information Statement must be issued again.',
        severity: 'warning',
        relatedEntity: 'onboarding_compliance',
        actionPayload: { userId: c.user_id, statementCode: 'CEIS', milestoneMonths: milestone },
      });
    }
  }
  return due;
}

/** Run one full sweep for every organisation. */
async function runExpirySweep({ today = new Date() } = {}) {
  const { rows: orgs } = await pool.query('SELECT id FROM organisations');
  const results = [];

  for (const org of orgs) {
    try {
      const settings = await odb.getOnboardingSettings();
      const marked = await markExpired(org.id, settings, today);
      const reminders = await sendExpiryReminders(org.id, settings, today);
      const statements = await scheduleRecurringStatements(org.id, settings, today);
      results.push({ organisationId: org.id, ...marked, reminders, statements });
    } catch (err) {
      log.error('expiry sweep failed for organisation', { error: err, organisationId: org.id });
    }
  }

  if (results.length) log.info('expiry sweep complete', { organisations: results.length, results });
  return results;
}

// ── Scheduling ───────────────────────────────────────────────────────────────

const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;
let _timer = null;
let _running = false;

/**
 * Start the daily sweep. First run is delayed so it never competes with boot,
 * and the guard means a slow sweep cannot overlap the next tick.
 */
function startExpiryScheduler({ intervalMs = SWEEP_INTERVAL_MS, firstDelayMs = 5 * 60 * 1000 } = {}) {
  if (_timer) return _timer;

  const tick = async () => {
    if (_running) { log.warn('expiry sweep still running — skipping this tick'); return; }
    _running = true;
    try { await runExpirySweep(); } catch (err) {
      log.error('expiry sweep error', { error: err });
    } finally { _running = false; }
  };

  setTimeout(tick, firstDelayMs).unref();
  _timer = setInterval(tick, intervalMs);
  _timer.unref();
  log.info('onboarding expiry scheduler started', { intervalHours: intervalMs / 3600000 });
  return _timer;
}

function stopExpiryScheduler() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

// CLI: node onboarding-expiry.js
if (require.main === module) {
  require('dotenv').config();
  runExpirySweep()
    .then((r) => { console.log(JSON.stringify(r, null, 2)); return pool.end(); })
    .then(() => process.exit(0))
    .catch((err) => { console.error('Sweep failed:', err); process.exit(1); });
}

module.exports = {
  runExpirySweep,
  startExpiryScheduler,
  stopExpiryScheduler,
  markExpired,
  sendExpiryReminders,
  scheduleRecurringStatements,
  inAhpraLatePeriod,
};
