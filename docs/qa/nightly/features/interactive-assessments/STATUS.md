# Interactive Assessments

- Tracker stage: **idea**
- Tracker environment: **none**
- Evidence label: **tab-unproven**
- Addressed since the last audit (2026-11-21..2026-11-22): **no**
- Created (any located code): **yes**

## Located files
- backend/whodas-routes.js (requireClinicalRead/Write per route)
- backend/assessments-routes.js (requireClinicalRead/Write per route)

## Guard check
OK — requireClinicalRead/Write throughout, re-confirmed.

## Tests run
- unit: `assessment-catalogue.test.js, assessment-surface-guards.test.js, whodas-external-completion.test.js, whodas-frontend-guards.test.js, whodas-scoring.test.js, whodas-templates.test.js` — **pass** (6 files / 484 tests — re-run fresh tonight, unchanged from last night)
- integration: `assessments.itest.js, whodas.itest.js` — **pass** (2 files / 81 tests)

## Tab / browser proof
None found — no dedicated Assessment tab banner (re-confirmed tonight), no E2E, no browser QA entry.

## Recency
Not touched since the last audit (2026-11-21 18:36 UTC) — none of tonight's 7 commits (calendar/booking/travel UI polish plus a Settings gear-icon swap) touched WHODAS/assessment code.

## Open tasks (from the tracker)
- Assessment Review — todo

## Reason for the label
WHODAS 2.0 is fully built, guarded and tested (484 unit + 81 integration tests pass) — the only thing missing is a browser check proving the tab actually renders and works for a therapist; that is a tab-proof gap, not unbuilt functionality, so `tab-unproven` rather than `needs-refinement`. Unchanged from last night.

## Disagreement with the tracker
Tracker "idea" stage vs. WHODAS 2.0 already fully built and heavily tested.
