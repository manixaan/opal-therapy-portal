# Employee Personal Page (My Profile Tab)

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed in this change window (2026-09-22 → 2026-09-23): no — zero commits landed in this window at all; `profile-routes.js`, `profile.js`, and `employees.js` remain untouched since the prior window's `37f4e057` "Users & Roles redesigned" (which added a NEW, separate `frontend/current/people.js` — a distinct file from `employees.js`, covered under Portal - Splose - Outlook instead).
- Created (any located code): yes

## Located files

- Backend: `backend/profile-routes.js` (leave, CPD, documents, credentials incl. credential-scan upload/extraction, work-schedule/work-locations, notification-prefs, setup-status — 27 routes)
- People register (admin view of others, "More → People"): `backend/onboarding-routes.js` (`/api/onboarding/employees`, `/:userId`, `requirePermission('onboarding.view')`) and `backend/onboarding-employee-routes.js` (self-service `/api/onboarding/me/*`). There is no `people-routes.js`/`employee-routes.js` — the tracker's assumed file naming doesn't exist; the register is split across these two files.
- Frontend: `frontend/current/employees.js`/`.css` (the register + one profile per person, `#emp-root`), `frontend/current/profile.js` (My Profile tab code; markup/CSS stayed in `mockup_v3.html`'s `PROFILE TAB` section, tab button `data-tab="profile"` at line 4088)

## Guard check

`profile-routes.js` has no blanket `router.use` — all 27 routes individually carry `requireAuth`. Role gating for approvals/cross-user views (`canApprove`, `canViewAll`) is owner-only, checked in-handler rather than as middleware; this audit confirmed the helper functions exist and gate on `role === 'owner'` but did not independently trace all 27 routes' internal branching — worth a spot-check given this file handles leave/CPD approvals and credential verification. `onboarding-routes.js`'s employee-register endpoints use `requirePermission('onboarding.view')` (correctly permission-gated, not self-scoped). `onboarding-employee-routes.js` is self-scoped by design (confirmed no route takes a user id). No guard defects found, but the per-route (not middleware) pattern in `profile-routes.js` is worth the team's own review given its sensitivity.

## Tests

- Unit (all pass): no dedicated `profile-routes.test.js` or `employees.test.js` exists; coverage is folded into `frontend-stage2-guards.test.js`, `frontend-stage3-guards.test.js`, `credential-surface-guards.test.js`, `security.test.js` (6 suites, 418 tests, 0 failures)
- Integration: `routes-users.itest.js` (includes a test specifically for the "set your work locations" reminder base-location logic), `documents.itest.js`, `audit.itest.js`, `stage2-pilot-readiness.itest.js`, `credential-scans.itest.js` all pass. **`readonly-and-hardening.itest.js` had 1 failing test** (`D-6/D-7: storage failure behaviour... write failure → 5xx with NO orphaned row`) — confirmed to be a **sandbox artifact, not a code defect**: this container runs as root, and the test simulates a storage write failure via `chmod 0o000` on a directory, which root bypasses on Linux (standard DAC permission checks don't apply to root). The other 56 tests in that run passed. This is not evidence of a real problem with the storage-failure-handling code; it just can't be exercised meaningfully as this container is configured.
- Browser/E2E: `docs/qa/BROWSER_QA_RESULTS.md` rows C and I cover parts of My Profile (setup card, profile sections render, leave/CPD/documents — with a note that some disabled features intentionally read "Coming soon"). No e2e spec covers My Profile specifically, and this QA pass predates the People-register work.

## Open tasks from the tracker

- "Review Portal Structure" — `todo`. This is explicitly a manual click-through testing job (walk every section, click every button, confirm leave/CPD approval round-trips with the owner side), not a coding task. One concrete correction the audit found: the tracker describes **"set your work locations for the next 24 hours"** as a 24-hour reminder; the actual implementation (`runLocationAlarmCheck()` in `backend/server.js`) is a **Friday-only weekly nudge for the coming Mon–Fri**, checked hourly but only acting on Fridays, idempotent per week — not a rolling 24-hour reminder. Worth flagging to whoever does the manual walkthrough so they're not testing for behaviour that isn't there.

## Commits in the window that touched it

None — `develop` did not move since last night (both audits sit on `74601fc`). Re-verified fresh
anyway: the shared guard-suite unit run (345/345) and the integration group (`routes-users.itest.js`,
`documents.itest.js`, `audit.itest.js`, `stage2-pilot-readiness.itest.js`, `credential-scans.itest.js`,
`readonly-and-hardening.itest.js` — 56/57, same 1 known sandbox-root `chmod` artifact as every prior
night) both re-run tonight with identical results — no regression.

## Disagreement

The tracker's "24-hour" reminder framing doesn't match the shipped weekly-Friday design — worth a decision on whether the tracker text is describing something that should exist but doesn't, or whether it's simply describing the weekly nudge loosely.
