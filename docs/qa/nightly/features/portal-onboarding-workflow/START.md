/opal-critical

## Idea
Portal Onboarding Workflow

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
All 11 onboarding-*-routes.js files (employee, workflow, journey, pack, returns, payroll, defaults, package-docs, assignment, library, onboarding-routes.js itself) plus ~37 supporting modules frontend/current/onboarding.js; ONBOARDING TAB banner at mockup_v3.html:4162 backend/onboarding-policies/ does NOT exist (no such directory) Stage mapping (from file-header comments): Stage 1 = onboarding-journey-routes.js. Stage 2 = onboarding-pack-routes.js, onboarding-returns-routes.js, onboarding-defaults-routes.js, onboarding-package-docs-routes.js. Stage 3 = onboarding-payroll-routes.js, onboarding-assignment-routes.js.

## Start here
Add SharePoint storage for Stage 2 onboarding documents in backend/onboarding-pack-db.js / backend/onboarding-library-routes.js, following the Graph-auth pattern already used in backend/outlook-oauth.js. Confirm the fixed-vs-dynamic contract field question with the practice owner first — backend/onboarding-contract-docx.js may already answer it. This is CRITICAL-level work (employee documents, a new external integration).

## Done means
An integration test in tests/integration/onboarding-pack.itest.js (or a new file) proving a Stage 2 document round-trips through SharePoint, reaching "proven" for Stage 2 specifically. Separately: install @tesseract.js-data/eng in the audit sandbox so onboarding-document-reader.test.js can give a trustworthy signal on future nights.

Tracker: 32b768b1-8bf3-40a6-9669-a8908922aa21
