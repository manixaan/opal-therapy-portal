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

## Where it lives today
FCA: `backend/fca-routes.js`. Progress Letter: `backend/letter-routes.js`. Client Agreement Form: `backend/templates-routes.js` + `templates/service-agreement-map.js` (part of the shared Templates system, not a standalone wizard).

## Start here
Open each generation wizard in a browser (FCA from a client's NDIS case, Progress Letter the same way, Client Agreement Form from the Resource Hub Templates area) and confirm each produces a document end to end. Add either an E2E spec per wizard under `e2e/tests/`, or a new row per wizard in `docs/qa/BROWSER_QA_RESULTS.md` — whichever matches how the team already tracks this (see row G/H style).

## Done means
A passing check proves each wizard renders and produces a document; evidence label reaches `proven`.

Tracker: 91ae30e7-9cda-4198-956f-8b9cdf043003
