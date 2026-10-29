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
System A (self-logged CPD tracker): `backend/resource-hub-r2-routes.js` (~lines 2304-2399), tested. System B (My Profile submit/approve/reject): `backend/profile-routes.js` (lines 204-312), untested.

## Start here
Add an integration test in `tests/integration/` (new file, or extend an existing profile-routes test) covering `/api/profile/cpd` POST → `/api/profile/cpd/:id/approve` → GET, and the reject path, as an owner approving/rejecting another user's submitted CPD activity, plus a 403 check for a non-owner caller. Follow the pattern in `tests/integration/resource-hub-r2.itest.js` for the sibling System A test. While there, consider whether the inline `canApprove(req.user)` check in `profile-routes.js` should move into `permissions.js` per the repo's stated convention — flag it to a human rather than refactoring silently, since it already works correctly.

## Done means
A new integration test exercises the CPD submit→approve→reject round trip in My Profile and passes. This closes the test gap shared with the Employee Personal Page card's "Review Portal Structure" task. Evidence label should move from `needs-refinement` toward `proven`.

Tracker: 37f4e057-ae96-4a9e-a576-5f808b7dc8fb
