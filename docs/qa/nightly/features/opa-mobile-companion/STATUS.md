# Opa Mobile Companion

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **needs-refinement** (bundles two sub-things — see split
  below)
- Addressed this window: no (no commits since 2026-09-27)
- Created at all: partially — Case Noting exists; Calendar View does not

## Naming note

`backend/opa-routes.js` is **not** the mobile companion — its header says
"OPA AI ASSISTANT ROUTES ... help, feature knowledge"; it's the desktop
Portal's in-app chat widget (`/api/opa`), confusingly sharing the "Opa"
brand name. The actual mobile-companion backend is **`backend/mobile-routes.js`**
("MOBILE API — thin, aggregated surface for the Opa Mobile Companion app").
The mobile app's own frontend is **not in this repo** — its planning docs
live in a separate mobile repo. So no frontend/browser proof of the mobile
screens can exist in this repo by construction.

## (a) Case Noting (dictation → AI clinical-pathway summary → save) — code: proven

- Located: `backend/mobile-routes.js` (`/api/mobile/today`, `/calendar`,
  `/appointments/:id`, `/travel`, `/clients`, `/voice-notes*`),
  `backend/case-note-routes.js` (voice-to-case-note drafting, mounted
  `/api/mobile/case-note-drafts` + legacy alias `/api/mobile/ai/case-note`).
- AI: `backend/ai/ai-policy.js` — `clinical_note_generation` IS registered
  (CLINICAL classification, AU region only, Bedrock/mock only, mandatory
  de-identification, output always requires human review).
  `clinical-note-provider.js` calls `require('./ai/ai-gateway')` — no AI
  boundary bypass found; it is the governed path the rule demands.
- Guard: `mobile-routes.js` and `case-note-routes.js` both use `requireAuth`
  only, no role middleware — but both headers document every query scoped
  to the caller's own id → **self-scoped by design**, not broken.
- Tests: `npx jest tests/case-note-routes.test.js tests/mobile-routes.test.js tests/opa-deidentify.test.js tests/opa-knowledge.test.js tests/opa-shell.test.js tests/travel-cascade.test.js tests/travel-feasibility.test.js tests/maps-autocomplete-routes.test.js` → 8 suites / 204 tests passed.
  `DB_NAME=therapy_scheduler_auditC DB_PASSWORD=audit npx jest --config jest.integration.config.js tests/integration/case-note-client-link.itest.js tests/integration/case-note-deidentification.itest.js tests/integration/event-travel-plan.itest.js tests/integration/travel-overrides.itest.js --runInBand` → 4 suites / 10 tests passed.
  `node --check` clean on all five related route files. No TODO/FIXME found.
- No browser-level proof exists or can exist from this repo (the mobile UI
  lives in a separate repo) — so against a strict "proven needs browser
  proof" bar, this is `tab-unproven`; against the code/test bar alone, it is
  `proven`. Reporting both readings rather than picking one.

## (b) Calendar View — **untouched**

No code, route, or test names a "Calendar View" feature at all — only
generic calendar/travel/maps building blocks exist (`/api/mobile/calendar`,
`/api/mobile/travel`, `backend/maps-routes.js`) that such a screen could be
built on. This correctly matches the tracker's own "bare title, empty
checklist."

## Open tasks from the tracker

- "Case Noting" (todo) — explicitly a manual testing/sign-off checklist
  ("confirm what pilot does today... get Ann's sign-off"), not an
  engineering gap. The engineering checklist items inside it (test
  dictation, test AI summary, test save-to-portal) already have automated
  coverage; the open item is the human step.
- "Calendar View" (todo) — bare title, nothing built yet, confirmed above.

## Commits in the window

None.

## Disagreement note

Confirms the previous `claude_update`: "mobile and case-noting backend is
solid and well tested" holds up exactly, and "pilot's own testing/sign-off
checklist is still completely open" also holds — nothing in this repo
substitutes for Ann's manual sign-off. One addition: the previous guess
didn't separately call out that "Calendar View" has zero code at all (not
partially built) — worth being explicit so it isn't mistaken for an
existing partial feature.
