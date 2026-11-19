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

## Decision
(not yet written in the tracker)

## Where it lives today
- backend/onboarding-employee-routes.js
- backend/onboarding-workflow-routes.js
- backend/onboarding-journey-routes.js
- backend/onboarding-pack-routes.js
- backend/onboarding-package-docs-routes.js
- backend/onboarding-returns-routes.js
- backend/onboarding-defaults-routes.js
- backend/onboarding-assignment-routes.js
- backend/onboarding-library-routes.js
- backend/onboarding-routes.js
- frontend: ONBOARDING TAB banner + frontend/current/onboarding.js + standalone onboarding.html / onboarding-invite.html

## Start here
Re-tick the Stage 1/2 checklists in backend/onboarding-employee-routes.js and onboarding-pack-routes.js against the running code — most items are further along than the checklist shows — then add SharePoint storage for Stage 2 documents, confirmed absent by a repo-wide grep for the fifth night running.

## Done means
Stage 2 documents land in SharePoint and the checklist matches reality; the new path is covered by an integration test alongside the existing onboarding-pack.itest.js pattern.

Tracker: 32b768b1-8bf3-40a6-9669-a8908922aa21
