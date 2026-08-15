# Resource ingestion register

How the 650-file `7 Resources` catalogue is accounted for inside the portal, and
why almost none of it became a Resource Hub resource.

## The distinction that shapes everything

**Accounted for** and **available** are different claims.

A `resource_ingestion_register` row says a decision was made about a catalogued
file. A `resources` row says staff can use something. 650 files produced 650
register rows and **16 new resources** — six official links and ten clean-room
Opal drafts. That ratio is the correct outcome, not a shortfall: 294 files are
commercial works Opal has no redistribution licence for, 152 have unresolved
rights, and 94 are client-derived.

The register is a separate table on purpose. No ordinary Resource Hub route
queries it, so nothing had to be excluded from a listing predicate — the
isolation is structural.

## Treatments

Every record carries exactly one, and the tally always sums to the catalogue
size. The admin view states plainly when it does not.

| Treatment | Count | What it means |
|---|---:|---|
| `live-vendor-link` | 294 | Vendor reference. No file served, link unverified. |
| `rights-review` | 152 | Metadata only until authorship is evidenced. |
| `privacy-excluded` | 94 | Client-derived. Permanently outside the hub. |
| `controlled-register` | 38 | Mapped to an instrument. No instrument document held. |
| `live-official-link` | 21 | Publisher's own page. 11 verified, 10 unresolved. |
| `opal-original-draft` | 18 | Clean-room replacement backlog. |
| `duplicate-archived` | 18 | Redundant copy; master keeps its own rights. |
| `unavailable-placeholder` | 10 | iCloud stub — the real file was never present. |
| `staff-only` | 5 | Internal material, held pending ownership proof. |

`reconciled-existing`, `rejected-quality` and `superseded` exist in the
vocabulary for later transitions; none applies today.

## Privacy is a schema guarantee, not a convention

The 94 private records contribute **no** filename, path, title or checksum to
the database. This is enforced by a CHECK constraint
(`privacy_excluded_stores_nothing_identifying`, migration 030), so no route,
backfill or hand-typed UPDATE can introduce one. Attempting it — in either
direction, including flipping an ordinary row to `privacy-excluded` while it
still holds a title — raises a constraint violation.

A private row therefore carries its catalogue id and aggregate classification
and nothing else. The admin interface generates the label
`Private record res-0123 — excluded` at render time from the id; there is no
column that could hold the real one.

Two further points worth keeping straight:

- The catalogue redacts only the **first path segment** of private records.
  `source_filename` and `display_title` still hold real, frequently client-named
  values. `redactedIdentity()` is what strips them — nothing downstream may
  assume the catalogue arrived sanitised.
- The audit never hashed private files, so `sha256` is null for all 94. A
  checksum cross-check against existing portal content is therefore impossible
  rather than merely clean, and the report says so.

No private file was opened, hashed, copied or indexed. The ingestion path
contains no file-reading code at all — its only input is the catalogue JSON.

## Reconciliation

Matching runs in this order:

1. **SHA-256** — the only evidence that reconciles automatically.
2. **Normalised title + source organisation** — recorded as `probable`, decides
   nothing.
3. **Normalised title alone** — recorded as `possible`, decides nothing.
4. **Filename** — supporting evidence only; never a match on its own.

Against the live portal this produced **0 checksum matches and 0 title
collisions**. That is a real finding, not a broken matcher (the matcher is unit
tested on all four paths): the 163 pre-existing resources are Opal-authored
guides and policies with no stored file checksums, and the vault is clinical
worksheets. There is no overlap to collapse.

## Running it

Dry run first — always. The apply step aborts if the treatment tally does not
equal the catalogue size, and again inside the transaction if the register does
not hold 650 rows afterwards.

```bash
node backend/setup/ingest-resource-catalogue.js
```

```bash
node backend/setup/ingest-resource-catalogue.js --apply --manifest backend/setup/manifests/ingestion-2026-08-11.json
```

Then apply the treatment matrix, which creates the link resources, expands the
instrument register and records clean-room provenance:

```bash
node backend/setup/apply-resource-treatments.js --apply
```

Both are idempotent on `(organisation_id, catalogue_id)`. A second run reports
`created=0 updated=650 events=0` — it updates in place and emits no duplicate
audit events. Neither script clobbers a decision once `reviewer_user_id` is set.

## Clean-room replacements

The 18 occupational-therapy company documents are replaced, never de-logoed.
**None of the source files was opened** — each purpose statement was written
from the catalogued title and ordinary professional knowledge. That is stricter
than required, and it is the surest way to carry across nothing but purpose.

Ten were drafted. Eight were not, and that is the deliverable for them:

| Risk tier | Count | Outcome |
|---|---:|---|
| `standard` | 10 | Branded DOCX + PDF drafts, staff-only, clinical review pending. |
| `high-clinical` | 7 | Requirements brief and blocker. A clinician must set scope. |
| `legal` | 1 | Service agreement. Legal review required; no draft generated. |

An Opal replacement will not resemble the original and is not a substitute for
it. It is a new document addressing the same clinical need.

## Quality gate

`resource-file-quality.js` judges bytes, not filenames: magic-number format
check, extension agreement, SHA-256, size, password/corruption detection, page
count, per-page content-stream parse, blank-page detection, text-layer presence
and a client-identifier scan (counts only — never the matched value).

**What it cannot do.** `getOperatorList()` proves a page *can* render; it does
not rasterise, so it cannot see clipping, contrast or whether a writing box is
big enough. Every report carries `visualReviewRequired: true`.

This is not theoretical. The first build of the clean-room documents passed
every structural check while silently truncating table cells mid-word — a
support worker would have read "where swallowing is unsafe — s". Visual
inspection caught it; the gate could not. A content-fidelity check now compares
every spec string against the extracted PDF text, so that class of defect fails
the build.

## Accessibility, stated honestly

- **DOCX** — real heading styles, `w:tblHeader` on table header rows, alt text
  on the logo, `en-AU` language. This is the accessible master.
- **PDF** — text layer, metadata and a reading order matching visual order, but
  **no tag tree**. `pdf-lib` cannot emit PDF/UA. Recorded as
  `text-layer-present-tagging-unverified`, never as compliance.

## Launch position

Live for staff: six verified official/nonprofit link resources.

Staged or held: the five v0.2 Opal originals, the ten clean-room drafts, 152
rights-review records, 304 unverified links, 94 private records, 18 duplicates,
10 placeholders, and every controlled-instrument document. No participant or
public access exists or was created.
