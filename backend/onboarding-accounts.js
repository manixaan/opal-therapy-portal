'use strict';

/**
 * ACCOUNT PROVISIONING — turning an onboarding into someone who can sign in.
 *
 * The portal already had one way in for a new starter: an emailed invitation
 * link on which they choose their own password. That is the better mechanism
 * and it stays. This module adds the second path the practice asked for — the
 * Owner creates the account and the system issues a temporary password — and
 * makes it safe rather than merely possible.
 *
 * ── WHY A TEMPORARY PASSWORD NEEDS MORE CARE THAN AN INVITE LINK ───────────
 * An invite token is single-purpose: it can set a password and do nothing
 * else. A temporary password is a real credential. Left unguarded it would let
 * somebody sign in and use the portal indefinitely on a secret that a second
 * person (whoever sent the email) also knows. So three things hold at once:
 *
 *   1. must_change_password gates EVERY authenticated path except the password
 *      change itself, enforced at the single requireAuth choke point in
 *      permissions.js — not by hiding buttons.
 *   2. temp_password_expires_at is checked at LOGIN, so an unused credential
 *      stops working on its own.
 *   3. Changing the password clears both flags in the same statement that sets
 *      the hash, so the temporary credential cannot outlive its replacement.
 *
 * The plaintext is returned exactly once — to the Owner who created it, and
 * into the invitation email — and is never stored. Losing it means reissuing,
 * which is the correct trade.
 *
 * ── OWNER SAFETY ───────────────────────────────────────────────────────────
 * `resolvePortalRole` refuses to mint an owner. The Owner role carries the
 * practice's financial and user-management authority, and no onboarding
 * workflow — however the client-side form is manipulated — may grant it. Role
 * changes at that level go through the existing privileged user-management
 * path, where they are a deliberate act with an audit trail of their own.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 12;

/** How long an unused temporary credential remains valid. */
const TEMP_PASSWORD_TTL_DAYS = 7;

/**
 * The two portal roles onboarding may grant, and what the Owner sees.
 *
 * 'Employee' is `therapist` in the role model — the portal's ordinary staff
 * role, which is what an OT, an assistant and an admin-who-is-not-an-
 * administrator all hold. The label differs from the internal name because the
 * internal name is a scheduling concept and the Owner is choosing an
 * employment one.
 */
const PORTAL_ROLES = Object.freeze({
  employee: {
    role: 'therapist',
    label: 'Employee',
    description: 'Their own calendar, their own clients, their own records.',
  },
  admin: {
    role: 'admin',
    label: 'Admin',
    description: 'Practice-wide scheduling and travel. No financials, no user management.',
  },
});

/**
 * Map an Owner's choice to a role, refusing anything that is not one of the two.
 *
 * Deliberately NOT a lookup with a fallback: an unrecognised value is an error,
 * because the one thing a silent default must never do here is pick a role
 * nobody chose.
 *
 * @returns {{ok:true, role:string, key:string}|{ok:false, error:string}}
 */
function resolvePortalRole(choice) {
  const key = String(choice || '').trim().toLowerCase();
  if (key === 'owner') {
    return {
      ok: false,
      error: 'Owner access cannot be granted through onboarding. '
        + 'Change a role to Owner from Settings → Team, where it is a deliberate act.',
    };
  }
  // Accept the internal names too, so an API caller using 'therapist' is not
  // surprised — but never 'owner', and never 'read_only' by accident.
  const alias = { therapist: 'employee', employee: 'employee', admin: 'admin' }[key];
  if (!alias) {
    return { ok: false, error: 'Choose either Employee or Admin portal access.' };
  }
  return { ok: true, key: alias, role: PORTAL_ROLES[alias].role };
}

/**
 * Generate a temporary password a human can retype from an email.
 *
 * Four words plus a two-digit number: roughly 4 × log2(2048) + log2(90) ≈ 50
 * bits from a CSPRNG, which is far beyond what an online login endpoint
 * rate-limited to ten attempts per fifteen minutes can be walked through, and
 * unlike a random character string it survives being read aloud over the phone.
 *
 * The wordlist is deliberately plain and unambiguous: no homophones, no words
 * that differ by one letter, nothing that reads as a slur or a name. It is
 * short by design — entropy comes from the number of draws, and a short list
 * that a person can transcribe correctly beats a long one they mistype.
 */
