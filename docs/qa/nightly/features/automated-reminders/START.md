/opal-critical

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
(none recorded in the tracker)

## Where it lives today
Nothing for client-facing appointment reminders. The "Therapist Snapshot" task is a different, already-built feature: `backend/snapshot-routes.js` + `frontend/current/reports.js`, self-scoped to the caller by design (not a guard gap — see STATUS.md).

## Start here
This is two separate pieces of work wearing one tracker card:
1. **Client appointment reminders (the actual idea)** — nothing exists yet. Before building, decide the channel (SMS/email) and who triggers it (a scheduled job needs a place to live — there is no cron/scheduler pattern elsewhere in the backend yet; the closest is `splose-poller.js`'s interval loop). If the channel is email, note `backend/email.js` already wraps nodemailer (bumped 9.0.3→9.1.1 in `61fa50e` for four CVEs — unrelated maintenance, no reminder code exists yet to be affected by it).
2. **snapshot-routes.js's permission tier** — every route is `requireAuth` only, and tonight's audit confirms that's the accepted self-scoped pattern per the audit's own rubric (same exception as `mobile-routes.js`). No further action needed here unless the team wants an explicit `requirePermission` tier added anyway.

## Done means
For (1): a new integration test proving a reminder is queued/sent for an appointment inside the 24-hour window, and none outside it. For (2): nothing outstanding — already resolved as by-design.

Tracker: 398a0b36-a12f-4190-83e4-b3a8932b3b46
