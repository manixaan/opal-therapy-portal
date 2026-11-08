# Automated Reminders

Tracker stage: idea · Tracker environment: none
Evidence label: **needs-refinement**
Addressed in this change window: **no** · Created: **partially**

## Located files

- **Therapist Snapshot** (built): `backend/snapshot-routes.js` — strictly `req.user.id`-scoped personal daily task/reminder list (header explicitly documents "NO cross-user access for ANY role — owner and admin included"). Confirmed: `router.use('/api/snapshot', requireAuth)` is the only guard (correctly so — self-scoped exception), every query filters `WHERE user_id = $1`, a `loadOwn()` helper double-checks `id = $1 AND user_id = $2`.
- **"24Hr Automatic Client Appt Reminders"** (the card's own headline idea — `idea` field literally reads "24Hr Automatic Client Appt Reminders"): **nothing found**. Searched all of `backend/*.js` for reminder/24-hour/appointment-reminder/SMS/Twilio/SNS/sendReminder terms — every hit was unrelated (account-verification link expiry, onboarding document expiry, staff credential nudges). `backend/server.js`'s scheduled jobs (delta sync, Splose sync, Outlook webhook renewal, a Friday location alarm, a daily `run()`) are all calendar-sync/integration jobs, none client-facing. No cron package is used. No email/SMS send path to a client exists anywhere in the backend.
- `backend/credential-reminder.js` exists as a reference pattern (decide/notify, staff-facing credential nudges) but is unrelated to appointments — it is a candidate pattern to copy for the client reminder, not the reminder itself.

## Tests

- Snapshot: integration test `tests/integration/snapshot.itest.js` passes (ran as part of a combined 88-test run with templates/letters — **all 88 pass**). No dedicated unit test file for `snapshot-routes.js` (glob for `snapshot*.test.js` found none).
- Client reminders: no tests, because no code exists to test.

## Classification reasoning

The tracker's own idea text is the client-facing reminder, and that remains entirely unbuilt — the task "Automated Client Appt Reminders" is still `todo`, which is exactly the trigger for `needs-refinement` (a task on the feature is open). "Therapist Snapshot" is a different, already-built feature bundled onto the same card.

## Open tasks from the tracker

"Automated Client Appt Reminders" (todo, unbuilt), "Therapist Snapshot" (todo in the tracker, but the code itself is complete and tested).

## Commits in the window touching this feature

None — `backend/snapshot-routes.js` did not change in the last 14 days, and no client-reminder code was added.

## Disagreement

None.
