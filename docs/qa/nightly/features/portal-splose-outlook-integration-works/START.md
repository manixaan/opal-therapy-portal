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
- backend/splose-sync-routes.js, splose-api.js, splose-link-routes.js, splose-credentials.js, splose-draft-sync.js, splose-poller.js
- backend/outlook-mirror.js, backend/outlook-delta-preserve.js, backend/outlook-oauth.js (OAuth helper), backend/travel-cascade.js (travel-time cascade)
- backend/routes.js — GET /api/outlook/categories (line 1463)
- Frontend: BOOK TAB (mockup_v3.html:4464), CALENDAR TAB (mockup_v3.html:4711/4712)

## Start here
Fix the still-open bug first: open backend/routes.js around line 1463 (GET /api/outlook/categories) and make it return 409 or an empty list instead of a 500 when the caller has no Outlook connection — the current catch block returns 500 for every error including "not connected" (thrown by getValidAccessToken at backend/routes.js:150). Add a test asserting the new behaviour.

## Done means
A passing test asserting /api/outlook/categories returns 409/empty (not 500) for a disconnected user; the evidence label moves to `proven`.

Tracker: eba1c6a7-3ba4-420f-acf4-1c5838991138
