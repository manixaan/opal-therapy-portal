'use strict';

/**
 * CREDENTIAL SCANS — the register keeps the evidence, not just the claim.
 *
 * Real PostgreSQL, real routes. What is proved here and nowhere else:
 *
 *   · a credential cannot be created without its document, and one document
 *     cannot stand as the evidence for two credentials;
 *   · an Owner may read and verify a colleague's credential and may not edit
 *     it — the route refuses, whatever the dialog offers;
 *   · verification is withdrawn when the values or the document it attested to
 *     change, and is NOT withdrawn by an idle note;
 *   · a model's reading is recorded separately from what a human kept, and the
 *     database itself refuses a proposal carrying a date of birth.
 *
 * The model call is stubbed at the module boundary. The gateway path — policy,
 * region, guardrail refusal, the closed vocabulary — is proved against the
 * mock provider in tests/credential-extraction.test.js; what needs proving
 * HERE is what the route does with an answer once it has one.
 */

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { db, truncateAll, seedUser, closePool } = require('./helpers');
const credentialExtraction = require('../../credential-extraction');

const PASSWORD = 'CredPass1';
const PDF_B64 = Buffer.from('%PDF-1.4 a credential certificate').toString('base64');
const OTHER_PDF_B64 = Buffer.from('%PDF-1.4 a second certificate').toString('base64');

function buildApp() {
  const app = express();
  app.use(bodyParser.json({ limit: '10mb' }));
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../profile-routes'));
  return app;
}

let ORG_ID;

async function agentFor(app, overrides) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser({ password_hash: hash, organisation_id: ORG_ID, ...overrides });
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user };
}

/** Upload a scan and return its document id. */
async function uploadScan(agent, base64 = PDF_B64, fileName = 'ahpra.pdf') {
  const r = await agent.post('/api/profile/credentials/scans').send({
    fileName, fileMime: 'application/pdf', fileSizeBytes: 128, fileData: base64,
  });
  expect(r.status).toBe(201);
  return r.body.document.id;
}

async function createCredential(agent, overrides = {}, base64 = PDF_B64) {
  const documentId = overrides.documentId || await uploadScan(agent, base64);
  const r = await agent.post('/api/profile/credentials').send({
    credentialType: 'ahpra',
    credentialName: 'AHPRA Registration',
    registrationNumber: 'OCC0012345',
    expiryDate: '2027-11-30',
    ...overrides,
    documentId,
  });
  expect(r.status).toBe(201);
  return r.body.credential;
}

beforeAll(async () => {
  const org = await db.pool.query(
    `INSERT INTO organisations (name) VALUES ('Credential Test Practice') RETURNING id`);
  ORG_ID = org.rows[0].id;
});

beforeEach(async () => {
  await truncateAll();
  const org = await db.pool.query(
    `INSERT INTO organisations (name) VALUES ('Credential Test Practice') RETURNING id`);
  ORG_ID = org.rows[0].id;
  jest.restoreAllMocks();
  // Two or three logins per test from one IP against a 10-per-15-minutes
  // limiter. It is exercised deliberately elsewhere, not incidentally here.
  require('../../auth')._resetLoginRateLimit();
});

afterAll(async () => {
  // Per-IP, in-memory and PROCESS-wide, and the suite runs every file in one
  // worker: leaving the counter exhausted would 429 the first logins of
  // whichever file runs next.
  require('../../auth')._resetLoginRateLimit();
  await closePool();
});

// ═══════════════════════════════════════════════════════════════════════════
//  THE SCAN IS THE POINT
// ═══════════════════════════════════════════════════════════════════════════

