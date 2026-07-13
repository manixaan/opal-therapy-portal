'use strict';

/**
 * Full-stack regression tests for the Phase-4 defect repairs — real Express
 * routes, real sessions, real SQL. Each test here pins a bug that previously
 * shipped behind green (mocked) tests:
 *
 *   1. Change Password crashed with MODULE_NOT_FOUND (bcrypt vs bcryptjs)
 *   2. GET /api/admin/users failed on the phantom users.has_outlook_connected
 *   3. read_only users could not be invited (VALID_ROLES omission)
 *   4. "Sync now" reported success without running anything
 *   5. /auth/outlook-login is the real OAuth entry (onboarding was calling a
 *      route that never existed)
 *   6. base-location notification check queried a non-existent column
 */

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { db, truncateAll, seedUser, seedOrganisation, closePool } = require('./helpers');

function buildRealApp({ forceSyncRunner } = {}) {
  const app = express();
  app.use(bodyParser.json());
  app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true },
  }));
  if (forceSyncRunner) app.set('forceSyncRunner', forceSyncRunner);
  app.use('/', require('../../auth'));
  app.use('/', require('../../routes'));
  app.use('/', require('../../app-routes'));
  app.use('/', require('../../invite-routes'));
  return app;
}

const PASSWORD = 'IntegrationPass1';

async function seedLoginUser(overrides = {}) {
  const hash = await bcrypt.hash(PASSWORD, 4); // low cost for test speed only
  return seedUser({ password_hash: hash, ...overrides });
}

async function loginAgent(app, email) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return agent;
}

beforeEach(truncateAll);
afterAll(closePool);

describe('Fix 1 — change password uses bcryptjs', () => {
  test('wrong current password → 400; correct → 200, new hash verifies, audit written', async () => {
    const app = buildRealApp();
    const user = await seedLoginUser();
    const agent = await loginAgent(app, user.email);

    const bad = await agent.post('/api/auth/change-password')
      .send({ currentPassword: 'WrongPass1', newPassword: 'NewPassword1' });
    expect(bad.status).toBe(400); // was 500 MODULE_NOT_FOUND before the fix

    const good = await agent.post('/api/auth/change-password')
      .send({ currentPassword: PASSWORD, newPassword: 'NewPassword1' });
    expect(good.status).toBe(200);
    expect(good.body.ok).toBe(true);

    const { rows } = await db.pool.query('SELECT password_hash FROM users WHERE id=$1', [user.id]);
    expect(await bcrypt.compare('NewPassword1', rows[0].password_hash)).toBe(true);

    const audit = await db.pool.query(
      "SELECT COUNT(*) FROM audit_logs WHERE action='password.changed' AND actor_user_id=$1", [user.id]);
    expect(Number(audit.rows[0].count)).toBe(1);
  });
});

describe('Fix 2 — owner user-management listing', () => {
  test('GET /api/admin/users returns rows with derived has_outlook (no phantom column)', async () => {
    const app = buildRealApp();
    const owner = await seedLoginUser({ role: 'owner' });
    await seedUser({ role: 'therapist' });
    const agent = await loginAgent(app, owner.email);

    const res = await agent.get('/api/admin/users');
    expect(res.status).toBe(200); // was 500: column u.has_outlook_connected does not exist
    expect(res.body.users.length).toBe(2);
    const me = res.body.users.find(u => u.id === owner.id);
    expect(me.hasOutlook).toBe(false); // derived from access_token, not the phantom column
  });

  test('therapist is refused (403)', async () => {
    const app = buildRealApp();
    const t = await seedLoginUser({ role: 'therapist' });
    const agent = await loginAgent(app, t.email);
    const res = await agent.get('/api/admin/users');
    expect(res.status).toBe(403);
  });
});

describe('Fix 3 — read_only invitations', () => {
  test('owner can invite a read_only user (row persisted with role)', async () => {
    const app = buildRealApp();
    const org = await seedOrganisation();
    const owner = await seedLoginUser({ role: 'owner' });
    await db.pool.query('UPDATE users SET organisation_id=$1 WHERE id=$2', [org.id, owner.id]);
    const agent = await loginAgent(app, owner.email);

    const res = await agent.post('/api/invites')
      .send({ email: 'viewer@test.invalid', role: 'read_only' });
    expect(res.status).toBe(201); // was 400: role must be one of owner, admin, therapist
    expect(res.body.invite.role).toBe('read_only');
    expect(res.body.invite.invite_token).toBeUndefined(); // token never exposed

    const { rows } = await db.pool.query(
      "SELECT role, status FROM user_invites WHERE email='viewer@test.invalid'");
    expect(rows[0]).toMatchObject({ role: 'read_only', status: 'pending' });
  });

  test('admin can invite read_only but not owner', async () => {
    const app = buildRealApp();
    const org = await seedOrganisation();
    const admin = await seedLoginUser({ role: 'admin' });
    await db.pool.query('UPDATE users SET organisation_id=$1 WHERE id=$2', [org.id, admin.id]);
    const agent = await loginAgent(app, admin.email);

    const ok = await agent.post('/api/invites')
      .send({ email: 'viewer2@test.invalid', role: 'read_only' });
    expect(ok.status).toBe(201);

    const refused = await agent.post('/api/invites')
      .send({ email: 'boss@test.invalid', role: 'owner' });
    expect(refused.status).toBe(403);
  });
});

