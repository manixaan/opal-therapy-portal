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
`backend/routes.js` line ~1487 (`GET /api/outlook/categories`), calling `getValidAccessToken` at line ~151 — still unfixed as of 2026-10-28, the 12th consecutive night. (Unrelated to this bug: a real two-way Portal/Splose match-link-ignore reconciliation shipped 2026-10-22 in `backend/splose-match.js` + `splose-sync-routes.js`, and a Calendar Sync Settings feature shipped 2026-10-27 in `backend/sync-settings-routes.js` — see STATUS.md. Neither touches this route. Also unrelated and still without a tracker card: the travel/booking panel in `frontend/current/travel.js`, which gained a desk-work rule 2026-10-28 — see STATUS.md's note.)

## Start here
Open `backend/routes.js` around line 1487. Wrap the "not connected" case so it returns a clean response (e.g. `200 { categories: [] }` or `409 { error: 'outlook_not_connected' }`) instead of letting the generic catch turn it into a 500 — match how other Outlook routes in the same file already signal "not connected". Add a regression test in a relevant `backend/tests/*.test.js` or `backend/tests/integration/*.itest.js` file (there's no existing one for this route — check `sync.test.js` or `outlook-delta-preserve.test.js` for the nearest pattern to copy) asserting a disconnected user gets a non-500 response.

## Done means
The new test passes and documents the expected clean response; evidence label reaches `proven`.

Tracker: eba1c6a7-3ba4-420f-acf4-1c5838991138
