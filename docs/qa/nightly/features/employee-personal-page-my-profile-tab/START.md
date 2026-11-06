/opal-fast-change

**Idea**: Employee Personal Page (My Profile Tab)

**Why**: (not yet written in the tracker)

**Who uses it**: (not yet written in the tracker)

**What they see**: (not yet written in the tracker)

**What should happen**: (not yet written in the tracker)

**Outcome**: (not yet written in the tracker)

**Decisions**: (none recorded)

## Where it lives today
`backend/profile-routes.js` (leave, CPD, documents, credentials), `frontend/current/profile.js`,
tab banner at `frontend/current/mockup_v3.html:4323`. Confirmed bug, 3 nights running:
`isManager = ['owner','admin'].includes(u.role)` at `profile.js:93` (leave), `:284` (CPD) and
`:1344`/`:793` (credentials) shows Approve/Reject/Verify buttons to Admin, while the backend's
`canApprove()` (`profile-routes.js:35-37`) only allows `owner` — every Admin click 403s.

## Start here
Decide with the team whether Admin should ever approve leave/CPD/credentials (the backend's
2026-08-06 comment says this was made owner-only on purpose). If it stays owner-only, fix
`isManager` (or add a separate `canSeeApprovalUI` check) at the three `profile.js` locations above
so Admin gets a read-only view instead of a dead button, and fix the stale "Owner/Admin only"
doc-comment at `profile-routes.js:857-858` to match the code. There is currently no
`profile-routes` unit/integration test at all — add one asserting Admin gets 403 (and the button
is hidden) for leave, CPD and credential-verify.

## Done means
A new test for each of the three approval actions (leave, CPD, credential-verify) proves Owner
succeeds and Admin is blocked/hidden consistently — moves this from `broken` to `proven`.

Tracker: 83bb9988-52ba-4f8c-85ba-7b65aca189b2
