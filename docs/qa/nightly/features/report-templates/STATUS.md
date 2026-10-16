Feature: Report Templates
Tracker stage: idea
Tracker environment: none
Evidence label: tab-unproven
Addressed in change window (2026-10-02 to 2026-10-16): no
Created (any located code): yes

## Located files
- FCA: `backend/fca-routes.js` (`router.use('/api/fca', requireAuth)`), `backend/fca/` engine
- Progress Letter: `backend/letter-routes.js` (`router.use('/api/letters', requireAuth)`)
- Client Agreement Form (= service agreement): `backend/templates-routes.js`
  (`router.use('/api/templates', requireAuth)`), `backend/service-agreements/templates/*.docx`
  masters, `backend/templates/service-agreement-map.js`
These are document-generation flows reached from within a client/case page,
not standalone nav tabs (no dedicated `TAB` banner in `mockup_v3.html`).

## Guard check
Pass. All three route groups sit behind `requireAuth` at the router level.

## Tests run
- Unit: `fca-docx-engine`, `fca-frontend-helpers`, `fca-preview-lifecycle`,
  `fca-preview-pages`, `fca-resolve-scalars`, `fca-wizard-behaviour`,
  `letter-docx-engine`, `letter-frontend-helpers`, `letter-template-map`,
  `templates-appendices`, `templates-export-boundary`,
  `templates-frontend-guards`, `templates-routes`,
  `templates-service-agreement-map` → 14 suites / 569 tests, all PASS
- Integration (`DB_NAME=therapy_scheduler_audit`): `fca-reports.itest.js`,
  `progress-note-letters.itest.js`, `templates.itest.js` → 3 suites / 120
  tests, all PASS

## Browser / E2E evidence
None found. No Playwright spec exercises FCA/letter/service-agreement
generation, and `docs/qa/BROWSER_QA_RESULTS.md` doesn't cover it either.

## Open tasks from tracker
- FCA [todo]
- Progress Letter [todo]
- Client Agreement Form [todo]

## Commits in window touching this feature
None.

## Disagreement with tracker
None. Tracker stage `idea` doesn't overclaim against the tab-unproven
evidence found underneath.
