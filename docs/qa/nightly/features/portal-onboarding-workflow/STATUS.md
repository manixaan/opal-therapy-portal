# Portal Onboarding Workflow

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **proven**
- Addressed in this change window: no
- Created (any located code): yes

## Located files
- backend/onboarding-workflow-routes.js, backend/onboarding-routes.js and the other onboarding-*-routes.js files (Stage 1/2/3)
- frontend/current/onboarding.js
- mockup_v3.html: ONBOARDING TAB (line 4297)

## Guard check
requireAuth + requirePermission('onboarding.view' / 'onboarding.assign' / etc.) throughout — 'the first feature in the portal to use requirePermission' per the file's own header comment.

## Tests and results
- unit: onboarding-workflow-guards.test.js, onboarding-journey-frontend-guards.test.js (sampled from 27 onboarding unit files) — 203 passed
- integration: onboarding-workflow.itest.js, sync-settings.itest.js (sampled from 11 onboarding integration files) — 96 passed

## Open tracker tasks
- Stage 1 (todo)
- Stage 2 (todo)
- stage 3 (todo)

## Commits in the 14-day change window touching this feature
Not touched directly in the 14-day window, though it is adjacent to ongoing onboarding-payroll work (1fd6157 touched the AI gateway, not onboarding itself).

## Why this label
299 tests (203 unit + 96 integration) pass across the onboarding stages, every route is permission-gated, and docs/qa/BROWSER_QA_RESULTS.md entry C proves the new-therapist onboarding flow renders correctly end to end with the setup card tracking real state.
