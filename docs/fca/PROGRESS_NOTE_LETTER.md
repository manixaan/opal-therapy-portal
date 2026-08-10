# Progress Note Letter Generation

How the Opal progress note letter is composed, where every value on the page
comes from, and what a therapist is stopped from sending.

Everything here is server-side and self-contained. **No external AI is involved
at any point in this feature**, and no client data leaves the deployment.

This document assumes [`REPORT_GENERATION.md`](./REPORT_GENERATION.md). The
letter is a **second document type on the same machinery**, not a second
implementation, and this file describes only what differs.

---

## 1. What was reused, and what was added

The letter is the FCA report's pipeline pointed at a second template. There is
**one** engine, **one** resolver, **one** manifest composer, **one** set of data
layers and **one** client search. A second copy of any of them would have meant
a second place for organisation isolation, the frozen-snapshot rule or the
"missing is flagged, never fabricated" rule to be got wrong.

| File | Status | What changed |
|---|---|---|
| `backend/fca/docx-engine.js` | **generalised** | `composeDocx({ templateBuffer, manifest, options })` is now the engine; `generateFcaDocx` is that function pinned to `FCA_OPTIONS`. Added: multiline `w:br` writing, whole-paragraph removal, an injectable custom-block builder, an optional TOC rebuild, a parameterised error prefix. |
| `backend/fca/resolve-scalars.js` | **generalised** | Takes an optional `catalogue`. Added the `organisation` layer, a declared `fallbackField`, and a per-tag `isDate` flag. FCA precedence is untouched. |
| `backend/fca/manifest.js` | **generalised** | Every function takes an optional `catalogue` (sections, required tags, overridable tags, limits, custom-tag minting and pattern, `requireTitle`). Defaults to the FCA catalogue. |
| `backend/fca/template-map.js` | **extended** | `STYLE.BODY_EMPHASIS` added. Nothing else. |
| `backend/fca/data-layers.js` | **new, shared** | `loadSploseClient`, `loadClientProfile`, `loadPortalData` moved here out of `fca-routes.js` verbatim; `loadOrganisationSettings` and `therapistCredentials` added. |
| `backend/fca/client-search.js` | **new, shared** | The FCA client-search body, moved. Both routers now delegate to it. |
| `backend/fca/document-id.js` | **new, shared** | The document-reference convention, extracted from `fca-routes.js`. Output is unchanged (`FCA-1A2B3C4D`); the letter issues `LTR-1A2B3C4D`. |
| `backend/fca/letter-template-map.js` | **new** | The letter's static, sha256-pinned template description. |
| `backend/fca/letter-blocks.js` | **new** | The letter's engine options, its custom-block builder, and the final "no `[PORTAL — …]`" guard. ~120 lines, no XML walking of its own. |
| `backend/letter-routes.js` | **new** | The fixed API contract, RBAC, addressing rules, required-value validation, persistence, storage, audit. |
| `backend/migrations/020_progress_note_letters.sql` | **new** | Additive generalisation of the 018 tables. |

---

## 2. Verified template contract

`backend/fca/templates/progress-note-letter-v1.docx`
sha256 `f686096730a793d44316f9e73aa329dd36ebe2583699df0ee80d0ece583ed5c5`

Every number below is **discovered** from the file by
`backend/tests/letter-template-map.test.js`, which unzips the real template and
walks its XML. Nothing in production code branches on a count.

- **30** unique `w:tag` content controls across **32** occurrences
- of which **24** unique scalar tags across **26** occurrences
- **5** block controls: 2 required, 3 optional
- **1** custom-content anchor, `OPAL_ANCHOR_LETTER_CUSTOM_SECTIONS`
- exactly two scalars repeat: `OPAL_CLIENT_FULL_NAME` ×2 and
  `OPAL_THERAPIST_ROLE` ×2, both wholly inside `word/document.xml`
- `word/header6.xml` carries the four `OPAL_ORGANISATION_*` letterhead tags
- `word/footer6.xml` carries `OPAL_LETTER_DOCUMENT_ID` beside a live `PAGE`
  field, whose `begin`/`separate`/`end` run structure is asserted intact after
  every generation

