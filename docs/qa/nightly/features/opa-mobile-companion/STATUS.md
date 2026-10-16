Feature: Opa Mobile Companion
Tracker stage: idea
Tracker environment: none
Evidence label: needs-refinement
Addressed in change window (2026-10-02 to 2026-10-16): no
Created (any located code): yes

## Located files
- Case Noting: `backend/mobile-routes.js` (`router.use('/api/mobile', requireAuth)`,
  self-scoped by design — header comment explicitly documents "every
  endpoint returns the CALLER'S OWN day only... Anything not owned by the
  caller answers 404"), `backend/case-note-routes.js`
  (`router.use('/api/mobile/case-note-drafts', requireAuth)` and
  `router.use('/api/mobile/ai/case-note', requireAuth)`),
  `backend/clinical-note-provider.js` (goes through `require('./ai/ai-gateway')`
  — confirmed by `ai-gateway-boundary.test.js:196` and
  `ai-single-gateway-guards.test.js:158/172`, which assert exactly this
  wiring).
- Calendar View: `GET /api/mobile/calendar?date=&range=day|week` already
  exists at `backend/mobile-routes.js:417`, with unit test coverage
  (`mobile-routes.test.js` lines 234, 362–404). **This contradicts the
  tracker's own claim that Calendar View "hasn't been started at all" —
  a backend endpoint for it already exists and is tested.** No mobile
  frontend lives in this repository (the mobile app is a separate
  native/PWA project), so nothing here proves it renders on the device.

## AI governance (Case Noting)
`docs/mobile/CASE_NOTE_AI_PRIVACY.md` documents de-identification (a
names-check flow using role tokens), Australian-only Bedrock regions
(`ap-southeast-2`/`ap-southeast-4`), three guards against offshore model
drift, a fail-closed default (`503` if not configured), and audit logging
that never carries clinical content. Backed by
`tests/clinical-note-provider.test.js`.

## Guard check
Pass — self-scoped by design (documented), AI calls correctly routed
through the single gateway.

## Tests run
- Unit: `mobile-routes`, `case-note-routes`, `casenotes-compose`,
  `casenotes-helpers`, `clinical-note-deidentify`, `clinical-note-provider`
  → 6 suites / 160 tests, all PASS
- Integration (`DB_NAME=therapy_scheduler_audit`): `case-note-client-link.itest.js`,
  `case-note-deidentification.itest.js` → both PASS

## Browser / E2E evidence
None — this is a native/separate mobile app, not part of this repo's
Playwright suite. The tracker itself says Ann's hands-on device sign-off
is still needed, which this audit cannot perform.

## Open tasks from tracker
- Case Noting [todo]
- Calendar View [todo]

## Commits in window touching this feature
None.

## Disagreement with tracker
The tracker's prior Claude update says Calendar View "hasn't been started
at all", but a backend endpoint for it (`GET /api/mobile/calendar`)
already exists and is unit-tested. The tracker underclaims here — the
opposite of the overclaiming disagreement this audit normally flags —
but it changes the real next step: the backend piece is done; only the
mobile-app frontend, which lives outside this repository, remains.
