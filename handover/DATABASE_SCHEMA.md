# DATABASE_SCHEMA.md — Live schema, verified 2026-07-12

> Dumped from the running PostgreSQL instance via `information_schema` (not from code).
> Schema creation method: **no migration tool** — `INIT_QUERIES` in `backend/database.js:77-543` runs on every boot (CREATE TABLE IF NOT EXISTS / ALTER TABLE ADD COLUMN IF NOT EXISTS / guarded DO-blocks / backfill UPDATEs). Plus `backend/session-store.js` auto-creates `sessions`, and `backend/app-routes.js:35-65` auto-creates `user_settings`, `org_settings`, `user_notifications`.
> **Views: none. Triggers: none. Stored functions: none. Migration files: none.**

## Tables at a glance

| Table | Rows (live) | Owner feature | Read by | Written by | Prod-critical |
|---|---|---|---|---|---|
| **users** | 4 | Auth/accounts | every requireAuth, auth.js, app-routes admin, pollers | auth, register-routes, app-routes admin, OAuth callback, updateUserTokens, profile-routes (JSONB) | ✅ core |
| **events** | 5,473 | Calendar/sync | GET /api/events, calendar-routes, notifications checks, search, diagnostics | upsertOutlookEvent, createEvent, write-back routes, pollers, reconcile/dedup/soft-delete | ✅ core |
| **sessions** | 0 (self-pruning) | Login sessions | PgSessionStore | PgSessionStore, reset/suspend/sign-out-all DELETEs | ✅ core |
| **outlook_delta_state** | 1 | Delta sync | pollers, delta route, webhook | saveDeltaState | ✅ core |
| **sync_log** | 5,197 | Sync audit | diagnostics, failed-writeback check | write-back routes, travel-blocks | ✅ (observability) |
| **audit_logs** | 20 | Security audit | (no reader UI yet) | logAuditEvent everywhere | ✅ (compliance) |
| **organisations** | 1 | Multi-tenancy | register (org lookup), calendar-routes | seed only | ✅ |
| **user_notifications** | 48 | Notifications | GET /api/notifications, integrations status | storeNotification (15 checks + routes), PATCH status | ✅ |
| **user_settings** | 1 | Preferences | GET /api/settings, long-travel check | PATCH /api/settings | ✅ |
| **org_settings** | 0 | Org config | GET settings/organisation | PATCH organisation (owner) | ○ (defaults apply) |
| **user_invites** | 0 | Invites | invite-routes, register-routes | createInvite/accept/revoke | ✅ when team grows |
| **therapist_profiles** | 0 | Multi-therapist | calendar-routes, getUser JOIN, upsert stamping | POST/PUT therapists, registerUserFromInvite | ⚠ empty — see drift |
| **leave_requests** | 0 | Leave | profile-routes, search | profile-routes | ○ |
| **cpd_activities** | 0 | CPD | profile-routes, CPD check, search | profile-routes | ○ |
| **pd_documents** | 0 | PD docs | profile-routes | profile-routes | ○ |
| **credentials** | 0 | Credentials | profile-routes, expiry check, search | profile-routes | ○ |
| **conflicts** | 0 | (planned conflict log) | nothing | **nothing** | ✗ disconnected |

## Column detail

