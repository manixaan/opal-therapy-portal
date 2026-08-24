'use strict';

/**
 * RESOURCE LIBRARY FOLDERS — INTEGRATION
 *
 * A filing cabinet the practice keeps by hand: the Owner makes folders, puts
 * documents in them, renames things and moves things. The properties asserted
 * here only exist once the routes, the database and the permission model are
 * all in play at once:
 *
 *   - Changing the structure is the Owner's. A therapist calling the API
 *     directly is refused; hiding the button is not the control.
 *   - One organisation's folders cannot be read, counted, or written to from
 *     another.
 *   - A file dropped on a folder lands in THAT folder, live, and a PDF or Word
 *     file carrying somebody's completed details is refused and never stored.
 *   - Removing a folder never destroys a document.
 *   - Search still spans the whole library; a folder narrows it only on
 *     request.
 */

const request = require('supertest');
const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Uploads go through the file-storage abstraction. Point it at a scratch
// directory BEFORE the modules load, so the suite never touches a real store.
const STORE = fs.mkdtempSync(path.join(os.tmpdir(), 'opal-lib-files-'));
process.env.RESOURCE_HUB_STORAGE_PATH = STORE;

const { db, truncateAll, seedUser, seedOrganisation, closePool } = require('./helpers');

const PASSWORD = 'LibPass123';

function buildApp() {
  const app = express();
  app.use(bodyParser.json({ limit: '32mb' }));
  app.use(session({
    secret: process.env.SESSION_SECRET, resave: false,
    saveUninitialized: false, cookie: { secure: false },
  }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../resource-hub-r2-routes'));
  app.use('/', require('../../resource-library-routes'));
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

/** A resource a therapist can actually browse. */
async function seedResource(orgId, over = {}) {
  const { rows } = await db.pool.query(
    `INSERT INTO resources
       (organisation_id, title, description, content_type, status,
        publication_state, access_tier, slug)
     VALUES ($1, $2, $3, $4, 'approved', 'approved', 'staff', $5)
     RETURNING *`,
    [orgId, over.title || 'Untitled', over.description || null,
      'content_type' in over ? over.content_type : 'download',
      over.slug || `r-${Math.random().toString(36).slice(2, 10)}`]);
  return rows[0];
}

/** Make a folder the way the Owner does. */
async function makeFolder(agent, name, parentId) {
  const res = await agent.post('/api/rh2/library/folders')
    .send(parentId ? { name, parentId } : { name });
  expect(res.status).toBe(201);
  return res.body.folder;
}

/** A structurally valid, tiny PDF with no client content in it. */
function samplePdf(marker = 'handwriting practice') {
  return Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n'
    + '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n'
    + `3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n% ${marker}\n`
    + 'trailer<</Root 1 0 R>>\n%%EOF').toString('base64');
}

/** A minimal zip, which is what an .xlsx looks like at the magic-byte level. */
function sampleXlsxLike() {
  return Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.alloc(64, 0x20),
  ]).toString('base64');
}

const folderNamed = (folders, name) => {
  for (const f of folders || []) {
    if (f.name === name) return f;
    for (const c of f.children || []) if (c.name === name) return c;
  }
  return null;
};

const listFolders = async (agent) => (await agent.get('/api/rh2/library/folders')).body.folders;

beforeEach(async () => {
  await truncateAll();
  // Many logins per file from one IP. The real limiter is 10 per 15 minutes
  // (auth.js); it is exercised deliberately elsewhere, not incidentally here.
  require('../../auth')._resetLoginRateLimit();
});

