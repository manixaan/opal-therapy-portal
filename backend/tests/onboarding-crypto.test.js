'use strict';

/**
 * ONBOARDING FIELD ENCRYPTION — unit tests.
 *
 * The property that matters most here is the one crypto-utils deliberately does
 * NOT have: this module FAILS CLOSED. An OAuth token stored in plaintext on a
 * dev box is a nuisance; a tax file number stored in plaintext cannot be
 * un-disclosed, so outside development the absence of a key must be a refusal.
 */

const KEY_A = 'ab'.repeat(32);
const KEY_B = 'cd'.repeat(32);

/** Reload the module with a fresh env — its key is cached per process. */
function freshModule(env) {
  jest.resetModules();
  const saved = {
    ONBOARDING_ENCRYPTION_KEY: process.env.ONBOARDING_ENCRYPTION_KEY,
    ONBOARDING_ENCRYPTION_KEY_PREVIOUS: process.env.ONBOARDING_ENCRYPTION_KEY_PREVIOUS,
    TOKEN_ENCRYPTION_KEY: process.env.TOKEN_ENCRYPTION_KEY,
    NODE_ENV: process.env.NODE_ENV,
  };
  for (const k of Object.keys(saved)) delete process.env[k];
  Object.assign(process.env, env);
  const mod = require('../onboarding-crypto');
  return { mod, restore: () => { Object.assign(process.env, saved); } };
}

afterEach(() => { jest.resetModules(); });

// ═════════════════════════════════════════════════════════════════════════════

describe('round trip', () => {
  test('a value encrypts and decrypts back', () => {
    const { mod, restore } = freshModule({ ONBOARDING_ENCRYPTION_KEY: KEY_A, NODE_ENV: 'test' });
    const ct = mod.encryptField('123456782');
    expect(ct).toMatch(/^obenc:/);
    expect(ct).not.toContain('123456782');
    expect(mod.decryptField(ct)).toBe('123456782');
    expect(mod.isEncrypted(ct)).toBe(true);
    restore();
  });

  test('the same plaintext encrypts differently each time', () => {
    const { mod, restore } = freshModule({ ONBOARDING_ENCRYPTION_KEY: KEY_A, NODE_ENV: 'test' });
    // A fresh IV per write: identical bank accounts must not be correlatable
    // by comparing ciphertext.
    expect(mod.encryptField('12345678')).not.toBe(mod.encryptField('12345678'));
    restore();
  });

  test('empty values pass through as null', () => {
    const { mod, restore } = freshModule({ ONBOARDING_ENCRYPTION_KEY: KEY_A, NODE_ENV: 'test' });
    expect(mod.encryptField(null)).toBeNull();
    expect(mod.encryptField(undefined)).toBeNull();
    expect(mod.encryptField('')).toBeNull();
    expect(mod.decryptField(null)).toBeNull();
    restore();
  });

  test('a plain value that was never encrypted is returned unchanged', () => {
    const { mod, restore } = freshModule({ ONBOARDING_ENCRYPTION_KEY: KEY_A, NODE_ENV: 'test' });
    expect(mod.decryptField('legacy-plaintext')).toBe('legacy-plaintext');
    restore();
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('fail closed', () => {
  test('production REFUSES to store a sensitive value without a key', () => {
    const { mod, restore } = freshModule({ NODE_ENV: 'production' });
    expect(() => mod.encryptField('123456782')).toThrow(/not configured/i);
    try { mod.encryptField('123456782'); } catch (err) {
      expect(err.code).toBe('ENCRYPTION_UNAVAILABLE');
    }
    expect(mod.isEncryptionConfigured()).toBe(false);
    restore();
  });

  test('staging refuses too', () => {
    const { mod, restore } = freshModule({ NODE_ENV: 'staging' });
    expect(() => mod.encryptField('123456782')).toThrow(/not configured/i);
    restore();
  });

  test('development stores a clearly-marked value rather than silent plaintext', () => {
    const { mod, restore } = freshModule({ NODE_ENV: 'development' });
    const stored = mod.encryptField('123456782');
    // The marker makes an accidentally-promoted dev row obvious rather than
    // letting it pass as ciphertext.
    expect(stored).toBe('devplain:123456782');
    expect(mod.isEncrypted(stored)).toBe(false);
    expect(mod.decryptField(stored)).toBe('123456782');
    restore();
  });

  test('a malformed key is rejected rather than silently truncated', () => {
    const { mod, restore } = freshModule({ ONBOARDING_ENCRYPTION_KEY: 'tooshort', NODE_ENV: 'test' });
    expect(() => mod.encryptField('x')).toThrow(/64 hex/i);
    restore();
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('key separation and rotation', () => {
  test('the OAuth key is used only as a fallback', () => {
    const { mod, restore } = freshModule({ TOKEN_ENCRYPTION_KEY: KEY_A, NODE_ENV: 'test' });
    const ct = mod.encryptField('123456782');
    expect(mod.decryptField(ct)).toBe('123456782');
    expect(mod.isEncryptionConfigured()).toBe(true);
    restore();
  });

  test('the dedicated key takes precedence over the OAuth key', () => {
    const { mod, restore } = freshModule({
      ONBOARDING_ENCRYPTION_KEY: KEY_B, TOKEN_ENCRYPTION_KEY: KEY_A, NODE_ENV: 'test',
    });
    const ct = mod.encryptField('123456782');
    restore();

    // Written with KEY_B, so KEY_A alone cannot read it.
    const only = freshModule({ ONBOARDING_ENCRYPTION_KEY: KEY_A, NODE_ENV: 'test' });
    expect(only.mod.decryptField(ct)).toBeNull();
    only.restore();
  });

  test('a previous key keeps reads working across a rotation', () => {
    const first = freshModule({ ONBOARDING_ENCRYPTION_KEY: KEY_A, NODE_ENV: 'test' });
    const ct = first.mod.encryptField('123456782');
    first.restore();

    // After rotating to KEY_B, the old ciphertext is still readable while the
    // re-encryption pass runs.
    const rotated = freshModule({
      ONBOARDING_ENCRYPTION_KEY: KEY_B,
      ONBOARDING_ENCRYPTION_KEY_PREVIOUS: KEY_A,
      NODE_ENV: 'test',
    });
    expect(rotated.mod.decryptField(ct)).toBe('123456782');
    // …and new writes use the new key.
    const fresh = rotated.mod.encryptField('999');
    expect(rotated.mod.decryptField(fresh)).toBe('999');
    rotated.restore();
  });

  test('an undecryptable value returns null, never a partial or garbled value', () => {
    const { mod, restore } = freshModule({ ONBOARDING_ENCRYPTION_KEY: KEY_A, NODE_ENV: 'test' });
    expect(mod.decryptField('obenc:deadbeef:cafebabe:0011')).toBeNull();
    expect(mod.decryptField('obenc:not-enough-parts')).toBeNull();
    restore();
  });

  test('tampered ciphertext fails authentication rather than decrypting', () => {
    const { mod, restore } = freshModule({ ONBOARDING_ENCRYPTION_KEY: KEY_A, NODE_ENV: 'test' });
    const ct = mod.encryptField('123456782');
    // Flip the last hex character of the ciphertext body — GCM must reject it.
    const tampered = ct.slice(0, -1) + (ct.slice(-1) === '0' ? '1' : '0');
    expect(mod.decryptField(tampered)).toBeNull();
    restore();
  });
});
