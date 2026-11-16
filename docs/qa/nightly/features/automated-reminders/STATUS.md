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

## Note
No change from the 2026-11-15 audit. Re-verified fresh tonight: same code, same tests, same result.
