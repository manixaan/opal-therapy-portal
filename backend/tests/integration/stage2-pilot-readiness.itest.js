'use strict';

/**
 * STAGE 2 THERAPIST PILOT READINESS — integration tests.
 *
 * Pins the identity chain and Outlook connect-state fixes:
 *   A. Therapist identity chain: invited treating therapists get a profile
 *      at registration; onboarding completion and role promotion provision
 *      one when missing; events back-filled; setup-status tells the truth.
 *   B. Outlook state: /api/sync-status is strictly per-user (user A never
 *      sees user B's mailbox); disconnect clears the caller's own tokens +
 *      delta state and is audited; no tokens in any status payload.
 *   C. Owner visibility: /api/admin/team-setup shows the chain per member,
 *      is owner/admin-only, and never exposes token material.
 */

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { db, truncateAll, seedUser, closePool } = require('./helpers');

const PASSWORD = 'Stage2Pass1';

function buildApp() {
  const app = express();
  app.use(bodyParser.json());
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../routes'));
  app.use('/', require('../../register-routes'));
  app.use('/', require('../../profile-routes'));
  app.use('/', require('../../app-routes'));
  return app;
}

async function agentFor(app, role, overrides = {}) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser({ password_hash: hash, role, ...overrides });
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user };
}

beforeEach(async () => {
  await truncateAll();
  require('../../auth')._resetLoginRateLimit();
});
afterAll(closePool);

// ═══ A. Identity chain ═══════════════════════════════════════════════════════

describe('therapist identity chain', () => {
  test('registerUserFromInvite creates + links a therapist profile for treating therapists', async () => {
    const org = await db.pool.query("INSERT INTO organisations (name) VALUES ('S2 Org') RETURNING id");
    const inv = await db.pool.query(`
      INSERT INTO user_invites (organisation_id, email, role, is_treating_therapist, invite_token, status, expires_at)
      VALUES ($1, 'new.t@example.test', 'therapist', TRUE, 'tok-s2', 'pending', NOW() + INTERVAL '7 days')
      RETURNING *`, [org.rows[0].id]);
    const { user, therapistProfile } = await db.registerUserFromInvite({
      invite: inv.rows[0], passwordHash: 'x', name: 'New Therapist',
    });
    expect(therapistProfile).toBeTruthy();
    expect(user.therapist_profile_id).toBe(String(therapistProfile.id));
    const link = await db.pool.query('SELECT user_id FROM therapist_profiles WHERE id = $1', [therapistProfile.id]);
    expect(link.rows[0].user_id).toBe(user.id);
  });

  test('onboarding completion provisions a missing profile and back-fills events', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app, 'therapist');
    // Pre-existing mirrored event with no profile stamp
    await db.pool.query(`
      INSERT INTO events (user_id, title, start_time, end_time, event_type)
      VALUES ($1, 'Pre-profile event', NOW(), NOW() + INTERVAL '1 hour', 'therapy')`, [user.id]);

    const before = await db.pool.query('SELECT id FROM therapist_profiles WHERE user_id = $1', [user.id]);
    expect(before.rows.length).toBe(0);

    const res = await agent.post('/api/auth/complete-onboarding-step').send({ step: 'review' });
    expect(res.status).toBe(200);

    const prof = await db.pool.query('SELECT id FROM therapist_profiles WHERE user_id = $1', [user.id]);
    expect(prof.rows.length).toBe(1);
    const u = await db.pool.query('SELECT therapist_profile_id, is_treating_therapist FROM users WHERE id = $1', [user.id]);
    expect(u.rows[0].therapist_profile_id).toBe(prof.rows[0].id);
    expect(u.rows[0].is_treating_therapist).toBe(true);
    const ev = await db.pool.query('SELECT therapist_profile_id FROM events WHERE user_id = $1', [user.id]);
    expect(ev.rows[0].therapist_profile_id).toBe(prof.rows[0].id); // back-filled
  });

  test('profile persists (idempotent) across repeated onboarding completions', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app, 'therapist');
    await agent.post('/api/auth/complete-onboarding-step').send({ step: 'review' });
    await agent.post('/api/auth/complete-onboarding-step').send({ step: 'review' });
    const prof = await db.pool.query('SELECT id FROM therapist_profiles WHERE user_id = $1', [user.id]);
    expect(prof.rows.length).toBe(1);
  });

  test('promoting a user to therapist provisions a profile', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app, 'owner');
    const target = await seedUser({ role: 'read_only' });
    const res = await agent.patch(`/api/admin/users/${target.id}/role`).send({ role: 'therapist' });
    expect(res.status).toBe(200);
    const prof = await db.pool.query('SELECT id FROM therapist_profiles WHERE user_id = $1', [target.id]);
    expect(prof.rows.length).toBe(1);
  });

  test('non-therapist roles never get an implicit profile', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app, 'admin');
    await agent.post('/api/auth/complete-onboarding-step').send({ step: 'review' });
    const prof = await db.pool.query('SELECT id FROM therapist_profiles WHERE user_id = $1', [user.id]);
    expect(prof.rows.length).toBe(0);
  });

  test('setup-status reports missing profile with a clear action, then all-clear once fixed', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app, 'therapist');

    let st = await agent.get('/api/profile/setup-status');
    expect(st.status).toBe(200);
    expect(st.body.therapistProfile.required).toBe(true);
    expect(st.body.therapistProfile.exists).toBe(false);
    expect(st.body.actions.map(a => a.key)).toContain('therapist_profile');
    expect(st.body.outlook.connected).toBe(false);

    await db.ensureTherapistProfile(user.id);
    await db.pool.query(
      "UPDATE therapist_profiles SET splose_practitioner_id = 'prac-s2' WHERE user_id = $1", [user.id]);

    st = await agent.get('/api/profile/setup-status');
    expect(st.body.therapistProfile.exists).toBe(true);
    expect(st.body.splosePractitionerMapped).toBe(true);
    expect(st.body.splosePractitionerId).toBe('prac-s2');
    expect(st.body.actions.map(a => a.key)).not.toContain('therapist_profile');
  });
});

