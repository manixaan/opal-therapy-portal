#!/usr/bin/env node
'use strict';

/**
 * CONTENT SEEDS — authored content, versioned in git, loadable into any
 * local database.
 *
 * The code lives in git; the content the Owner authors in the app (inductions,
 * learning paths, onboarding packages and their policy documents, walkthrough
 * modules, the Resource Hub catalogue) lives in each developer's database.
 * This script moves that content through git so every clone sees the same
 * thing:
 *
 *   npm run content:export     # database  → seeds/content/*.json  (then commit)
 *   npm run content:import     # seeds/content/*.json → database   (after pull)
 *
 * WHAT TRAVELS. Only the tables listed in TABLES below — content a person
 * authored. No users, no calendar, no assignments, no employee records, no
 * assessments, no audit rows. Every row keeps its UUID across databases, so
 * cross-references (a package requirement → its template → its document)
 * survive intact. Two things legitimately differ per database and are
 * remapped on import: organisation_id becomes the target's organisation and
 * every "who did this" column (created_by, published_by, …) becomes the
 * target's owner login.
 *
 * WHAT DOES NOT TRAVEL. The Resource Hub's uploaded files (RESOURCE_HUB_STORAGE_PATH,
 * ~1.5 GB) stay out of git; the catalogue rows import with their storage
 * keys, and the bytes arrive by copying that folder or via Blob storage.
 *
 * IMPORT SEMANTICS. Within one transaction, per table: upsert every seeded
 * row by primary key, then delete rows in the target organisation that the
 * seed no longer contains — so a deletion made on one machine reaches the
 * other. Tables without an organisation column (tags) are upsert-only.
 *
 * SAFETY. The last synchronised state is fingerprinted in
 * backend/.content-seed-state.json (gitignored). An import that would
 * overwrite local edits nobody exported refuses unless --force is given.
 * A fresh clone has no state file and imports without question.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SEED_DIR = path.join(__dirname, '..', '..', 'seeds', 'content');
const STATE_FILE = path.join(__dirname, '..', '.content-seed-state.json');
const DEFAULT_OWNER_EMAIL = 'owner@opaltherapy.dev';

/**
 * Tables in dependency order (parents first). Each entry:
 *   pk        primary key column(s) — the upsert conflict target
 *   org       the organisation column (rows are scoped to one org, and
 *             stale rows in that org are deleted on import)
 *   parent    for child tables with no org column: the FK to the parent in
 *             this list, so "stale" means "under a seeded parent but absent"
 *   users     columns that reference users — rewritten to the target owner
 *   deferred  self/forward references NULLed on insert and applied in a
 *             second pass (parent_id in a folder tree, duplicate_of, …)
 *   natural   a UNIQUE constraint or index other than the pk (one key, or a
 *             list of keys). A target row holding the
 *             same natural key under a different id (a tag seeded locally, an
 *             induction the app's "Import existing inductions" created) is
 *             removed before the upsert so the seeded id wins
 *   omit      columns never exported (large or environment-bound)
 */
