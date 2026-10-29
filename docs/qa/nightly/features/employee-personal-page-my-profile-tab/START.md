/opal-feature

## Idea
Employee Personal Page (My Profile Tab)

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
`backend/profile-routes.js` + `frontend/current/profile.js`. Tab: PROFILE TAB (`mockup_v3.html:4307`).

## Start here
Same gap as the Professional Development card's CPD half, plus leave: add an integration test exercising `/api/profile/leave` submit → owner approve/reject, and `/api/profile/cpd` submit → owner approve/reject, each with a non-owner 403 check. This single test closes both this card's "Review Portal Structure" task and the Professional Development card's gap — do them together. Use `tests/integration/documents.itest.js` as the pattern for mounting `profile-routes.js` in a test.

## Done means
A new integration test covers the leave and CPD submit→approve→reject round trip in My Profile and passes. Evidence label should move from `needs-refinement` toward `proven`.

Tracker: 83bb9988-52ba-4f8c-85ba-7b65aca189b2
