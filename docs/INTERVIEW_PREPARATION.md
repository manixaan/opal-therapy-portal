# Interview Preparation

Structured recruitment interviews for Opal Therapy: a library of interview
templates, an online interview record per applicant, and two PDFs — a blank
fillable template and a populated export of a completed interview.

Owned by the practice Owner. Delegable, one permission at a time, to an
individual administrator.

---

## 1. What this is, and what it deliberately is not

An interview record holds **employment information about a prospective
employee**. It is not clinical data and the applicant is not a participant.

Nothing in this feature references `contacts`, `participants`, `events` or any
clinical table — `interview-permissions.test.js` asserts that the route file's
only two tables are `interview_records` and `users`. A job applicant never
acquires a row in the practice's clinical database because somebody
interviewed them.

It is also **not an induction course**. An authorised admin is being given a
tool to interview applicants with; they are not being assigned the OT
interview as learning material. The permission is modelled accordingly.

---

## 2. Where it lives

| Layer | File |
| --- | --- |
| Template catalogue (content) | `backend/interview-templates.js` |
| PDF renderer (blank + populated) | `backend/interview-pdf.js` |
| API | `backend/interview-routes.js` |
| Schema | `backend/migrations/036_interview_preparation.sql` |
| Permissions | `backend/permissions.js` (`INTERVIEW_PERMISSIONS`) |
| Frontend module | `frontend/current/interview.js` + `interview.css` |
| Shell wiring | `frontend/current/mockup_v3.html` (`#view-interviews` / `#iv-root`) |
| Routing | `frontend/current/navigation.js` (`interviews` tab) |

Navigation: **More → Recruitment → Interview Preparation** for the Owner, and
**Menu → Recruitment → Interview Preparation** for an authorised admin.
Addresses are `#interviews` (library) and `#interviews/record/:id` (one
interview).

---

## 3. Permissions

Two permissions, neither in any role's defaults except `owner`:

| Permission | What it grants |
| --- | --- |
| `interviews.access` | See the module, run interviews, save, complete, export. Sees the records **this user created**. |
| `interviews.view_all` | Read and export **every** interview in the practice. Read only. |

Rules that hold at the route, not just in the UI:

- The **Owner holds both implicitly** and cannot be stripped of them.
- **Editing is narrower than reading.** An interview is a document one person
  wrote and signed. `view_all` lets a second person read and file it; only its
  author or the Owner may change what it says.
- **Delegation is owner-only by ROLE**, not by permission, so the ability to
  hand out access can never itself be handed out.
- **Only administrators can be delegated to.** A grant to a therapist or a
  read-only account is refused with `role_not_delegable`. Recruitment records
  are not a clinical surface.
- **Permanent deletion is owner-only.** Everybody else archives.
- A record in another organisation is a **404**, never a 403 — record ids
  cannot be probed.

`/api/interviews/*` sits behind `requireAuth` **and**
`requirePermission('interviews.access')` as two `router.use` lines, so the
whole namespace refuses an unauthorised caller whatever the navigation shows.
Hiding the tab is a courtesy; the router is the boundary.

### Granting and revoking

Interview Preparation → **Manage access** (Owner only). The screen lists the
Owner (locked, "Always has full access") and every active administrator with a
checkbox per permission.

Revoking takes effect on the admin's next request: the tab disappears, the
empty *Recruitment* menu group is removed, a deep link to a record redirects
safely to the calendar, and every route answers 403.

---

## 4. Templates

Templates are **code**, not database rows — the same reasoning as
`induction-modules.js` and `assessments/definitions.js`. An interview template
is authored content: it belongs in version control where a change is
reviewable, diffable and revertible.

Adding one is a file edit plus a line in `TEMPLATES`. No migration, no new
route, no UI change. `FUTURE_TEMPLATES` lists roles the practice has said it
will interview for but for which no interview has been written; they are
published to the library as "Not available yet" rather than hidden, because a
plausible-looking interview nobody drafted would be fabrication.

### The question grammar

```js
{ key, type, label, guidance?, rows?, options?, scale?, emphasis? }
```

`type` is one of `text`, `date`, `longtext`, `checkboxes`, `choice`,
`ratings`. Every renderer — the online form, the blank PDF, the populated PDF
— switches on exactly that set. `rows` on a `longtext` is a **starting
height**, never a limit.

