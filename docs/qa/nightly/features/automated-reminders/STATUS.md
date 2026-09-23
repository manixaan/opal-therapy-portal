# Automated Reminders

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven** (mixed — see below, the two tasks are in very different states)
- Addressed in this change window (2026-09-22 → 2026-09-23): no — zero commits landed in this window at all (see §6 of tonight's brief)
- Created (any located code): partially — Therapist Snapshot yes, client appointment reminders no

## Located files

- **Therapist Snapshot** (built): `backend/snapshot-routes.js` — "SNAPSHOT DAY — personal reminders + daily task list," strictly user-scoped by design (the project's own second named example of this pattern, alongside `mobile-routes.js`). No dedicated frontend file — it's embedded directly in `mockup_v3.html`'s header report panel (`openReportPanel('daily', ...)`, "Daily & Weekly Snapshot").
- **Automated Client Appt Reminders** (not found): searched for appointment-reminder, SMS/Twilio, and client-notification code across the backend (`grep -rli "appointment.*reminder|client.*reminder|sms|twilio"`) — the only hits were unrelated (kill-switch retry logic, onboarding cascades, mobile client lookups). No code sends a reminder to a client before their session.

## Guard check

`snapshot-routes.js`: `router.use('/api/snapshot', requireAuth)` — header comment explicitly documents strict user-scoping (`WHERE user_id = req.user.id` on every read/write, no cross-user access for any role including owner, not-yours answers 404) — matches the self-scoped-by-design exception exactly. No guard defect.

## Tests

- Unit: no dedicated `snapshot-routes.test.js` exists.
- Integration (passes): `tests/integration/snapshot.itest.js` — 6 tests, 0 failures.
- Browser/E2E: no mention of "snapshot" or "Today panel" in `docs/qa/BROWSER_QA_RESULTS.md` or either e2e spec.

## Open tasks from the tracker

- "Automated Client Appt Reminders" — `todo`. Notes ask for an SMS/email-style reminder sent to clients 24 hours (editable) before their session, with a confirm step. **Nothing in the codebase implements this** — classify this specific task as `untouched`.
- "Therapist Snapshot" — `todo`. Notes ask to review the existing snapshot and improve its weekly-utilisation-index and daily-sessions display. The backend and integration test exist; the checklist item "Create minimise function on snapshot" is marked done, "Add animation minimising window towards the top right hand side" is not — matching a UI feature that's partially built. No browser/E2E proof of the panel rendering.

## Commits in the window that touched it

None — `develop` did not move at all since last night (both audits sit on `74601fc`). Re-verified
fresh anyway: integration (`snapshot.itest.js`, 6/6) re-run tonight with identical results to last
night — no regression. Still no dedicated unit test file for `snapshot-routes.js`.

## Disagreement

None specific to the tracker stage — but worth flagging that this one tracker card bundles two tasks in very different states (one fully unbuilt, one built-and-tested-but-unproven-in-browser); a person reading only the card's `idea` stage would not see that distinction.
