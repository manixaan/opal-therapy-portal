# Opa Mobile Companion

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **needs-refinement** (both pieces are built, guarded and tested; the tracker's own next_action — confirm a real mobile client calls these APIs — is still open, which this repo alone cannot close)
- Addressed in change window (since last audit, 2026-10-24): no — no commit this window touched `case-note-routes.js`, `clinical-note-provider.js` or `mobile-routes.js`
- Created (code exists): yes

## Located files
### Case Noting
- `backend/case-note-routes.js` (`/api/mobile/case-note-drafts`, `/api/mobile/ai/case-note`), backed by `backend/clinical-note-provider.js`, which correctly routes through `backend/ai/ai-gateway.js` and `backend/ai/deidentify.js` — no vendor SDK bypass.
- AI policy: `clinical_note_generation` is registered in `backend/ai/ai-policy.js` — compliant with the no-default-policy rule.
- Guard: `requireAuth` only; file header explicitly documents strict `user_id` scoping ("not-yours answers 404, no role — owner included — can read another user's drafts") — **self-scoped by design**, not a missing guard.

### Calendar View
- `backend/mobile-routes.js`: `GET /api/mobile/calendar`, `/api/mobile/travel`, `/today`, `/appointments/:id`, `/clients`, `/voice-notes`. Travel/maps data reads locally stored `travel_time_minutes`/`travel_distance` — never recalculated or fetched externally.
- Guard: `requireAuth` only, header documents self-scoping (caller's own day/appointments, 404 for anything not owned) — **self-scoped by design**.

## Tests and results
- Case Noting: `tests/case-note-routes.test.js` (unit) — **pass** (re-run tonight); `tests/integration/case-note-client-link.itest.js`, `tests/integration/case-note-deidentification.itest.js` (integration) — **all pass** (re-run tonight).
- Calendar View: `tests/mobile-routes.test.js` (unit) — **pass** (re-run tonight). No integration test file matched "mobile". Note: tonight's "Make room" booking commits touched `frontend/current/travel.js` (desktop booking panel), not `mobile-routes.js` or its calendar view.
- No TODO/FIXME found in either route file.

**No mobile client codebase exists in this repository** — no React Native/Flutter/iOS project directory. Nobody can verify from this repo alone that a real mobile client successfully calls these APIs; that verification has to happen against the actual mobile app, outside this checkout. No E2E specs or `docs/qa/BROWSER_QA_RESULTS.md` entries mention mobile or case-note (expected — it's a native app, not browser-testable here).

## Open tasks from the tracker
"Case Noting" (todo, detailed manual-testing checklist on the real device) and "Calendar View" (todo, no notes).

## Commits in window that touched it
None directly. (See note above on the unrelated booking-panel commits.)

## Disagreement
None against tracker stage. The gap matches the tracker's own next_action: confirm with the real mobile client codebase that it successfully calls these APIs — something only verifiable from outside this repository.

## Re-verified 2026-10-27
No commit since last night's audit (`896ace1`) touched this feature's files — the true window (`896ace1..41f45ed`) holds only Calendar sync-settings/Outlook/Splose work (see Portal - Splose - Outlook's folder). Re-ran `mobile-routes.test.js` (41/41) and `clinical-note-provider.test.js` (10/10) tonight — same as last night. Evidence label unchanged.

## Re-verified 2026-10-28
Real window tonight is `41f45ed..15acf0c` (travel desk-work, place-names autocomplete, a
dependency patch — see the morning brief §6); none of it touches `case-note-routes.js`,
`clinical-note-provider.js` or `mobile-routes.js`. Re-ran `case-note-routes.test.js`,
`mobile-routes.test.js`, `clinical-note-provider.test.js` (unit, all pass) and
`case-note-client-link.itest.js`/`case-note-deidentification.itest.js` (integration,
both pass) tonight. No mobile-client codebase still exists in this repository to
confirm real-device calls. Evidence label unchanged.
