/opal-feature

**Idea**
24Hr Automatic Client Appt Reminders

**Why** / **Who uses it** / **What they see** / **What should happen** / **Outcome**
(not yet written in the tracker)

No decisions recorded. Task notes (verbatim):

- **Automated Client Appt Reminders**: "Want to create some sort of way to
  send a message to the clients 24hrs beforehand regarding their session
  to prompt them to confirm before rocking up to them not being there.
  Investigate how can this be safely done. The 24 hr should be editable to
  a user created time"
- **Therapist Snapshot**: "Already is a snapshot built into the portal -
  want to refine and test how this looks like. One key metric is
  utilisation index for the week and also their daily sessions and where
  to go etc. This is just a note to investigate what has been built and
  whether the UI can be improved to be more user friendly/useful"

## Where it lives today

Therapist Snapshot: `backend/snapshot-routes.js` (self-scoped, guarded,
integration-tested) and the header report panel in `mockup_v3.html`. The
client appointment reminder task has **nothing built** — no route, no
SMS/email integration, no scheduled job found anywhere in the backend.

## Start here

These are two different pieces of work under one card:
1. **Client reminders** is greenfield — start with the tracker's own first
   checklist item ("look at what appointment and client details we
   already hold") by reading `backend/scheduler-routes.js` and the events
   schema for what's already stored, then decide the send channel
   (SMS/email) before writing any code — this needs a provider decision
   from the team first.
2. **Therapist Snapshot** just needs proof — add a browser or E2E check
   that opens the Today/Weekly snapshot panel (`openReportPanel('daily', ...)`
   in `mockup_v3.html`) and confirms it renders real data, since the
   backend already passes `tests/integration/snapshot.itest.js`.

## Done means

Client reminders: a working send-and-confirm flow plus an integration
test, once the channel is chosen. Snapshot: an E2E/browser check moving it
to `proven`.

Tracker: 398a0b36-a12f-4190-83e4-b3a8932b3b46
