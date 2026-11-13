# Interactive Assessments

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed in change window (2026-11-12 to 2026-11-13): no — zero commits since the 2026-11-12 audit. The `clinical-letter-templates` merge and FCA/progress-report/case-note induction packs predate this window.
- Created (any code located): yes, extensively

## Located files

- Routes: `backend/fca-routes.js` (`/api/fca`), `backend/whodas-routes.js` (`/api/whodas`), `backend/assessments-routes.js` (`/api/assessments`), `backend/letter-routes.js` (`/api/letters`)
- Data access: `backend/fca/`, `backend/whodas/` directories, plus inline SQL
- Frontend: `frontend/current/assessment.js`, `fca.js`, `whodas.js`, `letter.js` — no standalone `ASSESSMENT TAB` banner; render as builder entry points inside the `RESOURCES TAB`'s Library → Templates collection (confirmed again at `mockup_v3.html:5331-5339`)
- Unit tests (15 files): `assessment-catalogue.test.js`, `assessment-surface-guards.test.js`, `fca-docx-engine/frontend-helpers/preview-lifecycle/preview-pages/resolve-scalars/wizard-behaviour.test.js`, `letter-docx-engine/frontend-helpers/template-map.test.js`, `whodas-external-completion/frontend-guards/scoring/templates.test.js`
- Integration tests: `assessments.itest.js`, `fca-reports.itest.js`, `progress-note-letters.itest.js`, `whodas.itest.js`
- E2E: none.

## Guard check

Re-confirmed tonight, unchanged. All four routers carry `requireAuth` at the router level (`fca-routes.js:161`, `whodas-routes.js:99`, `assessments-routes.js:62`, `letter-routes.js:166`). `fca-routes.js` and `letter-routes.js` document own-drafts-only scoping in their file headers — self-scoped by design.

## Tests run

- Unit: 21 suites, 1107 tests — **all pass** on two of this audit's three runs tonight. One run showed `fca-wizard-behaviour.test.js` fail a single `toBeCloseTo` scroll-offset assertion (1106/1107) when run alongside the full 21-file group under parallel workers; running that file alone, and re-running the full group twice more, both times produced 1107/1107. This is a timing-sensitive flake under worker contention, not a code regression — logged here for transparency, not scored as `broken`.
- Integration: `assessments.itest.js`, `fca-reports.itest.js`, `progress-note-letters.itest.js`, `whodas.itest.js` — re-run tonight, all 4 included in a 239-test run (238 pass / 1 unrelated root-sandbox artifact — see `employee-personal-page-my-profile-tab/STATUS.md`) — **pass**

## Open tasks from tracker

- "Assessment Review" — `todo`. A manual review/triage task for Ann — not a coding task.

## Disagreement — tracker is behind the evidence

Unchanged: the tracker's notes say only WHODAS 2.0 is configured. FCA and the Progress Report / Support Letter templates are, re-confirmed tonight, just as built and tested as WHODAS.

## Why tab-unproven, not proven

Unchanged — no E2E spec and no `docs/qa/BROWSER_QA_RESULTS.md` entry exists for completing an instrument in a real browser.

## Commits in window touching it

None this window.
