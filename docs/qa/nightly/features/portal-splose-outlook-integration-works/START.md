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

## Decisions
(none recorded)

## Where it lives today
`GET /api/outlook/categories` in `backend/routes.js` (around line 1463).
Everything else in this integration area is proven — calendar, Splose
sync, travel, and Outlook delta sync all pass their tests and are
covered in `e2e/tests/portal.spec.js` and `docs/qa/BROWSER_QA_RESULTS.md`.

## Start here
Open `backend/routes.js` around line 1463. In the `catch` block of
`GET /api/outlook/categories`, detect the "not connected" case
specifically (the same way other Outlook-aware routes already do — check
`backend/calendar-routes.js` or `backend/outlook-oauth.js` for the
existing pattern) and return a clean response (e.g. `200 {"data": []}` or
a `409`) instead of the current generic `500`. Add a regression test
alongside the existing Outlook route tests confirming the not-connected
case no longer 500s.

## Done means
A new test (unit or integration) proves `GET /api/outlook/categories`
returns a clean response, not a 500, when the user has no Outlook
connection. Evidence label should reach `proven`.

Tracker: eba1c6a7-3ba4-420f-acf4-1c5838991138
