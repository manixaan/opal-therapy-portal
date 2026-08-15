# WHODAS 2.0 IMPLEMENTATION REPORT

Date: 2026-08-10 · Branch `main` · Feature flag `ENABLE_WHODAS_ASSESSMENT` (off by default everywhere)

---

## 1. Architecture

A PDF-template + electronic-overlay implementation, in five separable parts:

```
WHO SOURCE PDF  +  FIELD POSITION MAP  +  RESPONSE DATA  +  SCORING ENGINE  →  DIGITAL ASSESSMENT
 (immutable,        (derived from the     (semantic,        (isolated, pure,
  hash-pinned)       PDF, hash-pinned)     server-owned)     three methods)
```

| Component | Where |
|---|---|
| Template extraction (provenance script) | [extract-templates.js](backend/whodas/extract-templates.js) |
| Immutable WHO templates + manifest | `backend/whodas/templates/` |
| Field-map + item-text derivation | [build-instrument-data.js](backend/whodas/build-instrument-data.js) |
| Field maps (committed, hash-pinned) | `backend/whodas/field-maps/` |
| Template registry / integrity | [template-registry.js](backend/whodas/template-registry.js) |
| Item registry (domains, recodes) | [instrument.js](backend/whodas/instrument.js) |
| Scoring engine | [scoring.js](backend/whodas/scoring.js) |
| Completed-PDF generation | [completed-pdf.js](backend/whodas/completed-pdf.js) |
| API | [whodas-routes.js](backend/whodas-routes.js) |
| Migration | [021_whodas_assessments.sql](backend/migrations/021_whodas_assessments.sql) |
| Frontend | [whodas.js](frontend/current/whodas.js), [whodas.css](frontend/current/whodas.css) |

**Reused, not rebuilt:** `requireAuth` and the existing role model; `organisation_id` isolation with 404-on-cross-org; the Splose `client_id TEXT` keying used by `fca_report_drafts`; `backend/storage/index.js`; `logAuditEvent` / `audit_logs`; the migration runner and its style; `safe()`, error shapes and module loggers; the Jest unit/integration split; the `ENABLE_*` flag module.

**Added, with justification:** `pdf-lib` (server-side PDF read/write — the repo had no PDF capability at all); `pdfjs-dist` vendored as a static asset under `frontend/current/vendor/pdfjs/` (no bundler exists); an optimistic-concurrency `version` column (no such convention existed).

Full audit: [01_REPO_AUDIT.md](docs/whodas/01_REPO_AUDIT.md).

---

## 2. WHO source integrity

Source: *Measuring Health and Disability: Manual for WHO Disability Assessment Schedule (WHODAS 2.0)*, WHO 2010, ISBN 978 92 4 154759 8 — SHA-256 `a78fcb2503c726c84be7e74361aa225d0e2a34de7ecd4cbecac4e4d1ec22da6d`, 152 pages.

The three instruments were **not supplied as standalone files**; they exist only as page ranges inside that manual. They were extracted with `pdf-lib copyPages`, which lifts page dictionaries, content streams, fonts and boxes verbatim — nothing is rasterised, re-typeset or re-encoded.

| Template | Source pages | Pages | SHA-256 |
|---|---|---|---|
| `whodas-36-interviewer` | 99–108 | 10 | `30c0f853dc1226477c7bf3fad9d72f2d9bb6e2b7c0f7f38bcebb7b4092250582` |
| `whodas-36-self` | 113–116 | 4 | `6d17d34b62db3e7a9c27c92117b0eb769a8aa6e81313a436079b56f64878ba9f` |
| `whodas-36-proxy` | 117–121 | 5 | `59fe6c9550075e50f491fe294c21e3607f6cb2b5465d2ddb6799851e3e97e34b` |
| `whodas-36-flashcards` | 109, 111 | 2 | `ff5325f7092837cdef9c2b8a16788dba06a14bf27f4abdbbcef5d6d48e9d52f4` |

All pages carry MediaBox `[0 0 567 780]` and CropBox `[41.76 41.76 523.8 735.0]` (482.04 × 693.24 pt). The CropBox trims the printer's registration marks and running head, so the viewer shows a clean page; overlay coordinates are stored in PDF user space and transformed through the pdf.js viewport.

