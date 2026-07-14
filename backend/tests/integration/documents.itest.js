'use strict';

/**
 * Document storage abstraction integration tests (real DB + local backend).
 * Verifies upload → private download → cross-user block → delete, on both the
 * default db backend and the local filesystem backend.
 */

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { db, truncateAll, seedUser, closePool } = require('./helpers');

// A tiny valid base64 PDF header sample.
const PDF_B64 = Buffer.from('%PDF-1.4 test document body').toString('base64');
const PASSWORD = 'DocsPass1';

function buildApp() {
  const app = express();
  app.use(bodyParser.json({ limit: '10mb' }));
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../profile-routes'));
  return app;
}

async function agentFor(app, overrides) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser({ password_hash: hash, ...overrides });
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user };
}

beforeEach(truncateAll);
afterAll(closePool);

describe('db backend (default)', () => {
  test('upload → private download → cross-user 403 → delete', async () => {
    process.env.DOCUMENT_STORAGE_BACKEND = 'db';
    const app = buildApp();
    const { agent, user } = await agentFor(app);

    const up = await agent.post('/api/profile/documents')
      .send({ title: 'My Cert', fileName: 'cert.pdf', fileMime: 'application/pdf', fileData: PDF_B64 });
    expect(up.status).toBe(201);
    const docId = up.body.document.id;
    expect(up.body.document.storage_backend).toBe('db');

    const dl = await agent.get(`/api/profile/documents/${docId}/download`);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toContain('application/pdf');
    expect(dl.headers['content-disposition']).toContain('attachment');
    expect(dl.body.toString()).toContain('%PDF-1.4');

    // Another therapist cannot download it
    const { agent: other } = await agentFor(app);
    const blocked = await other.get(`/api/profile/documents/${docId}/download`);
    expect(blocked.status).toBe(403);

    const del = await agent.delete(`/api/profile/documents/${docId}`);
    expect(del.status).toBe(200);
    const gone = await agent.get(`/api/profile/documents/${docId}/download`);
    expect(gone.status).toBe(404);
    delete process.env.DOCUMENT_STORAGE_BACKEND;
  });

  test('owner can download another user document; executable upload refused', async () => {
    process.env.DOCUMENT_STORAGE_BACKEND = 'db';
    const app = buildApp();
    const { agent: therapist, user: t } = await agentFor(app, { role: 'therapist' });
    const { agent: owner } = await agentFor(app, { role: 'owner' });

    const up = await therapist.post('/api/profile/documents')
      .send({ title: 'Reg', fileName: 'reg.pdf', fileMime: 'application/pdf', fileData: PDF_B64 });
    const docId = up.body.document.id;

    const ownerDl = await owner.get(`/api/profile/documents/${docId}/download`);
    expect(ownerDl.status).toBe(200);

    const exe = await therapist.post('/api/profile/documents')
      .send({ title: 'bad', fileName: 'malware.exe', fileMime: 'application/x-msdownload', fileData: 'TVqQAAM=' });
    expect(exe.status).toBe(415);
    delete process.env.DOCUMENT_STORAGE_BACKEND;
  });
});

describe('local filesystem backend', () => {
  test('bytes are stored on disk (not in file_data) and download works', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opal-docs-'));
    process.env.DOCUMENT_STORAGE_BACKEND = 'local';
    process.env.DOCUMENT_STORAGE_PATH = dir;
    const app = buildApp();
    const { agent } = await agentFor(app);

    const up = await agent.post('/api/profile/documents')
      .send({ title: 'Local Cert', fileName: 'cert.pdf', fileMime: 'application/pdf', fileData: PDF_B64 });
    expect(up.status).toBe(201);
    expect(up.body.document.storage_backend).toBe('local');
    const docId = up.body.document.id;

    // file_data is cleared in the DB; the object lives on disk
    const { rows } = await db.pool.query('SELECT file_data, storage_key FROM pd_documents WHERE id=$1', [docId]);
    expect(rows[0].file_data).toBeNull();
    expect(rows[0].storage_key).toBeTruthy();
    expect(fs.existsSync(path.join(dir, rows[0].storage_key))).toBe(true);

    const dl = await agent.get(`/api/profile/documents/${docId}/download`);
    expect(dl.status).toBe(200);
    expect(dl.body.toString()).toContain('%PDF-1.4');

    await agent.delete(`/api/profile/documents/${docId}`);
    expect(fs.existsSync(path.join(dir, rows[0].storage_key))).toBe(false); // blob removed too

    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.DOCUMENT_STORAGE_BACKEND;
    delete process.env.DOCUMENT_STORAGE_PATH;
  });
});
