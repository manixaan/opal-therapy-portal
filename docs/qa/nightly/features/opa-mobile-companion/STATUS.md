# Opa Mobile Companion

- Tracker stage: **idea** · Tracker environment: **none**
- Evidence label: **built-untested**
- Addressed since last audit (2026-09-18T19:20Z UTC, commit `0726dde`): **no** —
  `backend/mobile-routes.js` and `backend/tests/mobile-routes.test.js` do not appear in
  `git log 0726dde..HEAD -- backend frontend/current`
- Created (any located code): **yes**

## Located files

- `backend/mobile-routes.js` (664 lines) — "Opa Mobile Companion backend, Phase 2." Covers both
  tracker tasks: **Calendar View** (`GET /api/mobile/calendar`, `/today`, `/appointments/:id`,
  `/travel`) and **Case Noting** (`GET/POST/PATCH/DELETE /api/mobile/voice-notes[/:id]`,
  `GET /api/mobile/clients`).
- Related but distinct: `backend/opa-routes.js`/`opa-knowledge.js`/`opa-prompt.js`/`opa-provider.js`
  are the in-portal Opa AI chat assistant — a separate surface with no dedicated tracker card.
  **Recency note:** `opa-provider.js` was touched twice tonight (`d9e00ab`, `ec47514`) as part of
  the de-identification/Assist work (tokenising Opa's turns through the practice-wide de-identifier)
  — this is the *chat* surface, not `mobile-routes.js`; it does not move this feature's evidence.
- No standalone frontend page exists for "Opa Mobile" — it is a phone app that talks to this API
  only.

## Guard check

`mobile-routes.js` — `router.use('/api/mobile', requireAuth)`. No permission/role middleware
follows on any route. The file's own header comment documents this as intentional: every endpoint
returns the caller's own day only, anything not owned by the caller answers 404. This is the
documented self-scoped-by-design exception (same pattern as `snapshot-routes.js`). No unguarded
route found.

## Tests run

Re-run fresh tonight (file unchanged since last audit):

- `cd backend && npx jest tests/mobile-routes.test.js` — **PASS 41/41**. This suite exercises the
  real Express routes end-to-end via `supertest`, but `../database` is fully `jest.mock()`-ed — no
  query in `mobile-routes.js` ever reaches Postgres in this suite.
- **No integration test exists for mobile flows** — `backend/tests/integration/` still has no
  `mobile*.itest.js`. Confirmed still true tonight; the same gap flagged on every prior audit and
  not yet closed.
- `node --check mobile-routes.js` — **OK**. No TODO/FIXME found in `mobile-routes.js` or the
  `opa-*.js` files.

## Disagreement

None in the strict sense — tracker stage is idea and the evidence doesn't overclaim. This stays
below `proven` because nothing in the repository exercises `mobile-routes.js`'s actual SQL against
a real database — the one existing test suite fully mocks `database.js`. For a feature whose "Case
Noting" task specifically depends on correctly joining/linking a Splose client to a voice-note
draft, a fully-mocked unit suite proves the routing and guard logic but proves nothing about the
SQL itself.
