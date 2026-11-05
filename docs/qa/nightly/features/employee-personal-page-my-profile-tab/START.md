/opal-critical

**Idea**: Employee Personal Page (My Profile Tab)

**Why**: (not yet written in the tracker)

**Who uses it**: (not yet written in the tracker)

**What they see**: (not yet written in the tracker)

**What should happen**: (not yet written in the tracker)

**Outcome**: (not yet written in the tracker)

**Decisions**: (none recorded)

**Tracker's next_action**: "Add an integration test for the leave submit-approve-reject round
trip, and fix the Admin approval-button mismatch."

**Task notes (verbatim, "Review Portal Structure")**: "I want you to review the portal structure
for my profile TAB in the portal what the features are if they all the buttons and all the things
are operational and use a friendly and I laid out in a very I pleasing and intuitive way basically
test every single button make sure all the workflows occur this will include the following
personal details work locations leave professional development credentials professional
development documents notifications then there is this set your work locations for the next 24
hours we're not a reminder and then basically your name and email address so just those few
little details need to be kind of outlined in terms of whether they are required do that function
as per the intended design and they need to be tested with the owner portal if there are
workflows that have a relationship for example approving leave approving PD etc"

## Where it lives today

`backend/profile-routes.js`, `frontend/current/profile.js`.

## Start here

First decide (don't guess): is Admin meant to approve leave/CPD, or is approval owner-only by
design (per the 2026-08-06 RBAC comment at `profile-routes.js:35`)? If owner-only is correct, the
fix is in `frontend/current/profile.js` — narrow `isManager` so Admin doesn't see Approve/Reject/
Verify buttons it can't use (keep Admin's scheduling/travel manager view, drop the HR-approval
one). If Admin should be able to approve, the fix is in `profile-routes.js:35-42` — widen
`canApprove`/`canViewAll` to include Admin, and fix the stale JSDoc at line 152 either way.
Then add the integration test the tracker already asks for: submit leave as a therapist, approve
as the correct role, confirm the therapist sees the updated status.

## Done means

A new `tests/integration/<name>.itest.js` covering submit → approve → reject → employee-sees-
result passes, and manually clicking the role's own buttons in the UI no longer 403s.

Tracker: 83bb9988-52ba-4f8c-85ba-7b65aca189b2
