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
(not yet written in the tracker)

## Where it lives today
Automated Client Appt Reminders: NONE FOUND. Only tangential: checkCaseNoteReminders in app-routes.js (an internal therapist notification about missing case notes — not a client-facing appointment reminder). Therapist Snapshot: backend/snapshot-routes.js (344 lines, snapshot_reminders/snapshot_tasks tables), also consumed by backend/mobile-routes.js.

## Start here
This needs a design decision before code: SMS vs email for the reminder channel, and which provider (the repo has no existing outbound-SMS/email-reminder integration to extend — nodemailer is used for transactional email elsewhere and could be a starting point). Once decided, build a scheduled check (likely alongside scheduler-routes.js) that finds appointments ~24h out, sends the reminder, and records a confirmation/sent flag to avoid duplicate sends.

## Done means
A new integration test proving one appointment ~24h out triggers exactly one reminder send and is not re-sent on a second scheduler pass.

Tracker: 398a0b36-a12f-4190-83e4-b3a8932b3b46
