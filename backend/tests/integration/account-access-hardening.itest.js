'use strict';

/**
 * Accounts & access hardening (audit of 18 Oct 2026) — registration, invites,
 * approval and the first-owner bootstrap, against real SQL.
 *
 *   H-1  an email alone never redeems a pending invite; only the token does
 *   L-1  /check-invite by email reveals neither invites, roles nor accounts
 *        (and is rate limited — M-3)
 *   H-1  Approve refuses pending_verification
 *   M-1  resend renews an expired invite; expiresInDays is clamped to 1–30
 *   C-1  the bootstrap creates the practice organisation when there is none
 *   H-4  the bootstrap is limited to BOOTSTRAP_OWNER_EMAIL outside development
 *   L-2  the onboarding-profile routes go through requireAuth (and L-6)
 *   M-4  suspend / deactivate release the Outlook connection
 *   M-5  a server boot no longer rewrites profile / verification state
 *   M-7  forgot/reset reaches active unverified accounts and clears temp flags
 *
 * Onboarding-side fixes (H-2, H-3, M-2, M-8) live in onboarding.itest.js.
 */

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { db, truncateAll, seedUser, seedOrganisation, closePool } = require('./helpers');

const PASSWORD = 'Harden-Pass-123';

function buildApp() {
  const app = express();
  app.use(bodyParser.json());
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../register-routes'));
  app.use('/', require('../../invite-routes'));
  app.use('/', require('../../app-routes'));
  return app;
}

const ENV_KEYS = ['ALLOWED_EMAILS', 'ALLOWED_DOMAINS', 'BOOTSTRAP_OWNER_EMAIL', 'ORG_NAME', 'NODE_ENV'];
let savedEnv;
let app;

beforeAll(() => { app = buildApp(); });
beforeEach(async () => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  await truncateAll();
  require('../../auth')._resetLoginRateLimit();
  require('../../register-routes')._resetCheckInviteRateLimit();
});
afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});
afterAll(closePool);

const reg = (body) => request(app).post('/api/auth/register')
  .send({ password: PASSWORD, confirmPassword: PASSWORD, profile: { name: 'Some Person' }, ...body });
const countUsers = async (email) => Number((await db.pool.query(
  'SELECT COUNT(*) FROM users WHERE LOWER(email) = LOWER($1)', [email])).rows[0].count);

async function ownerAgent(org) {
  const owner = await seedUser({ role: 'owner', organisation_id: org.id, password_hash: await bcrypt.hash(PASSWORD, 4) });
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: owner.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, owner };
}

// ── H-1 / L-1 ───────────────────────────────────────────────────────────────
describe('invite claim by email (H-1, L-1)', () => {
  test('an email with a pending invite but no token is refused exactly like an unknown email', async () => {
    const org = await seedOrganisation();
    const owner = await seedUser({ role: 'owner', organisation_id: org.id });
    await db.createInvite({ organisationId: org.id, email: 'invitee@test.invalid', role: 'admin', invitedByUserId: owner.id });

    const invited = await reg({ email: 'invitee@test.invalid' });
    const unknown = await reg({ email: 'nobody@test.invalid' });
    expect(invited.status).toBe(403);
    expect(invited.body).toEqual(unknown.body);
    expect(invited.body.code).toBe('not_authorised');
    expect(invited.body.error).toMatch(/link in your invitation/);
    expect(await countUsers('invitee@test.invalid')).toBe(0);
    // The invite is untouched and still redeemable by its rightful holder.
    const { rows } = await db.pool.query(`SELECT status FROM user_invites WHERE email = 'invitee@test.invalid'`);
    expect(rows[0].status).toBe('pending');
  });

  test('check-invite by email gives the same answer for invited, registered and unknown emails', async () => {
    const org = await seedOrganisation();
    const owner = await seedUser({ role: 'owner', organisation_id: org.id });
    await db.createInvite({ organisationId: org.id, email: 'invited@test.invalid', role: 'admin', invitedByUserId: owner.id });
    await seedUser({ email: 'existing@test.invalid', organisation_id: org.id });

    const answers = [];
    for (const email of ['invited@test.invalid', 'existing@test.invalid', 'unknown@test.invalid']) {
      const r = await request(app).post('/api/auth/check-invite').send({ email });
      expect(r.status).toBe(200);
      answers.push(r.body);
    }
    expect(answers[0]).toEqual({ canRegister: false, reason: 'use_invite_link' });
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);
    expect(JSON.stringify(answers)).not.toMatch(/admin|account_exists/);
  });

  test('check-invite by token still describes the invite', async () => {
    const org = await seedOrganisation('Opal Test');
    const owner = await seedUser({ role: 'owner', organisation_id: org.id });
    const invite = await db.createInvite({ organisationId: org.id, email: 'tok@test.invalid', role: 'admin', invitedByUserId: owner.id });
    const r = await request(app).post('/api/auth/check-invite').send({ token: invite.invite_token });
    expect(r.body).toMatchObject({ canRegister: true, email: 'tok@test.invalid', role: 'admin', organisationName: 'Opal Test' });
  });

  test('check-invite is rate limited per IP', async () => {
    let last;
    for (let i = 0; i < 25; i += 1) {
      last = await request(app).post('/api/auth/check-invite').send({ email: `probe${i}@test.invalid` });
      if (last.status === 429) break;
    }
    expect(last.status).toBe(429);
  });
});

