'use strict';

/**
 * OUTLOOK MAILBOX CLAIM HANDLING (2026-08-06) — integration tests.
 *
 * Root cause pinned: disconnect left `microsoft_id` behind, so a disconnected
 * account kept a permanent claim on its mailbox and every other account hit
 * the users_microsoft_id_key unique violation in the OAuth callback.
 *
 * Rules under test:
 *   - disconnect clears microsoft_id along with tokens/email/delta state
 *   - a STALE claim (no active tokens) is released and the mailbox attaches
 *     to the signed-in portal user (audited)
 *   - an ACTIVE claim is never stolen — specific 403 page, no changes
 *   - the callback never switches the portal session user and never
 *     auto-creates a user outside development bootstrap
 *   - reconnecting the same mailbox to the same user is idempotent
 *
 * The Microsoft side is mocked — no network, no real OAuth, no Outlook writes.
 */

jest.mock('../../outlook-oauth', () => ({
  MICROSOFT_OAUTH_CONFIG: { scopes: ['Calendars.ReadWrite'] },
  getAuthorizationUrl: jest.fn((returnUrl) => ({
    url: 'https://login.microsoftonline.com/test/authorize?fake=1',
    state: 'test-state|' + Buffer.from(returnUrl || '/').toString('base64'),
  })),
  getAccessToken: jest.fn(async () => ({
    accessToken: 'fake-access-token', refreshToken: 'fake-refresh-token', expiresIn: 3600,
  })),
  getMicrosoftUser: jest.fn(async () => ({
    id: 'ms-mailbox-1', email: 'ann.mathew@opaltherapy.com.au', displayName: 'Mailbox User',
  })),
  refreshAccessToken: jest.fn(),
  getOutlookCalendarEvents: jest.fn(async () => []),
  getOutlookCalendarDelta: jest.fn(async () => ({ events: [], deltaLink: null })),
  createOutlookEvent: jest.fn(),
  updateOutlookEvent: jest.fn(),
  deleteOutlookEvent: jest.fn(),
  subscribeToCalendarChanges: jest.fn(),
}));

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { db, truncateAll, seedUser, closePool } = require('./helpers');

const PASSWORD = 'ClaimPass1';

function buildApp() {
  const app = express();
  app.use(bodyParser.json());
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../routes'));
  app.use('/', require('../../app-routes'));
  return app;
}

async function agentFor(app, role = 'therapist', overrides = {}) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser({ password_hash: hash, role, ...overrides });
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user };
}

/** Run the OAuth round-trip: outlook-login (sets state) then the callback. */
async function connectOutlook(agent) {
  const start = await agent.get('/auth/outlook-login');
  expect(start.status).toBe(200);
  const state = 'test-state|' + Buffer.from('/').toString('base64');
  return agent.get('/auth/oauth/callback?code=fake-code&state=' + encodeURIComponent(state));
}

const userRow = async (id) =>
  (await db.pool.query('SELECT id, email, microsoft_id, access_token, outlook_connected_email FROM users WHERE id = $1', [id])).rows[0];

const auditRows = async (action) =>
  (await db.pool.query('SELECT * FROM audit_logs WHERE action = $1', [action])).rows;

beforeEach(async () => {
  await truncateAll();
  require('../../auth')._resetLoginRateLimit();
});
afterAll(closePool);

describe('disconnect releases the mailbox claim', () => {
  test('disconnect clears microsoft_id AND tokens/email/delta state', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app, 'owner');
    const cb = await connectOutlook(agent);
    expect(cb.status).toBe(302);
    let row = await userRow(user.id);
    expect(row.microsoft_id).toBe('ms-mailbox-1');
    expect(row.access_token).not.toBeNull();
    expect(row.outlook_connected_email).toBe('ann.mathew@opaltherapy.com.au');

    const dis = await agent.post('/api/outlook/disconnect');
    expect(dis.status).toBe(200);
    row = await userRow(user.id);
    expect(row.microsoft_id).toBeNull();
    expect(row.access_token).toBeNull();
    expect(row.outlook_connected_email).toBeNull();
    const delta = await db.pool.query('SELECT 1 FROM outlook_delta_state WHERE user_id = $1', [user.id]);
    expect(delta.rows).toHaveLength(0);
  });
});

