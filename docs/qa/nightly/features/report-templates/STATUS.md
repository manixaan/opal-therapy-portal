# Report Templates

- Tracker stage: **idea** · Tracker environment: **none**
- Evidence label: **tab-unproven**
- Addressed since last audit (2026-09-18T19:20Z UTC, commit `0726dde`): **no** — none of tonight's
  7 commits touch any FCA/letter/templates file
- Created (any located code): **yes**

## Located files

- **"FCA"** → `backend/fca-routes.js` + `backend/fca/` (`fca/templates/fca-v1.docx`). Overlay
  `#fca-root` (`/fca.js?v=5`).
- **"Progress Letter"** → `backend/letter-routes.js`. Overlay `#letter-root` (`/letter.js?v=2`).
- **"Client Agreement Form"** → still not the codebase's name for anything; the equivalent remains
  "Service Agreement" (`backend/templates-routes.js` / `backend/templates/service-agreement-map.js`).
- `backend/templates/appendices.js` — FCA/other document PDF/WHODAS appendices (unchanged tonight).

`git log 0726dde..HEAD --oneline -- backend/fca-routes.js backend/fca backend/letter-routes.js
backend/templates-routes.js backend/templates` — empty. Nothing touched Report Templates tonight.

## Guard check

All three route files mount `router.use('/api/<x>', requireAuth)` plus a per-route
clinical/template read-or-write guard (`requireClinicalRead`/`requireClinicalWrite` in
`fca-routes.js`/`letter-routes.js`, `requireTemplateRead`/`requireTemplateWrite` in
`templates-routes.js`, including the 4 appendix routes). No unguarded route found.

## Tests run

Re-run fresh tonight, no code changed here since last audit:

- Unit — 14 files, **PASS 563/563**: `fca-docx-engine`, `fca-frontend-helpers`,
  `fca-preview-lifecycle`, `fca-preview-pages`, `fca-resolve-scalars`, `fca-wizard-behaviour`,
  `letter-docx-engine`, `letter-frontend-helpers`, `letter-template-map`, `templates-appendices`,
  `templates-export-boundary`, `templates-routes`, `templates-service-agreement-map`,
  `templates-frontend-guards`.
- Integration — 3 files, `DB_NAME=therapy_scheduler_n4b DB_PASSWORD=audit npx jest --config
  jest.integration.config.js ... --runInBand`: `fca-reports.itest.js`, `templates.itest.js`,
  `progress-note-letters.itest.js` — **PASS 120/120**, no DB contention this run.

Both counts match last night exactly. No TODO/FIXME found in `fca-routes.js`, `letter-routes.js`,
`templates-routes.js`, `templates/appendices.js`.

### Is the coverage still earned for how much changed?

No new commits landed here tonight, so last night's finding stands unchanged: three of the
heaviest layout commits from two nights ago (`05b4376` footer geometry, `c09883c` logo-in-header,
`c4f124b` Anti-Bribery-and-Corruption-Standard sizing) still ship with **no test file changes at
all** and no browser/E2E check covers them either. `fca-preview-pages.test.js` still explicitly
renders with `renderHeaders: false`, so logo placement remains untestable in the current harness by
design.

## Disagreement

Tracker stage is idea; the report-generation engine (four document types, including appendices) is
fully built, RBAC-correct, org-isolated, and thoroughly tested at the API/content level for
everything except the three pure-geometry commits above. "Client Agreement Form" remains a naming
mismatch worth fixing in the tracker so future searches find "Service Agreement" instead.
