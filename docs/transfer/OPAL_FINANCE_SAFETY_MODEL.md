# Opal Finance — Safety Model (carry over verbatim)

This is the non-negotiable core of the module. Every guarantee below is
implemented AND test-proven in the scheduling repo at `8c893bf`. Opal
Finance must reproduce all of them before any Xero connection is made.

## 1. Flag model (`finance-flags.js` — copy the file)

- **Write flags fail closed in EVERY environment.** Only the literal string
  `'true'` enables a write; unset/empty/`false`/`yes`/garbage = OFF. There
  is no development convenience default.
- **The hard rule (double gate):** every write helper requires BOTH the
  master gate AND its specific flag:
  `isDraftInvoiceCreateEnabled = isXeroWriteEnabled() && writeFlag('ENABLE_XERO_DRAFT_INVOICE_CREATE')`.
  `ENABLE_XERO_WRITE=false` therefore blocks every Xero write even when a
  specific flag is accidentally true. Proven three ways: unit test across
  all six write helpers simultaneously; route-level 403 with the specific
  flag set and the master off; live staging check.
- Read flags (`ENABLE_XERO_READ`, `ENABLE_FINANCE_DASHBOARD`,
  `ENABLE_ACCOUNTING_EXCEPTION_DASHBOARD`) default ON, explicit `'false'`
  turns off.
- Flag snapshot (`financeFlagState()`) is exposed on the status endpoint
  and shown as UI badges — the owner can always see the gate state.

### Verbatim flag set at handover (all writes OFF)
```dotenv
ENABLE_XERO_READ=true
ENABLE_FINANCE_DASHBOARD=true
ENABLE_ACCOUNTING_EXCEPTION_DASHBOARD=true
ENABLE_XERO_WRITE=false
ENABLE_XERO_DRAFT_INVOICE_CREATE=false
ENABLE_XERO_CONTACT_CREATE=false
ENABLE_XERO_APPROVE_INVOICE=false
ENABLE_XERO_SEND_INVOICE=false
ENABLE_XERO_PAYMENT_CREATE=false
ENABLE_XERO_AUTO_RECONCILIATION=false
ENABLE_XERO_WEBHOOKS=false
```

## 2. Write-path rules

- Draft invoices only: payload hard-codes `Status: 'DRAFT'`; there is no
  authorise, send, or payment code path at all (flags reserved, routes
  absent). A validation gauntlet runs before any write: candidate must be
  `approved_for_draft`, have a mapped ContactID, valid lines, and no
  existing `xero_invoice_id` (409 if it has one).
- `create-xero-contact` is a stub: 403 while gated, **501 even when fully
  enabled** — a deliberate proof that enabling flags alone cannot cause a
  write until real code is written and reviewed.
- **Pay runs: never.** No pay-run creation/posting code may ever exist.
  This is a permanent product rule, not a phase gate.
- Every write-shaped action requires an explicit owner click and writes an
  audit row (`finance.*` actions with actor, target, metadata).

## 3. Identity & idempotency rules

- Permanent id-based mappings are the source of truth:
  `splose_client_id ↔ xero ContactID`, `candidate ↔ xero_invoice_id`.
  NEVER match by name/number/description at write time.
- Contact suggestions never auto-map: every heuristic result lands in
  `needs_review`/`unmapped`; only the owner confirms; confirmed rows are
  never downgraded by later suggestion runs.
- Candidate generation is idempotent (unique per appointment, incl. the
  NULL-org COALESCE repair); `draft_created_in_xero` status is never
  regressed by regeneration.
- Duplicate risk blocks review and must be explicitly approved or ignored.

## 4. Secrets & privacy

- Xero client id/secret/webhook key: Key Vault only (env refs); never in
  git, logs, or chat. Tokens AES-256-GCM encrypted at rest (`enc:` prefix);
  decrypted only inside `xero-api.ensureValidToken`; never logged.
  **Generate a new `ENCRYPTION_KEY` for Opal Finance — do not reuse.**
- Xero rotates refresh tokens on every refresh — the rotated token MUST be
  persisted (handled in `ensureValidToken` callback).
- Sync log messages are sanitised (500-char, no payloads). Exception items
  carry record identifiers only — no client names, no clinical content
  (asserted by an integration test).
- OAuth: state CSRF-checked (strict outside dev/test); tokens attach to the
  ORG, never to a user matched by email; the signed-in session is never
  switched (the onboarding-loop lesson).

## 5. Webhook rules

Raw-body HMAC-SHA256, constant-time compare, 401 on mismatch, 404 when the
flag is off, respond 200 fast then process async + idempotent. The raw
parser must be mounted BEFORE json body parsing.

## 6. RBAC

Every finance route is owner-only, enforced in middleware server-side
(frontend hiding is cosmetic). Proven: unauth → 401; admin, therapist,
read_only → 403 on every route (integration loop + staging smoke).

## 7. Operational safety rules (process, not code)

- Sandbox first: connect the **Xero Demo Company** before any real org.
- No destructive migration, no data cleanup, no production deploy, no
  external write without an explicit owner-approved report first.
- Stop conditions for any agent working on Opal Finance: stop before any
  real Xero write, any destructive migration, any pay-run work, any change
  that enables external writes.

## 8. Proof inventory (what "proven" means above)

| Guarantee | Test/evidence |
|---|---|
| Writes off in every env | `finance-flags.test.js` (env matrix) |
| Double gate incl. all-specific-flags-true | `finance-flags.test.js` "EVERY specific write helper…" |
| Route-level gate | `accounting-phase2.itest.js` (403 with specific true/master off; 501 fully enabled) + `accounting-routes.itest.js` (draft 403) |
| Never auto-map | `contact-matching.test.js` + never-downgrade itest |
| Idempotency | phase2 itests (mapping ×3 → 1 row; regenerate → 1 candidate; exceptions same count) |
| RBAC | both accounting itests + staging smoke 2026-07-27 |
| No PII in exceptions | phase2 itest "identifiers only" |
| Webhook HMAC | `accounting-routes.itest.js` (404 flag-off, 401 bad signature) |
| OAuth no session switch | `accounting-routes.itest.js` (user count unchanged, session kept, token encrypted at rest) |
