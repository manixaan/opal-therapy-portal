# Report Templates

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed in this change window (2026-09-23 → 2026-09-24): no — zero commits landed in this window at all
- Created (any located code): yes — a large, well-hardened shared subsystem

## Located files

Covers all three tracker tasks (FCA, Progress Letter, Client Agreement Form — the last served as a "Service Agreement" template, not a standalone route file):

- Routes: `backend/fca-routes.js` (`/api/fca/*`), `backend/letter-routes.js` (`/api/letters/*`), `backend/templates-routes.js` (`/api/templates/*` — generic surface, includes the Service Agreement template id). There is no `service-agreement-routes.js` — that file does not exist.
- Shared engine: `backend/fca/` (docx-engine.js, manifest.js, resolve-scalars.js, template-map.js, letter-template-map.js, letter-blocks.js, data-layers.js, client-search.js, document-id.js, preview-pagination.js, plus shipped `.docx` templates)
- Templates-specific: `backend/templates/` (catalogue.js, service-agreement-map.js, compose.js, document-model.js, export-boundary.js, appendices.js, pdf-export.js); `backend/service-agreements/templates/*`
- Frontend: `frontend/current/fca.js`/`.css`, `letter.js`/`.css`, `templates.js`/`.css` — entered via the Resource Hub → Library → Templates collection, not a static tab banner

## Guard check

All three route files apply `requireAuth` at the router level, then a documented role split: therapist/owner may write, `read_only` may read, `admin` is excluded (clinical data). All three document organisation isolation (cross-org access answers 404, not 403) and an own-only exception scoped specifically to in-progress drafts (finished/issued documents are org-wide visible). No unguarded route found.

## Tests (re-run fresh tonight)

- Unit: `fca-docx-engine.test.js`, `fca-frontend-helpers.test.js`, `fca-preview-lifecycle.test.js`, `fca-preview-pages.test.js`, `fca-resolve-scalars.test.js`, `fca-wizard-behaviour.test.js`, `letter-docx-engine.test.js`, `letter-frontend-helpers.test.js`, `letter-template-map.test.js`, `templates-appendices.test.js`, `templates-export-boundary.test.js`, `templates-frontend-guards.test.js`, `templates-routes.test.js`, `templates-service-agreement-map.test.js` — run standalone tonight (16 suites / 695 tests, effectively all pass; `fca-wizard-behaviour.test.js` showed 2 timing-based flakes when run concurrently under CPU contention with 15 other suites, but passed 58/58 when re-run in isolation — CPU-contention flakiness under this sandbox's load, not a regression, though the test's fragility under load is worth a note to the team).
- Integration: `fca-reports.itest.js`, `progress-note-letters.itest.js`, `templates.itest.js` — run tonight in the combined Xero+Report Templates+Assessments batch (8 suites / 232 tests, 0 failures).
- Browser/E2E: none. Neither e2e spec mentions FCA, letters, agreements, or templates. `docs/qa/BROWSER_QA_RESULTS.md` has no mention of Report Templates anywhere.

## Open tasks from the tracker

- "FCA", "Progress Letter", "Client Agreement Form" — all `status: todo`, no explanation/checklist recorded at the task level.

## Commits in the window that touched it

None — `develop` sits on `74601fc` again tonight. Re-verified fresh: unit and integration both re-run tonight with results consistent with prior nights — no regression.

## Disagreement

Tracker stage `idea` undersells a mature, actively-developed subsystem with a hardened engine and full unit/integration coverage. The real gap for the team is the complete absence of browser/E2E proof, worth prioritising given how much recent work has landed here.
