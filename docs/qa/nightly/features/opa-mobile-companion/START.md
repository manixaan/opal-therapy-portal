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

(No decisions recorded in the tracker.)

## Where it lives today
- `backend/mobile-routes.js` (`/api/mobile/*`), `backend/case-note-routes.js` (case-note drafts + AI pathway)
- Desktop reuse: `frontend/current/casenotes.js` under the CASE NOTES tab

## Start here
This is not a build task — the tracker's own checklist for the Case Noting pilot is still fully open (every
item unchecked). Walk the Case Noting pilot through that checklist end to end (dictate → draft → AI pathway →
review) and get the named reviewer's sign-off. The backend (`npx jest tests/mobile-routes.test.js
tests/case-note-routes.test.js`) is already green — no code change is expected unless the walkthrough surfaces a
real defect.

## Done means
Every item on the tracker's Case Noting checklist is checked, with sign-off recorded, and the existing test
suites still pass. Evidence label moves from needs-refinement to proven once that human checklist is closed.

Tracker: e786d774-43bf-4a8b-826d-94bcb97a9613
