# Automated Reminders

- Tracker stage: **idea**
- Tracker environment: **none**
- Evidence label: **needs-refinement**
- Addressed since the last audit (2026-11-17..2026-11-18): **no**
- Created (any located code): **yes**

## Located files
- backend/snapshot-routes.js (self-scoped by design, requireAuth alone OK) for the Therapist Snapshot task
- frontend/current/reports.js consumes /api/snapshot (Today report tab)

## Could not locate / notable gaps
- Automated Client Appt Reminders: NOTHING located — no appointment-reminder send code anywhere in backend/ (grepped for appointment/appt reminder, 24-hour reminder sends)
- Therapist Snapshot: no "weekly utilisation index" UI found, and no snapshot-specific minimise function found (only an unrelated minimise on the separate Opa AI assistant chat widget, frontend/current/opa.js) — the tracker checklist marks "Create minimise function on snapshot" as done, but no matching code was found.

## Guard check
OK (snapshot-routes.js) — self-scoped by design.

## Tests run
- integration: `snapshot.itest.js` — **pass** (1 file / 6 tests)
- unit: `none found for snapshot-routes.js specifically` — **no test exists** (—)

## Tab / browser proof
Today report tab exists (reports.js); no E2E/browser QA entry for it.

## Recency
Not touched since the last audit (2026-11-17); zero commits anywhere since 2026-11-14.

## Open tasks (from the tracker)
- Automated Client Appt Reminders — todo
- Therapist Snapshot — todo

## Reason for the label
Automated Client Appt Reminders has no code at all; Therapist Snapshot has a working backend with one passing integration test but the UI refinements the task describes are not evident.

## Disagreement with the tracker
The tracker checklist ticks "Create minimise function on snapshot" as done, but no matching code could be found — flag this specific checklist item for re-checking, not the whole feature.
