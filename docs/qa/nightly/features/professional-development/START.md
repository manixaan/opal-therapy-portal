/opal-feature

## Idea
Professional Development

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
- backend/resource-hub-r2-routes.js — pd_events CRUD, filter by topic/mode/cost/CPD hours, past-event rollover, admin endpoints, Home-page preview query
- frontend/current/resourcehub.js — renderPd/renderPdCard/renderPdDetail/renderPdForm, Home preview card, admin form, CPD-hours filter, route #resources/pd[/eventId]
- frontend/current/navigation.js — route encode/decode for #resources/pd

## Start here
Open backend/resource-hub-r2-routes.js (pd_events) and frontend/current/resourcehub.js (renderPd*). The PD events catalogue — admin authoring, Home preview, CPD-hours filter — is built and passes 46/46 tests tonight. Add a browser/e2e check proving the tab renders, and ask the team to confirm this is what the tracker's blank "Professional Development" card means.

## Done means
A passing e2e spec or BROWSER_QA_RESULTS.md entry for the PD tab, and tracker confirmation of the match; the evidence label moves to `proven`.

Tracker: 37f4e057-ae96-4a9e-a576-5f808b7dc8fb
