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
Re-tick the Stage 1/2 checklists against the running code in backend/onboarding-employee-routes.js and onboarding-pack-routes.js (most items are further along than the checklist shows), then add SharePoint storage for Stage 2 documents — confirmed absent by a repo-wide grep — as the tracker's next_action asks. Separately, whoever maintains the environment's setup script should install the missing @tesseract.js-data/eng OCR package so tests/onboarding-document-reader.test.js stops failing on a 4-night-running environment artifact; that is not a Claude Code session's job to fix.

## Done means
SharePoint storage for Stage 2 documents exists and the Stage 1/2 checklists are re-ticked against the running code; label becomes `proven` once a tab/browser check is also recorded.

Tracker: 32b768b1-8bf3-40a6-9669-a8908922aa21
