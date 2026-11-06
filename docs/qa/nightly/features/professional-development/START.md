/opal-fast-change

**Idea**: Professional Development

**Why**: (not yet written in the tracker)

**Who uses it**: (not yet written in the tracker)

**What they see**: (not yet written in the tracker)

**What should happen**: (not yet written in the tracker)

**Outcome**: (not yet written in the tracker)

**Decisions**: (none recorded)

## Where it lives today
`backend/profile-routes.js` (CPD section) and `frontend/current/profile.js` (CPD section).
Confirmed bug, 3 nights running: `profile.js:284` treats `admin` as a manager
(`isManager = ['owner','admin'].includes(u.role)`) and shows CPD Approve/Reject buttons to Admin,
while `profile-routes.js:35-37` (`canApprove`) only allows `owner`. Admin's click 403s.

## Start here
Get a product decision first: should Admin approve CPD at all? (`profile-routes.js:33` documents
this as an intentional 2026-08-06 owner-only RBAC change.) If it stays owner-only, narrow
`isManager` at `profile.js:284` (and the matching spots for Leave at line 93 and Credentials at
line 1344 — same bug, same root cause, tracked on the "Employee Personal Page" card) so
Approve/Reject only render for `owner`, with a read-only state for Admin instead. Then add the
integration test this feature has never had: submit a CPD activity as a therapist, approve/reject
as owner, confirm the therapist sees the updated status, and assert Admin gets 403 with no visible
button — follow the login/role setup pattern in `backend/tests/integration/learning.itest.js`.

## Done means
A new integration test covers submit → approve/reject → employee-sees-result for Owner, and
403-and-hidden-button for Admin — that moves this from `broken` to `proven`.

Tracker: 37f4e057-ae96-4a9e-a576-5f808b7dc8fb