### One correction to the brief

The brief anticipated that the five block controls would be **nested inside a
parent `w:sdt`**, as the FCA's optional sections are. They are not: in this
template all five blocks and the anchor are **direct children of `w:body`**.
The engine's direct-child tag lookup is correct either way, so removing a block
here is exactly as safe — the nesting-safety property simply is not exercised by
this template. Recorded here so nobody re-derives it from the brief later.

### Blocks

| Tag | Label | Required | Default |
|---|---|---|---|
| `OPAL_SECTION_LETTER_PURPOSE_CONTEXT` | Purpose and context | yes | on, locked |
| `OPAL_SECTION_LETTER_PROGRESS_UPDATE` | Therapy and progress update | yes | on, locked |
| `OPAL_SECTION_LETTER_CURRENT_PRESENTATION` | Current presentation and support needs | no | on |
| `OPAL_SECTION_LETTER_CLINICAL_OPINION_RECOMMENDATIONS` | Clinical opinion and recommendations | no | on |
| `OPAL_SECTION_LETTER_NEXT_STEPS` | Next steps and review | no | on |

Every optional block defaults **on**: the safe default for clinical
correspondence is the complete letter, with the therapist removing what does not
apply rather than having to remember to add it.

Deselecting a required block is **refused with `400 required_section`**, not
silently corrected. The manifest composer would have re-added it safely, but a
therapist who believes they removed a section and did not has been misled about
what they are about to send.

---

## 3. The complete 24-tag source map

`layer` decides precedence; `source` is what the therapist sees in the wizard
and what the frozen snapshot records forever.

| # | Tag | Occ. | Part | Layer | Backed by | Source when resolved | Required? |
|---|---|---|---|---|---|---|---|
| 1 | `OPAL_LETTER_DATE` | 1 | document | report | draft `letter_details.letterDate` (defaults to today at draft creation) | `report_override` | **yes** |
| 2 | `OPAL_LETTER_SUBJECT` | 1 | document | report | draft `letter_details.subject` | `report_override` | **yes** |
| 3 | `OPAL_LETTER_REPORTING_PERIOD` | 1 | document | report | draft `letter_details.reportingPeriod` | `report_override` | **yes** |
| 4 | `OPAL_LETTER_RECIPIENT_NAME` | 1 | document | report | draft `letter_recipient.name` | `report_override` | **yes** |
| 5 | `OPAL_LETTER_RECIPIENT_ROLE` | 1 | document | report | draft `letter_recipient.role` | `report_override` | no — line removed |
| 6 | `OPAL_LETTER_RECIPIENT_ORGANISATION` | 1 | document | report | draft `letter_recipient.organisation` | `report_override` | no — line removed |
| 7 | `OPAL_LETTER_RECIPIENT_ADDRESS` | 1 | document | report | draft `letter_recipient.address` (multiline) | `report_override` | no — line removed |
| 8 | `OPAL_LETTER_SALUTATION` | 1 | document | report | draft `letter_recipient.salutation` | `report_override` | **yes** |
| 9 | `OPAL_LETTER_CC` | 1 | document | report | draft `letter_cc_recipients`, one per line (multiline) | `report_override` | no — line removed |
| 10 | `OPAL_CLIENT_FULL_NAME` | **2** | document | splose | Splose `fullName` | `splose` | **yes** |
| 11 | `OPAL_CLIENT_NDIS_NUMBER` | 1 | document | splose | Splose `ndisNumber` | `splose` | **yes** |
| 12 | `OPAL_CLIENT_PREFERRED_NAME` | 1 | document | client_profile | `fca_client_profiles.preferred_name`, **declared fallback** to Splose `firstname` | `client_profile`, or `splose` when the fallback was used | **yes** |
| 13 | `OPAL_THERAPIST_FULL_NAME` | 1 | document | portal | `therapist_profiles.display_name` → `users.display_name` → `users.name` | `portal` | **yes** |
| 14 | `OPAL_THERAPIST_ROLE` | **2** | document | portal | `therapist_profiles.role_title` → `users.role_title` | `portal` | **yes** |
| 15 | `OPAL_THERAPIST_CREDENTIALS` | 1 | document | portal | active `credentials.credential_name` values, joined | `portal` | **yes** |
| 16 | `OPAL_THERAPIST_QUALIFICATIONS` | 1 | document | report | override only — no portal column holds free-text qualifications (multiline) | `report_override` | no — line removed |
| 17 | `OPAL_THERAPIST_AHPRA_NUMBER` | 1 | document | portal | active AHPRA `credentials.registration_number` | `portal` | no — line removed |
| 18 | `OPAL_THERAPIST_PHONE` | 1 | document | portal | `users.phone` | `portal` | **yes** |
| 19 | `OPAL_THERAPIST_EMAIL` | 1 | document | portal | `users.email` | `portal` | **yes** |
| 20 | `OPAL_ORGANISATION_ADDRESS` | 1 | **header6** | organisation | `org_settings.settings.businessAddress` (multiline) | `portal` | **yes** |
| 21 | `OPAL_ORGANISATION_PHONE` | 1 | **header6** | organisation | `org_settings.settings.businessPhone` | `portal` | **yes** |
| 22 | `OPAL_ORGANISATION_EMAIL` | 1 | **header6** | organisation | `org_settings.settings.businessEmail` | `portal` | **yes** |
| 23 | `OPAL_ORGANISATION_WEBSITE` | 1 | **header6** | organisation | `org_settings.settings.website` | `portal` | **yes** |
| 24 | `OPAL_LETTER_DOCUMENT_ID` | 1 | **footer6** | server | `LTR-` + first 8 of the draft uuid | `server` | **yes** (always minted) |

