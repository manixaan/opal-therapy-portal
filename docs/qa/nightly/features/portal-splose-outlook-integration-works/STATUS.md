# Portal - Splose - Outlook | Integration Works

- Tracker stage: **idea**
- Tracker environment: **none**
- Evidence label: **needs-refinement**
- Addressed since the last audit (2026-11-19..2026-11-20): **no**
- Created (any located code): **yes**

## Located files
- backend/splose-sync-routes.js
- backend/travel-sync-routes.js
- backend/sync-settings-routes.js
- backend/calendar-routes.js
- backend/splose-link-routes.js
- backend/block-review-routes.js (added 2026-11-19 — `router.use('/api/block-review', requireAuth, denyReadOnly)`)
- backend/block-review.js, backend/sync-preferences.js, backend/rich-notes.js (added 2026-11-19 — logic/utility modules, no HTTP surface of their own)
- backend/billing/day-route.js, backend/billing/invoice-generation.js (billing route-planning logic this subsystem feeds, not route files)
- New endpoint `PATCH /api/events/:dbId/notes` added to backend/routes.js
- frontend: travel.js, booking-route.js, navigation.js, block-review.js, sync-settings.js, splose-sync.js, mockup_v3.html (calendar/booking panels, side panel, Sync popup)

## Guard check
OK — every route file guarded (`requireAuth` + `requireRole`/`requirePermission`/`denyReadOnly` as appropriate), re-confirmed tonight including `block-review-routes.js` (added 2026-11-19). The `PATCH /api/events/:dbId/notes` endpoint is `requireAuth` + an inline role check (blocks `read_only`/`pre_employee`) + SQL scoped `WHERE id = $1 AND user_id = $2` — self-scoped by design, the same convention as `snapshot-routes.js`, not a missing guard.

## Tests run
- unit (12 pre-existing files): `outlook-delta-preserve.test.js, outlook-mirror.test.js, splose-alert-dialog.test.js, splose-api-queue.test.js, splose-auto-sync-reset.test.js, splose-credentials.test.js, splose-draft-sync.test.js, splose-link-routes.test.js, splose-match.test.js, splose-poller.test.js, travel-outlook-sync.test.js, travel-sync-routes.test.js` — **pass** (12 files / 156 tests)
- unit (7 files added/changed 2026-11-19): `smart-booking-route.test.js, event-drawer-consistency.test.js, booking-panel-fresh.test.js, rich-notes.test.js, billing-engine.test.js, block-review.test.js, sync-preferences.test.js` — **pass** (7 files / 300 tests, re-run fresh tonight, identical to last night)
- unit (8 guard/asset-pin files): `frontend-stage3-guards.test.js, assign-learning-guards.test.js, nf2f-frontend.test.js, onboarding-journey-frontend-guards.test.js, templates-frontend-guards.test.js, travel-physical-route.test.js, travel-traffic.test.js, assessment-surface-guards.test.js` — **pass** (8 files / 656 tests; some of these files are also exercised separately under other features' own test batches — not a separate defect count, just the same shared guard file run from two angles tonight)
- integration (12 files): `calendar-category-colours.itest.js, calendar-local-first.itest.js, outlook-claim.itest.js, outlook-delta-preserve.itest.js, splose-connection.itest.js, splose-draft-sync.itest.js, splose-link-ignore.itest.js, sync-settings.itest.js, travel-outlook-sync.itest.js, event-notes.itest.js, block-review.itest.js, invoicing.itest.js` — **pass** (12 files / 126 tests, re-run fresh tonight, identical to last night)

## Tab / browser proof
docs/qa/BROWSER_QA_RESULTS.md rows E/F/J — dated 2026-08-01, stale (predates the whole 2026-11 window). No fresh browser/E2E proof added tonight.

## Recency
**Not addressed tonight.** Zero commits landed in `backend/` or `frontend/current/` anywhere in the repository between the last audit (18:39 UTC 2026-11-19) and tonight's. Last night's 10-commit landing (Smart Booking relocate-before-block, side-panel day change, server-saved side-panel notes, the wrong-event fix, the redesigned three-tab Sync popup with its outside-events block-review queue) stands unchanged — this feature's unit test files remain at 456 tests across 19 files, plus 126 integration tests across 12 files, all re-confirmed passing fresh tonight rather than carried forward from the number alone.

## Open tasks (from the tracker)
- Multi Calendar Rules — todo

## Reason for the label
Code, guards and a now much larger test suite all pass — but the one tracker task (Multi Calendar Rules) is still `todo` and the next_action ("walk the Multi Calendar Rules checklist against the live portal") is still open. Tonight's commits added a large amount of new, tested code underneath this subsystem but did not touch that live-verification checklist item itself — it is a human, not a code, task.

## Disagreement with the tracker
Tracker "idea" stage vs. a very large, heavily tested, and tonight even more actively developed calendar/sync/booking subsystem.