// ── Approve ─────────────────────────────────────────────────────────────────
describe('PATCH /api/admin/users/:id/approve (H-1)', () => {
  test('refuses pending_verification and leaves it unchanged; approves pending_approval', async () => {
    const org = await seedOrganisation();
    const { agent } = await ownerAgent(org);
    const unverified = await seedUser({ organisation_id: org.id, account_status: 'pending_verification', email_verified: false });
    const verified = await seedUser({ organisation_id: org.id, account_status: 'pending_approval', email_verified: true });

    const refused = await agent.patch(`/api/admin/users/${unverified.id}/approve`);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('pending_verification');
    expect((await db.getUser(unverified.id)).account_status).toBe('pending_verification');

    const ok = await agent.patch(`/api/admin/users/${verified.id}/approve`);
    expect(ok.status).toBe(200);
    expect((await db.getUser(verified.id)).account_status).toBe('active');
  });
});

// ── M-1 ─────────────────────────────────────────────────────────────────────
describe('invite expiry and resend (M-1)', () => {
  test('resending an expired invite issues a fresh token and expiry; the old link stops working', async () => {
    const org = await seedOrganisation();
    const { agent, owner } = await ownerAgent(org);
    const invite = await db.createInvite({ organisationId: org.id, email: 'late@test.invalid', role: 'therapist', invitedByUserId: owner.id });
    await db.pool.query(`UPDATE user_invites SET expires_at = NOW() - interval '1 day' WHERE id = $1`, [invite.id]);

    const r = await agent.post(`/api/invites/${invite.id}/resend`);
    expect(r.status).toBe(200);
    expect(r.body.renewed).toBe(true);
    expect(r.body.emailSent).toBe(false);   // email not configured in tests
    expect(r.body.emailSkipped).toBe(true);

    const { rows } = await db.pool.query('SELECT invite_token, expires_at FROM user_invites WHERE id = $1', [invite.id]);
    expect(rows[0].invite_token).not.toBe(invite.invite_token);
    expect(new Date(rows[0].expires_at).getTime()).toBeGreaterThan(Date.now() + 13 * 86400000);

    expect((await request(app).post('/api/auth/check-invite').send({ token: invite.invite_token })).body.canRegister).toBe(false);
    expect((await request(app).post('/api/auth/check-invite').send({ token: rows[0].invite_token })).body.canRegister).toBe(true);
  });

  test('resending a live invite keeps its token', async () => {
    const org = await seedOrganisation();
    const { agent, owner } = await ownerAgent(org);
    const invite = await db.createInvite({ organisationId: org.id, email: 'live@test.invalid', role: 'therapist', invitedByUserId: owner.id, expiresAt: new Date(Date.now() + 86400000) });
    const r = await agent.post(`/api/invites/${invite.id}/resend`);
    expect(r.body.renewed).toBe(false);
    const { rows } = await db.pool.query('SELECT invite_token FROM user_invites WHERE id = $1', [invite.id]);
    expect(rows[0].invite_token).toBe(invite.invite_token);
  });

  test.each([
    [-5, 1], [0, 1], [100000, 30], [7, 7], ['abc', 14],
  ])('expiresInDays %p is clamped to %p days', async (input, days) => {
    const org = await seedOrganisation();
    const { agent } = await ownerAgent(org);
    const r = await agent.post('/api/invites').send({ email: `clamp${days}x@test.invalid`, role: 'therapist', expiresInDays: input });
    expect(r.status).toBe(201);
    const ms = new Date(r.body.invite.expires_at).getTime() - Date.now();
    expect(ms).toBeGreaterThan((days - 0.01) * 86400000);
    expect(ms).toBeLessThanOrEqual(days * 86400000 + 60000);
  });
});

