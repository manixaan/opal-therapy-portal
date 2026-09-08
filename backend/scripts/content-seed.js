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
 *   natural   a UNIQUE constraint other than the pk. A target row holding the
 *             same natural key under a different id (a tag seeded locally, an
 *             induction the app's "Import existing inductions" created) is
 *             removed before the upsert so the seeded id wins
 *   omit      columns never exported (large or environment-bound)
 */
const TABLES = [
  { name: 'compliance_requirements', pk: ['id'], natural: ['organisation_id', 'code'], org: 'organisation_id', users: ['last_verified_by'], deferred: ['stored_document_id'] },
  { name: 'resource_tags', pk: ['id'], natural: ['category', 'name'] },
  { name: 'resource_folders', pk: ['id'], org: 'organisation_id', users: ['created_by'], deferred: ['parent_id'] },
  { name: 'resources', pk: ['id'], org: 'organisation_id', users: ['created_by', 'approved_by', 'content_owner'], deferred: ['duplicate_of', 'superseded_by'] },
  { name: 'resource_versions', pk: ['id'], natural: ['resource_id', 'version'], parent: 'resource_id', users: ['created_by'] },
  { name: 'resource_files', pk: ['id'], parent: 'resource_id', users: ['uploaded_by'], omit: ['file_data'] },
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
  { name: 'walkthrough_modules', pk: ['id'], org: 'organisation_id', users: ['created_by'] },
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
    `SELECT column_name, data_type, udt_name, is_nullable
       FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position`, [table]);
  if (!rows.length) throw new Error(`Table "${table}" does not exist — run the migrations first (npm run migrate)`);
  return Object.fromEntries(rows.map((r) => [r.column_name, { type: r.udt_name, nullable: r.is_nullable === 'YES' }]));
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
    format: 1, exported_at: new Date().toISOString(), fingerprint: fingerprint(content), tables: counts,
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

// The state file is keyed by database name: one machine may hold several
// local databases (a dev one, a QA one) at different points of sync.
function dbKey(client) {
  return client.database || (client.options && client.options.database) || 'default';
}
function readState(file = STATE_FILE, key) {
  try {
    const all = JSON.parse(fs.readFileSync(file, 'utf8'));
    return all[key] || null;
  } catch { return null; }
}
function writeState(fp, file = STATE_FILE, key) {
  let all = {};
  try { all = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first write */ }
  all[key] = { fingerprint: fp, at: new Date().toISOString() };
  fs.writeFileSync(file, JSON.stringify(all, null, 2) + '\n');
}

async function exportContent(client, opts = {}) {
  const ctx = await resolveContext(client, opts.ownerEmail);
  const content = await readContent(client, ctx);
  const counts = writeSeeds(content, opts.dir);
  writeState(fingerprint(content), opts.stateFile, dbKey(client));
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
 * Remove target rows that would collide with a seeded row on a natural key
 * while carrying a different primary key. Runs children-first, before any
 * upsert, so the seed's ids are the ones that survive.
 */
async function purgeNaturalCollisions(client, t, rows, types, ctx) {
  const nat = (t.natural || []).filter((c) => types[c]);
  if (!nat.length || !rows.length) return 0;
  let removed = 0;
  for (const r of rows) {
    const vals = nat.map((c) => (c === t.org ? ctx.orgId : r[c]));
    if (vals.some((v) => v == null)) continue;
    const where = nat.map((c, i) => `"${c}" = $${i + 1}${castFor(types[c].type)}`).join(' AND ');
    const pkNe = t.pk.map((c, i) => `"${c}" <> $${nat.length + i + 1}${castFor(types[c].type)}`).join(' OR ');
    const { rowCount } = await client.query(
      `DELETE FROM "${t.name}" WHERE ${where} AND (${pkNe})`, [...vals, ...t.pk.map((c) => r[c])]);
    removed += rowCount;
  }
  return removed;
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
  const state = readState(opts.stateFile, dbKey(client));
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
    for (const t of [...TABLES].reverse()) {
      await purgeNaturalCollisions(client, t, seeds.content[t.name] || [], typesByTable[t.name], ctx);
    }
    for (const t of TABLES) {
      const rows = seeds.content[t.name] || [];
      if (rows.length) await upsertTable(client, t, rows, typesByTable[t.name], ctx);
      seededParents[t.name] = rows.map((r) => r.id).filter(Boolean);
      summary[t.name] = { upserted: rows.length, deleted: 0 };
    }
    for (const t of TABLES) await applyDeferred(client, t, seeds.content[t.name] || [], typesByTable[t.name]);
    // Stale rows go children-first so no FK complains.
    for (const t of [...TABLES].reverse()) {
      summary[t.name].deleted = await deleteStale(client, t, seeds.content[t.name] || [], ctx, seededParents);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
  writeState(fingerprint(await readContent(client, ctx)), opts.stateFile, dbKey(client));
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
      for (const [t, s] of Object.entries(summary)) {
        if (s.upserted || s.deleted) console.log(`  ${String(s.upserted).padStart(5)} in, ${String(s.deleted).padStart(3)} removed  ${t}`);
      }
      console.log(`\nImported seeds exported ${manifest.exported_at}. Uploaded Resource Hub files are not in git — copy the RESOURCE_HUB_STORAGE_PATH folder separately.`);
    } else if (cmd === 'status') {
      const ctx = await resolveContext(client);
      const current = fingerprint(await readContent(client, ctx));
      const state = readState(STATE_FILE, dbKey(client));
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
