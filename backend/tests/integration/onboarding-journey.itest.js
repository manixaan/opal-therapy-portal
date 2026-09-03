'use strict';

/**
 * THE THREE-STAGE JOURNEY — offer → documentation → induction, against a real
 * PostgreSQL database (migration 047).
 *
 * The path the feature exists for:
 *
 *   Owner presses Start Onboarding once → the record AND the letter of offer
 *   draft exist → the Owner approves and sends → the candidate reads the
 *   letter through a token-only page and accepts → the release happens BY
 *   ITSELF (account, invitation, requirement set, employment profile carrying
 *   the offer terms) → the documentation is done → the induction checklist
 *   is generated → activating portal access is one of its tasks → the last
 *   task closes the record.
 *
 * Alongside it, what must NOT happen: a token answering twice, a therapist
 * reading the board, another organisation reading a record, a viewer ticking
 * off an induction task, and a declined offer silently disappearing.
 */

const http = require('http');
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { db, truncateAll, seedUser, seedOrganisation, closePool } = require('./helpers');

jest.setTimeout(60000);

const PASSWORD = 'JourneyPass1';

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
  app.use('/', require('../../onboarding-employee-routes'));
  app.use('/', require('../../onboarding-workflow-routes'));
  app.use('/', require('../../onboarding-journey-routes'));
  app.use('/', require('../../onboarding-assignment-routes'));
  app.use('/', require('../../onboarding-routes'));
  return app;
}

