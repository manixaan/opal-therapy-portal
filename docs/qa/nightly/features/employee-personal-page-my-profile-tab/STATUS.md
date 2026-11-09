# Employee Personal Page (My Profile Tab)

Tracker stage: idea · Tracker environment: none
Evidence label: **built-untested**
Addressed in this change window: **no** · Created: **yes**

## Located files

`backend/profile-routes.js` (1351 lines): Leave requests, CPD/professional development activities, Professional Development documents, Credentials, Work schedule, Notification prefs, Setup status. Frontend: `mockup_v3.html` `PROFILE TAB` banner plus standalone `frontend/current/profile.js`.

All routes carry `requireAuth`. Re-confirmed tonight by direct grep: approval/verification actions (leave approve/reject, CPD approve/reject, credential verify) use an inline `canApprove(user)` helper restricted to `role === 'owner'`. `work-schedule/:userId` uses `requirePermission('view_all_travel')`. No unguarded route found.

## Tests

**None.** Re-confirmed tonight: no `backend/tests/profile-routes.test.js` exists, and no unit or integration test file anywhere references `profile-routes` or exercises its leave/CPD/credential endpoints.

## Browser / E2E proof

`docs/qa/BROWSER_QA_RESULTS.md` entry I: Leave/CPD/documents sections render correctly, no fake-success strings, disabled features correctly read "Coming soon"/"Preview only — not saved". This proves rendering only, not the API logic.

## Open tasks from the tracker

"Review Portal Structure" (todo) — a manual, hands-on QA checklist, not an automated-test gap by itself, but it reinforces that nothing here is machine-verified yet.

## Commits in the window touching this feature

None. Zero commits landed on `develop` between the 2026-11-08 audit and tonight.

## Disagreement

None.

## Note

See `docs/qa/nightly/features/professional-development/STATUS.md` for a related ambiguity: that card may or may not be describing the CPD section covered here.
