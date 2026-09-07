# NDIS billing rules for Occupational Therapy

Reference for the invoicing algorithm. Everything below is transcribed from
two NDIA documents and cross-referenced; page numbers cite the source.

| Short name | Document | Status |
|---|---|---|
| **PAPL 25-26** | NDIS Pricing Arrangements and Price Limits 2025-26 v1.1 (published 14 Oct 2025; arrangements valid from 24 Nov 2025; prices from 1 Jul 2025) | Prices **and** claiming rules |
| **Sched 26-27** | NDIS Pricing Schedule 2026-27 v1.2 (published 22 Jul 2026; effective 1 Jul 2026) | Prices **only** |

> The 2026-27 document supplied is a price schedule. It carries no claiming
> rules. Until the 2026-27 *Pricing Arrangements* is supplied and checked, the
> 2025-26 claiming rules are treated as current. This is the one assumption in
> this document.

Machine-readable versions: [`backend/ndis/ot-price-guide.js`](../../backend/ndis/ot-price-guide.js)
(data) and [`backend/ndis-billing-rules.js`](../../backend/ndis-billing-rules.js) (logic).

---

## 1. Which line items an OT practice claims

An OT with current AHPRA registration claims under Registration Group **0128
Therapeutic Supports** for participants 9 or older, and **0118 Early
Intervention Supports for Early Childhood** for participants younger than 9
(PAPL 25-26 p.61-62, p.92-96). "Where a line item exists for a specific type
of professional, supports of that type need to be made against that item"
(p.61, p.96), so OT work is never claimed under *Other Professional*.

| Item | Name | Budget / category | Age | Use when |
|---|---|---|---|---|
| `15_617_0128_1_3` | Assessment Recommendation Therapy or Training – OT | Capacity Building 15 Improved Daily Living | 9+ | The default OT item |
| `01_661_0128_1_3` | Same, Disability-Related Health Supports duplicate | Core 01 Assistance with Daily Life | 9+ | Only when the plan funds the DRHS work from Core (p.61) |
| `10_617_0128_5_3` | Employment Therapy – OT | Capacity Building 10 Finding and Keeping a Job | 9+ | Employment-related OT, plan-stated (Sched 26-27 only) |
| `15_617_0118_1_3` | ECI Professional – OT | Capacity Building 15 | <9 | Default under-9 item |
| `01_650_0118_1_3` | ECI DRHS duplicate | Core 01 | <9 | Under-9 DRHS from Core |
| `15_052_0128_1_3` / `15_007_0118_1_3` | Therapy Assistant Level 1 | CB 15 | 9+ / <9 | TA under **direct** supervision at all times |
| `15_053_0128_1_3` / `15_008_0118_1_3` | Therapy Assistant Level 2 | CB 15 | 9+ / <9 | TA under indirect supervision, therapist satisfied they can work independently |
| `15_045_0128_1_3` | Community Engagement Assistance | CB 15 | 9+ | Group social-engagement support; flat per-participant price, no NDIA report claim |
| `15_049_0128_1_3` | Multidisciplinary Team | CB 15 | 9+ | Only with NDIA prior approval; no price limit |

Claim-type coding differs between the two years:

- **PAPL 25-26**: one item number per support; the claim type is chosen in the
  myplace portal drop-down (*Provider Travel*, *Non-Face-to-Face*,
  *Cancellation*, *NDIA Report*, *Telehealth Services*).
- **Sched 26-27**: the same claim types become explicit suffixed item numbers:
  `_PT` travel, `_NF` non-face-to-face, `_CA` cancellation, `_RR` NDIA
  requested report, `_TH` telehealth. Example: `15_617_0128_1_3_PT`.

The engine emits both the suffixed code and the portal option so either
claiming channel can be produced.

---

## 2. Price limits — cross-referenced

Hourly limits. Remote = MMM6 (+40%), Very Remote = MMM7 (+50%); no loading in
MMM1-5 (PAPL p.31).

