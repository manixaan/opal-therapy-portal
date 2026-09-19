# Interactive Assessments

- Tracker stage: **idea** · Tracker environment: **none**
- Evidence label: **tab-unproven**
- Addressed since last audit (2026-09-17T18:21Z UTC): **no** (core untouched; see cross-feature note below)
- Created (any located code): **yes**

## Located files

- `backend/assessments-routes.js` + `backend/assessments/` (`availability.js`, `definitions.js`, `share.js`) — cross-instrument catalogue, per-client history, share-disclosure prep.
- `backend/whodas-routes.js` (feature-flagged behind `ENABLE_WHODAS_ASSESSMENT`) + `backend/whodas/` — the WHODAS 2.0 36-item digital assessment, server-scored.
- Frontend: `#assessment-root`, a dedicated full-page surface driven by `frontend/current/assessment.js` (`/assessment.js?v=3`) and `frontend/current/whodas.js` (`/whodas.js?v=5`).

`git log b6a8ad4..HEAD` shows **zero commits** touching `whodas-routes.js`, `backend/whodas/`, `assessments-routes.js`, `backend/assessments/`, `frontend/current/assessment.js` or `frontend/current/whodas.js` directly — this subsystem's own code is unchanged since last night.

## Cross-feature note

Commit `5b66e38` ("appendices on an FCA document — attach PDFs or completed WHODAS assessments") is new tonight and does reach into this feature's data, but from the *other* side: `backend/templates/appendices.js` and `templates-routes.js` (Report Templates) now let a therapist attach a completed WHODAS assessment as a lettered appendix on an FCA/other document. That code and its tests live entirely under `templates-routes.js`/`templates.itest.js`, not here — see the Report Templates STATUS.md. It is a new consumer of WHODAS data, not a change to the assessment engine itself, so it does not move this feature's evidence label.

## Guard check

`assessments-routes.js` and `whodas-routes.js` both still mount `router.use('/api/<x>', requireAuth)` plus local `requireClinicalRead`/`requireClinicalWrite` on every route. `whodas-routes.js` additionally 404s before auth if `ENABLE_WHODAS_ASSESSMENT` isn't `'true'`. No unguarded route found.

## Tests run

Re-run fresh tonight, no code changed here since the last audit:

- Unit (6 files: `assessment-catalogue`, `assessment-surface-guards`, `whodas-external-completion`, `whodas-frontend-guards`, `whodas-scoring`, `whodas-templates`) — **481/481 passed**. (`assessment-surface-guards.test.js` picked up a one-line pin/behaviour touch from `5b66e38`'s bundled changes but still passes clean.)
- Integration (2 files: `assessments.itest.js`, `whodas.itest.js`) — **81/81 passed**, first against the shared audit DB, confirmed again against a session-private database (`therapy_scheduler_qaaudit_assess`) to rule out the cross-session DB contention flagged mid-audit tonight — real clinician workflow, real templates, real scoring, real PDF, nothing stubbed, including golden-value scoring tests against the WHO's own workbooks.

No E2E spec and no `docs/qa/BROWSER_QA_RESULTS.md` entry covers the `#assessment-root` page rendering in a real browser.

**"Assessment Review"** — re-checked tonight, still no literal match anywhere in `backend/` or `frontend/current/`. The closest candidates remain the share/disclosure review step (`assessments-routes.js`) and the governance register's `reviewed_at`/`next_review_due` columns — neither is a feature called "Assessment Review."

No TODO/FIXME found in `assessments-routes.js` or `whodas-routes.js`.

## Disagreement

Tracker stage is idea; the assessment framework (WHODAS plus the generic multi-instrument scaffold) is fully built, guarded, and thoroughly tested including real WHO-workbook scoring golden tests, and is now also a data source for another feature's document appendices. "Assessment Review" as a task name still doesn't map to anything built.
