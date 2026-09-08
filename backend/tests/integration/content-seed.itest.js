'use strict';

/**
 * Content seeds (backend/scripts/content-seed.js) — export → import round trip
 * against a real database.
 *
 * Covers: ids preserved across the trip, organisation and author columns
 * remapped to the target, deferred self-references (folder tree) restored,
 * natural-key collisions resolved in favour of the seeded id, stale rows in
 * the target org deleted, rows outside the org untouched, and the
 * unexported-edits guard with its --force override.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const pg = require('pg');

const { db, truncateAll, seedUser, seedOrganisation, closePool } = require('./helpers');
const seed = require('../../scripts/content-seed');

seed.withTextDates(pg);

let tmp, dir, stateFile;
let org, owner, otherOrg;

beforeEach(async () => {
  await truncateAll();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'content-seed-'));
  dir = path.join(tmp, 'seeds');
  stateFile = path.join(tmp, 'state.json');
  org = await seedOrganisation('Opal Therapy');
  otherOrg = await seedOrganisation('Elsewhere');
  owner = await seedUser({ role: 'owner', organisation_id: org.id, email: 'owner@opaltherapy.dev' });
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));
afterAll(closePool);

const opts = () => ({ dir, stateFile });

async function authorContent(orgId, userId) {
  const q = (sql, p) => db.pool.query(sql, p).then((r) => r.rows[0]);
  const parent = await q(
    `INSERT INTO resource_folders (organisation_id, name, slug, created_by) VALUES ($1, 'Clinical', 'clinical', $2) RETURNING *`, [orgId, userId]);
  const child = await q(
    `INSERT INTO resource_folders (organisation_id, parent_id, name, slug, created_by) VALUES ($1, $2, 'Paediatrics', 'paediatrics', $3) RETURNING *`, [orgId, parent.id, userId]);
  const res = await q(
    `INSERT INTO resources (organisation_id, folder_id, title, slug, resource_type, status, created_by)
     VALUES ($1, $2, 'Sensory diet guide', 'sensory-diet-guide', 'guide', 'approved', $3) RETURNING *`, [orgId, child.id, userId]);
  // resource_tags is global (no org) and outside truncateAll: reuse across tests.
  await db.pool.query(`DELETE FROM resource_tags WHERE category = 'topic' AND name = 'sensory'`);
  const tag = await q(`INSERT INTO resource_tags (category, name) VALUES ('topic', 'sensory') RETURNING *`);
  await db.pool.query(`INSERT INTO resource_tag_links (resource_id, tag_id) VALUES ($1, $2)`, [res.id, tag.id]);
  const wf = await q(
    `INSERT INTO learning_workflows (organisation_id, title, category, status, draft_content, created_by)
     VALUES ($1, 'New Starter — OT', 'induction', 'active', '{"sections":[]}', $2) RETURNING *`, [orgId, userId]);
  await db.pool.query(
    `INSERT INTO learning_workflow_versions (workflow_id, version, title, category, content, published_by)
     VALUES ($1, 1, 'New Starter — OT', 'induction', '{"sections":[]}', $2)`, [wf.id, userId]);
  const doc = await q(
    `INSERT INTO onboarding_documents (organisation_id, code, title, category, created_by)
     VALUES ($1, 'code-of-conduct', 'Code of Conduct', 'policy', $2) RETURNING *`, [orgId, userId]);
  const pkg = await q(
    `INSERT INTO onboarding_packages (organisation_id, code, title, kind, created_by)
     VALUES ($1, 'ot-starter', 'OT Starter', 'package', $2) RETURNING *`, [orgId, userId]);
  const tpl = await q(
    `INSERT INTO onboarding_requirement_templates (organisation_id, code, title, section, classification, handler, actor, document_id, learning_workflow_id, created_by)
     VALUES ($1, 'read-conduct', 'Read the Code of Conduct', 'policies', 'OPAL_POLICY', 'document_ack', 'employee', $2, $3, $4) RETURNING *`,
    [orgId, doc.id, wf.id, userId]);
  await db.pool.query(
    `INSERT INTO onboarding_package_requirements (package_id, template_id, sort_order) VALUES ($1, $2, 1)`, [pkg.id, tpl.id]);
  return { parent, child, res, tag, wf, doc, pkg, tpl };
}

const count = async (table, where = '', p = []) =>
  Number((await db.pool.query(`SELECT count(*)::int AS n FROM ${table} ${where}`, p)).rows[0].n);

describe('content-seed export → import', () => {
  test('round-trips authored content into a fresh database with ids kept and ownership remapped', async () => {
    const a = await authorContent(org.id, owner.id);
    // Content in another org must never be exported or touched.
    const stranger = await seedUser({ role: 'owner', organisation_id: otherOrg.id });
    await db.pool.query(
      `INSERT INTO learning_workflows (organisation_id, title, category, status, created_by) VALUES ($1, 'Theirs', 'induction', 'active', $2)`,
      [otherOrg.id, stranger.id]);

    const { counts } = await seed.exportContent(db.pool, opts());
    expect(counts.learning_workflows).toBe(1);
    expect(counts.resource_folders).toBe(2);
    expect(counts.onboarding_package_requirements).toBe(1);
    const exported = JSON.parse(fs.readFileSync(path.join(dir, 'learning_workflows.json'), 'utf8'));
    expect(exported[0].organisation_id).toBeNull();
    expect(exported[0].created_by).toBe('OWNER');
    expect(fs.existsSync(path.join(dir, 'manifest.json'))).toBe(true);

    // A "fresh clone": same schema, a new organisation and owner, no content.
    await truncateAll();
    const org2 = await seedOrganisation('Opal Therapy');
    const owner2 = await seedUser({ role: 'owner', organisation_id: org2.id, email: 'owner@opaltherapy.dev' });
    fs.rmSync(stateFile, { force: true });

    const { summary } = await seed.importContent(db.pool, opts());
    expect(summary.resources.upserted).toBe(1);

    const wf = (await db.pool.query('SELECT * FROM learning_workflows')).rows;
    expect(wf).toHaveLength(1);
    expect(wf[0].id).toBe(a.wf.id);
    expect(wf[0].organisation_id).toBe(org2.id);
    expect(wf[0].created_by).toBe(owner2.id);

    const child = (await db.pool.query('SELECT * FROM resource_folders WHERE id = $1', [a.child.id])).rows[0];
    expect(child.parent_id).toBe(a.parent.id);
    const tpl = (await db.pool.query('SELECT * FROM onboarding_requirement_templates WHERE id = $1', [a.tpl.id])).rows[0];
    expect(tpl.document_id).toBe(a.doc.id);
    expect(tpl.learning_workflow_id).toBe(a.wf.id);
    expect(await count('resource_tag_links', 'WHERE resource_id = $1 AND tag_id = $2', [a.res.id, a.tag.id])).toBe(1);
    expect(await count('learning_workflow_versions', 'WHERE workflow_id = $1', [a.wf.id])).toBe(1);
  });

  test('import mirrors the seed: stale rows go, natural-key duplicates yield to the seeded id, other orgs untouched', async () => {
    const a = await authorContent(org.id, owner.id);
    await seed.exportContent(db.pool, opts());

    // Target state diverges: an extra induction (as the app's "Import existing
    // inductions" would create), a same-named tag under a different id, and a
    // workflow in another organisation.
    await db.pool.query(
      `INSERT INTO learning_workflows (organisation_id, title, category, status, created_by) VALUES ($1, 'Stale local', 'induction', 'active', $2)`,
      [org.id, owner.id]);
    await db.pool.query(`DELETE FROM resource_tag_links; DELETE FROM resource_tags`);
    await db.pool.query(`INSERT INTO resource_tags (category, name) VALUES ('topic', 'sensory')`);
    const stranger = await seedUser({ role: 'owner', organisation_id: otherOrg.id });
    await db.pool.query(
      `INSERT INTO learning_workflows (organisation_id, title, category, status, created_by) VALUES ($1, 'Theirs', 'induction', 'active', $2)`,
      [otherOrg.id, stranger.id]);

    const { summary } = await seed.importContent(db.pool, { ...opts(), force: true });
    expect(summary.learning_workflows.deleted).toBe(1);
    expect(await count('learning_workflows', 'WHERE organisation_id = $1', [org.id])).toBe(1);
    expect(await count('learning_workflows', 'WHERE organisation_id = $1', [otherOrg.id])).toBe(1);
    const tags = (await db.pool.query(`SELECT id FROM resource_tags WHERE category = 'topic' AND name = 'sensory'`)).rows;
    expect(tags.map((t) => t.id)).toEqual([a.tag.id]);
    expect(await count('resource_tag_links', 'WHERE tag_id = $1', [a.tag.id])).toBe(1);
  });

  test('refuses to overwrite unexported local edits unless forced', async () => {
    await authorContent(org.id, owner.id);
    await seed.exportContent(db.pool, opts());
    // Importing straight back is a no-op and allowed.
    await expect(seed.importContent(db.pool, opts())).resolves.toBeTruthy();

    await db.pool.query(`UPDATE learning_workflows SET title = 'Edited locally, never exported'`);
    await expect(seed.importContent(db.pool, opts())).rejects.toMatchObject({ code: 'UNEXPORTED_CHANGES' });
    expect((await db.pool.query('SELECT title FROM learning_workflows')).rows[0].title).toBe('Edited locally, never exported');

    await seed.importContent(db.pool, { ...opts(), force: true });
    expect((await db.pool.query('SELECT title FROM learning_workflows')).rows[0].title).toBe('New Starter — OT');
  });

  test('a seed column this database does not have is a clear error, not a partial import', async () => {
    await authorContent(org.id, owner.id);
    await seed.exportContent(db.pool, opts());
    const f = path.join(dir, 'learning_workflows.json');
    const rows = JSON.parse(fs.readFileSync(f, 'utf8'));
    rows[0].from_the_future = 1;
    fs.writeFileSync(f, JSON.stringify(rows));
    await db.pool.query('DELETE FROM learning_workflows');
    await expect(seed.importContent(db.pool, { ...opts(), force: true })).rejects.toThrow(/npm run migrate/);
    expect(await count('learning_workflows')).toBe(0);
  });
});
