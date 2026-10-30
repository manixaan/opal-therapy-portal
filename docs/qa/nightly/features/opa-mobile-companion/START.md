/opal-critical

## Idea
Opa Mobile Companion

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
Calendar View: `backend/mobile-routes.js` (`GET /api/mobile/calendar`,
`loadOwnAppointments`), with overlap/day-crossing support added to
`backend/database.js`'s `getEventsForTherapists`. Case Noting (voice-to-case-note,
clinical AI): `backend/case-note-routes.js` + `clinical-note-provider.js` (goes
through `backend/ai/ai-gateway.js`). Both tracker tasks' code was touched again
tonight (fixes, not new features) and both remain `todo` in the tracker. This
touches clinical AI output and governance — CRITICAL level.

## Start here
This repository's side keeps getting fixed and re-proven, but the tracker tasks
themselves are about device/pilot verification, which code here cannot do.
166 unit tests + 10 integration tests pass across both routes as of tonight
(`npx jest tests/mobile-routes.test.js tests/case-note-routes.test.js` and the
`case-note-approval-edit.itest.js`/`case-note-client-link.itest.js`/
`case-note-deidentification.itest.js` integration files). The real next step is
the tracker's own checklist: walk the pilot on the test device end to end
(dictation, AI summary against the clinical pathway, note landing in the
portal), per the "Case Noting" task's checklist items, and separately confirm
the calendar/travel view on-device. No code change is expected unless that
walkthrough finds a mismatch with what the tests above already prove works in
isolation.

## Done means
The tracker's own device checklist items (Case Noting and Calendar View) ticked
off against the real test device/mobile client — or a completed manual
device-test checklist entry on this tracker card. Until then the label stays
`needs-refinement`: this repo's tests (`tests/mobile-routes.test.js`,
`tests/case-note-routes.test.js`, `tests/integration/case-note-approval-edit.itest.js`)
can confirm the API contract but not the real device/client calling it.

Tracker: e786d774-43bf-4a8b-826d-94bcb97a9613
