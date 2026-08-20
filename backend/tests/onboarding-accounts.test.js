'use strict';

/**
 * ACCOUNT PROVISIONING — the temporary credential and the gate that ends it.
 *
 * This is the one part of the onboarding workflow that hands somebody a way
 * into the practice, so the properties below are the ones that actually
 * matter:
 *
 *   - a generated password always satisfies the portal's OWN policy, because
 *     a credential the change-password screen would reject is a credential
 *     nobody can replace;
 *   - it comes from a CSPRNG, is drawn uniformly, and does not repeat;
 *   - onboarding can never mint an Owner, whatever a client sends;
 *   - the forced-change gate is a path allowlist matched on whole segments,
 *     so "/api/auth/change-password-evil" is not "/api/auth/change-password";
 *   - the gate is checked BEFORE the pre-employee one, because a new starter
 *     created this way holds both conditions at once.
 */

const crypto = require('crypto');
const accounts = require('../onboarding-accounts');
const { validatePassword } = require('../auth');
const {
  isPasswordChangePath, isPreEmployeePath, PASSWORD_CHANGE_PATHS,
} = require('../permissions');

// ═════════════════════════════════════════════════════════════════════════════
//  THE TEMPORARY PASSWORD
// ═════════════════════════════════════════════════════════════════════════════

describe('generateTemporaryPassword', () => {
  test('ALWAYS satisfies the portal password policy', () => {
    // If this ever fails, a new starter receives a password that the screen
    // they are forced onto refuses — locked out on their first day, with the
    // only remedy being an Owner who has to notice.
    for (let i = 0; i < 300; i += 1) {
      const pw = accounts.generateTemporaryPassword();
      expect(`${pw}:${validatePassword(pw)}`).toBe(`${pw}:null`);
    }
  });

  test('is long enough to be worth typing but short enough to be typed', () => {
    for (let i = 0; i < 50; i += 1) {
      const pw = accounts.generateTemporaryPassword();
      expect(pw.length).toBeGreaterThanOrEqual(16);
      expect(pw.length).toBeLessThanOrEqual(64);
    }
  });

  test('does not repeat across many draws', () => {
    const seen = new Set();
    for (let i = 0; i < 500; i += 1) seen.add(accounts.generateTemporaryPassword());
    expect(seen.size).toBe(500);
  });

  test('draws from the CSPRNG, not Math.random', () => {
    const spy = jest.spyOn(crypto, 'randomBytes');
    const mathSpy = jest.spyOn(Math, 'random');
    accounts.generateTemporaryPassword();
    expect(spy).toHaveBeenCalled();
    expect(mathSpy).not.toHaveBeenCalled();
    spy.mockRestore();
    mathSpy.mockRestore();
  });

  test('every wordlist entry can actually be drawn', () => {
    // A rejection-sampled pick with an off-by-one would silently make the last
    // word unreachable, quietly shrinking the keyspace.
    const seen = new Set();
    for (let i = 0; i < 40000; i += 1) {
      accounts.generateTemporaryPassword().split('-').slice(0, 4)
        .forEach((w) => seen.add(w.toLowerCase()));
    }
    expect(seen.size).toBe(accounts.WORDS.length);
  });

  test('the wordlist has no duplicates — a duplicate is silent lost entropy', () => {
    expect(new Set(accounts.WORDS).size).toBe(accounts.WORDS.length);
  });

  test('hashing produces a bcrypt hash the login path can verify', async () => {
    const bcrypt = require('bcryptjs');
    const pw = accounts.generateTemporaryPassword();
    const hash = await accounts.hashPassword(pw);
    expect(hash).toMatch(/^\$2[aby]\$12\$/);
    expect(await bcrypt.compare(pw, hash)).toBe(true);
    expect(await bcrypt.compare('wrong', hash)).toBe(false);
  });
});

