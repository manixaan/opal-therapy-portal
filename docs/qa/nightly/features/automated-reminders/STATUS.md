# Automated Reminders

- Tracker stage: **idea**
- Tracker environment: **none**
- Evidence label: **needs-refinement**
- Addressed since the last audit (2026-11-18..2026-11-19): **no**
- Created (any located code): **yes**

## Located files
- backend/snapshot-routes.js (self-scoped by design, requireAuth alone OK — header documents every query scoped to req.user.id) for the Therapist Snapshot task
- frontend/current/reports.js consumes /api/snapshot (Today report tab)

## Could not locate / notable gaps
- Automated Client Appt Reminders: NOTHING located again tonight — no appointment-reminder send code anywhere in backend/ (fresh grep for appointment/appt reminder, 24-hour reminder sends).
- Therapist Snapshot: no snapshot-specific minimise function found again tonight (only the unrelated minimise on the separate Opa AI assistant chat widget, frontend/current/opa.js) — the tracker checklist still marks "Create minimise function on snapshot" as done, but no matching code exists. This disagreement persists unchanged.

## Guard check
OK (snapshot-routes.js) — self-scoped by design, re-confirmed.

## Tests run
- integration: `snapshot.itest.js` — **pass** (1 file / 6 tests)
- unit: no test exists for snapshot-routes.js specifically (confirmed again, none) — **no test exists** (—)

## Tab / browser proof
Today report tab exists (reports.js); no E2E/browser QA entry for it.

## Recency
Not touched since the last audit (2026-11-18); tonight's 10 commits were all in the calendar/booking/travel/notes/sync subsystem, outside this feature's located files.

## Open tasks (from the tracker)
- Automated Client Appt Reminders — todo
- Therapist Snapshot — todo

## Reason for the label
Automated Client Appt Reminders has no code at all; Therapist Snapshot has a working backend with one passing integration test but the UI refinement (minimise) the checklist claims is done is not evident. Unchanged from last night.

## Disagreement with the tracker
The tracker checklist ticks "Create minimise function on snapshot" as done, but no matching code could be found — flag this specific checklist item for re-checking, not the whole feature.
