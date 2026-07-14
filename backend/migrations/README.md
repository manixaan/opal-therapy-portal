# Database migrations

## How this works

The app historically applied its whole schema on every boot via `INIT_QUERIES`
in `database.js` (idempotent `CREATE … IF NOT EXISTS`). That schema is now
**frozen as the version-0 baseline**, recorded by `000_baseline.sql`. Every
schema change from here forward is an ordered, checksummed, tracked SQL file
in this directory.

```
npm run migrate            # apply all pending migrations
npm run migrate:status     # show applied / pending / drift
node migrate.js up --yes   # explicit confirmation (required in production)
```

## Guarantees

| Property | Mechanism |
|---|---|
| Tracking | `schema_migrations` (id, name, checksum, applied_at) |
| Ordering | files run in `NNN_` filename order |
| No double-run | applied ids are skipped |
| Transactional | each migration in its own transaction; failure rolls back that migration and stops |
| Drift refusal | editing an applied file changes its checksum → runner refuses. **Never edit an applied migration — add a new one** |
| Concurrency | Postgres advisory lock (`743901`) serialises simultaneous runners |
| Fresh DB | on an empty database the baseline marker applies `INIT_QUERIES` first |
| Existing DB | on a database that already has the schema, the baseline is recorded without executing |
| Production guard | `NODE_ENV=production` refuses unless the deploy pipeline sets `MIGRATE_ALLOW_PRODUCTION=true` (or a deliberate manual run passes `--yes`) |
| Test isolation | the integration framework forces `<DB_NAME>_test` and refuses production-looking configuration |

## Writing a migration

1. Create `migrations/NNN_short_description.sql` (next zero-padded number).
2. Prefer idempotent DDL (`IF NOT EXISTS` / `DROP … IF EXISTS` before `ADD`)
   so a re-run after a partial failure is safe.
3. Plain `CREATE INDEX` (not `CONCURRENTLY`) so it stays transactional.
4. Run `npm run migrate` locally, then `npm run test:all`.
5. Never modify a file once it has been applied anywhere.

A leading `-- @norun-baseline` marker means "record as applied without
executing" — used only by `000_baseline.sql`.

## Deployment sequence

Every environment follows: **deploy code → run migrations → (re)start app**.
Boot still runs `INIT_QUERIES` idempotently (safety net for dev), but staging
and production correctness depends on `npm run migrate` having been run —
the CI/CD pipeline does this before the app restarts, and `/ready` reports
pending migrations.

## Future: moving existing DB-stored documents into Azure Blob Storage

Not performed during the pilot build (real employee documents are never
touched by tooling in this repo). When the time comes:

1. Set `DOCUMENT_STORAGE_BACKEND=blob` + `AZURE_STORAGE_*` on the target
   environment. New uploads then go straight to Blob; existing rows keep
   `storage_backend='db'` and keep working — the abstraction reads both.
2. Run a one-off, resumable backfill script (to be written at that point) that,
   per row with `storage_backend='db' AND file_data IS NOT NULL`:
   `put()` bytes to Blob → verify size/hash of the uploaded object →
   `setPDDocumentStorage(id, { storageBackend:'blob', storageKey, clearInline:true })`.
   One row per transaction, so an interruption leaves every document readable
   from exactly one place.
3. Verify: zero rows left with `storage_backend='db'`, spot-check downloads
   through the authenticated route, then take a DB backup (rows are now
   metadata-only).

Rollback at any point: rows not yet converted are untouched; converted rows
can be reverted by streaming the blob back into `file_data`.