const TABLES = [
  { name: 'compliance_requirements', pk: ['id'], natural: ['organisation_id', 'code'], org: 'organisation_id', users: ['last_verified_by'], deferred: ['stored_document_id'] },
  { name: 'resource_tags', pk: ['id'], natural: ['category', 'name'] },
  { name: 'resource_folders', pk: ['id'], natural: ['organisation_id', 'slug'], org: 'organisation_id', users: ['created_by'], deferred: ['parent_id'] },
  { name: 'resources', pk: ['id'], natural: [['organisation_id', 'slug'], ['organisation_id', 'external_ref']], org: 'organisation_id', users: ['created_by', 'approved_by', 'content_owner'], deferred: ['duplicate_of', 'superseded_by'] },
  { name: 'resource_versions', pk: ['id'], natural: ['resource_id', 'version'], parent: 'resource_id', users: ['created_by'] },
  { name: 'resource_files', pk: ['id'], natural: ['resource_id', 'storage_key'], parent: 'resource_id', users: ['uploaded_by'], omit: ['file_data'] },
  { name: 'resource_tag_links', pk: ['resource_id', 'tag_id'], parent: 'resource_id' },
  { name: 'resource_folder_assignments', pk: ['resource_id'], org: 'organisation_id' },
  { name: 'resource_collections', pk: ['id'], natural: ['organisation_id', 'key'], org: 'organisation_id' },
  { name: 'resource_collection_items', pk: ['collection_id', 'resource_id'], parent: 'collection_id' },
  { name: 'resource_quick_links', pk: ['id'], org: 'organisation_id' },
  { name: 'quizzes', pk: ['id'], parent: 'resource_id' },
  { name: 'quiz_questions', pk: ['id'], parent: 'quiz_id' },
  { name: 'learning_paths', pk: ['id'], natural: ['organisation_id', 'key'], org: 'organisation_id' },
  { name: 'learning_path_items', pk: ['id'], natural: ['path_id', 'resource_id'], parent: 'path_id' },
  { name: 'learning_workflows', pk: ['id'], org: 'organisation_id', users: ['created_by'] },
  { name: 'learning_workflow_versions', pk: ['id'], natural: ['workflow_id', 'version'], parent: 'workflow_id', users: ['published_by'] },
  { name: 'walkthrough_modules', pk: ['id'], natural: ['organisation_id', 'key'], org: 'organisation_id', users: ['created_by'] },
  { name: 'walkthrough_module_versions', pk: ['id'], natural: ['module_id', 'version'], parent: 'module_id', users: ['published_by'] },
  { name: 'onboarding_documents', pk: ['id'], natural: ['organisation_id', 'code'], org: 'organisation_id', users: ['created_by'] },
  { name: 'onboarding_document_versions', pk: ['id'], natural: ['document_id', 'version'], parent: 'document_id', users: ['published_by'] },
  { name: 'onboarding_requirement_templates', pk: ['id'], natural: ['organisation_id', 'code'], org: 'organisation_id', users: ['created_by'] },
  { name: 'onboarding_packages', pk: ['id'], natural: ['organisation_id', 'code'], org: 'organisation_id', users: ['created_by'] },
  { name: 'onboarding_package_requirements', pk: ['id'], natural: ['package_id', 'template_id'], parent: 'package_id' },
  { name: 'onboarding_package_versions', pk: ['id'], natural: ['package_id', 'version'], parent: 'package_id', users: ['published_by'] },
  { name: 'onboarding_pack_defaults', pk: ['id'], natural: ['package_id', 'phase', 'code'], org: 'organisation_id', users: ['updated_by'] },
];

const parentTableOf = (col) => {
  // The parent column names its table by convention (resource_id → resources).
  const map = { resource_id: 'resources', collection_id: 'resource_collections', quiz_id: 'quizzes',
    path_id: 'learning_paths', workflow_id: 'learning_workflows', module_id: 'walkthrough_modules',
    document_id: 'onboarding_documents', package_id: 'onboarding_packages' };
  return map[col];
};

// ── Type handling ─────────────────────────────────────────────────────────────
// Dates and timestamps leave Postgres as strings (never JS Dates) so a seed
// file is byte-stable regardless of the exporting machine's timezone.
function withTextDates(pg) {
  const t = pg.types;
  for (const oid of [1082 /* date */, 1114 /* timestamp */, 1184 /* timestamptz */]) t.setTypeParser(oid, (v) => v);
}

async function columnTypes(client, table) {
  const { rows } = await client.query(
    `SELECT column_name, data_type, udt_name, is_nullable, character_maximum_length
       FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position`, [table]);
  if (!rows.length) throw new Error(`Table "${table}" does not exist — run the migrations first (npm run migrate)`);
  return Object.fromEntries(rows.map((r) => [r.column_name,
    { type: r.udt_name, nullable: r.is_nullable === 'YES', maxLength: r.character_maximum_length }]));
}

// ── Context: which organisation and which owner ───────────────────────────────
async function resolveContext(client, ownerEmail) {
  const email = ownerEmail || process.env.CONTENT_SEED_OWNER_EMAIL || DEFAULT_OWNER_EMAIL;
  let { rows } = await client.query(
    `SELECT id, organisation_id FROM users WHERE lower(email) = lower($1) AND role = 'owner'`, [email]);
  if (!rows.length) {
    ({ rows } = await client.query(
      `SELECT id, organisation_id FROM users WHERE role = 'owner' AND organisation_id IS NOT NULL ORDER BY created_at LIMIT 1`));
  }
  if (!rows.length || !rows[0].organisation_id) {
    throw new Error(`No owner login with an organisation found (looked for ${email}). Run node setup/seed-users.js first.`);
  }
  return { ownerId: rows[0].id, orgId: rows[0].organisation_id };
}

