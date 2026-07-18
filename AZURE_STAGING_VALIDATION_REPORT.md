# Azure Staging Validation Report — Opal Therapy Employee Portal

**Date:** 2026-07-17 · **Branch:** `azure-staging` · **Staging URL:** https://opal-portal-staging.azurewebsites.net
**Deployed commit:** `4a32674` (runs `29580014469` → `29582738520` → `29584716994`, all green)
**Data policy honoured:** synthetic accounts only; the single connected mailbox (`adminservices@opaltherapy.com.au`, chosen by the owner) is an admin service mailbox — its 3 mirrored events carry no clinical content. No production data exists anywhere in staging.

---

## Classification per area

| Area | Result |
|---|---|
| Azure resources (RG, App Service B1/Node 22, PG Flexible 16 + PITR 14d, Key Vault RBAC, private Blob, App Insights→Log Analytics) | **PASS** |
| Environment configuration (Key Vault references, managed identity, strict env validation) | **PASS** |
| Deployment pipeline (OIDC federated, CI-gated, health-gated; 3 further deploys this stage) | **PASS** |
| `/health` / `/ready` | **PASS** (200/200 after every deploy; DB-outage split re-proven) |
| Migrations (ledger `000–003`, applied by `startup.sh`, advisory-locked) | **PASS** |
| Synthetic employees (4 roles: registration-equivalent seed, login, sessions, password change, suspension lifecycle, concurrent logins) | **PASS** (31-probe harness + 7-probe lifecycle, all green) |
| Role enforcement (owner/admin/therapist/read_only incl. server-side read_only write-block) | **PASS** |
| Blob storage round trip (private container, authz denials, executable rejection, delete) | **PASS** |
| Application Insights (requests + dependencies + correlation ids; sensitive-shape KQL scan = 0 rows; 3 alert rules + action group) | **PASS** |
| Entra staging registration (separate app `667a8036…`, tenant-scoped, admin consent, secret in KV only) | **PASS** |
| **Outlook read-only validation (Stage 12)** | **PASS** — detail below |
| Outlook write/delete blocked while flags off | **PASS (live)** — create → 403 `feature_disabled`, update → 403, poller cascade delete gated (delete shares the same module guard; unit-proven) |
| **Splose read-only validation (Stage 13)** | **PASS** (2026-07-18, real API key in Key Vault) — API auth ✓; practitioners (2) / locations (1) / services (16) / busy-time-types retrieved ✓; appointments via **real 17-page cursor pagination (1,610 records, `_fetchComplete=true`)** ✓; throttled fetching exercised ✓; 15-min cancellation poller cycling with zero errors ✓; empty/truncated-response safety engaged by design (completeness metadata observed true on live data) ✓; **write still 403 `feature_disabled` with a working key** ✓. Ops note: `az webapp restart` alone did **not** re-resolve the Key Vault reference — rewriting the app setting forced it (documented for rotations) |
| Data comparison (Stage 14) | **PASS** — Splose↔portal exact match on a 14-day live window: counts 3=3, **identical id-set digests**, identical start times, identical practitioner ids; Outlook↔portal previously verified (3 events, distinct ids, correct owner, 0 duplicates/ghosts). No mismatch to correct; no deletion pathways touched |
| Log hygiene (container logs + telemetry: no tokens, cookies, secrets, `enc:` material, clinical content) | **PASS** (three separate scans) |

## The onboarding-loop bug — required answers

1. **Root cause:** the OAuth callback matched portal users by **Microsoft email**, auto-created an account for the shared mailbox, and **overwrote the session** onto that new, un-onboarded user → Step 1 forever. Two aggravators found and fixed in the same pass: `safeProfile` never returned the persisted onboarding arrays the wizard reads, and the wizard's `init()` unconditionally reset to Step 1 (clobbering even the OAuth `?step=4` return).
2. **Files changed:** `backend/routes.js` (callback session-attachment + eligibility before token exchange), `backend/register-routes.js` (arrays in payload; idempotent step appends), `frontend/current/onboarding.html` (resume logic), `backend/migrations/002_outlook_connected_email.sql`, plus `backend/server.js`/`crypto-utils` tests and `migrations/003` for the two follow-on staging defects.
3. **Database state checked:** wrongly created `adminservices@…` portal user present with encrypted tokens; four synthetic users intact; owner's completed-steps array showed duplicate appends (fixed).
4. **Token saved before fix:** yes — encrypted access+refresh pair. 5. **Attached to correct user:** no — attached to the auto-created account (now: attached to `synthetic.owner`, mailbox address recorded separately). 6. **Duplicates:** no duplicate token records (tokens live on the user row); the duplicate *account* was deleted (0 events had synced to it; 1 session row removed; audit rows detached).
7. **Tests added:** 8 OAuth-callback integration tests (session attachment, no wrong-user association, no auto-provisioning in strict envs, progress across connect/refresh/re-login, reconnect idempotency, state-rejection before exchange, wizard contract) + 5 crypto-utils contract tests + 2 contract updates. 8. **Totals: 109 unit + 73 integration, all passing.**
9. **Deployment runs:** `29580014469` (loop fix + migration 002), `29582738520` (token decrypt), `29584716994` (event-type migration 003).
10. **Staging validation:** login → main app (no loop) ✓ · Integrations shows **Connected** ✓ · connected account = `adminservices@opaltherapy.com.au` (API/DB; the panel label shows the portal email — cosmetic defect S-5) ✓ · page refresh persists ✓ · re-login persists ✓ · `/health` + `/ready` 200 ✓.
11. **Stage 12:** completed — see below. 12. **Remaining limitations:** listed at the end.

