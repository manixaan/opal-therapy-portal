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
(not yet written in the tracker)

## Where it lives today
- backend/assessments-routes.js, assessments/{availability,definitions,share}.js
- backend/fca-routes.js, fca/ (as above)
- backend/whodas-routes.js, whodas/ (build-instrument-data, completed-pdf, extract-templates, field-maps/, instrument.js, scoring.js, template-registry.js, templates/)
- Frontend: single mount point #assessment-root; no dedicated "Review" tab markup exists

## Start here
Assessment Review (Ann sorting pending assessments into keep/remove) is a human curation task, not code. The one fully-configured instrument, WHODAS 2.0, passes 481/481 tests but has never been proven in a browser — add an e2e spec (e2e/tests/assessment.spec.js, following e2e/tests/portal.spec.js) that completes one WHODAS 2.0 flow end to end, and add a row to docs/qa/BROWSER_QA_RESULTS.md.

## Done means
A passing e2e spec or BROWSER_QA_RESULTS.md entry for the WHODAS 2.0 flow; the evidence label moves to `proven` for the assessment system (Assessment Review itself stays a human task, not a code label).

Tracker: f0210ee7-ed35-4228-a28c-d5d4c83da371
