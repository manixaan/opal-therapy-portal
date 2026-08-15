# WHODAS 2.0 — Phase 0: Repository Audit

Audit date: 2026-08-10 · Branch `main` · Head `7c99d8d`

Purpose: establish which existing Opal Portal patterns the WHODAS module must
reuse, so that no second auth system, client model, document store or audit
system is created.

---

## 1. Architecture at a glance

| Layer | What is actually there |
|---|---|
| Backend | Node ≥20, Express 4, single process. `backend/server.js` boots, mounts ~20 routers |
| Frontend | **No build step, no bundler, no framework.** Static files in `frontend/current/`, served by `express.static`. One shell (`mockup_v3.html`, 27,769 lines) plus per-feature `<feature>.js` / `<feature>.css` pairs loaded as classic scripts |
| Database | PostgreSQL via `pg` Pool (`backend/database.js`) |
| Realtime | Socket.IO (calendar mirror only — not needed by WHODAS) |
| Tests | Jest 30 + Supertest. Two configs: `jest.config.js` (unit) and `jest.integration.config.js` (`--runInBand`, real Postgres) |
| Deployment | Azure App Service; `azure-staging` is the deploy branch (see repo `main branch for PRs`) |

Feature modules are self-contained and follow a consistent shape. **The FCA
module (migration 018, `backend/fca-routes.js` + `backend/fca/`) is the closest
precedent to WHODAS and should be the template.**

---

## 2. Authentication and session

- `express-session` with a Postgres-backed store (`backend/session-store.js`).
- Microsoft OAuth2 via `passport-oauth2` / `backend/outlook-oauth.js` for
  calendar; local email+password (`bcryptjs`) for portal login (`backend/auth.js`).
- `requireAuth` middleware is exported from `backend/permissions.js` and is the
  single gate used by every clinical router.

**WHODAS action:** reuse `requireAuth`. Do not add any auth surface.

## 3. RBAC

`backend/permissions.js` defines four roles, least → most privileged:

| Role | Clinical documentation access |
|---|---|
| `read_only` | view only |
| `therapist` | own calendar, assigned clients, own clinical drafts |
| `admin` | **no clinical access** — deliberately a scheduling + travel role since 2026-08-06 |
| `owner` | full, including financials |

The FCA module encodes the clinical policy explicitly and WHODAS must match it:

- `therapist`, `owner` — create / edit / generate / download **their own** drafts
- `read_only` — read templates and client lists; no writes, no generation
- `admin` — **no access**; admin is non-clinical here

Two helpers already exist in `fca-routes.js`: `requireClinicalRead` and
`requireClinicalWrite`. WHODAS should use the same pair (extracted to a shared
module if a second consumer justifies it).

**Own-only draft rule:** a draft in progress carries unfinished clinical
reasoning; no role, owner included, reads another user's draft. Finished/issued
work is org-visible. WHODAS drafts must follow this.

## 4. Client / patient model — IMPORTANT DEVIATION FROM THE BRIEF

> **There is no `clients` table in this database.**

Splose is the system of record for client identity. Migration 018 states it
plainly: *"client_id is TEXT: it is a Splose identifier, not a local foreign
key, and there is no clients table in this database to point at."*

Local supplementary client facts live in `fca_client_profiles`, keyed
`UNIQUE (organisation_id, splose_client_id)`.

**WHODAS action:** the brief asks for a "client UUID". That is not available.
WHODAS assessments must key on `organisation_id` + `client_id TEXT` (Splose id),
exactly as `fca_report_drafts` does. This is a deliberate, documented deviation.

## 5. Therapist identity

`therapist_profiles` (UUID PK, `user_id` UNIQUE → `users.id`). A user has at
most one profile; owners/admins who are not treating therapists have none.
`fca_report_drafts` carries both `therapist_profile_id` and a denormalised
`therapist_name`. WHODAS should record `started_by_user_id` /
`completed_by_user_id` referencing `users(id)`, plus a denormalised clinician
display name for history rows that must survive staff changes.

## 6. Organisation isolation

Every clinical table carries `organisation_id UUID NOT NULL REFERENCES
organisations(id) ON DELETE CASCADE`, and every query filters it.

Convention: a cross-org read returns **404, not 403** — *"you may not see this"
already leaks that it exists.* WHODAS must do the same.

## 7. Document / blob storage

