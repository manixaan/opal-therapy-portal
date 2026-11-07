/opal-critical

# Report Templates

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
(not yet written in the tracker)

## Where it lives today
- backend/fca-routes.js, backend/fca/ (FCA report task)
- backend/letter-routes.js (Progress Letter task)
- backend/templates-routes.js, backend/service-agreements/templates/ (Client Agreement Form task, via Resource Hub -> Templates)
- mockup_v3.html: RESOURCES TAB (line 5120) hosts the Templates surface

## Start here
Add a Playwright spec under e2e/tests/ that logs in as a therapist, opens the Resource Hub -> Templates surface (frontend/current/mockup_v3.html's RESOURCES TAB block), picks a client, generates an FCA report or progress letter, and asserts the resulting document download. Copy the login/role setup from e2e/tests/tutorials.spec.js.

## Done means
A new e2e/tests/*.spec.js case passes end-to-end and a line is added to docs/qa/BROWSER_QA_RESULTS.md, moving the label to proven.

Tracker: 91ae30e7-9cda-4198-956f-8b9cdf043003
