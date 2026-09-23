# Opa Mobile Companion

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed in this change window (2026-09-22 → 2026-09-23): no — zero commits landed in this window
  at all. The desktop case-note composer described below (`1c17e78`) landed in the *prior* window
  (2026-09-21 → 2026-09-22) and is unchanged tonight.
- Created (any located code): yes — backend API surface, plus a first-party desktop composition UI,
  not just a mobile-draft review surface

## Important: this is a genuinely separate mobile app, not a tab in this portal

The actual Opa Mobile Companion client (dictation UI, mobile calendar UI) is
a **separate app that does not live in this repository**. There is no
`frontend/mobile/` or PWA source anywhere in the codebase. This repo only
contains: (1) the backend API the mobile app talks to, and (2) a desktop
review page in the main portal for what the mobile app produces. That
means the classification below is a judgement call, not a literal
application of "no E2E spec, no browser QA entry" for a tab — there is no
tab in this repo for the actual dictation/calendar experience to test.
Given the tracker task itself says the pilot "needs rigorous testing," this
audit treats the absence of any end-to-end proof of the real user
experience as the more useful signal for the team, over a stricter reading
that would call the backend alone "proven."

## Update (2026-09-22, prior window — unchanged tonight): the portal itself can now compose and dictate a case note, not just review one

