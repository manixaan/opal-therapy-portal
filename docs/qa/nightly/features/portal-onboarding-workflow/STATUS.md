# Portal Onboarding Workflow

- Tracker stage: **idea**
- Tracker environment: **none**
- Evidence label: **needs-refinement**
- Addressed since the last audit (2026-11-21..2026-11-22): **no**
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
OK — requireAuth + requirePermission('onboarding.*') per route throughout, re-confirmed file by file.

## Tests run
- unit: 25 `tests/onboarding-*.test.js` files run (excluding payroll/security, covered under Xero/cross-cutting): 24 passed, 1 FAILED — `tests/onboarding-document-reader.test.js`: "Cannot find module '@tesseract.js-data/eng/package.json'". This is the SAME environment/install artifact confirmed independently on 2026-11-15 through 2026-11-21 (eight nights running now); `@tesseract.js-data/eng` is declared in backend/package.json but genuinely absent from backend/node_modules in this sandbox (re-confirmed by a fresh `ls backend/node_modules` check tonight). Not fixable from inside this audit (no npm install). 604 other tests in the same run passed, identical to last night. — **fail (1 of 25 files, known environment artifact)** (604 pass / 1 fail)
- integration: `onboarding-defaults.itest.js, onboarding-journey.itest.js, onboarding-pack.itest.js, onboarding-portal-route.itest.js, onboarding-returns.itest.js, onboarding-wizard-link.itest.js, onboarding-workflow.itest.js, onboarding.itest.js` — **pass** (8 files / 208 tests; first attempt against the shared `DB_NAME=therapy_scheduler_audit` showed spurious failures from a sibling audit worker running its own integration suite against the same database name concurrently — a cross-process DB collision, not a code defect; a clean re-run on an isolated DB name gave 208/208)

## Tab / browser proof
docs/qa/BROWSER_QA_RESULTS.md row C (onboarding/profile chain) — dated 2026-08-01, stale but present; e2e/tests/portal.spec.js also touches the invite flow.

## Recency
Not touched since the last audit (2026-11-21 18:36 UTC) — none of tonight's 7 commits (calendar/booking/travel UI polish plus a Settings gear-icon swap) touched any onboarding file.

## Open tasks (from the tracker)
- Stage 1 — todo
- Stage 2 — todo
- stage 3 — todo

## Reason for the label
Extensively built and tested (812 of 813 onboarding tests pass across eight audit nights running). The one failing test is a known environment artifact (missing OCR language package), not a logic defect. The real, specific gap is functional: SharePoint document storage for Stage 2 is confirmed absent again tonight by a repo-wide grep, and the dynamic-employee-contract work Stage 2 asks for is still open — genuinely unbuilt code, which is why this stays `needs-refinement`.

## Disagreement with the tracker
Tracker "idea" stage vs. a very large, mostly-tested, already-permissioned workflow; separately, all three stage tasks remain todo (Letter of Offer preview/send flow, SharePoint storage for Stage 2, dynamic employee contract, Stage 3 undefined).
