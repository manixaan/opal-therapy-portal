# Report Templates

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed in change window (2026-11-12 to 2026-11-13): no — see Interactive Assessments; same underlying work predates this window
- Created (any code located): yes, all three sub-tasks

## Located files

- "FCA" → `backend/fca-routes.js` (`/api/fca`)
- "Progress Letter" → `backend/letter-routes.js` (`/api/letters`)
- "Client Agreement Form" → not a standalone route file (CLAUDE.md's repo map entry for `backend/service-agreement-routes.js` is stale — re-confirmed tonight, that file does not exist). It is folded into `backend/templates-routes.js` + `backend/templates/service-agreement-map.js`, backed by real document assets in `backend/service-agreements/templates/`.
- Data access: `backend/templates/{catalogue,compose,document-model,export-boundary,pdf-export,appendices,progress-report-map,support-letter-map,service-agreement-map}.js`
- Frontend: no dedicated tab — embedded inside the Resource Hub's Library → Templates collection
- Unit tests: `templates-appendices/clinical-maps/export-boundary/frontend-guards/routes/service-agreement-map.test.js` (6 files), plus the FCA/letter test files shared with Interactive Assessments
- Integration tests: `templates.itest.js`, `fca-reports.itest.js`, `progress-note-letters.itest.js`
- E2E: none.

## Guard check

Re-confirmed tonight, unchanged. `templates-routes.js:113` — `requireAuth` router-level; header documents organisation-scoped and own-only. `fca-routes.js`/`letter-routes.js` as above.

## Tests run

- Unit: included in tonight's 21-suite/1107-test run shared with Interactive Assessments — **all pass** (see that feature's STATUS.md for a note on one transient worker-contention flake, not reproduced on retry)
- Integration: `templates.itest.js`, `fca-reports.itest.js`, `progress-note-letters.itest.js` — included in tonight's 239-test run (238 pass / 1 unrelated failure) — **pass**

## Open tasks from tracker

- "FCA", "Progress Letter", "Client Agreement Form" — all `todo`, no `explanation` or checklist recorded.

## Disagreement

CLAUDE.md's repository map (§2) still lists `backend/service-agreement-routes.js` as the home of service agreements; re-confirmed tonight that file does not exist. Report-only — not changed by this audit.

## Commits in window touching it

None this window.
