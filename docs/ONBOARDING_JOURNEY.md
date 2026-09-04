# The onboarding journey — starter packs, returned documents, accounts

Migration `038_onboarding_starter_packs.sql`. Backend
`backend/onboarding-workflow-*.js`, `onboarding-starter-pack.js`,
`onboarding-extraction.js`, `onboarding-accounts.js`,
`onboarding-package-docs-routes.js`, `graph-mail.js`. Frontend
`frontend/current/onboarding.{js,css}` and `create-password.html`.

Companion to [ONBOARDING_PACKAGES.md](ONBOARDING_PACKAGES.md), which describes
the requirement workflow this builds on. Read that one first.

---

## What this adds, and why

034 gave the practice a requirement workflow reached through a secure
invitation link. That model is good and it stays. What it did not describe is
the part that actually happens first in a small practice:

> A new starter is emailed a pack of forms. They fill them in and send them
> back. Somebody then retypes thirty fields into the portal.

This feature removes the retyping, and nothing else about 034 changes.

```
Owner starts onboarding
  → the system recommends a package from the role and employment type
  → a starter-pack ZIP is generated from the PINNED package version
  → it is emailed (attached, or a secure link when it is too large)
  → the completed forms come back
  → the Owner uploads them; the originals are kept forever
  → the details are read out of them, through the governed AI gateway
  → the Owner accepts / corrects / discards each one
  → a portal account is created with a temporary password
  → the sign-in email goes out
  → the employee signs in, is FORCED to change their password,
    and finds their details already filled in
  → they check, correct and complete
  → the Owner watches the status advance on its own
```

Every step is resumable and idempotent, because in practice the Owner will
double-click, the network will drop, and SMTP will be down on the day somebody
starts.

---

## The two ways in, and why both exist

| Path | Credential | When |
|---|---|---|
| **Invitation link** (034) | The new starter chooses their own password on a single-use link | The safer default. Still one click away, from the workspace: *"Invite them to the portal instead"* |
| **Temporary password** (038) | The system generates one; the Owner passes it on | When the paper round-trip happened first and the Owner is creating the account themselves |

`onboarding-assignment-routes.js` documents the original decision — *"No
temporary password is ever generated or emailed"* — and that judgement was
right for the invitation path. The second path was a deliberate reversal
requested for the round-trip flow, and it is made safe by three things that
hold regardless of how the credential travels:

1. **`must_change_password` gates every authenticated path** except the
   password change itself, at the single `requireAuth` choke point in
   `permissions.js`. Not by hiding buttons — a temporary credential cannot
   reach the employee's own onboarding, let alone anything else.
2. **`temp_password_expires_at` is checked at LOGIN**, so an unused credential
   stops working on its own (7 days by default, 30 maximum).
3. **Changing the password clears both flags in the same statement** that sets
   the hash, so the temporary credential cannot outlive its replacement.

The plaintext is returned exactly once — in the create-account response, with
`Cache-Control: no-store` — and is never stored, never logged, and never
placed in an audit record. Losing it means reissuing, which is correct.

**Whether the password travels in the email is the Owner's call**, made
explicitly in the send dialog, and recorded in
`onboarding_email_dispatches`. Neither choice is made silently.

---

## Starter packs

### Composition

The pack is **derived** from the package's resolved requirements: any
requirement referencing a library document contributes that document, in
requirement order. `onboarding_package_documents` holds the Owner's deltas:

| Row | Meaning |
|---|---|
| `excluded = FALSE` | Add a document no requirement asks for (a welcome letter, a position description) |
| `excluded = TRUE` | Keep the requirement, but leave the document out of the **emailed** pack — they read it in the portal instead |
| `display_title` | Rename the entry **for this package only**. The library title, which every historical record sees, is untouched |
| `sort_order` | The order they appear in the ZIP and the read-me |

Deriving rather than hand-maintaining a second list is what stops the package
and its pack drifting apart — the same reasoning behind composing packages
instead of copying them.

