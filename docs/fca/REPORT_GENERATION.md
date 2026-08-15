# FCA Report Generation

How the Opal Functional Assessment Report is composed, where every value on the
page comes from, and what is deliberately left blank.

Everything here is server-side and self-contained. **No external AI is involved
at any point in this feature**, and no client data leaves the deployment.

---

## 1. Architecture

```
Splose ─┐
        │  (live, per request)
        ▼
   resolve-scalars.js ──► manifest.js ──► docx-engine.js ──► .docx bytes
        ▲     ▲                 │                              │
        │     │                 └──► preview (same object)     └──► storage
        │     │
  client profile   report overrides
  (fca_client_*)   (draft.scalar_overrides)
```

| File | Role | Pure? |
|---|---|---|
| `backend/fca/template-map.js` | Static description of `fca-v1.docx`: sections, scalar tags, layer ownership, style ids, limits | yes |
| `backend/fca/resolve-scalars.js` | Four-layer precedence and per-tag source attribution | yes |
| `backend/fca/manifest.js` | Composes the manifest; enforces required sections server-side | yes |
| `backend/fca/docx-engine.js` | Renders the manifest into a validated `.docx` | yes |
| `backend/fca/preview-pagination.js` | Restates the template's `w:pageBreakBefore` breaks as explicit break runs, for the browser preview only | yes |
| `backend/fca/document-id.js` | Issues the document reference, date, version and status; shared with the letter | yes |
| `backend/fca-routes.js` | API, RBAC, organisation isolation, persistence, storage, audit | no |
| `backend/migrations/018_fca_reports.sql` | Templates, profiles, plans, goals, drafts, documents, presets | — |
| `backend/migrations/022_document_control_and_excluded_fields.sql` | `document_control` + `excluded_fields` on the shared draft table | — |

### The wizard is four steps

1. **Client** — search the practice record.
2. **Therapist** — who is preparing the report.
3. **Review data** — every resolved value with the layer it came from.
4. **Sections & document** — the section picker and ordering on the left, the
   live document on the right, and one primary action at the foot of the
   dialog: **Download Word document**.

Choosing sections, previewing and generating used to be three stages. They are
one, because they are one decision: a therapist ticks a section and watches it
appear in the real document beside it. The frontend maps a stored step of 5 or 6
— the old Preview and Generate stages — onto step 4 (`fcaMapStep` in
`frontend/current/fca.js`), so no draft or bookmark saved under the old
numbering becomes unreachable.

Download composes from the therapist's LATEST intent: any debounced section edit
and any in-flight save land first, then `POST /generate` runs, and only then is
the finished document handed over. Nothing else in the file starts a download.

### Preview pagination — a renderer limitation, corrected at the document layer

The preview endpoint streams the composed `.docx` to the vendored
[docx-preview](../../frontend/current/vendor/DOCX_PREVIEW_VENDORED.md) build in
the browser. That renderer breaks pages on exactly two things: a
`w:br w:type="page"` run, and a section break.

The Opal template starts each major section on a new page the way Word authors
normally do it — `w:pageBreakBefore` in the paragraph's properties, nineteen of
them. docx-preview 0.4.0 **parses that property and never acts on it**, so the
whole report rendered as ONE page element: a single sheet metres long, with no
page boundaries.

`fca/preview-pagination.js` restates each of those breaks as the explicit break
run the renderer reads, for the preview stream only:

- nothing is invented — every inserted break stands where the template already
  said "new page", and no break is added between arbitrary paragraphs;
- no break is inserted before the first element, or where the previous element
  already ends the page (a section break, or an existing page-break run), since
  either would render an empty page;
- content controls are walked through, because the renderer flattens them
  before it groups pages;
- **the download is untouched.** Word honours `w:pageBreakBefore` natively, and
  the file the therapist edits is the engine's own output, byte for byte.

A full report renders as 22 page elements instead of 3. Three of those elements
hold more than one Word page: docx-preview does not reflow text, so a section
whose content exceeds one page grows its element rather than splitting it. The
panel says so — *"final pagination and page numbering may differ slightly in
Microsoft Word"* — and `backend/tests/fca-preview-pages.test.js` runs the real
renderer over a real composed document to hold all of this in place.

### The manifest is the single source of truth

The server composes the manifest, the DOCX engine consumes it, and the wizard
preview renders **the same object**. The frontend never computes its own section
list, scalar values or source labels. If it did, the preview a therapist
approved could differ from the document that reached a plan manager — which is
the specific failure this design exists to prevent.

