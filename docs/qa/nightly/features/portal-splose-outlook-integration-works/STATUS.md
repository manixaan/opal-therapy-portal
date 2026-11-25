# Portal - Splose - Outlook | Integration Works

- Tracker stage: **idea**
- Tracker environment: **none**
- Evidence label: **needs-refinement**
- Addressed since the last audit (2026-11-24..2026-11-25): **yes** — trackpad pinch-zoom, a travel-legs-follow-the-zoom fix, address/suburb re-derivation, and a Swap-type rebook fix on the calendar; plus the Outlook M365 app-bar embed and its session-store fix (see "Note" below on tracker mapping)
- Created (any located code): **yes**

## Located files
- backend/calendar-routes.js, backend/nf2f-routes.js, backend/travel-sync-routes.js,
  backend/splose-sync-routes.js, backend/sync-settings-routes.js, backend/splose-link-routes.js,
  backend/block-review-routes.js
- `PATCH /api/outlook/events/:dbId` in backend/routes.js — delegates to backend/event-move.js
  (unchanged tonight, landed 23 Nov).
- backend/routes.js — tonight's changes: a saved address now re-derives its own suburb/region
  (previously a fresh Smart Booking kept the client's booked suburb); Swap type in the event panel
  rebooks via the same two-step pattern used elsewhere (new event saved, old one removed with
  `DELETE ?cascade=0` only after, so its travel block survives).
- frontend/current/travel.js — travel legs now redraw live from the day's cached segments on every
  pinch-zoom frame (`redrawTravelLegsFromCache`, no routing/Outlook/minutes-sync call mid-pinch); the
  saved-address suburb fix.
- frontend/current/mockup_v3.html — pinch-to-zoom the week grid's time axis (two fingers / ctrl+wheel
  / Safari gesture events; 36–216 px per hour, remembered per browser); the Swap-type UI.
- frontend/current/booking-route.js — Swap-type opens Smart Booking pre-filled with the old event's
  day/time/length/client/address.
- backend/billing/{calendar-travel-minutes,day-route,route-facts,travel-billing,nf2f-timer,trips}.js
  (unchanged tonight)
- backend/travel-outlook-sync.js, backend/sync-preferences.js, backend/splose-api.js,
  backend/rich-notes.js, backend/block-review.js (unchanged tonight)
- backend/.gitignore fix tonight: `node_modules` (not `node_modules/`) so a worktree's symlinked
  node_modules is excluded too — a build/tooling fix, not a feature change, but in this subsystem's
  touched-files list.
- Migration 094 landed tonight but belongs to Opa Mobile Companion, not this subsystem (no new
  migration for calendar/travel/Splose/sync itself — the last ones remain `089`–`093`).

## Could not locate / notable gaps
CLAUDE.md's repo map names backend/service-agreement-routes.js; that file still does not exist in
this checkout (re-confirmed tonight by a fresh `ls`). Service agreements are actually generated
through templates-routes.js + backend/templates/service-agreement-map.js — see Report Templates'
folder. Documentation mismatch, not a functional gap.

## Guard check
OK — every route file still sits behind `requireAuth` plus a role/permission middleware or
`denyReadOnly`, re-confirmed by `node --check` across `routes.js`, `event-move.js`, and all seven
route files. No TODO/FIXME in any file touched tonight. The suburb/address fix and the Swap-type
rebook both run inside the same guarded `PATCH`/create/delete paths as before — no new route, no
guard change.

## Tests run
- unit: a 62-file batch run fresh tonight — calendar/booking/travel/NF2F/Splose-sync/sync-prefs/
  theme/time-format/rich-notes/block-review, the new `calendar-pinch-zoom.test.js`, the shared
  asset-pin guards `assessment-surface-guards.test.js` and `frontend-stage3-guards.test.js` (both
  re-pinned tonight for the pinch-zoom and outlook-tab.html script/version bumps — confirmed by
  `scripts/check-asset-pins.js`: "Every pin matches the shell this commit would ship"), plus
  `outlook-embed.test.js` (expanded tonight, see the embed note below) and `boot-fetch-sharing.test.js`/
  `static-cache-headers.test.js` — **pass** (62 files / 1,415 tests: 61 files/1,121 tests in the main
  batch + `frontend-stage3-guards.test.js`'s 294 tests run separately). Plus `event-move.test.js`
  (unchanged tonight, counted under Opa Mobile Companion's folder) — **pass** (7/7 tests).
- integration: `block-review.itest.js, calendar-category-colours.itest.js, calendar-local-first.itest.js,
  event-travel-plan.itest.js, events-sync.itest.js, nf2f-timer.itest.js, splose-connection.itest.js,
  splose-draft-sync.itest.js, splose-link-ignore.itest.js, sync-settings.itest.js,
  travel-outlook-sync.itest.js, travel-overrides.itest.js, event-times.itest.js,
  event-delete-cascade.itest.js` — **pass** (14 files / 125 tests, re-run fresh tonight;
  `event-delete-cascade.itest.js` gained 14 new lines tonight covering the Swap-type `cascade=0`
  path and still passes).

## Tab / browser proof
docs/qa/BROWSER_QA_RESULTS.md rows E/F/J — dated 2026-08-01, stale (predates the whole 2026-11
window). No new E2E spec landed tonight for this subsystem's own behaviour (pinch-zoom, swap-type,
suburb fix). The net finding stands: no functional E2E coverage of the calendar/booking/travel sync
workflow itself.

## Recency
**Addressed tonight**, across six of the ten commits in tonight's window (see the brief's "What
changed since last audit" for the full list): `fix(calendar): travel legs follow a pinch zoom live`,
`feat(calendar): trackpad pinch zooms the time axis`, `fix(calendar): saved address re-derives its
suburb; Swap type rebooks an event`, plus the Outlook-tab head-link fix and the `.gitignore` fix.

## Open tasks (from the tracker)
- Multi Calendar Rules — todo

## Reason for the label
Several real calendar/travel fixes landed and are tested fresh tonight, but the one tracker task
(Multi Calendar Rules) is still `todo` and the next_action (walk that checklist against the live
portal) is still open; no tab-level browser/E2E proof exists either. `needs-refinement` is the
stricter, correct label given the open human checklist item. Unchanged from last night in substance,
even though the subsystem itself kept moving.

## Disagreement with the tracker
Tracker "idea" stage vs. a very large, heavily tested, production subsystem that gained real user-
facing polish again tonight (pinch-zoom, a travel-legs lag fix, a correctness fix on saved addresses).

## Note — a second subsystem with no tracker card of its own
Tonight's two largest new files, backend/outlook-embed.js and frontend/current/outlook-tab.*
(the Outlook/Teams "Opal" app-bar icon — a full M365 app, not calendar/Splose sync), plus the embed
session-store fix (`fix(outlook): the embed session gets its own store — password sign-in broke`),
do not fit this card's own idea (calendar ↔ Splose ↔ Outlook data sync) especially well — they are
about embedding the whole portal inside Outlook as an app, a different kind of "integration" than
this card describes. They are reported here only because "Outlook" is in both names and no better
home exists in the tracker. See the brief's "What changed since last audit" for the full technical
detail and risk notes on this one — it is flagged separately there as a subsystem with no exact
tracker feature.