**24 unique tags, 26 occurrences.** A per-report `scalarOverrides` entry beats
every layer except `server` (which is read-only), and the structured recipient /
letter-details fields beat a raw override for the nine tags they own — those
fields are what the wizard writes and what the therapist can see.

### The `organisation` layer

`org_settings` is the portal's existing JSONB settings table. Two keying
conventions already exist in this codebase — `app-routes.js` writes the
installation-wide `'opal'` row, `scheduler-routes.js` reads a row keyed by the
organisation uuid — so `loadOrganisationSettings()` reads **both** and lets the
organisation-specific row win. Neither convention was changed.

`PATCH /api/settings/organisation` (owner only) now accepts
`businessAddress`, `businessPhone`, `businessEmail` and `website` so these can
actually be configured. **Until an owner sets them, they resolve to `missing`
and generation is refused.** Nothing is inferred from the organisation's name,
from the author's email domain, or from anywhere else.

### The preferred-name fallback

This is the one place a fallback exists, and it is **declared in the catalogue**
rather than implied by code: `OPAL_CLIENT_PREFERRED_NAME` names Splose's
`firstname` as its `fallbackField`. The letter puts the preferred name in
running prose, and an empty slot mid-sentence is worse than a given name. The
source attribution reads `splose` when the fallback was used, so the therapist
can always see which of the two they are looking at. The FCA declares **no**
fallback, so a first name is still never a preferred name there.

---

## 4. Required values, and why generation is refused

Six controls sit alone in a paragraph and can be cleaned away. **Every other
control shares its paragraph with sentence text or a literal label**, so there
is no way to remove it without mangling the page — and shipping the template's
own `[PORTAL — …]` placeholder to a plan manager is not an option.

So the rule is derived, not listed:

```
required  ⟺  the tag has no optional-line cleanup
```

18 tags are required. When any of them is unresolved, `POST .../generate`
returns **`400 missing_required_fields`** naming them in plain English
("Please complete: Recipient name, Subject, Business address."), writes nothing,
and stores no document. Every required tag is overridable, so the therapist can
always clear the block themselves.

Three independent guards make the promise true:

1. the required-value check before rendering;
2. whole-paragraph removal for the six optional lines during rendering;
3. `assertNoPortalPlaceholders(buffer)` — the finished package is re-opened and
   every control-bearing part scanned for `[PORTAL —` before a single byte is
   stored. Guards 1 and 2 live in different files against different lists; the
   promise is about the bytes that reach the recipient, and this is the only
   check that is actually about those.