describe('a credential carries its document', () => {
  test('a credential cannot be created without one', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app, { role: 'therapist' });

    const r = await agent.post('/api/profile/credentials')
      .send({ credentialType: 'ahpra', credentialName: 'AHPRA Registration' });

    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/scan of the credential document is required/i);
    const { rows } = await db.pool.query('SELECT * FROM credentials');
    expect(rows).toHaveLength(0);
  });

  test('the scan is attached, and stays out of the PD documents list', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app, { role: 'therapist' });

    const cred = await createCredential(agent);
    expect(cred.document_id).toBeTruthy();

    // The same file in two places invites somebody to delete it from the one
    // where it looks like a stray.
    const docs = await agent.get('/api/profile/documents');
    expect(docs.body.documents.map((d) => d.id)).not.toContain(cred.document_id);

    // But it is downloadable from the credential.
    const dl = await agent.get(`/api/profile/documents/${cred.document_id}/download`);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toContain('application/pdf');
  });

  test('the list carries the attached document\'s identity for the card', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app, { role: 'therapist' });
    await createCredential(agent);

    const list = await agent.get('/api/profile/credentials');
    expect(list.body.credentials[0].document_file_name).toBe('ahpra.pdf');
    expect(list.body.credentials[0].document_mime).toBe('application/pdf');
  });

  test('somebody else\'s scan cannot be claimed as evidence', async () => {
    const app = buildApp();
    const { agent: mine } = await agentFor(app, { role: 'therapist' });
    const { agent: theirs } = await agentFor(app, { role: 'therapist' });

    const theirDoc = await uploadScan(theirs);
    const r = await mine.post('/api/profile/credentials')
      .send({ credentialType: 'wwcc', credentialName: 'WWCC', documentId: theirDoc });

    expect(r.status).toBe(404);
  });

  test('one scan cannot back two credentials', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app, { role: 'therapist' });

    const documentId = await uploadScan(agent);
    await createCredential(agent, { documentId });

    const second = await agent.post('/api/profile/credentials')
      .send({ credentialType: 'wwcc', credentialName: 'WWCC', documentId });

    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/already attached/i);
  });

  test('removing a credential removes the scan with it', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app, { role: 'therapist' });
    const cred = await createCredential(agent);

    expect((await agent.delete(`/api/profile/credentials/${cred.id}`)).status).toBe(200);

    const { rows } = await db.pool.query('SELECT id FROM pd_documents WHERE id = $1', [cred.document_id]);
    expect(rows).toHaveLength(0);
  });

  test('a scan can be replaced, and the superseded one does not linger', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app, { role: 'therapist' });
    const cred = await createCredential(agent);

    const r = await agent.post(`/api/profile/credentials/${cred.id}/scan`).send({
      fileName: 'ahpra-2027.pdf', fileMime: 'application/pdf',
      fileSizeBytes: 140, fileData: OTHER_PDF_B64,
    });
    expect(r.status).toBe(201);
    expect(r.body.credential.document_id).toBe(r.body.document.id);
    expect(r.body.document.id).not.toBe(cred.document_id);

    const { rows } = await db.pool.query('SELECT id FROM pd_documents WHERE id = $1', [cred.document_id]);
    expect(rows).toHaveLength(0);
  });

  test('a scan must be a scan — a Word file is refused', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app, { role: 'therapist' });

    const r = await agent.post('/api/profile/credentials/scans').send({
      fileName: 'cert.docx',
      fileMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fileData: PDF_B64,
    });
    expect(r.status).toBe(415);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  WHO MAY DO WHAT
// ═══════════════════════════════════════════════════════════════════════════

