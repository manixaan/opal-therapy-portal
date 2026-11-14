# Automated Reminders

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **needs-refinement**
- Addressed in change window (2026-11-13 to 2026-11-14): no
- Created at all: yes (Therapist Snapshot task only)

## Located files

- **Therapist Snapshot** — located: `backend/snapshot-routes.js`
  (tasks/reminders/voice-note-adjacent data, strictly `user_id`-scoped per
  its own header comment), `frontend/current/reports.js` ("Daily & Weekly
  Snapshot: the report panel behind the header icon"). Integration test:
  `tests/integration/snapshot.itest.js`.
- **Automated Client Appt Reminders** — **not located**. Searched for
  SMS/email send mechanisms, "appt reminder", "24hr"/"24 hour", and checked
  `outlook-oauth.js` (only sets the Outlook calendar's own 15-minute
  reminder flag on events the therapist creates — not a client-facing
  confirmation message) and `splose-*.js` (no reminder-send capability).
  There is no automated client-appointment-reminder system in this
  codebase.

## Guard check

`snapshot-routes.js`: `router.use('/api/snapshot', requireAuth)` only, but
its header comment explicitly documents strict `user_id` scoping on every
read and write ("single choke point in permissions.requireAuth (no extra
denies here)") — the named self-scoped exception. Not broken.

## Tests run

- Integration: `tests/integration/snapshot.itest.js` — 6/6 passed, against
  `therapy_scheduler_audit_test`.
- No unit test file exists for `snapshot-routes.js`.

## Recency

Not touched in the change window (since the 2026-11-13 audit).

## Classify

`needs-refinement`. The feature card's own idea is "24Hr Automatic Client
Appt Reminders" — that is the primary ask, and it does not exist in the
codebase at all. Therapist Snapshot (a secondary, bundled task) is built
and its integration test passes. Since the dominant piece of this feature
is unbuilt and the open task reflects real outstanding scope (not just a
bookkeeping gap), this is reported as needing refinement rather than
`proven`/`tab-unproven` for the snapshot half alone.

## Open tasks (from tracker)

- Automated Client Appt Reminders — todo. "We will add an automatic
  reminder that goes out to each client before their session. The system
  will check upcoming appointments and send a message asking them to
  confirm." Nothing built yet toward this.
- Therapist Snapshot — todo. "A therapist snapshot already exists in the
  portal. This task is mainly to look at what is there today, then make it
  clearer and more useful." Matches the evidence — it exists and passes
  its test; the task is about refining it (weekly utilisation index, daily
  sessions with where-to-go-next), not building it from scratch.

## Commits in the window touching this

None.

## Disagreement

Tracker stage `idea` for the whole card, but the two tasks are at very
different places: Therapist Snapshot is built and tested; Automated Client
Appt Reminders has nothing. Worth splitting this into two tracker cards so
the dashboard doesn't average them into one misleading status.
