/opal-feature

## Idea
Report Templates

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

(No idea/why/who/what-they-see/outcome text or decisions are recorded on the parent card or on any of its three sub-tasks — "FCA", "Progress Letter", "Client Agreement Form" — beyond their bare titles.)

## Where it lives today
`backend/fca-routes.js` (FCA), `backend/letter-routes.js` (Progress Letter), `backend/templates-routes.js` + `backend/templates/service-agreement-map.js` (Client Agreement Form — folded into the generic templates system, not a standalone route file). All three are built, guarded and heavily tested.

## Start here
Add a Playwright spec that opens the Resource Hub's Library → Templates collection, generates one document per sub-task (an FCA report, a Progress Letter, and a Client Agreement Form), and asserts each download/preview renders — then record it in `docs/qa/BROWSER_QA_RESULTS.md`. This is the single gap across all three sub-tasks; the backend for each is already solid.

## Done means
The Playwright spec above passes for all three document types and is recorded in `docs/qa/BROWSER_QA_RESULTS.md`. That moves this from `tab-unproven` to `proven`.

Tracker: 91ae30e7-9cda-4198-956f-8b9cdf043003
