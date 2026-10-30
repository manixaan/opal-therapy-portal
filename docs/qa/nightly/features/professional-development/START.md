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
System A (self-logged CPD tracker, tested): `backend/resource-hub-r2-routes.js:2306-2392`.
System B (My Profile submit/approve/reject, untested): `backend/profile-routes.js:204-321`.

## Start here
Add an integration test (new file, or extend a `profile-routes.js` test)
covering `/api/profile/cpd` POST → `/api/profile/cpd/:id/approve` → GET, and
the `/reject` path, as an owner acting on another user's submitted CPD
activity, plus a 403 check for a non-owner caller. This is employment-sensitive
approval data gated by an inline `canApprove(req.user)` check rather than
`permissions.js` middleware, so treat it as CRITICAL, not ordinary feature
work. Follow `tests/integration/resource-hub-r2.itest.js` for the sibling
System A test shape, and flag (don't silently refactor) whether the inline
check should move into `permissions.js`.

## Done means
A new integration test exercises the CPD submit→approve→reject round trip in
My Profile (System B) and passes, including the non-owner 403 case. This
closes the test gap shared with the Employee Personal Page card's "Review
Portal Structure" task. Evidence label should move from `needs-refinement`
toward `proven`.

Tracker: 37f4e057-ae96-4a9e-a576-5f808b7dc8fb