`backend/storage/index.js` — one interface, three backends selected by
`DOCUMENT_STORAGE_BACKEND`:

- `db` (default) — base64 in a `file_data TEXT` column
- `local` — files under `DOCUMENT_STORAGE_PATH`
- `blob` — private Azure Blob Storage (production target, lazily required)

Contract: `put()`, `get()`, `remove()`. **The backend never exposes a public
URL.** Downloads always route through an authenticated, ownership-checked
Express handler.

`fca_generated_documents` is the shape to copy: `storage_backend`,
`storage_key`, `file_data`, `filename`, `byte_size`, `checksum`,
`template_version`, with a CHECK that one of `file_data` / `storage_key` is
present.

**WHODAS action:** reuse this abstraction verbatim for completed PDFs. No new
storage path, no static asset directory.

## 8. PDF generation — GAP

> **The repository has no PDF library of any kind.**
> No `pdf-lib`, no `pdfkit`, no `pdfjs-dist`, no `puppeteer`, no headless Chrome.

The only PDF reference in the codebase is a MIME allow-list entry in
`profile-routes.js:339` for user-uploaded attachments.

Document generation today is **Word (.docx) only**: `backend/fca/docx-engine.js`
manipulates OOXML directly using `jszip` + `@xmldom/xmldom` + `xpath` against a
shipped template of content controls. That technique does not transfer to PDF.

**WHODAS therefore requires new dependencies.** Minimum viable set:

| Need | Proposed | Why |
|---|---|---|
| Read immutable source PDF, draw response marks, emit completed PDF | `pdf-lib` | Pure JS, no native build, no headless browser, MIT, actively maintained. Can copy pages from a source doc without re-rendering, preserving the original content streams and fonts byte-for-byte |
| Render source PDF pages in the browser viewer | `pdfjs-dist` | Mozilla's renderer; must be **vendored as a static asset** under `frontend/current/vendor/` because there is no bundler |

Both are additive and confined to the WHODAS module. This is the single
largest new-infrastructure decision in the feature and is flagged for approval.

## 9. Audit logging

Table `audit_logs` (created idempotently in `backend/database.js:248`):

```
id, organisation_id, actor_user_id, action VARCHAR(100),
target_type VARCHAR(50), target_id VARCHAR(255), metadata JSONB,
ip_address, created_at
```

Helper: `logAuditEvent({ actorUserId, action, targetType, targetId, metadata,
ipAddress, organisationId })` — `backend/database.js:734`.

`view_audit_logs` is an `owner`-only permission.

**Privacy convention (from `fca-routes.js`):** *"No client identity and no
clinical content in logs, audit payloads or client-facing errors. Audit rows
carry ids, versions and counts."* WHODAS audit metadata must therefore carry
assessment id, template version, item counts and score-method name — **never
response values, never scores tied to a named client in a log line.**

**WHODAS action:** use `logAuditEvent` directly. No new audit system.

## 10. Migration conventions

- `backend/migrations/NNN_snake_name.sql`, sequential, currently at `018`.
- Runner: `backend/migrate.js` (`npm run migrate`, `npm run migrate:status`).
- Style: heavily commented header explaining the *why*; `CREATE TABLE IF NOT
  EXISTS`; `ADD COLUMN IF NOT EXISTS`; named `CONSTRAINT valid_*` CHECKs;
  `CREATE INDEX IF NOT EXISTS`; additive only.
- Immutability is enforced **in the database**, not just in code — see
  `fca_templates_refuse_update()` trigger, which refuses content edits to a
  template version once a document has been generated from it (status changes
  like `is_active` remain allowed).
- Integration test `backend/tests/integration/migrate.itest.js` exercises the
  runner.

**WHODAS action:** next free number is `021_whodas_assessments.sql`. Copy the
`fca_templates` immutability trigger pattern for the WHODAS template registry.

## 11. API conventions

- Routers are plain `express.Router()`, mounted at `/` in `server.js`, with the
  full path written into each route: `router.get('/api/fca/drafts/:id', ...)`.
- A `safe(async fn)` wrapper is used on every handler for error propagation.
- Auth applied per-route via a permission middleware, or once per prefix
  (`router.use('/api/mobile/case-note-drafts', requireAuth)`).
- Errors return `{ error: '<machine_code>', message?: '<human>' }` with
  meaningful HTTP status. `409` is already used for state conflicts
  (`invalid_state`, `not_editable`, `archived`).
