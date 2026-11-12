# Employee Personal Page (My Profile Tab)

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **built-untested**
- Addressed in change window (2026-10-29 to 2026-11-12): marginal — `frontend/current/profile.js` touched (5 lines)
- Created (any code located): yes

## Located files

- Routes: `backend/profile-routes.js` — `/api/profile/leave`, `/api/profile/cpd`, `/api/profile/documents`, `/api/profile/credentials`, `/api/profile/work-schedule/:userId`
- Data access: inline SQL + `db.updateLeaveStatus`/`db.deleteLeaveRequest` in `database.js`
- Frontend: `frontend/current/profile.js`; `PROFILE TAB` banner `mockup_v3.html:4325`
- Unit tests: `smart-route-backend.test.js` (covers only the work-schedule cross-user read-only check — **confirmed no `profile-routes.test.js` exists**), `credential-surface-guards.test.js`, `onboarding-security.test.js` (touches `/api/profile/leave` incidentally)
- Integration tests: `documents.itest.js`, `credential-scans.itest.js`, `audit.itest.js`, `readonly-and-hardening.itest.js`
- E2E: none dedicated. `docs/qa/BROWSER_QA_RESULTS.md` rows C (onboarding/profile chain) and I (Leave/CPD/documents, 2026-08-01) give some manual browser coverage: "Setup card + profile sections render; no fake-success strings; disabled features read 'Coming soon'".

## Guard check

Clean. Every route (`leave`, `cpd`, `documents`, `credentials`, `work-schedule`) carries `requireAuth`. Approve/reject/verify actions use an inline `canApprove()`/role check rather than `requirePermission` middleware — functions correctly, not flagged as unguarded, but a style note (consistent with the file's own documented role table).

## Tests run

- Unit: included in the `credential-surface-guards`/`pd-catalogue-guards`/`smart-route-backend` run — 3 suites, 87 tests, **all pass**. None of these is a dedicated `profile-routes.test.js`.
- Integration: `documents.itest.js`, `credential-scans.itest.js`, `audit.itest.js` — part of a 245-test run, 244 passed / 1 failed. The 1 failure is in `readonly-and-hardening.itest.js`'s D-6/D-7 test, which simulates a storage write failure via `fs.chmodSync(dir, 0o000)` — **this cannot work when the test process runs as root** (confirmed: `whoami` → `root`; Linux DAC checks are bypassed for root, so the chmod-based failure injection never triggers). This is a sandbox limitation, not a code defect in `/api/profile/documents`.

## Open tasks from tracker

- "Review Portal Structure" — `todo`. A manual QA checklist (walk every section, test personal details/work locations/leave/PD/notifications, verify owner-portal linkage) — explicitly a human testing task, not a coding task.

## Why built-untested

This matches the classification held for four consecutive nights: the routes are guarded and the tab renders per `docs/qa/BROWSER_QA_RESULTS.md` row I, but no test actually exercises `profile-routes.js`'s own guard boundaries — `smart-route-backend.test.js` covers only the work-schedule cross-user read-only path, and the integration coverage on `documents.itest.js`/`credential-scans.itest.js` is incidental (those files are really testing documents/credentials subsystems that happen to route through this file, not `profile-routes.js`'s leave/cpd/approval logic specifically). That's "no test exercises it, or the only tests are unrelated" — the `built-untested` criterion, not `needs-refinement`.

## Disagreement — wording

The tracker's own notes describe **"set your work locations for the next 24 hours"**. The actual UI banner in `mockup_v3.html:4325` reads **"next week"**. This is a real, verified mismatch between what the tracker assumes the UI says and what it actually says — flagging for a human decision on which is correct (the behaviour, not just the words, may differ too; not independently verified here).

## Commits in window touching it

Minimal (5-line `profile.js` change).
