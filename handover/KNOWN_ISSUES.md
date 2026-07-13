# KNOWN_ISSUES.md

> Every issue re-validated against the code at commit `5581ab1` on 2026-07-12. Line numbers are current.
> Severity: 🔴 Critical · 🟠 High · 🟡 Medium · 🔵 Low.

---

## 🔴 #1 — Change Password crashes (wrong bcrypt module)
- **File/fn**: `backend/app-routes.js:941`, in `POST /api/auth/change-password`
- **Current code**: `const bcrypt = require('bcrypt');` — only `bcryptjs` is installed (verified: `node_modules/bcryptjs` exists, `bcrypt` does not).
- **User impact**: Every "Change Password" attempt from Settings returns 500 (MODULE_NOT_FOUND). Password reset (email flow) is unaffected — it uses `bcryptjs` correctly.
- **Data-loss / security**: None directly, but users stuck on a compromised password can't self-rotate it in-app.
- **Repro**: Log in → Settings → Security → Change Password → submit → 500.
- **Fix**: change to `require('bcryptjs')`.
- **Tests**: add a DB-integration test hitting the route (currently no test loads this route with a real bcrypt).

## 🔴 #2 — Owner User Management list fails (phantom column)
- **File/fn**: `backend/app-routes.js:1213`, in `GET /api/admin/users`
- **Current code**: SELECT includes `u.has_outlook_connected` — **users has no such column** (live schema verified). The query already derives `(u.access_token IS NOT NULL AND u.access_token != '') AS has_outlook` two lines below, so the phantom column is a leftover.
- **User impact**: Owner's User Management panel shows "Failed to load users"; approve/suspend/role UI can't populate.
- **Data-loss / security**: None; but owners can't manage the team.
- **Repro**: Log in as owner → Settings → User Management.
- **Fix**: delete `u.has_outlook_connected,` from the SELECT (keep the derived `has_outlook`).
- **Note**: `tests/permissions.test.js` "owner GET /api/admin/users returns 200" passes because `db.pool.query` is mocked — it does not execute the real SQL. A DB-integration test is required to catch this class of bug.

## 🔴 #3 — "Missing base location" notification never fires (phantom column)
- **File/fn**: `backend/app-routes.js:254`, `checkIncompleteProfile`
- **Current code**: `SELECT base_location, display_name FROM therapist_profiles …` — **therapist_profiles has no `base_location`** (actual column: `default_work_location_id`).
- **User impact**: The intended nudge to set a base work location (needed for travel calc) silently never appears. The error is swallowed by `Promise.allSettled` in `runAllSystemChecks`, so it's invisible.
- **Fix**: decide the real source of "base location" (currently `users.default_work_location` JSONB holds travel bases) and query that; or remove the check. Note: with `therapist_profiles` empty, no row would match anyway.

## 🔴 #6 — Outlook webhook body is unparseable in production
- **Files**: `backend/server.js:90` (`app.use(bodyParser.json())` — global) vs `backend/routes.js:726` (`require('express').raw({type:'*/*'})` on the webhook route)
- **Problem**: The global JSON body-parser runs first and consumes/parses the request body; by the time the route-level `express.raw` runs, `req.body` is already the parsed object, so `req.body.toString('utf8')` yields `"[object Object]"` and `JSON.parse` throws. The **validation-token handshake** (query-param based, `routes.js:729`) still works, so subscriptions register — but **actual change notifications are silently dropped** (`catch` logs and returns).
- **User impact**: In production with `WEBHOOK_BASE_URL` set, "real-time" Outlook sync does not work; the 90-second poller is the only thing keeping calendars in sync. On localhost webhooks don't run at all, so this is latent.
- **Data-loss / security**: None; degrades to polling.
- **Fix**: mount the webhook route BEFORE `bodyParser.json()`, or exclude `/api/webhooks/outlook` from the global JSON parser (e.g. `app.use((req,res,next)=> req.path==='/api/webhooks/outlook' ? next() : bodyParser.json()(req,res,next))`), or read the already-parsed `req.body` directly instead of re-parsing.
- **Tests**: add a test posting a Graph-shaped notification and asserting a delta sync is triggered.

