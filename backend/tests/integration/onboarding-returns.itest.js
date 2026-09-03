'use strict';

/**
 * THE RETURN LEG — against a real database, the model stubbed at the gateway.
 *
 *   documents come back → the portal reads them, says what each is and
 *   whether it is signed, keeps every reading per document, reconciles:
 *   agreeing clear readings are applied to the profile by themselves,
 *   disagreeing ones become a named conflict the Owner chooses, doubtful
 *   ones a review → credentials land in the register with their expiry and
 *   the original attached → Requires Your Attention shows only exceptions →
 *   internal setup has been running since Phase 2 began.
 */

const http = require('http');
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { db, truncateAll, seedUser, seedOrganisation, closePool } = require('./helpers');

jest.setTimeout(60000);
const PASSWORD = 'ReturnPass1';

function buildApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use('/api/onboarding', bodyParser.json({ limit: '16mb' }));
  app.use(bodyParser.json({ limit: '10mb' }));
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false } }));
  for (const r of ['auth', 'app-routes', 'onboarding-employee-routes', 'onboarding-workflow-routes', 'onboarding-journey-routes', 'onboarding-pack-routes', 'onboarding-returns-routes', 'onboarding-assignment-routes', 'onboarding-routes', 'profile-routes']) {
    app.use('/', require(`../../${r}`));
  }
  return app;
}

