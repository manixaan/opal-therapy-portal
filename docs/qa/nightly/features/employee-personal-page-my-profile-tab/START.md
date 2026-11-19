/opal-critical

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

## Decision
(not yet written in the tracker)

## Where it lives today
- backend/profile-routes.js (leave, cpd, documents, credentials)
- frontend tab: PROFILE TAB (mockup_v3.html)

## Start here
Copy the pattern from an existing *.itest.js (e.g. tests/integration/case-note-approval-edit.itest.js) to add tests/integration/profile-leave-cpd.itest.js: submit a leave request as a therapist, approve it via backend/profile-routes.js as an owner, and assert the therapist sees the updated status. Do the same for one CPD item.

## Done means
tests/integration/profile-leave-cpd.itest.js (or similarly named) passes, proving the leave/CPD approval round trip; label becomes `proven`.

Tracker: 83bb9988-52ba-4f8c-85ba-7b65aca189b2
