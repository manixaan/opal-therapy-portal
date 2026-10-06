/opal-feature

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
(not yet written in the tracker)

## Where it lives today
- Case Noting: backend/case-note-routes.js (/api/mobile/case-note-drafts + legacy /api/mobile/ai/case-note), backend/clinical-note-provider.js (AI transmission layer), backend/case-note-style.js, backend/ai/deidentify.js, docs/mobile/CASE_NOTE_AI_PRIVACY.md
- Calendar View: backend/mobile-routes.js (/api/mobile/today, /calendar, /appointments/:id, /travel), backend/maps-routes.js
- No mobile client code lives in this repository — the on-device pilot the tracker's checklist describes lives in a separate mobile app project not checked into this repo.

## Start here
The backend (case-note-routes.js, mobile-routes.js) is built, self-scoped, AI-governed where relevant, and passes 105/105 tests. What's open is the tracker's own checklist for the Case Noting pilot — walk the device through each unchecked item (dictation accuracy, AI summary against the clinical pathway, save-to-portal correctness) and get Ann's sign-off. This is a human testing task, not a code change.

## Done means
Every item on the tracker's Case Noting checklist ticked and Ann's sign-off recorded; the evidence label moves to `proven`.

Tracker: e786d774-43bf-4a8b-826d-94bcb97a9613
