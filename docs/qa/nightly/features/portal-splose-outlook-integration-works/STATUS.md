# Portal - Splose - Outlook | Integration Works

- Tracker stage: **idea**
- Tracker environment: **none**
- Evidence label: **needs-refinement**
- Addressed since the last audit (2026-11-23..2026-11-24): **yes** — the shared calendar-save path was refactored
- Created (any located code): **yes**

## Located files
- backend/calendar-routes.js
- backend/nf2f-routes.js
- backend/travel-sync-routes.js
- backend/splose-sync-routes.js
- backend/sync-settings-routes.js
- backend/splose-link-routes.js
- backend/block-review-routes.js
- `PATCH /api/outlook/events/:dbId` in backend/routes.js — **now delegates to `backend/event-move.js`
  (new tonight)**, which holds the handler's former body unchanged (local-first write, Splose
  draft-queue + auto-sync nudge, Outlook mirror with graceful degradation). The route's response is
  documented as byte-for-byte what it was before the extraction.
- `PATCH /api/events/:dbId/notes` in backend/routes.js
- backend/event-move.js (new) — shared by this route and the mobile app's new drag-to-move
  (`backend/mobile-routes.js`, see Opa Mobile Companion's folder)
- backend/travel-outlook-sync.js, backend/sync-preferences.js, backend/splose-api.js, backend/rich-notes.js, backend/block-review.js
- backend/billing/{calendar-travel-minutes,day-route,route-facts,travel-billing,nf2f-timer,trips}.js (travel/route-planning logic this subsystem's UI consumes — not the invoicing use of the same billing engine, which the Xero Integration Works folder covers separately)
- frontend: travel.js/.css, booking-route.js/.css, nf2f.js/.css, splose-sync.js/.css, sync-settings.js, block-review.js/.css, and the calendar tab block in mockup_v3.html
- No new migrations this window (last ones remain `089`–`093`, all already applied).

## Guard check
OK — `PATCH /api/outlook/events/:dbId` is still `requireAuth`, re-confirmed after the refactor; the
extraction moved the handler's body into `event-move.js` (a plain service module, no route, no guard
of its own needed — the caller owns the ownership check, exactly as the module's own header comment
says). Every other route file still sits behind `requireAuth` plus a role/permission middleware or
`denyReadOnly`, re-confirmed by fresh `node --check` + re-grep tonight across all seven route files
plus `event-move.js`. No unguarded route found. No TODO/FIXME found in this subsystem's files.

## Tests run
- unit: 54 files run fresh tonight (calendar/booking/travel/NF2F/Splose-sync/sync-prefs/theme/
  time-format/rich-notes/block-review, plus `boot-fetch-sharing.test.js`, `static-cache-headers.test.js`,
  and the shared asset-pin guard `assessment-surface-guards.test.js`) — **pass** (967/967 tests).
  Plus the new `event-move.test.js`, run separately alongside the mobile unit files tonight (see Opa
  Mobile Companion's folder) — **pass** (7/7 tests). 55 files / 974 tests total for this subsystem.
  File-set selection varies slightly night to night by design; no regression, all green.
- integration: `block-review.itest.js, calendar-category-colours.itest.js, calendar-local-first.itest.js, event-travel-plan.itest.js, events-sync.itest.js, nf2f-timer.itest.js, splose-connection.itest.js, splose-draft-sync.itest.js, splose-link-ignore.itest.js, sync-settings.itest.js, travel-outlook-sync.itest.js, travel-overrides.itest.js` — **pass** (12 files / 112 tests, re-run fresh tonight, exact match to last night's count on the now-refactored save path). `event-times.itest.js` and `event-delete-cascade.itest.js` were also re-run as an extra check on the shared save path tonight — both pass, confirming the extraction preserved behaviour for those flows too.

## Tab / browser proof
docs/qa/BROWSER_QA_RESULTS.md rows E/F/J — dated 2026-08-01, stale (predates the whole 2026-11
window). No new E2E spec landed tonight for this subsystem's own behaviour. The net finding stands:
no functional E2E coverage of the calendar/booking/travel sync workflow itself.

## Recency
**Addressed tonight**, after the first fully quiet night this audit had seen (2026-11-23). One
commit, `refactor(calendar): one save road for a calendar edit — event-move.js` (21:42 UTC
2026-11-23, after last night's 18:35 UTC audit so first seen this run), extracted
`PATCH /api/outlook/events/:dbId`'s body into `backend/event-move.js` so the mobile app's new
drag-to-move takes the same road. The commit message states the route's response is byte-for-byte
unchanged and is pinned by the existing calendar-local-first, splose-draft-sync, event-times,
splose-link-ignore and event-delete-cascade itests (all green, re-confirmed above) plus a new unit
file for the service (`event-move.test.js`, 7 tests, all pass).

## Open tasks (from the tracker)
- Multi Calendar Rules — todo

## Reason for the label
Code, guards and tests all pass after tonight's refactor — the extraction changed where the logic
lives, not what it does, and every pinning test confirms that. But the one tracker task (Multi
Calendar Rules) is still `todo` and the next_action ("walk the Multi Calendar Rules checklist
against the live portal") is still open, and no tab-level browser/E2E proof exists either.
`needs-refinement` is the stricter, correct label given the open human checklist item. Unchanged
from last night.

## Disagreement with the tracker
Tracker "idea" stage vs. a very large, heavily tested, production subsystem — the same disagreement
as every prior night, now with a cleaner internal shape (one shared save path for portal and mobile)
behind it.
