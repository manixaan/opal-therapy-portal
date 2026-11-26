# Portal - Splose - Outlook | Integration Works

- Tracker stage: **idea**
- Tracker environment: **none**
- Evidence label: **needs-refinement**
- Addressed since the last audit (2026-11-25..2026-11-26): **yes** — a trip-home-fit rework: "Via home" is now offered only when it actually fits the gap, the leg switch names both ways, a drive that cannot fit its gap gets a note instead of a bare red bar, plus two same-night visual fixes (the no-time note no longer covers a short tile's title; the Direct\|Home switch and dark-mode red bars)
- Created (any located code): **yes**

## Located files
- backend/calendar-routes.js, backend/nf2f-routes.js, backend/travel-sync-routes.js,
  backend/splose-sync-routes.js, backend/sync-settings-routes.js, backend/splose-link-routes.js,
  backend/block-review-routes.js (all unchanged tonight — no backend file in this subsystem was
  touched by any of tonight's four commits; every change is frontend-only).
- frontend/current/travel.js (v80 as of tonight) — `homeAvailable` now checks the gap actually fits
  drive-home + 30 min + drive-back (cached/suburb-table minutes only, never a new Routes call) before
  offering a trip home; the leg switch now names both destinations ("Direct \| Home", "Stay \| Home")
  and fills the one taken; a drive that cannot fit its gap now carries an inline note on the tile
  boundary ("18 min drive · no time") rather than a bare red bar, shrinking to a red "!" with the
  sentence as its tooltip where it would otherwise cover the tile's own title (a same-day fix once the
  wider change exposed the overlap on 15-minute, three-line-wrapped tiles); the Same place marker now
  has its own panel fill so the day-column wash doesn't shade it; the panel explains why home is
  missing and warns when a saved trip home no longer fits (still drawn, since it is what gets billed).
- frontend/current/theme.css (v9) — dark-mode fix: the theme's travel fill/ink no longer override the
  gutter bars, so a no-time drive shows red again, not purple.
- frontend/current/mockup_v3.html — markup/CSS support for the above (switch label layout at narrow
  week-view widths, the boundary note).
- backend/billing/{calendar-travel-minutes,day-route,route-facts,travel-billing,nf2f-timer,trips}.js,
  backend/travel-outlook-sync.js, backend/sync-preferences.js, backend/splose-api.js,
  backend/rich-notes.js, backend/block-review.js, `PATCH /api/outlook/events/:dbId` →
  backend/event-move.js — all unchanged tonight.
- No new migration for calendar/travel/Splose/sync tonight (the last ones remain `089`–`093`;
  migration `094` belongs to Opa Mobile Companion, landed last night, unchanged tonight).

## Could not locate / notable gaps
CLAUDE.md's repo map names backend/service-agreement-routes.js; that file still does not exist in
this checkout (re-confirmed tonight by a fresh `ls`). Service agreements are actually generated
through templates-routes.js + backend/templates/service-agreement-map.js — see Report Templates'
folder. Documentation mismatch, not a functional gap.

## Guard check
OK — no backend route changed tonight, so no new guard surface. `node --check` clean on
`frontend/current/travel.js` (syntax-checkable despite being a browser script). No TODO/FIXME in any
file touched tonight. `scripts/check-asset-pins.js` confirms every `?v=` pin in `mockup_v3.html`
matches tonight's commit, including `travel.js` at v80 and `theme.css` at v9.

## Tests run
- unit: a 59-file batch run fresh tonight (57 files / 950 tests covering calendar/booking/travel/
  NF2F/Splose-sync/sync-prefs/theme/time-format/rich-notes/block-review/outlook, including
  `smart-booking-route.test.js` and `travel-physical-route.test.js`, both changed by tonight's
  commits — 27 new assertions added to `smart-booking-route.test.js` alone across the four commits)
  + `frontend-stage3-guards.test.js` (294 tests) + `assessment-surface-guards.test.js` (85 tests,
  re-pinned six times tonight across the four commits for `travel.js`/`theme.css` version bumps) —
  **pass** (59 files / 1,329 tests, re-run fresh tonight).
- integration: `event-travel-plan.itest.js, travel-outlook-sync.itest.js, travel-overrides.itest.js,
  calendar-category-colours.itest.js, calendar-local-first.itest.js, invoicing-splose.itest.js,
  outlook-claim.itest.js, outlook-delta-preserve.itest.js, splose-connection.itest.js,
  splose-draft-sync.itest.js, splose-link-ignore.itest.js` — **pass** (11 files / 96 tests, re-run
  fresh tonight on an isolated `DB_NAME`). `block-review.itest.js`, `nf2f-timer.itest.js`,
  `sync-settings.itest.js`, `events-sync.itest.js`, `event-times.itest.js` and
  `event-delete-cascade.itest.js` were not re-run tonight individually (none of tonight's four commits
  touch their own code paths) — carried forward from last night's pass, not re-confirmed fresh.

## Tab / browser proof
docs/qa/BROWSER_QA_RESULTS.md rows E/F/J — dated 2026-08-01, stale (predates the whole 2026-11
window). No new E2E spec landed tonight for this subsystem's own behaviour. The net finding stands:
no functional E2E coverage of the calendar/booking/travel sync workflow itself.

## Recency
**Addressed tonight**, across four of the ten commits in tonight's window (see the brief's "What
changed since last audit" for the full list), landing in this order: `6d9845b` (Via home only when it
fits; both-ways leg switch), `1f30596` (same-night fix: Direct\|Home switch at narrow widths, dark-mode
red bars), the merge commit `85e9d53` (landing both as "travel-home-fit"), and `f5fc28d` (the no-time
note no longer covers a short tile's title).

## Open tasks (from the tracker)
- Multi Calendar Rules — todo

## Reason for the label
A real correctness fix landed and is tested fresh tonight (the trip-home-fit logic no longer offers a
trip that cannot fit the gap), but the one tracker task (Multi Calendar Rules) is still `todo` and the
next_action (walk that checklist against the live portal) is still open; no tab-level browser/E2E proof
exists either. `needs-refinement` is the stricter, correct label given the open human checklist item.

## Disagreement with the tracker
Tracker "idea" stage vs. a very large, heavily tested, production subsystem that gained a real
correctness fix again tonight (the trip-home-fit rework).

## Note — a second subsystem with no tracker card of its own (unchanged tonight)
backend/outlook-embed.js and frontend/current/outlook-tab.* (the Outlook/Teams "Opal" app-bar icon —
landed 25 Nov, unchanged tonight) still do not fit this card's own idea (calendar ↔ Splose ↔ Outlook
data sync) especially well — embedding the whole portal inside Outlook as an app is a different kind
of "integration" than this card describes. Carried forward unchanged; see the brief's "Do this first"
for tonight's unrelated, much larger addition with the same no-tracker-card problem (Opal Assist).
