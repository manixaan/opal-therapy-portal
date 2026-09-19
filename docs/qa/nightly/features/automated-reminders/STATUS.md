# Automated Reminders

- Tracker stage: **idea** · Tracker environment: **none**
- Evidence label: **untouched**
- Addressed since last audit (2026-09-18T19:20Z UTC, commit `0726dde`): **no**
- Created (any located code): **partially** — the two tasks are two unrelated things

## Located files

Re-verified fresh tonight (commit `cec0a03`); the two tasks still map to two **different,
unrelated** pieces of code, and nothing changed in either since last night:

- **"Therapist Snapshot"** → `backend/snapshot-routes.js` (`/api/snapshot/*`, 15 routes) and
  `frontend/current/reports.js` (`autoOpenDailySnapshot()`). `git log 0726dde..HEAD --oneline --
  backend/snapshot-routes.js frontend/current/reports.js backend/tests/integration/snapshot.itest.js`
  — empty. Untouched tonight.
- **"Automated Client Appt Reminders"** (the tracker's own idea text) → still **nothing implements
  this**. Re-ran a repo-wide case-insensitive search for "reminder" across `backend/` and
  `frontend/current/` tonight: same categories as every prior audit — the Snapshot's personal
  reminders table, an internal case-note-completion nag, staff document/credential expiry
  reminders, a CPD notification-preference toggle, and a mirrored Outlook calendar-event reminder
  flag. None is a client-facing appointment reminder. `git diff 0726dde..HEAD | grep -i reminder`
  and `git log 0726dde..HEAD --oneline | grep -i reminder` — both empty. Tonight's 7-commit window
  (AI de-identification/Assist/theme) adds nothing here either.

## Guard check

`snapshot-routes.js:31` — `router.use('/api/snapshot', requireAuth)`, no permission/role
middleware follows on any of the 15 routes. Per this audit's rubric, the file's own header comment
("STRICTLY user-scoped... personal productivity data, not practice data... no cross-user access
for ANY role") makes this **self-scoped by design, not broken** — the documented exception, same
as `mobile-routes.js`. `node --check snapshot-routes.js` — clean.

## Tests run

Re-run fresh tonight, no code changed here since last audit:

- `DB_NAME=therapy_scheduler_n4a DB_PASSWORD=audit npx jest --config jest.integration.config.js
  tests/integration/snapshot.itest.js --runInBand` — **PASS 6/6**.
- No unit test file exists for `snapshot-routes.js` (confirmed: no `tests/snapshot*.test.js`).
- No test, unit or integration, exists for client-facing appointment reminders — there is no code
  to test.

No TODO/FIXME found in `snapshot-routes.js`.

## Disagreement

None in the strict "tracker ahead of evidence" sense (stage is idea, the floor). The feature's own
idea text names the goal as **client-facing 24-hour appointment reminders**, and nothing in the
codebase does that four audits running. "Therapist Snapshot" is real, tested, working software with
a deliberate self-scoped-only guard — but it answers a different question and should not be
mistaken for progress on the stated goal.
