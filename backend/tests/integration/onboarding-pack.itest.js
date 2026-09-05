'use strict';

/**
 * PHASE 2 — the per-employee document pack, against a real database.
 *
 *   the signed offer is verified → this person's default pack is derived
 *   from the role and employment type → the Owner edits it (rename, replace
 *   a file, add a document, remove one) without touching anyone else's →
 *   every document previews from the portal → Prepare Onboarding Email
 *   builds the ZIP, fixes the due date and creates the Outlook draft with
 *   the ZIP attached (Graph stubbed at its boundary) → mark sent →
 *   "Onboarding Documents Sent · Due: date" → waiting.
 */

const http = require('http');
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const JSZip = require('jszip');

const { db, truncateAll, seedUser, seedOrganisation, closePool } = require('./helpers');
const graphMail = require('../../graph-mail');
const packEmail = require('../../onboarding-pack-email');

jest.setTimeout(60000);
const PASSWORD = 'PackPass1';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function buildApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use('/api/onboarding', bodyParser.json({ limit: '16mb' }));
  app.use(bodyParser.json({ limit: '10mb' }));
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../app-routes'));
  app.use('/', require('../../onboarding-employee-routes'));
  app.use('/', require('../../onboarding-workflow-routes'));
  app.use('/', require('../../onboarding-journey-routes'));
  app.use('/', require('../../onboarding-pack-routes'));
  app.use('/', require('../../onboarding-assignment-routes'));
  app.use('/', require('../../onboarding-routes'));
  return app;
}

