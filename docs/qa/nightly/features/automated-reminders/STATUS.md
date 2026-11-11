# Automated Reminders

Tracker stage: idea · Tracker environment: none
Evidence label: **needs-refinement**
Addressed in this change window: **no** · Created: **partially**

## Located files

- **Therapist Snapshot** (built): `backend/snapshot-routes.js` — strictly `req.user.id`-scoped personal daily task/reminder list. Re-confirmed tonight by direct grep: `router.use('/api/snapshot', requireAuth)` is the only guard (correctly so — self-scoped exception), every query filters `WHERE user_id = $1`.
- **"24Hr Automatic Client Appt Reminders"** (the card's own headline idea): **nothing found**, re-confirmed tonight with a fresh repo-wide search for reminder/24-hour/appointment-reminder terms — zero relevant matches. No cron package, no email/SMS send path to a client exists anywhere in the backend.
- `backend/credential-reminder.js` exists (confirmed present tonight) as a reference pattern (staff-facing credential nudges), not the client reminder itself.

## Tests

- Snapshot: `tests/integration/snapshot.itest.js` run tonight on its own isolated DB — **6/6 pass**. No dedicated unit test file for `snapshot-routes.js` (re-confirmed: no `snapshot*.test.js` exists).
- Client reminders: no tests, because no code exists to test.

## Classification reasoning

The tracker's own idea text is the client-facing reminder, and that remains entirely unbuilt — the task "Automated Client Appt Reminders" is still `todo`, which is exactly the trigger for `needs-refinement`. "Therapist Snapshot" is a different, already-built feature bundled onto the same card.

## Open tasks from the tracker

"Automated Client Appt Reminders" (todo, unbuilt), "Therapist Snapshot" (todo in the tracker, but the code itself is complete and tested).

## Commits in the window touching this feature

None. No commits landed on `develop` since last night's audit — `develop` is still at `40669e7`, the exact commit audited last night and re-verified again tonight.

## Disagreement

None.