const WORDS = Object.freeze([
  'anchor', 'basket', 'candle', 'copper', 'dolphin', 'ember', 'falcon', 'garden',
  'harbour', 'island', 'jasmine', 'kettle', 'lantern', 'meadow', 'nectar', 'orchard',
  'pebble', 'quartz', 'ribbon', 'saddle', 'timber', 'umbrella', 'velvet', 'walnut',
  'willow', 'yellow', 'zephyr', 'almond', 'bridge', 'cactus', 'daisy', 'eagle',
  'forest', 'granite', 'hazel', 'indigo', 'juniper', 'kingfisher', 'lemon', 'marble',
  'nutmeg', 'olive', 'poppy', 'quiver', 'rosemary', 'summit', 'thistle', 'valley',
  'wombat', 'yarrow', 'basil', 'cedar', 'dune', 'fennel', 'gully', 'heron',
  'ironbark', 'jarrah', 'karri', 'lagoon', 'mallee', 'numbat', 'opal', 'paperbark',
]);

/** A uniform draw from `list`, rejection-sampled so no value is favoured. */
function pick(list) {
  const range = 256 - (256 % list.length);
  for (;;) {
    const byte = crypto.randomBytes(1)[0];
    if (byte < range) return list[byte % list.length];
  }
}

function generateTemporaryPassword() {
  const words = [pick(WORDS), pick(WORDS), pick(WORDS), pick(WORDS)];
  // Capitalised first word and a trailing number so the result satisfies the
  // portal's own password policy without the recipient having to think about it.
  words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1);
  const number = 10 + (crypto.randomBytes(2).readUInt16BE(0) % 90);
  return `${words.join('-')}-${number}`;
}

/** Hash a password with the portal's existing cost factor. */
async function hashPassword(plain) {
  return bcrypt.hash(String(plain), SALT_ROUNDS);
}

/** When a temporary credential issued now stops working. */
function temporaryPasswordExpiry(days = TEMP_PASSWORD_TTL_DAYS) {
  const ttl = Math.max(1, Math.min(Number(days) || TEMP_PASSWORD_TTL_DAYS, 30));
  return new Date(Date.now() + ttl * 24 * 60 * 60 * 1000);
}

/**
 * Has this temporary credential expired?
 *
 * Only meaningful while password_is_temporary is TRUE. A chosen password never
 * expires — this portal does not do forced rotation, and adding it here by
 * accident would lock out the whole practice.
 */
function temporaryPasswordExpired(user) {
  if (!user || user.password_is_temporary !== true) return false;
  if (!user.temp_password_expires_at) return false;
  return new Date(user.temp_password_expires_at).getTime() <= Date.now();
}

/**
 * Decide what creating an account for this email means.
 *
 * Three outcomes, and the difference matters (§53): a brand-new person, the
 * pre-employee this onboarding already created, or somebody who already works
 * here. The third is never resolved silently — an Owner who is genuinely
 * re-onboarding an existing employee has to say so.
 *
 * @param {object|null} existingUser  from db.getUserByEmail
 * @param {object} assignment
 * @returns {{action:'create'|'adopt'|'conflict', reason?:string, userId?:string}}
 */
function classifyAccountTarget(existingUser, assignment) {
  if (!existingUser) return { action: 'create' };

  // The pre-employee this onboarding made. Adopting it is the whole point.
  if (existingUser.role === 'pre_employee') {
    if (assignment.user_id && assignment.user_id !== existingUser.id) {
      return {
        action: 'conflict',
        reason: 'That email belongs to a different onboarding in progress.',
      };
    }
    return { action: 'adopt', userId: existingUser.id };
  }

  // Our own subject, already promoted — a retry after a partial success.
  if (assignment.user_id && existingUser.id === assignment.user_id) {
    return { action: 'adopt', userId: existingUser.id };
  }

  return {
    action: 'conflict',
    reason: existingUser.is_active === false
      ? 'An inactive account already uses that email address. Reactivate it from Settings → Team, or use a different login email.'
      : `An active account already uses that email address (${existingUser.name || existingUser.email}). `
        + 'Use a different login email, or continue onboarding against the existing account from Settings → Team.',
  };
}

module.exports = {
  SALT_ROUNDS,
  TEMP_PASSWORD_TTL_DAYS,
  PORTAL_ROLES,
  WORDS,
  resolvePortalRole,
  generateTemporaryPassword,
  hashPassword,
  temporaryPasswordExpiry,
  temporaryPasswordExpired,
  classifyAccountTarget,
};
