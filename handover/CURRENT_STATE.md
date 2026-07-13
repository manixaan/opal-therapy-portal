# CURRENT_STATE.md — Opal Therapy Scheduler

> Generated 2026-07-12 from the live repository and a live boot + test + database check.
> Every claim below was verified against the actual code or a command run on this date.

---

## Project purpose

Internal operations platform for Opal Therapy (occupational-therapy practice, Perth WA).
It unifies three calendars behind one scheduling UI:

1. **The app's own PostgreSQL event store** (source served to the UI)
2. **Outlook** via Microsoft Graph (bi-directional sync: 90-second delta polling, write-back, optional webhooks)
3. **Splose** practice-management software (read proxy + appointment creation + 15-minute cancellation poller)

On top of scheduling it provides: travel planning (Google Maps proxy), NDIS case tracking, dormant-case detection, billing views, staff management (invites, roles, approval workflow), leave/CPD/credentials tracking, notifications, and an ATO travel logbook.

---

## Repository facts (verified 2026-07-12)

| Fact | Value |
|---|---|
| Git branch | `main` |
| Latest commit | `5581ab1d09e518a7a757276798df5f017f30b286` — "Fix perpetual delta bootstrap — use Graph deltaLink URL directly" (2026-06-29) |
| Git status | Clean except one untracked directory: `.claude/worktrees/` (local AI-tooling artefact, safe to ignore/delete) |
| Uncommitted changes | None |
| Untracked files | `.claude/worktrees/` only |
| Frontend entry point (main app) | `frontend/current/mockup_v3.html` (23,868 lines) — served by Express at `GET /` after auth |
| Frontend auth pages | `frontend/current/{login,register,forgot-password,reset-password,verify-email,pending-approval,onboarding}.html` |
| Backend entry point | `backend/server.js` (`main` in package.json) |
| Node.js version in use | v26.0.0 |
| Package manager | npm 11.12.1 (package-lock.json present) |
| Database | PostgreSQL (local; `pg` driver v8.x; schema auto-applied on boot — no migration tool) |
| Dev startup | `cd backend && npm run dev` (nodemon) |
| Plain startup | `cd backend && npm start` → `node server.js` |
| Production startup | **Not yet defined** — no Procfile/systemd/container config exists (see DEPLOYMENT_READINESS.md) |
| Test command | `cd backend && npm test` → `jest --config jest.config.js` |
| Server boots cleanly? | **Yes** — verified this date: DB initialises, routes register, `GET /health` returns `{"status":"healthy"}` |
| All tests pass? | **Yes** — 3 suites, 47/47 tests, ~0.9 s (verified this date) |

Port note: the server defaults to `PORT=5000` in code but the local `.env` sets 5001; every frontend hardcoded URL assumes **5001**.

---

## Feature status — the honest ledger

### ✅ Implemented and verified (exercised this session or covered by passing tests)

- Email/password login, logout, sign-out-all-devices; session regeneration; login rate limiting (10/15 min/IP) — covered by `tests/auth.test.js`
- Account lifecycle: `pending_verification → pending_approval → active / suspended / deactivated`, enforced at page-serving and login layers
- Email verification (24 h token) and password reset (1 h single-use token + all-session invalidation)
- RBAC: `owner / admin / therapist / read_only`; owner-only admin routes; therapist calendar isolation; financial-field stripping — covered by `tests/permissions.test.js`
- Registration via invite token and via env allowlist; first-owner bootstrap
- Outlook OAuth connect (from main app Settings), token refresh, AES-256-GCM token encryption at rest (pass-through if key unset)
- Outlook → app delta sync every 90 s: correct deltaLink handling, stale-token recovery, batched upserts, soft-delete on `@removed`/`isCancelled` — behaviourally verified end-to-end this session; upsert idempotency covered by `tests/sync.test.js`
- App → Outlook write-back: create (with synchronous local-DB save), update, delete, location patch, travel blocks; org-level token fallback
- DB-level duplicate guard: `UNIQUE(user_id, outlook_id)` (verified present in live DB)
- Ghost-event mitigation: periodic ±90-day full reconciliation every ~60 delta cycles; manual `/api/sync/cleanup` and `/api/sync/reconcile`
- Event-type classification from Outlook categories (`sync-utils.js`) feeding billing-tier logic
- Splose read proxy (appointments/patients/cases/services/practitioners/locations/invoices/payments/support-items/busy-times/contacts) with rate-limit queue and 10-min cache
- Splose appointment creation from Smart Booking (client sessions), Splose 15-min cancellation poller (soft-delete local + best-effort Outlook delete)
- Smart Booking wizard: client path (steps 1→4) and non-client path (steps 1→4 direct); drag-to-book with duration preserved; correct date after week navigation; week position persists across refresh
- Right-click delete on calendar tiles (Outlook + DB soft-delete)
- Live refresh: per-user Socket.IO rooms; frontend `calendarUpdated` handler reloads events
- Sync diagnostics endpoint `/api/sync/diagnostics`
- Google Maps proxy (`/api/maps/*`) — key stays server-side
- Security hardening: helmet, CORS allowlist, Origin/Referer CSRF check on unsafe methods, startup secret guards, audit logging

