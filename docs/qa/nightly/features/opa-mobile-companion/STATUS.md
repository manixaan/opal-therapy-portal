# Opa Mobile Companion

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **proven**
- Addressed in change window (2026-11-12 to 2026-11-13): no — zero commits since the 2026-11-12 audit
- Created (any code located): yes — API surface only; the mobile app itself is not in this repository

## Located files

- Routes: `backend/mobile-routes.js`, `backend/case-note-routes.js`
- AI layer: `backend/clinical-note-provider.js` — the only caller of `backend/ai/ai-gateway.js` for this feature; boundary re-confirmed respected tonight
- Data access: inline SQL (`voice_notes`, `events`, `snapshot_*` tables); `backend/case-note-pdf.js`, `backend/case-note-style.js`
- Frontend: **none found in this repository**, re-confirmed tonight.
- Unit tests: `mobile-routes.test.js`, `case-note-routes.test.js`, `casenotes-compose.test.js`, `casenotes-helpers.test.js`
- Integration tests: `case-note-approval-edit.itest.js`, `case-note-client-link.itest.js`, `case-note-deidentification.itest.js`
- E2E: none (no app to drive from this repo).

## Guard check

Re-confirmed tonight by direct grep, unchanged. `mobile-routes.js:41` — `requireAuth` only, file header documents every endpoint as scoped to the caller's own `user_id`/`therapist_profile_id` — self-scoped by design. `case-note-routes.js:52,56` — same pattern.

## AI governance — re-verified

`clinical-note-provider.js` still fails closed without `CLINICAL_NOTE_AI_ENABLED` plus a key, restricted to an Australian Bedrock region — `docs/mobile/CASE_NOTE_AI_PRIVACY.md` unchanged.

## Tests run

- Unit: re-run tonight as part of a 37-suite/684-test group — **all pass** (deliberate `ERROR`-level log lines for simulated `ECONNREFUSED`/disk-failure/`ECONNRESET` scenarios are intentional failure-path tests)
- Integration: re-run tonight — 3 files, included in a 7-suite/47-test run — **all pass**

## Open tasks from tracker

- "Case Noting" — `todo`. Explicitly a human-on-the-device testing task.
- "Calendar View" — `todo`, no further detail recorded.

## Why proven, not tab-unproven

Unchanged for a fifth consecutive night: there is no in-repo tab to drive with Playwright — the mobile app lives outside this repository. Self-scoped guards re-verified + passing unit/integration tests = `proven` for the backend surface this repo actually contains.

## Disagreement

None in the formal sense. Standing note, unchanged: this repository holds only the backend API for a mobile-app pilot the tracker describes as "currently built" — the actual pilot app isn't here to verify.

## Commits in window touching it

None this window.
