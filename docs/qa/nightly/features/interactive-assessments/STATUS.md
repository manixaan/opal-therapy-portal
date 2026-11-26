# Interactive Assessments

- Tracker stage: **idea**
- Tracker environment: **none**
- Evidence label: **tab-unproven**
- Addressed since the last audit (2026-11-25..2026-11-26): **no**
- Created (any located code): **yes**

## Located files
- backend/whodas-routes.js (requireClinicalRead/Write per route)
- backend/assessments-routes.js (requireClinicalRead/Write per route)

## Guard check
OK — requireClinicalRead/Write throughout, re-confirmed.

## Tests run
- unit: `assessment-catalogue.test.js, assessment-surface-guards.test.js, whodas-external-completion.test.js, whodas-frontend-guards.test.js, whodas-scoring.test.js, whodas-templates.test.js` — **pass** (6 files / 585 tests combined with the Employee Personal Page and Inductions batches run alongside tonight — re-run fresh, unchanged from last night). `assessment-surface-guards.test.js` is again the one file in this set touched tonight (six more cache-bust version-pin bumps, for the calendar/travel and snapshot changes elsewhere — not an assessment code change; `scripts/check-asset-pins.js` confirms every pin matches).
- integration: `assessments.itest.js, whodas.itest.js` — **pass** (2 files, part of a 193-test/10-file batch run fresh tonight alongside Xero, Report Templates and Inductions integration files)

## Tab / browser proof
None found — no dedicated Assessment tab banner (re-confirmed by a fresh grep tonight), no E2E, no browser QA entry.

## Recency
Not touched since the last audit. Ten commits landed elsewhere in the repo tonight (2026-11-26, see the brief's "What changed since last audit") — none touched this subsystem's own code; one shared frontend guard test it is listed under (`assessment-surface-guards.test.js`) was re-pinned again, for the night's calendar/travel-home-fit and snapshot version bumps.

## Open tasks (from the tracker)
- Assessment Review — todo

## Reason for the label
WHODAS 2.0 is fully built, guarded and tested (484 unit + 81 integration tests pass) — the only thing missing is a browser check proving the tab actually renders and works for a therapist; that is a tab-proof gap, not unbuilt functionality, so `tab-unproven` rather than `needs-refinement`. Unchanged from last night.

## Disagreement with the tracker
Tracker "idea" stage vs. WHODAS 2.0 already fully built and heavily tested.
