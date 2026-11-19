# Portal - Splose - Outlook | Integration Works

- Tracker stage: **idea**
- Tracker environment: **none**
- Evidence label: **needs-refinement**
- Addressed since the last audit (2026-11-18..2026-11-19): **yes**
- Created (any located code): **yes**

## Located files
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

## Guard check
OK — every route file guarded (`requireAuth` + `requireRole`/`requirePermission`/`denyReadOnly` as appropriate), unchanged from last night plus the new `block-review-routes.js`, confirmed guarded the same way. The new `PATCH /api/events/:dbId/notes` endpoint is `requireAuth` + an inline role check (blocks `read_only`/`pre_employee`) + SQL scoped `WHERE id = $1 AND user_id = $2` — self-scoped by design, the same convention as `snapshot-routes.js`, not a missing guard.

## Tests run
- unit (12 pre-existing files): `outlook-delta-preserve.test.js, outlook-mirror.test.js, splose-alert-dialog.test.js, splose-api-queue.test.js, splose-auto-sync-reset.test.js, splose-credentials.test.js, splose-draft-sync.test.js, splose-link-routes.test.js, splose-match.test.js, splose-poller.test.js, travel-outlook-sync.test.js, travel-sync-routes.test.js` — **pass** (12 files / 156 tests)
- unit (7 files new/changed by tonight's commits): `smart-booking-route.test.js, event-drawer-consistency.test.js, booking-panel-fresh.test.js, rich-notes.test.js, billing-engine.test.js, block-review.test.js, sync-preferences.test.js` — **pass** (7 files / 300 tests)
- unit (8 guard/asset-pin files, confirms tonight's `?v=` bumps for travel.js and booking-route.js were done correctly): `frontend-stage3-guards.test.js, assign-learning-guards.test.js, nf2f-frontend.test.js, onboarding-journey-frontend-guards.test.js, templates-frontend-guards.test.js, travel-physical-route.test.js, travel-traffic.test.js, assessment-surface-guards.test.js` — **pass** (8 files / 656 tests; some of these files are also exercised separately under other features' own test batches — not a separate defect count, just the same shared guard file run from two angles tonight)
- integration (12 files): `calendar-category-colours.itest.js, calendar-local-first.itest.js, outlook-claim.itest.js, outlook-delta-preserve.itest.js, splose-connection.itest.js, splose-draft-sync.itest.js, splose-link-ignore.itest.js, sync-settings.itest.js, travel-outlook-sync.itest.js, event-notes.itest.js, block-review.itest.js, invoicing.itest.js` — **pass** (12 files / 126 tests)

## Tab / browser proof
docs/qa/BROWSER_QA_RESULTS.md rows E/F/J — dated 2026-08-01, stale (predates the whole 2026-11 window). No fresh browser/E2E proof added tonight.

## Recency
**Addressed tonight.** 10 commits landed since the last audit (2026-11-18), all in this subsystem: Smart Booking can now offer to relocate before a report/non-face-to-face/telehealth block and do that work at the client's location instead of pushing the client session later, when the free time before it holds the whole drive; an event's day can be changed from the side panel; side-panel event notes now save to the server and survive reloads/switches (fixing real data loss); the side panel now reliably shows the event that was actually clicked (fixed a roughly 1-in-3 wrong-event bug); a new booking opens scrolled to the top with every group folded; no more unwanted automatic trip-home; no forced 15-minute booking rounding; and the Sync popup was redesigned into three tabs (Outlook/Splose/Portal) with a new "outside events" block-review queue. All of it is guarded and tested — this feature's own unit test files grew from 156 tests (12 files) to 456 tests (19 files) tonight, plus 126 integration tests across 12 files (up from 84 across 9).

## Open tasks (from the tracker)
- Multi Calendar Rules — todo

## Reason for the label
Code, guards and a now much larger test suite all pass — but the one tracker task (Multi Calendar Rules) is still `todo` and the next_action ("walk the Multi Calendar Rules checklist against the live portal") is still open. Tonight's commits added a large amount of new, tested code underneath this subsystem but did not touch that live-verification checklist item itself — it is a human, not a code, task.

## Disagreement with the tracker
Tracker "idea" stage vs. a very large, heavily tested, and tonight even more actively developed calendar/sync/booking subsystem.
