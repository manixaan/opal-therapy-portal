# Opa Mobile Companion

Tracker stage: idea · Tracker environment: none
Evidence label: **proven**
Addressed in this change window: **no** · Created: **yes**

## Located files

`backend/mobile-routes.js` (707 lines) — diary/travel/voice-notes aggregate API for a separate mobile app whose UI lives outside this repo. `backend/case-note-routes.js` — voice-to-case-note drafting API.

Both carry only `requireAuth` — correctly so, per the self-scoped exception in CLAUDE.md. Re-confirmed tonight by grepping the queries directly, not just the header comment: `mobile-routes.js` scopes `voice_notes WHERE id=$1 AND user_id=$2`, `events WHERE id=$1 AND (user_id=$2 OR therapist_profile_id=$3)`, `snapshot_tasks`/`snapshot_reminders WHERE id=$1 AND user_id=$2`. `case-note-routes.js` scopes `case_note_drafts WHERE user_id = $1 AND status = 'draft'` via a `loadOwnDraft` helper used throughout. No unguarded route found.

## Tests

- Unit (4 files): `mobile-routes.test.js`, `case-note-routes.test.js`, `casenotes-compose.test.js`, `casenotes-helpers.test.js` — run tonight as part of a combined 17-file batch with Xero and Inductions; **all 17 files passed, 539/539 tests**.
- Integration (3 files): `case-note-approval-edit.itest.js`, `case-note-client-link.itest.js`, `case-note-deidentification.itest.js` — run tonight on isolated DB `therapy_scheduler_audit_g3_test` as part of a combined 6-file batch with Interactive Assessments; all 6 files passed (132/132). No `*mobile*.itest.js` exists.

## Browser / E2E proof

None, and none expected: the mobile app's own UI lives outside this repository. This evidence is for the backend API surface only.

## Open tasks from the tracker

"Case Noting" (todo), "Calendar View" (todo) — no further detail text.

## Commits in the window touching this feature

None. No commits landed on `develop` since last night's audit — `develop` is still at `40669e7`, the exact commit audited last night and re-verified again tonight.

## Disagreement

None.
