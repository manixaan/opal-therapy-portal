# Vendored dependency: pdf.js

 and  copied verbatim from pdfjs-dist@4.10.38.

This repository has no bundler and no build step (see docs/whodas/01_REPO_AUDIT.md §1),
so the renderer is vendored as a static asset rather than imported from npm.
It is used only by the WHODAS 2.0 assessment viewer, to render the immutable
WHO source PDFs in the browser so interactive controls can be positioned over
the real document instead of a re-typeset copy of it.

Licence: Apache-2.0 (Mozilla Foundation).

To update: bump pdfjs-dist in backend/package.json, re-copy both files, and
update the version above.