- Module-scoped logger: `require('./logger').createLogger('<feature>')`.

## 12. Concurrency

> **There is no optimistic-concurrency mechanism in the repository.**

No `If-Match` / ETag handling, no `version` column, no `expected_version`
parameter anywhere. `409` is used only for *status* conflicts (editing an
already-generated report), not for stale-write detection.

**WHODAS action:** the brief requires stale updates to conflict rather than
silently overwrite. Since no convention exists to follow, WHODAS must
introduce one. Proposal: an integer `version` column on the assessment row,
incremented on every accepted response write; the client echoes the version it
last read and a mismatch returns `409 stale_version` with the current server
state. This is new but small, local to the module, and does not alter any
existing table.

## 13. Draft / autosave precedent

`case_note_drafts` (migration 017) and `fca_report_drafts` (018) both use:
`status VARCHAR(20) NOT NULL DEFAULT 'draft'` with a
`CONSTRAINT valid_*_status CHECK (status IN (...))`, plus `created_at` /
`updated_at TIMESTAMPTZ`.

Status vocabularies in use: `('draft','archived')` and
`('draft','generated','archived')`.

**WHODAS action:** the brief asks for `DRAFT / COMPLETED / VOIDED`. The house
style is lowercase in a CHECK constraint, so:
`CHECK (status IN ('draft','completed','voided','amended'))`. `completed` is the
analogue of the FCA's `generated` (the point after which content freezes).

Autosave today is a client-driven `PATCH /:id` — there is no debounce helper or
save-state UI component to reuse; WHODAS builds its own in `whodas.js`.

## 14. Feature flags

`backend/feature-flags.js`. Naming is `ENABLE_<THING>`; resolution is:
explicit `'true'`/`'false'` env wins; when unset, development/test default
TRUE and staging/production default FALSE (fail-safe). Flags that must never
default on use a strict `=== 'true'` check in every environment.

**WHODAS action:** add `ENABLE_WHODAS_ASSESSMENT` using the **strict**
pattern (`=== 'true'`), not the permissive one — WHO-copyrighted content must
not become reachable because an environment variable was forgotten. This also
provides the licensing gate required by the brief. Add to
`featureFlagState()` and `backend/.env.example`.

## 15. Testing conventions

- Unit: `backend/tests/<thing>.test.js`, pure functions, no DB.
- Integration: `backend/tests/integration/<thing>.itest.js`, real Postgres via
  `helpers.js` + `globalSetup.js`, run serially.
- Frontend logic is tested by **shell-parsing the static JS** — e.g.
  `frontend-stage3-guards.test.js`, `fca-frontend-helpers.test.js`,
  `supportpop-shell.test.js` read the `.js`/`.html` files and assert on
  structure. There is no jsdom/DOM test harness.
- Existing RBAC/security suites to extend rather than duplicate:
  `rbac-hardening.itest.js`, `readonly-and-hardening.itest.js`,
  `security.test.js`, `audit.itest.js`.

## 16. Existing assessment modules

None. There is no assessments area, no questionnaire engine and no instrument
library. **WHODAS is greenfield** inside the portal — but the FCA wizard
(`frontend/current/fca.js`, 1,830 lines) is the nearest UX precedent for a
multi-step clinical document workflow, and `resourcehub.js` for a library-style
listing.

---

## 17. Summary of what WHODAS reuses vs. adds

**Reuses unchanged:** `requireAuth`; role model and the FCA clinical-access
policy; `organisation_id` isolation with 404-on-cross-org; Splose `client_id
TEXT` keying; `backend/storage/index.js`; `logAuditEvent` + `audit_logs`;
migration runner and style; `safe()` + error-shape + logger conventions;
Jest unit/integration split; `ENABLE_*` flag module.

**Adds (justified):**
1. `pdf-lib` (server) and vendored `pdfjs-dist` (browser) — no PDF capability exists.
2. Migration `021_whodas_assessments.sql` — template registry, assessments, responses, generated documents.
3. An optimistic-concurrency `version` column + `409 stale_version` — no repo convention existed.
4. `ENABLE_WHODAS_ASSESSMENT` strict-mode flag.
5. `frontend/current/whodas.js` / `whodas.css` + a PDF-overlay viewer.

**Explicitly does not add:** a second auth system, a local clients table, a
parallel document store, a separate audit log, a frontend framework or build
step.