`1c17e78` (prior window) adds `frontend/current/casenotes-compose.js` (new, 628 lines) — a "New case note"
flow directly in the desktop portal's Case Notes tab: a caseload client picker, on-device dictation
via the browser SpeechRecognition API (hard-gated to `processLocally: true` — refuses to run if the
engine can't guarantee local-only processing; no audio capture or upload; no cloud fallback), a
"names check" step that must be fully resolved before drafting is allowed, and a "Create case note
draft" action. This is a genuine first-party desktop composition capability, distinct from
`casenotes.js`'s pre-existing role as a review-only surface for mobile-dictated drafts.

**No new backend route** — it's a thin client over three existing mobile endpoints:
`GET /api/mobile/clients`, `POST /api/mobile/case-note-drafts/names-check`,
`POST /api/mobile/case-note-drafts/generate`. Same AI gateway/Bedrock pathway, same RBAC, same schema
as the mobile pilot — this is a second entry point into the same clinical-AI generation path, not a
separate one.

**Guard check: clean.** `mobile-routes.js`: `router.use('/api/mobile', requireAuth)`, self-scoped
(`listOwnClients` filters to caller's own caseload). `case-note-routes.js`:
`router.use('/api/mobile/case-note-drafts', requireAuth)` and the `/ai/case-note` route likewise. The
new `frontend-stage3-guards.test.js` "composer" describe block asserts: no new endpoint, no
`bedrock`/`anthropic`/`userId` strings client-side, no `getUserMedia`/`MediaRecorder`/audio upload, no
logging/localStorage/cookie/URL-param leakage of transcript content — all pass.

**Tests, re-run fresh tonight**: Unit — 7 suites (`casenotes-compose.test.js`,
`frontend-stage3-guards.test.js`, `case-note-routes.test.js`, `casenotes-helpers.test.js`,
`clinical-note-provider.test.js`, `clinical-note-deidentify.test.js`, `mobile-routes.test.js`), run
together with the Splose/Outlook batch → **548/548 passed**, no regression. Integration —
`case-note-client-link.itest.js` + `case-note-deidentification.itest.js`, run together with the
Splose/Outlook batch (15 suites, 99 tests, 0 failures) → both still pass, no regression.

**Zero browser/E2E proof of the new composer** — no mention of `casenotes-compose`, "New case note",
or `cnc-root` anywhere in `e2e/tests/*.spec.js` or `docs/qa/BROWSER_QA_RESULTS.md`. This adds a
second, higher-stakes way to reach the same unproven dictation → Bedrock → structured-draft path with
no end-to-end evidence — the classification stays `tab-unproven` for the feature overall, and if
anything the bar for "proven" is now higher (two live entry points to prove, not one).

**Privacy doc staleness now applies to two callers.** `docs/mobile/CASE_NOTE_AI_PRIVACY.md:3` still
says the feature needs `ANTHROPIC_API_KEY`; both the mobile pilot and this new desktop composer
route exclusively through AWS Bedrock via the identical `/generate` endpoint. Same finding as last
night, now one caller wider.

**Scope judgement**: this is new work landing under the existing "Case Noting" tracker task, not
untracked scope-creep like Opal Assist — the commit and its tests show clear awareness of the
existing mobile pattern (same endpoints, same guard style, same de-identification tests extended).
But the task's own description text ("rigorous testing" of the mobile pilot) is now stale: it should
be revised to mention this desktop composer needs the same rigorous testing, since it carries the
same clinical risk.

## Located files

- Routes: `backend/mobile-routes.js` (today/calendar view with travel derivation, clients, tasks, voice notes — **self-scoped by design**, this is the project's own canonical example of that pattern), `backend/case-note-routes.js` (dictation → AI → draft pipeline)
- AI clinical pathway: `backend/clinical-note-provider.js` (transcript → Bedrock → structured case-note tool-schema output), `backend/case-note-style.js` (the versioned clinical prompt, kept server-side only)
- Frontend (desktop surface, NOT the mobile app itself): `frontend/current/casenotes.js` + `casenotes.css` — the review surface, "Drafts dictated in the Opa mobile app, waiting for your review"; **new tonight**: `frontend/current/casenotes-compose.js` (628 lines) — a desktop composer with its own on-device dictation, wired into `casenotes.js` via a "New case note" button
- Docs: `docs/mobile/CASE_NOTE_AI_PRIVACY.md`, `docs/mobile/CLINICAL_AI_PROVIDER_DECISION.md`, `docs/mobile/MOBILE_BACKEND_PHASE2_REPORT.md`, `docs/mobile/MOBILE_PERSISTED_DRAFT_CONTRACT.md`

## Guard check

`mobile-routes.js`: `router.use('/api/mobile', requireAuth)` then every query filters `WHERE user_id = $1`; the header comment explicitly documents this as narrower than the rest of the portal, no role-based access at all, not-yours answers 404 — this is the self-scoped-by-design exception the project's own rules name this file as an example of. `case-note-routes.js`: same pattern, `requireAuth` + strict user-scoping, and notably **no role, including owner, can read another user's drafts** — stronger than the portal norm, appropriate for clinical dictation content. No guard defects found.

## Tests

- Unit (all pass, run together with the Splose/Outlook batch): `mobile-routes.test.js`, `case-note-routes.test.js`, `casenotes-helpers.test.js`, `clinical-note-provider.test.js`, `clinical-note-deidentify.test.js` — 0 failures across the combined 528-test run
- Integration (all pass): `case-note-client-link.itest.js`, `case-note-deidentification.itest.js` — 2 suites, 6 tests, 0 failures
- Browser/E2E: **none.** Neither `e2e/tests/portal.spec.js`, `tutorials.spec.js`, nor `docs/qa/BROWSER_QA_RESULTS.md` mention mobile, case-note, clinical, or dictation anywhere. Partly explained by `BROWSER_QA_RESULTS.md` being a web-only (Playwright/Chromium) staging pass that can't reach a separate mobile client — but it means the pilot's actual dictation → AI summary → save flow, the part the tracker explicitly flags as needing rigorous testing, has zero recorded end-to-end evidence anywhere in this repo.

## Open tasks from the tracker

- "Case Noting" — `todo`. Notes describe a pilot dictation tool already built, needing rigorous testing of the AI clinical pathway, not further building. Matches what was found: solid backend, no test proof of the actual clinical summarisation quality or the dictation UX.
- "Calendar View" — `todo`, no further detail recorded. `mobile-routes.js` today/calendar endpoints (`deriveTrips`, `canOpenInMaps`, `needsAddressReview`) appear to cover this; same lack of end-to-end proof applies.

## Findings worth the team's attention

- **`CLINICAL_NOTE_AI_ENABLED=false` by default** (`.env.example:315`) — consistent with pilot status, but confirm the actual deployed value if the team believes the pilot is live for any user today.
- **Stale privacy doc**: `docs/mobile/CASE_NOTE_AI_PRIVACY.md` still says the feature requires `ANTHROPIC_API_KEY`; the code routes exclusively through AWS Bedrock (`clinical-note-provider.js`, `ai-policy.js` — `allowedProviders: [Bedrock, Mock]`). `docs/mobile/CLINICAL_AI_PROVIDER_DECISION.md` already flags this exact staleness risk itself. Since this is the compliance-facing privacy contract for clinical dictation data, it should be corrected before the pilot is treated as production-ready.
- Design looks careful on paper (fail-closed, no fallback provider, Australia-only Bedrock inference, PII merged in after generation rather than sent to the model, tool-schema-validated output) — the gap is proof, not design.

## Commits in the window that touched it

None this window (2026-09-22 → 2026-09-23) — `develop` did not move since last night (both audits sit
on `74601fc`). Prior window: 1c17e78 (2026-09-22) `feat(casenotes): start a case note in the portal —
client picker, on-device dictation, names check, governed draft` — see "Update" above.

## Disagreement

The tracker's own task notes already predict low confidence here ("rigorous testing is required"); the evidence confirms that testing has not yet happened at the level that matters (real dictation → real AI output → real portal save), even though the backend plumbing is solid. Not a tracker-vs-evidence disagreement so much as a confirmation the tracker's own caution was warranted.
