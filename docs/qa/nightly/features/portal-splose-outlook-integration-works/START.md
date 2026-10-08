/opal-fast-change

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

(No decisions recorded in the tracker.)

## Where it lives today
- `backend/calendar-routes.js`, `backend/splose-sync-routes.js`, `backend/splose-link-routes.js`,
  `backend/travel-routes.js`, `backend/routes.js` (`GET /api/outlook/categories`)
- Frontend: BOOK, CALENDAR, TRAVEL & FLIGHTS, TRAVEL LOGBOOK tabs in `mockup_v3.html`

## Start here
Open `backend/routes.js` around line 1463 (`GET /api/outlook/categories`) and make it return a 409 or an empty
list instead of a 500 when the calling user has no Outlook connection — the current catch block returns 500 for
every error, including "not connected" (thrown by `getValidAccessToken`). Follow the "no connection" guard
pattern used by neighbouring Outlook routes. Add a test asserting the new behaviour, then run
`npx jest tests/outlook-mirror.test.js` plus the new test. Separately, `backend/routes-outlook-integration.js` is
dead code (never required anywhere) — worth deleting once confirmed unused, though that is a separate, lower-risk
cleanup from the 500-bug fix.

## Done means
`GET /api/outlook/categories` returns 409/empty for a disconnected user, with a new passing test, and
`npx jest tests/outlook-mirror.test.js` still green. Evidence label moves from needs-refinement to proven once
this is fixed and the Travel & Flights "Coming soon" stubs are either built or explicitly scoped out.

Tracker: eba1c6a7-3ba4-420f-acf4-1c5838991138
