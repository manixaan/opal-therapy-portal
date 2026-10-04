/opal-fast-change

## Idea
Update Opal Docs Register

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
Nothing — and nothing should. This is an Excel register + SharePoint organising task. Checked backend/instrument-register-routes.js (a different domain — clinical instrument register), backend/register-routes.js (user signup, unrelated), backend/onboarding-package-docs-routes.js (closest conceptual match, a document-pack composer, not an Excel register), and docs/resource-hub/INGESTION_REGISTER.md (resource rights tracking, unrelated). No xlsx/exceljs/Excel-export code exists anywhere in the repo.

## Start here
No engineering task applies. Update the Excel register and SharePoint links directly, outside the portal.

## Done means
There is no test for this — it is done when the register and SharePoint links are updated. Evidence label stays `untouched` by design, not `proven`: nothing in this codebase will ever "prove" an external spreadsheet.

Tracker: 45c66127-e21b-47c5-be70-6c9c61952126
