/opal-feature

**Idea:** 24Hr Automatic Client Appt Reminders
**Why:** (not yet written in the tracker)
**Who uses it:** (not yet written in the tracker)
**What they see:** (not yet written in the tracker)
**What should happen:** (not yet written in the tracker)
**Outcome:** (not yet written in the tracker)
(No recorded decisions.)

## Where it lives today

Nothing for the client-facing reminder itself. `backend/snapshot-routes.js` is a different, already-built feature (a therapist's own personal daily task/reminder list, self-scoped, guarded, tested) — there is nothing in it to extend for a client-facing reminder.

## Start here

Decide where client-facing appointment reminders should send from (email via the existing mailer, or Outlook/SMS). Look at `backend/credential-reminder.js` for the house pattern on a reminder job (pure `decide()` function, surfaced via a notification-bell sync, no cron of its own — computed on demand). Write the client-facing equivalent as a new file, e.g. `backend/appointment-reminder.js`, scheduled the way `backend/server.js`'s existing `setInterval` jobs are scheduled.

## Done means

A new test proves a reminder is generated ~24 hours before a booked appointment and not duplicated on a second run → evidence label `proven`.

Tracker: 398a0b36-a12f-4190-83e4-b3a8932b3b46