### 🟡 Implemented but not tested (code path exists and looks correct; never exercised end-to-end)

- Outlook **webhooks** (registration, renewal, notification handler) — cannot run on localhost; additionally has a known raw-body bug (see Broken)
- Leave requests / CPD / PD documents / credentials CRUD + approval flows (routes complete; UI wired; no automated tests; owner-approval paths not manually exercised this session)
- Invite create/revoke/resend emails (email transport skipped in dev — logs link instead)
- Multi-therapist master calendar endpoints (`/api/calendar/master`, `/availability`, `/therapists-summary`) — `therapist_profiles` table is **empty** in the live DB, so these return empty sets; org-token fallback papers over it for single-user use
- Friday location-alarm cron; 15 notification system-checks (most fire correctly; two are broken — see below)
- `PUT /api/splose/appointments/:id` (reschedule write to Splose)
- Password change from onboarding/registration pages (auth-page flows verified; **Settings change-password is broken**, see below)

### 🟠 Partially implemented

- **Unified calendar feed**: the frontend still merges three sources in the browser (`GET /api/events` + live Splose fetches + canvas state). The designed single reconciled endpoint (`/api/calendar/events` as sole source) exists for the multi-therapist path but the main UI does not use it.
- **Multi-therapist model**: full schema + routes exist; zero `therapist_profiles` rows; `organisation_id` is NULL on all users/events; UI therapist-selector falls back to Splose practitioner list.
- **Manual address overrides**: DB columns + PATCH route exist and work for Outlook-backed events; Splose-session overrides still live only in browser localStorage (`manual_addr_splose_*`).
- **read_only role**: enforced by permissions map and admin role-change; **cannot be invited** (invite route omits it from VALID_ROLES).

### 🔴 Broken (verified against live code/DB on this date — see KNOWN_ISSUES.md for line refs)

1. Settings → Change Password: `require('bcrypt')` but only `bcryptjs` is installed → always 500
2. Owner User Management list: SQL references non-existent `users.has_outlook_connected` → query fails
3. "Missing base location" notification check: references non-existent `therapist_profiles.base_location` → silently never fires
4. Onboarding "Connect Outlook" step: calls `GET /api/auth/outlook/url` which does not exist (real route: `GET /auth/outlook-login`)
5. Settings "Sync now": imports `runDeltaSyncForAllUsers` from server.js, which is not exported → silent no-op
6. Production webhooks: app-level `bodyParser.json()` consumes the Graph notification body before the route-level `express.raw()` → notification processing throws and is dropped (validation handshake unaffected)

### 📋 Planned only (never built)

- Production deployment packaging (Procfile/container, prod CSP, ALLOWED_ORIGINS for a real domain)
- npm-audit remediation pass
- Splose appointment persistence into the local events table
- Safety floor on empty-list reconciliation/poller deletes
- Frontend modularisation (single 23.9 k-line HTML file)
- Everything in `docs/FEATURE_ADDITIONS_ROADMAP.md` and `docs/COMPLETE_FEATURE_ROADMAP_MAY2026.md` not listed above (flight tracking, auto-fit multi-client scheduling — auto-fit UI exists but is hidden via `display:none` and force-disabled by an org-settings flag)

### 🪦 Legacy / dead code (safe to delete after confirming with the owner)

- `backend/routes-backup-original.js`, `backend/routes-outlook-integration.js` — required by nothing (grep-verified)
- `backend/{test-splose,check-outlook-categories,check-remaining-data,inspect-splose-fields,discover-splose-api}.js` — one-off CLI probes hitting live APIs with `.env` creds; never imported by the server
- `frontend/archive/*` (mockup v1/v2/v2-updated, travel_logger.js, travel_report_generator.js) — superseded by mockup_v3
- `reference/dormant_cases_scheduler.js` — reference copy; live implementation is in routes.js + frontend
- `docs/archive/*` — historical planning docs; several describe features as "complete" that differ from the current code (do not trust them)
- Route `POST /api/splose/busy-times` — Splose has no such endpoint (verified live: 404 "Cannot POST"); always returns 500; frontend no longer calls it
- Route `POST /api/events` — creates local-only events invisible to Outlook sync; no current UI caller (Smart Booking uses `/api/outlook/events`)
- `conflicts` table — 0 rows, no code writes to it

---

## Data snapshot (live DB, counts only — no personal data)

| Table | Rows | Note |
|---|---|---|
| events | 5,473 | ~5.3 k Outlook-synced + test bookings; soft-deleted rows included in count |
| sync_log | 5,197 | append-only sync audit |
| users | 4 | 1 real therapist account (Outlook-connected) + owner/admin/therapist dev accounts |
| user_notifications | 48 | |
| organisations | 1 | "Opal Therapy" — but `users.organisation_id` is NULL on all rows |
| outlook_delta_state | 1 | delta token currently healthy |
| audit_logs | 20 | |
| user_settings | 1 | |
| therapist_profiles, user_invites, leave_requests, cpd_activities, pd_documents, credentials, org_settings, sessions, conflicts | 0 | sessions prunes itself; the rest never populated |
