# Source reconciliation — `7 Resources`

What the vault actually contains, recomputed from the bytes by
`backend/setup/scan-resource-source.js`, and how it compares with the audit
baseline this task was given.

Run it yourself:

```bash
node backend/setup/scan-resource-source.js --out /tmp/inventory.json
```

The vault is opened read-only. The scanner has no write, rename or delete path,
and it refuses to run if `--out` resolves inside the source root.

## Against the baseline

Every structural figure reconciles exactly.

| Measure | Baseline | Recomputed | |
|---|---:|---:|---|
| Files | 651 | 651 | ✓ |
| Total size | ~1.8 GB | 1,969,925,733 B (1.83 GiB) | ✓ |
| PDF | 483 | 483 | ✓ |
| PDF pages | ~4,600 | 4,600 | ✓ |
| DOCX / DOC | 96 / 6 | 96 / 6 | ✓ |
| PPTX / PPT | 24 / 5 | 24 / 5 | ✓ |
| JPEG | 19 | 19 | ✓ |
| ZIP | 7 | 7 | ✓ |
| `.icloud` placeholders | 10 | 10 | ✓ |
| `.DS_Store` | 1 | 1 | ✓ |
| Office temp file | ≥1 | 1 | ✓ |
| Duplicate groups | 30 | 30 | ✓ |
| Files in those groups | 62 | 62 | ✓ |
| Redundant copies | ~32 | 32 | ✓ |
| Files under `CLIENTS` | 51 | 51 | ✓ |
| Fillable PDFs | 14 | 13 + 1 unreadable | see below |
| PDFs with extractable text | ~391 | 359 | see below |
| Image-only / extraction-hostile | ~92 | 124 | see below |

### The three figures that differ, and why

**Fillable PDFs — 13, not 14.** One further PDF (`PAEDS/SENSORY/Calm Down Cards
2020.pdf`) has a damaged object graph: pdf.js renders it, pdf-lib cannot read
its catalogue (`Expected instance of PDFDict, but got undefined`), so its form
dictionary cannot be counted. 13 confirmed + 1 uncountable = the baseline's 14.
It is recorded with its analysis error rather than silently counted either way.

**Text layer — 359 rather than ~391.** This is a threshold, not a disagreement.
The distribution is:

| Extracted characters | PDFs | Reading |
|---|---:|---|
| 0 | 85 | genuinely image-only |
| 1–199 | 29 | a scan carrying a title or page-number text layer |
| ≥200 but no single page ≥50 | 10 | text so thin no page is readable |
| ≥200 with a readable page | 359 | a usable text layer |

`textExtractable` requires both ≥200 characters overall **and** at least one page
carrying ≥50 — because the decision it drives is "can this be indexed for search
and read by a screen reader", and a PDF whose only text is a footer cannot. A
looser threshold reproduces the baseline's ~391; the bands above are published so
either question can be answered without rescanning.

**Extraction-hostile — 124 rather than ~92.** The same boundary seen from the
other side: 85 + 29 + 10. The 32-file difference is entirely the trace-text band.

## Duplicates: why the earlier pass saw 16 groups, not 30

The previous ingestion never hashed a file under `CLIENTS`, so it could only ever
observe duplicate groups whose members were all outside it. It found 16 groups /
18 redundant copies, and that number was correct for what it could see.

Hashing everything reveals the rest:

| | Groups | Redundant |
|---|---:|---:|
| Safe ↔ safe | 16 | 18 |
| Client-path ↔ safe copy | 13 | 13 |
| Client ↔ client | 1 | 1 |
| **Total** | **30** | **32** |

The 13 middle rows matter well beyond arithmetic. Each is a **generic
third-party worksheet that happens to sit in a client folder** — `Lazy 8
Breathing.pdf`, `Six_Sides_of_Breathing.pdf`, a Twinkl activity sheet — and each
is byte-identical to a copy already filed under `PAEDS`. The brief's rule applies
exactly: use the safe non-client copy and ignore the client path. No derivative
is created and no review is needed to make them safe, because the file being used
was never a client file.

