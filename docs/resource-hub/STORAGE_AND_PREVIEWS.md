# Resource Hub — storage, previews and the document lifecycle

*Updated 2026-08-15, after the content-evidence audit and document-library
upgrade.*

## Where exactly are the documents stored?

**Approved hosted resources live in the Resource Hub's managed store. The
source folder is only used during ingestion.** Some source items are
intentionally *not* copied into hosted storage because they are private,
copyright-restricted, external-link-only, duplicates, placeholders or
otherwise unsuitable for hosting — the ingestion register records which and
why, per file.

Concretely:

| What | Where | Notes |
|---|---|---|
| Source vault | `~/Documents/7 Resources/` | Read-only reference. Never served, never required at runtime. The portal must keep working if it is detached. |
| Managed store (dev) | `~/Documents/Opal-Resource-Store/` | Set by `RESOURCE_HUB_STORAGE_PATH` (see `.claude/launch.json`). Content-addressed originals under `resources/<hh>/<sha256>.<ext>`, seeded Opal documents under `opal-originals/` and `opal-cleanroom/`, generated previews under `derivatives/<hh>/<sha256>-<kind>.<ext>`. |
| Managed store (production) | Azure Blob Storage | `RESOURCE_HUB_STORAGE_BACKEND=blob` + `AZURE_STORAGE_CONNECTION_STRING` + `RESOURCE_HUB_STORAGE_CONTAINER` (default `resource-hub`, deliberately separate from employee documents). Same relative keys, so rows migrate without rewriting. |
| Metadata | Postgres | `resources`, `resource_files`, `resource_file_derivatives`, `resource_ingestion_register` + events tables. |

The abstraction is `backend/resource-file-storage.js`: routes call the async
`getBuffer`/`putBuffer`/`removeBlob` API and never touch a filesystem path.
Keys are relative-only, traversal-checked, and re-checked after following
symlinks. Neither backend exposes a public URL — every byte is served by the
authenticated `/api/rh2` routes.

## Why the counts differ (the reconciliation)

`node backend/scripts/audit-resource-storage.js` prints the live walk. As of
this audit the 650 register rows resolve as:

- **95 privacy-excluded** — client-derived; identity fields are NULL by schema
  CHECK, nothing hosted, permanently outside the hub (94 from the original
  file-level review + 1 found by the 2026-08-15 content audit inside an
  otherwise-clean folder).
- **18 duplicate-archived** — byte-identical copies; the master row carries
  the document.
- **10 unavailable-placeholder** — iCloud stubs; no real bytes ever existed.
- **1 rejected-quality** — an Office lock file that had been hosted as if it
  were a document; removed.
- **38 controlled-register** — standardised instruments. Metadata lives in
  `controlled_instruments` (the Assessments view); hosted copies were
  withdrawn because the recorded rights decision holds no instrument document.
- **152 rights-review** — hosted bytes kept for the admin review queue only
  (publication_state `rights-review`, access tier `admin`); therapists cannot
  reach them by browse, search, direct id, download, preview or thumbnail.
  One of the 152 (an oversized file) was never imported.
- **336 hosted for staff** — vendor/official/staff-only/opal-draft items, per
  the practice owner's recorded decision (commit 14a55c0) that catalogued
  documents are hosted and organised, with provenance badges kept honest:
  `publication_state` stays `inventory`, attribution never claims Opal
  authorship, `copyright_status` travels unchanged.

Resources not from the register (~180) are R1-era guides, official links
created by treatment application, and clean-room Opal originals.

## Privacy: how exclusion works and why it recurs less now

1. **Decision layer** (`resource-ingestion.js`) — vault path prefixes,
   privacy classes and portal actions; any one signal excludes. The content
   scanner's vocabulary (`client-confidential`, `privacy-review`) now counts.
