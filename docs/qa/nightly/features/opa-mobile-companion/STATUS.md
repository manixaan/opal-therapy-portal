# Opa Mobile Companion

Tracker stage: idea · Tracker environment: none
Evidence label: **proven**
Addressed in this change window: **yes** · Created: **yes**

## Located files

`backend/mobile-routes.js` (707 lines) — diary/travel/voice-notes aggregate API for a separate mobile app whose UI lives outside this repo. `backend/case-note-routes.js` — voice-to-case-note drafting API.

Both carry only `requireAuth` (no `requirePermission`/`requireRole`) — correctly so, per the self-scoped exception in CLAUDE.md. `mobile-routes.js`'s header explicitly claims every endpoint returns only the caller's own day; spot-checked and confirmed: `voice_notes WHERE id=$1 AND user_id=$2`, `events WHERE id=$1 AND (user_id=$2 OR therapist_profile_id=$3)`, `snapshot_tasks`/`snapshot_reminders WHERE id=$1 AND user_id=$2`. `case-note-routes.js`'s header makes the same claim for `case_note_drafts` ("Strictly user-scoped... no role — owner included — can read another user's drafts"); confirmed via `WHERE user_id = $1 AND status = 'draft'` and `loadOwnDraft` used throughout. Worth flagging once: these are clinical drafts about clients, gated purely by *draft ownership* rather than a clinical-role permission check — a materially different guarantee than `fca-routes.js`/`letter-routes.js`'s `requireClinicalRead/Write`, though consistent with the file's own documented design. No TODO/FIXME.

## Tests

- Unit (4 files): `mobile-routes.test.js`, `case-note-routes.test.js`, `casenotes-compose.test.js`, `casenotes-helpers.test.js` — **163/163 pass**
- Integration (3 files): `case-note-approval-edit.itest.js`, `case-note-client-link.itest.js`, `case-note-deidentification.itest.js` — **10/10 pass**. No `*mobile*.itest.js` exists.

## Browser / E2E proof

None, and none expected: the mobile app's own UI lives outside this repository, so there is no portal tab to prove with E2E/browser QA here. This evidence is for the backend API surface only (consistent with how this feature has always been evaluated).

## Open tasks from the tracker

"Case Noting" (todo), "Calendar View" (todo) — no further detail text.

## Commits in the window touching this feature

`a56173c` (editing an approved note sends it back for approval), `22e68b7` (one editable note, Copy note, Download PDF on Opal letterhead), `e1af24e` (the phone diary matches the portal calendar).

## Disagreement

None.