Integrity is enforced in four places: extraction refuses a source whose hash differs; `readTemplateBytes()` re-hashes on **every** read; the server verifies all templates and field maps at boot and disables the feature rather than serving a modified instrument; and a database trigger freezes a `whodas_templates` row once an assessment has been rendered from it.

Also committed: the two WHO scoring workbooks under `backend/whodas/reference/`, used as the golden-test oracle.

---

## 3. Administration methods

| Method | Template | Status |
|---|---|---|
| Interviewer-administered | 10-page official form + flashcards #1/#2 | Implemented |
| Self-administered | 4-page official form | Implemented |
| Proxy-administered | 5-page official form, including H4 respondent relationship (8 printed codes) | Implemented |

All three carry the same 36 scored items `D1.1–D6.8`. Item wording is **derived per form from its own PDF**, not transcribed — which is how the genuine wording differences are preserved (proxy is third-person throughout; the interviewer form prints *"did you have joining in community activities"* where self prints *"did you have in joining"*).

Method-specific non-scored fields are all mapped: interviewer face sheet (F1–F5, A1–A5), conditional day counts (D5.01, D5.02), the two Yes/No items (D5.9, D5.10, coded 1=No / 2=Yes and never fed through the difficulty recode), H1–H3 on all three forms, and proxy H4.

---

## 4. Electronic completion

**Viewer** — the official PDF is rendered by pdf.js at the page's own aspect ratio, with transparent radio controls positioned over the printed response cells. Nothing about the document is redrawn. Selecting a response draws a ring around the printed option, which is the mark the form itself asks for (*"circle only one response"*). On a narrow screen the document scrolls rather than reflowing.

**Accessibility** — every control is a real `<input type="radio">` with an `aria-label` carrying the WHO item verbatim plus the printed response category; visible focus rings; the save indicator is an `aria-live` region; no state is signalled by colour alone (selection is a ring, missing items add a dashed outline, status chips print their own word); completion gaps are buttons that focus the offending item.

**Autosave** — 700 ms debounce, field-level merge, save states *Saving… / Saved / Save failed*, exponential retry up to four attempts with the pending edits put back on failure, `beforeunload` flush, and an explicit **Save & Exit**. A stale write returns `409 stale_version` and the client stops saving and requires a reload rather than overwriting newer clinical responses. A partial unique index makes a duplicate in-progress assessment for the same client and method impossible.

**Work/school declaration** — captured as portal chrome outside the document area, because the form's own skip instruction depends on it. It is never inferred; completion is refused until it is answered. Declaring "does not work or study" clears any work-block answers so a stale response can never reach the engine.

---

## 5. Scoring

Three methods, implemented in one isolated, deterministic, side-effect-free module. Each result carries its own `label`, `sourceMethodology`, `scoringVersion` and `calculatedAt`; all three are stored on every completed assessment; none is ever presented as "the" WHODAS score.

| Key | Label | Source | Formula |
|---|---|---|---|
| `irt` **(default)** | WHODAS 2.0 Complex Score (IRT) | Manual Chapter 8 SPSS syntax | Per-item recode (flat 0–4 / collapsed 0,1,1,2,2), domain sums × 100 / {20,16,10,12,10,14,24}, overall × 100 / **106** (36-item) or **92** (32-item) |
| `simple_sum` | WHO Simple Sum Score | Simple-scoring workbook | `SUM(36 items, 0–4) / 144` |
| `domain_mean` | WHO Domain Mean Score | 36-item scoring workbook | Six raw domain proportions (/24, /20, /16, /20, /32, /32), then their unweighted mean |

Key behaviours:

- **The workbook named "complex-scoring" is not WHO's complex method.** It applies no item weighting and no category collapsing. It is implemented faithfully and labelled `domain_mean` so it can never be mistaken for the IRT score.
- **Only IRT has a 32-item pathway.** Both workbooks divide by fixed denominators, so for a respondent who skipped D5.5–D5.8 they return `scorable: false` with a stated reason rather than an invented denominator.
- **Life activities is reported as Chapter 8 defines it** — `Do51` (household) and `Do52` (work/school) separately. No combined Domain 5 value is invented for IRT.
- **Missing data** follows manual §6.5: ≤2 missing items are imputed from their own domain mean; 3+ is refused; two missing in one domain makes that domain unreportable (and makes `domain_mean` unscorable, since its overall *is* the domain mean).
- **No severity labels.** No supplied source defines score-to-severity cut-points, so none are produced — asserted by tests on both the engine output and the frontend.
- Every score carries an unrounded `exact` alongside the 2 dp display `value`, so longitudinal comparison is not limited by presentation rounding.

