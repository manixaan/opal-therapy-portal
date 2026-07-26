# Parked Future Pipeline — Accounting / Xero Integration

> ## Status: **PARKED — DO NOT IMPLEMENT YET**
>
> The employee portal is progressing through controlled read-only live
> testing for Outlook and Splose. Accounting/Xero is a future module and
> must not distract from stabilising the current portal.
>
> **Revisit only after:** (1) read-only live testing passes → (2) limited
> pilot is stable → (3) Outlook/Splose write behaviour is proven safe →
> (4) the core employee portal is reliable.
>
> Current priority order stands: staging stability → read-only live testing
> → Outlook + Splose mirroring → limited employee pilot → controlled write
> testing → production rollout.

*Recorded 2026-07-26. This is a fully specified implementation stream so it
can be picked up quickly later. Nothing below exists in the codebase yet.*

---

## 1. Module identity

- **Name:** `Accounting` (alternatives considered: Accounting & Finance, Finance Operations)
- **Navigation:** `Administration → Accounting`
- **Access:** owner/admin-only by default. Therapists never see
  organisation-wide finance without explicit grant.

## 2. Purpose

Connect the portal to **Xero** (or similar) for: Xero integration ·
automatic/semi-automatic invoicing · payment and bank reconciliation
support · finance dashboards · revenue tracking · utilisation tracking ·
pricing and NDIS rate monitoring · invoice status monitoring · outstanding
debtor visibility · business performance reporting.

## 3. Core principle

**Splose stays the clinical/practice source of truth. Xero stays the
accounting source of truth. The portal is the operational bridge and
dashboard layer.** Store only what is required for: matching,
auditability, dashboarding, invoicing workflow state, reconciliation
workflow state, operational reporting. Never duplicate complete financial
or clinical records.

## 4. High-level architecture

```text
Splose (appointments · practitioners · clients · services · status · case/funding)
        ↓
Opal Portal (scheduling · therapist mapping · pricing rules · invoice
             generation logic · utilisation dashboard · reconciliation
             suggestions · audit trail)
        ↓
Xero (contacts · invoices · payments · bank transactions · reports)
```

## 5. Security model (high sensitivity — non-negotiable)

OAuth 2.0 to Xero · encrypted token storage · Azure Key Vault for secrets ·
strict owner/admin RBAC · audit logs for every financial action ·
**read-only mode first** · feature flags for all write actions · no
financial secrets in frontend code · no Xero credentials in GitHub · no
bank data in logs · no unredacted invoice payloads in logs · no
client health/clinical information in finance logs.

Feature flags (fail closed — missing/invalid flags must never enable writes;
same resolution pattern as the existing `feature-flags.js`):

```dotenv
ENABLE_XERO_READ=true
ENABLE_XERO_WRITE=false
ENABLE_AUTO_INVOICE_CREATE=false
ENABLE_AUTO_INVOICE_APPROVE=false
ENABLE_AUTO_RECONCILIATION=false
ENABLE_FINANCE_DASHBOARD=true
```

## 6. Xero integration scope

Support: app registration · OAuth redirect/callback · tenant selection ·
encrypted access + refresh tokens · token refresh · connection status ·
connected-organisation display · disconnect/reconnect · audit logging ·
read-only validation · write-flag enforcement.

**Initial access is read-only. No invoice creation until read-only finance
reporting is validated.**

Lessons already learned in this codebase that apply directly: attach OAuth
tokens to the signed-in portal session (never match/auto-create by
account email); decrypt tokens at every read choke point; eligibility
checks before token exchange; Key Vault references need an app-setting
rewrite (not just restart) after rotation.

### Data areas to investigate (verify at build time — do not assume)

Contacts · Invoices · Payments · Bank Transactions · Reports · Bank
Summary · Profit and Loss · Aged Receivables · Webhooks · Attachments ·
Invoice status updates. Confirm exact scopes, tenant permissions, rate
limits and webhook limitations against Xero's current documentation.

## 7. Module sections

```text
Accounting
├── Overview
├── Invoices
├── Reconciliation
├── Utilisation
├── Pricing
├── Revenue
├── Debtors / Outstanding
├── NDIS Billing
├── Xero Sync
└── Reports
```

## 8. Dashboard concepts

Total revenue · revenue by month/therapist/region/service type · billable,
non-billable, available and booked hours · utilisation % · cancellation
rate · unpaid/overdue/paid invoices · average invoice value · average
revenue per appointment · forecast revenue · travel revenue ·
report-writing revenue · rural/remote revenue · NDIS support-item revenue ·
pricing variance warnings.

## 9. Invoicing workflow

Initial safe workflow (human in the loop at every consequential step):

```text
Completed Splose appointment → portal calculates invoice candidate →
owner/admin reviews → portal creates DRAFT invoice in Xero →
owner/admin approves/sends in Xero
```

Never begin with automatic approval or sending. The advanced pipeline
(pricing rules → draft → validation → approve → send → monitor →
reconcile) comes only after the safe workflow is proven.

### Invoice candidate inputs

Splose appointment ID · client/contact · service · practitioner · date ·
duration · appointment status · cancellation status · travel time ·
non-face-to-face time · report-writing time · location/MMM classification ·
NDIS support item · hourly rate · GST handling · funding type · invoice
contact · claim/reference number · notes required on invoice · internal
billing rule · manual override reason.

