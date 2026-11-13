# Employee Personal Page (My Profile Tab)

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **built-untested**
- Addressed in change window (2026-11-12 to 2026-11-13): no — zero commits since the 2026-11-12 audit
- Created (any code located): yes

## Located files

- Routes: `backend/profile-routes.js` — `/api/profile/leave`, `/api/profile/cpd`, `/api/profile/documents`, `/api/profile/credentials`, `/api/profile/work-schedule/:userId`
- Data access: inline SQL + `db.updateLeaveStatus`/`db.deleteLeaveRequest` in `database.js`
- Frontend: `frontend/current/profile.js`; `PROFILE TAB` banner `mockup_v3.html:4325`
- Unit tests: `smart-route-backend.test.js` (covers only the work-schedule cross-user read-only check — **confirmed again tonight: no `profile-routes.test.js` exists**), `credential-surface-guards.test.js`, `onboarding-security.test.js` (touches `/api/profile/leave` incidentally)
- Integration tests: `documents.itest.js`, `credential-scans.itest.js`, `audit.itest.js`, `readonly-and-hardening.itest.js`
- E2E: none dedicated. `docs/qa/BROWSER_QA_RESULTS.md` rows C and I give manual browser coverage, unchanged since 2026-08-01.

## Guard check

Re-confirmed tonight by direct grep, unchanged. Every route (`leave`, `cpd`, `documents`, `credentials`, `work-schedule`) carries `requireAuth`. Approve/reject/verify actions use an inline `canApprove()`/role check rather than `requirePermission` middleware — functions correctly, not flagged as unguarded.

## Tests run

- Unit: re-run tonight as part of a 23-suite/810-test group (798 passed, 12 skipped) — **all pass**. None of these is a dedicated `profile-routes.test.js`.
- Integration: re-run tonight — `documents.itest.js`, `credential-scans.itest.js`, `audit.itest.js`, `readonly-and-hardening.itest.js` — part of a 9-suite/239-test run, 238 passed / 1 failed. The 1 failure is `readonly-and-hardening.itest.js`'s D-6/D-7 test, which simulates a storage write failure via `fs.chmodSync(dir, 0o000)` — re-confirmed tonight this cannot work when the test process runs as root (`whoami` → `root`). Sandbox limitation, not a code defect.

## Open tasks from tracker

- "Review Portal Structure" — `todo`. A manual QA checklist — explicitly a human testing task, not a coding task.

## Why built-untested

Unchanged for a fifth consecutive night: the routes are guarded and the tab renders per `docs/qa/BROWSER_QA_RESULTS.md` row I, but no test actually exercises `profile-routes.js`'s own guard boundaries.

## Disagreement — wording

Re-confirmed tonight: the tracker's own notes describe **"set your work locations for the next 24 hours"**. The actual UI banner in `mockup_v3.html:4325` still reads **"next week"**. Standing mismatch for a human decision.

## Commits in window touching it

None this window.
