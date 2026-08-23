# Service Agreements — developer guide

The Resource Hub's third document workflow, after the FCA report (`018`) and the
progress-note letter (`020`). Owners manage an **immutable master** Word
template; staff build agreements from it, issue a participant-facing **fillable
PDF**, and email a **secure completion link**; participants complete and sign
without a portal account.

Migration `037_service_agreements.sql`. Backend `backend/service-agreement-routes.js`
and `backend/service-agreements/*`. Frontend `frontend/current/serviceagreement.{js,css}`
and `service-agreement-sign.html`.

---

## Where it lives

**Templates → Service Agreement is the canonical home**, addressed as
`#resources/service-agreement`.

"Templates" is a *collection inside the Resource Hub*, not a top-level tab —
this portal has no Templates tab, and the Templates collection is already where
the FCA report and the progress-note letter live. So the Service Agreement is a
**native entry in that collection's grid**, rendered by `resourcehub.js` from
its `TOOLS` declaration, using the library's own card markup.

It is declared as a **workflow tool** rather than seeded as a `resources` row
because a workflow has no file, no version to review and no governance record —
it is code, and a `resources` row describing code would need a governance
lifecycle nobody could complete. What it *does* share with the rows beside it is
everything a person interacts with: the card, the collection, the search and the
category.

| | |
|---|---|
| Category | Agreements and forms |
| Collection | `templates` |
| Finds it | service agreement · ndis agreement · participant agreement · agreement · service booking |
| Permission (courtesy gate) | `service_agreements.access` |

### Routes

| Address | Screen |
|---|---|
| `#resources/service-agreement` | template overview |
| `#resources/service-agreement/new` | creation wizard |
| `#resources/service-agreement/<uuid>` | one agreement |
| `#resources/service-agreement/master` | owner master console |
| `#resources/service-agreement/versions` | master version history |

`#resources/agreements`, `#resources/service-agreements` and
`#resources/serviceagreement` normalise to the canonical address, ids intact.
The workflow briefly lived as a card mounted beside the hub with **no address of
its own**, so there is no released URL to redirect — these are the spellings a
person plausibly types. `encodeRoute(decodeRoute(x))` is idempotent, so there is
no redirect loop.

**Unchanged by the move:** every API endpoint, every document download URL, and
the participant signing link `/service-agreement-sign?token=…`. The signing page
is a served page outside the portal shell and has no portal navigation.

### One way in

The Templates card, a restored deep link and a contextual "Create service
agreement" on a participant record all call `SVA.route()`. There is deliberately
no second entry point and no second dashboard — **two places to manage one
master is how two masters get published.**

### The participant-record shortcut

Every participant's record (the `#cp-panel` drawer opened by
`openClientProfile()`) carries a **Documents → Create service agreement** action,
built by `mountClientServiceAgreement()` in `mockup_v3.html`.

It is a *shortcut*, not a second workflow. It calls `SVA.createFor(clientId)` —
the same entry point the Templates card uses — closes the drawer, switches to
the Resources tab and opens the same wizard. Templates → Service Agreement
remains the canonical home.

- **Shown only** to a user holding `service_agreements.access`. Owners hold it
  implicitly, so that one check covers owner, delegated administrator and
  delegated employee. Anyone else gets no section, and no orphaned heading —
  `hideDocumentsSection()` removes both, mirroring `hideAssessmentsSection()`.
- **Nothing about the participant travels in the URL.** The id is passed in a
  closure, not an attribute or a query string; the wizard's address is
  `#resources/service-agreement/new` and then the agreement's own server-minted
  uuid.
- **Preselection is confirmed first.** `startNew()` loads the *server-scoped*
  client list and only proceeds when the id is in it — so an id belonging to
  somebody the user may not see (including another organisation) falls back to
  the picker with a message rather than silently selecting the wrong person.
  The 200-client cap in `fca/client-search.js` means a very large practice can
  hit that fallback; it degrades to the picker, never to a wrong participant.
- **Styling** matches the drawer's existing action: the same full-width button
  in the same padded wrapper as "Book appointment", secondary rather than
  primary so booking stays the panel's main action.

### Who sees what

`visibleActions({ canManageMaster, canWord })` is the single place that decides,
and it decides from the **server's** flags on every load — the client never
infers anything from a role.

| | Owner | Administrator / employee |
|---|---|---|
| Use template | ✓ | ✓ |
| Draft / awaiting / completed lists | ✓ (practice) | ✓ (their own, or all with `view_all`) |
| Published version and last-updated date (read-only document control) | ✓ | ✓ |
| Manage master, edit clauses, upload, publish, retire | ✓ | ✗ |
| Download master Word · download agreement Word | ✓ | ✗ |
| Participant PDF preview | ✓ | ✓ |
| "Create service agreement" on a participant record | ✓ | ✓ (with `service_agreements.access`) |
| Version history, master hash, governance | ✓ | ✗ |