```js
manifest = {
  scalarData:    { TAG: value | null },
  scalarSources: { TAG: 'splose' | 'client_profile' | 'report_override'
                      | 'portal' | 'server' | 'missing' },
  excludedTags:  [TAG],
  sections: [{ tag, kind: 'required'|'optional'|'custom', group, title,
               guidance?, included, order }]
}
```

### Verified template facts (`fca-v1.docx`, sha256 `bf918d21…5b2782`)

Asserted by `backend/tests/fca-docx-engine.test.js` against the shipped file, so
none of this can silently drift.

- **58** unique `w:tag` content controls across **84** occurrences
- **25** section-or-anchor controls, **33** scalar controls
- **17** unique `OPAL_CLIENT_*` tags — discovered dynamically, never hard-coded
- **15** scalar tags repeat, the most (`OPAL_THERAPIST_FULL_NAME`) **5** times
- Parts carrying controls: `word/document.xml` (81), `word/header6.xml` (2 —
  `OPAL_CLIENT_PREFERRED_NAME`, `OPAL_CLIENT_NDIS_NUMBER`), `word/footer6.xml`
  (1 — `OPAL_REPORT_DOCUMENT_ID`). **A body-only implementation ships blank
  headers**, so parts are walked generically.
- Optional controls are **nested inside required parents**: 5 assessment tools
  inside `ASSESSMENT_METHOD`; 9 domains plus the custom anchor inside
  `ASSESSMENT_RESULTS`; 2 recommendation groups inside
  `SUMMARY_RECOMMENDATIONS`. `APPENDICES` is optional and top-level.
- A real TOC field (`TOC \o "1-3" \h \z \u`) with `w:updateFields` in settings
- `PAGE` fields live in `footer5.xml` and `footer6.xml` (one each). **There is
  no `NUMPAGES` field anywhere in this template** — the "PAGE/NUMPAGES" phrasing
  in the brief overstates it. The engine asserts both counts are unchanged, so
  a future template that adds `NUMPAGES` is covered without a code change.
- Style ids use an **EN DASH with no spaces**: `OPAL–Body`, `OPAL–Heading2`,
  `OPAL–Heading3`, `OPAL–Placeholder`, `OPAL–ClinicalPrompt`

---

## 2. Four-layer precedence

1. **Splose** — live client data, the system of record for identity and contact
2. **Client profile** — organisation-scoped durable facts Splose has no field for
3. **Report overrides** — this draft only
4. **Generation snapshot** — the frozen result of 1–3

Layer 4 is not a resolution input; it is what the resolution *becomes* at
generate time. **The download route re-reads the snapshot and never
re-resolves**, so an issued document cannot quietly change when Splose or a
profile does.

Resolution order depends on which layer *owns* the tag:

| Tag class | Order | Notes |
|---|---|---|
| Splose-authoritative | override → **splose** → missing | **The profile is not consulted at all.** A stale profile copy of a name, NDIS number, address, email or phone must never shadow the live record. If Splose is blank the tag is `missing` — it is never borrowed from the profile. |
| Profile-owned | override → client_profile → missing | Backed by a profile column or the **current** NDIS plan |
| Portal | override → portal → missing | Assessor/organisation facts from this database |
| Report-specific | override → missing | Belongs to one report; nowhere else to come from |
| Opal-issued | override → **server** → missing | Issued once at draft creation and stored. The issued value is a **default, not a decree** — see below |

### Document control is issued, not looked up

Document ID, report date, version and status used to be minted at generate time
and shown as **Missing** in the review step. That was a category error: a
therapist cannot go and find the id of a document that does not exist yet.

They are now **issued once, when the draft is created**, and stored in
`fca_report_drafts.document_control`:

| Tag | Issued value |
|---|---|
| `OPAL_REPORT_DOCUMENT_ID` | `FCA-{first 8 of the draft uuid, upper case}` |
| `OPAL_REPORT_DATE` | the creation date, `dd/mm/yyyy` |
| `OPAL_REPORT_VERSION` | `1.0` |
| `OPAL_REPORT_STATUS` | `Draft` |

- They resolve with source **`server`** and render with the badge
  **"Generated by Opal"** — never "Missing".
- **Reading, not minting.** Generate re-reads the stored row, so **regenerating
  a draft can never renumber it**. A draft created before this behaviour existed
  carries `{}` and is resolved from its own id and `created_at`, which yields
  exactly the reference it would always have had.
