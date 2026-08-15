# WHODAS 2.0 — Phase 0: WHO Source-Document Audit

Audit date: 2026-08-10. Every statement below was read out of the supplied
files. Nothing here is recalled from memory or taken from a third-party site.

---

## 1. Supplied source material and integrity

| # | File | SHA-256 | Notes |
|---|---|---|---|
| 1 | `WHO Disability Assessment Manual.pdf` | `a78fcb2503c726c84be7e74361aa225d0e2a34de7ecd4cbecac4e4d1ec22da6d` | 152 pages, 2.8 MB, PDF 1.4. *Measuring Health and Disability: Manual for WHO Disability Assessment Schedule (WHODAS 2.0)*, © WHO 2010, ISBN 978 92 4 154759 8 |
| 2 | `36item-scoring-template-simple-scoring.xlsx` | `cec01e176693f36fccebd7d5e3e1022bf31cdb6d04d9a16df8b0158c1b8e6b6d` | Single sheet |
| 3 | `36item-scoring-template-complex-scoring.xlsx` | `3d52651d8fc4c0b6de620b4f62dedaf02d84a4ff30bba8ebb231485ed86f11d4` | Single sheet |

**Not supplied:** the WHO webpage, the WHO copyright/licensing guidance page and
the WHO permissions guidance page named in the brief were not provided as
files and were not fetched. Section 8 below records what the *supplied* manual
itself states about copyright, which is the only authoritative licensing text
currently in hand.

### PDF geometry (relevant to the overlay architecture)

- `MediaBox` — `0 0 567 780` pt, **identical on all 152 pages** (≈200 × 275 mm)
- `CropBox` — `41.76 41.76 523.8 735.0` pt → **482.04 × 693.24 pt** (≈170 × 244.6 mm)
- Not encrypted · **no `/AcroForm`** — there are no existing PDF form fields
- Producer: Acrobat Distiller 8.0.0 / PScript5.dll

Two consequences:

1. The overlay layer must be built against the **CropBox**, not the MediaBox.
   The MediaBox includes printer's registration/crop marks and the
   `WHODAS-03(23Nov09).book Page n …` running head; standard viewers (and
   `pdf.js`) honour the CropBox and hide them. Coordinates in the field map must
   therefore be expressed relative to the CropBox origin `(41.76, 41.76)`.
2. Because there is no AcroForm, every interactive control must come from our
   own field map. This confirms the brief's overlay architecture is required,
   not merely preferred.

### The instruments are not standalone files — ACTION REQUIRED

The three 36-item instruments exist only as **page ranges inside the single
supplied manual PDF**:

| Form | PDF pages | Length |
|---|---|---|
| 36-item Interviewer-administered | 99–108 | 10 pages |
| Interviewer flashcard #1 | 109 | 1 page |
| Interviewer flashcard #2 | 111 | 1 page |
| 36-item Self-administered | 113–116 | 4 pages |
| 36-item Proxy-administered | 117–121 | 5 pages |

There is no separate blank-form PDF to treat as the immutable template.
Options are recorded in `04_OPEN_QUESTIONS.md`; the recommendation is
byte-faithful page extraction from the hashed manual.

---

## 2. Instrument structure — confirmed by reading the forms

All three 36-item variants carry the **same 36 scored items** with the same
item numbers `D1.1–D6.8` and the same six domains. They differ in wording
person (2nd vs 3rd), in administration furniture, and in the extra
non-scored items listed in §3.

| Domain | Title on the form | Items | Count |
|---|---|---|---|
| 1 | Understanding and communicating | D1.1–D1.6 | 6 |
| 2 | Getting around | D2.1–D2.5 | 5 |
| 3 | Self-care | D3.1–D3.4 | 4 |
| 4 | Getting along with people | D4.1–D4.5 | 5 |
| 5 | Life activities — household `5(1)` | D5.1–D5.4 | 4 |
| 5 | Life activities — work/school `5(2)` | D5.5–D5.8 | 4 |
| 6 | Participation in society | D6.1–D6.8 | 8 |
| | | **Total scored** | **36** |

The brief's UI mock lists domains as "Cognition, Mobility, Self-care, Getting
along, Life activities, Participation". Those are the *conceptual* domain names
used in manual §6.2; the **printed instrument** uses "Understanding and
communicating" and "Getting around". The results view should use the printed
instrument's headings, since those are what the clinician just read aloud.

### Response scale (identical on all three forms)

Five categories, printed left-to-right:

`None` · `Mild` · `Moderate` · `Severe` · `Extreme or cannot do`

