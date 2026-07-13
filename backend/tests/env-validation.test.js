'use strict';

/** Unit tests for boot-time environment validation. */

const { validateEnvironment } = require('../env-validation');

const GOOD_PROD = {
  NODE_ENV: 'production',
  SESSION_SECRET: 'x'.repeat(48),
  TOKEN_ENCRYPTION_KEY: 'a'.repeat(64),
  DB_PASSWORD: 'set',
  ALLOWED_ORIGINS: 'https://portal.example.com.au',
  MICROSOFT_CLIENT_ID: 'id',
  MICROSOFT_CLIENT_SECRET: 'secret',
  MICROSOFT_REDIRECT_URI: 'https://portal.example.com.au/auth/oauth/callback',
  SPLOSE_API_KEY: 'key',
  GOOGLE_MAPS_API_KEY: 'maps',
  EMAIL_HOST: 'smtp.example.com',
  APP_BASE_URL: 'https://portal.example.com.au',
  MICROSOFT_TENANT_ID: 'tenant-guid',
};

describe('validateEnvironment', () => {
  test('complete production config passes with no errors', () => {
    const r = validateEnvironment(GOOD_PROD);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  test('production refuses missing critical vars', () => {
    const r = validateEnvironment({ NODE_ENV: 'production' });
    expect(r.ok).toBe(false);
    const keys = r.errors.map(e => e.key);
    expect(keys).toEqual(expect.arrayContaining([
      'SESSION_SECRET', 'TOKEN_ENCRYPTION_KEY', 'DB_PASSWORD',
      'ALLOWED_ORIGINS', 'MICROSOFT_CLIENT_ID', 'SPLOSE_API_KEY',
    ]));
  });

  test('weak or short SESSION_SECRET fails in production', () => {
    expect(validateEnvironment({ ...GOOD_PROD, SESSION_SECRET: 'changeme' }).ok).toBe(false);
    expect(validateEnvironment({ ...GOOD_PROD, SESSION_SECRET: 'short' }).ok).toBe(false);
  });

  test('TOKEN_ENCRYPTION_KEY must be 64 hex chars', () => {
    expect(validateEnvironment({ ...GOOD_PROD, TOKEN_ENCRYPTION_KEY: 'not-hex' }).ok).toBe(false);
    expect(validateEnvironment({ ...GOOD_PROD, TOKEN_ENCRYPTION_KEY: 'A'.repeat(64) }).ok).toBe(true);
  });

  test('development downgrades critical problems to warnings and still passes', () => {
    const r = validateEnvironment({ NODE_ENV: 'development' });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.warnings.length).toBeGreaterThan(5);
  });

  test('staging is strict like production', () => {
    const r = validateEnvironment({ NODE_ENV: 'staging' });
    expect(r.ok).toBe(false);
  });

  test('webhooks enabled requires a non-default WEBHOOK_CLIENT_STATE', () => {
    const withHookNoState = { ...GOOD_PROD, WEBHOOK_BASE_URL: 'https://portal.example.com.au' };
    expect(validateEnvironment(withHookNoState).ok).toBe(false);

    const withDefaultState = { ...withHookNoState, WEBHOOK_CLIENT_STATE: 'opal-scheduler-webhook' };
    expect(validateEnvironment(withDefaultState).ok).toBe(false);

    const withRealState = { ...withHookNoState, WEBHOOK_CLIENT_STATE: 'a-real-random-secret' };
    expect(validateEnvironment(withRealState).ok).toBe(true);
  });

  test('missing recommended vars warn but never block', () => {
    const noMaps = { ...GOOD_PROD };
    delete noMaps.GOOGLE_MAPS_API_KEY;
    const r = validateEnvironment(noMaps);
    expect(r.ok).toBe(true);
    expect(r.warnings.some(w => w.key === 'GOOGLE_MAPS_API_KEY')).toBe(true);
  });
});
