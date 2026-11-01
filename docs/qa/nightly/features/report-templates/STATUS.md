# Report Templates

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Created (any code located): yes
- Addressed in this change window (2026-10-18 → 2026-11-01): no — no commits touched the located files

## Located files

- `backend/fca-routes.js`, `backend/fca/` (docx-engine, template-map, resolve-scalars, client-search, document-id, preview-pagination, letter-blocks, template-map)
- `backend/letter-routes.js` (Progress Letter — document engine for the Opal progress-note letter)
- `backend/templates-routes.js`, `backend/templates/catalogue.js`, `backend/templates/service-agreement-map.js` (Client Agreement Form is the "Service Agreement" document type inside this generic document engine)
- `frontend/current/fca.js` / `fca.css`, `letter.js` / `letter.css`, `templates.js` / `templates.css` (pinned in `mockup_v3.html` at `?v=5`, `?v=2`, `?v=8` respectively)
- No dedicated top-level tab banner — these wizards are launched from modals/panels inside the NDIS Cases / Case Notes area, not their own tab.

## Guard check

All three route files sit behind `router.use('/api/<feature>', requireAuth)` plus a per-route clinical/template role middleware (`requireClinicalRead`/`requireClinicalWrite` for FCA and letters, `requireTemplateRead`/`requireTemplateWrite` for templates). No unguarded route found.

## Tests

| Test | Result |
|---|---|
| `tests/fca-docx-engine.test.js`, `fca-frontend-helpers`, `fca-preview-lifecycle`, `fca-preview-pages`, `fca-resolve-scalars`, `fca-wizard-behaviour` | pass |
| `tests/letter-docx-engine.test.js`, `letter-frontend-helpers`, `letter-template-map` | pass |
| `tests/templates-appendices.test.js`, `templates-export-boundary`, `templates-frontend-guards`, `templates-routes`, `templates-service-agreement-map` | pass |
| `tests/integration/fca-reports.itest.js` (run alone) | pass — 41/41 |
| `tests/integration/progress-note-letters.itest.js` (run alone) | pass — 55/55 |
| `tests/integration/templates.itest.js` (run alone) | pass — 24/24 |

No E2E spec and no entry in `docs/qa/BROWSER_QA_RESULTS.md` names FCA, Progress Letter or Client Agreement — nothing proves the wizard actually completes and produces a document in a browser.

## Open tracker tasks

- FCA — todo (no explanation/notes recorded)
- Progress Letter — todo (no explanation/notes recorded)
- Client Agreement Form — todo (no explanation/notes recorded)

## Commits in window touching this feature

None.

## Disagreement note

The tracker stage is `idea` with no idea/why/outcome text written, which understates how far this has come — the document-generation engine for all three templates is fully built, guarded and passing 120 unit tests plus 120 integration tests. The only real gap is a browser confirmation, not missing code.
