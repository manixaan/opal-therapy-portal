# Opa Mobile Companion

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **needs-refinement**
- Addressed this window (commits since 2026-10-04 touching its located files): **no** — zero commits have landed on `develop` under backend/ or frontend/current/ since the last audit (2026-10-04); the audited commit (`aacf8e68`) is still unchanged. This is the sixth consecutive reconfirmation night on this exact code. Tonight is not Sunday UTC, so targeted batches were run (not the complete suites) — see each section below for exactly what ran tonight.
- Created (any located code at all): **yes**

## Located files
- Case Noting: backend/case-note-routes.js (/api/mobile/case-note-drafts + legacy /api/mobile/ai/case-note), backend/clinical-note-provider.js (AI transmission layer), backend/case-note-style.js, backend/ai/deidentify.js, docs/mobile/CASE_NOTE_AI_PRIVACY.md
- Calendar View: backend/mobile-routes.js (/api/mobile/today, /calendar, /appointments/:id, /travel), backend/maps-routes.js
- No mobile client code lives in this repository — the on-device pilot the tracker's checklist describes lives in a separate mobile app project not checked into this repo.

## Guard check
mobile-routes.js: requireAuth, self-scoped-by-design (every query filtered by req.user.id, 404 on anything not owned — spot-checked /today, /appointments/:id, voice-notes CRUD). case-note-routes.js: requireAuth on both mount points, same ownership pattern, documented in its own header. AI gateway registration confirmed: clinical_note_generation is a registered ai-policy.js entry (classification CLINICAL, de-identification required, human review required on every output). No gaps.

## Tests run tonight
- unit: `mobile-routes.test.js, case-note-routes.test.js` — 105/105 pass
- integration: `case-note-client-link.itest.js, case-note-deidentification.itest.js` — included in the 126/126 integration figure under Report Templates above

## Open tasks (from the tracker)
- Case Noting — build, todo (tracker checklist: confirm pilot behaviour, test dictation end to end, test AI summary against the clinical pathway, decide "good enough" with Ann, test save-to-portal, fix and re-test, get Ann's sign-off — every item still unchecked)
- Calendar View — build, todo

## Compare with the tracker
None — the tracker's own claude_update already frames this accurately: the backend pilot is built, guarded and well tested, but the human sign-off checklist for the Case Noting pilot (ending in "Get Ann's sign-off") is still entirely open. That checklist, not the code, is what keeps this at needs-refinement rather than proven.
