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
backend/learning-routes.js, backend/induction-assistant-routes.js, backend/onboarding-induction.js,
frontend/current/induction*.js. The induction-pack delivery mechanism is proven and heavily tested
(271 unit + 68 integration tests pass). "Induction Playground" (richer step types: photos, quizzes,
hold points) has no code anywhere yet.

## Start here
Open backend/tests/induction-packs.test.js to see the existing pack-definition pattern (the recent
commits like c19a488 "Writing a Case Note" are good neighbours to copy). For "Induction Playground",
the new step types (photo capture, quiz, hold point) need a schema addition to whatever defines a
pack step today — start there, add one new step type end to end (schema → route → frontend render)
with a test, rather than all three at once.

## Done means
A test proves one new step type (photo, quiz, or hold point) end to end, and the "Portal Inductions"
/ "Splose Inductions" bookkeeping tasks are closed once someone confirms they are in fact done (the
tracker's own next_action already says so). Evidence label should move to `proven` once the Playground
gap is either built or descoped.

Tracker: 21c90e45-6bc2-4bb9-9022-520338c00eb8
