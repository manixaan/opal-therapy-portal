# Automated Reminders

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **needs-refinement** (this card actually bundles two unrelated
  things — see split below)
- Addressed this window: no (no commits since 2026-09-27)
- Created at all: partially — the Therapist Snapshot exists; the client
  appointment-reminder feature does not exist at all

## This tracker card is really two separate things

### (a) Client appointment reminders (24hr, editable) — **untouched**
Searched for reminder/notification code tied to client appointments: every
"reminder" hit in the codebase is unrelated (onboarding document-expiry
reminders, case-note reminders, a user's own snapshot task list, CPD/plan
expiry toggles). There is no SMS/email-to-client code, no outbound
notification provider, and no configurable lead-time setting anywhere.
Client appointments live in Splose, not the portal. Nothing to locate.

### (b) Therapist Snapshot (daily/weekly panel) — **needs-refinement**
- Located: `backend/snapshot-routes.js` (mounted `/api/snapshot`,
  `backend/server.js:625`); `frontend/current/reports.js` (the "Daily &
  Weekly Snapshot" modal, triggered from a header icon, not a `TAB` banner —
  it's a cross-tab overlay by design).
- Guard: `requireAuth` only, no role middleware — but the file header
  documents every query scoped to `WHERE user_id = req.user.id`, "NO
  cross-user access for ANY role" → **self-scoped by design**, not broken.
- Tests: `npx jest tests/mobile-routes.test.js` → 41/41 passed.
  `DB_NAME=therapy_scheduler_auditA DB_PASSWORD=audit npx jest --config
  jest.integration.config.js tests/integration/snapshot.itest.js
  --runInBand` → 6/6 passed. `node --check snapshot-routes.js` clean.
- No TODO/FIXME found.
- **Real gap found:** no "utilisation index" metric exists anywhere in
  `reports.js` or `mockup_v3.html` — only an unrelated "billable hours vs
  target" ring and a "Weekly utilisation digest" *email toggle* (a
  notification preference, not a computed index). The tracker's own
  checklist (utilisation-index calc, layout refresh, real-data testing) is
  still genuinely open, not just a review formality.
- No browser/E2E evidence: no Playwright spec and no
  `docs/qa/BROWSER_QA_RESULTS.md` entry mentions the snapshot panel.

## Open tasks from the tracker

- "Automated Client Appt Reminders" (todo) — fully unbuilt per its own
  checklist (nothing checked).
- "Therapist Snapshot" (todo) — "Find where the snapshot lives" and "Create
  minimise function on snapshot" are checked; everything else (utilisation
  index, layout refresh, real-data test) is open.

## Commits in the window

None.

## Disagreement note

Refines the existing `claude_update` guess. That guess said the snapshot
panel is "built and tested but never confirmed in a real browser" — true,
but it understated that the tracker's own checklist points at a real,
unimplemented calculation (the utilisation index), not cosmetic polish. The
reminder half of the guess ("hasn't been started") is confirmed exactly.
