/opal-feature

**Idea:** 24Hr Automatic Client Appt Reminders

**Why:** (not yet written in the tracker)

**Who uses it:** (not yet written in the tracker)

**What they see:** (not yet written in the tracker)

**What should happen:** (not yet written in the tracker)

**Outcome:** (not yet written in the tracker)

No decisions recorded yet.

**Task — Automated Client Appt Reminders:** We will add an automatic
reminder that goes out to each client before their session. The system
will check upcoming appointments and send a message asking them to
confirm. First we need to look at what Opal Portal already stores about
appointments and clients, so we reuse that rather than rebuild it...
(truncated in the tracker).

**Task — Therapist Snapshot:** A therapist snapshot already exists in the
portal. This task is mainly to look at what is there today, then make it
clearer and more useful. We will focus on two things the therapist cares
about: their weekly utilisation index and their daily sessions with where
to go next. We start by reviewing the... (truncated in the tracker).

## Where it lives today

Therapist Snapshot: `backend/snapshot-routes.js`,
`frontend/current/reports.js` — built, guarded (self-scoped), tested.
Automated Client Appt Reminders: nothing. No SMS/email send path exists
anywhere in the backend.

## Start here

These are two different pieces of work. For the Snapshot refinement, start
at `frontend/current/reports.js` and the weekly/daily renderers it
describes in its own header comment; follow `tests/integration/
snapshot.itest.js` for the existing data shape. For the client reminder
system, it does not exist yet — this is a real build: decide the channel
(SMS vs email; Splose may already send its own reminders, worth checking
with the practice before duplicating), then add a scheduled job that reads
upcoming appointments (reuse the same appointment data `mobile-routes.js`
already reads) and sends a confirmation request. Do not build this without
confirming the channel and vendor with a person first — it is a new
outbound communication to clients, not an internal refinement.

## Done means

Therapist Snapshot: a browser check of the weekly utilisation index and
daily "where to go next" view. Client reminders: a passing integration
test for the send-and-confirm flow, once the channel is chosen. Target
label: `needs-refinement` clears once both tasks have a plan; `proven`
only once the reminder system itself exists and is tested.

Tracker: 398a0b36-a12f-4190-83e4-b3a8932b3b46
