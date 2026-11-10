# Interactive Assessments

Tracker stage: idea · Tracker environment: none
Evidence label: **tab-unproven**
Addressed in this change window: **no** · Created: **yes**

## Located files

Routes: `backend/fca-routes.js`, `backend/whodas-routes.js`, `backend/assessments-routes.js`, `backend/letter-routes.js`. Directories: `backend/fca/`, `backend/whodas/`, `backend/assessments/`. Frontend: not a shell tab — a standalone full-page overlay (`frontend/current/assessment.js/.css`), plus `fca.js/.css` and `whodas.js/.css`.

Guarded, re-confirmed by direct grep tonight: `fca-routes.js` — 16 routes, all behind `router.use('/api/fca', requireAuth)` plus per-route `requireClinicalRead`/`requireClinicalWrite`. `assessments-routes.js` — 5 routes, all behind `router.use('/api/assessments', requireAuth)` plus `requireCatalogue`/`requireClinicalRead`/`requireClinicalWrite`. `letter-routes.js` — 11 routes, same pattern. `whodas-routes.js` — 16 routes, same pattern, plus a feature flag (`isWhodasAssessmentEnabled()`) gating ahead of auth. No unguarded route found anywhere in this subsystem.

## Tests

- Unit (12 files): `assessment-catalogue.test.js`, `assessment-surface-guards.test.js`, `fca-wizard-behaviour.test.js`, `fca-frontend-helpers.test.js`, `fca-preview-lifecycle.test.js`, `fca-preview-pages.test.js`, `fca-resolve-scalars.test.js`, `fca-docx-engine.test.js`, `whodas-scoring.test.js`, `whodas-templates.test.js`, `whodas-frontend-guards.test.js`, `whodas-external-completion.test.js` — **738/738 pass**, run tonight.
- Integration (3 files): `assessments.itest.js`, `fca-reports.itest.js`, `whodas.itest.js` — **122/122 pass**, run tonight on isolated DB `therapy_scheduler_audit_g1_test`. One expected WARN ("splose client list unavailable") during the FCA run is a fail-closed test fixture, not a failure.

## Browser / E2E proof

**None found.** `e2e/tests/portal.spec.js` and `tutorials.spec.js` have zero matches for assessment/fca/whodas. `docs/qa/BROWSER_QA_RESULTS.md` has no relevant entry. Nothing proves a user can open a client's Assessment Review overlay and complete an instrument in a real browser.

## Open tasks from the tracker

"Assessment Review" (todo, no further detail).

## Commits in the window touching this feature

None for this feature. `develop` moved from `34cf881` (last night's audit commit) to `40669e7` between the 2026-11-09 audit and tonight — one commit, "feat(booking): Travel block booking type …" — but it touches only the Smart Booking/calendar/profile surface (see `portal-splose-outlook-integration-works/STATUS.md` and `employee-personal-page-my-profile-tab/STATUS.md`), nothing located under this feature.

## Disagreement

None.
