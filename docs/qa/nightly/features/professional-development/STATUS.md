# Professional Development

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed in this change window (2026-09-22 → 2026-09-23): no — zero commits landed in this window at all
- Created (any located code): yes — split across two other subsystems, no dedicated PD subsystem exists

## Located files

There is no standalone PD route/data-access file and no `pd_catalogue` table (migration 029 only extends the pre-existing `pd_events` table). PD is split across:

- Admin-curated PD events catalogue (the "PD tab" browsing/management), a sub-feature of the Resource Hub: `backend/resource-hub-r2-routes.js` (`pd_events` CRUD, a scheduled status-flip query, a Home-page preview query). Migration `029_pd_catalogue.sql`'s own header states: "All 12 rows were entered through the admin PD tab. There is no provider API, no feed and no scraper" and "Opal has no booking integration" — this is provenance scaffolding, not itself new functionality.
- Employee-facing CPD (Continuing Professional Development) records, in the My Profile tab: `backend/profile-routes.js` (`/api/profile/cpd` GET/POST, `/:id/approve`, `/:id/reject`, `/:id` DELETE)
- Frontend: `frontend/current/profile.js` (My Profile CPD UI), `frontend/current/resourcehub.js` (admin PD catalogue UI)

## Guard check

`profile-routes.js`: every route individually carries `requireAuth` (no blanket `router.use`); CPD-specific routes at lines 202/225/259/280/301. Role gating for approve/reject is via in-code helper functions `canApprove`/`canViewAll` (owner-only) rather than middleware — this audit confirmed the functions exist and gate correctly on `role === 'owner'`, but did not trace every one of the 27 routes in the file individually. `resource-hub-r2-routes.js`: `router.use('/api/rh2', requireAuth, ...)` blanket guard covers the PD endpoints too. No guard defects found.

## Tests

- Unit (all pass): `pd-catalogue-guards.test.js` (run with the Employee Profile batch: 6 suites, 418 tests, 0 failures). No dedicated CPD-specific unit test file exists for `profile-routes.js`'s CPD routes — coverage there is folded into the broader guard-test suites (`frontend-stage2-guards.test.js`, `frontend-stage3-guards.test.js`, `credential-surface-guards.test.js`, `security.test.js`).
- Integration: `resource-hub-r2.itest.js` (passed, part of the Resource Hub batch — 6 suites, 133 tests, 0 failures) exercises `pd_events`. No CPD-specific integration test was identified by name for the My Profile side.
- Browser/E2E: `docs/qa/BROWSER_QA_RESULTS.md` row I ("Leave/CPD/documents") notes setup card and profile sections render, and that disabled features in the shipped build read "Coming soon"/"Preview only — not saved" — meaning some CPD/document functionality is **intentionally stubbed in the current staging build**, not broken. This is the only browser evidence found, and it predates most of the window's work.

## Open tasks from the tracker

None recorded — "Professional Development" has no tasks in the tracker snapshot, only the bare feature title.

## Commits in the window that touched it

None — `develop` did not move since last night (both audits sit on `74601fc`). Re-verified fresh
anyway: unit (`pd-catalogue-guards.test.js`, part of a 345-test guard-suite run) and integration
(`resource-hub-r2.itest.js`, part of a 261-test combined Inductions+Resource Hub batch) both re-run
tonight with identical results to last night — no regression.

## Disagreement

None — there's too little in the tracker to disagree with. Worth flagging to the team that this tracker card has no tasks and no notes, while real, working (if split) code already exists for it.
