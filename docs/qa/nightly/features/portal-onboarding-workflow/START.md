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
Two separate threads: (1) the environment is missing the @tesseract.js-data/eng OCR package that tests/onboarding-document-reader.test.js needs — that's an environment/install fix, not a code fix (see Technical detail in the brief). (2) Re-tick the Stage 1/2 checklists against the running code in backend/onboarding-employee-routes.js and onboarding-pack-routes.js, then add SharePoint storage for Stage 2 documents as the tracker's next_action asks.

## Done means
tests/onboarding-document-reader.test.js passes once the OCR language package is installed, and the Stage 1/2 checklists are re-ticked against the running code; label becomes `proven`.

Tracker: 32b768b1-8bf3-40a6-9669-a8908922aa21
