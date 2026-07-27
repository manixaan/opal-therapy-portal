# Accounting Automation Phase 2 — Plan of Record

> ## Status: **PARKED — DOCUMENTED ONLY** (recorded 2026-07-27)
> The calendar reconciliation stream is mid-staging-validation. Per the
> owner's gating rule, implementation starts only when the active stream is
> clean, committed, tested and staged — and on explicit go-ahead.
> **First implementation target (owner-recommended):** Exception dashboard +
> contact mappings + invoice candidates.

Full capability scope: invoices, payment-status sync, contacts, expenses,
timesheets (Payroll AU), leave, financial dashboard, exception dashboard.

## Non-negotiable safety rules
- No real financial writes by default; **Demo Company/sandbox first**.
- Global kill-switch: `ENABLE_XERO_WRITE=false` **blocks every Xero write
  even if a more specific write flag is true** (double-gate in code).
- **Pay-run creation/posting is never automated in this phase** — the route
  must not exist. Final payroll review stays in Xero.
- Explicit owner confirmation before every Xero write; audit everything;
  no tokens/receipt-URLs/clinical content in logs; Key Vault only.

## 1. Invoice generation
Draft invoices from **approved** service records only. Never invoice:
cancelled/draft/unapproved/duplicate records, records already mapped to a
Xero invoice, unresolved payer/contact mapping, or missing pricing/account/
tax/tracking config. Line items carry contact, dates, reference, qty, unit
amount, account code, TaxType, tracking categories, source-record refs,
batch id. **Permanent mapping is the source of truth:**
`internal_service_record_id ↔ xero_invoice_id (↔ line id)` — never invoice
number/name/description matching. Flow: candidates → owner review → draft
creation only when flag-enabled → never authorise/send/pay.

## 2. Payment-status sync
Pull Draft/Submitted/Authorised/Paid/Voided from Xero; **derive** Part-paid
(amount_paid>0 & amount_due>0) and Overdue (due_date past & amount_due>0).
Store xero ids/number/status/amounts/dates/last_synced_at/local_display_
status. Xero is source of truth for its statuses; changed-after-sync raises
an exception, never silent overwrite. Surface on invoice screen, dashboard,
exceptions.

## 3. Contact synchronisation
Map plan managers, support coordinators (when payer), organisations,
self-managed clients, suppliers. `internal_contact_id ↔ xero_contact_id`
permanent mapping; ContactID is the stable key. Confidence ladder: stored
mapping = safe · ABN/email/phone exact = high · name-only/fuzzy/multiple =
needs review · none = create *candidate* (auto-create only behind flag).
Manual mapping UI + unmapped-contacts exception queue.

## 4. Expense workflow
Staff submit (member, trip, client?, date, category, description, amount,
GST, receipt, km, reimbursable, notes) → approval queue → owner approves →
Xero export (bill/spend-money per capability decision) **only with both the
record approval AND the export action approved, and flags on**. Receipts:
private storage abstraction, validated type/size, never public URLs,
optional Xero Files attachment later. Mapping:
`internal_expense_id ↔ xero_bill/transaction/file_id`.

## 5. Timesheets (Payroll AU)
Portal automates timesheet assembly/export; **pay-run review/posting stays
in Xero**. Requires staff↔EmployeeID and activity↔earnings-rate mappings,
pay-calendar resolution, approval, duplicate-export prevention. Blockers
(unmapped staff/pay item, unresolved period, already exported, unapproved,
incomplete Xero payroll setup) go to exceptions, never bypassed.

## 6. Leave
**Portal is request/approval master; Xero is payroll destination.**
Post-sync edits in Xero raise conflicts (exception dashboard), never silent
overwrite. Mappings: staff↔EmployeeID, leave type↔LeaveTypeID, request↔
LeaveApplicationID. Read leave types/balances first; export behind flags.

## 7. Financial dashboard (owner-only, read-only)
Cash position · receivables · payables · payroll costs · GST/PAYG/Super
liabilities (as-synced, or clearly labelled estimates) · trends · cash-flow
risks · integration health. Always show last-sync time + incomplete-data
warnings. Xero is source of truth for accounting numbers.

## 8. Exception dashboard — THE operational control centre
Delivered-not-invoiced · blocked candidates (contact/account/tax/tracking) ·
stale drafts (>3d) · overdue invoices · missing receipts · pending
approvals · missing/unexported timesheets · leave conflicts · unmapped
contacts/employees/pay items · integration errors · duplicate risks ·
changed-after-sync · sync failures. Each item: severity, type, source,
affected record, explanation, suggested action, safe-action button, audit
history, resolved state. **Prioritised above dashboard polish.**

