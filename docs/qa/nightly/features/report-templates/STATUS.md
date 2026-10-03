# Report Templates

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed this window (commits since 2026-10-02 touching its located files): **no** — zero commits have landed on `develop` under backend/ or frontend/current/ since the last audit (2026-10-02); the audited commit (`aacf8e6`) is still unchanged. This is the fourth consecutive reconfirmation night on this exact code.
- Created (any located code at all): **yes**

## Located files
- FCA: backend/fca-routes.js, backend/fca/ (client-search, data-layers, docx-engine, document-id, manifest, preview-pagination, resolve-scalars, template-map, templates/)
- Progress Letter: backend/letter-routes.js (reuses backend/fca/ helpers, no dedicated subdir)
- Client Agreement Form: NO dedicated route file exists — served via backend/templates-routes.js + backend/templates/service-agreement-map.js, catalogue.js, compose.js, appendices.js, and docx assets in backend/service-agreements/templates/
- Frontend: FCA wizard #fca-root, Progress Letter via letter.js — both overlays, not standalone tabs; no distinct "Client Agreement Form" UI found in mockup_v3.html

## Guard check
fca-routes.js: requireAuth + requireClinicalRead/requireClinicalWrite on every route. letter-routes.js: same pattern. templates-routes.js: requireAuth + requireTemplateRead/requireTemplateWrite. No gaps. Minor hygiene note: requireClinicalRead/Write are defined locally per route file rather than centrally in permissions.js — logic is consistent across files but duplicated, worth consolidating eventually.

## Tests and results
Unit (all pass): fca-docx-engine (43), fca-frontend-helpers (62), fca-preview-lifecycle (21), fca-preview-pages (32), fca-resolve-scalars (41), fca-wizard-behaviour (58), letter-docx-engine (39), letter-frontend-helpers (95), letter-template-map (25), templates-appendices (11), templates-export-boundary (64), templates-frontend-guards (26), templates-routes (34), templates-service-agreement-map (18) — re-run tonight, all pass, no flake this time (fca-wizard-behaviour ran clean, 58/58, in its own isolated batch, same as the clean re-runs on 2026-09-30 through 2026-10-02).
Integration: fca-reports.itest.js, progress-note-letters.itest.js, templates.itest.js — re-run tonight, all pass (part of a 201/201-passing batch alongside assessments.itest.js and whodas.itest.js). Identical to the last three nights.

## Open tasks (from the tracker)
- FCA — build, todo
- Progress Letter — build, todo
- Client Agreement Form — build, todo

## Compare with the tracker
Tracker stage "idea" with all three tasks todo, but FCA and Progress Letter are mature, heavily-tested systems. "Client Agreement Form" genuinely has no distinct code — this part of the tracker may just be unaware the Service Agreement template already serves this need.
