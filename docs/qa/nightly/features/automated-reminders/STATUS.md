# Automated Reminders

- Tracker stage: **idea**
- Tracker environment: **none**
- Evidence label: **needs-refinement**
- Addressed since the last audit (2026-11-25..2026-11-26): **yes** — the Snapshot's missing-address flow, idle-gap/Smart-Recommendations removal and spacing fixes all landed; billable-hours (last night's addition) is unchanged
- Created (any located code): **yes**

## Located files
- backend/snapshot-routes.js (self-scoped by design, requireAuth alone OK — header documents every
  query scoped to req.user.id) for the Therapist Snapshot task — unchanged tonight.
- backend/billing/snapshot-hours.js (added last night) — unchanged tonight.
- frontend/current/reports.js (Today report tab) — tonight's three commits, in landing order:
  `f6601f3` dropped Smart Recommendations, the Open Calendar/Book/Logbook/View-week action buttons and
  the Free gaps card from the daily/weekly snapshot, fixed missing spaces in card subtitles
  ("7 clients", "1 item to review"); `b6ce0fe` removed the Free Windows & Idle Gaps section (and its
  lunch-break warning), free-window timeline rows, the per-day "gaps" stat, and the three now-unused
  Report Settings toggles that only drove that panel; `5e972ee` turned every missing-address note into
  a guided step-through fix (daily "Fix all N", each "No address · fix" chip, Needs attention, the
  weekly Missing addr card) that opens the calendar's event panel with the address box focused and a
  Back/Skip/Done progress bar, and changed the missing-address count to follow the calendar's own
  `sessionNeedsFullAddress` rule (a no-address portal booking means "where I already am", no longer
  flagged). `reports.js` is pinned `v=14` in `mockup_v3.html`, matching
  `assessment-surface-guards.test.js` — `scripts/check-asset-pins.js` confirms the match.

## Could not locate / notable gaps
- Automated Client Appt Reminders: NOTHING located again tonight — no appointment-reminder send code
  anywhere in backend/ (fresh grep tonight for appt/appointment/24-hour reminder sends, no hits).
- Therapist Snapshot: no snapshot-specific minimise function found again tonight (fresh grep of
  frontend/current/reports.js — no "minimise"/"Minimise" string at all, and its CSS) — only the
  unrelated minimise on the separate Opa AI assistant chat widget (frontend/current/opa.js). The
  tracker checklist still marks "Create minimise function on snapshot" as done; no matching code
  exists. This disagreement persists unchanged, now confirmed across twelve audit nights (2026-11-15
  through 2026-11-26) — tonight's three commits were about the missing-address flow and dropping
  stale panels, not the minimise UI, so they do not touch this gap either way.
- No unit test exists specifically for backend/billing/snapshot-hours.js's own pure calculation logic
  (confirmed again by a fresh grep of tests/*.test.js tonight) — it is exercised only through the
  integration test below. Unchanged from last night's finding.

## Guard check
OK (snapshot-routes.js) — self-scoped by design, re-confirmed; no route changed tonight (all three
commits are frontend-only plus a shared asset-pin bump). `node --check` clean on
`frontend/current/reports.js`. No TODO/FIXME in it.

## Tests run
- integration: `snapshot.itest.js, snapshot-billable-hours.itest.js` — **pass** (2 files / 9 tests,
  re-run fresh tonight, exact match to last night)
- unit: no test exists for snapshot-routes.js or billing/snapshot-hours.js specifically (confirmed
  again, none) — **no test exists** (—). The frontend guard tests that read reports.js
  (`assessment-surface-guards.test.js`, `frontend-stage3-guards.test.js`, `frontend-undo-guards.test.js`,
  `frontend-xss-guards.test.js`) all re-ran fresh tonight — 85 + 294 + a combined 56 tests across the
  latter three (729 total across the four files) — all pass.

## Tab / browser proof
Today report tab exists (reports.js); no E2E/browser QA entry for it, and none landed tonight for the
missing-address step-through or the panel removals specifically.

## Recency
**Addressed tonight.** Three commits, all 2026-11-26, in landing order:
`fix(reports): drop Smart Recommendations, action buttons and Free gaps from the snapshot`,
`fix(reports): remove idle gaps from the snapshot, fix missing spaces`,
`feat(reports): missing addresses become a step-through fix exercise`. No risk note on any of the
three (no backend, no guard, no new route — UI-only).

## Open tasks (from the tracker)
- Automated Client Appt Reminders — todo
- Therapist Snapshot — todo

## Reason for the label
Automated Client Appt Reminders has no code at all; Therapist Snapshot gained real, guarded, tested UI
progress again tonight (missing-address guided fix, dead-panel removal) but the checklist/code mismatch
on the minimise function is untouched and the task itself stays `todo`. `needs-refinement`.

## Disagreement with the tracker
The tracker checklist ticks "Create minimise function on snapshot" as done, but no matching code could
be found — flag this specific checklist item for re-checking, not the whole feature. Unrelated to
tonight's work.
