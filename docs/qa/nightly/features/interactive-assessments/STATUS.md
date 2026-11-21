# Interactive Assessments

- Tracker stage: **idea**
- Tracker environment: **none**
- Evidence label: **tab-unproven**
- Addressed since the last audit (2026-11-20..2026-11-21): **no**
- Created (any located code): **yes**

## Located files
- backend/whodas-routes.js (requireClinicalRead/Write per route)
- backend/assessments-routes.js (requireClinicalRead/Write per route)

## Guard check
OK — requireClinicalRead/Write throughout, re-confirmed.

## Tests run
- unit: `assessment-catalogue.test.js, assessment-surface-guards.test.js, whodas-external-completion.test.js, whodas-frontend-guards.test.js, whodas-scoring.test.js, whodas-templates.test.js` — **pass** (6 files / 484 tests — re-run fresh tonight; the +2 vs last night's 482 comes from `assessment-surface-guards.test.js` picking up unrelated `?v=` asset-pin changes from tonight's calendar work, not an assessments change)
- integration: `assessments.itest.js, whodas.itest.js` — **pass** (2 files / 81 tests)

## Tab / browser proof
None found — no dedicated Assessment tab banner (re-confirmed tonight), no E2E, no browser QA entry.

## Recency
Not touched since the last audit (2026-11-20) — none of the 77 commits that landed in `backend/` or `frontend/current/` between 18:52 UTC 2026-11-20 and tonight's audit touched WHODAS/assessment code directly (that window was calendar/booking/travel/Splose-sync and invoicing/billing/Xero work only; the asset-pin guard test above moved only because it tracks a shared pin list).

## Open tasks (from the tracker)
- Assessment Review — todo

## Reason for the label
WHODAS 2.0 is fully built, guarded and tested (484 unit + 81 integration tests pass) — the only thing missing is a browser check proving the tab actually renders and works for a therapist; that is a tab-proof gap, not unbuilt functionality, so `tab-unproven` rather than `needs-refinement`. Unchanged from last night.

## Disagreement with the tracker
Tracker "idea" stage vs. WHODAS 2.0 already fully built and heavily tested.
