/**
 * crypto-utils.js
 *
 * AES-256-GCM symmetric encryption for OAuth tokens stored in the database.
 *
 * Key configuration
 * ─────────────────
 * Set TOKEN_ENCRYPTION_KEY in .env to a 64-character hex string (= 32 bytes).
 * Generate one with:
 *
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * If the env var is absent the module operates in pass-through mode and logs a
 * warning on first use.  This keeps the dev environment functional while making
 * it obvious that encryption is not active.
 *
 * Wire format
 * ───────────
 * Encrypted values are stored as a single colon-delimited string:
 *
 *   <iv 24 hex chars>:<authTag 32 hex chars>:<ciphertext hex>
 *
 * The prefix makes it trivial to detect whether a stored value is already
 * encrypted (starts with "enc:") vs a legacy plaintext token.
 *
 * Backward compatibility
 * ──────────────────────
 * decrypt() checks the "enc:" prefix before attempting to decrypt.  Any value
 * that doesn't carry the prefix is returned as-is so existing tokens in the DB
 * continue to work until they are next refreshed and re-written.
 */

'use strict';

const crypto = require('crypto');

const ALGO      = 'aes-256-gcm';
const IV_BYTES  = 12; // 96-bit IV recommended for GCM
const TAG_BYTES = 16;
const PREFIX    = 'enc:';

let _key    = null;
let _warned = false;

function _getKey() {
  if (_key) return _key;

  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex) {
    if (!_warned) {
      console.warn(
        '⚠️  TOKEN_ENCRYPTION_KEY is not set — OAuth tokens are stored in plain text. ' +
        'Generate a key with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
      );
      _warned = true;
    }
    return null;
  }

  if (hex.length !== 64) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)');
  }

  _key = Buffer.from(hex, 'hex');
  return _key;
}

/**
 * Encrypt a plaintext string.
 * Returns the original string unchanged if TOKEN_ENCRYPTION_KEY is not set.
 *
 * @param  {string} plaintext
 * @returns {string}
 */
function encrypt(plaintext) {
  if (plaintext == null) return plaintext;
  const key = _getKey();
  if (!key) return plaintext; // pass-through when key not configured

  const iv      = crypto.randomBytes(IV_BYTES);
  const cipher  = crypto.createCipheriv(ALGO, key, iv);
  const enc     = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return PREFIX + iv.toString('hex') + ':' + authTag.toString('hex') + ':' + enc.toString('hex');
}

/**
 * Decrypt a value produced by encrypt().
 * Returns the original value unchanged if it doesn't carry the "enc:" prefix
 * (legacy plaintext token) or if TOKEN_ENCRYPTION_KEY is not set.
 *
 * @param  {string} value
 * @returns {string}
 */
function decrypt(value) {
  if (value == null) return value;
  if (!value.startsWith(PREFIX)) return value; // legacy / already plaintext

  const key = _getKey();
  if (!key) {
    // Key absent but value appears encrypted — cannot decrypt, surface the error
    // clearly rather than silently returning garbage.
    throw new Error(
      'TOKEN_ENCRYPTION_KEY is not set but an encrypted token was found in the database. ' +
      'Set TOKEN_ENCRYPTION_KEY to the key used when the token was originally encrypted.'
    );
  }

  const rest    = value.slice(PREFIX.length);
  const parts   = rest.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted token format');

  const iv         = Buffer.from(parts[0], 'hex');
  const authTag    = Buffer.from(parts[1], 'hex');
  const ciphertext = Buffer.from(parts[2], 'hex');

  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);

  return decipher.update(ciphertext, undefined, 'utf8') + decipher.final('utf8');
}

module.exports = { encrypt, decrypt };
