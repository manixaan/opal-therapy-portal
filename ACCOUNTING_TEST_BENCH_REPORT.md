# Accounting Module Test Bench Report

**Module:** Accounting / Xero (owner-only finance) · **Branch:** `xero-accounting-module`
**Date:** 2026-07-26 · **Xero live connection:** NOT YET (owner action pending — see `deploy/XERO_OWNER_ACTIONS_CHECKLIST.md`)

This bench covers everything testable without a live Xero credential. Xero's
HTTP API is mocked at the client boundary; all business logic, RBAC, flag
enforcement, encryption, validation, and audit are exercised against real
Express + PostgreSQL.

## Totals

| Suite | Count | Status |
|---|---|---|
| Unit (jest) | 13 suites, **138 tests** | ✅ all passing (29 net-new for accounting) |
| Integration (real PostgreSQL) | 11 suites, **84 tests** | ✅ all passing (11 net-new for accounting) |
| Dependency audit | `npm audit` | ✅ 0 vulnerabilities |
| Production-mode boot | fail-closed check | ✅ writes off with no flags set |

## Results by category

### OAuth
| Test | Result | Evidence |
|---|---|---|
| Connect returns authUrl + stores state | PASS | integration: authUrl contains `login.xero.com` |
| Callback attaches tokens to the ORG, not a Xero-email user | PASS | connection row on org; **0 new users created** (no Outlook-class session switch) |
| Session user unchanged after callback | PASS | `/status` still the same owner |
| Tokens encrypted at rest | PASS | `access_token` starts with `enc:` in the DB (integration env now sets `TOKEN_ENCRYPTION_KEY`) |
| Callback wrong role → 403, no token exchange | PASS | `exchangeCodeForTokens` never called |
| Invalid state in staging → 403 before exchange | PASS | strict-env branch; exchange not called |
| Token refresh persists rotated refresh token | PASS | `updateConnectionTokens` re-encrypts; `ensureValidToken` unit-covered |

### Sync (read-only)
| Test | Result | Notes |
|---|---|---|
| Resource mappers (contacts/invoices/payments/accounts/items) | PASS | `xero-sync._maps` + Xero date parsing (`/Date(...)/` + ISO) |
| Pagination completeness flag | PASS | `apiGetAll` returns `complete:false` past the page cap; sync records `blocked` |
| Rate-limit 429 backoff | PASS (unit) | `apiGet` honours `Retry-After`, bounded retries |
| No writes during sync | PASS | sync layer has no write paths; only GETs |
| Sync state + sanitised sync log | PASS | per-resource state; log messages truncated, no payloads |

### RBAC (the security boundary — backend-enforced)
| Test | Result |
|---|---|
| admin / therapist / read_only denied **every** accounting route (401/403, never 200) | PASS |
| unauthenticated denied every route | PASS |
| owner allowed | PASS |
| callback owner-only even as a redirect target | PASS |

### Feature flags (fail closed)
| Test | Result |
|---|---|
| Every write flag OFF when unset — in development, test, staging AND production | PASS (unit, all 4 envs) |
| Only literal `'true'` enables a flag | PASS |
| Draft create requires BOTH `ENABLE_XERO_WRITE` and the specific flag | PASS |
| Draft-invoice route → 403 while flag off (even for owner, even with a valid candidate) | PASS (integration) |
| Production boot logs all write flags false with none set | PASS (live boot) |

### Pricing engine
| Test | Result |
|---|---|
| Most-specific rule wins; effective-date windows honoured | PASS |
| Duration → quantity (90 min = 1.5) | PASS |
| Cancelled appointment → no lines, `ignored` | PASS |
| **No matching rule → `needs_pricing`, never a guessed amount** | PASS |
| Unmapped contact → `needs_mapping` | PASS |
| GST vs exempt tax estimate | PASS |
| Missing account/item code warned | PASS |

### Invoice candidates
| Test | Result |
|---|---|
| Idempotent — re-run keyed on appointment id, no duplicates | PASS (UNIQUE constraint + upsert logic) |
| A candidate that already produced a Xero draft never regresses | PASS (upsert guards status + lines) |
| Review transitions + audit | PASS |

### Draft invoice creation (write path)
| Test | Result |
|---|---|
| Flag off → 403 | PASS |
| Flag on but candidate not `approved_for_draft` → 400 (validation gauntlet) | PASS |
| Validation blocks: existing invoice, no contact, no lines, bad amount, missing codes | PASS (route logic; covered by integration + unit of the guards) |
| Creates **DRAFT only** — never AUTHORISED/sent | PASS (payload `Status: DRAFT`; no approve/send code path exists) |

### Reconciliation assistant
| Test | Result |
|---|---|
| Exact linked payment → exact/high | PASS |
| Reference-only match → medium | PASS |
| Partial / over / under payment classified | PASS |
| Contact-name mismatch lowers confidence | PASS |
| Unmatched payment → manual_review_required | PASS |
| Unmatched authorised invoice surfaced; overdue flagged | PASS |
| Fully-paid invoice not surfaced | PASS |
| **No bank-statement-line reconciliation claimed** | PASS (assistant records decisions only; UI + API note the Xero limitation) |

### Webhooks
| Test | Result |
|---|---|
| Flag off → 404 | PASS |
| Bad HMAC signature → 401 | PASS |
| Raw body mounted before JSON parser (signature integrity) | PASS (server.js wiring) |

### Logging / security
| Property | Result |
|---|---|
| Tokens encrypted at rest; decrypted only at the API choke point | PASS |
| No tokens/secrets/bank payloads in logs | PASS (sync log messages truncated; errors carry Xero codes only; structured logger redaction applies) |
| Clinical notes never pulled into candidates | PASS (generator explicitly excludes `note`) |
| Every financial action audited (connect, disconnect, refresh, sync, candidate review, draft create, reconciliation decision, pricing/mapping changes) | PASS (`logAuditEvent` on each) |

## Classifications

| Item | Class |
|---|---|
| All logic/RBAC/flag/validation/audit behaviour | **PASS** |
| Live Xero OAuth, sync, dashboards against a real org | **NOT TESTED — OWNER XERO ACTION REQUIRED** (Phase X17) |
| Draft invoice creation against real Xero | **NOT TESTED — owner approval + Phase X18 required** |
| Webhook end-to-end with Xero delivery | **NOT TESTED — owner setup required (X16 §E)** |
| Bank statement-line reconciliation | **NOT SUPPORTED BY PUBLIC API** — designed around, never faked |

## Remaining blockers

1. **Xero developer app + credentials** (owner) — the only thing between this
   and live read-only staging validation. Checklist:
   `deploy/XERO_OWNER_ACTIONS_CHECKLIST.md`.
2. Live read-only validation (X17) and controlled draft-invoice test (X18)
   run after the credentials land; both keep writes off / minimal.

**No overstatement:** every "PASS" above is local/mocked-Xero evidence.
Nothing involving a real Xero organisation has run yet.
