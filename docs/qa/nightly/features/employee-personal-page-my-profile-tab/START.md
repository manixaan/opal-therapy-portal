/opal-critical

**Idea:** Employee Personal Page (My Profile Tab)

**Why:** (not yet written in the tracker)

**Who uses it:** (not yet written in the tracker)

**What they see:** (not yet written in the tracker)

**What should happen:** (not yet written in the tracker)

**Outcome:** (not yet written in the tracker)

**Decisions:** (none recorded)

## Where it lives today

- `backend/profile-routes.js` (leave, CPD, documents, credentials, work-schedule, notification-prefs)
- `frontend/current/profile.js` + `mockup_v3.html` PROFILE TAB (`#pf-leave`, `#pf-cpd`, `#pf-credentials`)
- No test anywhere covers `/api/profile/leave*` or `/api/profile/cpd*` (approve/reject).

## Start here

Add an integration test file `backend/tests/integration/profile-leave-cpd.itest.js` (or extend `documents.itest.js`'s pattern — same login/agent helper, same `requireAuth`+owner-only pattern). Cover: a therapist submits a leave request, sees only their own in `GET /api/profile/leave`, an owner sees the org-wide list, a non-owner admin is `403`'d on `/approve`, an owner approves and the status/audit row updates. Mirror the same round trip for `/api/profile/cpd*`. Use `backend/tests/integration/resource-hub-r2.itest.js`'s CPD tests (lines ~740-753) as the closest existing pattern for the assert shape.

## Done means

The new integration test passes and exercises the leave and CPD approve/reject round trip end to end → evidence label becomes `proven`.

Tracker: 83bb9988-52ba-4f8c-85ba-7b65aca189b2
