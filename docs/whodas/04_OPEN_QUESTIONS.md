# WHODAS 2.0 — Open Questions Blocking Implementation

Raised: 2026-08-10, after Phase 0 (repo audit) and the WHO source-document audit.

Under the brief's NO-GUESSING RULE these are documented rather than silently
resolved. Q1 blocks the scoring engine and the results UI. Q2 blocks one branch
of Q1. Q3 blocks the template registry. Everything else in the build is
unblocked.

---

## Q1 — Which scheme is "the WHO reference calculation"? **BLOCKING**

The supplied sources define three incompatible schemes (full detail in
`02_WHO_SOURCE_AUDIT.md` §5).

| | Coding | Domain scores | Overall | Handles work/school skip |
|---|---|---|---|---|
| **A. Workbook — simple** | 0–4 | none | `Σ36 items / 144`, shown `0.00%` | no |
| **B. Workbook — "complex"** | 0–4 raw, **no IRT recode** | six raw proportions (/24, /20, /16, /20, /32, /32) | unweighted mean of the six | no |
| **C. Manual Ch.8 SPSS — true IRT** | 1–5 in, recoded to 0–4 or 0–2 per item | `Σrecoded × 100 / domain max` | `× 100 / 106` (36-item) or `× 100 / 92` (32-item) | **yes** |

Key points:

- **The workbook labelled "complex-scoring" is not WHO's complex method.** It
  applies no item weighting and no category collapsing. It disagrees with
  Chapter 8 on every input except all-none and all-extreme.
- **Only C handles the work/school skip.** Under A or B, a respondent correctly
  instructed to skip D5.5–D5.8 is scored as if they answered "None" to all
  four, which artificially lowers their Life activities and overall score.
  This is a clinical-safety issue, not a preference.
- **Only C produces the "XX / 100" the brief's UI mock shows** as a
  WHO-defined 0–100 metric. A and B produce percentages of a raw maximum.
- The brief says golden fixtures come from the workbooks; the workbooks can
  only validate A and B. C's reference is the Chapter 8 syntax itself, which
  this audit verified is fully arithmetically self-consistent (all seven
  denominators and both summary denominators reconcile exactly).

**Recommendation: implement all three, explicitly labelled, with C as the
default.** They are cheap once the response data model exists, and each is
defensible against a different supplied source. The results view names the
method in use; nothing is presented as "the" WHODAS score without saying which.
Suggested labels:

- `simple_sum` — "Simple scoring (WHO simple-scoring workbook)"
- `domain_mean` — "Domain-mean scoring (WHO 36-item scoring workbook)"
- `irt` — "Complex / IRT scoring (WHODAS 2.0 manual, Chapter 8)" ← default

**Decision needed:** all three, or a subset?

---

## Q2 — Confirm the Domain-5 item mapping for IRT scoring
*(only applies if Q1 includes scheme C)*

Chapter 8's SPSS variable names for Domain 5 do not match the printed item
numbers on any form. Every other domain matches one-to-one.

| Printed on all three forms | Chapter 8 SPSS |
|---|---|
| D5.1–D5.4 (household) | `d52 d53 d54 d55` |
| D5.5–D5.8 (work/school) | `d58 d59 d510 d511` |

`d5_1`, `d5_6`, `d5_7` are recoded nowhere and used in no formula.

The only ordering that preserves the verified `/10` and `/14` denominators is a
straight offset:

| Printed | SPSS | Recode | Max |
|---|---|---|---|
| D5.1 | d5_2 | collapsed | 2 |
| D5.2 | d5_3 | collapsed | 2 |
| D5.3 | d5_4 | flat | 4 |
| D5.4 | d5_5 | collapsed | 2 |
| D5.5 | d5_8 | collapsed | 2 |
| D5.6 | d5_9 | flat | 4 |
| D5.7 | d5_10 | flat | 4 |
| D5.8 | d5_11 | flat | 4 |

