/opal-feature

## Idea
Portal - Splose - Outlook | Integration Works

## Why
(not yet written in the tracker)

## Who uses it
(not yet written in the tracker)

## What they see
(not yet written in the tracker)

## What should happen
(not yet written in the tracker)

## Outcome
(not yet written in the tracker)

## Decisions
(not yet written in the tracker)

## Where it lives today
backend/calendar-routes.js, calendar-permissions.js (helper, no routes) backend/splose-sync-routes.js, splose-link-routes.js, splose-api.js, splose-caseload.js, splose-credentials.js, splose-draft-sync.js, splose-poller.js backend/outlook-oauth.js (OAuth helper, no routes), backend/routes-outlook-integration.js (defines its own local requireAuth instead of the shared one — inconsistent but not a gap), backend/routes.js (GET /api/outlook/categories lives here) Frontend: BOOK TAB (mockup_v3.html:4464), CALENDAR TAB (mockup_v3.html:4711/4712)

## Start here
Fix GET /api/outlook/categories in backend/routes.js (~line 1463): distinguish "user has no Outlook connection" from a real upstream failure and return 409/empty instead of 500 for the former, following the "no connection" guard pattern used by neighbouring Outlook routes. Add a test asserting the new behaviour, then run `npx jest tests/outlook-mirror.test.js` plus the new test. Multi Calendar Rules itself needs its own design pass before any code — there is no existing "rules across multiple calendars" concept in the codebase to extend.

## Done means
`npx jest tests/outlook-mirror.test.js tests/<new-test>.test.js` passes, and the fixed endpoint returns 409/empty for a disconnected user in manual testing.

Tracker: eba1c6a7-3ba4-420f-acf4-1c5838991138
