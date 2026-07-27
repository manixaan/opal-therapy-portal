# Opal Finance — Recommended Target Architecture

A small, boring, safe finance app. The scheduling portal proved the
domain logic; Opal Finance gives it a clean home without a 7,500-line
frontend file or scheduler coupling.

## 1. Shape

Same proven stack, new repo:

```
opal-finance/
├── backend/
│   ├── server.js              express app; raw webhook parser BEFORE json
│   ├── config.js              env validation (fail fast, no defaults for secrets)
│   ├── db.js                  pg Pool + tiny query helpers
│   ├── migrate.js             ported checksummed runner (advisory lock)
│   ├── migrations/001_finance_core.sql   (= 004+006 merged, FKs re-pointed)
│   ├── auth/                  NEW: sessions + login + RBAC (owner/bookkeeper)
│   ├── audit.js               NEW: audit_logs table + logAuditEvent
│   ├── crypto-utils.js        copied; NEW ENCRYPTION_KEY
│   ├── finance-flags.js       copied verbatim
│   ├── xero/                  xero-api.js, xero-sync.js (copied)
│   ├── engines/               contact-matching, pricing, candidate,
│   │                          reconciliation, exceptions (copied; pool injected)
│   ├── splose/                NEW thin read-only client (appointments, patients)
│   └── routes/                rebuilt: oauth, sync, dashboard, candidates,
│                              contacts, exceptions, config, webhook
├── frontend/                  simple multi-page or SPA; NOT one giant file
└── tests/                     unit + integration (ported + harness rebuilt)
```

Node 22 + Express 4 (or 5 — if 5, async handlers are safe natively, but
keep the guard habit) + PostgreSQL. No ORM — the SQL in `accounting-db.js`
is already written and tested.

## 2. Key decisions (make these first)

1. **Tenancy**: single practice → drop `organisation_id` everywhere
   (simplest, recommended); the COALESCE indexes become plain unique keys.
   Keep the column only if multi-practice is a real roadmap item.
2. **Splose access**: own API client with its own key (recommended) vs an
   internal read-only API on the scheduler. Own client removes the
   cross-app dependency; needs the owner to issue a key (note the
   dead-key-within-a-day incident — verify durability with Splose).
3. **Users/roles**: owner + optional bookkeeper role. Reuse the
   scheduler's session/bcrypt/rate-limit patterns (they are hardened), not
   its code wholesale.
4. **Xero app registration**: register a NEW Xero app (own client id/secret,
   redirect URI on the Opal Finance domain). Scopes: `offline_access
   accounting.transactions accounting.contacts accounting.settings` (+
   payroll scopes only when that phase starts — see capability matrix).
5. **Hosting**: mirror the proven Azure pattern — App Service + PG Flexible
   + Key Vault (RBAC, env references) + App Insights; OIDC GitHub Actions
   deploy with both classic and immutable-format federated subjects; CI =
   unit + integration (PG service container) + migration validation +
   zero-vuln audit gate.

## 3. Port order (each step lands green before the next)

1. Skeleton: server, config, db, health (`/health`, `/ready`), CI, test harness.
2. `001_finance_core.sql` + migrate runner + ledger itest.
3. `finance-flags.js` + its 11 tests. **Nothing Xero-shaped before this.**
4. Auth + audit + RBAC (+ tests: 401/403 loop).
5. `crypto-utils` + `xero-api` + OAuth routes (+ ported OAuth itests:
   encrypted at rest, no session switch, forged-state 403).
6. `xero-sync` + cache routes + sync log + dashboard.
7. Engines + their unit tests (pure — should pass unmodified).
8. Candidates/contacts/exceptions routes + ported phase-2 itests.
9. Frontend screens (Connection, Dashboard, Exceptions, Contacts,
   Candidates, Pricing/Mappings, Sync Log; locked write buttons visible).
10. Staging deploy + smoke (reuse the 13-item pattern) → owner connects
    **Demo Company** → live read-only validation.
11. Only then: Phase 2B roadmap (payment-status sync, duplicate heuristics,
    expenses/timesheets/leave). Pay-run automation: never.

## 4. What NOT to build

- No calendar, no Outlook, no Resource Hub, no scheduling concepts.
- No background write jobs of any kind; writes only ever happen from an
  explicit owner action behind the double gate.
- No pay-run creation/posting code, ever.
- No secret in git or logs; Key Vault references only.

## 5. Interfaces back to the scheduling portal (later, optional)

None required for v1. If the portal later wants finance signals (e.g. an
"uninvoiced appointments" card), add a read-only endpoint on Opal Finance
and keep the apps otherwise independent. Do not share a database.