## Feature flags (all fail-closed; verbatim set)
```dotenv
ENABLE_XERO_READ=true
ENABLE_XERO_WRITE=false
ENABLE_XERO_CONTACT_CREATE=false
ENABLE_XERO_DRAFT_INVOICE_CREATE=false
ENABLE_XERO_INVOICE_AUTHORISE=false
ENABLE_XERO_INVOICE_SEND=false
ENABLE_XERO_PAYMENT_CREATE=false
ENABLE_XERO_EXPENSE_EXPORT=false
ENABLE_XERO_BILL_CREATE=false
ENABLE_XERO_RECEIPT_ATTACHMENT_EXPORT=false
ENABLE_XERO_PAYROLL_READ=true
ENABLE_XERO_TIMESHEET_EXPORT=false
ENABLE_XERO_TIMESHEET_APPROVE=false
ENABLE_XERO_PAYRUN_CREATE=false
ENABLE_XERO_PAYRUN_POST=false
ENABLE_XERO_LEAVE_READ=true
ENABLE_XERO_LEAVE_EXPORT=false
ENABLE_XERO_LEAVE_APPROVE_IN_XERO=false
ENABLE_ACCOUNTING_FINANCIAL_DASHBOARD=true
ENABLE_ACCOUNTING_EXCEPTION_DASHBOARD=true
```

## Navigation
Accounting → Overview · **Exceptions** · Invoice Candidates · Invoices ·
Contacts · Expenses · Timesheets · Leave · Mappings · Sync Log · Settings.
RBAC: owner-only by default; staff may submit/view **own** expenses and
timesheets only; payroll/mappings/writes owner-only.

## Data model (extend existing 004 tables; no duplication; safe migrations)
Sync runs/errors · contact/employee/account/tax/tracking/pay-item/leave-type
mappings+caches · service_invoice_candidates(+lines) · invoice_batches ·
xero_invoice_mappings + status snapshots · expense_claims/receipts/approvals
+ mappings · staff_timesheet_periods/lines/approvals + mappings ·
leave mappings (reuse existing leave_requests module) ·
accounting_exception_items · financial_dashboard_snapshots.
Every Xero-mapped table: internal id, xero id, tenant id, source,
created/updated/last_synced_at, sync_status, last_error, audit.

## Idempotency (critical, pre-write)
Invoices: mapping-based, candidate state, batch locking, internal
idempotency keys, same payer+date+client+service+amount heuristic → flagged.
Contacts: stored mapping + ContactID only. Expenses: staff+date+amount+
receipt-hash+category. Timesheets: staff+period+rate+activity, never twice.
Leave: staff+type+dates; post-sync change = conflict.

## API surface
As specified in the owner's brief (dashboard, exceptions+resolve,
invoice-candidates generate/approve/create-xero-draft, invoices+sync-status,
contacts sync/map/create-candidate, expenses CRUD+submit/approve/reject/
export, timesheets generate/approve/export, leave CRUD+approve/reject/
export, mappings per type, sync-log). All authenticated; owner-only except
own-expense/own-timesheet staff routes.

## Implementation phases
X2.0 branch `accounting-automation-phase-2` + safety gate (tag verified,
tree clean, tests green, flags off) → X2.1 capability matrix update + safety
model + exception spec docs → X2.2 migrations → X2.3 read-only sync
expansion (incl. payroll employees/pay items/leave types) → X2.4 contact
mapping → X2.5 invoice candidates → X2.6 draft-invoice gate (double-flag +
owner confirm + sandbox-first) → X2.7 payment-status sync → X2.8 expenses →
X2.9 timesheets → X2.10 leave → X2.11 financial dashboard → X2.12
**exception dashboard** → X2.13 UI/audit → X2.14 full test matrix (RBAC,
flag double-gate, generation rules, payment derivation, contacts, expenses,
timesheets, leave, dashboards, exceptions, security, regression) → X2.15
staging deploy + smoke → X2.16 Demo Company validation (17-step sequence,
one draft invoice only, flags re-off after).

## Pre-coding checklist (X2.1 gate)
Update `XERO_API_CAPABILITY_MATRIX.md` from current official docs before
any write code: invoice fields/statuses, Payments behaviour, ContactID
requirements, TaxRates, TrackingCategories, reports, bills/spend-money,
Files API, **Payroll AU** employees/timesheets/leave endpoints + scopes
(`payroll.employees`, `payroll.timesheets`, `payroll.settings` — verify),
rate limits, unsupported operations. Document limitations; never assume.

## Classification at recording: PARKED — DOCUMENTED ONLY
Unblocks when: calendar stream staged clean ✓ + owner go-ahead. Build order
on start: **Exceptions + contact mappings + invoice candidates** first.
