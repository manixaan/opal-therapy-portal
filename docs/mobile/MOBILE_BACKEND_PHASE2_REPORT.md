# Mobile Backend — Phase 2 Report

**Date:** 2026-08-09 · **Scope:** minimal safe backend API layer for the Opa Mobile Companion (planning docs live in the mobile repo: `Opa-Mobile-Companion/docs/`).
**Constraints honoured:** no changes to auth model, RBAC, Outlook/Splose/Xero sync, calendar engine, or travel calculation logic; no external calls of any kind from the new routes; no deploys; no write flags touched.

## What was built

| Piece | File |
| --- | --- |
| Route module | `backend/mobile-routes.js` — mounted in `server.js` next to snapshot routes; whole prefix gated `router.use('/api/mobile', requireAuth)` |
| Migration | `backend/migrations/015_voice_notes.sql` (015, **not** 013/014 — 013 `product_thumbnails` and 014 `support_tickets` were taken by parallel work the same day) |
| Tests | `backend/tests/mobile-routes.test.js` — 35 focused tests, mocked DB, supertest in-process |

## Endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /api/mobile/today?date=&timezone=` | One-round-trip day aggregate: appointments, next appointment, derived travel (nextTrip/trips/needsReviewCount), open tasks, due-or-overdue reminders, last 5 draft voice notes, summary counts |
| `GET /api/mobile/calendar?date=&range=day\|week&timezone=` | Compact appointment lists grouped by Perth day |
| `GET /api/mobile/appointments/:id` | Own-diary detail + description/clientName, travel {minutes, km}, `mapsAddress` (only when routable), caller's linked voice notes |
| `GET /api/mobile/travel?date=&timezone=` | Derived trip list + summary; `calculationMethod` string included |
| `GET /api/mobile/voice-notes?status=&date=` · `GET /:id` | List own / read own |
| `POST /api/mobile/voice-notes` | Create — always `status: 'draft'` |
| `PATCH /api/mobile/voice-notes/:id` | Edit content/links while draft; status transitions `draft→reviewed`, `draft\|reviewed→archived` |
| `DELETE /api/mobile/voice-notes/:id` | Hard delete **drafts only** (snapshot convention for user-owned draft content); reviewed/archived → 409, archive instead |

### Compact appointment shape (list)

`{ id, title, start, end, timezone: 'Australia/Perth', eventType, status, isCancelled, location, isVirtual, hasTravel, needsAddressReview, canOpenInMaps, source }` — never `outlook_id`, `splose_id`, `custom_metadata`, or any raw sync payload. `clientName`/`description` appear only on the detail endpoint.

## Security / scoping decisions

1. **Caller-scoped only, deliberately narrower than the portal.** Every endpoint returns the caller's own data: events via their own `therapist_profile_id`, tasks/reminders/voice notes via `user_id` (snapshot model — no cross-user access for any role, owner included). Owner/admin get their *personal* diary on mobile; the master calendar stays a portal feature. This satisfies "no broad data through aggregate endpoints" by construction.
2. **Client can never select a scope.** `therapistId`/`practitionerId`/`therapistIds` query params are ignored (tested). Scope derives from `req.user` only.
3. **404-on-not-yours** for appointments and voice notes, byte-identical to genuinely-missing responses (tested). Link targets that aren't yours answer the same `invalid_link` 400 as nonexistent ids — no existence leaks.
4. **Link verification is server-side and fail-closed:** `linkedEventId` must be an event on the caller's profile (or legacy `user_id` row), `linkedTaskId`/`linkedReminderId` must be the caller's snapshot rows.
5. **No secrets, ever:** the routes return only local Postgres columns; no tokens, keys, or env values appear in any response; errors are generic (`Internal error`) with details only in server logs.
6. **Draft-first clinical safety:** voice notes are created as drafts; content freezes at `reviewed`; `archived` is terminal; nothing auto-finalises.
7. **Audit:** `mobile.voice_note_created|updated|reviewed|archived|deleted` with **ids-only metadata** (verified in tests and live QA — transcripts never enter the audit log).
8. **No account with a missing therapist profile errors out:** day/calendar/travel return empty data + `warnings: ['no_therapist_profile']` so the personal parts of the screen still work.
9. **read_only** accounts: reads work, writes blocked by the existing single choke point in `permissions.requireAuth` (untouched).

## Timezone behaviour

Same contract as `scheduler-routes.js`: Perth (AWST, UTC+8, no DST) is the single business timezone. `date` params are Perth calendar dates; the server converts to a UTC window (`2026-08-10` → `[2026-08-09T16:00Z, 2026-08-10T16:00Z)`) — boundary maths verified by test. An optional `timezone` param is validated as a real IANA name (400 otherwise) but **never shifts day boundaries**; responses always declare `timezone: 'Australia/Perth'`.

