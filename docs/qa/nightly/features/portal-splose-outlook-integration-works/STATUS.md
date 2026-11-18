# Portal - Splose - Outlook | Integration Works

- Tracker stage: **idea**
- Tracker environment: **none**
- Evidence label: **needs-refinement**
- Addressed in the 2026-11-04..2026-11-18 change window: **yes**
- Created (any located code): **yes**

## Located files
- backend/splose-sync-routes.js
- backend/travel-sync-routes.js
- backend/sync-settings-routes.js
- backend/calendar-routes.js
- backend/splose-link-routes.js

## Guard check
OK — requireAuth + requireRole/requirePermission throughout.

## Tests run
- unit: `outlook-delta-preserve.test.js, outlook-mirror.test.js, splose-alert-dialog.test.js, splose-api-queue.test.js, splose-auto-sync-reset.test.js, splose-credentials.test.js, splose-draft-sync.test.js, splose-link-routes.test.js, splose-match.test.js, splose-poller.test.js, travel-outlook-sync.test.js, travel-sync-routes.test.js` — **pass** (12 files / 156 tests)
- integration: `calendar-category-colours.itest.js, calendar-local-first.itest.js, outlook-claim.itest.js, outlook-delta-preserve.itest.js, splose-connection.itest.js, splose-draft-sync.itest.js, splose-link-ignore.itest.js, sync-settings.itest.js, travel-outlook-sync.itest.js` — **pass** (9 files / 84 tests)

## Tab / browser proof
docs/qa/BROWSER_QA_RESULTS.md rows E/F/J (Outlook state, Splose fail-closed boundaries, direct-URL/permission checks) — dated 2026-08-01, STALE: that doc notes "Travel & Flights tab disabled (Coming soon)", which is now false — flight-routes.js/flights.js shipped 2026-11-14, inside this audit window. The browser QA snapshot pre-dates the current build. A known prior defect in the same doc — GET /api/outlook/categories 500s with no Outlook connection (Medium) — was not re-verified live this run; flag it for a human recheck.

## Recency
Heavily touched in-window: calendar colours/tiles, weekends bookable, flight booking, event-panel declutter (8+ commits).

## Open tasks (from the tracker)
- Multi Calendar Rules — todo

## Reason for the label
Code, guards, and 240 backend tests all pass, but the one task (Multi Calendar Rules) is todo and the next_action ("walk the Multi Calendar Rules checklist against the live portal") is open.

## Disagreement with the tracker
Tracker "idea" stage vs. a large, tested, actively developed calendar/sync subsystem.
