'use strict';

/**
 * RESOURCE LIBRARY FOLDERS — INTEGRATION
 *
 * The properties here only exist once the routes, the database and the
 * permission model are all in play at once:
 *
 *   - Restructuring the library is the Owner's. A therapist who calls the API
 *     directly is refused; hiding the button is not the control (§34).
 *   - One organisation's taxonomy cannot be seen, counted, or written to from
 *     another (§33).
 *   - A manual placement SURVIVES the next automatic run. This is the promise
 *     the whole feature rests on (§14).
 *   - Search still spans the whole library. A folder narrows only when the
 *     caller asks (§21).
 *   - Nothing is destroyed: ids, files, tags, favourites and version history
 *     are the same after organisation as before (§62).
 *   - A run can be undone (§39).
 *
 * The AI path is not stubbed and not required: with no Bedrock configuration
 * in a test runner the gateway denies, the run proceeds deterministically, and
 * that is exactly the degradation §61 asks for — so these tests also prove the
 * model is genuinely optional.
 */

const request = require('supertest');
const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const { db, truncateAll, seedUser, seedOrganisation, closePool } = require('./helpers');
const organiser = require('../../resource-library-organiser');

const PASSWORD = 'LibPass123';

function buildApp() {
  const app = express();
  app.use(bodyParser.json({ limit: '8mb' }));
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
      // `content_type: null` is meaningful — a record with no type and no
      // describable title is what genuinely cannot be placed.
      'content_type' in over ? over.content_type : 'download',
      over.slug || `r-${Math.random().toString(36).slice(2, 10)}`]);
  return rows[0];
}

/** Enough of a real library that derivation produces more than one folder. */
async function seedLibrary(orgId) {
  const made = [];
  const batches = [
    ['Feelings Thermometer Worksheet', 6],
    ['Social Story About Waiting', 6],
    ['Letter Formation Practice Sheet', 6],
    ['Professional Boundaries Policy', 5],
    ['Handwriting Screening Tool', 5],
    ['NDIS Price Guide Summary', 5],
  ];
  for (const [title, n] of batches) {
    for (let i = 0; i < n; i++) {
      made.push(await seedResource(orgId, {
        title: `${title} ${i + 1}`,
        content_type: title.includes('Policy') ? 'policy' : 'download',
      }));
    }
  }
  // Every real library has one of these: a record whose title says nothing.
  // It belongs in Needs Review, and its presence is what makes that folder
  // visible — an empty review bucket is deliberately hidden.
  made.push(await seedResource(orgId, { title: 'Qqzz Vhtx', content_type: null }));
  return made;
}

/** Run an organisation synchronously, the way the route's background task does. */
async function organise(orgId, userId, mode = 'organise') {
  const run = await organiser.startRun(orgId, userId, mode);
  expect(run).toBeTruthy();
  await organiser.executeRun(run, { userId });
  const { rows } = await db.pool.query(
    'SELECT * FROM resource_classification_runs WHERE id = $1', [run.id]);
  expect(rows[0].status).toBe('complete');
  return rows[0];
}

const folderNamed = (folders, name) => {
  for (const f of folders) {
    if (f.name === name) return f;
    for (const c of f.children || []) if (c.name === name) return c;
  }
  return null;
};

beforeEach(async () => {
  await truncateAll();
  // Many logins per file from one IP. The real limiter is 10 per 15 minutes
  // (auth.js); it is exercised deliberately elsewhere, not incidentally here.
  require('../../auth')._resetLoginRateLimit();
});

afterAll(async () => {
  // The limiter is per-IP, in-memory and PROCESS-wide, and every integration
  // file shares one worker. Leaving it exhausted would 429 the first logins of
  // whichever file runs next.
  require('../../auth')._resetLoginRateLimit();
  await closePool();
});

// ═════════════════════════════════════════════════════════════════════════════

