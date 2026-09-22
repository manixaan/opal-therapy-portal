'use strict';

/**
 * GET /api/admin/people — the one-row-per-person view behind Settings →
 * Users & Roles. Real SQL: org scoping, the therapist-profile / Splose /
 * Outlook joins, and open invites folded into the same list.
 */

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { db, truncateAll, seedUser, seedOrganisation, closePool } = require('./helpers');

function buildApp() {
  const app = express();
  app.use(bodyParser.json());
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false, httpOnly: true } }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../app-routes'));
  return app;
}

const PASSWORD = 'IntegrationPass1';
async function seedLoginUser(overrides = {}) {
  return seedUser({ password_hash: await bcrypt.hash(PASSWORD, 4), ...overrides });
}
async function loginAgent(app, email) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return agent;
}

beforeEach(truncateAll);
afterAll(closePool);

describe('GET /api/admin/people', () => {
  test('owner only — admin and therapist get 403, anonymous 401', async () => {
    const app = buildApp();
    const org = await seedOrganisation();
    for (const role of ['admin', 'therapist']) {
      const u = await seedLoginUser({ role, organisation_id: org.id });
      const agent = await loginAgent(app, u.email);
      expect((await agent.get('/api/admin/people')).status).toBe(403);
    }
    expect((await request(app).get('/api/admin/people')).status).toBe(401);
  });

  test('one row per person: users in MY org with profile/Splose/Outlook, open invites folded in, other orgs excluded', async () => {
    const app = buildApp();
    const org = await seedOrganisation('Opal');
    const other = await seedOrganisation('Elsewhere');
    const owner = await seedLoginUser({ role: 'owner', organisation_id: org.id, name: 'Ann Owner' });
    const linked = await seedUser({ role: 'therapist', organisation_id: org.id, name: 'Paulita', email: 'paulita@test.invalid' });
    await db.upsertTherapistProfile({ userId: linked.id, organisationId: org.id, displayName: 'Paulita R', splosePractitionerId: '88200' });
    await db.pool.query(`UPDATE users SET access_token = 'enc-not-real', outlook_connected_email = 'paulita@mail.test' WHERE id = $1`, [linked.id]);
    const pending = await seedUser({ role: 'therapist', organisation_id: org.id, account_status: 'pending_approval', name: 'New Starter' });
    const suspended = await seedUser({ role: 'therapist', organisation_id: org.id, account_status: 'suspended', is_active: false });
    await seedUser({ role: 'therapist', organisation_id: other.id, name: 'Stranger' });
    // An open invite for someone with no account yet, and one for an account that exists.
    await db.pool.query(
      `INSERT INTO user_invites (organisation_id, email, role, invited_by_user_id, status, invite_token, expires_at, display_name_hint)
       VALUES ($1,'fresh@test.invalid','therapist',$2,'pending','tok-fresh-not-real', NOW() + INTERVAL '7 days','Fresh Person'),
              ($1,'paulita@test.invalid','therapist',$2,'pending','tok-paulita-not-real', NOW() - INTERVAL '1 day', NULL),
              ($1,'gone@test.invalid','therapist',$2,'revoked','tok-gone-not-real', NOW() + INTERVAL '7 days', NULL)`,
      [org.id, owner.id]);

    const agent = await loginAgent(app, owner.email);
    const r = await agent.get('/api/admin/people');
    expect(r.status).toBe(200);
    const people = r.body.people;
    const emails = people.map(p => p.email).sort();
    expect(emails).toEqual([owner.email, 'fresh@test.invalid', pending.email, 'paulita@test.invalid', suspended.email].sort());
    expect(JSON.stringify(r.body)).not.toMatch(/Stranger|tok-|enc-not-real|gone@/);

    const me = people.find(p => p.id === owner.id);
    expect(me.isMe).toBe(true);
    expect(me.kind).toBe('user');

    const pr = people.find(p => p.email === 'paulita@test.invalid');
    expect(pr.therapistProfile.exists).toBe(true);
    expect(pr.splosePractitionerId).toBe('88200');
    expect(pr.outlook).toEqual(expect.objectContaining({ connected: true, email: 'paulita@mail.test' }));
    expect(pr.invite).toEqual(expect.objectContaining({ expired: true }));
    expect(pr.name).toBe('Paulita');
    expect(pr.therapistProfile.displayName).toBe('Paulita R');

    const fresh = people.find(p => p.email === 'fresh@test.invalid');
    expect(fresh.kind).toBe('invite');
    expect(fresh.accountStatus).toBe('invited');
    expect(fresh.name).toBe('Fresh Person');
    expect(fresh.invite.expired).toBe(false);
    expect(fresh.splosePractitionerId).toBeNull();

    expect(people.find(p => p.id === pending.id).accountStatus).toBe('pending_approval');
    expect(people.find(p => p.id === suspended.id)).toEqual(expect.objectContaining({ accountStatus: 'suspended', isActive: false }));
  });
});
