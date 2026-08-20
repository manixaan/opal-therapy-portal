'use strict';

/**
 * THE ONBOARDING JOURNEY — end to end, against a real PostgreSQL database.
 *
 * The full path the feature exists for:
 *
 *   Owner starts onboarding → the system recommends a package → a starter
 *   pack ZIP is generated from the PINNED package version → it is emailed →
 *   the completed forms come back → the Owner uploads them → the details are
 *   read out of them → the Owner reviews and corrects → a portal account is
 *   created with a temporary password → the sign-in email goes out → the
 *   employee signs in, is FORCED to change their password, and finds their
 *   details already filled in.
 *
 * The model is never called: the AI gateway runs on its mock provider, and
 * everything downstream of it — normalisation, the encrypted store, the review
 * verbs, the apply step — is exercised for real by injecting a proposal the
 * way a real run would.
 *
 * What is asserted alongside the happy path is the set of things that must NOT
 * happen: a second account from a retried request, a therapist reading
 * somebody else's returned documents, a temporary password reaching any screen
 * but the password change, an Admin promoting themselves to Owner, and a bank
 * account number appearing in any response.
 */

const http = require('http');
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const JSZip = require('jszip');

const { db, truncateAll, seedUser, seedOrganisation, closePool } = require('./helpers');

// The account-creation fixture runs the whole journey before its assertions
// begin, and bcrypt at the production cost factor is deliberately slow.
jest.setTimeout(60000);

const PASSWORD = 'OnboardPass1';

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
  app.use('/', require('../../app-routes'));
  app.use('/', require('../../onboarding-employee-routes'));
  app.use('/', require('../../onboarding-workflow-routes'));
  app.use('/', require('../../onboarding-package-docs-routes'));
  app.use('/', require('../../onboarding-assignment-routes'));
  app.use('/', require('../../onboarding-library-routes'));
  app.use('/', require('../../onboarding-routes'));
  return app;
}

/**
 * ONE http server for the whole file, shared by every agent.
 *
 * `request.agent(app)` starts a fresh ephemeral server per agent and never
 * closes it. This file creates well over a hundred agents, and the sockets and
 * listeners accumulate until a request is dropped — which surfaces as "socket
 * hang up" on whichever test happened to be running, so the failure looks
 * random and unrelated to the code under test. Binding once removes the cause
 * rather than retrying around it.
 */
let app;
let server;
let org;

/**
 * supertest parses a response as text unless told otherwise, which turns a ZIP
 * into mojibake. This hands the raw bytes back so the archive can be opened
 * and its contents genuinely checked.
 */
function binaryParser(res, callback) {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

let _ipCounter = 0;
function nextIp() {
  _ipCounter += 1;
  return `10.${Math.floor(_ipCounter / 65025) % 255}.${Math.floor(_ipCounter / 255) % 255}.${(_ipCounter % 254) + 1}`;
}

/**
 * Sign in as a seeded user, optionally holding delegated permissions.
 *
 * `permissions` is granted with a real UPDATE to users.permissions rather than
 * passed to seedUser — the helper does not write that column, and stubbing it
 * would mean these tests never exercise the merge in getPermissions().
 */
async function agentFor({ permissions, ...overrides } = {}) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser({ password_hash: hash, organisation_id: org.id, ...overrides });
  if (permissions) {
    await db.pool.query('UPDATE users SET permissions = $2 WHERE id = $1',
      [user.id, JSON.stringify(permissions)]);
  }
  const agent = request.agent(server);
  const res = await agent.post('/api/auth/login')
    .set('X-Forwarded-For', nextIp())
    .send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user };
}

/** Sign in with an explicit password, returning the raw response too. */
async function loginAs(email, password) {
  const agent = request.agent(server);
  const res = await agent.post('/api/auth/login')
    .set('X-Forwarded-For', nextIp())
    .send({ email, password });
  return { agent, res };
}

async function seedCatalogue() {
  return require('../../onboarding-seed').seedOnboarding({ organisationId: org.id });
}

/**
 * Give the policy documents real content and re-publish the packages.
 *
 * The catalogue seeds policy SLOTS deliberately — Opal does not fabricate its
 * own policies — so putting content behind them is a real step in the
 * workflow, and it is also what puts documents into a starter pack, since a
 * slot with no file cannot be emailed.
 *
 * Written through the data layer rather than over HTTP. Publishing thirty-six
 * documents is SETUP for these tests, not their subject: the HTTP publish path
 * is already covered by onboarding.itest.js, and doing it over seventy-two
 * requests in every fixture made the suite slow enough that requests began to
 * time out — which showed up as an unrelated test failing at random.
 */
async function publishAllDocuments() {
  const odb = require('../../onboarding-db');
  const docs = await odb.listDocuments(org.id);

  for (const doc of docs) {
    if (doc.content_status === 'link_only') continue;
    const version = await odb.createDocumentVersion(doc.id, {
      title: doc.title,
      body: `${doc.title}\n\nContent supplied for testing.`,
      effectiveDate: '2026-08-01',
      changeNote: 'Initial content',
    });
    if (version) await odb.publishDocumentVersion(doc.id, version.id, null);
  }

  // Package versions pin the document version, so each package is republished
  // to point its snapshot at the newly published documents.
  const pkgs = await odb.listPackages(org.id, { kind: 'package' });
  for (const pkg of pkgs) {
    const fresh = await odb.getPackage(org.id, pkg.id);
    await odb.publishPackage(org.id, fresh, null, 'Pin published policy versions');
  }
}

/** Start an onboarding and return its id. */
async function startOnboarding(ownerAgent, overrides = {}) {
  const rec = await ownerAgent.get(
    '/api/onboarding/packages/recommend?roleCategory=occupational_therapist&employmentType=full_time'
  );
  expect(rec.status).toBe(200);
  const packageId = overrides.packageId || rec.body.recommended.packageId;

  const res = await ownerAgent.post('/api/onboarding/assignments').send({
    applicantName: 'Jane Smith',
    applicantEmail: 'jane.smith@example.com',
    jobTitle: 'Occupational Therapist',
    employmentType: 'full_time',
    roleCategory: 'occupational_therapist',
    proposedRole: 'therapist',
    startDate: '2026-09-01',
    packageId,
    ...overrides.body,
  });
  expect(res.status).toBe(201);
  return { assignmentId: res.body.assignment.id, packageId, recommended: rec.body };
}

/**
 * Inject an extraction result the way a real run would.
 *
 * The gateway is stubbed at ITS boundary rather than at the provider, so
 * everything this feature owns — normalisation, the TFN refusal, encryption,
 * the masked read, the review verbs, the apply step — runs for real.
 */
function stubModel(fields, notes) {
  const gateway = require('../../ai/ai-gateway');
  return jest.spyOn(gateway, 'generate').mockResolvedValue({
    text: null,
    toolUse: {
      type: 'tool_use',
      name: 'record_employee_details',
      input: { fields, notes: notes || '' },
    },
    metadata: {
      aiUsed: true, interactionId: null, modelKey: 'mock', provider: 'mock',
    },
  });
}

const RETURNED_FORM = [
  'OPAL THERAPY — EMPLOYEE DETAILS FORM',
  '',
  'Legal first name: Jane',
  'Surname: Smith',
  'Preferred name: Janey',
  'Date of birth: 03/04/1990',
  'Personal email: jane.personal@example.com',
  'Mobile: 0412 345 678',
  'Address: 12 Wattle Street, Fremantle WA 6160',
  'Emergency contact: Peter Smith (brother) 0498 765 432',
  '',
  'BANK DETAILS',
  'Account name: Jane Smith',
  'BSB: 066-123',
  'Account number: 12345678',
].join('\n');

beforeAll(() => {
  process.env.ONBOARDING_ENCRYPTION_KEY = 'cd'.repeat(32);
  process.env.APP_BASE_URL = 'https://portal.test.invalid';
  // The gateway's availability check runs FOR REAL — region, model registry,
  // policy, kill switch. Only the provider invocation is stubbed, so a policy
  // that would deny this feature in production denies it here too.
  process.env.AWS_REGION = 'ap-southeast-2';
  process.env.BEDROCK_MODEL_ID = 'au.anthropic.test-profile-synthetic';
  app = buildApp();
  server = http.createServer(app);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
});

afterAll(async () => {
  delete process.env.AWS_REGION;
  delete process.env.BEDROCK_MODEL_ID;
  await new Promise((resolve) => server.close(resolve));
  await closePool();
});