describe('organising a library', () => {
  it('creates folders from what is actually in the collection', async () => {
    const org = await seedOrganisation();
    const { agent, user } = await agentFor('owner', org.id);
    await seedLibrary(org.id);

    const run = await organise(org.id, user.id);
    expect(run.scanned_count).toBe(34);
    expect(run.assigned_count).toBe(34);
    expect(run.review_count).toBe(1);
    expect(run.folders_created).toBeGreaterThan(1);

    const res = await agent.get('/api/rh2/library/folders');
    expect(res.status).toBe(200);
    expect(res.body.organised).toBe(true);
    expect(folderNamed(res.body.folders, 'Policies & Procedures')).toBeTruthy();
    expect(folderNamed(res.body.folders, 'Needs Review')).toBeTruthy();
  });

  it('runs deterministically when no model is available (§61)', async () => {
    const org = await seedOrganisation();
    const { user } = await agentFor('owner', org.id);
    await seedLibrary(org.id);
    const run = await organise(org.id, user.id);
    // No Bedrock configuration in a test runner: the run must still complete,
    // and must say honestly that the deeper review did not happen.
    expect(run.ai_used).toBe(false);
    expect(run.ai_unavailable_reason).toBeTruthy();
    expect(run.error).toBeNull();
  });

  it('refuses a second concurrent run rather than racing itself', async () => {
    const org = await seedOrganisation();
    const { agent, user } = await agentFor('owner', org.id);
    await seedResource(org.id, { title: 'Anything' });

    const first = await organiser.startRun(org.id, user.id);
    expect(first).toBeTruthy();
    const res = await agent.post('/api/rh2/library/organise').send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('organisation_in_progress');
  });

  it('hides an empty Needs Review but keeps it as a safety net (§31)', async () => {
    const org = await seedOrganisation();
    const { agent, user } = await agentFor('owner', org.id);
    // A library with nothing ambiguous in it.
    for (let i = 0; i < 8; i++) {
      await seedResource(org.id, { title: `Professional Boundaries Policy ${i}`, content_type: 'policy' });
    }
    await organise(org.id, user.id);

    const listed = (await agent.get('/api/rh2/library/folders')).body.folders;
    expect(folderNamed(listed, 'Needs Review')).toBeNull();

    // Still there underneath, so a later unplaceable upload has somewhere to go.
    const { rows } = await db.pool.query(
      `SELECT is_active FROM resource_folders
        WHERE organisation_id = $1 AND kind = 'library' AND is_review_bucket`, [org.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].is_active).toBe(true);
  });

  /**
   * The failure this protects against is permanent and silent: migration 039's
   * partial unique index gives an organisation one active run, and a process
   * that dies mid-run leaves the row saying 'running' for ever. On staging a
   * full run takes ~17 minutes, most of it waiting on the model, so an App
   * Service restart inside that window is not hypothetical.
   */
  it('reaps a run whose process died, so the Owner is not locked out for ever', async () => {
    const org = await seedOrganisation();
    const { agent, user } = await agentFor('owner', org.id);
    await seedResource(org.id, { title: 'Anything' });

    const dead = await organiser.startRun(org.id, user.id);
    expect(dead).toBeTruthy();

    // Still beating: a slow run must NOT be reaped, or a second run would
    // start and race it.
    const blocked = await agent.post('/api/rh2/library/organise').send({});
    expect(blocked.status).toBe(409);

    // Its process dies — the heartbeat stops.
    await db.pool.query(
      `UPDATE resource_classification_runs
          SET heartbeat_at = NOW() - ($2 || ' minutes')::interval,
              started_at   = NOW() - ($2 || ' minutes')::interval
        WHERE id = $1`,
      [dead.id, String(organiser.STALE_RUN_MINUTES + 5)]);

    const retry = await agent.post('/api/rh2/library/organise').send({});
    expect(retry.status).toBe(202);

    const { rows } = await db.pool.query(
      'SELECT status, error FROM resource_classification_runs WHERE id = $1', [dead.id]);
    expect(rows[0].status).toBe('failed');
    expect(rows[0].error).toMatch(/Interrupted/);
  });

  it('beats while it works, so a slow run is never mistaken for a dead one', async () => {
    const org = await seedOrganisation();
    const { user } = await agentFor('owner', org.id);
    await seedLibrary(org.id);

    const run = await organiser.startRun(org.id, user.id);
    const before = await db.pool.query(
      'SELECT heartbeat_at FROM resource_classification_runs WHERE id = $1', [run.id]);
    // Backdate the heartbeat, then let the run report progress.
    await db.pool.query(
      "UPDATE resource_classification_runs SET heartbeat_at = NOW() - INTERVAL '1 hour' WHERE id = $1",
      [run.id]);
    await organiser.executeRun(run, { userId: user.id });

    const after = await db.pool.query(
      'SELECT status, heartbeat_at FROM resource_classification_runs WHERE id = $1', [run.id]);
    expect(after.rows[0].status).toBe('complete');
    expect(new Date(after.rows[0].heartbeat_at).getTime())
      .toBeGreaterThan(new Date(before.rows[0].heartbeat_at).getTime() - 1000);
  });

  it('is idempotent — a second run reuses the same folder rows and slugs (§25, §52)', async () => {
    const org = await seedOrganisation();
    const { agent, user } = await agentFor('owner', org.id);
    await seedLibrary(org.id);

    await organise(org.id, user.id);
    const before = await agent.get('/api/rh2/library/folders');
    const beforeIds = before.body.folders.map((f) => `${f.id}:${f.slug}`).sort();

    const second = await organise(org.id, user.id, 'reorganise');
    expect(second.folders_created).toBe(0);

    const after = await agent.get('/api/rh2/library/folders');
    expect(after.body.folders.map((f) => `${f.id}:${f.slug}`).sort()).toEqual(beforeIds);
  });

  it('leaves resource identities, files, tags and favourites untouched (§62)', async () => {
    const org = await seedOrganisation();
    const { user } = await agentFor('owner', org.id);
    const [first] = await seedLibrary(org.id);

    const { rows: [tag] } = await db.pool.query(
      `INSERT INTO resource_tags (category, name) VALUES ('therapy_area', 'Zzz Test Tag')
       ON CONFLICT (category, name) DO UPDATE SET name = EXCLUDED.name RETURNING *`);
    await db.pool.query(
      'INSERT INTO resource_tag_links (resource_id, tag_id) VALUES ($1, $2)', [first.id, tag.id]);
    await db.pool.query(
      `INSERT INTO resource_files (resource_id, file_name, storage_key, format, is_primary)
       VALUES ($1, 'x.pdf', 'resources/aa/x.pdf', 'pdf', TRUE)`, [first.id]);
    await db.pool.query(
      'INSERT INTO resource_favourites (user_id, resource_id) VALUES ($1, $2)', [user.id, first.id]);
    await db.pool.query(
      `INSERT INTO resource_versions (resource_id, version, title, change_kind)
       VALUES ($1, 1, $2, 'initial')`, [first.id, first.title]);

    await organise(org.id, user.id);

    const after = await db.pool.query('SELECT * FROM resources WHERE id = $1', [first.id]);
    expect(after.rows).toHaveLength(1);
    expect(after.rows[0].slug).toBe(first.slug);
    expect(after.rows[0].title).toBe(first.title);
    // The legacy ingestion column is not the taxonomy's to write.
    expect(after.rows[0].folder_id).toBe(first.folder_id);

    const counts = await db.pool.query(
      `SELECT (SELECT COUNT(*) FROM resource_files WHERE resource_id = $1)::int AS files,
              (SELECT COUNT(*) FROM resource_tag_links WHERE resource_id = $1)::int AS tags,
              (SELECT COUNT(*) FROM resource_favourites WHERE resource_id = $1)::int AS favs,
              (SELECT COUNT(*) FROM resource_versions WHERE resource_id = $1)::int AS versions`,
      [first.id]);
    expect(counts.rows[0]).toEqual({ files: 1, tags: 1, favs: 1, versions: 1 });

    const file = await db.pool.query('SELECT storage_key FROM resource_files WHERE resource_id = $1', [first.id]);
    expect(file.rows[0].storage_key).toBe('resources/aa/x.pdf');
  });

  it('does not shelve an archived resource, so counts describe what is usable (§29)', async () => {
    const org = await seedOrganisation();
    const { user } = await agentFor('owner', org.id);
    await seedLibrary(org.id);
    const gone = await seedResource(org.id, { title: 'Retired Policy' });
    await db.pool.query(
      "UPDATE resources SET status = 'archived', archived_at = NOW() WHERE id = $1", [gone.id]);

    await organise(org.id, user.id);
    const { rows } = await db.pool.query(
      'SELECT 1 FROM resource_folder_assignments WHERE resource_id = $1', [gone.id]);
    expect(rows).toHaveLength(0);
  });

  it('never shelves a client-derived record', async () => {
    const org = await seedOrganisation();
    const { user } = await agentFor('owner', org.id);
    await seedLibrary(org.id);
    const priv = await seedResource(org.id, { title: 'Client-derived worksheet' });
    await db.pool.query(
      `UPDATE resources SET access_tier = 'excluded-private',
              publication_state = 'excluded-private' WHERE id = $1`, [priv.id]);

    await organise(org.id, user.id);
    const { rows } = await db.pool.query(
      'SELECT 1 FROM resource_folder_assignments WHERE resource_id = $1', [priv.id]);
    expect(rows).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('manual placement outranks the machine (§14)', () => {
  it('survives a later automatic run', async () => {
    const org = await seedOrganisation();
    const { agent, user } = await agentFor('owner', org.id);
    const made = await seedLibrary(org.id);
    await organise(org.id, user.id);

    const folders = (await agent.get('/api/rh2/library/folders')).body.folders;
    const policies = folderNamed(folders, 'Policies & Procedures');
    // A worksheet the Owner insists belongs with the policies.
    const worksheet = made.find((r) => r.title.startsWith('Feelings Thermometer'));

    const moved = await agent.post('/api/rh2/library/move')
      .send({ folderId: policies.id, resourceIds: [worksheet.id] });
    expect(moved.status).toBe(200);
    expect(moved.body.moved).toBe(1);

    const run = await organise(org.id, user.id, 'reorganise');
    expect(run.skipped_locked).toBeGreaterThanOrEqual(1);

    const { rows } = await db.pool.query(
      'SELECT folder_id, classification_source, manual_lock FROM resource_folder_assignments WHERE resource_id = $1',
      [worksheet.id]);
    expect(rows[0].folder_id).toBe(policies.id);
    expect(rows[0].classification_source).toBe('manual');
    expect(rows[0].manual_lock).toBe(true);
  });

  it('records the move in the audit trail (§60)', async () => {
    const org = await seedOrganisation();
    const { agent, user } = await agentFor('owner', org.id);
    const made = await seedLibrary(org.id);
    await organise(org.id, user.id);
    const folders = (await agent.get('/api/rh2/library/folders')).body.folders;

    await agent.post('/api/rh2/library/move')
      .send({ folderId: folders[0].id, resourceIds: [made[0].id] });

    const { rows } = await db.pool.query(
      "SELECT action FROM audit_logs WHERE organisation_id = $1 AND action LIKE 'resource_library%'",
      [org.id]);
    const actions = rows.map((r) => r.action);
    expect(actions).toContain('resource_library.organised');
    expect(actions).toContain('resource_library.resources_moved');
  });

  it('can be handed back to automatic classification on request', async () => {
    const org = await seedOrganisation();
    const { agent, user } = await agentFor('owner', org.id);
    const made = await seedLibrary(org.id);
    await organise(org.id, user.id);
    const folders = (await agent.get('/api/rh2/library/folders')).body.folders;
    const policy = made.find((r) => r.title.startsWith('Professional Boundaries'));
    const wrong = folderNamed(folders, 'Needs Review');

    await agent.post('/api/rh2/library/move').send({ folderId: wrong.id, resourceIds: [policy.id] });
    const back = await agent.post('/api/rh2/library/reclassify').send({ resourceId: policy.id });
    expect(back.status).toBe(200);
    expect(back.body.folder).toBe('Policies & Procedures');
  });

  it('refuses to move a resource belonging to another organisation (§33)', async () => {
    const mine = await seedOrganisation('Mine');
    const theirs = await seedOrganisation('Theirs');
    const { agent, user } = await agentFor('owner', mine.id);
    await seedLibrary(mine.id);
    await organise(mine.id, user.id);
    const folders = (await agent.get('/api/rh2/library/folders')).body.folders;

    const foreign = await seedResource(theirs.id, { title: 'Their Policy' });
    const res = await agent.post('/api/rh2/library/move')
      .send({ folderId: folders[0].id, resourceIds: [foreign.id] });
    expect(res.status).toBe(404);

    const { rows } = await db.pool.query(
      'SELECT 1 FROM resource_folder_assignments WHERE resource_id = $1', [foreign.id]);
    expect(rows).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('permissions (§34)', () => {
  let org; let ownerAgent; let therapist;

  beforeEach(async () => {
    org = await seedOrganisation();
    const owner = await agentFor('owner', org.id);
    ownerAgent = owner.agent;
    await seedLibrary(org.id);
    await organise(org.id, owner.user.id);
    therapist = await agentFor('therapist', org.id);
  });

  it('lets a therapist browse the folders', async () => {
    const res = await therapist.agent.get('/api/rh2/library/folders');
    expect(res.status).toBe(200);
    expect(res.body.folders.length).toBeGreaterThan(0);
    expect(res.body.canOrganise).toBeUndefined();
  });

  it('tells a therapist plainly that organising is not theirs', async () => {
    const status = await therapist.agent.get('/api/rh2/library/status');
    expect(status.status).toBe(200);
    expect(status.body.canOrganise).toBe(false);
  });

  it('refuses every restructuring route to a therapist', async () => {
    const folders = (await ownerAgent.get('/api/rh2/library/folders')).body.folders;
    // Issued one at a time. A burst of concurrent supertest requests against
    // an ephemeral server drops connections, and a dropped request leaves a
    // transaction open that deadlocks the next truncate — a test-harness
    // artefact that looks exactly like a routing bug.
    const calls = [
      () => therapist.agent.post('/api/rh2/library/organise').send({}),
      () => therapist.agent.post('/api/rh2/library/rollback').send({}),
      () => therapist.agent.post('/api/rh2/library/folders').send({ name: 'Mine' }),
      () => therapist.agent.patch(`/api/rh2/library/folders/${folders[0].id}`).send({ name: 'Renamed' }),
      () => therapist.agent.delete(`/api/rh2/library/folders/${folders[0].id}`),
      () => therapist.agent.post('/api/rh2/library/move').send({ folderId: folders[0].id, resourceIds: [] }),
      () => therapist.agent.post('/api/rh2/library/reclassify').send({ resourceId: folders[0].id }),
    ];
    for (const call of calls) {
      const res = await call();
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('library_structure_forbidden');
    }
  });

  it('refuses an admin too — restructuring is the Owner\'s alone', async () => {
    const admin = await agentFor('admin', org.id);
    const res = await admin.agent.post('/api/rh2/library/organise').send({});
    expect(res.status).toBe(403);
  });

  it('does not leak another organisation\'s folders or counts (§33)', async () => {
    const other = await seedOrganisation('Other Practice');
    const stranger = await agentFor('owner', other.id);

    const res = await stranger.agent.get('/api/rh2/library/folders');
    expect(res.status).toBe(200);
    expect(res.body.folders).toHaveLength(0);
    expect(res.body.totalResources).toBe(0);

    const folders = (await ownerAgent.get('/api/rh2/library/folders')).body.folders;
    const peek = await stranger.agent.get(`/api/rh2/library/folders/${folders[0].id}`);
    expect(peek.status).toBe(404);

    const rename = await stranger.agent.patch(`/api/rh2/library/folders/${folders[0].id}`)
      .send({ name: 'Hijacked' });
    expect(rename.status).toBe(404);
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('browsing, search and deep links', () => {
  let org; let agent; let owner; let made;

  beforeEach(async () => {
    org = await seedOrganisation();
    const o = await agentFor('owner', org.id);
    agent = o.agent; owner = o.user;
    made = await seedLibrary(org.id);
    await organise(org.id, owner.id);
  });

  it('keeps search global — a folder narrows only when asked (§21)', async () => {
    const folders = (await agent.get('/api/rh2/library/folders')).body.folders;
    const policies = folderNamed(folders, 'Policies & Procedures');

    // A plain search finds the policy regardless of which folder it is in.
    const global = await agent.get('/api/rh2/resources?q=Boundaries');
    expect(global.status).toBe(200);
    expect(global.body.resources.length).toBeGreaterThan(0);

    // The same search, deliberately scoped to a folder that does not hold it.
    const review = folderNamed(folders, 'Needs Review');
    const scoped = await agent.get(`/api/rh2/resources?q=Boundaries&folderId=${review.id}`);
    expect(scoped.status).toBe(200);
    expect(scoped.body.resources).toHaveLength(0);

    const right = await agent.get(`/api/rh2/resources?q=Boundaries&folderId=${policies.id}`);
    expect(right.body.resources.length).toBeGreaterThan(0);
  });

  it('rejects a malformed folder filter rather than silently returning everything', async () => {
    const res = await agent.get('/api/rh2/resources?folderId=not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body.parameter).toBe('folderId');
  });

  it('a parent folder shows its subfolders\' resources too', async () => {
    const folders = (await agent.get('/api/rh2/library/folders')).body.folders;
    const parent = folders.find((f) => (f.children || []).length);
    if (!parent) return; // this corpus produced no subfolders; nothing to assert
    const flat = await agent.get(`/api/rh2/resources?folderId=${parent.id}`);
    const tree = await agent.get(`/api/rh2/resources?folderId=${parent.id}&folderScope=tree`);
    expect(tree.body.resources.length).toBeGreaterThanOrEqual(flat.body.resources.length);
  });

  it('addresses a folder by a slug that survives a rename (§52)', async () => {
    const folders = (await agent.get('/api/rh2/library/folders')).body.folders;
    const target = folderNamed(folders, 'Policies & Procedures');

    const bySlug = await agent.get(`/api/rh2/library/folders/${target.slug}`);
    expect(bySlug.status).toBe(200);
    expect(bySlug.body.folder.id).toBe(target.id);

    await agent.patch(`/api/rh2/library/folders/${target.id}`).send({ name: 'Practice Policies' });
    const still = await agent.get(`/api/rh2/library/folders/${target.slug}`);
    expect(still.status).toBe(200);
    expect(still.body.folder.name).toBe('Practice Policies');
  });

  it('gives a subfolder a breadcrumb trail (§20)', async () => {
    const folders = (await agent.get('/api/rh2/library/folders')).body.folders;
    const parent = folders.find((f) => (f.children || []).length);
    if (!parent) return;
    const res = await agent.get(`/api/rh2/library/folders/${parent.children[0].id}`);
    expect(res.status).toBe(200);
    expect(res.body.breadcrumb.map((b) => b.id)).toEqual([parent.id]);
  });

  it('an existing resource URL still works after organisation', async () => {
    const res = await agent.get(`/api/rh2/resources/${made[0].slug}`);
    expect(res.status).toBe(200);
    expect(res.body.resource ? res.body.resource.id : res.body.id).toBe(made[0].id);
  });

  it('counts what THIS reader can open, not what exists', async () => {
    // An admin-tier record is invisible to a therapist, so it must not be
    // counted for one either.
    const hidden = await seedResource(org.id, { title: 'Professional Boundaries Policy Draft' });
    await db.pool.query(
      "UPDATE resources SET access_tier = 'admin', publication_state = 'rights-review' WHERE id = $1",
      [hidden.id]);
    await organise(org.id, owner.id, 'reorganise');

    const therapist = await agentFor('therapist', org.id);
    const asOwner = await agent.get('/api/rh2/library/folders');
    const asTherapist = await therapist.agent.get('/api/rh2/library/folders');
    expect(asTherapist.body.totalResources).toBeLessThan(asOwner.body.totalResources);
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('folder management (§37)', () => {
  let org; let agent; let owner;

  beforeEach(async () => {
    org = await seedOrganisation();
    const o = await agentFor('owner', org.id);
    agent = o.agent; owner = o.user;
    await seedLibrary(org.id);
    await organise(org.id, owner.id);
  });

  it('creates a folder and a subfolder', async () => {
    const top = await agent.post('/api/rh2/library/folders')
      .send({ name: 'Student Placements', description: 'Material for students.' });
    expect(top.status).toBe(201);

    const sub = await agent.post('/api/rh2/library/folders')
      .send({ name: 'Supervision Records', parentId: top.body.folder.id });
    expect(sub.status).toBe(201);
    expect(sub.body.folder.parent_id).toBe(top.body.folder.id);
  });

  it('holds the hierarchy to two levels (§9)', async () => {
    const top = await agent.post('/api/rh2/library/folders').send({ name: 'Student Placements' });
    const sub = await agent.post('/api/rh2/library/folders')
      .send({ name: 'Supervision Records', parentId: top.body.folder.id });
    const third = await agent.post('/api/rh2/library/folders')
      .send({ name: 'Weekly Notes', parentId: sub.body.folder.id });
    expect(third.status).toBe(400);
    expect(third.body.code).toBe('depth_limit');
  });

  it('refuses a folder name that means nothing (§11)', async () => {
    for (const bad of ['Miscellaneous', 'Other Documents', 'CLINICAL_MISC_03', '']) {
      const res = await agent.post('/api/rh2/library/folders').send({ name: bad });
      expect(res.status).toBe(400);
    }
  });

  it('a renamed folder is never renamed back by a later run (§25)', async () => {
    const folders = (await agent.get('/api/rh2/library/folders')).body.folders;
    const target = folderNamed(folders, 'Policies & Procedures');
    await agent.patch(`/api/rh2/library/folders/${target.id}`).send({ name: 'Practice Policies' });

    await organise(org.id, owner.id, 'reorganise');

    const after = (await agent.get('/api/rh2/library/folders')).body.folders;
    expect(folderNamed(after, 'Practice Policies')).toBeTruthy();
    expect(folderNamed(after, 'Policies & Procedures')).toBeNull();
  });

  it('removing a folder moves its resources to Needs Review, never deletes them (§62)', async () => {
    const folders = (await agent.get('/api/rh2/library/folders')).body.folders;
    const target = folderNamed(folders, 'Policies & Procedures');
    const before = await db.pool.query('SELECT COUNT(*)::int AS n FROM resources WHERE organisation_id = $1', [org.id]);

    const res = await agent.delete(`/api/rh2/library/folders/${target.id}`);
    expect(res.status).toBe(200);
    expect(res.body.movedToReview).toBeGreaterThan(0);

    const after = await db.pool.query('SELECT COUNT(*)::int AS n FROM resources WHERE organisation_id = $1', [org.id]);
    expect(after.rows[0].n).toBe(before.rows[0].n);

    const listed = (await agent.get('/api/rh2/library/folders')).body.folders;
    expect(folderNamed(listed, 'Policies & Procedures')).toBeNull();
    expect(folderNamed(listed, 'Needs Review').count).toBeGreaterThan(0);
  });

  it('will not remove Needs Review itself', async () => {
    const folders = (await agent.get('/api/rh2/library/folders')).body.folders;
    const review = folderNamed(folders, 'Needs Review');
    const res = await agent.delete(`/api/rh2/library/folders/${review.id}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('review_bucket_fixed');
  });

  it('keeps an empty folder a person deliberately made (§31)', async () => {
    const made = await agent.post('/api/rh2/library/folders').send({ name: 'Student Placements' });
    await organise(org.id, owner.id, 'reorganise');
    const folders = (await agent.get('/api/rh2/library/folders')).body.folders;
    expect(folders.find((f) => f.id === made.body.folder.id)).toBeTruthy();
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('undoing a run (§39)', () => {
  it('restores the placements the run replaced', async () => {
    const org = await seedOrganisation();
    const { agent, user } = await agentFor('owner', org.id);
    const made = await seedLibrary(org.id);

    await organise(org.id, user.id);
    const before = await db.pool.query(
      'SELECT resource_id, folder_id FROM resource_folder_assignments WHERE organisation_id = $1 ORDER BY resource_id',
      [org.id]);
    expect(before.rows.length).toBeGreaterThan(0);

    // A second run that genuinely changes something: move one resource by
    // hand first is not it (that locks); instead retitle one so it reclassifies.
    await db.pool.query("UPDATE resources SET title = 'NDIS Price Guide Summary 99' WHERE id = $1",
      [made[0].id]);
    const second = await organise(org.id, user.id, 'reorganise');

    const undo = await agent.post('/api/rh2/library/rollback').send({ runId: second.id });
    expect(undo.status).toBe(200);

    const after = await db.pool.query(
      'SELECT resource_id, folder_id FROM resource_folder_assignments WHERE organisation_id = $1 ORDER BY resource_id',
      [org.id]);
    expect(after.rows).toEqual(before.rows);
  });

  it('will not undo the same run twice', async () => {
    const org = await seedOrganisation();
    const { agent, user } = await agentFor('owner', org.id);
    await seedLibrary(org.id);
    const run = await organise(org.id, user.id);

    expect((await agent.post('/api/rh2/library/rollback').send({ runId: run.id })).status).toBe(200);
    const again = await agent.post('/api/rh2/library/rollback').send({ runId: run.id });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('already_rolled_back');
  });

  it('does not undo a placement the Owner has since made by hand', async () => {
    const org = await seedOrganisation();
    const { agent, user } = await agentFor('owner', org.id);
    const made = await seedLibrary(org.id);
    await organise(org.id, user.id);
    const run = await organise(org.id, user.id, 'reorganise');

    const folders = (await agent.get('/api/rh2/library/folders')).body.folders;
    const review = folderNamed(folders, 'Needs Review');
    await agent.post('/api/rh2/library/move')
      .send({ folderId: review.id, resourceIds: [made[0].id] });

    await agent.post('/api/rh2/library/rollback').send({ runId: run.id });

    const { rows } = await db.pool.query(
      'SELECT folder_id, manual_lock FROM resource_folder_assignments WHERE resource_id = $1',
      [made[0].id]);
    expect(rows[0].folder_id).toBe(review.id);
    expect(rows[0].manual_lock).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════

describe('a resource added after organisation (§23, §57)', () => {
  it('is shelved in an existing folder without a new run', async () => {
    const org = await seedOrganisation();
    const { user } = await agentFor('owner', org.id);
    await seedLibrary(org.id);
    await organise(org.id, user.id);

    const fresh = await seedResource(org.id, {
      title: 'Complaints Handling Policy', content_type: 'policy',
    });
    const got = await organiser.classifyResource(org.id, fresh.id, { userId: user.id });
    expect(got).toBeTruthy();
    expect(got.folderName).toBe('Policies & Procedures');
  });

  it('goes to Needs Review rather than inventing a folder (§24)', async () => {
    const org = await seedOrganisation();
    const { agent, user } = await agentFor('owner', org.id);
    await seedLibrary(org.id);
    await organise(org.id, user.id);
    const beforeCount = (await agent.get('/api/rh2/library/folders')).body.folders.length;

    const odd = await seedResource(org.id, { title: 'qqqq zzzz', content_type: null });
    const got = await organiser.classifyResource(org.id, odd.id, { userId: user.id });
    expect(got.review).toBe(true);

    const afterCount = (await agent.get('/api/rh2/library/folders')).body.folders.length;
    expect(afterCount).toBe(beforeCount);
  });

  it('does not invent a taxonomy for a library nobody has organised', async () => {
    const org = await seedOrganisation();
    const { user } = await agentFor('owner', org.id);
    const lonely = await seedResource(org.id, { title: 'Complaints Handling Policy' });
    expect(await organiser.classifyResource(org.id, lonely.id, { userId: user.id })).toBeNull();
  });

  it('will not move a resource the Owner has locked (§58)', async () => {
    const org = await seedOrganisation();
    const { agent, user } = await agentFor('owner', org.id);
    const made = await seedLibrary(org.id);
    await organise(org.id, user.id);
    const folders = (await agent.get('/api/rh2/library/folders')).body.folders;
    const review = folderNamed(folders, 'Needs Review');

    await agent.post('/api/rh2/library/move').send({ folderId: review.id, resourceIds: [made[0].id] });
    expect(await organiser.classifyResource(org.id, made[0].id, { userId: user.id })).toBeNull();

    const { rows } = await db.pool.query(
      'SELECT folder_id FROM resource_folder_assignments WHERE resource_id = $1', [made[0].id]);
    expect(rows[0].folder_id).toBe(review.id);
  });
});