// ── C-1 / H-4 ───────────────────────────────────────────────────────────────
describe('first-owner bootstrap (C-1, H-4)', () => {
  beforeEach(() => {
    process.env.ALLOWED_EMAILS = 'ann@practice.test,eve@practice.test';
    delete process.env.ALLOWED_DOMAINS;
    delete process.env.BOOTSTRAP_OWNER_EMAIL;
    delete process.env.ORG_NAME;
  });

  test('outside development with BOOTSTRAP_OWNER_EMAIL unset, the bootstrap is refused and nothing is created', async () => {
    process.env.NODE_ENV = 'test';
    const r = await reg({ email: 'ann@practice.test' });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('bootstrap_not_permitted');
    expect(r.body.error).toMatch(/BOOTSTRAP_OWNER_EMAIL/);
    expect(await countUsers('ann@practice.test')).toBe(0);
    expect(Number((await db.pool.query('SELECT COUNT(*) FROM organisations')).rows[0].count)).toBe(0);
  });

  test('an allowlisted email that is not BOOTSTRAP_OWNER_EMAIL cannot become the first owner', async () => {
    process.env.NODE_ENV = 'production';
    process.env.BOOTSTRAP_OWNER_EMAIL = 'ann@practice.test';
    const r = await reg({ email: 'eve@practice.test' });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('bootstrap_not_permitted');
    expect(await countUsers('eve@practice.test')).toBe(0);
  });

  test('BOOTSTRAP_OWNER_EMAIL (any case) becomes the active owner of a newly created organisation', async () => {
    process.env.NODE_ENV = 'production';
    process.env.BOOTSTRAP_OWNER_EMAIL = 'Ann@Practice.Test';
    process.env.ORG_NAME = 'Opal Test Practice';
    const r = await reg({ email: 'ann@practice.test' });
    process.env.NODE_ENV = 'test'; // email links need APP_BASE_URL outside dev/test
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ requiresVerification: false, accountStatus: 'active' });

    const { rows: orgs } = await db.pool.query('SELECT id, name FROM organisations');
    expect(orgs).toHaveLength(1);
    expect(orgs[0].name).toBe('Opal Test Practice');
    const user = await db.getUserByEmail('ann@practice.test');
    expect(user).toMatchObject({ role: 'owner', account_status: 'active', organisation_id: orgs[0].id });

    // C-1: the bootstrapped owner can now create an invite (organisation_id NOT NULL).
    const agent = request.agent(app);
    expect((await agent.post('/api/auth/login').send({ email: 'ann@practice.test', password: PASSWORD })).status).toBe(200);
    const inv = await agent.post('/api/invites').send({ email: 'first.hire@test.invalid', role: 'therapist' });
    expect(inv.status).toBe(201);

    // The window is closed now that an active owner exists: the next
    // allowlisted sign-up is an ordinary pending therapist.
    process.env.NODE_ENV = 'production';
    const next = await reg({ email: 'eve@practice.test' });
    expect(next.status).toBe(201);
    expect(next.body.accountStatus).toBe('pending_verification');
    expect((await db.getUserByEmail('eve@practice.test')).role).toBe('therapist');
    expect(Number((await db.pool.query('SELECT COUNT(*) FROM organisations')).rows[0].count)).toBe(1);
  });

  test('development with BOOTSTRAP_OWNER_EMAIL unset keeps the old behaviour', async () => {
    process.env.NODE_ENV = 'development';
    const r = await reg({ email: 'eve@practice.test' });
    expect(r.status).toBe(201);
    expect((await db.getUserByEmail('eve@practice.test')).role).toBe('owner');
  });

  test('a non-bootstrap allowlist sign-up is refused cleanly when no organisation exists', async () => {
    process.env.NODE_ENV = 'production';
    await seedUser({ role: 'owner', organisation_id: null });   // an owner, but no organisation row
    const r = await reg({ email: 'eve@practice.test' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('no_organisation');
    expect(await countUsers('eve@practice.test')).toBe(0);
  });
});

