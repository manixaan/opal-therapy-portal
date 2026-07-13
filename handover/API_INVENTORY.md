# API_INVENTORY.md — Complete route inventory

> Generated from source at commit `5581ab1`. "Auth" = session required via `requireAuth`.
> Status legend: **AV** Active+verified · **AU** Active but untested · **PI** Partially implemented · **BR** Broken · **DP** Deprecated · **DBG** Debug only · **UN** Unused · **DC** Dead code

## ⚠ Route-mount duplication (read first)

`server.js:339-341` mounts `routes.js` at **three prefixes**: `/`, `/auth`, `/api`.
Every route defined in routes.js therefore also answers at `/auth/<path>` and `/api/<path>` (e.g. `/api/api/events`, `/auth/api/splose/patients`). These aliases are accidental, unused by the frontend, and should be collapsed to a single mount in a future cleanup. Routes below are listed at their canonical path only.

There are also **four independent copies of `requireAuth`** (permissions.js, routes.js, calendar-routes.js, invite-routes.js) with identical behaviour — a consolidation target, not a bug.

---

## Pages (server.js — no router)

| Method | Route | Handler | Auth | Notes | Status |
|---|---|---|---|---|---|
| GET | `/` | inline (server.js:243) | session+status guard | Serves mockup_v3.html; redirects by account_status/profile_completed | AV |
| GET | `/login` `/register` `/forgot-password` `/reset-password` `/verify-email` `/pending-approval` | inline | none | Static auth pages | AV |
| GET | `/onboarding` | inline (server.js:260) | session+status guard | onboarding.html | AV |
| GET | `/health` | inline | none | `{status:'healthy'}` — verified this date | AV |

## auth.js (mounted at `/`)

| Method | Route | Auth | Role | Body/Params | Response | DB | Status |
|---|---|---|---|---|---|---|---|
| POST | `/api/auth/login` | rate-limited | — | {email,password} | safeProfile+permissions | users, audit_logs, sessions | AV (tested) |
| POST | `/api/auth/logout` | session | — | — | {ok} | sessions, audit_logs | AV (tested) |
| POST | `/api/auth/sign-out-all` | session | — | — | {ok} | sessions, audit_logs | AU |
| GET | `/api/auth/me` | session | — | — | safeProfile | users | AV (tested) |
| GET | `/api/auth/verify-email` | none | — | ?token | {ok,newStatus} | users, audit_logs | AV |
| POST | `/api/auth/resend-verification` | none (2-min cooldown) | — | {email} | {ok} always | users | AU |
| POST | `/api/auth/forgot-password` | none (3-min cooldown) | — | {email} | {ok} always | users, audit_logs | AV |
| POST | `/api/auth/reset-password` | none | — | {token,password,confirmPassword} | {ok} | users, sessions, audit_logs | AV |

## register-routes.js

| Method | Route | Auth | Body | DB | Status |
|---|---|---|---|---|---|
| POST | `/api/auth/check-invite` | none | {token} or {email} | user_invites, users, organisations | AV |
| POST | `/api/auth/register` | none | {token\|email,password,confirmPassword,profile{}} | users, therapist_profiles, user_invites, audit_logs | AV (tested: reject path) |
| GET | `/api/auth/onboarding` | session | — | users | AV |
| POST | `/api/auth/complete-profile` | session | profile fields | users, therapist_profiles, audit_logs | AU (superseded by step endpoint but still called by older onboarding builds) |
| POST | `/api/auth/complete-onboarding-step` | session | {step,data,skipped} | users | AV |

## invite-routes.js

| Method | Route | Auth | Role | DB | EXT | Status |
|---|---|---|---|---|---|---|
| POST | `/api/invites` | ✓ | owner (any role) / admin (therapist only) | user_invites, users, audit_logs | SMTP | AU — **PI**: VALID_ROLES omits `read_only` |
| GET | `/api/invites` | ✓ | owner/admin | user_invites | — | AU |
| DELETE | `/api/invites/:id` | ✓ | owner/admin (admin: therapist invites only) | user_invites, audit_logs | — | AU |
| POST | `/api/invites/:id/resend` | ✓ | owner/admin | user_invites | SMTP | AU |

