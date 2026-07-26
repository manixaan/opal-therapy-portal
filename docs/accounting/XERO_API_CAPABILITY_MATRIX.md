# Xero API Capability Matrix — Opal Therapy Accounting Module

**Phase X1 deliverable.** Maps every desired accounting function to what the
official Xero public API actually supports, so the module is never built as
if an unsupported action were available.

> **Verification status.** This matrix is compiled from Xero's published API
> design (Accounting API, Finance API, Webhooks, OAuth 2.0) as understood at
> build time. Rows marked **NOT YET VERIFIED** must be confirmed against
> `developer.xero.com` documentation and a live sandbox connection during
> Phase X17 before any dependent behaviour is enabled. The module is coded
> defensively: capabilities are gated behind fail-closed flags and a live
> read-only validation, so a wrong assumption here cannot cause a bad write.

## Legend

| Class | Meaning |
|---|---|
| **SUPPORTED** | Public Accounting/Finance API supports this directly |
| **SUPPORTED WITH LIMITATION** | Available but constrained (scope, states, rate) |
| **NOT SUPPORTED BY PUBLIC API** | No public endpoint — must remain in Xero UI |
| **REQUIRES SPECIAL XERO ACCESS** | Needs partner/Finance API entitlement or app certification |
| **NOT YET VERIFIED** | Confirm against live docs/sandbox in X17 |

---

## 1. OAuth 2.0 / connection

| Function | Class | Notes |
|---|---|---|
| App registration (auth-code flow) | SUPPORTED | Standard OAuth2 web app; created in Xero developer portal (owner action, X16) |
| Redirect URI | SUPPORTED | Must exactly match; staging + production registered separately |
| Scopes | SUPPORTED | `openid profile email offline_access accounting.transactions accounting.contacts accounting.settings accounting.reports.read` (read-first). `.read` variants used where available to enforce least privilege during read-only phase |
| Refresh token | SUPPORTED | `offline_access` scope; 60-day refresh token rotation — **refresh token rotates on every use, must persist the new one each refresh** |
| Access token lifetime | SUPPORTED WITH LIMITATION | ~30 minutes; refresh proactively |
| Tenant (organisation) selection | SUPPORTED | `GET /connections` returns authorised tenants; `Xero-tenant-id` header on every call |
| Disconnect / revoke | SUPPORTED | `DELETE /connections/{id}` |

## 2. Accounting API — reads

| Resource | Class | Notes |
|---|---|---|
| Organisation / tenant details | SUPPORTED | `GET /Organisation` |
| Contacts | SUPPORTED | `GET /Contacts`, paginated, `If-Modified-Since` supported |
| Invoices | SUPPORTED | `GET /Invoices`, filter by status/date, `page` pagination, modified-since |
| Invoice history | SUPPORTED | `GET /Invoices/{id}/History` |
| Payments | SUPPORTED | `GET /Payments` |
| Accounts (chart of accounts) | SUPPORTED | `GET /Accounts` |
| Items | SUPPORTED | `GET /Items` |
| Bank Transactions | SUPPORTED WITH LIMITATION | `GET /BankTransactions` returns spend/receive money **that already exist as transactions** — NOT raw unreconciled bank statement lines |
| Reports — Aged Receivables | SUPPORTED | `GET /Reports/AgedReceivablesByContact` (per-contact) |
| Reports — Profit & Loss | SUPPORTED | `GET /Reports/ProfitAndLoss` |
| Reports — Bank Summary | SUPPORTED | `GET /Reports/BankSummary` |
| Reports — Balance Sheet | SUPPORTED | `GET /Reports/BalanceSheet` |

## 3. Accounting API — writes (all flag-gated, default OFF)

| Function | Class | Notes |
|---|---|---|
| Create **draft** invoice | SUPPORTED | `POST /Invoices` with `Status: DRAFT` — the only write this module will do first |
| Approve invoice (→ AUTHORISED) | SUPPORTED | `POST /Invoices` status update — **deferred, flag OFF** |
| Send invoice (email) | SUPPORTED WITH LIMITATION | `POST /Invoices/{id}/Email` — **deferred, flag OFF** |
| Create payment (mark invoice paid) | SUPPORTED WITH LIMITATION | `PUT /Payments` applies a payment against an invoice to an account — **deferred, flag OFF**; this is application-of-payment, not bank reconciliation |
| Void / delete invoice | SUPPORTED | Not used by this module initially |
| Attachments | SUPPORTED | `POST /Invoices/{id}/Attachments` — not in initial scope |

## 4. Bank reconciliation — the critical constraint

