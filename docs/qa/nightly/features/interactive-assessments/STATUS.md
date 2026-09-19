# Interactive Assessments

- Tracker stage: **idea** · Tracker environment: **none**
- Evidence label: **tab-unproven**
- Addressed since last audit (2026-09-18T19:20Z UTC, commit `0726dde`): **no**
- Created (any located code): **yes**

## Located files

- `backend/assessments-routes.js` + `backend/assessments/` (`availability.js`, `definitions.js`,
  `share.js`).
- `backend/whodas-routes.js` (feature-flagged behind `ENABLE_WHODAS_ASSESSMENT`) + `backend/whodas/`.
- Frontend: `#assessment-root`, driven by `frontend/current/assessment.js` (`?v=3`) and
  `frontend/current/whodas.js` (`?v=5`).

`git log 0726dde..HEAD --oneline -- backend/assessments-routes.js backend/assessments
backend/whodas-routes.js backend/whodas frontend/current/assessment.js
frontend/current/whodas.js` — empty. This subsystem's own code is unchanged since last night; the
only nearby touch is the shared `theme.js` pin bump inside `assessment-surface-guards.test.js`,
unrelated to assessment pins.

## Guard check

`assessments-routes.js` and `whodas-routes.js` both mount `router.use('/api/<x>', requireAuth)`
plus local `requireClinicalRead`/`requireClinicalWrite` on every route. `whodas-routes.js`
additionally 404s before auth if `ENABLE_WHODAS_ASSESSMENT` isn't `'true'`. No unguarded route
found.

## Tests run

Re-run fresh tonight, no code changed here since last audit:

- Unit (6 files: `assessment-catalogue`, `assessment-surface-guards`,
  `whodas-external-completion`, `whodas-frontend-guards`, `whodas-scoring`, `whodas-templates`) —
  **PASS 481/481**.
- Integration (2 files: `assessments.itest.js`, `whodas.itest.js`),
  `DB_NAME=therapy_scheduler_n4c` — **PASS 81/81**.

No E2E spec and no `docs/qa/BROWSER_QA_RESULTS.md` entry covers the `#assessment-root` page
rendering in a real browser — unchanged tonight.

**"Assessment Review"** — re-checked tonight via repo-wide case-insensitive grep for
`assessment.{0,3}review` — zero matches. Still no literal match anywhere.

No TODO/FIXME found in `assessments-routes.js` or `whodas-routes.js`.

## Disagreement

Tracker stage is idea; the assessment framework (WHODAS plus the generic multi-instrument
scaffold) is fully built, guarded, and thoroughly tested including real WHO-workbook scoring
golden tests. "Assessment Review" as a task name still doesn't map to anything built.
