# Employee Personal Page (My Profile Tab)

Tracker stage: idea · Tracker environment: none
Evidence label: **built-untested**
Addressed in this change window: **partially** · Created: **yes**

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

**1 commit** — `40669e7` (2026-11-10) touched `frontend/current/profile.js`'s Work schedule section only: the Local/Remote home-base picker is retired, and a saved `remote` base now loads as an ordinary (`local`) one. This is a source-level change covered by a source-string assertion in the new `backend/tests/travel-block-frontend.test.js` ("home bases have no Local/Remote picker; a saved remote base loads as local"), not by a dedicated `profile-routes` test — the backend API itself (`backend/profile-routes.js`) is untouched tonight and still has zero automated test coverage. Evidence label is unchanged: still `built-untested`.

## Disagreement

None.

## Note

See `docs/qa/nightly/features/professional-development/STATUS.md` for a related ambiguity: that card may or may not be describing the CPD section covered here.