| Item | Claim type | 25-26 National | 26-27 National | Remote | Very Remote | Change |
|---|---|---|---|---|---|---|
| OT 9+ (`15_617_0128_1_3`, `01_661_0128_1_3`) | Direct, Telehealth, NF2F, Cancellation, NDIA Report | $193.99 | $193.99 | $271.59 | $290.99 | none |
| OT 9+ | Provider Travel (50%) | $97.00 | $97.00 | $135.80 | $145.50 | none |
| OT <9 (`15_617_0118_1_3`, `01_650_0118_1_3`) | Direct etc. | $193.99 | $193.99 | $271.59 | $290.99 | none |
| OT <9 | Provider Travel | $97.00 | $97.00 | $135.80 | $145.50 | none |
| OT Employment (`10_617_0128_5_3`) | Direct etc. | not in supplied 25-26 tables | $193.99 | $271.59 | $290.99 | new listing |
| Therapy Assistant L1 | Direct etc. | $56.16 | $56.16 | $78.62 | $84.24 | none |
| Therapy Assistant L1 | Travel | $28.08 | $28.08 | $39.31 | $42.12 | none |
| Therapy Assistant L2 | Direct etc. | $86.79 | $86.79 | $121.51 | $130.19 | none |
| Therapy Assistant L2 | Travel | $43.40 | $43.40 | $60.76 | $65.10 | none |
| Community Engagement Assistance | Direct | $51.20 | not in supplied 26-27 tables | $71.68 | $76.80 | — |
| Non-labour travel (`15_799_0128_1_3`, `01_799_0128_1_1`, `15_799_0118_1_3`, `01_799_0118_1_1`, `10_799_0128_5_3`) | Each | $1.00 notional | $1.00 notional | $1.00 | $1.00 | none |

Sources: PAPL p.62, p.94, p.96-97; Sched p.35-36, p.48, p.54, p.62-63, p.74-76.

**Cross-reference findings.** OT and therapy-assistant limits did not move
between the two years. For context, other professions did: Psychology rose
$232.99 to $252.99; Dietetics fell $188.99 to $178.99; Exercise Physiology fell
$166.99 to $161.99; Physiotherapy ($183.99) and Podiatry ($188.99) held. The
travel item is priced at exactly 50% of the direct limit in both years, and the
26-27 schedule now prints it as its own line rather than leaving it to the
p.22 rule.

Therapy items carry **no time-of-day or day-of-week variants**. The weekday /
evening / Saturday / Sunday / public holiday split on p.17-18 applies to
Disability Support Workers and nurses only. An OT session on a Saturday is
claimed at the same limit as a Tuesday.

---

## 3. Claiming rules — the business rule set

Each rule below is a constraint the algorithm enforces or flags. "Warn" means
the claim is produced with a warning for owner review; "block" means no line
is produced.

### 3.1 Who the limits bind (PAPL p.9-10)

| Funding | Rule | Engine |
|---|---|---|
| NDIA (agency) managed | Provider must be registered; limits apply | block if `providerRegistered === false` |
| Plan managed | Limits apply regardless of provider registration; plan manager needs ABN and tax invoice | limits enforced |
| Self managed | Limits and arrangements do not apply | warn `self_managed_limits_not_binding`, never `needs_review` |

The NDIA does not set prices. The practice agrees a price with each participant
and must not tell participants the price is set by the NDIA (p.9). The agreed
rate lives in `finance_pricing_rules`; this engine only checks it against the
ceiling.

### 3.2 Units and proration (p.16-17)

- Claim in the item's unit (hour) at the agreed unit price. Never above the limit.
- Less than a full unit is claimed pro rata by time: `amount = rate × minutes ÷ 60`, rounded to cents. The p.16 table at $193.99 (10 min = $32.33 … 50 min = $161.66) is reproduced by the tests.
- Claim a quantity of hours **or** units, never both.
- Only claim after delivery. No prepayment for therapy.

### 3.3 Telehealth (p.20, p.32)

- Same limit as direct. 26-27 code `_TH`; 25-26 portal option *Telehealth Services*.
- Must be appropriate, part of a specific support item, explained to the participant, and **agreed in advance in the service agreement**. Engine: warn `telehealth_agreement_not_confirmed`.
- The price limit is the one for **where the provider is**, unless a remote / very remote participant agrees the remote limit represents value for money. Engine uses `providerMmm` for telehealth, NF2F and reports.

