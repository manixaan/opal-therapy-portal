# Resource Hub — governance, files and controlled instruments

How the staff-facing Resource Hub decides what may be shown, downloaded,
approved and published, and what a human still has to do.

This describes the **staff-side** hub. There is no participant or carer login in
this application; see [Approval versus publication](#approval-versus-publication).

---

## Staff file access

Files hang off a resource and are delivered by database id only.

**`GET /api/rh2/resources/:id/files`** returns metadata for the files the caller
may actually download — the server filters the list, so the interface never
renders a control that would fail. The projection is fixed and deliberately
omits `storage_key`, `storage_backend` and `file_data`.

**`GET /api/rh2/files/:fileId`** streams the bytes. The browser supplies a UUID
and nothing else: no path, no key, no filename. The endpoint then checks, in
order, organisation membership, the parent resource's publication state, whether
the file is archived, and the effective access tier. Any failure returns an
identical `404 {"error":"Not found"}` — a `403` would confirm that a particular
clinical document exists.

`Content-Type` comes from an allow-list keyed on the record's `format`, never
from the stored `file_mime`, so a poisoned row cannot choose how a browser
interprets the bytes. Responses also carry `X-Content-Type-Options: nosniff`, a
sanitised `Content-Disposition` filename, and `Cache-Control: private, no-store`.

### File access inheritance

A file's `access_tier` is **nullable, and null means inherit**. The effective
tier is always the **more restrictive** of resource and file:

| Resource | File | Effective | Why |
|---|---|---|---|
| `staff` | `null` | `staff` | inherits |
| `staff` | `clinician` | `clinician` | a file may narrow |
| `clinician` | `staff` | `clinician` | a file may **not** widen |
| `excluded-private` | anything | `excluded-private` | quarantine wins |
| anything | unrecognised | `excluded-private` | fails closed |

Forgetting to set a file tier can therefore never widen access. The rule lives
in `resource-governance.js` (`effectiveAccessTier`, `canReadFile`) so routes,
UI and tests share one implementation.

### Governed storage

Resource files live under a dedicated root (`RESOURCE_HUB_STORAGE_PATH`,
defaulting to `backend/.resource-hub-files`), separate from employee documents.
Keys are relative (`opal-originals/<slug>/<slug>-v<version>.<ext>`) and both the
database (`resource_file_storage_key_is_relative`) and the storage layer refuse
absolute paths, traversal, drive letters and symlinks that escape the root.

**The historical `~/Documents/7 Resources` vault is never referenced.** The seed
reads only the directory passed via `--pack`, and refuses any path containing
`7 Resources`, `CLIENTS` or `paediatrics resources` before opening a file.

---

## Source versus publisher versus cited evidence

Three different things that a single column used to conflate:

- **`source_class`** — who *wrote* the work. This is what drives the publisher
  badge, and it is the only field that can produce an "Opal Therapy" badge.
- **`source_publisher`** — the publisher of the work itself.
- **`provenance.evidence`** — sources the work *cites*. Structured, not prose.

The distinction is not academic. Three NDIS explainers were Opal-authored but
carried `source_publisher = "National Disability Insurance Agency"` because that
was the source they cited. To anything reading the column they looked like NDIA
publications. They now record Opal Therapy as publisher with NDIA moved into
`provenance.evidence`, annotated *"No NDIA text is reproduced."*

`provenance.classification` records **how** each classification was reached:

```json
{ "method": "human-verified-content-review" | "inferred-from-authority-level"
           | "human-source-review" | "handoff-pack-declared",
  "confidence": "low" | "medium" | "high",
  "at": "…", "by": "…", "note": "…" }
```

An inference is recorded as an inference. 126 records carry
`inferred-from-authority-level` at medium confidence; three carry
`human-verified-content-review` at high confidence.

---

## Rights-review rules

**Classifying authorship grants no permission to redistribute.** `source_class`
and `rights_status` are independent, are stored independently, and are audited
independently. The source-review endpoint accepts them as separate optional
fields; supplying a source class alone leaves rights untouched and the response
says so explicitly.

*"The logo was removed"* is not a rights status, and there is no code path that
turns one into the other.

`rights_status` values: `unreviewed` (the default and the honest starting
position), `opal-owned`, `licensed-for-portal`, `official-link-only`,
`reference-only`, `restricted`, `unknown`. Anything other than a reviewed,
permissive value blocks approval.

---

## Unresolved-source review workflow

37 resources have `source_class = 'unknown'`. **They are not classified
automatically and must not be.**

`GET /api/rh2/admin/source-review` (owner/admin) lists them with pagination,
search and sort. Each row carries the evidence already on the record — publisher
string, cited source, authority level, recorded provenance — under an explicit
note that this is *evidence only and does not establish authorship or any right
to redistribute*. The API proposes nothing and pre-selects nothing.

`POST /api/rh2/admin/source-review/:id` records a decision. A reason or evidence
note is **required**. Each changed field writes its own `resource_governance_events`
row inside the same transaction as the change, so a decision without a recorded
reviewer is not representable.

Unresolved records remain out of publication readiness: `approvalBlockers()`
refuses any record whose source class is still unknown.

---

## Controlled instrument governance

`controlled_instruments` registers standardised assessments — WHODAS, COPM,
MoCA, RUDAS, Sensory Profile, MOHOST — as **metadata and permitted-use notes
only**.

**No instrument content is stored.** There is no column that can hold a form,
manual, item wording or scoring table. The only file-shaped column is
`source_url`, constrained to `https://`, pointing at the rights holder's own
site.

Defaults are pessimistic by design:

| Field | Default | Meaning |
|---|---|---|
| `rights_status` | `unreviewed` | nobody has checked the licence |
| `clinical_status` | `unreviewed` | nobody has checked currency |
| `access_restriction` | `clinician` | narrowest tier with a real audience |
| `evidence_checked` | `false` | no evidence confirmed |

A register row therefore starts by asserting nothing, which is the correct
starting position for someone else's copyrighted instrument. The API returns
`unresolvedFields` on every row so a blank licence never reads as an approved
one.

**Opal is never the rights holder of a controlled instrument.** Only name and
abbreviation are seeded as facts; edition, rights holder, official URL and
permitted use are left blank for a human, because a plausible-looking guess in a
clinical governance record is worse than an honest blank.

Editing is restricted to owner and admin, every change requires a reason, and
declaring an instrument *clinically current* is owner-only — the same clinical
attestation rule that applies to resources.

### WHODAS module linking

WHODAS is **linked, not duplicated**. The register row carries
`linked_module = 'whodas'` and `linked_module_route = '/api/whodas/instrument'`,
and stores no items, no scoring and no PDFs. The WHODAS module remains the only
implementation; the register points at it.

The only licensing text recorded is a **quotation** of what the WHO manual says
(public domain per §5.1, *subject to registration and no substantive changes*)
together with the fact that `docs/whodas/03_LICENSING_COMPLIANCE.md` has six
outstanding items. That is a description of the situation, not a conclusion
about it, and `rights_status` stays `unreviewed` until a person confirms it.

---

## Clinical filtering behaviour

The Population and Setting filters were previously decorative: the UI sent slugs
the server had never seen, the SQL was correct, and **nothing in the application
ever wrote `clinical_population` or `clinical_setting`**. Every selection matched
zero rows and rendered as "no results".

They are now truthful:

- The vocabulary is **server-owned** (`CLINICAL_POPULATIONS`,
  `CLINICAL_SETTINGS`) and validated. An unrecognised value is ignored rather
  than silently matching nothing.
- **`unclassified` is a real, selectable value** that matches records with an
  empty array — currently every resource. It is listed first.
- `GET /api/rh2/clinical-vocabulary` returns live counts, so the control reads
  "Unclassified (163)" rather than offering options that all return nothing.

**No classification was invented for any existing record.** Populating these
columns for the 163 existing resources is human enrichment work; until then,
`Unclassified` is the accurate answer and the other options correctly return
nothing.

---

## Approval versus publication

These are different claims and the interface keeps them apart.

- **Approved** — the record passed rights, clinical, brand/accessibility and
  provenance gates. Shown only when the server reports `approval_ready`.
- **Published** — visible to an audience beyond staff. Shown only when
  `publication_state === 'published'`.

**Publication is switched off in this release** (`PUBLISH_ENABLED = false`).
The state exists so the lifecycle is complete, but nothing may enter it: this
portal has no participant or carer login, so "published" would name an audience
that cannot authenticate. Approving a resource reports *"Resource approved. It
remains unpublished."*

Legacy `status = 'approved'` grants neither badge. A record can carry it from
before governance existed while failing every gate the word now implies.

The nine concepts the staff interface keeps distinct: Opal authorship,
third-party/official source, rights review, clinical review, brand/accessibility
review, approval, publication, retirement (**inactive/withdrawn — reversible**),
and private quarantine (`excluded-private` — the only genuinely terminal state).

Approval readiness and its blockers are **computed on the server** by the same
`approvalBlockers()` the approve route enforces. The browser holds no copy of the
policy, so it can never claim a readiness the server would refuse.

---

## Adding a future Opal original safely

1. Author it clean-room: write a requirements brief, put the source away, draft
   from generally accepted practice and current official sources. Never de-logo
   somebody else's work — *"logo removed" is not a rights status*.
2. Add it to a handoff pack with a stable `external_ref` id, then seed with
   `node backend/setup/seed-opal-originals.js --pack <dir>`. The seed is
   idempotent on `(organisation_id, external_ref)`.
3. It lands `status=draft`, `publication_state=clinical-review`,
   `access_tier=staff`, `clinical_status=draft`, `brand_review_status=pending`.
   It is not published and cannot be approved in that state.
4. Register the PDF as the primary staff file and the editable DOCX at the
   clinician tier.
5. Walk it through review with `POST /api/rh2/resources/:id/governance-state`,
   supplying a reason at every step. Completing clinical review is owner-only.
6. Approval additionally requires a content owner, a content version, a review
   due date and completed brand/accessibility review.

---

## Outstanding human decisions

Not code. These cannot be resolved by implementation:

- **Clinical review** of the five Opal drafts.
- **Brand and accessibility approval** of the same five.
- **The official Opal logo asset.** The drafts carry a typographic wordmark;
  none was supplied and none was invented, which is why
  `brand_review_status = 'pending'` blocks their approval.
- **Human classification of the 37 unknown-source resources**, via the review
  queue.
- **Confirmation of controlled-instrument licensing** — for all six, and for
  WHODAS specifically the WHO registration checklist.
- **A separately authorised participant-access project**, if resources are ever
  to reach clients or carers.
