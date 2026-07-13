# ARCHITECTURE.md — Opal Therapy Scheduler

> Grounded in the code at commit `5581ab1`. File:line references are to that commit.

---

## 1. Subsystem architecture

### Authentication
- **Primary**: email + password. bcryptjs cost 12. Timing-safe compare against a dummy hash when the user doesn't exist (`auth.js:105-107`). Generic error messages prevent enumeration.
- **Login rate limit**: in-memory Map, 10 attempts / 15 min / IP, `Retry-After` header, pruned every 10 min (`auth.js:53-86`). Resets on restart (accepted trade-off).
- **Session fixation defence**: `req.session.regenerate()` on successful login (`auth.js:159`).
- **Account-status gate at login**: inactive / pending_verification / pending_approval / suspended / deactivated each return distinct 403 codes (`auth.js:127-156`).
- **Microsoft OAuth is NOT a login method** — it *links* an Outlook calendar to an already-existing local account by email match (`routes.js:200-210`). Dev-mode exception: an unknown Microsoft email auto-creates an owner account (`routes.js:201-204`) — must be disabled for production.
- Page-level guard: `GET /` checks session + account_status + profile_completed and redirects to the right page before serving the app (`server.js:243-257`).

### Sessions
- `express-session` with custom `PgSessionStore` (`session-store.js`) on the shared pg pool. Table `sessions (sid, sess jsonb, expire)` auto-created; pruned every 15 min.
- 8-hour rolling TTL; cookie `httpOnly`, `sameSite:lax`, `secure` in production (`server.js:179-193`).
- The same session middleware is **shared with Socket.IO** (`server.js:198`) so sockets know their userId.
- Mass invalidation: password reset and sign-out-all delete rows via `sess->>'userId'` (`auth.js:242-245, 533-536`). Suspension does **not** currently delete sessions — the user is locked out on their next request because `requireAuth` re-checks `is_active`/status per request via `db.getUser` (`routes.js:58-78`); the app-routes admin suspend handler also deletes sessions — verify per flow 15 below.

### Roles & permissions
- Single source of truth: `permissions.js`. `ROLE_PERMISSIONS` maps 4 roles → permission strings. `requireAuth` (per-router copies exist — see AI_CONTINUATION_NOTES) attaches `req.user` with computed permissions; `requireRole(...)`/`requirePermission(...)` guard routes.
- `read_only`: 12 view-only permissions. `therapist`: own calendar/clients only. `admin`: operational, no financials. `owner`: everything.
- Calendar isolation is enforced in the query layer, not just middleware: therapists' requested therapist-IDs are overwritten with their own profile id (`calendar-routes.js:281-286`).
- `stripFinancials` removes rate/revenue/billing fields from responses for non-owners (`permissions.js:201-213`).

### Frontend
- One self-contained HTML file per page; no framework, no build step. The main app is a single-file SPA with tab-based views (`switchTab`), a hand-rolled week-grid calendar, and a global `SESSIONS` object as the canvas state. See FRONTEND_MAP.md.
- Served by the backend itself (`express.static(frontend/current)` + guarded sendFile routes), so same-origin — no CORS needed in the browser.

### Backend
- Single Express process. 8 routers mounted in `server.js:334-365` (auth → routes → calendar → register → invite → profile → app → maps).
- **Quirk**: `routes.js` is mounted at `/`, `/auth`, *and* `/api` (`server.js:339-341`), so each of its routes answers on three prefixes (e.g. `/api/events`, `/auth/api/events`, `/api/api/events`). Only the canonical paths are used by the frontend; the aliases are accidental surface (see API_INVENTORY).
- Global error handler hides messages in production (`server.js:309-315`). Startup guards refuse prod boot with weak `SESSION_SECRET` or missing `TOKEN_ENCRYPTION_KEY` (`server.js:144-175`).

