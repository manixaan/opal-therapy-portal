# Automated Reminders

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **untouched**
- Addressed this window (commits since 2026-10-03 touching its located files): **no** — zero commits have landed on `develop` under backend/ or frontend/current/ since the last audit (2026-10-03); the audited commit (`aacf8e6`) is still unchanged. This is the fifth consecutive reconfirmation night on this exact code; tonight is the weekly Sunday deep run (complete `npm test` + `npm run test:integration`).
- Created (any located code at all): **yes**

## Located files
- Automated Client Appt Reminders: NONE FOUND. Only tangential: checkCaseNoteReminders in app-routes.js (an internal therapist notification about missing case notes — not a client-facing appointment reminder).
- Therapist Snapshot: backend/snapshot-routes.js (344 lines, snapshot_reminders/snapshot_tasks tables), also consumed by backend/mobile-routes.js.

## Guard check
snapshot-routes.js: requireAuth as a single choke point; every one of its 8 handlers scopes its query to user_id = req.user.id, no role bypass exists — the "self-scoped by design" header claim was spot-checked and holds true. scheduler-routes.js: requireAuth + requireMasterCalendarAccess — guarded.

## Tests and results
No unit test exists for snapshot specifically. Integration: snapshot.itest.js — reconfirmed tonight inside the full `npm run test:integration` deep run (passed, part of the 997/999 passing overall; the 2 failures were elsewhere — see the audit's top-level brief). Identical result to the last four nights.

## Open tasks (from the tracker)
- Automated Client Appt Reminders — build, todo
- Therapist Snapshot — build, todo

## Compare with the tracker
None — matches the tracker's own claude_update exactly.
