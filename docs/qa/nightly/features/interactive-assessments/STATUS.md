# Interactive Assessments

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Created (any code located): yes
- Addressed in this change window (2026-11-01 → 2026-11-02): no — no commits touched the located files

## Located files

- `backend/whodas-routes.js`, `backend/whodas/` (instrument, scoring, build-instrument-data, completed-pdf, template-registry, field-maps)
- `backend/assessments-routes.js`, `backend/assessments/` (availability.js, definitions.js, share.js) — the generic catalogue/sharing layer the "Assessment tab" sits on
- `frontend/current/whodas.js` / `whodas.css`, `frontend/current/assessment.js` / `assessment.css` (pinned `?v=5` / `?v=3`)
- No dedicated tab banner for the wizard itself (it is opened from a client record), but the Assessment catalogue/tab machinery is in `assessment.js`.

## Guard check

Both route files sit behind `router.use('/api/<feature>', requireAuth)` plus per-route `requireClinicalRead`/`requireClinicalWrite` (whodas) or `requireCatalogue`/`requireClinicalRead`/`requireClinicalWrite` (assessments). No unguarded route found.

## Tests

| Test | Result |
|---|---|
| `tests/whodas-external-completion.test.js`, `whodas-frontend-guards`, `whodas-scoring`, `whodas-templates` | pass (re-run 2026-11-02, unchanged) |
| `tests/assessment-catalogue.test.js` | pass (re-run 2026-11-02, unchanged) |
| `tests/integration/whodas.itest.js` (run alone) | pass — 53/53 (re-run 2026-11-02, unchanged) |
| `tests/integration/assessments.itest.js` (run alone) | pass — 28/28 (re-run 2026-11-02, unchanged) |

No E2E spec and no entry in `docs/qa/BROWSER_QA_RESULTS.md` names WHODAS or the Assessment tab — nothing proves the wizard completes end to end in a browser.

## Open tracker tasks

- Assessment Review — todo. This is a **human review task, not a coding task**: Ann is to go through every assessment listed in the Assessment tab, confirm WHODAS 2.0 is the only one fully configured, mark the rest keep/remove, and find original source material (and licensing, if needed) for anything kept, handing that to Anthony/Pauly to build later.

## Commits in window touching this feature

None.

## Disagreement note

None beyond what the tracker already says — stage `idea` understates a fully built, guarded, tested WHODAS engine, but the tracker's own existing note already says as much. The open task itself is correctly scoped as a human review job, not a build job.