### Version pinning

`onboarding-starter-pack.snapshot()` runs during `publishPackage` and lands in
the version's immutable `content.starterPack`. Generating a pack reads **that**,
never the live library.

So an Owner who publishes a new Employee Handbook next month does not
retroactively change what last month's new starter was sent, and the manifest
can still name the exact document version years later. `regenerate: true`
rebuilds from the **same pinned version** — moving somebody to a newer package
version is a separate, deliberate act.

### The four verbs

| Verb | What it actually does |
|---|---|
| **Add** | Attaches an existing library document to this package's pack |
| **Replace** | Publishes a **new VERSION of the document itself**, in the library. "Fair Work Information Statement 2026.pdf" is not a new document; it is the 2026 edition of one Opal has issued for years, and keeping it as a version is what lets a 2025 record still say which edition that employee received |
| **Rename** | Changes the display title **for this package only** |
| **Remove** | Takes it out of **future** packs. Nothing is deleted: previous versions keep it, previous starter packs keep their manifests, and the exclusion itself is a row |

None is destructive. The one thing an Owner cannot do here is make evidence
disappear.

### The ZIP

Built with `jszip`, deterministically — entries emitted in manifest order with
a fixed date, so regenerating an unchanged pack produces byte-identical output
and the sha256 identifies its **content** rather than the second it was built.

Filenames come from human titles with a position prefix (`03 - Fair Work
Information Statement.pdf`), never from internal codes or ids. `safeStem()`
reduces a title through a single allowlist pass, so no separator, `..`, control
character or Windows device name can survive. Only documents resolved through
the pinned snapshot are ever read.

`00 - Read Me First.txt` leads: what to complete, what to read, how to send it
back, and — the one instruction that genuinely has to be there, because the
whole pack travels by email — **do not email your tax file number**.

A document that cannot be read becomes a reported **omission**, never a silent
gap. A starter pack quietly missing the Fair Work statement is a compliance
failure that looks like a success.

---

## Email

### There was no Graph mail integration to reuse

The portal's Microsoft connection is calendar-only:
`Calendars.ReadWrite offline_access User.Read` (`outlook-oauth.js`). No
`Mail.Send`, no `Mail.ReadWrite`, and `@microsoft/microsoft-graph-client` is
declared in `package.json` but required by nothing.

So the primary path is **SMTP with an attachment**, through the practice's own
configured mailbox — which is a Microsoft 365 mailbox in this deployment, so
the mail genuinely comes from the practice. `email.sendTemplated` gained an
`attachments` passthrough (Buffers only, 18 MB cap, at most 5).

`backend/graph-mail.js` implements the nicer **draft** path — a message
prepared in the Owner's own Outlook, attached and addressed, for them to read
and send. It is **inert until an administrator grants `Mail.ReadWrite` and sets
`GRAPH_MAIL_ENABLED=true`**; until then `isAvailable()` returns false and the
UI says so rather than failing obscurely. See *Manual steps* below.

`mailto:` is not used anywhere. A mailto link cannot carry an attachment, and
pretending otherwise produces an email with the pack silently missing.

### Oversize packs

Over 15 MB (SMTP) or 3 MB (a Graph draft), the pack travels as a **secure
link** instead: 32 random bytes, stored only as a sha256 hash, expiring in 21
days, authorising exactly one thing — download this one ZIP. The recipient has
no account yet, which is why the link authenticates itself.

### Failure is never fatal

Every outcome — sent, draft created, skipped, failed — writes a row to
`onboarding_email_dispatches` **before** the status is considered. A failed
send leaves the pack, does not advance the status, and hands the Owner a
download path so they can deliver it by hand. `attempt` counts resends, so
"did Jane get her pack?" is answerable.

---

## Reading the returned documents

### What it is, and what it is not

It reads returned documents and **proposes** values. It does not decide
anything, does not write to an employee record, and does not create a person.