afterAll(async () => {
  require('../../auth')._resetLoginRateLimit();
  await closePool();
  fs.rmSync(STORE, { recursive: true, force: true });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('making folders', () => {
  it('creates a folder and a subfolder', async () => {
    const org = await seedOrganisation();
    const { agent } = await agentFor('owner', org.id);

    const top = await makeFolder(agent, 'Student Placements');
    const sub = await makeFolder(agent, 'Supervision Records', top.id);
    expect(sub.parent_id).toBe(top.id);

    const listed = await listFolders(agent);
    expect(folderNamed(listed, 'Student Placements')).toBeTruthy();
    expect(folderNamed(listed, 'Supervision Records')).toBeTruthy();
  });

  it('holds the hierarchy to two levels', async () => {
    const org = await seedOrganisation();
    const { agent } = await agentFor('owner', org.id);
    const top = await makeFolder(agent, 'Student Placements');
    const sub = await makeFolder(agent, 'Supervision Records', top.id);

    const third = await agent.post('/api/rh2/library/folders')
      .send({ name: 'Weekly Notes', parentId: sub.id });
    expect(third.status).toBe(400);
    expect(third.body.code).toBe('depth_limit');
  });

  it('refuses a name that means nothing', async () => {
    const org = await seedOrganisation();
    const { agent } = await agentFor('owner', org.id);
    for (const bad of ['Miscellaneous', 'Other Documents', 'CLINICAL_MISC_03', 'General Files 2', '']) {
      const res = await agent.post('/api/rh2/library/folders').send({ name: bad });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('invalid_folder_name');
    }
  });

  it('renames a folder, and the slug keeps working afterwards', async () => {
    const org = await seedOrganisation();
    const { agent } = await agentFor('owner', org.id);
    const made = await makeFolder(agent, 'Student Placements');

    expect((await agent.get(`/api/rh2/library/folders/${made.slug}`)).status).toBe(200);

    const renamed = await agent.patch(`/api/rh2/library/folders/${made.id}`)
      .send({ name: 'Placement Records' });
    expect(renamed.status).toBe(200);

    const still = await agent.get(`/api/rh2/library/folders/${made.slug}`);
    expect(still.status).toBe(200);
    expect(still.body.folder.name).toBe('Placement Records');
  });

  it('keeps an empty folder a person deliberately made', async () => {
    const org = await seedOrganisation();
    const { agent } = await agentFor('owner', org.id);
    const made = await makeFolder(agent, 'Student Placements');
    expect((await listFolders(agent)).find((f) => f.id === made.id)).toBeTruthy();
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('uploading into a folder', () => {
  let org; let agent; let folder;

  beforeEach(async () => {
    org = await seedOrganisation();
    const o = await agentFor('owner', org.id);
    agent = o.agent;
    folder = await makeFolder(agent, 'Handwriting Resources');
  });

  it('puts a PDF straight into the folder, live', async () => {
    const res = await agent.post(`/api/rh2/library/folders/${folder.id}/upload`)
      .send({ fileName: 'Letter Formation Practice.pdf', fileData: samplePdf() });
    expect(res.status).toBe(201);
    expect(res.body.folder).toBe('Handwriting Resources');
    expect(res.body.file.format).toBe('pdf');
    expect(res.body.privacyScanned).toBe(true);

    // Immediately visible to a therapist, which is what "live" has to mean.
    const therapist = await agentFor('therapist', org.id);
    const inFolder = await therapist.agent.get(`/api/rh2/resources?folderId=${folder.id}`);
    expect(inFolder.body.resources.map((r) => r.id)).toContain(res.body.resource.id);
  });

  it('names the document after the file, tidied', async () => {
    const res = await agent.post(`/api/rh2/library/folders/${folder.id}/upload`)
      .send({ fileName: 'pencil_grip-guide.pdf', fileData: samplePdf() });
    expect(res.status).toBe(201);
    expect(res.body.resource.title).toBe('pencil grip guide');
  });

  it('accepts an explicit title when one is given', async () => {
    const res = await agent.post(`/api/rh2/library/folders/${folder.id}/upload`)
      .send({ fileName: 'x.pdf', fileData: samplePdf(), title: 'Pencil Grip Guide' });
    expect(res.body.resource.title).toBe('Pencil Grip Guide');
  });

  it('takes Excel, and says plainly that it was not text-scanned', async () => {
    const res = await agent.post(`/api/rh2/library/folders/${folder.id}/upload`)
      .send({ fileName: 'Caseload Tracker.xlsx', fileData: sampleXlsxLike() });
    expect(res.status).toBe(201);
    expect(res.body.file.format).toBe('xlsx');
    // The honest half: Excel gets a file-type check, not a privacy scan.
    expect(res.body.privacyScanned).toBe(false);
  });

  it('decides the format from the name, not from what the caller claims', async () => {
    // A PDF body announced as a spreadsheet must not skip the PDF gate by
    // being renamed in the request body.
    const res = await agent.post(`/api/rh2/library/folders/${folder.id}/upload`)
      .send({ fileName: 'sneaky.xlsx', fileData: samplePdf(), format: 'pdf' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('quality_rejected');
  });

  it('refuses a file type the library does not take', async () => {
    const res = await agent.post(`/api/rh2/library/folders/${folder.id}/upload`)
      .send({ fileName: 'installer.exe', fileData: samplePdf() });
    expect(res.status).toBe(415);
    expect(res.body.code).toBe('unsupported_format');
  });

  it('refuses an empty file', async () => {
    const res = await agent.post(`/api/rh2/library/folders/${folder.id}/upload`)
      .send({ fileName: 'nothing.pdf', fileData: '' });
    expect(res.status).toBe(400);
  });

  it('leaves no half-made record behind when a file is refused', async () => {
    const before = await db.pool.query(
      'SELECT COUNT(*)::int AS n FROM resources WHERE organisation_id = $1', [org.id]);

    const rejected = await agent.post(`/api/rh2/library/folders/${folder.id}/upload`)
      .send({ fileName: 'broken.pdf', fileData: Buffer.from('not a pdf at all').toString('base64') });
    expect(rejected.status).toBe(422);

    // A resource with no document is worse than nothing: the route must undo
    // the row it created before the bytes were checked.
    const after = await db.pool.query(
      'SELECT COUNT(*)::int AS n FROM resources WHERE organisation_id = $1', [org.id]);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it('refuses to upload into another organisation\'s folder', async () => {
    const other = await seedOrganisation('Other Practice');
    const stranger = await agentFor('owner', other.id);
    const res = await stranger.agent.post(`/api/rh2/library/folders/${folder.id}/upload`)
      .send({ fileName: 'x.pdf', fileData: samplePdf() });
    expect(res.status).toBe(404);
  });

  it('counts the upload in the folder it went into', async () => {
    await agent.post(`/api/rh2/library/folders/${folder.id}/upload`)
      .send({ fileName: 'One.pdf', fileData: samplePdf('one') });
    await agent.post(`/api/rh2/library/folders/${folder.id}/upload`)
      .send({ fileName: 'Two.pdf', fileData: samplePdf('two') });

    expect(folderNamed(await listFolders(agent), 'Handwriting Resources').count).toBe(2);
  });

  it('records the upload in the audit trail', async () => {
    await agent.post(`/api/rh2/library/folders/${folder.id}/upload`)
      .send({ fileName: 'Audited.pdf', fileData: samplePdf() });
    const { rows } = await db.pool.query(
      "SELECT action FROM audit_logs WHERE organisation_id = $1 AND action LIKE 'resource_library%'",
      [org.id]);
    expect(rows.map((r) => r.action)).toContain('resource_library.file_uploaded');
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('renaming a document', () => {
  it('changes the title without asking for a change note', async () => {
    const org = await seedOrganisation();
    const { agent } = await agentFor('owner', org.id);
    const resource = await seedResource(org.id, { title: 'Scan 001' });

    const res = await agent.patch(`/api/rh2/library/resources/${resource.id}`)
      .send({ title: 'Pencil Grip Guide' });
    expect(res.status).toBe(200);
    expect(res.body.resource.title).toBe('Pencil Grip Guide');

    // A rename is filing, not editing: version history is untouched.
    const versions = await db.pool.query(
      'SELECT COUNT(*)::int AS n FROM resource_versions WHERE resource_id = $1', [resource.id]);
    expect(versions.rows[0].n).toBe(0);
  });

  it('refuses an empty name', async () => {
    const org = await seedOrganisation();
    const { agent } = await agentFor('owner', org.id);
    const resource = await seedResource(org.id);
    const res = await agent.patch(`/api/rh2/library/resources/${resource.id}`).send({ title: '  ' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('empty_title');
  });

  it('refuses a therapist, and another organisation', async () => {
    const org = await seedOrganisation();
    const other = await seedOrganisation('Other');
    await agentFor('owner', org.id);
    const therapist = await agentFor('therapist', org.id);
    const stranger = await agentFor('owner', other.id);
    const resource = await seedResource(org.id, { title: 'Mine' });

    expect((await therapist.agent.patch(`/api/rh2/library/resources/${resource.id}`)
      .send({ title: 'Theirs' })).status).toBe(403);
    expect((await stranger.agent.patch(`/api/rh2/library/resources/${resource.id}`)
      .send({ title: 'Theirs' })).status).toBe(404);

    const { rows } = await db.pool.query('SELECT title FROM resources WHERE id = $1', [resource.id]);
    expect(rows[0].title).toBe('Mine');
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('moving documents by hand', () => {
  let org; let agent; let a; let b; let docs;

  beforeEach(async () => {
    org = await seedOrganisation();
    const o = await agentFor('owner', org.id);
    agent = o.agent;
    a = await makeFolder(agent, 'Assessments');
    b = await makeFolder(agent, 'Therapy Resources');
    docs = [await seedResource(org.id, { title: 'One' }), await seedResource(org.id, { title: 'Two' })];
  });

  it('moves several at once and counts them where they landed', async () => {
    const res = await agent.post('/api/rh2/library/move')
      .send({ folderId: a.id, resourceIds: docs.map((d) => d.id) });
    expect(res.status).toBe(200);
    expect(res.body.moved).toBe(2);

    const listed = await listFolders(agent);
    expect(folderNamed(listed, 'Assessments').count).toBe(2);
    expect(folderNamed(listed, 'Therapy Resources').count).toBe(0);
  });

  it('moves a document from one folder to another', async () => {
    await agent.post('/api/rh2/library/move').send({ folderId: a.id, resourceIds: [docs[0].id] });
    await agent.post('/api/rh2/library/move').send({ folderId: b.id, resourceIds: [docs[0].id] });

    const { rows } = await db.pool.query(
      'SELECT folder_id FROM resource_folder_assignments WHERE resource_id = $1', [docs[0].id]);
    expect(rows[0].folder_id).toBe(b.id);
  });

  it('records the move in the audit trail', async () => {
    await agent.post('/api/rh2/library/move').send({ folderId: a.id, resourceIds: [docs[0].id] });
    const { rows } = await db.pool.query(
      "SELECT action FROM audit_logs WHERE organisation_id = $1 AND action LIKE 'resource_library%'",
      [org.id]);
    expect(rows.map((r) => r.action)).toContain('resource_library.resources_moved');
  });

  it('refuses to move another organisation\'s document', async () => {
    const theirs = await seedOrganisation('Theirs');
    const foreign = await seedResource(theirs.id, { title: 'Their Policy' });
    const res = await agent.post('/api/rh2/library/move')
      .send({ folderId: a.id, resourceIds: [foreign.id] });
    expect(res.status).toBe(404);
    const { rows } = await db.pool.query(
      'SELECT 1 FROM resource_folder_assignments WHERE resource_id = $1', [foreign.id]);
    expect(rows).toHaveLength(0);
  });

  it('refuses an unknown folder', async () => {
    const res = await agent.post('/api/rh2/library/move')
      .send({ folderId: '00000000-0000-0000-0000-000000000000', resourceIds: [docs[0].id] });
    expect(res.status).toBe(404);
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('removing a folder never loses a document', () => {
  it('sends its documents to Needs Review, creating that folder if needed', async () => {
    const org = await seedOrganisation();
    const { agent } = await agentFor('owner', org.id);
    const folder = await makeFolder(agent, 'Old Policies');
    const doc = await seedResource(org.id, { title: 'Superseded Policy' });
    await agent.post('/api/rh2/library/move').send({ folderId: folder.id, resourceIds: [doc.id] });

    const before = await db.pool.query(
      'SELECT COUNT(*)::int AS n FROM resources WHERE organisation_id = $1', [org.id]);

    const res = await agent.delete(`/api/rh2/library/folders/${folder.id}`);
    expect(res.status).toBe(200);
    expect(res.body.movedToReview).toBe(1);

    const after = await db.pool.query(
      'SELECT COUNT(*)::int AS n FROM resources WHERE organisation_id = $1', [org.id]);
    expect(after.rows[0].n).toBe(before.rows[0].n);

    const listed = await listFolders(agent);
    expect(folderNamed(listed, 'Old Policies')).toBeNull();
    expect(folderNamed(listed, 'Needs Review').count).toBe(1);
  });

  it('will not remove Needs Review itself', async () => {
    const org = await seedOrganisation();
    const { agent } = await agentFor('owner', org.id);
    const folder = await makeFolder(agent, 'Old Policies');
    const doc = await seedResource(org.id);
    await agent.post('/api/rh2/library/move').send({ folderId: folder.id, resourceIds: [doc.id] });
    await agent.delete(`/api/rh2/library/folders/${folder.id}`);

    const review = folderNamed(await listFolders(agent), 'Needs Review');
    const res = await agent.delete(`/api/rh2/library/folders/${review.id}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('review_bucket_fixed');
  });

  it('hides Needs Review while it is empty', async () => {
    const org = await seedOrganisation();
    const { agent } = await agentFor('owner', org.id);
    await makeFolder(agent, 'Assessments');
    expect(folderNamed(await listFolders(agent), 'Needs Review')).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('permissions', () => {
  let org; let ownerAgent; let therapist; let folder;

  beforeEach(async () => {
    org = await seedOrganisation();
    const owner = await agentFor('owner', org.id);
    ownerAgent = owner.agent;
    folder = await makeFolder(ownerAgent, 'Assessments');
    therapist = await agentFor('therapist', org.id);
  });

  it('lets a therapist browse the folders', async () => {
    const res = await therapist.agent.get('/api/rh2/library/folders');
    expect(res.status).toBe(200);
    expect(res.body.folders.length).toBeGreaterThan(0);
  });

  it('refuses every structural route to a therapist', async () => {
    const doc = await seedResource(org.id);
    // Sequential: a burst of concurrent supertest requests drops connections,
    // and a dropped request leaves a transaction open that deadlocks the next
    // truncate — an artefact that reads exactly like a routing bug.
    const calls = [
      () => therapist.agent.post('/api/rh2/library/folders').send({ name: 'Mine' }),
      () => therapist.agent.patch(`/api/rh2/library/folders/${folder.id}`).send({ name: 'Renamed' }),
      () => therapist.agent.delete(`/api/rh2/library/folders/${folder.id}`),
      () => therapist.agent.post('/api/rh2/library/move').send({ folderId: folder.id, resourceIds: [doc.id] }),
      () => therapist.agent.patch(`/api/rh2/library/resources/${doc.id}`).send({ title: 'x' }),
      () => therapist.agent.post(`/api/rh2/library/folders/${folder.id}/upload`)
        .send({ fileName: 'x.pdf', fileData: samplePdf() }),
    ];
    for (const call of calls) {
      const res = await call();
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('library_structure_forbidden');
    }
  });

  it('refuses an admin too — the structure is the Owner\'s alone', async () => {
    const admin = await agentFor('admin', org.id);
    expect((await admin.agent.post('/api/rh2/library/folders').send({ name: 'Theirs' })).status).toBe(403);
  });

  it('does not leak another organisation\'s folders or counts', async () => {
    const other = await seedOrganisation('Other Practice');
    const stranger = await agentFor('owner', other.id);

    const res = await stranger.agent.get('/api/rh2/library/folders');
    expect(res.body.folders).toHaveLength(0);
    expect(res.body.totalResources).toBe(0);

    expect((await stranger.agent.get(`/api/rh2/library/folders/${folder.id}`)).status).toBe(404);
    expect((await stranger.agent.patch(`/api/rh2/library/folders/${folder.id}`)
      .send({ name: 'Hijacked' })).status).toBe(404);
  });
});

// ═════════════════════════════════════════════════════════════════════════════

/**
 * THE DESTINATION IS THE SERVER'S TO DECIDE.
 *
 * The Library workspace now offers three ways to put something in a folder —
 * drag a file onto the page, pick Upload from the right-click menu, or start a
 * New document and let it be filed where it was started. All three send a
 * folder id the browser chose, so what matters is that the browser choosing a
 * different one buys nothing.
 *
 * These pin the refusals for a caller who edits the id before it is sent:
 * another organisation's folder, a folder that is not a folder, and a role
 * that may author a resource but may not file one.
 */
describe('a folder id the client picked is still checked', () => {
  let org; let owner; let folder;

  beforeEach(async () => {
    org = await seedOrganisation();
    owner = (await agentFor('owner', org.id)).agent;
    folder = await makeFolder(owner, 'Assessments');
  });

  it('refuses a move into another organisation\'s folder', async () => {
    const theirs = await seedOrganisation('Theirs');
    const theirOwner = (await agentFor('owner', theirs.id)).agent;
    const theirFolder = await makeFolder(theirOwner, 'Their Assessments');
    const mine = await seedResource(org.id, { title: 'Mine' });

    const res = await owner.post('/api/rh2/library/move')
      .send({ folderId: theirFolder.id, resourceIds: [mine.id] });
    expect(res.status).toBe(404);

    const { rows } = await db.pool.query(
      'SELECT 1 FROM resource_folder_assignments WHERE resource_id = $1', [mine.id]);
    expect(rows).toHaveLength(0);
  });

  it('refuses an upload into another organisation\'s folder, and stores nothing', async () => {
    const theirs = await seedOrganisation('Theirs');
    const theirOwner = (await agentFor('owner', theirs.id)).agent;
    const theirFolder = await makeFolder(theirOwner, 'Their Assessments');

    const res = await owner.post(`/api/rh2/library/folders/${theirFolder.id}/upload`)
      .send({ fileName: 'worksheet.pdf', fileData: samplePdf() });
    expect(res.status).toBe(404);

    const { rows } = await db.pool.query(
      "SELECT 1 FROM resources WHERE title = 'worksheet'");
    expect(rows).toHaveLength(0);
  });

  it('refuses a folder id that is not a uuid rather than reading it', async () => {
    // A path segment is not a path: '../../etc/passwd' is a 404, not a lookup.
    for (const bad of ['..', '../../etc/passwd', 'null', '1 OR 1=1']) {
      const up = await owner.post(`/api/rh2/library/folders/${encodeURIComponent(bad)}/upload`)
        .send({ fileName: 'x.pdf', fileData: samplePdf() });
      expect(up.status).toBe(404);
    }
    const mv = await owner.post('/api/rh2/library/move')
      .send({ folderId: '../../etc/passwd', resourceIds: [(await seedResource(org.id)).id] });
    expect(mv.status).toBe(400);
  });

  it('lets an admin author a resource but not file one', async () => {
    // The New document flow is create-then-file. An admin may do the first
    // half (POST /api/rh2/resources) and must be refused the second, because
    // filing is a change to the library's structure.
    const admin = (await agentFor('admin', org.id)).agent;
    const created = await admin.post('/api/rh2/resources')
      .send({ title: 'Sensory Diet Handout', contentType: 'guide', content: '## Notes' });
    expect(created.status).toBe(201);
    const id = (created.body.resource || created.body).id;

    const filed = await admin.post('/api/rh2/library/move')
      .send({ folderId: folder.id, resourceIds: [id] });
    expect(filed.status).toBe(403);
    expect(filed.body.code).toBe('library_structure_forbidden');

    const { rows } = await db.pool.query(
      'SELECT 1 FROM resource_folder_assignments WHERE resource_id = $1', [id]);
    expect(rows).toHaveLength(0);
  });

  it('files an owner\'s new document into the folder it was started from', async () => {
    // The whole New document chain, end to end, as the client performs it.
    const created = await owner.post('/api/rh2/resources')
      .send({ title: 'Handwriting Warm Ups', contentType: 'guide', content: '## Warm ups' });
    expect(created.status).toBe(201);
    const id = (created.body.resource || created.body).id;

    const filed = await owner.post('/api/rh2/library/move')
      .send({ folderId: folder.id, resourceIds: [id] });
    expect(filed.status).toBe(200);
    expect(filed.body.folder).toBe('Assessments');

    const { rows } = await db.pool.query(
      'SELECT folder_id, manual_lock FROM resource_folder_assignments WHERE resource_id = $1', [id]);
    expect(rows[0].folder_id).toBe(folder.id);
    expect(rows[0].manual_lock).toBe(true);
  });

  it('refuses an upload to a therapist even when the folder is their own organisation\'s', async () => {
    const therapist = (await agentFor('therapist', org.id)).agent;
    const res = await therapist.post(`/api/rh2/library/folders/${folder.id}/upload`)
      .send({ fileName: 'worksheet.pdf', fileData: samplePdf() });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('library_structure_forbidden');

    const { rows } = await db.pool.query('SELECT 1 FROM resource_files');
    expect(rows).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('browsing, search and deep links', () => {
  let org; let agent; let policies; let therapy; let sub; let therapyDocs;

  beforeEach(async () => {
    org = await seedOrganisation();
    const o = await agentFor('owner', org.id);
    agent = o.agent;
    policies = await makeFolder(agent, 'Policies');
    therapy = await makeFolder(agent, 'Therapy Resources');
    sub = await makeFolder(agent, 'Handwriting', therapy.id);

    const policyDoc = await seedResource(org.id, { title: 'Professional Boundaries Policy' });
    therapyDocs = [
      await seedResource(org.id, { title: 'Letter Formation Sheet' }),
      await seedResource(org.id, { title: 'Pencil Grip Guide' }),
    ];
    await agent.post('/api/rh2/library/move').send({ folderId: policies.id, resourceIds: [policyDoc.id] });
    await agent.post('/api/rh2/library/move').send({ folderId: sub.id, resourceIds: therapyDocs.map((d) => d.id) });
  });

  it('keeps search global — a folder narrows only when asked', async () => {
    const global = await agent.get('/api/rh2/resources?q=Boundaries');
    expect(global.body.resources.length).toBeGreaterThan(0);

    const scoped = await agent.get(`/api/rh2/resources?q=Boundaries&folderId=${sub.id}`);
    expect(scoped.body.resources).toHaveLength(0);

    const right = await agent.get(`/api/rh2/resources?q=Boundaries&folderId=${policies.id}`);
    expect(right.body.resources.length).toBeGreaterThan(0);
  });

  it('rejects a malformed folder filter rather than returning everything', async () => {
    const res = await agent.get('/api/rh2/resources?folderId=not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body.parameter).toBe('folderId');
  });

  it('a parent folder shows its subfolders\' documents too', async () => {
    const flat = await agent.get(`/api/rh2/resources?folderId=${therapy.id}`);
    const tree = await agent.get(`/api/rh2/resources?folderId=${therapy.id}&folderScope=tree`);
    expect(flat.body.resources).toHaveLength(0);
    expect(tree.body.resources).toHaveLength(2);
  });

  it('rolls a subfolder\'s count up to its parent', async () => {
    const parent = folderNamed(await listFolders(agent), 'Therapy Resources');
    expect(parent.count).toBe(2);
    expect(parent.directCount).toBe(0);
  });

  it('gives a subfolder a breadcrumb trail', async () => {
    const res = await agent.get(`/api/rh2/library/folders/${sub.id}`);
    expect(res.body.breadcrumb.map((b) => b.id)).toEqual([therapy.id]);
  });

  it('an existing document URL still works after filing', async () => {
    expect((await agent.get(`/api/rh2/resources/${therapyDocs[0].slug}`)).status).toBe(200);
  });

  it('counts what THIS reader can open, not what exists', async () => {
    const hidden = await seedResource(org.id, { title: 'Rights Review Draft' });
    await db.pool.query(
      "UPDATE resources SET access_tier = 'admin', publication_state = 'rights-review' WHERE id = $1",
      [hidden.id]);
    await agent.post('/api/rh2/library/move').send({ folderId: policies.id, resourceIds: [hidden.id] });

    const therapist = await agentFor('therapist', org.id);
    const asOwner = await agent.get('/api/rh2/library/folders');
    const asTherapist = await therapist.agent.get('/api/rh2/library/folders');
    expect(asTherapist.body.totalResources).toBeLessThan(asOwner.body.totalResources);
    expect(folderNamed(asTherapist.body.folders, 'Policies').count)
      .toBeLessThan(folderNamed(asOwner.body.folders, 'Policies').count);
  });
});
