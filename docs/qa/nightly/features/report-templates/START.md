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
`backend/fca-routes.js` + `backend/fca/` (FCA report), `backend/letter-routes.js`
(Progress Letter), `backend/templates-routes.js` + `backend/service-agreements/`
(Client Agreement Form / service agreement). All `requireAuth`-guarded, 689
unit + integration tests passing.

## Start here
Pick one document type (FCA is the most-tested, so start there), open a
client case in a browser, generate the document, and confirm the preview
and the downloaded file match. Follow the pattern `e2e/tests/portal.spec.js`
already uses for other flows to add a Playwright spec, or add an entry to
`docs/qa/BROWSER_QA_RESULTS.md` if a full E2E spec isn't the right scope
yet. Repeat for Progress Letter and the Client Agreement Form.

## Done means
One browser or E2E check per document type (FCA, Progress Letter, Client
Agreement Form) proving it renders and generates correctly for a real
case. Evidence label should reach `proven`.

Tracker: 91ae30e7-9cda-4198-956f-8b9cdf043003
