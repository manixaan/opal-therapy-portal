# PROJECT_TREE.md — Repository Map

> Verified 2026-07-12. Excludes `node_modules/`, `.git/`, `.claude/` (AI-tooling cache), `.env` (secrets — never commit).
> "Used" = reachable from `backend/server.js` at runtime or served to the browser.

```
.
├── .gitignore
├── README.md
├── Opal_Therapy_Security_Review.docx        (historical security report — reference only)
├── write_access_capability_report.docx      (historical Splose/Outlook write research — reference only)
│
├── backend/
│   ├── server.js                ★ ENTRY POINT
│   ├── database.js
│   ├── routes.js
│   ├── auth.js
│   ├── register-routes.js
│   ├── invite-routes.js
│   ├── app-routes.js
│   ├── calendar-routes.js
│   ├── calendar-permissions.js
│   ├── profile-routes.js
│   ├── maps-routes.js
│   ├── permissions.js
│   ├── outlook-oauth.js
│   ├── splose-api.js
│   ├── sync-utils.js
│   ├── email.js
│   ├── crypto-utils.js
│   ├── session-store.js
│   ├── jest.config.js
│   ├── package.json / package-lock.json
│   ├── .env.example
│   ├── tests/
│   │   ├── setup.js
│   │   ├── helpers/buildApp.js
│   │   ├── auth.test.js
│   │   ├── permissions.test.js
│   │   └── sync.test.js
│   ├── setup/                   (7 human setup guides + seed-users.js)
│   ├── docs/                    (4 legacy backend docs — partially stale)
│   ├── routes-backup-original.js        ✗ DEAD
│   ├── routes-outlook-integration.js    ✗ DEAD
│   ├── test-splose.js                   ✗ CLI probe
│   ├── check-outlook-categories.js      ✗ CLI probe
│   ├── check-remaining-data.js          ✗ CLI probe
│   ├── inspect-splose-fields.js         ✗ CLI probe
│   └── discover-splose-api.js           ✗ CLI probe
│
├── frontend/
│   ├── current/                 ★ AUTHORITATIVE
│   │   ├── mockup_v3.html       ★ MAIN APP (23,868 lines)
│   │   ├── login.html
│   │   ├── register.html
│   │   ├── forgot-password.html
│   │   ├── reset-password.html
│   │   ├── verify-email.html
│   │   ├── pending-approval.html
│   │   └── onboarding.html
│   └── archive/                 ✗ ALL OBSOLETE (v1, v2, v2_updated, v2_dormant_addition, 2 JS helpers)
│
├── docs/                        (5 current-ish planning docs + archive/ of 18 stale ones)
├── reference/dormant_cases_scheduler.js   ✗ reference copy
└── handover/                    (this package)
```

---

## Backend files in detail