---

## 5. Optional-line cleanup

| Tag | Paragraph in the template | When absent |
|---|---|---|
| `OPAL_LETTER_RECIPIENT_ROLE` | the control alone | whole `w:p` deleted |
| `OPAL_LETTER_RECIPIENT_ORGANISATION` | the control alone | whole `w:p` deleted |
| `OPAL_LETTER_RECIPIENT_ADDRESS` | the control alone | whole `w:p` deleted |
| `OPAL_THERAPIST_QUALIFICATIONS` | the control alone | whole `w:p` deleted |
| `OPAL_THERAPIST_AHPRA_NUMBER` | `"AHPRA registration: "` + control | whole `w:p` deleted |
| `OPAL_LETTER_CC` | `"CC: "` + control | whole `w:p` deleted |

Removing only the control would leave a naked `CC:` on the page. That is a
failure, not a cosmetic issue: it reads as an unfinished document to whoever
receives it.

`removeParagraphsContaining()` walks up from the control to the nearest
enclosing `w:p`, stopping at `w:body` or `w:tc` so it can never take a table
cell with it, and runs **before** the scalar pass so nothing is written into a
paragraph that is about to be deleted.

A value that is `null`, `undefined` or whitespace-only all count as absent.

---

## 6. Multiline values

A raw `\n` inside a `w:t` is **not** a line break in WordprocessingML — Word
renders it as a space. The only correct representation is a `w:br` element
between runs of text, and it must sit inside the **same `w:r`** so the
template's own `w:rPr` (font, size, colour) applies to every line rather than
only the first.

```xml
<w:r>
  <w:rPr>…the template's own run properties…</w:rPr>
  <w:t xml:space="preserve">Level 2, 88 Wellington Street</w:t>
  <w:br/>
  <w:t xml:space="preserve">East Perth WA 6004</w:t>
</w:r>
```

Four tags render this way, and the test suite asserts that this set is exactly
the set of controls the template declares as `w:text multiLine="1"`:
`OPAL_LETTER_RECIPIENT_ADDRESS`, `OPAL_LETTER_CC`,
`OPAL_THERAPIST_QUALIFICATIONS`, `OPAL_ORGANISATION_ADDRESS`.

The CC list is built from the structured `ccRecipients` array —
`"{name}, {organisation}"` per entry, one per line — so the therapist edits a
list, not a blob.

The FCA passes **no** multiline tags, so its rendering is byte-identical to
before.

---

## 7. Custom content

The anchor `OPAL_ANCHOR_LETTER_CUSTOM_SECTIONS` is replaced by one `w:sdt` per
custom block, in order, and then removed. With no custom content the anchor is
removed outright, leaving no trace of its placeholder prose.

```xml
<w:sdt>
  <w:sdtPr>
    <w:alias w:val="PORTAL LETTER SECTION — Equipment trial — CUSTOM"/>
    <w:tag w:val="OPAL_SECTION_LETTER_CUSTOM_EQUIPMENT_TRIAL_{UUID}"/>
    <w:id w:val="90000"/>
  </w:sdtPr>
  <w:sdtContent>
    <w:p><w:pPr><w:pStyle w:val="OPAL–BodyEmphasis"/></w:pPr>…label…</w:p>
    <w:p><w:pPr><w:pStyle w:val="OPAL–Body"/></w:pPr>…paragraph…</w:p>
  </w:sdtContent>
</w:sdt>
```

- **No heading style and no `w:outlineLvl`.** This document has no headings and
  no table of contents; a heading would look wrong on the page and there is
  nothing for it to be collected into. The FCA's TOC-rebuild concern does not
  apply, and TOC rebuilding is switched **off** for the letter explicitly rather
  than left to happen to find nothing.
- **The label is optional.** A letter block may legitimately be a bare
  paragraph, so the label paragraph is omitted entirely rather than emitted
  empty — an empty bold paragraph is a blank line in the middle of a letter.
  (The FCA keeps `requireTitle: true`: an FCA custom section is a heading and is
  meaningless without one.)
