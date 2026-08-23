# Rule — database & migrations (`backend/migrations/**`, schema changes)

Full detail: `backend/migrations/README.md`. The essentials:

- **Append-only.** Migrations are checksummed in `schema_migrations`; editing an
  applied file makes the runner refuse to start. Never modify an existing
  migration — add `NNN_short_description.sql` with the next zero-padded number.
- `database.js` `INIT_QUERIES` is the frozen version-0 baseline. New schema goes
  in a migration, and only mirror it into `INIT_QUERIES` if the existing file
  already does so for comparable tables.
- Prefer idempotent DDL (`IF NOT EXISTS`) so a partial failure is re-runnable.
  Plain `CREATE INDEX`, never `CONCURRENTLY` — each migration runs in one
  transaction.
- Locally: `npm run migrate` then `npm run migrate:status` (from `backend/`).
  Never run migrations against staging or production from a development task.
- Any migration is **CRITICAL** level: add or extend an integration test that
  exercises the new columns/tables, and check `/ready` still reports clean.
