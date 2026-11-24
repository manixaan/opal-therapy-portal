# Opa Mobile Companion

- Tracker stage: **idea**
- Tracker environment: **none**
- Evidence label: **needs-refinement**
- Addressed since the last audit (2026-11-23..2026-11-24): **yes** — drag-to-move landed for the Calendar View task
- Created (any located code): **yes**

## Located files
- backend/mobile-routes.js — `POST /api/mobile/appointments/:id/move` (new tonight, 23 Nov commit)
  is guarded by `requireAuth` (router-wide) **plus** `requireAnyPermission('manage_own_schedule',
  'manage_all_schedules')` and every query scoped to `user_id = req.user.id` — stronger than the
  self-scoped-by-design exception the rest of this router relies on for its GETs.
- backend/mobile-calendar.js (new tonight) — pure rules module: `canMoveEvent`, `checkMove`,
  `buildTravelLegs`. No DB, no clock argument (caller passes `now`), fully unit-testable.
- backend/event-move.js (new tonight) — the one shared save road for a calendar edit (local-first
  write, Splose draft-queue, Outlook mirror with graceful degradation), extracted out of
  `PATCH /api/outlook/events/:dbId` so the phone's move and a portal drag take the same path. Also
  the located file for Portal - Splose - Outlook (see that folder).
- backend/case-note-routes.js `generateGovernedDraft()` — mobile voice notes (voiceNoteId) link into
  the same governed AI case-note generation pathway used by the desktop Case Notes workspace.

## Could not locate / notable gaps
The mobile app's own frontend code lives outside this repository (native app) — nothing here can
prove it renders or runs on a device, drag-to-move included.

## Guard check
OK. `router.use('/api/mobile', requireAuth)` covers the whole prefix; the new move route additionally
requires `manage_own_schedule` or `manage_all_schedules` and every read/write is scoped to
`user_id = req.user.id`. `node --check` clean on `mobile-calendar.js`, `mobile-routes.js`,
`event-move.js`, `routes.js`. No TODO/FIXME in any of the four changed/new files. The move is
audited as `mobile_event_moved` with ids and minutes only (no clinical/employee data in the
metadata).

## Tests run
- unit: `mobile-routes.test.js, mobile-calendar.test.js, mobile-move.test.js, event-move.test.js,
  case-note-routes.test.js, casenotes-compose.test.js, casenotes-helpers.test.js,
  casenotes-workspace.test.js` — **pass** (8 files / 219 tests, run fresh tonight; the four
  mobile/event-move files are new tonight and this is their first run under this audit)
- integration: `mobile-move.itest.js, case-note-approval-edit.itest.js, case-note-client-link.itest.js,
  case-note-deidentification.itest.js, case-note-workspace.itest.js` — **pass** (5 files / 17 tests;
  `mobile-move.itest.js` is new tonight)

## Tab / browser proof
N/A — mobile client is outside this repo. Server-side, the move is now guarded and tested; nothing
in this repository can prove the phone's drag gesture itself works.

## Recency
**Addressed tonight.** Two commits landed at 21:42 UTC 2026-11-23 (after last night's 18:35 UTC audit,
so first seen this run): `feat(mobile): drag-to-move from Opa` (mobile-calendar.js, mobile-routes.js)
and `refactor(calendar): one save road for a calendar edit — event-move.js` (extracted from
`backend/routes.js`, shared by the portal's own drag-to-move PATCH). The commit's own message flags
a known gap: Outlook copies of portal-drawn travel legs refresh only when the portal next draws that
day — not fixed by this change, not a regression either.

## Open tasks (from the tracker)
- Case Noting — todo
- Calendar View — todo

## Reason for the label
Case Noting's device walkthrough is still open (unchanged). Calendar View moved from read-only
(GET endpoints only, as of last night) to a guarded, audited, tested write path tonight — real
progress — but the tracker task itself is still `todo` and the next_action (manual device
walkthrough) is still open, so the label stays `needs-refinement` rather than moving toward `proven`.

## Disagreement with the tracker
Tracker "idea" stage vs. a now-larger, built, tested, AI-governed (Case Noting) and guarded
(Calendar View) backend pathway for this feature.
