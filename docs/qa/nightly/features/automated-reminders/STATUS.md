# Automated Reminders

- Tracker stage: `idea`
- Tracker environment: `none`
- Evidence label: **tab-unproven**
- Addressed since the last audit (2026-10-09): no
- Created (any located code at all): yes

## Located

- Client-facing appointment reminders (SMS/email): **nothing found.** Searched the whole backend for sms/twilio/sendgrid/reminder-sending code; there is none.
- Therapist Snapshot panel: `backend/snapshot-routes.js` (requireAuth; header comment documents strict `user_id` scoping — self-scoped by design, same pattern as `mobile-routes.js`). Frontend: `frontend/current/reports.js` — `snapLoad()` (line ~431) calls `/api/snapshot/reminders` and `/api/snapshot/tasks` directly, and its own comment confirms it ("Snapshot Day V2 (2026-08-09): ONE unified To-Do-style list over the /api/snapshot backend, rendered inside the daily panel"). The panel itself is the "Daily & Weekly Snapshot" report modal in `frontend/current/mockup_v3.html` (around line 21836), opened from the header icon — it is not a `TAB` banner, it's a modal reachable from every tab.
- Re-confirmed tonight: `frontend/current/reports.js`'s `snapLoad()` (line ~431) does call `/api/snapshot/reminders` and `/api/snapshot/tasks` for the report panel's reminders/tasks widget — this was corrected on 2026-10-09 (the eight briefs before that, 2026-09-30 through 2026-10-08, had wrongly called `snapshot-routes.js` "a same-named, unrelated personal-reminders backend, not the report panel"). The panel's sessions/travel/billable-progress widgets come from elsewhere (`/api/events` and similar); the reminders/tasks widget specifically is this code.

## Tests

- Unit: none for `snapshot-routes.js`.
- Integration: `tests/integration/snapshot.itest.js` — **6/6 pass**.
- e2e / browser QA: none found for the Snapshot panel or for client reminders.

## Open tasks (from the tracker)

Tracker tasks: "Automated Client Appt Reminders" (todo, no code at all), "Therapist Snapshot" (todo).

## Commits since the last audit that touched it

None — no commits have landed on `develop` under `backend/` or `frontend/current/` since the last audit (2026-10-09). Code audited tonight is the same commit (`aacf8e6`) as the last several nights.

## Disagreement with the tracker

None — tracker stage is `idea` for both halves, which undersells the Snapshot panel (it's built and integration-tested) but doesn't overclaim.

