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

## Decisions
(none recorded)

## Where it lives today
`backend/whodas-routes.js` and `backend/assessments-routes.js`, both
guarded and heavily tested (690 unit + integration tests). Reached from a
client profile rather than a top-level tab, and behind
`ENABLE_WHODAS_ASSESSMENT`.

## Start here
Log in as a therapist, open a client profile in a browser, start a
WHODAS 2.0 assessment, complete it, and confirm it renders and scores
correctly. Add a Playwright spec or a `docs/qa/BROWSER_QA_RESULTS.md`
entry for it, following the existing pattern for other flows.

## Done means
One browser or E2E check proves a WHODAS assessment opens from a client
profile and scores correctly. Evidence label should reach `proven`.

Tracker: f0210ee7-ed35-4228-a28c-d5d4c83da371