The failure mode that matters is not a wrong answer — it is a wrong answer that
looks authoritative. So every value lands in `onboarding_extracted_fields` with
its source document, its page and the model's own confidence, and stays there
until a person accepts it. The apply step is separate and deliberate.

### Tax file numbers are never extracted

Three independent layers, because the instruction layer is the one that can be
talked out of it:

1. The system prompt forbids returning one.
2. The field vocabulary (`FIELDS`) has no key for one, and an unknown key is
   dropped at parse time.
3. Migration 038 puts a `CHECK` constraint on `field_key` that refuses one at
   the database.

Plus `looksLikeTfn()`, which drops a bare 8–9 digit run landing in a text
field that has no business holding one. A TFN is collected from the employee
directly, in the authenticated portal, in the form built for it.

### The closed vocabulary

`FIELDS` in `onboarding-extraction.js` is the complete list of what may be
stored, and that is its point: a model cannot invent `spouse_income` or
`medicare_number` and have it persist. Data minimisation stops being a policy
document and becomes a data structure.

Each entry declares its group, label, sensitivity, and where accept-and-apply
writes it (`employee_personal_details`, `employment_profiles`,
`payroll_profiles`, or nowhere).

### Governance

Every call goes through `backend/ai/ai-gateway.js` under the
`onboarding_document_extraction` policy — Australian region, approved model
keys only, kill switch respected, denials audited. Declared `INTERNAL`, not
clinical: a returned Employee Details Form carries employment information about
somebody who works here, not health information about somebody we treat.
`INTERNAL` still pins the call to Australia.

### Text only, and honest about scans

PDFs are read with the portal's existing pdfjs worker, page by page, so a field
can cite the page it came from. DOCX is unzipped and stripped to text.

**A photograph or scan has no text layer, and this portal has no OCR
dependency.** That is the common case for a small practice, not an edge case,
so it is reported plainly at upload time — *"These look like scans or
photographs. We cannot read text from them, so you will need to enter the
details yourself."* — rather than being discovered two clicks later when
extraction finds nothing.

### Sensitive values

A BSB or account number is exactly as sensitive as the `payroll_profiles`
column it will become, and arrives **earlier**, before anyone has reviewed it.
So the proposal table encrypts on the same terms as 034: `value_encrypted`
through `onboarding-crypto`, `value_masked` as the only renderable form, and a
`CHECK` constraint making it impossible to store a sensitive value in the
plaintext column.

`listExtractedFields` builds its output from an **explicit column list** and
`value_encrypted` is not in it. Exactly one function decrypts —
`revealFieldValue` — and it is reachable only from the apply step; no route
serialises its return value.

A reader without `onboarding.payroll` sees that a bank account exists and
cannot see what it is, and cannot silently overwrite it either.

---

## Statuses

Six states are added between `created` and `invite_sent`. They are **optional**
— an Owner who does not need the paper round-trip still goes straight from
`created` to an invitation.

| Status | What the Owner reads |
|---|---|
| `created` | Draft |
| `starter_pack_ready` | Starter pack ready |
| `starter_pack_sent` | Awaiting documents |
| `documents_received` | Documents received |
| `details_extracted` | Details ready for review |
| `ready_for_account` | Ready for account |
| `account_created` | Account created |
| `invite_sent` | Invitation sent |
| `invite_accepted` / `in_progress` | Employee reviewing |
| `corrections_required` | Actions outstanding |
| `activated` / `completed` | **Complete** |

`activated` reads as "Complete" because that IS what it means — the run is
finished and the person is staff. Renaming the state in the database would
have meant rewriting five guards for a word.

**These states are set by acts, not derived from progress.** `PRE_RELEASE_STATUSES`
in `onboarding-engine.js` makes `deriveAssignmentStatus` return them unchanged;
without that guard, `recomputeAssignment` would see the requirements that
already exist, decide the run is `in_progress`, and erase the one piece of
state the Owner's next action depends on.

Transitions are one-way: `advanceStatus` compares ordinals in `JOURNEY_ORDER`,
so a late write cannot undo real progress.

