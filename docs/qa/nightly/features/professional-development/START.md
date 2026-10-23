/opal-feature

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
Two unrelated systems share the name "CPD": the My Profile submit→approve/reject workflow in `backend/profile-routes.js`, and the self-logged CPD-hours tracker in `backend/resource-hub-r2-routes.js` (`/api/rh2/cpd*`).

## Start here
First, clarify with the team which system this tracker card actually means — they are not the same feature. If it means the My Profile approve/reject workflow, the work is identical to the Employee Personal Page card's gap: add an integration test exercising submit→approve and submit→reject for CPD in `backend/profile-routes.js`, copying the pattern from `backend/tests/integration/resource-hub-r2.itest.js`.

## Done means
The relevant system has a passing test for its full workflow; evidence label reaches `proven`.

Tracker: 37f4e057-ae96-4a9e-a576-5f808b7dc8fb
