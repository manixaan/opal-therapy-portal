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
(not yet written in the tracker)

## Where it lives today
backend/assessments-routes.js, assessments/{availability,definitions,share}.js backend/fca-routes.js, fca/{client-search,data-layers,document-id,docx-engine,letter-blocks,letter-template-map,manifest,preview-pagination,resolve-scalars,template-map,templates/} backend/whodas-routes.js, whodas/{build-instrument-data,completed-pdf,extract-templates,field-maps/,instrument-data.json,instrument.js,reference/,scoring.js,template-registry.js,templates/} Frontend: /assessment.js, /whodas.js, /fca.js; single mount point #assessment-root (mockup_v3.html:25349) — no dedicated "Review" tab markup

## Start here
Add an E2E spec (e2e/tests/assessment.spec.js, following e2e/tests/portal.spec.js) that completes one WHODAS 2.0 flow end to end, and add a row to docs/qa/BROWSER_QA_RESULTS.md. Note: E2E only runs under /opal-release, not from a feature task — write the spec, don't run the full E2E suite. "Assessment Review" itself needs a design decision first: who reviews a completed assessment, and what changes on approval/rejection.

## Done means
e2e/tests/assessment.spec.js passes under /opal-release, and a docs/qa/BROWSER_QA_RESULTS.md row confirms the assessment page renders — reaching "proven" for the core FCA/WHODAS system.

Tracker: f0210ee7-ed35-4228-a28c-d5d4c83da371
