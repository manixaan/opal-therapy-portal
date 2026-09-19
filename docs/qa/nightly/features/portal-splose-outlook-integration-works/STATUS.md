# Portal - Splose - Outlook | Integration Works

- Tracker stage: **idea** · Tracker environment: **none**
- Evidence label: **tab-unproven**
- Addressed since last audit (2026-09-18T19:20Z UTC, commit `0726dde`): **partially** — `ec47514`
  and `cec0a03` add a small, unrelated capability to two of this feature's files (see below);
  nothing in its actual sync/identity/credential *behaviour* changed
- Created (any located code): **yes**

## Located files

- `backend/splose-sync-routes.js`, `backend/splose-api.js`, `backend/splose-caseload.js`,
  `backend/splose-draft-sync.js`, `backend/splose-poller.js`, `backend/splose-link-routes.js`,
  `backend/splose-credentials.js`, migration `069_integration_connections.sql`,
  `backend/outlook-oauth.js`, `backend/travel-routes.js`, `backend/travel-cascade.js`,
  `backend/travel-feasibility.js` — all confirmed present.
- Frontend: Calendar tab, Travel & Flights tab, Settings → Integrations → Splose
  (practitioner picker + API-key connect/disconnect, inline script in `mockup_v3.html`).

**Tonight's touch, read in full:** `git diff 0726dde..HEAD -- backend/splose-api.js
backend/splose-credentials.js` (24 lines) shows exactly two things, both from the unrelated
de-identification feature:
1. `splose-api.js` gains one new function, `getPatientIdentifiers()` — returns each active
   patient's DOB/phones/NDIS/Medicare/address, explicitly documented as "for the de-identifier's
   known-value matcher ONLY... must never leave the server or be logged."
2. `splose-credentials.js`'s `apply()` gains two lines calling
   `require('./assist/identity-directory').invalidate()` and
   `require('./assist/known-values').clear()` after `setApiKey()` — clears an unrelated cache when
   the Splose connection changes accounts.

Neither touches `splose-link-routes.js`, any guard, any route, or the connection-resolution logic
itself. `git log 0726dde..HEAD --oneline -- <all other located files>` — empty.

## Guard check

- `splose-sync-routes.js` — `router.use('/api/splose-sync', requireAuth, denyReadOnly,
  requireDraftSync)`.
- `splose-link-routes.js` — `router.use('/api/splose/my-practitioner', requireAuth, ...)` with an
  inline `role === 'read_only'` 403 check; `router.use('/api/splose/connection', requireAuth,
  requireRole('owner'))`.
- No unguarded route found in either file; unchanged tonight.

## Tests run

Re-run fresh tonight (`DB_NAME=therapy_scheduler_n4b`), including the two files that changed:

- `npx jest tests/splose-link-routes.test.js tests/splose-credentials.test.js` — **PASS 24/24**.
- `npx jest tests/splose-api-queue.test.js` (re-run specifically because `splose-api.js` changed
  tonight) — **PASS 4/4**.
- `npx jest tests/mobile-routes.test.js tests/frontend-stage2-guards.test.js
  tests/assessment-surface-guards.test.js` — **PASS 134/134** (combined with the 4 above = 138,
  matching last night's figure).
- Prior-baseline unit suite (10 files) — **PASS 184/184**.
- `DB_NAME=therapy_scheduler_n4b DB_PASSWORD=audit npx jest --config jest.integration.config.js
  tests/integration/splose-connection.itest.js --runInBand` — **PASS 3/3**.
- Prior-baseline integration suite (5 files) — **PASS 55/55**, no DB contention this run.

Total 346 unit + 58 integration, all green — matches last night exactly, with
`splose-api-queue.test.js` specifically re-confirmed on top of tonight's `getPatientIdentifiers()`
addition. No TODO/FIXME found in `splose-*.js`/`outlook-*.js`.

## Why not `proven`

`docs/qa/BROWSER_QA_RESULTS.md` flow E is dated 2026-08-01, before the calendar/travel commits and
the Settings → Integrations → Splose UI existed. That UI still has zero browser or E2E proof
anywhere in the repo. No new artifact appeared tonight. The identity/credential cache-clearing
addition is server-side plumbing with its own passing unit coverage; it doesn't touch this gap.

## Disagreement

Tracker stage is idea; the calendar/Splose/Outlook sync engine plus the practitioner-identity and
practice-credential management is extensively built and freshly tested (346 unit + 58 integration,
all green) — materially ahead of "idea," just not browser-proven yet for its newest surface. The
"Multi Calendar Rules" tracker task still does not map to any code, table, or UI string in the
repo.
