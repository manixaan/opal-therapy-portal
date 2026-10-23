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
Therapist Snapshot: `backend/snapshot-routes.js` (personal reminders/tasks) + `frontend/current/reports.js` (the utilisation/travel/idle-gaps report panel). Client appointment reminders: nothing yet — no scheduler, no SMS/email wiring, no "reminded" flag anywhere.

## Start here
This card bundles two unrelated deliverables — treat them separately. For the client reminder half: before writing code, get a decision on channel (SMS vs email), the confirm-step UX, and the configurable lead time (the tracker's own checklist already lists these as open decisions). There is no cron/scheduling infrastructure in this codebase at all, so the first real engineering step is choosing one (e.g. `node-cron`, or a simple polling interval in `server.js`) and a provider for the message itself. For the Therapist Snapshot half: open `frontend/current/reports.js`'s daily/weekly panel in a browser and confirm the utilisation index and travel summary render correctly; if so, add an E2E spec or a `docs/qa/BROWSER_QA_RESULTS.md` row for it.

## Done means
Client reminders: a scheduled job sends a reminder and records the result, with a test proving it fires once per appointment and never double-sends. Therapist Snapshot: a browser/E2E check proves the report panel renders correctly, moving that half to `proven`.

Tracker: 398a0b36-a12f-4190-83e4-b3a8932b3b46
