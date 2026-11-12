# Portal - Splose - Outlook | Integration Works

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **proven**
- Addressed in change window (2026-10-29 to 2026-11-12): yes — `backend/splose-api.js`, `backend/splose-caseload.js`, plus a large Travel/Calendar/Assist cluster (see "What changed" in the brief); most directly, commit `40669e7 feat(booking): Travel block booking type; drop Local/Remote home bases; client name in event panel`
- Created (any code located): yes, extensively

## Located files

- Routes: `backend/series-routes.js`, `backend/calendar-routes.js`, `backend/travel-sync-routes.js`, `backend/splose-link-routes.js`, `backend/travel-routes.js`, `backend/splose-sync-routes.js`, `backend/sync-settings-routes.js`, `backend/scheduler-routes.js`
- Support (non-route): `backend/outlook-oauth.js`, `backend/splose-api.js`, `backend/splose-poller.js`, `backend/splose-draft-sync.js`
- Frontend: `BOOK TAB` (`mockup_v3.html:4601`), `CALENDAR TAB` (`:4897`), `TRAVEL & FLIGHTS TAB` (`:5875`), `TRAVEL LOGBOOK TAB` (`:5912`)
- Unit tests (27 files, all run): `scheduler-geo/helpers/matrix.test.js`, `sync.test.js`, `splose-poller/alert-dialog/api-queue/auto-sync-reset/link-routes/credentials/draft-sync/match.test.js`, `travel-cascade/feasibility/block-frontend/work-location-gate/traffic/outlook-sync/overlay-clamp/physical-route/sync-routes.test.js`, `outlook-mirror/delta-preserve.test.js`, `sync-status-route/preferences/backfill/safety.test.js`
- Integration tests (15 files): `outlook-claim`, `scheduler-availability`, `travel-overrides`, `event-delete-cascade`, `event-travel-plan`, `calendar-local-first`, `event-series`, `events-sync`, `event-times`, `outlook-delta-preserve`, `splose-link-ignore`, `splose-connection`, `sync-settings`, `splose-draft-sync`, `travel-outlook-sync`
- E2E: none dedicated. Manual browser QA: `docs/qa/BROWSER_QA_RESULTS.md` rows D (Outlook state), E (Calendar/shell, Travel & Flights), F (Splose boundaries) — dated **2026-08-01**, predates this window's Travel block booking type work.

## Guard check

Clean on every located router: `series-routes.js` (`requireAuth`), `calendar-routes.js` (`requireAuth` + `requireRole('owner','admin')`/`requireMasterCalendarAccess`), `travel-sync-routes.js` (`requireAuth` + `requireAnyPermission`), `splose-link-routes.js` (`requireAuth` + `requireRole('owner')` on admin/connection routes), `travel-routes.js` (`requireAuth` + `denyReadOnly`), `splose-sync-routes.js` (`requireAuth`, `denyReadOnly`, `requireDraftSync`), `sync-settings-routes.js` (`requireAuth`, `denyReadOnly`, `requireRole('owner')` on writes), `scheduler-routes.js` (`requireAuth` + `requireMasterCalendarAccess`).

## Tests run

- Unit: 27 suites, 444 tests — **all pass**
- Integration: 15 suites, 133 tests — **all pass**
- `node --check`: clean on every located file

## Open tasks from tracker

- "Multi Calendar Rules" — `todo`. Checklist (all unchecked): confirm each workflow rule is in operation; confirm the "changes saved but not synced" indicator; confirm travel time calculates correctly for a day; confirm Portal/Splose match in both directions; decide what the Outlook calendar should show and how far ahead; stress-test with real-world examples.

## Commits in window touching it

Heavy activity this window, including the newest piece: `40669e7 feat(booking): Travel block booking type; drop Local/Remote home bases; client name in event panel`, plus the travel/traffic/splose/outlook cluster (`08da79d`, `e1af24e`, `338f5dc`, `75eae1e`, `0a365c4`, `3c85f54`, and more — see the brief's "What changed" section for the full commit list).

## Why proven overall, with one flagged gap

This audit maintains the classification this card has held for four consecutive nights (2026-11-08 through tonight, all against the same commit `40669e7`, since zero commits have landed on `develop` in that time): the base Calendar/Splose/Outlook subsystem is guarded, extensively unit- and integration-tested, and has real browser/E2E boundary proof (`e2e/tests/portal.spec.js` rows on Outlook/Splose boundaries; `docs/qa/BROWSER_QA_RESULTS.md` rows D/E/F). That's enough for `proven` at the tab level.

The one caveat, carried forward unchanged in "Do this first": the **Travel block booking type** (commit `40669e7`, the newest piece) is only unit/jsdom-proven — nothing in a real browser confirms a user can pick "Travel block" in Smart Booking, see the Google Maps route, and get the right calendar tile. This doesn't demote the whole card, but it's the standing action item.

## Disagreement

None in the "tracker overclaims" sense — if anything the reverse: the tracker card still reads as `idea` while the underlying calendar/travel/Splose/Outlook sync machinery is extensively built and tested. The open "Multi Calendar Rules" task is really about stress-testing something that already works at the unit/integration level, not about missing functionality.

## Continuity note

This audit independently re-ran every unit and integration test rather than trusting the prior night's numbers, and everything matched: 444/444 unit, 133/133 integration, all guards re-confirmed by direct grep. No regression since 2026-11-11.
