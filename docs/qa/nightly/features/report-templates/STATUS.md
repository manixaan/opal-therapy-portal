# Report Templates

- Tracker stage: **idea** · Tracker environment: **none**
- Evidence label: **tab-unproven**
- Addressed since last audit (2026-09-17T18:21Z UTC): **partially** — 15 commits reworked FCA document generation; the on-screen wizard is still unproven
- Created (any located code): **yes**

## Located files

- **"FCA"** → `backend/fca-routes.js` + `backend/fca/` (including `fca/templates/fca-v1.docx`, the binary Word master). Rendered client-side as a full-page overlay, `#fca-root` in `mockup_v3.html` (`/fca.js?v=5`).
- **"Progress Letter"** → `backend/letter-routes.js`, reusing the FCA engine/manifest/scalar-resolver against a second template. Overlay `#letter-root` (`/letter.js?v=2`).
- **"Client Agreement Form"** → still not the codebase's name for anything; no literal string exists anywhere in `backend/` or `frontend/current/`. The equivalent remains **"Service Agreement"**, served generically through `backend/templates-routes.js` / `backend/templates/service-agreement-map.js` / `backend/service-agreements/templates/`, driven by `/api/templates/*` (`/templates.js?v=7`).
- **New since last audit:** `backend/templates/appendices.js` — lets an FCA/other template document have PDF or completed-WHODAS appendices attached (commit `5b66e38`). Routes: `GET/POST /api/templates/documents/:id/appendices`, `DELETE .../appendices/:appendixId`, `GET .../appendices/:appendixId.pdf`, all in `templates-routes.js`.

## Guard check

All three route files still mount `router.use('/api/<x>', requireAuth)` plus a per-route clinical/template read-or-write guard (`requireClinicalRead`/`requireClinicalWrite` in `fca-routes.js`/`letter-routes.js`, `requireTemplateRead`/`requireTemplateWrite` in `templates-routes.js`). The four new appendix routes each carry `requireTemplateRead` or `requireTemplateWrite` explicitly — no unguarded route found, including the new surface.

## Tests run

Since last night's audit (`b6a8ad4..HEAD`), ~15 commits reworked FCA/report-template document generation: page-break behaviour (`dc18d66`), a custom Word table style (`3abb5e3`), PDF/WHODAS appendices (`5b66e38`), footer-table geometry (`05b4376`), cover/header/footer/field-update cleanup (`08f7a30`), removing the document-control page and forced breaks (`cb59c4c`), the logo moving into the running header (`c09883c`), Anti-Bribery-and-Corruption-Standard physical sizing (`c4f124b`), WHODAS table styling (`6335aae`), dropping a table column (`af3ce85`), and trimming the FCA master's optional fields (`07ac56e`).

Re-ran everything fresh tonight, targeted only:

- **Unit — 14 files, 563 tests, all passed**: `fca-docx-engine`, `fca-frontend-helpers`, `fca-preview-lifecycle`, `fca-preview-pages`, `fca-resolve-scalars`, `fca-wizard-behaviour`, `letter-docx-engine`, `letter-frontend-helpers`, `letter-template-map`, `templates-appendices` (new tonight), `templates-export-boundary`, `templates-routes`, `templates-service-agreement-map`, `templates-frontend-guards`.
- **Integration — 3 files, 120 tests, all passed**: `fca-reports.itest.js`, `templates.itest.js` (includes the new appendices describe block — RBAC, cross-client isolation, audit logging, real DOCX-body and real PDF-page-count assertions), `progress-note-letters.itest.js`.
  - First combined run of these three files against the shared `DB_NAME=therapy_scheduler_audit` showed 34/120 failing (500s on letter generation, a 401 on login) — this matched the concurrency warning relayed mid-audit (another parallel audit session hitting the same shared database). Re-ran twice more against a session-private database (`therapy_scheduler_qaaudit_fca`) and got a clean **120/120** both times. Treating the failing run as DB contention, not a product regression — it was not reproducible against an isolated database.

### Is the coverage still earned for how much changed?

Genuinely deep in places: `fca-docx-engine.test.js` and `fca-preview-pages.test.js` assert on real unzipped `word/document.xml`/`header6.xml`/`footer6.xml` content — table-of-contents entries, the exact count of `<w:tblStyle w:val="OPAL–Table"/>` per table, `<w:pageBreakBefore>`/`<w:br w:type="page">` counts (0 in the download, 19 in the preview stream), `w:updateFields` absence, and control placement inside header/footer parts. `templates.itest.js`'s new appendices tests check the real DOCX body text, real merged-PDF page counts, and audit-log rows.

But three of the heaviest layout commits shipped with **no test file changes at all** — `git show --stat` for each:
- `05b4376` (footer tables span the same 1in column as the header) — `template-map.js` + the binary `.docx` only.
- `c09883c` (Opal logo moved into the running header band) — same, binary-only.
- `c4f124b` (Anti-Bribery-and-Corruption physical sizing: Arial 11pt body, margins, table column width, header/footer font size) — same, binary-only.

Grepping the whole FCA/letter/templates test surface for the specifics these three commits changed (logo/header image, `9026` dxa column width, `w:pgMar`, footer table width, 9pt header/footer text) finds nothing — the only font-size assertion in the suite is the pre-existing 11pt list-style check from `07ac56e`. `fca-preview-pages.test.js` explicitly renders with `renderHeaders: false` ("headers pull the logo through a Blob URL jsdom has no reader for"), so the logo placement is untestable in the current harness by design. So: "fully tested document-generation engine" is still true for the structural/content changes (breaks, TOC, table style, control placement), but **not** for the three purely-visual/geometry commits — those are asserted by nothing, automated or manual (no browser/E2E entry covers them either).

No TODO/FIXME found in `fca-routes.js`, `letter-routes.js`, `templates-routes.js`, `templates/appendices.js`.

## Disagreement

Tracker stage is idea; the report-generation engine (four document types now, including appendices) is fully built, RBAC-correct, org-isolated, and thoroughly tested at the API/content level for everything except the three pure-geometry commits above. "Client Agreement Form" remains a naming mismatch worth fixing in the tracker so future searches find "Service Agreement" instead.
