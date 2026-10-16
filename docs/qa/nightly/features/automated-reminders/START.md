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
Therapist Snapshot: `backend/snapshot-routes.js`, guarded, tested at
integration level, but missing the utilisation-index metric. Client
appointment reminders: nothing yet.

## Start here
Two separate pieces of work:
1. Snapshot: agree the utilisation-index formula with Anthony (weekly
   hours booked vs. available, most likely), add it to
   `backend/snapshot-routes.js` alongside the existing daily-sessions
   data, and extend `tests/integration/snapshot.itest.js` to cover it.
2. Client reminders: decide the delivery channel (SMS via a provider
   like Twilio, or email) and whether Anthony still wants it — this is
   a new feature with nothing to build on yet. If going ahead, start
   from what Opal already stores about appointments and clients
   (`backend/calendar-routes.js`) rather than rebuilding that.

## Done means
The utilisation-index metric is visible in the Snapshot panel with a
passing test, and a decision is recorded on whether/how client reminders
proceed. Evidence label should reach `proven` for Snapshot once the
metric lands.

Tracker: 398a0b36-a12f-4190-83e4-b3a8932b3b46
