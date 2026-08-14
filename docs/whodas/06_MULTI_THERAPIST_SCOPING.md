# Future work — multi-therapist Splose client scoping

**Status: not implemented. Deliberately out of scope.**

This records a known future integration requirement so it is not rediscovered as
a bug, and so nobody weakens the current security model trying to work around it.

## Current mode — single practitioner / owner test bench

The Splose API connection represents **one** Splose practitioner profile, which
currently corresponds to the Opal Portal **owner** account. The supported
pathway is:

```
Owner → Contacts → Splose client → Client profile → Assessments → WHODAS 2.0
```

That is sufficient to build, test and clinically validate WHODAS.

## Why therapists cannot reach Contacts today

This was verified against the running server, not inferred from the UI:

| Endpoint Contacts requires | therapist | owner |
|---|---|---|
| `GET /api/splose/patients` | 403 | 200 — 55 (whole practice) |
| `GET /api/splose/contacts` | 403 | 200 — 79 |
| `GET /api/splose/invoices` | 403 | 200 — 1,714 |

Two independent reasons:

1. **There is no therapist-scoped client endpoint.** The only practitioner
   scoping in the codebase, `scopeSplosePractitioner()` at
   [routes.js:109](../../backend/routes.js), forces a therapist to their own
   `practitionerId` and fails closed when unmapped — but it is applied to
   **appointments only**, never to patients. A therapist has no narrower client
   query to fall back on.
2. **Contacts is owner-only by decision.** [routes.js:91](../../backend/routes.js)
   records an RBAC hardening dated 2026-08-06: *"whole-practice PII/financial
   areas (Contacts, Activity, Billing, NDIS Cases, Dormant Cases) are
   OWNER-ONLY… Default-deny: adding a new Splose route requires an explicit tier
   choice here."*

Opening Contacts to therapists today would expose the full client directory
**and 1,714 invoices**. Do not do it as a side effect of an assessment feature.

## Future intended model

```
Portal therapist
  → linked Splose practitionerId  (users.tp_splose_practitioner_id)
  → therapist-scoped Splose patients / caseload
  → Client
  → the SAME Assessments system
```

Likely shape, when it is scoped properly:

- A narrow endpoint returning only patients attached to the caller's own
  appointments — derived from `scopeSplosePractitioner`, not a new permission
  layer, and not a relaxation of `/patients`, `/contacts` or `/invoices`.
- A prerequisite: therapist accounts must actually be linked. The dev therapist
  has no `tp_splose_practitioner_id`, and an unlinked account correctly receives
  nothing.
- No change to the owner pathway.

## Why WHODAS will not need rewriting

The assessment engine does not know or care how a client was reached. It takes a
`client_id` and an authenticated user, and records the acting clinician:

- `whodas_assessments.client_id` — the Splose client id (TEXT; there is no local
  `clients` table)
- `whodas_assessments.started_by_user_id` / `completed_by_user_id` /
  `voided_by_user_id` — the real acting user
- `whodas_generated_documents.created_by_user_id`

Nothing assumes `owner_id = clinician_id`, and no assessment belongs to the
Splose connection identity. When therapist client discovery arrives, the same
routes serve it unchanged — only the route that *finds* the client changes.

**Do not** introduce `owner`-shaped assumptions into the assessment layer to
make the current test bench simpler. That is the one change that would make this
future work expensive.
