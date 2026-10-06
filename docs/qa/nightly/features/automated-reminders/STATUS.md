# Automated Reminders

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **untouched**
- Addressed this window (commits since 2026-10-04 touching its located files): **no** — zero commits have landed on `develop` under backend/ or frontend/current/ since the last audit (2026-10-04); the audited commit (`aacf8e68`) is still unchanged. This is the sixth consecutive reconfirmation night on this exact code. Tonight is not Sunday UTC, so targeted batches were run (not the complete suites) — see each section below for exactly what ran tonight.
- Created (any located code at all): **yes**

## Located files
- Automated Client Appt Reminders: NONE FOUND. Only tangential: checkCaseNoteReminders in app-routes.js (an internal therapist notification about missing case notes — not a client-facing appointment reminder). Grepped again tonight for twilio/sms/client-confirmation patterns across backend/*.js — no hit.
- Therapist Snapshot: the Daily & Weekly Snapshot report panel (frontend/current/mockup_v3.html #report-modal, openReportPanel — billable-progress bars, weekly utilisation digest) computed client-side from calendar/booking data already loaded; backend/app-routes.js GET /api/settings (reportPreferences: dailyBillableTargetHours, weeklyBillableTargetHours). Also backend/snapshot-routes.js (personal reminders/tasks, a different self-scoped feature reused by mobile, not the report panel itself).

## Guard check
snapshot-routes.js: requireAuth as a single choke point; every handler scopes its query to user_id = req.user.id. GET /api/settings: requireAuth, self-scoped to the caller's own settings. No gaps in what exists; nothing exists for the reminders half.

## Tests run tonight
- unit: `no test file exercises /api/settings reportPreferences or the report-panel computation directly (confirmed again tonight)` — none
- integration: `not run tonight (snapshot.itest.js, which covers personal reminders/tasks rather than the report panel, was not in tonight's targeted batches)` — n/a

## Open tasks (from the tracker)
- Automated Client Appt Reminders — build, todo
- Therapist Snapshot — build, todo

## Compare with the tracker
None — matches the tracker's own claude_update: the client-facing 24-hour reminder is entirely unbuilt (keeping the feature at `untouched` as a whole), while the bundled Therapist Snapshot sub-task is separately built and guarded but has no test at any level or browser proof of its own.
