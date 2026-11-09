# Portal - Splose - Outlook | Integration Works

Tracker stage: idea · Tracker environment: none
Evidence label: **proven**
Addressed in this change window: **no** · Created: **yes**

## Located files

- `backend/calendar-routes.js` — therapist/calendar/availability API
- `backend/splose-sync-routes.js`, `backend/sync-settings-routes.js`, `backend/splose-link-routes.js` — Splose sync, settings, practitioner linking
- `backend/travel-sync-routes.js` — travel legs mirrored to Outlook
- `backend/splose-api.js`, `backend/splose-caseload.js` — Splose client/queue layer
- `backend/outlook-mirror.js`, `backend/graph-identity.js`, `backend/graph-mail-transport.js` — Outlook/Graph integration
- `backend/outlook-oauth.js` — a pure helper module (no routes of its own); the live OAuth callback is `GET /auth/oauth/callback` in the legacy `routes.js:239`, mounted at root via `server.js:474`, correctly unguarded by middleware because it validates Microsoft's `state` param against `req.session.oauthState` before establishing the session itself.

Guarded, re-confirmed tonight by reading handler bodies, not just the middleware list: `calendar-routes.js`'s handful of bare-`requireAuth` routes (`/therapists/me`, `PUT /therapists/:id`, `/calendar/events`) are **not gaps** — each has inline authorization (owner-or-self match on `therapist_profile_id`, or role-based scoping that forces a `role==='therapist'` caller to their own profile). `splose-sync-routes.js`/`sync-settings-routes.js` use `requireAuth` + `denyReadOnly` + owner-only `requireRole('owner')` on settings writes. `splose-link-routes.js` uses `requireAuth` + `requireRole('owner')`. `travel-sync-routes.js` uses `requireAuth` + `requireAnyPermission('manage_own_schedule','manage_all_schedules')`. No unguarded route found.

**Technical note**: `backend/routes-outlook-integration.js` also defines an OAuth callback route but is **not required by `server.js`** — it appears to be dead/unused code, not the live path. Worth a cleanup pass independent of this audit; it is not a security gap since it is never mounted.

## Tests

- Unit (19 files): `sync.test.js`, `sync-preferences.test.js`, `sync-safety.test.js`, `sync-backfill.test.js`, `sync-status-route.test.js`, `splose-auto-sync-reset.test.js`, `splose-alert-dialog.test.js`, `splose-draft-sync.test.js`, `splose-match.test.js`, `splose-poller.test.js`, `splose-credentials.test.js`, `splose-link-routes.test.js`, `splose-api-queue.test.js`, `travel-sync-routes.test.js`, `travel-outlook-sync.test.js`, `outlook-mirror.test.js`, `outlook-delta-preserve.test.js`, `graph-identity.test.js`, `graph-mail-transport.test.js` — **276/276 pass**, run tonight.
- Integration (10 files): `sync-settings.itest.js`, `splose-connection.itest.js`, `splose-draft-sync.itest.js`, `splose-link-ignore.itest.js`, `events-sync.itest.js`, `outlook-claim.itest.js`, `outlook-delta-preserve.itest.js`, `travel-outlook-sync.itest.js`, `oauth-callback.itest.js`, `calendar-local-first.itest.js` — **104/104 pass**, run tonight on isolated DB `therapy_scheduler_audit_g4_test` (~102s).

## Browser / E2E proof

`docs/qa/BROWSER_QA_RESULTS.md` entries E (freshness pill, Outlook-only toggle), F (Splose 403 boundaries) and H (accounting/Xero gating, unrelated subsystem but same doc) all pass. `e2e/tests/portal.spec.js` exercises the Splose 403 boundaries directly.

## Open tasks from the tracker

"Multi Calendar Rules" (todo) — a manual confirm-and-stress-test checklist, not an automated-test gap.

## Commits in the window touching this feature

None. Zero commits landed on `develop` between the 2026-11-08 audit and tonight — `develop` is at the same commit (`34cf881`) both nights. (Last night's run, auditing the same commit, listed the Splose/Outlook fixes that landed in the days before 2026-11-08; none of that is new tonight.)

## Disagreement

None.