---

## Idempotency

| Operation | How a retry is made safe |
|---|---|
| Generate starter pack | A live pack built from the same package version is **reused**; unique partial index on `(assignment_id) WHERE superseded_at IS NULL` |
| Upload returned document | Same sha256 on the same assignment returns the existing row with `duplicate: true` |
| Read the documents | Unique partial index on running runs; a second request **joins** the one in flight |
| Re-read the documents | `ON CONFLICT … WHERE status = 'proposed' AND value_source = 'extraction'` — a second pass never undoes the Owner's correction |
| Create account | Refused with `account_exists` if `account_created_at` is already set |
| Regenerate | Supersedes rather than overwrites; the old pack and its manifest survive |

---

## The Owner's language

Half of this feature's specification is about wording, and wording regresses
silently because nothing breaks when it does. So it is pinned by
`tests/onboarding-journey-frontend-guards.test.js`:

| Was | Is |
|---|---|
| `PKG_OT_FULL_TIME` under the package name | *(gone — still the stable identifier underneath)* |
| `v3`, `Publish v4` | *(gone)* / "Publish changes" |
| `Blocking` | "Required before they start" |
| "In use: 3" | "Assigned to 3 people" — and the query now excludes cancelled and archived runs, so the sentence is true |
| A blank pane | An empty state that says what will appear and offers the action |
| `region_not_configured` | "This portal is not configured to read documents yet. Enter the details yourself — your uploads are saved either way." |

---

## Files

| File | What it owns |
|---|---|
| `migrations/038_onboarding_starter_packs.sql` | Six tables, the status vocabulary, the temporary-password columns |
| `onboarding-starter-pack.js` | Pack composition, the read-me, the deterministic ZIP. No express, no clock |
| `onboarding-extraction.js` | The field vocabulary, normalisation, the TFN refusals, the tool schema. No DB |
| `onboarding-accounts.js` | Temporary passwords, role resolution, existing-person classification. No DB |
| `onboarding-workflow-db.js` | Data access for the six new tables. The only file that decrypts a proposal |
| `onboarding-workflow-routes.js` | The journey: recommend, generate, send, upload, extract, review, apply, account, invite |
| `onboarding-package-docs-routes.js` | The starter-pack document list: add, rename, remove, restore, reorder, history |
| `graph-mail.js` | Outlook draft creation. Inert until the scope is granted |
| `frontend/current/create-password.html` | First sign-in |

---

## Running it locally

```bash
cd backend && npm run migrate
```

```bash
cd backend && npx jest --config jest.config.js onboarding
```

```bash
cd backend && DB_NAME=therapy_scheduler_onbwf npx jest --config jest.integration.config.js --runInBand tests/integration/onboarding-workflow.itest.js
```

Set `ONBOARDING_ENCRYPTION_KEY` (64 hex characters) or sensitive extraction is
refused with a 503 rather than stored in clear.

---

## Manual steps this feature cannot do for itself

**Outlook drafts.** `graph-mail.js` is written, tested and inert. Turning it on
needs, in order:

1. Add the delegated **`Mail.ReadWrite`** permission to the Entra app
   registration (staging and production are separate registrations — see
   `deploy/AZURE_DEPLOYMENT.md` and `deploy/staging-entra.sh`).
2. Grant admin consent.
3. Set `GRAPH_MAIL_ENABLED=true` on the App Service and restart. With the flag
   on, `backend/outlook-oauth.js` adds `Mail.ReadWrite` to the scopes it
   requests; with it off, the scope is never asked for, so a tenant that has
   not consented is never confronted with it.
4. Every already-connected user must **reconnect** (Settings → Integrations)
   — stored refresh tokens are scoped to the old set and do not silently gain
   mail rights. The draft button stays disabled for a user until they do.

Until then the SMTP path carries the pack, attached, from the practice mailbox.
Nothing is blocked on this; the draft is the nicer option, not the only one.
