# Opa Mobile Companion

- Tracker stage: **idea** · Tracker environment: **none**
- Evidence label: **built-untested**
- Addressed since last audit (2026-09-17T18:21Z UTC): **no** — `backend/mobile-routes.js` and `backend/tests/mobile-routes.test.js` do not appear in `git log b6a8ad4..HEAD -- backend frontend/current`
- Created (any located code): **yes**

## Located files

- `backend/mobile-routes.js` (664 lines) — "Opa Mobile Companion backend, Phase 2" per its own file header. Covers both tracker tasks:
  - **Calendar View** → `GET /api/mobile/calendar`, `GET /api/mobile/today`, `GET /api/mobile/appointments/:id`, `GET /api/mobile/travel`.
  - **Case Noting** → `GET/POST/PATCH/DELETE /api/mobile/voice-notes[/:id]` and `GET /api/mobile/clients` (lets a draft link a Splose client instead of an appointment).
- Related but distinct: `backend/opa-routes.js`/`opa-knowledge.js`/`opa-prompt.js`/`opa-provider.js` are the in-portal Opa AI chat assistant (desktop and mobile), a separate surface with no dedicated tracker card.
- No standalone frontend page exists for "Opa Mobile" — it is a phone app that talks to this API only. The one in-portal trace is the Case Notes tab tooltip at `frontend/current/mockup_v3.html:4080`: `title="Case Notes — review drafts dictated in the Opa mobile app"`.
- No `e2e/tests/*mobile*` spec exists — expected, since the client is a phone app, not something Playwright drives against this repo.

## Guard check

`mobile-routes.js` — `router.use('/api/mobile', requireAuth)`. No permission/role middleware follows on any route. The file's own header comment documents this as intentional: "Scoping model — deliberately NARROWER than the portal: every endpoint returns the CALLER'S OWN day only... Anything not owned by the caller answers 404... read_only: GETs allowed; writes blocked by permissions.requireAuth." This satisfies the audit's documented-exception rule exactly (same pattern as `snapshot-routes.js`). **Correction to last night's audit:** the 2026-09-17 STATUS.md labelled this "broken: unguarded endpoint" despite quoting the same documented exception — that was a misapplication of the rule. Tonight's correct classification is **self-scoped by design, not broken**. No unguarded route found.

## Tests run

Re-run fresh tonight (file unchanged since last audit):

- Unit: `tests/mobile-routes.test.js` — **41/41 passed**. This suite does exercise the real Express routes end-to-end via `supertest` (auth, guard, validation, 404-vs-owned-data behaviour all covered), but `../database` is fully `jest.mock()`-ed — no query in `mobile-routes.js` ever reaches Postgres in this suite. The `ECONNREFUSED splose.internal:443` log line is a deliberately-unreachable-host test double, not a real failure.
- **No integration test exists for mobile flows** — `backend/tests/integration/` still has no `mobile*.itest.js`. Confirmed still true tonight; this is the same gap flagged on 2026-09-17 and it has not been closed.
- `node --check mobile-routes.js` — **OK**. No TODO/FIXME found in `mobile-routes.js` or the `opa-*.js` files.

## Disagreement

None in the strict sense — tracker stage is idea and the evidence doesn't overclaim. Two things worth carrying forward distinctly from last night: (1) the guard classification here should read *self-scoped by design*, not *broken* — last night's audit mis-scored a documented, intentional exception; (2) that correction does not make this feature `proven`. With the guard cleared, the remaining reason this stays below `proven` is that nothing in the repository exercises `mobile-routes.js`'s actual SQL against a real database — the one existing test suite fully mocks `database.js`. For a feature whose "Case Noting" task specifically depends on correctly joining/linking a Splose client to a voice-note draft, a fully-mocked unit suite proves the routing and guard logic but proves nothing about the SQL itself. This is real, actively-developed backend functionality with zero integration-level proof.
