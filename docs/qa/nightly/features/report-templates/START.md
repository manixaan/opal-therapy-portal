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
(not yet written in the tracker)

## Where it lives today
- FCA: backend/fca-routes.js, backend/fca/ (client-search, data-layers, docx-engine, document-id, manifest, preview-pagination, resolve-scalars, template-map, templates/)
- Progress Letter: backend/letter-routes.js (reuses backend/fca/ helpers, no dedicated subdir; code's own name is 'Progress Note Letter')
- Client Agreement Form: no dedicated route file — served via backend/templates-routes.js + backend/templates/service-agreement-map.js, catalogue.js, compose.js, appendices.js and docx assets in backend/service-agreements/templates/ (code's own name is 'Service Agreement')

## Start here
Open backend/fca-routes.js, backend/letter-routes.js and backend/templates-routes.js, and the existing tests (fca-docx-engine.test.js etc.). All three document flows (FCA, Progress Letter, Client Agreement Form) are built, guarded and pass every test. Add one e2e spec or a docs/qa/BROWSER_QA_RESULTS.md entry per flow proving it renders in a browser, and resolve with the team whether "Client Agreement Form" is meant to be the existing Service Agreement template or something new.

## Done means
A passing e2e spec or BROWSER_QA_RESULTS.md entry for each of the three flows; the evidence label moves to `proven`.

Tracker: 91ae30e7-9cda-4198-956f-8b9cdf043003
