'use strict';

/**
 * RESOURCE LIBRARY AS A DOCUMENT LIBRARY — INTEGRATION
 *
 * The app here is built with the SERVER'S OWN body-limit chain
 * (body-limits.js applyBodyLimits), not a test-local parser. The two older
 * library suites mount a 32/36 MB global parser of their own, which is how an
 * upload route that 413'd every real file over ~75 kB passed its tests.
 */

const request = require('supertest');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const os = require('os');
const path = require('path');

const STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'opal-libsp-files-'));
process.env.RESOURCE_HUB_STORAGE_PATH = STORE;

const { db, truncateAll, seedUser, seedOrganisation, closePool } = require('./helpers');
const { applyBodyLimits } = require('../../body-limits');

const PASSWORD = 'LibSpPass123';

function buildApp() {
  const app = express();
  applyBodyLimits(app);
  app.use(session({
    secret: process.env.SESSION_SECRET, resave: false,
    saveUninitialized: false, cookie: { secure: false },
  }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../resource-hub-r2-routes'));
  app.use('/', require('../../resource-library-routes'));
  app.use('/', require('../../resources-routes'));
  return app;
}

const app = buildApp();

async function agentFor(role, orgId) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser({ password_hash: hash, role, organisation_id: orgId });
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user };
}

/** A structurally valid PDF with no client content; `padBytes` pads a comment. */
function samplePdf(marker = 'handwriting practice', padBytes = 0) {
  return Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n'
    + '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n'
    + `3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n% ${marker}\n`
    + (padBytes ? `% ${'x'.repeat(padBytes)}\n` : '')
    + 'trailer<</Root 1 0 R>>\n%%EOF').toString('base64');
}

async function makeFolder(agent, name, parentId) {
  const res = await agent.post('/api/rh2/library/folders')
    .send(parentId ? { name, parentId } : { name });
  expect(res.status).toBe(201);
  return res.body.folder;
}

async function upload(agent, folderId, fileName, fileData, extra = {}) {
  return agent.post(`/api/rh2/library/folders/${folderId}/upload`)
    .send({ fileName, fileData, ...extra });
}

beforeEach(async () => {
  await truncateAll();
  require('../../auth')._resetLoginRateLimit();
});

afterAll(async () => {
  require('../../auth')._resetLoginRateLimit();
  await closePool();
  fs.rmSync(STORE, { recursive: true, force: true });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('B1 — uploads through the real server body limit', () => {
  it('accepts a file over 1 MB into a folder', async () => {
    const org = await seedOrganisation();
    const { agent } = await agentFor('owner', org.id);
    const folder = await makeFolder(agent, 'Policies');
    const big = samplePdf('large policy', 1_200_000);
    expect(Buffer.from(big, 'base64').length).toBeGreaterThan(1024 * 1024);

    const res = await upload(agent, folder.id, 'Large policy.pdf', big);
    expect(res.status).toBe(201);
    expect(res.body.file.sizeBytes).toBeGreaterThan(1024 * 1024);
  });

  it('still keeps the small global default everywhere else', async () => {
    const org = await seedOrganisation();
    const { agent } = await agentFor('owner', org.id);
    // A 200 kB JSON body on a route outside the large-body subtrees.
    const res = await agent.post('/api/auth/login').send({ email: 'x'.repeat(200_000), password: 'y' });
    expect(res.status).toBe(413);
  });
});

describe('B2 — restoring an archived resource makes it live again', () => {
  it('clears archived_at when it leaves retired', async () => {
    const org = await seedOrganisation();
    const { agent } = await agentFor('owner', org.id);
    const folder = await makeFolder(agent, 'Handouts');
    const up = await upload(agent, folder.id, 'Pencil grip.pdf', samplePdf());
    expect(up.status).toBe(201);
    const id = up.body.resource.id;

    expect((await agent.post(`/api/rh2/resources/${id}/archive`).send({})).status).toBe(200);
    let row = (await db.pool.query('SELECT archived_at FROM resources WHERE id = $1', [id])).rows[0];
    expect(row.archived_at).not.toBeNull();

    const back = await agent.post(`/api/rh2/resources/${id}/governance-state`)
      .send({ toState: 'inventory', reason: 'Archived by mistake' });
    expect(back.status).toBe(200);
    row = (await db.pool.query('SELECT archived_at FROM resources WHERE id = $1', [id])).rows[0];
    expect(row.archived_at).toBeNull();

    // And the library can act on it again (the move scope requires archived_at IS NULL).
    const move = await agent.post('/api/rh2/library/move').send({ folderId: folder.id, resourceIds: [id] });
    expect(move.status).toBe(200);
  });
});

describe('B3 — a failed upload leaves no resource behind', () => {
  it('removes the shell when storage throws', async () => {
    const org = await seedOrganisation();
    const { agent } = await agentFor('owner', org.id);
    const folder = await makeFolder(agent, 'Forms');
    const storage = require('../../resource-file-storage');
    const spy = jest.spyOn(storage, 'putBuffer').mockRejectedValueOnce(new Error('disk full'));
    try {
      const res = await upload(agent, folder.id, 'Broken.pdf', samplePdf('unique storage failure'));
      expect(res.status).toBe(500);
    } finally {
      spy.mockRestore();
    }
    const { rows } = await db.pool.query(
      'SELECT COUNT(*)::int AS n FROM resources WHERE organisation_id = $1', [org.id]);
    expect(rows[0].n).toBe(0);
  });
});

describe('B8 — the legacy upload door is gone', () => {
  it('answers 404 for every role', async () => {
    const org = await seedOrganisation();
    const { agent } = await agentFor('owner', org.id);
    const { rows } = await db.pool.query(
      `INSERT INTO resources (organisation_id, title, status) VALUES ($1, 'Legacy', 'approved') RETURNING id`,
      [org.id]);
    const res = await agent.post(`/api/resources/${rows[0].id}/files`)
      .send({ fileName: 'a.pdf', fileMime: 'application/pdf', fileData: samplePdf() });
    expect(res.status).toBe(404);
  });
});