## routes.js — OAuth & sync

| Method | Route | Auth | Purpose | DB | EXT | Status |
|---|---|---|---|---|---|---|
| GET | `/auth/outlook-login` | none | Returns Graph authorize URL (+state) | — | — | AV |
| GET | `/auth/oauth/callback` | none | Code exchange, link account, HTML success page | users | Graph | AV (state check lenient — see SECURITY_REVIEW) |
| GET | `/auth/user` | ✓ | id/email/hasOutlookTokens | users | — | AU (legacy; `/api/auth/me` is canonical) |
| POST | `/api/sync/outlook-clear` | ✓ | Hard-DELETE outlook-sourced rows | events | — | AV (used by "Clear & re-sync") |
| POST | `/api/sync/outlook-initial` | ✓ | Full 4-yr fetch + upsert + reconcile + dedup; per-user in-flight lock | events | Graph | AV |
| GET | `/api/events` | ✓ | All non-deleted events for user | events | — | AV (tested) |
| GET | `/api/events/outlook-only` | ✓ | Filtered subset | events | — | AU/UN (no FE caller found) |
| POST | `/api/events` | ✓ | Create local-only event | events | — | **UN/DP** — orphan flow; events never reach Outlook; no current FE caller |
| POST | `/api/sync/outlook-delta` | ✓ | Manual delta sync w/ stale-token recovery | events, outlook_delta_state | Graph | AV |
| POST | `/api/webhooks/outlook` | clientState check | Graph change notifications | events, outlook_delta_state, users | Graph | **BR in production** — raw-body consumed by global bodyParser (KNOWN_ISSUES #6); validation-token handshake works |
| GET | `/api/sync-status` | ✓ | connected/connectedAs/counts (org-fallback aware) | users, events | — | AV |
| GET | `/api/sync/diagnostics` | ✓ | counts, duplicates, ghosts, last errors | events, sync_log, outlook_delta_state | — | AV |
| GET | `/api/sync/reconcile` | ✓ | Dry-run diff report for a window | events | Graph | AV |
| POST | `/api/sync/cleanup` | ✓ | One-time stale purge + dedup | events | Graph | AV |
| GET | `/api/outlook/categories` | ✓ | Master category colours | users | Graph | AV |

## routes.js — Splose proxy

| Method | Route | Auth | DB | EXT | Status |
|---|---|---|---|---|---|
| GET | `/api/splose/status` | ✓ | user_notifications (on fail) | Splose /services | AV |
| GET | `/api/splose/sync-status` | ✓ | — (in-process state) | — | AV |
| GET | `/api/splose/services` | ✓ | — | Splose | AV |
| GET | `/api/splose/practitioners` | ✓ | — | Splose | AV |
| GET | `/api/splose/locations` | ✓ | — | Splose | AV |
| GET | `/api/splose/appointments` | ✓ | — | Splose ×4 (appts/patients/support-items/locations) | AV — heavy: full-list fetch + enrichment |
| GET | `/api/splose/appointments/:id` | ✓ | — | Splose | AU |
| POST | `/api/splose/appointments` | ✓ | — | Splose POST | AV (Smart Booking client path) |
| PUT | `/api/splose/appointments/:id` | ✓ | — | Splose PUT | AU |
| GET | `/api/splose/busy-time-types` | ✓ | — | Splose | AV |
| GET | `/api/splose/busy-times` | ✓ | — | Splose ×2 | AU |
| POST | `/api/splose/busy-times` | ✓ | — | Splose POST | **DC** — Splose has no POST /busy-times (live-verified 404); always 500; no FE caller since fix |
| GET | `/api/splose/patients` | ✓ | — | Splose | AV |
| POST | `/api/splose/patients` | ✓ | — | Splose POST (direct axios) | AU |
| GET | `/api/splose/patients/:id` | ✓ | — | Splose | AU |
| GET | `/api/splose/cases` | ✓ | — | Splose (all pages, filter in Node) | AV |
| GET | `/api/splose/contacts` | ✓ | — | Splose | AU |
| GET | `/api/splose/invoices` | ✓ | — | Splose | AU (Billing tab) |
| GET | `/api/splose/availabilities/:practitionerId` | ✓ | — | Splose | AU |
| GET | `/api/splose/payments` | ✓ | — | Splose | AU (Billing tab) |
| GET | `/api/splose/support-activities` | ✓ | — | Splose | AU |
| GET | `/api/splose/support-items` | ✓ | — | Splose | AV (travel logbook) |
| GET | `/api/splose/dormant-cases` | ✓ | — | Splose ×2 | AV (dormant tab) |
| GET | `/api/splose/debug/raw-appointment/:id` | ✓ | owner | — | Splose | DBG |
| GET | `/api/splose/debug/raw-patient/:id` | ✓ | owner | — | Splose | DBG |
| GET | `/api/splose/debug/location-report` | ✓ | owner | — | Splose ×4 | DBG |

## routes.js — Outlook write-back

| Method | Route | Auth | Body | DB | EXT | Status |
|---|---|---|---|---|---|---|
| POST | `/api/outlook/events` | ✓ (owner/admin may target another user) | {dbEventId?,title,startTime,endTime,location?,categories?,sploseId?,targetTherapistUserId?} | events (updateEventOutlookId + synchronous upsert w/ createdBySource:'app') | Graph POST | AV — verified 201 + DB row same round-trip |
| PATCH | `/api/outlook/events/:dbId/location` | ✓ | {location,lat?,lng?} | events (manual_location, override flag), sync_log | Graph PATCH | AV |
| PATCH | `/api/outlook/events/:dbId` | ✓ | {title?,startTime?,endTime?,location?} | events, sync_log | Graph PATCH | AV |
| DELETE | `/api/outlook/events/:dbId` | ✓ | — | events (soft-delete), | Graph DELETE (non-fatal) | AV |
| POST | `/api/outlook/travel-blocks` | ✓ | {start,end,fromLabel,toLabel,…} | events (createEvent + source='app'), sync_log | Graph POST | AU |

## calendar-routes.js (multi-therapist)

| Method | Route | Auth | Role | DB | Status |
|---|---|---|---|---|---|
| GET | `/api/therapists` | ✓ | owner/admin | therapist_profiles, users | AU — returns [] (table empty) |
| GET | `/api/therapists/me` | ✓ | any | therapist_profiles | AU |
| GET | `/api/therapists/:id` | ✓ | owner/admin or self | therapist_profiles | AU |
| POST | `/api/therapists` | ✓ | owner | therapist_profiles, users, events (backfill), audit_logs | AU |
| PUT | `/api/therapists/:id` | ✓ | owner or self | therapist_profiles | AU |
| GET | `/api/calendar/events` | ✓ | therapist forced to own profile | events⋈therapist_profiles⋈users | AU (dormant — no profiles) |
| GET | `/api/calendar/master` | ✓ | owner/admin (requireMasterCalendarAccess) | same | AV guard (403 tested); data path dormant |
| GET | `/api/calendar/availability` | ✓ | owner/admin | same | AU |
| GET | `/api/calendar/therapists-summary` | ✓ | owner/admin | therapist_profiles, events | AU |

## profile-routes.js

| Method | Route | Auth | Role | DB | Status |
|---|---|---|---|---|---|
| GET/POST | `/api/profile/leave` | ✓ | own; owner/admin see all | leave_requests, audit_logs | AU |
| PATCH | `/api/profile/leave/:id/approve` `/reject` | ✓ | owner/admin | leave_requests, audit_logs | AU |
| DELETE | `/api/profile/leave/:id` | ✓ | own drafts only | leave_requests | AU |
| GET/POST | `/api/profile/cpd` | ✓ | as leave | cpd_activities | AU |
| PATCH | `/api/profile/cpd/:id/approve` `/reject` | ✓ | owner/admin | cpd_activities | AU |
| DELETE | `/api/profile/cpd/:id` | ✓ | own drafts | cpd_activities | AU |
| GET/POST | `/api/profile/documents` | ✓ | own | pd_documents (base64 ≤5 MB) | AU |
| DELETE | `/api/profile/documents/:id` | ✓ | own | pd_documents | AU |
| GET/POST | `/api/profile/credentials` | ✓ | own; owner/admin all | credentials | AU |
| PATCH | `/api/profile/credentials/:id` | ✓ | own | credentials | AU |
| PATCH | `/api/profile/credentials/:id/verify` | ✓ | owner/admin | credentials | AU |
| DELETE | `/api/profile/credentials/:id` | ✓ | own | credentials | AU |
| GET/PUT | `/api/profile/work-schedule` | ✓ | own | users (JSONB) | AV (used by calendar + location alarm) |
| GET/PUT | `/api/profile/notification-prefs` | ✓ | own | users (JSONB) | AU |

## app-routes.js

| Method | Route | Auth | Role | DB | Status |
|---|---|---|---|---|---|
| GET | `/api/notifications` | ✓ | — | user_notifications + 15 live checks (events, credentials, cpd_activities, sync_log, users, user_settings) | AV — but check #2 (base_location) **BR** silently, check #15 counts all users org-wide |
| PATCH | `/api/notifications/:id` | ✓ | — | user_notifications | AV |
| POST | `/api/notifications/mark-all-read` | ✓ | — | user_notifications | AV |
| GET | `/api/settings` | ✓ | — | user_settings, org_settings | AV |
| PATCH | `/api/settings` | ✓ | — | user_settings (JSONB merge, whitelist) | AV |
| GET/PATCH | `/api/settings/organisation` | ✓ | GET: filtered by role · PATCH: owner | org_settings | AU |
| GET | `/api/settings/integrations/status` | ✓ | — | user_notifications, users | AV |
| POST | `/api/auth/change-password` | ✓ | — | users | **BR** — `require('bcrypt')` (KNOWN_ISSUES #1) |
| GET | `/api/search` | ✓ | role-scoped queries | events, credentials, cpd_activities, leave_requests | AV |
| GET | `/api/users` | ✓ | owner | users | AU (lightweight list; distinct from admin/users) |
| POST | `/api/sync/force` | ✓ | — | — | **BR/no-op** — imports non-exported fn (KNOWN_ISSUES #5) |
| POST | `/api/support/bug-report` | ✓ | — | user_notifications | AU |
| GET | `/api/app-info` | ✓ | — | — | AV |
| GET | `/api/admin/users` | ✓ | owner | users | **BR** — selects non-existent `u.has_outlook_connected` (KNOWN_ISSUES #2) |
| PATCH | `/api/admin/users/:id/approve` | ✓ | owner | users, audit_logs + approval email | AU |
| PATCH | `/api/admin/users/:id/role` | ✓ | owner | users, audit_logs | AU (accepts read_only ✓) |
| PATCH | `/api/admin/users/:id/suspend` | ✓ | owner | users, sessions (invalidated), audit_logs | AU (session-delete verified in code) |
| PATCH | `/api/admin/users/:id/activate` | ✓ | owner | users, audit_logs | AU |
| PATCH | `/api/admin/users/:id/deactivate` | ✓ | owner | users, audit_logs | AU |

## maps-routes.js

| Method | Route | Auth | EXT | Status |
|---|---|---|---|---|
| GET | `/api/maps/sdk-url` | ✓ | — (key injection) | AV |
| POST | `/api/maps/routes` | ✓ | Google Routes API | AV |
| POST | `/api/maps/places` | ✓ | Google Places Text Search | AV |
| GET | `/api/maps/geocode` | ✓ | Google Geocoding | AV |

## Orphaned / duplicate summary

- **Dead**: `POST /api/splose/busy-times` (upstream endpoint doesn't exist), everything in `routes-backup-original.js` / `routes-outlook-integration.js` (files never mounted).
- **Orphaned (no frontend caller)**: `POST /api/events`, `GET /api/events/outlook-only`, `GET /auth/user`.
- **Frontend calls a route that doesn't exist**: onboarding.html → `GET /api/auth/outlook/url` (KNOWN_ISSUES #4).
- **Accidental duplicates**: every routes.js path ×3 via triple mounting (see top).
- **Two user-list endpoints**: `GET /api/users` (works) vs `GET /api/admin/users` (rich, broken) — consolidate after fixing.