## 🟠 #4 — Onboarding "Connect Outlook" hits a non-existent route
- **File**: `frontend/current/onboarding.html:858` → `fetch('/api/auth/outlook/url')`
- **Reality**: no such route. The real endpoint is `GET /auth/outlook-login` (routes.js:133), which returns `{authUrl}` (not `{url}`).
- **User impact**: The Outlook step during onboarding fails; users must connect later from Settings (which works).
- **Fix**: point the fetch at `/auth/outlook-login?returnUrl=<onboarding url>` and read `data.authUrl`.
- **Tests**: manual onboarding walk-through (no automated onboarding test exists).

## 🟠 #5 — Settings "Sync now" is a silent no-op
- **File/fn**: `backend/app-routes.js:1127`, `POST /api/sync/force`
- **Current code**: `const { runDeltaSyncForAllUsers } = require('./server');` — server.js exports `{ app, io, _webhookSubscriptions }` only, so the import is `undefined`; the `if (typeof … === 'function')` guard fails and nothing happens. Returns `{ok:true}` regardless.
- **User impact**: The manual "Sync now" button does nothing; users wait up to 90 s for the automatic poll. Misleading success response.
- **Fix**: either export `runDeltaSyncForAllUsers` from server.js, or have this route call `POST /api/sync/outlook-delta` logic directly for the current user.

## 🟠 #7 — Splose empty-response can mass-delete the calendar
- **File/fn**: `backend/server.js:535-604`, `runSploseSync`
- **Problem**: `liveIds` is built from the Splose fetch. If Splose returns an empty (or heavily truncated) list that is still a **200** (transient issue, auth scope change, pagination cutoff), every local event with a `splose_id` is treated as cancelled → soft-deleted **and deleted from Outlook** (best-effort). No floor/threshold guard.
- **User impact / data-loss**: Potential wholesale disappearance of Splose-linked appointments from both the app and Outlook. Soft-delete is recoverable in the DB; the Outlook deletions are not trivially recoverable.
- **Fix**: skip the delete pass if `liveIds.size === 0`, or if it dropped >X% vs the last successful run; log + notify instead. Require the fetch to have paged to completion.
- **Tests**: unit test asserting no deletes when the live set is empty.

## 🟠 #8 — Outlook empty-window reconcile can mass-delete
- **File/fn**: `backend/database.js:965-982`, `reconcileOutlookWindow` (called by the 60-cycle auto-reconcile in server.js and by `/api/sync/outlook-initial`)
- **Problem**: By design, when `knownOutlookIds` is empty it soft-deletes **every** outlook-sourced event in the window (`database.js:968-982`). If the Graph fetch returns empty due to a transient error rather than a genuinely empty calendar, a whole window is tombstoned.
- **User impact / data-loss**: Recoverable soft-delete, but the calendar empties until the next successful sync re-imports.
- **Fix**: treat "empty live set" as "abort reconcile + alert", not "delete all". Distinguish a real empty calendar (rare) from a failed fetch.
- **Tests**: unit test that an empty `knownOutlookIds` does NOT delete when the fetch is flagged as failed/suspect.

## 🟡 #9 — `read_only` users cannot be invited
- **File/fn**: `backend/invite-routes.js:67`, `VALID_ROLES = ['owner','admin','therapist']`
- **Reality**: DB CHECK (`user_invites_role_check_v2`) and `permissions.js` both support `read_only`; role-change to read_only works. Only the invite path rejects it.
- **User impact**: Can't onboard a view-only user via invite; must create then downgrade.
- **Fix**: add `'read_only'` to VALID_ROLES (owner-only, mirror the admin restriction).

