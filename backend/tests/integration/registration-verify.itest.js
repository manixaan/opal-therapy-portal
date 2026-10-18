'use strict';

/**
 * Email verification → account status (4 Oct 2026).
 *
 * An account created through an owner's invite is already approved: verifying
 * the email makes it ACTIVE. A self-registration waits for the owner
 * (pending_approval). Before this fix every account went to pending_approval,
 * so an invitee was stuck behind a second approval. The check is fail-closed:
 * only an invite accepted at the moment the account was created counts.
 */

const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const request = require('supertest');
const { db, truncateAll, seedUser, seedOrganisation, closePool } = require('./helpers');

function buildApp() {
  const app = express();
  app.use(bodyParser.json());
  app.use(session({ secret: process.env.SESSION_SECRET || 'test-secret', resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../register-routes'));
  return app;
}
let app, org, owner;
const PASSWORD = 'Invitee-Pass-123!';

beforeAll(() => { app = buildApp(); });
beforeEach(async () => {
  await truncateAll();
  org = await seedOrganisation('Verify Org');
  owner = await seedUser({ role: 'owner', organisation_id: org.id });
});
afterAll(closePool);

async function tokenFor(email) {
  const { rows } = await db.pool.query('SELECT email_verification_token, account_status FROM users WHERE LOWER(email) = LOWER($1)', [email]);
  return rows[0];
}
const statusOf = async (email) => (await db.pool.query('SELECT account_status, email_verified FROM users WHERE LOWER(email) = LOWER($1)', [email])).rows[0];

test('invite token → register: the invitee is active and verified at once (the token is the mailbox proof)', async () => {
  // Was: pending_verification, then active on verify. Since the account
  // hardening of 18 Oct 2026 (audit H-1 / M-1b) the token itself proves the
  // mailbox, so there is no verification step — and no copy-link dead end
  // when email is not configured.
  const invite = await db.createInvite({ organisationId: org.id, email: 'invitee@test.invalid', role: 'therapist', invitedByUserId: owner.id, isTreatingTherapist: true });
  const reg = await request(app).post('/api/auth/register').send({
    token: invite.invite_token, password: PASSWORD, confirmPassword: PASSWORD, profile: { name: 'Ivy Invitee' },
  });
  expect(reg.status).toBe(201);
  expect(reg.body.requiresVerification).toBe(false);
  expect(reg.body.accountStatus).toBe('active');
  const after = await tokenFor('invitee@test.invalid');
  expect(after.email_verification_token).toBeNull();
  expect(await statusOf('invitee@test.invalid')).toEqual({ account_status: 'active', email_verified: true });

  const login = await request(app).post('/api/auth/login').send({ email: 'invitee@test.invalid', password: PASSWORD });
  expect(login.status).toBe(200);
});

test('verify-email still activates an older invite-created account left at pending_verification', async () => {
  // Accounts registered through an invite before the change above are still
  // pending_verification; their emailed link must keep working.
  const invite = await db.createInvite({ organisationId: org.id, email: 'legacy@test.invalid', role: 'therapist', invitedByUserId: owner.id });
  await seedUser({ email: 'legacy@test.invalid', organisation_id: org.id, account_status: 'pending_verification', email_verified: false });
  await db.pool.query(`UPDATE user_invites SET status = 'accepted', accepted_at = NOW() WHERE id = $1`, [invite.id]);
  await db.pool.query(`UPDATE users SET email_verification_token = 'tok-legacy', email_verification_expires_at = NOW() + interval '1 day' WHERE email = 'legacy@test.invalid'`);
  const v = await request(app).get('/api/auth/verify-email').query({ token: 'tok-legacy' });
  expect(v.status).toBe(200);
  expect(v.body.newStatus).toBe('active');
});

test('a self-registration (no invite) still waits for the owner', async () => {
  await seedUser({ email: 'self@test.invalid', organisation_id: org.id, account_status: 'pending_verification', email_verified: false });
  await db.pool.query(`UPDATE users SET email_verification_token = 'tok-self', email_verification_expires_at = NOW() + interval '1 day' WHERE email = 'self@test.invalid'`);
  const v = await request(app).get('/api/auth/verify-email').query({ token: 'tok-self' });
  expect(v.body.newStatus).toBe('pending_approval');
  expect((await statusOf('self@test.invalid')).account_status).toBe('pending_approval');
});

test('an old accepted invite does not activate a later account with the same email', async () => {
  const invite = await db.createInvite({ organisationId: org.id, email: 'reuse@test.invalid', role: 'therapist', invitedByUserId: owner.id });
  await db.pool.query(`UPDATE user_invites SET status = 'accepted', accepted_at = NOW() - interval '10 days' WHERE id = $1`, [invite.id]);
  await seedUser({ email: 'reuse@test.invalid', organisation_id: org.id, account_status: 'pending_verification', email_verified: false });
  await db.pool.query(`UPDATE users SET email_verification_token = 'tok-reuse', email_verification_expires_at = NOW() + interval '1 day' WHERE email = 'reuse@test.invalid'`);
  const v = await request(app).get('/api/auth/verify-email').query({ token: 'tok-reuse' });
  expect(v.body.newStatus).toBe('pending_approval');
});

test('an invite from another organisation, or a revoked one, does not count', async () => {
  const other = await seedOrganisation('Other Org');
  const a = await db.createInvite({ organisationId: other.id, email: 'cross@test.invalid', role: 'therapist', invitedByUserId: owner.id });
  await db.pool.query(`UPDATE user_invites SET status = 'accepted', accepted_at = NOW() WHERE id = $1`, [a.id]);
  const b = await db.createInvite({ organisationId: org.id, email: 'cross@test.invalid', role: 'therapist', invitedByUserId: owner.id });
  await db.pool.query(`UPDATE user_invites SET status = 'revoked', accepted_at = NOW() WHERE id = $1`, [b.id]);
  await seedUser({ email: 'cross@test.invalid', organisation_id: org.id, account_status: 'pending_verification', email_verified: false });
  await db.pool.query(`UPDATE users SET email_verification_token = 'tok-cross', email_verification_expires_at = NOW() + interval '1 day' WHERE email = 'cross@test.invalid'`);
  const v = await request(app).get('/api/auth/verify-email').query({ token: 'tok-cross' });
  expect(v.body.newStatus).toBe('pending_approval');
});

test('verifying never changes a suspended account', async () => {
  await seedUser({ email: 'sus@test.invalid', organisation_id: org.id, account_status: 'suspended', email_verified: false });
  await db.pool.query(`UPDATE users SET email_verification_token = 'tok-sus', email_verification_expires_at = NOW() + interval '1 day' WHERE email = 'sus@test.invalid'`);
  await request(app).get('/api/auth/verify-email').query({ token: 'tok-sus' });
  expect((await statusOf('sus@test.invalid')).account_status).toBe('suspended');
});
