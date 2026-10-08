# Report Templates

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed this window (commits since 2026-10-07 touching its located files): **no** — zero commits have landed
  on `develop` under `backend/` or `frontend/current/` since the last audit; audited commit `aacf8e68` unchanged.
  Eighth consecutive reconfirmation night.
- Created (any located code at all): **yes**

## Located files
- `backend/fca-routes.js`, `backend/letter-routes.js` (Progress Letter), `backend/templates-routes.js` + 
  `backend/templates/service-agreement-map.js` (the Client Agreement Form most plausibly maps to the existing
  Service Agreement template here — no code exists under the literal name "Client Agreement Form")
- Supporting: `backend/fca/`, `backend/templates/catalogue.js`
- Frontend: no `<!-- TAB -->` banner — reachable only via hidden entry points inside the Resource Hub
  (`#fca-hub-entry`, `#letter-hub-entry`, `#templates-root` in mockup_v3.html:5120-5152), rendered by
  `frontend/current/fca.js`, `letter.js`, `templates.js`

## Guard check
`fca-routes.js`, `letter-routes.js`, `templates-routes.js` all sit behind `requireAuth` plus
`requireClinicalRead`/`requireClinicalWrite` (fca/letters) or `requireTemplateRead`/`requireTemplateWrite`
(templates) on every route. No gaps found.

## Tests run tonight
- unit: `fca-docx-engine.test.js, fca-frontend-helpers.test.js, fca-preview-lifecycle.test.js,
  fca-preview-pages.test.js, fca-resolve-scalars.test.js, fca-wizard-behaviour.test.js, letter-docx-engine.test.js,
  letter-frontend-helpers.test.js, letter-template-map.test.js, templates-appendices.test.js,
  templates-export-boundary.test.js, templates-frontend-guards.test.js, templates-routes.test.js,
  templates-service-agreement-map.test.js` — 569/569 pass
- integration: `fca-reports.itest.js, progress-note-letters.itest.js, templates.itest.js` — 120/120 pass

## Open tasks (from the tracker)
- FCA — build, todo
- Progress Letter — build, todo
- Client Agreement Form — build, todo

## Compare with the tracker
None new. FCA and Progress Letter are built and heavily tested; "Client Agreement Form" still doesn't map to any
distinct code. The only real gap is proof the pages render in a browser — `docs/qa/BROWSER_QA_RESULTS.md`
(dated 2026-08-01) has no FCA/letter/templates flow, and no e2e spec names any of the three.
