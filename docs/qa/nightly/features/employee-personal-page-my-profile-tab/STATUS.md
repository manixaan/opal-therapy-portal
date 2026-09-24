# Employee Personal Page (My Profile Tab)

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed in this change window (2026-09-23 → 2026-09-24): no — zero commits landed in this window at all
- Created (any located code): yes

## Located files

- Backend: `backend/profile-routes.js` (leave, CPD, documents, credentials incl. credential-scan upload/extraction, work-schedule/work-locations, notification-prefs, setup-status — 27 routes)
- People register (admin view of others): `backend/onboarding-routes.js` (`/api/onboarding/employees`, `requirePermission('onboarding.view')`) and `backend/onboarding-employee-routes.js` (self-service `/api/onboarding/me/*`)
- Frontend: `frontend/current/employees.js`/`.css` (the register), `frontend/current/profile.js` (My Profile tab logic; markup in `mockup_v3.html`'s `PROFILE TAB` section)

## Guard check

`profile-routes.js` has no blanket `router.use` — all 27 routes individually carry `requireAuth`. Approval/cross-user views (`canApprove`, `canViewAll`) are owner-only, checked in-handler. `onboarding-routes.js`'s employee-register endpoints use `requirePermission('onboarding.view')`. `onboarding-employee-routes.js` is self-scoped by design. No guard defects found; the per-route (not middleware) pattern in `profile-routes.js` is worth the team's own periodic review given its sensitivity, but is not itself a defect.

## Tests (re-run fresh tonight)

- Unit: coverage is folded into `frontend-stage2-guards.test.js`, `frontend-stage3-guards.test.js`, `credential-surface-guards.test.js`, `security.test.js` — run tonight bundled with other feature areas; the guard-suite set passed cleanly (332–345 tests depending on grouping, 0 failures).
- Integration: `routes-users.itest.js`, `documents.itest.js`, `audit.itest.js`, `stage2-pilot-readiness.itest.js`, `credential-scans.itest.js`, `readonly-and-hardening.itest.js` — run tonight in the PD/Profile + Inductions/Resources batch (12 suites / 176 tests). **1 known non-code failure**: `readonly-and-hardening.itest.js`, "D-6/D-7: storage failure behaviour (local backend)" — this container runs as root; the test simulates an unwritable storage directory via `chmod 0o000`, which root bypasses on Linux, so the simulated failure never occurs (confirmed by reading the assertion: expects `>= 500`, got `201`). Same artifact flagged every prior audit night since 2026-09-20 — not a code defect.
- Browser/E2E: `docs/qa/BROWSER_QA_RESULTS.md` row C (onboarding→profile chain) and row I ("Leave/CPD/documents") cover parts of My Profile — sections render, no fake-success strings, disabled features honestly read "Coming soon"/"Preview only — not saved". No e2e spec covers My Profile specifically, and this QA pass (2026-08-01) predates the People-register redesign work. This row is real evidence the tab renders, but "Preview only — not saved" language means some of what it checked is intentionally non-functional in the build it tested — not enough, on balance, to call the full leave/CPD/documents/credentials flow `proven` outright. Kept as `tab-unproven`, as on every prior audit night, with this nuance flagged for a person to weigh.

## Open tasks from the tracker

- "Review Portal Structure" — `todo`. A manual click-through testing job, not a coding task. One correction this audit (and prior nights) found: the tracker describes a **24-hour** reminder for setting work locations; the actual implementation (`runLocationAlarmCheck()` in `backend/server.js`) is a **Friday-only weekly nudge** for the coming Mon–Fri, not a rolling 24-hour reminder.

## Commits in the window that touched it

None — `develop` sits on `74601fc` again tonight. Re-verified fresh: both the shared guard-suite unit run and the integration group re-run tonight with the same single known artifact as every prior night — no regression.

## Disagreement

The tracker's "24-hour" reminder framing doesn't match the shipped weekly-Friday design — worth a decision on whether the tracker text should change or whether a real 24-hour reminder is still wanted.
