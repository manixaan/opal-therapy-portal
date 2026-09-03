'use strict';

/**
 * PHASE 3 + PAYROLL + THE ONE SCREEN — against a real database.
 *
 *   payroll setup assembles itself from what onboarding gathered and is
 *   Ready for Review only when nothing is missing or in conflict → Phase 3
 *   says exactly what blocks it → once ready, the induction pack (role-keyed,
 *   editable, restorable) goes out as an Outlook draft → returned agreements
 *   are recognised and complete their items; accounts complete when their
 *   set-up task is done → everything required done = Phase 3 complete,
 *   onboarding complete, employee active → the board shows the six lines.
 */

const http = require('http');
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { db, truncateAll, seedUser, seedOrganisation, closePool } = require('./helpers');
const graphMail = require('../../graph-mail');

jest.setTimeout(90000);
const PASSWORD = 'InductPass1';

function buildApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use('/api/onboarding', bodyParser.json({ limit: '16mb' }));
  app.use(bodyParser.json({ limit: '10mb' }));
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false } }));
  for (const r of ['auth', 'app-routes', 'onboarding-employee-routes', 'onboarding-workflow-routes', 'onboarding-journey-routes', 'onboarding-pack-routes', 'onboarding-returns-routes', 'onboarding-payroll-routes', 'onboarding-assignment-routes', 'onboarding-routes']) {
    app.use('/', require(`../../${r}`));
  }
  return app;
}

