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

const OT = {
  name: 'Olive Therapist', personalEmail: 'olive.ot@example.test', position: 'Occupational Therapist',
  roleCategory: 'occupational_therapist', employmentType: 'full_time', proposedRole: 'therapist',
  isTreatingTherapist: true, payBasis: 'annual', payRate: 85000, hoursPerWeek: 38,
};

/** A small, real PDF with the given lines of text in it. */
async function pdfWith(...lines) {
  const { PDFDocument, StandardFonts } = require('pdf-lib');
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  lines.forEach((line, i) => page.drawText(line, { x: 50, y: 780 - i * 20, size: 11, font }));
  return Buffer.from(await pdf.save()).toString('base64');
}

async function attach(owner, id, kind, ...lines) {
  return owner.post(`/api/onboarding/journey/records/${id}/documents/${kind}`)
    .send({ fileName: `${kind}.pdf`, fileMime: 'application/pdf', fileData: await pdfWith(...lines) });
}

/** Start a record and release it through the portal route. */
async function released(owner, over = {}) {
  const body = await start(owner, over);
  const id = body.record.id;
  expect((await owner.post(`/api/onboarding/journey/records/${id}/offer/skip`)).status).toBe(200);
  const rel = await owner.post(`/api/onboarding/journey/records/${id}/release`);
  expect(rel.status).toBe(201);
  return { id, url: rel.body.release.onboardingUrl, body: rel.body };
}

