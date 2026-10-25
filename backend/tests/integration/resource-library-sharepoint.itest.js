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

// Thumbnails are generated in the background after an upload answers. Left
// running, that work races the next test's TRUNCATE and deadlocks it. Nothing
// here is about previews, so they are switched off for this suite.
beforeAll(() => {
  jest.spyOn(require('../../resource-preview-service'), 'ensureDerivatives')
    .mockResolvedValue({ results: [] });
});

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

// ═════════════════════════════════════════════════════════════════════════════
//  WHO MAY DO WHAT
// ═════════════════════════════════════════════════════════════════════════════

const fileCount = async (orgId) => (await db.pool.query(
  `SELECT COUNT(*)::int AS n FROM resource_files f JOIN resources r ON r.id = f.resource_id
    WHERE r.organisation_id = $1`, [orgId])).rows[0].n;

describe('roles — managed by Owner and Admin, enforced on the server', () => {
  let org; let owner; let folder; let doc;

  beforeEach(async () => {
    org = await seedOrganisation();
    owner = (await agentFor('owner', org.id)).agent;
    folder = await makeFolder(owner, 'Policies');
    const up = await upload(owner, folder.id, 'Code of conduct.pdf', samplePdf('conduct'));
    expect(up.status).toBe(201);
    doc = up.body.resource;
  });

  const mutations = () => [
    ['create folder', (a) => a.post('/api/rh2/library/folders').send({ name: 'Mine' })],
    ['rename folder', (a) => a.patch(`/api/rh2/library/folders/${folder.id}`).send({ name: 'Renamed' })],
    ['remove folder', (a) => a.delete(`/api/rh2/library/folders/${folder.id}`)],
    ['move', (a) => a.post('/api/rh2/library/move').send({ folderId: folder.id, resourceIds: [doc.id] })],
    ['rename document', (a) => a.patch(`/api/rh2/library/resources/${doc.id}`).send({ title: 'x' })],
    ['upload', (a) => upload(a, folder.id, 'x.pdf', samplePdf('x'))],
    ['replace', (a) => a.post(`/api/rh2/library/resources/${doc.id}/replace`).send({ fileName: 'y.pdf', fileData: samplePdf('y') })],
    ['restore version', (a) => a.post(`/api/rh2/library/resources/${doc.id}/versions/1/restore`).send({})],
    ['delete', (a) => a.post('/api/rh2/library/delete').send({ resourceIds: [doc.id] })],
    ['delete check', (a) => a.post('/api/rh2/library/delete-check').send({ resourceIds: [doc.id] })],
    ['list bin', (a) => a.get('/api/rh2/library/recycle-bin')],
    ['restore from bin', (a) => a.post('/api/rh2/library/recycle-bin/restore').send({ items: [{ kind: 'resource', id: doc.id }] })],
    ['purge', (a) => a.post('/api/rh2/library/recycle-bin/purge').send({ items: [{ kind: 'resource', id: doc.id }] })],
    ['empty bin', (a) => a.post('/api/rh2/library/recycle-bin/empty').send({})],
  ];

  it.each(['therapist', 'read_only'])('refuses every mutation to %s with 403, and changes nothing', async (role) => {
    const { agent } = await agentFor(role, org.id);
    for (const [label, call] of mutations()) {
      const res = await call(agent);
      expect([label, res.status]).toEqual([label, 403]);
    }
    const { rows } = await db.pool.query('SELECT title, deleted_at FROM resources WHERE id = $1', [doc.id]);
    expect(rows[0]).toEqual({ title: 'Code of conduct', deleted_at: null });
    expect(await fileCount(org.id)).toBe(1);
  });

  it(`lets ${'read_only'} and therapists browse and open, but not see the bin`, async () => {
    for (const role of ['therapist', 'read_only']) {
      const { agent } = await agentFor(role, org.id);
      const res = await agent.get(`/api/rh2/library/browse?folderId=${folder.id}`);
      expect(res.status).toBe(200);
      expect(res.body.documents.map((d) => d.title)).toEqual(['Code of conduct']);
      expect(res.body.canManage).toBe(false);
      expect((await agent.get(`/api/rh2/library/resources/${doc.id}/versions`)).status).toBe(200);
      expect((await agent.get(`/api/rh2/library/resources/${doc.id}/details`)).status).toBe(200);
    }
  });

  it('lets an admin do every management action, but not permanently delete', async () => {
    const { agent } = await agentFor('admin', org.id);
    expect((await agent.post('/api/rh2/library/folders').send({ name: 'Admin made' })).status).toBe(201);
    expect((await agent.patch(`/api/rh2/library/resources/${doc.id}`).send({ title: 'Conduct' })).status).toBe(200);
    expect((await upload(agent, folder.id, 'Leave.pdf', samplePdf('leave'))).status).toBe(201);
    expect((await agent.post(`/api/rh2/library/resources/${doc.id}/replace`)
      .send({ fileName: 'Conduct v2.pdf', fileData: samplePdf('v2') })).status).toBe(200);
    expect((await agent.post(`/api/rh2/library/resources/${doc.id}/versions/1/restore`).send({})).status).toBe(200);
    expect((await agent.post('/api/rh2/library/delete').send({ resourceIds: [doc.id] })).status).toBe(200);
    expect((await agent.get('/api/rh2/library/recycle-bin')).body.canPurge).toBe(false);
    expect((await agent.post('/api/rh2/library/recycle-bin/purge')
      .send({ items: [{ kind: 'resource', id: doc.id }] })).status).toBe(403);
    expect((await agent.post('/api/rh2/library/recycle-bin/empty').send({})).status).toBe(403);
    expect((await agent.post('/api/rh2/library/recycle-bin/restore')
      .send({ items: [{ kind: 'resource', id: doc.id }] })).status).toBe(200);
  });

  it('audits every mutation without document content', async () => {
    const pdf = samplePdf('audit marker');
    const up = await upload(owner, folder.id, 'Audited.pdf', pdf);
    await owner.patch(`/api/rh2/library/resources/${up.body.resource.id}`).send({ title: 'Audited 2' });
    await owner.post('/api/rh2/library/delete').send({ resourceIds: [up.body.resource.id] });
    await owner.post('/api/rh2/library/recycle-bin/restore')
      .send({ items: [{ kind: 'resource', id: up.body.resource.id }] });
    const { rows } = await db.pool.query(
      `SELECT action, metadata::text AS m FROM audit_logs WHERE action LIKE 'resource_library.%'`);
    const actions = rows.map((r) => r.action);
    for (const a of ['folder_created', 'file_uploaded', 'resource_renamed', 'resource_deleted', 'resource_restored']) {
      expect(actions).toContain(`resource_library.${a}`);
    }
    for (const r of rows) expect(r.m || '').not.toContain(pdf.slice(0, 40));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  FOLDERS: any depth, no cycles, unique names
// ═════════════════════════════════════════════════════════════════════════════

describe('nested folders', () => {
  let org; let agent;
  beforeEach(async () => {
    org = await seedOrganisation();
    ({ agent } = await agentFor('owner', org.id));
  });

  it('nests five deep and browses with a full breadcrumb and rolled-up counts', async () => {
    let parent = null;
    const chain = [];
    for (const name of ['A', 'B', 'C', 'D', 'E']) {
      parent = await makeFolder(agent, name, parent && parent.id);
      chain.push(parent);
    }
    expect((await upload(agent, chain[4].id, 'Deep.pdf', samplePdf('deep'))).status).toBe(201);
    const deep = await agent.get(`/api/rh2/library/browse?folderId=${chain[4].id}`);
    expect(deep.body.breadcrumb.map((b) => b.name)).toEqual(['A', 'B', 'C', 'D']);
    expect(deep.body.documents.map((d) => d.title)).toEqual(['Deep']);
    const top = await agent.get('/api/rh2/library/browse?folderId=root');
    expect(top.body.folders.find((f) => f.name === 'A').count).toBe(1);
    expect(top.body.documents).toEqual([]);
    // The legacy folder route agrees at any depth.
    const meta = await agent.get(`/api/rh2/library/folders/${chain[0].id}`);
    expect(meta.body.folder.count).toBe(1);
  });

  it('refuses to move a folder into itself or any descendant', async () => {
    const a = await makeFolder(agent, 'A');
    const b = await makeFolder(agent, 'B', a.id);
    const c = await makeFolder(agent, 'C', b.id);
    for (const target of [a.id, b.id, c.id]) {
      const viaMove = await agent.post('/api/rh2/library/move').send({ folderId: target, folderIds: [a.id] });
      expect(viaMove.status).toBe(400);
      expect(viaMove.body.code).toBe('folder_cycle');
      const viaPatch = await agent.patch(`/api/rh2/library/folders/${a.id}`).send({ parentId: target });
      expect(viaPatch.status).toBe(400);
      expect(viaPatch.body.code).toBe('folder_cycle');
    }
    // Moving the grandchild up to the top level is fine, and reports where it came from.
    const up = await agent.post('/api/rh2/library/move').send({ folderId: 'root', folderIds: [c.id] });
    expect(up.status).toBe(200);
    expect(up.body.previous.folders).toEqual([{ id: c.id, parentId: b.id }]);
  });

  it('keeps sibling names unique, case-insensitively, but allows the same name elsewhere', async () => {
    const a = await makeFolder(agent, 'Forms');
    const dup = await agent.post('/api/rh2/library/folders').send({ name: '  forms ' });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('folder_name_taken');
    const other = await makeFolder(agent, 'Clinical');
    expect((await agent.post('/api/rh2/library/folders').send({ name: 'Forms', parentId: other.id })).status).toBe(201);
    const nested = (await agent.get(`/api/rh2/library/browse?folderId=${other.id}`)).body.folders[0];
    const clash = await agent.post('/api/rh2/library/move').send({ folderId: 'root', folderIds: [nested.id] });
    expect(clash.status).toBe(409);
    const rename = await agent.patch(`/api/rh2/library/folders/${other.id}`).send({ name: 'FORMS' });
    expect(rename.status).toBe(409);
    expect(a.id).toBeTruthy();
  });

  it('moves several documents and folders at once and returns where they came from', async () => {
    const src = await makeFolder(agent, 'Source');
    const dst = await makeFolder(agent, 'Destination');
    const sub = await makeFolder(agent, 'Sub', src.id);
    const d1 = (await upload(agent, src.id, 'One.pdf', samplePdf('one'))).body.resource;
    const res = await agent.post('/api/rh2/library/move')
      .send({ folderId: dst.id, resourceIds: [d1.id], folderIds: [sub.id] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ documents: 1, folders: 1 });
    expect(res.body.previous.resources).toEqual([{ id: d1.id, folderId: src.id }]);
    const listed = await agent.get(`/api/rh2/library/browse?folderId=${dst.id}`);
    expect(listed.body.folders.map((f) => f.name)).toEqual(['Sub']);
    expect(listed.body.documents.map((d) => d.id)).toEqual([d1.id]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  DELETE → BIN → RESTORE
// ═════════════════════════════════════════════════════════════════════════════

describe('the recycle bin', () => {
  let org; let owner; let therapist;
  beforeEach(async () => {
    org = await seedOrganisation();
    owner = (await agentFor('owner', org.id)).agent;
    therapist = (await agentFor('therapist', org.id)).agent;
  });

  it('a deleted document disappears for everyone and comes back where it was', async () => {
    const folder = await makeFolder(owner, 'Handouts');
    const sub = await makeFolder(owner, 'Fine motor', folder.id);
    const up = await upload(owner, sub.id, 'Scissor skills.pdf', samplePdf('scissors'));
    const id = up.body.resource.id;
    const fileId = up.body.file.id;

    const del = await owner.post('/api/rh2/library/delete').send({ resourceIds: [id] });
    expect(del.status).toBe(200);
    expect((await therapist.get(`/api/rh2/library/browse?folderId=${sub.id}`)).body.documents).toEqual([]);
    expect((await owner.get(`/api/rh2/library/browse?folderId=${sub.id}`)).body.documents).toEqual([]);
    expect((await therapist.get(`/api/rh2/files/${fileId}`)).status).toBe(404);
    expect((await owner.get('/api/rh2/resources?q=Scissor')).body.resources).toEqual([]);

    const listing = await owner.get('/api/rh2/library/recycle-bin');
    expect(listing.body.items).toEqual([expect.objectContaining({
      kind: 'resource', id, name: 'Scissor skills', originalPath: ['Handouts', 'Fine motor'], daysLeft: 90,
    })]);

    const back = await owner.post('/api/rh2/library/recycle-bin/restore').send({ items: [{ kind: 'resource', id }] });
    expect(back.status).toBe(200);
    const after = await therapist.get(`/api/rh2/library/browse?folderId=${sub.id}`);
    expect(after.body.documents.map((d) => d.id)).toEqual([id]);
    const { rows } = await db.pool.query('SELECT status, publication_state, archived_at FROM resources WHERE id = $1', [id]);
    expect(rows[0]).toEqual({ status: 'approved', publication_state: 'approved', archived_at: null });
    expect((await owner.get('/api/rh2/library/recycle-bin')).body.items).toEqual([]);
  });

  it('a deleted folder takes its subtree with it and restores it whole', async () => {
    const top = await makeFolder(owner, 'Assessments');
    const mid = await makeFolder(owner, 'Paediatric', top.id);
    const leaf = await makeFolder(owner, 'Sensory', mid.id);
    const d1 = (await upload(owner, mid.id, 'Mid.pdf', samplePdf('mid'))).body.resource;
    const d2 = (await upload(owner, leaf.id, 'Leaf.pdf', samplePdf('leaf'))).body.resource;

    expect((await owner.post('/api/rh2/library/delete').send({ folderIds: [mid.id] })).status).toBe(200);
    const items = (await owner.get('/api/rh2/library/recycle-bin')).body.items;
    expect(items).toEqual([expect.objectContaining({
      kind: 'folder', id: mid.id, originalPath: ['Assessments'], documentCount: 2, folderCount: 1,
    })]);
    expect((await owner.get(`/api/rh2/library/browse?folderId=${top.id}`)).body.folders).toEqual([]);

    expect((await owner.post('/api/rh2/library/recycle-bin/restore')
      .send({ items: [{ kind: 'folder', id: mid.id }] })).status).toBe(200);
    const midView = await owner.get(`/api/rh2/library/browse?folderId=${mid.id}`);
    expect(midView.body.breadcrumb.map((b) => b.name)).toEqual(['Assessments']);
    expect(midView.body.folders.map((f) => f.name)).toEqual(['Sensory']);
    expect(midView.body.documents.map((d) => d.id)).toEqual([d1.id]);
    expect((await owner.get(`/api/rh2/library/browse?folderId=${leaf.id}`)).body.documents.map((d) => d.id))
      .toEqual([d2.id]);
  });

  it('restoring a document whose folder is also in the bin recreates the path', async () => {
    const top = await makeFolder(owner, 'HR');
    const sub = await makeFolder(owner, 'Leave', top.id);
    const d1 = (await upload(owner, sub.id, 'Leave form.pdf', samplePdf('leave'))).body.resource;
    const d2 = (await upload(owner, sub.id, 'Other.pdf', samplePdf('other'))).body.resource;
    await owner.post('/api/rh2/library/delete').send({ resourceIds: [d1.id] });
    await owner.post('/api/rh2/library/delete').send({ folderIds: [top.id] });

    const back = await owner.post('/api/rh2/library/recycle-bin/restore')
      .send({ items: [{ kind: 'resource', id: d1.id }] });
    expect(back.status).toBe(200);
    expect(back.body.restored.resources[0].path).toEqual(['HR', 'Leave']);
    const view = await owner.get(`/api/rh2/library/browse?folderId=${sub.id}`);
    expect(view.status).toBe(200);
    expect(view.body.documents.map((d) => d.id)).toEqual([d1.id]);
    // The rest of the folder's batch is still in the bin, now listed on its own.
    const items = (await owner.get('/api/rh2/library/recycle-bin')).body.items;
    expect(items.map((i) => i.id)).toEqual([d2.id]);
  });

  it('a deleted folder name can be reused, and restoring the old one keeps both', async () => {
    const f = await makeFolder(owner, 'Forms');
    await owner.post('/api/rh2/library/delete').send({ folderIds: [f.id] });
    await makeFolder(owner, 'Forms');
    await owner.post('/api/rh2/library/recycle-bin/restore').send({ items: [{ kind: 'folder', id: f.id }] });
    const names = (await owner.get('/api/rh2/library/browse?folderId=root')).body.folders.map((x) => x.name).sort();
    expect(names).toEqual(['Forms', 'Forms (2)']);
  });

  it('only the owner can permanently delete; bytes go only when nothing else uses them', async () => {
    const folder = await makeFolder(owner, 'Shared');
    const pdf = samplePdf('shared bytes');
    const a = (await upload(owner, folder.id, 'A.pdf', pdf)).body;
    const b = (await upload(owner, folder.id, 'B.pdf', pdf)).body; // same bytes, same blob
    const solo = (await upload(owner, folder.id, 'Solo.pdf', samplePdf('solo bytes'))).body;
    const key = async (fileId) => (await db.pool.query(
      'SELECT storage_key FROM resource_files WHERE id = $1', [fileId])).rows[0].storage_key;
    const sharedKey = await key(a.file.id);
    const soloKey = await key(solo.file.id);
    expect(await key(b.file.id)).toBe(sharedKey);

    await owner.post('/api/rh2/library/delete').send({ resourceIds: [a.resource.id, solo.resource.id] });
    const admin = (await agentFor('admin', org.id)).agent;
    expect((await admin.post('/api/rh2/library/recycle-bin/purge')
      .send({ items: [{ kind: 'resource', id: a.resource.id }] })).status).toBe(403);

    const res = await owner.post('/api/rh2/library/recycle-bin/purge')
      .send({ items: [{ kind: 'resource', id: a.resource.id }, { kind: 'resource', id: solo.resource.id }] });
    expect(res.status).toBe(200);
    expect(res.body.purged.resources).toBe(2);
    expect((await db.pool.query('SELECT 1 FROM resources WHERE id = ANY($1::uuid[])',
      [[a.resource.id, solo.resource.id]])).rows).toEqual([]);
    expect(fs.existsSync(path.join(STORE, sharedKey))).toBe(true); // B still uses it
    expect(fs.existsSync(path.join(STORE, soloKey))).toBe(false);
    expect((await owner.get(`/api/rh2/files/${b.file.id}`)).status).toBe(200);
  });

  it('purge ignores anything that is not in the bin', async () => {
    const folder = await makeFolder(owner, 'Live');
    const live = (await upload(owner, folder.id, 'Live.pdf', samplePdf('live'))).body.resource;
    const res = await owner.post('/api/rh2/library/recycle-bin/purge')
      .send({ items: [{ kind: 'resource', id: live.id }, { kind: 'folder', id: folder.id }] });
    expect(res.status).toBe(200);
    expect(res.body.purged).toMatchObject({ resources: 0, folders: 0 });
    expect((await owner.get(`/api/rh2/library/browse?folderId=${folder.id}`)).body.documents).toHaveLength(1);
  });

  it('empties the bin for the owner', async () => {
    const folder = await makeFolder(owner, 'Old');
    await upload(owner, folder.id, 'Old.pdf', samplePdf('old'));
    await owner.post('/api/rh2/library/delete').send({ folderIds: [folder.id] });
    const res = await owner.post('/api/rh2/library/recycle-bin/empty').send({});
    expect(res.status).toBe(200);
    expect(res.body.purged).toMatchObject({ resources: 1, folders: 1 });
    expect((await owner.get('/api/rh2/library/recycle-bin')).body.items).toEqual([]);
  });

  it('the scheduled purge removes only what has been in the bin 90 days', async () => {
    const recycle = require('../../resource-recycle-bin');
    const folder = await makeFolder(owner, 'Ageing');
    const old = (await upload(owner, folder.id, 'Old.pdf', samplePdf('aged'))).body.resource;
    const fresh = (await upload(owner, folder.id, 'Fresh.pdf', samplePdf('fresh'))).body.resource;
    await owner.post('/api/rh2/library/delete').send({ resourceIds: [old.id, fresh.id] });
    await db.pool.query(`UPDATE resources SET deleted_at = NOW() - INTERVAL '91 days' WHERE id = $1`, [old.id]);

    const result = await recycle.purgeExpired();
    expect(result.resources).toBe(1);
    const left = (await owner.get('/api/rh2/library/recycle-bin')).body.items.map((i) => i.id);
    expect(left).toEqual([fresh.id]);

    // Shift the clock instead of the data: 100 days from now, the rest is due.
    const later = await recycle.purgeExpired({ now: new Date(Date.now() + 100 * 24 * 3600 * 1000) });
    expect(later.resources).toBe(1);
    expect((await owner.get('/api/rh2/library/recycle-bin')).body.items).toEqual([]);
    // A live document is never touched by the job.
    expect((await owner.get(`/api/rh2/library/browse?folderId=${folder.id}`)).status).toBe(200);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  REPLACE → VERSIONS → RESTORE
// ═════════════════════════════════════════════════════════════════════════════

describe('versions', () => {
  it('replace is live at once, keeps history, and restore adds a version', async () => {
    const org = await seedOrganisation();
    const { agent: owner } = await agentFor('owner', org.id);
    const { agent: therapist } = await agentFor('therapist', org.id);
    const folder = await makeFolder(owner, 'Policies');
    const v1 = (await upload(owner, folder.id, 'Privacy.pdf', samplePdf('privacy v1'))).body;

    const rep = await owner.post(`/api/rh2/library/resources/${v1.resource.id}/replace`)
      .send({ fileName: 'Privacy 2026.pdf', fileData: samplePdf('privacy v2') });
    expect(rep.status).toBe(200);
    expect(rep.body.versionNo).toBe(2);

    // Live immediately for a therapist; the old file is not listed as a file.
    const listed = await therapist.get(`/api/rh2/library/browse?folderId=${folder.id}`);
    expect(listed.body.documents[0].file.fileName).toBe('Privacy 2026.pdf');
    expect(listed.body.documents[0].versionNo).toBe(2);
    const files = await therapist.get(`/api/rh2/resources/${v1.resource.id}/files`);
    expect(files.body.files.map((f) => f.fileName)).toEqual(['Privacy 2026.pdf']);

    let versions = (await therapist.get(`/api/rh2/library/resources/${v1.resource.id}/versions`)).body;
    expect(versions.versions.map((v) => [v.versionNo, v.fileName, v.isCurrent])).toEqual([
      [2, 'Privacy 2026.pdf', true], [1, 'Privacy.pdf', false]]);
    expect(versions.canRestore).toBe(false);
    // The previous version is still downloadable.
    expect((await therapist.get(versions.versions[1].downloadUrl)).status).toBe(200);

    const restore = await owner.post(`/api/rh2/library/resources/${v1.resource.id}/versions/1/restore`).send({});
    expect(restore.status).toBe(200);
    expect(restore.body.versionNo).toBe(3);
    versions = (await owner.get(`/api/rh2/library/resources/${v1.resource.id}/versions`)).body.versions;
    expect(versions.map((v) => [v.versionNo, v.fileName, v.action, v.restoredFrom])).toEqual([
      [3, 'Privacy.pdf', 'restore', 1], [2, 'Privacy 2026.pdf', 'replace', null], [1, 'Privacy.pdf', 'upload', null]]);
    const now = await therapist.get(`/api/rh2/library/browse?folderId=${folder.id}`);
    expect(now.body.documents[0].file.fileName).toBe('Privacy.pdf');
    // Restoring the current version again is refused.
    expect((await owner.post(`/api/rh2/library/resources/${v1.resource.id}/versions/3/restore`).send({})).status).toBe(409);
  });

  it('a privacy-rejected replacement leaves the current version untouched', async () => {
    const org = await seedOrganisation();
    const { agent: owner } = await agentFor('owner', org.id);
    const folder = await makeFolder(owner, 'Forms');
    const v1 = (await upload(owner, folder.id, 'Intake.pdf', samplePdf('blank intake'))).body;
    const quality = require('../../resource-file-quality');
    const spy = jest.spyOn(quality, 'assessFile').mockResolvedValueOnce({
      report: { privacy: { verdict: 'likely-pii' }, identifierFindings: [] }, failures: [], warnings: [],
    });
    try {
      const rep = await owner.post(`/api/rh2/library/resources/${v1.resource.id}/replace`)
        .send({ fileName: 'Intake.pdf', fileData: samplePdf('completed intake') });
      expect(rep.status).toBe(422);
      expect(rep.body.code).toBe('privacy_rejected');
    } finally { spy.mockRestore(); }
    const versions = (await owner.get(`/api/rh2/library/resources/${v1.resource.id}/versions`)).body.versions;
    expect(versions).toHaveLength(1);
  });

  it('existing documents upgrade to a version-1 row (migration 078 backfill)', async () => {
    const org = await seedOrganisation();
    const { agent: owner } = await agentFor('owner', org.id);
    const folder = await makeFolder(owner, 'Legacy');
    const up = (await upload(owner, folder.id, 'Legacy.pdf', samplePdf('legacy'))).body;
    // Simulate a pre-078 row: no version history at all.
    await db.pool.query('DELETE FROM resource_file_versions WHERE resource_id = $1', [up.resource.id]);
    const sql = fs.readFileSync(path.join(__dirname, '../../migrations/078_resource_file_versions.sql'), 'utf8');
    await db.pool.query(sql.slice(sql.indexOf('INSERT INTO resource_file_versions')));
    const versions = (await owner.get(`/api/rh2/library/resources/${up.resource.id}/versions`)).body.versions;
    expect(versions.map((v) => [v.versionNo, v.action, v.fileName])).toEqual([[1, 'initial', 'Legacy.pdf']]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  DUPLICATE NAMES
// ═════════════════════════════════════════════════════════════════════════════

describe('uploading a name that is already in the folder', () => {
  let agent; let folder; let first;
  beforeEach(async () => {
    const org = await seedOrganisation();
    ({ agent } = await agentFor('owner', org.id));
    folder = await makeFolder(agent, 'Reports');
    first = (await upload(agent, folder.id, 'Report.pdf', samplePdf('first'))).body;
  });

  it('asks first and stores nothing', async () => {
    const res = await upload(agent, folder.id, 'report.PDF', samplePdf('second'));
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'duplicate_name', existing: { id: first.resource.id }, suggestedName: 'report (2).PDF',
    });
    expect((await agent.get(`/api/rh2/library/browse?folderId=${folder.id}`)).body.documents).toHaveLength(1);
  });

  it('Replace makes it a new version of the same document', async () => {
    const res = await upload(agent, folder.id, 'Report.pdf', samplePdf('second'), { onConflict: 'replace' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ replaced: true, versionNo: 2, resource: { id: first.resource.id } });
    expect((await agent.get(`/api/rh2/library/browse?folderId=${folder.id}`)).body.documents).toHaveLength(1);
  });

  it('Keep both files it as "Name (2)"', async () => {
    const res = await upload(agent, folder.id, 'Report.pdf', samplePdf('second'), { onConflict: 'keepBoth' });
    expect(res.status).toBe(201);
    expect(res.body.renamedTo).toBe('Report (2).pdf');
    const third = await upload(agent, folder.id, 'Report.pdf', samplePdf('third'), { onConflict: 'keepBoth' });
    expect(third.body.renamedTo).toBe('Report (3).pdf');
    const titles = (await agent.get(`/api/rh2/library/browse?folderId=${folder.id}`)).body.documents.map((d) => d.title);
    expect(titles.sort()).toEqual(['Report', 'Report (2)', 'Report (3)']);
  });

  it('the same name in a different folder is not a duplicate', async () => {
    const other = await makeFolder(agent, 'Elsewhere');
    expect((await upload(agent, other.id, 'Report.pdf', samplePdf('x'))).status).toBe(201);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  LEARNING REFERENCES
// ═════════════════════════════════════════════════════════════════════════════

describe('deleting a document a learning workflow uses', () => {
  it('warns with the workflows, deletes on confirmation, and the player flags it removed', async () => {
    const org = await seedOrganisation();
    const { agent: owner } = await agentFor('owner', org.id);
    const folder = await makeFolder(owner, 'Induction');
    const doc = (await upload(owner, folder.id, 'Handbook.pdf', samplePdf('handbook'))).body.resource;
    const content = { sections: [{ key: 's1', title: 'Read', items: [
      { key: 'i1', type: 'resource', title: 'Handbook', resource_id: doc.id, required: true }] }] };
    const { rows } = await db.pool.query(
      `INSERT INTO learning_workflows (organisation_id, title, status, draft_content)
       VALUES ($1, 'New starter induction', 'active', $2) RETURNING id`, [org.id, content]);

    const check = await owner.post('/api/rh2/library/delete-check').send({ folderIds: [folder.id] });
    expect(check.body.workflows).toEqual([expect.objectContaining({ id: rows[0].id, title: 'New starter induction' })]);

    const first = await owner.post('/api/rh2/library/delete').send({ resourceIds: [doc.id] });
    expect(first.status).toBe(409);
    expect(first.body.code).toBe('in_use');
    expect(first.body.workflows[0].title).toBe('New starter induction');
    expect((await db.pool.query('SELECT deleted_at FROM resources WHERE id = $1', [doc.id])).rows[0].deleted_at).toBeNull();

    const confirmed = await owner.post('/api/rh2/library/delete').send({ resourceIds: [doc.id], confirm: true });
    expect(confirmed.status).toBe(200);

    // The learning API now marks the item as removed rather than linking it.
    const learningApp = express();
    applyBodyLimits(learningApp);
    learningApp.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false }));
    learningApp.use('/', require('../../auth'));
    learningApp.use('/', require('../../learning-routes'));
    const hash = await bcrypt.hash(PASSWORD, 4);
    const u = await seedUser({ password_hash: hash, role: 'owner', organisation_id: org.id });
    const la = request.agent(learningApp);
    await la.post('/api/auth/login').send({ email: u.email, password: PASSWORD });
    const wf = await la.get(`/api/learning/workflows/${rows[0].id}/preview`);
    expect(wf.status).toBe(200);
    const items = (wf.body.content || wf.body.workflow.content).sections[0].items;
    expect(items[0].resource_removed).toBe(true);
  });
});

describe('a privacy refusal: the checklist, and "upload anyway" for bare patterns only', () => {
  const builder = require('../../opal-document-builder');
  const textPdf = async (text) => (await builder.buildPdf({
    title: 'Example report', sections: [{ heading: 'Body', paragraphs: [text] }],
  })).toString('base64');
  // The shape of the 25 Oct 2026 wheelchair report: a business contact and a
  // session date, no client identifier at all.
  const PATTERNS_ONLY = 'Plan manager email: mail@example.com.au. Reviewed on 24/06/2026.';
  const WITH_NDIS = 'NDIS 430782072. Contact mail@example.com.au.';

  let agent; let folder;
  beforeEach(async () => {
    const org = await seedOrganisation();
    ({ agent } = await agentFor('owner', org.id));
    folder = await makeFolder(agent, 'Examples');
  });

  const docCount = async () => (await db.pool.query(
    `SELECT COUNT(*)::int AS n FROM resource_folder_assignments WHERE folder_id = $1`, [folder.id])).rows[0].n;

  it('refuses bare patterns with an overridable checklist, and stores nothing', async () => {
    const res = await upload(agent, folder.id, 'Example.pdf', await textPdf(PATTERNS_ONLY));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('privacy_rejected');
    expect(res.body.overridable).toBe(true);
    expect(res.body.reasons.map((r) => r.id).sort()).toEqual(['date', 'email']);
    expect(res.body.reasons.every((r) => r.type === 'pattern' && r.pages.length === 1)).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/mail@example|24\/06\/2026/);
    expect(await docCount()).toBe(0);
  });

  it('acknowledging only some items is still refused', async () => {
    const res = await upload(agent, folder.id, 'Example.pdf', await textPdf(PATTERNS_ONLY),
      { privacyAcknowledged: ['email'] });
    expect(res.status).toBe(422);
    expect(await docCount()).toBe(0);
  });

  it('acknowledging every item uploads it, and the override is audited without content', async () => {
    const res = await upload(agent, folder.id, 'Example.pdf', await textPdf(PATTERNS_ONLY),
      { privacyAcknowledged: ['email', 'date'] });
    expect(res.status).toBe(201);
    expect(res.body.privacyOverridden).toBe(true);
    expect(await docCount()).toBe(1);
    const { rows } = await db.pool.query(
      `SELECT target_id, metadata::text AS m FROM audit_logs
        WHERE action = 'resource_library.upload_privacy_overridden'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].target_id).toBe(res.body.resource.id);
    expect(rows[0].m).toMatch(/"email"/);
    expect(rows[0].m).not.toMatch(/mail@example|24\/06\/2026/);
  });

  it('a client identifier is never overridable, whatever is acknowledged', async () => {
    const res = await upload(agent, folder.id, 'Example.pdf', await textPdf(WITH_NDIS),
      { privacyAcknowledged: ['ndis-number', 'email', 'date', 'phone'] });
    expect(res.status).toBe(422);
    expect(res.body.overridable).toBe(false);
    expect(res.body.reasons[0]).toMatchObject({ id: 'ndis-number', type: 'personal' });
    expect(await docCount()).toBe(0);
    const { rows } = await db.pool.query(
      `SELECT 1 FROM audit_logs WHERE action = 'resource_library.upload_privacy_overridden'`);
    expect(rows).toHaveLength(0);
  });

  it('a replacement can be overridden the same way, and only the same way', async () => {
    const first = (await upload(agent, folder.id, 'Example.pdf', samplePdf('clean'))).body;
    const url = `/api/rh2/library/resources/${first.resource.id}/replace`;
    const data = await textPdf(PATTERNS_ONLY);
    const refused = await agent.post(url).send({ fileName: 'Example.pdf', fileData: data });
    expect(refused.status).toBe(422);
    expect(refused.body.overridable).toBe(true);
    const ok = await agent.post(url).send({ fileName: 'Example.pdf', fileData: data, privacyAcknowledged: ['date', 'email'] });
    expect(ok.status).toBe(200);
    expect(ok.body.privacyOverridden).toBe(true);
  });

  it('a therapist cannot upload at all, acknowledgement or not', async () => {
    const org = await seedOrganisation();
    const { agent: owner } = await agentFor('owner', org.id);
    const f = await makeFolder(owner, 'Theirs');
    const { agent: therapist } = await agentFor('therapist', org.id);
    const res = await upload(therapist, f.id, 'Example.pdf', await textPdf(PATTERNS_ONLY),
      { privacyAcknowledged: ['email', 'date'] });
    expect(res.status).toBe(403);
  });
});
