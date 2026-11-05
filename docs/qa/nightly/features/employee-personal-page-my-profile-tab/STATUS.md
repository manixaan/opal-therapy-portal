# Employee Personal Page (My Profile Tab)

- Tracker stage: idea · Tracker environment: none
- Evidence label: **broken** (re-confirmed 2026-11-05 — code and findings unchanged since 2026-11-04)
- Addressed in this change window: no — zero commits since the 2026-11-04 audit's cutoff
- Created (any located code): **yes**

## Located files

- Backend: `backend/profile-routes.js` (mounted `server.js:497-498`) — leave CRUD + approve/reject,
  CPD CRUD + approve/reject, documents upload/download/delete, credentials (+ scan/extract/verify),
  work schedule, notification prefs, setup status. Work-location 24h reminder logic lives in
  `server.js:1223-1280`. Notifications generally live in `app-routes.js` (`storeNotification`).
- Frontend: `PROFILE TAB` banner `mockup_v3.html:4323`; `frontend/current/profile.js?v=12`.
- Guards: all routes `requireAuth`; approve/reject additionally gate inline via
  `canApprove`/`canViewAll` (`profile-routes.js:35-42`), both **owner-only**.

## Tests and results

- No dedicated unit or integration test for the leave/CPD approve-reject round trip.
- `tests/integration/readonly-and-hardening.itest.js` touches the documents endpoint —
  **1 of 5 suites in that batch failed**, on an unrelated storage-write-failure assertion
  (`D-6/D-7`) that expects a `chmod`'d directory to block a write; this sandbox runs as root, so
  the permission check never actually applies — an environment artifact, not a product defect.

## Open tasks from the tracker

- "Review Portal Structure" — todo, all checklist items unchecked. This is a hands-on
  click-through task for a human, not a coding task.

## Findings — confirmed bug (matches the tracker's own next_action exactly)

`profile-routes.js:35-42` carries a 2026-08-06 RBAC comment: "HR-style controls ... are
OWNER-ONLY. Admin's remit is scheduling + travel; approvals are practice management" —
`canApprove`/`canViewAll` both return true only for `role === 'owner'`.

But `frontend/current/profile.js` (lines 93, 284, 1344) treats Admin as a manager:
`isManager = ['owner','admin'].includes(u.role)`. This renders the full "Leave approvals"/"CPD
approvals" UI — Approve/Reject/Verify buttons — for Admin (`profile.js:100-123, 290-311, 793,
1386`). The backend's `canViewAll` silently forces `mineOnly=true` for Admin, so Admin actually
only sees their own records dressed up as the "all requests" manager view, and any Approve/Reject
click gets a 403. A stale JSDoc comment at `profile-routes.js:152` still says "Owner/Admin only",
contradicting the actual owner-only code — likely how the mismatch was introduced.

This is exactly the "Admin approval-button mismatch" the tracker's `next_action` names, and it
also affects the Professional Development (CPD) card — see that feature's STATUS.md.
