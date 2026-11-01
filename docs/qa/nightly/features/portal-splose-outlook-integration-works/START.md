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
`backend/routes.js` — `GET /api/outlook/categories` (~line 1487), calling
`getValidAccessToken(user)` then Microsoft Graph. The rest of the Splose/Outlook/
travel subsystem (`backend/outlook-oauth.js`, `splose-*.js`, `travel-*.js`) is
heavily built and tested — see STATUS.md.

## Start here
Open `backend/routes.js` around line 1487. When `getValidAccessToken` throws
because the user has no Outlook connection, the catch block currently returns
`res.status(500).json({ error: ..., details: err.message })` — a leaked
internal error as a 500. Change it to detect the not-connected case and return
a clean response (e.g. `200 { data: [] }` or a `400`/`409` with a plain
message, matching how `backend/routes-outlook-integration.js` already reports
"not connected" elsewhere in this file). Add a unit test alongside the
existing `tests/outlook-mirror.test.js` pattern covering both the connected
and not-connected paths.

## Done means
A new test for `GET /api/outlook/categories` passes, covering the
not-connected case with no leaked `err.message`, and
`npx jest tests/outlook-categories.test.js` (or wherever you add it) is green.

Tracker: eba1c6a7-3ba4-420f-acf4-1c5838991138
