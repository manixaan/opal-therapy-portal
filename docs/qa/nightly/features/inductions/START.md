/opal-critical

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
(none recorded in the tracker)

## Where it lives today
Backend: `backend/learning-routes.js`, `backend/tutorial-routes.js`, `backend/walkthrough-routes.js`,
`backend/walkthrough-catalogue.js`, `backend/walkthrough-content.js`, `backend/walkthrough-anchors.js`,
`backend/induction-assistant-routes.js`, `backend/learning-content.js`, `backend/onboarding-learning-bridge.js`.
Frontend: `frontend/current/resourcehub.js` (`?v=r52`), `induction.js` (`?v=10`), `induction-modules.js`
(`?v=3`), `induction-assistant.js`/`.css` (`?v=3`), `workshop.js`/`.css` (`?v=15`). E2E:
`e2e/tests/tutorials.spec.js`. "Induction Playground" (the third named task): nothing anywhere.

## Start here
1. Fix the stale E2E assertion first — `e2e/tests/tutorials.spec.js:59` checks for a heading
   `'All learning'` that `56f3aaa`'s course-builder redesign removed in favour of the
   `Inductions`/`Assignments`/`Staff progress` tabs under the `Assign Learning` h1. Update the
   assertion to check the tabs (or the `Assign Learning` h1 plus the `Inductions` tab) instead.
2. Close or reword the three tracker tasks against what's actually shipped: "Portal Inductions"
   and "Splose Inductions" are both built and tested; "Induction Playground" has no code or
   equivalent under another name anywhere in the repo — ask the practice what it was meant to
   describe, or drop it, before writing a build prompt for it.
3. Given tonight's AI-touching induction assistant (`ba26286`, `71bd2c5`, `0f19b1e`, `ab55bbc`)
   sits on a documented data-residency waiver, any further work here should stay `/opal-critical`.

## Done means
`e2e/tests/tutorials.spec.js` passes with an assertion that matches the shipped Assign Learning
tabs, and all three tracker tasks are either resolved or explicitly reconciled with what exists.
Evidence label should reach `proven` once that E2E fix lands and actually runs green, or move to
a deliberate `needs-refinement`-closed state once the three tracker tasks are reconciled.

Tracker: 21c90e45-6bc2-4bb9-9022-520338c00eb8
