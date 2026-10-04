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
backend/resource-hub-r2-routes.js — pd_events CRUD, filter by topic/mode/cost/CPD hours, past-event rollover, admin endpoints, Home-page preview query frontend/current/resourcehub.js — renderPd/renderPdCard/renderPdDetail/renderPdForm, Home preview card, admin form, CPD-hours filter, route #resources/pd[/eventId] frontend/current/resourcehub.css — .rh2-pd* styles frontend/current/navigation.js — route encode/decode for #resources/pd

## Start here
Manually click through #resources/pd as a therapist and as an owner (create/edit a PD event, confirm the Home-page preview and CPD-hours filter work), then add a row to docs/qa/BROWSER_QA_RESULTS.md. No code change is obviously needed — this is a verification + tracker-hygiene task.

## Done means
A docs/qa/BROWSER_QA_RESULTS.md row confirming #resources/pd renders and works end to end, reaching "proven".

Tracker: 37f4e057-ae96-4a9e-a576-5f808b7dc8fb