let app; let server; let org;
let ipCounter = 0;
const nextIp = () => `10.8.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;
const binary = (res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); };

async function agentFor({ permissions, ...overrides } = {}) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser({ password_hash: hash, organisation_id: org.id, ...overrides });
  if (permissions) await db.pool.query('UPDATE users SET permissions = $2 WHERE id = $1', [user.id, JSON.stringify(permissions)]);
  const agent = request.agent(server);
  const res = await agent.post('/api/auth/login').set('X-Forwarded-For', nextIp()).send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user };
}

/** Publish a real file behind a few library documents so the ZIP has something to carry. */
async function publishFiles(codes) {
  const odb = require('../../onboarding-db');
  const docs = await odb.listDocuments(org.id);
  for (const doc of docs) {
    if (!codes.includes(doc.code)) continue;
    const version = await odb.createDocumentVersion(doc.id, {
      title: doc.title, fileName: `${doc.code}.pdf`, fileMime: 'application/pdf',
      fileData: Buffer.from(`%PDF-1.4 ${doc.code}`).toString('base64'), fileSizeBytes: 20,
      effectiveDate: '2026-08-01', changeNote: 'file for testing',
    });
    if (version) await odb.publishDocumentVersion(doc.id, version.id, null);
  }
}

function stubOutlook() {
  jest.spyOn(graphMail, 'unavailableReason').mockReturnValue(null);
  jest.spyOn(graphMail, 'isAvailable').mockReturnValue(true);
  jest.spyOn(graphMail, 'getAccessToken').mockResolvedValue('token');
  return jest.spyOn(graphMail, 'createDraft').mockResolvedValue({ ok: true, id: 'AAMk-pack-1', webLink: 'https://outlook.office.com/mail/drafts/pack' });
}

const OT = {
  name: 'Jane Smith', personalEmail: 'jane.smith@example.com', position: 'Occupational Therapist',
  roleCategory: 'occupational_therapist', employmentType: 'full_time', proposedRole: 'therapist', isTreatingTherapist: true,
  mobileCommunityRole: true, usesOwnVehicle: true, childRelatedWork: 'yes', ndisRiskAssessedRole: 'yes',
  startDate: '2026-11-02', payBasis: 'annual', payRate: 92000, hoursPerWeek: 38,
};
const ADMIN = {
  name: 'Bob Brown', personalEmail: 'bob@example.com', position: 'Administration Officer',
  roleCategory: 'administration', employmentType: 'casual', proposedRole: 'admin', isTreatingTherapist: false,
  startDate: '2026-11-02', payBasis: 'hourly', payRate: 35,
};

/** Start a record and settle Phase 1 without a letter. */
async function settled(agent, body) {
  const res = await agent.post('/api/onboarding/journey/records').send(body);
  expect(res.status).toBe(201);
  const id = res.body.record.id;
  const skip = await agent.post(`/api/onboarding/journey/records/${id}/offer/skip`);
  expect(skip.status).toBe(200);
  return { id, base: `/api/onboarding/journey/records/${id}`, pack: skip.body.pack };
}

beforeAll(() => {
  process.env.ONBOARDING_ENCRYPTION_KEY = 'ab'.repeat(32);
  process.env.APP_BASE_URL = 'https://portal.test.invalid';
  app = buildApp();
  server = http.createServer(app);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
});
afterAll(async () => { await new Promise((resolve) => server.close(resolve)); await closePool(); });
beforeEach(async () => {
  await truncateAll();
  require('../../onboarding-employee-routes')._resetInviteRateLimit();
  require('../../auth')._resetLoginRateLimit();
  org = await seedOrganisation('Opal Therapy Test');
  await require('../../onboarding-seed').seedOnboarding({ organisationId: org.id });
  await require('./onboarding-fixtures').configurePackDefaults(org.id);
  await publishFiles(['DOC_CONTRACT_TEMPLATE', 'DOC_NEW_EMPLOYEE_DETAILS', 'DOC_FWIS']);
  jest.restoreAllMocks();
});

// ═════════════════════════════════════════════════════════════════════════════

describe('the default pack', () => {
  test('is derived from the role and employment type the moment Phase 1 settles', async () => {
    const { agent } = await agentFor({ role: 'owner', email: 'owner@example.com' });
    const ot = await settled(agent, OT);
    const admin = await settled(agent, ADMIN);
    const codes = (p) => p.items.filter((i) => i.status === 'included').map((i) => i.code);

    expect(ot.pack.prepared).toBe(true);
    expect(codes(ot.pack)).toEqual(expect.arrayContaining(['PACK_CONTRACT', 'PACK_NEW_EMPLOYEE_DETAILS', 'PACK_SUPER_CHOICE', 'REQ_FWIS', 'REQ_AHPRA', 'REQ_WWCC', 'REQ_NDIS_SCREENING', 'REQ_DRIVERS_LICENCE', 'PACK_FIRST_AID', 'PACK_CPR', 'PACK_PASSPORT_VISA', 'PACK_POLICE_CHECK']));
    expect(codes(admin.pack)).toEqual(expect.arrayContaining(['PACK_CONTRACT', 'REQ_CEIS', 'REQ_FWIS']));
    expect(codes(admin.pack)).not.toContain('REQ_AHPRA');
    expect(codes(admin.pack)).not.toContain('PACK_FIRST_AID');

    const contract = ot.pack.items.find((i) => i.code === 'PACK_CONTRACT');
    expect(contract).toMatchObject({ sendsDocument: true, employeeReturns: true, requiresVerification: true, required: true, origin: 'default' });
    expect(contract.file).toMatchObject({ source: 'library', previewKind: 'pdf' });
    expect(contract.file.previewUrl).toBe(`${ot.base}/pack/items/${contract.id}/preview`);
    // A library document with no file yet says so instead of pretending.
    const superChoice = ot.pack.items.find((i) => i.code === 'PACK_SUPER_CHOICE');
    expect(superChoice.file.source).toBe('link');
    expect(superChoice.file.previewUrl).toBeNull();
    expect(ot.pack.counts.missingFiles).toBeGreaterThan(0);
  });

  test('every document previews from the portal', async () => {
    const { agent } = await agentFor({ role: 'owner', email: 'owner@example.com' });
    const { pack: p } = await settled(agent, OT);
    const contract = p.items.find((i) => i.code === 'PACK_CONTRACT');
    const res = await agent.get(contract.file.previewUrl).buffer().parse(binary);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/^inline/);
    expect(res.body.toString()).toBe('%PDF-1.4 DOC_CONTRACT_TEMPLATE');
    const dl = await agent.get(contract.file.downloadUrl);
    expect(dl.headers['content-disposition']).toMatch(/^attachment/);
  });
});

describe('editing one person\'s pack', () => {
  test('rename, replace the file, add a document, remove one — and nobody else changes', async () => {
    const { agent } = await agentFor({ role: 'owner', email: 'owner@example.com' });
    const jane = await settled(agent, OT);
    const other = await settled(agent, { ...OT, name: 'Kim Lee', personalEmail: 'kim@example.com' });
    const contract = jane.pack.items.find((i) => i.code === 'PACK_CONTRACT');
    const fwis = jane.pack.items.find((i) => i.code === 'REQ_FWIS');

    const renamed = await agent.patch(`${jane.base}/pack/items/${contract.id}`).send({ title: 'Contract of Employment — Jane Smith' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.pack.items.find((i) => i.id === contract.id).title).toBe('Contract of Employment — Jane Smith');

    const replaced = await agent.post(`${jane.base}/pack/items/${contract.id}/file`).send({ fileName: 'Jane contract.docx', fileMime: DOCX, fileData: Buffer.from('PK-docx-jane').toString('base64') });
    expect(replaced.status).toBe(201);
    const item = replaced.body.pack.items.find((i) => i.id === contract.id);
    expect(item.file).toMatchObject({ source: 'own', previewKind: 'docx', fileName: 'Jane contract.docx' });
    const bytes = await agent.get(item.file.previewUrl).buffer().parse(binary);
    expect(bytes.body.toString()).toBe('PK-docx-jane');

    const removed = await agent.post(`${jane.base}/pack/items/${fwis.id}/remove`).send({ reason: 'given in person' });
    expect(removed.status).toBe(200);
    expect(removed.body.pack.items.find((i) => i.id === fwis.id)).toMatchObject({ status: 'removed', removedReason: 'given in person' });

    const lib = await agent.get(`${jane.base}/pack/library`);
    const notice = lib.body.documents.find((d) => d.code === 'POL_COLLECTION_NOTICE');
    expect(notice.alreadyInPack).toBe(true);
    expect((await agent.post(`${jane.base}/pack/items`).send({ documentId: notice.id })).status).toBe(409);
    const leave = lib.body.documents.find((d) => d.code === 'POL_LEAVE');
    expect(leave.alreadyInPack).toBe(false);
    const added = await agent.post(`${jane.base}/pack/items`).send({ documentId: leave.id, employeeReturns: false, required: false });
    expect(added.status).toBe(201);
    expect(added.body.pack.items.find((i) => i.library && i.library.code === 'POL_LEAVE')).toMatchObject({ origin: 'added', title: leave.title });
    const uploaded = await agent.post(`${jane.base}/pack/items`).send({ title: 'Parking map', employeeReturns: false, fileName: 'parking.pdf', fileMime: 'application/pdf', fileData: Buffer.from('%PDF map').toString('base64') });
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.pack.items.find((i) => i.title === 'Parking map').file.source).toBe('own');
    // Several files on one document: attachments, each removable on its own, all in the ZIP.
    const att1 = await agent.post(`${jane.base}/pack/items/${contract.id}/attachments`).send({ fileName: 'schedule-a.pdf', fileMime: 'application/pdf', fileData: Buffer.from('%PDF schedule A').toString('base64') });
    expect(att1.status).toBe(201);
    const att2 = await agent.post(`${jane.base}/pack/items/${contract.id}/attachments`).send({ fileName: 'schedule-b.pdf', fileMime: 'application/pdf', fileData: Buffer.from('%PDF schedule B').toString('base64') });
    const withBoth = att2.body.pack.items.find((i) => i.id === contract.id);
    expect(withBoth.attachments.map((a) => a.fileName)).toEqual(['schedule-a.pdf', 'schedule-b.pdf']);
    const attBytes = await agent.get(withBoth.attachments[0].previewUrl).buffer().parse(binary);
    expect(attBytes.body.toString()).toBe('%PDF schedule A');
    const zipRes = await agent.get(`${jane.base}/pack/zip`).buffer().parse(binary);
    const zipped = await require('jszip').loadAsync(zipRes.body);
    expect(Object.keys(zipped.files).filter((n) => /schedule.a|schedule.b/i.test(n))).toHaveLength(2);
    const dropped = await agent.delete(`${jane.base}/pack/items/${contract.id}/attachments/${withBoth.attachments[0].id}`);
    expect(dropped.status).toBe(200);
    expect(dropped.body.pack.items.find((i) => i.id === contract.id).attachments.map((a) => a.fileName)).toEqual(['schedule-b.pdf']);
    expect((await agent.delete(`${jane.base}/pack/items/${contract.id}/attachments/${withBoth.attachments[0].id}`)).status).toBe(404);
    // A file dropped on a section files under that section; an unknown section falls to the default.
    const filed = await agent.post(`${jane.base}/pack/items`).send({ title: 'Passport scan', section: 'identity', employeeReturns: false, required: false, fileName: 'passport.pdf', fileMime: 'application/pdf', fileData: Buffer.from('%PDF passport').toString('base64') });
    expect(filed.status).toBe(201);
    expect(filed.body.pack.items.find((i) => i.title === 'Passport scan')).toMatchObject({ section: 'identity', origin: 'added' });
    const misfiled = await agent.post(`${jane.base}/pack/items`).send({ title: 'Odd one', section: 'nonsense', employeeReturns: false });
    expect(misfiled.body.pack.items.find((i) => i.title === 'Odd one').section).toBe('policies');

    // Reverting the replacement goes back to the library copy.
    const reverted = await agent.delete(`${jane.base}/pack/items/${contract.id}/file`);
    expect(reverted.body.pack.items.find((i) => i.id === contract.id).file.source).toBe('library');

    // Kim's pack is exactly as it was.
    const kim = await agent.get(`${other.base}/pack`);
    expect(kim.body.pack.items.find((i) => i.code === 'PACK_CONTRACT').title).toBe('Contract of Employment');
    expect(kim.body.pack.items.find((i) => i.code === 'REQ_FWIS').status).toBe('included');
    expect(kim.body.pack.items.some((i) => i.title === 'Parking map')).toBe(false);

    // Renaming is refused with an empty name; a viewer cannot edit at all.
    expect((await agent.patch(`${jane.base}/pack/items/${contract.id}`).send({ title: '' })).status).toBe(400);
    const viewer = await agentFor({ role: 'admin', email: 'viewer@example.com', permissions: ['onboarding.view'] });
    expect((await viewer.agent.get(`${jane.base}/pack`)).status).toBe(200);
    expect((await viewer.agent.post(`${jane.base}/pack/items/${fwis.id}/restore`)).status).toBe(403);
  });
});

describe('Prepare Onboarding Email', () => {
  test('builds the ZIP from the items, fixes the due date, drafts in Outlook, and mark-sent waits', async () => {
    const { agent } = await agentFor({ role: 'owner', email: 'owner@example.com' });
    const jane = await settled(agent, OT);
    const contract = jane.pack.items.find((i) => i.code === 'PACK_CONTRACT');
    await agent.patch(`${jane.base}/pack/items/${contract.id}`).send({ title: 'Contract of Employment — Jane Smith' });

    // Email 2 is prefilled and editable.
    const before = await agent.get(`${jane.base}/pack`);
    expect(before.body.pack.email.subject).toBe('Onboarding Documentation Pack - Opal Therapy');
    expect(before.body.pack.email.body).toContain('Hi Jane,');
    expect(before.body.pack.email.body).toMatch(/within seven days, by \d{2}\/\d{2}\/\d{4}\./);

    expect((await agent.post(`${jane.base}/pack/email/draft`)).body.code).toBe('graph_unavailable');

    const createDraft = stubOutlook();
    const drafted = await agent.post(`${jane.base}/pack/email/draft`).send({ body: before.body.pack.email.body + '\n\nPS. Call me with questions.' });
    expect(drafted.status).toBe(201);
    const p = drafted.body.pack;
    expect(p.email.draftId).toBe('AAMk-pack-1');
    expect(p.email.dueAt).toBeTruthy();
    const due = packEmail.ddmmyyyy(p.email.dueAt);
    expect(new Date(p.email.dueAt).getTime() - Date.now()).toBeGreaterThan(6 * 86400000);
    expect(p.email.body).toContain(`by ${due}.`);
    expect(p.email.body).toContain('PS. Call me');
    expect(p.zip).toMatchObject({ documentCount: 3 });
    expect(p.zip.manifest.map((m) => m.fileName)).toEqual(['01 - Contract of Employment — Jane Smith.pdf', '02 - Fair Work Information Statement.pdf', '03 - New Employee Details Form.pdf']);
    expect(p.zip.omissions.some((o) => o.code === 'PACK_SUPER_CHOICE')).toBe(true);
    expect(p.editable).toBe(true);

    const call = createDraft.mock.calls[0][0];
    expect(call.to).toBe('jane.smith@example.com');
    expect(call.attachmentMime).toBe('application/zip');
    expect(call.attachmentName).toBe('Opal Therapy Test - Jane Smith - Onboarding Documentation Pack.zip');
    expect(call.html).toContain(`by ${due}.`);
    const zip = await JSZip.loadAsync(call.attachment);
    expect(Object.keys(zip.files)).toContain('01 - Contract of Employment — Jane Smith.pdf');
    expect(await zip.file('00 - Read Me First.txt').async('string')).toContain('• Passport / visa documentation — your own copy');

    // The stored ZIP is what the download serves, and the draft is stale once the pack changes.
    const dl = await agent.get(`${jane.base}/pack/zip`).buffer().parse(binary);
    expect(dl.headers['content-type']).toBe('application/zip');
    expect(dl.body.equals(call.attachment)).toBe(true);
    const fwis = p.items.find((i) => i.code === 'REQ_FWIS');
    const removed = await agent.post(`${jane.base}/pack/items/${fwis.id}/remove`);
    expect(removed.body.pack.email.draftId).toBeNull();
    await agent.post(`${jane.base}/pack/email/draft`);

    const sent = await agent.post(`${jane.base}/pack/mark-sent`);
    expect(sent.status).toBe(200);
    expect(sent.body.pack.editable).toBe(false);
    expect(sent.body.pack.email.sentAt).toBeTruthy();
    const rec = await agent.get(jane.base);
    expect(rec.body.record.status).toBe('starter_pack_sent');
    expect(rec.body.journey.stages[1].summary).toBe(`Onboarding documents sent — due ${due}.`);
    expect(rec.body.journey.next.actor).toBe('employee');
    expect(rec.body.journey.waitingOnEmployee[0].dueAt).toBeTruthy();
    expect((await agent.patch(`${jane.base}/pack/items/${contract.id}`).send({ title: 'x' })).status).toBe(409);

    const board = await agent.get('/api/onboarding/journey/board');
    expect(board.body.records[0].next.actor).toBe('employee');
    expect(board.body.summary.byStage.documentation).toBe(1);

    const { rows: audit } = await db.pool.query("SELECT action FROM audit_logs WHERE action LIKE 'onboarding.pack_%' ORDER BY created_at");
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['onboarding.pack_prepared', 'onboarding.pack_item_updated', 'onboarding.pack_email_drafted', 'onboarding.pack_item_removed', 'onboarding.pack_marked_sent']));
  });

  test('a pack with nothing to send is refused rather than drafting an empty ZIP', async () => {
    const { agent } = await agentFor({ role: 'owner', email: 'owner@example.com' });
    const jane = await settled(agent, OT);
    stubOutlook();
    for (const i of jane.pack.items.filter((x) => x.sendsDocument && x.file.previewUrl)) {
      await agent.post(`${jane.base}/pack/items/${i.id}/remove`);
    }
    const res = await agent.post(`${jane.base}/pack/email/draft`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('empty_pack');
  });
});
