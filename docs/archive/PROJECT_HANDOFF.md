# Therapy Scheduling App — Project Handoff

**User:** Antony (ant.manixavier@gmail.com) — therapist/manager at **Opal Therapy**, a single-location NDIS-focused OT practice in Willetton WA (Perth metro, `Australia/Perth` timezone).

**Date of handoff:** 2026-04-20

---

## What we're building

A smart therapy scheduling web app that sits on top of Splose (NDIS practice management software). Reads data out of Splose, runs smart scheduling logic, writes new appointments back.

### Core features
- Dynamic weekly calendar with colour-coded session blocks
- Smart scheduling: regional clustering (group East-side clients on same day, West-side on another)
- Busy/admin day alternation (don't stack two back-to-back heavy client days)
- Capacity check for new clients against NDIS funding plans
- Billable hours + utilisation tracking
- Recurring blocks for admin, report writing, case noting

### Session types (8)
1. Initial session
2. Therapy session
3. Assessment session
4. Multidisciplinary meetings (MDT)
5. Travel
6. Report writing
7. Case noting
8. Admin

Default durations ~1 hour but timing is dynamic — user must be able to edit per session.

---

## Architectural decisions

### Hosting & security
- **End-to-end encrypted cloud** (not local-only — team needs to share data)
- **Microsoft 365 suite** already in use across the team — big asset. Plan to use Entra ID for SSO, Azure (Australia region) for hosting, native Outlook/Teams/OneDrive integration
- **Compliance:** Australian Privacy Principles (APP), Privacy Act 1988, NDIS Practice Standards, Australian data residency required

### Data flow
Splose is the system of record. Our app reads from Splose, applies scheduling logic, writes back. We don't replace Splose — we make it smarter.

### Visual style
Warm, illustrated, friendly — the aesthetic of Splose's own calendar icons (user shared screenshot previously).

---

## Splose API — verified endpoints

**Base URL:** `https://api.splose.com/v1`
**Auth:** `Authorization: Bearer <token>`
**Rate limit:** 60 calls/minute
**Pagination:** `id_gt` / `id_lt` (NO `limit` param — server rejects with 400)
**Realtime/delta feed:** `update_gt` / `update_lt`
**Query param validation:** strict (Zod). Unknown keys → 400 with `formErrors`. Use only documented params.

### Read endpoints confirmed
| Endpoint | Purpose | Key fields |
|---|---|---|
| `GET /patients/{id}` | Patient + NDIS info | `ndisNumber`, `ndisInfo` (fundManagement, nominee, plan dates, Medicare) |
| `GET /cases/{id}` | NDIS funding plan | `hours`, `budget`, `appointmentCount`, `trackType` (Appointments/Hours/Budget), `utilisationAlert`, `issueDate`, `expiryDate`, `items[]`, `includeDidNotArrive`, `includeCancelled` |
| `GET /services/{id}` | Service catalogue | `duration` (minutes), `unit` (Hour/Each), `pricing`, `taxType`, `for` (appointment/support activity), `serviceTags`, travel pricing fields |
| `GET /appointments/{id}` | Appointments | Client-facing bookings |
| `GET /busy-times/{id}` | Admin/internal blocks | `start`, `end`, `practitionerIds[]`, `busyTimeTypeId`, `recurringRule` |
| `GET /busy-time-types/{id}` | Types of admin block | `title`, `color`, `duration`, **`isUtilisationIncluded`** (critical), `note` |
| `GET /support-activities/{id}` | Travel + non-labour costs | `patientId`, `caseId`, `serviceId`, `pricing`, `quantity`, `invoiceId`, `doNotInvoice` |
| `GET /availabilities/{practitionerId}` | Practitioner working hours | `date`, `locationId`, `startTime`, `endTime`, `repeatInterval` (max 100-day range per call) |
| `GET /contacts/*`, `GET /locations/*` | Supporting reads | Locations needed for address → regional clustering |

### Write endpoints confirmed
- `POST /appointments` — create appointment (supports RRULE recurring, group appointments via `maxPatients`/`appointmentPatients`, `caseId` linking)
- `PUT /appointments/{id}` — reschedule / edit (returns `1` on success)
- `POST /patients` — full NDIS field support
- `PUT /support-items/{id}` — update travel items (`Provider Travel` / `Non-Labour Costs` / `Activity Based Transport`, with `toMinutes`/`returnMinutes`)
- Case endpoints appear read-only — fine, clients/cases are created in Splose UI

### API surface fully mapped (as of 2026-04-20)

**Location GET** — `id, title, abn, address, postalCode, suburb, state, country, phone, email, timezone, onlineBooking, archived, deletedAt, createdAt, updatedAt`. For regional clustering use the structured fields (`suburb` / `postalCode` / `state`) rather than the free-text `address`. Filter out `archived=true` or non-null `deletedAt`.

**Practitioner GET** — `id, firstname, lastname, email, title, profession, description, roleName, providerNumbers[{type, number, locationId}], isActive, onlineBooking, timezone, archived, deletedAt, createdAt, updatedAt`. **No `colour` field** — practitioner colour must be assigned client-side (e.g. hashed palette) or we lean on session-type colour as in the v1 mockup. Filter scheduler view by `isActive=true`, `archived=false`, null `deletedAt`.

**Cancellation path — READ-ONLY, nested in `appointment.appointmentPatients[]`.** The cancellation fields (`status`, `cancellationReason`, `cancellationRate`, `cancellationNote`, `statusUpdatedAt`) live in a per-patient sub-array on each appointment — one entry per patient (supports group sessions where one attends, another no-shows). No write endpoint exposed; cancellations and no-shows must be done in the Splose UI. We read them via `GET /appointments` and reflect state via the delta feed.

- **`cancellationRate` = NDIS per-cancellation billable percentage** (how much of the fee is charged based on notice given), NOT a client-level frequency stat. For per-client risk scoring we compute from history.
- Smart rescheduler **detects** cancellations on poll; proposes replacement slots; user confirms cancellation in Splose
- Polling cadence for the active-day view should be ~1–2 min to avoid ghost appointments

---

## Session type → Splose resource mapping (corrected 2026-04-20 from live data)

| Our session type | Splose resource | Splose ID / notes |
|---|---|---|
| Initial | Appointment | service `125821` — Initial Assessment/Consultation |
| Therapy | Appointment | service `125320` — Therapy Session |
| Assessment | Appointment | service `131003` — Assessment Session |
| MDT | Appointment | service `166733` — MDT Meeting |
| Travel (billable) | Support-Activity | links patient+case, has pricing |
| Travel (non-billable) | Busy-Time | busy-time-type `55337` Travel (30min default) |
| Report writing | **Support-Activity** | billable; `for: "support activity"` services (Progress report, FCA, Sensory Report, Support Letter) |
| Case noting | **TBC with Antony** | no dedicated busy-time-type or service; probably folded into "Admin" or session time |
| Admin | Busy-Time | busy-time-type `55339` Admin (30min default) |

Plus leave/holiday blocks (not in our 8 session types but on the calendar): busy-time-types `55333–55336` (Personal / Sick / Annual / Public holiday) — all 450min (full-day) default.

Three write surfaces: **Appointment** (client-facing), **Busy-Time** (internal/time-off), **Support-Activity** (billable non-face-to-face).

### Scheduler design corrections

- **Busy/admin-day alternation** can't use `isUtilisationIncluded` (every type is `false` in this account). Compute day intensity directly from count of appointment blocks per day.
- **Colour palette:** honour Splose's per-busy-time-type colours (e.g. Admin `#F064E1`, Lunch `#8250FF`, Travel `#00C887`). For practitioners (no colour field), assign client-side.
- **Single-location / single-practitioner at v1:** design for N, validate with 1. Opal Therapy currently has one practitioner in Splose (Ann Mary Mathew); team may expand.
- **No online self-booking:** admin books all clients, so our app is the only automated writer alongside manual Splose UI entries.

---

## Smart scheduler architecture (ready to design)

### Free-slot computation
```
For each practitioner:
  availability (working hours per location, per day pattern)
- appointments (patient-facing bookings)
- busy-times (admin/internal blocks)
- support-activities (travel legs)
= free slots
```

### Scoring layer
```
+ location-aware clustering (group East-side patients on same day)
+ busy/admin day alternation (via isUtilisationIncluded on busy-time-types)
+ case capacity check (hours/appointments/budget vs trackType)
+ funding window check (issueDate/expiryDate)
→ scored slot recommendations
→ write back as Appointment (+ optional Support-Activity for travel)
```

---

## What exists in the workspace

- `mockup_v1.html` (604 lines, 22KB) — v1 clickable HTML mockup: week grid Mon-Fri, 8 colour-coded session types, left sidebar nav + legend, right sidebar stats + work preferences, capacity-check modal. **Paused pending API validation.**

---

## Updates (May 10, 2026)

### Features Added to Mockup

**✅ Dormant Case Reminder** — Auto-detects cases with 6+ weeks no interaction
- New dashboard tab with sortable table
- Daily scheduled check (06:00 AWST, configurable)
- Email report with NDIS status, suggested actions, quick-schedule links
- Files: `DORMANT_CASES_FEATURE.md`, `dormant_cases_scheduler.js`, `mockup_v2_dormant_cases_addition.html`

**⏳ Case Noting Suggestions** — Auto-suggest 10–15 min note time after sessions
- Flexible scheduling: same-day preferred, or add to flexible to-do
- Configurable duration and location
- Writes to Splose as Admin busy-time-type (or TBC dedicated type)
- Design doc: `FEATURE_ADDITIONS_ROADMAP.md` (Phase 2)
- **Blocker:** Confirm whether case notes use "Admin" or dedicated busy-time-type in Splose

**⏳ Client Reminders** — Auto-send SMS/email 24h before appointment
- Configurable reminder window (4/12/24/48 hours)
- SMS preferred, email fallback
- Hourly scheduler checks upcoming appointments
- Design doc: `FEATURE_ADDITIONS_ROADMAP.md` (Phase 3)
- **Blocker:** Splose API needs `patient.mobilePhone`, `patient.preferredReminderChannel` fields

---

## Immediate next steps when you resume

1. **REVIEW & INTEGRATE Dormant Cases Feature** (ready to go)
   - Merge `mockup_v2_dormant_cases_addition.html` components into main `mockup_v2.html`
   - Deploy `dormant_cases_scheduler.js` to Cloudflare Worker or backend service
   - Test with mock data; configure email service (SendGrid/SES/Azure Mail)

2. **DECIDE on Case Noting approach**
   - Confirm with Ann: should case notes be logged as "Admin" busy-time-type (existing, #55339) or new dedicated type?
   - Once decided, implementation is straightforward (modal workflow + Splose POST /busy-times)

3. **DECIDE on Client Reminder channels & gateway**
   - SMS (Twilio? AWS SNS? Vonage?) or email-only?
   - Will Splose API expose `patient.mobilePhone` field?
   - Fallback strategy if contact method missing?

4. **Practitioner colour strategy** — Splose doesn't return one per practitioner. Options: client-side hashed palette, or lean on session-type colour from v1 mockup.

5. **Rebuild mockup v1 against corrected session-type → service-ID mapping** (Therapy=125320, Initial=125821, Assessment=131003, MDT=166733).

6. **Plan Microsoft 365 / Entra ID / Azure Australia hosting architecture** before actual implementation.

7. **When integration-testing PHI endpoints** (`/patients`, `/cases`): probe with redacted outputs. Not needed for scheduler design, only for later write-side testing.

---

## Platforms evaluated and rejected

Cliniko, Halaxy, Nookal, Carepatron, Power Diary, coreplus, iinsight — all considered during a brief "switch platforms" detour, then rejected when Splose write APIs were confirmed. **Staying on Splose.**
