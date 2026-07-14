# Infrastructure Test Bench Report

**Scope:** Phases 7–9 infrastructure (migrations, document storage, health/readiness, structured logging, telemetry, audit, CI/CD, Azure deployment preparation)
**Freeze commit:** `73ea711` (branch `production-pilot`) · **Bench date:** 2026-07-14
**Environment:** macOS (darwin), Node v26.0.0, npm 11.12.1, PostgreSQL local, isolated synthetic databases (`opal_bench_*`, dropped after the bench). No real employee, client, or clinical data was used or touched at any point.
**Method:** adversarial first pass at the frozen commit → defect register → grouped repairs with regression tests → full second pass. Classifications: **PASS** / **PASS WITH LIMITATION** / **FAIL → FIXED → RETEST PASS** / **NOT TESTED — EXTERNAL ACCESS REQUIRED**.

---

## Results by test

| # | Test | Result | Evidence |
|---|---|---|---|
| 1 | Clean install (`npm ci` in exported freeze tree, no `.env`) | **PASS** | 345 packages from lockfile; all 25 application modules load; 96/96 unit tests in clean tree |
| 2 | Fresh empty database | **PASS** | `migrate.js up` applied baseline (INIT_QUERIES) + 001 on an empty DB; 18 tables, storage columns 2/2, indexes 3/3, CHECK constraint, ledger `[000,001]`; app `/ready` 200; full 60-test integration suite green on brand-new DB |
| 3 | Existing-database upgrade | **PASS** | Pre-migration schema built from old commit `62bfa8a`, seeded synthetic users/events/audit/document; upgrade preserved every row — Outlook + Splose identifiers intact, `created_by_source` intact, document bytes byte-identical, `storage_backend` defaulted `'db'`; indexes added; ledger correct |
| 4 | Migration repeatability | **PASS** | 3 further runs all no-ops; 0 duplicate ledger rows; 0 duplicate indexes |
| 5 | Failed migration | **PASS** | Mid-migration failure (`SELECT 1/0` after DDL) → transaction rolled back (no partial table), no ledger row, status shows `pending`, exit code 1 (CI-gateable), clear non-sensitive error, clean run after removing the failure |
| 6 | Concurrent migrations | **PASS** | Two simultaneous runners on a fresh DB: advisory lock serialised them — one applied everything, the other waited then found nothing pending; single ledger; both exit 0 |
| 7 | Wrong-database safety | **PASS** | `prod`/`live`-patterned DB names refused by the integration framework; non-local `DB_HOST` refused outside CI; `NODE_ENV=production` migrate refused without `MIGRATE_ALLOW_PRODUCTION=true`/`--yes`, with instructive error |
| 8 | Document authorisation (10 probes) | **FAIL ×2 → FIXED → RETEST PASS (9/9 + suspended ✓)** | Matrix: unauth 401, cross-user therapist 403, admin/owner 200, suspended-with-live-session 401, deleted 404. Findings D-2 (read_only could write) and D-3 (non-UUID id → 500) — see register |
| 9 | File attacks (11 probes) | **FAIL ×2 → FIXED → RETEST PASS (11/11)** | exe/MIME-mismatch/double-extension/traversal/bad-base64 all 415; unicode + duplicate + empty handled safely. Findings D-4 (malformed JSON → 500) and D-5 (100 KB parser vs documented 5 MB cap) |
| 10 | Storage failures | **FAIL ×2 → FIXED → RETEST PASS** | Findings D-6 (missing object → 500) and D-7 (orphaned metadata row on write failure). Post-fix: missing object → 404; write failure → 5xx with row rolled back (0 orphans) |
| 11 | Health endpoint semantics | **FAIL ×1 → FIXED → RETEST PASS** | Finding D-8: DB unreachable at boot crashed the process (session-store unhandled rejection). Post-fix: process survives, `/health` 200, `/ready` 503 `database:fail`, graceful warning logged; migration-pending → `/ready` 503 `pending:N` (integration-tested); draining → 503 `shutting_down` |
| 12 | Logging redaction | **PASS** | 14 unit tests: key-based masking (password/token/cookie/api-key/connection-string variants), Bearer/JWT/64-hex scrubbing, secret-bearing query params, Error serialisation without stacks, depth limits; request logs never include query strings; live log inspection found no secret-shaped values |
| 13 | Audit integrity | **FAIL ×1 (minor) → FIXED → RETEST PASS** | Correct actor/action/target/metadata for login success+failure, org settings (keys only), document upload/delete, cross-user download, credential verification; probe proved no password material lands in `audit_logs`. Finding D-10: denied cross-user document access wasn't audited — now writes `document.download_denied` |
| 14 | Telemetry | **PASS WITH LIMITATION** | Disabled-by-default proven on every boot; absent SDK + set connection string → warn-and-continue; redaction shared with logger (unit-tested); correlation IDs live-verified. **Limitation:** SDK-active path (real App Insights ingestion) NOT TESTED — EXTERNAL ACCESS REQUIRED |
| 15 | Environment configuration | **PASS WITH LIMITATION** | 6-case matrix: staging/production exit 1 on missing anything critical, weak session secret, malformed encryption key, dev-defaults-in-production; all-good staging exits 0; development warns-but-boots. **Limitation:** value-format validation (e.g. non-numeric `DB_PORT`, malformed URL) is not pre-checked — such configs fail closed at pool-connect/boot rather than in env-validation |
| 16 | Production-mode boot | **FAIL ×1 → FIXED → RETEST PASS** | Boots under strict validation, CSP header present, JSON structured logs active, `/health` + `/ready` 200. Finding D-1: no `trust proxy` → with `cookie.secure=true` behind Azure's TLS-terminating LB, express-session would never set the session cookie (login broken in production) and `req.ip` would be the LB. Post-fix proof: login via simulated LB (`X-Forwarded-Proto: https`) → `Set-Cookie … HttpOnly; Secure; SameSite=Lax`; plain-HTTP login still withholds the cookie (enforcement intact); real-server malformed JSON → 400; 9 MB body → 413 `Upload too large` |
| 17 | Azure package | **PASS** (D-9 fixed) | CI package steps replicated: prod-only install (128 pkgs, no jest), bundle excludes `.env*`, `backend/tests/`, itests, jest configs (D-9: base `jest.config.js` exclusion tightened); extracted bundle boots via `startup.sh` (migrations → server), `/ready` 200, `/login` 200, `/socket.io/socket.io.js` 200. npm packages' own internal test files remain (normal, harmless) |
| 18 | CI pipeline validation | **PASS WITH LIMITATION** | Every pipeline step executed locally with identical commands (install/syntax/unit/integration/migration-validation incl. fresh-DB + idempotency + status gate/audit/package); job graph enforces test→package→deploy ordering; production requires dispatch + confirmation phrase + protected-environment approval; YAML validated. **Limitation:** execution on GitHub Actions itself NOT TESTED — EXTERNAL ACCESS REQUIRED (needs repo push + Azure OIDC secrets) |
| 19 | Rollback simulation | **PASS** | Version-A code (`62bfa8a`) booted against the version-B (migrated) schema with zero errors — `/health` 200, `/` 302, `/login` 200. Migration 001 is purely additive; policy (one-version backwards compatibility, destructive changes need restore-verified backup) documented in `deploy/AZURE_DEPLOYMENT.md` §6.3. App rollback = redeploy previous artifact |
| 20 | Backup & restore | **PASS** | `pg_dump` → marker row added → restore to a NEW database (live DB untouched): original rows present, post-backup marker correctly absent, migration status `applied` ×2, current app `/ready` 200 against the restore |
| 21 | Full regression (post-repair) | **PASS** | **96/96 unit (8 suites) + 65/65 integration (9 suites); npm audit 0 vulnerabilities; dev boot `/ready` 200; production-mode boot verified; dev DB migrations applied** |

