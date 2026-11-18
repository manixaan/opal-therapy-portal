# Portal - Splose - Outlook | Integration Works

- Tracker stage: idea | Tracker environment: none
- Evidence label: **needs-refinement**
- Created: yes — extensive code exists
- Addressed this window: no — zero commits anywhere since 2026-11-15 (last window's flight-tracking,
  weekend-bookable, calendar-declutter etc. commits were already accounted for in that audit)

## Located files
- Backend: outlook-oauth.js (library, no routes), routes-outlook-integration.js, splose-sync-routes.js,
  splose-link-routes.js, sync-settings-routes.js, block-review-routes.js, travel-sync-routes.js,
  travel-routes.js, calendar-routes.js, booking-rules.js, flight-routes.js
- Frontend: Calendar tab in mockup_v3.html, frontend/current/flights.js/.css

## Guard check
All located route files guarded (requireAuth + permission/role middleware or router.use chain). No
unguarded endpoint found (re-confirmed tonight).

## Tests (re-run fresh tonight — file selection built independently from located route files, not
copied from last night's list; counts differ slightly from the 2026-11-15 brief as a result, with
no failures either way)
- Unit: 18 suites / 261 tests — all PASS (booking-rules, flight-routes, flights-frontend,
  splose-link-routes, travel-sync-routes, block-review, outlook-mirror, outlook-delta-preserve,
  sync, sync-status-route, sync-preferences, sync-safety, splose-api-queue, splose-credentials,
  splose-match, splose-poller, splose-auto-sync-reset, splose-alert-dialog).
- Integration: 17 suites / 135 tests — all PASS (block-review, calendar-category-colours,
  calendar-local-first, event-delete-cascade, event-series, event-times, event-travel-plan,
  events-sync, outlook-claim, outlook-delta-preserve, splose-connection, splose-draft-sync,
  splose-link-ignore, sync-settings, travel-outlook-sync, travel-overrides, series-master;
  DB_NAME=therapy_scheduler_audit_cal).
- Tab coverage: docs/qa/BROWSER_QA_RESULTS.md sections C/D/E/F all pass (confirmed unchanged
  tonight).

## Open tasks (from tracker)
- "Multi Calendar Rules" — todo. Re-confirmed genuinely unbuilt tonight: no "multi calendar" string
  anywhere in backend/.

## Commits in window touching this
None.

## Disagreement
Tracker stage "idea" significantly understates reality: a large, heavily-tested integration already
exists and is exercised nightly. The only real gap is the "Multi Calendar Rules" task.

## Note
No change from the 2026-11-16 audit. Independently re-verified fresh tonight (separate parallel
audit pass, its own throwaway database, independently-built test file selection — see above); same
code, zero failures, same conclusion.
