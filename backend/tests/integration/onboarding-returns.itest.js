'use strict';

/**
 * THE RETURN LEG — against a real database, the forms read by fixed rules.
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

/** The pack's own forms, built with the real field names and labels; read by fixed rules, no model. */
const forms = require('../fixtures/onboarding-forms');
const pdf = (buffer) => ({ fileMime: 'application/pdf', fileData: buffer.toString('base64') });
/** A complete contract on the offer's terms (full-time, $92,000, 38 hours, 2 November 2026). */
const CONTRACT_ON_OFFER = { ...forms.CONTRACT_COMPLETE, employment_type: 'Full-time', annual_salary_aud: '92,000.00', commencement_date: '2 November 2026' };
/** The details form agreeing with the offer (title and start date). */
const NED_ON_OFFER = { values: { ...forms.NED_COMPLETE.values, p2_role_position_title: 'Occupational Therapist', p2_employment_start_date: '02/11/2026' }, ticks: forms.NED_COMPLETE.ticks };

const OT = {
  name: 'Jane Doe', personalEmail: 'jane.doe@example.com', position: 'Occupational Therapist',
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
  await require('./onboarding-fixtures').configurePackDefaults(org.id);
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
    const { rows } = await db.pool.query('SELECT role FROM users WHERE email = $1', ['jane.doe@example.com']);
    expect(rows[0].role).toBe('pre_employee');
  });
});