let app; let server; let org;
let ipCounter = 0;
const nextIp = () => `10.6.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;
const ALL = ['onboarding.view', 'onboarding.assign', 'onboarding.review', 'onboarding.verify', 'onboarding.activate', 'onboarding.payroll', 'onboarding.sensitive_identity'];

async function agentFor({ permissions, ...overrides } = {}) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser({ password_hash: hash, organisation_id: org.id, ...overrides });
  if (permissions) await db.pool.query('UPDATE users SET permissions = $2 WHERE id = $1', [user.id, JSON.stringify(permissions)]);
  const agent = request.agent(server);
  const res = await agent.post('/api/auth/login').set('X-Forwarded-For', nextIp()).send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user };
}
function stubModel(fields, documents) {
  const gateway = require('../../ai/ai-gateway');
  return jest.spyOn(gateway, 'generate').mockResolvedValue({ text: null, toolUse: { type: 'tool_use', name: 'record_employee_details', input: { fields, documents, notes: '' } }, metadata: { aiUsed: true, interactionId: null, modelKey: 'mock', provider: 'mock' } });
}
function stubOutlook() {
  jest.spyOn(graphMail, 'unavailableReason').mockReturnValue(null);
  jest.spyOn(graphMail, 'isAvailable').mockReturnValue(true);
  jest.spyOn(graphMail, 'getAccessToken').mockResolvedValue('token');
  return jest.spyOn(graphMail, 'createDraft').mockResolvedValue({ ok: true, id: 'AAMk-ind-1', webLink: 'https://outlook.office.com/mail/drafts/ind' });
}
async function publishFiles(codes) {
  const odb = require('../../onboarding-db');
  for (const doc of await odb.listDocuments(org.id)) {
    if (!codes.includes(doc.code)) continue;
    const v = await odb.createDocumentVersion(doc.id, { title: doc.title, fileName: `${doc.code}.pdf`, fileMime: 'application/pdf', fileData: Buffer.from(`%PDF-1.4 ${doc.code}`).toString('base64'), fileSizeBytes: 20, effectiveDate: '2026-08-01', changeNote: 't' });
    if (v) await odb.publishDocumentVersion(doc.id, v.id, null);
  }
}
const text = (s) => ({ fileMime: 'text/plain', fileData: Buffer.from(s.padEnd(60, ' ')).toString('base64') });
const ADMIN = { name: 'Bob Brown', personalEmail: 'bob@example.com', position: 'Administration Officer', roleCategory: 'administration', employmentType: 'full_time', proposedRole: 'admin', isTreatingTherapist: false, startDate: '2026-10-07', payBasis: 'annual', payRate: 70000, hoursPerWeek: 38 };

beforeAll(() => {
  process.env.ONBOARDING_ENCRYPTION_KEY = 'dd'.repeat(32);
  process.env.APP_BASE_URL = 'https://portal.test.invalid';
  process.env.AWS_REGION = 'ap-southeast-2';
  process.env.BEDROCK_MODEL_ID = 'au.anthropic.test-profile-synthetic';
  app = buildApp(); server = http.createServer(app);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
});
afterAll(async () => { delete process.env.AWS_REGION; delete process.env.BEDROCK_MODEL_ID; await new Promise((r) => server.close(r)); await closePool(); });
beforeEach(async () => {
  await truncateAll();
  require('../../onboarding-employee-routes')._resetInviteRateLimit();
  require('../../auth')._resetLoginRateLimit();
  org = await seedOrganisation('Opal Therapy Test');
  await require('../../onboarding-seed').seedOnboarding({ organisationId: org.id });
  await require('./onboarding-fixtures').configurePackDefaults(org.id);
  await publishFiles(['DOC_CONTRACT_TEMPLATE', 'DOC_NEW_EMPLOYEE_DETAILS', 'DOC_OUTLOOK_SETUP', 'DOC_PORTAL_SETUP', 'DOC_PRIVACY_AGREEMENT', 'DOC_CODE_OF_CONDUCT_AGREEMENT']);
  jest.restoreAllMocks();
});

/** Start an admin employee, settle Phase 1, send Phase 2, return every required document reliably. */
async function throughPhase2(agent) {
  const res = await agent.post('/api/onboarding/journey/records').send(ADMIN);
  const id = res.body.record.id; const base = `/api/onboarding/journey/records/${id}`;
  await agent.post(`${base}/offer/skip`);
  await agent.post(`${base}/pack/mark-sent`);
  return { id, base };
}

describe('the one screen', () => {
  test('the board and the record carry the six summary lines', async () => {
    const { agent } = await agentFor({ role: 'owner', email: 'owner@example.com', permissions: ALL });
    const { base } = await throughPhase2(agent);
    const rec = await agent.get(base);
    const s = rec.body.journey.summary;
    expect(s.offer.label).toBe('Complete');
    expect(s.documentation.label).toMatch(/0 of \d+ items complete/);
    expect(s.documentation.detail).toBe('Awaiting employee');
    expect(s.setup.label).toMatch(/\d of \d items ready/);
    expect(s.payroll.label).toBe('Gathering information');
    expect(s.induction.label).toBe('Not yet sent');
    expect(typeof s.attention).toBe('number');
    const board = await agent.get('/api/onboarding/journey/board');
    expect(board.body.records[0].summary.offer.label).toBe('Complete');
    // The induction pack exists from the start, role-keyed: an admin gets no Splose instructions.
    expect(rec.body.induction.prepared).toBe(true);
    const codes = rec.body.induction.items.filter((i) => i.status === 'included').map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['IND_OUTLOOK_SETUP', 'IND_PORTAL_SETUP', 'IND_PRIVACY_AGREEMENT', 'IND_CODE_OF_CONDUCT', 'IND_OUTLOOK_ACTIVE', 'IND_PORTAL_ACTIVE', 'IND_TRAINING']));
    expect(codes).not.toContain('IND_SPLOSE_SETUP');
    expect(codes).not.toContain('IND_SPLOSE_ACTIVE');
    // Phase 2's pack no longer carries the policy acknowledgements; Phase 3 does.
    expect(rec.body.pack.items.some((i) => /^REQ_ACK_/.test(i.code))).toBe(false);
    expect(codes.some((c) => /^REQ_ACK_/.test(c))).toBe(true);
  });
});

describe('Payroll Setup and Phase 3', () => {
  test('payroll assembles itself; Phase 3 names its blockers; the pack goes out; returns complete it; the employee becomes active', async () => {
    const { agent } = await agentFor({ role: 'owner', email: 'owner@example.com', permissions: ALL });
    const { base } = await throughPhase2(agent);

    // Before anything comes back: payroll is gathering, Phase 3 is blocked and says why.
    let rec = await agent.get(base);
    expect(rec.body.payroll.status).toBe('gathering');
    expect(rec.body.induction.readiness.ready).toBe(false);
    expect(rec.body.induction.readiness.blockers).toEqual(expect.arrayContaining(['Outlook account still needs to be set up', 'Contract of Employment has not been returned']));
    expect(rec.body.journey.stages[2].summary).toMatch(/Phase 3 is not ready because: /);
    expect((await agent.post(`${base}/induction/email/draft`)).body.code).toBe('not_ready');
    expect((await agent.post(`${base}/payroll-setup/approve`)).body.code).toBe('not_ready');

    // The documents come back, reliably read.
    stubModel([
      { key: 'legal_first_name', value: 'Bob', confidence: 'high', documentIndex: 2 }, { key: 'surname', value: 'Brown', confidence: 'high', documentIndex: 2 },
      { key: 'date_of_birth', value: '1988-01-02', confidence: 'high', documentIndex: 2 }, { key: 'address_line1', value: '1 High St', confidence: 'high', documentIndex: 2 },
      { key: 'suburb', value: 'Perth', confidence: 'high', documentIndex: 2 }, { key: 'state', value: 'WA', confidence: 'high', documentIndex: 2 }, { key: 'postcode', value: '6000', confidence: 'high', documentIndex: 2 },
      { key: 'hours_per_week', value: '38', confidence: 'high', documentIndex: 1 }, { key: 'salary_annual', value: '70000', confidence: 'high', documentIndex: 1 },
      { key: 'bsb', value: '066-123', confidence: 'high', documentIndex: 2 }, { key: 'account_number', value: '12345678', confidence: 'high', documentIndex: 2 }, { key: 'account_holder_name', value: 'Bob Brown', confidence: 'high', documentIndex: 2 },
      { key: 'super_fund_name', value: 'AustralianSuper', confidence: 'high', documentIndex: 3 }, { key: 'super_usi', value: 'STA0100AU', confidence: 'high', documentIndex: 3 },
    ], [
      { documentIndex: 1, kind: 'contract', confidence: 'high', signed: 'yes' }, { documentIndex: 2, kind: 'new_employee_details', confidence: 'high', signed: 'yes' },
      { documentIndex: 3, kind: 'super_choice', confidence: 'high', signed: 'yes' }, { documentIndex: 4, kind: 'tax_summary', confidence: 'high', signed: 'unknown' },
      { documentIndex: 5, kind: 'passport', confidence: 'high', signed: 'unknown' }, { documentIndex: 6, kind: 'police_check', confidence: 'high', signed: 'unknown' },
    ]);
    const up = await agent.post(`${base}/returns`).send({ files: [
      { fileName: 'contract.txt', ...text('CONTRACT signed Bob Brown 38 hours 70000') }, { fileName: 'details.txt', ...text('NEW EMPLOYEE DETAILS Bob Brown 1 High St Perth') },
      { fileName: 'super.txt', ...text('SUPER CHOICE AustralianSuper STA0100AU') }, { fileName: 'tax summary.txt', ...text('EMPLOYEE TAX DETAILS SUMMARY ATO myGov') },
      { fileName: 'passport.txt', ...text('PASSPORT Bob Brown Australia') }, { fileName: 'police.txt', ...text('NATIONAL POLICE CHECK no disclosable court outcomes') },
    ] });
    expect(up.status).toBe(201);
    expect(up.body.processed.matched).toBe(6);

    rec = await agent.get(base);
    expect(rec.body.payroll.status).toBe('ready_for_review');
    expect(rec.body.payroll.rows.map((r) => r.status)).toEqual(Array(10).fill('ready'));
    expect(rec.body.journey.summary.payroll.label).toBe('Ready for Review');
    // Police check is statutory: it waits for the register.
    expect(rec.body.induction.readiness.blockers).toEqual(expect.arrayContaining(['Outlook account still needs to be set up', 'National Police Check has not been verified against the register']));
    expect(rec.body.pack.items.find((i) => i.code === 'PACK_CONTRACT').progress).toBe('verified');

    // Approve payroll.
    const approved = await agent.post(`${base}/payroll-setup/approve`);
    expect(approved.status).toBe(200);
    expect(approved.body.payroll.status).toBe('approved');
    const { rows: pay } = await db.pool.query('SELECT bank_status, payroll_setup_status, payroll_approved_at FROM payroll_profiles WHERE user_id = $1', [rec.body.record.userId]);
    expect(pay[0]).toMatchObject({ bank_status: 'verified', payroll_setup_status: 'setup_required' });
    expect(pay[0].payroll_approved_at).toBeTruthy();

    // The passport was recognised but nothing on it could be read: it needs a look, not silence.
    const passport = rec.body.pack.items.find((i) => i.code === 'PACK_PASSPORT_VISA');
    expect(passport.progress).toBe('attention');
    expect(rec.body.attention.some((a) => a.kind === 'incorrect_document' && a.action.packItemId === passport.id)).toBe(true);
    // Unblock Phase 3: verify the police check against the register and the passport by sight, mark Outlook done.
    const police = rec.body.pack.items.find((i) => i.code === 'PACK_POLICE_CHECK');
    await agent.post(`${base}/pack/items/${police.id}/verify`).send({ reference: 'ACIC 2026' });
    await agent.post(`${base}/pack/items/${passport.id}/verify`).send({ note: 'Sighted' });
    await agent.post(`${base}/tasks/work_email/complete`).send({ note: 'bob@opaltherapy.com.au' });
    rec = await agent.get(base);
    if (!rec.body.induction.readiness.ready) console.log('BLOCKERS', JSON.stringify(rec.body.induction.readiness.blockers));
    expect(rec.body.induction.readiness.ready).toBe(true);
    expect(rec.body.journey.stages[1].state).toBe('complete');
    expect(rec.body.journey.next.action).toBe('prepare_induction');
    expect(rec.body.journey.summary.induction.label).toBe('Ready to send');
    // The account item follows its task.
    expect(rec.body.induction.items.find((i) => i.code === 'IND_OUTLOOK_ACTIVE').progress).toBe('verified');

    // Edit the induction pack, then restore the defaults.
    const cc = rec.body.induction.items.find((i) => i.code === 'IND_CODE_OF_CONDUCT');
    await agent.post(`${base}/induction/items/${cc.id}/remove`).send({ reason: 'signed at interview' });
    const restored = await agent.post(`${base}/induction/restore-defaults`);
    expect(restored.body.pack.items.find((i) => i.code === 'IND_CODE_OF_CONDUCT').status).toBe('included');
    expect((await agent.get(`${base}/induction/items/${cc.id}/preview`)).status).toBe(200);

    // Email 3 → Outlook draft with the induction ZIP.
    const createDraft = stubOutlook();
    const drafted = await agent.post(`${base}/induction/email/draft`);
    expect(drafted.status).toBe(201);
    expect(drafted.body.pack.email.subject).toBe('Opal Therapy Internal Induction Pack');
    expect(drafted.body.pack.email.body).toContain('Hi Bob,');
    expect(drafted.body.pack.email.body).toMatch(/within seven days, by \d{2}\/\d{2}\/\d{4}\./);
    expect(createDraft.mock.calls[0][0].attachmentName).toBe('Opal Therapy Test - Bob Brown - Internal Induction Pack.zip');
    expect(drafted.body.pack.zip.manifest.map((m) => m.title)).toEqual(expect.arrayContaining(['Outlook setup instructions', 'Opal Portal setup instructions', 'Privacy and Confidentiality Agreement', 'Code of Conduct Agreement']));
    // The record still holds Phase 2's own ZIP summary separately.
    expect(drafted.body.pack.phase).toBe('induction');

    const sent = await agent.post(`${base}/induction/mark-sent`);
    expect(sent.status).toBe(200);
    rec = await agent.get(base);
    expect(rec.body.record.status).not.toBe('completed');
    expect(rec.body.journey.stages[2].summary).toMatch(/^Internal Induction Sent — due \d{2}\/\d{2}\/\d{4}\./);
    expect(rec.body.journey.summary.induction.label).toMatch(/^Sent — \d+ of \d+ complete/);
    expect(rec.body.journey.next.actor).toBe('employee');

    // Signed agreements come back; the portal recognises and completes them. Training and accounts follow their tasks.
    stubModel([], [{ documentIndex: 7, kind: 'privacy_agreement', confidence: 'high', signed: 'yes' }, { documentIndex: 8, kind: 'code_of_conduct', confidence: 'high', signed: 'yes' }]);
    const ret = await agent.post(`${base}/returns`).send({ files: [
      { fileName: 'privacy signed.txt', ...text('PRIVACY AND CONFIDENTIALITY AGREEMENT signed Bob Brown') },
      { fileName: 'conduct signed.txt', ...text('CODE OF CONDUCT AGREEMENT signed Bob Brown') },
    ] });
    expect(ret.status).toBe(201);
    rec = await agent.get(base);
    expect(rec.body.induction.items.find((i) => i.code === 'IND_PRIVACY_AGREEMENT').progress).toBe('verified');
    expect(rec.body.induction.items.find((i) => i.code === 'IND_CODE_OF_CONDUCT').progress).toBe('verified');
    expect(rec.body.record.status).not.toBe('completed'); // training + handbook + policy acks still open

    // Remaining required items: policy acknowledgements (auto on return), training (task), handbook is optional.
    const open = rec.body.induction.items.filter((i) => i.status === 'included' && i.required && i.progress !== 'verified' && i.progress !== 'sent' && i.progress !== 'n/a');
    for (const i of open.filter((x) => x.itemKind === 'document')) await agent.post(`${base}/induction/items/${i.id}/remove`).send({ reason: 'covered in person' }).catch(() => {});
    await agent.post(`${base}/tasks/induction_walkthrough/complete`);
    rec = await agent.get(base);
    expect(rec.body.record.status).toBe('completed');
    expect(rec.body.journey.stage.key).toBe('complete');
    expect(rec.body.journey.summary.induction.label).toBe('Complete');
    expect(rec.body.journey.summary.employee).toBe('Active — ready for commencement');
    const { rows: u } = await db.pool.query('SELECT role, activated_from_onboarding_at FROM users WHERE id = $1', [rec.body.record.userId]);
    expect(u[0].role).toBe('admin');
    expect(u[0].activated_from_onboarding_at).toBeTruthy();
    const { rows: audit } = await db.pool.query("SELECT action FROM audit_logs WHERE action IN ('onboarding.payroll_setup_approved', 'onboarding.induction_email_drafted', 'onboarding.induction_marked_sent', 'onboarding.onboarding_completed')");
    expect(audit.map((a) => a.action).sort()).toEqual(['onboarding.induction_email_drafted', 'onboarding.induction_marked_sent', 'onboarding.onboarding_completed', 'onboarding.payroll_setup_approved']);
  });
});
