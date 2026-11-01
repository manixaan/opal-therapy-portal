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

- **Therapist Snapshot** half already exists: `backend/snapshot-routes.js`
  (mounted `backend/server.js:586`) + the report modal in
  `frontend/current/mockup_v3.html` (`#report-modal`, `openReportPanel`).
  Proven by `tests/integration/snapshot.itest.js`.
- **Automated Client Appt Reminders** half: nothing yet.

## Start here

This card bundles two unrelated things — split them. For the Snapshot half,
the only gap is proof it renders: open the header report icon as a
therapist, confirm the Today/Week views load with real data, and record the
walkthrough in `docs/qa/BROWSER_QA_RESULTS.md` (or add a Playwright spec
under `e2e/tests/`, following the pattern of an existing calendar-area spec).
For the Reminders half, first resolve the tracker's own open decision —
SMS vs email vs both — then look at how appointment data and client contact
details are already modelled (`backend/scheduler-routes.js`/events, client
records) before writing a new scheduled sender; there is no existing
scheduler/cron pattern in this repo to copy, so this is new infrastructure,
not a small addition.

## Done means

- Snapshot: a passing E2E spec or a dated entry in
  `docs/qa/BROWSER_QA_RESULTS.md` confirming the report modal renders →
  label becomes `proven`.
- Reminders: a channel decision recorded in the tracker, plus a passing
  integration test for the reminder scheduler/sender → label moves from
  `untouched` to `built-untested` or better.

Tracker: 398a0b36-a12f-4190-83e4-b3a8932b3b46