The recode table is validated at module load: all nine Chapter 8 denominators must equal the sum of that group's per-item maxima, or the module refuses to load.

---

## 6. WHO validation

Three independent references, none of which is the engine:

1. **The WHO workbooks themselves.** `tests/helpers/whodas-workbook-oracle.js` opens the two `.xlsx` files, verifies their hashes, reads the item→cell mapping out of column A, writes responses into the score column and evaluates the workbooks' **own formula strings** (`SUM(C9:C49)/144`, `(SUM(C9:C14)/24)`, `SUM(C15+C22+C28+C35+C45+C55)/6`, …). Nothing is reimplemented, so a transcription error in the engine cannot be mirrored in the oracle.
2. **A literal transcription of Chapter 8**, written the awkward way — SPSS variable names, the 1–5 recode tables as printed, the domain formulas verbatim — while the engine works in 0–4 space where `flat` is the identity. Two different formulations that must agree on every input.
3. **Hand-computed boundary fixtures.**

Comparison results — **all agree to within 1e-10** (compared on unrounded values; display values compared at the workbooks' own 2 dp):

| Method | Cases | Compared | Result |
|---|---|---|---|
| `simple_sum` vs simple workbook | 45 (all-none, all-mild, all-moderate, all-severe, all-extreme, 40 seeded pseudo-random) | overall | **pass** |
| `domain_mean` vs 36-item workbook | 43 + 6 domain-isolation cases | overall **and all six domain values** | **pass** |
| `irt` vs Chapter 8 transcription | 65 × both pathways = 130 | overall, all six domains, both Domain-5 sub-scores, both denominators | **pass** |

Boundaries land exactly: all-none → 0.00, all-extreme → 100.00 on every method and both pathways. Category collapsing is verified behaviourally (mild and moderate coincide on collapsed items, diverge on flat items). The 32-item pathway is verified not to under-report relative to scoring skipped items as "None".

---

## 7. PDF

**Blank forms** — streamed byte-identical from the immutable template (verified by hash in the integration tests). No Opal header, footer, logo or rescaling. Download and print are offered per administration method, plus the interviewer flashcards.

**Completed forms** — generated by loading a fresh copy of the hash-checked template and drawing only what a person completing the paper form would have written: a ring around each chosen response, ring around each coded option, and write-in text on the printed rules. Skipped work items are left blank, exactly as on paper. No metadata of ours is written (title, author and subject are all absent) and the string "Opal Therapy" does not appear in the bytes.

Verified by test: generated documents open; page count and **all page dimensions including CropBox** match the source exactly; the completed document is distinct from the blank; the canonical template is byte-identical after generation; generation is deterministic; a stale field map is refused rather than used to place marks; an unrecognised response is reported, never silently dropped.

**Visual QA** was performed page-by-page against the WHO originals for all three forms. Rings land centred on the printed options; the two-line "Extreme or cannot do" cell is enclosed in full (an early version clipped the second line and was fixed); face-sheet write-ins sit on the printed rules; the skipped work block renders completely blank. No shifted questions, clipped text, overlay drift, changed pagination or hidden WHO text.

---

## 8. Database

Migration **`021_whodas_assessments.sql`** — additive only, no existing table altered.

- `whodas_templates` — key, version, method, storage path, SHA-256, page count, media/crop box, source provenance, active flag. Immutability trigger freezes content once an assessment references it (deactivation still allowed).
- `whodas_assessments` — organisation + Splose `client_id`, administration method, pinned template id/version/hash, status (`draft|completed|voided|amended`), `work_school_applicable`, `responses` (semantic values), `form_data`, `scores` (all three methods), scoring version, `version` for optimistic concurrency, started/completed/voided actors and timestamps, amendment links. Partial unique index prevents duplicate in-progress records. Trigger freezes clinical content once completed and refuses a version going backwards.
- `whodas_generated_documents` — storage backend/key/bytes, filename, size, checksum, template key/version/hash, page count.

> **Note on numbering:** this was authored as `019` but renumbered to `021` after a concurrent session's work claimed `019`/`020`. `019` is now an intentional gap in the sequence.

---

## 9. Security / RBAC

- **Licensing gate first:** every `/api/whodas/*` route returns **404** unless `ENABLE_WHODAS_ASSESSMENT === 'true'` — mounted ahead of auth, so a disabled deployment exposes no surface and does not advertise the feature as forbidden.
- `therapist` / `owner` — full clinical access within their organisation. `read_only` — instrument and blank forms only. **`admin` — no access at all**, matching the FCA policy (admin is a non-clinical scheduling role in this portal).
- Organisation isolation on every query; cross-org access returns **404, not 403**.
- Drafts in progress are own-only, even for owners; **completed** assessments are organisation-visible, since they are filed clinical records.
- All SQL is parameterised. Assessment ids are UUID-validated before use. Documents are served only through an authenticated, ownership-checked route — never a public URL or static asset. `Cache-Control: no-store` on completed documents, `private` on blank forms. No client identity in filenames or query strings.
- Server-side authoritative scoring — the browser never sends or computes a score.

Negative tests run and passing: unauthenticated access; admin blocked; read_only blocked from writes; no-organisation blocked; cross-org read/patch/download; cross-client listing; another clinician's draft; malformed / unknown / traversal-style ids.

---

## 10. Tests

| Suite | Tests | Result |
|---|---|---|
| `whodas-scoring.test.js` (golden + engine) | 260 | pass |
| `whodas-templates.test.js` (integrity, field maps, PDF) | 37 | pass |
| `whodas-frontend-guards.test.js` | 34 | pass |
| `integration/whodas.itest.js` | 53 | pass |
| **WHODAS total** | **384** | **pass** |
| Full unit suite (50 files) | 1653 | 1650 pass / 3 fail |
| Full integration suite (30 files) | 411 | pass |

The **3 unit failures are not from this work**: they are in `fca-resolve-scalars.test.js` and `letter-template-map.test.js`, both belonging to a concurrent session's in-flight FCA/letters changes (`backend/fca/*`), which this feature does not touch. Immediately before that session's latest commits landed, the full unit suite was green at 1653/1653 with WHODAS included.

Also added: coverage for the new feature flag in `feature-flags.test.js`, and `migrate.itest.js`'s migration-id assertion now derives from the migrations directory (it had already drifted out of step with the files it described after the concurrent renumbering).

---

## 11. Deployment

**Local only. Not deployed to staging.**

Verified locally: migration applies cleanly (`021` applied, full suite re-runs green); server boots with `ENABLE_WHODAS_ASSESSMENT=true`, logs `whodas templates synced {registered: 4, inserted: 4}`, `/health` returns 200 and `/api/whodas/instrument` correctly returns 401 unauthenticated.

Staging deployment has **not** been performed, for two reasons: the standing workflow for this project is to QA at localhost and push to Azure only on your explicit go-ahead; and the working tree is currently shared with an active concurrent session whose changes are interleaved with mine in `server.js`, `package.json` and the FCA module. Nothing has been committed from this session for the same reason — see §13.

---

## 12. Compliance

Manual §5.1 states WHO *"is granting free access and use of WHODAS 2.0, and has therefore placed the instrument in the public domain"*, conditional on completing a registration form on the WHODAS 2.0 web site, and that users *"have no authority to make substantive changes to the assessment instrument"*. The manual as a publication remains © WHO 2010, all rights reserved.

No WHO registration or permission is recorded in this repository. Production release therefore remains gated. The full checklist is in [03_LICENSING_COMPLIANCE.md](docs/whodas/03_LICENSING_COMPLIANCE.md) and includes: completing WHO registration and recording it; reviewing current WHO terms against the live WHO pages (not the 2010 manual alone); confirming that electronic reproduction for **clinical** rather than research use is in scope; recording template provenance; attaching visual-QA sign-off; and obtaining written WHO permission if Opal Therapy's own legal review concludes registration alone is insufficient.

This report makes no legal determination.

---

## 13. Remaining issues

1. **Nothing is committed.** A concurrent session is actively editing and committing shared files in this working tree (`backend/server.js`, `backend/package.json`, `backend/fca/*`, `backend/ai/*`, and it has already swept my `mockup_v3.html` edits and the `pdf-lib` dependency into its own commits). Committing from here would entangle its half-finished work. Say the word and I will stage only the WHODAS paths.
2. **Domain-5 SPSS mapping (Q2)** — you approved proceeding on the arithmetically-forced mapping. It is isolated in one annotated constant with a dedicated test, but it is stated nowhere in the supplied documents. WHO's downloadable `.sps` file would close it definitively; recommended before clinical sign-off.
3. **Imputation space (Q4)** — manual §6.5 does not say whether the domain mean is taken over raw or recoded values for IRT. Recoded space is implemented (the only well-defined option, since the collapsed recode is an integer lookup). Documented in [04_OPEN_QUESTIONS.md](docs/whodas/04_OPEN_QUESTIONS.md); worth a clinician's confirmation.
4. **Templates are page extracts, not WHO's standalone form PDFs** — byte-faithful and provenance-traced, but if official standalone PDFs are obtained under licence they should supersede these as a new registry version (no rework required).
5. **Browser end-to-end run: done.** Verified on a local server against a real Splose client — the Assessments section renders inside the client profile, the method chooser opens, the official WHO PDF renders at exactly the CropBox size (723.06 × 1039.86 CSS px = 482.04 × 693.24 pt × 1.5), all 180 response controls (36 × 5) are present with WHO item text as their `aria-label`, responses ring the printed option on the document, and autosave reports "Saved" with the version incrementing server-side. Two defects were found and fixed during this run — see §15.
6. **Assessment library entry point: done.** Mounted as an **Assessments** section inside the client profile panel (`openClientProfile`), between Provider travel and Book appointment. It self-hides when no assessment module is enabled, so the panel is unchanged for deployments without the flag.
7. **Longitudinal comparison** was deliberately not built (the brief allowed deferring it). Domain and overall scores are stored per assessment with method and version, so it is straightforward later.
8. **`H1–H3`, `D5.9`, `D5.10`, `D5.01`, `D5.02`** are captured and rendered into the completed PDF but not scored — no supplied WHO source scores them.

---

## 14. Classification

> ### READY FOR LOCAL TESTING

Justification for not classifying higher: the scoring engine, template integrity, PDF generation, RBAC, concurrency and audit trail are covered by 384 passing tests including golden validation against WHO's own workbook formulas; the documents have been visually verified page by page; and the assembled feature has now been driven end-to-end in a browser inside the real portal against a live client record. What remains between here and *READY FOR CONTROLLED STAGING CLINICAL TESTING* is entirely delivery: **nothing has been committed**, and it has **not** been deployed to staging or smoke-tested there. A full assessment has also not yet been carried through completion → scoring → completed-PDF in the browser (only at the API and engine level, where it is covered by integration tests).

Production use additionally remains blocked on the WHO licensing checklist in §12, independent of technical readiness.

---

## 15. Defects found during browser verification

Both found by driving the real UI, neither caught by the test suite:

1. **`undefined undefined` written as the client name.** The profile panel's patient lookup can return a partial cache entry with undefined name fields; template-stringing those produced the literal text `"undefined undefined"`, which was denormalised onto the assessment row and shown in the viewer toolbar. A clinical record filed under a fabricated name is not acceptable, so `clientDisplayName()` now returns `null` unless a real name is present and the server falls back to the client id. Verified: the row now stores `null`.
2. **CORS blocked every write on the QA port.** `ALLOWED_ORIGINS` is unset, so it defaults to `localhost:5001` only — meaning the repository's own `opal-backend-qa-5002` launch configuration could not POST anything. Pre-existing and not WHODAS-specific, but it made the QA config unusable; `ALLOWED_ORIGINS` is now set in `.env` to cover both ports.

Also noted (not a defect): pdf.js page rendering stalls while the browser tab is backgrounded, because it drives rendering from `requestAnimationFrame`. Only affects headless verification, not a clinician with the tab open.
