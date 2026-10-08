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

(No decisions recorded in the tracker.)

## Where it lives today
- `backend/onboarding-journey-routes.js` (Stage 1), `backend/onboarding-pack-routes.js` (Stage 2),
  `backend/onboarding-induction.js` (Stage 3), `backend/onboarding-defaults-routes.js` ("Edit Onboarding" tab)
- Frontend: ONBOARDING TAB in `mockup_v3.html`, `frontend/current/onboarding-journey.js`

## Start here
Add SharePoint document storage to Stage 2's pack-finalise step in `backend/onboarding-pack-routes.js` /
`backend/onboarding-pack-db.js`. Confirm which SharePoint site/library documents should land in with the practice
owner before building — there is no existing Graph/SharePoint client in this repo to copy from, only a CSP
allowlist entry for Office Online embedding. Stage 1 and Stage 3 need no further build work; this is purely the
Stage 2 SharePoint half.

## Done means
Finished Stage 2 onboarding documents land in both the agreed SharePoint location and the portal's own storage,
with a new or extended integration test in `tests/integration/onboarding-pack.itest.js` exercising the
SharePoint write path, and `npx jest --config jest.integration.config.js tests/integration/onboarding-pack.itest.js
--runInBand` passing. Evidence label moves from needs-refinement to proven once this lands and is verified.

Tracker: 32b768b1-8bf3-40a6-9669-a8908922aa21
