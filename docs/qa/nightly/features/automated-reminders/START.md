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
Therapist Snapshot (a different, already-built feature that shares this tracker card): `backend/snapshot-routes.js` + `frontend/current/reports.js`. The 24-hour client appointment reminder itself: nothing yet.

## Start here
This card mixes two unrelated things. For the client reminder: a person needs to decide if it's still wanted and on what channel (SMS? email? which provider?) before any code is written — this is not a coding task yet. For Therapist Snapshot: open the Daily/Weekly report panel (now in `frontend/current/reports.js`) in a browser as a therapist and owner, confirm it renders real figures, then add a Playwright spec alongside `e2e/tests/portal.spec.js` or a dated `docs/qa/BROWSER_QA_RESULTS.md` entry.

## Done means
For Therapist Snapshot: a browser/E2E check confirms the report panel renders. For the client reminder: a written idea/why/what in the tracker, then build it as its own tracked task separate from Therapist Snapshot.

Tracker: 398a0b36-a12f-4190-83e4-b3a8932b3b46