### Mandatory pre-creation validation

Client/contact mapping · appointment status · duplicate-invoice risk ·
correct date/practitioner/service/support item/rate/quantity · tax/GST
treatment · cancellation rule · travel rule · funding type · invoice
contact · required reference fields · manual override reason where
applicable.

## 10. Reconciliation

Suggestion-only at first: `Xero payment ↔ Xero invoice ↔ bank transaction ↔
Splose appointment/client`.

Stages: **1** read-only payment/invoice dashboard → **2** suggested
matches → **3** admin-reviewed reconciliation actions → **4** rule-based
auto-reconciliation for low-risk cases → **5** exception dashboard for
unmatched/ambiguous items.

Track: issued/paid/partially-paid/overdue/voided invoices · payments
received · matched bank transactions · unmatched payments · duplicate
payment risk · under/overpayment · reference, client-name, invoice-number,
date and amount mismatches.

## 11. Utilisation dashboard

From existing scheduling + Splose data: available/booked/billable/
cancelled/travel/admin/report-writing/direct-client/non-face-to-face/
telehealth/rural-remote hours · utilisation % · weekly and monthly trends ·
service mix · unfilled capacity · region-based utilisation.

## 12. Pricing engine

Track: NDIS rates · internal rates · telehealth rates · report-writing
rates · travel rates · rural/remote MMM loadings · cancellation rates ·
private client rates · plan-managed/self-managed differences · support
item mapping · pricing effective dates · historical rate changes · manual
override approvals.

Warnings: billed below configured rate · wrong/missing support item ·
incorrect MMM rate · appointment without billing rule · service without
mapped Xero item · duplicate billing candidate · billable-but-uninvoiced
appointment · invoiced amount differs from expected.

## 13. Data model concepts (future migrations, not yet)

`xero_connections` · `xero_tenants` · `xero_tokens` ·
`xero_contacts_cache` · `xero_invoices_cache` · `xero_payments_cache` ·
`xero_bank_transactions_cache` · `billing_rules` · `pricing_rules` ·
`service_billing_mappings` · `invoice_candidates` ·
`invoice_line_candidates` · `invoice_sync_log` ·
`reconciliation_candidates` · `reconciliation_matches` ·
`finance_dashboard_snapshots` · `finance_audit_log`

(All schema lands via the existing migration runner — never in INIT_QUERIES.)

## 14. Audit requirements

Audit every financial action: Xero connect/disconnect · token refresh
failure · invoice candidate created/edited · draft invoice created ·
invoice approved/sent (where supported) · reconciliation match
suggested/accepted/rejected · pricing rule changed · support-item mapping
changed · manual override entered · dashboard export · finance data
access · **failed finance access attempts**.

## 15. Permissions

| Role | Default |
|---|---|
| Owner | Full accounting access |
| Admin | Limited access if granted |
| Therapist | No organisation finance access |
| Read-only | No finance access unless explicitly granted |

Future permission names: `finance.view_dashboard` ·
`finance.view_invoices` · `finance.create_draft_invoice` ·
`finance.approve_invoice` · `finance.view_reconciliation` ·
`finance.manage_reconciliation` · `finance.manage_pricing` ·
`finance.manage_xero_connection` · `finance.export_reports`

## 16. Implementation phases (for later)

- **X1 — Discovery & API proof:** Xero org access, app registration, scope
  confirmation, sandbox/demo connection, read org/contacts/invoices/
  payments/reports, webhook feasibility, rate limits, bank transaction
  visibility.
- **X2 — Read-only finance mirror:** OAuth, encrypted tokens, tenant id,
  read invoices/payments/reports, cache only required fields, Accounting
  tab shell, read-only dashboard, audit logging, tests, all writes disabled.
- **X3 — Splose↔Xero matching:** clients↔contacts, services↔items/accounts,
  practitioners↔revenue centres, appointments↔invoices, uninvoiced/
  invoiced/mismatch identification, exception dashboard.
- **X4 — Draft invoice generation:** candidate engine, pricing rules,
  support-item mapping, drafts only, admin review, duplicate prevention,
  rollback/error handling, audit, tests.
- **X5 — Payment & reconciliation support:** read payments + bank
  transactions, suggest matches, reconciliation queue, admin confirms,
  unmatched/overdue/under-over-payment tracking.
- **X6 — Controlled automation:** auto-create low-risk drafts, auto-suggest
  reconciliation, confidence scoring, manual override, approval
  thresholds, high-risk stays manual.
- **X7 — Advanced dashboards & forecasting:** revenue forecast, therapist
  utilisation, region/service profitability, cashflow indicators, NDIS
  pricing variance, debtor ageing, business KPI dashboard.

## 17. Accounting test bench (required before any finance write)

OAuth state validation · encrypted token storage · read-only sync · scope
failure · tenant mismatch · duplicate invoice prevention · candidate
validation · pricing rules · NDIS rates · GST/tax handling · contact
matching · service mapping · payment matching · reconciliation ambiguity ·
API rate limits · webhook duplicate/replay · write-flag enforcement ·
audit logs · permissions · log redaction · rollback/error recovery.

---

*When this stream is picked up, start at Phase X1 and follow the same
discipline the portal build used: staged flags fail closed, read-only
proven live before any write, adversarial test bench before enablement,
and evidence-based readiness classifications.*
