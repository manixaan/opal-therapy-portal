'use strict';

/**
 * Resource Hub R1 integration tests — RBAC, governance lifecycle, private
 * upload/download, favourites, therapist-visibility of approved-only.
 */

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { db, truncateAll, seedUser, closePool } = require('./helpers');

const PASSWORD = 'ResPass1';
const PDF_B64 = Buffer.from('%PDF-1.4 resource file').toString('base64');

function buildApp() {
  const app = express();
  app.use(bodyParser.json({ limit: '10mb' }));
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../resources-routes'));
  return app;
}

async function agentFor(app, role) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser({ password_hash: hash, role });
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user };
}

beforeEach(async () => { await truncateAll(); require('../../auth')._resetLoginRateLimit(); });
afterAll(closePool);

test('RBAC + governance lifecycle + private files', async () => {
  const app = buildApp();
  const { agent: owner } = await agentFor(app, 'owner');
  const { agent: therapist } = await agentFor(app, 'therapist');
  const { agent: ro } = await agentFor(app, 'read_only');

  // Unauthenticated denied
  expect((await request(app).get('/api/resources')).status).toBe(401);

  // Tags seeded by migration
  const tags = await owner.get('/api/resources/tags');
  expect(tags.body.tags.length).toBeGreaterThan(60);

  // Folder: therapist cannot create, owner can
  expect((await therapist.post('/api/resources/folders').send({ name: 'X' })).status).toBe(403);
  const folder = await owner.post('/api/resources/folders').send({ name: 'Handwriting' });
  expect(folder.status).toBe(201);

  // Therapist creates a DRAFT (forced), owner creates approved directly
  const draft = await therapist.post('/api/resources').send({ title: 'My worksheet' });
  expect(draft.status).toBe(201);
  expect(draft.body.resource.status).toBe('draft');
  const approvedRes = await owner.post('/api/resources').send({
    title: 'Pencil grip handout', status: 'approved', folderId: folder.body.folder.id, resourceType: 'Handout',
  });
  expect(approvedRes.body.resource.status).toBe('approved');
  expect(approvedRes.body.resource.review_due_at).toBeTruthy();

  // Therapist list shows ONLY approved (draft hidden)
  const tList = await therapist.get('/api/resources');
  expect(tList.body.resources.map(r => r.title)).toEqual(['Pencil grip handout']);
  // Owner can see drafts via status filter
  const oDrafts = await owner.get('/api/resources?status=draft');
  expect(oDrafts.body.resources.map(r => r.title)).toContain('My worksheet');
  // read_only sees approved list
  expect((await ro.get('/api/resources')).body.resources).toHaveLength(1);

  // Governance: submit → approve
  const draftId = draft.body.resource.id;
  expect((await therapist.post(`/api/resources/${draftId}/submit`)).status).toBe(200);
  expect((await therapist.post(`/api/resources/${draftId}/approve`)).status).toBe(403); // therapist cannot approve
  expect((await owner.post(`/api/resources/${draftId}/approve`)).status).toBe(200);
  const nowVisible = await therapist.get('/api/resources');
  expect(nowVisible.body.resources).toHaveLength(2);

  // Files: therapist cannot upload; owner can; bad type refused
  const rid = approvedRes.body.resource.id;
  expect((await therapist.post(`/api/resources/${rid}/files`).send({ fileName: 'a.pdf', fileMime: 'application/pdf', fileData: PDF_B64 })).status).toBe(403);
  expect((await owner.post(`/api/resources/${rid}/files`).send({ fileName: 'evil.exe', fileMime: 'application/x-msdownload', fileData: 'TVqQ' })).status).toBe(415);
  expect((await owner.post(`/api/resources/${rid}/files`).send({ fileName: 'handout.pdf', fileMime: 'application/pdf', fileData: PDF_B64 })).status).toBe(201);

  // Download: therapist OK on approved; 404 on garbage id; draft blocked pre-approval
  const dl = await therapist.get(`/api/resources/${rid}/download`);
  expect(dl.status).toBe(200);
  expect(dl.body.toString()).toContain('%PDF-1.4 resource');
  expect((await therapist.get('/api/resources/not-a-uuid/download')).status).toBe(404);

  // Favourite round trip
  expect((await therapist.post(`/api/resources/${rid}/favourite`)).status).toBe(200);
  const favList = await therapist.get('/api/resources');
  expect(favList.body.resources.find(r => r.id === rid).favourited).toBe(true);

  // Archive: owner only; archived leaves therapist view
  expect((await therapist.delete(`/api/resources/${rid}/archive`)).status).toBe(403);
  expect((await owner.delete(`/api/resources/${rid}/archive`)).status).toBe(200);
  const afterArchive = await therapist.get('/api/resources');
  expect(afterArchive.body.resources.find(r => r.id === rid)).toBeFalsy();

  // Audit rows exist, no file content inside
  const audit = await db.pool.query("SELECT action, metadata::text AS m FROM audit_logs WHERE action LIKE 'resource.%'");
  const actions = audit.rows.map(r => r.action);
  for (const a of ['resource.created', 'resource.approved', 'resource.file_uploaded', 'resource.downloaded', 'resource.favourited', 'resource.archived']) {
    expect(actions).toContain(a);
  }
  for (const r of audit.rows) expect(r.m || '').not.toContain(PDF_B64.slice(0, 12));
});

test('hub flag off → 403 for everyone', async () => {
  process.env.ENABLE_RESOURCE_HUB = 'false';
  const app = buildApp();
  const { agent: owner } = await agentFor(app, 'owner');
  const res = await owner.get('/api/resources');
  expect(res.status).toBe(403);
  expect(res.body.code).toBe('resource_hub_disabled');
  delete process.env.ENABLE_RESOURCE_HUB;
});