## 🟡 #10 — Orphan `POST /api/events` (local-only events)
- **File/fn**: `backend/routes.js:594`
- **Problem**: Creates an event that never reaches Outlook or the sync path (source='app', no outlook_id, invisible to delta). No current frontend caller (Smart Booking uses `/api/outlook/events`).
- **Impact**: Dead surface that could confuse future work into thinking app-native events are a supported path.
- **Fix**: remove it, or make it write through to Outlook (like the booking path). Decide the product intent first.

## 🟡 #11 — Dead `POST /api/splose/busy-times`
- **File/fn**: `backend/routes.js:1655`
- **Reality**: Splose has **no** `POST /busy-times` endpoint (live-verified 404 "Cannot POST /v1/busy-times", earlier in project). Always 500s. No frontend caller since the non-client booking flow was switched to Outlook-only.
- **Fix**: delete the route and `splose-api.createBusyTime`, or leave a clearly-commented stub. Document that Splose busy-times must be created in the Splose UI.

## 🟠 #12 — OAuth `state` not enforced (CSRF on the OAuth callback)
- **File/fn**: `backend/routes.js:183-186`, `GET /auth/oauth/callback`
- **Current code**: logs "No (lenient mode - continuing)" and proceeds even when `state !== session.oauthState`.
- **Security impact**: OAuth login-CSRF / authorization-code injection risk in production. Also the dev fallback that auto-creates an **owner** account for an unknown Microsoft email (routes.js:201-204) is dangerous if reachable in prod.
- **Fix**: in production, reject on state mismatch (400). Remove/guard the unknown-email owner auto-create for prod. Validate the decoded returnUrl is same-origin before redirecting.
- **Tests**: callback test with a mismatched state → 400 in prod mode.

