'use strict';

/**
 * ONBOARDING FIELD ENCRYPTION
 *
 * A thin, deliberately stricter wrapper around crypto-utils' AES-256-GCM so
 * that tax file numbers, bank details and identity document numbers are
 * encrypted at rest.
 *
 * WHY THIS EXISTS RATHER THAN CALLING crypto-utils DIRECTLY
 * ─────────────────────────────────────────────────────────
 * crypto-utils.encrypt() PASSES THROUGH unchanged when no key is configured.
 * That is the right behaviour for an OAuth token — a dev box without a key
 * still works, and the value is short-lived and re-issuable. It is the wrong
 * behaviour for a TFN: silently writing one in plaintext is exactly the
 * failure this feature must not have, and unlike a token it can never be
 * un-disclosed.
 *
 * So this module FAILS CLOSED. Outside development and test, storing a
 * sensitive onboarding value without a configured key throws, and the route
 * turns that into an honest 503 telling the Owner that encryption is not
 * configured — rather than accepting the data and quietly storing it in clear.
 *
 * KEY SOURCE AND ROTATION
 * ───────────────────────
 * ONBOARDING_ENCRYPTION_KEY (64 hex chars = 32 bytes) is the key. It is
 * SEPARATE from TOKEN_ENCRYPTION_KEY on purpose: OAuth tokens are rotated
 * routinely and re-obtained by re-authenticating, whereas HR ciphertext must
 * survive. Sharing one key would mean an OAuth key rotation permanently
 * destroyed every stored TFN and bank detail.
 *
 * Rotation story: values are re-encryptable because every write goes through
 * this module and every read through decryptField(). To rotate, set
 * ONBOARDING_ENCRYPTION_KEY_PREVIOUS to the old key, deploy, and run the
 * re-encryption pass (scripts/onboarding-rekey.js); decryptField() accepts
 * either key during the overlap so no read fails mid-migration.
 *
 * WHAT IS AND IS NOT ENCRYPTED
 * ────────────────────────────
 * Encrypted:  TFN, BSB, bank account number, SMSF bank details, passport /
 *             citizenship / visa document numbers.
 * Not:        names, addresses, dates of birth, fund names, member numbers.
 *             Those are ordinary personal information protected by access
 *             control; encrypting them would defeat search and sorting for no
 *             meaningful gain, since anyone able to read the row can read the
 *             plaintext either way.
 */

const crypto = require('crypto');
const log = require('./logger').createLogger('onboarding-crypto');

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const PREFIX = 'obenc:';

let _warned = false;

function devLike() {
  const env = process.env.NODE_ENV || 'development';
  return env === 'development' || env === 'test';
}

function parseKey(hex, label) {
  if (!hex) return null;
  if (String(hex).length !== 64) {
    throw new Error(`${label} must be exactly 64 hex characters (32 bytes)`);
  }
  return Buffer.from(String(hex), 'hex');
}

/**
 * The active key, or null.
 *
 * Falls back to TOKEN_ENCRYPTION_KEY ONLY when the dedicated key is unset, and
 * says so loudly once. The fallback keeps existing staging deployments working
 * the day this ships; the warning is what gets the dedicated key provisioned.
 */
function activeKey() {
  const own = parseKey(process.env.ONBOARDING_ENCRYPTION_KEY, 'ONBOARDING_ENCRYPTION_KEY');
  if (own) return own;

  const shared = parseKey(process.env.TOKEN_ENCRYPTION_KEY, 'TOKEN_ENCRYPTION_KEY');
  if (shared) {
    if (!_warned) {
      _warned = true;
      log.warn('ONBOARDING_ENCRYPTION_KEY is not set — falling back to TOKEN_ENCRYPTION_KEY. '
        + 'Provision a dedicated key: rotating the OAuth token key would otherwise make every '
        + 'stored tax and bank value permanently unreadable.');
    }
    return shared;
  }
  return null;
}

function previousKeys() {
  const out = [];
  for (const name of ['ONBOARDING_ENCRYPTION_KEY_PREVIOUS', 'TOKEN_ENCRYPTION_KEY']) {
    try {
      const k = parseKey(process.env[name], name);
      if (k) out.push(k);
    } catch (_) { /* a malformed previous key must not break reads */ }
  }
  return out;
}

/** True when sensitive onboarding values can be stored safely. */
function isEncryptionConfigured() {
  try { return activeKey() !== null; } catch (_) { return false; }
}

/**
 * Encrypt one sensitive field.
 *
 * @throws {EncryptionUnavailableError} outside dev/test when no key is set.
 */
function encryptField(plaintext) {
  if (plaintext === null || plaintext === undefined || plaintext === '') return null;

  const key = activeKey();
  if (!key) {
    if (devLike()) {
      // Development convenience ONLY, and it never produces something that
      // looks encrypted: the marker makes an accidentally-promoted dev row
      // obvious rather than passing silently as ciphertext.
      if (!_warned) {
        _warned = true;
        log.warn('No onboarding encryption key configured — sensitive fields are stored '
          + 'with a DEV-PLAINTEXT marker. This is refused outside development.');
      }
      return `devplain:${String(plaintext)}`;
    }
    const err = new Error('Onboarding field encryption is not configured');
    err.code = 'ENCRYPTION_UNAVAILABLE';
    throw err;
  }

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + iv.toString('hex') + ':' + tag.toString('hex') + ':' + enc.toString('hex');
}

function tryDecrypt(key, ivHex, tagHex, ctHex) {
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return decipher.update(Buffer.from(ctHex, 'hex'), undefined, 'utf8') + decipher.final('utf8');
}

/**
 * Decrypt a value produced by encryptField().
 *
 * Tries the active key, then any previous key, so a rotation overlap does not
 * break reads. Returns null (never a partial or garbled value) when the value
 * cannot be decrypted with any key — a caller must treat that as "unavailable",
 * not as "empty".
 */
function decryptField(value) {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value);

  if (s.startsWith('devplain:')) return s.slice('devplain:'.length);
  if (!s.startsWith(PREFIX)) return s; // never encrypted (legacy / plain column)

  const parts = s.slice(PREFIX.length).split(':');
  if (parts.length !== 3) return null;

  const candidates = [];
  try { const a = activeKey(); if (a) candidates.push(a); } catch (_) { /* fall through */ }
  candidates.push(...previousKeys());

  for (const key of candidates) {
    try { return tryDecrypt(key, parts[0], parts[1], parts[2]); } catch (_) { /* next key */ }
  }
  log.error('Onboarding value could not be decrypted with any configured key');
  return null;
}

/** True when a stored column value is in this module's ciphertext form. */
function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

module.exports = {
  encryptField,
  decryptField,
  isEncrypted,
  isEncryptionConfigured,
  PREFIX,
};