// ── L-2 ─────────────────────────────────────────────────────────────────────
describe('onboarding-profile routes sit behind requireAuth (L-2)', () => {
  test('a temporary-password session cannot write its profile until the password is changed', async () => {
    const org = await seedOrganisation();
    const u = await seedUser({ organisation_id: org.id, password_hash: await bcrypt.hash(PASSWORD, 4) });
    await db.pool.query(`UPDATE users SET must_change_password = TRUE, password_is_temporary = TRUE WHERE id = $1`, [u.id]);
    const agent = request.agent(app);
    expect((await agent.post('/api/auth/login').send({ email: u.email, password: PASSWORD })).status).toBe(200);

    const writes = [
      await agent.post('/api/auth/complete-profile').send({ displayName: 'Changed', phone: '0400 000 000' }),
      await agent.post('/api/auth/complete-onboarding-step').send({ step: 'profile', data: { name: 'Changed' } }),
      await agent.get('/api/auth/onboarding'),
    ];
    for (const r of writes) {
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('must_change_password');
    }
    expect((await db.getUser(u.id)).name).toBe('Test User');
  });

  test('a session whose account was suspended is refused (401), not served', async () => {
    const org = await seedOrganisation();
    const u = await seedUser({ organisation_id: org.id, password_hash: await bcrypt.hash(PASSWORD, 4) });
    const agent = request.agent(app);
    expect((await agent.post('/api/auth/login').send({ email: u.email, password: PASSWORD })).status).toBe(200);
    expect((await agent.get('/api/auth/onboarding')).status).toBe(200);
    // Status changed without touching is_active — L-6 as well as L-2.
    await db.pool.query(`UPDATE users SET account_status = 'suspended' WHERE id = $1`, [u.id]);
    expect((await agent.post('/api/auth/complete-onboarding-step').send({ step: 'review' })).status).toBe(401);
    expect((await db.getUser(u.id)).profile_completed).not.toBe(true);
  });
});

// ── M-4 ─────────────────────────────────────────────────────────────────────
describe('suspend / deactivate release the leaver\'s Outlook connection (M-4)', () => {
  async function connectedUser(org) {
    const u = await seedUser({ organisation_id: org.id });
    await db.pool.query(
      `UPDATE users SET access_token = 'enc-access-not-real', refresh_token = 'enc-refresh-not-real',
              token_expires_at = NOW() + interval '1 hour', outlook_connected_email = $2,
              microsoft_id = $3 WHERE id = $1`, [u.id, `${u.id}@mail.test`, `ms-${u.id}`]);
    await db.pool.query(`INSERT INTO outlook_delta_state (user_id, delta_token) VALUES ($1, 'delta-not-real')`, [u.id]);
    return u;
  }
  const outlookOf = async (id) => (await db.pool.query(
    `SELECT access_token, refresh_token, token_expires_at, outlook_connected_email, microsoft_id,
            (SELECT COUNT(*)::int FROM outlook_delta_state d WHERE d.user_id = u.id) AS delta_rows
       FROM users u WHERE id = $1`, [id])).rows[0];
  const RELEASED = { access_token: null, refresh_token: null, token_expires_at: null, outlook_connected_email: null, microsoft_id: null, delta_rows: 0 };

  test.each(['suspend', 'deactivate'])('%s clears tokens, connected email, microsoft_id and delta state', async (action) => {
    const org = await seedOrganisation();
    const { agent } = await ownerAgent(org);
    const leaver = await connectedUser(org);
    const bystander = await connectedUser(org);

    const r = await agent.patch(`/api/admin/users/${leaver.id}/${action}`).send({ reason: 'left' });
    expect(r.status).toBe(200);
    expect(await outlookOf(leaver.id)).toEqual(RELEASED);
    expect((await outlookOf(bystander.id)).access_token).toBe('enc-access-not-real');
  });
});

