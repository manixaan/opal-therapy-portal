/opal-feature

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
- Stage 1: backend/onboarding-offer-letter.js, onboarding-offer-docx.js, onboarding-offer-pdf.js, onboarding-offer-template.js, onboarding-offer-email.js, onboarding-journey-routes.js, onboarding-defaults-routes.js, backend/graph-mail.js (real Microsoft Graph integration)
- Stage 2: backend/onboarding-pack-routes.js, onboarding-pack.js, onboarding-pack-db.js, onboarding-pack-email.js, backend/onboarding-contract-docx.js (the dynamic employee contract — fills OPAL_COE_* content controls from the SAME Stage-1 offer terms)
- Stage 3: backend/onboarding-induction.js, backend/onboarding-journey.js (projectInduction(), STAGE3_STATUSES), backend/onboarding-journey-routes.js
- Frontend: ONBOARDING TAB (mockup_v3.html:4162), frontend/current/onboarding-journey.js (all three stage panels, including the 'Edit onboarding' default-categories screen)

## Start here
Open backend/onboarding-contract-docx.js and backend/onboarding-pack-routes.js to see the Stage 2 pack flow that already works. The gap is SharePoint: there is no Graph /sites//drives/ call anywhere in the backend. Decide which SharePoint site/library documents should land in, add an upload step to the pack-finalise path (mirror the real Graph calls already in backend/graph-mail.js), and add an integration test asserting the upload fires with the right document and site.

## Done means
A new passing integration test proving the SharePoint upload happens on Stage 2 pack finalisation; the evidence label moves to `proven`.

Tracker: 32b768b1-8bf3-40a6-9669-a8908922aa21
