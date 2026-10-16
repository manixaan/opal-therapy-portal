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

## Decisions
(none recorded)

## Where it lives today
`backend/profile-routes.js`, reached from the `PROFILE TAB` in
`mockup_v3.html`. Credentials and documents are proven and well-tested.
Leave requests and CPD approvals have zero automated tests.

## Start here
Add an integration test in `backend/tests/integration/` exercising
`/api/profile/leave`: a therapist submits a leave request, the owner
approves (or rejects) it, and a read_only or unrelated therapist is
blocked from acting on it. Follow the pattern already used for
`/api/profile/credentials` in `readonly-and-hardening.itest.js`. Do the
same for `/api/profile/cpd`'s submit → approve/reject round trip.
Separately, complete the tracker's own manual review: click through
every button on the My Profile tab as both employee and owner.

## Done means
A new integration test proves the leave and CPD approval round trips
work and are guarded, and the manual tab review is complete. Evidence
label should reach `proven`.

Tracker: 83bb9988-52ba-4f8c-85ba-7b65aca189b2
