# Backend Route Permission Matrix

Stage 1 (2026-07-31). Inventory basis: a full sweep of all 12 route sources
found **178 routes, 87 write-shaped**. Before Stage 1, **16 write-shaped
routes relied on local `requireAuth` copies lacking the read_only
write-block** (14 in routes.js + the local copies in calendar-routes.js and
invite-routes.js). This matrix records the enforcement model per area, what
Stage 1 fixed, and what is documented-but-deferred.

## The choke point (fixed)

`permissions.js requireAuth` is now the ONLY auth middleware in live code —
it loads the user, computes permissions, and blocks every
POST/PUT/PATCH/DELETE for `read_only` outside `/api/auth/*`. The local
block-free copies in `routes.js`, `calendar-routes.js` and
`invite-routes.js` are deleted (the only remaining local copies are in the
two dead, never-mounted files `routes-backup-original.js` /
`routes-outlook-integration.js`, slated for removal). A comment at each
site forbids re-introduction.

## Matrix by area

Classifications: owner-only · admin/owner · therapist-own ·
therapist-scoped · any-auth-read · read_only-safe (GET only) ·
flag-gated-write · public(auth pages) · deferred.

| Area (file) | Write-shaped routes | Enforcement now | Stage 1 change |
|---|---|---|---|
| Splose proxy (routes.js) | 4 writes + 19 reads | Full model in SPLOSE_RBAC_AND_PRIVACY_MODEL.md — role + practitioner scoping + flag gates | **Rebuilt** (C1/C2) |
| Local events (routes.js) | GET/POST `/api/events` | any-auth-read (own rows via `user_id`) / POST therapist+admin+owner, **read_only blocked** | **Fixed** via choke point (H3) |
| Sync ops (routes.js: outlook-clear/initial/delta/cleanup) | 4 POST | own-account operations; read_only blocked; destructive cleanup paths keep their internal safety guards | Choke point applied |
| Outlook event writes (routes.js: `/api/outlook/events*`, travel-blocks) | 5 | flag-gated (`ENABLE_OUTLOOK_WRITE=false` blocks all); read_only blocked; **known deferral:** falls back to any org member's token — acceptable only while the write flag is off, listed as a Stage 2 item | Choke point applied |
| Calendar admin (calendar-routes.js) | therapist CRUD (POST/PATCH/DELETE `/api/therapists*`) | owner-only via requireRole (pre-existing); reads: therapist forced to own profile; master calendar owner/admin | requireAuth swapped to choke point |
| Invites (invite-routes.js) | POST/DELETE/resend + new GET `/link` | owner/admin (admin restricted to therapist/read_only invites); audited | requireAuth swapped; `/link` added (audited) |
| Auth (auth.js) | login/logout/verify/reset/resend | public by design with rate limits + enumeration safety | unchanged |
| Registration (register-routes.js) | register/complete-profile/onboarding steps | invite-token or allowlist enforced server-side | unchanged |
| Profile: leave/CPD/documents/credentials (profile-routes.js) | 18 | own-record CRUD; approvals owner/admin via `canApprove`; downloads ownership-checked + audited | unchanged (already used choke point) |
| Admin users (app-routes.js `/api/admin/*`) | 8 | owner-only (pre-existing, tested) | unchanged |
| Settings/notifications/search (app-routes.js) | 9 | authenticated, own-scoped; read_only blocked from writes | unchanged (already choke point) |
| Resources (resources-routes.js) | 8 | role model + governance lifecycle (pre-existing, tested) | unchanged |
| Accounting (accounting-routes.js) | all | owner-only + triple-gated writes (pre-existing, tested) | unchanged |
| Maps proxy (maps-routes.js) | 0 writes (4 GET) | authenticated; billable + unthrottled — deferred (rate limit, Stage 2) | unchanged |
| Webhooks (server.js mounts) | 2 POST unauthenticated by design | Graph clientState compare (hardcoded-default blocked in staging/prod by env-validation); Xero HMAC | unchanged |
| Health (health-routes.js) | 0 | public liveness/readiness | unchanged |

## Mount aliasing note

`routes.js` is mounted at `/`, `/auth` and `/api`, so path aliases exist
(e.g. `/api/api/events`). All Stage 1 guards are attached at the ROUTE
level, so aliases inherit them; the read_only exemption matches only
`/api/auth/*` prefixes, which no alias of a business route produces.

## Fixed in Stage 1 (the launch-critical set)

1. read_only can no longer POST/PUT/PATCH/DELETE anything outside
   `/api/auth/*` anywhere (single choke point).
2. Therapists can no longer read whole-practice PII/financial Splose data,
   nor act on another practitioner's Splose records.
3. No Splose write is reachable with flags off — including the former
   direct-axios patient-create bypass and the formerly ungated busy-time
   create.
4. Therapist/read_only cannot create invites; invite-link retrieval is
   owner/admin + audited.
5. Bug fix en route: `GET /api/calendar/reconcile` success path referenced
   `axios` without requiring it (guaranteed 500 since birth) — fixed.

## Documented deferrals (medium/low, Stage 2+)

- Outlook write routes' org-member token fallback (dormant behind flag).
- Maps proxy rate limiting (billable per-request).
- Leave/CPD/credential approval DB updates are not org-scoped
  (single-org pilot; real if multi-tenancy ever arrives).
- Field-level minimisation of NDIS numbers in therapist-visible
  own-appointment payloads.
- Dead files with stale local requireAuth copies to delete in the cleanup
  PR: `routes-backup-original.js`, `routes-outlook-integration.js`, plus
  probe scripts.

## Proof

`stage1-launch-blockers.itest.js` (16 tests) covers items 1–4 above;
pre-existing suites (`permissions.test.js`, `readonly-and-hardening.itest.js`,
`accounting-*.itest.js`, `resources.itest.js`) continue to pin the
unchanged areas. Full suite at Stage 1 head: 185 unit + 120 integration,
clean exits.
