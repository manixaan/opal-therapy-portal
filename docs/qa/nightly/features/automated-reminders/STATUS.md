# Automated Reminders

- Tracker idea text: "24Hr Automatic Client Appt Reminders"
- Tracker stage: idea | Tracker environment: none
- Evidence label: **needs-refinement**
- Created: no (for what the card actually asks for — see note)
- Addressed this window: no

## Located files
None for the client-appointment-reminder goal the card names. Re-grepped backend/*.js tonight for
appt/appointment reminder, 24hr, SMS, twilio, sendReminder — no matches anywhere.

Side note: backend/snapshot-routes.js + tests/integration/snapshot.itest.js implement a *different*,
already-proven feature — a personal reminders + daily task list, strictly self-scoped to the caller
(matches the CLAUDE.md-documented self-scoped-by-design exception). This is NOT a client-appointment
SMS/email reminder. Re-grepping "utilisation"/"utilization" across the whole codebase tonight still
finds only unrelated learning-module-completion usages.

## Guard check
N/A — nothing to guard-check for the client-reminder goal.

## Tests (re-run fresh tonight)
- snapshot-routes.js's own test: tests/integration/snapshot.itest.js — 1 suite / 6 tests PASS
  (DB_NAME=therapy_scheduler_audit_snapshot), but this proves the unrelated personal-reminders
  feature, not the appointment-reminder goal this card names.

## Open tasks (from tracker)
- "Automated Client Appt Reminders" — todo.
- "Therapist Snapshot" — todo.

## Commits in window touching this
None.

## Disagreement
None — the tracker correctly shows this as not yet built.

## Additional detail (2026-11-17)
Tonight's pass also located the Snapshot feature's frontend: `frontend/current/reports.js`
(functions `openReportPanel`/`switchReportMode`), wired into `mockup_v3.html`, pulling billable
hours/travel/idle-gap data from `/api/events`, plus the personal reminders/tasks widget from
`snapshot-routes.js`. No dedicated unit test exists for this report-panel logic beyond the generic
frontend guard suites.

## Note
No change from the 2026-11-16 audit. Independently re-verified fresh tonight (separate parallel
audit pass, its own throwaway database) — same code, same tests, same result.
