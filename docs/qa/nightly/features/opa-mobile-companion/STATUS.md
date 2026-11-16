# Opa Mobile Companion

- Tracker stage: idea | Tracker environment: none
- Evidence label: **proven**
- Created: yes
- Addressed this window: no

## Located files
backend/mobile-routes.js — a thin, aggregated API surface for a mobile companion app (clients, today,
calendar, appointments/:id, travel, voice-notes CRUD). Header comment documents it as deliberately
self-scoped (every endpoint returns only the caller's own day/data, 404 for anything not owned) —
matches the CLAUDE.md-documented self-scoped-by-design exception alongside snapshot-routes.js.
- "Case Noting": voice notes link into case_note_drafts via voiceNoteId (case-note-routes.js).
- "Calendar View": GET /api/mobile/calendar is implemented (day/week range, Perth-timezone-safe).
No separate mobile frontend exists in this repo — the mobile client is evidently a separate app/repo
consuming this API, which is expected and not a gap. (All re-confirmed tonight; unchanged file set.)

## Guard check
requireAuth only — correct; self-scoped-by-design exception applies.

## Tests (re-run fresh tonight)
- Unit: tests/mobile-routes.test.js — 50/50 PASS.
- Integration: tests/integration/case-note-workspace.itest.js — 1 suite / 3 tests PASS
  (DB_NAME=therapy_scheduler_audit_mobile).

## Open tasks (from tracker)
- "Case Noting" — todo (code proves this is built and tested — see above).
- "Calendar View" — todo (code proves this is built and tested — see above).

## Commits in window touching this
None.

## Disagreement
Both open tracker tasks are already done in code — confirms the tracker's own next_action verbatim
("Close both tasks in the tracker"). Reporting the gap only; not changing the tracker.

## Note
No change from the 2026-11-15 audit. Re-verified fresh tonight: same code, same tests, same result.
