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
- backend/mobile-routes.js (self-scoped by design — every query filters by req.user.id, matches the snapshot-routes.js exception, requireAuth alone is correct here)
- backend/case-note-routes.js generateGovernedDraft() — mobile voice notes (voiceNoteId) link into the same governed AI case-note generation pathway used by the desktop Case Notes workspace

## Start here
On the test device, dictate a case note through the Opa Mobile Companion app and confirm it reaches backend/case-note-routes.js's generateGovernedDraft() (linked by voiceNoteId) and produces a usable draft linked to the right client. This is a manual walkthrough first — only write code if it finds a real defect.

## Done means
The walkthrough is recorded as passing (or the defect found is filed as its own task).

Tracker: e786d774-43bf-4a8b-826d-94bcb97a9613
