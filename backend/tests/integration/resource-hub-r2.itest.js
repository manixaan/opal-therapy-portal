'use strict';

/**
 * Resource Hub R2 integration tests — home aggregation, governed publishing
 * with version snapshots, policy acknowledgements across material edits,
 * learning paths, server-side quiz scoring, search misses, external-source
 * verification, PD events, CPD tracker and analytics RBAC.
 *
 * Real Express routes, real sessions, real SQL. No external HTTP: check-now
 * is never called here; its hash-diff logic is unit-tested on the exported
 * pure function.
 */

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { db, truncateAll, seedUser, closePool } = require('./helpers');
const { computeSourceCheckUpdate, isPrivateIp, urlHopIssue } = require('../../resource-hub-r2-routes');

const PASSWORD = 'HubR2Pass1';

function buildApp() {
  const app = express();
  app.use(bodyParser.json({ limit: '5mb' }));
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

/** Create a draft via the API as the given agent, returning the resource. */
async function createDraft(agent, body) {
  const res = await agent.post('/api/rh2/resources').send({ title: 'R2 Resource', ...body });
  expect(res.status).toBe(201);
  return res.body.resource;
}

beforeEach(async () => {
  await truncateAll();
  delete process.env.ENABLE_RESOURCE_HUB;
  require('../../auth')._resetLoginRateLimit();
});
afterAll(closePool);

// ═══ Gate + RBAC ═════════════════════════════════════════════════════════════

describe('gate and RBAC', () => {
  test('unauthenticated is 401 everywhere', async () => {
    const app = buildApp();
    for (const [method, path] of [
      ['get', '/api/rh2/home'], ['get', '/api/rh2/resources'], ['get', '/api/rh2/learning'],
      ['post', '/api/rh2/resources'], ['get', '/api/rh2/admin/analytics'], ['get', '/api/rh2/cpd'],
    ]) {
      expect((await request(app)[method](path)).status).toBe(401);
    }
  });

  test('ENABLE_RESOURCE_HUB=false closes the module for every role', async () => {
    const app = buildApp();
    const { agent: owner } = await agentFor(app, 'owner');
    process.env.ENABLE_RESOURCE_HUB = 'false';
    const res = await owner.get('/api/rh2/home');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('resource_hub_disabled');
  });

  test('therapist cannot author, approve, manage sources, PD, quick links or view analytics', async () => {
    const app = buildApp();
    const { agent: therapist } = await agentFor(app, 'therapist');
    expect((await therapist.post('/api/rh2/resources').send({ title: 'X' })).status).toBe(403);
    expect((await therapist.get('/api/rh2/sources')).status).toBe(403);
    expect((await therapist.post('/api/rh2/pd').send({ title: 'X' })).status).toBe(403);
    expect((await therapist.post('/api/rh2/quick-links').send({ label: 'X', url: 'https://x.invalid' })).status).toBe(403);
    expect((await therapist.get('/api/rh2/admin/analytics')).status).toBe(403);
  });

  test('read_only can read home but the global write block stops mutations', async () => {
    const app = buildApp();
    const { agent: ro } = await agentFor(app, 'read_only');
    expect((await ro.get('/api/rh2/home')).status).toBe(200);
    const res = await ro.post('/api/rh2/cpd').send({ activity: 'X', activityDate: '2026-08-01' });
    expect(res.status).toBe(403);
  });
});

// ═══ Publishing workflow ═════════════════════════════════════════════════════

describe('publishing workflow and visibility', () => {
  test('therapist sees approved only; drafts are invisible in list and detail', async () => {
    const app = buildApp();
    const { agent: owner } = await agentFor(app, 'owner');
    const { agent: therapist } = await agentFor(app, 'therapist');

    const draft = await createDraft(owner, { title: 'Hidden Draft' });
    const toApprove = await createDraft(owner, { title: 'Visible Policy' });
    expect((await owner.post(`/api/rh2/resources/${toApprove.id}/approve`)).status).toBe(200);

    const list = await therapist.get('/api/rh2/resources');
    expect(list.status).toBe(200);
    const titles = list.body.resources.map((r) => r.title);
    expect(titles).toContain('Visible Policy');
    expect(titles).not.toContain('Hidden Draft');

    expect((await therapist.get(`/api/rh2/resources/${draft.id}`)).status).toBe(404);
    expect((await therapist.get(`/api/rh2/resources/${toApprove.id}`)).status).toBe(200);
    // Detail also resolves by slug
    expect((await therapist.get('/api/rh2/resources/visible-policy')).status).toBe(200);
  });

  test('admin can create a draft but cannot approve or archive; owner approve snapshots v1', async () => {
    const app = buildApp();
    const { agent: owner } = await agentFor(app, 'owner');
    const { agent: admin } = await agentFor(app, 'admin');

    const draft = await createDraft(admin, { title: 'Admin Draft', content: 'Body v1' });
    expect(draft.status).toBe('draft');
    expect(draft.slug).toBe('admin-draft');

    expect((await admin.post(`/api/rh2/resources/${draft.id}/approve`)).status).toBe(403);
    expect((await admin.post(`/api/rh2/resources/${draft.id}/archive`)).status).toBe(403);

    const approve = await owner.post(`/api/rh2/resources/${draft.id}/approve`);
    expect(approve.status).toBe(200);
    expect(approve.body.resource.status).toBe('approved');
    expect(approve.body.resource.last_reviewed_at).toBeTruthy();
    expect(approve.body.resource.review_due_at).toBeTruthy();

    const { rows: versions } = await db.pool.query(
      'SELECT * FROM resource_versions WHERE resource_id = $1 ORDER BY version', [draft.id]);
    expect(versions).toHaveLength(1);
    expect(versions[0].version).toBe(1);
    expect(versions[0].change_kind).toBe('initial');
    expect(versions[0].content).toBe('Body v1');
  });

  test('admin can edit a draft but not an approved resource; owner edit of approved requires changeKind', async () => {
    const app = buildApp();
    const { agent: owner } = await agentFor(app, 'owner');
    const { agent: admin } = await agentFor(app, 'admin');

    const draft = await createDraft(admin, { title: 'Editable Draft' });
    const patch = await admin.patch(`/api/rh2/resources/${draft.id}`).send({ description: 'Updated' });
    expect(patch.status).toBe(200);
    expect(patch.body.resource.description).toBe('Updated');

    await owner.post(`/api/rh2/resources/${draft.id}/approve`);
    expect((await admin.patch(`/api/rh2/resources/${draft.id}`).send({ description: 'Nope' })).status).toBe(403);
    expect((await owner.patch(`/api/rh2/resources/${draft.id}`).send({ description: 'No changeKind' })).status).toBe(400);
  });

  test('unsafe link schemes are rejected server-side: resources externalUrl, quick links, PD registrationUrl', async () => {
    const app = buildApp();
    const { agent: owner } = await agentFor(app, 'owner');

    // resources.external_url — javascript:/data: never stored
    expect((await owner.post('/api/rh2/resources')
      .send({ title: 'XSS', externalUrl: 'javascript:alert(1)' })).status).toBe(400);
    expect((await owner.post('/api/rh2/resources')
      .send({ title: 'XSS', externalUrl: 'data:text/html,<script>1</script>' })).status).toBe(400);
    const okRes = await owner.post('/api/rh2/resources')
      .send({ title: 'Linked', externalUrl: 'https://example.invalid/doc' });
    expect(okRes.status).toBe(201);
    expect((await owner.patch(`/api/rh2/resources/${okRes.body.resource.id}`)
      .send({ externalUrl: 'javascript:alert(2)' })).status).toBe(400);
    // clearing the link stays allowed
    expect((await owner.patch(`/api/rh2/resources/${okRes.body.resource.id}`)
      .send({ externalUrl: null })).status).toBe(200);

    // quick links — http(s) or an app-internal /path only
    expect((await owner.post('/api/rh2/quick-links')
      .send({ label: 'Bad', url: 'javascript:alert(1)' })).status).toBe(400);
    expect((await owner.post('/api/rh2/quick-links')
      .send({ label: 'Bad2', url: '//evil.invalid/x' })).status).toBe(400);
    const internal = await owner.post('/api/rh2/quick-links')
      .send({ label: 'Reports', url: '/reports?range=week' });
    expect(internal.status).toBe(201);
    expect((await owner.patch(`/api/rh2/quick-links/${internal.body.quickLink.id}`)
      .send({ url: 'javascript:alert(1)' })).status).toBe(400);
    expect((await owner.patch(`/api/rh2/quick-links/${internal.body.quickLink.id}`)
      .send({ url: 'https://example.invalid/ok' })).status).toBe(200);

    // PD events — registrationUrl must be http(s)
    expect((await owner.post('/api/rh2/pd')
      .send({ title: 'Bad PD', registrationUrl: 'javascript:alert(1)' })).status).toBe(400);
    const pd = await owner.post('/api/rh2/pd')
      .send({ title: 'Good PD', registrationUrl: 'https://example.invalid/register' });
    expect(pd.status).toBe(201);
    expect((await owner.patch(`/api/rh2/pd/${pd.body.event.id}`)
      .send({ registrationUrl: 'file:///etc/passwd' })).status).toBe(400);
  });

  test('authorityLevel is validated against the 5 permitted values', async () => {
    const app = buildApp();
    const { agent: owner } = await agentFor(app, 'owner');
    const bad = await owner.post('/api/rh2/resources').send({ title: 'X', authorityLevel: 'divine' });
    expect(bad.status).toBe(400);
    const ok = await owner.post('/api/rh2/resources').send({ title: 'X', authorityLevel: 'official_regulatory' });
    expect(ok.status).toBe(201);
    expect(ok.body.resource.authority_level).toBe('official_regulatory');
  });
});

// ═══ Acknowledgements + material edits ═══════════════════════════════════════

describe('policy acknowledgements across versions', () => {
  async function approvedPolicy(owner) {
    const draft = await createDraft(owner, {
      title: 'Safety Policy', content: 'v1 content', acknowledgementRequired: true,
    });
    await owner.post(`/api/rh2/resources/${draft.id}/approve`);
    return draft;
  }

  test('acknowledge is idempotent and version-stamped; clears requiredForYou', async () => {
    const app = buildApp();
    const { agent: owner } = await agentFor(app, 'owner');
    const { agent: therapist, user: tUser } = await agentFor(app, 'therapist');
    const policy = await approvedPolicy(owner);

    let home = await therapist.get('/api/rh2/home');
    expect(home.body.requiredForYou.map((r) => r.id)).toContain(policy.id);

    expect((await therapist.post(`/api/rh2/resources/${policy.id}/acknowledge`)).status).toBe(200);
    expect((await therapist.post(`/api/rh2/resources/${policy.id}/acknowledge`)).status).toBe(200);
    const { rows: acks } = await db.pool.query(
      'SELECT * FROM policy_acknowledgements WHERE user_id = $1 AND resource_id = $2', [tUser.id, policy.id]);
    expect(acks).toHaveLength(1);
    expect(acks[0].version).toBe(1);

    home = await therapist.get('/api/rh2/home');
    expect(home.body.requiredForYou.map((r) => r.id)).not.toContain(policy.id);
  });

  test('material edit bumps version, keeps old acks intact, and re-requires acknowledgement', async () => {
    const app = buildApp();
    const { agent: owner } = await agentFor(app, 'owner');
    const { agent: therapist, user: tUser } = await agentFor(app, 'therapist');
    const policy = await approvedPolicy(owner);

    await therapist.post(`/api/rh2/resources/${policy.id}/acknowledge`);

    const patch = await owner.patch(`/api/rh2/resources/${policy.id}`)
      .send({ content: 'v2 content', changeKind: 'material', changeNote: 'Rewrote escalation steps' });
    expect(patch.status).toBe(200);
    expect(patch.body.resource.version).toBe(2);

    // Old acknowledgement (v1) is untouched — immutable, version-stamped.
    const { rows: acks } = await db.pool.query(
      'SELECT version FROM policy_acknowledgements WHERE user_id = $1 AND resource_id = $2 ORDER BY version',
      [tUser.id, policy.id]);
    expect(acks.map((a) => a.version)).toEqual([1]);

    // Version history holds both versions, newest first in the detail view.
    const detail = await therapist.get(`/api/rh2/resources/${policy.id}`);
    expect(detail.body.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(detail.body.versions[0].change_kind).toBe('material');
    expect(detail.body.versions[0].change_note).toBe('Rewrote escalation steps');
    expect(detail.body.userState.acknowledgedVersion).toBe(1);
    expect(detail.body.userState.acknowledgedCurrent).toBe(false);

    // The policy is required again at v2…
    const home = await therapist.get('/api/rh2/home');
    expect(home.body.requiredForYou.map((r) => r.id)).toContain(policy.id);

    // …and affected users were notified.
    const { rows: notifs } = await db.pool.query(
      `SELECT type FROM user_notifications WHERE user_id = $1 AND type = 'policy_update'`, [tUser.id]);
    expect(notifs.length).toBe(1);

    // Re-acknowledging at v2 clears it and both rows coexist.
    await therapist.post(`/api/rh2/resources/${policy.id}/acknowledge`);
    const { rows: allAcks } = await db.pool.query(
      'SELECT version FROM policy_acknowledgements WHERE user_id = $1 AND resource_id = $2 ORDER BY version',
      [tUser.id, policy.id]);
    expect(allAcks.map((a) => a.version)).toEqual([1, 2]);

    // MINOR edit: version history advances to v3, but the v2 acknowledgement
    // stays sufficient — a typo-level edit never re-flags staff.
    const minor = await owner.patch(`/api/rh2/resources/${policy.id}`)
      .send({ content: 'v2 content, typo fixed', changeKind: 'minor', changeNote: 'Fixed a typo' });
    expect(minor.status).toBe(200);
    expect(minor.body.resource.version).toBe(3);

    const afterMinor = await therapist.get(`/api/rh2/resources/${policy.id}`);
    expect(afterMinor.body.versions.map((v) => v.version)).toEqual([3, 2, 1]);
    expect(afterMinor.body.versions[0].change_kind).toBe('minor');
    expect(afterMinor.body.userState.acknowledgedVersion).toBe(2);
    expect(afterMinor.body.userState.acknowledgedCurrent).toBe(true);

    const homeAfterMinor = await therapist.get('/api/rh2/home');
    expect(homeAfterMinor.body.requiredForYou.map((r) => r.id)).not.toContain(policy.id);

    // No fresh re-acknowledgement notification was sent for the minor edit.
    const { rows: notifsAfterMinor } = await db.pool.query(
      `SELECT type FROM user_notifications WHERE user_id = $1 AND type = 'policy_update'`, [tUser.id]);
    expect(notifsAfterMinor.length).toBe(1);

    // The learning-path view agrees: the item still reads as acknowledged.
    const { rows: [minorPath] } = await db.pool.query(
      `INSERT INTO learning_paths (organisation_id, key, name) VALUES (NULL, 'ack-check', 'Ack Check') RETURNING *`);
    await db.pool.query(
      `INSERT INTO learning_path_items (path_id, resource_id, sort_order) VALUES ($1,$2,1)`,
      [minorPath.id, policy.id]);
    const learning = await therapist.get('/api/rh2/learning/ack-check');
    expect(learning.body.path.items[0].acknowledged).toBe(true);
  });

  test('acknowledge on a resource that does not require it is 400', async () => {
    const app = buildApp();
    const { agent: owner } = await agentFor(app, 'owner');
    const draft = await createDraft(owner, { title: 'Plain Article' });
    await owner.post(`/api/rh2/resources/${draft.id}/approve`);
    expect((await owner.post(`/api/rh2/resources/${draft.id}/acknowledge`)).status).toBe(400);
  });
});

// ═══ Favourites + completion ═════════════════════════════════════════════════

describe('favourites and completion', () => {
  test('favourite / unfavourite round-trip shows in detail userState', async () => {
    const app = buildApp();
    const { agent: owner } = await agentFor(app, 'owner');
    const { agent: therapist } = await agentFor(app, 'therapist');
    const r = await createDraft(owner, { title: 'Fav Target' });
    await owner.post(`/api/rh2/resources/${r.id}/approve`);

    expect((await therapist.post(`/api/rh2/resources/${r.id}/favourite`)).status).toBe(200);
    let detail = await therapist.get(`/api/rh2/resources/${r.id}`);
    expect(detail.body.userState.favourited).toBe(true);

    expect((await therapist.delete(`/api/rh2/resources/${r.id}/favourite`)).status).toBe(200);
    detail = await therapist.get(`/api/rh2/resources/${r.id}`);
    expect(detail.body.userState.favourited).toBe(false);
  });

  test('complete / uncomplete drives mandatory requiredForYou', async () => {
    const app = buildApp();
    const { agent: owner } = await agentFor(app, 'owner');
    const { agent: therapist } = await agentFor(app, 'therapist');
    const r = await createDraft(owner, { title: 'Mandatory Module', mandatory: true });
    await owner.post(`/api/rh2/resources/${r.id}/approve`);

    let home = await therapist.get('/api/rh2/home');
    expect(home.body.requiredForYou.map((x) => x.id)).toContain(r.id);

    expect((await therapist.post(`/api/rh2/resources/${r.id}/complete`)).status).toBe(200);
    home = await therapist.get('/api/rh2/home');
    expect(home.body.requiredForYou.map((x) => x.id)).not.toContain(r.id);

    expect((await therapist.delete(`/api/rh2/resources/${r.id}/complete`)).status).toBe(200);
    home = await therapist.get('/api/rh2/home');
    expect(home.body.requiredForYou.map((x) => x.id)).toContain(r.id);
  });

  test('requiredForYou respects target_roles: untargeted for everyone, targeted only for the named role', async () => {
    const app = buildApp();
    const { agent: owner } = await agentFor(app, 'owner');
    const { agent: admin } = await agentFor(app, 'admin');
    const { agent: therapist } = await agentFor(app, 'therapist');

    const everyone = await createDraft(owner, { title: 'For Everyone', mandatory: true });
    const adminsOnly = await createDraft(owner, { title: 'For Admins', mandatory: true, targetRoles: ['admin'] });
    await owner.post(`/api/rh2/resources/${everyone.id}/approve`);
    await owner.post(`/api/rh2/resources/${adminsOnly.id}/approve`);

    const tHome = await therapist.get('/api/rh2/home');
    expect(tHome.body.requiredForYou.map((r) => r.id)).toContain(everyone.id);
    expect(tHome.body.requiredForYou.map((r) => r.id)).not.toContain(adminsOnly.id);

    const aHome = await admin.get('/api/rh2/home');
    expect(aHome.body.requiredForYou.map((r) => r.id)).toContain(everyone.id);
    expect(aHome.body.requiredForYou.map((r) => r.id)).toContain(adminsOnly.id);
  });

  test('saved=1 filters the library to the user\'s own favourites', async () => {
    const app = buildApp();
    const { agent: owner } = await agentFor(app, 'owner');
    const { agent: therapist } = await agentFor(app, 'therapist');
    const { agent: other } = await agentFor(app, 'therapist');

    const a = await createDraft(owner, { title: 'Saved One' });
    const b = await createDraft(owner, { title: 'Not Saved' });
    await owner.post(`/api/rh2/resources/${a.id}/approve`);
    await owner.post(`/api/rh2/resources/${b.id}/approve`);
    await therapist.post(`/api/rh2/resources/${a.id}/favourite`);

    const saved = await therapist.get('/api/rh2/resources').query({ saved: '1' });
    expect(saved.status).toBe(200);
    expect(saved.body.resources.map((r) => r.title)).toEqual(['Saved One']);

    // Strictly per-user: another user's saved view is empty.
    expect((await other.get('/api/rh2/resources').query({ saved: '1' })).body.resources).toHaveLength(0);
  });

  test('feedback is validated and stored', async () => {
    const app = buildApp();
    const { agent: owner } = await agentFor(app, 'owner');
    const { agent: therapist } = await agentFor(app, 'therapist');
    const r = await createDraft(owner, { title: 'Feedback Target' });
    await owner.post(`/api/rh2/resources/${r.id}/approve`);

    expect((await therapist.post(`/api/rh2/resources/${r.id}/feedback`).send({ kind: 'shouty' })).status).toBe(400);
    expect((await therapist.post(`/api/rh2/resources/${r.id}/feedback`)
      .send({ kind: 'needs_update', comment: 'Rates are stale' })).status).toBe(200);
    const { rows } = await db.pool.query('SELECT * FROM resource_feedback WHERE resource_id = $1', [r.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('needs_update');
  });
});

// ═══ Learning paths ══════════════════════════════════════════════════════════

describe('learning paths', () => {
  test('items come back in sort order with per-item completion and path percentage', async () => {
    const app = buildApp();
    const { agent: owner } = await agentFor(app, 'owner');
    const { agent: therapist } = await agentFor(app, 'therapist');

    const first = await createDraft(owner, { title: 'Step One' });
    const second = await createDraft(owner, { title: 'Step Two' });
    await owner.post(`/api/rh2/resources/${first.id}/approve`);
    await owner.post(`/api/rh2/resources/${second.id}/approve`);

    const { rows: [path] } = await db.pool.query(
      `INSERT INTO learning_paths (organisation_id, key, name) VALUES (NULL, 'new-starter', 'New Starter') RETURNING *`);
    await db.pool.query(
      `INSERT INTO learning_path_items (path_id, resource_id, sort_order) VALUES ($1,$2,2), ($1,$3,1)`,
      [path.id, first.id, second.id]);

    let learning = await therapist.get('/api/rh2/learning');
    expect(learning.status).toBe(200);
    expect(learning.body.paths).toHaveLength(1);
    // sort_order 1 (Step Two) before sort_order 2 (Step One)
    expect(learning.body.paths[0].items.map((i) => i.title)).toEqual(['Step Two', 'Step One']);
    expect(learning.body.paths[0].percent).toBe(0);

    await therapist.post(`/api/rh2/resources/${second.id}/complete`);
    const detail = await therapist.get('/api/rh2/learning/new-starter');
    expect(detail.status).toBe(200);
    expect(detail.body.path.completed).toBe(1);
    expect(detail.body.path.total).toBe(2);
    expect(detail.body.path.percent).toBe(50);
    expect(detail.body.path.items.find((i) => i.title === 'Step Two').completed).toBe(true);

    // Home continueLearning mirrors the same numbers
    const home = await therapist.get('/api/rh2/home');
    expect(home.body.continueLearning[0].percent).toBe(50);

    expect((await therapist.get('/api/rh2/learning/no-such-path')).status).toBe(404);
  });
});

// ═══ Search ══════════════════════════════════════════════════════════════════

describe('search and search misses', () => {
  test('finds by tag alias; filters and sorts work', async () => {
    const app = buildApp();
    const { agent: owner } = await agentFor(app, 'owner');
    const { agent: therapist } = await agentFor(app, 'therapist');

    const { rows: [tag] } = await db.pool.query(
      `INSERT INTO resource_tags (category, name, aliases) VALUES ('therapy_area', 'Telepractice', '["telehealth","remote"]')
       ON CONFLICT (category, name) DO UPDATE SET aliases = EXCLUDED.aliases RETURNING *`);
    const r = await createDraft(owner, { title: 'Remote Session Guide', tagIds: [tag.id], contentType: 'guide' });
    await owner.post(`/api/rh2/resources/${r.id}/approve`);

    const byAlias = await therapist.get('/api/rh2/resources').query({ q: 'telehealth' });
    expect(byAlias.status).toBe(200);
    expect(byAlias.body.resources.map((x) => x.id)).toContain(r.id);

    const byType = await therapist.get('/api/rh2/resources').query({ contentType: 'guide' });
    expect(byType.body.resources.map((x) => x.id)).toContain(r.id);
    const byWrongType = await therapist.get('/api/rh2/resources').query({ contentType: 'policy' });
    expect(byWrongType.body.resources).toHaveLength(0);
  });

  test('zero-result search upserts an aggregate miss with no user linkage', async () => {
    const app = buildApp();
    const { agent: therapist } = await agentFor(app, 'therapist');
    const { agent: owner } = await agentFor(app, 'owner');

    expect((await therapist.get('/api/rh2/resources').query({ q: 'sensory diet unicorn' })).body.resources).toHaveLength(0);
    expect((await owner.get('/api/rh2/resources').query({ q: 'Sensory Diet UNICORN' })).body.resources).toHaveLength(0);

    const { rows } = await db.pool.query('SELECT * FROM search_misses');
    expect(rows).toHaveLength(1); // aggregated case-insensitively, both users
    expect(rows[0].term).toBe('sensory diet unicorn');
    expect(rows[0].miss_count).toBe(2);
    // No user linkage by design — neither a column nor metadata.
    expect(Object.keys(rows[0])).toEqual(
      expect.not.arrayContaining(['user_id', 'created_by', 'searched_by']));
  });
});

// ═══ Quizzes ═════════════════════════════════════════════════════════════════

describe('knowledge checks', () => {
  async function seedQuiz(owner, threshold = 80) {
    const r = await createDraft(owner, { title: 'Quiz Module' });
    await owner.post(`/api/rh2/resources/${r.id}/approve`);
    const { rows: [quiz] } = await db.pool.query(
      'INSERT INTO quizzes (resource_id, pass_threshold) VALUES ($1,$2) RETURNING *', [r.id, threshold]);
    await db.pool.query(
      `INSERT INTO quiz_questions (quiz_id, sort_order, question, options, correct_index) VALUES
       ($1, 1, 'Q1', '["a","b","c"]', 1), ($1, 2, 'Q2', '["x","y"]', 0)`, [quiz.id]);
    return r;
  }

  test('correct_index is hidden from non-owners in detail but visible to the owner', async () => {
    const app = buildApp();
    const { agent: owner } = await agentFor(app, 'owner');
    const { agent: therapist } = await agentFor(app, 'therapist');
    const r = await seedQuiz(owner);

    const tDetail = await therapist.get(`/api/rh2/resources/${r.id}`);
    expect(tDetail.body.quiz.questions).toHaveLength(2);
    for (const q of tDetail.body.quiz.questions) expect(q.correctIndex).toBeUndefined();

    const oDetail = await owner.get(`/api/rh2/resources/${r.id}`);
    expect(oDetail.body.quiz.questions[0].correctIndex).toBe(1);
  });

  test('server-side scoring: fail below threshold, pass auto-completes the resource', async () => {
    const app = buildApp();
    const { agent: owner } = await agentFor(app, 'owner');
    const { agent: therapist, user: tUser } = await agentFor(app, 'therapist');
    const r = await seedQuiz(owner, 80);

    expect((await therapist.post(`/api/rh2/resources/${r.id}/quiz-attempt`).send({ answers: [1] })).status).toBe(400);

    const fail = await therapist.post(`/api/rh2/resources/${r.id}/quiz-attempt`).send({ answers: [0, 1] });
    expect(fail.status).toBe(200);
    expect(fail.body).toMatchObject({ score: 0, total: 2, passed: false });
    let { rows: prog } = await db.pool.query(
      'SELECT 1 FROM user_learning_progress WHERE user_id = $1 AND resource_id = $2', [tUser.id, r.id]);
    expect(prog).toHaveLength(0);

    // 1 of 2 = 50% — still below the 80% threshold
    const half = await therapist.post(`/api/rh2/resources/${r.id}/quiz-attempt`).send({ answers: [1, 1] });
    expect(half.body).toMatchObject({ score: 1, total: 2, passed: false });

    const pass = await therapist.post(`/api/rh2/resources/${r.id}/quiz-attempt`).send({ answers: [1, 0] });
    expect(pass.body).toMatchObject({ score: 2, total: 2, percent: 100, passed: true });
    ({ rows: prog } = await db.pool.query(
      'SELECT 1 FROM user_learning_progress WHERE user_id = $1 AND resource_id = $2', [tUser.id, r.id]));
    expect(prog).toHaveLength(1);

    const { rows: attempts } = await db.pool.query('SELECT * FROM quiz_attempts WHERE user_id = $1', [tUser.id]);
    expect(attempts).toHaveLength(3);
  });
});

// ═══ External sources ════════════════════════════════════════════════════════

describe('external sources', () => {
  test('owner-only CRUD and the verify flow', async () => {
    const app = buildApp();
    const { agent: owner } = await agentFor(app, 'owner');
    const { agent: admin } = await agentFor(app, 'admin');

    expect((await admin.get('/api/rh2/sources')).status).toBe(403);
    expect((await admin.post('/api/rh2/sources').send({ name: 'X', url: 'https://x.invalid' })).status).toBe(403);

    const created = await owner.post('/api/rh2/sources')
      .send({ name: 'NDIS Price Guide', url: 'https://example.invalid/guide', authority: 'official_regulatory' });
    expect(created.status).toBe(201);
    const source = created.body.source;
    expect(source.status).toBe('current');

    // Simulate what check-now would have persisted after a detected change.
    await db.pool.query(
      `UPDATE external_sources SET status = 'source_changed', change_detected_at = NOW(),
              verified_after_change = FALSE, content_hash = 'newhash' WHERE id = $1`, [source.id]);

    const listed = await owner.get('/api/rh2/sources');
    expect(listed.body.sources[0].freshness).toBe('source_changed');

    expect((await admin.post(`/api/rh2/sources/${source.id}/verify`)).status).toBe(403);
    const verified = await owner.post(`/api/rh2/sources/${source.id}/verify`);
    expect(verified.status).toBe(200);
    expect(verified.body.source.status).toBe('current');
    expect(verified.body.source.verified_after_change).toBe(true);
    expect(verified.body.source.last_verified_at).toBeTruthy();
  });

  test('isPrivateIp blocks loopback, RFC1918, link-local, multicast, unspecified and IPv6 equivalents', () => {
    const priv = [
      '127.0.0.1', '127.255.255.254',          // 127/8
      '10.0.0.1', '10.255.255.255',            // 10/8
      '172.16.0.1', '172.31.255.255',          // 172.16/12
      '192.168.0.1', '192.168.255.1',          // 192.168/16
      '169.254.1.1', '169.254.169.254',        // link-local + metadata IP
      '224.0.0.1', '239.255.255.255', '255.255.255.255', // 224/4 + broadcast
      '0.0.0.0', '0.1.2.3',                    // unspecified / 0/8
      '::1', '::',                             // v6 loopback + unspecified
      'fe80::1', 'febf::1',                    // fe80::/10
      'fc00::1', 'fd12:3456::1',               // fc00::/7
      'ff02::1',                               // v6 multicast
      '::ffff:127.0.0.1', '::ffff:10.0.0.1',   // v4-mapped
    ];
    for (const ip of priv) expect({ ip, private: isPrivateIp(ip) }).toEqual({ ip, private: true });

    const pub = [
      '8.8.8.8', '1.1.1.1', '203.0.113.7',
      '172.15.0.1', '172.32.0.1', '192.169.0.1', '170.254.1.1',
      '2001:4860:4860::8888', '::ffff:8.8.8.8',
    ];
    for (const ip of pub) expect({ ip, private: isPrivateIp(ip) }).toEqual({ ip, private: false });

    // Not a parseable IP at all — treated as unsafe.
    expect(isPrivateIp('not-an-ip')).toBe(true);
    expect(isPrivateIp('')).toBe(true);
  });

  test('urlHopIssue vets every hop: scheme allowlist, hostname blocklist, literal private IPs', () => {
    // rejected
    expect(urlHopIssue('javascript:alert(1)')).toBeTruthy();
    expect(urlHopIssue('data:text/html,x')).toBeTruthy();
    expect(urlHopIssue('file:///etc/passwd')).toBeTruthy();
    expect(urlHopIssue('ftp://example.com/x')).toBeTruthy();
    expect(urlHopIssue('not a url')).toBeTruthy();
    expect(urlHopIssue('http://localhost:5001/api')).toBeTruthy();
    expect(urlHopIssue('http://sub.localhost/x')).toBeTruthy();
    expect(urlHopIssue('http://printer.local/x')).toBeTruthy();
    expect(urlHopIssue('http://metadata.google.internal/computeMetadata/v1/')).toBeTruthy();
    expect(urlHopIssue('http://127.0.0.1/x')).toBeTruthy();
    expect(urlHopIssue('http://10.1.2.3/x')).toBeTruthy();
    expect(urlHopIssue('http://169.254.169.254/latest/meta-data/')).toBeTruthy();
    expect(urlHopIssue('http://[::1]/x')).toBeTruthy();
    expect(urlHopIssue('http://[fe80::1]/x')).toBeTruthy();
    // allowed (DNS-resolved addresses are then checked separately per hop)
    expect(urlHopIssue('https://www.ndis.gov.au/providers')).toBeNull();
    expect(urlHopIssue('http://example.com/doc.pdf')).toBeNull();
    expect(urlHopIssue('https://203.0.113.7/report')).toBeNull();
  });

  test('hash/etag/last-modified diff logic flags changes without touching resources', () => {
    const stored = { etag: 'W/"abc"', last_modified: 'Mon, 01 Jun 2026 00:00:00 GMT', content_hash: 'hash1' };

    // Identical metadata: no change
    expect(computeSourceCheckUpdate(stored, {
      httpStatus: 200, etag: 'W/"abc"', lastModified: 'Mon, 01 Jun 2026 00:00:00 GMT', contentHash: 'hash1',
    }).changed).toBe(false);

    // New etag: change detected
    expect(computeSourceCheckUpdate(stored, { httpStatus: 200, etag: 'W/"def"' }).changed).toBe(true);

    // New body hash: change detected
    expect(computeSourceCheckUpdate(stored, { httpStatus: 200, contentHash: 'hash2' }).changed).toBe(true);

    // First-ever check (nothing stored): baseline recorded, no change flagged
    const fresh = computeSourceCheckUpdate({ etag: null, last_modified: null, content_hash: null },
      { httpStatus: 200, etag: 'W/"abc"', contentHash: 'hash1' });
    expect(fresh.changed).toBe(false);
    expect(fresh.etag).toBe('W/"abc"');
    expect(fresh.content_hash).toBe('hash1');

    // Fetch failure keeps stored fingerprints and flags nothing
    const failed = computeSourceCheckUpdate(stored, { httpStatus: null, etag: null, lastModified: null, contentHash: null });
    expect(failed.changed).toBe(false);
    expect(failed.content_hash).toBe('hash1');
  });
});

// ═══ PD events ═══════════════════════════════════════════════════════════════

describe('PD events', () => {
  test('CRUD is admin/owner; everyone reads; past events are lazily flipped', async () => {
    const app = buildApp();
    const { agent: admin } = await agentFor(app, 'admin');
    const { agent: therapist } = await agentFor(app, 'therapist');

    expect((await therapist.post('/api/rh2/pd').send({ title: 'Nope' })).status).toBe(403);
    expect((await admin.post('/api/rh2/pd').send({ title: 'Bad mode', mode: 'astral' })).status).toBe(400);

    const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const past = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const upcoming = await admin.post('/api/rh2/pd')
      .send({ title: 'Sensory Workshop', startsAt: future, mode: 'online', cpdHours: 2 });
    expect(upcoming.status).toBe(201);
    const old = await admin.post('/api/rh2/pd').send({ title: 'Old Seminar', startsAt: past, endsAt: past });
    expect(old.status).toBe(201);

    const listed = await therapist.get('/api/rh2/pd');
    expect(listed.status).toBe(200);
    expect(listed.body.upcoming.map((e) => e.title)).toEqual(['Sensory Workshop']);
    expect(listed.body.past.map((e) => e.title)).toEqual(['Old Seminar']);

    const patched = await admin.patch(`/api/rh2/pd/${upcoming.body.event.id}`).send({ location: 'Perth' });
    expect(patched.status).toBe(200);
    expect(patched.body.event.location).toBe('Perth');
    expect((await therapist.patch(`/api/rh2/pd/${upcoming.body.event.id}`).send({ location: 'X' })).status).toBe(403);

    expect((await admin.delete(`/api/rh2/pd/${old.body.event.id}`)).status).toBe(200);
    expect((await db.pool.query('SELECT * FROM pd_events')).rows).toHaveLength(1);

    // Home shows the next upcoming events
    const home = await therapist.get('/api/rh2/home');
    expect(home.body.upcomingPd.map((e) => e.title)).toEqual(['Sensory Workshop']);
  });
});

// ═══ CPD entries ═════════════════════════════════════════════════════════════

describe('CPD tracker', () => {
  test('entries are strictly own-only across users, all roles can use it', async () => {
    const app = buildApp();
    const { agent: userA } = await agentFor(app, 'therapist');
    const { agent: userB } = await agentFor(app, 'therapist');

    const created = await userA.post('/api/rh2/cpd')
      .send({ activity: 'Supervision session', activityDate: '2026-07-01', hours: 1.5, interactiveHours: 1.5 });
    expect(created.status).toBe(201);
    const entryId = created.body.entry.id;

    expect((await userA.get('/api/rh2/cpd')).body.entries).toHaveLength(1);
    expect((await userB.get('/api/rh2/cpd')).body.entries).toHaveLength(0);
    expect((await userB.patch(`/api/rh2/cpd/${entryId}`).send({ hours: 99 })).status).toBe(404);
    expect((await userB.delete(`/api/rh2/cpd/${entryId}`)).status).toBe(404);

    const patched = await userA.patch(`/api/rh2/cpd/${entryId}`).send({ hours: 2 });
    expect(patched.status).toBe(200);
    expect(Number(patched.body.entry.hours)).toBe(2);
    expect((await userA.delete(`/api/rh2/cpd/${entryId}`)).status).toBe(200);
    expect((await userA.get('/api/rh2/cpd')).body.entries).toHaveLength(0);
  });

  test('summary uses the Dec 1 – Nov 30 registration year and carries the responsibility note', async () => {
    const app = buildApp();
    const { agent: therapist } = await agentFor(app, 'therapist');

    for (const [date, hours, interactive] of [
      ['2025-12-15', 2, 1],   // inside 2026 registration year
      ['2026-11-15', 3, 0],   // inside
      ['2026-12-05', 10, 10], // next registration year — excluded
      ['2025-11-30', 10, 10], // previous registration year — excluded
    ]) {
      const res = await therapist.post('/api/rh2/cpd')
        .send({ activity: 'PD activity', activityDate: date, hours, interactiveHours: interactive });
      expect(res.status).toBe(201);
    }

    const summary = await therapist.get('/api/rh2/cpd/summary').query({ year: 2026 });
    expect(summary.status).toBe(200);
    expect(summary.body.periodStart).toBe('2025-12-01');
    expect(summary.body.periodEnd).toBe('2026-11-30');
    expect(summary.body.entryCount).toBe(2);
    expect(summary.body.totalHours).toBe(5);
    expect(summary.body.interactiveHours).toBe(1);
    expect(summary.body.note).toMatch(/remains with the practitioner/);
  });
});

// ═══ Analytics + quick links + home ══════════════════════════════════════════

describe('analytics and quick links', () => {
  test('analytics: owner and admin ok, therapist 403; payload aggregates real activity', async () => {
    const app = buildApp();
    const { agent: owner } = await agentFor(app, 'owner');
    const { agent: admin } = await agentFor(app, 'admin');
    const { agent: therapist, user: tUser } = await agentFor(app, 'therapist');

    const policy = await createDraft(owner, { title: 'Ack Policy', acknowledgementRequired: true });
    await owner.post(`/api/rh2/resources/${policy.id}/approve`);
    await therapist.get(`/api/rh2/resources/${policy.id}`); // records a view (fire-and-forget)
    await db.pool.query('INSERT INTO resource_views (user_id, resource_id) VALUES ($1,$2)', [tUser.id, policy.id]);
    await therapist.post(`/api/rh2/resources/${policy.id}/favourite`);
    await therapist.post(`/api/rh2/resources/${policy.id}/acknowledge`);
    await therapist.get('/api/rh2/resources').query({ q: 'nothing matches this' });

    expect((await therapist.get('/api/rh2/admin/analytics')).status).toBe(403);

    for (const agent of [owner, admin]) {
      const res = await agent.get('/api/rh2/admin/analytics');
      expect(res.status).toBe(200);
      for (const key of ['mostViewed', 'mostSaved', 'mostCompleted', 'searchMisses',
        'ackCompletion', 'pathCompletion', 'staleResources', 'feedback']) {
        expect(Array.isArray(res.body[key])).toBe(true);
      }
      expect(res.body.mostViewed[0].id).toBe(policy.id);
      expect(res.body.mostSaved[0].id).toBe(policy.id);
      expect(res.body.searchMisses[0].term).toBe('nothing matches this');
      const ack = res.body.ackCompletion.find((a) => a.id === policy.id);
      expect(ack.acknowledged_users).toBe(1);
      expect(ack.active_users).toBe(3); // owner + admin + therapist
    }
  });

  test('quick links: admin manages, everyone sees them on home, inactive links disappear', async () => {
    const app = buildApp();
    const { agent: admin } = await agentFor(app, 'admin');
    const { agent: therapist } = await agentFor(app, 'therapist');

    expect((await admin.post('/api/rh2/quick-links').send({ label: 'No URL' })).status).toBe(400);
    const created = await admin.post('/api/rh2/quick-links')
      .send({ label: 'NDIS Portal', url: 'https://example.invalid/ndis', sortOrder: 1 });
    expect(created.status).toBe(201);

    let home = await therapist.get('/api/rh2/home');
    expect(home.body.quickLinks.map((l) => l.label)).toEqual(['NDIS Portal']);

    const off = await admin.patch(`/api/rh2/quick-links/${created.body.quickLink.id}`).send({ isActive: false });
    expect(off.status).toBe(200);
    home = await therapist.get('/api/rh2/home');
    expect(home.body.quickLinks).toHaveLength(0);

    expect((await admin.delete(`/api/rh2/quick-links/${created.body.quickLink.id}`)).status).toBe(200);
  });

  test('GET /api/rh2/quick-links: admin/owner list every link including inactive, sorted; therapist 403', async () => {
    const app = buildApp();
    const { agent: owner } = await agentFor(app, 'owner');
    const { agent: admin } = await agentFor(app, 'admin');
    const { agent: therapist } = await agentFor(app, 'therapist');

    const b = await admin.post('/api/rh2/quick-links')
      .send({ label: 'B Link', url: 'https://example.invalid/b', sortOrder: 2 });
    const a = await admin.post('/api/rh2/quick-links')
      .send({ label: 'A Link', url: 'https://example.invalid/a', sortOrder: 1 });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    await admin.patch(`/api/rh2/quick-links/${b.body.quickLink.id}`).send({ isActive: false });

    expect((await therapist.get('/api/rh2/quick-links')).status).toBe(403);

    for (const agent of [owner, admin]) {
      const res = await agent.get('/api/rh2/quick-links');
      expect(res.status).toBe(200);
      // sorted by sort_order, and the hidden link is still listed for admins
      expect(res.body.quickLinks.map((l) => l.label)).toEqual(['A Link', 'B Link']);
      expect(res.body.quickLinks.map((l) => l.is_active)).toEqual([true, false]);
    }

    // Home keeps serving only active links to everyone.
    const home = await therapist.get('/api/rh2/home');
    expect(home.body.quickLinks.map((l) => l.label)).toEqual(['A Link']);
  });

  test('home payload has a sane shape on a completely empty database', async () => {
    const app = buildApp();
    const { agent: therapist } = await agentFor(app, 'therapist');
    const res = await therapist.get('/api/rh2/home');
    expect(res.status).toBe(200);
    for (const key of ['collections', 'continueLearning', 'requiredForYou', 'whatsNew',
      'popular', 'recentlyAdded', 'upcomingPd', 'quickLinks']) {
      expect(res.body[key]).toEqual([]);
    }
  });
});
