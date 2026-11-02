# Automated Reminders

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed in change window (since 2026-11-01): no
- Created (any located code): partially — see split below

## Reason

The feature's two tasks are at opposite ends of the spectrum, so the
single feature-level label (`tab-unproven`) covers only the half that has
code; the other half is flagged separately as `untouched` below:

- **Therapist Snapshot** — `tab-unproven`. `backend/snapshot-routes.js` is
  guarded (self-scoped by design, documented in its header, matching the
  named exception in `.claude/rules/backend-api.md`) and proven at the API
  level by `tests/integration/snapshot.itest.js` (6/6 passing). The UI is a
  header-icon report modal in `mockup_v3.html` ("Daily & Weekly Snapshot"),
  not a `============ TAB ============` page. No E2E spec names it
  (`e2e/tests/`) and `docs/qa/BROWSER_QA_RESULTS.md` has no entry for
  "snapshot" — nothing proves it renders. This matches the tracker's own
  `claude_update` exactly.
- **Automated Client Appt Reminders** — `untouched`. No 24-hour (or any
  interval) client appointment reminder exists anywhere in the codebase: no
  scheduler/cron job, no SMS/email-reminder sender, no reminder-settings
  table or route. (A broad grep for `sms`/`twilio`/`appointment reminder`
  only matched unrelated substrings inside words like "forms".) This also
  matches the tracker's own `claude_update`.

## Located files

- `backend/snapshot-routes.js` — mounted at `/` (`backend/server.js:586`,
  comment: "Snapshot Day (personal reminders + daily tasks; strictly
  user-scoped)"). `requireAuth` only, self-scoped by design.
- Frontend: report modal `#report-modal` in `frontend/current/mockup_v3.html`
  (around line 22727), opened from the header icon (`openReportPanel`), not a
  tab banner.
- Automated Client Appt Reminders: nothing located.

## Tests and results

| Test | Result |
|---|---|
| `DB_NAME=therapy_scheduler_audit DB_PASSWORD=audit npx jest --config jest.integration.config.js tests/integration/snapshot.itest.js --runInBand` | ✅ 6/6 passed (re-run 2026-11-02, unchanged) |
| Appointment-reminder scheduler/sender | none exists — no test possible |

No unit test file exists specifically for `snapshot-routes.js` (only the
integration test above exercises it).

## Open tasks from the tracker

- Therapist Snapshot — status `todo`; one checklist child
  ("Find where the snapshot lives in the portal") is marked done, the rest
  (confirm utilisation-index formula, improved layout, re-test) are open —
  these are UI/design decisions a person needs to make, not something this
  audit can resolve.
- Automated Client Appt Reminders — status `todo`; every checklist item open,
  including the channel decision (SMS vs email) the tracker's own
  `next_action` already flags.

## Commits in window that touched it

None. No commit since 2026-11-01 touched `snapshot-routes.js`, and there is
still no reminder-sender code to have been touched.

## Disagreement

None — the tracker's own `claude_update` already states the Snapshot is
"fully built and tested but has never been confirmed in a browser" and that
the reminder "hasn't been started at all". The evidence here agrees with
both halves.