Participants never see the portal at all — only their own signing session.

---

## The one idea to hold onto

**There is one document, and the server composes it.**

Everything a participant sees — the Word file, the PDF, the wizard's live
preview, the signing page's field list — is derived from the *same composed
`.docx` bytes*. Nothing re-derives the agreement's structure anywhere else.

```
master .docx  ─┐
manifest.js   ─┼─→ docx.js ──→ COMPOSED .docx ─┬─→ (owner downloads Word)
clause snapshot┘   (fca/docx-engine)           │
                                               ├─→ docx-outline.js ─┬─→ pdf.js → AcroForm PDF
                                               │                    └─→ /preview → wizard panel
                                               └─→ signing page field list
```

That shape is why the PDF cannot say something different from the Word file, and
why an owner rewording a clause in Word flows into every surface with no second
data entry.

---

## Why the PDF is built from the Word file, not beside it

`opal-document-builder.js` builds DOCX and PDF **in parallel from one spec** —
the right pattern when the *portal* authors the content. It is the wrong pattern
here, because the content is the **owner's Word document**, which they edit in
Word. A parallel PDF renderer would need its own copy of every clause, and the
first reworded cancellation clause would make the two documents disagree about
money.

There is also **no DOCX→PDF converter available anywhere**: no LibreOffice, no
`soffice`, no headless Word, and the Azure staging runtime is a plain
`NODE|22-lts` image. So `docx-outline.js` reads the finished Word bytes into a
flat block list and `pdf.js` composes the PDF with `pdf-lib`.

The specification's fallback "deterministic marker pipeline" (insert markers →
convert → locate coordinates → redact → place widgets) exists for the case where
a converter *does* run but loses content-control coordinates. It is unnecessary
here and would be strictly worse: composing the PDF directly means field
coordinates are known **by construction**, with no marker to leak.

**A field is an empty content control.** `manifest.js` deliberately writes `''`
into every scalar it has no value for, so an empty control is a positive
statement — "this is a blank to be completed" — not an accident. That single
rule is the whole detection mechanism, and it is why the PDF and the Word file
cannot disagree about which fields are open.

---

## Three things the spec assumed that this repo did not have

Worth knowing before changing anything, because each forced a design decision.

| Assumed | Reality | What was done |
|---|---|---|
| A DOCX→PDF conversion engine | None exists; staging has no LibreOffice | Compose the PDF from the outline (above) |
| An organisation profile (ABN, NDIS registration, legal name) | `organisations` is `(id, name, created_at)`; `org_settings.settings` held four letterhead keys | `service-agreements/organisation.js` adds an owner-controlled `serviceAgreement` key inside the **existing** `org_settings`, with a real ATO ABN checksum |
| A participants table | None. Participants live in **Splose**; `client_id` is `TEXT` everywhere | Identity resolves live from Splose; everything Opal has never stored is **instance data on the agreement** |

That last row is the big one. Of the 61 portal-authority fields, the resolver
can fill roughly a third. **Funding management type, plan manager, participant
emergency contacts, communication and accessibility preferences, cultural safety
preferences, interpreter needs, continuity plan, every consent, and every agreed
support and rate have no column anywhere in this database.** They are collected
in the wizard, which is also where the field-authority model puts them.

`resolve.js` reports them as `missing` rather than guessing, and the wizard says
"Not recorded anywhere in Opal" rather than showing an empty box.

---

## Field authority — the trust boundary

Every one of the 83 scalars declares an authority in `template-map.js`, and it
is **enforced, not advisory**:

| Authority | Who may write it | Where the value comes from |
|---|---|---|
| `server` | Opal alone | `serverValuesFor()` — reference, version, status, template hash, issue date |
| `owner` | the practice | the organisation snapshot pinned at issue |
| `portal` | staff, via the wizard | `formData` — the only caller-supplied bag |
| `esign` | a completed signing session **only** | `signing.signatureValuesFor()` |

`manifest.js` consults `formData` **only** for `portal` tags. A signature, an
ABN or an agreement reference sitting in `formData` is silently ignored rather
than written — which is what makes "never accept signature values from an
ordinary form save" a structural fact rather than a rule somebody remembered.

`signing.signatureValuesFor()` is the **only** function in the codebase that
produces `esign` values, and it produces them from the session and the server
clock, never from the request body.

