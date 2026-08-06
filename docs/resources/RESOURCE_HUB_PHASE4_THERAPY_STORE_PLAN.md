# Resource Hub — Phase 4 plan: Therapy Store & Purchase Requests

**Status: PLANNED — not built.** Phase 1 shows the workflow as a static
foundation only. No purchase orders are created, nothing is sent to Xero or
Opal Finance, and no supplier integration exists. Build only on explicit
owner approval — and note the accounting leg belongs to **Opal Finance**, not
this portal.

## Catalogue fields (target)

Image · title · supplier · price · diagnosis tags · therapy-goal tags ·
category · age range · availability · short description · rationale ·
alternatives · client suitability · supplier information · estimated total
cost (unit × qty + delivery estimate).

## Therapist request fields (target)

Client reference (internal ref, never free-text client names) · product +
quantity · clinical rationale · therapy goal · estimated cost · preferred
supplier · supporting resource/assessment reference where relevant.

## Approval workflow (target)

Therapist submits → **Owner review** (clinical relevance, client suitability,
budget/funding suitability, client-specific vs general practice stock) →
**Admin purchase-order check** (supplier, tax, delivery, cost centre) →
**Accounting handoff** (approved package exported to the accounting workflow)
→ order + financial record linked back to the request.

Statuses: Draft · Submitted · Owner Review · Approved · Admin Review ·
Purchase Order Created · Ordered · Received · Invoiced · Paid · Rejected.

## Hard safety gates

- **An explicit approval checkpoint sits before anything leaves the portal** —
  no automatic export to accounting/Xero/Opal Finance, ever.
- Tax treatment is an accounting-review field — the portal never determines it
  automatically.
- Audit trail: requester, approvers, timestamps, decisions, changes, supplier,
  purchase order, invoice, payment status.
- Client references stay internal identifiers; no client-identifying data in
  supplier-facing artifacts.