- **They are overridable.** A therapist genuinely issuing version 2.0, or
  marking a report Final, is stating a fact about their own document; the
  override wins and the badge changes to "Entered for this report". There is no
  `readOnly` behaviour on these tags any more.

**Nothing else is auto-filled.** Issue date, reviewer name, reviewer role and
authorised recipients stay `missing` until a human supplies them. They are facts
about the world — a date that has not happened, a second clinician, a consent
decision only the participant can make — and a plausible-looking guess in a
clinical document is worse than a visible gap. The same principle governs every
client and therapist fact in the table above.

### Excluding a field

A therapist may say outright that a field does not apply. That is a different
statement from "we could not find this", and produces a different document.

| State | In the review step | In the .docx |
|---|---|---|
| Has a value | the value + its source badge | the value |
| **Missing** | "No value" + `Missing` badge | the template's own `[PORTAL — …]` placeholder, styled for completion |
| **Excluded** | "Excluded — nothing will be inserted", row de-emphasised, input disabled | **an empty content control** — still there to type into in Word, but blank |

- Persisted as `fca_report_drafts.excluded_fields` (JSONB array, migration
  `022`), accepted on `PATCH` as `excludedFields`, carried on the manifest as
  `excludedTags`, and **frozen with the rest of the snapshot** at generate.
- **Replaced, not merged.** Exclusion is a set the therapist owns outright; a
  merge could not express un-excluding.
- **Excluding clears any override** for that tag. Un-excluding therefore falls
  back to whatever the layers resolve, rather than resurrecting a value the
  therapist last saw struck through.
- **An excluded field never blocks generation**, even one the template otherwise
  requires. The guard that matters — no unresolved `[PORTAL — …]` placeholder in
  the produced bytes — still holds, because the control is emptied rather than
  left alone.
- Unknown tags are dropped rather than trusted, exactly as section tags and
  overrides are.

The review step carries one quiet inline note above the field list, worded
identically in both builders:

> If we do not hold this information, you can leave it blank and complete it in
> Word after downloading — or exclude it so nothing is inserted.

### Source vocabulary — a documented superset

The API contract names four values: `splose`, `client_profile`,
`report_override`, `missing`. Those keep their exact meaning. Two more are
emitted: **`portal`** and **`server`**. Collapsing an assessor's AHPRA number
into `splose`, or a server-minted document id into `client_profile`, would be
false attribution — and the entire point of this field is that a therapist can
trust the badge next to a clinical fact. Frontends should treat the vocabulary
as open and render an unknown source by its own name.

### Missing is flagged, never fabricated

Nothing infers, derives or guesses. A first name is **not** a preferred name and
is never substituted. Empty strings, whitespace and null are all absent. An
absent value resolves to `null` with source `missing`, is listed in
`missingFields`, and the engine leaves the template's own placeholder on the
page — so the gap is visible in the document rather than papered over. The
strings `null` and `undefined` can never reach the page.

---

## 3. Complete tag-to-source mapping (all 33 scalar tags)

