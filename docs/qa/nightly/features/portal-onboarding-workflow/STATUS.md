# Portal Onboarding Workflow

- Tracker stage: idea | Tracker environment: none
- Evidence label: **needs-refinement**
- Created: yes — 29 onboarding-*.js backend files, a standalone onboarding.html/.js frontend
- Addressed this window: no — zero commits anywhere since 2026-11-15

## Located files
- Backend: onboarding-routes.js (29 guard refs) plus 28 other onboarding-*.js route/lib files
  (journey, pack, payroll, returns, wizard-link, workflow, etc.)
- Frontend: frontend/current/onboarding.js, onboarding.html (standalone page)

## Guard check
onboarding-routes.js: OK (29 requireAuth/requirePermission/requireRole references). `node --check`
passes (re-confirmed tonight across all of backend/*.js).

## Tests (re-run fresh tonight)
- Unit: 27 suites run, 26 PASS / 1 FAIL — tests/onboarding-document-reader.test.js fails because
  `@tesseract.js-data/eng` (an OCR training-data package declared in package.json) is not present in
  this sandbox's node_modules. Confirmed environment/install gap, not an application defect —
  653/654 individual tests still pass. The hard limit against running `npm install` means this
  cannot be fixed from this audit; flagging again for whoever maintains the environment's setup
  script.
- Integration: 10 suites / 232 tests — all PASS (DB_NAME=therapy_scheduler_audit_onb). Same WARN
  logged as last night (ONBOARDING_ENCRYPTION_KEY not set, falls back to TOKEN_ENCRYPTION_KEY) —
  expected on this sandbox, not a test failure.
- Tab coverage: docs/qa/BROWSER_QA_RESULTS.md section C (onboarding/profile chain) and
  e2e/tests/portal.spec.js's invite-flow test both cover this (confirmed unchanged tonight).

## Open tasks (from tracker)
- "Stage 1" — todo
- "Stage 2" — todo
- "stage 3" — todo

## Commits in window touching this
None.

## Disagreement
Tracker stage "idea" significantly understates reality — this is one of the most heavily built and
tested subsystems in the repository.

## Note
No change from the 2026-11-15 audit. Re-verified fresh tonight: same code, same tests (same single
known environment artifact), same result.
