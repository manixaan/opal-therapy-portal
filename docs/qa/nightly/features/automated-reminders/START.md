/opal-feature

# Automated Reminders

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
(not yet written in the tracker)

## Where it lives today
- backend/snapshot-routes.js (Therapist Snapshot task only: personal daily tasks/reminders, 'Snapshot Day' — strictly user-scoped)

## Start here
Decide where client-facing appointment reminders should send from (email via the existing mailer, or Outlook) and build a new scheduled job — there is nothing to extend in snapshot-routes.js, which only serves the therapist's own personal task list. Look at backend/credential-reminder.js for the house pattern on a reminder job (schedule, dedupe, audit), then write the client-facing equivalent as a new file, e.g. backend/appointment-reminder.js.

## Done means
A new test file proves a reminder is generated ~24 hours before a booked appointment and not duplicated; Therapist Snapshot can be reclassified separately once split out.

Tracker: 398a0b36-a12f-4190-83e4-b3a8932b3b46
