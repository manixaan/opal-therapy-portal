/opal-critical

## Idea
Portal - Splose - Outlook | Integration Works

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
- backend/splose-sync-routes.js
- backend/travel-sync-routes.js
- backend/sync-settings-routes.js
- backend/calendar-routes.js
- backend/splose-link-routes.js

## Start here
Walk the Multi Calendar Rules checklist against the live portal: book a session, confirm the "changes saved but not synced" indicator, check travel-time calculation, and confirm Portal/Splose match in both directions. This is a verification pass (backend/splose-sync-routes.js and calendar-routes.js already pass 240 tests), not a build task.

## Done means
Each Multi Calendar Rules checklist item is manually confirmed against the live portal with no bug found; label becomes `proven`.

Tracker: eba1c6a7-3ba4-420f-acf4-1c5838991138
