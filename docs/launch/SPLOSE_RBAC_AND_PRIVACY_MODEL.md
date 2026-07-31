# Splose RBAC & Privacy Model

Stage 1 launch-blocker fix (2026-07-31) for audit findings C1/C2: the
entire `/api/splose/*` proxy was requireAuth-only, exposing every client's
PII and all practice financials to any authenticated account, and one write
route bypassed the read-only flag entirely. This is the enforced model now.

## Principles

1. **Backend-enforced** — frontend tab-hiding is cosmetic; every rule below
   is middleware on the route (`backend/routes.js`, "Splose proxy access
   model" block).
2. **Fail-closed** — a therapist with no Splose practitioner mapping gets an
   explicit `practitioner_mapping_required` 403, never a data fallback.
3. **read_only means read NOTHING from the practice-management system** —
   their calendar mirror is served from the local DB, not the proxy.
4. **No write reaches Splose with `ENABLE_SPLOSE_WRITE=false`** — and no
   route may ever call Splose with raw axios around `splose-api.js`.

## Route classification (all 23 proxy routes)

| Route | Access | Enforcement |
|---|---|---|
| GET `/api/splose/status`, `/sync-status`, `/services`, `/practitioners`, `/locations`, `/busy-time-types` | owner/admin/therapist (reference data, no client PII) | `requireAuth + denySploseToReadOnly` |
| GET `/api/splose/appointments` | owner/admin: any practitioner · therapist: **forced to own** `splose_practitioner_id` (client-supplied param overridden; unmapped → 403 `practitioner_mapping_required`; other id → 403 `practitioner_scope_denied`) | `+ scopeSplosePractitioner('query')` |
| GET `/api/splose/appointments/:id` | owner/admin any · therapist only if the appointment's practitioner matches their mapping (fetch-then-check, fail-closed) | `assertOwnAppointment` |
| GET `/api/splose/busy-times` | same practitioner scoping | `scopeSplosePractitioner('query')` |
| GET `/api/splose/availabilities/:practitionerId` | owner/admin any · therapist own id only | `scopeSplosePractitioner('params')` |
| GET `/api/splose/patients`, `/patients/:id` | **owner/admin only** (whole-practice PII: names, addresses, NDIS numbers, phones) | `requireSploseAdmin` |
| GET `/api/splose/cases`, `/contacts` | **owner/admin only** | `requireSploseAdmin` |
| GET `/api/splose/invoices`, `/payments`, `/support-activities`, `/support-items` | **owner/admin only** (financial) | `requireSploseAdmin` |
| GET `/api/splose/dormant-cases` | **owner/admin only** (whole-practice PII + activity) | `requireSploseAdmin` |
| GET `/api/splose/debug/*` (raw dumps) | owner only (pre-existing) | `requireRole('owner')` |
| POST `/api/splose/appointments` | owner/admin, or therapist scoped to own practitioner — **then flag-gated** (`ENABLE_SPLOSE_WRITE`) | scoping + real `splose-api.createAppointment` gate |
| PUT `/api/splose/appointments/:id` | therapist: ownership verified BEFORE any write attempt — then flag-gated | fetch-then-check + gate |
| POST `/api/splose/busy-times` | scoped as above — **now flag-gated** (`createBusyTime` previously had no flag check) | gate added in `splose-api.js` |
| POST `/api/splose/patients` | **owner/admin only + flag-gated.** The direct-axios call that bypassed `ENABLE_SPLOSE_WRITE` is deleted; the route now goes through the new `splose-api.createPatient()` which throws `FEATURE_DISABLED` when the flag is off | `requireSploseAdmin` + gate |

**Explicit admin position:** admin is intentionally equivalent to owner on
the Splose proxy (practice-management operations are an admin function);
financial visibility inside the LOCAL mirror remains owner-only via
`stripFinancials` on calendar routes. Revisit if a lower-trust admin is
ever hired.

## Therapist caseload position (owner decision, recorded)

Splose has no caseload/assignment concept and neither did the portal. For
launch, "a therapist's data" is defined as **appointments (and busy times /
availabilities) belonging to their linked Splose practitioner id** — which
includes the patient names/addresses embedded in those appointments via the
enriched payload. The whole-practice patient directory is owner/admin-only;
consequently the Smart Booking patient picker now shows an honest
"not available for your role" state for therapists (it booked as Ann's
practitioner id anyway — a separate Stage 2 fix). If therapists need richer
client access later, build explicit per-client assignment, not a proxy
reopen.

## Data minimisation changes

- `[location-debug]` log line no longer prints patient names/raw address
  fields — identifier only (audit H6).
- `_patientRawAddress` debug payload now attaches in `development` only
  (was leaking on staging).
- Dormant auto-check no longer runs (or caches whole-practice data) in
  therapist/read_only browsers.
- Not done in Stage 1 (documented): field-stripping of NDIS numbers from
  the enriched own-appointments payload for therapists; sessionStorage SWR
  caches are not yet cleared on logout.

## Proof

`backend/tests/integration/stage1-launch-blockers.itest.js` (16 tests):
unauth 401 on every route; read_only 403 everywhere incl. reference data;
therapist 403 on all nine PII/financial routes with the underlying Splose
client functions proven un-called; unmapped-therapist fail-closed;
mapped-therapist forced scoping (spy asserts the practitioner id actually
sent); cross-practitioner single-appointment denial; owner/admin positive
paths; and every write route 403 `feature_disabled` for OWNER with flags
explicitly `false` (the deployed posture). Splose write functions in these
tests are the REAL implementations — the flag gate itself is what passes.

**Statement for the record: with current staging/production flags
(`ENABLE_SPLOSE_WRITE=false`, `ENABLE_AUTOMATIC_REMOTE_DELETE=false`), no
Splose write path is reachable by any role through any route.**