// ── Export ────────────────────────────────────────────────────────────────────
/** Read every content table for the org into { table: rows[] }, ids preserved. */
async function readContent(client, { orgId }) {
  const out = {};
  const seededIds = {}; // table → Set of pk values, for parent scoping
  for (const t of TABLES) {
    const types = await columnTypes(client, t.name);
    const cols = Object.keys(types).filter((c) => !(t.omit || []).includes(c));
    const order = t.pk.map((c) => `"${c}"`).join(', ');
    let rows;
    if (t.org) {
      ({ rows } = await client.query(
        `SELECT ${cols.map((c) => `"${c}"`).join(', ')} FROM "${t.name}" WHERE "${t.org}" = $1 ORDER BY ${order}`, [orgId]));
    } else if (t.parent) {
      const ids = [...(seededIds[parentTableOf(t.parent)] || [])];
      ({ rows } = await client.query(
        `SELECT ${cols.map((c) => `"${c}"`).join(', ')} FROM "${t.name}" WHERE "${t.parent}" = ANY($1::uuid[]) ORDER BY ${order}`, [ids]));
    } else {
      ({ rows } = await client.query(`SELECT ${cols.map((c) => `"${c}"`).join(', ')} FROM "${t.name}" ORDER BY ${order}`));
    }
    // Environment-bound columns are neutralised so the seed diff never churns
    // on who exported it or from which database.
    for (const r of rows) {
      if (t.org) r[t.org] = null;
      for (const u of t.users || []) if (r[u] != null) r[u] = 'OWNER';
    }
    out[t.name] = rows;
    seededIds[t.name] = new Set(rows.map((r) => t.pk.map((c) => r[c]).join('|')));
  }
  return out;
}

function fingerprint(content) {
  return crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

function writeSeeds(content, dir = SEED_DIR) {
  fs.mkdirSync(dir, { recursive: true });
  const counts = {};
  for (const t of TABLES) {
    const rows = content[t.name] || [];
    counts[t.name] = rows.length;
    fs.writeFileSync(path.join(dir, `${t.name}.json`), JSON.stringify(rows, null, 1) + '\n');
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    // No timestamp: an export that changed nothing must produce no diff.
    format: 1, fingerprint: fingerprint(content), tables: counts,
  }, null, 2) + '\n');
  return counts;
}

function readSeeds(dir = SEED_DIR) {
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  const content = {};
  for (const t of TABLES) {
    const f = path.join(dir, `${t.name}.json`);
    content[t.name] = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : [];
  }
  return { manifest: JSON.parse(fs.readFileSync(manifestPath, 'utf8')), content };
}

// The state file is keyed by database name — one machine may hold several
// local databases at different points of sync — and remembers the database's
// OID, so a database dropped and recreated under the same name reads as
// never synced rather than as one full of unexported edits.
async function dbIdentity(client) {
  const { rows } = await client.query('SELECT current_database() AS name, oid::text AS oid FROM pg_database WHERE datname = current_database()');
  return rows[0];
}
function readState(file = STATE_FILE, id) {
  try {
    const entry = JSON.parse(fs.readFileSync(file, 'utf8'))[id.name];
    return entry && entry.oid === id.oid ? entry : null;
  } catch { return null; }
}
function writeState(fp, file = STATE_FILE, id) {
  let all = {};
  try { all = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first write */ }
  all[id.name] = { oid: id.oid, fingerprint: fp, at: new Date().toISOString() };
  fs.writeFileSync(file, JSON.stringify(all, null, 2) + '\n');
}

async function exportContent(client, opts = {}) {
  const ctx = await resolveContext(client, opts.ownerEmail);
  const content = await readContent(client, ctx);
  const counts = writeSeeds(content, opts.dir);
  writeState(fingerprint(content), opts.stateFile, await dbIdentity(client));
  return { counts, fingerprint: fingerprint(content) };
}

// ── Import ────────────────────────────────────────────────────────────────────
function castFor(type) {
  return `::${type.startsWith('_') ? type.slice(1) + '[]' : type}`;
}
function toParam(value, type) {
  if (value === null || value === undefined) return null;
  if (type === 'jsonb' || type === 'json') return JSON.stringify(value);
  return value;
}