describe('returned documents: read, reconciled, applied', () => {
  test('agreeing readings flow to the profile and the register; a disagreement becomes a conflict the Owner chooses', async () => {
    const { agent, user: owner } = await agentFor({ role: 'owner', email: 'owner@example.com', permissions: ['onboarding.view', 'onboarding.assign', 'onboarding.review', 'onboarding.verify', 'onboarding.payroll', 'onboarding.sensitive_identity'] });
    const { base } = await settledAndSent(agent);

    // Three documents: the signed contract, the details form (disagreeing about the start date), and a licence scan the rules do not read.
    const up = await agent.post(`${base}/returns`).send({ files: [
      { fileName: '01 - Contract of Employment.pdf', ...pdf(await forms.buildContractPdf(CONTRACT_ON_OFFER, { signature: 'Jane Marie Doe' })) },
      { fileName: '04 - New Employee Details.pdf', ...pdf(await forms.buildEmployeeDetailsPdf({ values: { ...NED_ON_OFFER.values, p2_employment_start_date: '09/11/2026' }, ticks: NED_ON_OFFER.ticks })) },
      { fileName: 'licence.txt', ...text('DRIVERS LICENCE 0000001 expiry 14/03/2031 Jane Doe') },
    ] });
    expect(up.status).toBe(201);
    expect(up.body.stored).toHaveLength(3);
    expect(up.body.processed).toMatchObject({ read: 3, matched: 3, unrecognised: 0, aiUsed: false });
    expect(up.body.processed.candidates).toBeGreaterThan(30);
    expect(up.body.processed.conflict).toBe(1);
    expect(up.body.processed.reliable).toBeGreaterThan(5);

    // Requires Your Attention: the start-date conflict, nothing else about the readings.
    const kinds = up.body.attention.map((a) => a.kind);
    expect(kinds.filter((k) => k === 'conflict')).toHaveLength(1);
    const conflict = up.body.attention.find((a) => a.kind === 'conflict');
    expect(conflict.title).toBe('Commencement Date Conflict');
    expect(conflict.options.map((o) => `${o.sourceLabel}: ${o.display}`)).toEqual(expect.arrayContaining(['Contract of Employment: 02/11/2026', 'New Employee Details: 09/11/2026', 'Offer terms: 02/11/2026']));
    expect(kinds).not.toContain('unrecognised_document');
    expect(kinds).not.toContain('missing_signature');
    expect(kinds).toContain('payroll_approval');

    // The profile carries the reliable values already.
    const rec = await agent.get(base);
    expect(rec.body.record.status).toBe('documents_received');
    expect(rec.body.profile.personal).toMatchObject({ name: 'Jane Marie Doe', address: '12 Example Street, Subiaco, WA, 6008' });
    expect(rec.body.profile.personal.dateOfBirth).toMatch(/^1998-03-14/);
    expect(rec.body.profile.emergency).toMatchObject({ name: 'John Doe', relationship: 'Partner' });
    expect(rec.body.profile.employment.hoursPerWeek).toBe(38);
    expect(rec.body.profile.employment.startDate).toMatch(/^2026-11-02/); // the offer's date stands until the conflict is settled
    expect(rec.body.profile.payroll).toMatchObject({ bankStatus: 'provided', bsbMasked: '•••-•00', accountLast4: '0001' });
    const licence = rec.body.profile.credentials.find((c) => c.type === 'drivers_licence');
    expect(licence).toMatchObject({ number: '0000001', status: 'pending_review' });
    expect(licence.expiryDate).toMatch(/^2031-03-14/);
    expect(licence.documentId).toBeTruthy(); // the original is attached
    // The passport details on the form become an identity record, the original attached.
    expect(rec.body.profile.identity).toHaveLength(1);
    expect(rec.body.profile.identity[0]).toMatchObject({ kind: 'identity', evidenceType: 'australian_passport', numberLast4: '0001' });
    expect(rec.body.profile.identity[0].expiryDate).toMatch(/^2033-07-01/);

    // The pack table: the details form waits on the conflict; the licence (not statutory) is verified by the automation; the contract's reading is complete.
    const items = rec.body.pack.items;
    expect(items.find((i) => i.code === 'PACK_NEW_EMPLOYEE_DETAILS').progress).toBe('received'); // start-date conflict unsettled → not yet verified
    expect(rec.body.returnedDocuments.find((d) => d.fileName === '01 - Contract of Employment.pdf').check).toMatchObject({ status: 'ok', kind: 'contract', method: 'pdf_form' });
    expect(items.find((i) => i.code === 'REQ_DRIVERS_LICENCE')).toMatchObject({ progress: 'verified', verificationMode: 'auto' });
    expect(items.find((i) => i.code === 'REQ_AHPRA').progress).toBe('awaiting_return');

    // The registers read the profile: the licence expiry appears without anybody typing it.
    const userId = rec.body.record.userId;
    const employees = await agent.get(`/api/onboarding/employees/${userId}`);
    expect(employees.body.credentials.find((c) => c.type === 'drivers_licence').expiryDate).toMatch(/^2031-03-14/);
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
    expect(after.body.profile.employment.startDate).toMatch(/^2026-11-02/);
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
    expect(JSON.stringify(audit)).not.toMatch(/Jane|066-000|00000001|Subiaco/);
  });

  test('an unrecognised document and a missing signature need the Owner; a statutory check waits for the register', async () => {
    const { agent } = await agentFor({ role: 'owner', email: 'owner@example.com', permissions: ['onboarding.view', 'onboarding.assign', 'onboarding.review', 'onboarding.verify'] });
    const { base } = await settledAndSent(agent);
    const up = await agent.post(`${base}/returns`).send({ files: [
      { fileName: 'IMG_0001.txt', ...text('something blurry that says nothing useful at all') },
      { fileName: 'WWCC card.txt', ...text('WORKING WITH CHILDREN CHECK WWC0000001 valid to 01/07/2029') },
      { fileName: 'contract.pdf', ...pdf(await forms.buildContractPdf({ ...CONTRACT_ON_OFFER, signature_date: '' })) },
      { fileName: 'employee details.pdf', ...pdf(await forms.buildEmployeeDetailsPdf(NED_ON_OFFER)) },
    ] });
    expect(up.status).toBe(201);
    const kinds = up.body.attention.map((a) => a.kind);
    expect(kinds).toEqual(expect.arrayContaining(['unrecognised_document', 'missing_signature', 'register_check']));
    const unsigned = up.body.attention.find((a) => a.kind === 'missing_signature');
    expect(unsigned.detail).toMatch(/Contract of Employment came back without a signature/);

    // The Owner says what the blurry one is.
    const blur = up.body.attention.find((a) => a.kind === 'unrecognised_document');
    const rec = await agent.get(base);
    const passportItem = rec.body.pack.items.find((i) => i.code === 'REQ_IDENTITY');
    const assigned = await agent.post(`${base}/returns/${blur.action.returnedDocumentId}/assign`).send({ packItemId: passportItem.id });
    expect(assigned.status).toBe(200);
    expect(assigned.body.attention.some((a) => a.kind === 'unrecognised_document')).toBe(false);

    // The WWCC (read from the details form) is on the profile with its expiry, but stays pending until checked against the register.
    const wwcc = rec.body.profile.credentials.find((c) => c.type === 'wwcc');
    expect(wwcc).toMatchObject({ number: 'WWC0000001', status: 'pending_review' });
    // The unsigned contract is held: its check names the blanks, and the item is not verified.
    const contractDoc = rec.body.returnedDocuments.find((d) => d.fileName === 'contract.pdf');
    expect(contractDoc.signatureStatus).toBe('missing');
    expect(contractDoc.check.issues.map((i) => i.message)).toEqual(['Employee signature is empty', 'Date signed is blank']);
    expect(rec.body.pack.items.find((i) => i.code === 'PACK_CONTRACT').progress).not.toBe('verified');
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

  test('a document that does not apply is set aside: it stops counting, can be put back, and needs the verify permission', async () => {
    const { agent } = await agentFor({ role: 'owner', email: 'owner@example.com', permissions: ['onboarding.view', 'onboarding.assign', 'onboarding.review', 'onboarding.verify'] });
    const { base } = await settledAndSent(agent);
    const before = await agent.get(base);
    const visa = before.body.pack.items.find((i) => i.code === 'REQ_RIGHT_TO_WORK');
    expect(visa.progress).toBe('awaiting_return');
    const returnsBefore = before.body.pack.counts.returns;
    const trackedBefore = before.body.pack.tracking.total;

    // A viewer, and a reviewer without the verify permission, cannot set a document aside.
    const viewer = await agentFor({ role: 'admin', email: 'viewer@example.com', permissions: ['onboarding.view', 'onboarding.review'] });
    expect((await viewer.agent.post(`${base}/pack/items/${visa.id}/not-applicable`)).status).toBe(403);

    const marked = await agent.post(`${base}/pack/items/${visa.id}/not-applicable`).send({ note: 'Australian citizen' });
    expect(marked.status).toBe(200);
    const after = await agent.get(base);
    const visaAfter = after.body.pack.items.find((i) => i.id === visa.id);
    expect(visaAfter).toMatchObject({ progress: 'not_applicable', verificationStatus: 'not_applicable', verificationNote: 'Australian citizen' });
    expect(after.body.pack.counts.returns).toBe(returnsBefore - 1);
    expect(after.body.pack.counts.notApplicable).toBe(1);
    expect(after.body.pack.tracking.total).toBe(trackedBefore - 1);
    expect(after.body.pack.counts.returnsOpen).toBe(before.body.pack.counts.returnsOpen - 1);
    // A document that does not come back cannot be marked twice, and only one expected back can be marked at all.
    const readOnly = after.body.pack.items.find((i) => i.status === 'included' && !i.employeeReturns);
    expect((await agent.post(`${base}/pack/items/${readOnly.id}/not-applicable`)).status).toBe(409);

    // Reversed: back to awaiting return, counted again.
    expect((await agent.post(`${base}/pack/items/${visa.id}/applicable`)).status).toBe(200);
    const restored = await agent.get(base);
    expect(restored.body.pack.items.find((i) => i.id === visa.id).progress).toBe('awaiting_return');
    expect(restored.body.pack.counts.returns).toBe(returnsBefore);
    expect((await agent.post(`${base}/pack/items/${visa.id}/applicable`)).status).toBe(409);

    const { rows: audit } = await db.pool.query("SELECT action FROM audit_logs WHERE action IN ('onboarding.pack_item_not_applicable', 'onboarding.pack_item_applicable') ORDER BY created_at");
    expect(audit.map((a) => a.action)).toEqual(['onboarding.pack_item_not_applicable', 'onboarding.pack_item_applicable']);
  });

  test('a ZIP of returns is unpacked into documents, each matched on its own; what it cannot hold is reported', async () => {
    const { agent } = await agentFor({ role: 'owner', email: 'owner@example.com' });
    const { base } = await settledAndSent(agent);
    const JSZip = require('jszip');
    const z = new JSZip();
    z.file('Returned/Jane police check.txt', 'NATIONAL POLICE CHECK result no disclosable outcome'.padEnd(60, ' '));
    z.file('Returned/Signed contract.txt', 'CONTRACT OF EMPLOYMENT signed'.padEnd(60, ' '));
    z.file('Returned/__MACOSX/._x.txt', 'junk');
    z.file('Returned/budget.xlsx', 'nope');
    const zipData = (await z.generateAsync({ type: 'nodebuffer' })).toString('base64');
    const up = await agent.post(`${base}/returns`).send({ files: [{ fileName: 'returns.zip', fileMime: 'application/zip', fileData: zipData }] });
    expect(up.status).toBe(201);
    expect(up.body.stored.map((s) => [s.fileName, s.fromZip])).toEqual([['Jane police check.txt', 'returns.zip'], ['Signed contract.txt', 'returns.zip']]);
    expect(up.body.rejected).toEqual([{ fileName: 'returns.zip › budget.xlsx', reason: expect.stringMatching(/not accepted/) }]);
    expect(up.body.processed).toMatchObject({ matched: 2, aiUsed: false });
    const rec = await agent.get(base);
    expect(rec.body.pack.items.find((i) => i.code === 'PACK_POLICE_CHECK').progress).toBe('received');
    // A contract that is not the pack's own form cannot be read for a signature, so it is received and waits for a person.
    expect(rec.body.pack.items.find((i) => i.code === 'PACK_CONTRACT').returnedAt).toBeTruthy();
    expect(rec.body.returnedDocuments.map((d) => d.title).sort()).toEqual(['Returned / Jane police check.txt', 'Returned / Signed contract.txt']);
    // A zip that turns out to hold nothing usable is a 400, not a silent success.
    const empty = new JSZip(); empty.file('only.xlsx', 'x');
    const bad = await agent.post(`${base}/returns`).send({ files: [{ fileName: 'empty.zip', fileMime: 'application/zip', fileData: (await empty.generateAsync({ type: 'nodebuffer' })).toString('base64') }] });
    expect(bad.status).toBe(400);
    // No audit row names a file.
    const { rows } = await db.pool.query("SELECT metadata FROM audit_logs WHERE action = 'onboarding.returned_document_uploaded'");
    expect(rows.length).toBe(2);
    for (const r of rows) expect(JSON.stringify(r.metadata)).not.toMatch(/police|contract|Jane/i);
  });

  test('a document the rules do not know is matched by name and nothing is invented', async () => {
    const { agent } = await agentFor({ role: 'owner', email: 'owner@example.com' });
    const { base } = await settledAndSent(agent);
    const up = await agent.post(`${base}/returns`).send({ files: [{ fileName: 'Jane police check.txt', ...text('NATIONAL POLICE CHECK result no disclosable outcome') }] });
    expect(up.status).toBe(201);
    expect(up.body.processed).toMatchObject({ matched: 1, aiUsed: false, candidates: 0 });
    const rec = await agent.get(base);
    expect(rec.body.pack.items.find((i) => i.code === 'PACK_POLICE_CHECK').progress).toBe('received');
    expect(rec.body.profile.credentials).toHaveLength(0);
  });

  test('the ATO super choice form is read beneath its labels; an incomplete details form names its blanks and is never verified silently', async () => {
    const { agent } = await agentFor({ role: 'owner', email: 'owner@example.com', permissions: ['onboarding.view', 'onboarding.assign', 'onboarding.review', 'onboarding.verify', 'onboarding.payroll', 'onboarding.sensitive_identity'] });
    const { base } = await settledAndSent(agent);
    const ticks = forms.NED_COMPLETE.ticks.filter((t) => t !== 'p2_interpreter_required_no');
    const up = await agent.post(`${base}/returns`).send({ files: [
      { fileName: '02 - Superannuation Form.pdf', ...pdf(await forms.buildSuperChoicePdf(forms.SUPER_COMPLETE, { signature: 'Jane Marie Doe', signedDate: '10092026' })) },
      { fileName: '04 - New Employee Details.pdf', ...pdf(await forms.buildEmployeeDetailsPdf({ values: { ...NED_ON_OFFER.values, p4_bsb: '12345' }, ticks })) },
    ] });
    expect(up.status).toBe(201);
    expect(up.body.processed).toMatchObject({ read: 2, matched: 2, aiUsed: false });
    const rec = await agent.get(base);
    const superDoc = rec.body.returnedDocuments.find((d) => d.fileName === '02 - Superannuation Form.pdf');
    expect(superDoc.check).toMatchObject({ status: 'ok', kind: 'super_choice', method: 'pdf_text', section: 'B' });
    expect(superDoc.signatureStatus).toBe('present');
    expect(rec.body.pack.items.find((i) => i.code === 'PACK_SUPER_CHOICE')).toMatchObject({ progress: 'verified', verificationMode: 'auto' });
    expect(rec.body.profile.payroll).toMatchObject({ superFund: 'AustralianSuper' });
    // The details form: the interpreter question is unanswered and the BSB is malformed — named, and the item held.
    const ned = rec.body.returnedDocuments.find((d) => d.fileName === '04 - New Employee Details.pdf');
    expect(ned.check.status).toBe('attention');
    expect(ned.check.issues.map((i) => i.message)).toEqual(['Interpreter required: nothing is ticked', 'BSB should be six digits (000-000)']);
    const item = rec.body.pack.items.find((i) => i.code === 'PACK_NEW_EMPLOYEE_DETAILS');
    expect(item.progress).not.toBe('verified');
    expect(item.attentionReason).toMatch(/Interpreter required: nothing is ticked; BSB should be six digits/);
    // The malformed BSB was never proposed; the valid values were.
    expect(rec.body.profile.payroll.bsbMasked).toBeNull();
    expect(rec.body.profile.payroll.accountLast4).toBe('0001');
    expect(rec.body.profile.personal.dateOfBirth).toMatch(/^1998-03-14/);
  });
});
