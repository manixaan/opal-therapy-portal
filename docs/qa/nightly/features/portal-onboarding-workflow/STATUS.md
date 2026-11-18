# Portal Onboarding Workflow

- Tracker stage: **idea**
- Tracker environment: **none**
- Evidence label: **broken**
- Addressed in the 2026-11-04..2026-11-18 change window: **no**
- Created (any located code): **yes**

## Located files
- backend/onboarding-employee-routes.js
- backend/onboarding-workflow-routes.js
- backend/onboarding-journey-routes.js
- backend/onboarding-pack-routes.js
- backend/onboarding-package-docs-routes.js
- backend/onboarding-returns-routes.js
- backend/onboarding-defaults-routes.js
- backend/onboarding-assignment-routes.js
- backend/onboarding-library-routes.js
- backend/onboarding-routes.js
- frontend: ONBOARDING TAB banner + frontend/current/onboarding.js + standalone onboarding.html / onboarding-invite.html

## Guard check
OK — requireAuth + requirePermission('onboarding.*') per route throughout.

## Tests run
- unit: `25 onboarding-*.test.js files run (excluding payroll/security, covered under Xero/cross-cutting): 24 passed, 1 FAILED — tests/onboarding-document-reader.test.js: "Cannot find module '@tesseract.js-data/eng/package.json'". Root cause: @tesseract.js-data/eng is declared in backend/package.json but genuinely absent from backend/node_modules — an OCR-language-pack install gap in this environment, not a code defect. 604 other tests in the same run passed.` — **fail (1 of 25 files)** (604 pass / 1 fail)
- integration: `onboarding-defaults.itest.js, onboarding-journey.itest.js, onboarding-pack.itest.js, onboarding-portal-route.itest.js, onboarding-returns.itest.js, onboarding-wizard-link.itest.js, onboarding-workflow.itest.js, onboarding.itest.js` — **pass** (8 files / 208 tests)

## Tab / browser proof
docs/qa/BROWSER_QA_RESULTS.md row C (onboarding/profile chain) — dated 2026-08-01, stale but exists.

## Recency
Not directly touched in-window.

## Open tasks (from the tracker)
- Stage 1 — todo
- Stage 2 — todo
- stage 3 — todo

## Reason for the label
One located unit test file fails. By the letter of the rule (a located test fails) this is `broken`, but the cause is a missing optional dependency (OCR language data for scanned-document reading) in this sandbox, not a logic error in the code — node --check is clean on every backend file, and 812 other onboarding tests (unit+integration) pass.

## Disagreement with the tracker
Tracker "idea" stage vs. a very large, mostly-tested, already-permissioned workflow; separately, all three stage tasks remain todo (Letter of Offer preview/send flow, SharePoint storage for Stage 2, dynamic employee contract, Stage 3 undefined).
