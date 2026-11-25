# Automated Reminders

- Tracker stage: **idea**
- Tracker environment: **none**
- Evidence label: **needs-refinement**
- Addressed since the last audit (2026-11-24..2026-11-25): **yes** — the Therapist Snapshot task's billable-hours figure now follows invoicing's own rules
- Created (any located code): **yes**

## Located files
- backend/snapshot-routes.js (self-scoped by design, requireAuth alone OK — header documents every
  query scoped to req.user.id) for the Therapist Snapshot task — tonight added
  `GET /api/snapshot/billable-hours`.
- backend/billing/snapshot-hours.js (new tonight) — read-only; applies invoicing's own selection/
  eligibility/held-for-review rules plus the NDIS travel-allocation rule book to the viewer's Perth-day
  diary, rather than guessing from Outlook categories as before.
- frontend/current/reports.js consumes `/api/snapshot` (Today report tab) — tonight's changes wire up
  the new billable-hours figure; also fixed Perth-date keying (previously showed yesterday before
  8am), Mon–Sun week coverage, DAY_DATES actually being read, and Meetings excluded from billable.

## Could not locate / notable gaps
- Automated Client Appt Reminders: NOTHING located again tonight — no appointment-reminder send code
  anywhere in backend/ (fresh grep tonight for appt/appointment/24-hour reminder sends, no hits).
- Therapist Snapshot: no snapshot-specific minimise function found again tonight (fresh grep of
  frontend/current/reports.js and its CSS) — only the unrelated minimise on the separate Opa AI
  assistant chat widget (frontend/current/opa.js). The tracker checklist still marks "Create minimise
  function on snapshot" as done; no matching code exists. This disagreement persists unchanged, now
  confirmed across eleven audit nights (2026-11-15 through 2026-11-25) — tonight's commit was about
  billable-hours accuracy, not the minimise UI, so it does not touch this gap either way.
- No unit test exists specifically for the new backend/billing/snapshot-hours.js module (confirmed by
  a fresh grep of tests/*.test.js tonight) — it is exercised only through the integration test below.

## Guard check
OK (snapshot-routes.js) — self-scoped by design, re-confirmed; the new billable-hours route follows
the same pattern, read-only, no new guard needed. `node --check` clean on
backend/billing/snapshot-hours.js and backend/snapshot-routes.js. No TODO/FIXME in either file.

## Tests run
- integration: `snapshot.itest.js, snapshot-billable-hours.itest.js` — **pass** (2 files / 9 tests,
  re-run fresh tonight; `snapshot-billable-hours.itest.js` is new tonight)
- unit: no test exists for snapshot-routes.js or billing/snapshot-hours.js specifically (confirmed
  again, none) — **no test exists** (—). The frontend guard tests that read reports.js
  (`assessment-surface-guards.test.js`, `frontend-stage3-guards.test.js`, `frontend-undo-guards.test.js`,
  `frontend-xss-guards.test.js`) all re-ran fresh tonight as part of other features' batches and pass.

## Tab / browser proof
Today report tab exists (reports.js); no E2E/browser QA entry for it, and none landed tonight for the
new billable-hours figure specifically.

## Recency
**Addressed tonight.** One commit, `feat(snapshot): billable hours counted by the invoicing rules`
(2026-11-25), added the new `billing/snapshot-hours.js` module and wired it into both the route and
the frontend report.

## Open tasks (from the tracker)
- Automated Client Appt Reminders — todo
- Therapist Snapshot — todo

## Reason for the label
Automated Client Appt Reminders has no code at all; Therapist Snapshot's billable-hours figure is now
backed by invoicing's own rules (real progress, with a passing integration test) but the checklist/code
mismatch on the minimise function is untouched and the task itself stays `todo`. `needs-refinement`.

## Disagreement with the tracker
The tracker checklist ticks "Create minimise function on snapshot" as done, but no matching code could
be found — flag this specific checklist item for re-checking, not the whole feature. Unrelated to
tonight's billable-hours work.