async function requirementByCode(id, code) {
  const { rows } = await db.pool.query('SELECT * FROM onboarding_requirements WHERE assignment_id = $1 AND template_code = $2', [id, code]);
  return rows[0];
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

describe('Owner decision 4 / B-5 — no placeholder or unattached document reaches a starter', () => {
  test('a policy still holding "[TO CONFIRM …]" gaps blocks the release, and is named', async () => {
    const { agent: owner } = await agentFor({ role: 'owner', email: 'owner@example.test' });
    const odb = require('../../onboarding-db');
    const doc = (await odb.listDocuments(org.id)).find((d) => d.code === 'POL_COLLECTION_NOTICE');
    const v = await odb.createDocumentVersion(doc.id, {
      title: doc.title, body: 'Employee Privacy Collection Notice\n\nContact: [TO CONFIRM: privacy officer name and role]',
      effectiveDate: '2026-10-01', changeNote: 'Draft with gaps',
    });
    await odb.publishDocumentVersion(doc.id, v.id, null);
    for (const pkg of await odb.listPackages(org.id, { kind: 'package' })) {
      await odb.publishPackage(org.id, await odb.getPackage(org.id, pkg.id), null, 'Repin');
    }
    const { record } = await start(owner);
    await owner.post(`/api/onboarding/journey/records/${record.id}/offer/skip`);
    const rel = await owner.post(`/api/onboarding/journey/records/${record.id}/release`);
    expect(rel.status).toBe(409);
    expect(rel.body.code).toBe('documents_not_ready');
    expect(rel.body.error).toMatch(/Collection Notice/);
    expect(rel.body.error).toMatch(/TO CONFIRM/);
  });

  test('a contract with gaps cannot be attached; a finished one can, and only then can the starter acknowledge it', async () => {
    const { agent: owner } = await agentFor({ role: 'owner', email: 'owner@example.test' });
    const { id, url } = await released(owner);
    const gaps = await attach(owner, id, 'contract', 'Contract of Employment', 'Notice period: [TO CONFIRM: weeks]');
    expect(gaps.status).toBe(400);
    expect(gaps.body.code).toBe('document_not_ready');

    const starter = request.agent(server);
    const acc = await starter.post('/api/onboarding-invite/accept').set('X-Forwarded-For', nextIp())
      .send({ token: tokenOf(url), password: STARTER_PASSWORD });
    expect(acc.status).toBe(200);
    const contract = await requirementByCode(id, 'REQ_CONTRACT');
    const early = await starter.post(`/api/onboarding/me/requirements/${contract.id}/acknowledge`).send({ acknowledged: true, typedLegalName: 'Dana Adopt' });
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('document_not_attached');

    expect((await attach(owner, id, 'contract', 'Contract of Employment', 'Agreed terms for Dana Adopt.')).status).toBe(201);
    const detail = await starter.get(`/api/onboarding/me/requirements/${contract.id}`);
    expect(detail.body.attachedDocument).toMatchObject({ fileName: 'contract.pdf' });
    const file = await starter.get(detail.body.attachedDocument.url);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toMatch(/pdf/);
    const ack = await starter.post(`/api/onboarding/me/requirements/${contract.id}/acknowledge`).send({ acknowledged: true, typedLegalName: 'Dana Adopt' });
    expect(ack.status).toBe(200);
    const after = await requirementByCode(id, 'REQ_CONTRACT');
    expect(after.data.attachedDocumentSha256).toMatch(/^[0-9a-f]{64}$/);
    // Fixed once acknowledged.
    expect((await attach(owner, id, 'contract', 'A different contract')).status).toBe(409);
    // Another starter cannot read it; a viewer without onboarding.view cannot either.
    const { agent: therapist } = await agentFor({ role: 'therapist', email: 't@example.test' });
    expect((await therapist.get(`/api/onboarding/journey/records/${id}/documents/contract/preview`)).status).toBe(403);
  });
});

describe('Owner decision 3 — waivers are the Owner\'s, with a reason, never a clinician\'s statutory checks', () => {
  test('a reviewer cannot set anything aside; the Owner cannot set aside Ahpra, NDIS screening or the WWCC for an OT', async () => {
    const { agent: owner } = await agentFor({ role: 'owner', email: 'owner@example.test' });
    const { id } = await released(owner, OT);
    const { agent: reviewer } = await agentFor({ role: 'admin', email: 'rev@example.test', permissions: ['onboarding.view', 'onboarding.review', 'onboarding.verify', 'onboarding.activate'] });
    const vehicle = (await db.pool.query(
      `SELECT id FROM onboarding_requirements WHERE assignment_id = $1 AND template_code NOT IN ('REQ_AHPRA','REQ_NDIS_SCREENING','REQ_WWCC','REQ_RIGHT_TO_WORK') AND blocks_activation = FALSE LIMIT 1`, [id])).rows[0];
    expect((await reviewer.post(`/api/onboarding/assignments/${id}/requirements/${vehicle.id}/not-applicable`).send({ reason: 'n/a' })).status).toBe(403);
    expect((await reviewer.post(`/api/onboarding/assignments/${id}/requirements/${vehicle.id}/waive`).send({ reason: 'n/a' })).status).toBe(403);

    for (const code of ['REQ_AHPRA', 'REQ_NDIS_SCREENING', 'REQ_WWCC']) {
      const r = await requirementByCode(id, code);
      if (!r) continue;
      const na = await owner.post(`/api/onboarding/assignments/${id}/requirements/${r.id}/not-applicable`).send({ reason: 'Not needed' });
      expect(na.status).toBe(409);
      expect(na.body.code).toBe('statutory_not_waivable');
      const w = await owner.post(`/api/onboarding/assignments/${id}/requirements/${r.id}/waive`).send({ reason: 'Not needed' });
      expect(w.status).toBe(409);
    }
    // The Owner may set a non-statutory item aside, with a reason only.
    expect((await owner.post(`/api/onboarding/assignments/${id}/requirements/${vehicle.id}/not-applicable`).send({})).status).toBe(400);
    expect((await owner.post(`/api/onboarding/assignments/${id}/requirements/${vehicle.id}/not-applicable`).send({ reason: 'Not part of this role' })).status).toBe(200);
  });

  test('a statutory check set aside on a clinician by hand still blocks activation', async () => {
    const { agent: owner } = await agentFor({ role: 'owner', email: 'owner@example.test' });
    const { id } = await released(owner, OT);
    await db.pool.query(`UPDATE onboarding_requirements SET status = 'not_applicable' WHERE assignment_id = $1 AND template_code = 'REQ_AHPRA'`, [id]);
    const readiness = await require('../../onboarding-lifecycle').activationReadiness(
      (await db.pool.query('SELECT * FROM onboarding_assignments WHERE id = $1', [id])).rows[0]);
    expect(readiness.blockers.find((b) => b.code === 'REQ_AHPRA').reason).toMatch(/clinician/);
  });
});

describe('Owner decision 2 — activation is the Owner\'s press, only when everything required is done', () => {
  test('before the starter sets a password, Activate is refused and says so; nothing activates by itself', async () => {
    const { agent: owner } = await agentFor({ role: 'owner', email: 'owner@example.test' });
    const { id } = await released(owner);
    await db.pool.query(`UPDATE onboarding_requirements SET status = 'complete' WHERE assignment_id = $1`, [id]);
    const act = await owner.post(`/api/onboarding/assignments/${id}/activate`);
    expect(act.status).toBe(409);
    expect(act.body.blockers.map((b) => b.code)).toContain('password_not_set');
    const { rows } = await db.pool.query('SELECT u.role FROM users u JOIN onboarding_assignments a ON a.user_id = u.id WHERE a.id = $1', [id]);
    expect(rows[0].role).toBe('pre_employee');
  });

  test('B-9: verifying a credential requirement makes it a verified credential record', async () => {
    const { agent: owner } = await agentFor({ role: 'owner', email: 'owner@example.test' });
    const { id, url } = await released(owner, OT);
    const starter = request.agent(server);
    await starter.post('/api/onboarding-invite/accept').set('X-Forwarded-For', nextIp()).send({ token: tokenOf(url), password: STARTER_PASSWORD });
    const ahpra = await requirementByCode(id, 'REQ_AHPRA');
    const sub = await starter.post(`/api/onboarding/me/requirements/${ahpra.id}/credential`).send({ registrationNumber: 'OCC0009999999', expiryDate: '2027-11-30' });
    expect(sub.status).toBe(200);
    const ver = await owner.post(`/api/onboarding/assignments/${id}/requirements/${ahpra.id}/verify`).send({ reference: 'Ahpra register checked' });
    expect(ver.status).toBe(200);
    const { rows } = await db.pool.query(
      'SELECT status, lifecycle_status, verified_by_user_id FROM credentials WHERE onboarding_requirement_id = $1', [ahpra.id]);
    expect(rows[0]).toMatchObject({ status: 'verified', lifecycle_status: 'current' });
    expect(rows[0].verified_by_user_id).toBeTruthy();
  });
});

describe('Owner decision 1 — the portal route', () => {
  test('the offer settles → release is next; Create portal account refers the Owner to the release', async () => {
    const { agent: owner } = await agentFor({ role: 'owner', email: 'owner@example.test' });
    const { record } = await start(owner);
    const skip = await owner.post(`/api/onboarding/journey/records/${record.id}/offer/skip`);
    expect(skip.body.route).toBe('portal');
    expect(skip.body.journey.next).toMatchObject({ actor: 'admin', action: 'release' });
    const res = await owner.post(`/api/onboarding/assignments/${record.id}/account`).send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('use_release');
  });

  test('B-12: an expired invitation is renewed by Resend — a new link, the old one dead, the starter told plainly', async () => {
    const { agent: owner } = await agentFor({ role: 'owner', email: 'owner@example.test' });
    const { id, url } = await released(owner);
    await db.pool.query(`UPDATE user_invites SET expires_at = NOW() - INTERVAL '1 day' WHERE onboarding_assignment_id = $1`, [id]);
    const dead = await request(server).post('/api/onboarding-invite/check').set('X-Forwarded-For', nextIp()).send({ token: tokenOf(url) });
    expect(dead.body).toMatchObject({ ok: false, code: 'expired' });
    expect(dead.body.message).toMatch(/ask the practice/i);

    const rec = await owner.get(`/api/onboarding/journey/records/${id}`);
    expect(rec.body.invitation).toMatchObject({ status: 'expired', canResend: true });
    const renewed = await owner.post(`/api/onboarding/assignments/${id}/resend-invite`).send({});
    expect(renewed.status).toBe(200);
    expect(renewed.body.onboardingUrl).toBeTruthy();
    expect(tokenOf(renewed.body.onboardingUrl)).not.toBe(tokenOf(url));
    const old = await request(server).post('/api/onboarding-invite/check').set('X-Forwarded-For', nextIp()).send({ token: tokenOf(url) });
    expect(old.body.ok).toBe(false);
    const accept = await request(server).post('/api/onboarding-invite/accept').set('X-Forwarded-For', nextIp())
      .send({ token: tokenOf(renewed.body.onboardingUrl), password: STARTER_PASSWORD });
    expect(accept.status).toBe(200);
    // Once the starter has their own password, Resend refuses and says why.
    const again = await owner.post(`/api/onboarding/assignments/${id}/resend-invite`).send({});
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('already_accepted');
    // Only someone who may assign onboarding can renew.
    const { agent: viewer } = await agentFor({ role: 'admin', email: 'v@example.test', permissions: ['onboarding.view'] });
    expect((await viewer.post(`/api/onboarding/assignments/${id}/resend-invite`).send({})).status).toBe(403);
  });

  test('B-13: an unreleased record moves to the current package version on a confirmed request only', async () => {
    const { agent: owner } = await agentFor({ role: 'owner', email: 'owner@example.test' });
    const { record } = await start(owner);
    const odb = require('../../onboarding-db');
    const pkg = await odb.getPackage(org.id, record.packageId);
    await odb.publishPackage(org.id, pkg, null, 'v next');
    const before = await owner.get(`/api/onboarding/journey/records/${record.id}`);
    expect(before.body.packageVersion.behind).toBe(true);
    expect((await owner.post(`/api/onboarding/journey/records/${record.id}/package-version`).send({})).body.code).toBe('confirm_required');
    const moved = await owner.post(`/api/onboarding/journey/records/${record.id}/package-version`).send({ confirm: true });
    expect(moved.status).toBe(200);
    expect(moved.body.packageVersion.behind).toBe(false);
    const { agent: viewer } = await agentFor({ role: 'admin', email: 'v2@example.test', permissions: ['onboarding.view'] });
    expect((await viewer.post(`/api/onboarding/journey/records/${record.id}/package-version`).send({ confirm: true })).status).toBe(403);
  });

  test('B-15: the letter particulars typed on the Start form reach the offer terms', async () => {
    const { agent: owner } = await agentFor({ role: 'owner', email: 'owner@example.test' });
    const { offer } = await start(owner, { award: 'QA-AWARD', payCycle: 'Weekly', workPattern: 'QA-PATTERN', superannuationRate: 12, offerClosingDate: '2026-11-20', cpdAllowance: 1500 });
    expect(offer.terms).toMatchObject({ award: 'QA-AWARD', payCycle: 'Weekly', workPattern: 'QA-PATTERN', superannuationRate: 12, offerClosingDate: '2026-11-20', cpdAllowance: 1500 });
  });
});

describe('the practice\'s details are settings the Owner edits, used everywhere', () => {
  test('Owner-only, validated field by field, and the letter and Email 1 follow them', async () => {
    const { agent: owner } = await agentFor({ role: 'owner', email: 'owner@example.test' });
    const bad = await owner.put('/api/onboarding/settings').send({ practiceEmail: 'nope', practiceAbn: '12' });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.fields).sort()).toEqual(['practiceAbn', 'practiceEmail']);

    const { agent: delegate } = await agentFor({ role: 'admin', email: 'd@example.test', permissions: ['onboarding.view', 'onboarding.manage_compliance'] });
    expect((await delegate.put('/api/onboarding/settings').send({ offerSignatoryName: 'Someone Else' })).status).toBe(403);
    // The delegate can still change the compliance settings that are theirs.
    expect((await delegate.put('/api/onboarding/settings').send({ defaultDueDays: 21 })).status).toBe(200);

    const ok = await owner.put('/api/onboarding/settings').send({ offerSignatoryName: 'Kim Lee', offerSignatoryTitle: 'Practice Manager', returnEmail: 'hr@example.test' });
    expect(ok.status).toBe(200);
    const { record } = await start(owner);
    const rec = await owner.get(`/api/onboarding/journey/records/${record.id}`);
    expect(rec.body.email.body).toMatch(/Kim\nPractice Manager \| Opal Therapy$/);
    const letter = await owner.get(`/api/onboarding/journey/records/${record.id}/offer/letter/download`).buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    const xml = await (await require('jszip').loadAsync(letter.body)).file('word/document.xml').async('string');
    expect(xml).toContain('Kim Lee');
  });
});

