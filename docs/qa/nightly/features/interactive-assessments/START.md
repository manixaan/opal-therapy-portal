/opal-critical

# Interactive Assessments

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
- backend/assessments-routes.js, backend/assessments/ (Assessment Review task)
- frontend/current/assessment.js, assessment.css (full-page assessment surface loaded globally, not a single '============ TAB' banner)

## Start here
Add a Playwright case that opens a client's Assessment Review from the client workspace, loads frontend/current/assessment.js's full-page surface, answers an instrument, and asserts the saved result. Copy the assessment-opening flow from backend/tests/assessment-surface-guards.test.js to see which endpoint triggers the overlay.

## Done means
A new e2e spec passes and a docs/qa/BROWSER_QA_RESULTS.md line is added, moving the label to proven.

Tracker: f0210ee7-ed35-4228-a28c-d5d4c83da371
