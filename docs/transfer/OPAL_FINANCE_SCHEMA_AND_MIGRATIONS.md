# Opal Finance — Schema & Migrations Extraction

The finance data model as it exists at `8c893bf`, what each table is for,
which columns couple to the scheduler, and how to re-baseline it in Opal
Finance. Full DDL is in the pack: `migrations/004_…sql` + `migrations/006_…sql`.

## 1. Tables (17)

### Connection + sync
| Table | Purpose | Key points |
|---|---|---|
| `xero_connections` | One row per Xero org connection | Tokens stored ENCRYPTED (`enc:` AES-256-GCM); `status` connected/disconnected; `organisation_id` FK → scheduler `organisations` |
| `xero_sync_state` | Per-resource sync watermark | keyed (connection_id, resource) |
| `finance_sync_log` | Sanitised sync run log | `message VARCHAR(500)` — never tokens/payloads; `status` ok/error/blocked |

### Read-only caches (Xero is source of truth)
`xero_contacts_cache` (name, email, is_customer) ·
`xero_invoices_cache` (number, status, amounts, dates, contact) ·
`xero_payments_cache` · `xero_accounts_cache` · `xero_items_cache`
— all keyed `UNIQUE(connection_id, xero_*_id)`, replaced on sync, safe to
drop and re-sync at any time.

### Configuration
`finance_pricing_rules` (service/type/funding/MMM match → unit amount, tax
type, account/item code) · `finance_service_mappings` (splose service →
Xero account/item/tax) · `finance_contact_mappings` (see below) ·
`finance_dashboard_snapshots`.

### Working data
| Table | Purpose |
|---|---|
| `finance_invoice_candidates` | Idempotent per Splose appointment (`UNIQUE(org, splose_appointment_id)` + 006 expression index); status vocab: draft_candidate / needs_mapping / needs_pricing / duplicate_risk / ready_for_review / approved_for_draft / draft_created_in_xero / ignored / error; `warnings JSONB` (codes only); `duplicate_reason` (006) |
| `finance_invoice_candidate_lines` | qty, unit amount, tax_type, account/item code, sort order |
| `finance_invoice_actions` | Audit of candidate actions (draft_created etc.) |
| `finance_reconciliation_candidates` | Suggestion rows, owner decision recorded |
| `accounting_exception_items` (006) | Typed exceptions: severity, source, affected_type/id (identifiers ONLY — never names), explanation, suggested_action, status open/resolved/dismissed, first/last_seen |

### Contact mapping (the permanent map)
`finance_contact_mappings`: `splose_client_id ↔ xero_contact_id`
(**ContactID is the only stable key**), `match_confidence` high/medium/low,
`match_reason` existing/email/name_exact/name_fuzzy/multiple/none/manual
(006), `status` mapped/needs_review/unmapped. Owner-confirmed rows
(`status='mapped'`) are never downgraded by suggestion runs (guarded in
`upsertSuggestedContactMapping`).

## 2. The NULL-org idempotency repair (006) — DO NOT LOSE THIS

Postgres treats NULLs as distinct in unique constraints, so the 004-era
`UNIQUE(organisation_id, …)` keys never fire `ON CONFLICT` when
`organisation_id` is NULL → silent duplicates. 006 adds three unique
expression indexes:

```sql
COALESCE(organisation_id, '00000000-0000-0000-0000-000000000000'::uuid), <natural key>
```

on `accounting_exception_items`, `finance_contact_mappings`,
`finance_invoice_candidates` — and the upserts in `accounting-db.js` name
that exact expression in `ON CONFLICT`. If Opal Finance keeps an optional
org column, keep this pattern (PG 14-safe; on PG 15+ `UNIQUE NULLS NOT
DISTINCT` is the cleaner equivalent — pick one and keep SQL + code in sync).

## 3. Scheduler couplings to sever on re-baseline

- `organisation_id UUID REFERENCES organisations(id)` — on most tables.
  Opal Finance options: (a) single-tenant → drop the column and the
  COALESCE indexes become plain unique keys; (b) keep multi-org → create
  its own `organisations`.
- `users(id)` FKs: `connected_by_user_id`, `created_by_user_id`,
  `reviewed_by_user_id`, `decided_by_user_id`, `resolved_by` → point at the
  new app's users table (keep them: they are the audit trail).

## 4. Recommended re-baseline

One fresh `001_finance_core.sql` = 004 + 006 merged, FKs re-pointed,
comments kept (they document the status vocabularies and safety rules).
Do NOT copy 000/001/002/003/005 — they are scheduler concerns. Port
`migrate.js` (checksummed ledger `schema_migrations`, advisory lock) and
the `migrate.itest.js` exact-ledger assertion pattern.

## 5. Data migration

None required. Verified read-only on staging 2026-07-27: every finance
table has **zero rows** (no Xero connection was ever made). Local dev data
is synthetic. Opal Finance starts from clean DDL — no export/import step.
