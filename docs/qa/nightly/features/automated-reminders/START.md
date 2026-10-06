/opal-fast-change

## Idea
Automated Reminders

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
(not yet written in the tracker)

## Where it lives today
- Automated Client Appt Reminders: NONE FOUND. Only tangential: checkCaseNoteReminders in app-routes.js (an internal therapist notification about missing case notes — not a client-facing appointment reminder). Grepped again tonight for twilio/sms/client-confirmation patterns across backend/*.js — no hit.
- Therapist Snapshot: the Daily & Weekly Snapshot report panel (frontend/current/mockup_v3.html #report-modal, openReportPanel — billable-progress bars, weekly utilisation digest) computed client-side from calendar/booking data already loaded; backend/app-routes.js GET /api/settings (reportPreferences: dailyBillableTargetHours, weeklyBillableTargetHours). Also backend/snapshot-routes.js (personal reminders/tasks, a different self-scoped feature reused by mobile, not the report panel itself).

## Start here
Two separate pieces of work. (1) Therapist Snapshot (smaller): the report panel in frontend/current/mockup_v3.html (#report-modal) and backend/app-routes.js's GET /api/settings already work; add a browser/e2e check. (2) Automated Client Appt Reminders (new build): nothing exists yet — confirm with the team how reminders should be sent (SMS vs email, which provider) before building; the editable-interval requirement suggests reusing the /api/settings pattern.

## Done means
Therapist Snapshot: a passing e2e spec or BROWSER_QA_RESULTS.md entry. Appt Reminders: a located, guarded, tested route sending a real reminder. Either moves that half off its current label; the feature stays `untouched` overall until the reminders half exists.

Tracker: 398a0b36-a12f-4190-83e4-b3a8932b3b46
