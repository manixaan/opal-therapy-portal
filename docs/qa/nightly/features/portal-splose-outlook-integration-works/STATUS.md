# Portal - Splose - Outlook | Integration Works

- Tracker stage: **idea**
- Tracker environment: **none**
- Evidence label: **needs-refinement**
- Addressed since the last audit (2026-11-21..2026-11-22): **yes**
- Created (any located code): **yes**

## Located files
- backend/calendar-routes.js
- backend/nf2f-routes.js
- backend/travel-sync-routes.js
- backend/splose-sync-routes.js
- backend/sync-settings-routes.js
- backend/splose-link-routes.js
- backend/block-review-routes.js
- `PATCH /api/events/:dbId/notes` in backend/routes.js
- backend/travel-outlook-sync.js, backend/sync-preferences.js, backend/splose-api.js, backend/rich-notes.js, backend/block-review.js
- backend/billing/{calendar-travel-minutes,day-route,route-facts,travel-billing,nf2f-timer,trips}.js (travel/route-planning logic this subsystem's UI consumes — not the invoicing use of the same billing engine, which the Xero Integration Works folder covers separately)
- frontend: travel.js/.css, booking-route.js/.css, nf2f.js/.css, splose-sync.js/.css, sync-settings.js, block-review.js/.css, and the calendar tab block in mockup_v3.html (new tonight: a right-click context menu on empty calendar time, and left-docking the booking sheet for Fri/Sat/Sun)
- No new migrations this window (last new ones were `089`/`090`, both already applied).

## Guard check
OK — no new backend route or permission-surface code landed tonight (all 7 commits are frontend UI polish plus their test files, and one unrelated cosmetic Settings gear-icon change in mockup_v3.html with no tracker card). Every route file still sits behind `requireAuth` plus a role/permission middleware or `denyReadOnly`, re-confirmed by re-grep tonight across all seven route files. `PATCH /api/events/:dbId/notes` remains `requireAuth` + an inline role check + SQL scoped `WHERE id = $1 AND user_id = $2` — self-scoped by design, not a gap. No unguarded route found. No new TODO/FIXME introduced in tonight's changed files (`travel.js`, `mockup_v3.html`, `theme.css`).

## Tests run
- unit: 55 files run fresh tonight — **pass** (936/936 tests: 52 files/903 tests for calendar/booking/travel/NF2F/Splose-sync/sync-prefs/theme/time-format/rich-notes/block-review, plus `boot-fetch-sharing.test.js`, `static-cache-headers.test.js`, `splose-billing-source.test.js` — 3 files/33 tests). Two new test files landed tonight: `calendar-slot-context-menu.test.js` (right-click menu, 64 new assertions) and `booking-panel-side.test.js` (late-week left-docking, new tonight). `assessment-surface-guards.test.js` (shared asset-pin guard, re-pinned for `travel.js` v75/v74 and `theme.css` v8) also re-confirmed passing in the full suite run.
- integration: `block-review.itest.js, calendar-category-colours.itest.js, calendar-local-first.itest.js, event-travel-plan.itest.js, events-sync.itest.js, nf2f-timer.itest.js, splose-connection.itest.js, splose-draft-sync.itest.js, splose-link-ignore.itest.js, sync-settings.itest.js, travel-outlook-sync.itest.js, travel-overrides.itest.js` — **pass** (12 files / 112 tests)

## Tab / browser proof
docs/qa/BROWSER_QA_RESULTS.md rows E/F/J — dated 2026-08-01, stale (predates the whole 2026-11 window). `e2e/tests/portal.spec.js` has zero calendar/booking/travel/sync references. No fresh browser/E2E proof added tonight.

## Recency
**Addressed again tonight, more lightly than last night.** All 7 commits that landed in `backend/` and `frontend/current/` since the last audit (18:36 UTC 2026-11-21) touch this subsystem: a travel side-panel decluttering (dropped repeated grey explanatory sub-text), a right-click context menu on empty calendar time, hiding empty NDIS-plan/Region cards until a client is picked, a typing-in-the-start-field fix plus solid travel-leg fill, and late-week (Fri/Sat/Sun) booking-sheet left-docking (two commits). One unrelated commit (Settings gear icon) touches `mockup_v3.html` but is cosmetic chrome with no tracker card. Unit test count rose from 2,290 (63 files, by last night's count) — tonight's targeted re-count across the same subsystem plus two new test files gives 936 tests across 55 files (file selection judgment varies slightly night to night; no regression either way, both counts are all-green).

## Open tasks (from the tracker)
- Multi Calendar Rules — todo

## Reason for the label
Code, guards and tests all pass, and tonight's smaller landing is clean — but the one tracker task (Multi Calendar Rules) is still `todo` and the next_action ("walk the Multi Calendar Rules checklist against the live portal") is still open, and no tab-level browser/E2E proof exists either. `needs-refinement` is the stricter, correct label given the open human checklist item. Unchanged from last night.

## Disagreement with the tracker
Tracker "idea" stage vs. a very large, heavily tested, production subsystem — the same disagreement as every prior night, now with more evidence behind it.
