'use strict';

/**
 * Audit-trail integration tests (Phase 8) — verifies that security-relevant
 * actions write correct audit rows (actor, action, target, sanitised
 * metadata) and that no secrets land in the audit table.
 */

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { db, truncateAll, seedUser, closePool } = require('./helpers');

const PASSWORD = 'AuditPass1';
const PDF_B64 = Buffer.from('%PDF-1.4 audit test').toString('base64');

function buildApp() {
  const app = express();
  app.use(bodyParser.json({ limit: '10mb' }));
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../profile-routes'));
  app.use('/', require('../../app-routes'));
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

async function auditRows(action) {
  const { rows } = await db.pool.query(
    'SELECT actor_user_id, action, target_type, target_id, metadata FROM audit_logs WHERE action = $1',
    [action]);
  return rows;
}

beforeEach(truncateAll);
afterAll(closePool);

describe('authentication audit', () => {
  test('login success and failure both audited with correct actor', async () => {
    const app = buildApp();
    const hash = await bcrypt.hash(PASSWORD, 4);
    const user = await seedUser({ password_hash: hash });

    await request(app).post('/api/auth/login').send({ email: user.email, password: 'WrongPass9' });
    await request(app).post('/api/auth/login').send({ email: user.email, password: PASSWORD });

    const failed = await auditRows('login_failed');
    expect(failed).toHaveLength(1);
    expect(failed[0].actor_user_id).toBe(user.id);
    expect(failed[0].metadata.reason).toBe('wrong_password');

    const ok = await auditRows('login_success');
    expect(ok).toHaveLength(1);
    expect(ok[0].actor_user_id).toBe(user.id);
  });

  test('no password material ever lands in audit_logs', async () => {
    const app = buildApp();
    const hash = await bcrypt.hash(PASSWORD, 4);
    const user = await seedUser({ password_hash: hash });
    await request(app).post('/api/auth/login').send({ email: user.email, password: 'S3cretProbe!' });

    const { rows } = await db.pool.query('SELECT metadata::text AS m, target_id FROM audit_logs');
    for (const r of rows) {
      expect(r.m || '').not.toContain('S3cretProbe');
      expect(r.target_id || '').not.toContain('S3cretProbe');
    }
  });
});

describe('org settings audit', () => {
  test('owner PATCH /api/settings/organisation writes org_settings.changed with keys only', async () => {
    const app = buildApp();
    const { agent, user } = await agentFor(app, { role: 'owner' });

    const res = await agent.patch('/api/settings/organisation')
      .send({ kilometreRate: 0.92, name: 'Opal Therapy' });
    expect(res.status).toBe(200);

    const rows = await auditRows('org_settings.changed');
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_user_id).toBe(user.id);
    expect(rows[0].metadata.changedKeys.sort()).toEqual(['kilometreRate', 'name']);
    // keys only — the audit row must not duplicate settings values
    expect(JSON.stringify(rows[0].metadata)).not.toContain('0.92');
  });
});

describe('document audit', () => {
  test('upload and delete are audited; cross-user download by admin is audited', async () => {
    process.env.DOCUMENT_STORAGE_BACKEND = 'db';
    const app = buildApp();
    const { agent: therapist, user: t } = await agentFor(app, { role: 'therapist' });
    const { agent: admin, user: a } = await agentFor(app, { role: 'admin' });

    const up = await therapist.post('/api/profile/documents')
      .send({ title: 'Cert', fileName: 'cert.pdf', fileMime: 'application/pdf', fileData: PDF_B64 });
    expect(up.status).toBe(201);
    const docId = up.body.document.id;

    const uploaded = await auditRows('document.uploaded');
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0].actor_user_id).toBe(t.id);
    expect(uploaded[0].target_id).toBe(docId);
    // metadata carries file metadata, never file content
    expect(JSON.stringify(uploaded[0].metadata)).not.toContain(PDF_B64.slice(0, 12));

    // Self-download: not audited (routine access to own file)
    await therapist.get(`/api/profile/documents/${docId}/download`);
    expect(await auditRows('document.downloaded')).toHaveLength(0);

    // Admin cross-user download: audited with document owner in metadata
    const dl = await admin.get(`/api/profile/documents/${docId}/download`);
    expect(dl.status).toBe(200);
    const downloaded = await auditRows('document.downloaded');
    expect(downloaded).toHaveLength(1);
    expect(downloaded[0].actor_user_id).toBe(a.id);
    expect(downloaded[0].metadata.documentOwnerUserId).toBe(t.id);

    await therapist.delete(`/api/profile/documents/${docId}`);
    const deleted = await auditRows('document.deleted');
    expect(deleted).toHaveLength(1);
    expect(deleted[0].actor_user_id).toBe(t.id);
    delete process.env.DOCUMENT_STORAGE_BACKEND;
  });
});

describe('credential verification audit', () => {
  test('owner verifying a credential writes credential.verified', async () => {
    const app = buildApp();
    const { agent: therapist } = await agentFor(app, { role: 'therapist' });
    const { agent: owner, user: o } = await agentFor(app, { role: 'owner' });

    const created = await therapist.post('/api/profile/credentials')
      .send({ credentialType: 'ahpra', credentialName: 'AHPRA Registration' });
    expect(created.status).toBe(201);
    const credId = created.body.credential.id;

    const verified = await owner.patch(`/api/profile/credentials/${credId}/verify`);
    expect(verified.status).toBe(200);

    const rows = await auditRows('credential.verified');
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_user_id).toBe(o.id);
    expect(rows[0].target_id).toBe(credId);
  });
});
