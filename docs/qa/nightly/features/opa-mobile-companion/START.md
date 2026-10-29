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
(none recorded)

## Where it lives today
Calendar View: `backend/mobile-routes.js`. Case Noting (voice-to-case-note, clinical AI): `backend/case-note-routes.js` + `clinical-note-provider.js` (goes through `backend/ai/ai-gateway.js`). This touches clinical AI output — CRITICAL level.

## Start here
This repository's side of the work is done and fully tested — 122 tests pass across both routes. The only outstanding step is confirming the real mobile client (a separate codebase) successfully calls `GET /api/mobile/calendar` and the `/api/mobile/case-note-drafts*` endpoints, or running the manual device-test checklist on this tracker card. That verification cannot happen from inside this repository.

## Done means
Confirmation from the mobile client's own test suite, or a completed manual device-test checklist, that these endpoints work end to end from a real device. No code change is expected unless that check turns up a contract mismatch.

Tracker: e786d774-43bf-4a8b-826d-94bcb97a9613
