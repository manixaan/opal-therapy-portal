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
FCA/Progress Letter: `backend/fca-routes.js` + `backend/letter-routes.js`. Client Agreement Form: `backend/templates-routes.js` + `backend/service-agreements/templates/service-agreement-v2.2.docx`. Frontend: `frontend/current/templates.js`.

## Start here
Open each generation wizard in a browser as a therapist: FCA, Progress Letter, and the Client Agreement Form (via the Resources Library "Templates" collection entry point). Confirm each produces a downloadable document with the expected content filled in. Add a Playwright spec or a dated `docs/qa/BROWSER_QA_RESULTS.md` entry covering all three — this overlaps entirely with the Interactive Assessments card's FCA/letter work, so do them together.

## Done means
A browser or E2E check confirms each of the three wizards produces a document. Evidence label should move from `tab-unproven` to `proven`.

Tracker: 91ae30e7-9cda-4198-956f-8b9cdf043003