let app; let server; let org;
let ipCounter = 0;
const nextIp = () => `10.7.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;

async function agentFor({ permissions, ...overrides } = {}) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser({ password_hash: hash, organisation_id: org.id, ...overrides });
  if (permissions) await db.pool.query('UPDATE users SET permissions = $2 WHERE id = $1', [user.id, JSON.stringify(permissions)]);
  const agent = request.agent(server);
  const res = await agent.post('/api/auth/login').set('X-Forwarded-For', nextIp()).send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user };
}

/** The model, stubbed at the gateway boundary: classification + per-document readings. */
function stubModel(fields, documents, notes) {
  const gateway = require('../../ai/ai-gateway');
  return jest.spyOn(gateway, 'generate').mockResolvedValue({
    text: null,
    toolUse: { type: 'tool_use', name: 'record_employee_details', input: { fields, documents, notes: notes || '' } },
    metadata: { aiUsed: true, interactionId: null, modelKey: 'mock', provider: 'mock' },
  });
}

const OT = {
  name: 'Jane Smith', personalEmail: 'jane.smith@example.com', position: 'Occupational Therapist',
  roleCategory: 'occupational_therapist', employmentType: 'full_time', proposedRole: 'therapist', isTreatingTherapist: true,
  mobileCommunityRole: true, usesOwnVehicle: true, childRelatedWork: 'yes', ndisRiskAssessedRole: 'yes',
  startDate: '2026-11-02', payBasis: 'annual', payRate: 92000, hoursPerWeek: 38,
};

const text = (s) => ({ fileMime: 'text/plain', fileData: Buffer.from(s.padEnd(60, ' ')).toString('base64') });

async function settledAndSent(agent) {
  const res = await agent.post('/api/onboarding/journey/records').send(OT);
  const id = res.body.record.id; const base = `/api/onboarding/journey/records/${id}`;
  await agent.post(`${base}/offer/skip`);
  await agent.post(`${base}/pack/mark-sent`);
  return { id, base };
}

beforeAll(() => {
  process.env.ONBOARDING_ENCRYPTION_KEY = 'ce'.repeat(32);
  process.env.APP_BASE_URL = 'https://portal.test.invalid';
  process.env.AWS_REGION = 'ap-southeast-2';
  process.env.BEDROCK_MODEL_ID = 'au.anthropic.test-profile-synthetic';
  app = buildApp();
  server = http.createServer(app);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
});
afterAll(async () => {
  delete process.env.AWS_REGION; delete process.env.BEDROCK_MODEL_ID;
  await new Promise((resolve) => server.close(resolve)); await closePool();
});
beforeEach(async () => {
  await truncateAll();
  require('../../onboarding-employee-routes')._resetInviteRateLimit();
  require('../../auth')._resetLoginRateLimit();
  org = await seedOrganisation('Opal Therapy Test');
  await require('../../onboarding-seed').seedOnboarding({ organisationId: org.id });
  jest.restoreAllMocks();
});

// ═════════════════════════════════════════════════════════════════════════════

describe('Phase 2 begins: the profile owner exists and internal setup is under way', () => {
  test('a pre-employee account, an employment profile from the offer, and the setup checklist appear together', async () => {
    const { agent } = await agentFor({ role: 'owner', email: 'owner@example.com' });
    const { base } = await settledAndSent(agent);
    const rec = await agent.get(base);
    expect(rec.body.record.userId).toBeTruthy();
    expect(rec.body.profile.employment).toMatchObject({ position: 'Occupational Therapist', employmentType: 'full_time', hoursPerWeek: 38, payBasis: 'annual', payRate: 92000 });
    expect(rec.body.tasks.map((t) => t.code)).toEqual(expect.arrayContaining(['portal_account', 'work_email', 'payroll_setup', 'induction_walkthrough']));
    expect(rec.body.tasks.find((t) => t.code === 'portal_account').status).toBe('done');
    expect(rec.body.journey.stages[2].state).toBe('parallel');
    expect(rec.body.journey.stage.key).toBe('documentation');
    expect(rec.body.journey.internalOpen.length).toBeGreaterThan(3);
    const { rows } = await db.pool.query('SELECT role FROM users WHERE email = $1', ['jane.smith@example.com']);
    expect(rows[0].role).toBe('pre_employee');
  });
});

describe('returned documents: read, reconciled, applied', () => {
  test('agreeing readings flow to the profile and the register; a disagreement becomes a conflict the Owner chooses', async () => {
    const { agent, user: owner } = await agentFor({ role: 'owner', email: 'owner@example.com', permissions: ['onboarding.view', 'onboarding.assign', 'onboarding.review', 'onboarding.verify', 'onboarding.payroll', 'onboarding.sensitive_identity'] });
    const { base } = await settledAndSent(agent);

    // The stubbed model: three documents, one of them disagreeing about hours.
    stubModel([
      { key: 'legal_first_name', value: 'Jane', confidence: 'high', documentIndex: 1 }, { key: 'surname', value: 'Smith', confidence: 'high', documentIndex: 1 },
      { key: 'legal_first_name', value: 'Jane', confidence: 'high', documentIndex: 2 }, { key: 'surname', value: 'Smith', confidence: 'high', documentIndex: 2 },
      { key: 'date_of_birth', value: '1990-04-03', confidence: 'high', documentIndex: 2 }, { key: 'date_of_birth', value: '1990-04-03', confidence: 'high', documentIndex: 3 },
      { key: 'hours_per_week', value: '38', confidence: 'high', documentIndex: 1 }, { key: 'hours_per_week', value: '30.4', confidence: 'high', documentIndex: 2 },
      { key: 'mobile', value: '0412 000 000', confidence: 'high', documentIndex: 2 }, { key: 'suburb', value: 'Fremantle', confidence: 'high', documentIndex: 2 },
      { key: 'address_line1', value: '12 Wattle Street', confidence: 'high', documentIndex: 2 }, { key: 'postcode', value: '6160', confidence: 'high', documentIndex: 2 }, { key: 'state', value: 'WA', confidence: 'high', documentIndex: 2 },
      { key: 'emergency_name', value: 'Peter Smith', confidence: 'high', documentIndex: 2 }, { key: 'emergency_phone', value: '0498 765 432', confidence: 'high', documentIndex: 2 }, { key: 'emergency_relationship', value: 'Brother', confidence: 'high', documentIndex: 2 },
      { key: 'bsb', value: '066-123', confidence: 'high', documentIndex: 2 }, { key: 'account_number', value: '12345678', confidence: 'high', documentIndex: 2 }, { key: 'account_holder_name', value: 'Jane Smith', confidence: 'high', documentIndex: 2 },
      { key: 'drivers_licence_number', value: 'WA1234567', confidence: 'high', documentIndex: 3 }, { key: 'drivers_licence_expiry', value: '2029-03-01', confidence: 'high', documentIndex: 3 },
    ], [
      { documentIndex: 1, kind: 'contract', confidence: 'high', signed: 'yes' },
      { documentIndex: 2, kind: 'new_employee_details', confidence: 'high', signed: 'yes' },
      { documentIndex: 3, kind: 'drivers_licence', confidence: 'high', signed: 'unknown' },
    ]);

    const up = await agent.post(`${base}/returns`).send({ files: [
      { fileName: 'Jane contract signed.txt', ...text('CONTRACT OF EMPLOYMENT signed Jane Smith 38 hours per week') },
      { fileName: 'employee details.txt', ...text('NEW EMPLOYEE DETAILS FORM Jane Smith DOB 03/04/1990 30.4 hours') },
      { fileName: 'licence.txt', ...text('DRIVERS LICENCE WA1234567 expiry 01/03/2029 Jane Smith') },
    ] });
    expect(up.status).toBe(201);
    expect(up.body.stored).toHaveLength(3);
    expect(up.body.processed).toMatchObject({ read: 3, matched: 3, unrecognised: 0, aiUsed: true });
    expect(up.body.processed.conflict).toBe(1);
    expect(up.body.processed.reliable).toBeGreaterThan(5);

    // Requires Your Attention: the hours conflict and the two doubtful readings, nothing else.
    const kinds = up.body.attention.map((a) => a.kind);
    expect(kinds.filter((k) => k === 'conflict')).toHaveLength(1);
    const conflict = up.body.attention.find((a) => a.kind === 'conflict');
    expect(conflict.title).toBe('Employment Hours Conflict');
    expect(conflict.options.map((o) => `${o.sourceLabel}: ${o.display}`)).toEqual(expect.arrayContaining(['Contract of Employment: 38 hours', 'New Employee Details Form: 30.4 hours', 'Offer terms: 38 hours']));
    expect(kinds).not.toContain('unrecognised_document');
    expect(kinds).not.toContain('missing_signature');
    expect(kinds).toContain('payroll_approval');

    // The profile carries the reliable values already.
    const rec = await agent.get(base);
    expect(rec.body.record.status).toBe('documents_received');
    expect(rec.body.profile.personal).toMatchObject({ name: 'Jane Smith', address: '12 Wattle Street, Fremantle, WA, 6160' });
    expect(rec.body.profile.personal.dateOfBirth).toMatch(/^1990-04-03/);
    expect(rec.body.profile.emergency).toMatchObject({ name: 'Peter Smith', relationship: 'Brother' });
    expect(rec.body.profile.employment.hoursPerWeek).toBe(38); // the offer's value stands until the conflict is settled
    expect(rec.body.profile.payroll).toMatchObject({ bankStatus: 'provided', bsbMasked: '•••-•23', accountLast4: '5678' });
    const licence = rec.body.profile.credentials.find((c) => c.type === 'drivers_licence');
    expect(licence).toMatchObject({ number: 'WA1234567', status: 'pending_review' });
    expect(licence.expiryDate).toMatch(/^2029-03-01/);
    expect(licence.documentId).toBeTruthy(); // the original is attached
    expect(rec.body.profile.identity).toHaveLength(0);

    // The pack table: contract and details form verified by the automation; licence waits for the register check? No — licence is not statutory.
    const items = rec.body.pack.items;
    expect(items.find((i) => i.code === 'PACK_NEW_EMPLOYEE_DETAILS').progress).toBe('received'); // hours conflict unsettled → not yet verified
    expect(items.find((i) => i.code === 'REQ_DRIVERS_LICENCE')).toMatchObject({ progress: 'verified', verificationMode: 'auto' });
    expect(items.find((i) => i.code === 'REQ_AHPRA').progress).toBe('awaiting_return');

    // The registers read the profile: the licence expiry appears without anybody typing it.
    const userId = rec.body.record.userId;
    const employees = await agent.get(`/api/onboarding/employees/${userId}`);
    expect(employees.body.credentials.find((c) => c.type === 'drivers_licence').expiryDate).toMatch(/^2029-03-01/);
    const expiring = await agent.get('/api/onboarding/compliance/expiring?days=365');
    expect(expiring.body.items.some((i) => i.kind === 'drivers_licence' && i.userId === userId)).toBe(false); // not within a year yet
    const { rows: creds } = await db.pool.query('SELECT expiry_date, document_id, source FROM credentials WHERE user_id = $1 AND credential_type = $2', [userId, 'drivers_licence']);
    expect(creds[0].source).toBe('onboarding');
    const { rows: pd } = await db.pool.query('SELECT document_type, onboarding_assignment_id FROM pd_documents WHERE id = $1', [creds[0].document_id]);
    expect(pd[0]).toMatchObject({ document_type: 'credential_scan' });

    // The Owner chooses the contract's value; the profile follows.
    const choose = conflict.options.find((o) => o.sourceLabel === 'Contract of Employment');
    const resolved = await agent.post(`${base}/fields/${conflict.action.fieldId}/resolve`).send({ decision: 'choose', candidateId: choose.candidateId });
    expect(resolved.status).toBe(200);
    expect(resolved.body.field).toMatchObject({ status: 'applied' });
    expect(resolved.body.attention.some((a) => a.kind === 'conflict')).toBe(false);
    const after = await agent.get(base);
    expect(after.body.profile.employment.hoursPerWeek).toBe(38);
    expect(after.body.pack.items.find((i) => i.code === 'PACK_NEW_EMPLOYEE_DETAILS').progress).toBe('verified');

    // Payroll approval is an Owner act and then falls silent.
    const approved = await agent.post(`${base}/payroll/approve`);
    expect(approved.status).toBe(200);
    expect(approved.body.attention.some((a) => a.kind === 'payroll_approval')).toBe(false);
    const { rows: pay } = await db.pool.query('SELECT bank_status, bank_verified_by FROM payroll_profiles WHERE user_id = $1', [userId]);
    expect(pay[0]).toMatchObject({ bank_status: 'verified', bank_verified_by: owner.id });

    // Audit names ids only.
    const { rows: audit } = await db.pool.query("SELECT action, metadata FROM audit_logs WHERE action IN ('onboarding.returns_processed', 'onboarding.field_resolved', 'onboarding.payroll_bank_approved')");
    expect(audit.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(audit)).not.toMatch(/Jane|066-123|12345678|WA1234567/);
  });

  test('an unrecognised document and a missing signature need the Owner; a statutory check waits for the register', async () => {
    const { agent } = await agentFor({ role: 'owner', email: 'owner@example.com', permissions: ['onboarding.view', 'onboarding.assign', 'onboarding.review', 'onboarding.verify'] });
    const { base } = await settledAndSent(agent);
    stubModel([
      { key: 'wwcc_number', value: 'WWC1234567', confidence: 'high', documentIndex: 2 }, { key: 'wwcc_expiry', value: '2028-06-30', confidence: 'high', documentIndex: 2 },
    ], [
      { documentIndex: 1, kind: 'unrecognised', confidence: 'low', signed: 'unknown' },
      { documentIndex: 2, kind: 'wwcc', confidence: 'high', signed: 'unknown' },
      { documentIndex: 3, kind: 'contract', confidence: 'high', signed: 'no' },
    ]);
    const up = await agent.post(`${base}/returns`).send({ files: [
      { fileName: 'IMG_0001.txt', ...text('something blurry that says nothing useful at all') },
      { fileName: 'card.txt', ...text('WORKING WITH CHILDREN CHECK WWC1234567 valid to 30/06/2028') },
      { fileName: 'contract.txt', ...text('CONTRACT OF EMPLOYMENT unsigned copy returned') },
    ] });
    expect(up.status).toBe(201);
    const kinds = up.body.attention.map((a) => a.kind);
    expect(kinds).toEqual(expect.arrayContaining(['unrecognised_document', 'missing_signature', 'register_check']));

    // The Owner says what the blurry one is.
    const blur = up.body.attention.find((a) => a.kind === 'unrecognised_document');
    const rec = await agent.get(base);
    const passportItem = rec.body.pack.items.find((i) => i.code === 'PACK_PASSPORT_VISA');
    const assigned = await agent.post(`${base}/returns/${blur.action.returnedDocumentId}/assign`).send({ packItemId: passportItem.id });
    expect(assigned.status).toBe(200);
    expect(assigned.body.attention.some((a) => a.kind === 'unrecognised_document')).toBe(false);

    // The WWCC is on the profile with its expiry, but stays pending until checked against the register.
    const wwcc = rec.body.profile.credentials.find((c) => c.type === 'wwcc');
    expect(wwcc).toMatchObject({ number: 'WWC1234567', status: 'pending_review' });
    const item = rec.body.pack.items.find((i) => i.code === 'REQ_WWCC');
    expect(item.progress).toBe('received');
    const verified = await agent.post(`${base}/pack/items/${item.id}/verify`).send({ reference: 'WA register 2026-09-20' });
    expect(verified.status).toBe(200);
    expect(verified.body.attention.some((a) => a.kind === 'register_check')).toBe(false);
    const { rows } = await db.pool.query('SELECT status, verification_reference FROM credentials WHERE user_id = $1 AND credential_type = $2', [rec.body.record.userId, 'wwcc']);
    expect(rows[0]).toMatchObject({ status: 'verified', verification_reference: 'WA register 2026-09-20' });

    // A viewer sees the attention list but cannot act on it.
    const viewer = await agentFor({ role: 'admin', email: 'viewer@example.com', permissions: ['onboarding.view'] });
    expect((await viewer.agent.get(`${base}/attention`)).status).toBe(200);
    expect((await viewer.agent.post(`${base}/returns/${blur.action.returnedDocumentId}/archive`)).status).toBe(403);
  });

  test('without the model, documents are still matched by name and nothing is invented', async () => {
    const { agent } = await agentFor({ role: 'owner', email: 'owner@example.com' });
    const { base } = await settledAndSent(agent);
    const gateway = require('../../ai/ai-gateway');
    jest.spyOn(gateway, 'isAvailable').mockReturnValue(false);
    const up = await agent.post(`${base}/returns`).send({ files: [{ fileName: 'Jane police check.txt', ...text('NATIONAL POLICE CHECK result no disclosable outcome') }] });
    expect(up.status).toBe(201);
    expect(up.body.processed).toMatchObject({ matched: 1, aiUsed: false, candidates: 0 });
    const rec = await agent.get(base);
    expect(rec.body.pack.items.find((i) => i.code === 'PACK_POLICE_CHECK').progress).toBe('received');
    expect(rec.body.profile.credentials).toHaveLength(0);
  });
});