---

## Defect register

| ID | Severity | Defect | Root cause | Fix | Regression test |
|---|---|---|---|---|---|
| D-1 | **High** | Production login would fail on Azure: secure session cookie never set behind TLS-terminating proxy; `req.ip` = LB address | No `trust proxy` | `app.set('trust proxy', 1)` in server.js | Live proof: Secure cookie set via `X-Forwarded-Proto: https`, withheld on plain HTTP |
| D-2 | **High** | `read_only` users could create/modify business data — the restriction existed only as a permission list, unenforced | No server-side write guard | Single choke point in `requireAuth`: unsafe methods → 403 for `read_only`, `/api/auth/*` exempt (password change, onboarding) | `readonly-and-hardening.itest.js` (blocked writes, allowed reads + auth endpoints, therapist unaffected) |
| D-3 | Medium | Non-UUID `:id` → Postgres cast error → 500 on document/credential routes | Unvalidated route params hit `uuid` casts | `isUuid` guard → early 404 on 5 routes | itest: download/delete/credential routes with garbage ids → 404 |
| D-4 | Low | Malformed JSON and oversized bodies surfaced as 500 | Error handler ignored `err.status` | Handler respects status; 4xx get sanitised client-error messages, only 5xx alert telemetry | Real-server curl: malformed → 400, 9 MB → 413 |
| D-5 | **High (functional)** | Documented 5 MB document uploads impossible — global 100 KB JSON limit rejected them | Parser limit never scoped for uploads | Scoped `8mb` parser for `/api/profile/documents` only; global default kept as request-size defence | Probe 9.11 (400 KB → 201) + 413 over-cap proof |
| D-6 | Medium | Missing/unreadable stored object → 500 with backend internals in logs | `backend.get` uncaught | try/catch → safe 404 `Document content unavailable` | itest: object deleted behind app's back → 404 |
| D-7 | Medium | Storage write failure left an orphaned metadata row (document without content) | Row created before `put`, no cleanup | On `put` failure: delete row, rethrow → 5xx | itest: unwritable dir → 5xx, 0 orphans |
| D-8 | **High** | DB unreachable at boot → unhandled rejection → crash loop; liveness impossible during transient outages | Fire-and-forget `_ensureTable()` in session store | `.catch` + warning (table persists across restarts; also created by INIT_QUERIES + migrations); process-level `unhandledRejection` log-and-continue + `uncaughtException` log-and-exit backstops | Dead-DB boot: `/health` 200, `/ready` 503, process alive, graceful warning |
| D-9 | Low | `jest.config.js` shipped in deployment bundle | Exclude pattern too narrow | `jest*.config.js` in ci.yml | Package rebuild: absent |
| D-10 | Low | Denied cross-user document access not audited | Missing call | `document.download_denied` audit row (both parties' ids) | itest asserts the row |

All ten defects **fixed and re-tested**. No repair weakened a test or removed a security check; every fix added enforcement or corrected semantics.

## Remaining limitations (explicit)

1. **Azure-side execution** — GitHub Actions runs, real App Service deploy, Key Vault resolution, Blob backend against live Azure, App Insights ingestion: NOT TESTED — EXTERNAL ACCESS REQUIRED. Every repo-side step is verified locally by equivalent commands.
2. **Env value-format pre-validation** (bad port/URL formats) fails closed at connect/boot rather than in `env-validation.js`.
3. **Blob backend unit surface** — `storage/index.js` blob path is code-reviewed and contract-identical to the tested local backend, but exercised only with the connection string absent (throws cleanly). First staging deploy should upload/download/delete one synthetic document as a smoke test.
4. **Storage timeout simulation** (upload/download hangs) not simulated locally; Azure SDK defaults + the platform request timeout bound it in practice.

## Exit-requirements checklist

Unit ✓ (96) · Integration ✓ (65) · Migration suite ✓ · Fresh DB ✓ · Upgrade ✓ · Repeatability ✓ · Document permissions ✓ · Upload validation ✓ · Health/readiness ✓ · Env validation ✓ · Production boot ✓ · `npm audit` 0 ✓ · Azure-only items explicitly marked ✓ · Report complete ✓

**Verdict: infrastructure exit criteria met — proceeding to Phase 10.**
