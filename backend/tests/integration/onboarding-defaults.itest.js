'use strict';

/**
 * EDIT ONBOARDING — a package's default packs, tweaked once, inherited by
 * every new record for that package; records already started keep their own.
 */

const http = require('http');
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { db, truncateAll, seedUser, seedOrganisation, closePool } = require('./helpers');

jest.setTimeout(60000);
const PASSWORD = 'DefaultsPass1';

function buildApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use('/api/onboarding', bodyParser.json({ limit: '16mb' }));
  app.use(bodyParser.json({ limit: '10mb' }));
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false } }));
  for (const r of ['auth', 'app-routes', 'onboarding-employee-routes', 'onboarding-workflow-routes', 'onboarding-journey-routes', 'onboarding-pack-routes', 'onboarding-returns-routes', 'onboarding-payroll-routes', 'onboarding-defaults-routes', 'onboarding-assignment-routes', 'onboarding-library-routes', 'onboarding-routes']) {
    app.use('/', require(`../../${r}`));
  }
  return app;
}

let app; let server; let org;
let ipCounter = 0;
const nextIp = () => `10.5.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;

async function agentFor({ permissions, ...overrides } = {}) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser({ password_hash: hash, organisation_id: org.id, ...overrides });
  if (permissions) await db.pool.query('UPDATE users SET permissions = $2 WHERE id = $1', [user.id, JSON.stringify(permissions)]);
  const agent = request.agent(server);
  const res = await agent.post('/api/auth/login').set('X-Forwarded-For', nextIp()).send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user };
}

beforeAll(() => {
  process.env.ONBOARDING_ENCRYPTION_KEY = 'aa'.repeat(32);
  process.env.APP_BASE_URL = 'https://portal.test.invalid';
  app = buildApp(); server = http.createServer(app);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
});
afterAll(async () => { await new Promise((r) => server.close(r)); await closePool(); });
beforeEach(async () => {
  await truncateAll();
  require('../../auth')._resetLoginRateLimit();
  org = await seedOrganisation('Opal Therapy Test');
  await require('../../onboarding-seed').seedOnboarding({ organisationId: org.id });
});

describe('Edit onboarding', () => {
  test('lists the packages, walks the three phases, and a tweak reaches only new records of that package', async () => {
    const { agent } = await agentFor({ role: 'owner', email: 'owner@example.com' });
    const list = await agent.get('/api/onboarding/journey/defaults');
    expect(list.status).toBe(200);
    const titles = list.body.packages.map((p) => p.title);
    expect(titles).toEqual(expect.arrayContaining(['Occupational Therapist — Full-Time', 'Occupational Therapist — Casual', 'Administration — Permanent', 'Administration — Casual']));
    const otFull = list.body.packages.find((p) => p.code === 'PKG_OT_FULL_TIME');
    const adminPerm = list.body.packages.find((p) => p.code === 'PKG_ADMIN_PERMANENT');

    const d = await agent.get(`/api/onboarding/journey/defaults/${otFull.id}`);
    expect(d.status).toBe(200);
    expect(d.body.letter.previewUrl).toContain('/letter/preview.docx');
    expect(d.body.emails.offer.body).toContain('Hi Sample,');
    expect(d.body.emails.induction.subject).toBe('Opal Therapy Internal Induction Pack');
    const docCodes = d.body.phases.documentation.items.map((i) => i.code);
    expect(docCodes).toEqual(expect.arrayContaining(['PACK_CONTRACT', 'REQ_AHPRA', 'REQ_WWCC', 'PACK_FIRST_AID']));
    expect(d.body.phases.induction.items.map((i) => i.code)).toEqual(expect.arrayContaining(['IND_SPLOSE_SETUP', 'IND_PRIVACY_AGREEMENT']));
    // The sample letter renders for the package.
    const letter = await agent.get(d.body.letter.previewUrl);
    expect(letter.status).toBe(200);
    expect(letter.headers['content-type']).toMatch(/wordprocessingml/);

    // Tweak the OT full-time default: drop first aid, rename the contract, add a document.
    const removed = await agent.patch(`/api/onboarding/journey/defaults/${otFull.id}/items/PACK_FIRST_AID`).send({ phase: 'documentation', removed: true });
    expect(removed.status).toBe(200);
    expect(removed.body.items.find((i) => i.code === 'PACK_FIRST_AID').status).toBe('removed');
    const renamed = await agent.patch(`/api/onboarding/journey/defaults/${otFull.id}/items/PACK_CONTRACT`).send({ phase: 'documentation', title: 'Employment Contract', required: false });
    expect(renamed.body.items.find((i) => i.code === 'PACK_CONTRACT')).toMatchObject({ title: 'Employment Contract', required: false, tweaked: true });
    const lib = await agent.get('/api/onboarding/documents?audience=employee');
    const leave = lib.body.documents.find((x) => x.code === 'POL_LEAVE');
    const added = await agent.post(`/api/onboarding/journey/defaults/${otFull.id}/items`).send({ phase: 'documentation', documentId: leave.id, employeeReturns: false, required: false });
    expect(added.status).toBe(201);
    expect(added.body.items.some((i) => i.origin === 'added' && i.library && i.library.code === 'POL_LEAVE')).toBe(true);
    expect((await agent.get('/api/onboarding/journey/defaults')).body.packages.find((p) => p.id === otFull.id).tweaks).toBe(3);

    // A new OT full-time record inherits the tweak; an admin record does not.
    const start = async (body) => (await agent.post('/api/onboarding/journey/records').send(body)).body.record.id;
    const ot = await start({ name: 'Jane Smith', personalEmail: 'jane@example.com', position: 'Occupational Therapist', roleCategory: 'occupational_therapist', employmentType: 'full_time', isTreatingTherapist: true, mobileCommunityRole: true, usesOwnVehicle: true, childRelatedWork: 'yes', ndisRiskAssessedRole: 'yes', startDate: '2026-11-02' });
    const admin = await start({ name: 'Bob Brown', personalEmail: 'bob@example.com', position: 'Admin', roleCategory: 'administration', employmentType: 'full_time', isTreatingTherapist: false, startDate: '2026-11-02' });
    for (const id of [ot, admin]) await agent.post(`/api/onboarding/journey/records/${id}/offer/skip`);
    const otPack = (await agent.get(`/api/onboarding/journey/records/${ot}/pack`)).body.pack.items.filter((i) => i.status === 'included');
    expect(otPack.map((i) => i.code)).not.toContain('PACK_FIRST_AID');
    expect(otPack.find((i) => i.code === 'PACK_CONTRACT')).toMatchObject({ title: 'Employment Contract', required: false });
    expect(otPack.some((i) => i.library && i.library.code === 'POL_LEAVE')).toBe(true);
    const adminPack = (await agent.get(`/api/onboarding/journey/records/${admin}/pack`)).body.pack.items.filter((i) => i.status === 'included');
    expect(adminPack.find((i) => i.code === 'PACK_CONTRACT').title).toBe('Contract of Employment');
    expect(adminPack.some((i) => i.library && i.library.code === 'POL_LEAVE')).toBe(false);

    // Restoring the default clears the tweaks; the record already started keeps its copy.
    const restored = await agent.post(`/api/onboarding/journey/defaults/${otFull.id}/restore`).send({ phase: 'documentation' });
    expect(restored.body.items.find((i) => i.code === 'PACK_FIRST_AID').status).toBe('included');
    expect(restored.body.items.find((i) => i.code === 'PACK_CONTRACT').title).toBe('Contract of Employment');
    const still = (await agent.get(`/api/onboarding/journey/records/${ot}/pack`)).body.pack.items.find((i) => i.code === 'PACK_CONTRACT');
    expect(still.title).toBe('Employment Contract');

    // Upload the file behind a default that has none; it publishes to the library and reaches new records.
    const fresh = await agent.get(`/api/onboarding/journey/defaults/${otFull.id}`);
    const superItem = fresh.body.phases.documentation.items.find((i) => i.code === 'PACK_SUPER_CHOICE');
    // Records already prepared published the shipped Stage 2 file for it; the practice's upload replaces that.
    expect(superItem.file.previewUrl).toBeTruthy();
    const up = await agent.post(`/api/onboarding/journey/defaults/${otFull.id}/items/PACK_SUPER_CHOICE/file`).send({ phase: 'documentation', fileName: 'super-choice.pdf', fileMime: 'application/pdf', fileData: Buffer.from('%PDF-1.4 super').toString('base64') });
    expect(up.status).toBe(201);
    expect(up.body.items.find((i) => i.code === 'PACK_SUPER_CHOICE').file.previewUrl).toBeTruthy();
    // An added item with no library document gets one created for it.
    const newDoc = await agent.post(`/api/onboarding/journey/defaults/${otFull.id}/items`).send({ phase: 'documentation', title: 'Parking map' });
    const parking = newDoc.body.items.find((i) => i.title === 'Parking map');
    expect(parking.file.previewUrl).toBeNull();
    const up2 = await agent.post(`/api/onboarding/journey/defaults/${otFull.id}/items/${parking.code}/file`).send({ phase: 'documentation', fileName: 'parking.pdf', fileMime: 'application/pdf', fileData: Buffer.from('%PDF-1.4 map').toString('base64') });
    expect(up2.status).toBe(201);
    const parkingAfter = up2.body.items.find((i) => i.code === parking.code);
    expect(parkingAfter.library).toBeTruthy();
    expect(parkingAfter.file.previewUrl).toBeTruthy();
    const bytes = await agent.get(parkingAfter.file.previewUrl);
    expect(bytes.status).toBe(200);
    const later = await start({ name: 'Kim Lee', personalEmail: 'kim@example.com', position: 'OT', roleCategory: 'occupational_therapist', employmentType: 'full_time', isTreatingTherapist: true, startDate: '2026-11-02' });
    await agent.post(`/api/onboarding/journey/records/${later}/offer/skip`);
    const laterPack = (await agent.get(`/api/onboarding/journey/records/${later}/pack`)).body.pack.items;
    expect(laterPack.find((i) => i.code === 'PACK_SUPER_CHOICE').file.source).toBe('library');
    expect(laterPack.find((i) => i.title === 'Parking map').file.source).toBe('library');

    // A viewer can look but not tweak.
    const viewer = await agentFor({ role: 'admin', email: 'viewer@example.com', permissions: ['onboarding.view'] });
    expect((await viewer.agent.get(`/api/onboarding/journey/defaults/${adminPerm.id}`)).status).toBe(200);
    expect((await viewer.agent.patch(`/api/onboarding/journey/defaults/${adminPerm.id}/items/PACK_CONTRACT`).send({ phase: 'documentation', removed: true })).status).toBe(403);
  });
});
