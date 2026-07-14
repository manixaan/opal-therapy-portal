'use strict';

/**
 * MIGRATION RUNNER
 *
 *   npm run migrate            apply all pending migrations
 *   npm run migrate:status     show applied / pending / drift
 *   node migrate.js up --yes   explicit confirmation (required in production)
 *
 * Design notes
 * ────────────
 * The application historically applied its whole schema via INIT_QUERIES on
 * every boot (idempotent CREATE/ALTER IF NOT EXISTS). That remains the
 * baseline — migration 000_baseline records that the INIT_QUERIES schema is
 * the version-0 starting point. From here forward, every schema change is an
 * ordered, tracked file so environments can be reasoned about and audited.
 *
 * Guarantees:
 *   • Tracking      — schema_migrations records id, name, checksum, applied_at.
 *   • Transactional — each migration runs in its own transaction; a failure
 *                     rolls that migration back and stops the run.
 *   • Idempotent    — applied migrations are skipped; a migration cannot
 *                     silently run twice.
 *   • Drift-proof   — editing an already-applied file is detected by checksum
 *                     and refused. Never edit an applied migration; add a new one.
 *   • Concurrent-safe — a Postgres advisory lock serialises runners, so two
 *                     processes (e.g. two deploy jobs) cannot interleave DDL.
 *   • Fresh-DB safe — on an empty database the baseline marker applies the
 *                     full INIT_QUERIES schema before later migrations run.
 *   • Production-guarded — NODE_ENV=production refuses to migrate unless
 *                     MIGRATE_ALLOW_PRODUCTION=true (deploy pipeline) or the
 *                     CLI --yes flag is passed.
 *
 * Files: migrations/NNN_description.sql  (NNN = zero-padded ordinal)
 * A leading "-- @norun-baseline" marker means "record as applied without
 * executing" (used for 000_baseline, whose DDL comes from INIT_QUERIES).
 */

// Load .env exactly like server boot does — without this, a bare
// `node migrate.js` would silently fall back to default connection values
// and could target the wrong database. dotenv never overrides variables that
// are already set (so the test framework's forced *_test config wins).
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pool } = require('./database');

/** Authoritative name of the database this pool is actually connected to. */
async function currentDatabase(q = pool) {
  const { rows } = await q.query('SELECT current_database() AS db');
  return rows[0].db;
}

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// Arbitrary but fixed application-wide advisory lock id for migrations.
const MIGRATION_LOCK_KEY = 743901;

async function ensureMigrationsTable(q = pool) {
  try {
    await q.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id          VARCHAR(20) PRIMARY KEY,
        name        TEXT NOT NULL,
        checksum    VARCHAR(64) NOT NULL,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  } catch (err) {
    // Two concurrent CREATE TABLE IF NOT EXISTS can race in Postgres; if the
    // other process won, the table exists and we are fine.
    if (!/already exists|duplicate/i.test(err.message)) throw err;
  }
}

function loadMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => /^\d+.*\.sql$/.test(f))
    .sort()
    .map(file => {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      return {
        id: file.match(/^(\d+)/)[1],
        name: file,
        sql,
        checksum: crypto.createHash('sha256').update(sql).digest('hex'),
        recordOnly: /^\s*--\s*@norun-baseline/m.test(sql),
      };
    });
}

async function getApplied(q = pool) {
  const { rows } = await q.query(
    'SELECT id, name, checksum, applied_at FROM schema_migrations ORDER BY id');
  return new Map(rows.map(r => [r.id, r]));
}

