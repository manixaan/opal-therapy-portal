# Invoicing architecture

The Owner Portal › **Invoicing** tab turns delivered calendar sessions and the
practitioner's travel into NDIS invoice drafts, then finalises, sends and
records payments against them. Rural trips add shared operating costs.

```
Calendar events ─► eligibility ─► billing profile (payer, NDIS no., MMM)
      │                                   │
      ▼                                   ▼
 practitioner-day route ─► route facts   rate card on the service date
      │                     (persisted)         │
      ▼                                         ▼
 travel allocation ───────────────────► session + travel lines
                                                │
                   trip cost allocation ───────►│
                                                ▼
                       group by client + payer ─► draft invoice ─► PDF
                                                ▼
                     finalise (locked PDF) ─► sent ─► part paid ─► paid
```

Migration: `backend/migrations/071_invoicing_billing.sql`. Routes:
`backend/invoicing-routes.js`. Domain services: `backend/billing/`. UI:
`frontend/current/invoicing.js` / `.css`.

## Source of truth

| Fact | Source |
|---|---|
| Session happened, when, with whom, for how long, where | `events` (the calendar). `start_time`/`end_time` are UTC; the local date uses the billing timezone (Australia/Perth). |
| Attendance / exclusion | No attendance exists locally (Splose owns it). Billing setting **completion rule**: `PAST_CONFIRMED` (default: a confirmed `therapy` event whose end has passed is delivered) or `EXPLICIT_ONLY`. The owner can mark any event Completed / Did not attend / Cancelled / Not billable from the calendar drawer (`calendar_event_billing`). |
| Client, payer, NDIS number, address, MMM | `billing_profiles`, keyed by the Splose patient id (`events.client_id`). There is no local clients table. A stub profile (name only) is created the first time invoicing meets a client; nothing else is invented. "Fill blanks from Splose" imports name, NDIS number and address. |
| Prices, caps, item codes | `billing_rate_cards` + `billing_rate_rules` (versioned, effective-dated). `billing/default-rate-card.js` is the only place prices appear in code, and it only seeds an organisation's first card. |
| Travel minutes + km | `travel_route_facts`: the first Google Routes answer for an origin → destination is stored and reused by every later run. |
| The money on an invoice | `invoice_lines` — every line carries a `calculation` JSON snapshot of all inputs. |

The browser never computes money. Every figure is computed server-side, in
integer cents and 4-dp quantities (`billing/money.js`), with half-up rounding
applied once.

## Generation flow (`billing/invoice-generation.js`)

"Complete invoicing" (`POST /api/invoicing/runs`) and "Generate Trip Invoices" both call `runInvoicing`.

**Phase A: prepare (no transaction; all network work happens here)**
1. Load the candidate events in the period: `therapy` events, plus uncategorised `outlook` events that carry a client. The latter become an EVENT_NO_SERVICE_TYPE issue.
2. Eligibility (`session-billing.js#evaluateEvent`) sorts each event into three outcomes:
   - SKIP: deleted, cancelled, marked DNA / not billable, not yet delivered, or awaiting completion.
   - ISSUE: no client, no service type, invalid duration, or an in-person session with no location.
   - BILLABLE.
3. Stub profiles are created. MMM is classified (this may geocode once per address).
4. The client checks run:
   - A missing MMM, or no rate on the service date, **blocks** the event.
   - A missing payer or NDIS number is a **recipient issue**. The draft is still calculated but has status NEEDS_ATTENTION and no recipient.
5. The practitioner-day routes are built and their route facts resolved.

**Phase B: commit (one transaction, `pg_advisory_xact_lock` per organisation)**
1. Load the existing claims for these events.
2. For each billable event and component (SESSION, TRAVEL_LABOUR, TRAVEL_KM):
   - **Claimed on a finalised invoice:** skip it and count it as "already invoiced".
   - **Claimed on a draft:** recalculate the line in place. An owner-overridden or owner-removed line is left alone.
   - **Unclaimed:** add it to the client + payer draft.
3. Draft lines in scope whose event is no longer billable are set VOIDED, and the change is audited.
4. Trip runs: the trip-cost phase runs inside the same transaction.
5. Each touched draft gets its totals, practitioner names and recipient snapshot refreshed, and its status set (DRAFT or NEEDS_ATTENTION). `is_stale` is cleared.
6. Issues are upserted. In-scope issues that were not raised again are resolved automatically; this is what makes "Reprocess" work.