## 🟡 #13 — Email templates interpolate names without HTML-escaping
- **File/fn**: `backend/email.js` — e.g. invite `:113-123`, verification/reset/approved templates
- **Problem**: `displayName`, `invitedBy`, org name, `toEmail` are dropped into HTML with template literals, no escaping.
- **Security impact**: HTML/markup injection into outbound emails. Low severity (senders are owner/admin or the self-registering user's own name), but still a hardening gap.
- **Fix**: HTML-escape all interpolated values (a 5-line `escapeHtml`).

## 🔵 #14 — Hardcoded Azure tenant configuration
- **File/fn**: `backend/outlook-oauth.js:23-27` — tenant GUID literal in `tenantId`, `authorizationUri`, `tokenUri`.
- **Impact**: App is bound to one Azure tenant; not portable/configurable per environment.
- **Fix**: `MICROSOFT_TENANT_ID` env var; build the URLs from it (see ENVIRONMENT_VARIABLES).

## 🟠 #15 — Hardcoded `http://localhost:5001` throughout the frontend
- **File**: `frontend/current/mockup_v3.html` — 9+ occurrences (bootstrapSploseConfig block ~:7211-7301, event/patient/appointment loaders, travel/logbook/billing loaders; verified list in ENVIRONMENT_VARIABLES).
- **Impact**: **Deployment blocker** — every one of these breaks the moment the app is served from any host other than localhost:5001.
- **Fix**: replace with relative URLs (same-origin) or a single `API_BASE=''` constant + fetch wrapper.

## 🟡 #16 — Manual address overrides & session notes stored only in localStorage
- **File**: `frontend/current/mockup_v3.html` — `manual_addr_splose_<id>` (~:6878, :12365), `session_note_<id>` (:12576-12591)
- **Impact / data-loss**: Manual routing addresses for Splose-only sessions and all per-session notes live only in the current browser. Clearing browser data or switching device loses them permanently; other users never see them.
- **Fix**: persist to the DB. For Splose sessions this needs a local events row (see #17) or a dedicated overrides table. Outlook-backed events already persist via the location PATCH route — mirror that.

## 🟡 #17 — Splose appointments are never persisted to the DB
- **Where**: read flow (ARCHITECTURE flow 11). Splose appointments exist only in browser `SESSIONS`/`__outlookEventsCache` merge; `GET /api/events` doesn't know about Splose-only sessions.
- **Impact**: The frontend still merges three sources client-side (contradicts the "single reconciled feed" goal). Server-side features (search, notifications, conflict detection) can't see Splose-only sessions. Enables #16.
- **Fix**: on Splose sync, upsert appointments into `events` with `splose_id` + `source='splose'` (extend the CHECK/enum), so one unified feed serves the UI. Non-trivial — design carefully to avoid double-counting Outlook events that mirror Splose ones.

## 🔵 #18 — Frontend loads all ~5,300 events into memory
- **Where**: `loadOutlookEventsToCalendar` → `GET /api/events` (returns everything, no window) → `__outlookEventsCache`.
- **Impact**: Fine now (~5 k rows), grows unbounded with history; boot latency and memory scale with total events.
- **Fix**: add `?start&end` windowing to `/api/events` (function already accepts filters — `database.js:750`) and fetch per visible range.

## 🔵 #19 — Base64 documents stored in a PostgreSQL TEXT column
- **File**: `pd_documents.file_data`; `profile-routes.js:326-351`
- **Impact**: Rows bloat with file bodies; 5 MB each; no object storage, streaming, or virus scan. Zero rows today.
- **Fix**: move to object storage (S3/GCS) with a URL reference before the feature is used at scale.

## 🔵 #20 — `conflicts` table is disconnected; vestigial event columns
- The `conflicts` table has no readers/writers. Several `events` columns (`sync_correlation_id`, `last_synced_to_*`, teams_*, `client_id`, `ndis_plan_expiry`) are never maintained. See DATABASE_SCHEMA drift. Low priority cleanup.

---

## Previously-identified items now FIXED (with evidence)

| Item | Evidence |
|---|---|
| Perpetual delta bootstrap (7 s every 90 s, edits took >2 min) | Commit `5581ab1` — deltaLink-URL handling in `outlook-oauth.js:402`; verified incremental delta ~100 ms this session |
| Duplicate event rows from concurrent sync | Commit `e467444` — `UNIQUE(user_id, outlook_id)` present in live DB (`events_user_outlook_unique`) |
| App-created events flipped to source='outlook' on re-import | Commit `e467444` — `created_by_source` column + `COALESCE(NULLIF(created_by_source,'app'),'outlook')` in `database.js:901` |
| All Outlook events typed 'meeting' (broke billing tiers) | Commit `e467444` — `classifyEventType` now called at every upsert site (`routes.js`, `server.js`) |
| Splose poller broadcast to ALL users | Commit `e467444` — `io.to('user:'+row.user_id)` in `server.js:593` |
| Frontend ignored live `calendarUpdated` | Commit `e467444` — `socket.on('calendarUpdated')` present in mockup_v3 |
| Ghost events outside delta window | Commit `e467444` — 60-cycle `reconcileOutlookWindow` in `server.js:487-500` |
| Event vanished on Cmd+R (not saved to DB) | Commits `c42229f` + `f56d250` — synchronous `upsertOutlookEvent` in `POST /api/outlook/events`; week persisted to localStorage |
| Wrong booking date after week navigation | Commit `126cff9` — `__renderWeekHeader` now updates `DAY_DATES` |
| Delete 500 (ErrorItemNotFound re-thrown) | Commit `126cff9` — all Outlook delete errors non-fatal (`routes.js:2210`) |
| Outlook create 400 (malformed extensions) | Commit `bd943f0` — extensions field removed |
| Server freeze on re-bootstrap (5 k serial upserts) | Commit `4a648a0` — batched Promise.all(20) + narrowed window |
| Owner with no token couldn't write/see Outlook | Commits `9cf1d82`/`3bbb5e2` — org-level token fallback (NULL-org safe) |
| Google Maps API key exposed in frontend | Earlier — moved behind `/api/maps/*` proxy |
