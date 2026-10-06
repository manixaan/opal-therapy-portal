# Report Templates

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed this window (commits since 2026-10-04 touching its located files): **no** — zero commits have landed on `develop` under backend/ or frontend/current/ since the last audit (2026-10-04); the audited commit (`aacf8e68`) is still unchanged. This is the sixth consecutive reconfirmation night on this exact code. Tonight is not Sunday UTC, so targeted batches were run (not the complete suites) — see each section below for exactly what ran tonight.
- Created (any located code at all): **yes**

## Located files
- FCA: backend/fca-routes.js, backend/fca/ (client-search, data-layers, docx-engine, document-id, manifest, preview-pagination, resolve-scalars, template-map, templates/)
- Progress Letter: backend/letter-routes.js (reuses backend/fca/ helpers, no dedicated subdir; code's own name is 'Progress Note Letter')
- Client Agreement Form: no dedicated route file — served via backend/templates-routes.js + backend/templates/service-agreement-map.js, catalogue.js, compose.js, appendices.js and docx assets in backend/service-agreements/templates/ (code's own name is 'Service Agreement')

## Guard check
fca-routes.js: requireAuth + requireClinicalRead/requireClinicalWrite on every route. letter-routes.js: same pattern. templates-routes.js: requireAuth + its own requireTemplateRead/requireTemplateWrite (deliberately identical role split, per its header comment). No gaps.

## Tests run tonight
- unit: `fca-docx-engine, fca-frontend-helpers, fca-preview-lifecycle, fca-preview-pages, fca-resolve-scalars, fca-wizard-behaviour, letter-docx-engine, letter-frontend-helpers, letter-template-map, templates-appendices, templates-export-boundary, templates-frontend-guards, templates-routes, templates-service-agreement-map` — 569/569 pass
- integration: `fca-reports.itest.js, progress-note-letters.itest.js, templates.itest.js` — 126/126 pass (combined with the mobile-companion integration batch below)

## Open tasks (from the tracker)
- FCA — build, todo
- Progress Letter — build, todo
- Client Agreement Form — build, todo

## Compare with the tracker
Tracker stage "idea" with all three tasks todo, but FCA and Progress Letter are mature, heavily-tested systems. "Client Agreement Form" has no code under that name — it is served by the Service Agreement template; this part of the tracker may be unaware that need is already covered.
