# Opa Mobile Companion

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Created (any code located): yes (backend API only)
- Addressed since the last audit (2026-11-05, cutoff commit `8853376`, through tonight's HEAD `704a51f` — 4 commits: `704a51f`, `0a365c4`, `cd8c4a8`, `e3c0b90`): **no**. `e1af24e fix(mobile): the phone diary matches the portal calendar` touches `backend/mobile-routes.js`/`backend/database.js` but predates the 2026-11-05 audit's cutoff — already covered by prior audits, not new tonight.

## Located
- `backend/mobile-routes.js` — the whole mobile API surface (events, voice notes, tasks, reminders, case-note draft generation alias).
- Case-noting AI: `backend/mobile-routes.js` deliberately has **no** AI call of its own (see its own header comment and the "AI — moved, deliberately" block at the end of the file). The dictation→draft flow is `POST /api/mobile/case-note-drafts/generate`, implemented once in `backend/case-note-routes.js`, which calls `backend/clinical-note-provider.js` → `backend/ai/ai-gateway.js`. This is the only door to a model, as required by `.claude/rules/ai-gateway.md`, and it runs through `ai-audit.js`.
- Calendar View: served by the same `backend/mobile-routes.js` day/travel endpoints (`day-route`, `events`), reusing `backend/billing/day-route.js`.
- **What is not in this repository at all**: the native/PWA mobile client itself. There is no mobile app source tree here — only the backend API it calls. Nothing in this repo can prove what a user actually sees or taps on a phone.
- No `e2e/tests/*.spec.js` for mobile. No "mobile" entry in `docs/qa/BROWSER_QA_RESULTS.md`.

## Guard check
Pass, with the self-scoped exception correctly applied. `router.use('/api/mobile', requireAuth)` is the only middleware — no per-route role check — but the file's own header comment documents (lines 1-28) that every query is scoped to the caller's own `therapist_profile_id`/`user_id`, matching the `snapshot-routes.js`/`mobile-routes.js` exception named explicitly in `CLAUDE.md` §"backend-api.md" guard rule. This is "self-scoped by design," not a missing guard.

## Tests run
Unit:
```
npx jest tests/mobile-routes.test.js
```
Result: **1 suite passed, 50 tests passed, 0 failed** (covers voice notes, tasks, reminders, and the case-note-drafts/generate alias). No matching integration test file (`tests/integration/mobile*.itest.js` does not exist).

## Open tracker tasks
- "Case Noting" (todo) — a human testing/sign-off job on the mobile pilot (dictation accuracy, AI summary quality, Ann's sign-off), not a code task.
- "Calendar View" (todo, no explanation/checklist recorded).

## Commits in window touching it
None since the 2026-11-05 audit's cutoff. (`e1af24e fix(mobile): the phone diary matches the portal calendar` is older than that cutoff — it was already in scope for the 2026-11-04/05 audits, not new tonight.)

## Disagreement note
**Disagreement with three straight prior nights' classification**, not just the tracker's `claude_update` text. The 2026-11-01/02/04/05 briefs on `origin/claude/nightly-audit` (real prior audits — confirmed genuine, not fabricated) all called this feature `proven`, "figures matching exactly" night over night. Tonight's independent re-derivation agrees the *backend API* is guarded, AI-gateway-compliant, and passing 50 tests — that part is solid and unchanged. But re-examining the feature as scoped ("Opa Mobile Companion" — the mobile app, not just its API), its client code is entirely absent from this repository, with no e2e spec and no browser-QA entry proving the dictation/case-noting/calendar flow actually works for a user on a device. Three prior nights calling the whole feature `proven` overstates what this repo can actually show; `tab-unproven` is the more honest label — proven API, unproven user-facing flow, and the user-facing flow is the point of a "mobile companion." This is a genuine change of label from history, not a fabrication issue — worth a human's attention on whether "proven" was ever the right call here, or whether the scope should explicitly be "backend API only."
