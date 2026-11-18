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

## Decision
(not yet written in the tracker)

## Where it lives today
- backend/snapshot-routes.js (self-scoped by design, requireAuth alone OK) for the Therapist Snapshot task
- frontend/current/reports.js consumes /api/snapshot (Today report tab)

## Start here
Decide the reminder channel (SMS or email) before writing any code — nothing exists yet for Automated Client Appt Reminders. Separately, re-check the Therapist Snapshot's "minimise" checklist item against frontend/current/reports.js; no matching code was found this run even though the tracker checklist marks it done.

## Done means
The reminder channel decision is recorded in the tracker and the Therapist Snapshot checklist matches real code; label becomes `proven` once a real reminder is sent and confirmed.

Tracker: 398a0b36-a12f-4190-83e4-b3a8932b3b46
