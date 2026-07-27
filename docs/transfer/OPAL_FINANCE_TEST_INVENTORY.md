# Opal Finance — Test Inventory

67 accounting-specific tests (out of the repo's 151 unit + 104 integration,
all green with clean exits at `8c893bf`). All six files are copied into the
pack under `tests/`.

## 1. Unit tests (39) — port with the modules they cover, near-zero changes

| File | Tests | Covers |
|---|---|---|
| `finance-flags.test.js` | 11 | Read defaults; writes OFF in dev/test/staging/production; only literal `'true'` enables; draft + contact double gates; ALL six write helpers blocked by master gate alone; webhook independence; `financeDisabledError` shape; flag snapshot |
| `contact-matching.test.js` | 10 | Full confidence ladder (existing > email > name_exact > fuzzy > multiple > none); never-auto-map property; name normalisation; fuzzy word-containment rules |
| `pricing-engine.test.js` | 10 | Rule matching precedence (service/type/funding/MMM), amounts/tax, warning codes |
| `reconciliation-engine.test.js` | 8 | Match suggestion logic, confidence, reasons |

Requirements: plain jest, no DB. `finance-flags.test.js` resets modules +
env per test (pattern worth keeping).

## 2. Integration tests (28) — port after routes/auth are rebuilt

| File | Tests | Covers |
|---|---|---|
| `accounting-routes.itest.js` | 11 | RBAC loop (admin/therapist/read_only denied, unauth 401, owner allowed); OAuth connect/callback: token to org, encrypted at rest, NO user auto-provisioning, session never switched, wrong role 403, forged state 403 in staging before token exchange; draft-create 403 flag-off with valid candidate; validation gauntlet 400 with flags on; review audited; webhook 404 flag-off / 401 bad HMAC |
| `accounting-phase2.itest.js` | 17 | RBAC on all slice-1 routes; contact-create stub 403/403-hard-rule/501; exception-dashboard flag off → 403; manual map persists (mapped/high/manual) + audited; suggestions never downgrade confirmed; mapping upsert idempotent under NULL org; refresh-suggestions clean 404 unconnected; candidate readiness blocked without ContactID / ready with it / regeneration no-duplicate; exception generation (5 types, severity order, explanation+action present); regeneration idempotent; resolve→recurs, dismiss→permanent, reopen; auto-resolve when condition fixed; identifiers-only privacy assertion |

## 3. Harness the integration tests assume (rebuild equivalents)

- `tests/integration/env.js` (setupFiles): forces DB name to `*_test`;
  `helpers.js` re-verifies the LIVE pool targets `*_test` (belt+braces) —
  **keep this safety**, it prevents tests trashing a real DB.
- `globalSetup`: runs migrations on the test DB.
- `helpers.js`: `truncateAll` (TRUNCATE … RESTART IDENTITY CASCADE),
  `seedUser`, `closePool`.
- Express app built per test file: `body-parser` + `express-session` +
  auth router + accounting router; login via supertest agent.
- Auth router must expose a rate-limit reset (`_resetLoginRateLimit`) or
  repeated logins from one IP will 429 mid-suite.
- jest.integration.config: `maxWorkers: 1` (shared DB), `.itest.js` match.
- `migrate.itest.js` pattern: assert the EXACT migration ledger array —
  update it with every new migration (deliberate tripwire).

## 4. Hard-won test lessons (encode in Opal Finance from day 1)

1. **Express 4 async handlers must be wrapped/guarded.** An unhandled
   rejection hangs the request, leaks the supertest socket, and jest never
   exits. Use a `safe()` wrapper or try/catch in every handler.
2. **Never reuse a pg parameter inside a CASE** — "inconsistent types
   deduced for parameter $N". Compute values in JS and pass distinct params.
   (Bit this repo twice: Resource Hub, then `setExceptionStatus`.)
3. NULL-org `ON CONFLICT` needs the COALESCE expression indexes (006) or
   idempotency silently breaks — and only an itest that runs the upsert
   twice catches it.
4. A "passing" suite that never exits is a failing suite — treat lingering
   jest processes as red, run `--detectOpenHandles` when in doubt.

## 5. Not ported (scheduler-owned, for regression context only)

Calendar/series-master/events-sync, Resource Hub, users/auth/documents/
health itests, `reconcile-safety.itest.js` (calendar reconciliation — the
name collides with finance reconciliation but it is a calendar test).
