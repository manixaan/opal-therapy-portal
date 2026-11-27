# Automated Reminders

Tracker stage: idea · Tracker environment: none
Evidence label: **built-untested**
Addressed this window (since 2026-11-13): yes — Therapist Snapshot only
Created (any located code): partially — Therapist Snapshot exists, Automated Client Appt
Reminders does not.

## Located files

- **Automated Client Appt Reminders: NOT FOUND.** No client-facing appointment-reminder system
  exists anywhere in the codebase. `backend/credential-reminder.js` exists but is unrelated —
  it is a staff "finish your credentials" nudge on the My Profile setup card and notification
  bell, not a client appointment reminder. There is no SMS/email-to-client scheduler, no
  confirm-step endpoint, and no configurable reminder-time setting.
- **Therapist Snapshot**: `backend/snapshot-routes.js`, `backend/billing/snapshot-hours.js`,
  and — missed on first pass, found while cross-checking the commit log —
  `frontend/current/reports.js`, the actual UI for the "Daily & Weekly Snapshot" report modal
  (`#report-modal`/`#report-overlay`, `mockup_v3.html:24848-24864`, opened via
  `onclick="openReportPanel('daily', this)"` at `mockup_v3.html:4514`).

## Guard check

`snapshot-routes.js`: `router.use('/api/snapshot', requireAuth)`, header documents "STRICTLY
user-scoped: every read and write filters WHERE user_id = req.user.id. There is NO cross-user
access for ANY role." Self-scoped by design, not broken.

## Correction on the "minimise" checklist item

An earlier pass of this audit (checked only against `mockup_v3.html`) wrongly concluded the
"Create minimise function on snapshot" checklist item was false. It is not. The real
implementation lives in `frontend/current/reports.js`: `reportPanelGenie(modal, dir, onDone)`
(lines 99–136) is a genuine, wired-up open/close animation — `openReportPanel()` calls it with
`dir:'in'`, `closeReportPanel()` with `dir:'out'` — that scales and fades the modal via the
`.genie` CSS class (`mockup_v3.html:887`). **The checklist's "done" item is accurate.** The
separate, correctly-unchecked item ("Add animation minimising window towards the top right
hand side") is also accurate: the current animation scales from/to the panel's own centre
(`translate(-50%,-50%) scale(...)`), it does not translate toward a corner. So there is no
tracker/code disagreement here after all.

## Tests

- Unit: no dedicated test exercises `reports.js` (`reportPanelGenie`, the missing-address
  step-through, or the removed panels). The only hits for `reports.js`/`openReportPanel` in
  `backend/tests/` are generic cross-file guard tests (cache-bust pin, XSS-escaping pattern,
  undo pattern) — none test this file's actual behaviour.
- Integration: `snapshot.itest.js`, `snapshot-billable-hours.itest.js` (API only, not the
  frontend panel) — both passed clean as part of the 16-file shared batch.
- No browser/E2E coverage found for the report panel.

## Open tasks (from tracker)

- Automated Client Appt Reminders — todo. Entire checklist unchecked; zero code exists for any
  part of it (storing a reminder time, choosing SMS/email, a confirm step, a scheduler, a
  "mark as reminded" flag).
- Therapist Snapshot — todo overall, but genuinely active this window: a missing-address
  step-through fix exercise was added, and three stale panels (Smart Recommendations,
  quick-action buttons, Free/idle gaps) were removed, per `5e972ee`/`b6ce0fe`/`f6601f3`. The
  "Add animation minimising window towards the top right hand side" item remains open and is
  correctly unchecked.

## Commits in window (since 2026-11-13)

`59b13b1` feat(snapshot): billable hours counted by the invoicing rules · `5e972ee`
feat(reports): missing addresses become a step-through fix exercise · `b6ce0fe` fix(reports):
remove idle gaps from the snapshot, fix missing spaces · `f6601f3` fix(reports): drop Smart
Recommendations, action buttons and Free gaps from the snapshot. No commit touches any
client-reminder code.

## Disagreement

None. (An earlier draft of this STATUS.md incorrectly flagged one; corrected above after
finding `frontend/current/reports.js`, which the first pass missed.)
