/opal-critical

## Idea
Opa Mobile Companion

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
(none recorded in the tracker)

## Where it lives today
`backend/mobile-routes.js` (Case Noting + Calendar View tasks both live here). Guard is `requireAuth` only, documented in the file's own header as intentional self-scoped design — confirmed correct tonight, not a defect. Tested at the unit level only: `backend/tests/mobile-routes.test.js` (41 passing, but `database.js` is fully mocked — no real SQL is exercised).

## Start here
One gap, one file: no integration test exists for `mobile-routes.js` against a real database. Copy the shape of `backend/tests/integration/opa.itest.js` (real Express app, real sessions via `supertest.agent`, real Postgres via the `tests/integration/helpers.js` `truncateAll`/`seedUser` pattern that every `*.itest.js` in this repo already uses) into a new `backend/tests/integration/mobile.itest.js`. Cover at minimum: `GET /api/mobile/calendar` returning only the caller's own events, and a `POST /api/mobile/voice-notes` draft linked to a Splose client id instead of an appointment id (the Case Noting task's distinguishing behaviour). This is auth-adjacent, self-scoped-identity work (it decides what "the caller's own data" means at the SQL level), so route it `/opal-critical` even though the guard shape itself needs no change.

## Done means
`backend/tests/integration/mobile.itest.js` exists and passes against a real Postgres database, exercising both the Calendar View diary read and a Case Notes voice-note draft linked to a Splose client. Evidence label should move from `built-untested` to `proven` once that test is green — no browser/E2E proof is needed for this one, since there is no in-portal tab for it (the client is a phone app the repo cannot drive).

Tracker: e786d774-43bf-4a8b-826d-94bcb97a9613
