Feature: Interactive Assessments
Tracker stage: idea
Tracker environment: none
Evidence label: tab-unproven
Addressed in change window (2026-10-02 to 2026-10-16): no
Created (any located code): yes

## Located files
`backend/whodas-routes.js` (`router.use('/api/whodas', requireAuth)`,
plus a feature-flag gate `ENABLE_WHODAS_ASSESSMENT` ahead of auth),
`backend/assessments-routes.js` (`router.use('/api/assessments', requireAuth)`).
No dedicated "ASSESSMENTS TAB" banner exists in `mockup_v3.html` — this is
feature-flagged and reached from within a client profile, not a
standalone nav tab.

## Guard check
Pass.

## Tests run
- Unit: `whodas-external-completion`, `whodas-frontend-guards`,
  `whodas-scoring`, `whodas-templates`, `assessment-catalogue`,
  `assessment-surface-guards` → 6 suites / 481 tests, all PASS
- Integration (`DB_NAME=therapy_scheduler_audit`): `assessments.itest.js`,
  `whodas.itest.js` → both PASS

## Browser / E2E evidence
None found — no check opens a WHODAS assessment from a client profile in
a browser.

## Open tasks from tracker
- Assessment Review [todo] — this is a human content/licensing review
  job (deciding which of the many pending assessments to keep, sourcing
  originals), not a coding task, and correctly has no located code beyond
  WHODAS 2.0 itself.

## Commits in window touching this feature
None.

## Disagreement with tracker
None.
