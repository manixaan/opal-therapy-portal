# Automated Reminders

- Tracker stage: idea · Tracker environment: none
- Evidence label: **needs-refinement** (mixed — one sub-part tab-unproven, one untouched; see breakdown)
- Addressed since the last audit (develop unchanged since 2026-10-28, also commit `15acf0c`): no.
- Created (any located code): partially — Therapist Snapshot exists; the 24-hour client reminder does not.

## Located

- **Therapist Snapshot:** `backend/snapshot-routes.js`, frontend moved to `frontend/current/reports.js` (per a comment in `tests/frontend-stage3-guards.test.js:26`: "Daily & Weekly Snapshot: its CODE moved to reports.js").
- **Automated Client Appt Reminders (24hr pre-appointment reminder to clients):** not found. Searched `24.hour.*reminder`, `appt.*reminder`, `appointment.*reminder`, `client.*reminder` across `backend/` and `frontend/current/` — every hit is unrelated (internal staff `snapshot_reminders`/`snapshot_tasks`, credential-expiry and work-location reminders, a one-line comment in `travel.js`: "Client reminders around leave come later"). Nothing sends an automated reminder to an NDIS client ahead of their appointment.

## Guard check

`snapshot-routes.js`'s header comment explicitly documents every query scoped to `req.user.id`/`req.session.userId`, "NO cross-user access for ANY role" — self-scoped by design, matching the CLAUDE.md exception.

## Tests and results

| Command | Result |
|---|---|
| `npx jest tests/frontend-stage3-guards.test.js` | PASS — 289 tests |
| `DB_NAME=therapy_scheduler_audit_g1 npx jest --config jest.integration.config.js tests/integration/snapshot.itest.js --runInBand` | PASS — 6 tests |
| `node --check snapshot-routes.js` | OK |
| test for "Automated Client Appt Reminders" | **none exists — there is no code to test** |

## Commits in window touching located files

None. No commit touches `snapshot-routes.js` or `frontend/current/reports.js`; none relate to a client-facing reminder feature.

## Breakdown

- **Therapist Snapshot: tab-unproven** — API located, guarded, fully covered by passing tests, but none of `e2e/tests/portal.spec.js`, `e2e/tests/tutorials.spec.js`, or `docs/qa/BROWSER_QA_RESULTS.md` (flows A-J) exercise the Daily/Weekly report panel in a browser.
- **Automated Client Appt Reminders: untouched** — zero matching code anywhere; this feature has not been started.

## Open tracker tasks

`[todo]` Automated Client Appt Reminders — not started, a decision on channel/scope is needed before any code is written. `[todo]` Therapist Snapshot — needs a browser or E2E check to move past tab-unproven.

## Disagreement / notes

Agree with the prior claude_update on both counts, independently verified.