describe('the Owner and somebody else\'s credential', () => {
  test('may read the scan and verify, and may not edit', async () => {
    const app = buildApp();
    const { agent: therapist } = await agentFor(app, { role: 'therapist' });
    const { agent: owner } = await agentFor(app, { role: 'owner' });
    const cred = await createCredential(therapist);

    // Read: allowed, and audited by the existing document route.
    expect((await owner.get(`/api/profile/documents/${cred.document_id}/download`)).status).toBe(200);

    // Verify: allowed — this is the Owner's job.
    expect((await owner.patch(`/api/profile/credentials/${cred.id}/verify`)).status).toBe(200);

    // Edit: refused. A register a manager can silently retype is not evidence.
    const edit = await owner.patch(`/api/profile/credentials/${cred.id}`)
      .send({ registrationNumber: 'CHANGED123' });
    expect(edit.status).toBe(404);

    const { rows } = await db.pool.query('SELECT registration_number FROM credentials WHERE id = $1', [cred.id]);
    expect(rows[0].registration_number).toBe('OCC0012345');
  });

  test('cannot attach a scan to somebody else\'s credential either', async () => {
    const app = buildApp();
    const { agent: therapist } = await agentFor(app, { role: 'therapist' });
    const { agent: owner } = await agentFor(app, { role: 'owner' });
    const cred = await createCredential(therapist);

    const r = await owner.post(`/api/profile/credentials/${cred.id}/scan`).send({
      fileName: 'x.pdf', fileMime: 'application/pdf', fileData: OTHER_PDF_B64,
    });
    expect(r.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  VERIFICATION MEANS SOMETHING
// ═══════════════════════════════════════════════════════════════════════════

describe('verification and change', () => {
  test('changing a verified value withdraws the tick', async () => {
    const app = buildApp();
    const { agent: therapist } = await agentFor(app, { role: 'therapist' });
    const { agent: owner } = await agentFor(app, { role: 'owner' });
    const cred = await createCredential(therapist);

    await owner.patch(`/api/profile/credentials/${cred.id}/verify`);

    const edit = await therapist.patch(`/api/profile/credentials/${cred.id}`)
      .send({ registrationNumber: 'OCC9999999' });

    expect(edit.status).toBe(200);
    expect(edit.body.verificationWithdrawn).toBe(true);
    expect(edit.body.credential.status).toBe('active');
    expect(edit.body.credential.verified_at).toBeNull();
    expect(edit.body.credential.verified_by_user_id).toBeNull();
  });

  test('an idle note does not undo somebody else\'s check', async () => {
    const app = buildApp();
    const { agent: therapist } = await agentFor(app, { role: 'therapist' });
    const { agent: owner } = await agentFor(app, { role: 'owner' });
    const cred = await createCredential(therapist);

    await owner.patch(`/api/profile/credentials/${cred.id}/verify`);
    const edit = await therapist.patch(`/api/profile/credentials/${cred.id}`)
      .send({ notes: 'Renewal reminder set in my calendar.' });

    expect(edit.body.verificationWithdrawn).toBeFalsy();
    expect(edit.body.credential.status).toBe('verified');
  });

  test('resending an unchanged value does not withdraw the tick', async () => {
    const app = buildApp();
    const { agent: therapist } = await agentFor(app, { role: 'therapist' });
    const { agent: owner } = await agentFor(app, { role: 'owner' });
    const cred = await createCredential(therapist);

    await owner.patch(`/api/profile/credentials/${cred.id}/verify`);
    // The dialog sends every field on Save, including the ones nobody touched.
    const edit = await therapist.patch(`/api/profile/credentials/${cred.id}`).send({
      credentialType: 'ahpra', credentialName: 'AHPRA Registration',
      registrationNumber: 'OCC0012345', expiryDate: '2027-11-30',
    });

    expect(edit.body.verificationWithdrawn).toBeFalsy();
    expect(edit.body.credential.status).toBe('verified');
  });

  test('replacing the document withdraws it — the evidence changed', async () => {
    const app = buildApp();
    const { agent: therapist } = await agentFor(app, { role: 'therapist' });
    const { agent: owner } = await agentFor(app, { role: 'owner' });
    const cred = await createCredential(therapist);

    await owner.patch(`/api/profile/credentials/${cred.id}/verify`);
    const r = await therapist.post(`/api/profile/credentials/${cred.id}/scan`).send({
      fileName: 'new.pdf', fileMime: 'application/pdf', fileData: OTHER_PDF_B64,
    });

    expect(r.body.verificationWithdrawn).toBe(true);
    expect(r.body.credential.status).toBe('active');
  });

  test('the credential type can be corrected — a mis-filed licence is the commonest fix', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app, { role: 'therapist' });
    const cred = await createCredential(agent);

    const edit = await agent.patch(`/api/profile/credentials/${cred.id}`)
      .send({ credentialType: 'wwcc' });
    expect(edit.status).toBe(200);
    expect(edit.body.credential.credential_type).toBe('wwcc');

    const bogus = await agent.patch(`/api/profile/credentials/${cred.id}`)
      .send({ credentialType: 'wizard_licence' });
    expect(bogus.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  READING THE SCAN
// ═══════════════════════════════════════════════════════════════════════════

describe('reading a scan', () => {
  const proposal = {
    status: 'proposed',
    sourceKind: 'image',
    notes: 'Expiry printed on the reverse.',
    warnings: [],
    fields: {
      credential_type: { value: 'wwcc', confidence: 'high' },
      credential_name: { value: 'Working with Children Check', confidence: 'high' },
      registration_number: { value: 'WWC1234567', confidence: 'high' },
      expiry_date: { value: '2029-05-01', confidence: 'medium' },
      holder_name: { value: 'Priya Raman', confidence: 'high' },
    },
    meta: { modelKey: 'clinical_standard', interactionId: null },
  };

  test('proposes fields, records the reading, and writes nothing to the credential', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app, { role: 'therapist', name: 'Priya Raman' });
    jest.spyOn(credentialExtraction, 'extract').mockResolvedValue(proposal);

    const documentId = await uploadScan(agent);
    const r = await agent.post(`/api/profile/credentials/scans/${documentId}/extract`)
      .send({ credentialType: 'wwcc', pageImages: [] });

    expect(r.status).toBe(200);
    expect(r.body.status).toBe('proposed');
    expect(r.body.fields.registration_number.value).toBe('WWC1234567');
    expect(r.body.extractionId).toBeTruthy();

    // Recorded as a proposal, against the document, by this person.
    const { rows } = await db.pool.query('SELECT * FROM credential_extractions');
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('proposed');
    expect(rows[0].document_id).toBe(documentId);
    expect(rows[0].requested_by_user_id).toBe(user.id);
    expect(rows[0].applied).toBeNull();

    // And nothing became a credential by being read.
    const creds = await db.pool.query('SELECT * FROM credentials');
    expect(creds.rows).toHaveLength(0);
  });

  test('warns when the certificate names somebody else', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app, { role: 'therapist', name: 'Jane Smith' });
    jest.spyOn(credentialExtraction, 'extract').mockResolvedValue(proposal);

    const documentId = await uploadScan(agent);
    const r = await agent.post(`/api/profile/credentials/scans/${documentId}/extract`).send({});

    expect(r.body.warnings.join(' ')).toMatch(/does not look like your name/i);
  });

  test('a safety-filter refusal is recorded as a refusal, not as an outage', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app, { role: 'therapist' });
    jest.spyOn(credentialExtraction, 'extract').mockResolvedValue({
      status: 'refused', fields: {}, notes: '', warnings: [], sourceKind: 'image', meta: {},
    });

    const documentId = await uploadScan(agent);
    const r = await agent.post(`/api/profile/credentials/scans/${documentId}/extract`).send({});

    expect(r.status).toBe(200);
    expect(r.body.status).toBe('refused');
    const { rows } = await db.pool.query('SELECT status FROM credential_extractions');
    expect(rows[0].status).toBe('refused');
  });

  test('somebody else\'s scan cannot be read', async () => {
    const app = buildApp();
    const { agent: mine } = await agentFor(app, { role: 'therapist' });
    const { agent: theirs } = await agentFor(app, { role: 'therapist' });
    const documentId = await uploadScan(theirs);

    const r = await mine.post(`/api/profile/credentials/scans/${documentId}/extract`).send({});
    expect(r.status).toBe(404);
  });

  test('saving records which proposed values the person actually kept', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app, { role: 'therapist', name: 'Priya Raman' });
    jest.spyOn(credentialExtraction, 'extract').mockResolvedValue(proposal);

    const documentId = await uploadScan(agent);
    const read = await agent.post(`/api/profile/credentials/scans/${documentId}/extract`).send({});

    // The person keeps the number and the date, but corrects the name.
    const created = await agent.post('/api/profile/credentials').send({
      credentialType: 'wwcc',
      credentialName: 'WWCC (WA)',
      registrationNumber: 'WWC1234567',
      expiryDate: '2029-05-01',
      documentId,
      extractionId: read.body.extractionId,
    });
    expect(created.status).toBe(201);

    const { rows } = await db.pool.query('SELECT * FROM credential_extractions');
    expect(rows[0].status).toBe('applied');
    expect(rows[0].credential_id).toBe(created.body.credential.id);
    expect(Object.keys(rows[0].applied).sort())
      .toEqual(['credential_type', 'expiry_date', 'registration_number']);
    // The corrected name is NOT recorded as applied — that difference is the
    // only measure of how often the reader is right.
    expect(rows[0].applied).not.toHaveProperty('credential_name');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  THE DATABASE'S OWN REFUSAL
// ═══════════════════════════════════════════════════════════════════════════

describe('the closed vocabulary, enforced below the application', () => {
  test('a proposal carrying a date of birth is refused by the database', async () => {
    const user = await seedUser({ organisation_id: ORG_ID });
    await expect(db.pool.query(
      `INSERT INTO credential_extractions (organisation_id, requested_by_user_id, proposed)
       VALUES ($1, $2, $3)`,
      [ORG_ID, user.id, JSON.stringify({ date_of_birth: { value: '1988-03-04' } })]
    )).rejects.toThrow(/credential_extractions_proposed_keys_check/);
  });

  test('a proposal inside the vocabulary is accepted', async () => {
    const user = await seedUser({ organisation_id: ORG_ID });
    const r = await db.pool.query(
      `INSERT INTO credential_extractions (organisation_id, requested_by_user_id, proposed)
       VALUES ($1, $2, $3) RETURNING id`,
      [ORG_ID, user.id, JSON.stringify({ expiry_date: { value: '2029-05-01', confidence: 'high' } })]
    );
    expect(r.rows[0].id).toBeTruthy();
  });
});
