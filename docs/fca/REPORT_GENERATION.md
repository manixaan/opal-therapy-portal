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
| `backend/fca-routes.js` | API, RBAC, organisation isolation, persistence, storage, audit | no |
| `backend/migrations/018_fca_reports.sql` | Templates, profiles, plans, goals, drafts, documents, presets | — |

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
| Server-issued | server only | `readOnly` — a submitted override is ignored, never applied |

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
| 26 | `OPAL_REPORT_DOCUMENT_ID` | 3 | Server-issued | server.documentReference | rejected — `server_issued` |
| 27 | `OPAL_REPORT_DATE` | 2 | Server-issued | server.reportDate | rejected — `server_issued` |
| 28 | `OPAL_REPORT_VERSION` | 2 | Server-issued | server.reportVersion | rejected — `server_issued` |
| 29 | `OPAL_REPORT_STATUS` | 1 | Server-issued | server.reportStatus | rejected — `server_issued` |
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
- **Server-issued (4):** document id, report date, version, status.
- **Missing by design:** any of the above with no data. Only the 4 server-issued
  tags are guaranteed to resolve, because the server mints them itself.

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
| Engine + template facts | `backend/tests/fca-docx-engine.test.js` | 33 |
| Resolver + manifest | `backend/tests/fca-resolve-scalars.test.js` | 29 |
| Routes, isolation, profiles, audit | `backend/tests/integration/fca-reports.itest.js` | 35 |

The engine tests run against the **real** `fca-v1.docx` and assert by unzipping
the produced package — the only thing that matters is what Word receives.
