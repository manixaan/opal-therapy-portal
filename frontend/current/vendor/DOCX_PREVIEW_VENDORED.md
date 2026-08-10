# Vendored: docx-preview + jszip

Used by the "Preview exact document" action in the FCA report and progress
note letter builders. The builders' default preview renders from the server
manifest (instant, reflects every toggle); this renders the REAL generated
DOCX so the therapist can see the actual Opal letterhead, styles, tables and
section content before downloading.

| File | Version | Licence | Source |
|---|---|---|---|
| `docx-preview.min.js` | 0.4.0 | Apache-2.0 | npm `docx-preview` (dist) |
| `jszip.min.js` | see backend/package.json | MIT | npm `jszip` (dist) — peer dependency of docx-preview |

## Why vendored rather than a CDN

The rendered document contains participant health information. Vendoring keeps
the renderer on our own origin: no third-party CDN request accompanies a
clinical document render, nothing is fetched at page load from outside, and
the app keeps working if a CDN is unreachable. `express.static` already serves
`frontend/current/`, so no server change is needed.

## Fidelity — what this is and is not

docx-preview renders the actual .docx client-side with real styles, fonts,
tables, colours and images. It is NOT a pixel-perfect Word renderer:
pagination, headers/footers and page-number fields are approximated, because
laying those out requires a full document engine.

If pixel-exact output ever matters (for example checking pagination before
sending to the NDIA), the upgrade path is server-side LibreOffice headless
conversion to PDF. That needs a custom container image — Azure App Service
currently runs the plain `NODE|22-lts` runtime with no LibreOffice binary.
Nothing here blocks that change.

Microsoft Graph PDF conversion was considered and rejected for this phase: it
is exact, but it requires uploading the document to OneDrive and a new
`Files.ReadWrite` scope, which puts clinical documents through a file store
and re-prompts every user for consent.

## Updating

```bash
npm --prefix backend install --no-save docx-preview
cp backend/node_modules/docx-preview/dist/docx-preview.min.js frontend/current/vendor/
cp backend/node_modules/jszip/dist/jszip.min.js frontend/current/vendor/
```

Bump the version in the table above when you do.