- **Interviewer-administered** prints the numerals `1 2 3 4 5` in the cells —
  the interviewer circles a number.
- **Self- and proxy-administered** print only the words — the respondent
  circles a word. No numerals appear on the form at all.

This is the origin of the coding conflict in §5 and is why responses must be
stored as a **semantic value** (`none|mild|moderate|severe|extreme`) with the
numeric coding derived per scoring method, never inferred from display text.

### Conditional / skip logic

One skip exists, and it is worded slightly differently per form:

- **Self-administered** (page 3 of 4): *"If you work (paid, non-paid,
  self-employed) or go to school, complete questions D5.5–D5.8, below.
  Otherwise, skip to D6.1."*
- **Interviewer-administered** (page 7 of 10): *"If respondent works (paid,
  non-paid, self-employed) or goes to school, complete questions D5.5–D5.10 on
  the next page. Otherwise, skip to D6.1 on the following page."*

So D5.5–D5.8 are **legitimately non-applicable** when the respondent is not in
work or school. This is the 36-item vs 32-item distinction and it drives both
completion validation and which overall-score denominator applies.

Interviewer-only conditional day-count follow-ups:

- **D5.01** — asked only *"If any of the responses to D5.2–D5.5 are rated
  greater than none (coded as '1')"*. (Note: the form's own cross-reference
  here says D5.2–D5.5 while the household block it follows is printed
  D5.1–D5.4 — see §6, this is a WHO-internal numbering inconsistency.)
- **D5.02** — asked only *"If any of D5.5–D5.8 are rated greater than none
  (coded as '1')"*.

---

## 3. Non-scored items, by form

| Item | Type | Interviewer | Self | Proxy |
|---|---|---|---|---|
| A1–A5 | Demographic / background face sheet (manual §7.1) | yes | no | no |
| F1–F5 | Face sheet (manual §7.3) | yes | no | no |
| D5.01 | Days reduced/missed household work (conditional) | yes | no | no |
| D5.02 | Days missed work ≥ half a day (conditional) | yes | no | no |
| D5.9 | *"Have you had to work at a lower level…"* — **No = 1 / Yes = 2** | yes | no | no |
| D5.10 | *"Did you earn less money…"* — **No = 1 / Yes = 2** | yes | no | no |
| H1 | Days difficulties present (past 30 days) | yes | yes | yes |
| H2 | Days totally unable | yes | yes | yes |
| H3 | Days cut back / reduced | yes | yes | yes |
| H4 | **Proxy only** — *"I am the ______ (choose one) of this person."* 8 coded options: 1 husband or wife · 2 parent · 3 son or daughter · 4 brother or sister · 5 other relative · 6 friend · 7 professional carer · 8 other (specify) ______ | no | no | yes |

**H4 is the WHO-required proxy respondent field the brief asks for.** It sits
on page 1 of the proxy form, above the items, and is footnoted *"Questions
H1–H3 appear at the end of the questionnaire."* No other proxy metadata is
requested by the instrument, so no other proxy field may be invented inside the
document area.

D5.9 and D5.10 use a **1 = No / 2 = Yes** coding, which is *not* the difficulty
scale. They must have their own value mapping and must never be fed into the
difficulty recode.

H1–H3 are free-numeric day counts (0–30 implied by "in the past 30 days"), and
**none of the supplied scoring material scores them** — both workbooks list
H1–H3 below the score cell and outside every formula.

---

## 4. Interviewer-administered specifics

- Pages carry a `36 / Interview` badge top-right; self and proxy carry
  `36 / Self` and `36 / Proxy`.
- Question text is printed in **blue** (the manual's typographical convention,
  §9.2: text the interviewer reads aloud) with black instructional text.
- *"Show flashcards #1 and #2"* appears above each domain block. The flashcards
  are PDF pages 109 and 111 and are part of correct administration — the viewer
  should make them available to the interviewer.
- Domain lead-ins are scripted, e.g. Domain 5(1): *"I am now going to ask you
  about activities involved in maintaining your household…"*. These are part of
  the instrument and must render, not be summarised.

---

## 5. SCORING — the central finding

> **The supplied sources define three mutually incompatible scoring schemes.
> They cannot all be "the WHO reference calculation".**

### 5a. Manual §6.1 prose (PDF p.49 / printed p.41)

States simple scoring sums items coded **"none" (1) … "extreme" (5)** — a 1–5
convention — and describes complex scoring as IRT-based with three steps
(recode within domain, sum domains, convert to a 0–100 metric).

### 5b. Manual Chapter 8 — SPSS syntax (PDF pp.67–69 / printed pp.59–61)

