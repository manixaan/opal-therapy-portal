'use strict';

/**
 * Token-encryption contract tests — the exact semantics the sync pollers
 * rely on after the staging "Bearer enc:…" 401 bug:
 *
 *   - encrypt→decrypt round-trips when TOKEN_ENCRYPTION_KEY is set
 *   - decrypt() passes NON-encrypted values through unchanged (so the
 *     defensive decrypt in getValidTokenForUser is a no-op in environments
 *     without the key, and for legacy plaintext rows)
 *   - ciphertext is never mistakable for a raw JWT
 *   - an encrypted value without the key fails loudly, not silently
 */

const ORIGINAL_ENV = { ...process.env };
const KEY = 'ab'.repeat(32); // 64 hex chars

function freshCrypto(env) {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.TOKEN_ENCRYPTION_KEY;
  Object.assign(process.env, env);
  return require('../crypto-utils');
}

afterEach(() => { process.env = { ...ORIGINAL_ENV }; jest.resetModules(); });

describe('with TOKEN_ENCRYPTION_KEY set (staging/production reality)', () => {
  test('encrypt→decrypt round-trips and ciphertext is enc:-prefixed, non-JWT-shaped', () => {
    const { encrypt, decrypt } = freshCrypto({ TOKEN_ENCRYPTION_KEY: KEY });
    const token = 'eyJfakeHeader.eyJfakePayload.signature-material-1234567890';
    const stored = encrypt(token);
    expect(stored.startsWith('enc:')).toBe(true);
    expect(stored).not.toContain(token.slice(0, 12));
    expect(decrypt(stored)).toBe(token);
  });

  test('decrypt passes plaintext (legacy rows) through unchanged', () => {
    const { decrypt } = freshCrypto({ TOKEN_ENCRYPTION_KEY: KEY });
    expect(decrypt('legacy-plaintext-token')).toBe('legacy-plaintext-token');
  });

  test('poller contract: decrypt(encrypt(x)) then decrypt again is stable', () => {
    // getValidTokenForUser may receive an already-decrypted value from a
    // db helper — double-decrypt must not corrupt it.
    const { encrypt, decrypt } = freshCrypto({ TOKEN_ENCRYPTION_KEY: KEY });
    const once = decrypt(encrypt('token-value'));
    expect(decrypt(once)).toBe('token-value');
  });
});

describe('without the key (development passthrough)', () => {
  test('decrypt is an identity function for plaintext', () => {
    const { decrypt } = freshCrypto({});
    expect(decrypt('anything-at-all')).toBe('anything-at-all');
    expect(decrypt(null)).toBe(null);
  });

  test('an enc:-prefixed value without the key fails loudly, never silently', () => {
    const { decrypt } = freshCrypto({});
    expect(() => decrypt('enc:deadbeef:cafebabe:0123')).toThrow();
  });
});
