# Interactive Assessments

Tracker stage: idea · Tracker environment: none
Evidence label: **tab-unproven**
Addressed in this change window: **no** · Created: **yes**

## Located files

Routes: `backend/fca-routes.js`, `backend/whodas-routes.js`, `backend/assessments-routes.js`, `backend/letter-routes.js`. Directories: `backend/fca/` (client-search, manifest, data-layers, letter-blocks, docx-engine, templates), `backend/whodas/` (scoring, instrument, field-maps, templates), `backend/assessments/` (availability, share, definitions — cross-instrument catalogue layer). Frontend: not a shell tab — a standalone full-page overlay (`frontend/current/assessment.js/.css`), plus instrument-specific `fca.js/.css` and `whodas.js/.css`.

Guarded: `fca-routes.js`, `assessments-routes.js`, `letter-routes.js` each use `router.use('/api/<x>', requireAuth)` then gate every individual route with inline `requireClinicalRead`/`requireClinicalWrite` helpers (`CLINICAL_ROLES = {therapist, owner}`, admin excluded by design) — confirmed by direct inspection, every route carries one. `whodas-routes.js` additionally gates ahead of auth with a feature flag (`isWhodasAssessmentEnabled()`, returns 404 when off) before its own equivalent inline role check. No unguarded route found anywhere in this subsystem. No TODO/FIXME.

## Tests

- Unit (12 files): `assessment-catalogue.test.js`, `assessment-surface-guards.test.js`, `fca-wizard-behaviour.test.js`, `fca-frontend-helpers.test.js`, `fca-preview-lifecycle.test.js`, `fca-preview-pages.test.js`, `fca-resolve-scalars.test.js`, `fca-docx-engine.test.js`, `whodas-scoring.test.js`, `whodas-templates.test.js`, `whodas-frontend-guards.test.js`, `whodas-external-completion.test.js` — **738/738 pass**
- Integration (3 files): `assessments.itest.js`, `fca-reports.itest.js`, `whodas.itest.js` — **122/122 pass**

## Browser / E2E proof

**None found.** `e2e/tests/portal.spec.js` and `tutorials.spec.js` have zero matches for assessment/fca/whodas. `docs/qa/BROWSER_QA_RESULTS.md` has no relevant entry (one incidental "Assessment" hit is a results-table column header, unrelated). Nothing proves a user can open a client's Assessment Review overlay and complete an instrument in a real browser.

## Open tasks from the tracker

"Assessment Review" (todo, no further detail).

## Commits in the window touching this feature

One: `24aee93` (Support Letter and Progress Report masters), touching `backend/fca/` templates only — not the route files or `backend/whodas`/`backend/assessments`.

## Disagreement

None.