| File | Used | Loaded by | Responsibilities | Status |
|---|---|---|---|---|
| `server.js` (802) | ✅ | `npm start` | Express app + helmet/CORS/CSRF middleware, session (PgSessionStore, shared with Socket.IO), static frontend serving, page-level account-status guards (`/`, `/onboarding`, auth pages), health check, mounts all 8 routers, **background jobs**: 90 s Outlook delta poller (+ periodic full reconcile), 15 min Splose cancellation poller, webhook register/renew, Friday location-alarm cron. Exports `{ app, io, _webhookSubscriptions }` | Current |
| `database.js` (1,810) | ✅ | almost everything | pg Pool (UTC pinned via type parsers + `options`), `INIT_QUERIES` = entire schema + idempotent migrations run every boot, boot-time duplicate cleanup, all DB helpers: users/tokens (AES-GCM via crypto-utils), events CRUD, `upsertOutlookEvent` (the idempotent sync core), soft-delete/reconcile/dedup, delta state, therapist profiles, invites, leave/CPD/docs/credentials, audit log | Current |
| `routes.js` (2,307) | ✅ | server.js — mounted at `/`, `/auth`, **and** `/api` (triple-mount, see API_INVENTORY) | Outlook OAuth flow, initial/delta sync, webhook receiver, sync status/diagnostics/reconcile/cleanup, all `/api/splose/*` proxy routes, all `/api/outlook/*` write-back routes, `classifyEventType` import | Current |
| `auth.js` (551) | ✅ | server.js (first router) | Login (rate-limited, timing-safe), logout, sign-out-all, `/api/auth/me`, verify-email, resend-verification, forgot/reset password | Current |
| `register-routes.js` (584) | ✅ | server.js | check-invite, register (invite + allowlist paths, first-owner bootstrap), onboarding state/step endpoints | Current |
| `invite-routes.js` (262) | ✅ | server.js | Invite create/list/revoke/resend; token never exposed in responses | Current (missing `read_only` in VALID_ROLES) |
| `app-routes.js` (1,421) | ✅ | server.js | Notifications engine (15 system checks + ephemeral), user/org settings, integrations status, change-password (**broken — bcrypt**), global search, bug report, app-info, admin user management (**list broken — bad column**), force-sync (**no-op**), exports `storeNotification` | Current, 3 bugs |
| `calendar-routes.js` (453) | ✅ | server.js | Therapist-profile CRUD + multi-therapist event/master/availability/summary endpoints (org-scoped, role-guarded) | Current but dormant (no profile rows) |
| `calendar-permissions.js` (~190) | ✅ | calendar-routes | canViewMasterCalendar / canViewTherapistCalendar / canManageTherapistSchedule / requireMasterCalendarAccess / validateTherapistIds / stripFinancials | Current |
| `profile-routes.js` (586) | ✅ | server.js | Leave, CPD, PD documents (base64 ≤5 MB), credentials CRUD + approve/verify; work-schedule + notification-prefs persistence | Current |
| `maps-routes.js` (169) | ✅ | server.js | Google Maps proxy: sdk-url, routes, places, geocode. Key server-side; inputs sanitised; fixed upstream URLs | Current |
| `permissions.js` (261) | ✅ | routes/app-routes/profile-routes/maps-routes | ROLE_PERMISSIONS map (4 roles), requireAuth/requireRole/requirePermission, stripFinancials, calendar/financial helpers | Current — **the RBAC source of truth** |
| `outlook-oauth.js` (525) | ✅ | routes.js, server.js | Graph OAuth (auth URL w/ state-encoded returnUrl, token exchange, refresh), calendarView fetch (UTC-forced, paginated), event create/update/delete, **delta sync** (`getOutlookCalendarDelta` — handles full-URL deltaLinks) | Current. Tenant ID hardcoded at top (see ENVIRONMENT_VARIABLES) |
| `splose-api.js` (543) | ✅ | routes.js, server.js | Splose v1 client: Bearer auth, 600 ms rate-limit queue with 429 backoff, 10-min full-list cache + in-flight dedup, cursor pagination (`fetchAllPages`, MAX 50 pages), appointments (client-side date filter — API has none), patients (multi-field address extraction), services/practitioners/locations/cases/invoices/payments/support-items, createAppointment/updateAppointment/createBusyTime (**createBusyTime targets a non-existent Splose endpoint**) | Current |
| `sync-utils.js` (42) | ✅ | routes.js, server.js | `classifyEventType(categories, isTeams)` — Outlook category → event_type | Current |
| `email.js` (434) | ✅ | auth/register/invite/app-routes | Nodemailer SMTP transport (logs links when unconfigured); invite / welcome / verification / reset / account-approved templates. **Interpolates names into HTML unescaped** | Current |
| `crypto-utils.js` (125) | ✅ | database.js | AES-256-GCM encrypt/decrypt for OAuth tokens; pass-through + warning when `TOKEN_ENCRYPTION_KEY` unset; `enc:` prefix for legacy compat | Current |
| `session-store.js` (154) | ✅ | server.js | Minimal express-session Store on the shared pg pool; `sessions` table auto-created; 15-min prune timer | Current |
| `tests/*` | ✅ | jest | 47 tests: auth flows, RBAC, sync idempotency/tombstones/classification. All mocked — no live services | Current |
| `setup/seed-users.js` | manual | never imported | Dev seeding of owner/admin/therapist accounts | Dev utility |
| `routes-backup-original.js` | ❌ | nothing | Pre-refactor snapshot of routes.js | **Dead — delete** |
| `routes-outlook-integration.js` | ❌ | nothing | Older Outlook-routes draft | **Dead — delete** |
| 5 × CLI probe scripts | ❌ | nothing (run manually) | One-off live-API field discovery. They read real creds from `.env` — do not run casually | Dev-only; candidates for a `/scripts` folder or deletion |

## Frontend files in detail

| File | Used | Served by | Notes | Status |
|---|---|---|---|---|
| `current/mockup_v3.html` | ✅ | `GET /` (auth-guarded sendFile) + express.static | **The entire main application**: all CSS, all views (Profile, Smart Booking, Calendar, Contacts, Activity, Billing, NDIS, Dormant, Travel, Logbook, Settings), all JS (~17 k lines). See FRONTEND_MAP.md | **Authoritative** |
| `current/login.html` (348) | ✅ | `GET /login` | Email/password form → `/api/auth/login`; session-redirect if already logged in | Current |
| `current/register.html` (560) | ✅ | `GET /register` | Invite-token + allowlist registration → check-invite / register | Current |
| `current/forgot-password.html` / `reset-password.html` | ✅ | own routes | Reset request / completion | Current |
| `current/verify-email.html` (339) | ✅ | `GET /verify-email` | Consumes `?token=`, resend button | Current |
| `current/pending-approval.html` | ✅ | `GET /pending-approval` | Static hold page (no API calls) | Current |
| `current/onboarding.html` (1,077) | ✅ | `GET /onboarding` | 9-step wizard → onboarding endpoints. **Outlook step calls a non-existent route** | Current, 1 bug |
| `archive/*` (4 HTML + 2 JS) | ❌ | nothing | Superseded prototypes. mockup_v2 once contained a hardcoded Maps key (scrubbed); keep out of any static-serving path | **Obsolete** |

## Documentation folders

- `docs/PRODUCTION_ARCHITECTURE.md`, `ARCHITECTURE_SUMMARY.md`, `SECURITY_CHECKLIST.md`, roadmap docs — planning-era; directionally useful, **not** ground truth (this handover supersedes them).
- `docs/archive/*` (18 files) and `backend/docs/*` (4 files) — historical; several claim completion states that don't match the code. Treat as archaeology.
- `backend/setup/STEP_1…7 + SETUP_INDEX` — human onboarding guides for Node/Postgres/Azure/env; still broadly accurate for local setup.
