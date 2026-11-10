# Automated Reminders

Tracker stage: idea · Tracker environment: none
Evidence label: **needs-refinement**
Addressed in this change window: **no** · Created: **partially**

## Located files

- **Therapist Snapshot** (built): `backend/snapshot-routes.js` — strictly `req.user.id`-scoped personal daily task/reminder list. Re-confirmed tonight by direct grep: `router.use('/api/snapshot', requireAuth)` is the only guard (correctly so — self-scoped exception), every query filters `WHERE user_id = $1`.
- **"24Hr Automatic Client Appt Reminders"** (the card's own headline idea): **nothing found**, re-confirmed tonight with a fresh repo-wide search for reminder/24-hour/appointment-reminder/SMS/Twilio/SNS terms — zero relevant matches. No cron package, no email/SMS send path to a client exists anywhere in the backend.
- `backend/credential-reminder.js` exists (confirmed present tonight) as a reference pattern (staff-facing credential nudges), not the client reminder itself.

## Tests

- Snapshot: integration test `tests/integration/snapshot.itest.js` ran tonight as part of a combined 17-file run on isolated DB `therapy_scheduler_audit_g6_test` — passed, within that run's **212/212** total. No dedicated unit test file for `snapshot-routes.js` (re-confirmed: no `snapshot*.test.js` exists).
- Client reminders: no tests, because no code exists to test.

## Classification reasoning

The tracker's own idea text is the client-facing reminder, and that remains entirely unbuilt — the task "Automated Client Appt Reminders" is still `todo`, which is exactly the trigger for `needs-refinement`. "Therapist Snapshot" is a different, already-built feature bundled onto the same card.

## Open tasks from the tracker

"Automated Client Appt Reminders" (todo, unbuilt), "Therapist Snapshot" (todo in the tracker, but the code itself is complete and tested).

## Commits in the window touching this feature

None for this feature. `develop` moved from `34cf881` to `40669e7` between the 2026-11-09 audit and tonight — one commit, the Travel block booking type (see `portal-splose-outlook-integration-works/STATUS.md`) — which does not touch `snapshot-routes.js` or add any client-reminder code.

## Disagreement

None.