### Database
- PostgreSQL, single pool (max 20), **UTC everywhere**: `process.env.TZ='UTC'` before any require (`server.js:20`), pg type parsers force TIMESTAMP → UTC (`database.js:36-37`), pool `options:'-c TimeZone=UTC'`.
- **Schema management = `INIT_QUERIES`** (`database.js:77-543`): one big idempotent SQL string (CREATE TABLE IF NOT EXISTS + ALTER TABLE ADD COLUMN IF NOT EXISTS + guarded DO-blocks) executed on every boot. There is **no migration tool and no down-migrations**. Boot also runs a duplicate-outlook_id cleanup (`database.js:555-566`).
- Full table detail in DATABASE_SCHEMA.md.

### Outlook / Microsoft Graph
- App-level OAuth (authorization-code), scopes `Calendars.ReadWrite offline_access User.Read`. Tenant-specific endpoints with a **hardcoded tenant ID** (`outlook-oauth.js:23-27`).
- Tokens stored on `users` (encrypted); refreshed when <60 s left, by both the request path (`routes.js:90-124`) and pollers (`server.js:394-409`).
- **Reads**: `getOutlookCalendarEvents` (calendarView, `Prefer: outlook.timezone="UTC"`, $top=250, ≤50 pages) and `getOutlookCalendarDelta` (90-day-back/180-day-forward bootstrap window; returns changed[], deleted[], new deltaToken; accepts a full deltaLink URL — `outlook-oauth.js:391-470`).
- **Writes**: create/update/delete event; travel-block create. Create payload deliberately has no Graph extensions (they caused 400s — commit `bd943f0`).
- **Webhooks**: subscription create/renew in `server.js:613-709` (gated on `WEBHOOK_BASE_URL`); receiver at `POST /api/webhooks/outlook` (`routes.js:724-821`). Subscription→user map is **in-memory only** (`_webhookSubscriptions`), rebuilt by re-registration on boot.

### Splose
- Server-side proxy only; Bearer `SPLOSE_API_KEY`; base `https://api.splose.com/v1`.
- Client (`splose-api.js`) enforces ~2 req/s via a promise queue (600 ms gap), retries 429 ×3 with backoff, caches parameterless full-list fetches 10 min with in-flight dedup.
- **API quirks encoded in the client** (do not "fix" them): `/appointments` accepts NO date params (fetch all, filter client-side); pagination is cursor-only via `links.nextPage`; services use `name`/`pricing` not `title`/`price`; **no DELETE /appointments** and **no POST /busy-times** exist (cancellations must be made in the Splose UI).
- Writes that DO work: `POST /appointments`, `PUT /appointments/:id`, `POST /patients`, `POST /support-activities`.

### Socket.IO
- Shares Express session; authenticated sockets join room `user:<id>` (`server.js:288-304`). All emits are room-scoped `calendarUpdated {upserted,cancelled,removed}` from: delta poller, webhook handler, Splose poller. Frontend handler → `loadOutlookEventsToCalendar()`.

### Background jobs (all in server.js; all in-process timers — they die with the process)
| Job | Interval | Guard | What it does |
|---|---|---|---|
| Outlook delta poller | 90 s (+5 s boot delay) | `deltaRunning` flag | Per user with a token: refresh token → delta fetch → batched upserts (20) + soft-deletes → save token → emit. Every 60th cycle per user: full ±90-day reconcile (`reconcileOutlookWindow`) |
| Splose cancellation poller | 15 min (+8 s) | `sploseRunning` flag | Fetch ±90-day Splose appts → any local `splose_id` event not in the live/non-cancelled set is soft-deleted + best-effort Outlook delete + scoped emit. **No empty-list safety floor** |
| Webhook registration | boot +10 s; renew every 2 days | env-gated | POST/PATCH Graph subscriptions (3-day expiry) |
| Friday location alarm | hourly check, fires Fri (UTC) | prefs opt-out | Stores a notification if next week's work-location schedule is incomplete |

### Email
- Nodemailer SMTP (`email.js`); if `EMAIL_HOST/USER/PASS` unset → transport skipped, action link printed to server log (the current dev workflow). Five HTML templates. `tls.rejectUnauthorized` only in production. Names interpolated without HTML-escaping (see SECURITY_REVIEW).

