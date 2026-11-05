# Interactive Assessments

- Tracker stage: idea · Tracker environment: none
- Evidence label: **tab-unproven** (re-confirmed 2026-11-05, unchanged)
- Addressed in this change window: no — zero commits since the 2026-11-04 audit's cutoff
- Created (any located code): **yes** — WHODAS 2.0 only

## Located files

- Backend: `backend/whodas-routes.js` (gated by `ENABLE_WHODAS_ASSESSMENT`, default **off** —
  `backend/feature-flags.js:87`), `backend/fca-routes.js`, `backend/assessments-routes.js`
  (catalogue/history framework), `backend/letter-routes.js`. Supporting: `backend/whodas/`,
  `backend/fca/`, `backend/assessments/definitions.js` + `availability.js`.
- Frontend: no standalone tab banner — embedded in the client-profile/Case Notes view
  (`mockup_v3.html:19536` `#cp-assessments` → `#whodas-root`). `whodas.js?v=5` renders nothing if
  the feature flag is off.
- Guards: all guarded — `requireAuth` + `requireClinicalRead`/`requireClinicalWrite` per route on
  WHODAS, FCA and the assessments catalogue.

## Tests and results

- Unit: 15 suites / 897 tests — **all pass** (whodas-*, fca-*, assessment-catalogue,
  assessment-surface-guards, letter-*).
- Integration: `whodas.itest.js`, `fca-reports.itest.js` — **pass**.
- No E2E coverage at all — `e2e/tests/` has only `portal.spec.js`/`tutorials.spec.js`, neither
  mentions whodas/fca/assessment. No browser QA entry (BROWSER_QA_RESULTS.md only has
  "Assessment" as a table column header, not an actual entry).

## Open tasks from the tracker

- "Assessment Review" — todo, a human review/sort task (keep/remove each assessment, source
  originals), not a coding task.

## Findings

Only WHODAS 2.0 has real built logic. `backend/assessments/definitions.js` lists five more
(`copm`, `moca`, `rudas`, `sensory-profile`, `mohost`) as explicit `REGISTER_ONLY` stubs —
no item wording or scoring held, by design, to avoid fabricating clinical instrument content.
This matches the tracker's own note exactly. Also worth a human decision: `ENABLE_WHODAS_ASSESSMENT`
defaults off, so even a fully proven WHODAS wizard would not appear to real users without that
flag being set in the relevant environment.
