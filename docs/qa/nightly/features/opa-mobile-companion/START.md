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
On the test device, dictate a case note through the mobile app and confirm it reaches backend/case-note-routes.js generateGovernedDraft() correctly linked by voiceNoteId, the same path the desktop Case Notes workspace uses. This is a manual walkthrough, not a build task — no new code is implied unless the walkthrough finds a defect.

## Done means
A full device walkthrough (dictate -> AI summary -> save) is recorded with no defect, or defects found are filed as their own tasks; label becomes `proven`.

Tracker: e786d774-43bf-4a8b-826d-94bcb97a9613
