# Interactive Assessments

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed in change window (since last audit, 2026-10-24): no — no commit this window touched `whodas-routes.js`, `assessments-routes.js`, `fca-routes.js` or their frontend files
- Created (code exists): yes

## Located files
- Backend: `backend/whodas-routes.js`, `backend/assessments-routes.js`, `backend/fca-routes.js` (mounted in `server.js`).
- Frontend: `assessment.js`, `whodas.js`, `fca.js` (pinned with `?v=` in `mockup_v3.html`; lives alongside NDIS Cases/Case Notes, no separate "ASSESSMENT TAB" banner).

## Guard check
All routes behind `requireAuth` plus `requireClinicalRead`/`requireClinicalWrite`/`requireCatalogue` — solid, appropriate for clinical data.

## Tests and results
Unit: `assessment-catalogue.test.js`, `assessment-surface-guards.test.js`, `whodas-external-completion.test.js`, `whodas-frontend-guards.test.js`, `whodas-scoring.test.js`, `whodas-templates.test.js` — **pass** (re-run tonight; `assessment-surface-guards.test.js` is also touched by tonight's resource/booking commits for their own asset pins — this feature's own assertions are unaffected).
Integration: `tests/integration/assessments.itest.js`, `whodas.itest.js` — **all pass** (re-run tonight).

**Browser/E2E proof for the assessment-taking wizard itself: none.** No `e2e/tests/*.spec.js` match; `docs/qa/BROWSER_QA_RESULTS.md` doesn't cover it (its closest entry, Flow I, only touches Leave/CPD/documents rendering).

No TODO/FIXME found.

## Open tasks from the tracker
"Assessment Review" (todo) — a human cataloguing task (keep/remove which assessments, source originals for WHODAS 2.0 and others), not a coding task.

## Commits in window that touched it
None — tonight's 8 commits touched none of this feature's route or frontend files.

## Disagreement
None against tracker stage. The gap matches the tracker's own next_action: nobody has opened the assessment wizard in a browser to confirm it completes end to end.

## Re-verified 2026-10-27
No commit since last night's audit (`896ace1`) touched this feature's files — the true window (`896ace1..41f45ed`) holds only Calendar sync-settings/Outlook/Splose work (see Portal - Splose - Outlook's folder). Re-ran the unit suite tonight (assessment-catalogue, assessment-surface-guards, fca-*, letter-*, whodas-*): 897/897 passed, same as last night. Evidence label unchanged.

## Re-verified 2026-10-28
Real window tonight is `41f45ed..15acf0c` (travel desk-work, place-names autocomplete,
a dependency patch — see the morning brief §6); none of it touches `whodas-routes.js`,
`assessments-routes.js`, `fca-routes.js` or their frontend. Re-ran
`assessment-catalogue`, `assessment-surface-guards`, `whodas-external-completion`,
`whodas-frontend-guards`, `whodas-scoring`, `whodas-templates` (unit, all pass) and
`assessments.itest.js`/`whodas.itest.js` (integration, both pass) tonight. Still no
browser/E2E proof the wizard completes. Evidence label unchanged.
