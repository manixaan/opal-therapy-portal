'use strict';

/**
 * THE THREE-STAGE JOURNEY — offer → documentation → induction, against a real
 * PostgreSQL database (migration 047).
 *
 * The path the feature exists for:
 *
 *   Owner presses Start Onboarding once → the record AND the letter of offer
 *   exist → the letter is previewed as a real .docx → Email 1 is prepared and
 *   an Outlook draft is created with the letter attached (Graph stubbed at
 *   its boundary) → the Owner marks it sent → the signed letter is uploaded
 *   and stored → the Owner verifies it → the release happens BY ITSELF
 *   (account, invitation, requirement set, employment profile carrying the
 *   offer terms) → the documentation is done → the induction checklist is
 *   generated → activating portal access is one of its tasks → the last task
 *   closes the record.
 *
 * Alongside it, what must NOT happen: a therapist reading the board, another
 * organisation reading a record, a viewer ticking off an induction task, a
 * stale Outlook draft surviving a change of terms, and a declined offer
 * silently disappearing.
 */

const http = require('http');
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { db, truncateAll, seedUser, seedOrganisation, closePool } = require('./helpers');
const graphMail = require('../../graph-mail');
const offerDocx = require('../../onboarding-offer-docx');

/** Outlook, stubbed at the Graph boundary: available, and a draft is "created". */
function stubOutlook() {
  jest.spyOn(graphMail, 'unavailableReason').mockReturnValue(null);
  jest.spyOn(graphMail, 'isAvailable').mockReturnValue(true);
  jest.spyOn(graphMail, 'getAccessToken').mockResolvedValue('token');
  return jest.spyOn(graphMail, 'createDraft').mockResolvedValue({ ok: true, id: 'AAMk-draft-1', webLink: 'https://outlook.office.com/mail/drafts/1' });
}

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
  // A spy on graph-mail from one test must not carry its calls into the next.
  jest.restoreAllMocks();
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
    expect(body.journey.next).toMatchObject({ actor: 'admin', action: 'prepare_email' });
    expect(body.letter).toMatchObject({ source: 'generated', templateVersion: offerDocx.TEMPLATE_VERSION });
    expect(body.email.subject).toBe('Letter of Offer - Opal Therapy');
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

describe('Stage 0 — a Start form saved part-way survives as a draft (migration 054)', () => {
  test('save, list, resume, then creating the record clears the draft', async () => {
    const { agent } = await agentFor({ role: 'owner', email: 'owner@example.com' });
    const form = { name: 'Jane Smith', position: 'Occupational Therapist', payRate: '92000' };

    const saved = await agent.post('/api/onboarding/journey/drafts').send({ form });
    expect(saved.status).toBe(201);
    expect(saved.body.draft).toMatchObject({ applicantName: 'Jane Smith', positionTitle: 'Occupational Therapist', form });
    const id = saved.body.draft.id;

    const updated = await agent.put(`/api/onboarding/journey/drafts/${id}`).send({ form: { ...form, name: 'Jane A Smith' } });
    expect(updated.status).toBe(200);
    expect(updated.body.draft.applicantName).toBe('Jane A Smith');

    const list = await agent.get('/api/onboarding/journey/drafts');
    expect(list.status).toBe(200);
    expect(list.body.drafts.map((d) => d.id)).toEqual([id]);

    const one = await agent.get(`/api/onboarding/journey/drafts/${id}`);
    expect(one.body.draft.form.payRate).toBe('92000');

    await start(agent, { draftId: id });
    expect((await agent.get('/api/onboarding/journey/drafts')).body.drafts).toEqual([]);
    expect((await agent.get(`/api/onboarding/journey/drafts/${id}`)).status).toBe(404);
  });

  test('a draft can be discarded, and a malformed one is refused', async () => {
    const { agent } = await agentFor({ role: 'owner', email: 'owner@example.com' });
    expect((await agent.post('/api/onboarding/journey/drafts').send({ form: 'nope' })).status).toBe(400);
    expect((await agent.post('/api/onboarding/journey/drafts').send({ form: { pad: 'x'.repeat(20000) } })).status).toBe(400);

    const { body } = await agent.post('/api/onboarding/journey/drafts').send({ form: { name: 'Temp' } });
    expect((await agent.delete(`/api/onboarding/journey/drafts/${body.draft.id}`)).status).toBe(200);
    expect((await agent.delete(`/api/onboarding/journey/drafts/${body.draft.id}`)).status).toBe(404);
  });

  test('drafts carry personal details, so the view permission alone cannot read them, and another organisation never can', async () => {
    const owner = await agentFor({ role: 'owner', email: 'owner@example.com' });
    const { body } = await owner.agent.post('/api/onboarding/journey/drafts').send({ form: { name: 'Private Person', personalEmail: 'p@example.com' } });

    const viewer = await agentFor({ role: 'admin', email: 'viewer@example.com', permissions: ['onboarding.view'] });
    expect((await viewer.agent.get('/api/onboarding/journey/drafts')).status).toBe(403);
    expect((await viewer.agent.get(`/api/onboarding/journey/drafts/${body.draft.id}`)).status).toBe(403);

    const otherOrg = await seedOrganisation('Elsewhere Pty Ltd');
    const outsider = await agentFor({ role: 'owner', email: 'other@example.com', organisation_id: otherOrg.id });
    expect((await outsider.agent.get(`/api/onboarding/journey/drafts/${body.draft.id}`)).status).toBe(404);
    expect((await outsider.agent.get('/api/onboarding/journey/drafts')).body.drafts).toEqual([]);
    expect((await outsider.agent.delete(`/api/onboarding/journey/drafts/${body.draft.id}`)).status).toBe(404);
  });
});

