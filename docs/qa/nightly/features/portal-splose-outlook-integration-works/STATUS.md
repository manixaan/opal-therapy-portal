# Portal - Splose - Outlook | Integration Works

Tracker stage: idea · Tracker environment: none
Evidence label: **proven**
Addressed in this change window: **yes** · Created: **yes**

## Located files

- `backend/calendar-routes.js` — therapist/calendar/availability API
- `backend/splose-sync-routes.js`, `backend/sync-settings-routes.js`, `backend/splose-link-routes.js` — Splose sync, settings, practitioner linking
- `backend/travel-sync-routes.js` — travel legs mirrored to Outlook
- `backend/splose-api.js`, `backend/splose-caseload.js` — Splose client/queue layer
- `backend/outlook-mirror.js`, `backend/graph-identity.js`, `backend/graph-mail-transport.js` — Outlook/Graph integration
- `backend/outlook-oauth.js` — a pure helper module (no routes of its own); the live OAuth callback is `GET /auth/oauth/callback` in the legacy `routes.js:239`, mounted at root via `server.js:474`, correctly unguarded by middleware because it validates Microsoft's `state` param against `req.session.oauthState` before establishing the session itself.
- **New tonight**: `backend/booking-rules.js` (the booking-type/client rule engine for `POST /api/outlook/events`, legacy `routes.js:2312`) and `backend/block-review.js`/`backend/block-review-routes.js` (unchanged by this commit, but adjacent — `block-review.js` gained one line), plus the new frontend module `frontend/current/travel-block.js`, wired into `frontend/current/mockup_v3.html`'s Smart Booking panel.

Guarded, re-confirmed tonight by reading handler bodies, not just the middleware list: `calendar-routes.js`'s handful of bare-`requireAuth` routes (`/therapists/me`, `PUT /therapists/:id`, `/calendar/events`) are **not gaps** — each has inline authorization (owner-or-self match on `therapist_profile_id`, or role-based scoping that forces a `role==='therapist'` caller to their own profile). `splose-sync-routes.js`/`sync-settings-routes.js` use `requireAuth` + `denyReadOnly` + owner-only `requireRole('owner')` on settings writes. `splose-link-routes.js` uses `requireAuth` + `requireRole('owner')`. `travel-sync-routes.js` uses `requireAuth` + `requireAnyPermission('manage_own_schedule','manage_all_schedules')`. `POST /api/outlook/events` (legacy `routes.js:2312`, where the new travel-block rule is enforced) carries `requireAuth` plus an inline role check inside `createBookingCore()` that 403s `read_only`/`pre_employee` accounts before anything is written — re-confirmed tonight by reading the handler body and by `tests/booking-rules.test.js`'s new "a read-only account cannot book a travel block" case. No unguarded route found.

**Technical note**: `backend/routes-outlook-integration.js` also defines an OAuth callback route but is **not required by `server.js`** — it appears to be dead/unused code, not the live path. Worth a cleanup pass independent of this audit; it is not a security gap since it is never mounted. (Unchanged tonight.)

## Tonight's change: Travel block booking type (commit `40669e7`)

`booking-rules.js` gained a `travel` group (`travel-block` kind): client optional, but the booking is refused server-side unless both a start and an end address are present (`cleanTravelRoute`). The server enforces this independently of the panel — confirmed by `tests/booking-rules.test.js`'s new direct-to-`validateBooking` case and its `POST /api/outlook/events` supertest cases (400 with no route, 403 for `read_only`, 201 with both ends saved as `eventType: 'travel'` and no `client_id` stamp). The same commit retires the Local/Remote home-base picker in `frontend/current/profile.js` (a saved `remote` base now loads as `local`) and makes the event detail panel prefer the event row's `client_name` over a just-booked tile's cached name — both covered by source-level assertions in the new `tests/travel-block-frontend.test.js` (a real jsdom run of the production `travel-block.js` against the panel markup). `node --check` is clean on `booking-rules.js` and `block-review.js`; no TODO/FIXME in any of the touched files.

## Tests

- Unit (22 files, 19 from before + 3 new/changed tonight — `booking-rules.test.js`, `travel-block-frontend.test.js`, and `assessment-surface-guards.test.js`'s asset-pin update): `sync.test.js`, `sync-preferences.test.js`, `sync-safety.test.js`, `sync-backfill.test.js`, `sync-status-route.test.js`, `splose-auto-sync-reset.test.js`, `splose-alert-dialog.test.js`, `splose-draft-sync.test.js`, `splose-match.test.js`, `splose-poller.test.js`, `splose-credentials.test.js`, `splose-link-routes.test.js`, `splose-api-queue.test.js`, `travel-sync-routes.test.js`, `travel-outlook-sync.test.js`, `outlook-mirror.test.js`, `outlook-delta-preserve.test.js`, `graph-identity.test.js`, `graph-mail-transport.test.js`, `booking-rules.test.js`, `travel-block-frontend.test.js` — **324/324 pass**, run tonight. `assessment-surface-guards.test.js` (the asset-pin guard, 93 cases) also re-run tonight and passes — it now pins `profile.js?v=13` and the new `travel-block.js?v=1`, matching `scripts/check-asset-pins.js` on the staged tree.
- Integration (10 files, unchanged by this commit): `sync-settings.itest.js`, `splose-connection.itest.js`, `splose-draft-sync.itest.js`, `splose-link-ignore.itest.js`, `events-sync.itest.js`, `outlook-claim.itest.js`, `outlook-delta-preserve.itest.js`, `travel-outlook-sync.itest.js`, `oauth-callback.itest.js`, `calendar-local-first.itest.js` — **104/104 pass**, run tonight on isolated DB `therapy_scheduler_audit_test` (~51s). None of these files exercise the travel-block rule directly (it is unit-covered via supertest against the mounted router in `booking-rules.test.js`, not a `*.itest.js` file); no gap, just noting where the coverage actually sits.

## Browser / E2E proof

`docs/qa/BROWSER_QA_RESULTS.md` entries E (freshness pill, Outlook-only toggle), F (Splose 403 boundaries) and H (accounting/Xero gating, unrelated subsystem but same doc) all pass — unchanged tonight, still describing the calendar/booking tab before tonight's commit landed. **Gap**: no E2E spec or browser QA entry has exercised the new Travel block booking type itself (picking it from the Smart Booking panel, address autocomplete, the Google Maps route call, the resulting calendar tile) — `e2e/tests/portal.spec.js` and `tutorials.spec.js` have zero matches for "travel block" or "travel-block". The tab as a whole stays `proven` on its existing, broader E2E/browser coverage, but this specific addition is only unit/jsdom-proven tonight.

## Open tasks from the tracker

"Multi Calendar Rules" (todo) — a manual confirm-and-stress-test checklist, not an automated-test gap. Its own text explicitly describes travel-time-between-sessions behaviour, which this commit extends (a billable, self-booked travel leg) — worth flagging to whoever runs that checklist next.

## Commits in the window touching this feature

**1 commit** — `40669e7` "feat(booking): Travel block booking type; drop Local/Remote home bases; client name in event panel" (2026-11-10). Touches `backend/block-review.js`, `backend/booking-rules.js`, `backend/tests/assessment-surface-guards.test.js`, `backend/tests/booking-rules.test.js` (new), `backend/tests/travel-block-frontend.test.js` (new), `frontend/current/mockup_v3.html`, `frontend/current/profile.js`, `frontend/current/travel-block.js` (new).

## Disagreement

None — the tracker still says `idea`, the evidence says `proven`, same direction as every prior night.
