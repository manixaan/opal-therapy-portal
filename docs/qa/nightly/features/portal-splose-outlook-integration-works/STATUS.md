# Portal - Splose - Outlook | Integration Works

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed in this change window (2026-09-24 → 2026-09-25): no — zero commits landed in this window at all
- Created (any located code): yes — extensively, long predating this window

## Located files

- Routes: `backend/routes.js` (core Outlook/Splose sync surface: `/api/events`, `/api/sync/*`, `/api/sync-status`, `/api/outlook/*`, `/api/calendar/reconcile`, `/api/splose/status`), `backend/splose-link-routes.js` (practitioner linking, self-service + owner-assigns), `backend/splose-sync-routes.js` (draft-and-publish queue), `backend/travel-routes.js`, `backend/scheduler-routes.js`, `backend/calendar-routes.js`
- Data access: `backend/outlook-oauth.js`, `backend/travel-cascade.js`, `travel-feasibility.js`, `availability-engine.js`, `candidate-engine.js`, `candidate-scorer.js`, `splose-api.js`, `splose-draft-sync.js`, `splose-poller.js`, `splose-credentials.js`, `calendar-permissions.js`, `geo.js`
- Frontend: **Self-service linking** — inline in `frontend/current/mockup_v3.html` (Settings → Integrations → Splose), functions `loadSplosePractitionerLink`/`linkSplosePractitioner`/`unlinkSplosePractitioner`. **Owner-assigns linking** — `frontend/current/people.js` (Users & Roles tab: dropdown of Splose practitioners, greys out names already linked). Also `frontend/current/splose-sync.js`, `travel.js`, `scheduler.js`.

## Guard check

Every route file guards through `requireAuth`: `splose-link-routes.js` (`requireAuth` + inline read-only denial on self-service; `requireAuth`+`requireRole('owner')` on admin-link and connection endpoints), `splose-sync-routes.js` (`requireAuth`+`denyReadOnly`+`requireDraftSync`), `travel-routes.js`/`scheduler-routes.js` (`requireAuth` + `requireMasterCalendarAccess`/`denyReadOnly` per route), `calendar-routes.js` (`requireAuth` + role gates on writes), `routes.js` (per-route `requireAuth`, plus `requireRole('owner','admin')` on reconcile/diagnostics). No unguarded route found.

**Dead code (not a guard defect, never mounted)**: `backend/routes-outlook-integration.js` and `backend/routes-backup-original.js` duplicate live sync logic but are never `require()`d anywhere. Worth a cleanup ticket so they can't be wired in later by accident.

## Tests (re-run fresh tonight)

- Unit: `splose-link-routes.test.js`, `splose-api-queue.test.js`, `splose-credentials.test.js`, `splose-poller.test.js`, `splose-draft-sync.test.js`, `sync.test.js`, `sync-safety.test.js`, `sync-status-route.test.js`, `outlook-mirror.test.js`, `outlook-delta-preserve.test.js`, `scheduler-geo.test.js`, `scheduler-helpers.test.js`, `scheduler-matrix.test.js`, `travel-cascade.test.js`, `travel-feasibility.test.js`, `availability-engine.test.js`, `contact-matching.test.js` — run standalone by an investigation agent tonight (5 core Splose files: 71/71 pass); broader combined run also clean.
- Integration: `splose-connection.itest.js`, `splose-draft-sync.itest.js`, `admin-people.itest.js`, `routes-users.itest.js`, `users.itest.js` — run tonight in the Splose/Mobile/Snapshot batch (9 suites / 79 tests, 0 failures).
- Browser/E2E: `docs/qa/BROWSER_QA_RESULTS.md` (2026-08-01) rows C, D, E, F, J cover Splose link pending state, per-user Outlook not-connected state, the disabled Travel & Flights tab, and Splose 403 fail-closed boundaries. `e2e/tests/portal.spec.js` exercises Splose fail-closed/permission checks. **Neither self-service nor owner-assigns Splose-linking screen has any e2e or browser-QA coverage** — confirmed again tonight by grep, matching every prior audit night since 2026-09-18 (now eight consecutive nights).

## Open tasks from the tracker

- "Multi Calendar Rules" — `todo`. Checklist asks to confirm each workflow rule is in operation: unsynced indicator, travel-time calculation, two-way Portal/Splose match, what Outlook should show, a stress test with real-world examples. No code, comment, or identifier matching "multi calendar" exists — this reads as a confirmation/QA task against existing sync mechanics, not a discrete unbuilt feature. The mechanics themselves (`splose-sync.js`'s pending queue and conflict dialog, `travel-cascade.js`/`availability-engine.js`) are covered by passing tests; the checklist's own ask — a human stress test — is manual verification this audit cannot perform.

## Commits in the window that touched it

None — `develop` sits on `74601fc` again tonight (fourth night running). Re-verified fresh: unit and integration both re-run tonight with identical results — no regression.

## Disagreement

None on tracker-vs-evidence. Worth flagging directly to the team: the Splose-practitioner-linking UI gap has now been open and independently re-confirmed for **eight** consecutive audit nights (2026-09-18 through 2026-09-25), still covering two unproven UI paths.