| Function | Class | Notes |
|---|---|---|
| Read raw **bank statement lines** | **NOT SUPPORTED BY PUBLIC API** | The Accounting API exposes `BankTransactions` (created transactions), not the imported, unreconciled statement lines a human sees in Xero's Reconcile screen |
| **Reconcile** a bank statement line ↔ transaction | **NOT SUPPORTED BY PUBLIC API** | There is no public endpoint that performs the reconcile action Xero's UI performs. Bank reconciliation stays in Xero |
| Statement lines via **Bank Feeds API** | **REQUIRES SPECIAL XERO ACCESS** | Confirmed: a separate **Bank Feeds API** exists for pushing/reading bank statements, but it is a partner programme requiring application + certification — not available to a standard developer app. Treat as unavailable |
| Statement lines via **Finance API** | **REQUIRES SPECIAL XERO ACCESS** | Richer bank data requires explicit entitlement — **NOT YET VERIFIED** for this tenant; treat as unavailable until confirmed |
| Reconcile API-created batch payments | **NOT SUPPORTED BY PUBLIC API** | Confirmed via Xero developer community: payments created through the API cannot be reconciled against the bank feed through the API — reinforces the assistant-only design |
| Mark invoice as paid | SUPPORTED WITH LIMITATION | Achieved by *applying a payment* (§3), which is distinct from reconciling the bank feed |

**Design consequence (locked in):** the module is a **reconciliation
*assistant***, not a bank reconciler. It reads invoices + payments (+
`BankTransactions` where present), *suggests* matches, lets the owner accept/
reject the suggestion **inside the portal's own records**, and — only when a
supported write flag is on — can apply a payment against an invoice via the
Payments endpoint. **Actual bank-feed reconciliation remains a human action
in Xero.** The UI states this explicitly wherever reconciliation appears.

## 5. Webhooks

| Function | Class | Notes |
|---|---|---|
| Invoice webhooks | SUPPORTED | Xero webhooks deliver Invoice + Contact create/update events |
| Signature validation | SUPPORTED | HMAC-SHA256 of raw body with the webhook signing key; must return 401 on mismatch, 200 fast otherwise |
| Intent-to-receive handshake | SUPPORTED WITH LIMITATION | Xero sends a validation payload on endpoint setup that must be signature-verified and answered — owner setup step (X16) |
| Replay/duplicate handling | SUPPORTED WITH LIMITATION | Webhooks may redeliver; consumer must be idempotent (dedupe on event id) |
| Bank transaction webhooks | NOT SUPPORTED BY PUBLIC API | Only Invoices/Contacts event categories are offered |

## 6. Rate limits

| Constraint | Class | Notes |
|---|---|---|
| Per-minute limit | SUPPORTED WITH LIMITATION | ~60 calls/min per tenant (verify current figure) |
| Daily limit | SUPPORTED WITH LIMITATION | ~5,000 calls/day per tenant (verify) |
| 429 handling | SUPPORTED | `Retry-After` header on throttle — the sync layer honours it with backoff |
| Concurrent app-wide limit | NOT YET VERIFIED | Confirm uncached app limit; sync uses one worker + throttling regardless |

## 7. Desired-function summary (from the build spec)

| Desired capability | Verdict |
|---|---|
| Read invoices | SUPPORTED |
| Create draft invoices | SUPPORTED (flag-gated) |
| Approve invoices | SUPPORTED — deferred |
| Send invoices | SUPPORTED WITH LIMITATION — deferred |
| Read payments | SUPPORTED |
| Create payments (apply to invoice) | SUPPORTED WITH LIMITATION — deferred |
| Read bank transactions | SUPPORTED WITH LIMITATION (created txns only) |
| Read bank **statement lines** | NOT SUPPORTED BY PUBLIC API |
| Perform Xero **bank reconciliation** | NOT SUPPORTED BY PUBLIC API |
| Mark invoices as paid | SUPPORTED WITH LIMITATION (via Payments) |
| Match bank statement lines | NOT SUPPORTED BY PUBLIC API |
| Access unreconciled statement lines | REQUIRES SPECIAL XERO ACCESS (Finance API) — NOT YET VERIFIED |
| Use Finance API bank statement endpoints | REQUIRES SPECIAL XERO ACCESS — NOT YET VERIFIED |
| Webhooks for invoice changes | SUPPORTED (flag-gated, owner setup) |

**Bottom line:** everything the module *actively does first* — read-only
mirror, invoice-candidate generation, draft invoice creation — is fully
SUPPORTED. Everything in the NOT-SUPPORTED / SPECIAL-ACCESS rows is designed
around, never faked, and the reconciliation feature is scoped as an assistant
accordingly.
