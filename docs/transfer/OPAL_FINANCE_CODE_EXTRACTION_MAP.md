# Opal Finance — Code Extraction Map

Exact source locations, line counts, dependency edges and portability
rating for every piece of the Accounting/Xero module. Source of truth:
scheduling repo at commit `8c893bf`.

Portability legend — **P** portable as-is · **T** thin coupling (1–2
injectable seams) · **C** coupled (rewrite around it).

## 1. Backend modules (`backend/`)

| File | Lines | Internal requires | Rating | Notes |
|---|---|---|---|---|
| `contact-matching.js` | 112 | — (pure) | **P** | Confidence ladder; unit-tested |
| `pricing-engine.js` | 124 | — (pure) | **P** | Rule matching by service/type/funding/MMM |
| `reconciliation-engine.js` | 110 | — (pure) | **P** | Suggestion-only matcher |
| `candidate-engine.js` | 104 | — (DI: `{adb, pricing, logger}`) | **P** | Idempotent by appointment id; readiness requires confirmed ContactID |
| `xero-sync.js` | 151 | — (DI: `{xeroApi, adb, logger}`) | **P** | Paged read-only sync of 5 resources |
| `finance-flags.js` | 99 | — (env only) | **P** | THE safety model; copy verbatim |
| `xero-api.js` | 222 | `crypto-utils` (`decrypt`) | **T** | OAuth + API client; token rotation, 429 retry, pagination; env: `XERO_CLIENT_ID/SECRET/REDIRECT_URI` |
| `accounting-db.js` | 532 | `database` (`pool`), `crypto-utils` (`encrypt`) | **T** | All SQL; swap in the new app's pool; COALESCE `ON CONFLICT` targets must match migration 006 indexes |
| `accounting-exceptions.js` | 133 | `database` (`pool`) | **T** | Exception engine; same pool seam |
| `accounting-routes.js` | 589 | `database`, `accounting-db`, `xero-api`, `finance-flags`, `pricing-engine`, `reconciliation-engine`, `xero-sync`, `candidate-engine`, `permissions`, `accounting-exceptions`, `contact-matching`, `logger`; lazy `splose-api` (lines ~250, ~505) | **C** | Transplant handler bodies; rebuild auth/audit/logging seams |

## 2. Shared modules the above depend on (`backend/`, copies in pack under `backend/shared/`)

| File | Lines | Why needed | Opal Finance action |
|---|---|---|---|
| `crypto-utils.js` | 124 | AES-256-GCM encrypt/decrypt, `enc:` prefix, `ENCRYPTION_KEY` env; decrypt passes plaintext through | Copy; generate a NEW key |
| `permissions.js` | 275 | `requireAuth`, `requireRole` middleware over session user | Rewrite for the new app's auth; keep owner-only invariant |
| `logger.js` | 153 | Structured logger + App Insights | Replace with the new app's logger |
| `database.js` (partial) | — | `pool` (pg Pool from env) + `logAuditEvent` | Rebuild: small pool module + own audit table/helper |
| `splose-api.js` (reference only) | ~560 | `getAppointments`, `getPatients` (normalised, throttled, cached) | Decide integration pattern (own client vs internal API); do NOT copy wholesale — it contains scheduling-specific normalisation |

## 3. Server mounting (`backend/server.js`)

```js
// line ~135 — BEFORE bodyParser.json: raw bytes for webhook HMAC
app.use('/api/accounting/webhooks/xero', express.raw({ type: '*/*' }));
// lines ~447–449
const accountingRoutes = require('./accounting-routes');
app.post('/api/accounting/webhooks/xero', accountingRoutes.xeroWebhookHandler);
app.use('/', accountingRoutes);
```
Preserve raw-before-json ordering in Opal Finance or webhook signatures
will never verify.

## 4. Migrations (`backend/migrations/`)

| File | Contents |
|---|---|
| `004_accounting_xero_module.sql` (291 lines) | 16 tables (connections, sync state, 5 caches, dashboard snapshots, service mappings, contact mappings, pricing rules, candidates + lines + actions, reconciliation candidates, sync log) |
| `006_accounting_exceptions_and_mapping.sql` (58 lines) | `accounting_exception_items`, `match_reason`, `duplicate_reason`, 3 COALESCE unique indexes (NULL-org dedupe repair) |

FKs into scheduler tables: `organisations(id)` on most finance tables;
`users(id)` on `connected_by_user_id` / `created_by_user_id` /
`reviewed_by_user_id` / `resolved_by` / `decided_by_user_id`. Replace or
drop in the new app's baseline. Migration-runner pattern (checksummed
ledger, advisory lock 743901) is worth porting; `migrate.js` is generic.

## 5. Frontend (`frontend/current/mockup_v3.html`)

| Block | Lines (at 8c893bf) | Extracted to |
|---|---|---|
| Accounting section: `<style>` + sub-nav + panels | 4255–4340 | pack `frontend/accounting-section.html` |
| Accounting JS: `acctState` → `hookAccountingTab` (all `acct*` functions) | 6873–7178 | pack `frontend/accounting-module.js` |
| Tab button + owner-gating | `data-tab="accounting"` in the nav; revealed for owner in `initAuth` | note only |

External symbols the JS block uses: `showToast`, session cookie
(`credentials:'include'`), CSS vars (`--border`, `--muted`, `--surface-2`).
CSS classes `.acct-page`, `.acct-note`, `.acct-table` are REUSED by the
Resource Hub tab — see handover §4.7 before any later removal.

## 6. Tests (`backend/tests/`)

Copied into the pack under `tests/`; see `OPAL_FINANCE_TEST_INVENTORY.md`
for the per-test breakdown and harness requirements
(`*_test` DB enforcement, `truncateAll` CASCADE, `_resetLoginRateLimit`).

## 7. Deploy/config references

- `deploy/staging-xero-config.sh` — env-driven Key Vault + App Service
  setup for Xero secrets/flags (no secret values inside; takes them from
  the caller's env). Template for Opal Finance's own config script.
- `deploy/XERO_OWNER_ACTIONS_CHECKLIST.md`, `docs/accounting/NEXT_XERO_SETUP_STEPS.md`
  — owner-facing Xero app setup; the **redirect URI must change** to the
  Opal Finance domain (new Xero app registration recommended).
- KV secret names used today: `xero-client-id`, `xero-client-secret`,
  `xero-webhook-key` (names only — values live in Key Vault, never in git).
