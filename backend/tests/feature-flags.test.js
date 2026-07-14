'use strict';

/**
 * Feature-flag unit tests (Phase 10) — resolution matrix and module-boundary
 * write guards. The fail-safe property under test: in staging/production an
 * UNSET flag means OFF; in development/test it means ON.
 */

const ORIGINAL_ENV = { ...process.env };

function freshFlags(env) {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };
  delete process.env.ENABLE_OUTLOOK_WRITE;
  delete process.env.ENABLE_SPLOSE_WRITE;
  delete process.env.ENABLE_AUTOMATIC_REMOTE_DELETE;
  Object.assign(process.env, env);
  return require('../feature-flags');
}

afterEach(() => { process.env = { ...ORIGINAL_ENV }; jest.resetModules(); });

describe('flag resolution matrix', () => {
  test('unset flags default ON in development and test', () => {
    for (const NODE_ENV of ['development', 'test']) {
      const f = freshFlags({ NODE_ENV });
      expect(f.isOutlookWriteEnabled()).toBe(true);
      expect(f.isSploseWriteEnabled()).toBe(true);
      expect(f.isAutomaticRemoteDeleteEnabled()).toBe(true);
    }
  });

  test('unset flags default OFF in staging and production (fail-safe)', () => {
    for (const NODE_ENV of ['staging', 'production']) {
      const f = freshFlags({ NODE_ENV });
      expect(f.isOutlookWriteEnabled()).toBe(false);
      expect(f.isSploseWriteEnabled()).toBe(false);
      expect(f.isAutomaticRemoteDeleteEnabled()).toBe(false);
    }
  });

  test('explicit values override the environment default in both directions', () => {
    const on = freshFlags({ NODE_ENV: 'production', ENABLE_OUTLOOK_WRITE: 'true' });
    expect(on.isOutlookWriteEnabled()).toBe(true);
    expect(on.isSploseWriteEnabled()).toBe(false); // still off — flags are independent

    const off = freshFlags({ NODE_ENV: 'development', ENABLE_SPLOSE_WRITE: 'false' });
    expect(off.isSploseWriteEnabled()).toBe(false);
    expect(off.isOutlookWriteEnabled()).toBe(true);
  });

  test('anything other than the string "true" is OFF when set', () => {
    const f = freshFlags({ NODE_ENV: 'production', ENABLE_OUTLOOK_WRITE: 'yes' });
    expect(f.isOutlookWriteEnabled()).toBe(false);
  });

  test('featureFlagState reports all three flags', () => {
    const f = freshFlags({ NODE_ENV: 'staging', ENABLE_OUTLOOK_WRITE: 'true' });
    expect(f.featureFlagState()).toEqual({
      outlookWrite: true, sploseWrite: false, automaticRemoteDelete: false,
    });
  });
});

describe('module-boundary write guards', () => {
  test('outlook write functions throw FEATURE_DISABLED when the flag is off', async () => {
    freshFlags({ NODE_ENV: 'test', ENABLE_OUTLOOK_WRITE: 'false' });
    const outlook = require('../outlook-oauth');
    for (const call of [
      () => outlook.createOutlookEvent('tok', { title: 'x' }),
      () => outlook.updateOutlookEvent('tok', 'id', { title: 'x' }),
      () => outlook.deleteOutlookEvent('tok', 'id'),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: 'FEATURE_DISABLED', flag: 'ENABLE_OUTLOOK_WRITE' });
    }
  });

  test('splose write functions throw FEATURE_DISABLED when the flag is off', async () => {
    freshFlags({ NODE_ENV: 'test', ENABLE_SPLOSE_WRITE: 'false' });
    const splose = require('../splose-api');
    await expect(splose.createAppointment({ start: 'x' }))
      .rejects.toMatchObject({ code: 'FEATURE_DISABLED', flag: 'ENABLE_SPLOSE_WRITE' });
    await expect(splose.updateAppointment('id', {}))
      .rejects.toMatchObject({ code: 'FEATURE_DISABLED', flag: 'ENABLE_SPLOSE_WRITE' });
  });

  test('error message names the flag and never contains credentials', () => {
    const f = freshFlags({ NODE_ENV: 'production' });
    const err = f.featureDisabledError('ENABLE_OUTLOOK_WRITE', 'Outlook write-back');
    expect(err.message).toContain('ENABLE_OUTLOOK_WRITE');
    expect(err.message).not.toMatch(/key|token|password|secret/i);
  });
});