// ── M-5 ─────────────────────────────────────────────────────────────────────
describe('boot no longer rewrites accounts (M-5)', () => {
  test('initializeDatabase on a migrated database leaves profile/verification state alone', async () => {
    const org = await seedOrganisation();
    const invitee = await seedUser({ organisation_id: org.id, email_verified: false });
    await db.pool.query(`UPDATE users SET profile_completed = FALSE, onboarding_step = 'profile' WHERE id = $1`, [invitee.id]);
    expect(Number((await db.pool.query('SELECT COUNT(*) FROM schema_migrations')).rows[0].count)).toBeGreaterThan(0);

    expect(await db.initializeDatabase()).toBe(true);   // what every server boot runs

    const after = await db.getUser(invitee.id);
    expect(after.profile_completed).toBe(false);
    expect(after.onboarding_step).toBe('profile');
    expect(after.email_verified).toBe(false);
  });
});

// ── M-7 ─────────────────────────────────────────────────────────────────────
describe('forgot / reset password (M-7)', () => {
  test('an active but unverified account with an expired temporary password can reset and sign in', async () => {
    const org = await seedOrganisation();
    const u = await seedUser({ organisation_id: org.id, email_verified: false, email: 'starter@test.invalid' });
    await db.pool.query(
      `UPDATE users SET password_is_temporary = TRUE, must_change_password = TRUE,
              temp_password_expires_at = NOW() - interval '1 day' WHERE id = $1`, [u.id]);

    const f = await request(app).post('/api/auth/forgot-password').send({ email: 'Starter@Test.Invalid' });
    expect(f.body).toEqual({ ok: true });
    const { rows } = await db.pool.query('SELECT password_reset_token FROM users WHERE id = $1', [u.id]);
    expect(rows[0].password_reset_token).toBeTruthy();   // was refused before: email_verified = FALSE

    const NEW = 'Brand-New-Pass-42';
    const r = await request(app).post('/api/auth/reset-password')
      .send({ token: rows[0].password_reset_token, password: NEW, confirmPassword: NEW });
    expect(r.status).toBe(200);

    const after = await db.getUser(u.id);
    expect(after).toMatchObject({
      password_is_temporary: false, must_change_password: false, temp_password_expires_at: null,
      email_verified: true, password_reset_token: null,
    });
    const login = await request(app).post('/api/auth/login').send({ email: 'starter@test.invalid', password: NEW });
    expect(login.status).toBe(200);
    expect(login.body.mustChangePassword).toBe(false);
  });

  test('unknown, unverified-pending and suspended accounts get the same generic answer and no token', async () => {
    const org = await seedOrganisation();
    const pending = await seedUser({ organisation_id: org.id, account_status: 'pending_verification', email_verified: false });
    const suspended = await seedUser({ organisation_id: org.id, account_status: 'suspended', is_active: false });
    for (const email of [pending.email, suspended.email, 'nobody@test.invalid']) {
      const f = await request(app).post('/api/auth/forgot-password').send({ email });
      expect(f.status).toBe(200);
      expect(f.body).toEqual({ ok: true });
    }
    const { rows } = await db.pool.query('SELECT COUNT(*)::int AS n FROM users WHERE password_reset_token IS NOT NULL');
    expect(rows[0].n).toBe(0);
  });
});
