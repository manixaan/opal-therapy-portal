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
- backend/calendar-routes.js, backend/nf2f-routes.js, backend/travel-sync-routes.js, backend/splose-sync-routes.js, backend/sync-settings-routes.js, backend/splose-link-routes.js, backend/block-review-routes.js
- `PATCH /api/events/:dbId/notes` in backend/routes.js
- backend/travel-outlook-sync.js, backend/sync-preferences.js, backend/splose-api.js, backend/rich-notes.js, backend/block-review.js
- backend/billing/{calendar-travel-minutes,day-route,route-facts,travel-billing,nf2f-timer,trips}.js
- frontend: travel.js/.css, booking-route.js/.css, nf2f.js/.css, splose-sync.js/.css, sync-settings.js, block-review.js/.css, mockup_v3.html (calendar/booking panels, side panel, Sync popup)

## Start here
Walk the Multi Calendar Rules checklist against the live portal: book a session, confirm the "changes saved but not synced" indicator, check travel-time calculation, and confirm Portal/Splose match in both directions. This is a verification pass, not a build task — the subsystem grew hugely again overnight 2026-11-21 (calendar a11y/gesture/rendering polish, booking panel, travel-leg display/routing, NF2F timer, a redesigned one-button Sync popup with a "To check" tab, an Outlook-text-escaping security fix) and now passes 2,290 unit + 133 integration tests underneath it.

## Done means
Each Multi Calendar Rules checklist item is manually confirmed against the live portal with no bug found; label becomes `proven`.

Tracker: eba1c6a7-3ba4-420f-acf4-1c5838991138
