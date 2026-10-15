# Interactive Assessments

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed this window: no (no commits since 2026-09-27)
- Created at all: yes

## Located files

- Routes: `backend/whodas-routes.js`, `backend/assessments-routes.js`
  (`fca-routes.js` is a related report — see Report Templates).
- Data/logic: `backend/whodas/` (scoring.js, instrument.js,
  template-registry.js, field-maps, templates), `backend/assessments/`
  (definitions.js, availability.js, share.js).
- Frontend: not a `TAB` banner — it's a full-page overlay like FCA.
  `mockup_v3.html` loads `/whodas.js?v=5` then `/assessment.js?v=3`;
  `#assessment-root` is deliberately a direct child of `<body>`, not a tab.
- Tests: unit `assessment-catalogue.test.js`, `assessment-surface-guards.test.js`,
  `whodas-scoring.test.js`, `whodas-external-completion.test.js`,
  `whodas-templates.test.js`, `whodas-frontend-guards.test.js`; integration
  `assessments.itest.js`, `whodas.itest.js`.

## Guard status

`whodas-routes.js` → `requireAuth` + `CLINICAL_ROLES` role check
(therapist/owner/read_only). `assessments-routes.js` → same pattern. Both
properly guarded.

## Tests run

- `npx jest tests/assessment-catalogue.test.js tests/assessment-surface-guards.test.js tests/whodas-scoring.test.js tests/whodas-external-completion.test.js tests/whodas-templates.test.js` (run together with Report Templates' FCA/letter files) → 9 suites / 612 tests passed, 0 failed.
- `DB_NAME=therapy_scheduler_auditA DB_PASSWORD=audit npx jest --config jest.integration.config.js tests/integration/assessments.itest.js tests/integration/whodas.itest.js --runInBand` (run together with Report Templates' integration files) → 4 suites / 177 tests passed, 0 failed.
- No TODO/FIXME found in `whodas-routes.js`, `assessments-routes.js`,
  `assessments/definitions.js`, `assessments/availability.js`.

## Browser-QA gap

Neither `e2e/tests/portal.spec.js` nor `tutorials.spec.js` mentions
assessments/whodas/fca. `docs/qa/BROWSER_QA_RESULTS.md` did not exercise the
FCA wizard or WHODAS/assessment rendering. No browser evidence exists for
the assessment page actually opening.

## Open tasks from the tracker

- "Assessment Review" (todo) — a pure content-curation/licensing task for a
  human (deciding which of the other pending instruments to keep, sourcing
  originals), confirmed in code: `assessments/definitions.js`'s own header
  states availability is driven by source files on disk, and "no item
  wording appears in this file for ANY instrument" except WHODAS, which
  ships the WHO source PDFs. This does not itself represent an engineering
  gap for the WHODAS instrument that is already built.

## Commits in the window

None.

## Disagreement note

Confirms, with detail added, the previous `claude_update`: "extremely
thoroughly tested behind the scenes, but nothing proves the page opens in a
browser." Added detail: there is no "ASSESSMENTS TAB" banner at all — it's a
body-level full-page overlay, same architecture as the FCA wizard.
