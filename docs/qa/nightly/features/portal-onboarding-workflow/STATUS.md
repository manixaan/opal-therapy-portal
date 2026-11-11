# Portal Onboarding Workflow

Tracker stage: idea · Tracker environment: none
Evidence label: **proven**
Addressed in this change window: **no** · Created: **yes**

## Located files

`backend/onboarding-employee-routes.js`, `onboarding-workflow-routes.js`, `onboarding-journey-routes.js`, `onboarding-pack-routes.js`, `onboarding-returns-routes.js`, `onboarding-payroll-routes.js`, `onboarding-defaults-routes.js`, `onboarding-package-docs-routes.js`, `onboarding-assignment-routes.js`, `onboarding-library-routes.js`, `onboarding-routes.js` (11 files, all mounted in `backend/server.js`). Frontend: `frontend/current/onboarding.js` and the `ONBOARDING TAB` / `EMPLOYEES TAB` banners in `mockup_v3.html`.

Guarded, re-confirmed by direct grep of all 11 files tonight: every route pairs `requireAuth` with a delegated `requirePermission('onboarding.*')` permission (`onboarding.view`, `onboarding.assign`, `onboarding.review`, `onboarding.payroll`, `onboarding.manage_packages`, `onboarding.manage_documents` — not in any role's defaults except owner, per `permissions.js`). No unguarded route found.

## Tests

- Unit (27 files, `onboarding-*.test.js`): **653/654 pass**, run tonight. The one failure (`onboarding-document-reader.test.js`, "the OCR language data is shipped with the portal") is the same **environment gap, not a code defect**, as prior nights: `Cannot find module '@tesseract.js-data/eng/package.json'` — the package is declared in `backend/package.json` but absent from `backend/node_modules` in this sandbox. Did not attempt `npm install`/`npm ci` (forbidden in this sandbox).
- Integration (10 files, `onboarding*.itest.js`): **218/218 pass**, run tonight on isolated DB `therapy_scheduler_audit_g4_test` (361s).

## Browser / E2E proof

`docs/qa/BROWSER_QA_RESULTS.md` entry C: new-therapist onboarding flow renders correctly end to end, setup card tracks real state, persists after reload. Unchanged since no commits landed in this window; re-confirmed present tonight.

## Open tasks from the tracker

"Stage 1", "Stage 2", "stage 3" (all todo, no further detail in the tracker).

## Commits in the window touching this feature

None. No commits landed on `develop` since last night's audit — `develop` is still at `40669e7`, the exact commit audited last night and re-verified again tonight.

## Disagreement

None.
