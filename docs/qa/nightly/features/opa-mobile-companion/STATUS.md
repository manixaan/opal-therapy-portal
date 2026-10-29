# Opa Mobile Companion

- Tracker stage: idea · Tracker environment: none
- Evidence label: **needs-refinement**
- Addressed since the last audit (develop unchanged since 2026-10-28, also commit `15acf0c`): no — confirmed by `git log --since=2026-10-15` on every located file, all empty.
- Created (any located code): yes.

## Located

- `backend/mobile-routes.js` — `GET /api/mobile/{clients,today,calendar,appointments/:id,travel,voice-notes,voice-notes/:id}`, POST/PATCH/DELETE voice-notes. Header states it never calls Splose/Outlook/Xero/Maps/any AI provider and is scoped to the caller's own day only.
- Tracker task **"Calendar View"** → `GET /api/mobile/calendar` — located, in `mobile-routes.js`.
- Tracker task **"Case Noting"** → **not** in `mobile-routes.js`. It is `backend/case-note-routes.js`, whose header says "CASE-NOTE DRAFTS — voice-to-case-note for Opa Mobile." Routes: `/api/mobile/case-note-drafts*` and deprecated alias `/api/mobile/ai/case-note`. This is the "AU-region clinical AI" piece. It calls `clinical-note-provider.js`, which correctly goes through `backend/ai/ai-gateway.js` — no gateway-boundary violation. Registered in `ai-policy.js` as `clinical_note_generation`.
- No frontend tab exists for mobile, by design — consumed by an external mobile client not in this repo.

## Guard check

`mobile-routes.js`: `requireAuth` only — verified in code that every route filters by `req.user.id` or the caller's own `therapist_profile_id`; unowned resources 404. Self-scoped by design. `case-note-routes.js`: `requireAuth` only on both mount points; header explicitly documents "Strictly user-scoped (snapshot model): every read/write filters user_id; not-yours answers 404. No role — owner included — can read another user's drafts." Both self-scoped by design, not broken.

## Tests and results

| Command | Result |
|---|---|
| `npx jest tests/mobile-routes.test.js` | PASS — 41/41 |
| `npx jest tests/case-note-routes.test.js tests/clinical-note-provider.test.js tests/clinical-note-deidentify.test.js` | PASS — 81/81 |
| `DB_NAME=therapy_scheduler_audit_g5 npx jest --config jest.integration.config.js tests/integration/case-note-client-link.itest.js tests/integration/case-note-deidentification.itest.js --runInBand` | PASS — 6/6 |
| `npx jest tests/ai-gateway-boundary.test.js tests/ai-single-gateway-guards.test.js` | PASS — 30/30 (confirms no AI gateway boundary violation anywhere implicated by this feature) |

No integration test exists for `mobile-routes.js` itself (no `*.itest.js` references `api/mobile`/`mobile-routes`). No test exists — and none can — proving the external mobile client successfully calls these APIs; that is impossible to establish from this repository.

## Commits in window touching located files

None.

## Open tracker tasks

`[todo]` Case Noting — located (`case-note-routes.js`, not `mobile-routes.js`), tested, no browser/E2E proof possible from this repo. `[todo]` Calendar View — located, tested, same structural gap.

## Disagreement / notes

Partial disagreement on specificity, agreement on substance. Prior claude_update: "the mobile API (clients, calendar, voice notes, AU-region clinical AI) is guarded and fully tested, but nothing in this repository confirms the real mobile client actually calls it" — accurate but imprecise: the "AU-region clinical AI"/case-noting piece is not in `mobile-routes.js` at all, it's in the separately-named `case-note-routes.js`. Recommend any future starter prompt name `case-note-routes.js` explicitly for "Case Noting," not just "the mobile API." The `needs-refinement` label is correct (both tracker tasks are `todo`) and carries over unchanged; the only real gap — proof the external mobile client calls these APIs correctly — is a permanent, structural gap this repository cannot close on its own, not a code defect.
