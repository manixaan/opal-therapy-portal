# Onboarding Packages — developer guide

Opal Therapy's digital equivalent of a corporate new-starter pack, modelled as
a **requirement workflow** rather than a folder of PDFs.

Migration `034_onboarding_packages.sql`. Backend `backend/onboarding-*.js`.
Frontend `frontend/current/onboarding.{js,css}` and `onboarding-invite.html`.

---

## The one idea to hold onto

A requirement is **not** a document. It is a thing that must be true before
someone can start work, and it can be satisfied in eight different ways:

| Handler | What actually happens |
|---|---|
| `info` | Read a page and confirm |
| `document_ack` | Read a pinned document **version** and acknowledge it |
| `form` | Fill a structured Opal form (personal, bank, tax, super, identity…) |
| `upload` | Supply evidence |
| `credential` | Enter a registration/card number → **employer verifies it externally** |
| `training` | Complete a course (internal learning workflow, or an external one + certificate) |
| `live_source` | Use a current official government process, then confirm |
| `employer_task` | Something only the practice can do (stapled super request, payroll setup) |

Orthogonal to that is `classification` — what the requirement **is** in
compliance terms (`OFFICIAL_DOCUMENT`, `OFFICIAL_LIVE_SOURCE`, `OPAL_POLICY`,
`OPAL_FORM`, `EMPLOYEE_UPLOAD`, `EMPLOYER_VERIFICATION`, `TRAINING_MODULE`,
`ACKNOWLEDGEMENT`, `EMPLOYER_ONLY_COMPLIANCE`). One handler serves several
classifications and vice versa, so they are separate columns.

---

## What this feature deliberately did NOT build

Four models already existed and are **extended**, not cloned. If you find
yourself adding a table, check these first:

