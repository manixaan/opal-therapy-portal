# Report Templates

- Tracker stage: **idea**
- Tracker environment: **none**
- Evidence label: **tab-unproven**
- Addressed since the last audit (2026-11-17..2026-11-18): **no**
- Created (any located code): **yes**

## Located files
- backend/fca-routes.js (requireClinicalRead/Write per route)
- backend/letter-routes.js (requireClinicalRead/Write per route — covers Progress Letter)
- backend/templates-routes.js + backend/templates/service-agreement-map.js (Client Agreement Form generation)
- backend/service-agreements/templates/*.docx, *.pdf (shipped templates)

## Could not locate / notable gaps
- CLAUDE.md's repo map names backend/service-agreement-routes.js; that file does not exist in this checkout. Service agreements are actually generated through templates-routes.js + backend/templates/service-agreement-map.js. This is a documentation mismatch to report to whoever maintains CLAUDE.md, not a functional gap — out of scope for this audit to fix.

## Guard check
OK — requireClinicalRead/Write (admin excluded by design; fca-routes.js header documents this).

## Tests run
- unit: `templates-routes.test.js, templates-service-agreement-map.test.js, letter-template-map.test.js, templates-clinical-maps.test.js, templates-export-boundary.test.js, templates-appendices.test.js` — **pass** (6 files / 207 tests)
- unit: `fca-docx-engine.test.js, fca-frontend-helpers.test.js, fca-preview-lifecycle.test.js, fca-preview-pages.test.js, fca-resolve-scalars.test.js, fca-wizard-behaviour.test.js, letter-docx-engine.test.js, letter-frontend-helpers.test.js` — **pass** (8 files / 391 tests)
- integration: `templates.itest.js` — **pass** (1 file / 27 tests)

## Tab / browser proof
None found — no tab banner, no E2E spec, no browser QA entry names FCA/Letter/Agreement.

## Recency
Not touched since the last audit (2026-11-17); zero commits anywhere since 2026-11-14. For orientation, clinical letter template work landed back on 2026-11-07 (64e432f, 0561d91, 24aee93) — Support Letter and Progress Report masters, live preview — related subsystem, different document types from the three named tasks.

## Open tasks (from the tracker)
- FCA — todo
- Progress Letter — todo
- Client Agreement Form — todo

## Reason for the label
All three document types generate correctly and 625 backend tests pass — the gap is proof, not missing code: nobody has hand-checked a document through to a downloaded file, and no browser/E2E test covers any of the three flows. That is a tab/real-world proof gap, not an unbuilt feature, so this is `tab-unproven` rather than `needs-refinement`.

## Disagreement with the tracker
Tracker "idea" stage vs. an extensive, well-tested document-generation backend.
