# Report Templates

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed in change window (since last audit, 2026-10-22): no — zero commits in the window; develop is frozen at the commit audited last night
- Created (code exists): yes, for all three tasks

## Per-task breakdown

### FCA
- Located: `backend/fca-routes.js` + `fca.js`; guarded (`requireClinicalRead`/`requireClinicalWrite`).
- Tests: `fca-docx-engine.test.js`, `fca-frontend-helpers.test.js`, `fca-preview-lifecycle.test.js`, `fca-preview-pages.test.js`, `fca-resolve-scalars.test.js`, `fca-wizard-behaviour.test.js` (unit) — **all pass** (re-run tonight, 2026-10-23; `fca-wizard-behaviour.test.js` failed once on its debounce-timing test — "several rapid changes compose once" — when run in a 64-suite parallel batch, then passed cleanly, 58/58, when re-run alone; a CPU-contention flake, not a code regression — code is unchanged since last night); `tests/integration/fca-reports.itest.js` — **pass** (re-run tonight, 2026-10-23).
- Browser/E2E proof: none.

### Progress Letter
- Located: `backend/letter-routes.js` + `letter.js`; guarded identically.
- Tests: `letter-docx-engine.test.js`, `letter-frontend-helpers.test.js`, `letter-template-map.test.js` (unit) — **all pass** (re-run tonight, 2026-10-23); `tests/integration/progress-note-letters.itest.js` — **pass** (re-run tonight, 2026-10-23).
- Browser/E2E proof: none.

### Client Agreement Form
- **Not a standalone wizard** — implemented inside the generic Resource Hub → Templates system: `backend/templates-routes.js` + `templates.js`, mapped via `backend/templates/service-agreement-map.js`; guarded (`requireTemplateRead`/`requireTemplateWrite`).
- Tests: `templates-routes.test.js`, `templates-appendices.test.js`, `templates-export-boundary.test.js`, `templates-frontend-guards.test.js`, `templates-service-agreement-map.test.js` (unit) — **all pass** (re-run tonight, 2026-10-23); `tests/integration/templates.itest.js` — **pass** (re-run tonight, 2026-10-23).
- Browser/E2E proof: none.

No TODO/FIXME found in any of these route files.

## Open tasks from the tracker
"FCA", "Progress Letter", "Client Agreement Form" — all `todo`, no notes recorded on any.

## Commits in window that touched it
None.

## Disagreement
None against tracker stage. One internal note: the tracker treats "Client Agreement Form" as its own generator, but it actually lives inside the shared Templates system alongside other document templates — worth knowing before assigning separate work to it.
