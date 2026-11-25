/opal-critical

## Idea
Opa Mobile Companion

## Why
(not yet written in the tracker)

## Who uses it
(not yet written in the tracker)

## What they see
(not yet written in the tracker)

## What should happen
(not yet written in the tracker)

## Outcome
(not yet written in the tracker)

## Decision
(not yet written in the tracker)

## Where it lives today
- backend/mobile-routes.js — GETs are self-scoped by design (every query filters by req.user.id,
  matches the snapshot-routes.js exception); the write routes (`move`, `edit`, `details`) additionally
  require `manage_own_schedule`/`manage_all_schedules`. Tonight (25 Nov) added the client card
  (`GET …/:id/client`), notes owing (`GET /notes-owing`, dismiss/undismiss), push device registration
  (`POST/DELETE /push-devices`), and the edit sheet (`GET …/:id/edit`, `GET /clients/:id/address`,
  `PATCH …/:id/details`) for changing an appointment's address, client or session type from the phone.
- backend/mobile-event-edit.js, backend/mobile-notes-owing.js (both new 25 Nov) — the edit sheet's
  rules and the notes-owing query, respectively.
- backend/push/apns.js, backend/push/push-jobs.js (both new 25 Nov) — sends to Apple directly; a
  2-minute job for "time to leave" and the 5:30pm notes-owing digest. Inert without
  `PUSH_NOTIFICATIONS_ENABLED=true` and the three `APNS_*` env vars — not yet exercised against real
  APNs.
- backend/migrations/094_mobile_push_and_notes_owing.sql (new 25 Nov) — the three tables push and
  notes-owing need.
- backend/mobile-calendar.js (yesterday) — the move's validation rules (overlap, travel fit,
  past-time, ownership), unit-tested in mobile-calendar.test.js.
- backend/event-move.js (yesterday) — the shared save road the phone's move/edit and a portal drag
  all now take (local-first write, Splose queue, Outlook mirror).
- backend/case-note-routes.js generateGovernedDraft() — mobile voice notes (voiceNoteId) link into the same governed AI case-note generation pathway used by the desktop Case Notes workspace

## Start here
On the test device, dictate a case note through the Opa Mobile Companion app and confirm it reaches backend/case-note-routes.js's generateGovernedDraft() (linked by voiceNoteId) and produces a usable draft linked to the right client. This is a manual walkthrough first — only write code if it finds a real defect. While on the device, also try: drag-to-move; opening the edit sheet and changing an appointment's address, then its client/type; opening the client card; dismissing a notes-owing item; and, if an APNs key has since been added, registering for push and confirming a "time to leave" or notes-owing notification actually arrives — every one of these server sides is now guarded and tested, but nothing here has proven the phone's own UI works yet.

## Done means
The walkthrough is recorded as passing (or the defect found is filed as its own task).

Tracker: e786d774-43bf-4a8b-826d-94bcb97a9613