This is the **only complete, executable algorithm in the supplied material**,
and it is the true IRT/complex method. Input is 1–5. Each item is recoded to
one of two patterns:

| Pattern | Recode | Max | Items (SPSS names) |
|---|---|---|---|
| **Flat** | `1=0 2=1 3=2 4=3 5=4` | 4 | D1_1, D1_2, D1_3, D1_4, D2_1, D2_4, D2_5, D3_2, D4_4, D5_4, D5_9, D5_10, D5_11, D6_2, D6_4, D6_5, D6_7 (17 items) |
| **Collapsed** | `1=0 2=1 3=1 4=2 5=2` | 2 | D1_5, D1_6, D2_2, D2_3, D3_1, D3_3, D3_4, D4_1, D4_2, D4_3, D4_5, D5_2, D5_3, D5_5, D5_8, D6_1, D6_3, D6_6, D6_8 (19 items) |

Domain and summary formulas, verbatim:

```
Do1  = (d11+d12+d13+d14+d15+d16) * 100 / 20
Do2  = (d21+d22+d23+d24+d25)     * 100 / 16
Do3  = (d31+d32+d33+d34)         * 100 / 10
Do4  = (d41+d42+d43+d44+d45)     * 100 / 12
Do51 = (d52+d53+d54+d55)         * 100 / 10     ← household
Do52 = (d58+d59+d510+d511)       * 100 / 14     ← work/school
Do6  = (d61+d62+d63+d64+d65+d66+d67+d68) * 100 / 24

st_s32 = (32 items, excluding the work block) * 100 / 92
st_s36 = (all 36 items)                       * 100 / 106
```

**Arithmetic verification (performed during this audit):** every denominator
equals the exact sum of that domain's per-item maxima under the recode table
above — 20, 16, 10, 12, 10, 14, 24. The two summary denominators are
`20+16+10+12+10+24 = 92` and `92+14 = 106`. The syntax is fully
self-consistent. This is a strong signal it has been transcribed correctly and
can be implemented exactly.

Note `st_s32` is the score for a respondent **not in gainful employment**
(manual §6, PDF p.49), which is exactly the skip condition in §2.

### 5c. The two supplied workbooks — neither matches 5a or 5b

Both workbooks state, in cell A1/B2–B6:

> *"When scoring WHODAS, the following numbers are assigned to responses:
> 0 = No Difficulty, 1 = Mild Difficulty, 2 = Moderate Difficulty,
> 3 = Severe Difficulty, 4 = Extreme Difficulty or Cannot Do"*

— i.e. **0–4**, contradicting the manual's 1–5 prose. Both output cells are
formatted `0.00%` (numFmtId 10), so results present as 0.00 %–100.00 %.

**Simple workbook** — no domain scores at all, one formula:

```
Overall Score  C50 = SUM(C9:C49) / 144            → 36 items × max 4 = 144
```

**"Complex" workbook** — six domain proportions on the **raw 0–4 values, with
no IRT recode whatsoever**, then an unweighted mean:

```
D1 C15 = SUM(C9:C14)  / 24      (6 items × 4)
D2 C22 = SUM(C17:C21) / 20      (5 × 4)
D3 C28 = SUM(C24:C27) / 16      (4 × 4)
D4 C35 = SUM(C30:C34) / 20      (5 × 4)
D5 C45 = SUM(C37:C44) / 32      (8 × 4)
D6 C55 = SUM(C47:C54) / 32      (8 × 4)
Overall C56 = SUM(C15+C22+C28+C35+C45+C55) / 6
```

**The workbook named "complex-scoring" is not the complex (IRT) method.** It is
a domain-averaged raw score. It applies no differential item weighting, no
category collapsing, and produces different numbers from Chapter 8 for every
input except all-none and all-extreme.

Worked check (all items = "extreme"): workbook-simple = 144/144 = 100.00 %;
workbook-complex = mean(1,1,1,1,1,1) = 100.00 %; Ch.8 st_s36 = 106×100/106 =
100. All three agree only at the extremes.

Neither workbook handles the work/school skip: the complex workbook's D5
denominator is a fixed 32, so a respondent who is not working scores as though
they had answered "None" to four items they were instructed to skip —
depressing their Life activities and overall score. Chapter 8 handles this
correctly with the separate `st_s32` path.

### 5d. Item-numbering conflict inside the WHO material

The Chapter 8 SPSS variable names for Domain 5 do **not** line up with the
printed item numbers on any of the three forms:

