'use strict';

/**
 * Regression tests for the infrastructure test-bench findings (D-2, D-3,
 * D-6, D-7, D-10). Each test pins a defect found by the adversarial bench:
 *
 *   D-2  read_only users could write business data (no server-side guard)
 *   D-3  non-UUID :id params returned 500 (Postgres cast error) instead of 404
 *   D-6  missing storage object returned 500 instead of a safe 404
 *   D-7  storage write failure left an orphaned metadata row
 *   D-10 denied cross-user document access was not audited
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

const PASSWORD = 'HardenPass1';
const PDF_B64 = Buffer.from('%PDF-1.4 hardening test').toString('base64');

function buildApp() {
  const app = express();
  app.use(bodyParser.json({ limit: '10mb' }));
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../profile-routes'));
  app.use('/', require('../../app-routes')); // change-password lives here
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

describe('D-2: read_only server-side write enforcement', () => {
  test('read_only cannot write business data but keeps auth endpoints and reads', async () => {
    const app = buildApp();
    const { agent: ro } = await agentFor(app, { role: 'read_only' });

    // Blocked: document upload
    const up = await ro.post('/api/profile/documents')
      .send({ title: 'x', fileName: 'x.pdf', fileMime: 'application/pdf', fileData: PDF_B64 });
    expect(up.status).toBe(403);

    // Blocked: credential creation
    const cred = await ro.post('/api/profile/credentials')
      .send({ credentialType: 'ahpra', credentialName: 'Reg' });
    expect(cred.status).toBe(403);

    // Allowed: reads
    const list = await ro.get('/api/profile/documents');
    expect(list.status).toBe(200);

    // Allowed: own auth endpoint (password change lives under /api/auth/)
    const pw = await ro.post('/api/auth/change-password')
      .send({ currentPassword: PASSWORD, newPassword: 'NewPassword77' });
    expect([200, 400]).toContain(pw.status); // route reachable, not 403
    expect(pw.status).not.toBe(403);
  });

  test('therapist writes remain unaffected by the guard', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app, { role: 'therapist' });
    const up = await agent.post('/api/profile/documents')
      .send({ title: 'ok', fileName: 'ok.pdf', fileMime: 'application/pdf', fileData: PDF_B64 });
    expect(up.status).toBe(201);
  });
});

describe('D-3: non-UUID route ids are a 404, not a 500', () => {
  test('download / delete / credential routes', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app, { role: 'therapist' });

    expect((await agent.get('/api/profile/documents/not-a-uuid/download')).status).toBe(404);
    expect((await agent.delete('/api/profile/documents/not-a-uuid')).status).toBe(404);
    expect((await agent.delete('/api/profile/credentials/12345')).status).toBe(404);

    const { agent: owner } = await agentFor(app, { role: 'owner' });
    expect((await owner.patch('/api/profile/credentials/zzz/verify')).status).toBe(404);
  });
});

describe('D-6/D-7: storage failure behaviour (local backend)', () => {
  test('missing storage object → 404; write failure → 5xx with NO orphaned row', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opal-harden-'));
    process.env.DOCUMENT_STORAGE_BACKEND = 'local';
    process.env.DOCUMENT_STORAGE_PATH = dir;
    const app = buildApp();
    const { agent } = await agentFor(app, { role: 'therapist' });

    // D-6: object deleted behind the app's back → safe 404
    const up = await agent.post('/api/profile/documents')
      .send({ title: 'L', fileName: 'l.pdf', fileMime: 'application/pdf', fileData: PDF_B64 });
    expect(up.status).toBe(201);
    const { rows } = await db.pool.query('SELECT storage_key FROM pd_documents WHERE id=$1', [up.body.document.id]);
    fs.unlinkSync(path.join(dir, rows[0].storage_key));
    const dl = await agent.get(`/api/profile/documents/${up.body.document.id}/download`);
    expect(dl.status).toBe(404);

    // D-7: unwritable storage → 5xx and the metadata row is rolled back
    fs.chmodSync(dir, 0o000);
    const fail = await agent.post('/api/profile/documents')
      .send({ title: 'ORPHAN-CHECK', fileName: 'o.pdf', fileMime: 'application/pdf', fileData: PDF_B64 });
    fs.chmodSync(dir, 0o755);
    expect(fail.status).toBeGreaterThanOrEqual(500);
    const orphans = await db.pool.query("SELECT COUNT(*) FROM pd_documents WHERE title='ORPHAN-CHECK'");
    expect(Number(orphans.rows[0].count)).toBe(0);

    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.DOCUMENT_STORAGE_BACKEND;
    delete process.env.DOCUMENT_STORAGE_PATH;
  });
});

describe('D-10: denied cross-user document access is audited', () => {
  test('403 download writes document.download_denied with both parties', async () => {
    process.env.DOCUMENT_STORAGE_BACKEND = 'db';
    const app = buildApp();
    const { agent: a, user: ua } = await agentFor(app, { role: 'therapist' });
    const { agent: b, user: ub } = await agentFor(app, { role: 'therapist' });

    const up = await a.post('/api/profile/documents')
      .send({ title: 'P', fileName: 'p.pdf', fileMime: 'application/pdf', fileData: PDF_B64 });
    const blocked = await b.get(`/api/profile/documents/${up.body.document.id}/download`);
    expect(blocked.status).toBe(403);

    const { rows } = await db.pool.query(
      "SELECT actor_user_id, metadata FROM audit_logs WHERE action='document.download_denied'");
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_user_id).toBe(ub.id);
    expect(rows[0].metadata.documentOwnerUserId).toBe(ua.id);
    delete process.env.DOCUMENT_STORAGE_BACKEND;
  });
});