async function upsertTable(client, t, rows, types, ctx) {
  const cols = Object.keys(rows[0] || {}).filter((c) => types[c]);
  const missing = Object.keys(rows[0] || {}).filter((c) => !types[c]);
  if (missing.length) {
    throw new Error(`seeds/content/${t.name}.json has columns this database lacks (${missing.join(', ')}) — run npm run migrate first`);
  }
  const deferred = t.deferred || [];
  const updatable = cols.filter((c) => !t.pk.includes(c));
  const pkList = t.pk.map((c) => `"${c}"`).join(', ');
  for (const r of rows) {
    const values = cols.map((c) => {
      if (deferred.includes(c)) return null;
      if (c === t.org) return ctx.orgId;
      if ((t.users || []).includes(c)) return r[c] == null ? null : ctx.ownerId;
      return toParam(r[c], types[c].type);
    });
    const placeholders = cols.map((c, i) => `$${i + 1}${castFor(types[c].type)}`);
    const setClause = updatable.length
      ? `DO UPDATE SET ${updatable.map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ')}`
      : 'DO NOTHING';
    await client.query(
      `INSERT INTO "${t.name}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders.join(', ')})
       ON CONFLICT (${pkList}) ${setClause}`, values);
  }
  return { deferred: deferred.filter((c) => cols.includes(c)) };
}

async function applyDeferred(client, t, rows, types) {
  const deferred = (t.deferred || []).filter((c) => types[c]);
  if (!deferred.length) return;
  for (const r of rows) {
    const set = deferred.filter((c) => r[c] != null);
    if (!set.length) continue;
    const where = t.pk.map((c, i) => `"${c}" = $${i + 1}`).join(' AND ');
    const params = [...t.pk.map((c) => r[c]), ...set.map((c) => r[c])];
    await client.query(
      `UPDATE "${t.name}" SET ${set.map((c, i) => `"${c}" = $${t.pk.length + i + 1}${castFor(types[c].type)}`).join(', ')} WHERE ${where}`,
      params);
  }
}

/**
 * A target row that holds a seeded row's natural key under a different id
 * (a package the migrations seeded with a random id, a tag created locally,
 * an induction the app's "Import existing inductions" made) is ADOPTED, not
 * dropped: it is moved aside so the seeded row can land, and once every table
 * is in, whatever referenced the old row — an onboarding assignment, a
 * learner's progress — is repointed to the seeded id before the old row goes.
 *
 * Moving aside means rewriting the last natural-key column (a text code or an
 * integer version) to a throwaway value. A natural key made only of foreign
 * keys (a path item: path + resource) names the same logical row, so that
 * one is simply deleted.
 */
function naturalKeys(t, types) {
  if (!t.natural) return [];
  const list = Array.isArray(t.natural[0]) ? t.natural : [t.natural];
  return list.map((k) => k.filter((c) => types[c])).filter((k) => k.length);
}

async function displaceCollisions(client, t, rows, types, ctx) {
  if (!rows.length || t.pk.length !== 1) return [];
  const pk = t.pk[0];
  const displaced = [];
  for (const nat of naturalKeys(t, types)) for (const r of rows) {
    const vals = nat.map((c) => (c === t.org ? ctx.orgId : r[c]));
    if (vals.some((v) => v == null)) continue;
    const where = nat.map((c, i) => `"${c}" = $${i + 1}${castFor(types[c].type)}`).join(' AND ');
    const { rows: hits } = await client.query(
      `SELECT "${pk}" AS id FROM "${t.name}" WHERE ${where} AND "${pk}" <> $${nat.length + 1}`, [...vals, r[pk]]);
    for (const hit of hits) {
      const keyCol = nat[nat.length - 1];
      const kt = types[keyCol];
      const suffix = `~${String(hit.id).slice(0, 8)}`;
      if (['text', 'varchar', 'bpchar'].includes(kt.type)) {
        const keep = kt.maxLength ? Math.max(1, kt.maxLength - suffix.length) : null;
        const expr = keep ? `left("${keyCol}", ${keep}) || $2` : `"${keyCol}" || $2`;
        await client.query(`UPDATE "${t.name}" SET "${keyCol}" = ${expr} WHERE "${pk}" = $1`, [hit.id, suffix]);
      } else if (['int2', 'int4', 'int8'].includes(kt.type)) {
        await client.query(`UPDATE "${t.name}" SET "${keyCol}" = "${keyCol}" + 1000000 WHERE "${pk}" = $1`, [hit.id]);
      } else {
        await client.query(`DELETE FROM "${t.name}" WHERE "${pk}" = $1`, [hit.id]);
        continue;
      }
      displaced.push({ table: t.name, pk, oldId: hit.id, newId: r[pk] });
    }
  }
  return displaced;
}

