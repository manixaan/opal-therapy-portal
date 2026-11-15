# Automated Reminders

- Tracker idea text: "24Hr Automatic Client Appt Reminders"
- Tracker stage: idea | Tracker environment: none
- Evidence label: **needs-refinement**
- Created: no (for what the card actually asks for — see note)
- Addressed this window: no

## Located files
None for the client-appointment-reminder goal the card names. Grepped backend/*.js for
appt/appointment reminder, 24hr, SMS, twilio, sendReminder — no matches anywhere.

Side note: backend/snapshot-routes.js + tests/integration/snapshot.itest.js implement a *different*,
already-proven feature — a personal reminders + daily task list, strictly self-scoped to the caller
(matches the CLAUDE.md-documented self-scoped-by-design exception). This is NOT a client-appointment
SMS/email reminder, and it is NOT a "weekly utilisation view" — grepping "utilisation"/"utilization"
across the whole codebase finds only unrelated learning-module-completion usages. There is a real
naming mismatch between the tracker's "Therapist Snapshot" task and what the only "Snapshot" feature
in the app actually does.

## Guard check
N/A — nothing to guard-check for the client-reminder goal.

## Tests
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

## Correction note
This audit's first pass called this `untouched`. Corrected to `needs-refinement` before delivery,
matching how the 2026-11-14 audit classified this same card: the "Therapist Snapshot" half of the
card does have real, tested code (even though it's a different feature than the name suggests), so
`untouched` ("nothing in the code base matches the feature") undersells it — the better single label
is `needs-refinement`, carrying the genuinely-open client-reminder half as the open task.
