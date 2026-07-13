# AI_CONTINUATION_NOTES.md — For the next AI developer

You are continuing a real, in-use internal app (Opal Therapy Scheduler). Read this before touching anything.

## 0. Golden rules
- **Ground every claim in the current code.** Prior planning docs (`docs/`, `docs/archive/`, `backend/docs/`) and old commit messages describe intentions, not reality — several claim "complete" for things that differ from the code. When unsure, run a command and verify. Say "needs verification" rather than guessing.
- **Never expose or commit secrets** (`backend/.env`), tokens, client/employee/health data. `.gitignore` already covers `.env`; keep it that way.
- **The database is live and holds real synced data (~5.5k events).** Never run destructive SQL casually. The empty-response delete bugs (#7/#8) mean sync code can wreck the calendar — treat those paths with extreme care.
- **Commit only when asked; branch off `main` for anything non-trivial.**

## 1. Read these first, in order
1. `handover/CURRENT_STATE.md` — what actually works vs. broken vs. dead
2. `handover/ARCHITECTURE.md` — subsystems + the 15 data flows
3. `handover/KNOWN_ISSUES.md` — the exact bugs with current line numbers
4. `backend/server.js` — entry point, middleware, all background jobs
5. `backend/database.js` — schema (`INIT_QUERIES`) + `upsertOutlookEvent` (the sync core)
6. `backend/routes.js` — sync + Splose + Outlook write-back
7. `backend/permissions.js` — the RBAC source of truth
8. `backend/outlook-oauth.js` + `backend/splose-api.js` — the two integrations
Then skim `handover/API_INVENTORY.md` and `DATABASE_SCHEMA.md` as references.

## 2. Sources of truth (do not create competing ones)
- **RBAC**: `permissions.js` (`ROLE_PERMISSIONS`). Not the frontend, not per-router copies.
- **Schema**: the live DB + `INIT_QUERIES`. There is **no migration tool** — schema changes go in `INIT_QUERIES` as idempotent `ALTER TABLE … IF NOT EXISTS` / guarded `DO` blocks. (Adopting real migrations is ROADMAP Phase 5 — propose it, don't silently half-do it.)
- **Event identity for sync**: `(user_id, outlook_id)` UNIQUE. `upsertOutlookEvent` is the ONLY correct way to write Outlook-sourced events — it preserves `created_by_source`, manual location, and idempotency. Don't hand-roll INSERTs into `events` for synced data.
- **Origin of an event**: `created_by_source` ('app'|'outlook') is permanent; `source` can flip during sync. Preserve this distinction — it's what prevents app→Outlook→app loops.
- **Times**: UTC everywhere in the backend/DB (pinned three ways). The frontend converts to Australia/Perth (UTC+8) for display. Never store Perth wall-clock.

## 3. Naming / conventions
- Routes: `/api/<area>/<thing>`. Splose proxy = `/api/splose/*`, Outlook write-back = `/api/outlook/*`, sync = `/api/sync/*`.
- DB helpers live in `database.js` and are imported as `db.*`. Splose calls go through `splose-api.js` (never call Splose directly except the two existing direct-axios spots). Graph calls go through `outlook-oauth.js`.
- `requireAuth` attaches `req.user` (with computed permissions); guard with `requireRole(...)`/`requirePermission(...)`.
- Frontend globals: `window.APP_USER/APP_SETTINGS`, calendar state `window.__currentWeekMonday/__outlookEventsCache`, canvas model `SESSIONS`, booking state `BOOKING_STATE`. See FRONTEND_MAP.md.
- Emoji-tagged `console.log` is the house logging style; keep it readable, never log tokens.

## 4. High-risk code paths (change with tests + care)
- `server.js` `runSploseSync` (:535) and `database.js` `reconcileOutlookWindow` (:965) — **can mass-delete**. Any change here needs an empty-set safety test first (#7/#8).
- `database.js` `upsertOutlookEvent` (:836) — the idempotency + origin-preservation core. Its SQL parameter numbering is fiddly; read the whole function before editing and re-run `tests/sync.test.js`.
- `outlook-oauth.js` `getOutlookCalendarDelta` (:391) — the deltaLink handling (`startsWith('https://')`, :402) is load-bearing; breaking it re-introduces the perpetual-bootstrap freeze.
- `routes.js` `POST /api/outlook/events` (:1940) — write-back + synchronous local save + org token fallback; the sequence matters for no-duplicate + survives-refresh behaviour.
- Auth/session invalidation (`auth.js`, `app-routes.js` suspend) — don't weaken the enumeration defences or the session-delete-on-reset/suspend.

## 5. Integrations that need special care
- **Splose API quirks are intentional, not bugs** — do NOT "fix" them: `/appointments` takes no date params (fetch-all + filter in Node); cursor-only pagination; fields are `name`/`pricing` not `title`/`price`; **there is no DELETE /appointments and no POST /busy-times** (cancellations happen in Splose UI). The rate-limit queue (600 ms) exists because Splose enforces ~2 req/s — respect it.
- **Graph**: `Prefer: outlook.timezone="UTC"` on reads is the timezone-correctness fix; keep it. Event-create must NOT include Graph `extensions` (caused 400s — commit bd943f0). Tokens auto-refresh; don't duplicate that logic.
- **Webhooks** are broken in prod by the raw-body bug (#6) — if you enable them, fix that first, and remember the subscription→user map is in-memory (lost on restart).

## 6. Known misleading / obsolete files (don't trust or wire these)
- `backend/routes-backup-original.js`, `backend/routes-outlook-integration.js` — dead, mounted by nothing.
- `backend/{test-splose,check-*,inspect-splose-fields,discover-splose-api}.js` — one-off CLI probes that hit live APIs with real creds; don't run casually.
- `frontend/archive/*` — old mockups (one once had a hardcoded Maps key). The authoritative UI is `frontend/current/mockup_v3.html`.
- `docs/archive/*`, `backend/docs/*`, roadmap docs — historical; supersede with `/handover`.
- Route `POST /api/events` and `POST /api/splose/busy-times` — orphan/dead; don't build on them.
- The triple-mount of routes.js (`/`,`/auth`,`/api`) creates phantom alias paths — use canonical paths only; consider collapsing the mount.

## 7. Where previous AI work introduced inconsistencies
- **Tests mock the DB**, so they pass while three real SQL/dep bugs (#1/#2/#3) ship. Add DB-integration tests before trusting green CI.
- Duplicate `requireAuth` in four files; four different frontend "loaders" for events; `DAY_DATES` was previously stale on nav (fixed) — watch for similar "state updated in one place but not the mirror" patterns.
- Schema has vestigial columns/tables from earlier iterations (`conflicts`, `sync_correlation_id`, teams_*). Don't assume a column is used just because it exists — grep first.
- `organisation_id` is NULL everywhere despite one org row; the `IS NOT DISTINCT FROM` fallback queries exist only to cope. If you backfill org, simplify them.

## 8. Recommended order for making changes
1. Do **ROADMAP Phase 1** (reproducibility + a DB-integration test harness) FIRST — it makes every later change safe to verify.
2. Then **Phase 2** small bug fixes (#1,#2,#3,#4,#5,#9) — each is a few lines; add a DB test per fix.
3. Then **Phase 3** data-loss guards (#7,#8) — highest real-world risk.
4. Then security (Phase 4) and deployment (Phase 6) before any real users.
5. Big items (Splose persistence #17, frontend modularisation, CSP) come after the app is safely deployable — they're large and shouldn't block the small wins.
- One change at a time; keep diffs small and reviewable; write the test that would have caught the bug.

## 9. Commands to run after every change
```bash
cd backend
npm test                      # 47 tests must stay green (add to them, don't regress)
node -e "require('./server.js')" &  # or: npm start — confirm it boots, GET /health = healthy, then stop it
```
- If you changed SQL/schema: boot once (INIT_QUERIES runs) and confirm no error, then spot-check the affected route against the **real** DB (the mocked tests won't catch schema mistakes).
- If you changed a sync path: check `/api/sync/diagnostics` for `possibleDuplicates` (should be empty) and `ghostCandidates`.
- If you touched the frontend: hard-refresh; verify the change AND that the calendar still loads and a booking still round-trips (there are no frontend tests to catch regressions).
- Before ending: re-read your diff for accidental secret exposure or a hardcoded URL/port.

## 10. When you're unsure
State the uncertainty and how to resolve it (a command, a file to read, a question for the owner). Do not present a guess as fact. This project has already accumulated confident-but-wrong documentation — don't add more.
