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
Build one new Induction Playground step type — start with photo, as the tracker's own next_action says — in frontend/current/induction.js next to the existing 'quiz'/'checkpoint' step types, with a test the way tests/induction-registry.test.js tests the existing types. Confirm it end to end with e2e/tests/tutorials.spec.js's pattern.

## Done means
A new test alongside tests/induction-registry.test.js proves the photo step type, and a sample induction using it saves and displays to a trainee; label becomes `proven`.

Tracker: 21c90e45-6bc2-4bb9-9022-520338c00eb8
