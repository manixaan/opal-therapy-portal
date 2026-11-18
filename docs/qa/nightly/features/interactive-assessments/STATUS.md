# Interactive Assessments

- Tracker stage: **idea**
- Tracker environment: **none**
- Evidence label: **needs-refinement**
- Addressed in the 2026-11-04..2026-11-18 change window: **no**
- Created (any located code): **yes**

## Located files
- backend/whodas-routes.js (requireClinicalRead/Write per route)
- backend/assessments-routes.js (requireClinicalRead/Write per route)

## Guard check
OK — requireClinicalRead/Write throughout.

## Tests run
- unit: `assessment-catalogue.test.js, assessment-surface-guards.test.js, whodas-external-completion.test.js, whodas-frontend-guards.test.js, whodas-scoring.test.js, whodas-templates.test.js` — **pass** (6 files / 481 tests)
- integration: `assessments.itest.js, whodas.itest.js` — **pass** (2 files / 81 tests)

## Tab / browser proof
None found — no dedicated Assessment tab banner, no E2E, no browser QA entry.

## Recency
Not directly touched in-window.

## Open tasks (from the tracker)
- Assessment Review — todo

## Reason for the label
The one task (Assessment Review) is a human review/triage job and is todo; next_action ("open the WHODAS tab as a therapist... record a browser check") is open, even though WHODAS 2.0 is fully built, guarded and tested on the backend.

## Disagreement with the tracker
Tracker "idea" stage vs. WHODAS 2.0 already fully built and heavily tested.
