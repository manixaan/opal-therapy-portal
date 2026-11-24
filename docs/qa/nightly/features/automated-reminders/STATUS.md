# Automated Reminders

- Tracker stage: **idea**
- Tracker environment: **none**
- Evidence label: **needs-refinement**
- Addressed since the last audit (2026-11-23..2026-11-24): **no**
- Created (any located code): **yes**

## Located files
- backend/snapshot-routes.js (self-scoped by design, requireAuth alone OK — header documents every query scoped to req.user.id) for the Therapist Snapshot task
- frontend/current/reports.js consumes /api/snapshot (Today report tab)

## Could not locate / notable gaps
- Automated Client Appt Reminders: NOTHING located again tonight — no appointment-reminder send code anywhere in backend/ (fresh grep for appointment/appt reminder, 24-hour reminder sends).
- Therapist Snapshot: no snapshot-specific minimise function found again tonight (only the unrelated minimise on the separate Opa AI assistant chat widget, frontend/current/opa.js:202,636) — the tracker checklist still marks "Create minimise function on snapshot" as done, but no matching code exists. `frontend/current/reports.js` does have a collapse/toggle for the Snapshot panel's "Completed" sub-list (`swCompletedCollapsed()` / `swToggleCompleted()`), but nothing minimises/collapses the whole Snapshot widget. This disagreement persists unchanged, now confirmed across ten audit nights (2026-11-15 through 2026-11-24).

## Guard check
OK (snapshot-routes.js) — self-scoped by design, re-confirmed.

## Tests run
- integration: `snapshot.itest.js` — **pass** (1 file / 6 tests, re-run fresh tonight)
- unit: no test exists for snapshot-routes.js specifically (confirmed again, none) — **no test exists** (—)

## Tab / browser proof
Today report tab exists (reports.js); no E2E/browser QA entry for it.

## Recency
Not touched since the last audit. Two commits landed elsewhere in the repo tonight (21:42 UTC 2026-11-23, after last night's 18:35 UTC audit): the mobile drag-to-move feature and the `event-move.js` calendar-save refactor (see Opa Mobile Companion and Portal - Splose - Outlook's folders) — neither touched this subsystem's files.

## Open tasks (from the tracker)
- Automated Client Appt Reminders — todo
- Therapist Snapshot — todo

## Reason for the label
Automated Client Appt Reminders has no code at all; Therapist Snapshot has a working backend with one passing integration test but the UI refinement (minimise) the checklist claims is done is not evident (only a narrower "Completed" list collapse exists). Unchanged from last night, now confirmed ten nights running.

## Disagreement with the tracker
The tracker checklist ticks "Create minimise function on snapshot" as done, but no matching code could be found — flag this specific checklist item for re-checking, not the whole feature.
