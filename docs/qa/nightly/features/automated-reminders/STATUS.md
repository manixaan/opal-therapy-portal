# Automated Reminders

- Tracker stage: `idea`
- Tracker environment: `none`
- Evidence label: **tab-unproven**
- Addressed since the last audit (2026-10-08): no
- Created (any located code at all): yes

## Located

- Client-facing appointment reminders (SMS/email): **nothing found.** Searched the whole backend for sms/twilio/sendgrid/reminder-sending code; there is none.
- Therapist Snapshot panel: `backend/snapshot-routes.js` (requireAuth; header comment documents strict `user_id` scoping — self-scoped by design, same pattern as `mobile-routes.js`). Frontend: `frontend/current/reports.js` — `snapLoad()` (line ~431) calls `/api/snapshot/reminders` and `/api/snapshot/tasks` directly, and its own comment confirms it ("Snapshot Day V2 (2026-08-09): ONE unified To-Do-style list over the /api/snapshot backend, rendered inside the daily panel"). The panel itself is the "Daily & Weekly Snapshot" report modal in `frontend/current/mockup_v3.html` (around line 21836), opened from the header icon — it is not a `TAB` banner, it's a modal reachable from every tab.
- **Correction to the last several nights' notes:** the last eight briefs (2026-09-30 through 2026-10-08) called `backend/snapshot-routes.js` "a same-named, unrelated personal-reminders backend, not the report panel." Re-read `frontend/current/reports.js` directly tonight (`snapLoad()`, line ~431, plus its own comment at line ~415): the panel *does* call `/api/snapshot/reminders` and `/api/snapshot/tasks` for its reminders/tasks widget. They are the same backend, not two same-named ones — the panel's sessions/travel/billable-progress widgets come from elsewhere (`/api/events` and similar, already covered by other features' tests), but the reminders/tasks widget is this code. That moves this half from `untouched` to `tab-unproven` (built, integration-tested, just never proven in a browser).

## Tests

- Unit: none for `snapshot-routes.js`.
- Integration: `tests/integration/snapshot.itest.js` — **6/6 pass**.
- e2e / browser QA: none found for the Snapshot panel or for client reminders.

## Open tasks (from the tracker)

Tracker tasks: "Automated Client Appt Reminders" (todo, no code at all), "Therapist Snapshot" (todo).

## Commits since the last audit that touched it

None — no commits have landed on `develop` under `backend/` or `frontend/current/` since the last audit (2026-10-08). Code audited tonight is the same commit (`aacf8e6`) as the last several nights.

## Disagreement with the tracker

None — tracker stage is `idea` for both halves, which undersells the Snapshot panel (it's built and integration-tested) but doesn't overclaim.

