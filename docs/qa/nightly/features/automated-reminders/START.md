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

## Where it lives today
Nothing yet. No SMS/email send-and-confirm flow exists anywhere in backend/. A separate, already-built
"Snapshot" feature (backend/snapshot-routes.js) exists but is an unrelated personal reminders/task list,
not this.

## Start here
Before writing code, the tracker's own next_action needs a human decision: "Decide the reminder channel
(SMS/email) and build the send-and-confirm flow." Once a channel is picked, the natural home is a new
backend/appointment-reminders-routes.js (or similar) alongside booking-rules.js, scheduled from the
existing Outlook/Splose sync cycle (see backend/splose-sync-routes.js for the sync-cycle pattern) rather
than a new poller. Separately, "Therapist Snapshot" in the tracker does not match any utilisation view
in the code — clarify with the team whether this means the existing personal Snapshot feature or
something new before building anything against that task.

## Done means
A test proves a reminder is sent (or queued) 24h before an appointment and that a confirmation updates
state. Evidence label should move to `built-untested` once code exists, then `proven` once tested and
checked in a browser/E2E.

Tracker: 398a0b36-a12f-4190-83e4-b3a8932b3b46