### Google Maps
- `maps-routes.js` proxy: `/api/maps/sdk-url` (key injected server-side; frontend loads SDK dynamically), `/routes` (Routes API, TRAFFIC_AWARE), `/places` (Text Search), `/geocode` (AU/WA-biased). All requireAuth, sanitised inputs, fixed upstream URLs, 8 s timeouts. 503 when key unset.

### File uploads
- PD documents only: base64 string in JSON body → `pd_documents.file_data` TEXT column. 5 MB raw cap checked as 7 MB base64 (`profile-routes.js:334-336`). No streaming, no object storage, no virus scanning, list endpoint excludes file_data. Fine for a handful of certificates; wrong design for scale (ROADMAP Phase 10).

---

## 2. Step-by-step data flows

**Notation**: FE = frontend function, → API route, BE = backend function, DB = tables, EXT = external API.

### Flow 1 — Employee login
1. FE `login.html` submit → `POST /api/auth/login` {email,password}
2. BE `auth.js` handler: `loginRateLimit` → `db.getUserByEmail` (DB: users) → bcrypt.compare (dummy-hash if no user) → status checks → `req.session.regenerate` → set `session.userId` → `db.recordLogin`, `db.logAuditEvent` (DB: users, audit_logs; sessions row via store)
3. Response `safeProfile` + permissions → FE redirects to `/`
4. `GET /` (server.js) re-checks account_status/profile_completed → serves mockup_v3.html
5. App boots: `GET /api/auth/me`, socket connect (joins `user:<id>`), `loadOutlookEventsToCalendar()` → `GET /api/events`, `bootstrapSploseConfig()` → 4 Splose proxy calls, `GET /api/sync-status`.

### Flow 2 — Employee registration
1. FE `register.html`: on load with `?token=` → `POST /api/auth/check-invite` (BE validates token state, returns email/role) — or manual email path (allowlist check)
2. Submit → `POST /api/auth/register` {token|email, password, confirmPassword, profile{name,…}}
3. BE `register-routes.js`: validate password policy → resolve path: invite (`db.findPendingInviteByToken`) or allowlist (`isAllowlistedEmail` from env) → 409 if account exists → first-owner bootstrap if no active owner (allowlist path becomes owner+active) → create user: invite path uses transactional `db.registerUserFromInvite` (DB: users, therapist_profiles, user_invites) else direct INSERT → set `account_status='pending_verification'`, store verification token (24 h) → audit → `emailSvc.sendVerificationEmail` (EXT: SMTP, or console link)
4. Response `{requiresVerification:true}` → FE shows "check your email". No session is created.

