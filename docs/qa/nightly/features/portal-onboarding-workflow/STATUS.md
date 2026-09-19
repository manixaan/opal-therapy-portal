# Portal Onboarding Workflow

- Tracker stage: **idea** · Tracker environment: **none**
- Evidence label: **tab-unproven**
- Addressed since last audit (2026-09-17T18:21Z UTC): **yes** — commit `4c174b5` fixed both standing regressions
- Created (any located code): **yes** — this is the single largest subsystem in the codebase

## Located files

- **Routes (11):** `backend/onboarding-employee-routes.js`, `onboarding-workflow-routes.js`, `onboarding-journey-routes.js`, `onboarding-pack-routes.js`, `onboarding-returns-routes.js`, `onboarding-payroll-routes.js`, `onboarding-defaults-routes.js`, `onboarding-package-docs-routes.js`, `onboarding-assignment-routes.js`, `onboarding-library-routes.js`, `onboarding-routes.js`
- **Data access (34+ files):** `onboarding-db.js`, `onboarding-engine.js`, `onboarding-journey.js`, `onboarding-journey-db.js`, `onboarding-pack.js`, `onboarding-pack-db.js`, `onboarding-form-reader.js`, `onboarding-document-check.js`, `onboarding-induction.js`, `onboarding-payroll.js`, `onboarding-reconcile.js`, `onboarding-returns-db.js`, `onboarding-returns-zip.js`, `onboarding-offer-*.js` and more.
- **Frontend:** `frontend/current/onboarding.js` (`?v=14`), `onboarding.css` (`?v=8`), `onboarding-journey.js` (`?v=72`), `onboarding-journey.css` (`?v=39`) — mounted at the `ONBOARDING TAB` banner. Pins match `mockup_v3.html` exactly.
- **Migrations (recent):** `063_onboarding_document_checks.sql` … `066_onboarding_offer_wording.sql`.

## Guard check

Every route sits behind `requireAuth` plus `requirePermission`/`requireAnyPermission`/an in-body `role === 'owner'` check. The only unauthenticated routes are documented, deliberate exceptions gated by single-use invite/download tokens. No unguarded route found.

## Tests run

Today's commit `4c174b5` ("placeholder publishing is race-safe, not-applicable documents no longer block Phase 3, induction test reads the real forms") targets exactly the two regressions flagged on the last two audits. Re-ran everything fresh tonight:

- `tests/integration/onboarding-defaults.itest.js` — **PASS** (1/1). The `GET /api/onboarding/journey/defaults/:packageId` 500 (`duplicate key value violates unique constraint "uq_onboarding_document_version"`) no longer reproduces.
- `tests/integration/onboarding-induction.itest.js` — **PASS** (2/2). Payroll status now reaches `ready_for_review` once all rows are ready.
- Full unit sweep `npx jest tests/onboarding-` — **573/573 passed**, 22 suites (includes `onboarding-journey-frontend-guards.test.js`, whose `?v=` pins already match the shipped shell — no stale-pin failure tonight).
- Full integration sweep `DB_NAME=therapy_scheduler_audit DB_PASSWORD=audit npx jest --config jest.integration.config.js tests/integration/onboarding --runInBand` — **176/176 passed**, 8 suites.

Both standing regressions are fixed and confirmed by fresh runs, not carried forward. No TODO/FIXME found in onboarding source files.

## Why not `proven`

No fresh browser/E2E proof exists for the exact flow that broke: package defaults, document publishing and payroll status. The only browser QA on file is `docs/qa/BROWSER_QA_RESULTS.md` flow C, dated 2026-08-01, and it only exercises the employee's post-registration review step and setup card (Splose/Outlook/travel-base chips) — not the defaults view or payroll readiness screen that just had a real, reproducible bug. Given how much has changed in this subsystem since (dozens of onboarding commits, several after Aug 1 touching exactly these files), that QA pass doesn't cover today's fix. No E2E spec exercises onboarding at all.

## Disagreement

Tracker stage is **idea** (implying nothing built) but the codebase shows a mature, heavily-tested three-stage onboarding journey (offer → documentation → induction/payroll), now fully green in both test suites after tonight's fix — the tracker should reflect a shipped, working feature, not an idea.
