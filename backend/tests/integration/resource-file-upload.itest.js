'use strict';

/**
 * Resource Hub file upload + preview delivery — the full pipeline against a
 * real database and a real (temporary) governed store: role gates, the
 * content-evidence privacy gate, magic-byte checks, content-addressed dedupe,
 * inline preview and thumbnail delivery, and quarantine behaviour.
 *
 * Test documents use invented example values only.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// The governed root must point at a temp dir BEFORE the storage module is
// first used by the routes. resource-file-storage reads the env per call, so
// setting it here (env.js has already loaded .env) is sufficient and keeps
// every write inside this test's sandbox.
const STORE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'opal-rh-upload-'));
process.env.RESOURCE_HUB_STORAGE_PATH = STORE_ROOT;

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const JSZip = require('jszip');

const { db, truncateAll, seedUser, seedOrganisation, closePool } = require('./helpers');

const PASSWORD = 'UploadPass1';

function buildApp() {
  const app = express();
  app.use(bodyParser.json({ limit: '36mb' }));
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../resource-hub-r2-routes'));
  return app;
}

async function agentFor(app, role, overrides = {}) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser({ password_hash: hash, role, ...overrides });
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user };
}

async function createDraft(agent, body) {
  const res = await agent.post('/api/rh2/resources').send({ title: 'Upload Target', ...body });
  expect(res.status).toBe(201);
  return res.body.resource;
}

/** Minimal but genuine DOCX (real zip, real document.xml). */
async function makeDocx(bodyText) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels',
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml',
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + `<w:body><w:p><w:r><w:t>${bodyText}</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

function uploadBody(buffer, fileName, format) {
  return { fileName, format, fileData: buffer.toString('base64') };
}

let app;
beforeAll(() => { app = buildApp(); });
beforeEach(async () => {
  await truncateAll();
  delete process.env.ENABLE_RESOURCE_HUB;
  require('../../auth')._resetLoginRateLimit();
});
afterAll(async () => {
  await closePool();
  fs.rmSync(STORE_ROOT, { recursive: true, force: true });
});

describe('upload gates', () => {
  test('a therapist cannot upload files', async () => {
    const owner = await agentFor(app, 'owner');
    const therapist = await agentFor(app, 'therapist',
      { organisation_id: owner.user.organisation_id });
    const resource = await createDraft(owner.agent, {});
    const clean = await makeDocx('Blank worksheet. Client Name: ____');
    const res = await therapist.agent
      .post(`/api/rh2/resources/${resource.id}/files`)
      .send(uploadBody(clean, 'w.docx', 'docx'));
    expect(res.status).toBe(403);
  });

  test('a file with populated client details is refused and never stored', async () => {
    const { agent } = await agentFor(app, 'owner');
    const resource = await createDraft(agent, {});
    const filled = await makeDocx('Support Plan. Client Name: Alex Sample. NDIS ID: 430001234');
    const res = await agent
      .post(`/api/rh2/resources/${resource.id}/files`)
      .send(uploadBody(filled, 'plan.docx', 'docx'));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('privacy_rejected');
    // Nothing stored: no row, no blob.
    const { rows } = await db.pool.query('SELECT 1 FROM resource_files WHERE resource_id = $1', [resource.id]);
    expect(rows.length).toBe(0);
    const blobs = fs.readdirSync(STORE_ROOT).filter((n) => n !== '.DS_Store');
    expect(blobs.length).toBe(0);
  });

  test('bytes that disagree with the declared format are refused', async () => {
    const { agent } = await agentFor(app, 'owner');
    const resource = await createDraft(agent, {});
    const res = await agent
      .post(`/api/rh2/resources/${resource.id}/files`)
      .send(uploadBody(Buffer.from('MZ\x90\x00 not a pdf'), 'report.pdf', 'pdf'));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('quality_rejected');
  });

  test('an unsupported format is refused up front', async () => {
    const { agent } = await agentFor(app, 'owner');
    const resource = await createDraft(agent, {});
    const res = await agent
      .post(`/api/rh2/resources/${resource.id}/files`)
      .send(uploadBody(Buffer.from('#!/bin/sh'), 'run.sh', 'sh'));
    expect(res.status).toBe(415);
  });
});

describe('storage and dedupe', () => {
  test('a clean blank template stores content-addressed with its checksum', async () => {
    const { agent } = await agentFor(app, 'owner');
    const resource = await createDraft(agent, {});
    const clean = await makeDocx('Emotion Zones Worksheet. Client Name: ____________');
    const res = await agent
      .post(`/api/rh2/resources/${resource.id}/files`)
      .send(uploadBody(clean, 'zones.docx', 'docx'));
    expect(res.status).toBe(201);
    expect(res.body.file.downloadUrl).toBe(`/api/rh2/files/${res.body.file.id}`);

    const { rows } = await db.pool.query(
      'SELECT storage_backend, storage_key, checksum_sha256, is_primary FROM resource_files WHERE id = $1',
      [res.body.file.id]);
    expect(rows[0].storage_backend).toBe('rhub');
    expect(rows[0].is_primary).toBe(true);
    expect(rows[0].storage_key)
      .toBe(`resources/${rows[0].checksum_sha256.slice(0, 2)}/${rows[0].checksum_sha256}.docx`);
    expect(fs.existsSync(path.join(STORE_ROOT, rows[0].storage_key))).toBe(true);
  });

  test('identical bytes on two resources share one physical blob', async () => {
    const { agent } = await agentFor(app, 'owner');
    const a = await createDraft(agent, { title: 'A' });
    const b = await createDraft(agent, { title: 'B' });
    const clean = await makeDocx('Shared worksheet content.');
    const r1 = await agent.post(`/api/rh2/resources/${a.id}/files`).send(uploadBody(clean, 'w.docx', 'docx'));
    const r2 = await agent.post(`/api/rh2/resources/${b.id}/files`).send(uploadBody(clean, 'w.docx', 'docx'));
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    const { rows } = await db.pool.query(
      'SELECT DISTINCT storage_key FROM resource_files WHERE resource_id IN ($1, $2)', [a.id, b.id]);
    expect(rows.length).toBe(1);
    // Exactly one blob on disk for that shared key. (The store root keeps
    // blobs from earlier tests — truncate wipes rows, not bytes — so the
    // assertion is scoped to this content hash, not the whole directory.)
    expect(fs.existsSync(path.join(STORE_ROOT, rows[0].storage_key))).toBe(true);
    const bucket = path.dirname(path.join(STORE_ROOT, rows[0].storage_key));
    const sha = path.basename(rows[0].storage_key).replace(/\.docx$/, '');
    expect(fs.readdirSync(bucket).filter((n) => n.startsWith(sha)).length).toBe(1);
  });
});

describe('delivery after upload', () => {
  test('the uploaded original downloads, previews inline, and respects quarantine', async () => {
    // File delivery requires a real organisation — the ladder refuses a NULL
    // org rather than treating it as a wildcard.
    const org = await seedOrganisation();
    const owner = await agentFor(app, 'owner', { organisation_id: org.id });
    const therapist = await agentFor(app, 'therapist', { organisation_id: org.id });
    const resource = await createDraft(owner.agent, {});
    const clean = await makeDocx('Deliverable worksheet.');
    const up = await owner.agent
      .post(`/api/rh2/resources/${resource.id}/files`)
      .send(uploadBody(clean, 'd.docx', 'docx'));
    expect(up.status).toBe(201);
    const fileId = up.body.file.id;

    const dl = await owner.agent.get(`/api/rh2/files/${fileId}`);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-disposition']).toMatch(/^attachment; /);

    const pv = await owner.agent.get(`/api/rh2/files/${fileId}/preview`);
    expect(pv.status).toBe(200);
    expect(pv.headers['content-disposition']).toMatch(/^inline; /);

    // A draft is author-only: the therapist gets the uniform 404 on all three.
    for (const suffix of ['', '/preview', '/thumbnail']) {
      const res = await therapist.agent.get(`/api/rh2/files/${fileId}${suffix}`);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Not found' });
    }

    // Quarantine: excluded-private serves nothing to anybody.
    await db.pool.query(
      `UPDATE resources SET publication_state = 'excluded-private', access_tier = 'excluded-private'
        WHERE id = $1`, [resource.id]);
    for (const suffix of ['', '/preview', '/thumbnail']) {
      const res = await owner.agent.get(`/api/rh2/files/${fileId}${suffix}`);
      expect(res.status).toBe(404);
    }
  });

  test('a quarantined resource refuses new uploads', async () => {
    const { agent } = await agentFor(app, 'owner');
    const resource = await createDraft(agent, {});
    await db.pool.query(
      `UPDATE resources SET publication_state = 'excluded-private', access_tier = 'excluded-private'
        WHERE id = $1`, [resource.id]);
    const clean = await makeDocx('Anything.');
    const res = await agent
      .post(`/api/rh2/resources/${resource.id}/files`)
      .send(uploadBody(clean, 'w.docx', 'docx'));
    expect(res.status).toBe(409);
  });
});
