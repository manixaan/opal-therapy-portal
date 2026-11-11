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
- `backend/booking-rules.js` (the booking-type/client rule engine for `POST /api/outlook/events`, legacy `routes.js:2312`) and `backend/block-review.js`/`backend/block-review-routes.js`, plus the frontend module `frontend/current/travel-block.js`, wired into `frontend/current/mockup_v3.html`'s Smart Booking panel.

Guarded, re-confirmed tonight by reading handler bodies, not just the middleware list: `calendar-routes.js`'s handful of bare-`requireAuth` routes (`/therapists/me`, `PUT /therapists/:id`, `/calendar/events`) are **not gaps** — each has inline authorization (owner-or-self match on `therapist_profile_id`, or role-based scoping that forces a `role==='therapist'` caller to their own profile). `splose-sync-routes.js`/`sync-settings-routes.js` use `requireAuth` + `denyReadOnly` + owner-only `requireRole('owner')` on settings writes. `splose-link-routes.js` uses `requireAuth` + `requireRole('owner')`. `travel-sync-routes.js` uses `requireAuth` + `requireAnyPermission('manage_own_schedule','manage_all_schedules')`. `POST /api/outlook/events` (legacy `routes.js:2312`, where the travel-block rule is enforced) carries `requireAuth` plus an inline role check inside `createBookingCore()` that 403s `read_only`/`pre_employee` accounts before anything is written. No unguarded route found.

**Technical note**: `backend/routes-outlook-integration.js` also defines an OAuth callback route but is **not required by `server.js`** — it appears to be dead/unused code, not the live path. Worth a cleanup pass independent of this audit; it is not a security gap since it is never mounted. (Unchanged tonight.)

## Most recent change on develop: Travel block booking type (commit `40669e7`, 2026-11-10)

`booking-rules.js` has a `travel` group (`travel-block` kind): client optional, but the booking is refused server-side unless both a start and an end address are present (`cleanTravelRoute`). The server enforces this independently of the panel. The same commit retired the Local/Remote home-base picker in `frontend/current/profile.js` and made the event detail panel prefer the event row's `client_name` over a just-booked tile's cached name. This commit was audited in full last night (2026-11-10) and is unchanged tonight — `develop` has not moved.

## Tests

- Unit (22 files): `sync.test.js`, `sync-preferences.test.js`, `sync-safety.test.js`, `sync-backfill.test.js`, `sync-status-route.test.js`, `splose-auto-sync-reset.test.js`, `splose-alert-dialog.test.js`, `splose-draft-sync.test.js`, `splose-match.test.js`, `splose-poller.test.js`, `splose-credentials.test.js`, `splose-link-routes.test.js`, `splose-api-queue.test.js`, `travel-sync-routes.test.js`, `travel-outlook-sync.test.js`, `outlook-mirror.test.js`, `outlook-delta-preserve.test.js`, `graph-identity.test.js`, `graph-mail-transport.test.js`, `booking-rules.test.js`, `travel-block-frontend.test.js`, `smart-booking-route.test.js` — **444/444 pass**, run tonight as one batch. `assessment-surface-guards.test.js` (the asset-pin guard, verified separately under Interactive Assessments) also passes tonight, still pinning `profile.js?v=13` and `travel-block.js?v=1`, matching `scripts/check-asset-pins.js` on the staged tree.
- Integration (10 files): `sync-settings.itest.js`, `splose-connection.itest.js`, `splose-draft-sync.itest.js`, `splose-link-ignore.itest.js`, `events-sync.itest.js`, `outlook-claim.itest.js`, `outlook-delta-preserve.itest.js`, `travel-outlook-sync.itest.js`, `oauth-callback.itest.js`, `calendar-local-first.itest.js` — run tonight on isolated DB `therapy_scheduler_audit_g5_test` as part of a combined 14-file batch with Xero's accounting integration tests; all 14 files passed (159/159).

## Browser / E2E proof

`docs/qa/BROWSER_QA_RESULTS.md` entries E (freshness pill, Outlook-only toggle), F (Splose 403 boundaries) and H (accounting/Xero gating, unrelated subsystem but same doc) — unchanged since no commits landed in this window; re-confirmed present tonight. **Gap, unchanged**: no E2E spec or browser QA entry has exercised the Travel block booking type itself (picking it from the Smart Booking panel, address autocomplete, the Google Maps route call, the resulting calendar tile) — `e2e/tests/portal.spec.js` and `tutorials.spec.js` have zero matches for "travel block" or "travel-block". The tab as a whole stays `proven` on its existing, broader E2E/browser coverage, but this one addition is still only unit/jsdom-proven.

## Open tasks from the tracker

"Multi Calendar Rules" (todo) — a manual confirm-and-stress-test checklist, not an automated-test gap. Its own text explicitly describes travel-time-between-sessions behaviour, which the travel-block addition extends (a billable, self-booked travel leg) — worth flagging to whoever runs that checklist next.

## Commits in the window touching this feature

None. No commits landed on `develop` since last night's audit — `develop` is still at `40669e7`. Last night's audit window covered the one commit that landed that day; tonight's window is empty.

## Disagreement

None — the tracker still says `idea`, the evidence says `proven`, same direction as every prior night.
