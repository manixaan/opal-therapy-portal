# Report Templates

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed in change window (2026-10-29 to 2026-11-12): yes — see "Interactive Assessments" STATUS.md; same underlying `clinical-letter-templates` work covers both cards
- Created (any code located): yes, all three sub-tasks

## Located files

- "FCA" → `backend/fca-routes.js` (`/api/fca`)
- "Progress Letter" → `backend/letter-routes.js` (`/api/letters`)
- "Client Agreement Form" → **not** a standalone route file (CLAUDE.md's repo map entry for `backend/service-agreement-routes.js` is stale — confirmed directly, that file does not exist). It is folded into the generic templates system: `backend/templates-routes.js` + `backend/templates/service-agreement-map.js`, backed by real document assets in `backend/service-agreements/templates/` (`service-agreement-v2.2.docx`, `-fillable-v2.2.pdf`, etc.)
- Data access: `backend/templates/{catalogue,compose,document-model,export-boundary,pdf-export,appendices,progress-report-map,support-letter-map,service-agreement-map}.js`
- Frontend: no dedicated tab — embedded inside the Resource Hub's Library → Templates collection (same entry points as Interactive Assessments)
- Unit tests: `templates-appendices/clinical-maps/export-boundary/frontend-guards/routes/service-agreement-map.test.js` (6 files), plus the FCA/letter test files shared with Interactive Assessments
- Integration tests: `templates.itest.js`, `fca-reports.itest.js`, `progress-note-letters.itest.js`
- E2E: none.

## Guard check

Clean. `templates-routes.js:113` — `requireAuth` router-level; header documents organisation-scoped **and** own-only — self-scoped by design. `fca-routes.js` and `letter-routes.js` as described in Interactive Assessments' STATUS.md.

## Tests run

- Unit: included in the 21-suite/1107-test run shared with Interactive Assessments — **all pass**
- Integration: `templates.itest.js`, `fca-reports.itest.js`, `progress-note-letters.itest.js` — included in the 245-test run (244 pass / 1 unrelated failure) — **pass**

## Open tasks from tracker

- "FCA", "Progress Letter", "Client Agreement Form" — all `todo`, no `explanation` or checklist recorded on any of the three.

## Disagreement

CLAUDE.md's repository map (§2) lists `backend/service-agreement-routes.js` and `backend/service-agreements/` as the home of service agreements. The routes file **does not exist**; only the `service-agreements/templates/` document assets do, and the actual route logic lives in `templates-routes.js`. This is a stale repo-map entry worth a human fixing in CLAUDE.md (report-only from this audit — not changed here).

## Commits in window touching it

Shared with Interactive Assessments — the `clinical-letter-templates` merge and related template-engine commits.