describe('expiry', () => {
  test('defaults to a week', () => {
    const at = accounts.temporaryPasswordExpiry();
    const days = (at.getTime() - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
  });

  test('a caller cannot ask for an unbounded lifetime', () => {
    const days = (accounts.temporaryPasswordExpiry(9999).getTime() - Date.now()) / 86400000;
    expect(days).toBeLessThanOrEqual(30.1);
  });

  test('a caller cannot ask for zero or a negative lifetime', () => {
    for (const bad of [0, -5, 'x', null]) {
      expect(accounts.temporaryPasswordExpiry(bad).getTime()).toBeGreaterThan(Date.now());
    }
  });

  test('an expired temporary credential is expired', () => {
    expect(accounts.temporaryPasswordExpired({
      password_is_temporary: true,
      temp_password_expires_at: new Date(Date.now() - 1000),
    })).toBe(true);
  });

  test('a live one is not', () => {
    expect(accounts.temporaryPasswordExpired({
      password_is_temporary: true,
      temp_password_expires_at: new Date(Date.now() + 60000),
    })).toBe(false);
  });

  test('a password the USER chose never expires', () => {
    // This portal does not do forced rotation. Treating a chosen password as
    // expirable here would eventually lock out the whole practice.
    expect(accounts.temporaryPasswordExpired({
      password_is_temporary: false,
      temp_password_expires_at: new Date(Date.now() - 999999),
    })).toBe(false);
    expect(accounts.temporaryPasswordExpired(null)).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  PORTAL ROLE
// ═════════════════════════════════════════════════════════════════════════════

describe('resolvePortalRole', () => {
  test('Employee means the ordinary staff role', () => {
    expect(accounts.resolvePortalRole('employee')).toEqual({
      ok: true, key: 'employee', role: 'therapist',
    });
    expect(accounts.resolvePortalRole('Employee').role).toBe('therapist');
    expect(accounts.resolvePortalRole('therapist').role).toBe('therapist');
  });

  test('Admin means admin', () => {
    expect(accounts.resolvePortalRole('admin')).toEqual({
      ok: true, key: 'admin', role: 'admin',
    });
  });

  test('ONBOARDING CAN NEVER MINT AN OWNER', () => {
    // The single most damaging thing a manipulated client-side field could
    // ask for. Refused by name, with a message that says where the real
    // mechanism lives.
    const out = accounts.resolvePortalRole('owner');
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/Owner access cannot be granted/i);
    expect(accounts.resolvePortalRole('OWNER').ok).toBe(false);
    expect(accounts.resolvePortalRole(' Owner ').ok).toBe(false);
  });

  test('an unrecognised value is an ERROR, not a silent default', () => {
    // A fallback here would pick a role nobody chose — which is exactly how
    // somebody ends up with access they were never granted.
    for (const bad of ['read_only', 'pre_employee', 'superuser', '', null, undefined, 42]) {
      expect(accounts.resolvePortalRole(bad).ok).toBe(false);
    }
  });

  test('both offered roles carry a label and an explanation for the Owner', () => {
    for (const key of ['employee', 'admin']) {
      expect(typeof accounts.PORTAL_ROLES[key].label).toBe('string');
      expect(accounts.PORTAL_ROLES[key].description.length).toBeGreaterThan(20);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  EXISTING PEOPLE
// ═════════════════════════════════════════════════════════════════════════════

describe('classifyAccountTarget', () => {
  const assignment = { id: 'a1', user_id: null };

  test('a brand-new email creates', () => {
    expect(accounts.classifyAccountTarget(null, assignment).action).toBe('create');
  });

  test('the pre-employee this onboarding already made is ADOPTED, never duplicated', () => {
    const out = accounts.classifyAccountTarget(
      { id: 'u1', role: 'pre_employee' }, assignment
    );
    expect(out).toEqual({ action: 'adopt', userId: 'u1' });
  });

  test('a retry after a partial success adopts our own subject', () => {
    const out = accounts.classifyAccountTarget(
      { id: 'u1', role: 'therapist' }, { id: 'a1', user_id: 'u1' }
    );
    expect(out).toEqual({ action: 'adopt', userId: 'u1' });
  });

  test('an existing ACTIVE employee is a conflict the Owner must resolve', () => {
    const out = accounts.classifyAccountTarget(
      { id: 'u9', role: 'therapist', name: 'Sam Jones', is_active: true }, assignment
    );
    expect(out.action).toBe('conflict');
    expect(out.reason).toContain('Sam Jones');
  });

  test('an inactive account is a conflict with its OWN remedy', () => {
    const out = accounts.classifyAccountTarget(
      { id: 'u9', role: 'admin', is_active: false }, assignment
    );
    expect(out.action).toBe('conflict');
    expect(out.reason).toMatch(/inactive/i);
  });

  test("another onboarding's pre-employee is a conflict, not a takeover", () => {
    const out = accounts.classifyAccountTarget(
      { id: 'u2', role: 'pre_employee' }, { id: 'a1', user_id: 'u1' }
    );
    expect(out.action).toBe('conflict');
    expect(out.reason).toMatch(/different onboarding/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  THE FORCED-CHANGE GATE
// ═════════════════════════════════════════════════════════════════════════════

describe('the password-change allowlist', () => {
  test('lets a temporary credential reach the change-password endpoint', () => {
    expect(isPasswordChangePath('/api/auth/change-password')).toBe(true);
    expect(isPasswordChangePath('/api/auth/me')).toBe(true);
    expect(isPasswordChangePath('/api/auth/logout')).toBe(true);
  });

  test('lets it reach NOTHING else — not even its own onboarding', () => {
    // The point of the gate: a password two people know must not start
    // filling in a tax form.
    for (const path of [
      '/api/onboarding/me',
      '/api/onboarding/me/requirements/x/form',
      '/api/contacts',
      '/api/events',
      '/api/learning/my',
      '/api/notifications',
      '/api/auth/forgot-password',
    ]) {
      expect(`${path}:${isPasswordChangePath(path)}`).toBe(`${path}:false`);
    }
  });

  test('matches whole SEGMENTS, so a prefix cannot be extended', () => {
    expect(isPasswordChangePath('/api/auth/change-password-evil')).toBe(false);
    expect(isPasswordChangePath('/api/auth/mefoo')).toBe(false);
    // A legitimate sub-path of an allowed one still passes.
    expect(isPasswordChangePath('/api/auth/me/extra')).toBe(true);
  });

  test('a query string cannot smuggle an allowed prefix', () => {
    expect(isPasswordChangePath('/api/contacts?next=/api/auth/change-password')).toBe(false);
  });

  test('the allowlist is as small as it looks', () => {
    // Widening this is a deliberate act. Anything added here is something a
    // shared credential can do.
    expect(PASSWORD_CHANGE_PATHS).toHaveLength(5);
    for (const p of PASSWORD_CHANGE_PATHS) expect(p).toMatch(/^\/(api\/)?auth\//);
  });

  test('is STRICTER than the pre-employee allowlist it runs before', () => {
    // A new starter created through the temporary-password path holds both
    // conditions. The narrower gate has to be the one that decides, so every
    // path it permits must also be one a pre-employee may reach.
    for (const p of PASSWORD_CHANGE_PATHS) {
      expect(`${p}:${isPreEmployeePath(p)}`).toBe(`${p}:true`);
    }
    // And it must genuinely be narrower.
    expect(isPreEmployeePath('/api/onboarding/me')).toBe(true);
    expect(isPasswordChangePath('/api/onboarding/me')).toBe(false);
  });
});
