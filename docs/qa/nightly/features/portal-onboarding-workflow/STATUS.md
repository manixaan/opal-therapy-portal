# Portal Onboarding Workflow

- Tracker stage: **idea**
- Tracker environment: **none**
- Evidence label: **needs-refinement**
- Addressed since the last audit (2026-11-17..2026-11-18): **no**
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
- unit: `25 onboarding-*.test.js files run (excluding payroll/security, covered under Xero/cross-cutting): 24 passed, 1 FAILED — tests/onboarding-document-reader.test.js: "Cannot find module '@tesseract.js-data/eng/package.json'". @tesseract.js-data/eng is declared in backend/package.json but genuinely absent from backend/node_modules in this sandbox. This is the SAME environment/install artifact this audit's prior nights (2026-11-15 through 2026-11-17) have already confirmed independently — flagging again for whoever maintains the environment's setup script; the hard limit against running `npm install` means it cannot be fixed from inside this audit. 604 other tests in the same run passed.` — **fail (1 of 25 files, known environment artifact)** (604 pass / 1 fail)
- integration: `onboarding-defaults.itest.js, onboarding-journey.itest.js, onboarding-pack.itest.js, onboarding-portal-route.itest.js, onboarding-returns.itest.js, onboarding-wizard-link.itest.js, onboarding-workflow.itest.js, onboarding.itest.js` — **pass** (8 files / 208 tests)

## Tab / browser proof
docs/qa/BROWSER_QA_RESULTS.md row C (onboarding/profile chain) — dated 2026-08-01, stale but exists; e2e/tests/portal.spec.js also touches the invite flow.

## Recency
Not touched since the last audit (2026-11-17); zero commits anywhere since 2026-11-14.

## Open tasks (from the tracker)
- Stage 1 — todo
- Stage 2 — todo
- stage 3 — todo

## Reason for the label
Extensively built and tested (812 of 813 onboarding tests pass; node --check is clean on every backend file). The one failing test is a 4-night-running environment artifact (missing OCR language package), not a logic defect, so it does not make this `broken`. The real, specific gap is functional: SharePoint document storage for Stage 2 is confirmed absent by a repo-wide grep, and the dynamic-employee-contract work Stage 2 asks for is still open — genuinely unbuilt code, which is why this is `needs-refinement`.

## Disagreement with the tracker
Tracker "idea" stage vs. a very large, mostly-tested, already-permissioned workflow; separately, all three stage tasks remain todo (Letter of Offer preview/send flow, SharePoint storage for Stage 2, dynamic employee contract, Stage 3 undefined).
