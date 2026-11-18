/opal-critical

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
backend/whodas/ (scoring.js is unit-tested at 100%), backend/fca/, backend/assessments/;
whodas-routes.js, fca-routes.js, assessments-routes.js. All CRITICAL-level (clinical/assessment data),
well tested at the unit and integration level — the only gap is proving the tab in a browser.

## Start here
This is not primarily a coding task — the tracker's own next_action says "Get a browser check of
WHODAS 2.0 scoring for a real client." Open the WHODAS tab as a therapist with a real (or synthetic
staging) client, complete an instrument, and compare the displayed score against
backend/whodas/scoring.js's own test fixtures in backend/tests/whodas-scoring.test.js. Record the
result in docs/qa/BROWSER_QA_RESULTS.md so future nightly audits pick it up as tab coverage.

## Done means
A docs/qa/BROWSER_QA_RESULTS.md entry (or an e2e spec) exists proving the WHODAS tab scores correctly
for a real client. Evidence label should move to `proven` once that entry lands.

Tracker: f0210ee7-ed35-4228-a28c-d5d4c83da371
