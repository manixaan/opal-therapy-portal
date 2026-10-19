'use strict';

/**
 * credential-reminder.js — "finish your credentials" nudge after first login.
 *
 * Every credential in the first-login wizard is optional, so a person can
 * reach the portal with none, or with records still waiting for their scan.
 * This decides whether they should be reminded, for the two places that
 * remind them: the My Profile setup card (GET /api/profile/setup-status) and
 * the notification bell (app-routes.js runAllSystemChecks).
 *
 * Quiet once the KEY credentials are on file with their documents, or once the
 * person dismisses the reminder (from either place — one dismissal holds for
 * both).
 */

const credentialExtraction = require('./credential-extraction');

const NOTIFICATION_TYPE = 'credentials_incomplete';

/** Clinicians: registration, insurance and both screening checks. */
const KEY_TYPES_CLINICAL = Object.freeze(['ahpra_registration', 'professional_indemnity', 'wwcc', 'ndis_worker_screening']);
/** Everyone else working with participants: the two screening checks. */
const KEY_TYPES_OTHER = Object.freeze(['wwcc', 'ndis_worker_screening']);

const ROLES = new Set(['therapist', 'admin', 'owner']);

/**
 * The pure decision, from already-loaded rows (unit-testable).
 * user: { role, profile_completed, is_treating_therapist }
 * creds: [{ credential_type, document_id }]
 */
function decide({ user, creds, dismissed }) {
  const applies = !!(user && ROLES.has(user.role) && user.profile_completed);
  const clinical = !!(user && (user.role === 'therapist' || user.is_treating_therapist));
  const keyTypes = clinical ? KEY_TYPES_CLINICAL : KEY_TYPES_OTHER;
  const list = Array.isArray(creds) ? creds : [];
  const byType = new Map();
  for (const c of list) {
    const t = credentialExtraction.canonicalType(c.credential_type) || c.credential_type;
    const prev = byType.get(t);
    byType.set(t, prev || !!c.document_id);
  }
  const missingKeyTypes = keyTypes.filter((t) => !byType.has(t));
  const keyTypesWithoutScan = keyTypes.filter((t) => byType.has(t) && !byType.get(t));
  const withoutScan = list.filter((c) => !c.document_id).length;
  const satisfied = !missingKeyTypes.length && !keyTypesWithoutScan.length;
  return {
    applies, keyTypes: [...keyTypes], total: list.length, withoutScan,
    missingKeyTypes, keyTypesWithoutScan, satisfied, dismissed: !!dismissed,
    due: applies && !satisfied && !dismissed,
  };
}

/** One line for the card / the bell. */
function describe(state) {
  if (!state.total) return 'Add your credentials and upload their documents (My Profile → Credentials)';
  const parts = [];
  if (state.missingKeyTypes.length) parts.push(`${state.missingKeyTypes.length} key credential${state.missingKeyTypes.length === 1 ? '' : 's'} not added`);
  if (state.keyTypesWithoutScan.length) parts.push(`${state.keyTypesWithoutScan.length} waiting for a scan`);
  return `Finish your credentials — ${parts.join(', ')} (My Profile → Credentials)`;
}

async function load(pool, userId) {
  const [u, c, s, n] = await Promise.all([
    pool.query(`SELECT role, profile_completed, is_treating_therapist FROM users WHERE id = $1`, [userId]),
    pool.query(`SELECT credential_type, document_id FROM credentials WHERE user_id = $1`, [userId]),
    pool.query(`SELECT settings FROM user_settings WHERE user_id = $1`, [userId]).catch(() => ({ rows: [] })),
    pool.query(
      `SELECT 1 FROM user_notifications WHERE user_id = $1 AND type = $2 AND status = 'dismissed' LIMIT 1`,
      [userId, NOTIFICATION_TYPE]).catch(() => ({ rows: [] })),
  ]);
  const settings = (s.rows[0] && s.rows[0].settings) || {};
  return decide({
    user: u.rows[0],
    creds: c.rows,
    dismissed: !!settings.credentialReminderDismissedAt || n.rows.length > 0,
  });
}

async function dismiss(pool, userId) {
  await pool.query(
    `INSERT INTO user_settings (user_id, settings, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (user_id) DO UPDATE
       SET settings = user_settings.settings || $2::jsonb, updated_at = NOW()`,
    [userId, JSON.stringify({ credentialReminderDismissedAt: new Date().toISOString() })]);
  await pool.query(
    `UPDATE user_notifications SET status = 'dismissed' WHERE user_id = $1 AND type = $2 AND status <> 'dismissed'`,
    [userId, NOTIFICATION_TYPE]).catch(() => {});
}

/**
 * The bell. One live reminder at a time (not one a day); removed again once
 * the key credentials are on file, so a stale nudge does not linger.
 */
async function syncNotification(pool, userId) {
  const state = await load(pool, userId);
  if (state.satisfied) {
    await pool.query(
      `DELETE FROM user_notifications WHERE user_id = $1 AND type = $2 AND status <> 'dismissed'`,
      [userId, NOTIFICATION_TYPE]);
    return state;
  }
  if (!state.due) return state;
  const live = await pool.query(
    `SELECT 1 FROM user_notifications WHERE user_id = $1 AND type = $2 AND status <> 'dismissed' LIMIT 1`,
    [userId, NOTIFICATION_TYPE]);
  if (live.rows.length) return state;
  await pool.query(
    `INSERT INTO user_notifications (user_id, type, title, message, severity, status, related_entity, action_payload)
     VALUES ($1, $2, $3, $4, 'info', 'unread', 'profile', $5::jsonb)`,
    [userId, NOTIFICATION_TYPE, 'Finish adding your credentials', describe(state),
     JSON.stringify({ action: 'open_credentials' })]);
  return state;
}

module.exports = {
  decide, describe, load, dismiss, syncNotification,
  NOTIFICATION_TYPE, KEY_TYPES_CLINICAL, KEY_TYPES_OTHER,
};
