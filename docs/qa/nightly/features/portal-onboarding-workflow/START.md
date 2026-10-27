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
Stage 2 notes (verbatim from the tracker task): "Add finish the templated documents and upload to sharepoint as well as portal default packages under the edit onboarding tab... documents in stage 2 need to be finalised and uploaded both to the sharepoint and the portal (in portal under the default categories inside the edit onboarding). Check the workflow from stage 1 to 2 if the buttons all work... Also simplify UI where necessary."

## Where it lives today
Stage 1 (Letter of Offer): built and tested, unchanged. Stage 2 dynamic
contract: built and tested, unchanged. Stage 2/3 now run through the portal
as a real screen (release, invitation, induction, internal setup tasks,
Owner-only Activate) — built and tested as of tonight
(`backend/onboarding-journey-routes.js`, `onboarding-lifecycle.js`,
`onboarding-assignment-routes.js`). The record's own contract/position
description is a new, separate DB-backed store
(`backend/onboarding-record-documents.js`, migration 079) — **not
SharePoint**. SharePoint storage itself: still nothing.

## Start here
**First, tonight's new item:** run `cd backend && npx jest
tests/onboarding-document-reader.test.js` and confirm whether
`@tesseract.js-data/eng` is genuinely missing from the real (Azure)
deployment's `node_modules`, not just this sandbox's. If it's missing
there too, OCR document extraction is silently broken in production — fix
the dependency install, don't patch around it in code. If it's present in
the real deployment, this was sandbox-only noise and the next audit should
revert the evidence label to `needs-refinement`.

**Then, the unchanged gap:** literal SharePoint storage for finished
Stage 2 documents. Before writing code, confirm which integration method the
practice wants (Microsoft Graph API, same auth pattern as
`backend/outlook-oauth.js` / `backend/graph-identity.js`, or a simpler
webhook/manual-link approach) — and confirm with the team that this is still
wanted now that `onboarding-record-documents.js` and Clinical Resources' new
document library exist, since one of those may turn out to be the better
place to store these documents instead of actual SharePoint. Do not reuse
Clinical Resources' `resourcelibrary.js`/`resource-library-routes.js` without
that confirmation — it is "SharePoint-*style*" UI only, not a Microsoft
integration, and onboarding documents are employee-sensitive (CRITICAL
level), which the general resource library is not scoped for.

## Done means
A decision is recorded on where Stage 2 documents should actually live, and
(if SharePoint is still wanted) a new integration test proves a finalised
Stage 2 document reaches it and is linked back in the portal; evidence label
for Stage 2 reaches `proven`.

Tracker: 32b768b1-8bf3-40a6-9669-a8908922aa21