### Versioning

Every template carries an integer `version`. When a record is created, the
**entire template is frozen into the record's `template_schema` column**.

Editing `interview-templates.js` afterwards never re-labels a stored answer,
never changes a question a candidate was actually asked, and never alters a
PDF regenerated from an old record. Answers submitted to an existing record
are coerced against **that record's snapshot**, so a question added to the
template later cannot be smuggled into an older record.

This is the same pinning guarantee `learning_assignments` gets from
`workflow_version_id`, expressed as a snapshot because the source of truth is
a reviewed file rather than a row.

**If you change a template's wording, bump its `version`.**
`interview-templates.test.js` pins all 38 questions verbatim and will fail
first.

---

## 5. The online interview

- **One continuous document**, not a paged wizard. The section strip scrolls
  to a heading; it never swaps a panel, so no answer is ever unmounted and a
  browser find searches the whole interview.
- **Answer boxes grow.** Every narrative field is a `<textarea>` with no
  `maxlength` that resizes to its content and shrinks again when text is
  deleted.
- **Autosave** 1.2s after the last keystroke; leaving a field, jumping
  sections, completing, exiting and switching tabs all flush first. A failed
  save re-queues underneath anything typed since, so newer keystrokes win and
  nothing is dropped. The unload guard arms **only** while something is
  genuinely unsaved.
- **`expectedUpdatedAt`** makes a lost update visible: if the row moved under
  the client the save is refused with the current record attached, rather than
  silently overwriting a colleague.
- **Validation is deliberately light.** Only candidate name, interview date,
  role and interviewer are required to *complete*; blank questions are
  reported ("29 of 38 questions are still blank") and never block. This is a
  note-taking tool, not a form.
- **Completion does not lock the record.** A later edit is allowed and
  increments `post_completion_edits`, which shows on the record, in the list
  and on the PDF, and writes an unthrottled
  `INTERVIEW_EDITED_AFTER_COMPLETION` audit row.

### Status lifecycle

```
draft ──save──▶ in_progress ──complete──▶ completed
                     ▲                        │
                     └────────reopen──────────┘
        any ──archive──▶ archived ──restore──▶ (back to what it was)
```

---

## 6. PDFs

One schema-driven renderer produces both documents.

**Blank fillable** (`GET /api/interviews/templates/:key/pdf`) — real AcroForm
fields: text fields for every narrative answer, checkboxes for client groups,
radio groups for single-choice questions and for each rating row. Opens and
fills in Preview, Acrobat, Edge and Chrome.

**Populated** (`GET /api/interviews/records/:id/pdf`) — the same layout with
the portal's answers already in the fields, so the download stays editable.

Add `?disposition=inline` for the Print action: the browser's own PDF viewer
prints the *generated document*, so what comes out of the printer is exactly
what downloads — no screen-styled approximation, and no portal chrome.

### No answer is ever clipped

The source template gave every question a fixed box, which is why it could not
survive a real interview: a three-paragraph answer disappeared below the fold.

This renderer measures each answer first and sizes its field to the text. When
an answer is taller than the page has left, it **splits** — the remainder
continues in a "Response continued" field on the next page. A six-page
template therefore prints as six, eight or fourteen pages depending on what
was written, and that is correct.

Two mechanisms make it a guarantee rather than an intention:

1. **Measurement is pessimistic.** Lines are wrapped against `MEASURE_INSET`
   (8pt of side padding) while pdf-lib lays the appearance out against 3.4pt,
   so pdf-lib can only ever produce the same number of lines or fewer.
   `interview-pdf.test.js` proves this by running *both* layout engines —
   this module's and pdf-lib's own `layoutMultilineText` — over adversarial
   inputs.
2. **Every field is built one line taller** than its measured text
   (`SPARE_LINES`).

Long single tokens (a pasted URL, a rule of underscores) are the one case
pdf-lib will not break; `softenLongTokens()` inserts the break before anything
is measured.

The field's `/V` value carries the answer's own text — not a re-flowed copy —
so the document is recoverable by reading the form. The test suite reads it
back and compares character for character.

### Two corrections to the source PDF

Both were required by the no-truncation rule:

1. The source's fields each carried **MaxLen 100**, so a PDF reader silently
   refused the 101st character of every narrative answer. No field generated
   here carries a maximum length.
