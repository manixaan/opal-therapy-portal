/opal-feature

## Idea
24Hr Automatic Client Appt Reminders

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

## Decisions
(none recorded)

### Task notes — "Automated Client Appt Reminders" (verbatim from tracker)
"Want to create some sort of way to send a message to the clients 24hrs beforehand regarding their session to prompt them to confirm before rocking up to them not being there. Investigate how can this be safely done. The 24 hr should be editable to a user created time"

### Task notes — "Therapist Snapshot" (verbatim from tracker, a separate already-built item bundled into this same card)
"Already is a snapshot built into the portal - want to refine and test how this looks like. One key metric is utilisation index for the week and also their daily sessions and where to go etc. This is just a note to investigate what has been built and whether the UI can be improved to be more user friendly/useful"

## Where it lives today
Client appointment reminders: nothing. Therapist Snapshot (a different, already-built thing on this same card): `backend/snapshot-routes.js`, `frontend/current/reports.js`.

## Start here
For the client-reminder idea (this card's actual title): decide the send channel (SMS vs email — tracker leaves this open) and the confirm mechanism, then follow the existing pattern in `backend/credential-reminder.js` for a scheduled-check-and-send job, creating `backend/appointment-reminder.js`. Reuse the appointment data already in `backend/calendar-routes.js` rather than building new storage. Before any of that, ask the team whether "Therapist Snapshot" should be split into its own tracker card — it's unrelated and already built.

## Done means
A new integration test proving an appointment due for a reminder gets one message, exactly once, and that a client confirming updates the appointment. That's `proven` for this idea; "Therapist Snapshot" needs its own START once split out.

Tracker: 398a0b36-a12f-4190-83e4-b3a8932b3b46
