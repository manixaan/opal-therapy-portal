# Portal Onboarding Workflow

- Tracker stage: **idea** · Tracker environment: **none**
- Evidence label: **tab-unproven**
- Addressed since last audit (2026-09-18T19:20Z UTC, commit `0726dde`): **no** — none of tonight's
  7 commits touch onboarding
- Created (any located code): **yes** — this is the single largest subsystem in the codebase

## Located files

- **Routes (11):** `backend/onboarding-employee-routes.js`, `onboarding-workflow-routes.js`,
  `onboarding-journey-routes.js`, `onboarding-pack-routes.js`, `onboarding-returns-routes.js`,
  `onboarding-payroll-routes.js`, `onboarding-defaults-routes.js`,
  `onboarding-package-docs-routes.js`, `onboarding-assignment-routes.js`,
  `onboarding-library-routes.js`, `onboarding-routes.js`.
- **Data access (34+ files)** and **Frontend:** `frontend/current/onboarding.js` (`?v=14`),
  `onboarding.css` (`?v=8`), `onboarding-journey.js` (`?v=72`), `onboarding-journey.css` (`?v=39`).
- **Migrations:** `063_onboarding_document_checks.sql` … `066_onboarding_offer_wording.sql`.

All confirmed present, unchanged. `git log 0726dde..HEAD --oneline -- <all 17 located files>` —
empty.

## Guard check

Every route sits behind `requireAuth` plus `requirePermission`/`requireAnyPermission`/an in-body
`role === 'owner'` check. The only unauthenticated routes are documented, deliberate exceptions
gated by single-use invite/download tokens. No unguarded route found.

## Tests run

Re-run fresh tonight, no code changed here since last audit's fix (`4c174b5`):

- `npx jest tests/onboarding-` — **PASS 573/573**, 22 suites.
- `DB_NAME=therapy_scheduler_n4b DB_PASSWORD=audit npx jest --config jest.integration.config.js
  tests/integration/onboarding --runInBand` — **PASS 176/176**, 8 suites.

Both counts match last night exactly — both standing regressions from two nights ago remain fixed.
No TODO/FIXME found in onboarding source files.

## Why not `proven`

No fresh browser/E2E proof exists for the fixed flow (package defaults, document publishing,
payroll status). The only browser QA on file is `docs/qa/BROWSER_QA_RESULTS.md` flow C, dated
2026-08-01, untouched tonight — it only exercises the employee's post-registration review step and
setup card, not the defaults view or payroll readiness screen. No E2E spec exercises onboarding at
all. Unchanged tonight.

## Disagreement

Tracker stage is idea (implying nothing built) but the codebase shows a mature, heavily-tested
three-stage onboarding journey, fully green in both test suites — the tracker should reflect a
shipped, working feature, not an idea.
