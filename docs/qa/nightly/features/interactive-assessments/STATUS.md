# Interactive Assessments

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed in this change window: no
- Created (any located code): yes

## Located files
- backend/assessments-routes.js, backend/assessments/ (Assessment Review task)
- frontend/current/assessment.js, assessment.css (full-page assessment surface loaded globally, not a single '============ TAB' banner)

## Guard check
requireAuth on /api/assessments. No inline role restriction found beyond that; not flagged as unguarded since the surface is read/write on the caller's own assigned assessments only (see assessment-surface-guards.test.js).

## Tests and results
- unit: assessment-catalogue.test.js, assessment-surface-guards.test.js — 126 passed
- integration: assessments.itest.js — 28 passed

## Open tracker tasks
- Assessment Review (todo)

## Commits in the 14-day change window touching this feature
Not touched in the 14-day change window.

## Why this label
154 tests (126 unit + 28 integration) pass and the surface is guarded, but it is a full-page overlay rather than a portal tab, and nothing in e2e/tests/ or docs/qa/BROWSER_QA_RESULTS.md proves a user can open and complete an assessment in a real browser.
