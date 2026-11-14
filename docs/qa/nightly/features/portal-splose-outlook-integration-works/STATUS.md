# Portal - Splose - Outlook | Integration Works

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **proven**, with one flagged gap (Travel block booking
  type — see below)
- Addressed in change window (2026-11-13 to 2026-11-14): yes — 2
  commits (see below)
- Created at all: yes

## Located files

- Routes: `backend/series-routes.js`, `backend/calendar-routes.js`,
  `backend/travel-sync-routes.js`, `backend/splose-link-routes.js`,
  `backend/travel-routes.js`, `backend/splose-sync-routes.js`,
  `backend/sync-settings-routes.js`, `backend/scheduler-routes.js`
- Support (non-router, no guard needed): `backend/outlook-oauth.js`,
  `backend/booking-rules.js`
- Frontend: `BOOK TAB` (`mockup_v3.html:4252`), `CALENDAR TAB` (`:4253`),
  `TRAVEL & FLIGHTS TAB` (`:4277`, disabled), `TRAVEL LOGBOOK TAB`
- Unit tests (19 files located tonight): `availability-engine`,
  `booking-rules`, `find-availability`, `outlook-delta-preserve`,
  `outlook-mirror`, `scheduler-geo/helpers/matrix`, `smart-booking-route`,
  `splose-alert-dialog/api-queue/auto-sync-reset/credentials/draft-sync/
  link-routes/match/poller`, `travel-outlook-sync`, `travel-sync-routes`
- Integration tests (9 files located tonight):
  `event-travel-plan.itest.js`, `outlook-claim.itest.js`,
  `outlook-delta-preserve.itest.js`, `scheduler-availability.itest.js`,
  `splose-connection.itest.js`, `splose-draft-sync.itest.js`,
  `splose-link-ignore.itest.js`, `travel-outlook-sync.itest.js`,
  `travel-overrides.itest.js`
- **Browser QA**: `docs/qa/BROWSER_QA_RESULTS.md` rows D (Outlook per-user
  connection state), E (Calendar/shell renders correctly, no hardcoded
  data, tabs gated correctly), F (Splose read/write boundaries 403
  correctly) — live on staging, 14/14 checks passed. Unchanged since
  2026-08-01.

## Guard check

Every located router carries `requireAuth` plus a role/permission layer:
`series-routes.js` (`requireAuth`), `calendar-routes.js` (`requireAuth` +
`requireRole`/`requireMasterCalendarAccess`), `travel-sync-routes.js`
(`requireAuth` + `requireAnyPermission`), `splose-link-routes.js`
(`requireAuth` + `requireRole('owner')` on admin routes), `travel-routes.js`
(`requireAuth` + `denyReadOnly`), `splose-sync-routes.js` (`requireAuth`,
`denyReadOnly`, `requireDraftSync`), `sync-settings-routes.js`
(`requireAuth`, `denyReadOnly`, `requireRole('owner')` on writes),
`scheduler-routes.js` (`requireAuth` + `requireMasterCalendarAccess`). No
finding.

## Tests run

- Unit: 533/533 passed (19 suites).
- Integration: 83/83 passed (9 suites), against
  `therapy_scheduler_audit_test`.
- `node --check`: clean on every located file (part of a 198-file sweep
  across all of `backend/`).

## Recency

Addressed in this window:
- `8edfa9b` feat(calendar): Add a flight — lookup, check-in buffer, drives
  either side, live status (touches `booking-rules.js`)
- `c1793d1` feat(booking): weekends bookable, no preset working hours
  (touches `booking-rules.js`, `scheduler-routes.js`)

## Classify

`proven`. The base Portal/Splose/Outlook sync machinery is guarded,
extensively unit- and integration-tested, and has real, passing
browser-level QA on staging covering the Calendar shell, Outlook
connection state, and Splose data boundaries. **One flagged gap, carried
as a standing note:** the Travel block booking type (added `40669e7`,
2026-11-10) is only unit/jsdom-proven — nothing in a real browser confirms
a user can pick "Travel block" in Smart Booking and see it land correctly
on the calendar.

## Open tasks (from tracker)

- Multi Calendar Rules — todo. "This task confirms the booking workflow we
  have designed is actually in operation and working... We check bookings,
  travel time, the save-versus-sync marker, and the two-way match, then
  stress test with real-world examples." The checklist items here read as
  stress-testing something that already works at the unit/integration
  level and has boundary-level browser proof, not as missing
  functionality. A real-world stress test against live Splose/Outlook
  accounts (the specific ask) has not happened and cannot be substituted
  by this audit.

## Commits in the window touching this

Listed above (2 commits).

## Disagreement

None in the "tracker overclaims" sense — if anything the reverse: the
tracker card still reads as `idea` while the underlying machinery is
extensively built, tested, and boundary-verified in a real browser.