| # | Tag | Occ | Layer | Resolved from | Save-back |
|---|-----|-----|-------|---------------|-----------|
| 1 | `OPAL_CLIENT_FULL_NAME` | 3 | Splose-authoritative | splose.fullName | rejected — `splose_authoritative` |
| 2 | `OPAL_CLIENT_NDIS_NUMBER` | 4 | Splose-authoritative | splose.ndisNumber | rejected — `splose_authoritative` |
| 3 | `OPAL_CLIENT_ADDRESS` | 1 | Splose-authoritative | splose.formattedAddress | rejected — `splose_authoritative` |
| 4 | `OPAL_CLIENT_EMAIL` | 1 | Splose-authoritative | splose.email | rejected — `splose_authoritative` |
| 5 | `OPAL_CLIENT_PHONE` | 1 | Splose-authoritative | splose.mobilePhone | rejected — `splose_authoritative` |
| 6 | `OPAL_CLIENT_PREFERRED_NAME` | 2 | Client profile | fca_client_profiles.preferred_name | eligible |
| 7 | `OPAL_CLIENT_DATE_OF_BIRTH` | 1 | Client profile | fca_client_profiles.date_of_birth | eligible |
| 8 | `OPAL_CLIENT_PRONOUNS` | 1 | Client profile | fca_client_profiles.pronouns | eligible |
| 9 | `OPAL_CLIENT_PRIMARY_DISABILITY` | 1 | Client profile | fca_client_profiles.primary_disability | eligible |
| 10 | `OPAL_CLIENT_OTHER_CONDITIONS` | 1 | Client profile | fca_client_profiles.other_conditions | eligible |
| 11 | `OPAL_CLIENT_NOMINEE_DETAILS` | 1 | Client profile | fca_client_profiles.nominee_details | eligible |
| 12 | `OPAL_CLIENT_SUPPORT_COORDINATOR_DETAILS` | 1 | Client profile | fca_client_profiles.support_coordinator_details | eligible |
| 13 | `OPAL_CLIENT_REFERRER_DETAILS` | 1 | Client profile | fca_client_profiles.referrer_details | eligible |
| 14 | `OPAL_CLIENT_NDIS_PLAN_START` | 1 | Client profile | current plan.plan_start | eligible |
| 15 | `OPAL_CLIENT_NDIS_PLAN_END` | 1 | Client profile | current plan.plan_end | eligible |
| 16 | `OPAL_CLIENT_NDIS_GOAL_1` | 1 | Client profile | current plan goal #1 | eligible |
| 17 | `OPAL_CLIENT_NDIS_GOAL_2` | 1 | Client profile | current plan goal #2 | eligible |
| 18 | `OPAL_THERAPIST_FULL_NAME` | 5 | Portal (this DB) | portal.therapistName | rejected — `not_client_data` |
| 19 | `OPAL_THERAPIST_CREDENTIALS` | 4 | Portal (this DB) | portal.therapistRoleTitle | rejected — `not_client_data` |
| 20 | `OPAL_THERAPIST_EMAIL` | 3 | Portal (this DB) | portal.therapistEmail | rejected — `not_client_data` |
| 21 | `OPAL_THERAPIST_PHONE` | 3 | Portal (this DB) | portal.therapistPhone | rejected — `not_client_data` |
| 22 | `OPAL_THERAPIST_ORGANISATION` | 2 | Portal (this DB) | portal.organisationName | rejected — `not_client_data` |
| 23 | `OPAL_THERAPIST_AHPRA_NUMBER` | 2 | Portal (this DB) | portal.ahpraNumber | rejected — `not_client_data` |
| 24 | `OPAL_THERAPIST_QUALIFICATIONS` | 2 | Report-specific | report override only | rejected — `report_specific` |
| 25 | `OPAL_THERAPIST_PROVIDER_NUMBER` | 2 | Report-specific | report override only | rejected — `report_specific` |
| 26 | `OPAL_REPORT_DOCUMENT_ID` | 3 | Opal-issued | `FCA-{uuid8}`, at creation | rejected — `server_issued` |
| 27 | `OPAL_REPORT_DATE` | 2 | Opal-issued | creation date, dd/mm/yyyy | rejected — `server_issued` |
| 28 | `OPAL_REPORT_VERSION` | 2 | Opal-issued | `1.0` | rejected — `server_issued` |
| 29 | `OPAL_REPORT_STATUS` | 1 | Opal-issued | `Draft` | rejected — `server_issued` |
| 30 | `OPAL_REPORT_ISSUE_DATE` | 2 | Report-specific | report override only | rejected — `report_specific` |
| 31 | `OPAL_REPORT_REVIEWER_NAME` | 1 | Report-specific | report override only | rejected — `report_specific` |
| 32 | `OPAL_REPORT_REVIEWER_ROLE` | 1 | Report-specific | report override only | rejected — `report_specific` |
| 33 | `OPAL_REPORT_AUTHORISED_RECIPIENTS` | 1 | Report-specific | report override only | rejected — `report_specific` |

The 25 section-or-anchor controls are listed in `template-map.js` (`SECTIONS`
plus `OPAL_ANCHOR_CUSTOM_SECTIONS`); 7 are required and 17 optional.

### Which tags are which

- **Splose-authoritative (5):** full name, NDIS number, address, email, phone.
- **Client-profile owned (12):** preferred name, date of birth, pronouns,
  primary disability, other conditions, nominee, support coordinator, referrer,
  plan start, plan end, goal 1, goal 2. These are exactly
  `template.profileEligibleTags`.
- **Portal (6):** assessor name, credentials, email, phone, organisation, AHPRA.
- **Report-specific (6):** qualifications, provider number, issue date, reviewer
  name, reviewer role, authorised recipients.
