# Portal Onboarding Workflow

- Tracker stage: idea | Tracker environment: none
- Evidence label: **needs-refinement**
- Created: yes — 29 onboarding-*.js backend files, a standalone onboarding.html/.js frontend
- Addressed this window: no direct onboarding-*.js commits seen in the 14-day change list (heavy
  activity was in calendar/flights/case-notes/assist/inductions/templates instead)

## Located files
- Backend: onboarding-routes.js (29 guard refs) plus 28 other onboarding-*.js route/lib files
  (journey, pack, payroll, returns, wizard-link, workflow, etc.)
- Frontend: frontend/current/onboarding.js, onboarding.html (standalone page)

## Guard check
onboarding-routes.js: OK (29 requireAuth/requirePermission/requireRole references). node --check passes.

## Tests
- Unit: 27 suites run, 26 PASS / 1 FAIL — tests/onboarding-document-reader.test.js fails because
  `@tesseract.js-data/eng` (an OCR training-data package declared in package.json) is not present in
  this sandbox's node_modules. Confirmed environment/install gap, not an application defect — 653/654
  individual tests still pass. The hard limit against running `npm install` means this cannot be fixed
  from this audit; flagging for whoever maintains the environment's setup script.
- Integration: 10 suites / 218 tests — all PASS (DB_NAME=therapy_scheduler_audit). One WARN logged
  (ONBOARDING_ENCRYPTION_KEY not set, falls back to TOKEN_ENCRYPTION_KEY) — expected on this sandbox,
  not a test failure.
- Tab coverage: docs/qa/BROWSER_QA_RESULTS.md section C (onboarding/profile chain, 7/7 pass) and
  e2e/tests/portal.spec.js's invite-flow test both cover this.

## Open tasks (from tracker)
- "Stage 1" — todo
- "Stage 2" — todo
- "stage 3" — todo

## Commits in window touching this
None directly under backend/onboarding-*.js or frontend/current/onboarding*.js in the 14-day window.

## Disagreement
Tracker stage "idea" significantly understates reality — this is one of the most heavily built and
tested subsystems in the repository.
