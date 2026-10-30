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
`backend/profile-routes.js` (leave + CPD + documents + credentials +
work-schedule) + `frontend/current/profile.js`. Tab: `PROFILE TAB`
(`mockup_v3.html:4315`). Mounted in `backend/server.js:497`.

## Start here
Add an integration test exercising `/api/profile/leave` (submit as therapist →
`/leave/:id/approve` and `/leave/:id/reject` as owner → non-owner gets 403)
and the same pattern for `/api/profile/cpd`. This is employment-sensitive
approval data reached by an inline `canApprove`/`canViewAll` check rather than
`permissions.js` middleware, so treat it as CRITICAL: also note whether that
inline check should move into `permissions.js`, without refactoring it
yourself. Use `tests/integration/documents.itest.js` for the `profile-routes.js`
mounting pattern and `tests/integration/resource-hub-r2.itest.js` for the
sibling CPD-system test shape. This closes the same gap as the Professional
Development card — do both round trips (leave and CPD) in one new file.

## Done means
A new integration test covers the leave and CPD submit→approve→reject round
trip in My Profile, including a non-owner 403 check, and passes. Evidence
label should move from `needs-refinement` toward `proven`.

Tracker: 83bb9988-52ba-4f8c-85ba-7b65aca189b2