- **The body paragraph is always emitted**, even when empty, because it is what
  the therapist types into.
- **No `w:lock`.** A generated block is a starting point the therapist finishes
  in Word: it must remain fully editable and deletable.
- **The tag is always server-minted** and namespaced
  `OPAL_SECTION_LETTER_CUSTOM_…`, which cannot collide with any real template
  control — asserted against every tag in the shipped file. `w:id` values are
  allocated above the template's own and checked for collisions.
- Cap: 5 blocks, 120-character label, 2000-character body.

---

## 8. Storage

Migration **020**, additive throughout. **No parallel template, draft or
document tables**: the letter uses the 018 tables, generalised.

```sql
ALTER TABLE fca_templates      ADD COLUMN document_type VARCHAR(40) NOT NULL DEFAULT 'fca_report';
ALTER TABLE fca_report_drafts  ADD COLUMN document_type VARCHAR(40) NOT NULL DEFAULT 'fca_report';
ALTER TABLE fca_report_drafts  ADD COLUMN letter_recipient     JSONB NOT NULL DEFAULT '{}';
ALTER TABLE fca_report_drafts  ADD COLUMN letter_cc_recipients JSONB NOT NULL DEFAULT '[]';
ALTER TABLE fca_report_drafts  ADD COLUMN letter_details       JSONB NOT NULL DEFAULT '{}';
```

Every existing row is correct without being touched, and every existing query —
none of which filters on `document_type` — keeps its meaning.

Reused as-is, deliberately not duplicated under letter-specific names:
`selected_sections` (selected block tags), `section_order`, `custom_sections`
(custom content definitions), `scalar_overrides`, and the frozen
`scalar_snapshot` / `scalar_sources` / `missing_fields`.

Saved letter recipients go into the profile's existing
`fca_client_profiles.other_contacts` array; no column was added for them.

Also added: named `CHECK` constraints on `document_type` and on the JSONB
shapes, plus `(organisation_id, created_by_user_id, document_type, created_at)`
and `(document_type, is_active)` indexes.

The 018 template-immutability trigger applies unchanged: once a document has
been generated from the letter template row, that row is frozen.

---

## 9. API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/letters/template` | blocks, scalar tags, required and optional-line tags, recipient targets |
| GET | `/api/letters/clients?q=` | delegates to the shared FCA client search |
| GET | `/api/letters/clients/:clientId/contacts` | recipient suggestions from the client report profile |
| POST | `/api/letters/drafts` | `{ clientId, therapistProfileId? }` → `201 { draft }` |
| GET | `/api/letters/drafts` | own drafts of this document type only |
| GET | `/api/letters/drafts/:id` | frozen once generated |
| PATCH | `/api/letters/drafts/:id` | `recipient`, `ccRecipients`, `letterDetails`, `selectedSections`, `customSections`, `scalarOverrides` |
| POST | `/api/letters/drafts/:id/save-recipient-to-profile` | `{ target }` — **explicit only** |
| POST | `/api/letters/drafts/:id/generate` | `{ documentId, filename, missingFields, warnings }` |
| GET | `/api/letters/documents/:documentId/download` | binary DOCX, authenticated, own-draft only |
| DELETE | `/api/letters/drafts/:id` | archives, never destroys |

Filename: `Progress Note Letter - {PreferredName‖FullName} - {YYYY-MM-DD}.docx`,
every component sanitised.

### Contacts are derived, never invented

The profile stores support coordinator, nominee and referrer as **free text**,
because that is what a therapist types. The only split applied is the one every
writer already intends: the **first line is the person**, the **rest is their
address**. `role` is the name of the field the value was stored in — a fact, not
a guess — and `organisation` is left `null` rather than parsed out of prose. The
therapist edits the suggestion before it reaches a document. Entries in
`other_contacts` are already structured and are read, not reinterpreted.

---

## 10. Security and privacy

Identical rules to the FCA report, enforced independently in `letter-routes.js`:

- **Roles.** `therapist` / `owner` create, edit, generate and download their own
  letters. `read_only` reads. **`admin` has no access at all** — it is a
  non-clinical scheduling role here, and correspondence about a participant is
  clinical documentation.
