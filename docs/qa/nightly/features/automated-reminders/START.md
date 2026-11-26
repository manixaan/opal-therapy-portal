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

## Decision
(not yet written in the tracker)

## Where it lives today
- backend/snapshot-routes.js (self-scoped by design, requireAuth alone OK — header documents every query scoped to req.user.id) for the Therapist Snapshot task
- backend/billing/snapshot-hours.js (new 25 Nov 2026) — billable hours now follow invoicing's own
  selection/eligibility/travel-allocation rules instead of guessing from Outlook categories
- frontend/current/reports.js consumes /api/snapshot (Today report tab) — as of 26 Nov 2026 also
  runs a guided step-through fix for missing addresses, and no longer shows Smart Recommendations,
  the Open Calendar/Book/Logbook/View-week buttons, the Free gaps card or the Free Windows & Idle Gaps
  section (all removed tonight)

## Start here
Check whether the Development Manager tracker's "Create minimise function on snapshot" checklist item under the Therapist Snapshot task has a real implementation anywhere in frontend/current/reports.js or its CSS. If it does, note where; if not, either build it or un-tick the checklist item. (Unrelated to tonight's billable-hours change, which already has a passing integration test — see STATUS.md.)

## Done means
The checklist and the code agree.

Tracker: 398a0b36-a12f-4190-83e4-b3a8932b3b46
