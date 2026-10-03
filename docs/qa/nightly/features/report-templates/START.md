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
FCA: backend/fca-routes.js, backend/fca/ (client-search, data-layers, docx-engine, document-id, manifest, preview-pagination, resolve-scalars, template-map, templates/) Progress Letter: backend/letter-routes.js (reuses backend/fca/ helpers, no dedicated subdir) Client Agreement Form: NO dedicated route file exists — served via backend/templates-routes.js + backend/templates/service-agreement-map.js, catalogue.js, compose.js, appendices.js, and docx assets in backend/service-agreements/templates/ Frontend: FCA wizard #fca-root, Progress Letter via letter.js — both overlays, not standalone tabs; no distinct "Client Agreement Form" UI found in mockup_v3.html

## Start here
Before writing code: confirm with the card's author whether "Client Agreement Form" means the existing Service Agreement template (backend/templates/catalogue.js, id 'service_agreement') or something new. Then add an E2E spec or a docs/qa/BROWSER_QA_RESULTS.md entry proving the FCA wizard and Progress Letter actually render and produce a document end to end, following e2e/tests/portal.spec.js's pattern.

## Done means
A docs/qa/BROWSER_QA_RESULTS.md row (or E2E spec) confirming FCA and Progress Letter render and generate documents, plus a tracker answer on Client Agreement Form's scope.

Tracker: 91ae30e7-9cda-4198-956f-8b9cdf043003
