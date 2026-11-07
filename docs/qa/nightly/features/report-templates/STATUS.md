# Report Templates

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed in this change window: no
- Created (any located code): yes

## Located files
- backend/fca-routes.js, backend/fca/ (FCA report task)
- backend/letter-routes.js (Progress Letter task)
- backend/templates-routes.js, backend/service-agreements/templates/ (Client Agreement Form task, via Resource Hub -> Templates)
- mockup_v3.html: RESOURCES TAB (line 5120) hosts the Templates surface

## Not located
- No file literally named service-agreement-routes.js; the Client Agreement Form lives inside templates-routes.js's generic document-template engine (see tests/templates-service-agreement-map.test.js).

## Guard check
requireAuth on all three routers, plus an inline CLINICAL_ROLES = {'therapist','owner'} check (403 for anyone else) in fca-routes.js, letter-routes.js and templates-routes.js. No unguarded route found.

## Tests and results
- unit: 14 fca-/letter-/templates-* unit files — 569 passed
- integration: fca-reports.itest.js, progress-note-letters.itest.js, templates.itest.js — 120 passed

## Open tracker tasks
- FCA (todo)
- Progress Letter (todo)
- Client Agreement Form (todo)

## Commits in the 14-day change window touching this feature
Not touched in the 14-day change window.

## Why this label
689 tests (569 unit + 120 integration) pass across FCA, Progress Letter and Client Agreement Form generation, and the inline role guard is present everywhere. No E2E spec and no docs/qa/BROWSER_QA_RESULTS.md entry exercises the Resource Hub -> Templates screen itself, so nothing proves a user can actually open it and generate a document end-to-end in a browser.
