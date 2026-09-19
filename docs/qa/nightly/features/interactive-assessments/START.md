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
(none recorded in the tracker)

## Where it lives today
`backend/assessments-routes.js` (generic framework) and `backend/whodas-routes.js` (WHODAS
2.0 instrument). Both fully tested against a real database, real scoring, real PDFs, and
now also readable as an appendix source from the Report Templates feature (`5b66e38`) —
that new code lives under `templates-routes.js`, not here.

## Start here
Two things to do:
1. Prove the `#assessment-root` page in a real browser — sign in as a therapist, start a
   WHODAS assessment on a client, complete and score it. Record the result in
   `docs/qa/BROWSER_QA_RESULTS.md` or as a Playwright spec.
2. Ask the practice what "Assessment Review" was meant to describe — no code or naming
   anywhere matches it; it may be an unwritten idea rather than something already started.

## Done means
A browser/E2E proof of the assessment page existing (raises the label to `proven`), and a
clarified `what_should_happen` for the "Assessment Review" task in the tracker.

Tracker: f0210ee7-ed35-4228-a28c-d5d4c83da371