### 3.4 Non-face-to-face (p.20-21)

Claimable only if all hold: the PAPL allows NF2F for the item (it does for all therapy items), charges comply, the activity is part of delivering a **specific support to that participant**, the value is explained, and the participant agreed in advance. Engine: warn `non_f2f_agreement_not_confirmed`.

**Never claimable as NF2F** (covered by the overhead component of the price limit): pre-engagement visits, developing service agreements, entering or amending participant details, service-time changes, travel monitoring, plan monitoring, quoting, service bookings, payment claims, and staff training, up-skilling and supervision. Claimable examples: reports for co-workers or other providers about the participant, participant-specific research linked to plan goals.

Charging a fee that is not linked to completed activity is not permitted, even if the service agreement pre-authorises NF2F.

### 3.5 Provider travel (p.21-25, p.31)

Preconditions (all): the item allows travel; the primary support is delivered **face to face**; the participant agreed the travel costs in advance; the worker is paid for travel time under their employment agreement (or is a sole trader travelling from their usual place of work).

**Labour (time)**

| Participant location | Cap per direction, per participant | Rate limit |
|---|---|---|
| MMM1-3 | 30 minutes | 50% of the direct limit ($97.00) |
| MMM4-5 | 60 minutes | 50% of the direct limit |
| MMM6-7 | no cap | 50% of the loaded limit ($135.80 / $145.50) |

- The MMM band is the **participant's** location at time of service.
- Return travel to the usual place of work is also claimable within the same cap, but only if the worker is paid for it.
- A multi-participant trip divides the total travel (including return) across the participants by prior agreement.
- Claimed separately from the primary support, same item with the *Provider Travel* option (26-27: `_PT`), at the travel rate or lower.
- Not claimable if the support already has travel built in.

**Non-labour (vehicle, tolls, parking)**

- Vehicle running cost guide: up to **$0.99 per kilometre**; other costs at full amount.
- Claimed against the `_799_` non-labour travel item for the registration group (e.g. `15_799_0128_1_3`), quantity = dollars at $1.00 notional unit.
- Only claimable where the labour-time rules allow a travel claim.

Engine: caps minutes and warns `travel_minutes_capped`; warns `per_km_rate_above_guide`, `travel_rate_above_limit`, `travel_agreement_not_confirmed`; blocks travel on telehealth, NF2F, report and cancellation claims.

Worked example (PAPL p.25, OT rates): 35 min out, 25 min back, MMM3, 80 km at $0.78. Claim = 30 + 25 = 55 min at $97.00 = $88.92 labour, plus $62.40 non-labour.

### 3.6 Short notice cancellation (p.26-27)

For therapy (non-DSW) supports the notice period is **2 clear business days**. Short notice also includes no-shows and the participant not being present when the provider arrives.

Claimable only if all hold: the item allows it (all therapy items do); the service agreement documents the cancellation terms; the provider could not find alternative billable work and must pay the worker.

- Up to **100%** of the agreed fee, same item, *Cancellation* option (26-27: `_CA`).
- The provider may waive it or offer better terms. No hard limit on count, but the NDIA monitors unusual patterns and the provider has a duty to follow up.
- Programs of support are exempt from the cancellation rules (p.32).

Interpretation of "2 clear business days" follows the p.27 example: a Tuesday 10 am appointment after a Monday public holiday can be cancelled without charge until **Thursday 10 am**. The engine walks back two business days from the start time, keeping the time of day and skipping weekends and the supplied public-holiday list. If no holiday list is supplied it still computes but warns `public_holidays_not_supplied`.

### 3.7 NDIA requested reports (p.27-28)

Claimable only if the service agreement allows it **and** the NDIA requested the report. A report counts as requested when it is required at plan commencement (objectives and goals), at plan review (functional outcomes against goals), recommends ongoing needs, or is stipulated in the plan. Same limit as direct, *NDIA Report* option (26-27: `_RR`). Engine warns `ndia_report_request_not_confirmed` and `ndia_report_agreement_not_confirmed`.

