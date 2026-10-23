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
`backend/whodas-routes.js`, `backend/assessments-routes.js`, `backend/fca-routes.js`; frontend `assessment.js`, `whodas.js`, `fca.js`.

## Start here
Sign in as a therapist, open a client's NDIS case, start a WHODAS 2.0 assessment (the only fully-configured one per the tracker), and complete it end to end — confirm it saves and scores. Copy the browser-QA style from `docs/qa/BROWSER_QA_RESULTS.md` row G/H for the checklist format. If it works, add either an E2E spec under `e2e/tests/` or a new row to `docs/qa/BROWSER_QA_RESULTS.md`.

## Done means
A browser or E2E check proves the assessment wizard renders and completes; evidence label reaches `proven`.

Tracker: f0210ee7-ed35-4228-a28c-d5d4c83da371