describe('The letter\'s wording — edited in the portal, the standard from then on (migration 055)', () => {
  const greetingIndex = (paras) => paras.findIndex((p) => p.segments[0] && p.segments[0].text === 'Dear ');
  const letterText = async (agent, id) => {
    const res = await agent.get(`/api/onboarding/journey/records/${id}/offer/letter/download`).buffer(true).parse((r, cb) => { const c = []; r.on('data', (d) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
    expect(res.status).toBe(200);
    const zip = await require('jszip').loadAsync(res.body);
    const xml = await zip.file('word/document.xml').async('string');
    return (xml.match(/<w:t(?: [^>]*)?>[^<]*<\/w:t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join('');
  };

  test('save an edit → every generated letter carries it, the record says so, and reset goes back', async () => {
    const { agent } = await agentFor({ role: 'owner', email: 'owner@example.com' });
    const before = await agent.get('/api/onboarding/journey/offer-template');
    expect(before.status).toBe(200);
    expect(before.body.template.source).toBe('built_in');
    const i = greetingIndex(before.body.paragraphs);

    const saved = await agent.put('/api/onboarding/journey/offer-template').send({ paragraphs: [{ index: i, segments: [
      { type: 'text', text: 'Hello ' }, { type: 'tag', tag: 'OPAL_LOO_CANDIDATE_FIRST_NAME' }, { type: 'text', text: ', and welcome,' },
    ] }] });
    expect(saved.status).toBe(200);
    expect(saved.body.template).toMatchObject({ source: 'practice', version: 1 });
    expect(saved.body.paragraphs[i].segments[0].text).toBe('Hello ');

    const record = await start(agent);
    expect(record.letter.template).toMatchObject({ source: 'practice', version: 1 });
    expect(await letterText(agent, record.record.id)).toContain('Hello Jane, and welcome,');

    const reset = await agent.post('/api/onboarding/journey/offer-template/reset');
    expect(reset.body.template.source).toBe('built_in');
    expect(await letterText(agent, record.record.id)).toContain('Dear Jane,');
  });

  test('a bad edit is refused and changes nothing; only onboarding.assign may edit', async () => {
    const { agent } = await agentFor({ role: 'owner', email: 'owner@example.com' });
    expect((await agent.put('/api/onboarding/journey/offer-template').send({ paragraphs: [{ index: 99999, segments: [] }] })).status).toBe(400);
    expect((await agent.put('/api/onboarding/journey/offer-template').send({})).status).toBe(400);
    expect((await agent.get('/api/onboarding/journey/offer-template')).body.template.source).toBe('built_in');

    const viewer = await agentFor({ role: 'admin', email: 'viewer@example.com', permissions: ['onboarding.view'] });
    expect((await viewer.agent.get('/api/onboarding/journey/offer-template')).status).toBe(403);
    expect((await viewer.agent.put('/api/onboarding/journey/offer-template').send({ paragraphs: [] })).status).toBe(403);
    expect((await viewer.agent.post('/api/onboarding/journey/offer-template/reset')).status).toBe(403);
  });
});

const detailLetter = (res) => res.body.letter;

describe('Stage 1 → 2 — letter, Email 1, Outlook draft, signed copy, verification, release', () => {
  test('the whole path, with the terms reaching the employment profile untyped', async () => {
    const { agent, user: owner } = await agentFor({ role: 'owner', email: 'owner@example.com' });
    const { record } = await start(agent);
    const base = `/api/onboarding/journey/records/${record.id}`;

    // The letter is a real .docx composed from the record.
    const preview = await agent.get(`${base}/offer/letter/preview.docx`).buffer().parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(preview.status).toBe(200);
    expect(preview.headers['content-type']).toBe(offerDocx.DOCX_MIME);
    expect(preview.headers['content-disposition']).toMatch(/^inline/);
    const zip = await require('jszip').loadAsync(preview.body);
    const xml = await zip.file('word/document.xml').async('string');
    expect(xml).toContain('Occupational Therapist');
    expect(xml).toContain('$92,000 per annum');
    expect(xml).not.toMatch(/\[PORTAL/);
    const dl = await agent.get(`${base}/offer/letter/download`);
    expect(dl.headers['content-disposition']).toMatch(/^attachment; filename="Letter%20of%20Offer%20-%20Jane%20Smith/);
    // The same letter as a PDF — read from the .docx, named like it.
    const pdfRes = await agent.get(`${base}/offer/letter/download.pdf`).buffer().parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(pdfRes.status).toBe(200);
    expect(pdfRes.headers['content-type']).toBe('application/pdf');
    expect(pdfRes.headers['content-disposition']).toMatch(/^attachment; filename="Letter%20of%20Offer%20-%20Jane%20Smith.*\.pdf"$/);
    expect(pdfRes.body.slice(0, 5).toString('latin1')).toBe('%PDF-');
    expect(detailLetter(await agent.get(base)).pdfUrl).toBe(`${base}/offer/letter/download.pdf`);

    // Email 1 is prefilled with Opal's wording and can be edited.
    const detail = await agent.get(base);
    expect(detail.body.email.subject).toBe('Letter of Offer - Opal Therapy');
    expect(detail.body.email.body).toContain('Hi Jane,');
    expect(detail.body.email.body).toContain('position of Occupational Therapist with Opal Therapy');
    expect(detail.body.journey.next.action).toBe('prepare_email');

    // Without Outlook connected, the draft is refused legibly.
    const noGraph = await agent.post(`${base}/offer/email/draft`);
    expect(noGraph.status).toBe(409);
    expect(noGraph.body.code).toBe('graph_unavailable');

    const createDraft = stubOutlook();
    const drafted = await agent.post(`${base}/offer/email/draft`).send({ subject: 'Letter of Offer - Opal Therapy', body: detail.body.email.body + '\n\nPS. Welcome!' });
    expect(drafted.status).toBe(201);
    expect(drafted.body.offer.status).toBe('email_drafted');
    expect(drafted.body.email.webLink).toBe('https://outlook.office.com/mail/drafts/1');
    expect(drafted.body.email.body).toContain('PS. Welcome!');
    expect(drafted.body.journey.next.action).toBe('send_in_outlook');
    expect(drafted.body.dispatches[0]).toMatchObject({ kind: 'letter_of_offer', method: 'graph_draft', status: 'draft_created' });
    // The Graph call carried the letter as a .docx attachment, to the candidate, with the HTML body.
    const call = createDraft.mock.calls[0][0];
    expect(call.to).toBe('jane.smith@example.com');
    expect(call.attachmentMime).toBe(offerDocx.DOCX_MIME);
    expect(call.attachmentName).toMatch(/^Letter of Offer - Jane Smith/);
    expect(Buffer.isBuffer(call.attachment)).toBe(true);
    expect(call.html).toContain('<p style="margin:0 0 12px">Hi Jane,</p>');
    expect(call.html).toContain('PS. Welcome!');

    // Nothing is sent by the portal: the Owner sends in Outlook and says so.
    const sent = await agent.post(`${base}/offer/mark-sent`);
    expect(sent.status).toBe(200);
    expect(sent.body.offer.status).toBe('sent');
    expect(sent.body.journey.stage.number).toBe(1.5);
    expect(sent.body.journey.next.actor).toBe('employee');

    // Terms are frozen once sent.
    expect((await agent.put(`${base}/offer`).send({ terms: { ...START_BODY, positionTitle: 'Changed' } })).status).toBe(409);

    // The signed letter comes back and is stored.
    const signedBytes = Buffer.from('%PDF-1.4 signed letter');
    const up = await agent.post(`${base}/offer/signed`).send({ fileName: 'Jane Smith signed LOO.pdf', fileMime: 'application/pdf', fileData: signedBytes.toString('base64') });
    expect(up.status).toBe(201);
    // The stored signed letter is the acceptance: no separate verification click.
    expect(up.body.offer.status).toBe('accepted');
    expect(up.body.signed).toMatchObject({ kind: 'signed', fileName: 'Jane Smith signed LOO.pdf', previewKind: 'pdf', size: signedBytes.length });
    expect(up.body.prepared.status).toBe('prepared');
    const served = await agent.get(`${base}/offer/signed/download`);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('application/pdf');
    expect(Buffer.from(served.body).toString()).toBe('%PDF-1.4 signed letter');

    // Phase 1 settled on upload; the document pack was derived without another click.
    expect((await agent.post(`${base}/offer/verify`)).status).toBe(409);
    const verified = { body: up.body };
    expect(verified.body.prepared.total).toBeGreaterThan(8);
    expect(verified.body.record.status).toBe('created');
    expect(verified.body.journey.stage.key).toBe('documentation');
    expect(verified.body.journey.stages[0].state).toBe('complete');
    expect(verified.body.journey.next).toMatchObject({ actor: 'admin', action: 'review_pack' });
    expect(verified.body.pack.items.length).toBe(verified.body.prepared.total);

    // The 034 release (portal account + invitation) is still available by hand.
    const released = await agent.post(`${base}/release`);
    expect(released.status).toBe(201);
    expect(released.body.record.status).toBe('invite_sent');
    expect(released.body.record.userId).toBeTruthy();
    expect(released.body.sections.length).toBeGreaterThan(0);

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

    // The audit trail names ids, never the person, and never the file.
    const { rows: audit } = await db.pool.query(
      "SELECT action, metadata FROM audit_logs WHERE action LIKE 'onboarding.offer_%' OR action = 'onboarding.assignment_released' ORDER BY created_at");
    expect(audit.map((a) => a.action)).toEqual([
      'onboarding.offer_email_drafted', 'onboarding.offer_marked_sent', 'onboarding.offer_signed_received',
      'onboarding.offer_verified', 'onboarding.assignment_released',
    ]);
    expect(JSON.stringify(audit)).not.toContain('jane.smith@example.com');
    expect(JSON.stringify(audit)).not.toContain('Jane Smith');
  });

  test('changing the terms regenerates the letter and forgets a stale Outlook draft', async () => {
    const { agent } = await agentFor({ role: 'owner', email: 'owner@example.com' });
    const { record } = await start(agent);
    const base = `/api/onboarding/journey/records/${record.id}`;
    stubOutlook();
    await agent.post(`${base}/offer/email/draft`);

    const revised = await agent.put(`${base}/offer`).send({ terms: { ...START_BODY, positionTitle: 'Senior Occupational Therapist', payRate: 99000 } });
    expect(revised.status).toBe(200);
    expect(revised.body.offer.status).toBe('draft');
    expect(revised.body.email.draftId).toBeNull();
    expect(revised.body.record.jobTitle).toBe('Senior Occupational Therapist');

    const dl = await agent.get(`${base}/offer/letter/download`).buffer().parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    const xml = await (await require('jszip').loadAsync(dl.body)).file('word/document.xml').async('string');
    expect(xml).toContain('Senior Occupational Therapist');
    expect(xml).toContain('$99,000 per annum');
  });

  test('an edited letter uploaded from Word is what gets attached, until it is discarded', async () => {
    const { agent } = await agentFor({ role: 'owner', email: 'owner@example.com' });
    const { record } = await start(agent);
    const base = `/api/onboarding/journey/records/${record.id}`;

    // A renamed non-Word file is refused.
    const bad = await agent.post(`${base}/offer/letter`).send({ fileName: 'letter.docx', fileMime: offerDocx.DOCX_MIME, fileData: Buffer.from('not a zip').toString('base64') });
    expect(bad.status).toBe(400);

    const edited = await offerDocx.buildOfferDocx({
      terms: { positionTitle: 'Occupational Therapist (edited in Word)', employmentType: 'part_time', startDate: '2026-11-02' },
      applicant: { name: 'Jane Smith', email: 'jane.smith@example.com' }, isTreatingTherapist: true,
    });
    const up = await agent.post(`${base}/offer/letter`).send({ fileName: 'LOO Jane edited.docx', fileMime: offerDocx.DOCX_MIME, fileData: edited.toString('base64') });
    expect(up.status).toBe(201);
    expect(up.body.letter.source).toBe('uploaded');
    expect(up.body.letter.uploaded.fileName).toBe('LOO Jane edited.docx');

    const createDraft = stubOutlook();
    await agent.post(`${base}/offer/email/draft`);
    expect(createDraft.mock.calls[0][0].attachmentName).toBe('LOO Jane edited.docx');
    const attached = await (await require('jszip').loadAsync(createDraft.mock.calls[0][0].attachment)).file('word/document.xml').async('string');
    expect(attached).toContain('(edited in Word)');

    const discarded = await agent.delete(`${base}/offer/letter`);
    expect(discarded.status).toBe(200);
    expect(discarded.body.letter.source).toBe('generated');
    expect(discarded.body.offer.status).toBe('draft'); // the draft carried the old letter
  });

  test('a declined offer blocks the stage, asks the Owner, and a revised letter is a new version', async () => {
    const { agent } = await agentFor({ role: 'owner', email: 'owner@example.com' });
    const { record } = await start(agent);
    const base = `/api/onboarding/journey/records/${record.id}`;
    await agent.post(`${base}/offer/mark-sent`);

    const decline = await agent.post(`${base}/offer/decline`).send({ reason: 'Accepted another role' });
    expect(decline.status).toBe(200);
    expect(decline.body.offer.status).toBe('declined');
    expect(decline.body.offer.declineReason).toBe('Accepted another role');
    expect(decline.body.record.status).toBe('created'); // nothing was released
    expect(decline.body.journey.stages[0].state).toBe('blocked');
    expect(decline.body.journey.next).toMatchObject({ actor: 'admin', action: 'reissue_offer' });

    const revised = await agent.put(`${base}/offer`).send({ terms: { ...START_BODY, positionTitle: 'Senior Occupational Therapist', payRate: 99000 } });
    expect(revised.status).toBe(200);
    expect(revised.body.offer).toMatchObject({ version: 2, status: 'draft' });
    expect(revised.body.offerHistory).toHaveLength(2);
    expect(revised.body.journey.stages[0].state).toBe('active');
  });

  test('a viewer can read the letter but cannot draft, mark sent, upload or verify', async () => {
    const { agent } = await agentFor({ role: 'owner', email: 'owner@example.com' });
    const { record } = await start(agent);
    const base = `/api/onboarding/journey/records/${record.id}`;
    const viewer = await agentFor({ role: 'admin', email: 'viewer@example.com', permissions: ['onboarding.view'] });
    expect((await viewer.agent.get(`${base}/offer/letter/download`)).status).toBe(200);
    expect((await viewer.agent.get(`${base}/offer/letter/download.pdf`)).status).toBe(200);
    expect((await viewer.agent.post(`${base}/offer/email/draft`)).status).toBe(403);
    expect((await viewer.agent.post(`${base}/offer/mark-sent`)).status).toBe(403);
    expect((await viewer.agent.post(`${base}/offer/signed`).send({ fileName: 'x.pdf', fileMime: 'application/pdf', fileData: 'JVBERg==' })).status).toBe(403);
    expect((await viewer.agent.post(`${base}/offer/verify`)).status).toBe(403);
  });

  test('skipping the letter prepares the document pack straight away', async () => {
    const { agent } = await agentFor({ role: 'owner', email: 'owner@example.com' });
    const { record } = await start(agent);
    const res = await agent.post(`/api/onboarding/journey/records/${record.id}/offer/skip`);
    expect(res.status).toBe(200);
    expect(res.body.offer.status).toBe('not_required');
    expect(res.body.prepared.status).toBe('prepared');
    expect(res.body.record.status).toBe('created');
    expect(res.body.journey.next.action).toBe('review_pack');
  });
});

describe('Stage 3 — the induction checklist, portal access as a task, and completion', () => {
  async function toReadyToActivate(agent) {
    const { record } = await start(agent);
    const base = `/api/onboarding/journey/records/${record.id}`;
    await agent.post(`${base}/offer/skip`);
    expect((await agent.post(`${base}/release`)).status).toBe(201);
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
    await agent.post(`/api/onboarding/journey/records/${b.record.id}/offer/mark-sent`);   // sent: waits on Bob

    const board = await agent.get('/api/onboarding/journey/board');
    expect(board.status).toBe(200);
    expect(board.body.summary).toMatchObject({ live: 2, needsYou: 1, waitingOnEmployee: 1, byStage: { offer: 2, documentation: 0, induction: 0 } });
    expect(board.body.records[0].id).toBe(a.record.id);
    expect(board.body.records[0].next.actor).toBe('admin');
    expect(board.body.records[1].next.actor).toBe('employee');
    expect(board.body.records.every((r) => r.stages.length === 3)).toBe(true);
  });
});