---

## Immutability

Three layers, because routes get rewritten:

1. **Publishing never overwrites.** `publishMaster()` retires the outgoing
   version and inserts a new row, inside one transaction. A partial unique index
   on `(organisation_id, template_key) WHERE status = 'published'` makes "two
   current masters" unrepresentable.
2. **Database triggers.** `trg_sa_master_immutable` freezes a published master's
   bytes, hash, manifest and snapshots. `trg_sa_immutable` freezes a signed
   agreement's content and refuses to move its pin. `trg_sa_artifact_immutable`
   refuses **any** update to an artifact.
3. **The pin.** At issue, the agreement stores the master version id, its
   SHA-256, the clause snapshot, the organisation snapshot, the pricing snapshot
   and the field-source manifest. Composition reads the *pinned* master, never
   the current one.

Publishing a new master therefore affects future agreements only — asserted
byte-for-byte in `service-agreements.itest.js`.

**Republishing** a historic version copies it to a *new* version rather than
reactivating the old row, because issued agreements point at version ids.

**Voiding a signed agreement is allowed.** Voiding is not editing: an agreement
signed in error or superseded by a renegotiated plan has to be markable as no
longer in force. The trigger guarantees not one byte of what was signed changes.

---

## Word is owner-only

A `.docx` is **editable**, so handing one to an employee makes the agreement's
wording negotiable by whoever holds the file — the single thing master
versioning exists to prevent. Staff get PDF.

Enforced by `requireOwner` on every route that sends Word, and asserted
*structurally* in `service-agreement-guards.test.js`: the test parses the route
file, finds every route calling `sendFile(..., DOCX_MIME)`, and fails if any one
of them lacks the guard. A Word route added next year is caught by that test.

`requireMasterAuthority` is **both** `role === 'owner'` **and**
`service_agreements.manage_master`, because the two checks refuse different
mistakes: the role check refuses an administrator granted the permission by
accident; the permission check refuses an owner who has not taken the power on.

---

## Schedule A is in two parts, and it matters

Measured from the v1.0 master, not assumed:

- `OPAL_REPEAT_SUPPORT_ROW` wraps a table row containing **five** columns —
  item number, description, delivery, frequency, rate. This row is **cloned once
  per agreed support**, with every `w:id` in the clone reallocated.
- A separate "Support-row detail" panel holds **seven more** fields — location,
  unit, quantity, total, funding period, travel terms, cancellation terms — with
  **one control each**. They describe the **first** support, and composition
  emits an explicit warning when there is more than one, rather than silently
  showing support 1's location under a table listing three.

Inventing a second repeat control to make all twelve per-support would break the
contract the owner's Word file actually declares.

---

## The template contract

| | |
|---|---|
| Accepted SHA-256 | `9c6bb10688ca5a5c322fb48a6901692f92c12045afb0cde270ca6dd1b13dee27` |
| Unique tags | 106 — **83 scalar**, **23 block** |
| Control occurrences | **126** = 124 `word/document.xml` + 1 `word/header6.xml` + 1 `word/footer6.xml` |
| Unique `w:id` | 124 |
| Nested controls | 81 |
| Inside the repeat row | 5 |

`validate-template.js` checks the **structure**, not the hash. A hash tells you
the file is byte-identical to one file — the wrong question for an owner who has
legitimately opened the master in Word and saved it, because Word rewrites the
package on every save. The seed hash is still recorded as *evidence*.

Uploads are refused for: macros (part **or** `macroEnabled` content type),
OLE/ActiveX/executable parts, path-traversing entry names, external
relationships, remote images, attached templates, missing tags, duplicate
`w:id`s, a broken repeat row, a missing anchor or internal block, missing Opal
styles, and a bracketed placeholder that has escaped a content control into body
text.

---

## Nothing internal reaches a participant

`OPAL_INTERNAL_COVER_CONTROL_NOTICE` and `OPAL_INTERNAL_OWNER_GOVERNANCE` are
removed from every participant-facing artefact — via the engine's one
nesting-aware removal path, by adding them to the section list as excluded.

Then the finished bytes are **scanned**:

- `assertNoForbiddenTokens()` — `[PORTAL —`, `[OWNER —`, `[SERVER —`,
  `[E-SIGN —`, `[INTERNAL —`, any raw `OPAL_*` tag, anchor and repeat markers.
- `assertNoInternalBlocks()` — the two tags, structurally.

Text is compared with **runs joined**, because Word splits a string across runs
freely and a per-node search would miss exactly the case that matters. Both
should be unreachable; they exist because three separate rules in three separate
files all have to hold, and the promise made to a participant is about the bytes.