/** Does the version-0 application schema already exist on this database? */
async function baselineSchemaExists(q = pool) {
  const { rows } = await q.query(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'users'`);
  return rows.length > 0;
}

function guardProduction(force) {
  const env = process.env.NODE_ENV || 'development';
  if (env === 'production' && !force && process.env.MIGRATE_ALLOW_PRODUCTION !== 'true') {
    throw new Error(
      'Refusing to run migrations with NODE_ENV=production. ' +
      'This protects the live database from accidental local runs. ' +
      'Deploy pipelines must set MIGRATE_ALLOW_PRODUCTION=true; ' +
      'a deliberate manual run may pass --yes.'
    );
  }
}

async function status() {
  await ensureMigrationsTable();
  const applied = await getApplied();
  const files = loadMigrationFiles();
  return files.map(m => {
    const a = applied.get(m.id);
    let state = a ? 'applied' : 'pending';
    if (a && a.checksum !== m.checksum) state = 'CHECKSUM-DRIFT';
    return { id: m.id, name: m.name, state, appliedAt: a?.applied_at || null };
  });
}

async function migrate({ force = false } = {}) {
  guardProduction(force);

  const client = await pool.connect();
  try {
    // Serialise concurrent runners (two deploy jobs, migrate + boot, etc.).
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);

    await ensureMigrationsTable(client);

    // Re-read state AFTER acquiring the lock — another process may have just
    // finished migrating while we waited.
    const applied = await getApplied(client);
    const files = loadMigrationFiles();

    // Drift check on already-applied files — refuse to proceed if history changed.
    for (const m of files) {
      const a = applied.get(m.id);
      if (a && a.checksum !== m.checksum) {
        throw new Error(
          `Migration ${m.name} was modified after being applied ` +
          `(recorded checksum ${a.checksum.slice(0, 12)} != file ${m.checksum.slice(0, 12)}). ` +
          `Never edit an applied migration — add a new one.`
        );
      }
    }

    const pending = files.filter(m => !applied.has(m.id));
    if (pending.length === 0) {
      console.log('✓ No pending migrations.');
      return { applied: [] };
    }

    console.log(`Migrating database "${await currentDatabase(client)}" on ` +
      `${process.env.DB_HOST || 'localhost'} (${pending.length} pending)`);

    const done = [];
    for (const m of pending) {
      if (m.recordOnly) {
        // Baseline marker: on a fresh database, apply the full INIT_QUERIES
        // schema (same initialiser the app boot uses); on an existing
        // database just record it. initializeDatabase is idempotent, so a
        // crash between init and record is safe to re-run.
        if (!(await baselineSchemaExists(client))) {
          console.log(`▶ ${m.name} — fresh database: applying baseline schema`);
          const ok = await require('./database').initializeDatabase();
          if (!ok) throw new Error(`Baseline schema initialisation failed (${m.name})`);
        } else {
          console.log(`↷ ${m.name} (baseline — schema present; recorded without executing)`);
        }
        await client.query(
          'INSERT INTO schema_migrations (id, name, checksum) VALUES ($1, $2, $3)',
          [m.id, m.name, m.checksum]);
        done.push(m.name);
        continue;
      }

      try {
        await client.query('BEGIN');
        await client.query(m.sql);
        await client.query(
          'INSERT INTO schema_migrations (id, name, checksum) VALUES ($1, $2, $3)',
          [m.id, m.name, m.checksum]);
        await client.query('COMMIT');
        console.log(`✓ ${m.name}`);
        done.push(m.name);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`✗ ${m.name} failed — rolled back: ${err.message}`);
        throw err;
      }
    }
    console.log(`✓ Applied ${done.length} migration(s).`);
    return { applied: done };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => {});
    client.release();
  }
}

// CLI entry
if (require.main === module) {
  const args = process.argv.slice(2);
  const cmd = args.find(a => !a.startsWith('--')) || 'up';
  const force = args.includes('--yes');
  (async () => {
    try {
      if (cmd === 'status') {
        const rows = await status();
        console.log(`\nMigration status — database "${await currentDatabase()}":`);
        for (const r of rows) {
          const when = r.appliedAt ? new Date(r.appliedAt).toISOString().slice(0, 19) : '';
          console.log(`  [${r.state.padEnd(14)}] ${r.name} ${when}`);
        }
      } else if (cmd === 'up') {
        await migrate({ force });
      } else {
        throw new Error(`Unknown command "${cmd}" — use: up | status`);
      }
      await pool.end();
      process.exit(0);
    } catch (err) {
      console.error('Migration error:', err.message);
      await pool.end().catch(() => {});
      process.exit(1);
    }
  })();
}

module.exports = { migrate, status, ensureMigrationsTable, loadMigrationFiles, currentDatabase, MIGRATION_LOCK_KEY };
