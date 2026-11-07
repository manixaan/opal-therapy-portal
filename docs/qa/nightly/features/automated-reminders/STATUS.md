# Automated Reminders

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **needs-refinement**
- Addressed in this change window: no
- Created (any located code): yes

## Located files
- backend/snapshot-routes.js (Therapist Snapshot task only: personal daily tasks/reminders, 'Snapshot Day' — strictly user-scoped)

## Not located
- No code anywhere implements client-facing 24-hour automatic appointment reminders (the feature's own headline idea, '24Hr Automatic Client Appt Reminders'). backend/credential-reminder.js is unrelated — it reminds staff about expiring onboarding credentials, not clients about appointments.

## Guard check
snapshot-routes.js: requireAuth only, documented self-scoped by design (every query filters WHERE user_id = $N). Matches the backend-api rule's exception.

## Tests and results
- integration: snapshot.itest.js — 6 passed
- unit: none found for snapshot-routes.js specifically — no test exists

## Open tracker tasks
- Automated Client Appt Reminders (todo)
- Therapist Snapshot (todo)

## Commits in the 14-day change window touching this feature
Not touched in the 14-day change window.

## Why this label
The feature's two tasks point in different directions: Therapist Snapshot (personal daily reminders) is built, guarded and passes 6 integration tests — but the feature's own idea, automatic 24-hour appointment reminders sent to clients, has no code anywhere. The task stays open because the headline idea is unbuilt, not because of a test failure.

## Disagreement with the tracker
Tracker idea and task title promise client-facing appointment reminders; the only thing actually built is an unrelated personal task list for the therapist. Worth a decision on whether 'Therapist Snapshot' should be split into its own tracker card.