---

## Signing sessions

The only unauthenticated surface in the portal.

- **The token is never stored** — only its SHA-256. A 32-byte random token has
  256 bits of entropy, so a slow hash would buy nothing and cost every page load.
- **Bound to one recipient.** A forwarded link still asks for the address it was
  issued to.
- **`assigned_tags` is frozen at issue** — not "the participant-editable fields"
  resolved at request time, so widening that category later cannot retroactively
  widen a live link.
- **Every failure looks the same.** Unknown, revoked, expired and locked all
  return "This link cannot be used." Distinguishing them tells somebody probing
  tokens which guess was close.
- **Nothing is revealed before verification** — only a masked email hint.

A signature here is a **typed name**, and the audit record says so:
`cryptographicSignatureApplied: false`, `signatureAssurance:
portal_typed_signature`. Nothing in this pipeline can produce or validate a
PKCS#7 signature, and labelling a typed name a digital signature would be a false
assurance in a legal document. A returned uploaded PDF records
`signatureAssurance: not_verified` for the same reason.

---

## Money

Integer cents throughout (`manifest.js`). `0.1 + 0.2` is not `0.3` in binary
floating point, and an agreement is a price list. `193.99 × 12` is `232788`
cents → `$2,327.88`, not `2327.8799999999997`.

A total that **cannot** be computed is left blank, never `$0.00` — `$0.00` in a
service agreement is a claim, and the wrong one. A total somebody typed is never
overwritten by the computed one.

Note `pg` returns `NUMERIC` as a **string**; there is no repo-wide coercion.

---

## Running it

```bash
cd backend && npm run migrate
```

The v1.0 master registers and publishes itself on first access, **after passing
validation** — a drifted seed fails loudly rather than becoming the practice's
live template.

Before any agreement can be created, the owner must complete the provider
identity (`PUT /api/service-agreements/settings` plus `businessAddress` on the
existing org settings route): legal name, ABN, complaints contact and business
address. An agreement that cannot name the provider is not a contract.

Email uses `email.sendTemplated()` — the shared transport, so
`_setTransporterForTests` still works. Unconfigured environments take the
documented `{ skipped: true }` path and the route returns the signing URL so the
flow stays testable. Env: `EMAIL_HOST`, `EMAIL_USER`, `EMAIL_PASS`, `EMAIL_FROM`,
`APP_BASE_URL`.

Local QA server: `opal-service-agreements-5012` in `.claude/launch.json`.

---

## Tests

| File | Covers |
|---|---|
| `service-agreement-template.test.js` | the tag contract; validator rejections built by mutating the real master |
| `service-agreement-compose.test.js` | manifest, authority, money, clause selection, DOCX composition, clone ids, placeholder leakage |
| `service-agreement-pdf.test.js` | AcroForm/NeedAppearances, widgets, locking, tooltips, text-layer leakage, **margin overflow** |
| `service-agreement-support.test.js` | clauses, sanitiser, signing, ABN, resolver restraint |
| `service-agreement-guards.test.js` | Word-is-owner-only and master-needs-both, structurally |
| `service-agreement-frontend-guards.test.js` | escaping on both surfaces, **the Templates placement, category, search terms, role-aware actions, routes and redirects**, participant-page rules |
| `integration/service-agreements.itest.js` | permissions, tenant + participant isolation, lifecycle, pinning, signing, audit |

The **margin-overflow** assertion in the PDF suite is not decorative — it caught
two clause bullets overhanging the right margin. The standard 14 fonts are not
embedded, so a viewer substitutes its own Helvetica whose advances differ
slightly from the AFM metrics `pdf-lib` measures with; body text is therefore
wrapped against a column `TEXT_SAFETY = 6`pt narrower than the one it is drawn
into.

`resource-file-quality.js` gained a `pdfTextItems()` op on its existing pdfjs
worker for that test. pdfjs 4 is ESM-only and importing it inside Jest's VM
fails; the worker is a plain Node realm, which is why it exists.

---

## Word never asks to update fields

Every Opal master inherited `<w:updateFields w:val="true"/>` from the original
FCA master. It tells Word to recalculate every field on open, and Word for Mac
announces that as

> This document contains fields that may refer to other files. Do you want to
> update the fields in this document?

The documents never referred to another file — measured across all three
masters, the only fields are TOC, PAGE and NUMPAGES, and there is not one
external relationship anywhere. A participant was being shown a security prompt
about a document that had nothing to fetch.

