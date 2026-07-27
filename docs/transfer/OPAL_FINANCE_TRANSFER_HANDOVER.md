# Opal Finance — Transfer Handover

> Decision (2026-07-27): the Accounting/Xero module moves OUT of the Opal
> Therapy scheduling portal into a separate application, **Opal Finance**.
> This pack is the complete handover. The module stays in place and running
> (read-only, all write flags off) until Opal Finance is stood up; nothing
> has been deleted or disabled here.

**Source state at handover:** scheduling repo `manixaan/opal-therapy-portal`,
deployed commit `8c893bf` (branch pathway `accounting-automation-phase-2` →
`azure-staging` → `main`), migrations 000–006 applied on staging,
classification **READY FOR STAGING REVIEW**. Local tests 151 unit + 104
integration, clean exits. No Xero connection has ever been made from staging;
no Xero write has ever occurred.

---

## 1. What was built (X-phases + Phase 2 slice 1)

| Area | State |
|---|---|
| Xero OAuth (owner-only, org-scoped) | Complete — tokens AES-256-GCM encrypted at rest, refresh rotation persisted, no session switching |
| Read-only sync | Complete — contacts / invoices / payments / accounts / items → local cache tables, sync state + sanitised sync log |
| Finance dashboard | Complete — computed from cache, owner-only |
| Pricing rules + service mappings | Complete — rule matching by service/type/funding/MMM |
| Invoice candidates | Complete — idempotent generation from Splose appointments, warning codes, review workflow (approve / ignore), readiness blocked without confirmed payer mapping |
| Draft invoice creation | Code exists, **double-flag-gated, never enabled**; DRAFT only, never authorise/send |
| Reconciliation assistant | Complete — suggestion-only (Xero's public API cannot reconcile bank lines; bank rec stays in Xero) |
| Contact mappings (Phase 2) | Complete — permanent `splose_client_id ↔ xero ContactID` map, confidence ladder, manual confirmation, never auto-maps |
| Exception dashboard (Phase 2) | Complete — typed items, severity, suggested action, resolve/dismiss/reopen, idempotent regeneration, auto-resolve |
| Xero webhooks | HMAC-verified handler, flag-gated, processing deferred |
| Capability matrix | `XERO_API_CAPABILITY_MATRIX.md` — what the Xero API can/cannot do, verified against official docs |

## 2. Safe to reuse as-is (portable, no scheduling-app knowledge)

These are pure or dependency-injected; copy them into Opal Finance unchanged:

- `contact-matching.js` — zero imports, pure functions, 10 unit tests
- `pricing-engine.js` — pure, 10 unit tests
- `reconciliation-engine.js` — pure, 8 unit tests
- `candidate-engine.js` — dependencies injected (`{ adb, pricing, logger }`)
- `xero-sync.js` — dependencies injected (`{ xeroApi, adb, logger }`)
- `finance-flags.js` — reads env only; **the safety model lives here** (writes fail closed in every environment; double gate)
- `xero-api.js` — needs only a `decrypt()` function and 3 env vars; all Xero rules baked in (token rotation, 429 retry, pagination, decrypt-at-choke-point)
- Migrations `004` + `006` — self-contained finance DDL except two FKs (see §7)
- All 6 accounting test files (67 tests) — port with the modules they cover

## 3. Should be rewritten for Opal Finance (do not port)

- **Auth/session/RBAC** — routes lean on the scheduler's `permissions.js`
  (`requireAuth`, `requireRole('owner')`) and express-session with a pg
  session store. Opal Finance needs its own auth; keep the invariant
  *every finance route is owner-only, enforced server-side*.
- **`accounting-routes.js`** — the route *logic* is sound and worth
  transplanting function-by-function, but it imports the scheduler's
  `database.js` (audit log), `logger.js`, `permissions.js` and lazily
  `splose-api.js`. Rebuild as Opal Finance routes around the ported engines.
- **Audit logging** — calls `db.logAuditEvent(...)`. Opal Finance needs its
  own audit table + helper (keep the events; they are load-bearing for the
  safety story).
- **Frontend** — the accounting UI is ~460 lines inside a 7,500-line
  single-file app (`mockup_v3.html`). Extracted copies are in the pack
  (`frontend/`), useful as a spec/reference; build Opal Finance's UI fresh.
- **Splose access** — see coupling, §4. Decide the integration pattern
  before building.

## 4. What is coupled to the scheduling app

1. **Splose** (biggest coupling): candidate generation and contact
   suggestions read Splose appointments/patients via the scheduler's
   `splose-api.js` (throttled, cached, normalised). Opal Finance must either
   (a) get its own Splose API client + key, or (b) consume a small
   read-only internal API exposed by the scheduler. (a) is cleaner; the
   practice's durable Splose key lives in Key Vault — a NEW key may be
   needed (note: a previously generated second key died Splose-side within
   a day; unresolved with Splose support).
2. **Auth/session/RBAC** — scheduler-owned (`permissions.js`, sessions
   table, login rate limiting).
3. **Audit** — writes to the scheduler's `audit_logs` via `database.js`.
4. **DB schema FKs** — finance tables reference `organisations(id)` and
   `users(id)` (see the schema doc for the NULL-org subtlety).
5. **Token crypto** — `crypto-utils.js` (AES-256-GCM, `enc:` prefix,
   `ENCRYPTION_KEY` env). Copy it (included under `backend/shared/`), and
   generate a **new key** for Opal Finance — never reuse the scheduler's.
6. **Server mounting** — `server.js` mounts the raw-body webhook parser
   BEFORE json body parsing (HMAC over exact bytes) and registers the
   webhook route before the router. Preserve this ordering in the new app.
7. **Frontend CSS** — `.acct-page`, `.acct-note`, `.acct-table` styles are
   ALSO used by the Resource Hub tab. When accounting is later removed from
   the scheduler, remove the accounting section but **keep those shared
   styles** (or re-scope Resource Hub first).
8. **Logger** — `logger.js` structured logger (App Insights wiring).

## 5. What is independent

Everything in §2, plus the data model (given the two FK columns), the flag
model, the capability matrix, the owner-actions checklist, and the entire
test suite for the pure engines.

## 6. Database tables (17, all created by migrations 004 + 006)

`xero_connections` · `xero_sync_state` · `xero_contacts_cache` ·
`xero_invoices_cache` · `xero_payments_cache` · `xero_accounts_cache` ·
`xero_items_cache` · `finance_dashboard_snapshots` ·
`finance_service_mappings` · `finance_contact_mappings` ·
`finance_pricing_rules` · `finance_invoice_candidates` ·
`finance_invoice_candidate_lines` · `finance_invoice_actions` ·
`finance_reconciliation_candidates` · `finance_sync_log` ·
`accounting_exception_items`

All tables are **empty on staging** at handover except none — zero rows in
every finance table (verified read-only 2026-07-27). There is no data to
migrate; Opal Finance starts from clean DDL.

## 7. Migrations

- `004_accounting_xero_module.sql` — the 16 X-phase tables
- `006_accounting_exceptions_and_mapping.sql` — exception items,
  `match_reason` / `duplicate_reason` columns, and the **NULL-org
  idempotency repair**: three `COALESCE(organisation_id, zero-uuid)` unique
  expression indexes that make `ON CONFLICT` dedupe work when
  `organisation_id` is NULL (plain UNIQUE treats NULLs as distinct). The
  upserts in `accounting-db.js` target these expressions. PG 14-safe.
- (`005` is Resource Hub — not finance; listed only because the ledger is
  sequential.) Migration runner: checksummed `NNN_*.sql` ledger + pg
  advisory lock `743901`. Reuse the runner pattern in Opal Finance.
- For Opal Finance: collapse 004+006 into a fresh `001_finance_core.sql`,
  replacing the `organisations`/`users` FKs with the new app's equivalents
  (or drop org scoping entirely if single-tenant — see architecture doc).

## 8. API routes (all `/api/accounting/*`, all owner-only except webhook)

OAuth: `GET xero/status` · `GET xero/connect` · `GET xero/callback` ·
`POST xero/disconnect` · `POST xero/refresh`
Sync: `POST xero/sync` · `GET xero/sync/status` ·
`GET xero/{contacts|invoices|payments|accounts|items}`
Dashboard: `GET dashboard`
Candidates: `GET candidates` · `POST candidates/generate` ·
`POST candidates/:id/review` · `POST candidates/:id/create-draft-invoice` (flag-gated)
Reconciliation: `GET reconciliation` · `POST reconciliation/refresh` ·
`POST reconciliation/:id/decide`
Config: `GET|POST pricing-rules` · `GET|POST service-mappings` · `GET sync-log`
Exceptions: `GET exceptions` (`?refresh=true`) · `POST exceptions/refresh` ·
`POST exceptions/:id/{resolve|dismiss|reopen}`
Contacts: `GET contacts` · `POST contacts/refresh-suggestions` ·
`POST contacts/:id/map` · `POST contacts/create-xero-contact` (403 stub; 501 even if enabled)
Webhook: `POST webhooks/xero` (HMAC-verified, flag-gated, raw-body)

## 9. Frontend components (extracted copies in `frontend/` of the pack)

Accounting tab inside `mockup_v3.html`: sub-nav (Overview · Exceptions ·
Xero Connection · Invoices · Invoice Candidates · Contacts · Reconciliation ·
Pricing · Sync Log · disabled Expenses/Timesheets/Leave), exception table
with severity badges + resolve/dismiss, contacts table with confidence
pills + manual map, candidates with approve/ignore + **visible-but-locked**
draft button, flag badges on the connection screen, open-exception count
badge. Tab is hidden for non-owners (backend still enforces).

## 10. Tests (67 accounting tests inside 151u/104i totals)

See `OPAL_FINANCE_TEST_INVENTORY.md`. Unit: finance-flags (11),
contact-matching (10), pricing-engine (10), reconciliation-engine (8).
Integration: accounting-routes (11), accounting-phase2 (17).

## 11. Feature flags (all fail-closed; writes require literal `'true'`)

Read (default ON): `ENABLE_XERO_READ`, `ENABLE_FINANCE_DASHBOARD`,
`ENABLE_ACCOUNTING_EXCEPTION_DASHBOARD`.
Writes (default OFF in EVERY environment, no dev convenience):
`ENABLE_XERO_WRITE` (master gate), `ENABLE_XERO_DRAFT_INVOICE_CREATE`,
`ENABLE_XERO_CONTACT_CREATE`, `ENABLE_XERO_APPROVE_INVOICE`,
`ENABLE_XERO_SEND_INVOICE`, `ENABLE_XERO_PAYMENT_CREATE`,
`ENABLE_XERO_AUTO_RECONCILIATION`, `ENABLE_XERO_WEBHOOKS`.
Phase-2 planned flags (documented, not yet coded) are listed in
`ACCOUNTING_AUTOMATION_PHASE_2_PLAN.md`.

## 12. Safety gates PROVEN (carry these guarantees into Opal Finance)

- **Hard rule**: `ENABLE_XERO_WRITE=false` blocks every write even when a
  specific write flag is accidentally `true` — proven at unit level (all
  six helpers at once), route level, and live on staging.
- Writes fail closed in every environment incl. dev/test (only `'true'` enables).
- DRAFT-only invoice payload (`Status: 'DRAFT'`), validation gauntlet before
  any write, permanent id-based mappings (never name matching).
- No pay-run code exists anywhere; pay-run automation is out of scope permanently.
- Tokens encrypted at rest; decrypt only at the API choke point; never logged.
- Exception/sync rows carry identifiers only — no client names, no clinical
  content (test-asserted).
- Webhook HMAC constant-time compare; 401 on mismatch; 404 when flag off.
- Every owner action audited.

## 13. To remove/disable in the scheduling app LATER (separate approved task)

Nothing yet — do not do this until Opal Finance is live and the owner signs
off. When that day comes: remove the `server.js` accounting mounts (3 lines),
the 10 backend modules, tests, the accounting section of `mockup_v3.html`
(keeping the shared `.acct-*` styles used by Resource Hub, or re-scoping
them first), the Accounting tab button, and Xero Key Vault secrets/app
settings; write a migration that drops the 17 finance tables (destructive —
owner approval + backup first); update `migrate.itest.js`. A checklist
belongs in that future task, not this one.

## 14. Foundation of Opal Finance

Port order (see `OPAL_FINANCE_TARGET_ARCHITECTURE.md` and the master
prompt): flags + crypto + migrations first, then xero-api + sync, then the
pure engines with their tests, then routes/UI rebuilt native to the new
app, then the exception dashboard as the operational centre. The capability
matrix and the Phase 2 plan remain the product roadmap (Phase 2B: payment
status sync, richer duplicate heuristics, then expenses/timesheets/leave —
with pay-run creation/posting permanently excluded).
