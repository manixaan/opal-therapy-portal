# Opa Mobile Companion

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **proven**
- Addressed in change window (2026-11-13 to 2026-11-14): yes (case-note-routes.js, shared with the
  desktop Case Notes workspace — see below)
- Created at all: yes

## Located files

- Routes: `backend/mobile-routes.js` (today/calendar/travel/voice-notes,
  explicitly "the Opa Mobile Companion app" per its own header comment),
  `backend/case-note-routes.js` (the governed AI case-note drafting the
  mobile app calls into: `POST /api/mobile/case-note-drafts/generate`,
  deprecated alias `POST /api/mobile/ai/case-note`)
- AI: `backend/clinical-note-provider.js` (Bedrock, Australian regions only,
  de-identified transcript, documented in `docs/mobile/
  CASE_NOTE_AI_PRIVACY.md` and `CLINICAL_AI_PROVIDER_DECISION.md`)
- Frontend/standalone app: none in this repository — the mobile app itself
  is a separate client that consumes this API; there is no tab or page
  here to prove in a browser.
- Unit tests: `tests/mobile-routes.test.js`, `tests/case-note-routes.test.js`,
  `tests/clinical-note-provider.test.js`
- Integration tests: `tests/integration/case-note-approval-edit.itest.js`,
  `tests/integration/case-note-client-link.itest.js`,
  `tests/integration/case-note-deidentification.itest.js`,
  `tests/integration/case-note-workspace.itest.js`

## Guard check

`mobile-routes.js`: `router.use('/api/mobile', requireAuth)` only, no
`requireRole`/`requirePermission` — but its header comment explicitly
documents every query as `user_id`-scoped ("Tasks/reminders/voice notes are
user_id-scoped exactly like snapshot-routes.js. Anything not owned by the
caller answers 404"), which is the exact exception named for this file in
the audit rules. **Self-scoped by design, not broken.**
`case-note-routes.js`: `router.use('/api/mobile/case-note-drafts',
requireAuth)` and `router.use('/api/mobile/ai/case-note', requireAuth)`,
plus client/event ownership checks inside the generation handler. No
finding.

## Tests run

- Unit: 123/123 passed (`case-note-routes.test.js` + `mobile-routes.test.js`).
- Unit (AI path): `clinical-note-provider.test.js` 10/10 passed.
- AI gateway boundary (touched by this feature): `ai-gateway-boundary.test.js`
  + `ai-single-gateway-guards.test.js` 30/30 passed — the clinical-note
  provider still goes through the single governed gateway.
- Integration: 13/13 passed (4 suites), against
  `therapy_scheduler_audit_test`.

## Recency

`e222a77` (this window) added the case-noting workspace used from the
desktop Case Notes tab; it extends `case-note-routes.js`, the same file the
mobile companion's AI drafting shares, without changing the mobile contract
(migration 088 only adds an optional `nf2f_event_id` column).

## Classify

`proven`. Code located, guarded (self-scoped by design), every targeted
unit/integration test passes, including the AI-gateway boundary tests for
the clinical-note generation path. There is no portal tab or page for this
feature — the mobile app is an external client — so the tab/E2E condition
in the `proven` definition does not apply.

## Open tasks (from tracker)

- Case Noting — todo. The task's own text says this is a review/verification
  task ("This task is about testing and verifying that pilot works") rather
  than a build task — tonight's test run is exactly that verification, and
  it passed.
- Calendar View — todo. `GET /api/mobile/calendar` and `GET
  /api/mobile/today` are built, guarded and tested.

## Commits in the window touching this

`e222a77` (above). `e77102f` merge also touched `case-note-routes.js`
indirectly (release merge).

## Disagreement

Tracker stage `idea`, both tasks `todo`, but the pilot both tasks describe
is already built, governed (AI de-identification, Australian-region
Bedrock, fail-closed) and passing every targeted test. Recommend closing
both tasks in the tracker rather than treating this as unstarted work.