2. Two of the source's answer areas — "How would you feel about having a
   caseload…" and "Overall observations" — **shared one field name** with a
   third, so typing in one wrote all three. Each question here owns its own
   field.

### Filenames

```
Opal_Therapy_OT_Interview_Jane_Smith_2026-08-20.pdf
Opal_Therapy_Occupational_Therapist_Interview_Template.pdf
```

Built from sanitised parts and re-scrubbed at the header, so a candidate
called `"; attachment; filename="payroll` cannot rewrite the
Content-Disposition.

### Known limitation — non-Latin scripts

The renderer uses the standard PDF fonts, which encode WinAnsi (CP1252).
`toWinAnsi()` transliterates what it can: all of Latin-1 passes through
untouched (é, ü, ñ, ç, ø, å), Latin Extended-A folds to its base letter
(Łukasz → Lukasz, Ngātai → Ngatai), and arrows and symbols become ASCII
equivalents.

**Scripts with no Latin form — CJK, Arabic, Hebrew, Cyrillic, Thai — become
`?`.** Generation never fails; the characters are simply not representable.

Fixing this needs an embedded Unicode font: a licensed font binary in
`backend/assets/` plus the `@pdf-lib/fontkit` dependency, and a switch from
`StandardFonts.Helvetica` to `pdf.embedFont(bytes)` in `interview-pdf.js`.
Deliberately not assumed here — it is a dependency and licensing decision, not
a code one.

---

## 7. Data model

One table, `interview_records` (migration 036). No children.

Queryable facts are columns (`candidate_name`, `position`, `interview_date`,
`interviewers`, `status`, `recommendation`, `created_by`, timestamps). Answers
are `responses` JSONB, keyed by question key, whose shape is defined by the
`template_schema` snapshot sitting in the same row. `ratings` is lifted out of
that blob because it is the one part of an interview that is scored and
compared across candidates.

**The portal holds the record; the PDF is an export.** A completed interview
is never stored only as a downloaded file.

---

## 8. Audit

Every event writes to `audit_logs` with `target_type = 'interview'`:

`INTERVIEW_CREATED`, `INTERVIEW_OPENED`, `INTERVIEW_EDITED`,
`INTERVIEW_EDITED_AFTER_COMPLETION`, `INTERVIEW_COMPLETED`,
`INTERVIEW_REOPENED`, `INTERVIEW_ARCHIVED`, `INTERVIEW_RESTORED`,
`INTERVIEW_DELETED`, `INTERVIEW_PDF_EXPORTED`, `INTERVIEW_TEMPLATE_EXPORTED`,
`INTERVIEW_ACCESS_CHANGED`.

**Ids and counts only — never candidate answers.** An audit log is read by
more people, kept for longer and exported more often than the record itself;
the record id resolves the detail for anyone entitled to look.

Routine autosaves are throttled to one `INTERVIEW_EDITED` per user per record
per 15 minutes, so the events that matter are not buried under several hundred
writes per interview. Post-completion edits are **never** throttled.

---

## 9. Tests

```bash
# unit
npx jest --config backend/jest.config.js tests/interview-

# integration (real Postgres, real sessions, real SQL)
cd backend && npx jest --config jest.integration.config.js tests/integration/interviews.itest.js
```

| Suite | Covers |
| --- | --- |
| `interview-templates.test.js` | grammar, all 38 questions pinned verbatim, coercion, versioning |
| `interview-pdf.test.js` | the no-clipping proof against pdf-lib's own layout, round-trip of a 10k-character answer, hostile input, filenames |
| `interview-permissions.test.js` | the permission model, and route-level gating asserted from source |
| `interview-surface-guards.test.js` | frontend escaping, no maxlength, autosave, accessibility, shell wiring |
| `integration/interviews.itest.js` | the full lifecycle and every RBAC boundary, called against the API directly |

---

## 10. Adding a template

1. Add the definition to `backend/interview-templates.js` (copy `OT_INTERVIEW`
   as the shape) and add it to `TEMPLATES`.
2. Remove the matching entry from `FUTURE_TEMPLATES` if there is one.
3. Add a content-fidelity block to `interview-templates.test.js`.

Nothing else changes. The library card, the online form, both PDFs, search,
export and the record list are all derived from the definition.
