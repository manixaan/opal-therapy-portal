'use strict';

/**
 * THE PORTAL ROUTE — production-readiness fixes (Oct 2026), against a real
 * PostgreSQL database.
 *
 *   • account safety: an onboarding acts only on its OWN pre-employee account,
 *     re-checked at every act (release, invite accept, temporary password,
 *     activation) — never a staff or Owner account sharing the email;
 *   • the temporary-password path keeps the record's route, status and role.
 */

const http = require('http');
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { db, truncateAll, seedUser, seedOrganisation, closePool } = require('./helpers');

jest.setTimeout(60000);

const PASSWORD = 'PortalPass1';
const STARTER_PASSWORD = 'StarterPass9';

function buildApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use('/api/onboarding', bodyParser.json({ limit: '16mb' }));
  app.use(bodyParser.json({ limit: '10mb' }));
  app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false, saveUninitialized: false, cookie: { secure: false },
  }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../app-routes'));
  app.use('/', require('../../invite-routes'));
  app.use('/', require('../../onboarding-employee-routes'));
  app.use('/', require('../../onboarding-workflow-routes'));
  app.use('/', require('../../onboarding-journey-routes'));
  app.use('/', require('../../onboarding-returns-routes'));
  app.use('/', require('../../onboarding-pack-routes'));
  app.use('/', require('../../onboarding-assignment-routes'));
  app.use('/', require('../../onboarding-routes'));
  app.use('/', require('../../profile-routes'));
  return app;
}

