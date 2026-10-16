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
(none recorded)

## Where it lives today
The `backend/onboarding-*.js` family — Letter of Offer, document display,
the dynamic employee contract, and the induction stage are all built and
tested. SharePoint document storage for Stage 2 is the one real gap.

## Start here
Update the tracker's Stage 1/Stage 2 checklists first — several items
marked undone (editable preview, identical PDF/doc rendering, the dynamic
contract) are already built and tested, so the checklist is stale, not
the code. Then build SharePoint storage for Stage 2's finished onboarding
documents: look at how `backend/onboarding-pack.js` already publishes
documents (shipped file vs. placeholder) and add a SharePoint upload step
alongside it, following the Microsoft Graph pattern already used for
Outlook in `backend/outlook-oauth.js`.

## Done means
Stage 1/2 tracker checklists reflect what tests already prove, and a new
integration test shows a finished onboarding document landing in
SharePoint. Evidence label should reach `proven`.

Tracker: 32b768b1-8bf3-40a6-9669-a8908922aa21