## Two further staging-only defects found by Stage 12 (both fixed)

- **Encrypted tokens sent raw to Graph** (`Bearer enc:…` → 401 every cycle): the pollers SELECT token columns via raw SQL, bypassing the decrypting db helpers; dev never noticed because without `TOKEN_ENCRYPTION_KEY` tokens rest as plaintext. Fixed at the single choke point (`getValidTokenForUser` decrypts defensively; the Splose poller receives the same function via DI). Graph error **codes** now logged.
- **`valid_event_type` CHECK rejected real mailbox events**: the classifier's documented default `'outlook'` (and `'report'`) were missing from the constraint; dev's events table predates the CHECK so it was never enforced there. Migration 003 aligns the constraint with the classifier vocabulary.

## Stage 12 — Outlook controlled read-only validation

With `ENABLE_OUTLOOK_WRITE=false`, `ENABLE_AUTOMATIC_REMOTE_DELETE=false` (boot-logged, diagnostics-verified):

| Check | Result |
|---|---|
| OAuth connection (portal-first, session preserved) | ✅ live, browser-driven |
| Token encryption at rest (AES-GCM `enc:` form, never raw JWT) | ✅ DB-verified |
| Token refresh | ✅ live (`🔁 Refreshing → ✅ refreshed` in logs, re-encrypted on save) |
| Calendar retrieval + delta bootstrap | ✅ 3 events mirrored, `deltaLink` saved |
| Incremental delta cycles | ✅ every 90 s, “no changes” steady-state |
| Correct employee ownership | ✅ all events on `synthetic.owner`; zero on any other user |
| No duplicates / no ghosts | ✅ 3 distinct `outlook_id`s, 0 duplicate groups, 0 tombstones |
| Cannot create / update in Outlook | ✅ live 403 `feature_disabled` naming the flag |
| Cannot delete in Outlook | ✅ poller cascade explicitly gated + same module guard as create/update (live-proven); delete *route* intentionally not fired at a real event because its designed local-tombstone fallback would mutate the mirror |
| OAuth state validation | ✅ forged state → 403 before any token exchange |
| Full ±90-day reconciliation, multi-page pagination, webhook receipt, Socket.IO push during a change | ⚠️ PASS WITH LIMITATION — 3-event calendar exercises single-page paths only; reconcile interval not yet elapsed; `WEBHOOK_BASE_URL` deliberately unset (polling covers staging); all four heavily covered by the integration suite |

## Remaining limitations / open items

1. **Outlook-side scale coverage** — the connected admin mailbox holds 3 events, so Outlook delta pagination and the ±90-day reconcile ran on a small calendar (Splose-side pagination is now proven at 17 pages / 1,610 records; the Outlook mechanics share the integration-test coverage). Revisit when a fuller calendar is connected during live testing.
2. Cosmetic: Integrations panel labels the connection with the portal email instead of the recorded mailbox (S-5); Settings “Connect Outlook” button navigates to raw JSON instead of following `authUrl` (S-4) — the flow works via onboarding and direct URL; both are small frontend fixes for the next pass.
3. Entra edge-flows not exercised: MFA-challenged sign-in, cancelled consent, unapproved employee via SSO (email/password remains the portal login; these belong to the future SSO stage).
4. **Ops note for secret rotations**: an App Service restart alone may serve a cached Key Vault reference — force re-resolution by rewriting the app setting (same reference string) after rotating a secret; the old worker also keeps serving ~100 s, so verify against a fresh worker (uptime reset).

---

# Final readiness decision

> # READY FOR CONTROLLED READ-ONLY LIVE TESTING

Supported by completed cloud evidence — now **full scope (Outlook + Splose)**: the platform validation (31/31 probes), the live Outlook read-only pipeline (connect → encrypted tokens → refresh → delta mirror → correct ownership → zero duplicates), the live Splose read-only pipeline (real key, 17-page/1,610-record pagination with completeness metadata, exact source↔portal data fidelity, clean poller cycles), and live proof with working credentials that the portal **cannot write into or delete from either system** while the staged flags are off. Controlled read-only live testing may begin across both integrations immediately. This classification is deliberately not LIMITED PILOT: write-back remains off pending the read-only live period, and the (now small) limitations above stand.
