Feature: Portal - Splose - Outlook | Integration Works
Tracker stage: idea
Tracker environment: none
Evidence label: broken
Addressed in change window (2026-10-02 to 2026-10-16): no
Created (any located code): yes

## Located files
`backend/calendar-routes.js`, `backend/scheduler-routes.js`,
`backend/splose-link-routes.js`, `backend/splose-sync-routes.js`,
`backend/travel-routes.js`, `backend/routes.js` (Outlook endpoints,
including `GET /api/outlook/categories` at line 1463).

## Guard check
Pass. Every route located sits behind `requireAuth` plus the right extra
layer (`requireRole`, `requireMasterCalendarAccess`, or `denyReadOnly`).
No unguarded endpoint found.

## CONFIRMED BUG
`GET /api/outlook/categories` (`backend/routes.js:1463-1475`) calls
`getValidAccessToken(user)`; when the user has no Outlook connection this
throws, the handler falls into its `catch` block, and returns a generic
`500 {"error":"Failed to fetch Outlook categories"}` instead of a clean
"not connected" response. This matches the live defect
`docs/qa/BROWSER_QA_RESULTS.md` recorded on 2026-08-01 ("GET
/api/outlook/categories 500 (×3, owner session)... should return
409/empty") and the tracker's own prior Claude update and next action.
**Zero test coverage** of this endpoint exists anywhere — grepped
`tests/` and `tests/integration/` for `outlook/categories` and
`masterCategories`; the only "categories" hits are in
`outlook-delta-preserve.test.js`, which is about calendar-event category
fields, unrelated to this endpoint.

## Tests run
- Unit: `availability-engine`, `find-availability`, `scheduler-geo`,
  `scheduler-helpers`, `scheduler-matrix`, `splose-api-queue`,
  `splose-credentials`, `splose-draft-sync`, `splose-link-routes`,
  `splose-poller`, `sync-safety`, `sync-status-route`, `sync`,
  `outlook-delta-preserve`, `outlook-mirror`, `travel-cascade`,
  `travel-feasibility`, `contact-matching`, `graph-identity` → 19 suites /
  458 tests, all PASS
- Integration (`DB_NAME=therapy_scheduler_audit`): `event-delete-cascade`,
  `event-times`, `event-travel-plan`, `events-sync`, `oauth-callback`,
  `outlook-claim`, `outlook-delta-preserve`, `scheduler-availability`,
  `series-master`, `splose-connection`, `splose-draft-sync`,
  `travel-overrides` → 12 suites / 91 tests, all PASS

## Browser / E2E evidence
Strong. `e2e/tests/portal.spec.js` covers the Outlook not-connected state,
Splose read/write boundaries, nav gating, and no cross-user caching.
`docs/qa/BROWSER_QA_RESULTS.md` flows D/E/F all pass, except this exact
console error is called out as an open Medium-severity item.

## Open tasks from tracker
- Multi Calendar Rules [todo]

## Commits in window touching this feature
None.

## Disagreement with tracker
None — the tracker's own prior Claude update already named this exact
bug correctly; this audit confirms it from the code rather than
contradicting the tracker.
