# Automated Reminders

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **untouched**
- Addressed this window: no — nothing in the codebase matches the feature's core ask (client-facing reminders).
- Created (any located code at all): **no** (for the feature as described; see note below)

## Located files
None for "Automated Client Appt Reminders" — searched (case-insensitive) for "appt reminder", "appointment
reminder", "confirm appointment/session/booking", "session reminder", "24-hour/24hr reminder", "sms", "twilio",
"appt confirm", "client reminder" across backend, frontend and e2e. All matches found are unrelated (CPD/leave
reminders, credential-expiry reminders, personal snapshot task reminders — none are client-facing).

Separately, **not this feature but bundled under the same tracker card**: `backend/snapshot-routes.js`
implements "Therapist Snapshot" — personal reminders + daily task list, self-scoped by `user_id`. This is a
different, already-built backend that happens to share the word "reminder"; it does not prove the client-facing
appointment-reminder feature the tracker idea names.

## Guard check
Not applicable to the core feature (no code located). For the bundled Snapshot backend: `snapshot-routes.js:31`:
`router.use('/api/snapshot', requireAuth);` — self-scoped by design (header documents "every read and write
filters WHERE user_id = req.user.id"), not broken.

## Tests run tonight
- Core feature: none apply (no code).
- Bundled Snapshot backend: `tests/integration/snapshot.itest.js` — 6/6 pass. This proves `snapshot-routes.js`,
  not the client-facing reminder feature or the "Therapist Snapshot" report panel (`frontend/current/reports.js`)
  that the tracker's second task actually asks about — no unit test and no e2e test exists for that report panel
  or its weekly-utilisation-index computation.

## Open tasks (from the tracker)
- Automated Client Appt Reminders — build, todo
- Therapist Snapshot — build, todo

## Compare with the tracker
None new. Client-facing appointment reminders have no code at all. The "Therapist Snapshot" task (reviewing the
existing report panel, focusing on weekly utilisation index and daily sessions) is a different, already-built
surface that remains untested at the report-panel level — `snapshot.itest.js` tests a same-named but unrelated
backend file.