## Travel derivation

Trips are derived from the day's own in-person therapy appointments in start order: trip N arrives at appointment N, origin is the previous stop (null = start of day). Minutes/km come from the columns the sync layer already stores on `events` (`travel_time_minutes`, `travel_distance`) — **nothing recalculated, no Maps/Splose calls**. Telehealth/virtual appointments (matched by `geo.js` `VIRTUAL_RE`) and cancelled appointments produce no trips. `needs_review` is a presentation state for unroutable destination addresses (same routability rule as `routes.js`); fixing addresses stays in the portal.

## Existing endpoints deliberately reused, not duplicated

- **Tasks/reminders:** mobile calls `/api/snapshot/tasks` and `/api/snapshot/reminders` directly — already user-scoped, validated, state-machined. No `/api/mobile` wrappers were added (no strong reason existed). The `/today` aggregate reads the same tables for its counts.
- **Opa chat:** `/api/opa/chat` is safe for mobile **as-is**: whole prefix requireAuth'd, role taken from session (never the body), knowledge grounding role-filtered server-side, nav actions allowlisted, audits store counts not content, provider fail-closed. One client-side caveat: it returns HTTP 200 with `status: 'grounded'|'limited'|'unavailable'` — the app must branch on `status`. Mobile-specific grounding (e.g. mobile nav targets in the action allowlist) is a Phase 4 item; **no AI provider changes were made in this phase**.

## Tests

- `tests/mobile-routes.test.js`: **35 tests** — 401 boundaries on all endpoints; own-scope pinning (query args asserted); client scope params ignored; Perth boundary maths; empty-day shape; snapshot reads scoped to caller; compact shape excludes raw Outlook/Splose fields; unroutable-address review flag; week grouping; 404-indistinguishability (foreign vs missing appointment/note); travel derivation incl. telehealth skip + cancelled exclusion; voice-note lifecycle (create/validate/max-length/link-ownership/update/review-freeze/archive-terminal/delete rules); audit actions incl. content-free metadata.
- Full unit suite: **29 suites, 721 tests, all passing.**
- Full integration suite (real Postgres, isolated `*_test` DB, migrations applied incl. 015): **24 suites, 227 tests, all passing.**

## Local QA (localhost, port 5002 — own instance; no Azure)

Seeded a throwaway QA therapist (+ second user for cross-user checks) with two demo events in the local dev DB, exercised every endpoint with curl, then deleted all QA data (users, events, notes, audit rows) and credential files. Results:

- unauthenticated → 401 everywhere; login → today/calendar/travel/detail all correct (2 appts, 2 trips, 1 needs-review, compact keys only)
- voice-note create→review→(edit 409)→(delete 409)→archive all per spec; `invalid_link` on bad/foreign links
- cross-user: user B got 404 on A's note and appointment, an empty own day, and `invalid_link` trying to link A's event
- audit rows present with ids-only metadata

## Known limitations

1. **Trip origins are best-effort:** the first trip of the day has no origin (home/base address isn't modelled locally) and origins use the previous appointment's address. Good enough for V1 display; a home-base setting is a future enhancement.
2. **Travel minutes/km exist only where the sync layer stored them** (`travel_time_minutes`/`travel_distance` on events); trips without them show nulls rather than recalculating.
3. **No pagination** (fixed LIMITs, matching portal convention): 100 tasks/reminders, 200 voice notes, 50 linked notes.
4. **Rate limiting:** none added for mobile endpoints (reads are cheap; writes are user-scoped INSERTs). The portal's login and Opa limits apply unchanged.
5. **Session model unchanged:** 8 h rolling cookie; mobile app must handle overnight expiry (documented in the mobile repo's security model).
6. **Parallel-work note:** migration numbering collided with same-day work (013/014 taken); voice notes landed as 015. `tests/integration/migrate.itest.js` was updated for the new ledger by the parallel session.

## Phase 3 integration notes (for the mobile app)

- Base URL: `http://localhost:5001` dev. Cookie auth: `POST /api/auth/login`, store `connect.sid`, replay; 401 → login screen.
- Branch on `warnings: ['no_therapist_profile']` for unmapped accounts — render tasks/reminders/notes anyway.
- Today aggregate covers the whole Today tab in one request; pull-to-refresh re-fetches it.
- Voice flow: on-device transcription → `POST /api/mobile/voice-notes` (draft) → optional `PATCH` edits → review happens wherever the user chooses (mobile PATCH `status: 'reviewed'` or portal).
- Convert-to-task/reminder = client calls `POST /api/snapshot/tasks|reminders` with the transcript-derived title (no mobile endpoint needed).
