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

## Decision
(not yet written in the tracker)

## Where it lives today
- backend/mobile-routes.js — GETs are self-scoped by design (every query filters by req.user.id,
  matches the snapshot-routes.js exception); `POST /api/mobile/appointments/:id/move` (new 23 Nov
  2026) additionally requires `manage_own_schedule`/`manage_all_schedules`.
- backend/mobile-calendar.js (new) — the move's validation rules (overlap, travel fit, past-time,
  ownership), unit-tested in mobile-calendar.test.js.
- backend/event-move.js (new) — the shared save road the phone's move and a portal drag both now
  take (local-first write, Splose queue, Outlook mirror).
- backend/case-note-routes.js generateGovernedDraft() — mobile voice notes (voiceNoteId) link into the same governed AI case-note generation pathway used by the desktop Case Notes workspace

## Start here
On the test device, dictate a case note through the Opa Mobile Companion app and confirm it reaches backend/case-note-routes.js's generateGovernedDraft() (linked by voiceNoteId) and produces a usable draft linked to the right client. This is a manual walkthrough first — only write code if it finds a real defect. While on the device, also try the new drag-to-move (Calendar View task): move an appointment and confirm it lands correctly in the portal and Outlook/Splose stay consistent — the server side is now guarded and tested (mobile-move.test.js, mobile-move.itest.js), but nothing has proven the phone gesture itself yet.

## Done means
The walkthrough is recorded as passing (or the defect found is filed as its own task).

Tracker: e786d774-43bf-4a8b-826d-94bcb97a9613