let app; let server; let org;
let ipCounter = 0;
const nextIp = () => `10.11.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;

async function agentFor({ permissions, ...overrides } = {}) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser({ password_hash: hash, organisation_id: org.id, ...overrides });
  if (permissions) {
    await db.pool.query('UPDATE users SET permissions = $2 WHERE id = $1', [user.id, JSON.stringify(permissions)]);
  }
  const agent = request.agent(server);
  const res = await agent.post('/api/auth/login').set('X-Forwarded-For', nextIp())
    .send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user };
}

async function publishAllDocuments() {
  const odb = require('../../onboarding-db');
  for (const doc of await odb.listDocuments(org.id)) {
    const version = await odb.createDocumentVersion(doc.id, {
      title: doc.title, body: `${doc.title}\n\nContent supplied for testing.`,
      effectiveDate: '2026-08-01', changeNote: 'Initial content',
    });
    if (version) await odb.publishDocumentVersion(doc.id, version.id, null);
  }
  for (const pkg of await odb.listPackages(org.id, { kind: 'package' })) {
    const fresh = await odb.getPackage(org.id, pkg.id);
    await odb.publishPackage(org.id, fresh, null, 'Pin published policy versions');
  }
}

const START_BODY = {
  name: 'Dana Adopt', personalEmail: 'dana.adopt@example.test', mobile: '0412 000 000',
  position: 'Practice Administrator', roleCategory: 'administration', employmentType: 'part_time',
  proposedRole: 'read_only', isTreatingTherapist: false,
  startDate: '2026-12-01', payBasis: 'hourly', payRate: 40, hoursPerWeek: 20,
  awardClassification: 'Level 2', probationMonths: 6, workLocation: 'Perth clinic',
};

async function start(agent, over = {}) {
  const res = await agent.post('/api/onboarding/journey/records').send({ ...START_BODY, ...over });
  expect(res.status).toBe(201);
  return res.body;
}

const tokenOf = (url) => new URL(url).searchParams.get('token');

/** Start a record and release it through the portal route. */
async function released(owner, over = {}) {
  const body = await start(owner, over);
  const id = body.record.id;
  expect((await owner.post(`/api/onboarding/journey/records/${id}/offer/skip`)).status).toBe(200);
  const rel = await owner.post(`/api/onboarding/journey/records/${id}/release`);
  expect(rel.status).toBe(201);
  return { id, url: rel.body.release.onboardingUrl, body: rel.body };
}

beforeAll(() => {
  process.env.ONBOARDING_ENCRYPTION_KEY = 'ef'.repeat(32);
  process.env.APP_BASE_URL = 'https://portal.test.invalid';
  app = buildApp();
  server = http.createServer(app);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await closePool();
});

beforeEach(async () => {
  await truncateAll();
  require('../../onboarding-employee-routes')._resetInviteRateLimit();
  require('../../auth')._resetLoginRateLimit();
  org = await seedOrganisation('Opal Therapy Test');
  await require('../../onboarding-seed').seedOnboarding({ organisationId: org.id });
  await publishAllDocuments();
  jest.restoreAllMocks();
});

// ═════════════════════════════════════════════════════════════════════════════

describe('B-1 — an onboarding never acts on an account that is not its own pre-employee', () => {
  test('release refuses when a staff account appeared with the applicant email after the record was made', async () => {
    const { agent: owner } = await agentFor({ role: 'owner', email: 'owner@example.test' });
    const { record } = await start(owner);
    const admin = await seedUser({ email: 'dana.adopt@example.test', role: 'admin', organisation_id: org.id, name: 'Dana Admin' });
    expect((await owner.post(`/api/onboarding/journey/records/${record.id}/offer/skip`)).status).toBe(200);
    const rel = await owner.post(`/api/onboarding/journey/records/${record.id}/release`);
    expect(rel.status).toBe(409);
    expect(rel.body.code).toBe('account_exists');
    const { rows } = await db.pool.query('SELECT role, password_hash FROM users WHERE id = $1', [admin.id]);
    expect(rows[0].role).toBe('admin');
    expect(rows[0].password_hash).toBe(admin.password_hash);
    const { rows: a } = await db.pool.query('SELECT user_id, status FROM onboarding_assignments WHERE id = $1', [record.id]);
    expect(a[0].user_id).toBeNull();
    expect(a[0].status).toBe('created');
  });

  test('accepting the invitation refuses once the linked account is no longer a pre-employee; its password is untouched', async () => {
    const { agent: owner } = await agentFor({ role: 'owner', email: 'owner@example.test' });
    const { id, url } = await released(owner);
    const { rows: a } = await db.pool.query('SELECT user_id FROM onboarding_assignments WHERE id = $1', [id]);
    // The account changes underneath the record (e.g. an Owner promoted it by hand).
    await db.pool.query("UPDATE users SET role = 'admin', password_hash = 'keep-me' WHERE id = $1", [a[0].user_id]);

    const res = await request(server).post('/api/onboarding-invite/accept').set('X-Forwarded-For', nextIp())
      .send({ token: tokenOf(url), password: STARTER_PASSWORD });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('account_conflict');
    const { rows } = await db.pool.query('SELECT role, password_hash FROM users WHERE id = $1', [a[0].user_id]);
    expect(rows[0]).toMatchObject({ role: 'admin', password_hash: 'keep-me' });
    // The invitation was not spent by the refused attempt.
    const { rows: inv } = await db.pool.query("SELECT status FROM user_invites WHERE onboarding_assignment_id = $1", [id]);
    expect(inv[0].status).toBe('pending');
  });

  test('activation and the temporary-password actions refuse a linked account that is not a pre-employee', async () => {
    const { agent: owner } = await agentFor({ role: 'owner', email: 'owner@example.test' });
    const { id } = await released(owner);
    const { rows: a } = await db.pool.query('SELECT user_id FROM onboarding_assignments WHERE id = $1', [id]);
    await db.pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [a[0].user_id]);

    const act = await owner.post(`/api/onboarding/assignments/${id}/activate`);
    expect(act.status).toBe(409);
    const acc = await owner.post(`/api/onboarding/assignments/${id}/account`).send({});
    expect(acc.status).toBe(409);
    expect(acc.body.code).toBe('account_not_owned');
    await db.pool.query('UPDATE onboarding_assignments SET account_created_at = NOW() WHERE id = $1', [id]);
    const re = await owner.post(`/api/onboarding/assignments/${id}/account/reissue-password`).send({});
    expect(re.status).toBe(409);
    expect(re.body.code).toBe('account_not_owned');
    const { rows } = await db.pool.query('SELECT role FROM users WHERE id = $1', [a[0].user_id]);
    expect(rows[0].role).toBe('admin');
  });

  test('a staff invitation is refused for an email with an onboarding in progress', async () => {
    const { agent: owner } = await agentFor({ role: 'owner', email: 'owner@example.test' });
    await start(owner);
    const res = await owner.post('/api/invites').send({ email: 'dana.adopt@example.test', role: 'admin' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('onboarding_in_progress');
  });
});

describe('B-4 — the temporary-password path keeps the record\'s route, status and agreed role', () => {
  test('on a released Read-only record it issues a password only, and a different role is refused', async () => {
    const { agent: owner } = await agentFor({ role: 'owner', email: 'owner@example.test' });
    const { id } = await released(owner);
    const before = await db.pool.query('SELECT status, proposed_role FROM onboarding_assignments WHERE id = $1', [id]);
    const { rows: count0 } = await db.pool.query('SELECT COUNT(*)::int AS n FROM onboarding_requirements WHERE assignment_id = $1', [id]);

    const wrong = await owner.post(`/api/onboarding/assignments/${id}/account`).send({ portalRole: 'employee' });
    expect(wrong.status).toBe(409);
    expect(wrong.body.code).toBe('role_mismatch');

    const ok = await owner.post(`/api/onboarding/assignments/${id}/account`).send({});
    expect(ok.status).toBe(201);
    expect(ok.body.temporaryPassword).toBeTruthy();
    const after = await db.pool.query('SELECT status, proposed_role FROM onboarding_assignments WHERE id = $1', [id]);
    expect(after.rows[0]).toEqual(before.rows[0]);
    expect(after.rows[0].proposed_role).toBe('read_only');
    const { rows: count1 } = await db.pool.query('SELECT COUNT(*)::int AS n FROM onboarding_requirements WHERE assignment_id = $1', [id]);
    expect(count1[0].n).toBe(count0[0].n);
  });
});
