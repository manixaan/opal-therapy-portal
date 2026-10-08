# Portal - Splose - Outlook | Integration Works

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **needs-refinement**
- Addressed this window: **no** — zero commits since 2026-10-07 touching `backend/` or `frontend/current/`.
  Eighth consecutive reconfirmation night.
- Created (any located code at all): **yes**

## Located files
- `backend/calendar-routes.js`, `backend/splose-link-routes.js`, `backend/splose-sync-routes.js`,
  `backend/travel-routes.js`, `backend/routes.js` (`GET /api/outlook/categories`, line ~1463)
- `backend/outlook-oauth.js` (OAuth helper, no routes of its own)
- `backend/routes-outlook-integration.js` — defines Outlook routes with its own local `requireAuth`, but is
  **not required anywhere in server.js or any other backend file** — orphaned/dead code, not reachable in
  production. Worth flagging for cleanup, not a guard risk since it is unreachable.
- `backend/splose-api.js`, `splose-draft-sync.js`, `splose-poller.js`, `splose-credentials.js`,
  `splose-caseload.js`, `calendar-permissions.js`, `travel-cascade.js`, `travel-feasibility.js`
- Frontend: `<!-- BOOK TAB -->` (mockup_v3.html:4464), `<!-- CALENDAR TAB -->` (mockup_v3.html:4711/4712, Smart
  Booking), `<!-- TRAVEL & FLIGHTS TAB -->` (mockup_v3.html:5725 — Add Flight/Add Manual Travel are "Coming soon"
  stubs), `<!-- TRAVEL LOGBOOK TAB -->` (mockup_v3.html:5762)

## Guard check
`calendar-routes.js`: every route guarded (`requireAuth` + `requireRole`/`requireMasterCalendarAccess`).
`splose-sync-routes.js`: `router.use('/api/splose-sync', requireAuth, denyReadOnly, requireDraftSync)`.
`splose-link-routes.js`: self-link routes explicitly documented self-scoped by email match; admin-link and
connection routes are `requireRole('owner')`. `travel-routes.js`: `requireAuth, denyReadOnly` throughout.
**Re-confirmed directly tonight**: `backend/routes.js`'s `GET /api/outlook/categories` wraps its body in a
blanket `catch` that returns HTTP 500 for every error, including the ordinary case of a user with no Outlook
connection (`Error('Outlook not connected')` thrown from `getValidAccessToken`) — it should return 409 or an
empty list instead. This is guard-adjacent (the route is still correctly behind `requireAuth`), not a guard gap,
but it is a real, still-open defect, also independently confirmed in `docs/qa/BROWSER_QA_RESULTS.md` (the
"Medium" `GET /api/outlook/categories 500` finding).

## Tests run tonight
- unit: `outlook-delta-preserve.test.js, outlook-mirror.test.js, splose-link-routes.test.js,
  splose-api-queue.test.js, splose-credentials.test.js, splose-draft-sync.test.js, splose-poller.test.js,
  sync.test.js, sync-status-route.test.js, permissions.test.js, security.test.js` — 159/159 pass across both
  runs tonight (the first 7 files overlap with permissions/security/sync tests also relevant to other features)
- integration: `event-delete-cascade.itest.js, event-travel-plan.itest.js, oauth-callback.itest.js,
  outlook-claim.itest.js, rbac-hardening.itest.js, splose-draft-sync.itest.js, travel-overrides.itest.js` —
  58/58 pass

## Open tasks (from the tracker)
- Multi Calendar Rules — build, todo

## Compare with the tracker
None new. The tracker's own `claude_update` already names the open `/api/outlook/categories` bug accurately. The
travel-cascade/draft-sync/two-way-match workflow is otherwise built, guarded and well tested, with real e2e
(`e2e/tests/portal.spec.js` — Splose/Outlook guard tests) and a recorded browser QA pass (flows D, E, F).
