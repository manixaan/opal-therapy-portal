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
backend/profile-routes.js (leave, CPD, documents, credentials, work-schedule routes);
frontend/current/profile.js. Fully built and wired both sides — this is CRITICAL-level work because
it touches employment-sensitive data (leave, CPD approvals).

## Start here
Open backend/profile-routes.js around line 124 (`PATCH /api/profile/leave/:id/approve`) and line 261
(`PATCH /api/profile/cpd/:id/approve`) — both already guarded by `canApprove(req.user)`. Write a new
integration test (e.g. backend/tests/integration/profile-leave-cpd-approval.itest.js, following the
pattern in tests/integration/onboarding-workflow.itest.js) that: (1) a therapist submits a leave
request, (2) a read_only or therapist user is denied approval (403), (3) an owner/admin approves it,
(4) the audit log records `leave_request_approved`. Repeat for CPD.

## Done means
The new integration test passes and proves the full therapist→owner round trip for both leave and CPD.
Evidence label should move to `proven` once that test exists and passes.

Tracker: 83bb9988-52ba-4f8c-85ba-7b65aca189b2