### 3.8 Groups (p.32)

Per-participant limit = item limit ÷ group size. Each participant is claimed for the full session time at that lower limit. Exception: Community Engagement Assistance is a flat per-participant price. Where a participant cancels a group session at short notice and cannot be replaced, they are billed as if they attended and the rest of the group is billed as if all attended (p.26).

### 3.9 More than one worker (p.36-37)

Both the therapist's and the therapy assistant's time is billable during supervision or specific training that is part of handing delivery to the assistant. Case conferences between therapists about a participant are billable for all therapists' time. Level 1 assistants require direct supervision at all times; Level 2 may work under indirect supervision.

### 3.10 What cannot be charged (p.37-40)

- Supports that are not reasonable and necessary, not tied to plan goals, or more appropriately funded by Medicare / health / another system. A therapist may need to split one client's work between Medicare and NDIS claims.
- Massage or treatment delivered directly to a body part (health system, p.94).
- Maintenance therapy only where it maintains function or prevents decline; ordinarily delivered by trained carers.
- **No** card surcharges, gap fees, late-payment fees, exit fees, or any fee the PAPL does not permit.
- GST: most therapy supports are GST-free; if GST applies, the limit is GST-inclusive.

---

## 4. How the weekly calendar becomes claims

Inputs the engine needs per event, and where the portal will source them:

| Input | Source |
|---|---|
| Start / end (duration) | `events.start_time` / `end_time` |
| Status (completed, cancelled, no-show), cancellation time | Splose appointment status + the cancellation timestamp (Splose exposes cancelled-at) |
| Delivery mode (in person, telehealth, NF2F, report) | Splose service / appointment type mapping in `finance_service_mappings` |
| Profession (OT, TA1, TA2) | practitioner record |
| Participant age (or age band) | client date of birth |
| Budget (capacity building, core DRHS, employment) | plan / service agreement line |
| Participant MMM | client address via the Health Workforce Locator; stored once per client |
| Provider MMM | practice location setting |
| Funding type | client record (NDIA / plan / self managed) |
| Agreed hourly rate | `finance_pricing_rules` via `pricing-engine.js` |
| Service agreement flags (telehealth, NF2F, reports, cancellations, travel) | service agreement record |
| Travel minutes, kilometres, return leg, shared participants | the calendar's travel chain (`travel_time_minutes`, `travel_distance`) |
| Public holidays | a per-state holiday list (to be added) |

Per event, `buildClaim` produces one primary line (direct / telehealth / NF2F / report / cancellation) and, for a delivered face-to-face session, up to two travel lines. `buildWeeklyClaims` rolls a week up per participant. Each claim has a status:

- `ready` — within limits, all agreement flags confirmed.
- `needs_review` — a rate or travel rate above the limit; nothing is clamped.
- `not_claimable` — cancellation with sufficient notice, or a cancellation the rules do not allow.
- `blocked` — inputs missing (age, item, date outside a known financial year, unregistered provider on an NDIA-managed plan).

Warnings are codes only; no client content is stored in them.

---

## 5. Open items before invoicing goes live

1. Supply the **2026-27 Pricing Arrangements and Price Limits** so the claiming rules (not just prices) can be re-verified for the current year.
2. Confirm which OT services the practice delivers from **Core (DRHS)** versus Capacity Building; the item choice depends on the plan.
3. Decide the practice's **cancellation policy** wording in the service agreement template. The engine enforces the NDIS ceiling (2 business days, 100%); the agreement can be more generous.
4. Confirm the **per-kilometre rate** the practice will charge (guide max $0.99) and whether return travel is paid to staff (drives whether the return leg is claimable).
5. Source a **public holiday list** per state so the cancellation deadline is exact.
6. Record each client's **MMM** and each practitioner's profession / TA level.
7. Wire `buildClaim` into the invoice-candidate generation in `accounting-db.js` alongside `pricing-engine.js`: the pricing engine supplies the rate, this module supplies the item code, ceiling and eligibility, and the two sets of warnings merge into `finance_invoice_candidates.warnings`.