beforeEach(async () => {
  await truncateAll();
  require('../../onboarding-employee-routes')._resetInviteRateLimit();
  require('../../auth')._resetLoginRateLimit();
  require('../../app-routes')._resetPasswordChangeRateLimit();
  org = await seedOrganisation('Opal Therapy Test');
  await seedCatalogue();
  jest.restoreAllMocks();
});

// ═════════════════════════════════════════════════════════════════════════════
//  PACKAGE RECOMMENDATION
// ═════════════════════════════════════════════════════════════════════════════

describe('recommending a package', () => {
  test('an OT on full time is recommended the OT full-time package', async () => {
    const { agent } = await agentFor({ role: 'owner' });
    const res = await agent.get(
      '/api/onboarding/packages/recommend?roleCategory=occupational_therapist&employmentType=full_time'
    );
    expect(res.status).toBe(200);
    expect(res.body.recommended.title).toBe('Occupational Therapist — Full-Time');
    expect(res.body.recommended.reason).toMatch(/role and employment type/);
  });

  test('an administrator on casual is recommended the administration casual package', async () => {
    const { agent } = await agentFor({ role: 'owner' });
    const res = await agent.get(
      '/api/onboarding/packages/recommend?roleCategory=administration&employmentType=casual'
    );
    expect(res.body.recommended.title).toBe('Administration — Casual');
  });

  test('with nothing to go on, nothing is recommended', async () => {
    // A confident-sounding guess is worse than no suggestion.
    const { agent } = await agentFor({ role: 'owner' });
    const res = await agent.get('/api/onboarding/packages/recommend');
    expect(res.body.recommended).toBeNull();
    expect(res.body.packages.length).toBeGreaterThan(0);
  });

  test('only base and overlay building blocks are excluded, never a real package', async () => {
    const { agent } = await agentFor({ role: 'owner' });
    const res = await agent.get(
      '/api/onboarding/packages/recommend?roleCategory=occupational_therapist&employmentType=casual'
    );
    for (const p of res.body.packages) {
      expect(p.title).not.toMatch(/Overlay|Base Employee/);
    }
  });

  test('a therapist cannot ask — it is an assign-level question', async () => {
    const { agent } = await agentFor({ role: 'therapist' });
    const res = await agent.get('/api/onboarding/packages/recommend?roleCategory=administration');
    expect(res.status).toBe(403);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  THE STARTER PACK
// ═════════════════════════════════════════════════════════════════════════════

describe('generating a starter pack', () => {
  test('produces a ZIP of the documents the pinned version names', async () => {
    const { agent } = await agentFor({ role: 'owner' });
    await publishAllDocuments();
    const { assignmentId } = await startOnboarding(agent);

    const res = await agent.post(`/api/onboarding/assignments/${assignmentId}/starter-pack`).send({});
    expect(res.status).toBe(201);
    expect(res.body.starterPack.documentCount).toBeGreaterThan(0);
    expect(res.body.starterPack.fileName).toBe('Opal Therapy Test - Jane Smith - Starter Pack.zip');

    const dl = await agent.get(`/api/onboarding/assignments/${assignmentId}/starter-pack/download`)
      .buffer(true).parse(binaryParser);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toContain('zip');
    expect(dl.headers['cache-control']).toContain('no-store');

    const zip = await JSZip.loadAsync(dl.body);
    const names = Object.keys(zip.files);
    expect(names).toContain('00 - Read Me First.txt');
    expect(names.length).toBe(res.body.starterPack.documentCount + 1);

    const readme = await zip.file('00 - Read Me First.txt').async('string');
    expect(readme).toContain('Jane Smith');
    expect(readme).toMatch(/do NOT email your tax file number/i);
  });

  test('no filename exposes an internal code or id', async () => {
    const { agent } = await agentFor({ role: 'owner' });
    await publishAllDocuments();
    const { assignmentId } = await startOnboarding(agent);
    await agent.post(`/api/onboarding/assignments/${assignmentId}/starter-pack`).send({});

    const dl = await agent.get(`/api/onboarding/assignments/${assignmentId}/starter-pack/download`)
      .buffer(true).parse(binaryParser);
    const zip = await JSZip.loadAsync(dl.body);
    for (const name of Object.keys(zip.files)) {
      expect(name).not.toMatch(/PKG_|DOC_|POL_/);
      expect(name).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/);
      expect(name).not.toContain('..');
    }
  });

  test('the manifest names the exact document version that went out', async () => {
    const { agent } = await agentFor({ role: 'owner' });
    await publishAllDocuments();
    const { assignmentId } = await startOnboarding(agent);
    const res = await agent.post(`/api/onboarding/assignments/${assignmentId}/starter-pack`).send({});

    for (const entry of res.body.starterPack.manifest) {
      expect(entry.documentCode).toBeTruthy();
      expect(entry.documentVersion).toBeGreaterThanOrEqual(1);
      expect(entry.sizeBytes).toBeGreaterThan(0);
    }
  });

  test('generating twice REUSES the pack — a double click cannot make two', async () => {
    const { agent } = await agentFor({ role: 'owner' });
    await publishAllDocuments();
    const { assignmentId } = await startOnboarding(agent);

    const first = await agent.post(`/api/onboarding/assignments/${assignmentId}/starter-pack`).send({});
    const second = await agent.post(`/api/onboarding/assignments/${assignmentId}/starter-pack`).send({});
    expect(first.body.reused).toBe(false);
    expect(second.body.reused).toBe(true);
    expect(second.body.starterPack.id).toBe(first.body.starterPack.id);

    const { rows } = await db.pool.query(
      'SELECT COUNT(*)::int AS n FROM onboarding_starter_packs WHERE assignment_id = $1 AND superseded_at IS NULL',
      [assignmentId]
    );
    expect(rows[0].n).toBe(1);
  });

  test('an explicit rebuild supersedes rather than overwrites the old one', async () => {
    const { agent } = await agentFor({ role: 'owner' });
    await publishAllDocuments();
    const { assignmentId } = await startOnboarding(agent);
    const first = await agent.post(`/api/onboarding/assignments/${assignmentId}/starter-pack`).send({});
    const again = await agent.post(`/api/onboarding/assignments/${assignmentId}/starter-pack`)
      .send({ regenerate: true });

    expect(again.body.starterPack.id).not.toBe(first.body.starterPack.id);
    const { rows } = await db.pool.query(
      'SELECT superseded_at FROM onboarding_starter_packs WHERE id = $1', [first.body.starterPack.id]
    );
    // The old pack SURVIVES — somebody may have received it.
    expect(rows[0].superseded_at).not.toBeNull();
  });

  test('the pack stays pinned when the package is published again afterwards', async () => {
    // The rule §42 asks for: editing a package later must not silently change
    // what somebody was already sent.
    const { agent } = await agentFor({ role: 'owner' });
    await publishAllDocuments();
    const { assignmentId, packageId } = await startOnboarding(agent);
    const first = await agent.post(`/api/onboarding/assignments/${assignmentId}/starter-pack`).send({});
    const pinnedVersion = first.body.starterPack.packageVersion;

    await agent.post(`/api/onboarding/packages/${packageId}/publish`)
      .send({ changeNote: 'Later change' });

    const view = await agent.get(`/api/onboarding/assignments/${assignmentId}/starter-pack`);
    expect(view.body.starterPack.packageVersion).toBe(pinnedVersion);

    const rebuilt = await agent.post(`/api/onboarding/assignments/${assignmentId}/starter-pack`)
      .send({ regenerate: true });
    // Even a deliberate rebuild uses the version this onboarding is pinned to.
    expect(rebuilt.body.starterPack.packageVersion).toBe(pinnedVersion);
  });

  test('a therapist cannot download somebody else\'s starter pack', async () => {
    const { agent: owner } = await agentFor({ role: 'owner' });
    await publishAllDocuments();
    const { assignmentId } = await startOnboarding(owner);
    await owner.post(`/api/onboarding/assignments/${assignmentId}/starter-pack`).send({});

    const { agent: therapist } = await agentFor({ role: 'therapist' });
    const res = await therapist.get(`/api/onboarding/assignments/${assignmentId}/starter-pack/download`);
    expect(res.status).toBe(403);
  });
});

describe('sending the starter pack', () => {
  test('records the attempt and advances the status', async () => {
    const { agent } = await agentFor({ role: 'owner' });
    await publishAllDocuments();
    const { assignmentId } = await startOnboarding(agent);
    await agent.post(`/api/onboarding/assignments/${assignmentId}/starter-pack`).send({});

    const res = await agent.post(`/api/onboarding/assignments/${assignmentId}/starter-pack/send`)
      .send({ toEmail: 'jane.smith@example.com' });
    expect(res.status).toBe(200);
    // SMTP is not configured under test, so the honest outcome is "skipped"
    // with the Owner handed a download path — never a false "sent".
    expect(res.body.status).toBe('skipped');
    expect(res.body.downloadPath).toContain('/starter-pack/download');

    const { rows } = await db.pool.query(
      'SELECT kind, status, attempt FROM onboarding_email_dispatches WHERE assignment_id = $1',
      [assignmentId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'starter_pack', status: 'skipped', attempt: 1 });
  });

  test('a resend is a second attempt, not a second onboarding', async () => {
    const { agent } = await agentFor({ role: 'owner' });
    await publishAllDocuments();
    const { assignmentId } = await startOnboarding(agent);
    await agent.post(`/api/onboarding/assignments/${assignmentId}/starter-pack`).send({});
    await agent.post(`/api/onboarding/assignments/${assignmentId}/starter-pack/send`).send({});
    await agent.post(`/api/onboarding/assignments/${assignmentId}/starter-pack/send`).send({});

    const { rows } = await db.pool.query(
      'SELECT attempt FROM onboarding_email_dispatches WHERE assignment_id = $1 ORDER BY attempt',
      [assignmentId]
    );
    expect(rows.map((r) => r.attempt)).toEqual([1, 2]);

    const { rows: assignments } = await db.pool.query(
      'SELECT COUNT(*)::int AS n FROM onboarding_assignments WHERE organisation_id = $1', [org.id]
    );
    expect(assignments[0].n).toBe(1);
  });

  test('refuses to send a pack that was never generated', async () => {
    const { agent } = await agentFor({ role: 'owner' });
    await publishAllDocuments();
    const { assignmentId } = await startOnboarding(agent);
    const res = await agent.post(`/api/onboarding/assignments/${assignmentId}/starter-pack/send`).send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('no_pack');
  });

  test('refuses an invalid recipient address', async () => {
    const { agent } = await agentFor({ role: 'owner' });
    await publishAllDocuments();
    const { assignmentId } = await startOnboarding(agent);
    await agent.post(`/api/onboarding/assignments/${assignmentId}/starter-pack`).send({});
    const res = await agent.post(`/api/onboarding/assignments/${assignmentId}/starter-pack/send`)
      .send({ toEmail: 'not-an-address' });
    expect(res.status).toBe(400);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  RETURNED DOCUMENTS
// ═════════════════════════════════════════════════════════════════════════════

describe('uploading the returned documents', () => {
  async function prepared() {
    const { agent } = await agentFor({ role: 'owner' });
    await publishAllDocuments();
    const { assignmentId } = await startOnboarding(agent);
    await agent.post(`/api/onboarding/assignments/${assignmentId}/starter-pack`).send({});
    await agent.post(`/api/onboarding/assignments/${assignmentId}/starter-pack/send`).send({});
    return { agent, assignmentId };
  }

  test('stores the originals and reports which are readable', async () => {
    const { agent, assignmentId } = await prepared();
    const res = await agent.post(`/api/onboarding/assignments/${assignmentId}/returned-documents`)
      .send({
        files: [{
          fileName: 'employee-details.txt',
          fileMime: 'text/plain',
          fileData: Buffer.from(RETURNED_FORM, 'utf8').toString('base64'),
        }],
      });
    expect(res.status).toBe(201);
    expect(res.body.stored).toHaveLength(1);
    expect(res.body.readable).toBe(1);
    expect(res.body.stored[0].textStatus).toBe('extracted');

    const { rows } = await db.pool.query(
      'SELECT status, file_sha256, text_status FROM onboarding_returned_documents WHERE assignment_id = $1',
      [assignmentId]
    );
    expect(rows[0].status).toBe('active');
    expect(rows[0].file_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test('a scan is accepted and honestly reported as unreadable', async () => {
    const { agent, assignmentId } = await prepared();
    const res = await agent.post(`/api/onboarding/assignments/${assignmentId}/returned-documents`)
      .send({
        files: [{
          fileName: 'scan.jpg', fileMime: 'image/jpeg',
          fileData: Buffer.from('not really a jpeg').toString('base64'),
        }],
      });
    expect(res.status).toBe(201);
    expect(res.body.readable).toBe(0);
    expect(res.body.message).toMatch(/scans or photographs/i);
    expect(res.body.stored[0].textStatus).toBe('no_text_layer');
  });

  test('the same file uploaded twice is not stored twice', async () => {
    const { agent, assignmentId } = await prepared();
    const file = {
      fileName: 'form.txt', fileMime: 'text/plain',
      fileData: Buffer.from(RETURNED_FORM, 'utf8').toString('base64'),
    };
    await agent.post(`/api/onboarding/assignments/${assignmentId}/returned-documents`).send({ files: [file] });
    const again = await agent.post(`/api/onboarding/assignments/${assignmentId}/returned-documents`)
      .send({ files: [file] });
    expect(again.body.stored[0].duplicate).toBe(true);

    const { rows } = await db.pool.query(
      "SELECT COUNT(*)::int AS n FROM onboarding_returned_documents WHERE assignment_id = $1 AND status = 'active'",
      [assignmentId]
    );
    expect(rows[0].n).toBe(1);
  });

  test('an executable dressed as a PDF is rejected, and the rest still land', async () => {
    const { agent, assignmentId } = await prepared();
    const res = await agent.post(`/api/onboarding/assignments/${assignmentId}/returned-documents`)
      .send({
        files: [
          { fileName: 'evil.exe', fileMime: 'application/pdf', fileData: 'TVqQAAMAAAA=' },
          {
            fileName: 'form.txt', fileMime: 'text/plain',
            fileData: Buffer.from(RETURNED_FORM, 'utf8').toString('base64'),
          },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.rejected).toHaveLength(1);
    expect(res.body.rejected[0].reason).toMatch(/does not match/i);
    expect(res.body.stored).toHaveLength(1);
  });

  test('removing a document ARCHIVES it — the evidence survives', async () => {
    const { agent, assignmentId } = await prepared();
    const up = await agent.post(`/api/onboarding/assignments/${assignmentId}/returned-documents`)
      .send({
        files: [{
          fileName: 'form.txt', fileMime: 'text/plain',
          fileData: Buffer.from(RETURNED_FORM, 'utf8').toString('base64'),
        }],
      });
    const docId = up.body.stored[0].id;

    const del = await agent.delete(
      `/api/onboarding/assignments/${assignmentId}/returned-documents/${docId}`
    );
    expect(del.status).toBe(200);

    const { rows } = await db.pool.query(
      'SELECT status, archived_at FROM onboarding_returned_documents WHERE id = $1', [docId]
    );
    expect(rows[0].status).toBe('archived');
    expect(rows[0].archived_at).not.toBeNull();
  });

  test('a therapist cannot upload to, or read, somebody else\'s onboarding', async () => {
    const { assignmentId } = await prepared();
    const { agent: therapist } = await agentFor({ role: 'therapist' });

    expect((await therapist.get(
      `/api/onboarding/assignments/${assignmentId}/returned-documents`
    )).status).toBe(403);
    expect((await therapist.post(
      `/api/onboarding/assignments/${assignmentId}/returned-documents`
    ).send({ files: [] })).status).toBe(403);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  READING THE DOCUMENTS
// ═════════════════════════════════════════════════════════════════════════════

describe('reading the details out of the returned documents', () => {
  async function withDocuments() {
    const { agent } = await agentFor({ role: 'owner' });
    await publishAllDocuments();
    const { assignmentId } = await startOnboarding(agent);
    await agent.post(`/api/onboarding/assignments/${assignmentId}/starter-pack`).send({});
    await agent.post(`/api/onboarding/assignments/${assignmentId}/starter-pack/send`).send({});
    const up = await agent.post(`/api/onboarding/assignments/${assignmentId}/returned-documents`)
      .send({
        files: [{
          title: 'Employee Details Form',
          fileName: 'employee-details.txt', fileMime: 'text/plain',
          fileData: Buffer.from(RETURNED_FORM, 'utf8').toString('base64'),
        }],
      });
    return { agent, assignmentId, documentId: up.body.stored[0].id };
  }

  const GOOD_FIELDS = [
    { key: 'legal_first_name', value: 'Jane', confidence: 'high', documentIndex: 1, page: 1 },
    { key: 'surname', value: 'Smith', confidence: 'high', documentIndex: 1, page: 1 },
    { key: 'date_of_birth', value: '1990-04-03', confidence: 'medium', documentIndex: 1, page: 1 },
    { key: 'personal_email', value: 'jane.personal@example.com', confidence: 'high', documentIndex: 1 },
    { key: 'mobile', value: '0412 345 678', confidence: 'high', documentIndex: 1 },
    { key: 'suburb', value: 'Fremantle', confidence: 'medium', documentIndex: 1 },
    { key: 'state', value: 'WA', confidence: 'high', documentIndex: 1 },
    { key: 'postcode', value: '6160', confidence: 'high', documentIndex: 1 },
    { key: 'emergency_name', value: 'Peter Smith', confidence: 'high', documentIndex: 1 },
    { key: 'emergency_phone', value: '0498 765 432', confidence: 'low', documentIndex: 1 },
    { key: 'account_holder_name', value: 'Jane Smith', confidence: 'high', documentIndex: 1 },
    { key: 'bsb', value: '066-123', confidence: 'high', documentIndex: 1, page: 1 },
    { key: 'account_number', value: '12345678', confidence: 'medium', documentIndex: 1, page: 1 },
  ];

  test('proposes the fields with their source, page and confidence', async () => {
    const { agent, assignmentId, documentId } = await withDocuments();
    stubModel(GOOD_FIELDS);

    const res = await agent.post(`/api/onboarding/assignments/${assignmentId}/extraction`).send({});
    expect(res.status).toBe(201);
    expect(res.body.fieldsProposed).toBe(GOOD_FIELDS.length);

    const view = await agent.get(`/api/onboarding/assignments/${assignmentId}/extraction`);
    expect(view.status).toBe(200);
    const all = view.body.groups.flatMap((g) => g.fields);

    const dob = all.find((f) => f.key === 'date_of_birth');
    expect(dob).toMatchObject({ value: '1990-04-03', confidence: 'medium', status: 'proposed' });
    expect(dob.source.documentId).toBe(documentId);
    expect(dob.source.label).toBe('Employee Details Form');
    expect(dob.source.page).toBe(1);
  });

  test('a bank account is returned MASKED, never in clear', async () => {
    const { agent, assignmentId } = await withDocuments();
    stubModel(GOOD_FIELDS);
    await agent.post(`/api/onboarding/assignments/${assignmentId}/extraction`).send({});

    const view = await agent.get(`/api/onboarding/assignments/${assignmentId}/extraction`);
    const raw = JSON.stringify(view.body);
    expect(raw).not.toContain('12345678');
    expect(raw).toContain('••••678');
    expect(raw).toContain('066-•••');
  });

  test('and is ENCRYPTED at rest — the column never holds the number', async () => {
    const { agent, assignmentId } = await withDocuments();
    stubModel(GOOD_FIELDS);
    await agent.post(`/api/onboarding/assignments/${assignmentId}/extraction`).send({});

    const { rows } = await db.pool.query(
      "SELECT value_text, value_encrypted, value_masked FROM onboarding_extracted_fields WHERE assignment_id = $1 AND field_key = 'account_number'",
      [assignmentId]
    );
    expect(rows[0].value_text).toBeNull();
    expect(rows[0].value_encrypted).toMatch(/^obenc:/);
    expect(rows[0].value_encrypted).not.toContain('12345678');
    expect(rows[0].value_masked).toBe('••••678');
  });

  test('a tax file number the model returned anyway is DROPPED', async () => {
    const { agent, assignmentId } = await withDocuments();
    stubModel([
      ...GOOD_FIELDS,
      // Both the shapes it could arrive in: an invented key, and a real key
      // carrying a nine-digit run.
      { key: 'tfn', value: '123456782', confidence: 'high', documentIndex: 1 },
      { key: 'award_classification', value: '123 456 782', confidence: 'high', documentIndex: 1 },
    ]);
    await agent.post(`/api/onboarding/assignments/${assignmentId}/extraction`).send({});

    const { rows } = await db.pool.query(
      'SELECT field_key, value_text FROM onboarding_extracted_fields WHERE assignment_id = $1',
      [assignmentId]
    );
    expect(rows.map((r) => r.field_key)).not.toContain('tfn');
    expect(rows.map((r) => r.field_key)).not.toContain('award_classification');
    for (const r of rows) expect(String(r.value_text)).not.toContain('123456782');
  });

  test('a misread date is dropped rather than stored wrong', async () => {
    const { agent, assignmentId } = await withDocuments();
    stubModel([{ key: 'date_of_birth', value: '03/04/1990', confidence: 'high', documentIndex: 1 }]);
    const res = await agent.post(`/api/onboarding/assignments/${assignmentId}/extraction`).send({});
    expect(res.body.fieldsProposed).toBe(0);
    expect(res.body.fieldsSkipped).toBe(1);
  });

  test('refuses when nothing readable was uploaded, and says why', async () => {
    const { agent } = await agentFor({ role: 'owner' });
    await publishAllDocuments();
    const { assignmentId } = await startOnboarding(agent);
    await agent.post(`/api/onboarding/assignments/${assignmentId}/returned-documents`).send({
      files: [{
        fileName: 'scan.jpg', fileMime: 'image/jpeg',
        fileData: Buffer.from('photo bytes').toString('base64'),
      }],
    });
    const res = await agent.post(`/api/onboarding/assignments/${assignmentId}/extraction`).send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('no_readable_text');
    expect(res.body.message).toMatch(/Enter the details manually/i);
  });

  test('an Admin without the payroll permission sees that a bank account exists, not what it is', async () => {
    const { agent: owner, assignmentId } = await withDocuments();
    stubModel(GOOD_FIELDS);
    await owner.post(`/api/onboarding/assignments/${assignmentId}/extraction`).send({});

    const { agent: admin } = await agentFor({
      role: 'admin', permissions: ['onboarding.view', 'onboarding.review'],
    });
    const view = await admin.get(`/api/onboarding/assignments/${assignmentId}/extraction`);
    expect(view.status).toBe(200);
    expect(view.body.canSeePayroll).toBe(false);

    const bsb = view.body.groups.flatMap((g) => g.fields).find((f) => f.key === 'bsb');
    expect(bsb).toBeTruthy();
    expect(bsb.visible).toBe(false);
    expect(bsb.value).toBeNull();
    expect(JSON.stringify(view.body)).not.toContain('066-123');
  });

  test('that Admin cannot silently overwrite the value they cannot see', async () => {
    const { agent: owner, assignmentId } = await withDocuments();
    stubModel(GOOD_FIELDS);
    await owner.post(`/api/onboarding/assignments/${assignmentId}/extraction`).send({});

    const { rows } = await db.pool.query(
      "SELECT id FROM onboarding_extracted_fields WHERE assignment_id = $1 AND field_key = 'bsb'",
      [assignmentId]
    );
    const { agent: admin } = await agentFor({
      role: 'admin', permissions: ['onboarding.view', 'onboarding.review'],
    });
    const res = await admin
      .patch(`/api/onboarding/assignments/${assignmentId}/extraction/fields/${rows[0].id}`)
      .send({ decision: 'correct', value: '999-999' });
    expect(res.status).toBe(403);
    expect(res.body.message).toContain('onboarding.payroll');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  REVIEW AND APPLY
// ═════════════════════════════════════════════════════════════════════════════

describe('reviewing what was read', () => {
  async function extracted() {
    const { agent } = await agentFor({ role: 'owner' });
    await publishAllDocuments();
    const { assignmentId } = await startOnboarding(agent);
    await agent.post(`/api/onboarding/assignments/${assignmentId}/starter-pack`).send({});
    await agent.post(`/api/onboarding/assignments/${assignmentId}/starter-pack/send`).send({});
    await agent.post(`/api/onboarding/assignments/${assignmentId}/returned-documents`).send({
      files: [{
        title: 'Employee Details Form',
        fileName: 'form.txt', fileMime: 'text/plain',
        fileData: Buffer.from(RETURNED_FORM, 'utf8').toString('base64'),
      }],
    });
    stubModel([
      { key: 'legal_first_name', value: 'Jane', confidence: 'high', documentIndex: 1 },
      { key: 'surname', value: 'Smyth', confidence: 'low', documentIndex: 1 },
      { key: 'date_of_birth', value: '1990-04-03', confidence: 'high', documentIndex: 1 },
      { key: 'suburb', value: 'Fremantle', confidence: 'high', documentIndex: 1 },
      { key: 'state', value: 'WA', confidence: 'high', documentIndex: 1 },
      { key: 'postcode', value: '6160', confidence: 'high', documentIndex: 1 },
      { key: 'bsb', value: '066-123', confidence: 'high', documentIndex: 1 },
      { key: 'account_number', value: '12345678', confidence: 'high', documentIndex: 1 },
    ]);
    await agent.post(`/api/onboarding/assignments/${assignmentId}/extraction`).send({});

    const view = await agent.get(`/api/onboarding/assignments/${assignmentId}/extraction`);
    const byKey = {};
    view.body.groups.flatMap((g) => g.fields).forEach((f) => { byKey[f.key] = f; });
    return { agent, assignmentId, byKey };
  }

  test('accept, correct and reject each do what they say', async () => {
    const { agent, assignmentId, byKey } = await extracted();
    const url = (id) => `/api/onboarding/assignments/${assignmentId}/extraction/fields/${id}`;

    const accepted = await agent.patch(url(byKey.legal_first_name.id)).send({ decision: 'accept' });
    expect(`${accepted.status} ${JSON.stringify(accepted.body)}`).toContain('200');
    expect(accepted.body.field.status).toBe('accepted');

    const corrected = await agent.patch(url(byKey.surname.id))
      .send({ decision: 'correct', value: 'Smith' });
    expect(corrected.body.field.status).toBe('corrected');
    expect(corrected.body.field.value).toBe('Smith');

    expect((await agent.patch(url(byKey.suburb.id))
      .send({ decision: 'reject' })).body.field.status).toBe('rejected');
  });

  test('a correction is recorded as a human act, with an event', async () => {
    const { agent, assignmentId, byKey } = await extracted();
    await agent.patch(`/api/onboarding/assignments/${assignmentId}/extraction/fields/${byKey.surname.id}`)
      .send({ decision: 'correct', value: 'Smith' });

    const { rows } = await db.pool.query(
      'SELECT value_source, reviewed, reviewed_by FROM onboarding_extracted_fields WHERE id = $1',
      [byKey.surname.id]
    );
    expect(rows[0].value_source).toBe('owner');
    expect(rows[0].reviewed).toBe(true);
    expect(rows[0].reviewed_by).not.toBeNull();

    const { rows: events } = await db.pool.query(
      'SELECT event_type, from_status, to_status FROM onboarding_extracted_field_events WHERE field_id = $1',
      [byKey.surname.id]
    );
    expect(events[0]).toMatchObject({
      event_type: 'field_corrected', from_status: 'proposed', to_status: 'corrected',
    });
  });

  test('a correction to a sensitive field stays encrypted and masked', async () => {
    const { agent, assignmentId, byKey } = await extracted();
    const res = await agent
      .patch(`/api/onboarding/assignments/${assignmentId}/extraction/fields/${byKey.account_number.id}`)
      .send({ decision: 'correct', value: '87654321' });
    expect(res.status).toBe(200);
    expect(res.body.field.value).toBe('••••321');

    const { rows } = await db.pool.query(
      'SELECT value_text, value_encrypted FROM onboarding_extracted_fields WHERE id = $1',
      [byKey.account_number.id]
    );
    expect(rows[0].value_text).toBeNull();
    expect(rows[0].value_encrypted).toMatch(/^obenc:/);
  });

  test('a correction that will not normalise is refused, not stored badly', async () => {
    const { agent, assignmentId, byKey } = await extracted();
    const res = await agent
      .patch(`/api/onboarding/assignments/${assignmentId}/extraction/fields/${byKey.bsb.id}`)
      .send({ decision: 'correct', value: 'not a bsb' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_value');
  });

  test('a second extraction never undoes the Owner\'s correction', async () => {
    const { agent, assignmentId, byKey } = await extracted();
    await agent.patch(`/api/onboarding/assignments/${assignmentId}/extraction/fields/${byKey.surname.id}`)
      .send({ decision: 'correct', value: 'Smith' });

    stubModel([{ key: 'surname', value: 'Smyth', confidence: 'high', documentIndex: 1 }]);
    await agent.post(`/api/onboarding/assignments/${assignmentId}/extraction`).send({});

    const { rows } = await db.pool.query(
      'SELECT value_text, status FROM onboarding_extracted_fields WHERE id = $1', [byKey.surname.id]
    );
    expect(rows[0].value_text).toBe('Smith');
    expect(rows[0].status).toBe('corrected');
  });

  test('applying before an account exists holds the values rather than claiming success', async () => {
    const { agent, assignmentId, byKey } = await extracted();
    for (const key of ['legal_first_name', 'date_of_birth', 'state', 'postcode']) {
      await agent.patch(`/api/onboarding/assignments/${assignmentId}/extraction/fields/${byKey[key].id}`)
        .send({ decision: 'accept' });
    }
    const res = await agent.post(`/api/onboarding/assignments/${assignmentId}/extraction/apply`).send({});
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(0);
    expect(res.body.pending).toBeGreaterThan(0);
    expect(res.body.message).toMatch(/when their account is created/i);
  });

  test('a rejected field is never applied', async () => {
    const { agent, assignmentId, byKey } = await extracted();
    await agent.patch(`/api/onboarding/assignments/${assignmentId}/extraction/fields/${byKey.suburb.id}`)
      .send({ decision: 'reject' });
    await agent.post(`/api/onboarding/assignments/${assignmentId}/extraction/apply`).send({});

    const { rows } = await db.pool.query(
      'SELECT status FROM onboarding_extracted_fields WHERE id = $1', [byKey.suburb.id]
    );
    expect(rows[0].status).toBe('rejected');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  THE ACCOUNT, THE FIRST LOGIN, AND THE PRE-FILLED FORM
// ═════════════════════════════════════════════════════════════════════════════

describe('creating the portal account', () => {
  async function readyForAccount() {
    const { agent } = await agentFor({ role: 'owner' });
    await publishAllDocuments();
    const { assignmentId } = await startOnboarding(agent);
    await agent.post(`/api/onboarding/assignments/${assignmentId}/starter-pack`).send({});
    await agent.post(`/api/onboarding/assignments/${assignmentId}/starter-pack/send`).send({});
    await agent.post(`/api/onboarding/assignments/${assignmentId}/returned-documents`).send({
      files: [{
        title: 'Employee Details Form',
        fileName: 'form.txt', fileMime: 'text/plain',
        fileData: Buffer.from(RETURNED_FORM, 'utf8').toString('base64'),
      }],
    });
    stubModel([
      { key: 'legal_first_name', value: 'Jane', confidence: 'high', documentIndex: 1 },
      { key: 'surname', value: 'Smith', confidence: 'high', documentIndex: 1 },
      { key: 'date_of_birth', value: '1990-04-03', confidence: 'high', documentIndex: 1 },
      { key: 'mobile', value: '0412 345 678', confidence: 'high', documentIndex: 1 },
      { key: 'suburb', value: 'Fremantle', confidence: 'high', documentIndex: 1 },
      { key: 'state', value: 'WA', confidence: 'high', documentIndex: 1 },
      { key: 'postcode', value: '6160', confidence: 'high', documentIndex: 1 },
      { key: 'emergency_name', value: 'Peter Smith', confidence: 'high', documentIndex: 1 },
      { key: 'bsb', value: '066-123', confidence: 'high', documentIndex: 1 },
      { key: 'account_number', value: '12345678', confidence: 'high', documentIndex: 1 },
    ]);
    await agent.post(`/api/onboarding/assignments/${assignmentId}/extraction`).send({});

    const view = await agent.get(`/api/onboarding/assignments/${assignmentId}/extraction`);
    for (const f of view.body.groups.flatMap((g) => g.fields)) {
      await agent.patch(`/api/onboarding/assignments/${assignmentId}/extraction/fields/${f.id}`)
        .send({ decision: 'accept' });
    }
    await agent.post(`/api/onboarding/assignments/${assignmentId}/extraction/apply`).send({});
    return { agent, assignmentId };
  }

  test('issues a temporary password ONCE, and applies the reviewed details', async () => {
    const { agent, assignmentId } = await readyForAccount();

    const res = await agent.post(`/api/onboarding/assignments/${assignmentId}/account`)
      .send({ portalRole: 'employee', loginEmail: 'jane.smith@example.com' });
    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.body.temporaryPassword).toMatch(/^[A-Z]/);
    expect(res.body.portalRoleLabel).toBe('Employee');
    expect(res.body.requirementsIssued).toBeGreaterThan(0);
    expect(res.body.fieldsApplied).toBeGreaterThan(0);

    // The reviewed details reached the canonical employee record.
    const { rows } = await db.pool.query(
      'SELECT legal_first_name, surname, date_of_birth, suburb FROM employee_personal_details WHERE user_id = $1',
      [res.body.userId]
    );
    expect(rows[0].legal_first_name).toBe('Jane');
    expect(rows[0].surname).toBe('Smith');
    expect(rows[0].suburb).toBe('Fremantle');

    // Including the bank details, encrypted, with only the mask readable.
    const { rows: payroll } = await db.pool.query(
      'SELECT bsb_encrypted, bsb_masked, account_number_encrypted, account_number_last4 FROM payroll_profiles WHERE user_id = $1',
      [res.body.userId]
    );
    expect(payroll[0].bsb_encrypted).toMatch(/^obenc:/);
    expect(payroll[0].account_number_last4).toBe('5678');
  });

  test('the password is NOT stored — only its hash', async () => {
    const { agent, assignmentId } = await readyForAccount();
    const res = await agent.post(`/api/onboarding/assignments/${assignmentId}/account`)
      .send({ portalRole: 'employee' });

    const { rows } = await db.pool.query(
      'SELECT password_hash, password_is_temporary, must_change_password, temp_password_expires_at FROM users WHERE id = $1',
      [res.body.userId]
    );
    expect(rows[0].password_hash).toMatch(/^\$2[aby]\$/);
    expect(rows[0].password_hash).not.toContain(res.body.temporaryPassword);
    expect(await bcrypt.compare(res.body.temporaryPassword, rows[0].password_hash)).toBe(true);
    expect(rows[0].password_is_temporary).toBe(true);
    expect(rows[0].must_change_password).toBe(true);
    expect(rows[0].temp_password_expires_at).not.toBeNull();
  });

  test('a retried request does NOT create a second account', async () => {
    const { agent, assignmentId } = await readyForAccount();
    const first = await agent.post(`/api/onboarding/assignments/${assignmentId}/account`)
      .send({ portalRole: 'employee' });
    const second = await agent.post(`/api/onboarding/assignments/${assignmentId}/account`)
      .send({ portalRole: 'employee' });

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('account_exists');

    const { rows } = await db.pool.query(
      'SELECT COUNT(*)::int AS n FROM users WHERE email = $1', ['jane.smith@example.com']
    );
    expect(rows[0].n).toBe(1);
  });

  test('ONBOARDING CANNOT MINT AN OWNER, however the request is shaped', async () => {
    const { agent, assignmentId } = await readyForAccount();
    for (const portalRole of ['owner', 'Owner', ' OWNER ']) {
      const res = await agent.post(`/api/onboarding/assignments/${assignmentId}/account`)
        .send({ portalRole });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Owner access cannot be granted/i);
    }
    const { rows } = await db.pool.query(
      "SELECT COUNT(*)::int AS n FROM users WHERE role = 'owner' AND organisation_id = $1", [org.id]
    );
    // Only the Owner who was seeded.
    expect(rows[0].n).toBe(1);
  });

  test('an Admin holding onboarding.activate still cannot create the account', async () => {
    const { assignmentId } = await readyForAccount();
    const { agent: admin } = await agentFor({
      role: 'admin',
      permissions: ['onboarding.view', 'onboarding.review', 'onboarding.activate'],
    });
    const res = await admin.post(`/api/onboarding/assignments/${assignmentId}/account`)
      .send({ portalRole: 'employee' });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/practice owner/i);
  });

  test('an email already belonging to an active employee is refused, with the reason', async () => {
    const { agent, assignmentId } = await readyForAccount();
    await seedUser({
      email: 'taken@example.com', name: 'Sam Jones',
      role: 'therapist', organisation_id: org.id,
    });
    const res = await agent.post(`/api/onboarding/assignments/${assignmentId}/account`)
      .send({ portalRole: 'employee', loginEmail: 'taken@example.com' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('email_in_use');
    expect(res.body.error).toContain('Sam Jones');
  });

  test('Admin access grants the admin role, not the therapist one', async () => {
    const { agent, assignmentId } = await readyForAccount();
    const res = await agent.post(`/api/onboarding/assignments/${assignmentId}/account`)
      .send({ portalRole: 'admin' });
    expect(res.status).toBe(201);

    const { rows } = await db.pool.query(
      'SELECT proposed_role FROM onboarding_assignments WHERE id = $1', [assignmentId]
    );
    expect(rows[0].proposed_role).toBe('admin');
    // And the account is still a pre-employee until activation — the role is
    // GRANTED at activation, never before.
    const { rows: user } = await db.pool.query('SELECT role FROM users WHERE id = $1', [res.body.userId]);
    expect(user[0].role).toBe('pre_employee');
  });

  test('reissuing replaces the password, so the old one stops working', async () => {
    const { agent, assignmentId } = await readyForAccount();
    const first = await agent.post(`/api/onboarding/assignments/${assignmentId}/account`)
      .send({ portalRole: 'employee' });
    const second = await agent.post(`/api/onboarding/assignments/${assignmentId}/account/reissue-password`)
      .send({});
    expect(second.status).toBe(200);
    expect(second.body.temporaryPassword).not.toBe(first.body.temporaryPassword);

    const old = await loginAs('jane.smith@example.com', first.body.temporaryPassword);
    expect(old.res.status).toBe(401);
    const fresh = await loginAs('jane.smith@example.com', second.body.temporaryPassword);
    expect(fresh.res.status).toBe(200);
  });
});

describe('the first sign-in', () => {
  async function accountCreated() {
    const { agent } = await agentFor({ role: 'owner' });
    await publishAllDocuments();
    const { assignmentId } = await startOnboarding(agent);
    await agent.post(`/api/onboarding/assignments/${assignmentId}/starter-pack`).send({});
    await agent.post(`/api/onboarding/assignments/${assignmentId}/starter-pack/send`).send({});
    await agent.post(`/api/onboarding/assignments/${assignmentId}/returned-documents`).send({
      files: [{
        title: 'Employee Details Form',
        fileName: 'form.txt', fileMime: 'text/plain',
        fileData: Buffer.from(RETURNED_FORM, 'utf8').toString('base64'),
      }],
    });
    stubModel([
      { key: 'legal_first_name', value: 'Jane', confidence: 'high', documentIndex: 1 },
      { key: 'surname', value: 'Smith', confidence: 'high', documentIndex: 1 },
      { key: 'date_of_birth', value: '1990-04-03', confidence: 'high', documentIndex: 1 },
      { key: 'mobile', value: '0412 345 678', confidence: 'high', documentIndex: 1 },
      { key: 'suburb', value: 'Fremantle', confidence: 'high', documentIndex: 1 },
      { key: 'state', value: 'WA', confidence: 'high', documentIndex: 1 },
      { key: 'postcode', value: '6160', confidence: 'high', documentIndex: 1 },
      { key: 'emergency_name', value: 'Peter Smith', confidence: 'high', documentIndex: 1 },
      { key: 'emergency_phone', value: '0498 765 432', confidence: 'high', documentIndex: 1 },
    ]);
    await agent.post(`/api/onboarding/assignments/${assignmentId}/extraction`).send({});
    const view = await agent.get(`/api/onboarding/assignments/${assignmentId}/extraction`);
    for (const f of view.body.groups.flatMap((g) => g.fields)) {
      await agent.patch(`/api/onboarding/assignments/${assignmentId}/extraction/fields/${f.id}`)
        .send({ decision: 'accept' });
    }
    const account = await agent.post(`/api/onboarding/assignments/${assignmentId}/account`)
      .send({ portalRole: 'employee', loginEmail: 'jane.smith@example.com' });
    expect(account.status).toBe(201);
    return { owner: agent, assignmentId, account: account.body };
  }

  test('the temporary password signs in, and the response says what happens next', async () => {
    const { account } = await accountCreated();
    const { res } = await loginAs('jane.smith@example.com', account.temporaryPassword);
    expect(res.status).toBe(200);
    expect(res.body.mustChangePassword).toBe(true);
    expect(res.body.next).toBe('change_password');
  });

  test('that session reaches NOTHING except the password change', async () => {
    const { account, assignmentId } = await accountCreated();
    const { agent } = await loginAs('jane.smith@example.com', account.temporaryPassword);

    for (const path of [
      '/api/onboarding/me',
      `/api/onboarding/assignments/${assignmentId}`,
      '/api/onboarding/dashboard',
    ]) {
      const res = await agent.get(path);
      expect(`${path}:${res.status}`).toBe(`${path}:403`);
      expect(res.body.code).toBe('must_change_password');
    }

    // Their own identity endpoint stays reachable, so the screen can greet them.
    expect((await agent.get('/api/auth/me')).status).toBe(200);
  });

  test('changing the password releases the gate and ends the temporary credential', async () => {
    const { account } = await accountCreated();
    const { agent } = await loginAs('jane.smith@example.com', account.temporaryPassword);

    const change = await agent.post('/api/auth/change-password').send({
      currentPassword: account.temporaryPassword,
      newPassword: 'JanesOwnPass1',
    });
    expect(change.status).toBe(200);
    expect(change.body.replacedTemporary).toBe(true);
    expect(change.body.next).toBe('onboarding');

    // The old credential is dead.
    const stale = await loginAs('jane.smith@example.com', account.temporaryPassword);
    expect(stale.res.status).toBe(401);

    // The new one works and is no longer gated.
    const fresh = await loginAs('jane.smith@example.com', 'JanesOwnPass1');
    expect(fresh.res.status).toBe(200);
    expect(fresh.res.body.mustChangePassword).toBe(false);
    expect((await fresh.agent.get('/api/onboarding/me')).status).toBe(200);
  });

  test('the new password must meet the SAME policy as registration', async () => {
    const { account } = await accountCreated();
    const { agent } = await loginAs('jane.smith@example.com', account.temporaryPassword);
    const res = await agent.post('/api/auth/change-password').send({
      currentPassword: account.temporaryPassword,
      newPassword: 'aaaaaaaa',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/uppercase/i);
  });

  test('an expired temporary password is refused at login, with its own code', async () => {
    const { account } = await accountCreated();
    await db.pool.query(
      "UPDATE users SET temp_password_expires_at = NOW() - INTERVAL '1 day' WHERE email = $1",
      ['jane.smith@example.com']
    );
    const { res } = await loginAs('jane.smith@example.com', account.temporaryPassword);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('temporary_password_expired');
  });

  test('their onboarding is waiting, and their details are ALREADY FILLED IN', async () => {
    // The whole point of the feature: Jane does not retype what she wrote on
    // the form.
    const { account } = await accountCreated();
    const { agent } = await loginAs('jane.smith@example.com', account.temporaryPassword);
    await agent.post('/api/auth/change-password').send({
      currentPassword: account.temporaryPassword, newPassword: 'JanesOwnPass1',
    });

    const mine = await agent.get('/api/onboarding/me');
    expect(mine.status).toBe(200);
    expect(mine.body.hasOnboarding).toBe(true);

    const personal = mine.body.sections
      .flatMap((s) => s.requirements)
      .find((r) => r.formKey === 'personal_details');
    expect(personal).toBeTruthy();

    const detail = await agent.get(`/api/onboarding/me/requirements/${personal.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.values.legal_first_name).toBe('Jane');
    expect(detail.body.values.surname).toBe('Smith');
    expect(detail.body.values.suburb).toBe('Fremantle');

    // And the form SAYS why it is filled in, without mentioning a model.
    expect(detail.body.prefill).toBeTruthy();
    expect(detail.body.prefill.message).toMatch(/Taken from Employee Details Form/i);
    expect(detail.body.prefill.sources).toContain('Employee Details Form');
    expect(JSON.stringify(detail.body.prefill)).not.toMatch(/\bAI\b|confidence|model/i);
  });

  test('their first sign-in is recorded, and the Owner sees it', async () => {
    const { owner, account, assignmentId } = await accountCreated();
    const { agent } = await loginAs('jane.smith@example.com', account.temporaryPassword);
    await agent.post('/api/auth/change-password').send({
      currentPassword: account.temporaryPassword, newPassword: 'JanesOwnPass1',
    });
    await agent.get('/api/onboarding/me');

    const journey = await owner.get(`/api/onboarding/assignments/${assignmentId}/journey`);
    expect(journey.status).toBe(200);
    const step = journey.body.steps.find((s) => s.key === 'employee_review');
    expect(step.state).toBe('done');
    expect(journey.body.assignment.statusLabel).toBe('Employee reviewing');
  });

  test('a correction the EMPLOYEE makes reaches their record', async () => {
    const { account } = await accountCreated();
    const { agent } = await loginAs('jane.smith@example.com', account.temporaryPassword);
    await agent.post('/api/auth/change-password').send({
      currentPassword: account.temporaryPassword, newPassword: 'JanesOwnPass1',
    });

    const mine = await agent.get('/api/onboarding/me');
    const personal = mine.body.sections.flatMap((s) => s.requirements)
      .find((r) => r.formKey === 'personal_details');

    const res = await agent.post(`/api/onboarding/me/requirements/${personal.id}/form`).send({
      legalFirstName: 'Jane', surname: 'Smith', preferredName: 'Janey',
      dateOfBirth: '1990-04-03', personalEmail: 'jane.personal@example.com',
      mobile: '0400 000 000',
      addressLine1: '12 Wattle Street', suburb: 'Fremantle', state: 'WA', postcode: '6160',
    });
    expect(res.status).toBe(200);

    const { rows } = await db.pool.query(
      'SELECT mobile, preferred_name FROM employee_personal_details WHERE user_id = $1',
      [account.userId]
    );
    expect(rows[0].mobile).toBe('0400 000 000');
    expect(rows[0].preferred_name).toBe('Janey');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  THE OWNER'S VIEW
// ═════════════════════════════════════════════════════════════════════════════

describe('the journey panel', () => {
  test('walks forward one step at a time, in plain language', async () => {
    const { agent } = await agentFor({ role: 'owner' });
    await publishAllDocuments();
    const { assignmentId } = await startOnboarding(agent);
    const url = `/api/onboarding/assignments/${assignmentId}/journey`;

    let j = (await agent.get(url)).body;
    expect(j.assignment.statusLabel).toBe('Draft');
    expect(j.nextAction.key).toBe('pack_generated');
    expect(j.progressPercent).toBe(0);

    await agent.post(`/api/onboarding/assignments/${assignmentId}/starter-pack`).send({});
    j = (await agent.get(url)).body;
    expect(j.assignment.statusLabel).toBe('Starter pack ready');
    expect(j.nextAction.key).toBe('pack_sent');

    await agent.post(`/api/onboarding/assignments/${assignmentId}/starter-pack/send`).send({});
    // SMTP is unconfigured, so the send is "skipped" and the status stays put —
    // which is correct: nothing left the building.
    j = (await agent.get(url)).body;
    expect(j.assignment.statusLabel).toBe('Starter pack ready');

    await agent.post(`/api/onboarding/assignments/${assignmentId}/returned-documents`).send({
      files: [{
        fileName: 'form.txt', fileMime: 'text/plain',
        fileData: Buffer.from(RETURNED_FORM, 'utf8').toString('base64'),
      }],
    });
    j = (await agent.get(url)).body;
    expect(j.assignment.statusLabel).toBe('Documents received');
    expect(j.returnedDocuments).toHaveLength(1);
    expect(j.progressPercent).toBeGreaterThan(0);
  });

  test('never shows a raw status, an id, or a PKG_ code', async () => {
    const { agent } = await agentFor({ role: 'owner' });
    await publishAllDocuments();
    const { assignmentId } = await startOnboarding(agent);
    await agent.post(`/api/onboarding/assignments/${assignmentId}/starter-pack`).send({});

    const j = (await agent.get(`/api/onboarding/assignments/${assignmentId}/journey`)).body;
    for (const step of j.steps) {
      expect(step.label).not.toMatch(/_/);
      expect(step.detail).not.toMatch(/PKG_/);
    }
    expect(j.assignment.statusLabel).not.toMatch(/_/);
  });

  test('a therapist cannot open somebody else\'s journey', async () => {
    const { agent: owner } = await agentFor({ role: 'owner' });
    await publishAllDocuments();
    const { assignmentId } = await startOnboarding(owner);

    const { agent: therapist } = await agentFor({ role: 'therapist' });
    expect((await therapist.get(`/api/onboarding/assignments/${assignmentId}/journey`)).status)
      .toBe(403);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  PACKAGE DOCUMENTS
// ═════════════════════════════════════════════════════════════════════════════

describe('managing the documents in a package', () => {
  async function ownerAndPackage() {
    const { agent } = await agentFor({ role: 'owner' });
    await publishAllDocuments();
    const pkgs = (await agent.get('/api/onboarding/packages?kind=package')).body.packages;
    const pkg = pkgs.find((p) => p.title === 'Occupational Therapist — Full-Time');
    return { agent, pkg };
  }

  test('lists the starter pack in business language, with no raw flags', async () => {
    const { agent, pkg } = await ownerAndPackage();
    const res = await agent.get(`/api/onboarding/packages/${pkg.id}/documents`);
    expect(res.status).toBe(200);
    expect(res.body.documents.length).toBeGreaterThan(0);

    for (const d of res.body.documents) {
      expect(d.requirement).toMatch(/Must be completed or acknowledged|Provided for reference/);
      expect(JSON.stringify(d)).not.toContain('blocks_activation');
      if (d.available) expect(d.previewUrl).toContain('/versions/');
    }
  });

  test('renaming changes this package only, never the library', async () => {
    const { agent, pkg } = await ownerAndPackage();
    const doc = (await agent.get(`/api/onboarding/packages/${pkg.id}/documents`)).body.documents[0];
    const originalTitle = doc.libraryTitle;

    const res = await agent.patch(`/api/onboarding/packages/${pkg.id}/documents/${doc.documentId}`)
      .send({ displayTitle: 'Read this one first' });
    expect(res.status).toBe(200);
    expect(res.body.libraryTitle).toBe(originalTitle);

    const { rows } = await db.pool.query(
      'SELECT title FROM onboarding_documents WHERE id = $1', [doc.documentId]
    );
    expect(rows[0].title).toBe(originalTitle);

    const after = (await agent.get(`/api/onboarding/packages/${pkg.id}/documents`)).body.documents
      .find((d) => d.documentId === doc.documentId);
    expect(after.title).toBe('Read this one first');
    expect(after.renamed).toBe(true);
  });

  test('removing takes it out of future packs and deletes nothing', async () => {
    const { agent, pkg } = await ownerAndPackage();
    const doc = (await agent.get(`/api/onboarding/packages/${pkg.id}/documents`)).body.documents[0];

    const res = await agent.delete(`/api/onboarding/packages/${pkg.id}/documents/${doc.documentId}`)
      .send({ reason: 'Superseded by the new handbook' });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/keeps the pack they were sent/i);

    const { rows } = await db.pool.query(
      'SELECT COUNT(*)::int AS n FROM onboarding_documents WHERE id = $1', [doc.documentId]
    );
    expect(rows[0].n).toBe(1);

    const after = (await agent.get(`/api/onboarding/packages/${pkg.id}/documents`)).body.documents
      .find((d) => d.documentId === doc.documentId);
    expect(after.excluded).toBe(true);
  });

  test('a removed document is left out of the next generated pack', async () => {
    const { agent, pkg } = await ownerAndPackage();
    const before = (await agent.get(`/api/onboarding/packages/${pkg.id}/documents`)).body.documents;
    const target = before.find((d) => d.available);

    await agent.delete(`/api/onboarding/packages/${pkg.id}/documents/${target.documentId}`)
      .send({ reason: 'No longer issued' });
    await agent.post(`/api/onboarding/packages/${pkg.id}/publish`).send({ changeNote: 'Removed one' });

    const { assignmentId } = await startOnboarding(agent, { packageId: pkg.id });
    const gen = await agent.post(`/api/onboarding/assignments/${assignmentId}/starter-pack`).send({});
    const codes = gen.body.starterPack.manifest.map((m) => m.documentCode);
    expect(codes).not.toContain(target.code);
  });

  test('restoring puts it back', async () => {
    const { agent, pkg } = await ownerAndPackage();
    const doc = (await agent.get(`/api/onboarding/packages/${pkg.id}/documents`)).body.documents[0];
    await agent.delete(`/api/onboarding/packages/${pkg.id}/documents/${doc.documentId}`).send({});
    await agent.post(`/api/onboarding/packages/${pkg.id}/documents/${doc.documentId}/restore`).send({});

    const after = (await agent.get(`/api/onboarding/packages/${pkg.id}/documents`)).body.documents
      .find((d) => d.documentId === doc.documentId);
    expect(after.excluded).toBe(false);
  });

  test('reordering changes the order of the generated pack', async () => {
    const { agent, pkg } = await ownerAndPackage();
    const docs = (await agent.get(`/api/onboarding/packages/${pkg.id}/documents`)).body.documents;
    const ids = docs.map((d) => d.documentId);
    const reversed = [...ids].reverse();

    const res = await agent.post(`/api/onboarding/packages/${pkg.id}/documents/reorder`)
      .send({ documentIds: reversed });
    expect(res.status).toBe(200);

    const after = (await agent.get(`/api/onboarding/packages/${pkg.id}/documents`)).body.documents;
    expect(after.map((d) => d.documentId)).toEqual(reversed);
  });

  test('the history says which edition each employee actually received', async () => {
    const { agent, pkg } = await ownerAndPackage();
    const { assignmentId } = await startOnboarding(agent, { packageId: pkg.id });
    const gen = await agent.post(`/api/onboarding/assignments/${assignmentId}/starter-pack`).send({});
    const shipped = gen.body.starterPack.manifest[0];

    const res = await agent.get(
      `/api/onboarding/packages/${pkg.id}/documents/${shipped.documentId}/history`
    );
    expect(res.status).toBe(200);
    expect(res.body.versions.length).toBeGreaterThan(0);
    expect(res.body.issuedIn.some((r) => r.employee === 'Jane Smith')).toBe(true);
  });

  test('an editing change marks the package as having unpublished changes', async () => {
    const { agent, pkg } = await ownerAndPackage();
    const doc = (await agent.get(`/api/onboarding/packages/${pkg.id}/documents`)).body.documents[0];
    await agent.patch(`/api/onboarding/packages/${pkg.id}/documents/${doc.documentId}`)
      .send({ displayTitle: 'Renamed' });

    const res = await agent.get(`/api/onboarding/packages/${pkg.id}/documents`);
    expect(res.body.package.hasUnpublishedChanges).toBe(true);
  });

  test('a therapist cannot edit a package', async () => {
    const { pkg } = await ownerAndPackage();
    const { agent: therapist } = await agentFor({ role: 'therapist' });
    expect((await therapist.post(`/api/onboarding/packages/${pkg.id}/documents`)
      .send({ documentId: pkg.id })).status).toBe(403);
    expect((await therapist.delete(`/api/onboarding/packages/${pkg.id}/documents/${pkg.id}`)
      .send({})).status).toBe(403);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  AUDIT
// ═════════════════════════════════════════════════════════════════════════════

describe('the audit trail', () => {
  test('records the journey without ever recording a value', async () => {
    const { agent } = await agentFor({ role: 'owner' });
    await publishAllDocuments();
    const { assignmentId } = await startOnboarding(agent);
    await agent.post(`/api/onboarding/assignments/${assignmentId}/starter-pack`).send({});
    await agent.post(`/api/onboarding/assignments/${assignmentId}/starter-pack/send`).send({});
    await agent.post(`/api/onboarding/assignments/${assignmentId}/returned-documents`).send({
      files: [{
        fileName: 'form.txt', fileMime: 'text/plain',
        fileData: Buffer.from(RETURNED_FORM, 'utf8').toString('base64'),
      }],
    });
    stubModel([{ key: 'bsb', value: '066-123', confidence: 'high', documentIndex: 1 }]);
    await agent.post(`/api/onboarding/assignments/${assignmentId}/extraction`).send({});

    const { rows } = await db.pool.query(
      "SELECT action, metadata FROM audit_logs WHERE action LIKE 'onboarding.%' ORDER BY created_at"
    );
    const actions = rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining([
      'onboarding.starter_pack_generated',
      'onboarding.starter_pack_sent',
      'onboarding.returned_document_uploaded',
      'onboarding.extraction_started',
      'onboarding.extraction_completed',
    ]));

    // Not one metadata blob carries a value the employee supplied.
    const blob = JSON.stringify(rows.map((r) => r.metadata));
    expect(blob).not.toContain('066-123');
    expect(blob).not.toContain('12345678');
    expect(blob).not.toContain('jane.personal@example.com');
  });

  test('a created account is audited without the password', async () => {
    const { agent } = await agentFor({ role: 'owner' });
    await publishAllDocuments();
    const { assignmentId } = await startOnboarding(agent);
    const res = await agent.post(`/api/onboarding/assignments/${assignmentId}/account`)
      .send({ portalRole: 'employee' });
    expect(res.status).toBe(201);

    const { rows } = await db.pool.query(
      "SELECT metadata FROM audit_logs WHERE action = 'onboarding.portal_account_created'"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata.tempPasswordIssued).toBe(true);
    expect(JSON.stringify(rows[0].metadata)).not.toContain(res.body.temporaryPassword);
  });
});
