# Invoices tab (owner-only)

Calendar-driven NDIS invoicing for the whole practice: the owner's calendar
plus every employee calendar, priced by `backend/ndis-billing-rules.js`, written
as invoices one client at a time or a week at a time. The rules themselves are
documented in [NDIS_OT_BILLING_RULES.md](NDIS_OT_BILLING_RULES.md).

## Where things live

| Piece | File |
|---|---|
| Routes (all owner-only, all audited) | `backend/invoicing-routes.js` |
| Data access | `backend/invoicing-db.js` |
| Schema | `backend/migrations/063_invoicing.sql` |
| Rules engine (pure) | `backend/ndis-billing-rules.js`, `backend/ndis/ot-price-guide.js` |
| Tab | `frontend/current/invoicing.js`, `invoicing.css`; `#view-invoicing` in `mockup_v3.html`; `invoicing` in `ROLE_NAV.owner` and navigation.js `KNOWN_TABS` |
| Tests | `backend/tests/ndis-billing-rules.test.js`, `backend/tests/integration/invoicing.itest.js` |

## The weekly workflow

1. **Client billing settings** (once per client). Funding type, age band, budget
   line, MMM zone, agreed hourly rate (blank = the price limit), per-km rate,
   invoice-to, and which extras the service agreement allows (telehealth,
   non-face-to-face, NDIA reports, cancellation fee, travel). Without a row the
   client's sessions show **Blocked**; nothing is guessed.
2. **Week board.** `GET /api/invoicing/week?start=YYYY-MM-DD` returns every
   therapy event across all therapist profiles in the organisation, with any
   existing invoice number. One card per practitioner per day. Each session
   carries the leg that *arrives* at it (minutes, km); the card header carries
   the drive home and whether it is paid to staff. When the calendar is showing
   the same week, `travel.js`'s `computeDayTravelSegments` seeds the legs; the
   owner can overtype any of them.
3. **Preview.** Every change posts to `POST /api/invoicing/preview`. The server
   pools each day's legs (`planDayTravel`, the NDIA p.25 method), gives each
   session its share, and runs `buildClaim`. Chips: **Ready** (within limits),
   **Review** (a rate or leg above a limit, never clamped), **Blocked** (missing
   inputs), **No claim** (cancellation with sufficient notice), **Invoiced**.
4. **Batch or individual.** `POST /api/invoicing/batch` makes one draft invoice
   per client from the ticked sessions and reports what it skipped and why.
   `POST /api/invoicing/invoices` makes one for a chosen client. A partial
   unique index (`event_id, kind` where the line is active) guarantees a
   session is on at most one live invoice; voiding deactivates the lines and
   frees the events.
5. **Status flow.** draft → approved → sent → paid; draft/approved/sent → void.
   Every transition is audited (`invoicing.*` actions in `audit_logs`).
6. **Rule book.** `GET /api/invoicing/rulebook` serves the price constants and
   three worked examples computed live by the engine; `POST /api/invoicing/simulate`
   powers the "Try a day" calculator. Because both go through the same functions
   as invoicing, the guide cannot drift from what the portal bills.

## Contracts worth knowing

- Amounts are never computed in the browser. It sends event ids, per-leg
  minutes/km, delivery mode, cancellation time and the day's return leg.
- `invoice_lines.minutes` is `NUMERIC(8,2)`: a pooled share such as 35 min ÷ 3
  is fractional and is priced exactly, then rounded to cents.
- Warnings on invoices and lines are codes only; the tab translates them.
- Xero is untouched. Pushing an approved invoice to Xero is the accounting
  module's job (`finance_invoice_candidates`) and is the next integration step.

## Local QA

`opal-invoicing-5023` in `.claude/launch.json` runs the worktree against
`therapy_scheduler_ndisbilling_test`. Seed a demo week, mark the seeded users'
`profile_completed`, log in as the owner and open `#invoicing`.
