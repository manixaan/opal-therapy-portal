# Automated Reminders

Tracker stage: idea · Tracker environment: none
Evidence label: **built-untested**
Addressed since last audit (2026-11-26, commit `f5fc28d`): no — zero new commits tonight
Created (any located code): partially — Therapist Snapshot exists, the client-facing
reminder system does not.

This card bundles two unrelated things: a client-facing appointment reminder
system (not built), and the Therapist Snapshot panel (built, lightly tested).

## Located files
- Client reminders: **none found anywhere.** Searched for
  `sendReminder`/`ReminderScheduler`/appointment-confirmation patterns across
  every backend file — nothing. `mobile-routes.js`'s `reminder_candidate` note
  type and `snapshot_reminders` are personal to-dos for the therapist, not
  client-facing messages. There is no SMS/email-to-client scheduler, no
  confirm-step endpoint, and no configurable reminder-time setting.
- Therapist Snapshot: `backend/snapshot-routes.js` (self-scoped by design —
  its own header says "STRICTLY user-scoped ... no cross-user access for ANY
  role"), `frontend/current/reports.js` — the UI for the Daily & Weekly
  Snapshot report modal (`#report-modal`/`#report-overlay`).

## Guard check
`snapshot-routes.js` is correctly self-scoped by design. No client-reminder
code exists to check.

## The minimise animation, verified
The checklist's "Create minimise function on snapshot" (marked done) maps to
a real function, `reportPanelGenie(modal, dir, onDone)` in `reports.js`
(lines 99–136). Verified directly tonight: `openReportPanel()` calls it with
`dir:'in'` (line 159), `closeReportPanel()` calls it with `dir:'out'`
(line 208) — it is genuinely wired into both open and close, not dead code.
The separate, correctly-unchecked checklist item ("Add animation minimising
window towards the top right hand side") is also accurate on inspection: the
current animation scales from/to the panel's own centre, not toward a corner.
No automated test and no `docs/qa/BROWSER_QA_RESULTS.md` entry exercises this
visually — the confirmation above is from reading the code, not from seeing
it render in a browser, and this audit did not start a local server tonight
to check that (doing so risks outbound calls at boot to Azure/Splose/Xero/
Outlook, which this audit's hard limits forbid touching).

## Tests and results (run tonight)
- Unit: **none** for `snapshot-routes.js` or `reports.js`'s panel behaviour —
  confirmed by grepping every `tests/*.test.js` file; the only hits are
  generic cross-file guard tests (cache-bust pin, XSS-escaping pattern) that
  don't exercise this file's actual behaviour.
- Integration (`DB_NAME=therapy_scheduler_audit`): `snapshot.itest.js` +
  `snapshot-billable-hours.itest.js` = 2 suites / **9 passed** (API only, not
  the frontend panel).
- `node --check`: OK. No TODO/FIXME found.

## Open tasks from the tracker
- **Automated Client Appt Reminders** (todo) — checklist entirely unchecked;
  nothing has been built for any part of it.
- **Therapist Snapshot** (todo) — the minimise-animation checklist item is
  correctly marked done (confirmed above); "add the animation towards the top
  right" is correctly still open; confirming the utilisation-index metric and
  testing with real data remain open too.

## Disagreement
None — the tracker's checklist for the minimise function is accurate, not a
disagreement.

## Commits since last audit (2026-11-26, commit f5fc28d)
None touch the Snapshot half, and none exist for the (non-existent)
client-reminder half.

## Recommendation
Split this card. The client-reminder system and the Therapist Snapshot panel
share nothing but a vague "reminder" word in the title.
