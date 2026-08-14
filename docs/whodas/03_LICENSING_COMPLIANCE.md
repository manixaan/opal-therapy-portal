# WHODAS 2.0 — Licensing & Compliance Note

Status: **development permitted · production release GATED**
Last reviewed: 2026-08-10

This note records what the supplied WHO material actually says. It deliberately
draws **no legal conclusion** — that is for Opal Therapy to obtain and record.

---

## 1. What the supplied manual states

### 1a. The publication (manual page ii)

> © World Health Organization 2010. All rights reserved.

Requests to reproduce WHO publications — *"whether for sale or for
noncommercial distribution"* — are directed to WHO Press, 20 Avenue Appia,
1211 Geneva 27, Switzerland · fax +41 22 791 4806 · `permissions@who.int`.

### 1b. The instrument (manual §5.1, printed p.37 / PDF p.45)

Materially more permissive, and specific to WHODAS 2.0 itself:

> WHO is granting free access and use of WHODAS 2.0, and has therefore placed
> the instrument in the public domain. People wishing to use it can do so after
> completing an online registration form on the WHODAS 2.0 web site.

and:

> Users of WHODAS 2.0 have no authority to make substantive changes to the
> assessment instrument unless given explicit permission to do so.

§5.2.1 adds:

> Users are encouraged to photocopy the WHODAS 2.0 versions in Part 3 for
> research purposes.

These two statements are consistent with each other: the **book** is a
copyrighted WHO publication; the **instrument** inside Part 3 is stated by WHO
to be in the public domain, subject to a registration step and to a
no-substantive-changes condition.

### 1c. Not supplied

The WHO WHODAS webpage, the WHO copyright/licensing guidance page and the WHO
permissions guidance page named in the task brief were **not provided as files
and have not been fetched**. The registration form referenced by §5.1 lives on
that webpage. Any assessment of current WHO terms must be made against those
live sources, not against this 2010 manual alone.

---

## 2. How this maps onto the implementation

The engineering rules the brief imposes are, independently, exactly what §5.1's
"no substantive changes" condition requires. They are enforced in code, not
merely by policy:

| Condition | Enforcement |
|---|---|
| No substantive change to the instrument | The instrument is never re-typeset. The source PDF is byte-immutable, hash-registered, and rendered directly. Responses are drawn as an overlay onto a **copy**. |
| Template cannot silently drift | SHA-256 recorded in the template registry; verified at boot; DB trigger refuses content edits to a template version once a document has been generated from it (pattern copied from `fca_templates`). |
| No Opal branding on the instrument | No logo, header, footer, watermark or explanatory text is written into the document area — blank or completed. Portal chrome lives strictly outside the rendered page. |
| WHO attribution preserved | The WHO logo and "WORLD HEALTH ORGANIZATION DISABILITY ASSESSMENT SCHEDULE 2.0" masthead are part of the source pages and are never removed or redrawn. **No WHO graphic is recreated by us.** |
| No implied WHO endorsement | Nothing in the module states or implies WHO endorses Opal Therapy. |
| No third-party wording | All item text comes from the supplied manual only. |

---

## 3. Production-release gate

**`ENABLE_WHODAS_ASSESSMENT` uses the strict flag pattern** — enabled only by
the exact string `'true'`, in every environment including development. Unlike
the permissive `resolveFlag()` helper, it never defaults on. This is the
technical expression of the gate: WHO-copyrighted content cannot become
reachable because an environment variable was forgotten.

Initial release is **staging-only**.

### Deployment checklist — must be complete before the flag is set in production

- [ ] **WHO registration completed** for Opal Therapy on the WHODAS 2.0 web
      site, as required by manual §5.1, and the confirmation recorded in this
      repository (date, registering entity, reference/receipt).
- [ ] **Current WHO terms reviewed** against the live WHO WHODAS page and WHO
      permissions guidance — not against the 2010 manual alone — and the review
      date recorded here.
- [ ] **Clinical-use scope confirmed.** §5.2.1's photocopy encouragement is
      worded *"for research purposes"*; the §5.1 public-domain statement is
      broader. Opal Therapy to confirm that electronic reproduction for
      **clinical** use in a therapy practice is within scope, and record the
      basis.
- [ ] **Template provenance recorded** — which PDF pages, from which source
      file, with which SHA-256, extracted on what date by what process.
- [ ] **Confirmation of no substantive change** — visual QA sign-off (Phase 19)
      attached, evidencing zero unintended visual difference between the WHO
      original and both the portal viewer and the generated completed PDF.
- [ ] **Written WHO permission obtained and filed**, if Opal Therapy's own
      legal review concludes registration alone is insufficient for this use.

Until every box is ticked, `ENABLE_WHODAS_ASSESSMENT` stays unset in
production. Staging use remains limited to synthetic client data.

---

## 4. Explicitly out of scope for this implementation

This note does **not** determine whether Opal Therapy may lawfully use WHODAS
2.0 in production, and no code comment, UI string or report in this module
should assert that it may. The module ships the gate; Opal Therapy clears it.
