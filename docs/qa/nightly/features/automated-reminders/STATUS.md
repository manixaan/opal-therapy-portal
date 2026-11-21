# Automated Reminders

- Tracker stage: **idea**
- Tracker environment: **none**
- Evidence label: **needs-refinement**
- Addressed since the last audit (2026-11-20..2026-11-21): **no**
- Created (any located code): **yes**

## Located files
- backend/snapshot-routes.js (self-scoped by design, requireAuth alone OK — header documents every query scoped to req.user.id) for the Therapist Snapshot task
- frontend/current/reports.js consumes /api/snapshot (Today report tab)

## Could not locate / notable gaps
- Automated Client Appt Reminders: NOTHING located again tonight — no appointment-reminder send code anywhere in backend/ (fresh grep for appointment/appt reminder, 24-hour reminder sends).
- Therapist Snapshot: no snapshot-specific minimise function found again tonight (only the unrelated minimise on the separate Opa AI assistant chat widget, frontend/current/opa.js:202,636) — the tracker checklist still marks "Create minimise function on snapshot" as done, but no matching code exists. **New nuance tonight**: `frontend/current/reports.js` does have a collapse/toggle for the Snapshot panel's "Completed" sub-list (`swCompletedCollapsed()` / `swToggleCompleted()`), but nothing minimises/collapses the whole Snapshot widget — the checklist item is ambiguous between the two, and only the narrower one exists. This disagreement persists unchanged, now confirmed across seven audit nights (2026-11-15 through 2026-11-21).

## Guard check
OK (snapshot-routes.js) — self-scoped by design, re-confirmed.

## Tests run
- integration: `snapshot.itest.js` — **pass** (1 file / 6 tests)
- unit: no test exists for snapshot-routes.js specifically (confirmed again, none) — **no test exists** (—)

## Tab / browser proof
Today report tab exists (reports.js); no E2E/browser QA entry for it.

## Recency
Not touched since the last audit (2026-11-20) — of the 77 commits that landed in `backend/` or `frontend/current/` between 18:52 UTC 2026-11-20 and tonight's audit, none touched `backend/snapshot-routes.js`, `frontend/current/reports.js`'s Snapshot logic, or any appointment-reminder path. (A separate, unrelated 2-line change to `reports.js` this window delegates its time-format helper to the shell's shared `fmtTime` — see Report Templates' folder; it does not touch the Snapshot/minimise code.)

## Open tasks (from the tracker)
- Automated Client Appt Reminders — todo
- Therapist Snapshot — todo

## Reason for the label
Automated Client Appt Reminders has no code at all; Therapist Snapshot has a working backend with one passing integration test but the UI refinement (minimise) the checklist claims is done is not evident (only a narrower "Completed" list collapse exists). Unchanged from last night.

## Disagreement with the tracker
The tracker checklist ticks "Create minimise function on snapshot" as done, but no matching code could be found — flag this specific checklist item for re-checking, not the whole feature.
