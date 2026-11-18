/opal-feature

## Idea
Portal - Splose - Outlook | Integration Works

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
backend/booking-rules.js, backend/calendar-routes.js, backend/travel-routes.js,
backend/splose-sync-routes.js, backend/sync-settings-routes.js — the calendar tab in
frontend/current/mockup_v3.html. This is a large, already-working integration; the one
concrete open item is "Multi Calendar Rules" (tracker task, status todo).

## Start here
Open backend/booking-rules.js and backend/tests/booking-rules.test.js to see the existing
rule pattern (weekend bookability, travel blocks). "Multi Calendar Rules" has no code anywhere
yet — start by asking the practice what rule they actually need (e.g. one practitioner syncing
two Outlook calendars, or two practitioners sharing one). Add the rule as a new function in
booking-rules.js alongside the existing ones, with a test in booking-rules.test.js first.

## Done means
A new test in backend/tests/booking-rules.test.js (or a new tests/multi-calendar-rules.test.js)
passes, proving the specific multi-calendar rule the practice described. Evidence label should
reach `proven` once that test exists and the calendar tab has been checked by hand against it.

Tracker: eba1c6a7-3ba4-420f-acf4-1c5838991138
