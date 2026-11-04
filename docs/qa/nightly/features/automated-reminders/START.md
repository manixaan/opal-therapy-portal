/opal-feature

**Idea**: 24Hr Automatic Client Appt Reminders

**Why**: (not yet written in the tracker)

**Who uses it**: (not yet written in the tracker)

**What they see**: (not yet written in the tracker)

**What should happen**: (not yet written in the tracker)

**Outcome**: (not yet written in the tracker)

**Decisions**: (none recorded)

**Tracker's next_action**: "Decide the reminder channel (SMS vs email) with the team, then build
the client reminder separately from the already-working Snapshot."

**Task notes (verbatim, "Automated Client Appt Reminders")**: "Want to create some sort of way to
send a message to the clients 24hrs beforehand regarding their session to prompt them to confirm
before rocking up to them not being there. Investigate how can this be safely done. The 24 hr
should be editable to a user created time"

**Task notes (verbatim, "Therapist Snapshot")**: "Already is a snapshot built into the portal -
want to refine and test how this looks like. One key metric is utilisation index for the week and
also their daily sessions and where to go etc. This is just a note to investigate what has been
built and whether the UI can be improved to be more user friendly/useful"

## Where it lives today

Client reminders: nothing yet. Snapshot: `backend/snapshot-routes.js`, `frontend/current/reports.js`.

## Start here

Two unrelated pieces of work on one card:
1. **Client reminders** — this needs the SMS-vs-email decision first (the next_action is correct);
   no code to touch yet. Once decided, the smallest first step is a scheduled job that reads
   `events`/appointments due in the configured window and an outbound send function — look at how
   `credential-reminder.js` structures its own scheduled nudge as a starting pattern.
2. **Snapshot** — before doing any UI work, first reconcile the tracker: either implement the
   "minimise" interaction the checklist already claims is done (in `frontend/current/reports.js`'s
   report-modal code), or untick that checklist item so it reflects reality.

## Done means

Client reminders: a working scheduled send + a passing integration test, reaching `built-untested`
at minimum. Snapshot: the checklist and the code agree, and a unit test exists for `reports.js`'s
utilisation calculation.

Tracker: 398a0b36-a12f-4190-83e4-b3a8932b3b46
