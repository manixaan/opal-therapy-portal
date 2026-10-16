/opal-critical

## Idea
Professional Development

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
Two separate systems: My Profile's `/api/profile/cpd` in
`backend/profile-routes.js`, and the Resource Hub's `/api/rh2/cpd` in
`backend/resource-hub-r2-routes.js`. The Resource Hub one is well tested;
My Profile's has zero tests.

## Start here
First, clarify with Anthony in the tracker which system (or both) this
card is actually about — that's the real blocker, not the code. Once
clear: if it's My Profile's CPD, add an integration test in a new or
existing file under `backend/tests/integration/` that exercises
`/api/profile/cpd` submit → owner approve/reject, following the pattern
`resource-hub-r2.itest.js` uses for `/api/rh2/cpd`.

## Done means
The ambiguity is resolved in the tracker, and the chosen system's
submit → approve/reject round trip has a passing integration test.
Evidence label should reach `proven`.

Tracker: 37f4e057-ae96-4a9e-a576-5f808b7dc8fb