## Privacy: location and content, unioned

Path alone is not a sufficient privacy signal in this vault, and neither is
content. The scanner applies both and takes the union.

| Outcome | Files |
|---|---:|
| `client-confidential` | 40 |
| `privacy-review` (quarantined, unresolved) | 9 |
| Generic duplicates resolved to a safe copy | 13 |

38 of the 40 confidential files are the `CLIENTS` residue after the 13 rescues.
The other 2, and all 9 quarantined, sit **outside** `CLIENTS` — ordinary topic
folders holding working documents that carry a person's details. A path-only
rule would have published them.

Detectors record signal names and counts only; the matched value is never
stored, returned or logged.

| Signal | Weight | Hits |
|---|---|---:|
| `participant-or-client-label` (with a filled value) | strong | 16 |
| `possessive-personal-name` (filename) | weak | 6 |
| `named-for-person` (filename) | weak | 5 |
| `ndis-participant-number` | strong | 1 |
| `medicare-number` | strong | 1 |
| `email-address` | contact detail | 123 |
| `australian-street-address` | contact detail | 20 |
| `australian-phone-number` | contact detail | 17 |

**Contact details do not quarantine anything.** 123 files carry an email address
and nearly all are a publisher's support address in a worksheet footer; treating
that as evidence of client data would quarantine most of the vault for the
offence of having been professionally published. They are recorded because they
matter to *branding* and third-party attribution review instead.

Likewise a label is not a disclosure: `Client: ________` is a blank worksheet,
which is how a large share of these templates print. Every label detector
requires a filled value after the colon. Applying that distinction cut the
label signal from 52 to 16 and the quarantine set from 113 files to 49.

## Every file has exactly one outcome

| Primary outcome | Files |
|---|---:|
| `rights-review` | 568 |
| `client-confidential` | 40 |
| `deduplicated` | 31 |
| `incomplete-placeholder` | 10 |
| `excluded-non-resource` | 2 |
| **Total** | **651** |

Precedence runs: non-resource → placeholder → privacy → duplicate → quality →
rights. Privacy outranks deduplication deliberately, which is why the count is 31
and not 32: one redundant copy is itself a client file, and it is recorded as
confidential rather than as a duplicate of another client file.

`excluded-non-resource` is the `.DS_Store` and the one `~$` Office lock file.
The 10 `.icloud` entries are stubs — the real files were never present locally,
so nothing about them can be verified and none is treated as a resource.

**568 files reaching `rights-review` is the finding, not a failure to classify.**
The vault is overwhelmingly third-party: Twinkl and Teachers-Pay-Teachers
worksheets, commercial OT company material, publisher workbooks, and standardised
instruments (the COPM booklet at 372 form fields, MOHOST at 412) that must never
be rebranded, altered or redistributed without the rights holder's permission.
Nothing here establishes a right to publish any of them, so nothing claims one.

## ZIP archives

All 7 are inventoried without extraction; **no member name is absolute, contains
`..`, or carries a drive letter**. Two pairs are `(1)`-suffixed copies of an
archive already present and collapse under deduplication.

| Archive | Members | Uncompressed |
|---|---:|---:|
| `anxiety-and-stress-activity-pack` | 7 | 2.6 MB |
| `sometimes-i-feel-angry-social-situation` | 3 | 6.9 MB |
| `eylf-fine-motor-skills-pack` | 30 | 16.0 MB |
| `social-skills-scenarios-super-pack` ×2 | 7 | 14.5 MB |
| `friendship-and-empathy-board-game` | 5 | 5.9 MB |
| `a-new-baby-social-situation` | 2 | 7.7 MB |

## What the scan deliberately does not decide

Topic, resource type, source organisation, licence and redistribution rights are
**not** inferred from bytes. The scanner emits the conservative default that
routes a record to human review, and records that it is unreviewed. A plausible
guess in a rights field is worse than a blank one, because a blank invites the
check that a guess suppresses.
