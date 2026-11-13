# Portal - Splose - Outlook | Integration Works

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **proven**
- Addressed in change window (2026-11-12 to 2026-11-13): no — zero commits landed on `develop` since the 2026-11-12 audit; the Travel block work (commit `40669e7`) predates this window (2026-11-10)
- Created (any code located): yes, extensively

## Located files

- Routes: `backend/series-routes.js`, `backend/calendar-routes.js`, `backend/travel-sync-routes.js`, `backend/splose-link-routes.js`, `backend/travel-routes.js`, `backend/splose-sync-routes.js`, `backend/sync-settings-routes.js`, `backend/scheduler-routes.js`
- Support (non-route): `backend/outlook-oauth.js`, `backend/splose-api.js`, `backend/splose-poller.js`, `backend/splose-draft-sync.js`
- Frontend: `BOOK TAB` (`mockup_v3.html:4601`), `CALENDAR TAB` (`:4897`), `TRAVEL & FLIGHTS TAB` (`:5875`), `TRAVEL LOGBOOK TAB` (`:5912`)
- Unit tests (37 files, run tonight across two groups): scheduler, sync, splose-*, travel-*, outlook-mirror/delta-preserve, sync-status/preferences/backfill/safety
- Integration tests (15 files): `outlook-claim`, `scheduler-availability`, `travel-overrides`, `event-delete-cascade`, `event-travel-plan`, `calendar-local-first`, `event-series`, `events-sync`, `event-times`, `outlook-delta-preserve`, `splose-link-ignore`, `splose-connection`, `sync-settings`, `splose-draft-sync`, `travel-outlook-sync`
- E2E: none dedicated. Manual browser QA: `docs/qa/BROWSER_QA_RESULTS.md` rows D, E, F — unchanged since 2026-08-01, predates the Travel block booking type work.

## Guard check

Re-confirmed tonight by direct grep, unchanged on every located router: `series-routes.js` (`requireAuth`), `calendar-routes.js` (`requireAuth` + `requireRole('owner','admin')`/`requireMasterCalendarAccess`), `travel-sync-routes.js` (`requireAuth` + `requireAnyPermission`), `splose-link-routes.js` (`requireAuth` + `requireRole('owner')` on admin/connection routes), `travel-routes.js` (`requireAuth` + `denyReadOnly`), `splose-sync-routes.js` (`requireAuth`, `denyReadOnly`, `requireDraftSync`), `sync-settings-routes.js` (`requireAuth`, `denyReadOnly`, `requireRole('owner')` on writes), `scheduler-routes.js` (`requireAuth` + `requireMasterCalendarAccess`).

## Tests run

- Unit: re-run tonight as part of a 37-suite/684-test group — **all pass**
- Integration: re-run tonight — 15 suites, 133 tests — **all pass**, identical to the 2026-11-12 run
- `node --check`: re-run tonight, clean on every located file

## Open tasks from tracker

- "Multi Calendar Rules" — `todo`. Checklist (all unchecked) — stress-testing something that already works at the unit/integration level, not missing functionality.

## Commits in window touching it

None this window. See the 2026-11-12 brief for the prior window's heavy activity (commit `40669e7` and the travel/traffic/splose/outlook cluster).

## Why proven overall, with one flagged gap

This audit maintains the classification held for five consecutive nights (2026-11-08 through tonight, all against the same commit `40669e7`): the base Calendar/Splose/Outlook subsystem is guarded, extensively unit- and integration-tested, and has real browser/E2E boundary proof. The one caveat, carried forward unchanged: the **Travel block booking type** is only unit/jsdom-proven — nothing in a real browser confirms a user can pick "Travel block" in Smart Booking and see it land correctly on the calendar.

## Disagreement

None in the "tracker overclaims" sense — if anything the reverse: the tracker card still reads as `idea` while the underlying machinery is extensively built and tested.

## Continuity note

This audit independently re-ran every unit and integration test rather than trusting the prior night's numbers, and everything matched exactly: 444/444 unit (part of tonight's 684-test combined group), 133/133 integration, all guards re-confirmed by direct grep. No regression since 2026-11-11.
