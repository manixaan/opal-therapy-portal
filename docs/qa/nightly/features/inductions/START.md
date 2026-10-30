/opal-feature

## Idea
Inductions

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
Induction Playground: `backend/induction-assistant-routes.js` + `frontend/current/induction-assistant.js`.
Portal Inductions and Splose Inductions: `backend/learning-routes.js` + `backend/tutorial-routes.js` +
`backend/walkthrough-routes.js`, delivered through the My Learning tab (`frontend/current/induction.js`).
This file covers only the Induction Playground sub-part — Portal Inductions and Splose Inductions are
`proven` tonight and need no further code (see STATUS.md in this folder).

## Start here
Log in as Owner, open the Induction Playground (AI co-author) under Learning/Induction admin, and walk it
through building or editing an induction end to end (draft a step, accept/edit/reject an AI suggestion, save).
Add either a new Playwright spec alongside `e2e/tests/tutorials.spec.js` or a dated entry in
`docs/qa/BROWSER_QA_RESULTS.md` recording what you saw. The route (`backend/induction-assistant-routes.js`,
guarded `requireAuth` + `requireRole('owner')`) and its unit/integration tests already pass — this step is
purely the missing browser/E2E proof, not new backend work.

## Done means
A browser or E2E check exercises the Induction Playground chat tool and confirms it produces a usable
induction/walkthrough. Evidence label for this sub-part should move from `tab-unproven` to `proven`.

Tracker: 21c90e45-6bc2-4bb9-9022-520338c00eb8
