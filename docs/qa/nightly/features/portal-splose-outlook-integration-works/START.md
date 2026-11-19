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
- backend/block-review-routes.js (new 2026-11-19 — `router.use('/api/block-review', requireAuth, denyReadOnly)`)
- backend/block-review.js, backend/sync-preferences.js, backend/rich-notes.js (new 2026-11-19 — logic/utility modules, no HTTP surface of their own)
- backend/billing/day-route.js, backend/billing/invoice-generation.js (billing route-planning logic this subsystem feeds, not route files)
- New endpoint `PATCH /api/events/:dbId/notes` added to backend/routes.js
- frontend: travel.js, booking-route.js, navigation.js, block-review.js, sync-settings.js, splose-sync.js, mockup_v3.html (calendar/booking panels, side panel, Sync popup)

## Start here
Walk the Multi Calendar Rules checklist against the live portal: book a session, confirm the "changes saved but not synced" indicator, check travel-time calculation, and confirm Portal/Splose match in both directions. This is a verification pass, not a build task — the subsystem grew substantially overnight (relocate-before-block booking, server-saved side-panel notes, a redesigned three-tab Sync popup, a new outside-events review queue) and now passes 456 unit + 126 integration tests underneath it.

## Done means
Each Multi Calendar Rules checklist item is manually confirmed against the live portal with no bug found; label becomes `proven`.

Tracker: eba1c6a7-3ba4-420f-acf4-1c5838991138
