# Portal Onboarding Workflow

Tracker stage: idea · Tracker environment: none
Evidence label: **proven**
Addressed in this change window: **no** · Created: **yes**

## Located files

`backend/onboarding-employee-routes.js`, `onboarding-workflow-routes.js`, `onboarding-journey-routes.js`, `onboarding-pack-routes.js`, `onboarding-returns-routes.js`, `onboarding-payroll-routes.js`, `onboarding-defaults-routes.js`, `onboarding-package-docs-routes.js`, `onboarding-assignment-routes.js`, `onboarding-library-routes.js`, `onboarding-routes.js` (mounted in `backend/server.js`). Frontend: `frontend/current/onboarding.js` and the `ONBOARDING TAB` / `EMPLOYEES TAB` banners in `mockup_v3.html` (lines 4297, 4306).

All route groups guarded: `requireAuth` plus `requirePermission('onboarding.*')` (a delegated permission set, not in any role's defaults except owner, per `permissions.js`). No bare unguarded route found. No TODO/FIXME.

## Tests

- Unit (glob `onboarding-*.test.js`, 27 files): **653/654 pass**. The one failure (`onboarding-document-reader.test.js`) is an **environment gap, not a code defect**: the OCR data package `@tesseract.js-data/eng` (declared in `backend/package.json` but absent from `backend/node_modules`) is missing, so the test can't resolve it. Confirmed by direct inspection — the package is a genuine dependency, not optional, and this agent could not run `npm install` to fix it (hard limit). Flagging for the environment setup script, not the onboarding code.
- Integration (10 files, `tests/integration/onboarding*.itest.js`): **218/218 pass** (confirmed on a clean re-run; a first run that overlapped by a few seconds with another integration run this agent started produced 35 false failures from database truncation contention — discarded, see Technical detail in the daily brief).

## Browser / E2E proof

`docs/qa/BROWSER_QA_RESULTS.md` entry C: new-therapist onboarding flow renders correctly end to end, setup card tracks real state, persists after reload.

## Open tasks from the tracker

"Stage 1", "Stage 2", "stage 3" (all todo, no further detail in the tracker).

## Commits in the window touching this feature

None — `backend/onboarding-*.js` did not change in the last 14 days. Stable, already-built code.

## Disagreement

None.
