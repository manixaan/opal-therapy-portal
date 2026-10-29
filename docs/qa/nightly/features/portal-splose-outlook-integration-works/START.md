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
`backend/routes.js:1487` (`GET /api/outlook/categories`), `backend/outlook-oauth.js`, `backend/calendar-routes.js`, `backend/sync-settings-routes.js`, `backend/splose-sync-routes.js`. The tracker's one task, "Multi Calendar Rules", has no matching code anywhere.

## Start here
Open `backend/routes.js` around line 1487 (`GET /api/outlook/categories`). Add the same pre-check `GET /api/calendar/reconcile` already uses at `routes.js:1058` — `if (!user?.access_token) return res.status(409).json({ error: 'outlook_not_connected' })` — before the call to `getValidAccessToken`. Then add a unit or integration test asserting a clean 409 (not a 500) when Outlook isn't connected. "Multi Calendar Rules" is a separate, unscoped task — it needs a written idea/why/what before any code should be started.

## Done means
A new test (e.g. in `tests/sync.test.js` or a new `tests/outlook-categories.test.js`) exercises `GET /api/outlook/categories` with no Outlook connection and asserts a clean non-500 response. Evidence label should move from `broken` to `proven` for this endpoint.

Tracker: eba1c6a7-3ba4-420f-acf4-1c5838991138
