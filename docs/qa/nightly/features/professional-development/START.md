/opal-feature

**Idea:** Professional Development

**Why:** (not yet written in the tracker)

**Who uses it:** (not yet written in the tracker)

**What they see:** (not yet written in the tracker)

**What should happen:** (not yet written in the tracker)

**Outcome:** (not yet written in the tracker)

No decisions recorded yet. No tasks recorded yet.

## Where it lives today

Two real, built candidates — the card doesn't say which it means:
1. The admin PD-events catalogue + org CPD tracking:
   `backend/resource-hub-r2-routes.js` (`/api/rh2/pd`, `/api/rh2/cpd`),
   `frontend/current/resourcehub.js`. Unit-tested
   (`tests/pd-catalogue-guards.test.js`), no browser proof.
2. The employee's own CPD section of My Profile:
   `backend/profile-routes.js` (`/api/profile/cpd`),
   `frontend/current/profile.js`. Zero test coverage.

## Start here

First, get the ambiguity resolved in the tracker — clarify which
subsystem this card means, or merge it with "Employee Personal Page" if
it means the CPD section. Once clarified: for the admin catalogue, add a
browser check or E2E spec. For the employee CPD section, write an
integration test for the submit/approve/reject round trip, following the
house pattern in `tests/integration/readonly-and-hardening.itest.js`.

## Done means

The scope question is answered, and whichever subsystem it turns out to
be has either a passing new test (profile CPD) or a browser check (admin
catalogue). Target label: `proven`.

Tracker: 37f4e057-ae96-4a9e-a576-5f808b7dc8fb
