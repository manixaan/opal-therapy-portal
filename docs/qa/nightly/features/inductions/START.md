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

## Decision
(not yet written in the tracker)

## Where it lives today
- backend/induction-assistant-routes.js (requireAuth + requireRole('owner') router-wide)
- frontend: induction.js, induction-modules.js, induction-assistant.js, induction.css, induction-assistant.css

## Start here
Build one new Induction Playground step type (start with photo) end to end with a test. Open frontend/current/induction-modules.js, copy the pattern used for the existing 'quiz' step type, and add 'photo' alongside it; extend induction-assistant-routes.js if the AI helper needs to author it. Add a unit test alongside induction-packs.test.js.

## Done means
A new unit test proving the photo step type can be authored and rendered passes; label moves toward `proven` once the learner-side E2E (tutorials.spec.js) is extended to exercise it too.

Tracker: 21c90e45-6bc2-4bb9-9022-520338c00eb8
