# Interactive Assessments

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed this window (commits since 2026-10-03 touching its located files): **no** — zero commits have landed on `develop` under backend/ or frontend/current/ since the last audit (2026-10-03); the audited commit (`aacf8e6`) is still unchanged. This is the fifth consecutive reconfirmation night on this exact code; tonight is the weekly Sunday deep run (complete `npm test` + `npm run test:integration`).
- Created (any located code at all): **yes**

## Located files
- backend/assessments-routes.js, assessments/{availability,definitions,share}.js
- backend/fca-routes.js, fca/{client-search,data-layers,document-id,docx-engine,letter-blocks,letter-template-map,manifest,preview-pagination,resolve-scalars,template-map,templates/}
- backend/whodas-routes.js, whodas/{build-instrument-data,completed-pdf,extract-templates,field-maps/,instrument-data.json,instrument.js,reference/,scoring.js,template-registry.js,templates/}
- Frontend: /assessment.js, /whodas.js, /fca.js; single mount point #assessment-root (mockup_v3.html:25349) — no dedicated "Review" tab markup

## Guard check
assessments-routes.js: requireAuth + requireCatalogue/requireClinicalRead/requireClinicalWrite on all 6 routes. fca-routes.js: requireAuth + requireClinicalRead/Write on all 13 routes. whodas-routes.js: requireAuth + requireClinicalRead/Write on all 17 routes. No gaps — this is clinical data and was checked carefully. Same hygiene note as Report Templates: requireClinicalRead/Write are defined locally per file rather than centrally in permissions.js.

## Tests and results
Unit (12 suites, all pass): assessment-catalogue, assessment-surface-guards, fca-docx-engine, fca-frontend-helpers, fca-preview-lifecycle, fca-preview-pages, fca-resolve-scalars, fca-wizard-behaviour, whodas-external-completion, whodas-frontend-guards, whodas-scoring, whodas-templates — reconfirmed tonight inside the full `npm test` deep run (all 144 files, one process), 938/938 clean, no parallel-load flake this time.
Integration: assessments.itest.js, fca-reports.itest.js, whodas.itest.js — reconfirmed tonight inside the full `npm run test:integration` deep run (all 62 files, one process, `--runInBand`), all passed. Identical to the last four nights.

## Open tasks (from the tracker)
- Assessment Review — build, todo

## Compare with the tracker
None — "Assessment Review" as a distinct second-party review/sign-off workflow genuinely has no code (controlled_instruments governance fields are about instrument licensing, not assessment review; WHODAS's /complete /void /amend are same-clinician lifecycle actions, not a review gate). The tracker is accurate that this specific task is untouched; it just doesn't separately flag that the surrounding FCA/WHODAS system is already mature.
