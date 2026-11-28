# Interactive Assessments

Tracker stage: idea · Tracker environment: none
Evidence label: **tab-unproven**
Addressed since last audit (2026-11-26, commit `f5fc28d`): no — zero new commits
Created (any located code): yes

*Reconfirmed 2026-11-28:* independently re-ran all 6 unit suites (484/484
passed) and `whodas.itest.js` + `assessments.itest.js` (2 suites / 81 passed)
tonight. `node --check`: OK. No TODO/FIXME found.

## Located files

`backend/whodas-routes.js`, `backend/whodas/` (template registry etc.),
`backend/assessments-routes.js`. Frontend: no dedicated tab banner — mounted inline into the
client profile via `#whodas-root` / `WHODAS.mountSummary` (`mockup_v3.html:21409-21478`),
`whodas.js?v=5`, `whodas.css?v=3`. A `#fca-hub-entry` placeholder nearby suggests this is a
shared client-profile surface, not its own top-level tab.

## Guard check

Both files apply `router.use('/api/<x>', requireAuth)` then per-route
`requireClinicalRead`/`requireClinicalWrite`/`requireCatalogue`. Well guarded, no exceptions.

## Tests

- Unit: `whodas-external-completion.test.js`, `whodas-frontend-guards.test.js`,
  `whodas-scoring.test.js`, `whodas-templates.test.js`, `assessment-catalogue.test.js`,
  `assessment-surface-guards.test.js` — **6/6 suites, 484/484 tests passed**.
- Integration: `whodas.itest.js`, `assessments.itest.js` — both passed clean as part of a
  16-file shared batch (the batch's one failure was in an unrelated file, see Employee
  Personal Page / Automated Reminders notes).
- No E2E spec and no WHODAS/assessment mention anywhere in `docs/qa/BROWSER_QA_RESULTS.md`.
  Nobody has proven the tab renders for a therapist with a real client.

## Open tasks (from tracker)

- Assessment Review — todo. A human review/triage task: go through every assessment in the
  Assessment tab, confirm WHODAS 2.0 is the only fully-configured one, mark the rest
  pending/to-remove, and source originals for keepers. This doesn't gate whether WHODAS 2.0
  itself works — it's a separate catalogue-curation job.

## Commits since last audit (2026-11-26)

None touch `whodas-routes.js` or `assessments-routes.js`.

## Disagreement

None on stage. The gap is purely a missing browser/E2E proof — automated coverage is
otherwise complete.
