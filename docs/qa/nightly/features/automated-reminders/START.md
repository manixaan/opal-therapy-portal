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

## Task notes, verbatim (Automated Client Appt Reminders)

"We will add an automatic reminder that goes out to each client before their session. The
system will check upcoming appointments and send a message asking them to confirm. First we
need to look at what Opal Portal already stores about appointments and clients, so we reuse
that rather than rebuild it. We will make the reminder time a setting Anthony can change, not
fixed at 24 hours."

"Want to create some sort of way to send a message to the clients 24hrs beforehand regarding
their session to prompt them to confirm before rocking up to them not being there. Investigate
how can this be safely done. The 24 hr should be editable to a user created time"

## Task notes, verbatim (Therapist Snapshot)

"A therapist snapshot already exists in the portal. This task is mainly to look at what is
there today, then make it clearer and more useful. We will focus on two things the therapist
cares about: their weekly utilisation index and their daily sessions with where to go next. We
start by reviewing the current version before changing anything."

"Already is a snapshot built into the portal - want to refine and test how this looks like.
One key metric is utilisation index for the week and also their daily sessions and where to go
etc. This is just a note to investigate what has been built and whether the UI can be improved
to be more user friendly/useful"

## Where it lives today

Client reminders: nothing. Snapshot: `backend/snapshot-routes.js`,
`backend/billing/snapshot-hours.js`, and the actual UI in `frontend/current/reports.js`
(`reportPanelGenie` already provides a working open/close minimise animation).

## Start here

Two unrelated pieces of work are bundled in this card — pick one:

1. **Client reminders**: this needs a scheduler, a client contact channel (SMS/email —
   neither exists yet), and a confirm-step endpoint. Nothing to reuse; this is a from-scratch
   build. Start by confirming what client contact details are already stored (check the
   client table/`*-db.js` for phone/email columns) before deciding on SMS vs email.
2. **Snapshot minimise-to-top-right**: the open/close genie animation already works
   (`frontend/current/reports.js:99-136`, `reportPanelGenie`), scaling from the panel's own
   centre. The one open checklist item is making it animate toward the top-right corner
   instead — change the `translate(-50%,-50%)` transform origin/target in that function to
   track the header icon's position (`mockup_v3.html:4514`) rather than the viewport centre.

## Done means

For reminders: a scheduled job sends a real reminder and records a result, with a passing
integration test. For the snapshot: the minimise animation ends at the header icon's position,
and `reports.js` gets at least one test exercising `reportPanelGenie` and the missing-address
step-through — right now neither has any dedicated coverage.

Tracker: 398a0b36-a12f-4190-83e4-b3a8932b3b46
