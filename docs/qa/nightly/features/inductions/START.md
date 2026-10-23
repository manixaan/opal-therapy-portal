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
Induction Playground (AI builder): `backend/induction-assistant-routes.js`, `frontend/current/induction-assistant.js`. Portal Inductions (walkthroughs): `backend/learning-routes.js`, `backend/learning-content.js`, `frontend/current/induction.js`. Splose Inductions: a seeded content module inside `backend/learning-routes.js` titled "Splose Induction" — no data-sync code.

## Start here
For the Induction Playground: open the owner portal in a browser, sign in as owner, open the AI induction co-authoring screen, and confirm it renders and a suggestion round-trips (accept/edit/reject). If it works, add an E2E spec `e2e/tests/induction-assistant.spec.js` modelled on `e2e/tests/tutorials.spec.js`.

For Splose Inductions: before building anything, confirm with the team whether this task means (a) the existing "Splose Induction" training content already satisfies it, or (b) a genuine Portal→Splose induction-data sync is wanted. Don't build a sync until that's confirmed — there is no scope for one today.

## Done means
Induction Playground: an E2E spec passes and/or a `docs/qa/BROWSER_QA_RESULTS.md` entry is added, reaching `proven`. Splose Inductions: the tracker's own idea/notes are filled in so the next audit can classify it.

Tracker: 21c90e45-6bc2-4bb9-9022-520338c00eb8