async function referencingColumns(client, table) {
  const { rows } = await client.query(
    `SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
       FROM pg_constraint c
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
      WHERE c.contype = 'f' AND c.confrelid = $1::regclass AND array_length(c.conkey, 1) = 1`, [table]);
  return rows;
}

/**
 * Retire one old row in favour of the seeded one: repoint every row outside
 * the seed that referenced it, do the same for its content children matched
 * by natural key under the new parent (an assignment pins a package AND its
 * version), then delete it — cascade takes the children nobody matched.
 */
async function adoptRow(client, table, oldId, newId, refCache, contentTables) {
  let repointed = 0;
  const t = TABLES.find((x) => x.name === table);
  for (const child of TABLES) {
    if (!child.parent || parentTableOf(child.parent) !== table || !child.natural || child.pk.length !== 1) continue;
    const key = Array.isArray(child.natural[0]) ? child.natural[0] : child.natural;
    if (!key.includes(child.parent)) continue;
    const others = key.filter((c) => c !== child.parent);
    if (!others.length) continue;
    const { rows: olds } = await client.query(
      `SELECT "${child.pk[0]}" AS id, ${others.map((c) => `"${c}"`).join(', ')} FROM "${child.name}" WHERE "${child.parent}" = $1`, [oldId]);
    for (const o of olds) {
      const { rows: news } = await client.query(
        `SELECT "${child.pk[0]}" AS id FROM "${child.name}" WHERE "${child.parent}" = $1 AND ${others.map((c, i) => `"${c}" = $${i + 2}`).join(' AND ')}`,
        [newId, ...others.map((c) => o[c])]);
      if (news.length) repointed += await adoptRow(client, child.name, o.id, news[0].id, refCache, contentTables);
    }
  }
  refCache[table] = refCache[table] || await referencingColumns(client, table);
  for (const ref of refCache[table]) {
    // Content tables' own children of the old row are the seed's business
    // (matched above, or cascade-deleted with it); only the rows outside the
    // seed — assignments, progress, acknowledgements — need moving.
    if (contentTables.has(ref.tbl)) continue;
    const { rowCount } = await client.query(
      `UPDATE ${ref.tbl} SET "${ref.col}" = $1 WHERE "${ref.col}" = $2`, [newId, oldId]);
    repointed += rowCount;
  }
  await client.query(`DELETE FROM "${table}" WHERE "${t.pk[0]}" = $1`, [oldId]);
  return repointed;
}

async function adoptDisplaced(client, displaced) {
  const contentTables = new Set(TABLES.map((t) => t.name));
  const refCache = {};
  let repointed = 0;
  for (const d of displaced) repointed += await adoptRow(client, d.table, d.oldId, d.newId, refCache, contentTables);
  return repointed;
}

async function deleteStale(client, t, rows, ctx, seededParents) {
  const keep = rows.map((r) => t.pk.map((c) => r[c]).join('|'));
  const pkExpr = t.pk.length === 1 ? `"${t.pk[0]}"::text` : `concat_ws('|', ${t.pk.map((c) => `"${c}"`).join(', ')})`;
  if (t.org) {
    const { rowCount } = await client.query(
      `DELETE FROM "${t.name}" WHERE "${t.org}" = $1 AND NOT (${pkExpr} = ANY($2::text[]))`, [ctx.orgId, keep]);
    return rowCount;
  }
  if (t.parent) {
    const parents = seededParents[parentTableOf(t.parent)] || [];
    const { rowCount } = await client.query(
      `DELETE FROM "${t.name}" WHERE "${t.parent}" = ANY($1::uuid[]) AND NOT (${pkExpr} = ANY($2::text[]))`, [parents, keep]);
    return rowCount;
  }
  return 0;
}

/** Accept a pg Pool or a single Client; a transaction needs one connection. */
async function withConnection(clientOrPool, fn) {
  const isPool = typeof clientOrPool.totalCount === 'number';
  const client = isPool ? await clientOrPool.connect() : clientOrPool;
  try { return await fn(client); } finally { if (isPool) client.release(); }
}

async function importContent(clientOrPool, opts = {}) {
  return withConnection(clientOrPool, (client) => importWith(client, opts));
}