2. **Content evidence** (`resource-privacy-scan.js`) — one shared detector
   used by the upload route and the file quality gate. A *label with a filled
   value* (`Client Name: <a name>`, a populated DOB, an NDIS/Medicare-shaped
   number) is a strong signal; `Client Name: ____` is not. Findings carry
   pattern names and counts only, never matched text. Anything except
   `no-obvious-pii` refuses to publish without a human.
3. **Quarantine** is terminal and total: `publication_state` and
   `access_tier` both `excluded-private`, title scrubbed, register row
   privacy-excluded (schema CHECK nulls every identifying field, which also
   makes re-import impossible), bytes and derivatives deleted
   reference-aware. Every read surface carries the excluded-private
   predicate; delivery refuses with the same 404 everyone else gets.

Scanned (image-only) documents have no text to scan — that class was cleared
by page-render review in the 2026-08-15 audit, and new uploads of that class
arrive only through the gated upload route.

## Previews

`backend/resource-preview-service.js` owns original → derivative:

| Format | Thumbnail | In-browser preview | Renderer |
|---|---|---|---|
| PDF | first page PNG | full document, pdf.js canvas | poppler `pdftoppm` / vendored pdf.js |
| DOCX | first page PNG | full document, docx-preview | QuickLook / vendored docx-preview |
| DOC | first page PNG | converted `preview-docx` derivative | QuickLook + `textutil` |
| PPTX / PPT / XLSX | first slide/page PNG | fallback panel (download) | QuickLook |
| ZIP | — | fallback panel | — |

Derivatives are cached rows in `resource_file_derivatives` (unique per
file+kind, stamped with the source checksum and renderer version, so
regeneration is idempotent) with blobs under `derivatives/`. Renderers are
feature-detected; a host without them reports `renderer-unavailable` and the
UI falls back to a type card — previews are never load-bearing. Generation
refuses excluded/retired/archived parents, and quarantine cleanup deletes
derivative rows and blobs with the original.

- Regenerate one file: the **Rebuild preview** action in the detail view, or
  `POST /api/rh2/files/:fileId/regenerate-preview` (owner/admin).
- Regenerate in bulk: `node backend/scripts/generate-resource-previews.js`
  (re-runs only what is missing or stale).
- Delivery: `/api/rh2/files/:id` (download), `/:id/preview` (inline),
  `/:id/thumbnail` — all three climb one decision ladder (org, governance
  state, visibility, effective tier; every refusal a uniform 404), audited
  separately so previews don't inflate download analytics.

The in-browser viewer is `frontend/current/docpreview.js` — the shared,
static-file counterpart of the FCA report preview, using the same vendored
on-origin renderers (no document ever touches a CDN).

## Adding a resource

Admin → Resource Hub → Admin → New resource → save the draft → attach the
document in the **Document file** control. The server runs the full gate
(allow-list → size → magic bytes → privacy scan → dedupe → store →
derivatives); a file that names a client is refused with a counts-only audit
trail. External resources: set the Source URL instead — the card becomes a
signpost to the publisher's site.

Approval is the owner's attestation: one click walks the record through the
review states with an audited event per hop, and `approvalBlockers` still
refuses unclassified or rights-restricted third-party material.

## Troubleshooting

- **Card has no thumbnail** — check `resource_file_derivatives` for the file;
  run the rebuild action or the batch script; on a host without
  poppler/QuickLook the type-card fallback is the designed behaviour.
- **Preview button missing** — only `pdf`, `docx` and converted `doc`
  preview; other formats intentionally offer download only.
- **404 on a file that "exists"** — the uniform 404 is any refusal: wrong
  org, quarantined/retired parent, tier above the caller's role, archived,
  or missing bytes. Check `publication_state`, `access_tier` (resource AND
  file) and `archived_at` before suspecting storage.
- **Store consistency** — `node backend/scripts/audit-resource-storage.js`
  verifies every DB reference resolves to a blob and every blob is
  referenced, and exits non-zero otherwise.
