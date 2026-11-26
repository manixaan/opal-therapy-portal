# Opa Mobile Companion

- Tracker stage: **idea**
- Tracker environment: **none**
- Evidence label: **needs-refinement**
- Addressed since the last audit (2026-11-25..2026-11-26): **no** — last night's large addition (edit client/session/address, client card, notes owing, push) is unchanged tonight; no commit touched this subsystem's files
- Created (any located code): **yes**

## Located files
- backend/mobile-routes.js — every route sits behind `router.use('/api/mobile', requireAuth)`; five
  routes new or changed tonight:
  - `POST …/:id/move` (yesterday) now also returns `canEdit`/`canMove` on the formatted appointment.
  - `GET …/:id/edit`, `GET /clients/:id/address`, `PATCH …/:id/details` (new) — the edit sheet: change
    address in place, or change client/type (rebooks the slot the way the portal's Swap type does).
  - `GET …/:id/client` (new) — the client card: contacts, own session history, own last case-note
    excerpt. `read_only` refused.
  - `GET /notes-owing`, `POST/DELETE /notes-owing/:id/dismiss` (new) — own finished sessions with no
    case note yet.
  - `POST/DELETE /push-devices` (new) — registers/removes an APNs device token.
- backend/mobile-event-edit.js (new) — `canEditEvent`, `currentKind`/`currentClient`, `composeBooking`,
  `repriceDay`, address cleaning. Pure rules + one DB call (`repriceDay`); no route of its own.
- backend/mobile-notes-owing.js (new) — `listOwed`, `ownSession`, `dismiss`/`undismiss`; every query
  scoped by `req.user` (`e.user_id = $n` or `therapist_profile_id`), matching the snapshot-routes.js
  self-scoped exception.
- backend/push/apns.js (new) — sends straight to Apple over HTTP/2 with an ES256 provider JWT
  (`node:crypto`, no dependency). No route; called only by push-jobs.js.
- backend/push/push-jobs.js (new) — a 2-minute job: "time to leave" and a 5:30pm Perth notes-owing
  digest. Claims a `mobile_push_sent` row before sending (no double-send across a re-run or a second
  instance); disables a token Apple reports gone.
- backend/migrations/094_mobile_push_and_notes_owing.sql (new) — `mobile_push_devices`,
  `mobile_push_sent`, `case_note_owed_dismissals`. Applied cleanly tonight on an isolated database
  (`DB_NAME=therapy_scheduler_audit_test`), `IF NOT EXISTS` throughout, no `CONCURRENTLY`.
- backend/.env.example documents the four env vars that keep push inert
  (`PUSH_NOTIFICATIONS_ENABLED`, `APNS_KEY_P8`/`APNS_KEY_ID`/`APNS_TEAM_ID`/`APNS_BUNDLE_ID`).
- backend/event-move.js, backend/routes.js's `createBookingCore`/`deleteEventCore` — the shared
  save/rebook road this edit now reuses (see Portal - Splose - Outlook's folder for the same files).
- backend/case-note-routes.js `generateGovernedDraft()` — mobile voice notes still link into the same
  governed AI case-note pathway as the desktop Case Notes workspace (unchanged tonight).

## Could not locate / notable gaps
The mobile app's own frontend code lives outside this repository (native app) — nothing here can
prove any of tonight's additions actually render or run on a device: not the edit sheet, not the
client card, not notes owing, not a push notification arriving.

## Guard check
OK. Every route is under `/api/mobile` and `router.use('/api/mobile', requireAuth)`; the write routes
(`move`, `edit`, `details`) additionally require `manage_own_schedule`/`manage_all_schedules`. Every
query in the new files is scoped to `user_id = req.user.id` (or `therapist_profile_id`), including the
client card's own-appointment check (404 on someone else's row, 403 for `read_only`), the edit sheet's
`loadEditable()` (`user_id = $2` on the SELECT), and `mobile-notes-owing.js`'s own-rows filter.
`node --check` clean on `mobile-routes.js`, `mobile-event-edit.js`, `mobile-notes-owing.js`,
`push/apns.js`, `push/push-jobs.js`, `server.js`. No TODO/FIXME in any of the five new/changed files.
The client card, the rebook, and the address change are each audited
(`mobile.client_card_viewed`, `mobile_event_rebooked`, `mobile_event_address_changed`) with ids and
flags only — no clinical or employee data in any metadata payload, read by inspection of every
`logAuditEvent` call in the new code. Push is fail-closed: `push/push-jobs.js`'s `off unless enabled`
path is itself asserted by `mobile-crm.itest.js`, and the feature stays inert without all four env
vars. The client picker reads only from the caller's own caseload (`splose-caseload.js`'s
`loadOwnClient`), never trusting a client id from the phone directly.

## Tests run
- unit: `mobile-routes.test.js, mobile-calendar.test.js, mobile-move.test.js, mobile-event-edit.test.js,
  event-move.test.js, push-apns.test.js, case-note-routes.test.js, casenotes-compose.test.js,
  casenotes-helpers.test.js, casenotes-workspace.test.js` — **pass** (10 files / 228 tests, re-run fresh
  tonight, exact match to last night's count)
- integration: `mobile-move.itest.js, mobile-event-edit.itest.js, mobile-crm.itest.js,
  case-note-approval-edit.itest.js, case-note-client-link.itest.js, case-note-deidentification.itest.js,
  case-note-workspace.itest.js` — **pass** (7 files / 34 tests, re-run fresh tonight on an isolated
  `DB_NAME`, migration 094 still applies cleanly; exact match to last night's count). Both the
  client/session/address edit and the push guard paths were re-confirmed passing, not only the happy
  path: stranger's row → 404, stale view → 409, missing required client → 400, unknown type → 400,
  `read_only` → 403, malformed push token → 400, Apple "gone" token → disabled not reused.

## Tab / browser proof
N/A — mobile client is outside this repo. Server-side, every one of tonight's additions is guarded,
audited and tested; nothing in this repository can prove the phone's own UI (the edit sheet, the
client card, a push notification, drag-to-move) actually works on a device.

## Recency
Not touched tonight. Last night's four commits (`feat(mobile): client card, notes owing, push to APNs
(migration 094)`, `feat(mobile): change client, session type or address from the phone`,
`feat(mobile): appointment detail reports canEdit/canMove for the Edit button`, plus the unrelated
`outlook-tab.html` head fix) remain the most recent activity on this subsystem. Tonight's ten commits
(2026-11-26, see the brief's "What changed since last audit") touched calendar/travel, Opal Assist and
the Snapshot — none of this feature's files. The gaps named in those commits' own risk notes are
unchanged: push is still "not exercised against real APNs (no key yet)".

## Open tasks (from the tracker)
- Case Noting — todo
- Calendar View — todo

## Reason for the label
Calendar View now has a large, guarded, audited, heavily tested write surface (move, edit, client
card, notes owing, push) — real progress again tonight — but the tracker task itself is still `todo`,
the next_action (manual device walkthrough) is still open, and push has never been exercised against
real APNs. `needs-refinement` rather than `proven`: the gap is the device/real-service proof, not
missing code.

## Disagreement with the tracker
Tracker "idea" stage vs. a now much larger, built, tested, audited backend pathway for this feature —
the widest gap of any card in the tracker given how much landed in two nights.
