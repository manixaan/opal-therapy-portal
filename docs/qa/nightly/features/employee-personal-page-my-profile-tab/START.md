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

(No decisions recorded in the tracker.)

## Where it lives today
- `backend/profile-routes.js` (`/api/profile/leave*`, `/api/profile/cpd*`, `/api/profile/credentials*`)
- Frontend: PROFILE TAB in `mockup_v3.html`, `frontend/current/profile.js`

## Start here
Add `backend/tests/profile-routes.test.js` covering a leave-request round trip (submit → owner approves →
employee sees updated status) and a CPD activity submission requiring owner approval, following
`backend/tests/credential-surface-guards.test.js`'s pattern for mocking the DB layer. Credentials are already
proven at both unit and integration level — use that as the template. Separately, the tracker's own "Review
Portal Structure" manual click-through task is still open and needs a human to walk every button in the tab.

## Done means
`backend/tests/profile-routes.test.js` exists and passes, covering at least one leave-approval and one
CPD-approval round trip, and `npx jest tests/profile-routes.test.js` is green. Evidence label moves from
needs-refinement to proven once that test lands and the manual structure review is also closed out.

Tracker: 83bb9988-52ba-4f8c-85ba-7b65aca189b2
