# Interactive Assessments

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed in change window (since last audit, 2026-10-23): no — zero commits in the window; develop is frozen at the same commit audited last night
- Created (code exists): yes

## Located files
- Backend: `backend/whodas-routes.js`, `backend/assessments-routes.js`, `backend/fca-routes.js` (mounted in `server.js`).
- Frontend: `assessment.js`, `whodas.js`, `fca.js` (pinned with `?v=` in `mockup_v3.html`; lives alongside NDIS Cases/Case Notes, no separate "ASSESSMENT TAB" banner).

## Guard check
All routes behind `requireAuth` plus `requireClinicalRead`/`requireClinicalWrite`/`requireCatalogue` — solid, appropriate for clinical data.

## Tests and results
Unit: `assessment-catalogue.test.js`, `assessment-surface-guards.test.js`, `whodas-external-completion.test.js`, `whodas-frontend-guards.test.js`, `whodas-scoring.test.js`, `whodas-templates.test.js` — **pass** (re-run tonight, 2026-10-24).
Integration: `tests/integration/assessments.itest.js`, `whodas.itest.js` — **all pass** (re-run tonight, 2026-10-24).

**Browser/E2E proof for the assessment-taking wizard itself: none.** No `e2e/tests/*.spec.js` match; `docs/qa/BROWSER_QA_RESULTS.md` doesn't cover it (its closest entry, Flow I, only touches Leave/CPD/documents rendering).

No TODO/FIXME found.

## Open tasks from the tracker
"Assessment Review" (todo) — a human cataloguing task (keep/remove which assessments, source originals for WHODAS 2.0 and others), not a coding task.

## Commits in window that touched it
None.

## Disagreement
None against tracker stage. The gap matches the tracker's own next_action: nobody has opened the assessment wizard in a browser to confirm it completes end to end.