async function importWith(client, opts) {
  const seeds = readSeeds(opts.dir);
  if (!seeds) throw new Error(`No seeds found in ${opts.dir || SEED_DIR} — nothing to import`);
  const ctx = await resolveContext(client, opts.ownerEmail);

  // Refuse to overwrite edits nobody exported, unless told to.
  // Refuse to overwrite edits nobody exported, unless told to.
  const state = readState(opts.stateFile, await dbIdentity(client));
  if (state && !opts.force) {
    const current = fingerprint(await readContent(client, ctx));
    if (current !== state.fingerprint) {
      const err = new Error('This database has content edits that were never exported. '
        + 'Run "npm run content:export" and commit them first, or re-run with --force to discard them.');
      err.code = 'UNEXPORTED_CHANGES';
      throw err;
    }
  }

  const summary = {};
  await client.query('BEGIN');
  try {
    const seededParents = {};
    // Two passes over the table list: everything upserted first (so a deferred
    // forward reference always has its target), then the deferred columns.
    const typesByTable = {};
    for (const t of TABLES) typesByTable[t.name] = await columnTypes(client, t.name);
    const displaced = [];
    for (const t of TABLES) {
      displaced.push(...await displaceCollisions(client, t, seeds.content[t.name] || [], typesByTable[t.name], ctx));
    }
    for (const t of TABLES) {
      const rows = seeds.content[t.name] || [];
      if (rows.length) await upsertTable(client, t, rows, typesByTable[t.name], ctx);
      seededParents[t.name] = rows.map((r) => r.id).filter(Boolean);
      summary[t.name] = { upserted: rows.length, deleted: 0, adopted: 0 };
    }
    for (const t of TABLES) await applyDeferred(client, t, seeds.content[t.name] || [], typesByTable[t.name]);
    // Children-first: a displaced version row must be resolved before the
    // package it hangs off is deleted.
    summary.repointed = await adoptDisplaced(client, [...displaced].reverse());
    for (const d of displaced) summary[d.table].adopted += 1;
    // Stale rows go children-first so no FK complains.
    for (const t of [...TABLES].reverse()) {
      summary[t.name].deleted = await deleteStale(client, t, seeds.content[t.name] || [], ctx, seededParents);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
  writeState(fingerprint(await readContent(client, ctx)), opts.stateFile, await dbIdentity(client));
  return { summary, manifest: seeds.manifest };
}

// ── CLI ───────────────────────────────────────────────────────────────────────
async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const force = rest.includes('--force');
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  const pg = require('pg');
  withTextDates(pg);
  const client = new pg.Client({
    host: process.env.DB_HOST || 'localhost', port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'therapy_scheduler', user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD, options: '-c TimeZone=UTC',
  });
  await client.connect();
  try {
    if (cmd === 'export') {
      const { counts } = await exportContent(client);
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      for (const [t, n] of Object.entries(counts)) if (n) console.log(`  ${String(n).padStart(5)}  ${t}`);
      console.log(`\nExported ${total} rows to seeds/content/. Review with git diff, then commit.`);
    } else if (cmd === 'import') {
      const { summary, manifest } = await importContent(client, { force });
      for (const t of TABLES) {
        const s = summary[t.name];
        if (s.upserted || s.deleted || s.adopted) {
          console.log(`  ${String(s.upserted).padStart(5)} in, ${String(s.deleted).padStart(3)} removed, ${String(s.adopted).padStart(3)} adopted  ${t.name}`);
        }
      }
      if (summary.repointed) console.log(`  ${summary.repointed} row(s) outside the seed (assignments, progress) now point at the seeded ids.`);
      console.log(`\nImported seeds ${manifest.fingerprint.slice(0, 12)}. Uploaded Resource Hub files are not in git — copy the RESOURCE_HUB_STORAGE_PATH folder separately.`);
    } else if (cmd === 'status') {
      const ctx = await resolveContext(client);
      const current = fingerprint(await readContent(client, ctx));
      const state = readState(STATE_FILE, await dbIdentity(client));
      const seeds = readSeeds();
      console.log(`database:   ${current.slice(0, 12)}${state ? (state.fingerprint === current ? '  (matches last sync)' : '  (UNEXPORTED local edits)') : '  (never synced)'}`);
      console.log(`seeds/:     ${seeds ? seeds.manifest.fingerprint.slice(0, 12) + (seeds.manifest.fingerprint === current ? '  (database matches)' : '  (differs from database)') : 'none'}`);
    } else {
      console.log('usage: node scripts/content-seed.js export | import [--force] | status');
      process.exitCode = 2;
    }
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
}

module.exports = { TABLES, exportContent, importContent, readContent, fingerprint, withTextDates, SEED_DIR, STATE_FILE };
