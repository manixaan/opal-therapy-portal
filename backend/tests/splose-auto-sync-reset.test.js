'use strict';

/**
 * Regression (27 Oct 2026, release gate): notifyQueued reads the person's sync
 * settings (081) before nudging the auto-sync timer. That read is async, and
 * the nudge used to look the auto-sync up AFTER it — so a reset in between
 * (a test's beforeEach, a shutdown) created a brand-new auto-sync whose timer
 * outlived the database pool ("Cannot use a pool after calling end").
 * The instance is now taken before the read: a reset stops it, and the late
 * nudge is a no-op.
 */

let resolveRead;
jest.mock('../database', () => ({
  pool: { query: jest.fn(() => new Promise((r) => { resolveRead = () => r({ rows: [] }); })) },
  logAuditEvent: jest.fn(),
}));
jest.mock('../outlook-oauth', () => ({}));
jest.mock('../splose-api', () => ({ isConfigured: () => true }));

const draftSync = require('../splose-draft-sync');

describe('notifyQueued after a reset', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.ENABLE_SPLOSE_DRAFT_SYNC = 'true';
    process.env.ENABLE_SPLOSE_AUTO_SYNC = 'true';
    process.env.ENABLE_SPLOSE_WRITE = 'true';
  });
  afterEach(() => { process.env = { ...saved }; });

  test('a settings read that finishes after the reset starts no new timer', async () => {
    const spy = jest.spyOn(draftSync, 'createAutoSync');
    const routes = require('../splose-sync-routes');
    expect(routes.notifyQueued('user-1')).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    const instance = spy.mock.results[0].value;
    const touch = jest.spyOn(instance, 'touch');

    routes._resetPublisher();          // stops that instance
    resolveRead();                     // the settings read lands afterwards
    await new Promise((r) => setImmediate(r));

    expect(spy).toHaveBeenCalledTimes(1);           // no second auto-sync created
    expect(touch).toHaveBeenCalledTimes(1);         // the late nudge went to the stopped one
    spy.mockRestore();
  });
});