It is arithmetically forced but **stated nowhere in the supplied documents**.

**Safest non-destructive behaviour if unresolved:** implement the mapping
above (no alternative is arithmetically possible), isolate it in a single
annotated constant, cover it with a dedicated test, and surface it in the
final report as an assumption for clinical sign-off. Confirmation against WHO's
downloadable SPSS `.sps` file — which carries the variable labels this manual
extract omits — would close it definitively.

**Decision needed:** proceed on the forced mapping, or obtain WHO's SPSS file
first?

---

## Q3 — Provenance of the immutable template PDFs

The brief's architecture requires an immutable source PDF per administration
method. **No such files were supplied.** The three instruments exist only as
page ranges inside the 152-page manual.

| Option | Detail |
|---|---|
| **A. Extract pages from the hashed manual** *(recommended)* | Copy pages 99–108 / 113–116 / 117–121 (plus flashcards 109, 111) into three standalone PDFs using `pdf-lib` page-copy, which preserves content streams, fonts and boxes without re-rendering. Reproducible, scriptable, provenance-traceable to the manual's SHA-256. CropBox already trims the printer's marks, so extracted pages present clean. |
| **B. Obtain WHO's separately published form PDFs** | Cleanest provenance, but they were not supplied and would need to be downloaded from the WHO site — which is also where the §5.1 registration step lives. |

Option A can be adopted now and superseded later without rework: the template
registry is versioned and hash-keyed, so replacing an extracted template with an
official standalone PDF is a new registry row, not a migration.

**Decision needed:** extract now (A), or wait for official standalone PDFs (B)?

---

## Q4 — Which space the §6.5 imputation mean is taken in *(interpretation made)*

Manual §6.5 says a missing item takes *"the mean score across all items within
the domain"*. It does not say whether, for IRT scoring, "score" means the raw
0–4 response or the Chapter 8 recoded value.

It cannot be the raw response: the collapsed recode is a lookup on the integers
0–4, and a mean is generally fractional, so recoding an imputed raw mean is
undefined. Interpolating the recode table would be inventing mathematics.

**Implemented:** the mean is taken over the already-recoded peer values for
`irt`, and over raw 0–4 values for `simple_sum` / `domain_mean` (which sum raw
values). Both are the quantity actually being summed for that method, which is
the most direct reading of "score".

Consequence worth knowing: with all five answered Domain-1 peers at "extreme",
the imputed value for a missing D1.1 is 3.2, not 4 — because the domain mixes
flat (max 4) and collapsed (max 2) items. The domain then scores 96, not 100.
This is conservative and arithmetically well-defined, but it is an
interpretation, and it is covered by a dedicated test.

---

## Non-blocking items proceeding on stated assumptions

1. **No local client record.** There is no `clients` table; Splose is the system
   of record. Assessments key on `organisation_id` + `client_id TEXT`, matching
   `fca_report_drafts`. The brief's "client UUID" is not achievable.
2. **New dependencies.** `pdf-lib` (server) and vendored `pdfjs-dist` (browser).
   The repo has no PDF capability at all and no bundler. Flagged in
   `01_REPO_AUDIT.md` §8.
3. **New concurrency convention.** No optimistic-concurrency mechanism exists;
   WHODAS introduces a `version` integer + `409 stale_version`, local to the
   module.
4. **No severity labels.** The supplied sources define no score-to-severity
   cut-points, so none will be rendered. Table 6.1 percentile lookup is the only
   authorised interpretive aid, and only for IRT 36-item scores.
5. **Domain headings** follow the printed instrument ("Understanding and
   communicating", "Getting around"), not the conceptual names in the brief's
   mock ("Cognition", "Mobility").
6. **H1–H3 and D5.9/D5.10 are captured but not scored** — no supplied source
   scores them. D5.9/D5.10 use a separate `1=No / 2=Yes` mapping.
