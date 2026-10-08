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

(No decisions recorded in the tracker.)

## Where it lives today
Nothing yet for the client-facing reminder. The bundled "Therapist Snapshot" report panel exists as
`frontend/current/reports.js` (rendered from the `#report-overlay`/`#report-modal` markup in `mockup_v3.html`),
separate from `backend/snapshot-routes.js` (a same-named but unrelated personal-reminders backend).

## Start here
Two separate pieces of work are bundled under this one card. For the client reminder: decide SMS vs email and a
provider before building anything — this needs a human decision, not code, first. For "Therapist Snapshot": test
the report panel directly (`frontend/current/reports.js`'s billable %/travel/idle-gap computation and weekly
utilisation index), not `backend/snapshot-routes.js`, which proves a different feature. Start by reading
`frontend/current/reports.js` and adding a frontend-logic test following the pattern in
`backend/tests/frontend-stage3-guards.test.js`.

## Done means
A provider decision is made and a reminder-sending integration test exists for the client-facing feature; a
dedicated test exists for the Therapist Snapshot report panel's utilisation-index calculation. Evidence label
moves from untouched toward needs-refinement once either piece has real code and a test.

Tracker: 398a0b36-a12f-4190-83e4-b3a8932b3b46