- **Opal-issued (4):** document id, report date, version, status — minted at
  draft creation and stored, overridable, never renumbered.
- **Missing by design:** any of the above with no data. Only the 4 Opal-issued
  tags are guaranteed to resolve, because Opal originates them itself.

**Therapist qualifications and provider number** are durable *therapist* facts,
but the profile layer is **client-scoped** — there is nowhere to save them back
to — so they are report overrides only. A therapist-profile layer would be the
right home for them in a future version.

---

## 4. Client profile layer

`fca_client_profiles` is keyed `UNIQUE (organisation_id, splose_client_id)`. Two
organisations can hold independent profiles for the same Splose client and never
see each other's clinical context.

**Holds:** preferred name (where different), pronouns, date of birth, primary
disability, other conditions, nominee/guardian, support coordinator, referrer,
other reusable contacts — plus versioned NDIS plans and their structured,
repeatable goals.

**Never holds:** report date/id/version/status, reviewer, approver, authorised
recipients, referral reason, assessment purpose, report-specific clinical
conclusions, or any report override. `save-to-profile` rejects all of them.

### Plan versioning

A plan is **never overwritten**. A new plan supersedes the old one by inserting a
new row with `is_current = TRUE` and clearing the previous flag; a partial unique
index enforces at most one current plan per profile. Old plan dates and their
goals stay attached and queryable forever — which is what makes a report issued
last year still explicable this year.

### Goals and the two-control limit

Goals are stored unbounded and ordered by `sort_order`. **`fca-v1` exposes only
`OPAL_CLIENT_NDIS_GOAL_1` and `_2`**, which map to the current plan's **first two
goals, in order**. A third or later goal is retained and queryable but has no
control to render into. A future template version can expose more with no data
migration.

### Save-back is explicit and permissioned

Nothing writes to a profile implicitly — **not on PATCH, not on generate**. Only
`POST /api/fca/drafts/:id/save-to-profile` writes, only for
`profileEligibleTags` that carry a value on this draft, and only for the fields
the therapist names. A request naming **any** ineligible field writes **nothing
at all** and returns `400` with a per-tag reason
(`splose_authoritative` · `not_client_data` · `server_issued` ·
`report_specific` · `unknown_tag` · `no_value_on_draft`) — partial success would
leave the therapist unsure what was actually saved. Plan and goal fields always
create a **new plan version**.

---

## 5. Access control

| Role | Access |
|---|---|
| `therapist`, `owner` | Create, edit, generate and download **their own** drafts; read and write client profiles in their organisation |
| `read_only` | Read the template, client list and profiles. No writes, no generation |
| `admin` | **No access at all.** Admin is a non-clinical scheduling role in this deployment (see `permissions.js`) and an FCA is clinical documentation |

- **Own-only drafts**, matching case-note drafts: no role — owner included —
  reads another user's draft. A draft carries unfinished clinical reasoning.
- **Organisation isolation** on every profile and draft query. A cross-org
  request returns **404, not 403** — "you may not see this" already leaks that
  it exists.
- Downloads are authenticated and own-draft-only. There is never a public URL.

### Privacy

No client identity and no clinical content in logs, audit payloads or
client-facing errors. `fca.report_generated` records `{ draftId, clientId,
therapistProfileId, templateVersion, sectionCount, customSectionCount }`;
`fca.client_profile_updated` records the client id and **field names only**,
never values.

### Splose availability

If Splose is unreachable the API returns **503 `splose_unavailable`**. A client
list is never fabricated and a partial client record is never invented.

---

## 6. The DOCX engine

`generateFcaDocx({ templateBuffer, manifest }) → Buffer` — pure: no DB, no
network, no filesystem, no clock. The returned Buffer carries an attached
`fcaStats` property (`scalarsWritten`, `removedSections`, `customSections`,
`tocEntries`, `warnings`) for tests and the generate route's warning channel;
the bytes are what callers actually consume.

Order of operations, which matters:

0. **Exclusions** are resolved first, into one of two shapes chosen by the
   template's own declaration, not by the caller. A tag listed in
   `dropParagraphWhenEmpty` joins the optional-line cleanup and loses its whole
   `w:p`; every other excluded tag is rewritten to an **empty string** so the
   control survives blank rather than keeping its placeholder. This is a single
   option through `composeDocx` (`manifest.excludedTags`) — nothing else in the
   pipeline special-cases it.