- **Own-only drafts.** No role, owner included, reads another user's draft.
- **Organisation isolation.** Every query filters `organisation_id`. Cross-org
  is **404**, never 403 — "you may not see this" already leaks that it exists.
- **Document-type isolation.** An FCA draft id is a 404 on the letter routes and
  vice versa, so neither feature can be used to read the other's rows.
- **The snapshot is frozen at generate.** Download re-reads the stored bytes and
  never re-resolves. A later change to Splose, to a client profile, or to the
  organisation's letterhead cannot alter a letter that has already been issued —
  asserted end to end.
- **A generated letter cannot be edited** (`409 not_editable`).
- **Save-back is explicit.** Choosing a recipient writes nothing. Only
  `POST /save-recipient-to-profile` writes, only to the named target, and a
  target outside the fixed vocabulary is refused with nothing written.
- **Audit.** `letter.draft_created`, `letter.draft_archived`, `letter.generated`,
  `letter.downloaded`, `letter.recipient_saved_to_profile`. Rows carry ids,
  template version and counts — draft id, client id, therapist profile id,
  document id, section count, custom-section count, CC **count**,
  missing-field **count**. **Never a participant name, never a recipient name,
  never a line of clinical narrative**, asserted by searching the serialised
  metadata for every name used in the test.
- **Logs and client-facing errors** carry a message and a path, never a request
  body.
- **No public URL.** Downloads go through the authenticated, own-draft-only
  route and set `X-Content-Type-Options: nosniff`.
- The recipient snapshot columns hold identifiable third-party contact details.
  They are organisation- and user-scoped through the row they hang off, never
  audited and never logged.

---

## 11. Tests

| Suite | Tests |
|---|---|
| `backend/tests/letter-template-map.test.js` | 24 — the sha256 pin and the whole verified contract, discovered from the file |
| `backend/tests/letter-docx-engine.test.js` | 32 — composition against the real template |
| `backend/tests/integration/progress-note-letters.itest.js` | 49 — real Express, real SQL, real DOCX bytes |

The engine suite includes an "opens without repair" check that runs the produced
package through macOS `textutil` where it exists, and falls back to explicit
structural assertions (control/content nesting, `pPr` position) where it does
not — rather than silently passing on a claim it never checked.

---

## 12. Known limitations

1. **The letterhead must be configured before the first letter.** Until an owner
   saves `businessAddress`, `businessPhone`, `businessEmail` and `website`,
   generation is refused. This is deliberate — a letter that goes to a plan
   manager with a guessed business address would be worse than one that was
   never generated — but it is a setup step, and the error message is the only
   place it is currently surfaced.
2. **`OPAL_CLIENT_NDIS_NUMBER` is required.** It shares the participant line
   with the name and preferred name, so it cannot be cleaned away. For a
   non-NDIS client the therapist must override it (for example with
   "Not applicable") before generating.
3. **`OPAL_THERAPIST_QUALIFICATIONS` has no portal source.** No column holds
   free-text qualifications, so it is override-only; its line is simply dropped
   when unused. A future `therapist_profiles.qualifications` column would move
   it to the `portal` layer with no other change.
4. **`OPAL_THERAPIST_CREDENTIALS` is required but comes from the credentials
   table**, so an author with no active credential row must override it. This is
   the correct failure mode for external correspondence, but it will surprise a
   therapist whose credentials have not been entered yet.
5. **Contacts are parsed only as "first line = person, rest = address".** A
   coordinator's organisation stored inside the free-text blob will not be
   lifted into the structured `organisation` field. Nothing is guessed; the
   therapist fills it in, and `save-recipient-to-profile` with
   `target: 'saved_contact'` then stores it structurally for next time.
6. **Custom blocks carry no ordering relative to the template's own blocks.**
   They always render together at the anchor, between the last selected block
   and the sign-off, which is where the template puts them.
7. **The wizard's frontend is out of scope for this document.** The manifest is
   the contract; the preview must render `draft.manifest` and must not compute
   its own section list, values or source labels.
