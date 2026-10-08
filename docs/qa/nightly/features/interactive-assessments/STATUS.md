# Interactive Assessments

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed this window: **no** — zero commits since 2026-10-07 touching `backend/` or `frontend/current/`.
  Eighth consecutive reconfirmation night.
- Created (any located code at all): **yes**

## Located files
- `backend/whodas-routes.js` — WHODAS 2.0 (36-item), feature-gated on `ENABLE_WHODAS_ASSESSMENT`
- `backend/assessments-routes.js` — the assessment framework (catalogue, per-client history, share prep);
  deliberately not feature-gated; confirms WHODAS 2.0 is the only implemented instrument today
- `backend/fca-routes.js`, `backend/letter-routes.js` (shared machinery, see Report Templates)
- `backend/whodas/`, `backend/fca/`, `backend/assessments/` — supporting modules
- Frontend: no tab banner — a dedicated full-page surface (`#assessment/record/:id`), rendered by
  `frontend/current/assessment.js`, loading `whodas.js`/`fca.js`/`letter.js` as instrument modules

## Guard check
`assessments-routes.js:62`: `router.use('/api/assessments', requireAuth);` + per-route
`requireCatalogue`/`requireClinicalRead`/`requireClinicalWrite`. `whodas-routes.js`: feature-flag gate, then
`requireAuth` + local `requireClinicalRead`/`requireClinicalWrite` on all 16 routes. No gaps found.

## Tests run tonight
- unit: `assessment-catalogue.test.js, assessment-surface-guards.test.js, whodas-external-completion.test.js,
  whodas-frontend-guards.test.js, whodas-scoring.test.js, whodas-templates.test.js` — 481/481 pass
- integration: `assessments.itest.js, whodas.itest.js` — 81/81 pass

## Open tasks (from the tracker)
- Assessment Review — build, todo (the tracker's own description: a human curation job — Ann reviewing which
  assessments to keep/remove — not a coding task)

## Compare with the tracker
None new. "Assessment Review" is Ann's human curation task, not code. WHODAS 2.0 and the assessment framework
are heavily tested but have never been proven in a browser — `docs/qa/BROWSER_QA_RESULTS.md` (dated 2026-08-01)
has no assessment/WHODAS/FCA flow, and no e2e spec names any of them.