**Grouping:** one draft per client + payer key (`payer_type|email or name`)
whose service period overlaps the run. Repeat sessions for a client in the
period become separate dated lines on one invoice. Different payers never
share an invoice. A draft that was waiting for a payer takes the payer's key
once the profile is fixed.

## Session calculation

`quantity = actual minutes ÷ 60` (4 dp, no invented rounding).
`unit = rate card session hourly rate for the client's MMM on the service date`.
`amount = quantity × unit`, half-up to the cent. The amount is priced from the
printed quantity, so quantity × unit always reconciles on the face of the
invoice. Example: 30 min at MM7 = 0.5000 × $290.99 = $145.50.

No evening, weekend or public-holiday loading applies to OT. Telehealth
sessions (Teams) are billed with no travel.

## Travel calculation

**Route** (`billing/day-route.js`). This is the server-side twin of the calendar's `travel.js#computeDayTravelSegments`:
- **Start:** the first session's `travel.before` point, otherwise the day's work base (`users.work_location_schedule` via the calendar's own `weekKeyFor`, then `default_work_location`). The office and unset or leave days never anchor travel. A remote base has no start or return leg.
- **Between:** consecutive sessions.
- **Return:** to the last session's `travel.after` point, otherwise the base.
- **Trip home between sessions:** when the gap between two sessions is at least *drive back to base + drive out again + 30 minutes*, the practitioner is taken to have gone back to the day's base. That gap becomes a Return leg and an Outbound leg instead of a direct drive. Shorter gaps chain. This is the calendar's own rule (`travel.js#midDayViaBase`); with no route facts to decide, it chains and never guesses a trip home.

Only billable in-person sessions are stops.

**Allocation** (`billing/travel-billing.js`):
1. Eligible legs are the outbound leg, every between leg, and the return leg **only if** Billing settings › "Return travel is paid to clinicians" is on. It is off by default (fail-closed). Each excluded leg records why.
2. Day pool = Σ eligible minutes, and separately Σ eligible km.
3. Each billable session on the route gets an equal share: pool ÷ sessions.
4. The share is capped at *that participant's* cap. The cap is the rate card's per-direction cap × directions, where directions = 2 when a payable return leg is in the pool. MM1–3 is 30 min, MM4–5 is 60 min, MM6–7 has no cap. **Minutes removed by a cap are not redistributed.**
5. Labour = capped hours × the participant's travel rate. Vehicle = equal km share × $/km. These are separate lines (item codes `_PT` and `15_799_…`); vehicle is not time-capped.

The whole day is held back, with a TRAVEL_DAY_DEFERRED warning, while any session on it is blocked, so shares are never computed on a partial route. A leg with no route facts raises TRAVEL_ROUTE_FAILED, and travel is never estimated. The owner can enter a leg manually (audited) from the attention item.

`travel_billing_allocations` stores, per session: day totals, share, cap, claimable minutes, rates, amounts and every leg with its inclusion reason. The invoice's "How calculated" view reads this.

## MMM classification (`billing/mmm-classification.js`, `billing/mmm-geometry.js`)

```
service address ─► geocode (once) ─► point-in-polygon against the active
official MMM dataset ─► MM 1–7 + source + dataset version ─► billing profile
```

**The source is never a postcode.**

**Dataset.** The Department of Health, Disability and Ageing publishes Modified Monash Model 2023 at
<https://data.gov.au/data/dataset/modified-monash-model-mmm-2023> as "MMM 2023.zip" → `MMM/MMM_2023b.zip`. It contains a shapefile of seven dissolved multipolygons built from ABS SA1 2021, in GDA94.

**Import it** (from `backend/`, once per environment, as part of a release):

  ```
  node scripts/import-mmm-dataset.js --shp MMM2023.shp --dbf MMM2023.dbf \
       --version MMM2023b --published 2025-03-10 --activate
  ```

  About 7,000 rings go into `mmm_dataset_rings`, each with a bounding box, so a lookup reads only a few rings. A new MMM release is a new version row, so billing code does not change.

**Stored per profile:**
- `mmm_zone`, `mmm_source`, `mmm_dataset_version`, `mmm_checked_at`, `mmm_confidence`
- an address fingerprint, which includes the dataset version, so an address change or a new dataset re-classifies automatically
- manual override fields: zone, reason, user, time

**Confidence.** The engine probes about 250 m N/S/E/W. If a neighbour lands in a different zone, or geocoding was imprecise, the profile is stored as REVIEW and raises MMM_REVIEW. The owner confirms it with an audited manual override. With no dataset loaded, every client needs a manual zone.

## Trip allocation (`billing/trip-allocation.js`, `billing/trips.js`)

- **Participation.** A trip has a window, practitioners and participating clients. Clients are auto-added from sessions in the window; manual adds and exclusions are kept.
- **Cost classification.** Every cost starts UNCLASSIFIED. The owner marks it SHARED_BILLABLE or NON_BILLABLE. Any unclassified cost blocks the allocation with TRIP_COST_INCOMPLETE; sessions still invoice.
- **Methods:**
  - EQUAL_PER_CLIENT (default): pool ÷ unique participating clients
  - PER_SESSION: proportional to billable sessions
  - MANUAL_WEIGHTED: proportional to owner weights (changes need a reason)
- **Exact reconciliation.** Allocation is by the largest-remainder method on integer cents, so Σ allocations = eligible pool exactly and can never exceed it. Ties go to a stable client order, so the split is deterministic.
- **Worked example.** $6,000 ÷ 15 = $400.00 each; $3,500 ÷ 3 = $1,166.67 + $1,166.67 + $1,166.66.
- **One line per client.** Each participating client gets one TRIP_COST line, "Remote Trip Shared Travel Cost – {trip}". The full calculation is in the line snapshot and in `trip_allocations`; the current set is marked `is_current`, and history is kept.
- **No double billing.** At most one live TRIP_COST claim exists per trip and client. If the allocation changes after a client's invoice was finalised, TRIP_ALLOCATION_CHANGED is raised; the invoice is not rewritten.

## Invoice lifecycle (`billing/invoice-lifecycle.js`)

| Status | Meaning / allowed |
|---|---|
| DRAFT | Editable, regenerable. |
| NEEDS_ATTENTION | Like DRAFT, but the recipient or NDIS number is missing. It cannot be finalised. |
| READY | Finalised. Numbers are locked and one final PDF is stored (`invoice_documents.is_final`, unique per invoice), never regenerated. |
| SENT | Emailed through the shared mail transport with the PDF attached, or marked sent manually. |
| PART_PAID / PAID | Payments are recorded. Overpayment is refused. PAID means outstanding = 0. |
| OVERDUE | Derived for display (sent or part-paid, past due, money owing); not stored. |
| VOID | Voiding requires a reason and no recorded payments. Lines become VOIDED, which frees their claims. **Void & reissue** regenerates a new draft that records `reissue_of_invoice_id`. |

Finalising requires:
- no stale flag
- a recipient
- an ABN in Billing settings
- at least one active line
- totals that match the lines

The PDF is re-rendered under the row lock from the checked data.

**Draft editing.**
- Owners can edit a line's description, quantity or unit price, remove or restore a line, add a manual line, and correct the recipient.
- Every financial change needs a reason and writes an audit event with before and after values.
- The line keeps both its original calculation snapshot and an `overrides` array.
- A regenerate run never recalculates an overridden line, and never re-adds a removed one.

## Idempotency

The partial unique index `uq_invoice_lines_event_component` on
`invoice_lines (calendar_event_id, component) WHERE line_status IN ('ACTIVE','REMOVED')`
makes a second claim for the same event and component impossible, even
under concurrency. `uq_invoice_lines_trip_cost` does the same for trip costs.
Runs are also serialised per organisation by an advisory lock.

## Calendar changes after invoicing

Triggers on `events` (`trg_billing_event_update`, `trg_billing_event_delete`)
fire for changes to billed fields: time, client, practitioner, status,
deletion, type and location. Setting a billing mark does the same. It
does not matter which component wrote the change (Outlook sync, Splose sync
or the UI).

- **Draft:** `is_stale = TRUE`. The UI recommends Regenerate, and Finalise is refused until then.
- **Finalised:** `source_changed_after_finalise = TRUE` plus a SOURCE_CHANGED_AFTER_FINALISE attention item. The invoice is **never** altered. The owner voids and reissues, or dismisses the item with a reason.

The calendar event drawer shows "Invoiced INV-xxxx" (owner only) and the
billing mark selector.

## Rate versioning

A service is priced by the ACTIVE card for its discipline whose effective period contains the service date. When cards overlap, the latest `effective_from` wins, then the highest version. A card that has priced any finalised line is locked; editing it returns `RATE_CARD_IN_USE`, and the owner creates a new version instead. Historical invoices don't depend on the card table anyway, because each line snapshots:
- the card id, version and name
- the zone rule
- the rates and the cap
- the quantity and the amount

## Audit model

`billing_audit_events` is append-only: a trigger rejects UPDATE and DELETE. Each row records:
- actor
- action
- entity
- before and after values (financial fields and ids only)
- reason
- time

It is written in the same transaction as the change. Actions include:
- `invoice_run.created`, `invoice.generated`, `invoice.recalculated`
- `invoice.line_added`, `invoice.line_removed`, `invoice.line_restored`, `invoice.line_overridden`
- `invoice.recipient_corrected`, `invoice.finalised`, `invoice.sent`, `invoice.payment_recorded`, `invoice.voided`, `invoice.reissued`
- `billing_profile.updated`, `billing_profile.mmm_override`
- `rate_card.created`, `rate_card.updated`, `billing_settings.updated`
- `trip.created`, `trip.cost_added`, `trip.cost_updated`, `trip.cost_removed`, `trip.allocation_changed`, `trip.allocation_input_changed`
- `route_fact.manual`, `event.attendance_marked`, `issue.dismissed`

## Authorisation and tenancy

- **Permission.** Every `/api/invoicing/*` route requires `requireAuth` plus `requirePermission('manage_billing')`. This permission already existed in the owner's defaults and was unused. It can be granted per user through the existing permission architecture, which is the path for a future finance or admin role. Admins and therapists are refused, including for events on their own calendar.
- **Tenancy.** Every query is scoped to `req.user.organisation_id`, and a user without an organisation is refused.
- **Navigation.** The Invoicing tab is in the owner's Business menu and gated by `PERMISSION_TABS.invoicing = 'manage_billing'`. That is UI convenience only; the server enforces access.

## Settings

The Billing settings screen covers:
- invoice prefix, next number and padding
- default payment terms (per-client override on the profile)
- business name, email, phone and address; blank values fall back to Settings › Organisation
- ABN, payment details and footer
- default tax treatment (GST-free by default)
- default trip allocation method
- completion rule
- timezone
- session description
- return-travel policy
- rate cards
- MMM dataset status

The logo is `backend/assets/opal-therapy-logo.png`, the same file other Opal PDFs use.

**Numbering.** Numbers are allocated under a row lock and are sequential per organisation. A number already in use is skipped. Set "Next invoice number" to continue the practice's existing sequence. The numbers must not collide with invoices still issued from Splose; change the prefix if both stay in use.

## Extension points

- **Another discipline.** Add a rate card with a new `discipline`. The generator currently prices `therapy` events as OT; mapping event service types to disciplines is the next step.
- **Xero.** Invoices, lines and payments are self-contained. Pushing a finalised invoice through the accounting module's fail-closed write flags can attach `xero_invoice_id` without touching the calculation.
- **Payment provider.** `recordPayment` is the single entry point for payments.
- **Maps provider.** `billing/maps-adapter.js#setMapsProvider`.
- **Attendance from Splose.** Populating `calendar_event_billing` from Splose appointment status would replace the PAST_CONFIRMED default.

## Configuration still required per environment

1. Apply migration 071. Deploy order: code → migrate → restart.
2. Import the MMM 2023 dataset (command above). Until then, clients need manual zones.
3. `GOOGLE_MAPS_API_KEY`, which is already used by the calendar. Without it, travel legs raise TRAVEL_ROUTE_FAILED until they are entered manually.
4. In Billing settings, set the ABN, payment details, the next invoice number and the return-travel policy.
5. SMTP (`EMAIL_*`) for "Email invoice". Otherwise use "Mark sent".
