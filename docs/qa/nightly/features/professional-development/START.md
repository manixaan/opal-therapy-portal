/opal-critical

**Idea:** Professional Development

**Why:** (not yet written in the tracker)

**Who uses it:** (not yet written in the tracker)

**What they see:** (not yet written in the tracker)

**What should happen:** (not yet written in the tracker)

**Outcome:** (not yet written in the tracker)

**Decisions:** (none recorded)

## Where it lives today

- Self-logged tracker (proven): `backend/resource-hub-r2-routes.js` `/api/rh2/cpd*`
- Owner approve/reject (untested): `backend/profile-routes.js` `/api/profile/cpd*`

## Start here

This is the same gap as the "Employee Personal Page" card's CPD half — don't duplicate the fix, do it once. Add the CPD half of the integration test described in `../employee-personal-page-my-profile-tab/START.md` (`backend/tests/integration/profile-leave-cpd.itest.js`): submit a CPD activity as therapist, owner lists/approves/rejects it, non-owner is 403'd. Copy the login/agent pattern from `backend/tests/integration/resource-hub-r2.itest.js`.

## Done means

The new CPD approve/reject integration test passes → evidence label becomes `proven`.

Tracker: 37f4e057-ae96-4a9e-a576-5f808b7dc8fb
