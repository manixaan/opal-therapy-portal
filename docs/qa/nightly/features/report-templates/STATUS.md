# Report Templates

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed in this change window (2026-09-22 → 2026-09-23): no — zero commits landed in this window at all
- Created (any located code): yes — a large, well-hardened shared subsystem

## Located files

Covers all three tracker tasks (FCA, Progress Letter, Client Agreement Form — the last served as a "Service Agreement" template, not a standalone route file):

- Routes: `backend/fca-routes.js` (`/api/fca/*`), `backend/letter-routes.js` (`/api/letters/*`, Progress Note Letter), `backend/templates-routes.js` (`/api/templates/*` — generic Templates surface, includes the Service Agreement template id; **there is no `service-agreement-routes.js`**, that file does not exist)
- Shared engine: `backend/fca/docx-engine.js`, `manifest.js`, `resolve-scalars.js`, `template-map.js`, `letter-template-map.js`, `letter-blocks.js`, `data-layers.js`, `client-search.js`, `document-id.js`, `preview-pagination.js`, `backend/fca/templates/fca-v1.docx`, `progress-note-letter-v1.docx`
- Templates-specific: `backend/templates/catalogue.js`, `service-agreement-map.js`, `compose.js`, `document-model.js`, `export-boundary.js`, `appendices.js`, `pdf-export.js`; `backend/service-agreements/templates/*.docx`/`.pdf`
- Frontend: `frontend/current/fca.js`/`.css`, `letter.js`/`.css`, `templates.js`/`.css` — all mounted as hidden root `<div>`s (`#fca-root`, `#letter-root`, `#templates-root`) that are direct children of `<body>` in `mockup_v3.html`, entered via the Resource Hub → Library → Templates collection, **not** static `<!-- ============ TAB ============ -->` sections

## Guard check

All three route files apply `requireAuth` at the router level (`/api/fca`, `/api/letters`, `/api/templates`) before any handler runs, then layer a documented role split on top: therapist/owner may write, `read_only` may read, `admin` is excluded (clinical data). All three also document organisation isolation (cross-org access answers 404, not 403, "so as not to leak existence") and an own-only exception scoped specifically to **in-progress drafts** (finished/issued documents are org-wide visible) — this is the self-scoped exception applied narrowly, not to the whole file. No unguarded route found.

## Tests

- Unit (all pass): `fca-docx-engine.test.js`, `fca-frontend-helpers.test.js`, `fca-preview-lifecycle.test.js`, `fca-preview-pages.test.js`, `fca-resolve-scalars.test.js`, `fca-wizard-behaviour.test.js`, `letter-docx-engine.test.js`, `letter-frontend-helpers.test.js`, `letter-template-map.test.js`, `templates-appendices.test.js`, `templates-export-boundary.test.js`, `templates-frontend-guards.test.js`, `templates-routes.test.js`, `templates-service-agreement-map.test.js` (run together with the Assessments batch: 20 suites, 1050 tests, 0 failures)
- Integration (all pass): `fca-reports.itest.js`, `progress-note-letters.itest.js`, `templates.itest.js` (run together with the Assessments batch: 5 suites, 201 tests, 0 failures)
- Browser/E2E: **none.** Neither `e2e/tests/portal.spec.js` nor `tutorials.spec.js` mentions FCA, letters, agreements, or templates. `docs/qa/BROWSER_QA_RESULTS.md` has no mention of Report Templates anywhere (the only "Assessment" hit is an unrelated table header). This QA pass (2026-08-01) never exercised this feature area at all.

## Open tasks from the tracker

- "FCA", "Progress Letter", "Client Agreement Form" — all `status: todo`, no explanation/checklist recorded at the task level (this feature's detail lives in code/docs, not tracker notes).

## Commits in the window that touched it

None (2026-09-22 → 2026-09-23) — `develop` did not move since last night (both audits sit on
`74601fc`). Re-verified fresh anyway: unit (1050/1050, shared run with Interactive Assessments) and
integration (201/201, shared run) both re-run tonight with identical results to last night — no
regression.

## Disagreement

Tracker stage `idea` undersells a mature, actively-developed subsystem with a hardened engine and full unit/integration coverage. The real gap for the team is the complete absence of browser/E2E proof — worth prioritising given how much recent work has landed here.
