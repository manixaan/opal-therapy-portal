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

### Task notes — "Assessment Review" (verbatim from tracker)
"we've created a series of assessments inside the assessment TAB of which hudas 2.0 is the only one that has actually been currently configured there are heaps and heaps and heaps of other assessments that are pending or to be confirmed it is Anne's job to analyze and understand which ones to remove and to find the originals for the ones that we need to include and to try and provide those Originals intuition point for then Anthony or Pauly to then added into the portal as an interactive workflow"

## Where it lives today
`backend/fca-routes.js`, `whodas-routes.js`, `assessments-routes.js`, `letter-routes.js`; builder UIs render inside the Resource Hub's Library → Templates collection. FCA and the Progress Report/Support Letter templates are already built and heavily tested — **this is ahead of what the tracker notes above assume**, so Ann's "keep or remove" review should be told that FCA and the letter templates are not merely "pending", they're built and passing 1107+ tests between them.

## Start here
Add a Playwright spec (follow `e2e/tests/tutorials.spec.js` for the login/navigation pattern) that opens a client's Assessment Review overlay, picks an instrument (start with WHODAS, since the tracker already considers it done), completes it, and asserts the result saves — then record it in `docs/qa/BROWSER_QA_RESULTS.md`. This is the one gap on an otherwise very well-tested feature.

## Done means
The Playwright spec above passes and is recorded in `docs/qa/BROWSER_QA_RESULTS.md`. That moves this from `tab-unproven` to `proven`.

Tracker: f0210ee7-ed35-4228-a28c-d5d4c83da371