### users (44 columns)
| Column | Type | Null | Default |
|---|---|---|---|
| id | uuid PK | NOT NULL | gen_random_uuid() |
| email | varchar **UNIQUE** | NOT NULL | |
| microsoft_id | varchar **UNIQUE** | NULL | |
| access_token / refresh_token | text (AES-GCM-encrypted when TOKEN_ENCRYPTION_KEY set; currently plaintext-passthrough) | NULL | |
| token_expires_at | timestamp | NULL | |
| name / display_name / role_title / phone | varchar/text | NULL | |
| password_hash | text (bcryptjs, cost 12) | NULL | |
| role | varchar | NULL | 'therapist' |
| permissions | jsonb (per-user extras, merged with role) | NULL | |
| organisation_id | uuid FK→organisations | NULL | **NULL on all 4 live rows** |
| is_active | boolean | NULL | true |
| is_treating_therapist | boolean | NULL | false |
| therapist_profile_id | **varchar** (stores UUID text — cast needed for joins; documented via COMMENT) | NULL | |
| last_login_at | timestamp | NULL | |
| default_work_location / work_location_schedule / notification_preferences | jsonb | NULL | |
| profile_completed (+_at) | boolean/timestamp | NULL | false |
| onboarding_step / onboarding_completed_steps / onboarding_skipped_steps | text / jsonb / jsonb | NULL | 'account' / [] / [] |
| account_status | text **CHECK** ∈ (pending_verification, pending_approval, active, suspended, deactivated) | NOT NULL | 'active' |
| email_verified (+token/expires/sent_at) | boolean + text/timestamps | NULL | false |
| password_reset_token / _expires_at | text/timestamp | NULL | |
| approved_by_user_id / approved_at | uuid/timestamp | NULL | |
| suspended_by_user_id / _at / _reason | uuid/timestamp/text | NULL | |
| created_at / updated_at | timestamp | NULL | CURRENT_TIMESTAMP |

### events (44 columns) — the sync core
Identity & content: `id` uuid PK · `user_id` uuid FK→users NOT NULL · `title` NOT NULL · `description` · `start_time`/`end_time` timestamp NOT NULL (UTC wall-clock) · `location` · `event_type` CHECK ∈ (therapy, leave, cpd, travel, admin, lunch, meeting, teams_meeting) default 'therapy' · `status` default 'confirmed'.
External IDs: `splose_id` varchar · `outlook_id` varchar (**UNIQUE(user_id, outlook_id)** — `events_user_outlook_unique`, verified live) · `outlook_ical_uid` · `outlook_change_key` · `outlook_last_modified_at` · `teams_meeting_id`.
Sync bookkeeping: `source` ('outlook'|'app', default 'outlook') · `created_by_source` (permanent origin; survives re-import) · `sync_correlation_id` (reserved, currently unwritten) · `sync_status` default 'pending' · `last_modified_by` · `synced_at` · `last_synced_to_outlook`/`_splose` (legacy, unused) · `write_error` · `last_write_attempt_at`.
Tombstones: `is_deleted` default false · `deleted_at`.
Location: `manual_location` jsonb · `is_manual_location_override` (protects against sync overwrite).
App metadata: `client_id/client_name/regional_tag/travel_distance/travel_time_minutes/ndis_plan_expiry/custom_metadata` · Teams: `is_teams_meeting/teams_join_link/teams_organizer`.
Ownership: `therapist_profile_id` uuid FK · `organisation_id` uuid FK (**both NULL on all live rows**).

### Remaining tables
As dumped (all verified live):

- **sessions**: sid varchar PK · sess jsonb NOT NULL · expire timestamptz NOT NULL. Index `sessions_expire_idx`.
- **outlook_delta_state**: user_id uuid PK FK→users CASCADE · delta_token text (may store a full Graph deltaLink URL — by design since commit `5581ab1`) · last_synced_at · updated_at.
- **sync_log**: id uuid PK · event_id uuid FK→events CASCADE NOT NULL · action · source · target · status default 'pending' · error_message · created_at. Index on event_id.
- **audit_logs**: id uuid PK · organisation_id FK · actor_user_id FK · action NOT NULL · target_type/target_id · metadata jsonb · ip_address · created_at.
- **organisations**: id uuid PK · name NOT NULL · created_at.
- **user_invites**: id uuid PK · organisation_id FK NOT NULL · email NOT NULL · role **CHECK v2** ∈ (owner, admin, therapist, read_only) · invited_by FK · status CHECK ∈ (pending, accepted, expired, revoked) · is_treating_therapist · therapist_profile_id FK · **invite_token UNIQUE NOT NULL** · timestamps · display_name_hint · metadata jsonb. Indexes: email, token, status, org.
- **therapist_profiles**: id uuid PK · organisation_id FK · **user_id uuid UNIQUE** FK CASCADE · display_name NOT NULL · role_title · colour default '#5b6af0' · outlook_calendar_id · splose_practitioner_id · default_work_location_id · is_active default true · timestamps.
- **leave_requests / cpd_activities / pd_documents / credentials**: as designed (status CHECKs: leave/cpd ∈ draft,submitted,approved,rejected; credentials ∈ active,expired,pending_review,missing,verified,rejected; pd_documents ∈ active,archived). pd_documents.file_data TEXT holds base64 file bodies.
- **user_settings**: user_id uuid PK FK CASCADE · settings jsonb NOT NULL '{}' · updated_at.
- **org_settings**: org_id text PK default 'opal' · settings jsonb '{}' · updated_at.
- **user_notifications**: id **serial** PK · user_id FK CASCADE · type · title/message NOT NULL · severity CHECK ∈ (info,warning,error,success) · status CHECK ∈ (unread,read,dismissed) · related_entity · action_payload jsonb · created_at.
- **conflicts**: full structure exists (event_id FK, conflict_type, app/outlook/splose_version jsonb, resolution) — **zero readers/writers in code**.

