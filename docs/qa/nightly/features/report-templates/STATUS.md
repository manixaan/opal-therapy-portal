# Report Templates

- Tracker stage: **idea**
- Tracker environment: **none**
- Evidence label: **needs-refinement**
- Addressed in the 2026-11-04..2026-11-18 change window: **yes**
- Created (any located code): **yes**

## Located files
- backend/fca-routes.js (requireClinicalRead/Write per route)
- backend/letter-routes.js (requireClinicalRead/Write per route — covers Progress Letter)
- backend/templates-routes.js + backend/templates/service-agreement-map.js (Client Agreement Form generation)
- backend/service-agreements/templates/*.docx, *.pdf (shipped templates)

## Could not locate / notable gaps
- No standalone Client-Agreement/service-agreement signing page exists in frontend/current/ (CLAUDE.md's repo map names backend/service-agreement-routes.js and a sign page; neither exists in this checkout — agreements are generated via templates-routes.js only, no client-facing sign flow)

## Guard check
OK — requireClinicalRead/Write (admin excluded by design; fca-routes.js header documents this).

## Tests run
- unit: `templates-routes.test.js, templates-service-agreement-map.test.js, letter-template-map.test.js, templates-clinical-maps.test.js, templates-export-boundary.test.js, templates-appendices.test.js` — **pass** (6 files / 207 tests)
- unit: `fca-docx-engine.test.js, fca-frontend-helpers.test.js, fca-preview-lifecycle.test.js, fca-preview-pages.test.js, fca-resolve-scalars.test.js, fca-wizard-behaviour.test.js, letter-docx-engine.test.js, letter-frontend-helpers.test.js` — **pass** (8 files / 391 tests)
- integration: `templates.itest.js` — **pass** (1 file / 27 tests)

## Tab / browser proof
None found — no tab banner, no E2E spec, no browser QA entry names FCA/Letter/Agreement.

## Recency
Clinical letter template work landed in-window (64e432f, 0561d91, 24aee93) — Support Letter and Progress Report masters, live preview — related subsystem, different document types from the three named tasks.

## Open tasks (from the tracker)
- FCA — todo
- Progress Letter — todo
- Client Agreement Form — todo

## Reason for the label
All three tasks (FCA, Progress Letter, Client Agreement Form) are todo and the next_action ("run all three document flows by hand through to a downloaded file") is open, even though the generation code and 625 backend tests for it pass.

## Disagreement with the tracker
Tracker "idea" stage vs. an extensive, well-tested document-generation backend.
