# TEST_REPORT.md

> Run 2026-07-12 on this machine. Node v26.0.0, jest 30.x.

## Summary (verified this date)

| Metric | Value |
|---|---|
| Command | `cd backend && npm test` (`jest --config jest.config.js`) |
| Test suites | 3 passed / 3 total |
| Tests | **47 passed / 47 total** |
| Failing | 0 |
| Skipped | 0 |
| Duration | ~0.9 s |
| Environment | node, all external services mocked; `tests/setup.js` sets fake DB/email env before any require; `tests/helpers/buildApp.js` builds an Express app with in-memory sessions |
| Real services used | **None** — no PostgreSQL, no Graph, no Splose, no SMTP, no network |
| DB required to run | **No** (pg is mocked in every suite) |

## Per-file breakdown

### `tests/auth.test.js` — 9 tests · Feature: authentication
Mocks: `../database`, `../email`, `../outlook-oauth`, `../splose-api` (all jest.mock). Uses supertest against buildApp. bcryptjs runs real (cost 1 for speed).
- login valid → 200 + Set-Cookie
- login wrong password → 401
- login unknown email → 401 (no enumeration)
- login inactive → 403
- login unverified → 403 + `pending_verification`
- login missing field → 400
- `/api/auth/me` no session → 401
- logout destroys session (agent-based)
- rate limiter → 429 after 10 failures from one IP

### `tests/permissions.test.js` — 13 tests · Feature: RBAC + financial stripping
Mocks: same set. Agent logs in per role.
- Unauthed 401 on `/api/events`, `/api/admin/users`, `/api/calendar/master`
- therapist 403 on admin users, both Splose debug routes, master calendar
- owner 200 on admin users (**note: this exercises the handler with a MOCKED db.pool.query, so it does NOT catch the real `has_outlook_connected` SQL bug — see gap below**)
- read_only 403 on approve + role-change PATCH
- register with disallowed email + no invite → rejected
- `stripFinancials` on object and array

### `tests/sync.test.js` — 25 tests · Feature: sync integrity
Mocks: an **in-memory event store** replacing `../database`; Graph/Splose/email mocked. `sync-utils.classifyEventType` runs real.
- classifyEventType (8): category → event_type mappings incl. teams override
- Outlook import (6): one-import-one-row, idempotent re-sync, update-in-place, cancellation soft-delete, title/time change updates
- Splose import (3): splose_id stored, no dup on re-run, cancellation soft-delete
- App write-back + loop prevention (4): outlook_id stored, re-import no dup, created_by_source='app' preserved, deleted not visible
- Distinct events not merged (1)
- Deletion idempotency (1)
- Dry-run reconciliation scenario (1): 8-event classification into active/deleted/outlook-only/splose-linked/app-only/duplicates
- Timezone (1): Perth 9am ↔ UTC 01:00 preserved

## What the tests actually prove vs. don't

**Genuinely covered:** login/logout/rate-limit/status gates; role gating on a representative set of routes; the *logic* of upsert idempotency, tombstoning, event-type classification, loop-prevention (via the in-memory store that faithfully mimics the unique-key upsert).

**NOT covered (no automated test — must be manually tested):**
1. Any route against a **real PostgreSQL schema** — so the two live SQL bugs (`has_outlook_connected`, `base_location`) pass CI but fail in production. **This is the single most important test gap.**
2. Real Microsoft Graph delta/create/update/delete (mocked shapes only).
3. Real Splose fetch/create/cancel and the enrichment/address logic.
4. The whole **frontend** — zero JS tests; no Playwright/Cypress. Smart Booking, calendar rendering, drag-to-book, socket refresh are only manually verified.
5. Registration → verification → approval → onboarding **end-to-end**.
6. Password reset end-to-end (token issue → email → consume → session invalidation).
7. Suspension → session invalidation → lockout.
8. Webhook receiver (and it's broken in prod — no test would have caught the raw-body issue).
9. Splose/Outlook empty-response safety (the dangerous mass-delete paths are untested).
10. Leave/CPD/credentials/documents CRUD + approval.
11. Email template rendering / injection.
12. Google Maps proxy.
13. Multi-therapist master calendar with real profile data.
14. Concurrency (two pollers / webhook + poller racing on the same event) — the unique constraint is the guard, but no test forces the race.

## Recommended first tests to add (highest value)
- **DB-integration smoke test** against a throwaway Postgres (or `pg-mem`): boot `INIT_QUERIES`, then hit `GET /api/admin/users`, `GET /api/notifications`, `POST /api/auth/change-password` — would immediately catch the three schema/dependency bugs.
- **Empty-response safety** unit tests for `reconcileOutlookWindow` and `runSploseSync` (assert they DON'T delete everything when the live set is empty).
- **A Playwright happy-path**: login → create client booking → see it on the calendar → refresh → still there → delete → gone.
