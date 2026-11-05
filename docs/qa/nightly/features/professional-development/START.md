/opal-critical

**Idea**: Professional Development

**Why**: (not yet written in the tracker)

**Who uses it**: (not yet written in the tracker)

**What they see**: (not yet written in the tracker)

**What should happen**: (not yet written in the tracker)

**Outcome**: (not yet written in the tracker)

**Decisions**: (none recorded)

**Tracker's next_action**: "Add an integration test for the CPD submit-approve-reject round trip
in My Profile."

## Where it lives today

`backend/profile-routes.js` (CPD routes), `frontend/current/profile.js` (CPD section).

## Start here

Same fix as the "Employee Personal Page" card's Admin-approval-button bug — they share the same
code. In `frontend/current/profile.js`, either stop showing Admin the CPD-approvals UI
(narrow `isManager` to owner-only for this section), or change `profile-routes.js:35-42`
`canApprove`/`canViewAll` to also allow Admin, whichever the team decides Admin's remit should be
(CLAUDE.md's RBAC comment at `profile-routes.js:35` says HR approvals are owner-only by design —
confirm that's still wanted before changing the backend). Then add the integration test the
tracker already asks for: submit a CPD activity as a therapist, approve/reject as owner, confirm
the therapist sees the updated status. Follow the pattern in
`backend/tests/integration/onboarding-journey.itest.js` for login/role setup.

## Done means

`npx jest --config jest.integration.config.js tests/integration/<new-file>.itest.js --runInBand`
passes, covering submit → approve → reject → employee-sees-result, and the Admin UI no longer
shows a button it can't use.

Tracker: 37f4e057-ae96-4a9e-a576-5f808b7dc8fb