| Existing | Used for | What 034 added |
|---|---|---|
| `credentials` | Ahpra, WWCC, NDIS screening, licence, qualification, indemnity | `lifecycle_status` (the issuing authority's own vocabulary), `jurisdiction`, verification provenance, `onboarding_requirement_id` |
| `pd_documents` | every employee-supplied file | `onboarding_requirement_id`, `sensitivity`, `file_sha256` |
| `learning_assignments` (033) | training requirements | nothing — onboarding points at it and completion flows one way |
| `user_invites` | the secure invitation | `pre_employee` role, `onboarding_assignment_id` |
| `org_settings` | organisation configuration | an `onboarding` key. **No new settings table.** |

There is no second LMS, no second document store, no second audit table.

---

## Data model

```
                 ┌─ compliance_requirements ── the official source and its BASIS
                 │
onboarding_requirement_templates ── the Owner's reusable building blocks
                 │        │
                 │        └── applicability: JSONB rule ─┐
                 ▼                                       │
onboarding_packages ──< onboarding_package_requirements   │  evaluated against
     │                     (DRAFT composition)            │  the assignment's
     └──< onboarding_package_versions (IMMUTABLE snapshot)┘  frozen `facts`
                 │
                 ▼
onboarding_assignments ──< onboarding_requirements ──< onboarding_requirement_events
                 │              │
                 │              ├─ pd_documents (evidence)
                 │              ├─ credentials (verification)
                 │              ├─ learning_assignments (training)
                 │              └─ onboarding_acknowledgements (pinned to a doc VERSION)
                 │
                 ├─ employment_profiles          ← onboarding.view
                 ├─ employee_personal_details    ← onboarding.review
                 ├─ payroll_profiles             ← onboarding.payroll        (ENCRYPTED)
                 └─ employee_identity_records    ← onboarding.sensitive_identity (ENCRYPTED)
```

The four employee tables are separate **because their permission tiers
differ**. Splitting them is what makes "an Admin who can chase paperwork but
must never see a TFN" expressible in the schema rather than only in a handler.

---

## The rule engine

`backend/onboarding-engine.js` is pure — no database, no express. Rules live in
the database as JSONB and are evaluated here, never in a frontend component.

```jsonc
{ "all": [ { "fact": "employment_type", "op": "eq", "value": "casual" } ] }
```

Supported: `all` / `any` / `not`; ops `eq`, `neq`, `in`, `not_in`, `is_true`,
`is_false`, `exists`. Facts are a closed list (`KNOWN_FACTS`).

**It fails closed.** An unknown fact or operator evaluates to `false`, and
nesting is depth-bounded. An authoring mistake must not hand someone a
requirement set they should not have, nor silently drop one they should.

Two derived facts are deliberately conservative:

```js
requires_worker_screening = risk_assessed === 'yes' || risk_assessed === 'requires_determination'
```

"We have not decided yet" surfaces as work to do, never as an exemption.

### Composition, not duplication

Packages inherit: a base plus overlays, flattened by `resolveComposition()`.
Later entries win, so a package can re-declare an inherited requirement to
change `mandatory` / `blocks_activation` / `condition`. Cycles are reported,
not followed.

```
PKG_BASE_EMPLOYEE → PKG_OVL_CASUAL → PKG_OVL_OT → PKG_OVL_CHILD_RELATED
                  → PKG_OVL_MOBILE → PKG_OVL_NDIS_RISK → PKG_OT_CASUAL
```

Adding a requirement to every new starter is **one edit to the base**, not six
edits that can drift apart.

### Versioning

Publishing snapshots the fully **resolved** requirement list into
`onboarding_package_versions.content` — inheritance flattened, template config
copied in, document versions and compliance records pinned. An assignment holds
`package_version_id` forever.

Editing a template or publishing a policy marks referencing packages
`draft_dirty`; it never changes what an in-flight employee sees.

---

## The two meters

The single most important UX rule in this feature:

```js
computeProgress(requirements) → { employeeDone/Total, employerDone/Total, ... }
```

An employee's meter counts **their** actions only. Employer verification is
counted separately and never subtracts from theirs. Being told you are 78%
complete because someone else has not checked your registration yet is both
untrue and demoralising.

`statusAfterEmployeeAction()` follows the same principle: a requirement the
employer must verify goes to `submitted` and waits; one that is purely the
employee's goes straight to `complete`, because making them wait for a
verification that will never come would be a lie about their progress.

**Submission is an act, not a side effect.** Finishing the last item stops at
`employee_actions_complete`. It becomes `employer_review` only when the employee
presses Submit (`submitted_at`). Deriving straight past that made the Submit
button vanish the moment it became relevant.

---

## Activation

`evaluateActivation()` returns `{ ok, blockers }` — never a bare boolean,
because a refusal has to be explainable in the UI.

A blocking requirement is satisfied by `verified` / `complete` /
`not_applicable`, or an Owner waiver **with a recorded reason**.

Waiving is refused outright on `REQ_NDIS_SCREENING`, `REQ_WWCC`, `REQ_AHPRA`
and `REQ_RIGHT_TO_WORK`. Waiving "police check — role has no participant
contact" is a legitimate organisational decision; turning an NDIS exclusion
into a clearance is not a decision Opal is entitled to make.

Activation is idempotent: `users.activated_from_onboarding_at` is set only
where it is still null, so exactly one concurrent call can win.

---

## Security

### Roles

`pre_employee` holds **no business permission at all**. Its access is defined
by an **allowlist choke point in `requireAuth`**, not by route guards:

```js
PRE_EMPLOYEE_PATHS = ['/api/auth/', '/api/onboarding/me', '/api/learning/my', …]
```

This is necessary because a number of routes gate on `requireAuth` alone —
submitting leave, for instance — and would otherwise have been reachable.
Matching is on path **segments**, so `/api/onboarding/members` cannot slip
through on the strength of `.../me`.

### Delegation

Eleven `onboarding.*` permissions, **none in any role's defaults but the
owner's**. An "Admin employee" (whose job is administration) and an "onboarding
administrator" (whom the Owner trusts with a colleague's tax file number) are
two different things. Nothing implies anything else: `onboarding.review` does
not confer `onboarding.payroll`.

Granting is Owner-only **by role**, not by permission — the ability to hand out
access to tax file numbers must not itself be delegable.

### Encryption — fails closed

`backend/onboarding-crypto.js`. Unlike `crypto-utils` (which passes through
when unkeyed — right for an OAuth token, wrong for a TFN), this **refuses** to
store a sensitive value outside development when no key is configured. Release
returns 503 rather than collecting data it cannot protect.

`ONBOARDING_ENCRYPTION_KEY` is **separate from `TOKEN_ENCRYPTION_KEY`** on
purpose: OAuth tokens are rotated routinely and re-obtained by
re-authenticating, whereas HR ciphertext must survive. Sharing one key would
mean an OAuth rotation permanently destroyed every stored TFN and bank detail.
Set `ONBOARDING_ENCRYPTION_KEY_PREVIOUS` during a rotation; reads try both.

Encrypted: TFN, BSB, account numbers, SMSF bank details, identity document
numbers. Not encrypted: names, addresses, fund names — ordinary personal
information protected by access control, where encrypting would defeat search
for no gain.

**Masking is the only renderable form.** `maskBsb` / `maskAccountNumber` /
`maskTfn` in the engine are the only permitted renderings; nothing else in the
codebase may format these values. `getPayrollProfileMasked()` does not even
select the encrypted columns. `decryptPayrollForExport()` is the single
decrypting path — Owner-only, reason-required, audited **before** the decrypt.

### Audit

`backend/onboarding-audit.js` builds metadata from a **frozen field
allowlist**. Objects and arrays-of-objects are dropped rather than serialised,
so there is no field a TFN could land in. `logger.js` redaction was extended
(tfn/bsb/account-number keys, plus TFN and BSB string patterns) as a backstop —
the allowlist is the control.

### ZIP import

Untrusted input by definition. Checked **before a byte is written**: absolute
paths, `..` traversal (both separators), null bytes, path length, entry count,
per-entry and total size, compression ratio (zip bomb), extension allowlist,
and **magic-number sniffing** against the declared type. Imports land as
DRAFTS — an archive must not be able to publish a document to a workforce.

Note: JSZip normalises `..` on load, so `pathProblem()` is a second layer. It
is unit-tested directly against the raw strings JSZip would not let through.

---

## Compliance honesty

Every source was verified against the primary publisher on **20 August 2026**
and recorded in `compliance_requirements` with a `basis` column. `basis` is the
honesty column: it stops the system implying that an Opal house rule is a
statute.

The catalogue deliberately does **not** assert several widely-repeated claims:

- **NDIS Worker Screening is not universal.** It binds risk-assessed roles and
  key personnel of **registered** providers. The Commission's own words for
  everyone else are recorded verbatim. Opal may require it as
  `OPAL_POLICY_REQUIREMENT` — never as law.
- **The NDIS Code of Conduct *is* universal** — the one NDIS obligation an
  unregistered provider cannot opt out of.
- **A National Police Check is not legally required** for all NDIS or health
  workers.
- **A WWCC follows the role's usual DUTIES, not its job title.** No card-number
  format is enforced, because no official WA source publishes one.
- **OT CPD is 20 hours/year, not 30** (5 of them interactive). The 30 figure is
  everywhere on secondary sites and belongs to other professions.
- **Occupational therapists are not mandatory reporters** under s.124B of the
  Children and Community Services Act 2004 (WA).
- **The CEIS is a recurring obligation** — 6 and 12 months then annually, or
  12-monthly for a small business employer. A system that ticks it off at
  onboarding puts the employer in breach from month six.
- **The Fair Work statements bind national system employers.** A WA sole trader
  or unincorporated partnership is generally in the state system, where they do
  not apply — hence `industrialRelationsSystem` starts `'unknown'` rather than
  guessing.
- **Identity is sighted, not scanned.** Home Affairs: "You do not need to keep
  a copy of the visa holder's travel document"; what it asks you to retain is
  the VEVO result. An employer VEVO check takes name + DOB + travel document
  type/number/country — **not** a visa grant number, which is the holder's own
  self-check identifier.
- **The employee records exemption does not cover applicants**, which is
  exactly when identity, TFN and bank details are collected — so an APP 5
  collection notice is issued first and blocks activation.

Version labels are **free text** (`"Last updated: July 2026"`) because the Fair
Work statements carry no version number, and the FTCIS lives at a URL whose
path says `2023-12` while holding the November 2025 revision.

### Policies seed empty on purpose

All 29 Opal policies seed as `document_required` **drafts**. Generating a
polished, authoritative-looking WHS or privacy policy so the feature "looked
complete" would put invented rules in front of a real workforce.

The consequence is deliberate: **release refuses** to issue an
activation-blocking acknowledgement whose document has no published version.
You cannot onboard someone against a policy you have not written.

---

## Integration points

### Learning (033)

`backend/onboarding-learning-bridge.js`. One way only:

- On release, a training requirement naming a `learning_workflow_id` creates a
  learning assignment (best-effort — a missing workflow leaves it as manual
  work rather than failing the release).
- When learning completes, `onLearningAssignmentCompleted()` completes the
  matching onboarding requirement. Hooked post-commit in `learning-routes.js`,
  wrapped, in the same shape as its existing Resource Hub bridge.

Nothing in onboarding ever writes back into learning state.

### Expiry

`backend/onboarding-expiry.js`, daily in-process (single-instance assumption
noted in the file). Warns at 90/60/30/7 days and on expiry, each **claimed
through a unique constraint** so a restart cannot replay yesterday's reminders.

Two subtleties:

- **Ahpra's late period.** Registration expires 30 November; between 1 and 31
  December a practitioner may legitimately show "Registered" with a past expiry
  while renewal is assessed. Those rows move to `renewal_late_period`, not
  `expired`.
- **A statutory status is never downgraded.** An `exclusion` or `suspension`
  stays as the authority set it.

It also schedules the recurring CEIS re-issue off each casual's start date,
reading the cadence from the compliance registry rather than hardcoding it.

---

## Adding a requirement

1. Add a compliance source to `COMPLIANCE_SOURCES` (`onboarding-catalogue.js`)
   with an honest `basis` and a primary-source URL.
2. Add a requirement template referencing it. Pick `handler` (mechanism) and
   `classification` (what it is), and write the `applicability` rule.
3. Add its code to the right package or overlay in `PACKAGE_BASE` /
   `PACKAGE_OVERLAYS`.
4. Restart — the seeder is idempotent by code and never touches an assignment
   in flight or a package the Owner has edited.
5. Publish a new package version when you want new starters to receive it.

`tests/onboarding-catalogue.test.js` enforces referential integrity and pins
the compliance claims above, so a later edit cannot quietly reintroduce a myth.

---

## Local development

```bash
cd backend && npm run migrate && node onboarding-seed.js
```

Set `ONBOARDING_ENCRYPTION_KEY` (64 hex chars) or tax/bank collection is
refused outside development. See `.env.example`.

```bash
npm test                                            # unit
npm run test:integration                            # integration
DB_NAME=therapy_scheduler_onb npm run test:integration   # isolated DB
```

Use the isolated form when another session is running integration tests — two
jest processes truncating the same `*_test` database deadlock on `TRUNCATE`.

Dev server: `opal-onboarding-5010` in `.claude/launch.json`.

---

## Known gaps and external dependencies

- **No official-resources ZIP was available.** The import pipeline, the
  document library and the metadata are built and tested; the official files
  themselves have not been imported. Official documents seed as `link_only`
  pointing at the publisher.
- **Opal policy content is not written** (29 slots await it, above).
- **Ahpra has no free API.** Structured access is the paid Practitioner
  Information Exchange, and its change-notification service is browser-only.
  Verification is a recorded human check.
- **Home Affairs offers no authorised VEVO API** for employer checks. Same
  approach — the record captures a human verification honestly rather than
  implying a machine check that never happened.
- **NDIS Worker Screening verification is database-based** and requires the
  practice's own NWSD/PRODA access; Opal records the outcome.
- **Xero payroll integration is a structured export**, not a live push. The
  boundary is `POST /api/onboarding/assignments/:id/payroll-export`.
- **Email delivery** needs SMTP configured; without it release still succeeds
  and returns the invitation link for manual delivery.
- **The expiry sweep assumes a single instance.** Scaling out needs an advisory
  lock.
- **Invitation tokens are stored unhashed**, matching the existing
  `user_invites` design, which needs the raw token for the Owner's
  copy-link recovery path. They are 32 random bytes, single-use, time-limited,
  revocable, and never returned in any list or detail response.