**`backend/docx-sanitiser.js`** is the fix, and it runs once for every document
type: `composeDocx()` calls it as its last act, after every value, section, row
and custom clause is in place, so the FCA report, the letter, the service
agreement and anything composed later are covered without each workflow
remembering to. `opal-document-builder.js` and the master download call it too.

It **removes** two things and **refuses** the rest:

| | |
|---|---|
| Removed | `w:updateFields` (document-wide) · `w:dirty="true"` (per field — the FCA TOC carried one) · a mail-merge data source |
| Refused | attached template · externally linked image · linked OLE object · external package/subdocument · `INCLUDETEXT`/`LINK`/`DDE`/`DDEAUTO`/`DATABASE`/`RD` · external `INCLUDEPICTURE` · macros · a hyperlink that is not http(s)/mailto |

Refusing rather than stripping is deliberate: an Opal document has no
legitimate external dependency, so one appearing means something upstream
changed that nobody reviewed. Generation fails with a precise audit log and a
bland user-facing message.

**Nothing is unlinked.** The TOC field and its cached result survive, so a
reader sees a populated contents list; a therapist refreshes it in Word on the
rare occasion they have moved a page boundary. Page numbers keep working.
Content controls, `OPAL_*` tags, ids, nesting, repeat rows, styles, numbering,
headers, footers and the embedded logo are untouched — the logo is *inside* the
package, which is why no external image relationship was ever needed.

Ordinary hyperlinks are left alone. A service agreement links to the NDIS
Commission and to the practice's complaints address, and those relationships
are `TargetMode="External"` because that is simply how Word stores a hyperlink.
An external hyperlink is a place the reader may choose to go; an external
template is content Word fetches on their behalf. Only the second is a
dependency.

### Corrected masters

| Template | Was | Now | Old sha256 | New sha256 |
|---|---|---|---|---|
| FCA report | `fca-v1.docx` | `fca-v1.1.docx` | `bf918d21…5b2782` | `5217d27d…1a78af` |
| Progress note / letter | `progress-note-letter-v1.docx` | `progress-note-letter-v1.1.docx` | `f6860967…3ed5c5` | `3f9a79e0…dfb9e0` |
| Service Agreement | `service-agreement-v1.0.docx` | `service-agreement-v1.0.1.docx` | `9c6bb106…3dee27` | `afb1e1e8…334d14` |

Each patch changes **`word/settings.xml` only** — plus `word/document.xml` in
the FCA's case, where the difference is exactly the removed `w:dirty`
attributes. Every other part is byte-for-byte the original, which is the
evidence that no clause, schedule or clinical content moved. A test asserts it.

The superseded files stay on disk for audit, and the repository guard exempts
them by name.

### The Service Agreement patch is automatic

An organisation on v1.0 is upgraded to v1.0.1 the next time its master is read
(`applySafetyPatchIfNeeded`). Publishing is normally a deliberate owner act
because it changes the legal document; this one is different and the difference
is provable — one Word setting, no content change — and leaving it manual would
mean participants kept seeing the warning until somebody pressed a button.

The clause configuration carries forward untouched, v1.0 is **retired rather
than rewritten**, and the audit records the reason.

**Agreements already issued keep their original pin and their original bytes.**
An agreement issued against v1.0 still says v1.0, still hashes to
`9c6bb106…`, and is served exactly as issued — so a Word copy downloaded for an
agreement issued *before* the patch still carries the warning. That is the
correct trade: an issued agreement is a record, and its recorded checksum is
what proves the bytes are the bytes. Its PDF was never affected.

---

## Two routing traps this feature hit

**A literal route declared after a parameterised one is unreachable.** Express
matches in declaration order, so `/api/service-agreements/access` sitting after
`/api/service-agreements/:id` was captured by the parameter, failed the uuid
test and returned 404 — for the owner too. The delegation endpoint existed and
could not be called by anybody. Literal routes come first; there is an
integration test that would catch it happening again.

**A cached asset hides a frontend change completely.** `mockup_v3.html`
cache-busts every asset with `?v=`. Changing `resourcehub.js` without bumping
`?v=r16` meant the browser kept serving the old file and the new card simply
never appeared. Bump the version with the file.

---

## Where to be careful

- **`tests/integration/helpers.js`** — a new table must be added to
  `ALL_TABLES` or rows leak between tests. Add **only** your own tables:
  adding `interview_records` while building this feature broke 16 FCA
  integration tests.
- **`fca/docx-engine.js`** is shared by three document types. The repeat-row
  support added here is opt-in via `manifest.repeatRows`; FCA and letter
  behaviour is unchanged and covered by their own 287 tests.
- **The client never decides a permission.** `canDownloadWord` and
  `canManageMaster` come from the server on every load.
