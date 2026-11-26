# Report Templates

- Tracker stage: **idea**
- Tracker environment: **none**
- Evidence label: **tab-unproven**
- Addressed since the last audit (2026-11-25..2026-11-26): **no**
- Created (any located code): **yes**

## Located files
- backend/fca-routes.js (requireClinicalRead/Write per route)
- backend/letter-routes.js (requireClinicalRead/Write per route — covers Progress Letter)
- backend/templates-routes.js (requireTemplateRead/Write per route — more precise than last night's "requireAuth" note, still fully guarded) + backend/templates/service-agreement-map.js (Client Agreement Form generation)
- backend/service-agreements/templates/*.docx, *.pdf (shipped templates)

## Could not locate / notable gaps
CLAUDE.md's repo map names backend/service-agreement-routes.js; that file still does not exist in this checkout (re-confirmed tonight). Service agreements are actually generated through templates-routes.js + backend/templates/service-agreement-map.js. This is a documentation mismatch to report to whoever maintains CLAUDE.md, not a functional gap.

## Guard check
OK — requireClinicalRead/Write (fca/letter) and requireTemplateRead/Write (templates-routes.js), re-confirmed.

## Tests run
- unit: `templates-routes.test.js, templates-service-agreement-map.test.js, letter-template-map.test.js, templates-clinical-maps.test.js, templates-export-boundary.test.js, templates-appendices.test.js, templates-frontend-guards.test.js, fca-docx-engine.test.js, fca-frontend-helpers.test.js, fca-preview-lifecycle.test.js, fca-preview-pages.test.js, fca-resolve-scalars.test.js, fca-wizard-behaviour.test.js, letter-docx-engine.test.js, letter-frontend-helpers.test.js` — **pass** (15 files / 626 tests, re-run fresh tonight as a standalone batch). `fca-wizard-behaviour.test.js` stayed clean again tonight; no commit touched this file or FCA code tonight.
- integration: `templates.itest.js` — **pass** (1 file / 27 tests, re-run fresh tonight as part of an 18-file batch)

## Tab / browser proof
None found — no tab banner, no E2E spec, no browser QA entry names FCA/Letter/Agreement (re-confirmed by a fresh grep tonight).

## Recency
Not touched since the last audit. Ten commits landed elsewhere in the repo tonight (2026-11-26, see the brief's "What changed since last audit") — none touched this subsystem's files. Test counts unchanged: 626 unit, 27 integration, both re-run fresh tonight on their own.

## Open tasks (from the tracker)
- FCA — todo
- Progress Letter — todo
- Client Agreement Form — todo

## Reason for the label
All three document types generate correctly and 625 backend tests pass (re-confirmed fresh tonight) — the gap is proof, not missing code: nobody has hand-checked a document through to a downloaded file, and no browser/E2E test covers any of the three flows. Unchanged from last night.

## Disagreement with the tracker
Tracker "idea" stage vs. an extensive, well-tested document-generation backend.
