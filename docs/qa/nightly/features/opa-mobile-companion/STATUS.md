# Opa Mobile Companion

- Tracker stage: **idea**
- Tracker environment: **none**
- Evidence label: **needs-refinement**
- Addressed since the last audit (2026-11-21..2026-11-22): **no**
- Created (any located code): **yes**

## Located files
- backend/mobile-routes.js (self-scoped by design — every query filters by req.user.id, matches the snapshot-routes.js exception, requireAuth alone is correct here)
- backend/case-note-routes.js generateGovernedDraft() — mobile voice notes (voiceNoteId) link into the same governed AI case-note generation pathway used by the desktop Case Notes workspace

## Could not locate / notable gaps
The mobile app's own frontend code lives outside this repository (native app) — nothing here can prove it renders or runs on a device.

## Guard check
OK — self-scoped by design (mobile-routes.js header documents own-day/own-user scoping), re-confirmed.

## Tests run
- unit: `mobile-routes.test.js, case-note-routes.test.js, casenotes-compose.test.js, casenotes-helpers.test.js, casenotes-workspace.test.js` — **pass** (5 files / 171 tests)
- integration: `case-note-approval-edit.itest.js, case-note-client-link.itest.js, case-note-deidentification.itest.js, case-note-workspace.itest.js` — **pass** (4 files / 13 tests)

## Tab / browser proof
N/A — mobile client is outside this repo.

## Recency
Not touched since the last audit (2026-11-21 18:36 UTC) — none of tonight's 7 commits (calendar/booking/travel UI polish plus a Settings gear-icon swap) touched `backend/mobile-routes.js` or `backend/case-note-routes.js`. AI-gateway boundary re-confirmed clean tonight — no stray provider-SDK `require` outside `backend/ai/`.

## Open tasks (from the tracker)
- Case Noting — todo
- Calendar View — todo

## Reason for the label
Both tasks (Case Noting, Calendar View) are todo and the next_action ("run the manual device walkthrough") is open, even though the backend voice-note capture and AI-governed draft generation are built and tested. Unchanged from last night.

## Disagreement with the tracker
Tracker "idea" stage vs. a built, tested, AI-governed backend pathway for this feature.
