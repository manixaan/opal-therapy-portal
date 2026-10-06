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
(not yet written in the tracker)

## Where it lives today
- backend/profile-routes.js — leave requests (/api/profile/leave*), CPD (/api/profile/cpd*), credentials and PD documents
- frontend/current/mockup_v3.html PROFILE TAB (line 4188, id="view-profile") — personal details, work locations, leave, PD, PD documents, credentials, notifications cards

## Start here
Open backend/profile-routes.js. The leave and CPD approval endpoints are correctly guarded (owner-only via canApprove) but have no test at any level. Add backend/tests/profile-routes.test.js covering a leave-request round trip (submit → owner approves → employee sees updated status) and a CPD activity submission requiring owner approval, following backend/tests/credential-surface-guards.test.js's pattern for mocking the DB layer.

## Done means
npx jest tests/profile-routes.test.js passes and asserts both the submit and approve paths (and the 403 path for a non-owner approver); the evidence label moves to `proven`.

Tracker: 83bb9988-52ba-4f8c-85ba-7b65aca189b2
