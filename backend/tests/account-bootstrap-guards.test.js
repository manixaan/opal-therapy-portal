'use strict';

/**
 * Pure guards from the accounts & access hardening (18 Oct 2026):
 *   - bootstrapDecision: who may become the first owner (audit H-4)
 *   - seed-users developmentGuard: the dev seed refuses non-local, non-dev
 *     databases (audit L-9)
 * The route-level behaviour is covered against real SQL in
 * tests/integration/account-access-hardening.itest.js.
 */

jest.mock('../database', () => ({ pool: { query: jest.fn() } }));
jest.mock('../email', () => ({}));
jest.mock('pg', () => ({ Pool: jest.fn(() => ({ query: jest.fn(), end: jest.fn(() => Promise.resolve()) })) }));

const { bootstrapDecision } = require('../register-routes');
const { developmentGuard } = require('../setup/seed-users');

describe('bootstrapDecision', () => {
  test('BOOTSTRAP_OWNER_EMAIL set: only that address (any case, trimmed) may bootstrap, in any environment', () => {
    for (const NODE_ENV of ['production', 'staging', 'development', 'test']) {
      const env = { NODE_ENV, BOOTSTRAP_OWNER_EMAIL: ' Ann@Practice.Example ' };
      expect(bootstrapDecision('ann@practice.example', env).allowed).toBe(true);
      expect(bootstrapDecision('ANN@PRACTICE.EXAMPLE', env).allowed).toBe(true);
      const other = bootstrapDecision('eve@practice.example', env);
      expect(other.allowed).toBe(false);
      expect(other.message).toMatch(/not been set up/);
      expect(bootstrapDecision('', env).allowed).toBe(false);
    }
  });

  test('unset in development keeps the old behaviour (also when NODE_ENV is unset)', () => {
    expect(bootstrapDecision('anyone@practice.example', { NODE_ENV: 'development' }).allowed).toBe(true);
    expect(bootstrapDecision('anyone@practice.example', {}).allowed).toBe(true);
  });

  test.each(['production', 'staging', 'test'])('unset in %s refuses, naming the setting', (NODE_ENV) => {
    const d = bootstrapDecision('anyone@practice.example', { NODE_ENV, BOOTSTRAP_OWNER_EMAIL: '  ' });
    expect(d.allowed).toBe(false);
    expect(d.message).toMatch(/BOOTSTRAP_OWNER_EMAIL/);
  });
});

describe('Outlook delta sync only reads live accounts (audit M-4)', () => {
  test('the per-cycle token query in server.js filters is_active and account_status', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
    const fn = src.slice(src.indexOf('async function runDeltaSyncForAllUsers'));
    const query = fn.slice(0, fn.indexOf('for (const user of result.rows)'));
    expect(query).toMatch(/access_token IS NOT NULL/);
    expect(query).toMatch(/is_active = TRUE/);
    expect(query).toMatch(/account_status = 'active'/);
  });
});

describe('seed-users developmentGuard', () => {
  test('runs only with NODE_ENV=development against localhost / 127.0.0.1', () => {
    expect(developmentGuard({ NODE_ENV: 'development', DB_HOST: 'localhost' })).toBeNull();
    expect(developmentGuard({ NODE_ENV: 'development', DB_HOST: '127.0.0.1' })).toBeNull();
    expect(developmentGuard({ NODE_ENV: 'development' })).toBeNull(); // DB_HOST defaults to localhost
  });

  test.each([
    [{ NODE_ENV: 'production', DB_HOST: 'localhost' }, /NODE_ENV/],
    [{ DB_HOST: 'localhost' }, /NODE_ENV/],
    [{ NODE_ENV: 'test', DB_HOST: 'localhost' }, /NODE_ENV/],
    [{ NODE_ENV: 'development', DB_HOST: 'opal-prod.postgres.database.azure.com' }, /DB_HOST/],
    [{ NODE_ENV: 'development', DB_HOST: '10.0.0.5' }, /DB_HOST/],
  ])('refuses %p', (env, why) => {
    expect(developmentGuard(env)).toMatch(why);
  });
});
