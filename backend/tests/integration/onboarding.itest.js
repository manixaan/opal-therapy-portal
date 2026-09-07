'use strict';

/**
 * ONBOARDING PACKAGES — integration tests against a real PostgreSQL database.
 *
 * These exercise the workflow the feature exists for, end to end:
 *
 *   Owner reviews a package → assigns → releases → invitation issued
 *   → applicant sets a password → completes forms, uploads, acknowledgements
 *   → submits → Owner verifies → activation gate → activated
 *   → the pre-employee is now a therapist, with their records retained.
 *
 * Plus the things that must NOT happen: a therapist reading someone else's
 * onboarding, an Admin without delegation seeing payroll, activation while a
 * blocking requirement is open, a TFN reaching the audit log or the API.
 */

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { db, truncateAll, seedUser, seedOrganisation, closePool } = require('./helpers');

const PASSWORD = 'OnboardPass1';
const PDF_B64 = Buffer.from('%PDF-1.4 onboarding evidence').toString('base64');

// A TFN that satisfies the ATO modulus-11 checksum, so validation passes and
// the tests exercise the real encrypt/mask path rather than a 400.
const VALID_TFN = '123456782';
// An ABN that satisfies the ATO modulus-89 checksum.
const VALID_ABN = '51824753556';

function buildApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use('/api/onboarding/imports', bodyParser.json({ limit: '62mb' }));
  app.use('/api/onboarding', bodyParser.json({ limit: '16mb' }));
  app.use(bodyParser.json({ limit: '10mb' }));
  app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false, saveUninitialized: false, cookie: { secure: false },
  }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../onboarding-employee-routes'));
  app.use('/', require('../../onboarding-assignment-routes'));
  app.use('/', require('../../onboarding-library-routes'));
  app.use('/', require('../../onboarding-routes'));
  return app;
}

let app;
let org;

// The login limiter is per-IP (10 per 15 minutes) and these tests log in far
// more often than that. `trust proxy` is enabled above precisely so each agent
// can present a distinct client IP, which is what a real deployment sees.
let _ipCounter = 0;
function nextIp() {
  _ipCounter += 1;
  return `10.${Math.floor(_ipCounter / 65025) % 255}.${Math.floor(_ipCounter / 255) % 255}.${(_ipCounter % 254) + 1}`;
}

async function agentFor(overrides) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser({ password_hash: hash, organisation_id: org.id, ...overrides });
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login')
    .set('X-Forwarded-For', nextIp())
    .send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user };
}

/** Seed the catalogue for this organisation. */
async function seedCatalogue() {
  return require('../../onboarding-seed').seedOnboarding({ organisationId: org.id });
}

/**
 * Publish a version of every document an acknowledgement depends on.
 *
 * The catalogue deliberately seeds policy SLOTS with no content — Opal does
 * not fabricate its own policies — and release refuses to ask anyone to
 * acknowledge an empty document. Publishing content first is therefore a real
 * step in the workflow, not test scaffolding, and this mirrors what an Owner
 * does before onboarding their first employee.
 */
async function publishAllDocuments(ownerAgent) {
  const docs = (await ownerAgent.get('/api/onboarding/documents')).body.documents;
  for (const doc of docs) {
    if (!doc.requiresAcknowledgement) continue;
    const version = await ownerAgent.post(`/api/onboarding/documents/${doc.id}/versions`).send({
      title: doc.title,
      body: `${doc.title}\n\nContent supplied for testing.`,
      effectiveDate: '2026-08-01',
      changeNote: 'Initial content',
    });
    expect(version.status).toBe(201);
    const published = await ownerAgent
      .post(`/api/onboarding/documents/${doc.id}/versions/${version.body.version.id}/publish`).send({});
    expect(published.status).toBe(200);
  }
  // Package versions pin the document version, so re-publish each package so
  // its snapshot points at the newly published documents.
  const pkgs = (await ownerAgent.get('/api/onboarding/packages?kind=package')).body.packages;
  for (const pkg of pkgs) {
    const res = await ownerAgent.post(`/api/onboarding/packages/${pkg.id}/publish`)
      .send({ changeNote: 'Pin published policy versions' });
    expect(res.status).toBe(201);
  }
}

beforeAll(() => {
  process.env.ONBOARDING_ENCRYPTION_KEY = 'cd'.repeat(32);
  app = buildApp();
});

beforeEach(async () => {
  await truncateAll();
  // The invitation limiter is also per-IP and in-memory; clear it so one test
  // file's volume does not look like an attack to the next test.
  require('../../onboarding-employee-routes')._resetInviteRateLimit();
  org = await seedOrganisation('Opal Therapy Test');
  await seedCatalogue();
});

afterAll(closePool);

// ═════════════════════════════════════════════════════════════════════════════