let app; let server; let org;
let ipCounter = 0;
const nextIp = () => `10.9.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;

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

async function seedCatalogue() {
  return require('../../onboarding-seed').seedOnboarding({ organisationId: org.id });
}

/** Content behind every policy slot, then republish, so a release is allowed. */
async function publishAllDocuments() {
  const odb = require('../../onboarding-db');
  // Every document, link-only ones included: two of the activation-blocking
  // acknowledgements (FWIS, NDIS Code) point at link-only documents, and a
  // release refuses while any blocking acknowledgement has no published version.
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
  name: 'Jane Smith', personalEmail: 'jane.smith@example.com', mobile: '0412 000 000',
  position: 'Occupational Therapist', roleCategory: 'occupational_therapist', employmentType: 'part_time',
  proposedRole: 'therapist', isTreatingTherapist: true,
  startDate: '2026-11-02', payBasis: 'annual', payRate: 92000, hoursPerWeek: 30.4,
  awardClassification: 'HPSS Award Level 2', probationMonths: 6, workLocation: 'Fremantle',
};

async function start(agent, over = {}) {
  const res = await agent.post('/api/onboarding/journey/records').send({ ...START_BODY, ...over });
  expect(res.status).toBe(201);
  return res.body;
}

const tokenFrom = (url) => new URL(url).searchParams.get('token');

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
  await seedCatalogue();
  await publishAllDocuments();
});

// ═════════════════════════════════════════════════════════════════════════════

describe('Stage 1 — Start Onboarding creates the record and the letter together', () => {
  test('one form produces one record, one offer draft, and a next action for the Owner', async () => {
    const { agent } = await agentFor({ role: 'owner', email: 'owner@example.com' });
    const body = await start(agent);

    expect(body.record.status).toBe('created');
    expect(body.record.terms).toMatchObject({ payBasis: 'annual', payRate: 92000, hoursPerWeek: 30.4, probationMonths: 6 });
    expect(body.offer).toMatchObject({ version: 1, status: 'draft' });
    expect(body.offer.terms.positionTitle).toBe('Occupational Therapist');
    expect(body.journey.stage.key).toBe('offer');
    expect(body.journey.next).toMatchObject({ actor: 'admin', action: 'approve_offer' });
    expect(body.letterHtml).toContain('Occupational Therapist');
    expect(body.letterHtml).toContain('$92,000.00 per annum');
    // The package was chosen for them.
    expect(body.record.packageId).toBeTruthy();
  });

  test('the terms are validated as a letter, not just stored', async () => {
    const { agent } = await agentFor({ role: 'owner', email: 'owner@example.com' });
    const res = await agent.post('/api/onboarding/journey/records').send({ ...START_BODY, payBasis: null, payRate: 50 });
    expect(res.status).toBe(400);
    expect(res.body.errors).toContain('Pay basis is required when a rate is given');
  });

  test('a second record for the same email is refused', async () => {
    const { agent } = await agentFor({ role: 'owner', email: 'owner@example.com' });
    await start(agent);
    const res = await agent.post('/api/onboarding/journey/records').send(START_BODY);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('assignment_exists');
  });

  test('only onboarding.assign can start; only onboarding.view can see the board', async () => {
    const viewer = await agentFor({ role: 'admin', email: 'viewer@example.com', permissions: ['onboarding.view'] });
    expect((await viewer.agent.post('/api/onboarding/journey/records').send(START_BODY)).status).toBe(403);
    expect((await viewer.agent.get('/api/onboarding/journey/board')).status).toBe(200);

    const therapist = await agentFor({ role: 'therapist', email: 't@example.com' });
    expect((await therapist.agent.get('/api/onboarding/journey/board')).status).toBe(403);
  });
});

describe('Stage 1 → 2 — approve, send, accept, and the release happens by itself', () => {
  test('the whole path, with the terms reaching the employment profile untyped', async () => {
    const { agent, user: owner } = await agentFor({ role: 'owner', email: 'owner@example.com' });
    const { record } = await start(agent);
    const base = `/api/onboarding/journey/records/${record.id}`;

    // Sending before approval is refused.
    expect((await agent.post(`${base}/offer/send`)).status).toBe(409);

    const approved = await agent.post(`${base}/offer/approve`);
    expect(approved.status).toBe(200);
    expect(approved.body.offer.status).toBe('approved');
    expect(approved.body.journey.next.action).toBe('send_offer');

    const sent = await agent.post(`${base}/offer/send`);
    expect(sent.status).toBe(200);
    expect(sent.body.offer.status).toBe('sent');
    expect(sent.body.offer.linkLive).toBe(true);
    expect(sent.body.delivery.status).toBe('skipped'); // no SMTP in tests
    expect(sent.body.offerUrl).toMatch(/^https:\/\/portal\.test\.invalid\/offer\?token=/);
    expect(sent.body.journey.next.actor).toBe('employee');
    expect(sent.body.dispatches[0]).toMatchObject({ kind: 'letter_of_offer', status: 'skipped' });

    // The response link is never returned again, and the token is stored hashed.
    const again = await agent.get(base);
    expect(again.body.offerUrl).toBeUndefined();
    const token = tokenFrom(sent.body.offerUrl);
    const { rows } = await db.pool.query('SELECT response_token_hash FROM onboarding_offers WHERE id = $1', [sent.body.offer.id]);
    expect(rows[0].response_token_hash).not.toBe(token);
    expect(rows[0].response_token_hash).toHaveLength(64);

    // The candidate reads it without an account.
    const pub = request(server);
    const check = await pub.post('/api/onboarding-offer/check').set('X-Forwarded-For', nextIp()).send({ token });
    expect(check.status).toBe(200);
    expect(check.body.letterHtml).toContain('Occupational Therapist');
    expect(check.body.letterHtml).toContain('30.4 hours per week');
    expect(check.body).not.toHaveProperty('applicantEmail');

    // Accepting needs a typed name.
    expect((await pub.post('/api/onboarding-offer/respond').set('X-Forwarded-For', nextIp())
      .send({ token, decision: 'accept' })).status).toBe(400);

    const accept = await pub.post('/api/onboarding-offer/respond').set('X-Forwarded-For', nextIp())
      .send({ token, decision: 'accept', signedName: 'Jane Smith' });
    expect(accept.status).toBe(200);
    expect(accept.body.decision).toBe('accepted');

    // Single use.
    const twice = await pub.post('/api/onboarding-offer/respond').set('X-Forwarded-For', nextIp())
      .send({ token, decision: 'accept', signedName: 'Jane Smith' });
    expect(twice.status).toBe(410);
    expect(twice.body.code).toBe('answered');

    // The release happened without an Owner click.
    const after = await agent.get(base);
    expect(after.body.offer.status).toBe('accepted');
    expect(after.body.offer.signedName).toBe('Jane Smith');
    expect(after.body.record.status).toBe('invite_sent');
    expect(after.body.record.userId).toBeTruthy();
    expect(after.body.journey.stage.key).toBe('documentation');
    expect(after.body.journey.stages[0].state).toBe('complete');
    expect(after.body.journey.next.actor).toBe('employee');
    expect(after.body.sections.length).toBeGreaterThan(0);

    const { rows: users } = await db.pool.query('SELECT role FROM users WHERE email = $1', ['jane.smith@example.com']);
    expect(users[0].role).toBe('pre_employee');
    const { rows: invites } = await db.pool.query(
      'SELECT invited_by_user_id, status FROM user_invites WHERE onboarding_assignment_id = $1', [record.id]);
    expect(invites).toHaveLength(1);
    expect(invites[0]).toMatchObject({ invited_by_user_id: owner.id, status: 'pending' });

    // The offer terms travelled: nobody re-typed hours, award or probation.
    const { rows: profiles } = await db.pool.query(
      'SELECT hours_per_week, award_classification, probation_end_date FROM employment_profiles WHERE assignment_id = $1', [record.id]);
    expect(Number(profiles[0].hours_per_week)).toBe(30.4);
    expect(profiles[0].award_classification).toBe('HPSS Award Level 2');
    expect(profiles[0].probation_end_date).toBeTruthy();

    // Terms are frozen once released.
    expect((await agent.put(`${base}/offer`).send({ terms: { ...START_BODY, positionTitle: 'Changed' } })).status).toBe(409);

    // The Owner was told.
    const { rows: notes } = await db.pool.query(
      "SELECT title FROM user_notifications WHERE user_id = $1 AND type LIKE 'onboarding_offer_accepted_%'", [owner.id]);
    expect(notes).toHaveLength(1);

    // And the audit trail names ids, never the person.
    const { rows: audit } = await db.pool.query(
      "SELECT action, metadata FROM audit_logs WHERE action IN ('onboarding.offer_accepted', 'onboarding.assignment_released') ORDER BY action");
    expect(audit.map((a) => a.action)).toEqual(['onboarding.assignment_released', 'onboarding.offer_accepted']);
    expect(JSON.stringify(audit)).not.toContain('jane.smith@example.com');
    expect(JSON.stringify(audit)).not.toContain('Jane Smith');
  });

  test('a reminder re-mints the link and the old one stops working', async () => {
    const { agent } = await agentFor({ role: 'owner', email: 'owner@example.com' });
    const { record } = await start(agent);
    const base = `/api/onboarding/journey/records/${record.id}`;
    await agent.post(`${base}/offer/approve`);
    const first = await agent.post(`${base}/offer/send`);
    const second = await agent.post(`${base}/offer/send`);
    expect(second.body.offer.reminderCount).toBe(1);
    expect(second.body.dispatches[0].kind).toBe('offer_reminder');

    const pub = request(server);
    const old = await pub.post('/api/onboarding-offer/check').set('X-Forwarded-For', nextIp()).send({ token: tokenFrom(first.body.offerUrl) });
    expect(old.status).toBe(404);
    const fresh = await pub.post('/api/onboarding-offer/check').set('X-Forwarded-For', nextIp()).send({ token: tokenFrom(second.body.offerUrl) });
    expect(fresh.status).toBe(200);
  });

  test('a declined offer blocks the stage, asks the Owner, and a revised letter is a new version', async () => {
    const { agent, user: owner } = await agentFor({ role: 'owner', email: 'owner@example.com' });
    const { record } = await start(agent);
    const base = `/api/onboarding/journey/records/${record.id}`;
    await agent.post(`${base}/offer/approve`);
    const sent = await agent.post(`${base}/offer/send`);

    const decline = await request(server).post('/api/onboarding-offer/respond').set('X-Forwarded-For', nextIp())
      .send({ token: tokenFrom(sent.body.offerUrl), decision: 'decline', reason: 'Accepted another role' });
    expect(decline.status).toBe(200);

    const after = await agent.get(base);
    expect(after.body.offer.status).toBe('declined');
    expect(after.body.offer.declineReason).toBe('Accepted another role');
    expect(after.body.record.status).toBe('created'); // nothing was released
    expect(after.body.journey.stages[0].state).toBe('blocked');
    expect(after.body.journey.next).toMatchObject({ actor: 'admin', action: 'reissue_offer' });
    const { rows: notes } = await db.pool.query(
      "SELECT 1 FROM user_notifications WHERE user_id = $1 AND type LIKE 'onboarding_offer_declined_%'", [owner.id]);
    expect(notes).toHaveLength(1);

    const revised = await agent.put(`${base}/offer`).send({ terms: { ...START_BODY, positionTitle: 'Senior Occupational Therapist', payRate: 99000 } });
    expect(revised.status).toBe(200);
    expect(revised.body.offer).toMatchObject({ version: 2, status: 'draft' });
    expect(revised.body.offerHistory).toHaveLength(2);
    expect(revised.body.record.jobTitle).toBe('Senior Occupational Therapist');
    expect(revised.body.journey.stages[0].state).toBe('active');
  });

  test('skipping the letter releases the documentation straight away', async () => {
    const { agent } = await agentFor({ role: 'owner', email: 'owner@example.com' });
    const { record } = await start(agent);
    const res = await agent.post(`/api/onboarding/journey/records/${record.id}/offer/skip`);
    expect(res.status).toBe(200);
    expect(res.body.offer.status).toBe('not_required');
    expect(res.body.release.status).toBe('released');
    expect(res.body.record.status).toBe('invite_sent');
  });
});

describe('Stage 3 — the induction checklist, portal access as a task, and completion', () => {
  async function toReadyToActivate(agent) {
    const { record } = await start(agent);
    const base = `/api/onboarding/journey/records/${record.id}`;
    await agent.post(`${base}/offer/skip`);
    // Stand in for the documentation stage: every requirement satisfied.
    await db.pool.query(
      `UPDATE onboarding_requirements SET status = 'complete', completed_at = NOW() WHERE assignment_id = $1`, [record.id]);
    await db.pool.query(
      `UPDATE onboarding_assignments SET status = 'ready_to_activate', submitted_at = NOW() WHERE id = $1`, [record.id]);
    return { record, base };
  }

  test('reaching the stage generates a role-keyed checklist, once', async () => {
    const { agent } = await agentFor({ role: 'owner', email: 'owner@example.com' });
    const { base } = await toReadyToActivate(agent);

    const one = await agent.get(base);
    expect(one.body.journey.stage.key).toBe('induction');
    expect(one.body.journey.stages[1].state).toBe('complete');
    const codes = one.body.tasks.map((t) => t.code);
    expect(codes).toEqual(expect.arrayContaining(['portal_access', 'work_email', 'payroll_setup', 'induction_walkthrough', 'clinical_supervision']));
    expect(one.body.journey.next).toMatchObject({ actor: 'admin', action: 'activate' });
    expect(one.body.record.inductionStartedAt).toBeTruthy();

    const two = await agent.get(base);
    expect(two.body.tasks).toHaveLength(one.body.tasks.length);
  });

  test('portal access runs as a task; the last task closes the record', async () => {
    const { agent } = await agentFor({ role: 'owner', email: 'owner@example.com' });
    const { record, base } = await toReadyToActivate(agent);
    await agent.get(base);

    // An automated task cannot simply be ticked.
    expect((await agent.post(`${base}/tasks/portal_access/complete`)).status).toBe(409);

    const run = await agent.post(`${base}/tasks/portal_access/run`);
    expect(run.status).toBe(200);
    expect(run.body.record.status).toBe('activated');
    expect(run.body.tasks.find((t) => t.code === 'portal_access').status).toBe('done');
    const { rows } = await db.pool.query('SELECT role FROM users WHERE id = $1', [record.userId || run.body.record.userId]);
    expect(rows[0].role).toBe('therapist');
    expect(run.body.journey.next.action).toBe('task');

    // Assign a task to a colleague, who is told.
    const { user: sam } = await agentFor({ role: 'admin', email: 'sam@example.com' });
    const assigned = await agent.patch(`${base}/tasks/work_email`).send({ assigneeUserId: sam.id, dueAt: '2026-10-30' });
    expect(assigned.status).toBe(200);
    expect(assigned.body.tasks.find((t) => t.code === 'work_email').assigneeName).toBe(sam.name);
    const { rows: notes } = await db.pool.query(
      "SELECT 1 FROM user_notifications WHERE user_id = $1 AND type LIKE 'onboarding_task_%'", [sam.id]);
    expect(notes).toHaveLength(1);

    let last;
    for (const t of run.body.tasks.filter((x) => x.code !== 'portal_access')) {
      last = await agent.post(`${base}/tasks/${t.code}/${t.code === 'equipment' ? 'skip' : 'complete'}`).send({ note: 'done in test' });
      expect(last.status).toBe(200);
    }
    expect(last.body.record.status).toBe('completed');
    expect(last.body.journey.stage.key).toBe('complete');
    expect(last.body.journey.next.actor).toBe('none');
    expect(last.body.journey.attention).toBe(0);

    const board = await agent.get('/api/onboarding/journey/board');
    expect(board.body.summary.complete).toBe(1);
    expect(board.body.summary.live).toBe(0);
  });

  test('activation refuses while a blocking requirement is open, and says so on the task', async () => {
    const { agent } = await agentFor({ role: 'owner', email: 'owner@example.com' });
    const { record, base } = await toReadyToActivate(agent);
    await db.pool.query(
      `UPDATE onboarding_requirements SET status = 'not_started'
        WHERE id = (SELECT id FROM onboarding_requirements WHERE assignment_id = $1 AND blocks_activation = TRUE LIMIT 1)`, [record.id]);
    await agent.get(base);
    const run = await agent.post(`${base}/tasks/portal_access/run`);
    expect(run.status).toBe(409);
    expect(run.body.code).toBe('activation_blocked');
    const after = await agent.get(base);
    expect(after.body.tasks.find((t) => t.code === 'portal_access').status).toBe('failed');
    expect(after.body.journey.counts.adminReview).toBe(1);
  });

  test('a viewer cannot tick off a task; another organisation cannot see the record', async () => {
    const { agent } = await agentFor({ role: 'owner', email: 'owner@example.com' });
    const { base } = await toReadyToActivate(agent);
    await agent.get(base);

    const viewer = await agentFor({ role: 'admin', email: 'viewer@example.com', permissions: ['onboarding.view'] });
    expect((await viewer.agent.post(`${base}/tasks/work_email/complete`)).status).toBe(403);
    expect((await viewer.agent.post(`${base}/tasks/portal_access/run`)).status).toBe(403);
    expect((await viewer.agent.get(base)).status).toBe(200);

    const otherOrg = await seedOrganisation('Somewhere Else');
    const hash = await bcrypt.hash(PASSWORD, 4);
    const stranger = await seedUser({ password_hash: hash, organisation_id: otherOrg.id, role: 'owner', email: 'stranger@example.com' });
    const sa = request.agent(server);
    await sa.post('/api/auth/login').set('X-Forwarded-For', nextIp()).send({ email: stranger.email, password: PASSWORD });
    expect((await sa.get(base)).status).toBe(404);
  });
});

describe('the board', () => {
  test('sorts by who needs the Owner, and counts each stage', async () => {
    const { agent } = await agentFor({ role: 'owner', email: 'owner@example.com' });
    const a = await start(agent);                                       // draft: needs the Owner
    const b = await start(agent, { name: 'Bob Brown', personalEmail: 'bob@example.com' });
    await agent.post(`/api/onboarding/journey/records/${b.record.id}/offer/approve`);
    await agent.post(`/api/onboarding/journey/records/${b.record.id}/offer/send`);   // sent: waits on Bob

    const board = await agent.get('/api/onboarding/journey/board');
    expect(board.status).toBe(200);
    expect(board.body.summary).toMatchObject({ live: 2, needsYou: 1, waitingOnEmployee: 1, byStage: { offer: 2, documentation: 0, induction: 0 } });
    expect(board.body.records[0].id).toBe(a.record.id);
    expect(board.body.records[0].next.actor).toBe('admin');
    expect(board.body.records[1].next.actor).toBe('employee');
    expect(board.body.records.every((r) => r.stages.length === 3)).toBe(true);
  });
});
