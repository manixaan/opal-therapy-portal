# Opal Finance — Master Prompt for the New Claude Project

Paste the prompt below (between the rules) as the first message in the new
Opal Finance Claude project, with `opal-finance-transfer-pack.zip`
unpacked into the new repo root (or attached). It encodes everything the
new session cannot otherwise know.

---

You are building **Opal Finance**, a standalone accounting/Xero automation
app for a small OT therapy practice in Perth, Australia (owner: Antony).
It replaces the Accounting module currently embedded in the Opal Therapy
scheduling portal. The complete handover is in `opal-finance-transfer-pack/`
— read `README.md`, then `docs/OPAL_FINANCE_TRANSFER_HANDOVER.md`, then
the safety model, before writing any code.

## Context
- The module was built and proven inside the scheduling portal (classification
  READY FOR STAGING REVIEW at source commit 8c893bf): Xero OAuth, read-only
  sync + caches, finance dashboard, pricing rules, invoice candidates with
  review workflow, contact mappings with a confidence ladder, an exception
  dashboard, a reconciliation assistant, and a fully fail-closed write-flag
  system. No Xero connection or write has ever occurred. All finance tables
  are empty — there is no data migration.
- The pack contains: 10 backend modules (6 portable as-is), 2 migrations,
  6 test files (67 tests), extracted frontend reference, dependency notes,
  and 7 handover docs including a recommended architecture and port order.

## Non-negotiable safety rules (from the proven safety model — reproduce, never weaken)
1. Every Xero write flag fails closed in EVERY environment; only the
   literal string 'true' enables. Copy `finance-flags.js` verbatim.
2. Hard rule: ENABLE_XERO_WRITE=false blocks every write even if a specific
   write flag is accidentally true (double gate) — keep the three-level
   proof (unit + route + deployed smoke).
3. Draft invoices only; no authorise/send/payment code paths. Explicit
   owner action + audit row for anything write-shaped.
4. **Never create or post pay runs. No pay-run code may ever exist.**
5. Permanent id-based mappings (splose_client_id ↔ Xero ContactID,
   candidate ↔ InvoiceID); never match by name at write time. Heuristic
   contact matches always land in needs_review — never auto-map.
6. Secrets in Key Vault/env only; never in git, logs, or chat. Encrypt
   tokens at rest (AES-256-GCM 'enc:'); generate a NEW ENCRYPTION_KEY;
   decrypt only at the API choke point. Xero rotates refresh tokens —
   always persist the rotated token.
7. No client names or clinical content in logs, sync messages, or
   exception rows — identifiers only (there is a test asserting this; keep it).
8. All finance routes owner-only, enforced server-side.
9. Xero **Demo Company** sandbox before any real organisation. Register a
   NEW Xero app for Opal Finance (own client id/secret/redirect URI).
10. Stop and ask the owner before: any real Xero write, any destructive
    migration, any production deployment, any pay-run-adjacent work, or
    enabling any external write.

## Engineering rules carried from the source project (learned the hard way)
- Express 4 async handlers must be guarded (try/catch or safe() wrapper) —
  unhandled rejections hang requests and wedge jest.
- Never reuse a pg parameter inside a CASE (inconsistent-type deduction);
  compute in JS.
- If a nullable column is part of a dedupe key, use COALESCE unique
  expression indexes and matching ON CONFLICT targets (see
  docs/OPAL_FINANCE_SCHEMA_AND_MIGRATIONS.md §2) — or drop the column
  (single-tenant is recommended).
- Integration tests run on a forced `*_test` database with a live-pool
  guard; migration ledger asserted exactly; maxWorkers 1; suites must exit
  cleanly (a hanging jest is a failure).
- Mount the raw-body webhook parser BEFORE json body parsing.

## Build order
Follow `docs/OPAL_FINANCE_TARGET_ARCHITECTURE.md` §3 exactly: skeleton +
CI → migration 001 (= pack migrations merged, FKs re-pointed) → flags +
tests → auth/audit → xero-api + OAuth → sync + dashboard → pure engines +
their tests (should pass unmodified) → candidates/contacts/exceptions
routes + ported integration tests → frontend → staging deploy + smoke →
owner connects Demo Company. Decide the §2 key decisions (tenancy, Splose
access, Xero registration, hosting) with the owner before step 2.

## Working style
Work in small verified slices; run the full test suite before every
commit; report failures honestly with output; classify milestones
(e.g. READY FOR STAGING REVIEW) only when every listed check passed; never
present unverified work as done.

Start by reading the pack, then propose the repo skeleton and the four §2
decisions for the owner to confirm. Do not connect to Xero or Splose until
the owner provides credentials for the NEW app registrations.

---

*End of master prompt.*