describe('catalogue and package engine', () => {
  test('seeds the registry, library, templates and six publishable packages', async () => {
    const { agent } = await agentFor({ role: 'owner' });

    const pkgs = await agent.get('/api/onboarding/packages');
    expect(pkgs.status).toBe(200);
    const assignable = pkgs.body.packages.filter((p) => p.kind === 'package');
    expect(assignable).toHaveLength(6);
    expect(assignable.every((p) => p.status === 'published' && p.currentVersion >= 1)).toBe(true);

    const compliance = await agent.get('/api/onboarding/compliance/requirements');
    expect(compliance.status).toBe(200);
    const codes = compliance.body.requirements.map((c) => c.code);
    expect(codes).toEqual(expect.arrayContaining(['FWIS', 'CEIS', 'FTCIS', 'NDIS_WORKER_SCREENING', 'WWCC_WA']));

    // The honesty column: worker screening must not be recorded as a blanket
    // legal requirement, because for an unregistered provider it is not one.
    const screening = compliance.body.requirements.find((c) => c.code === 'NDIS_WORKER_SCREENING');
    expect(screening.basis).not.toBe('LEGAL_REQUIREMENT');
    const police = compliance.body.requirements.find((c) => c.code === 'NATIONAL_POLICE_CHECK');
    expect(police.basis).toBe('OPAL_POLICY_REQUIREMENT');
  });

  test('Opal policies seed as drafts awaiting real content, never as invented policies', async () => {
    const { agent } = await agentFor({ role: 'owner' });
    const res = await agent.get('/api/onboarding/documents');
    expect(res.status).toBe(200);

    const privacy = res.body.documents.find((d) => d.code === 'POL_PRIVACY');
    expect(privacy).toBeTruthy();
    expect(privacy.status).toBe('draft');
    expect(privacy.contentStatus).toBe('document_required');

    // Official documents link to the publisher rather than shipping a copy
    // Opal was never given.
    const fwis = res.body.documents.find((d) => d.code === 'DOC_FWIS');
    expect(fwis.contentStatus).toBe('link_only');
    expect(fwis.ownerControlled).toBe(false);
    expect(fwis.officialSourceUrl).toContain('fairwork.gov.au');
  });

  test('preview resolves the right requirements per role and employment type', async () => {
    const { agent } = await agentFor({ role: 'owner' });
    const pkgs = (await agent.get('/api/onboarding/packages')).body.packages;
    const otCasual = pkgs.find((p) => p.code === 'PKG_OT_CASUAL');
    const adminCasual = pkgs.find((p) => p.code === 'PKG_ADMIN_CASUAL');

    const otRes = await agent.post(`/api/onboarding/packages/${otCasual.id}/preview`).send({
      facts: {
        employment_type: 'casual', role_category: 'occupational_therapist',
        child_related_work: 'yes', mobile_community_role: true, uses_own_vehicle: true,
        ndis_risk_assessed_role: 'yes', is_treating_therapist: true,
      },
    });
    expect(otRes.status).toBe(200);
    const otCodes = otRes.body.sections.flatMap((s) => s.requirements.map((r) => r.code));
    expect(otCodes).toEqual(expect.arrayContaining([
      'REQ_FWIS', 'REQ_CEIS', 'REQ_AHPRA', 'REQ_QUALIFICATION', 'REQ_PII',
      'REQ_WWCC', 'REQ_NDIS_SCREENING', 'REQ_DRIVERS_LICENCE', 'REQ_VEHICLE',
    ]));
    // A casual is not a fixed-term employee.
    expect(otCodes).not.toContain('REQ_FTCIS');
    // A police check is never applied automatically.
    expect(otCodes).not.toContain('REQ_POLICE_CHECK');

    const adminRes = await agent.post(`/api/onboarding/packages/${adminCasual.id}/preview`).send({
      facts: {
        employment_type: 'casual', role_category: 'administration',
        child_related_work: 'no', mobile_community_role: false,
        ndis_risk_assessed_role: 'no',
      },
    });
    const adminCodes = adminRes.body.sections.flatMap((s) => s.requirements.map((r) => r.code));
    expect(adminCodes).toContain('REQ_FWIS');
    expect(adminCodes).toContain('REQ_CEIS');
    // Office administration: no clinical registration, no screening, no driving.
    expect(adminCodes).not.toContain('REQ_AHPRA');
    expect(adminCodes).not.toContain('REQ_QUALIFICATION');
    expect(adminCodes).not.toContain('REQ_WWCC');
    expect(adminCodes).not.toContain('REQ_NDIS_SCREENING');
    expect(adminCodes).not.toContain('REQ_DRIVERS_LICENCE');
    // The NDIS Code of Conduct binds every worker, including administration.
    expect(adminCodes).toContain('REQ_NDIS_CODE');
  });

  test('a fixed-term package issues the FTCIS and not the CEIS', async () => {
    const { agent } = await agentFor({ role: 'owner' });
    const pkgs = (await agent.get('/api/onboarding/packages')).body.packages;
    const ft = pkgs.find((p) => p.code === 'PKG_OT_FIXED_TERM');
    const res = await agent.post(`/api/onboarding/packages/${ft.id}/preview`).send({
      facts: { employment_type: 'fixed_term', role_category: 'occupational_therapist' },
    });
    const codes = res.body.sections.flatMap((s) => s.requirements.map((r) => r.code));
    expect(codes).toContain('REQ_FTCIS');
    expect(codes).not.toContain('REQ_CEIS');
  });

  test('an undetermined risk role still triggers screening — never silently exempt', async () => {
    const { agent } = await agentFor({ role: 'owner' });
    const pkgs = (await agent.get('/api/onboarding/packages')).body.packages;
    const ot = pkgs.find((p) => p.code === 'PKG_OT_FULL_TIME');
    const res = await agent.post(`/api/onboarding/packages/${ot.id}/preview`).send({
      facts: {
        employment_type: 'full_time', role_category: 'occupational_therapist',
        ndis_risk_assessed_role: 'requires_determination',
        child_related_work: 'assessment_required',
      },
    });
    const codes = res.body.sections.flatMap((s) => s.requirements.map((r) => r.code));
    expect(codes).toContain('REQ_NDIS_SCREENING');
    expect(codes).toContain('REQ_WWCC');
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('package versioning', () => {
  test('an assigned employee stays on v1 when the owner publishes v2', async () => {
    const { agent } = await agentFor({ role: 'owner' });
    const pkgs = (await agent.get('/api/onboarding/packages')).body.packages;
    const pkg = pkgs.find((p) => p.code === 'PKG_ADMIN_CASUAL');
    expect(pkg.currentVersion).toBe(1);

    const a1 = await agent.post('/api/onboarding/assignments').send({
      applicantName: 'Employee A', applicantEmail: 'a@test.invalid',
      packageId: pkg.id, employmentType: 'casual', roleCategory: 'administration',
    });
    expect(a1.status).toBe(201);
    const v1Id = a1.body.assignment.packageVersionId;

    // Change the package and publish v2.
    const detail = await agent.get(`/api/onboarding/packages/${pkg.id}`);
    const templates = (await agent.get('/api/onboarding/requirement-templates')).body.templates;
    const police = templates.find((t) => t.code === 'REQ_POLICE_CHECK');
    await agent.post(`/api/onboarding/packages/${pkg.id}/requirements`)
      .send({ templateId: police.id }).expect(201);
    const publish = await agent.post(`/api/onboarding/packages/${pkg.id}/publish`)
      .send({ changeNote: 'Added police check' });
    expect(publish.status).toBe(201);
    expect(publish.body.version.version).toBe(2);

    // Employee A is untouched; Employee B gets v2.
    const stillV1 = await agent.get(`/api/onboarding/assignments/${a1.body.assignment.id}`);
    expect(stillV1.body.assignment.packageVersionId).toBe(v1Id);
    expect(stillV1.body.assignment.packageVersion).toBe(1);

    const a2 = await agent.post('/api/onboarding/assignments').send({
      applicantName: 'Employee B', applicantEmail: 'b@test.invalid',
      packageId: pkg.id, employmentType: 'casual', roleCategory: 'administration',
    });
    expect(a2.body.assignment.packageVersion).toBe(2);
    expect(a2.body.assignment.packageVersionId).not.toBe(v1Id);
  });

  test('a base package cannot be assigned or published directly', async () => {
    const { agent } = await agentFor({ role: 'owner' });
    const pkgs = (await agent.get('/api/onboarding/packages?kind=base')).body.packages;
    const base = pkgs.find((p) => p.code === 'PKG_BASE_EMPLOYEE');

    const publish = await agent.post(`/api/onboarding/packages/${base.id}/publish`).send({});
    expect(publish.status).toBe(409);

    const assign = await agent.post('/api/onboarding/assignments').send({
      applicantName: 'X', applicantEmail: 'x@test.invalid',
      packageId: base.id, employmentType: 'casual',
    });
    expect(assign.status).toBe(400);
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('the complete workflow', () => {
  /** Assign + release an OT casual, returning everything the tests need. */
  async function releaseOtCasual(ownerAgent, overrides = {}) {
    await publishAllDocuments(ownerAgent);
    const pkgs = (await ownerAgent.get('/api/onboarding/packages')).body.packages;
    const pkg = pkgs.find((p) => p.code === 'PKG_OT_CASUAL');

    const created = await ownerAgent.post('/api/onboarding/assignments').send({
      packageId: pkg.id,
      applicantName: 'Test OT Casual',
      applicantEmail: 'test.ot.casual@test.invalid',
      jobTitle: 'Occupational Therapist',
      proposedRole: 'therapist',
      isTreatingTherapist: true,
      employmentType: 'casual',
      roleCategory: 'occupational_therapist',
      startDate: '2026-09-01',
      childRelatedWork: 'yes',
      ndisRiskAssessedRole: 'yes',
      mobileCommunityRole: true,
      usesOwnVehicle: true,
      ...overrides,
    });
    expect(created.status).toBe(201);

    const released = await ownerAgent
      .post(`/api/onboarding/assignments/${created.body.assignment.id}/release`).send({});
    expect(released.status).toBe(201);

    const { rows } = await db.pool.query(
      'SELECT invite_token FROM user_invites WHERE onboarding_assignment_id = $1', [created.body.assignment.id]
    );
    return {
      assignmentId: created.body.assignment.id,
      token: rows[0].invite_token,
      released: released.body,
    };
  }

  test('release creates a pre-employee, an invitation and the requirement set', async () => {
    const { agent: owner } = await agentFor({ role: 'owner' });
    const { assignmentId, token, released } = await releaseOtCasual(owner);

    expect(released.requirementsIssued).toBeGreaterThan(20);
    expect(released.onboardingUrl).toContain('/onboarding-invite?token=');
    expect(token).toHaveLength(64); // 32 random bytes, hex

    const { rows: users } = await db.pool.query(
      "SELECT role, password_hash, is_active FROM users WHERE email = 'test.ot.casual@test.invalid'"
    );
    expect(users[0].role).toBe('pre_employee');
    // No temporary password is ever generated — they set their own.
    expect(users[0].password_hash).toBeNull();

    const detail = await owner.get(`/api/onboarding/assignments/${assignmentId}`);
    expect(detail.body.assignment.status).toBe('invite_sent');
    const codes = detail.body.sections.flatMap((s) => s.requirements.map((r) => r.code));
    expect(codes).toEqual(expect.arrayContaining(['REQ_FWIS', 'REQ_CEIS', 'REQ_AHPRA', 'REQ_WWCC']));
    expect(codes).not.toContain('REQ_FTCIS');
  });

  test('a second live onboarding for the same email is refused', async () => {
    const { agent: owner } = await agentFor({ role: 'owner' });
    await releaseOtCasual(owner);
    const pkgs = (await owner.get('/api/onboarding/packages')).body.packages;
    const pkg = pkgs.find((p) => p.code === 'PKG_OT_CASUAL');
    const dup = await owner.post('/api/onboarding/assignments').send({
      applicantName: 'Test OT Casual', applicantEmail: 'test.ot.casual@test.invalid',
      packageId: pkg.id, employmentType: 'casual', roleCategory: 'occupational_therapist',
    });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('assignment_exists');
  });

  test('full run: accept → complete → submit → verify → activate', async () => {
    const { agent: owner, user: ownerUser } = await agentFor({ role: 'owner' });
    const { assignmentId, token } = await releaseOtCasual(owner);

    // ── Applicant accepts the invitation ──────────────────────────────────
    const applicant = request.agent(app);
    const check = await applicant.post('/api/onboarding-invite/check').send({ token });
    expect(check.status).toBe(200);
    expect(check.body.ok).toBe(true);
    expect(check.body.roleTitle).toBe('Occupational Therapist');

    const accept = await applicant.post('/api/onboarding-invite/accept')
      .send({ token, password: 'NewStarter1!', name: 'Test OT Casual' });
    expect(accept.status).toBe(200);
    expect(accept.body.redirect).toBe('/#onboarding');

    // Single use — the same token cannot be spent twice.
    const replay = await request.agent(app).post('/api/onboarding-invite/accept')
      .send({ token, password: 'Another1!' });
    expect(replay.status).toBe(400);

    // ── The employee sees only their own onboarding ───────────────────────
    const mine = await applicant.get('/api/onboarding/me');
    expect(mine.status).toBe(200);
    expect(mine.body.hasOnboarding).toBe(true);
    expect(mine.body.welcome.roleTitle).toBe('Occupational Therapist');
    expect(mine.body.yourProgress.percent).toBe(0);

    const byCode = {};
    for (const s of mine.body.sections) for (const r of s.requirements) byCode[r.code] = r;

    // ── Acknowledgements ──────────────────────────────────────────────────
    for (const code of Object.keys(byCode)) {
      const r = byCode[code];
      if (r.handler !== 'document_ack') continue;
      const body = { acknowledged: true };
      if (r.config?.requiresTypedName) body.typedLegalName = 'Test OT Casual';
      const res = await applicant
        .post(`/api/onboarding/me/requirements/${r.id}/acknowledge`).send(body);
      expect([200, 409]).toContain(res.status);
    }

    // ── Forms ─────────────────────────────────────────────────────────────
    const form = (code, payload) => applicant
      .post(`/api/onboarding/me/requirements/${byCode[code].id}/form`).send(payload);

    expect((await form('REQ_PERSONAL_DETAILS', {
      legalFirstName: 'Test', surname: 'Casual', dateOfBirth: '1994-04-04',
      mobile: '0400000000', addressLine1: '1 Test St', suburb: 'Perth',
      state: 'WA', postcode: '6000',
    })).status).toBe(200);

    expect((await form('REQ_EMERGENCY_CONTACT', {
      emergencyName: 'Next Of Kin', emergencyRelationship: 'Partner', emergencyPhone: '0411111111',
    })).status).toBe(200);

    const bank = await form('REQ_BANK_DETAILS', {
      payrollNoticeAccepted: true, accountHolderName: 'Test Casual', bsb: '062-000', accountNumber: '12345678',
    });
    expect(bank.status).toBe(200);

    const tax = await form('REQ_TAX_SETUP', {
      taxSubmissionMethod: 'employer_electronic_form',
      residencyStatus: 'australian_resident',
      payrollNoticeAccepted: true, tfn: VALID_TFN, claimsTaxFreeThreshold: true, hasStudyLoan: false,
    });
    expect(tax.status).toBe(200);

    expect((await form('REQ_SUPER_SETUP', {
      payrollNoticeAccepted: true, superChoiceType: 'apra_fund', superFundName: 'Test Super',
      superFundAbn: VALID_ABN, superFundUsi: 'TST0100AU',
      superMemberNumber: 'M123456', superAccountName: 'Test Casual',
    })).status).toBe(200);

    expect((await form('REQ_IDENTITY', {
      evidenceType: 'australian_passport', nameOnDocument: 'Test Casual',
      travelDocumentType: 'passport', documentNumber: 'PA1234567', countryOfIssue: 'Australia',
    })).status).toBe(200);

    expect((await form('REQ_RIGHT_TO_WORK', { rightToWorkBasis: 'citizen' })).status).toBe(200);

    expect((await form('REQ_VEHICLE', {
      registration: '1ABC123', make: 'Toyota', model: 'Corolla', businessUseConfirmed: true,
    })).status).toBe(200);

    // ── Credentials ───────────────────────────────────────────────────────
    const credential = (code, payload) => applicant
      .post(`/api/onboarding/me/requirements/${byCode[code].id}/credential`).send(payload);

    expect((await credential('REQ_AHPRA', {
      registrationNumber: 'OCC0001234567', expiryDate: '2026-11-30',
    })).status).toBe(200);
    expect((await credential('REQ_QUALIFICATION', {
      registrationNumber: 'BSc-OT-2016', institution: 'Curtin University', completionYear: 2016,
    })).status).toBe(200);
    expect((await credential('REQ_PII', {
      registrationNumber: 'PII-2026-001', arrangement: 'employer_policy', expiryDate: '2027-06-30',
    })).status).toBe(200);
    expect((await credential('REQ_NDIS_SCREENING', {
      registrationNumber: 'WA-NDIS-123456', jurisdiction: 'WA', expiryDate: '2031-01-01',
    })).status).toBe(200);
    expect((await credential('REQ_WWCC', {
      registrationNumber: 'WWC1234567', familyName: 'Casual', expiryDate: '2029-05-01',
    })).status).toBe(200);
    expect((await credential('REQ_DRIVERS_LICENCE', {
      registrationNumber: 'WA1234567', licenceClass: 'C', jurisdiction: 'WA', expiryDate: '2030-02-02',
    })).status).toBe(200);

    // ── Remaining employee items ──────────────────────────────────────────
    const refreshed = await applicant.get('/api/onboarding/me');
    for (const s of refreshed.body.sections) {
      for (const r of s.requirements) {
        if (!['employee', 'both'].includes(r.actor)) continue;
        if (['submitted', 'complete', 'verified', 'not_applicable'].includes(r.status)) continue;

        if (r.handler === 'info') {
          await applicant.post(`/api/onboarding/me/requirements/${r.id}/start`).send({});
          // An info item completes on acknowledgement of having read it.
          await applicant.post(`/api/onboarding/me/requirements/${r.id}/acknowledge`)
            .send({ acknowledged: true });
        } else if (r.handler === 'training') {
          await applicant.post(`/api/onboarding/me/requirements/${r.id}/upload`).send({
            title: 'Certificate', fileName: 'cert.pdf',
            fileMime: 'application/pdf', fileData: PDF_B64,
          });
          await applicant.post(`/api/onboarding/me/requirements/${r.id}/training`)
            .send({ completedAt: '2026-08-20' });
        } else if (r.handler === 'upload') {
          await applicant.post(`/api/onboarding/me/requirements/${r.id}/upload`).send({
            title: r.title, fileName: 'evidence.pdf',
            fileMime: 'application/pdf', fileData: PDF_B64,
          });
        }
      }
    }

    // ── The employee's meter reaches 100% on their own actions ────────────
    const beforeSubmit = await applicant.get('/api/onboarding/me');
    expect(beforeSubmit.body.yourProgress.percent).toBe(100);
    expect(beforeSubmit.body.canSubmit).toBe(true);
    // …while employer verification is still outstanding and shown separately.
    expect(beforeSubmit.body.employerReview.remaining).toBeGreaterThan(0);

    // Before submitting, the run waits at employee_actions_complete — handing
    // it over is the employee's own act, not a side effect of finishing.
    expect(beforeSubmit.body.status).toBe('employee_actions_complete');

    const submitted = await applicant.post('/api/onboarding/me/submit').send({});
    expect(submitted.status).toBe(200);
    expect(submitted.body.status).toBe('employer_review');

    // …and the Submit button does not come back on a run already handed over.
    const afterSubmit = await applicant.get('/api/onboarding/me');
    expect(afterSubmit.body.canSubmit).toBe(false);

    // ── Activation is refused while verification is outstanding ───────────
    const tooEarly = await owner.post(`/api/onboarding/assignments/${assignmentId}/activate`).send({});
    expect(tooEarly.status).toBe(409);
    expect(tooEarly.body.code).toBe('activation_blocked');
    expect(tooEarly.body.blockers.length).toBeGreaterThan(0);

    // ── Owner verifies everything outstanding ─────────────────────────────
    const review = await owner.get(`/api/onboarding/assignments/${assignmentId}`);
    for (const s of review.body.sections) {
      for (const r of s.requirements) {
        if (['verified', 'complete', 'not_applicable'].includes(r.status)) continue;
        const path = `/api/onboarding/assignments/${assignmentId}/requirements/${r.id}`;
        if (r.requiresEmployerVerification || r.actor === 'both') {
          await owner.post(`${path}/verify`).send({});
        } else if (r.actor === 'employer') {
          await owner.post(`${path}/approve`).send({});
        } else {
          await owner.post(`${path}/approve`).send({});
        }
      }
    }

    const ready = await owner.get(`/api/onboarding/assignments/${assignmentId}`);
    expect(ready.body.activation.ok).toBe(true);
    expect(ready.body.assignment.status).toBe('ready_to_activate');
    expect(ready.body.canActivate).toBe(true);

    // ── Activate ──────────────────────────────────────────────────────────
    const activated = await owner.post(`/api/onboarding/assignments/${assignmentId}/activate`).send({});
    expect(activated.status).toBe(200);
    expect(activated.body.user.role).toBe('therapist');

    // Idempotent — a second activation is refused, not silently repeated.
    const again = await owner.post(`/api/onboarding/assignments/${assignmentId}/activate`).send({});
    expect(again.status).toBe(409);

    // No duplicate account was created.
    const { rows: dupes } = await db.pool.query(
      "SELECT COUNT(*)::int AS n FROM users WHERE email = 'test.ot.casual@test.invalid'"
    );
    expect(dupes[0].n).toBe(1);

    // Onboarding history is retained and the profile is live.
    const employee = await owner.get(`/api/onboarding/employees/${activated.body.user.id}`);
    expect(employee.status).toBe(200);
    expect(employee.body.employment.status).toBe('active');
    expect(employee.body.credentials.length).toBeGreaterThanOrEqual(6);
    expect(employee.body.acknowledgements.length).toBeGreaterThan(0);
    expect(employee.body.onboardingHistory).toHaveLength(1);
  }, 90000);

  test('correction reopens only the affected requirement', async () => {
    const { agent: owner } = await agentFor({ role: 'owner' });
    const { assignmentId, token } = await releaseOtCasual(owner);

    const applicant = request.agent(app);
    await applicant.post('/api/onboarding-invite/accept')
      .send({ token, password: 'NewStarter1!', name: 'Test OT Casual' });

    const mine = await applicant.get('/api/onboarding/me');
    const byCode = {};
    for (const s of mine.body.sections) for (const r of s.requirements) byCode[r.code] = r;

    await applicant.post(`/api/onboarding/me/requirements/${byCode.REQ_PERSONAL_DETAILS.id}/form`).send({
      legalFirstName: 'Test', surname: 'Casual', dateOfBirth: '1994-04-04',
      mobile: '0400000000', addressLine1: '1 Test St', suburb: 'Perth', state: 'WA', postcode: '6000',
    }).expect(200);
    await applicant.post(`/api/onboarding/me/requirements/${byCode.REQ_EMERGENCY_CONTACT.id}/form`).send({
      emergencyName: 'Kin', emergencyRelationship: 'Partner', emergencyPhone: '0411111111',
    }).expect(200);

    const before = await applicant.get('/api/onboarding/me');
    const doneBefore = before.body.yourProgress.done;

    const correction = await owner
      .post(`/api/onboarding/assignments/${assignmentId}/requirements/${byCode.REQ_PERSONAL_DETAILS.id}/request-correction`)
      .send({ reason: 'Your address is missing a unit number.' });
    expect(correction.status).toBe(200);

    const after = await applicant.get('/api/onboarding/me');
    expect(after.body.actionRequired).toBe(1);
    // Exactly one item reopened — the rest of their progress is untouched.
    expect(after.body.yourProgress.done).toBe(doneBefore - 1);

    const reopened = after.body.sections
      .flatMap((s) => s.requirements)
      .find((r) => r.code === 'REQ_PERSONAL_DETAILS');
    expect(reopened.status).toBe('correction_required');
    expect(reopened.reviewReason).toContain('unit number');

    const stillDone = after.body.sections
      .flatMap((s) => s.requirements)
      .find((r) => r.code === 'REQ_EMERGENCY_CONTACT');
    expect(['submitted', 'complete']).toContain(stillDone.status);

    // Submitting the correction clears it.
    await applicant.post(`/api/onboarding/me/requirements/${byCode.REQ_PERSONAL_DETAILS.id}/form`).send({
      legalFirstName: 'Test', surname: 'Casual', dateOfBirth: '1994-04-04',
      mobile: '0400000000', addressLine1: 'Unit 2, 1 Test St', suburb: 'Perth',
      state: 'WA', postcode: '6000',
    }).expect(200);
    const fixed = await applicant.get('/api/onboarding/me');
    expect(fixed.body.actionRequired).toBe(0);
  }, 60000);

  test('marking a requirement not applicable requires a reason', async () => {
    const { agent: owner } = await agentFor({ role: 'owner' });
    const { assignmentId } = await releaseOtCasual(owner);
    const detail = await owner.get(`/api/onboarding/assignments/${assignmentId}`);
    const wwcc = detail.body.sections.flatMap((s) => s.requirements).find((r) => r.code === 'REQ_WWCC');

    const noReason = await owner
      .post(`/api/onboarding/assignments/${assignmentId}/requirements/${wwcc.id}/not-applicable`)
      .send({});
    expect(noReason.status).toBe(400);

    const withReason = await owner
      .post(`/api/onboarding/assignments/${assignmentId}/requirements/${wwcc.id}/not-applicable`)
      .send({ reason: 'Role does not involve child-related work.' });
    expect(withReason.status).toBe(200);
    expect(withReason.body.requirement.status).toBe('not_applicable');
    expect(withReason.body.requirement.reviewReason).toContain('child-related');
  });

  test('a statutory requirement cannot be waived into a clearance', async () => {
    const { agent: owner } = await agentFor({ role: 'owner' });
    const { assignmentId } = await releaseOtCasual(owner);
    const detail = await owner.get(`/api/onboarding/assignments/${assignmentId}`);
    const all = detail.body.sections.flatMap((s) => s.requirements);

    const screening = all.find((r) => r.code === 'REQ_NDIS_SCREENING');
    const refused = await owner
      .post(`/api/onboarding/assignments/${assignmentId}/requirements/${screening.id}/waive`)
      .send({ reason: 'Trust me' });
    expect(refused.status).toBe(409);
    expect(refused.body.message).toMatch(/issuing authority|not applicable/i);

    // An organisational requirement CAN be waived, with a reason.
    const contract = all.find((r) => r.code === 'REQ_POSITION_DESCRIPTION');
    const waived = await owner
      .post(`/api/onboarding/assignments/${assignmentId}/requirements/${contract.id}/waive`)
      .send({ reason: 'Position description issued and signed on paper before the portal launch.' });
    expect(waived.status).toBe(200);
    expect(waived.body.requirement.waived).toBe(true);
  });

  test('cancelling revokes the invitation and deactivates the pre-employee', async () => {
    const { agent: owner } = await agentFor({ role: 'owner' });
    const { assignmentId, token } = await releaseOtCasual(owner);

    const cancelled = await owner.post(`/api/onboarding/assignments/${assignmentId}/cancel`)
      .send({ reason: 'Candidate withdrew' });
    expect(cancelled.status).toBe(200);

    const check = await request.agent(app).post('/api/onboarding-invite/check').send({ token });
    expect(check.body.ok).toBe(false);
    expect(['revoked', 'cancelled']).toContain(check.body.code);

    const { rows } = await db.pool.query(
      "SELECT is_active FROM users WHERE email = 'test.ot.casual@test.invalid'"
    );
    expect(rows[0].is_active).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('invitation security', () => {
  async function makeInvite(owner) {
    await publishAllDocuments(owner);
    const pkgs = (await owner.get('/api/onboarding/packages')).body.packages;
    const pkg = pkgs.find((p) => p.code === 'PKG_ADMIN_CASUAL');
    const created = await owner.post('/api/onboarding/assignments').send({
      applicantName: 'Invite Test', applicantEmail: 'invite@test.invalid',
      packageId: pkg.id, employmentType: 'casual', roleCategory: 'administration',
    });
    await owner.post(`/api/onboarding/assignments/${created.body.assignment.id}/release`).send({});
    const { rows } = await db.pool.query(
      'SELECT * FROM user_invites WHERE onboarding_assignment_id = $1', [created.body.assignment.id]
    );
    return { assignmentId: created.body.assignment.id, invite: rows[0] };
  }

  test('an unknown token is rejected', async () => {
    const res = await request(app).post('/api/onboarding-invite/check').send({ token: 'nope' });
    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe('invalid');
  });

  test('an expired invitation is rejected', async () => {
    const { agent: owner } = await agentFor({ role: 'owner' });
    const { invite } = await makeInvite(owner);
    await db.pool.query("UPDATE user_invites SET expires_at = NOW() - INTERVAL '1 day' WHERE id = $1", [invite.id]);

    const res = await request(app).post('/api/onboarding-invite/check').send({ token: invite.invite_token });
    expect(res.body.code).toBe('expired');
    const accept = await request(app).post('/api/onboarding-invite/accept')
      .send({ token: invite.invite_token, password: 'Password1!' });
    expect(accept.status).toBe(400);
  });

  test('a revoked invitation is rejected', async () => {
    const { agent: owner } = await agentFor({ role: 'owner' });
    const { invite } = await makeInvite(owner);
    await db.pool.query("UPDATE user_invites SET status = 'revoked' WHERE id = $1", [invite.id]);
    const res = await request(app).post('/api/onboarding-invite/check').send({ token: invite.invite_token });
    expect(res.body.code).toBe('revoked');
  });

  test('a short password is refused', async () => {
    const { agent: owner } = await agentFor({ role: 'owner' });
    const { invite } = await makeInvite(owner);
    const res = await request(app).post('/api/onboarding-invite/accept')
      .send({ token: invite.invite_token, password: 'short' });
    expect(res.status).toBe(400);
  });

  test('the token is never returned in a list or detail response', async () => {
    const { agent: owner } = await agentFor({ role: 'owner' });
    const { assignmentId } = await makeInvite(owner);
    const list = await owner.get('/api/onboarding/assignments');
    expect(JSON.stringify(list.body)).not.toMatch(/[0-9a-f]{64}/);
    const detail = await owner.get(`/api/onboarding/assignments/${assignmentId}`);
    expect(JSON.stringify(detail.body)).not.toMatch(/[0-9a-f]{64}/);
  });

  test('an active account cannot be sent through new-starter onboarding', async () => {
    const { agent: owner } = await agentFor({ role: 'owner' });
    const existing = await seedUser({ organisation_id: org.id, role: 'therapist' });
    const pkgs = (await owner.get('/api/onboarding/packages')).body.packages;
    const pkg = pkgs.find((p) => p.code === 'PKG_ADMIN_CASUAL');
    const res = await owner.post('/api/onboarding/assignments').send({
      applicantName: 'Existing', applicantEmail: existing.email,
      packageId: pkg.id, employmentType: 'casual', roleCategory: 'administration',
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('account_exists');
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('access control and IDOR', () => {
  async function releasedAssignment(owner) {
    await publishAllDocuments(owner);
    const pkgs = (await owner.get('/api/onboarding/packages')).body.packages;
    const pkg = pkgs.find((p) => p.code === 'PKG_ADMIN_CASUAL');
    const created = await owner.post('/api/onboarding/assignments').send({
      applicantName: 'Subject', applicantEmail: 'subject@test.invalid',
      packageId: pkg.id, employmentType: 'casual', roleCategory: 'administration',
    });
    await owner.post(`/api/onboarding/assignments/${created.body.assignment.id}/release`).send({});
    return created.body.assignment.id;
  }

  test('a therapist cannot reach the management surface at all', async () => {
    const { agent: owner } = await agentFor({ role: 'owner' });
    const assignmentId = await releasedAssignment(owner);
    const { agent: therapist } = await agentFor({ role: 'therapist' });

    for (const path of [
      '/api/onboarding/dashboard',
      '/api/onboarding/packages',
      '/api/onboarding/assignments',
      `/api/onboarding/assignments/${assignmentId}`,
      `/api/onboarding/assignments/${assignmentId}/payroll`,
      `/api/onboarding/assignments/${assignmentId}/identity`,
      '/api/onboarding/employees',
      '/api/onboarding/compliance/organisation',
    ]) {
      const res = await therapist.get(path);
      expect([403, 404]).toContain(res.status);
    }
  });

  test('an Admin employee is NOT an onboarding administrator by default', async () => {
    const { agent: owner } = await agentFor({ role: 'owner' });
    const assignmentId = await releasedAssignment(owner);
    const { agent: admin } = await agentFor({ role: 'admin' });

    expect((await admin.get('/api/onboarding/dashboard')).status).toBe(403);
    expect((await admin.get('/api/onboarding/assignments')).status).toBe(403);
    expect((await admin.get(`/api/onboarding/assignments/${assignmentId}/payroll`)).status).toBe(403);
  });

  test('delegation is granular — onboarding.view does not confer payroll', async () => {
    const { agent: owner } = await agentFor({ role: 'owner' });
    const assignmentId = await releasedAssignment(owner);
    const { agent: admin, user: adminUser } = await agentFor({ role: 'admin' });

    const granted = await owner.put(`/api/onboarding/permissions/${adminUser.id}`)
      .send({ permissions: ['onboarding.view', 'onboarding.review'] });
    expect(granted.status).toBe(200);

    // The delegate can now see progress…
    expect((await admin.get('/api/onboarding/dashboard')).status).toBe(200);
    expect((await admin.get(`/api/onboarding/assignments/${assignmentId}`)).status).toBe(200);
    // …but not payroll or identity, which were not granted.
    expect((await admin.get(`/api/onboarding/assignments/${assignmentId}/payroll`)).status).toBe(403);
    expect((await admin.get(`/api/onboarding/assignments/${assignmentId}/identity`)).status).toBe(403);
    // …and cannot activate, or change what everyone is asked for.
    expect((await admin.post(`/api/onboarding/assignments/${assignmentId}/activate`).send({})).status).toBe(403);
    expect((await admin.post('/api/onboarding/packages').send({ code: 'X_TEST', title: 'X' })).status).toBe(403);
  });

  test('a delegate cannot grant themselves more permission', async () => {
    const { agent: admin, user: adminUser } = await agentFor({ role: 'admin' });
    await db.pool.query(
      'UPDATE users SET permissions = $2 WHERE id = $1',
      [adminUser.id, JSON.stringify(['onboarding.view', 'onboarding.review', 'onboarding.activate'])]
    );
    const res = await admin.put(`/api/onboarding/permissions/${adminUser.id}`)
      .send({ permissions: ['onboarding.payroll', 'onboarding.sensitive_identity'] });
    expect(res.status).toBe(403);
  });

  test('an unknown permission string cannot be granted', async () => {
    const { agent: owner } = await agentFor({ role: 'owner' });
    const { user: adminUser } = await agentFor({ role: 'admin' });
    const res = await owner.put(`/api/onboarding/permissions/${adminUser.id}`)
      .send({ permissions: ['onboarding.view', 'admin.everything'] });
    expect(res.status).toBe(400);
  });

  test('a pre-employee reaches only their own onboarding', async () => {
    const { agent: owner } = await agentFor({ role: 'owner' });
    const assignmentId = await releasedAssignment(owner);
    const { rows } = await db.pool.query(
      'SELECT invite_token FROM user_invites WHERE onboarding_assignment_id = $1', [assignmentId]
    );
    const applicant = request.agent(app);
    await applicant.post('/api/onboarding-invite/accept')
      .send({ token: rows[0].invite_token, password: 'NewStarter1!' });

    expect((await applicant.get('/api/onboarding/me')).status).toBe(200);
    for (const path of [
      '/api/onboarding/dashboard',
      '/api/onboarding/assignments',
      `/api/onboarding/assignments/${assignmentId}`,
      '/api/onboarding/employees',
      '/api/onboarding/packages',
      '/api/onboarding/documents',
    ]) {
      const res = await applicant.get(path);
      expect(res.status).toBe(403);
    }
  });

  test('employee A cannot read employee B onboarding via any id', async () => {
    const { agent: owner } = await agentFor({ role: 'owner' });
    const bId = await releasedAssignment(owner);
    const { rows: bInv } = await db.pool.query(
      'SELECT invite_token FROM user_invites WHERE onboarding_assignment_id = $1', [bId]
    );

    // A second onboarding for a different person.
    const pkgs = (await owner.get('/api/onboarding/packages')).body.packages;
    const pkg = pkgs.find((p) => p.code === 'PKG_ADMIN_CASUAL');
    const aCreated = await owner.post('/api/onboarding/assignments').send({
      applicantName: 'Person A', applicantEmail: 'person.a@test.invalid',
      packageId: pkg.id, employmentType: 'casual', roleCategory: 'administration',
    });
    await owner.post(`/api/onboarding/assignments/${aCreated.body.assignment.id}/release`).send({});
    const { rows: aInv } = await db.pool.query(
      'SELECT invite_token FROM user_invites WHERE onboarding_assignment_id = $1',
      [aCreated.body.assignment.id]
    );

    const personA = request.agent(app);
    await personA.post('/api/onboarding-invite/accept')
      .send({ token: aInv[0].invite_token, password: 'PersonAPass1!' });
    const personB = request.agent(app);
    await personB.post('/api/onboarding-invite/accept')
      .send({ token: bInv[0].invite_token, password: 'PersonBPass1!' });

    // B's own requirement ids…
    const bMine = await personB.get('/api/onboarding/me');
    const bRequirement = bMine.body.sections.flatMap((s) => s.requirements)[0];

    // …are a 404 for A, not a 403: a foreign id is indistinguishable from absent.
    const peek = await personA.get(`/api/onboarding/me/requirements/${bRequirement.id}`);
    expect(peek.status).toBe(404);

    const write = await personA
      .post(`/api/onboarding/me/requirements/${bRequirement.id}/acknowledge`)
      .send({ acknowledged: true });
    expect(write.status).toBe(404);

    // A sees only their own assignment.
    const aMine = await personA.get('/api/onboarding/me');
    expect(aMine.body.welcome.name).not.toBe('Subject');
  }, 60000);
});

// ═════════════════════════════════════════════════════════════════════════════

describe('sensitive data handling', () => {
  async function withPayroll() {
    const { agent: owner } = await agentFor({ role: 'owner' });
    await publishAllDocuments(owner);
    const pkgs = (await owner.get('/api/onboarding/packages')).body.packages;
    const pkg = pkgs.find((p) => p.code === 'PKG_ADMIN_CASUAL');
    const created = await owner.post('/api/onboarding/assignments').send({
      applicantName: 'Payroll Subject', applicantEmail: 'payroll@test.invalid',
      packageId: pkg.id, employmentType: 'casual', roleCategory: 'administration',
    });
    const assignmentId = created.body.assignment.id;
    await owner.post(`/api/onboarding/assignments/${assignmentId}/release`).send({});
    const { rows } = await db.pool.query(
      'SELECT invite_token FROM user_invites WHERE onboarding_assignment_id = $1', [assignmentId]
    );
    const applicant = request.agent(app);
    await applicant.post('/api/onboarding-invite/accept')
      .send({ token: rows[0].invite_token, password: 'PayrollPass1!' });

    const mine = await applicant.get('/api/onboarding/me');
    const byCode = {};
    for (const s of mine.body.sections) for (const r of s.requirements) byCode[r.code] = r;

    await applicant.post(`/api/onboarding/me/requirements/${byCode.REQ_BANK_DETAILS.id}/form`).send({
      payrollNoticeAccepted: true, accountHolderName: 'Payroll Subject', bsb: '062-000', accountNumber: '12345678',
    }).expect(200);
    await applicant.post(`/api/onboarding/me/requirements/${byCode.REQ_TAX_SETUP.id}/form`).send({
      taxSubmissionMethod: 'employer_electronic_form',
      payrollNoticeAccepted: true, residencyStatus: 'australian_resident', tfn: VALID_TFN, claimsTaxFreeThreshold: true,
    }).expect(200);

    return { owner, applicant, assignmentId };
  }

  test('bank and tax values are encrypted at rest and never returned in full', async () => {
    const { owner, applicant, assignmentId } = await withPayroll();

    const { rows } = await db.pool.query(
      'SELECT * FROM payroll_profiles WHERE account_number_last4 = $1', ['5678']
    );
    const stored = rows[0];
    // Ciphertext, not plaintext.
    expect(stored.account_number_encrypted).toMatch(/^obenc:/);
    expect(stored.bsb_encrypted).toMatch(/^obenc:/);
    expect(stored.tfn_encrypted).toMatch(/^obenc:/);
    expect(stored.account_number_encrypted).not.toContain('12345678');
    expect(stored.tfn_encrypted).not.toContain(VALID_TFN);
    // Only the masked forms are stored in the clear.
    expect(stored.account_number_last4).toBe('5678');
    expect(stored.tfn_last3).toBe('782');
    expect(stored.bsb_masked).toBe('•••-•00');

    // The employer view is masked.
    const payroll = await owner.get(`/api/onboarding/assignments/${assignmentId}/payroll`);
    expect(payroll.status).toBe(200);
    const body = JSON.stringify(payroll.body);
    expect(body).not.toContain(VALID_TFN);
    expect(body).not.toContain('12345678');
    expect(payroll.body.payroll.accountNumberLast4).toBe('5678');
    expect(payroll.body.payroll.tfnProvided).toBe(true);

    // Even the person who typed it does not get it back.
    const mine = await applicant.get('/api/onboarding/me');
    expect(JSON.stringify(mine.body)).not.toContain(VALID_TFN);
    expect(JSON.stringify(mine.body)).not.toContain('12345678');
  }, 60000);

  test('no tax file number or account number reaches audit_logs', async () => {
    await withPayroll();
    const { rows } = await db.pool.query(
      "SELECT action, target_id, metadata::text AS meta FROM audit_logs WHERE action LIKE 'onboarding.%'"
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const blob = `${row.target_id || ''} ${row.meta || ''}`;
      expect(blob).not.toContain(VALID_TFN);
      expect(blob).not.toContain('12345678');
      expect(blob).not.toContain('062000');
    }
  }, 60000);

  test('the audit metadata allowlist drops anything it does not name', () => {
    const { safeMetadata } = require('../../onboarding-audit');
    const out = safeMetadata({
      assignmentId: 'a', tfn: VALID_TFN, accountNumber: '12345678',
      nested: { tfn: VALID_TFN }, values: [{ tfn: VALID_TFN }],
      reason: 'legitimate', code: 'REQ_X',
    });
    expect(out).toEqual({ assignmentId: 'a', reason: 'legitimate', code: 'REQ_X' });
    expect(JSON.stringify(out)).not.toContain(VALID_TFN);
  });

  test('an archive export excludes the TFN and full bank details by design', async () => {
    const { owner, assignmentId } = await withPayroll();
    const res = await owner.post(`/api/onboarding/assignments/${assignmentId}/archive-export`).send({});
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(VALID_TFN);
    expect(body).not.toContain('12345678');
    expect(res.body.payrollSummary.accountNumberLast4).toBe('5678');
    expect(res.body.note).toMatch(/deliberately excluded/i);
  }, 60000);

  test('payroll export decrypts, is owner-only, needs a reason, and is audited', async () => {
    const { owner, assignmentId } = await withPayroll();

    const noReason = await owner.post(`/api/onboarding/assignments/${assignmentId}/payroll-export`).send({});
    expect(noReason.status).toBe(400);

    const res = await owner.post(`/api/onboarding/assignments/${assignmentId}/payroll-export`)
      .send({ reason: 'Configuring the employee in payroll before the first pay run.' });
    expect(res.status).toBe(200);
    // This is the ONE path that returns plaintext.
    expect(res.body.payroll.tfn).toBe(VALID_TFN);
    expect(res.body.payroll.accountNumber).toBe('12345678');
    expect(res.headers['cache-control']).toContain('no-store');

    const { rows } = await db.pool.query(
      "SELECT metadata::text AS meta FROM audit_logs WHERE action = 'onboarding.payroll_exported'"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].meta).not.toContain(VALID_TFN);
  }, 60000);

  test('an invalid TFN or BSB is refused before anything is stored', async () => {
    const { agent: owner } = await agentFor({ role: 'owner' });
    await publishAllDocuments(owner);
    const pkgs = (await owner.get('/api/onboarding/packages')).body.packages;
    const pkg = pkgs.find((p) => p.code === 'PKG_ADMIN_CASUAL');
    const created = await owner.post('/api/onboarding/assignments').send({
      applicantName: 'Validation', applicantEmail: 'validation@test.invalid',
      packageId: pkg.id, employmentType: 'casual', roleCategory: 'administration',
    });
    await owner.post(`/api/onboarding/assignments/${created.body.assignment.id}/release`).send({});
    const { rows } = await db.pool.query(
      'SELECT invite_token FROM user_invites WHERE onboarding_assignment_id = $1',
      [created.body.assignment.id]
    );
    const applicant = request.agent(app);
    await applicant.post('/api/onboarding-invite/accept')
      .send({ token: rows[0].invite_token, password: 'ValidatePass1!' });

    const mine = await applicant.get('/api/onboarding/me');
    const byCode = {};
    for (const s of mine.body.sections) for (const r of s.requirements) byCode[r.code] = r;

    const badTfn = await applicant.post(`/api/onboarding/me/requirements/${byCode.REQ_TAX_SETUP.id}/form`)
      .send({
        taxSubmissionMethod: 'employer_electronic_form',
        payrollNoticeAccepted: true, residencyStatus: 'australian_resident', tfn: '111111111',
      });
    expect(badTfn.status).toBe(400);
    expect(badTfn.body.error).toMatch(/tax file number/i);

    const badBsb = await applicant.post(`/api/onboarding/me/requirements/${byCode.REQ_BANK_DETAILS.id}/form`)
      .send({ payrollNoticeAccepted: true, accountHolderName: 'X', bsb: '123', accountNumber: '12345678' });
    expect(badBsb.status).toBe(400);

    const { rows: none } = await db.pool.query('SELECT COUNT(*)::int AS n FROM payroll_profiles');
    expect(none[0].n).toBe(0);
  }, 60000);
});

// ═════════════════════════════════════════════════════════════════════════════

describe('ZIP import safety', () => {
  const JSZip = require('jszip');

  async function importZip(owner, build) {
    const zip = new JSZip();
    build(zip);
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    return owner.post('/api/onboarding/imports')
      .send({ fileName: 'resources.zip', fileData: buf.toString('base64') });
  }

  test('a valid archive stages proposals without publishing anything', async () => {
    const { agent: owner } = await agentFor({ role: 'owner' });
    const res = await importZip(owner, (zip) => {
      zip.file('Fair Work Information Statement.pdf', Buffer.from('%PDF-1.4 fwis'));
      zip.file('policies/Privacy Policy.pdf', Buffer.from('%PDF-1.4 privacy'));
    });
    expect(res.status).toBe(201);
    expect(res.body.import.accepted).toBe(2);

    const fwis = res.body.items.find((i) => i.file_name.includes('Fair Work'));
    expect(fwis.decision).toBe('pending');
    expect(fwis.proposed_category).toBe('Fair Work');
    expect(fwis.proposed_classification).toBe('OFFICIAL_DOCUMENT');

    // Nothing is visible to an employee yet.
    const docs = await owner.get('/api/onboarding/documents');
    const imported = docs.body.documents.filter((d) => d.code.startsWith('IMP_'));
    expect(imported).toHaveLength(0);

    const applied = await owner.post(`/api/onboarding/imports/${res.body.import.id}/apply`).send({});
    expect(applied.status).toBe(200);
    expect(applied.body.created).toHaveLength(2);
    expect(applied.body.note).toMatch(/DRAFTS/);

    const after = await owner.get('/api/onboarding/documents');
    const now = after.body.documents.filter((d) => d.code.startsWith('IMP_'));
    expect(now).toHaveLength(2);
    expect(now.every((d) => d.status === 'draft')).toBe(true);
  });

  test('hostile entry paths never escape the library', async () => {
    const { agent: owner } = await agentFor({ role: 'owner' });

    // JSZip itself normalises '..' and a leading '/' out of an entry name when
    // the archive is READ, so a crafted path arrives already defanged. That is
    // one layer; pathProblem() is the second, and is unit-tested directly in
    // tests/onboarding-import-safety.test.js against the raw strings JSZip
    // would not let through here. What this test proves is the end-to-end
    // outcome: nothing lands outside the library, and archive metadata and the
    // normalised remains of a traversal attempt are still not silently
    // imported under a name the Owner did not choose.
    const rename = (zip, from, to) => {
      const entry = zip.files[from];
      delete zip.files[from];
      entry.name = to;
      zip.files[to] = entry;
    };
    const res = await importZip(owner, (zip) => {
      zip.file('evil1.pdf', Buffer.from('%PDF-1.4 evil'));
      zip.file('__MACOSX/._junk.pdf', Buffer.from('%PDF-1.4 junk'));
      zip.file('ok.pdf', Buffer.from('%PDF-1.4 fine'));
      rename(zip, 'evil1.pdf', '../../etc/passwd.pdf');
    });
    expect(res.status).toBe(201);

    // Archive metadata is refused outright.
    const reasons = res.body.items.filter((i) => i.decision === 'rejected').map((i) => i.reason);
    expect(reasons.some((r) => /metadata/i.test(r))).toBe(true);

    // Nothing is written outside the library, and every stored path is
    // relative with no traversal segment left in it.
    for (const item of res.body.items) {
      expect(item.entry_path.startsWith('/')).toBe(false);
      expect(item.entry_path.split('/')).not.toContain('..');
    }

    // And nothing is published: everything waits for the Owner's decision.
    expect(res.body.items.filter((i) => i.decision === 'accepted')).toHaveLength(0);
  });

  test('an unsupported extension is refused', async () => {
    const { agent: owner } = await agentFor({ role: 'owner' });
    const res = await importZip(owner, (zip) => {
      zip.file('payload.exe', Buffer.from('MZ evil'));
      zip.file('script.svg', Buffer.from('<svg onload=alert(1)>'));
      zip.file('page.html', Buffer.from('<script>'));
    });
    expect(res.body.import.accepted).toBe(0);
    expect(res.body.import.rejected).toBe(3);
  });

  test('a file whose contents do not match its extension is refused', async () => {
    const { agent: owner } = await agentFor({ role: 'owner' });
    // An executable wearing a .pdf name.
    const res = await importZip(owner, (zip) => {
      zip.file('not-really.pdf', Buffer.from('MZ\x90\x00 this is a PE binary'));
    });
    expect(res.body.import.accepted).toBe(0);
    expect(res.body.items[0].reason).toMatch(/do not match/i);
  });

  test('duplicate files inside one archive are flagged, not imported twice', async () => {
    const { agent: owner } = await agentFor({ role: 'owner' });
    const res = await importZip(owner, (zip) => {
      zip.file('one.pdf', Buffer.from('%PDF-1.4 identical'));
      zip.file('two.pdf', Buffer.from('%PDF-1.4 identical'));
    });
    expect(res.body.import.accepted).toBe(1);
    const dupe = res.body.items.find((i) => i.decision === 'duplicate');
    expect(dupe).toBeTruthy();
  });

  test('a non-ZIP upload is refused', async () => {
    const { agent: owner } = await agentFor({ role: 'owner' });
    const res = await owner.post('/api/onboarding/imports')
      .send({ fileName: 'x.zip', fileData: Buffer.from('%PDF-1.4 not a zip').toString('base64') });
    expect(res.status).toBe(415);
  });

  test('a malformed ZIP is refused cleanly', async () => {
    const { agent: owner } = await agentFor({ role: 'owner' });
    // Correct signature, corrupt body.
    const bad = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('garbage'.repeat(20))]);
    const res = await owner.post('/api/onboarding/imports')
      .send({ fileName: 'x.zip', fileData: bad.toString('base64') });
    expect(res.status).toBe(400);
  });

  test('import requires the manage_documents permission', async () => {
    const { agent: admin } = await agentFor({ role: 'admin' });
    const res = await admin.post('/api/onboarding/imports').send({ fileData: 'x' });
    expect(res.status).toBe(403);
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('policy versioning and acknowledgements', () => {
  test('acknowledging v1 survives the publication of v2', async () => {
    const { agent: owner } = await agentFor({ role: 'owner' });
    const docs = (await owner.get('/api/onboarding/documents')).body.documents;
    const policy = docs.find((d) => d.code === 'POL_PRIVACY');

    const v1 = await owner.post(`/api/onboarding/documents/${policy.id}/versions`)
      .send({ title: 'Privacy & Confidentiality Policy', body: 'Version one text.' });
    expect(v1.status).toBe(201);
    await owner.post(`/api/onboarding/documents/${policy.id}/versions/${v1.body.version.id}/publish`)
      .send({}).expect(200);

    // Someone acknowledges v1.
    const { user } = await agentFor({ role: 'therapist' });
    await db.pool.query(
      `INSERT INTO onboarding_acknowledgements
         (organisation_id, user_id, document_id, document_version_id, document_code,
          document_title, document_version)
       VALUES ($1,$2,$3,$4,'POL_PRIVACY','Privacy & Confidentiality Policy',1)`,
      [org.id, user.id, policy.id, v1.body.version.id]
    );

    const v2 = await owner.post(`/api/onboarding/documents/${policy.id}/versions`)
      .send({ title: 'Privacy & Confidentiality Policy', body: 'Version two text.' });
    await owner.post(`/api/onboarding/documents/${policy.id}/versions/${v2.body.version.id}/publish`)
      .send({}).expect(200);

    // The v1 acknowledgement is untouched — history is never rewritten.
    const { rows } = await db.pool.query(
      'SELECT document_version FROM onboarding_acknowledgements WHERE user_id = $1', [user.id]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].document_version).toBe(1);

    // And v1 is now marked superseded rather than deleted.
    const detail = await owner.get(`/api/onboarding/documents/${policy.id}`);
    const versions = detail.body.versions;
    expect(versions.find((v) => v.version === 1).status).toBe('superseded');
    expect(versions.find((v) => v.version === 2).status).toBe('published');

    const reack = await owner.post(`/api/onboarding/documents/${policy.id}/require-reacknowledgement`).send({});
    expect(reack.status).toBe(200);
    expect(reack.body.version).toBe(2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('expiry engine', () => {
  test('warns once per window and marks lapsed credentials expired', async () => {
    const { user } = await agentFor({ role: 'therapist' });
    const expiry = new Date();
    expiry.setUTCDate(expiry.getUTCDate() + 25); // inside the 30-day window

    await db.pool.query(
      `INSERT INTO credentials
         (user_id, organisation_id, credential_type, credential_name, expiry_date, status, lifecycle_status)
       VALUES ($1,$2,'wwcc','Working with Children Check',$3,'verified','current')`,
      [user.id, org.id, expiry]
    );

    const expiryEngine = require('../../onboarding-expiry');
    const first = await expiryEngine.runExpirySweep();
    expect(first[0].reminders).toBe(1);

    // Re-running the same day sends nothing again — the unique constraint,
    // not a flag in memory, is what guarantees that.
    const second = await expiryEngine.runExpirySweep();
    expect(second[0].reminders).toBe(0);

    // A lapsed credential becomes expired.
    await db.pool.query(
      "UPDATE credentials SET expiry_date = CURRENT_DATE - 1 WHERE user_id = $1", [user.id]
    );
    await expiryEngine.runExpirySweep();
    const { rows } = await db.pool.query('SELECT status FROM credentials WHERE user_id = $1', [user.id]);
    expect(rows[0].status).toBe('expired');
  });

  test('an excluded worker is never downgraded to merely expired', async () => {
    const { user } = await agentFor({ role: 'therapist' });
    await db.pool.query(
      `INSERT INTO credentials
         (user_id, organisation_id, credential_type, credential_name, expiry_date,
          status, lifecycle_status)
       VALUES ($1,$2,'ndis_worker_screening','NDIS Worker Screening',
               CURRENT_DATE - 1,'verified','exclusion')`,
      [user.id, org.id]
    );
    await require('../../onboarding-expiry').runExpirySweep();
    const { rows } = await db.pool.query(
      'SELECT status, lifecycle_status FROM credentials WHERE user_id = $1', [user.id]
    );
    // The statutory status the Commission set is preserved verbatim.
    expect(rows[0].lifecycle_status).toBe('exclusion');
  });
});