describe('stale-claim self-heal in the OAuth callback', () => {
  test('a disconnected account holding the microsoft_id is released; the signed-in user gets the mailbox (audited)', async () => {
    const app = buildApp();
    // The stuck-staging scenario: an old row claims the mailbox with NO tokens
    const stale = await seedUser({ role: 'owner' });
    await db.pool.query('UPDATE users SET microsoft_id = $1, access_token = NULL WHERE id = $2', ['ms-mailbox-1', stale.id]);

    const { agent, user } = await agentFor(app, 'owner');
    const cb = await connectOutlook(agent);
    expect(cb.status).toBe(302);
    expect(cb.headers.location).toContain('outlook=connected');

    expect((await userRow(stale.id)).microsoft_id).toBeNull();
    const mine = await userRow(user.id);
    expect(mine.microsoft_id).toBe('ms-mailbox-1');
    expect(mine.access_token).not.toBeNull();

    const released = await auditRows('outlook.stale_claim_released');
    expect(released).toHaveLength(1);
    expect(released[0].actor_user_id).toBe(user.id);
    expect(released[0].target_id).toBe(stale.id);
  });

  test('an ACTIVELY connected mailbox is never stolen — specific 403, no changes, audited', async () => {
    const app = buildApp();
    const active = await seedUser({ role: 'owner' });
    await db.pool.query(
      "UPDATE users SET microsoft_id = $1, access_token = 'enc-active-token' WHERE id = $2",
      ['ms-mailbox-1', active.id]);

    const { agent, user } = await agentFor(app, 'therapist');
    const cb = await connectOutlook(agent);
    expect(cb.status).toBe(403);
    expect(cb.text).toContain('already connected to another portal');
    expect(cb.text).toContain('No changes were made');
    // no raw database details leak
    expect(cb.text).not.toMatch(/duplicate key|constraint|users_microsoft_id_key/);

    expect((await userRow(active.id)).microsoft_id).toBe('ms-mailbox-1');
    expect((await userRow(user.id)).microsoft_id).toBeNull();
    expect((await userRow(user.id)).access_token).toBeNull();
    expect(await auditRows('outlook.connect_blocked_active_claim')).toHaveLength(1);
  });

  test('callback never switches the portal session user and never creates one', async () => {
    const app = buildApp();
    const stale = await seedUser({ role: 'owner' });
    await db.pool.query('UPDATE users SET microsoft_id = $1 WHERE id = $2', ['ms-mailbox-1', stale.id]);
    const { agent, user } = await agentFor(app, 'therapist');
    const before = (await db.pool.query('SELECT COUNT(*)::int AS n FROM users')).rows[0].n;

    await connectOutlook(agent);

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(user.id);            // session untouched
    expect(me.body.email).toBe(user.email);      // NOT the Microsoft email
    const after = (await db.pool.query('SELECT COUNT(*)::int AS n FROM users')).rows[0].n;
    expect(after).toBe(before);                       // no auto-created account
  });

  test('reconnecting the same mailbox to the same user is idempotent', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app, 'owner');
    expect((await connectOutlook(agent)).status).toBe(302);
    expect((await connectOutlook(agent)).status).toBe(302);
    const row = await userRow(user.id);
    expect(row.microsoft_id).toBe('ms-mailbox-1');
    // exactly one user holds the claim
    const holders = await db.pool.query("SELECT id FROM users WHERE microsoft_id = 'ms-mailbox-1'");
    expect(holders.rows).toHaveLength(1);
    // no stale-release audit fired for a same-user reconnect
    expect(await auditRows('outlook.stale_claim_released')).toHaveLength(0);
  });
});

describe('owner-controlled mailbox claim release (zombie accounts)', () => {
  /** Seed the real staging scenario: an abandoned bootstrap-era account that
   *  still holds the mailbox WITH tokens, and cannot sign in to disconnect. */
  async function seedZombie() {
    const zombie = await seedUser({ role: 'therapist' });
    await db.pool.query(
      `UPDATE users SET microsoft_id = 'ms-mailbox-1', access_token = 'enc-old-token',
              refresh_token = 'enc-old-refresh', outlook_connected_email = 'ann.mathew@opaltherapy.com.au'
        WHERE id = $1`, [zombie.id]);
    await db.pool.query(
      `INSERT INTO outlook_delta_state (user_id, delta_link) VALUES ($1, 'stale-link')
       ON CONFLICT (user_id) DO UPDATE SET delta_link = 'stale-link'`, [zombie.id]).catch(() => {});
    return zombie;
  }

  test('owner releases a zombie claim; fields cleared, audited; mailbox then connects to owner', async () => {
    const app = buildApp();
    const zombie = await seedZombie();
    const { agent: owner, user: ownerUser } = await agentFor(app, 'owner');

    // Blocked while the zombie holds tokens (active-claim rule)
    expect((await connectOutlook(owner)).status).toBe(403);

    const rel = await owner.post(`/api/admin/users/${zombie.id}/release-outlook`);
    expect(rel.status).toBe(200);
    const z = await userRow(zombie.id);
    expect(z.microsoft_id).toBeNull();
    expect(z.access_token).toBeNull();
    expect(z.outlook_connected_email).toBeNull();
    const audits = await auditRows('outlook.claim_released_by_owner');
    expect(audits).toHaveLength(1);
    expect(audits[0].actor_user_id).toBe(ownerUser.id);
    expect(audits[0].target_id).toBe(zombie.id);

    // The real goal: the mailbox now connects to the signed-in owner
    const cb = await connectOutlook(owner);
    expect(cb.status).toBe(302);
    expect((await userRow(ownerUser.id)).microsoft_id).toBe('ms-mailbox-1');
  });

  test('release is owner-only; unknown user is 404', async () => {
    const app = buildApp();
    const zombie = await seedZombie();
    for (const role of ['admin', 'therapist']) {
      const { agent } = await agentFor(app, role);
      expect((await agent.post(`/api/admin/users/${zombie.id}/release-outlook`)).status).toBe(403);
    }
    expect((await userRow(zombie.id)).microsoft_id).toBe('ms-mailbox-1'); // untouched
    const { agent: owner } = await agentFor(app, 'owner');
    expect((await owner.post('/api/admin/users/00000000-0000-4000-8000-000000000000/release-outlook')).status).toBe(404);
  });

  test('owner user list surfaces mailbox claims for visibility', async () => {
    const app = buildApp();
    const zombie = await seedZombie();
    const { agent: owner } = await agentFor(app, 'owner');
    const list = await owner.get('/api/admin/users');
    expect(list.status).toBe(200);
    const row = list.body.users.find((u) => u.id === zombie.id);
    expect(row.hasMailboxClaim).toBe(true);
    expect(row.outlookConnectedEmail).toBe('ann.mathew@opaltherapy.com.au');
  });
});