// ═══ B. Outlook connect state ════════════════════════════════════════════════

describe('Outlook state is strictly per-user', () => {
  test('user A never sees user B\'s mailbox as connected', async () => {
    const app = buildApp();
    // User B: connected
    const hash = await bcrypt.hash(PASSWORD, 4);
    await seedUser({ password_hash: hash, role: 'owner', email: 'connected.b@example.test' });
    await db.pool.query(
      `UPDATE users SET access_token = 'tok-b', refresh_token = 'r', outlook_connected_email = 'mailbox.b@example.test'
        WHERE email = 'connected.b@example.test'`);
    // User A: fresh therapist, NOT connected
    const { agent } = await agentFor(app, 'therapist');
    const res = await agent.get('/api/sync-status');
    expect(res.status).toBe(200);
    expect(res.body.outlookConnected).toBe(false);
    expect(res.body.connectedAs).toBeNull();
    expect(res.body.status).toBe('not_connected');
    expect(JSON.stringify(res.body)).not.toContain('mailbox.b@example.test');
  });

  test('connected user sees their OWN mailbox + real last-sync time', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app, 'therapist');
    await db.pool.query(
      `UPDATE users SET access_token = 'tok-a', outlook_connected_email = 'my.mailbox@example.test' WHERE id = $1`, [user.id]);
    await db.pool.query(
      `INSERT INTO outlook_delta_state (user_id, delta_token, last_synced_at) VALUES ($1, 'd', NOW())
       ON CONFLICT (user_id) DO UPDATE SET last_synced_at = NOW()`, [user.id]);
    const res = await agent.get('/api/sync-status');
    expect(res.body.outlookConnected).toBe(true);
    expect(res.body.connectedAs).toBe('my.mailbox@example.test');
    expect(res.body.lastSyncedAt).toBeTruthy();
  });

  test('disconnect clears own tokens + delta state, is audited, and is idempotent', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app, 'therapist');
    await db.pool.query(
      `UPDATE users SET access_token = 'tok', refresh_token = 'r', outlook_connected_email = 'x@y.test' WHERE id = $1`, [user.id]);
    await db.pool.query(
      `INSERT INTO outlook_delta_state (user_id, delta_token) VALUES ($1, 'd') ON CONFLICT (user_id) DO NOTHING`, [user.id]);

    const res = await agent.post('/api/outlook/disconnect');
    expect(res.status).toBe(200);
    const u = await db.pool.query('SELECT access_token, refresh_token, outlook_connected_email FROM users WHERE id = $1', [user.id]);
    expect(u.rows[0].access_token).toBeNull();
    expect(u.rows[0].refresh_token).toBeNull();
    expect(u.rows[0].outlook_connected_email).toBeNull();
    const d = await db.pool.query('SELECT 1 FROM outlook_delta_state WHERE user_id = $1', [user.id]);
    expect(d.rows.length).toBe(0);
    const audit = await db.pool.query("SELECT COUNT(*) FROM audit_logs WHERE action = 'outlook.disconnected'");
    expect(Number(audit.rows[0].count)).toBe(1);

    // Status reflects the disconnect; second disconnect is a clean no-op
    const st = await agent.get('/api/sync-status');
    expect(st.body.outlookConnected).toBe(false);
    expect((await agent.post('/api/outlook/disconnect')).status).toBe(200);
  });

  test('read_only cannot call disconnect (choke point) and unauth gets 401', async () => {
    const app = buildApp();
    const r = await agentFor(app, 'read_only');
    expect((await r.agent.post('/api/outlook/disconnect')).status).toBe(403);
    expect((await request(app).post('/api/outlook/disconnect')).status).toBe(401);
  });
});

// ═══ C. Owner team-setup view ════════════════════════════════════════════════

describe('admin team-setup view', () => {
  test('owner sees the chain per member; no token material anywhere', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app, 'owner');
    const t = await seedUser({ role: 'therapist', email: 'chain.t@example.test' });
    await db.ensureTherapistProfile(t.id);
    await db.pool.query(
      `UPDATE users SET access_token = 'secret-token-value', outlook_connected_email = 'chain.mb@example.test' WHERE id = $1`, [t.id]);

    const res = await agent.get('/api/admin/team-setup');
    expect(res.status).toBe(200);
    const member = res.body.members.find(m => m.email === 'chain.t@example.test');
    expect(member.therapistProfile.exists).toBe(true);
    expect(member.outlook.connected).toBe(true);
    expect(member.outlook.email).toBe('chain.mb@example.test');
    expect(JSON.stringify(res.body)).not.toContain('secret-token-value');
    expect(JSON.stringify(res.body)).not.toContain('access_token');
  });

  test('therapist and read_only are denied; unauth 401', async () => {
    const app = buildApp();
    const t = await agentFor(app, 'therapist');
    expect((await t.agent.get('/api/admin/team-setup')).status).toBe(403);
    const r = await agentFor(app, 'read_only');
    expect((await r.agent.get('/api/admin/team-setup')).status).toBe(403);
    expect((await request(app).get('/api/admin/team-setup')).status).toBe(401);
  });
});