1. **Remove** unselected sections — delete exactly the `w:sdt` whose **own**
   `w:sdtPr/w:tag` carries the tag. Lookups are strictly direct-child, so a
   nested optional can be removed while its required ancestor is structurally
   safe. A descendant-matching implementation would delete the parent and take
   most of the report with it.
2. **Reorder** included sections among their own siblings, in place, using
   marker nodes so the parent's own paragraphs keep their positions.
3. **Custom sections** replace the anchor: one `w:sdt` each, unique `w:id`, tag
   `OPAL_SECTION_CUSTOM_{SLUG}_{UUID}` (always server-minted — a client-supplied
   tag could collide with a real control), a heading styled `OPAL–Heading2` with
   an explicit `w:outlineLvl` so it reaches the TOC, an optional guidance
   paragraph (`OPAL–Placeholder`), and an empty `OPAL–Body` paragraph. With no
   custom sections the anchor is removed entirely.
4. **Scalars**, across every control-bearing part. The value goes into the first
   `w:t` of the control and the remaining `w:t` nodes are blanked, so every
   `w:rPr` survives untouched. `w:showingPlcHdr` is cleared so Word does not
   re-substitute its placeholder. Text outside content controls is never touched.
5. **TOC** last, because the body must be final.
6. **Validate**, then return.

### TOC: what is rebuilt and what is honestly impossible

The real field and `w:updateFields` are both preserved, and the cached entries
are regenerated from the **final** body — after removals and custom-section
insertion. Entry paragraphs are cloned from the template's own cached entries,
so TOC1/TOC2/TOC3 styling, fonts, colours and dot leaders are the template's.
Scalars are populated *before* the rebuild, so the cover-page heading contributes
the participant's real name rather than the template placeholder.

**Page numbers cannot be computed without Word.** Pagination depends on a layout
engine — line breaking, widow/orphan control, table row splitting, the rendered
height of every block. Nothing in this process can know which page a heading
lands on, and a plausible-looking wrong number in a clinical document is worse
than none. Rebuilt entries therefore carry the correct **titles, order and
level** with an **empty page-number slot**; `w:updateFields="true"` makes Word
fill them the moment the document opens, and the template's own reminder to
update the field before issue is left in place. The entry list is never stale —
only the page numbers, and visibly so rather than wrongly.

One related honesty note: removing an optional section removes its control and
its headings, but **static prose outside any control is never touched**. The
summary table in "Assessment activities" still lists every assessment tool by
name, including deselected ones, because that table is template content the
therapist edits — not part of the optional control.

### Validation before any byte is returned

Zip integrity; every original part still present **and no unexpected part
added**; every modified part well-formed XML; no dangling relationship id; and
footer `PAGE`/`NUMPAGES` counts byte-identical to the template's. Failure throws
descriptively rather than shipping a document Word will offer to repair.

---

## 7. Publishing a new template version

`fca_templates` rows are **immutable once generated from** — a trigger refuses
any change to `template_key`, `version`, `name`, `storage_path` or `checksum`
when a generated document references the row. Reproducing an issued report a
year later has to mean re-running the exact same template. Toggling `is_active`
is still allowed: that retires a version without rewriting it.

To publish `v2`:

1. Add `backend/fca/templates/fca-v2.docx`.
2. Update `template-map.js` — bump `TEMPLATE_VERSION`, and re-derive `SECTIONS`,
   `SCALAR_TAGS` and every `occurrences` count **from the real file**. The
   engine test asserts the map against the shipped template, so a mismatch fails
   the build rather than shipping a wrong document.
3. Insert a new `fca_templates` row and set the old one `is_active = FALSE`.
4. Existing drafts keep their `template_id`/`template_version`; generated
   documents keep theirs. Nothing is retrospectively re-rendered.

---

## 8. Tests

| Suite | File | Tests |
|---|---|---|
| Engine + template facts + exclusion | `backend/tests/fca-docx-engine.test.js` | 41 |
| Resolver, manifest, document control, exclusion | `backend/tests/fca-resolve-scalars.test.js` | 44 |
| Frontend helpers + source guards | `backend/tests/fca-frontend-helpers.test.js` | 62 |
| Routes, isolation, profiles, audit, exclusion | `backend/tests/integration/fca-reports.itest.js` | 41 |

The engine tests run against the **real** `fca-v1.docx` and assert by unzipping
the produced package — the only thing that matters is what Word receives.
