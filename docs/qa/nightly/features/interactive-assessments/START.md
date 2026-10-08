/opal-feature

## Idea
Interactive Assessments

## Why
(not yet written in the tracker)

## Who uses it
(not yet written in the tracker)

## What they see
(not yet written in the tracker)

## What should happen
(not yet written in the tracker)

## Outcome
(not yet written in the tracker)

(No decisions recorded in the tracker.)

## Where it lives today
- `backend/whodas-routes.js`, `backend/assessments-routes.js`
- Frontend: the dedicated `#assessment/record/:id` page, `frontend/current/assessment.js` + `whodas.js`

## Start here
Add an e2e spec (`e2e/tests/assessment.spec.js`, following `e2e/tests/portal.spec.js`'s pattern) that completes
one WHODAS 2.0 flow end to end, and add a row to `docs/qa/BROWSER_QA_RESULTS.md`. e2e only runs under
`/opal-release` — write the spec, don't run the full e2e suite yourself. "Assessment Review" (sorting which
instruments to keep) is a separate human curation task for Ann, not something to build.

## Done means
A new e2e spec exercises the WHODAS 2.0 flow and a browser QA row exists for it. Existing suites
(`npx jest tests/whodas-scoring.test.js tests/assessment-catalogue.test.js`) stay green. Evidence label moves
from tab-unproven to proven once that browser/e2e proof lands.

Tracker: f0210ee7-ed35-4228-a28c-d5d4c83da371