describe('data, validation and permissions', () => {
  async function acceptedStarter(owner, over) {
    const { id, url } = await released(owner, over);
    const starter = request.agent(server);
    await starter.post('/api/onboarding-invite/accept').set('X-Forwarded-For', nextIp()).send({ token: tokenOf(url), password: STARTER_PASSWORD });
    return { id, starter };
  }

  test('B-21: an unrecognised choice is a 400 naming the field, not a 500', async () => {
    const { agent: owner } = await agentFor({ role: 'owner', email: 'owner@example.test' });
    const { id, starter } = await acceptedStarter(owner);
    const form = async (code, body) => starter.post(`/api/onboarding/me/requirements/${(await requirementByCode(id, code)).id}/form`).send(body);
    const tax = await form('REQ_TAX_SETUP', { payrollNoticeAccepted: true, taxSubmissionMethod: 'employer_electronic_form', residencyStatus: 'resident', tfn: '123456782' });
    expect(tax.status).toBe(400);
    expect(tax.body.field).toBe('residencyStatus');
    const idn = await form('REQ_IDENTITY', { evidenceType: 'passport', nameOnDocument: 'Dana Adopt' });
    expect(idn.status).toBe(400);
    expect(idn.body.field).toBe('evidenceType');
    const rtw = await form('REQ_RIGHT_TO_WORK', { rightToWorkBasis: 'australian_citizen' });
    expect(rtw.status).toBe(400);
    expect(rtw.body.field).toBe('rightToWorkBasis');
    const dob = await form('REQ_PERSONAL_DETAILS', { legalFirstName: 'Dana', surname: 'Adopt', dateOfBirth: '31/02/1990', mobile: '0400000000', addressLine1: '1 St', suburb: 'Perth', postcode: '6000' });
    expect(dob.status).toBe(400);
    expect(dob.body.field).toBe('dateOfBirth');
    expect((await form('REQ_RIGHT_TO_WORK', { rightToWorkBasis: 'citizen' })).status).toBe(200);
  });

  test('B-18: the profile is tiered by permission and every sensitive read is audited', async () => {
    const { agent: owner } = await agentFor({ role: 'owner', email: 'owner@example.test' });
    const { id, starter } = await acceptedStarter(owner);
    const pd = await requirementByCode(id, 'REQ_PERSONAL_DETAILS');
    expect((await starter.post(`/api/onboarding/me/requirements/${pd.id}/form`).send({
      legalFirstName: 'Dana', surname: 'Adopt', dateOfBirth: '1990-02-03', mobile: '0400000000', addressLine1: '1 Home St', suburb: 'Perth', state: 'WA', postcode: '6000',
    })).status).toBe(200);

    const { agent: viewer } = await agentFor({ role: 'admin', email: 'viewer@example.test', permissions: ['onboarding.view'] });
    const v = await viewer.get(`/api/onboarding/journey/records/${id}/profile`);
    expect(v.status).toBe(200);
    expect(v.body.profile.personal).toBeNull();
    expect(v.body.profile.restricted).toEqual(expect.arrayContaining(['personal', 'payroll']));
    const vr = await viewer.get(`/api/onboarding/journey/records/${id}`);
    expect(JSON.stringify(vr.body.profile)).not.toContain('1 Home St');

    await db.pool.query("DELETE FROM audit_logs WHERE action = 'onboarding.profile_viewed'");
    const o = await owner.get(`/api/onboarding/journey/records/${id}/profile`);
    expect(o.body.profile.personal.address).toContain('1 Home St');
    const { rows } = await db.pool.query("SELECT actor_user_id FROM audit_logs WHERE action = 'onboarding.profile_viewed'");
    expect(rows.length).toBe(1);
  });

  test('B-20: a returned scan needs the sensitive-identity tier, not just review, and each view is audited', async () => {
    const { agent: owner } = await agentFor({ role: 'owner', email: 'owner@example.test' });
    const { record } = await start(owner);
    await owner.post(`/api/onboarding/journey/records/${record.id}/offer/skip`);
    const up = await owner.post(`/api/onboarding/journey/records/${record.id}/returns`).send({
      fileName: 'passport.txt', fileMime: 'text/plain', fileData: Buffer.from('PASSPORT Dana Adopt Australia'.padEnd(60, ' ')).toString('base64'),
    });
    expect(up.status).toBe(201);
    const docId = up.body.stored[0].id;
    const { agent: reviewer } = await agentFor({ role: 'admin', email: 'rev@example.test', permissions: ['onboarding.view', 'onboarding.review'] });
    expect((await reviewer.get(`/api/onboarding/assignments/${record.id}/returned-documents/${docId}/preview`)).status).toBe(403);
    expect((await owner.get(`/api/onboarding/assignments/${record.id}/returned-documents/${docId}/preview`)).status).toBe(200);
    const { rows } = await db.pool.query("SELECT 1 FROM audit_logs WHERE action = 'onboarding.returned_document_viewed'");
    expect(rows.length).toBe(1);
  });

  test('B-6: a later document that disagrees with an applied value reopens it as a conflict', async () => {
    const { agent: owner } = await agentFor({ role: 'owner', email: 'owner@example.test' });
    const { record } = await start(owner);
    const rdb = require('../../onboarding-returns-db');
    const base = { organisationId: org.id, assignmentId: record.id, key: 'surname', source: { sourceLabel: 'New Employee Details' } };
    const first = await rdb.upsertResolved({ ...base, outcome: 'reliable', value: 'Adopt', confidence: 'high' });
    await db.pool.query(`UPDATE onboarding_extracted_fields SET status = 'applied', applied_at = NOW() WHERE id = $1`, [first.id]);
    const reopened = await rdb.upsertResolved({ ...base, outcome: 'conflict', value: null, reason: 'The documents disagree',
      options: [{ sourceKind: 'form', sourceLabel: 'New Employee Details', value: 'Adopt', display: 'Adopt' }, { sourceKind: 'form', sourceLabel: 'Passport', value: 'Adoptt', display: 'Adoptt' }] });
    expect(reopened).toBeTruthy();
    expect(reopened).toMatchObject({ outcome: 'conflict', status: 'proposed' });
    // Once the Owner has settled it, a later reading never overrides their choice.
    await db.pool.query(`UPDATE onboarding_extracted_fields SET resolution = 'owner', status = 'applied' WHERE id = $1`, [first.id]);
    expect(await rdb.upsertResolved({ ...base, outcome: 'conflict', value: null })).toBeNull();
  });
});