### Flow 3 — Employee approval
1. Owner opens Settings → User Management → `GET /api/admin/users` (**currently broken** — bad column; see KNOWN_ISSUES #2)
2. Approve → `PATCH /api/admin/users/:id/approve` (app-routes.js; requireRole('owner')) → UPDATE users SET account_status='active', approved_by/at → audit → `sendAccountApprovedEmail`
3. User can now pass the login status gate.

### Flow 4 — Employee onboarding
1. First login with `profile_completed=false` → `GET /` redirects → `GET /onboarding` (server-side status guard) → onboarding.html
2. FE loads state: `GET /api/auth/onboarding` (BE returns safeProfile + step)
3. Each step → `POST /api/auth/complete-onboarding-step` {step,data,skipped} — BE whitelists 9 step names, appends to completed/skipped JSONB arrays, applies step-specific UPDATEs (profile fields, work_location_schedule, travel bases, notification prefs) (DB: users)
4. Outlook step → **broken**: FE fetches `GET /api/auth/outlook/url` which doesn't exist (KNOWN_ISSUES #4); user must connect later from Settings
5. `review` step (not skipped) → sets profile_completed=TRUE, onboarding_step='complete' → `GET /` now serves the app.

### Flow 5 — Outlook OAuth connection (from main app)
1. FE `startOutlookSync()` (mockup_v3 ~:14633) → `GET /auth/outlook-login?returnUrl=<app URL>`
2. BE builds Graph authorize URL; CSRF+returnUrl encoded into `state` (`csrf|base64(returnUrl)`); state also mirrored in session → FE `window.location.href = authUrl` (EXT: Microsoft login)
3. Microsoft redirects → `GET /auth/oauth/callback?code&state` → BE: exchange code (`getAccessToken`), fetch profile (`getMicrosoftUser`), match local user **by email** (dev fallback: create owner), link microsoft_id, `db.updateUserTokens` (encrypt) (DB: users), set session, serve an HTML success page that auto-redirects to returnUrl
4. Note: state mismatch only logs a warning ("lenient mode", routes.js:183) — tighten for prod (SECURITY_REVIEW).

### Flow 6 — Client appointment creation (Smart Booking, client path)
1. FE wizard: step 1 patient (`PATIENTS` from `GET /api/splose/patients`) → step 2 service type → step 3 `renderSlotSuggestions()` (prefill from `_bspPrefill`/live panel fields + `computeSlotSuggestions` scored against SESSIONS; loads live week via `GET /api/splose/appointments`) → step 4 `confirmBooking()` (~:10698)
2. `confirmBooking` client path: build Perth ISO times from `DAY_DATES` → **Splose write**: `POST /api/splose/appointments` {start,end,serviceId,locationId,practitionerId,patientId,caseId,note} → BE `sploseApi.createAppointment` (EXT: Splose; cache invalidated). Failure = abort with toast.
3. **Outlook write** (awaited): `POST /api/outlook/events` {title,startTime,endTime,sploseId,targetTherapistUserId?} → BE resolves token (target user → org-fallback) → `outlookApi.createOutlookEvent` (EXT: Graph) → `db.updateEventOutlookId` if dbEventId → **synchronous local save** `db.upsertOutlookEvent(…, createdBySource:'app', eventType: classifyEventType(...), sploseId)` (DB: events) → 201 {outlookId}
4. FE: `addSession()` paints tile, `gotoWeekOf(date)` navigates + persists week, success modal shows Splose ✓ / Outlook status. Next delta tick UPDATEs the same row (no duplicate — unique constraint + upsert; `source` stays 'app' via created_by_source).

### Flow 7 — Appointment modification
- **From the app (Outlook-backed tiles)**: FE detail drawer `bdRecalc`/save → `PATCH /api/outlook/events/:dbId` {title?,startTime?,endTime?,location?} → BE: look up outlook_id (404 if none) → `updateOutlookEvent` (EXT: Graph, partial PATCH) → `db.updateEvent` mirror (DB: events, last_modified_by='app') → sync_log 'updated/success'. Failures log sync_log 'failed' + durable notification.
- **Location only**: `PATCH /api/outlook/events/:dbId/location` — DB first (`updateEventManualLocation`, sets is_manual_location_override=TRUE so future syncs never overwrite), then Graph.
- **Splose reschedule**: `PUT /api/splose/appointments/:id` exists (BE `updateAppointment`); FE uses it from the reschedule/edit paths for Splose-backed sessions.
- **In Outlook directly**: picked up by Flow 9; upsert overwrites title/times, preserves manual location + created_by_source.

### Flow 8 — Appointment deletion
1. FE right-click → `ctxDeleteEvent(id)` (or drawer `bdDeleteEvent`) → confirm → `DELETE /api/outlook/events/:dbId`
2. BE (routes.js:2180): fetch row (user-scoped) → if outlook_id: resolve token (caller → org fallback) → `deleteOutlookEvent` (EXT: Graph) — **all Outlook errors non-fatal** → soft-delete local row (is_deleted=TRUE) (DB: events)
3. FE removes tile from DOM + SESSIONS. Next delta tick may echo an `@removed` → `softDeleteEventByOutlookId` no-ops (idempotent).

### Flow 9 — Outlook → application sync
1. Timer (90 s) `runDeltaSyncForAllUsers` (server.js:418): users with access_token → `getValidTokenForUser` (refresh if <60 s; DB: users) → `db.getDeltaState` (DB: outlook_delta_state)
2. `getOutlookCalendarDelta(token, storedTokenOrUrl)` (EXT: Graph /calendarView/delta; bootstrap window −90/+180 d)
3. changed[]: isCancelled → `softDeleteEventByOutlookId`; else `upsertOutlookEvent` with `eventType: classifyEventType(categories)` — batches of 20 (DB: events)
4. deleted[] (@removed) → soft-delete (source='outlook' rows only — app rows protected)
5. Save new deltaToken; emit `calendarUpdated` to `user:<id>`; FE handler reloads events
6. Every 60th cycle: `getOutlookCalendarEvents(±90 d)` → `reconcileOutlookWindow` soft-deletes local outlook rows absent from the live set (ghost purge)
7. 400/410 → clear token; next tick re-bootstraps.

### Flow 10 — Application → Outlook sync
Covered by flows 6/7/8 (create/patch/delete write-back) plus `POST /api/outlook/travel-blocks` (creates Graph event + local source='app' event_type='travel' row, sync_log). Loop prevention: write-back saves outlook_id + created_by_source='app' immediately, so the delta echo matches the existing row and only UPDATEs; nothing is ever re-pushed to Outlook by the sync path (import never triggers export).

### Flow 11 — Splose appointment sync (read)
1. FE tab/booking loads → `SploseSync` service (stale-while-revalidate, sessionStorage-cached) → `GET /api/splose/appointments?startDate&endDate`
2. BE (routes.js:1304): `getAppointments` (EXT: Splose, all pages, client-side date filter) + parallel patients/support-items/locations → enrichment: routing address priority = billing/travel addr → patient addr → non-mobile venue addr; `isRoutable` + `missingReason` computed
3. FE `loadSploseAppointmentsIntoSessions` / calendar merge paints tiles (UTC→Perth). **Not persisted to DB** — Splose-only sessions exist solely in browser state.

### Flow 12 — Splose cancellation handling
1. Timer (15 min) `runSploseSync` (server.js:535): fetch ±90-day appointments (EXT: Splose)
2. liveIds = appts not fully-cancelled (every patient status = 'Cancelled' ⇒ cancelled)
3. Local events WHERE splose_id IS NOT NULL AND is_deleted=FALSE (DB: events): any id ∉ liveIds → soft-delete + best-effort `deleteOutlookEvent` (EXT: Graph) + scoped `calendarUpdated`
4. ⚠️ No guard against a legitimately-empty/failed-but-200 Splose response → would cancel everything (KNOWN_ISSUES #7).

### Flow 13 — Calendar live refresh
Socket path: any poller/webhook change → `io.to('user:<id>').emit('calendarUpdated', counts)` → FE `socket.on('calendarUpdated')` (mockup_v3, next to connect handlers) → `loadOutlookEventsToCalendar()` → `GET /api/events` → re-render week (`renderCurrentWeek`), preserving `__currentWeekMonday` (localStorage `opal_calendar_week`).

### Flow 14 — Password reset
1. `forgot-password.html` → `POST /api/auth/forgot-password` {email} — always `{ok:true}` (no enumeration); per-email 3-min cooldown; only sends for verified active/pending_approval accounts → token (1 h) stored (DB: users) → `sendPasswordResetEmail` (EXT: SMTP/console)
2. Link → `reset-password.html?token=` → `POST /api/auth/reset-password` {token,password,confirmPassword} → policy check → hash (cost 12) → clear token → **DELETE all sessions for that user** (DB: sessions) → audit.

### Flow 15 — User suspension & session invalidation
1. Owner → `PATCH /api/admin/users/:id/suspend` {reason?} (app-routes; requireRole('owner')) → UPDATE users SET account_status='suspended', suspended_by/at/reason → audit → sessions for that user deleted (verify the DELETE in the handler — `app-routes.js` suspend block) 
2. Belt-and-braces: every authed request re-loads the user (`requireAuth`) and rejects inactive accounts; login blocks `suspended` with its own code; `GET /` redirects suspended sessions to `/login?reason=suspended`
3. Reactivate via `PATCH /api/admin/users/:id/activate`.
