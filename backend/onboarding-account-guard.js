'use strict';

/**
 * ONBOARDING ACCOUNT GUARD — the one rule every path that creates, links or
 * changes a user from an onboarding record must pass, checked AT ACTION TIME.
 *
 * An onboarding record may only ever act on ITS OWN pre-employee account:
 *
 *   • the account's role is still 'pre_employee' (never a live staff or Owner
 *     account, whatever email it shares with the applicant);
 *   • it belongs to the record's organisation;
 *   • no OTHER open onboarding record is using it.
 *
 * The audit (B-1) found a record created before an account with the same
 * email existed could later adopt that account — offer verify linked it,
 * release issued an invitation against it, accepting the invitation replaced
 * its password, and activation changed its role (an Admin was demoted to
 * Read-only). Checking only when the link is first made is not enough: the
 * account can change after the link, so every act re-checks here.
 *
 *   assessAccount(user, assignment, { busy }) — pure, unit-tested
 *   loadAndAssess(q, assignment, userId, { lock }) — the database half
 *   assertOwnPreEmployee(q, assignment, userId, opts) — throws AccountGuardError
 */

const CLOSED = ['cancelled', 'archived', 'activated', 'completed'];

class AccountGuardError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.status = 409;
    this.body = { error: message, code };
  }
}

const MESSAGES = {
  no_account: 'This onboarding has no portal account yet.',
  not_pre_employee: 'An existing staff account already uses this email address, so this onboarding cannot act on it. '
    + 'Change the applicant email, or manage the existing account from Settings → Users & Roles.',
  other_organisation: 'That account belongs to a different organisation.',
  in_use: 'That email belongs to a different onboarding in progress.',
};

/**
 * Pure: may this onboarding act on this account?
 * @param {object|null} user        users row (id, role, organisation_id)
 * @param {object} assignment       onboarding_assignments row
 * @param {object} [opts]
 * @param {boolean} [opts.busy]     another open onboarding uses this account
 * @returns {{ ok: true } | { ok: false, code: string, error: string }}
 */
function assessAccount(user, assignment, { busy = false } = {}) {
  if (!user) return { ok: false, code: 'no_account', error: MESSAGES.no_account };
  if (user.role !== 'pre_employee') return { ok: false, code: 'not_pre_employee', error: MESSAGES.not_pre_employee };
  if (String(user.organisation_id || '') !== String(assignment.organisation_id || '')) {
    return { ok: false, code: 'other_organisation', error: MESSAGES.other_organisation };
  }
  if (busy) return { ok: false, code: 'in_use', error: MESSAGES.in_use };
  return { ok: true };
}

/** Load the account (optionally FOR UPDATE inside a transaction) and assess it. */
async function loadAndAssess(q, assignment, userId, { lock = false } = {}) {
  if (!userId) return { ok: false, code: 'no_account', error: MESSAGES.no_account, user: null };
  const { rows } = await q.query(
    `SELECT id, email, name, role, organisation_id, is_active, password_hash,
            password_is_temporary, must_change_password
       FROM users WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
    [userId]
  );
  const user = rows[0] || null;
  let busy = false;
  if (user && user.role === 'pre_employee') {
    const { rows: other } = await q.query(
      `SELECT 1 FROM onboarding_assignments
        WHERE user_id = $1 AND id <> $2 AND status <> ALL($3::text[]) LIMIT 1`,
      [userId, assignment.id, CLOSED]
    );
    busy = other.length > 0;
  }
  return { ...assessAccount(user, assignment, { busy }), user };
}

/** Throw unless the record may act on this account. Returns the users row. */
async function assertOwnPreEmployee(q, assignment, userId, opts) {
  const out = await loadAndAssess(q, assignment, userId, opts);
  if (!out.ok) throw new AccountGuardError(out.code, out.error);
  return out.user;
}

/** An existing account with this email that the record could adopt, or a refusal. */
async function adoptableByEmail(q, assignment, email, { lock = false } = {}) {
  const { rows } = await q.query(
    `SELECT id FROM users WHERE LOWER(email) = LOWER($1) ORDER BY created_at ASC LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [email]
  );
  if (!rows[0]) return { exists: false };
  const out = await loadAndAssess(q, assignment, rows[0].id, { lock });
  return { exists: true, ...out };
}

module.exports = {
  AccountGuardError,
  MESSAGES,
  assessAccount,
  loadAndAssess,
  assertOwnPreEmployee,
  adoptableByEmail,
};
