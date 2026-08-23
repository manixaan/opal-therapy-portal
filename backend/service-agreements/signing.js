'use strict';

/**
 * SERVICE AGREEMENT — SIGNING SESSIONS
 *
 * The only place in this portal that grants access to somebody without an
 * account, which is why the rules here are stated rather than assumed.
 *
 * ── THE TOKEN IS NEVER STORED ──────────────────────────────────────────────
 * `mintToken()` returns the secret once; only its SHA-256 is persisted. A
 * database copy of a live token would be a bearer credential at rest — anybody
 * with read access to one table could open any participant's agreement — and
 * it buys nothing, because the token already exists in the recipient's inbox.
 * Lookup hashes the presented token and matches on the hash.
 *
 * SHA-256 without a work factor is the right choice HERE and would be wrong
 * for a password. A password is short, human-chosen and guessable, so it needs
 * a slow hash. This token is 32 bytes of `crypto.randomBytes` — 256 bits of
 * entropy — so brute force is not a threat model and a slow hash would only
 * make every legitimate page load slower.
 *
 * ── COMPARISON IS CONSTANT TIME ────────────────────────────────────────────
 * The hash is looked up by an indexed equality, which leaks nothing useful,
 * and any subsequent comparison uses timingSafeEqual. A `===` on a secret is
 * the kind of detail that is fine until somebody can measure it.
 *
 * ── WHAT A SESSION MAY DO ──────────────────────────────────────────────────
 * A session carries `assigned_tags`: the exact fields it may write, frozen at
 * issue. Not "the participant-editable fields" resolved at request time —
 * widening that category in a later release must not retroactively widen a
 * link that is already in somebody's inbox.
 *
 * It is also bound to ONE agreement and ONE recipient email. A forwarded link
 * still asks for the address it was issued to, so a participant cannot
 * accidentally give a relative the ability to sign for them by forwarding an
 * email.
 */

const crypto = require('crypto');

const map = require('./template-map');

/** How long a completion link lives unless the caller says otherwise. */
const DEFAULT_EXPIRY_DAYS = 14;
const MAX_EXPIRY_DAYS = 90;
const MIN_EXPIRY_DAYS = 1;

/** Recipient-verification attempts before the session is treated as hostile. */
const MAX_VERIFICATION_ATTEMPTS = 6;

const SIGNATORY_TYPES = ['participant', 'representative', 'witness'];

/**
 * A fresh token and its stored hash.
 *
 * base64url so it survives an email client, a copy-paste and a URL without
 * escaping. 32 bytes → 43 characters.
 */
function mintToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/** Constant-time hash comparison. */
function tokensMatch(presentedHash, storedHash) {
  const a = Buffer.from(String(presentedHash || ''), 'utf8');
  const b = Buffer.from(String(storedHash || ''), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Is the email the recipient presented the one this session was issued to?
 *
 * Compared case-insensitively on the trimmed string, and in constant time. The
 * local part of an address is technically case-sensitive; treating it that way
 * would lock out a participant who typed their own address with a capital
 * letter, which is a worse outcome than the theoretical collision it prevents.
 */
function recipientMatches(presented, stored) {
  const norm = (s) => String(s || '').trim().toLowerCase();
  const a = Buffer.from(norm(presented), 'utf8');
  const b = Buffer.from(norm(stored), 'utf8');
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * The tags a signatory of this type may write.
 *
 * A witness may write ONLY the witness block. A representative may write
 * everything a participant may, because they are completing the form on the
 * participant's behalf — that is what representation means — but neither may
 * touch a rate, a support description or the provider's signatory.
 */
function assignedTagsFor(signatoryType) {
  if (signatoryType === 'witness') {
    return ['OPAL_WITNESS_NAME', 'OPAL_WITNESS_SIGNATURE', 'OPAL_WITNESS_SIGNED_DATE'];
  }
  return map.PARTICIPANT_EDITABLE_TAGS.filter(
    (t) => !['OPAL_WITNESS_SIGNATURE', 'OPAL_WITNESS_SIGNED_DATE'].includes(t)
  );
}

/** Expiry as an absolute instant, clamped to something defensible. */
function expiryFrom(now, days) {
  const d = Number.isFinite(Number(days)) ? Number(days) : DEFAULT_EXPIRY_DAYS;
  const clamped = Math.min(MAX_EXPIRY_DAYS, Math.max(MIN_EXPIRY_DAYS, Math.round(d)));
  return new Date(now.getTime() + clamped * 24 * 60 * 60 * 1000);
}

/**
 * Why a session cannot be used, or null when it can.
 *
 * Returns a REASON CODE, never a message: the route decides how much to tell
 * an anonymous caller, and the honest answer is "this link cannot be used" for
 * every case. Distinguishing "revoked" from "expired" from "never existed" in
 * a public response tells somebody probing tokens which of their guesses was
 * close.
 */
function sessionUnusableReason(session, now = new Date()) {
  if (!session) return 'not_found';
  if (session.status === 'revoked') return 'revoked';
  if (session.status === 'completed') return 'completed';
  if (session.status === 'expired') return 'expired';
  if (session.expires_at && new Date(session.expires_at).getTime() <= now.getTime()) return 'expired';
  if ((session.verification_attempts || 0) >= MAX_VERIFICATION_ATTEMPTS) return 'locked';
  return null;
}

/**
 * Keep only the values this session is allowed to write.
 *
 * Returns `{ accepted, rejected }`. A rejected tag is not an error the
 * participant sees — a browser posting a field it was not given is either a
 * bug or an attack, and in both cases the right behaviour is to drop it and
 * carry on rather than fail the whole submission and lose the fields that were
 * legitimate.
 */
function filterSubmission(values, assignedTags) {
  const allowed = new Set(Array.isArray(assignedTags) ? assignedTags : []);
  const accepted = {};
  const rejected = [];

  for (const [tag, raw] of Object.entries(values || {})) {
    if (!map.SCALAR_BY_TAG[tag]) { rejected.push(tag); continue; }
    if (!allowed.has(tag)) { rejected.push(tag); continue; }
    accepted[tag] = raw;
  }
  return { accepted, rejected };
}

/**
 * The signature values a completed session contributes.
 *
 * This is the ONLY function in the codebase that produces e-sign-authority
 * values, and it produces them from the SESSION — the typed name, the recorded
 * capacity and the server's own clock — never from anything the browser sent
 * as a signature field. That is what makes "a signature cannot arrive on an
 * ordinary form save" a structural fact rather than a rule somebody remembered
 * to apply.
 */
function signatureValuesFor(session, signedAt, formatDate) {
  const when = formatDate(signedAt);
  const name = String(session.signature_name || session.recipient_name || '').trim();

  if (session.signatory_type === 'witness') {
    return {
      OPAL_WITNESS_SIGNATURE: name,
      OPAL_WITNESS_SIGNED_DATE: when,
    };
  }
  return {
    OPAL_PARTICIPANT_SIGNATURE: name,
    OPAL_PARTICIPANT_SIGNED_DATE: when,
  };
}

/**
 * What is recorded about how a signature was made.
 *
 * Deliberately modest. It records intent, capacity, when, from where and
 * against which bytes — and it does NOT claim the signature was
 * cryptographically verified, because it was not. Calling a typed name a
 * digital signature in an audit record is the kind of overstatement that only
 * surfaces when somebody disputes the agreement.
 */
function signatureMetadata({ ip, userAgent, signedAt, documentSha256, capacity, intent }) {
  return {
    method: 'portal_typed_signature',
    cryptographicallyVerified: false,
    intentConfirmed: intent === true,
    capacity: capacity ? String(capacity).slice(0, 120) : null,
    signedAt: signedAt instanceof Date ? signedAt.toISOString() : String(signedAt || ''),
    documentSha256: documentSha256 || null,
    ip: ip ? String(ip).slice(0, 60) : null,
    userAgent: userAgent ? String(userAgent).slice(0, 250) : null,
  };
}

/** `${APP_BASE_URL}/service-agreement-sign?token=…` */
function buildSigningUrl(baseUrl, token) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  return `${base}/service-agreement-sign?token=${encodeURIComponent(token)}`;
}

module.exports = {
  mintToken,
  hashToken,
  tokensMatch,
  recipientMatches,
  assignedTagsFor,
  expiryFrom,
  sessionUnusableReason,
  filterSubmission,
  signatureValuesFor,
  signatureMetadata,
  buildSigningUrl,
  SIGNATORY_TYPES,
  DEFAULT_EXPIRY_DAYS,
  MAX_EXPIRY_DAYS,
  MIN_EXPIRY_DAYS,
  MAX_VERIFICATION_ATTEMPTS,
};
