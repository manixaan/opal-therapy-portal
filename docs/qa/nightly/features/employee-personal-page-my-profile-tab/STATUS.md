# Employee Personal Page (My Profile Tab)

Tracker stage: idea · Tracker environment: none
Evidence label: **built-untested**
Addressed in this change window: **no** · Created: **yes**

## Located files

`backend/profile-routes.js` (1351 lines): Leave requests (61-202), CPD/professional development activities (204-320), Professional Development documents (322-689), Credentials (690-1123), Work schedule (1124-1213), Notification prefs (1214-1263), Setup status (1264-1337). Frontend: `mockup_v3.html` `PROFILE TAB` banner (line 4323, `<section id="view-profile">`) plus standalone `frontend/current/profile.js`.

All routes carry `requireAuth`. Approval/verification actions (leave approve/reject, CPD approve/reject, credential verify) use an inline `canApprove(user)` helper restricted to `role === 'owner'` — admin is explicitly excluded by a 2026-08-06 RBAC comment ("HR-style controls... are OWNER-ONLY. Admin's remit is scheduling + travel"). `work-schedule/:userId` uses `requirePermission('view_all_travel')`. No unguarded route found. No TODO/FIXME.

## Tests

**None.** No `backend/tests/profile-routes.test.js` exists; no unit or integration test file anywhere references `profile-routes` or contains "leave request" strings. (A grep for "CPD" hits `pd-catalogue-guards.test.js`, but that tests an unrelated Resource Hub page — see `docs/qa/nightly/features/professional-development/STATUS.md`.)

## Browser / E2E proof

`docs/qa/BROWSER_QA_RESULTS.md` entry I: Leave/CPD/documents sections render correctly, no fake-success strings, disabled features correctly read "Coming soon"/"Preview only — not saved". This proves rendering only, not the API logic.

## Open tasks from the tracker

"Review Portal Structure" (todo) — a manual, hands-on QA checklist (click every button, confirm the leave/CPD approval round-trip with the owner side) explicitly described as "not a documentation job" and "no note-taking... needed". This is a human verification task, not an automated-test gap by itself, but it reinforces that nothing here is machine-verified yet.

## Commits in the window touching this feature

None — neither `backend/profile-routes.js` nor `frontend/current/profile.js` changed in the last 14 days, and the many recent `mockup_v3.html` commits do not touch the `PROFILE TAB` section.

## Disagreement

None.

## Note

See `docs/qa/nightly/features/professional-development/STATUS.md` for a related ambiguity: that card may or may not be describing the CPD section covered here.
