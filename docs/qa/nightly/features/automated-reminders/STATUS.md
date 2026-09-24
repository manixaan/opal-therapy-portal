# Automated Reminders

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven** (mixed — the two tasks are in very different states)
- Addressed in this change window (2026-09-23 → 2026-09-24): no — zero commits landed in this window at all
- Created (any located code): partially — Therapist Snapshot yes, client appointment reminders no

## Located files

- **Therapist Snapshot** (built): `backend/snapshot-routes.js` — personal reminders + daily task list, strictly user-scoped by design (the project's own named example of that pattern, alongside `mobile-routes.js`). No dedicated frontend tab file — it's the header "Daily & Weekly Snapshot" report panel in `mockup_v3.html`, logic in `frontend/current/reports.js` (`?v=9`).
- **Automated Client Appt Reminders** (not found): grepped for appointment-reminder/SMS/Twilio/client-notification code across `backend/` — no hits beyond unrelated matches (kill-switch retry logic, "24hr" appearing in an unrelated `mobile-routes.js` string). No code sends a reminder to a client before their session.

## Guard check

`snapshot-routes.js`: `router.use('/api/snapshot', requireAuth)` — header documents strict `user_id`-scoping on every query, no cross-user access for any role including owner, not-yours answers 404. Self-scoped by design — no guard defect.

## Tests (re-run fresh tonight)

- Unit: no dedicated `snapshot-routes.test.js` exists. Structural/guard tests that touch `reports.js` (`assessment-surface-guards`, `frontend-stage3-guards`, `frontend-undo-guards`, `frontend-xss-guards`) — 4 suites / 332 tests, all pass.
- Integration: `tests/integration/snapshot.itest.js` — run tonight as part of the Splose/Mobile/Snapshot batch (9 suites / 79 tests, 0 failures) — no regression from last night's isolated 6/6.
- Browser/E2E: no mention of "snapshot" or "Today panel" in `docs/qa/BROWSER_QA_RESULTS.md` or either e2e spec.

## Open tasks from the tracker

- "Automated Client Appt Reminders" — `todo`. Notes ask for an SMS/email-style reminder sent to clients 24 hours (editable) before their session, with a confirm step. Nothing in the codebase implements this.
- "Therapist Snapshot" — `todo`. Notes ask to review/refine the existing snapshot's utilisation-index and daily-sessions display. Backend + integration test exist; no browser/E2E proof of the panel rendering.

## Commits in the window that touched it

None — `develop` sits on `74601fc` again tonight, unchanged since 2026-09-22. Re-verified fresh: integration (`snapshot.itest.js`) re-run tonight with identical (passing) results — no regression.

## Disagreement

None specific to tracker stage vs. evidence — but this one card bundles two tasks in very different states (one fully unbuilt, one built-and-tested-but-unproven-in-browser); the `idea` stage alone doesn't show that split.
