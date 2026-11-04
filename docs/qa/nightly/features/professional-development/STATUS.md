# Professional Development

- Tracker stage: idea · Tracker environment: none
- Evidence label: **broken**
- Addressed in this change window: no
- Created (any located code): **yes**

## Located files

- Backend: `backend/profile-routes.js` — CPD activities (`GET/POST /api/profile/cpd`,
  `PATCH /api/profile/cpd/:id/approve`, `PATCH /api/profile/cpd/:id/reject`,
  `DELETE /api/profile/cpd/:id`) and PD document upload.
- Frontend: `mockup_v3.html:4323` `PROFILE TAB`; `frontend/current/profile.js` CPD section.
- Guards: `requireAuth` on all CPD routes; approve/reject additionally gate inline with
  `canApprove(req.user)` which is **owner-only** (`profile-routes.js:35-42`,
  `function canApprove(user) { return user?.role === 'owner'; }`).

## Tests and results

- No dedicated unit or integration test exists for the CPD submit→approve/reject round trip.
- `docs/qa/BROWSER_QA_RESULTS.md:30` is a render-only smoke check ("Setup card + profile sections
  render... ✅ 3/3"), not an approve/reject test.

## Open tasks from the tracker

None recorded — zero tasks on this feature card (the task list lives under the related "Employee
Personal Page" card instead).

## Findings — shared bug with Employee Personal Page

`frontend/current/profile.js` (lines 93, 284, 1344) treats **Admin** as a manager
(`isManager = ['owner','admin'].includes(u.role)`) and renders the CPD "approvals" UI —
Approve/Reject buttons — for Admin. But the backend's `canApprove` is **owner-only**, so an Admin
who clicks Approve/Reject on a CPD item gets a 403. This is the same root cause documented in
`features/employee-personal-page-my-profile-tab/STATUS.md` (confirmed by that feature's locate
pass) — it affects CPD exactly as it affects leave, since both sections key off the same
`isManager` flag in `profile.js` and the same owner-only gate pattern in `profile-routes.js`.

## Disagreement

None — the tracker's own `next_action` ("add an integration test for the CPD round trip") is
exactly right, and doing so would have caught this bug immediately.
