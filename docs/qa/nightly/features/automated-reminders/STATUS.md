# Automated Reminders

- Tracker stage: **idea** · Tracker environment: **none**
- Evidence label: **untouched**
- Addressed since last audit (2026-09-17T18:21Z UTC): **no** (guard classification corrected, see below; no code changed)
- Created (any located code): **partially** — the two tasks are two unrelated things

## Located files

Re-verified fresh tonight; the two tasks still map to two **different, unrelated** pieces of code, and nothing changed in either since the last audit:

- **"Therapist Snapshot"** → `backend/snapshot-routes.js` (`/api/snapshot/reminders`, `/api/snapshot/tasks`, 15 routes) and `frontend/current/reports.js` (`autoOpenDailySnapshot()`). Only frontend polish commits (`f0b622e`, `9ae5fbe` — open/close animation) touched this area since last night; the API and its guard are untouched.
- **"Automated Client Appt Reminders"** (the tracker's own idea text: "24Hr Automatic Client Appt Reminders") → still **nothing implements this**. Re-ran a repo-wide case-insensitive search for "reminder" across `backend/`: matches are the Snapshot's personal reminders table, an internal case-note-completion nag, a mirrored Outlook calendar-event reminder flag, a CPD notification-preference toggle, and an unused Splose API-discovery string. Checked the full commit list since last audit (`b6a8ad4..HEAD`, 39 commits) — none of them (Assist, Splose practitioner-linking, FCA, theme, learning/workshop, Finance) add a client-facing appointment reminder. No code to test.

## Guard check

`snapshot-routes.js:31` — `router.use('/api/snapshot', requireAuth)`, no permission/role middleware follows on any of the 15 routes. **This audit corrects last night's classification**: the task's own rubric (tonight's instructions) names this exact file as the worked example of the documented exception — every query is scoped to `req.user.id`, stated explicitly in the file's own header comment ("STRICTLY user-scoped... personal productivity data, not practice data... no cross-user access for ANY role"). That makes this **self-scoped by design, not broken**. Last night's audit flagged it as "broken: unguarded endpoint" under a stricter reading; tonight's fixed rubric text supersedes that. `node --check snapshot-routes.js` — clean.

## Tests run

Re-run fresh tonight, no code changed here since the last audit:

- `tests/integration/snapshot.itest.js` — **PASS 6/6** (run against a dedicated session-only database after the shared `therapy_scheduler_audit_test` database showed concurrent-session contention from another process; see the Xero feature's STATUS.md for detail).
- No unit test file exists for `snapshot-routes.js` (confirmed: no `tests/snapshot*.test.js`).
- No test, unit or integration, exists for client-facing appointment reminders — there is no code to test.

No TODO/FIXME found in `snapshot-routes.js`.

## Disagreement

None in the strict "tracker ahead of evidence" sense (stage is idea, the floor). Worth flagging plainly, as last night did: the feature's own idea text names the goal as **client-facing 24-hour appointment reminders**, and nothing in the codebase does that. "Therapist Snapshot" is real, tested, working software with a deliberate self-scoped-only guard — but it answers a different question and should not be mistaken for progress on the stated goal. The label moved from `broken` to `untouched` tonight purely because the guard concern is resolved as by-design, not because anything was built for the actual idea.
