# Portal - Splose - Outlook | Integration Works

- Tracker stage: **idea** · Tracker environment: **none**
- Evidence label: **tab-unproven**
- Addressed since last audit (2026-09-17T18:21Z UTC): **yes** — `494bd86`, `41a9e27`, `22ce321` (practitioner self-linking, practice API key moved into the database), plus `9092bc7`/`3ca64ca` (calendar overlay/sync-status perf) and today's `0726dde` (Outlook-category calendar tiles follow night mode)
- Created (any located code): **yes**

## Located files

- `backend/splose-sync-routes.js` (`/api/splose-sync/*`, draft-and-publish queue), `backend/splose-api.js`, `backend/splose-caseload.js`, `backend/splose-draft-sync.js`, `backend/splose-poller.js` — unchanged since last audit.
- **New tonight:** `backend/splose-link-routes.js` — `GET/PUT/DELETE /api/splose/my-practitioner` (self-service practitioner identity) and `GET/PUT/DELETE /api/splose/connection` (Owner-only practice API key management), both in the same file. `backend/splose-credentials.js` — resolves the effective key (database row wins over `SPLOSE_API_KEY`; explicit disconnect switches the env key off too) and pushes it into `splose-api.js` via `setApiKey()`.
- **New migration:** `backend/migrations/069_integration_connections.sql` — one `integration_connections` row per provider, secret AES-GCM encrypted via `crypto-utils`.
- `backend/outlook-oauth.js` (OAuth client); `backend/routes-outlook-integration.js` still exists but is **not mounted anywhere** — real Outlook routes are registered inline in `server.js`.
- `backend/travel-routes.js`, `backend/travel-cascade.js`, `backend/travel-feasibility.js` — unchanged.
- Frontend: Calendar tab (`mockup_v3.html:4613`), Travel & Flights tab (`mockup_v3.html:5600`). **New tonight:** Settings → Integrations → Splose gained a practitioner picker (`mockup_v3.html:6547`, `stg-splose-me-select`) and a "Connect with a new key" / disconnect row (`mockup_v3.html:6541`) — both inline script in `mockup_v3.html`, not a separate `.js` file, so no `?v=` pin applies.

**Task mapping — "Multi Calendar Rules" does not map cleanly.** No file, route, table or UI string contains "multi calendar" or "calendar rule(s)" anywhere in `backend/` or `frontend/current/`. The closest conceptual neighbours are `sync-safety.js` (cross-source deletion-safety rules between the app, Outlook and Splose) and `outlook-mirror`'s propagation rules — but the architecture is explicitly the *opposite* of "multi calendar": `server.js` and `tests/outlook-mirror.test.js` both document a 2026-08 decision that "the calendar integration is Outlook-only — the app and Outlook mirror each other; Splose serves patient/client data only." There is no multi-calendar merge/precedence engine in this codebase. Tonight's new commits (practitioner self-linking, API-key-in-database) are Splose *identity/credential* work, not calendar-rule work, and don't supply a mapping either. This should be called out as a task the tracker names but the code does not implement under that name.

## Guard check

- `splose-sync-routes.js` — `router.use('/api/splose-sync', requireAuth, denyReadOnly, requireDraftSync)` covers 6 of 7 routes. `GET /api/splose/cancellation-reasons` sits outside that prefix but carries its own inline `requireAuth, denyReadOnly`.
- `splose-link-routes.js` (new) — `router.use('/api/splose/my-practitioner', requireAuth, ...)` with an inline `role === 'read_only'` 403 check inside the handler; `router.use('/api/splose/connection', requireAuth, requireRole('owner'))` for the practice-wide key. Both guarded, no gaps found.
- No unguarded route found in either file.

## Tests run

Re-run fresh tonight against an isolated database (`therapy_scheduler_qanight2`) after discovering the shared `therapy_scheduler_audit` database was being written to by another concurrent session mid-run — see note below.

- **New unit tests:** `tests/splose-link-routes.test.js` + `tests/splose-credentials.test.js` — **24/24 passed**.
- **New integration test:** `tests/integration/splose-connection.itest.js` — **3/3 passed** (real Postgres, migration 069 applied cleanly).
- Related unit files touched by the same commits: `tests/mobile-routes.test.js`, `tests/frontend-stage2-guards.test.js`, `tests/assessment-surface-guards.test.js`, `tests/splose-api-queue.test.js` — **138/138 passed** (4 suites).
- Prior-baseline unit suite (10 files: `outlook-delta-preserve`, `outlook-mirror`, `reconciliation-engine`, `splose-api-queue`, `splose-draft-sync`, `splose-poller`, `sync-safety`, `sync`, `travel-cascade`, `travel-feasibility`) — re-run in full tonight, **184/184 passed** (9 files ran together at 180 + `splose-api-queue` at 4, verified separately = 184 total), still green with the new code on top.
- Prior-baseline integration suite (5 files: `events-sync`, `outlook-claim`, `outlook-delta-preserve`, `reconcile-safety`, `splose-draft-sync`) — **55/55 passed** once re-run against the isolated database.

**Cross-session DB contention (not a code defect):** the first pass of the integration re-run, against the task-suggested `DB_NAME=therapy_scheduler_audit`, produced 19 failing tests across 4 of 5 suites — foreign-key violations on `events.user_id` and logins returning 401 instead of 200/302. Investigation (`ps aux`) showed another live session running `npx jest ... tests/integration/fca-reports.itest.js ...` against the *same* `DB_NAME=therapy_scheduler_audit`, truncating/reseeding tables mid-run (per `.claude/rules/tests.md`'s documented risk of two sessions sharing one `_test` database). Re-running the identical five files against a private `DB_NAME=therapy_scheduler_qanight2` reproduced a clean 55/55 pass, confirming this was infrastructure contention, not a regression from the new Splose commits.

No TODO/FIXME found in `splose-*.js`/`outlook-*.js`.

## Why not `proven`

`docs/qa/BROWSER_QA_RESULTS.md` flow E covers the Calendar tab's shell rendering, but it is dated 2026-08-01 — before ~20 calendar/travel commits *and* before the entirely new Settings → Integrations → Splose UI (practitioner picker, API-key connect/disconnect) existed at all. That new UI has zero browser or E2E proof anywhere in the repo (no `e2e/tests/*splose*` file); the developer commit messages self-report "picker exercised in-browser," which is not independent QA evidence. Same judgement the audit applied to Portal Onboarding Workflow tonight: strong, fresh API/integration proof is not the same as browser proof of the newest surface, so this stays `tab-unproven` rather than `proven` until a fresh pass specifically covers Settings → Integrations → Splose.

## Disagreement

Tracker stage is idea; the calendar/Splose/Outlook sync engine, plus tonight's new practitioner-identity and practice-credential management, is extensively built and freshly tested (24 + 138 + 184 unit, 3 + 55 integration, all green) — materially ahead of "idea," just not browser-proven yet for its newest surface.