## Indexes (live, complete)
events: user_id, outlook_id, splose_id, start_time, source, is_deleted, outlook_ical_uid, therapist_profile_id, organisation_id, + UNIQUE(user_id,outlook_id) · sync_log: event_id · sessions: expire · user_invites: email, token(+unique), status, org · leave/cpd/credentials/pd_documents: user/org/status(+credentials expiry) · therapist_profiles: user(+unique), org · user_notifications: user, status · users: email(unique), microsoft_id(unique).

---

## Schema ↔ code drift analysis

### 🔴 Queries referencing columns that DO NOT exist (live-verified)
1. `app-routes.js:1213` — `SELECT … u.has_outlook_connected …` → **users has no such column** → `GET /api/admin/users` fails. (The same query already computes `(u.access_token IS NOT NULL …) AS has_outlook` — the phantom column is simply a stray.) 
2. `app-routes.js:254` — `SELECT base_location FROM therapist_profiles` → **no such column** (actual: `default_work_location_id`) → `checkIncompleteProfile` throws on every notifications load (swallowed by `Promise.allSettled`).

### 🟠 Schema columns no code path writes/reads
- `events.sync_correlation_id` — added by design, never populated.
- `events.last_synced_to_outlook`, `events.last_synced_to_splose`, `events.teams_meeting_id`, `events.teams_organizer`, `events.ndis_plan_expiry`, `events.client_id` — vestigial; only `synced_at` is maintained.
- `users.permissions` — read by getPermissions merge; no UI writes it.
- `user_invites.metadata`, `user_invites.therapist_profile_id` — never set by invite-routes.
- Whole `conflicts` table — disconnected.

### 🟡 Type / consistency drift
- `users.therapist_profile_id` is **varchar** while `events.therapist_profile_id`/`therapist_profiles.id` are uuid — joins require `::uuid` casts (done where used; documented via column COMMENT). Long-term: ALTER to uuid.
- Timestamp style is mixed: core tables use `timestamp` (naive, UTC-pinned by app), newer HR tables use `timestamptz`. Works because TZ is pinned everywhere, but be consistent for new tables (prefer timestamptz).
- `organisation_id` NULL on all users/events despite one organisations row — the "org fallback" queries (`IS NOT DISTINCT FROM $1 OR $1 IS NULL`) exist purely to cope with this. A one-time backfill would let those be simplified.
- `user_invites.role` CHECK includes `read_only` (v2 constraint applied) but application-level `VALID_ROLES` in invite-routes.js does not — app is stricter than schema.

### Missing indexes (suggested, not urgent at current volume)
- `sync_log(status, created_at)` — diagnostics/error queries scan.
- `events(user_id, start_time) WHERE is_deleted = FALSE` — partial composite for the hot calendar read.
- `audit_logs(actor_user_id, created_at)` — before an audit UI ships.

### Migration-drift risks inherent to the INIT_QUERIES approach
- Backfill UPDATEs (e.g. `source='app' WHERE outlook_id IS NULL`) run **every boot** — currently idempotent, but any future non-idempotent statement would repeat silently.
- No down-migrations, no schema versioning, no drift detection between environments. Adopting node-pg-migrate (or similar) is ROADMAP Phase 5.
- Boot-time hard-DELETE of duplicate outlook_ids (`database.js:555-566`) predates the UNIQUE constraint; now redundant but harmless — remove once confident.