describe('Fix 4 — force sync executes and reports stats', () => {
  test('owner gets real stats from the injected runner; audit row written', async () => {
    let ran = 0;
    const app = buildRealApp({
      forceSyncRunner: async () => {
        ran++;
        return { usersProcessed: 2, upserted: 5, cancelled: 1, removed: 0, blockedDeletions: 0, warnings: [], errors: [] };
      },
    });
    const owner = await seedLoginUser({ role: 'owner' });
    const agent = await loginAgent(app, owner.email);

    const res = await agent.post('/api/sync/force');
    expect(res.status).toBe(200);
    expect(ran).toBe(1); // previously reported ok without executing anything
    expect(res.body).toMatchObject({
      ok: true, completed: true, usersProcessed: 2,
      eventsCreatedOrUpdated: 5, eventsCancelled: 1, eventsDeleted: 0,
    });

    const audit = await db.pool.query(
      "SELECT COUNT(*) FROM audit_logs WHERE action='sync.manual_triggered'");
    expect(Number(audit.rows[0].count)).toBe(1);
  });

  test('therapist is refused (403) and the runner never fires', async () => {
    let ran = 0;
    const app = buildRealApp({ forceSyncRunner: async () => { ran++; return {}; } });
    const t = await seedLoginUser({ role: 'therapist' });
    const agent = await loginAgent(app, t.email);
    const res = await agent.post('/api/sync/force');
    expect(res.status).toBe(403);
    expect(ran).toBe(0);
  });
});

describe('Fix 5 — the real OAuth entry route used by onboarding', () => {
  test('GET /auth/outlook-login returns authUrl with encoded returnUrl in state', async () => {
    const app = buildRealApp();
    const res = await request(app)
      .get('/auth/outlook-login')
      .query({ returnUrl: 'http://localhost:5001/onboarding?step=4' });
    expect(res.status).toBe(200);
    expect(res.body.authUrl).toContain('login.microsoftonline.com');
    expect(res.body.authUrl).toContain('client_id=');
    expect(res.body.authUrl).toContain('state=');
    // returnUrl round-trips base64-encoded inside state (csrf|base64)
    const state = new URL(res.body.authUrl).searchParams.get('state');
    const encoded = state.split('|')[1];
    expect(Buffer.from(encoded, 'base64').toString('utf8')).toBe('http://localhost:5001/onboarding?step=4');
  });
});

describe('Fix 6 — base-location notification uses users.default_work_location', () => {
  test('fires for a user without a base location, not for one with it', async () => {
    const app = buildRealApp();

    const without = await seedLoginUser();
    const agentA = await loginAgent(app, without.email);
    await agentA.get('/api/notifications');
    const a = await db.pool.query(
      "SELECT COUNT(*) FROM user_notifications WHERE user_id=$1 AND type='profile_missing_base_location'",
      [without.id]);
    expect(Number(a.rows[0].count)).toBe(1); // previously the check threw and NEVER fired

    const withLoc = await seedLoginUser();
    await db.pool.query(
      `UPDATE users SET default_work_location = '{"office":{"addr":"1 Test St, Perth"}}'::jsonb WHERE id=$1`,
      [withLoc.id]);
    const agentB = await loginAgent(app, withLoc.email);
    await agentB.get('/api/notifications');
    const b = await db.pool.query(
      "SELECT COUNT(*) FROM user_notifications WHERE user_id=$1 AND type='profile_missing_base_location'",
      [withLoc.id]);
    expect(Number(b.rows[0].count)).toBe(0);
  });
});

describe('approval audit (was a silent pool.logAuditEvent?. no-op)', () => {
  test('approving a pending user writes account.approved audit', async () => {
    const app = buildRealApp();
    const owner = await seedLoginUser({ role: 'owner' });
    const pending = await seedUser({ account_status: 'pending_approval' });
    const agent = await loginAgent(app, owner.email);

    const res = await agent.patch(`/api/admin/users/${pending.id}/approve`);
    expect(res.status).toBe(200);

    const audit = await db.pool.query(
      "SELECT COUNT(*) FROM audit_logs WHERE action='account.approved' AND target_id=$1",
      [pending.id]);
    expect(Number(audit.rows[0].count)).toBe(1);
  });
});
