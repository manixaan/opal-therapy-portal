# Opa Mobile Companion

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed in this change window (2026-09-23 → 2026-09-24): no — zero commits landed in this window at all. The desktop case-note composer (`1c17e78`) landed two windows ago (2026-09-21) and is unchanged.
- Created (any located code): yes — backend API surface, plus a first-party desktop composition UI, not just a mobile-draft review surface

## Important: this is a genuinely separate mobile app, not a tab in this portal

The actual Opa Mobile Companion client (dictation UI, mobile calendar UI) is
a separate app that does not live in this repository. This repo only
contains: (1) the backend API the mobile app talks to, and (2) a desktop
composition/review page in the main portal. Given the tracker task itself
says the pilot "needs rigorous testing," this audit treats the absence of
any end-to-end proof of the real user experience as the more useful signal
for the team, over a stricter reading that would call the backend alone
"proven."

## Located files

- Routes: `backend/mobile-routes.js` (today/calendar view with travel derivation, clients, tasks, voice notes — self-scoped by design), `backend/case-note-routes.js` (dictation → AI → draft pipeline)
- AI clinical pathway: `backend/clinical-note-provider.js` (transcript → Bedrock → structured case-note tool-schema output), `backend/case-note-style.js` (versioned clinical prompt, server-side only)
- Frontend: `frontend/current/casenotes.js`/`.css` (review surface for mobile-dictated drafts), `frontend/current/casenotes-compose.js` (628 lines — desktop composer with its own on-device dictation, "New case note" button)
- Docs: `docs/mobile/CASE_NOTE_AI_PRIVACY.md`, `docs/mobile/CLINICAL_AI_PROVIDER_DECISION.md`, `docs/mobile/MOBILE_BACKEND_PHASE2_REPORT.md`, `docs/mobile/MOBILE_PERSISTED_DRAFT_CONTRACT.md`

## Guard check

`mobile-routes.js`: `router.use('/api/mobile', requireAuth)`, every query filters `WHERE user_id = $1`, not-yours answers 404 — self-scoped by design, the project's own named example of the pattern. `case-note-routes.js`: same strict-user-scoping pattern; header documents no role, including owner, can read another user's drafts. No guard defects found. Clinical AI path confirmed to route only through `backend/ai/ai-gateway.js` — no direct provider/SDK use.

## Tests (re-run fresh tonight)

- Unit: `mobile-routes.test.js`, `case-note-routes.test.js`, `casenotes-compose.test.js`, `casenotes-helpers.test.js`, `clinical-note-provider.test.js`, `clinical-note-deidentify.test.js` — 9 suites / 197 tests, all pass (run standalone); AI-gateway boundary tests (`ai-gateway.test.js`, `ai-gateway-boundary.test.js`, `ai-single-gateway-guards.test.js`, `ai-deidentify.test.js`, `ai-deidentification-gate.test.js`) also re-run and pass (5 suites / 100 tests).
- Integration: `case-note-client-link.itest.js`, `case-note-deidentification.itest.js` — run tonight in the Splose/Mobile/Snapshot batch (9 suites / 79 tests, 0 failures).
- Browser/E2E: none. Neither e2e spec nor `docs/qa/BROWSER_QA_RESULTS.md` mention mobile, case-note, clinical, or dictation anywhere.

## Open tasks from the tracker

- "Case Noting" — `todo`. Notes describe a pilot dictation tool already built, needing rigorous testing of the AI clinical pathway. Matches what was found: solid backend, unit/integration tested, no proof of the actual clinical summarisation quality or dictation UX end to end.
- "Calendar View" — `todo`, no further detail. `mobile-routes.js`'s today/calendar endpoints appear to cover this; same lack of end-to-end proof applies.

## Findings worth the team's attention

- `CLINICAL_NOTE_AI_ENABLED=false` by default (`.env.example`) — consistent with pilot status; confirm the actual deployed value if the pilot is believed live.
- Stale privacy doc: `docs/mobile/CASE_NOTE_AI_PRIVACY.md` still says the feature requires `ANTHROPIC_API_KEY`; the code routes exclusively through AWS Bedrock. This is the compliance-facing privacy contract for clinical dictation data — worth correcting before the pilot is treated as production-ready. Flagged on every prior audit night; still unfixed.

## Commits in the window that touched it

None this window — `develop` sits on `74601fc` again tonight. Re-verified fresh: unit and integration both re-run tonight with identical results — no regression.

## Disagreement

The tracker's own task notes already predict low confidence here ("rigorous testing is required"); the evidence confirms that testing has not yet happened at the level that matters (real dictation → real AI output → real portal save), even though the backend plumbing is solid.
