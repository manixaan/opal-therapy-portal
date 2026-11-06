# Automated Reminders (idea: "24Hr Automatic Client Appt Reminders")

- Tracker stage: idea · Tracker environment: none
- Evidence label: **needs-refinement** (two very different sub-tasks — see below), unchanged from
  2026-11-05
- Addressed in this change window (4 commits since the 2026-11-05 audit's cutoff `8853376`:
  `704a51f`, `0a365c4`, `cd8c4a8`, `e3c0b90`): **no** — none of the four touch `snapshot-routes.js`,
  `reports.js`, or any reminder/SMS/email code
- Created (any located code): partial — Snapshot exists, client reminders do not

## History

Real prior audits exist for this feature on 2026-11-01/02/04/05 on `origin/claude/nightly-audit`,
not visible from this run's `origin/develop`-based checkout until recovered onto this branch (see
the 2026-11-05 brief's own "History note" — the same gap it hit). The 2026-11-05 `STATUS.md` found
the same split reported again tonight, independently re-verified rather than carried forward
unchecked:

1. Client appointment reminders — nothing found then, nothing found tonight.
2. Therapist Snapshot — built, self-scoped, one passing integration test, and a checklist item
   ("Create minimise function on snapshot") marked done with no matching code.

## Task: Automated Client Appt Reminders — untouched

Re-grepped tonight for a reminder scheduler/cron, SMS/email provider wiring (twilio, sendgrid,
generic "sms"), and a reminders table/migration — found none. `backend/credential-reminder.js` is
an unrelated feature (nudges a staff member to finish their own credential paperwork, not a
client-facing send). No code exists to act on.

**Classification for this task alone: untouched.**

## Task: Therapist Snapshot — built, guarded, integration-tested, not browser-proven

- Located: `backend/snapshot-routes.js` (mounted in `server.js` as "Snapshot Day — personal
  reminders + daily tasks"), `frontend/current/reports.js` (the header-icon Daily/Weekly Snapshot
  panel: billable-hours progress, travel summary, idle gaps, recommendations), plus report-modal
  markup in `mockup_v3.html`.
- Guard: `router.use('/api/snapshot', requireAuth)` only — correct, not a defect. The file's header
  comment documents every read/write scoped to `WHERE user_id = req.user.id`, no cross-user access
  for any role. Self-scoped by design.
- Tests: no unit test file for `snapshot-routes.js` or `reports.js`. Integration coverage via
  `backend/tests/integration/snapshot.itest.js` → **6/6 passed** tonight (DB
  `therapy_scheduler_audit_a`).
- No browser/E2E evidence the panel renders for a real user.
- Checklist/code disagreement, re-verified tonight: "Create minimise function on snapshot" is
  marked done, but a case-insensitive grep for "minimi" across `reports.js` and `mockup_v3.html`
  still finds zero hits — no minimise logic exists anywhere, same as 2026-11-05. (There is an
  unrelated collapse/expand toggle for the completed-items list, `swToggleCompleted`, persisted via
  `localStorage` — worth noting as the nearest existing interaction, but it is not a minimise
  feature and doesn't make the checklist item accurate.) The separate undone item, "Add animation
  minimising window towards the top right hand side", is correctly left unchecked.

**Classification for this task alone: tab-unproven.**

## Overall feature label

**needs-refinement** — one task hasn't started at all and the tracker's own decisions (SMS vs
email, confirm-step design, configurable lead time) are still open; the other is built and tested
but unproven in a browser, with a known checklist/code mismatch still outstanding. Neither reaches
`proven`.

## Open tracker tasks

- "Automated Client Appt Reminders" (todo) — full decision list still open before any code can
  start.
- "Therapist Snapshot" (todo) — checklist mostly unchecked except the two items above.

## Disagreement

None against the tracker (stage `idea` understates how built the Snapshot half is — the expected
pattern this audit exists to surface, not a disagreement against an inflated claim).