| Printed on forms | Workbooks | SPSS Ch.8 |
|---|---|---|
| D5.1–D5.4 (household) | D5.1–D5.4 | `d52, d53, d54, d55` |
| D5.5–D5.8 (work/school) | D5.5–D5.8 | `d58, d59, d510, d511` |

`D5_1`, `D5_6`, `D5_7` receive no recode and appear in no formula, i.e. the
SPSS dataset layout carries three unscored Domain-5 variables interleaved with
the scored ones (consistent with the interviewer form's screener and the
D5.01/D5.02 day counts). Every other domain matches one-to-one.

The **only** ordering consistent with the verified denominators is:

| Printed item | SPSS var | Recode |
|---|---|---|
| D5.1 | d5_2 | collapsed |
| D5.2 | d5_3 | collapsed |
| D5.3 | d5_4 | **flat** |
| D5.4 | d5_5 | collapsed |
| D5.5 | d5_8 | collapsed |
| D5.6 | d5_9 | **flat** |
| D5.7 | d5_10 | **flat** |
| D5.8 | d5_11 | **flat** |

⚠️ **This mapping is an inference, not a statement made anywhere in the
supplied documents.** It is arithmetically forced (any other assignment breaks
the /10 and /14 denominators), but per the brief's NO-GUESSING RULE it is
recorded here as a documented ambiguity rather than silently adopted. It is
carried into `04_OPEN_QUESTIONS.md` as **Q2**.

---

## 6. Missing-data rules (manual §6.5, PDF p.53 / printed p.45)

Quoted rules for the **full 36-item version**:

- If the respondent is not working and has given responses to the 32-item
  WHODAS 2.0, *"the score can be used as it is, and will be comparable to that
  of the full 36-item version."*
- *"In all other situations where one or two items are missing, the mean score
  across all items within the domain should be assigned to the missing items.
  This method should not be used if more than two items are missing. In
  addition, if domain-wise scores are being computed for domains, the two
  missing items should not come from the same domain."*

Implementable rule set:

1. Work/school block skipped for a non-working respondent → **not missing**;
   use the 32-item path. Not an imputation.
2. 1–2 missing items overall → impute each with its **own domain's mean of
   answered items**; permitted only if the two do not share a domain when
   domain scores are reported.
3. ≥3 missing → **refuse to score.** The manual gives no simple method, and the
   complex alternatives (hot-deck, multiple imputation) are explicitly framed
   for researchers with large datasets, not a single clinical record.

Any imputed result must be visibly flagged, per the brief.

---

## 7. Severity labels — NOT PERMITTED

Manual §6.3 supplies **population percentile norms** (Table 6.1, IRT-based,
36-item: score 0 → 40.00th percentile, 10 → 72.35th, 30 → 88.35th, 50 →
94.69th, 90 → 99.90th, 100 → 100.00th) and Figure 6.1.

Nowhere in the supplied material is there a cut-point defining "mild",
"moderate" or "severe" **disability** from a WHODAS score. The words mild /
moderate / severe / extreme are **item response categories only**.

**Therefore the results view must not render any severity classification.**
Percentile lookup against Table 6.1 is the only interpretive aid the supplied
sources authorise, and only for the IRT-based 36-item score — it must not be
applied to either workbook method.

---

## 8. Copyright position from the supplied manual

Manual page ii states: *"© World Health Organization 2010. All rights
reserved."* Reproduction requests — *"whether for sale or for noncommercial
distribution"* — are directed to WHO Press
(`permissions@who.int`, fax +41 22 791 4806).

Manual §5.1 is titled *"Access and conditions of use for WHODAS 2.0 and its
translations"* (printed p.37 / PDF p.45) and has not yet been read in full;
it should be before any production gate is cleared.

No WHO permission or licence for Opal Therapy is recorded anywhere in this
repository. Per the brief this does not block development, but production
release of the reproduced instrument must remain gated. See
`03_LICENSING_COMPLIANCE.md`.

---

## 9. What is now fully determined vs. still open

**Determined and safe to build against:** the 36 items, their exact wording per
form, item numbers, domain membership, the five response categories, the
work/school skip, the interviewer-only extras (A1–A5, F1–F5, D5.01, D5.02,
D5.9, D5.10), H1–H3, proxy H4 and its eight coded options, PDF page ranges,
page geometry and CropBox offset, missing-data rules, the absence of any
authorised severity labels.

**Open — see `04_OPEN_QUESTIONS.md`:** which scoring scheme(s) constitute "the
WHO reference calculation" (Q1); confirmation of the Domain-5 SPSS↔printed
mapping (Q2); provenance of the immutable template PDFs (Q3).
