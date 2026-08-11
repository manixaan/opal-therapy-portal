# Opal Clinical AI Security Architecture

| | |
|---|---|
| **Version** | 1.0 |
| **Effective date** | 10 August 2026 |
| **Owner** | Opal Therapy Pty Ltd |
| **Classification** | Internal — Security Architecture |
| **Review cycle** | 6 months (next review: 10 February 2027) |
| **Supersedes** | — |

**Status: authoritative.** This document governs every use of AI in the Opal Therapy Portal and the Opa Mobile Companion. If you are adding, changing or reviewing anything that reaches a language model, read this first and follow it.

**Last verified against the code: 10 August 2026.** Every model id, policy and field list below was read out of the running modules, not recalled. If this document and the code disagree, the code wins — and the disagreement is a bug in one of them; fix it rather than working around it.

> **If you are an AI coding agent working in this repository:** you may not add an AI SDK, an API key, a vendor endpoint or a model id to any file outside `backend/ai/`. CI will fail. The correct move is always to add a policy in `backend/ai/ai-policy.js` and call the gateway. See §12 for the procedure.

---

## Why these rules exist

Opal is a WA occupational therapy practice serving NDIS participants. The material it handles is **health information** — sensitive information under the Privacy Act 1988, which applies to the practice regardless of turnover because health service providers are carved out of the small business exemption.

Four consequences drive this architecture:

1. **APP 8 and s 16C.** Sending health information to an overseas recipient is a cross-border disclosure, and s 16C makes the practice accountable for that recipient's acts *as if they were its own* — even where reasonable steps were taken, even for an inadvertent breach, even where the breach was a subcontractor's. Keeping inference in Australia removes this exposure entirely rather than mitigating it.
2. **AHPRA / OT Board.** The practitioner is responsible for the accuracy and relevance of any record produced with generative AI. AI output is therefore always a draft until a person accepts it.
3. **TGA.** Software that generates a diagnosis, differential or treatment recommendation *not explicitly stated by the practitioner* is a medical device requiring ARTG inclusion. Opal's AI restructures what a clinician said; it does not add clinical judgement.
4. **NDIS Commission.** Its February 2026 position expects that personal information is not disclosed to AI systems and that any use is appropriately de-identified — stricter than privacy law requires.

Fuller reasoning, sources and the open legal questions: [`docs/mobile/CLINICAL_AI_PROVIDER_DECISION.md`](mobile/CLINICAL_AI_PROVIDER_DECISION.md).

---

## 1. AI Gateway architecture

There is exactly **one** path from application code to a model.

```
  Feature  (case notes · Opa · future FCA / WHODAS / reports / resources)
      │
      ▼
  backend/ai/ai-gateway.js          ← the only entry point
      │
      ├─ kill switch on?            no ─▶ DENY
      ├─ feature has a policy?      no ─▶ DENY   (there is no default policy)
      ├─ classification permitted?  no ─▶ DENY   (caller may escalate, never relax)
      ├─ output type permitted?     no ─▶ DENY   (human review derives from this)
      ├─ region Australian?         no ─▶ DENY
      ├─ model in policy?           no ─▶ DENY   (registry keys only, never raw ids)
      ├─ model approved + onshore?  no ─▶ DENY
      └─ provider in policy?        no ─▶ DENY
      │
      ▼
  ai/providers/bedrock-provider.js  ← the ONLY file that may import an AI SDK
      │
      ▼
  AWS Bedrock runtime · AU geo profile · Sydney ⇄ Melbourne
      │
      ▼
  ai_interactions row written (allowed AND denied)
```

| File | Responsibility |
|---|---|
| `ai/ai-gateway.js` | Single entry point. `evaluate()` is pure and synchronous, so the whole decision surface is unit-testable without mocking HTTP. |
| `ai/ai-policy.js` | Per-feature declarations. Invariants enforced **at module load** — a bad policy fails the process at boot, not mid-consultation. |
| `ai/ai-model-registry.js` | The only file permitted to contain a model id. |
| `ai/ai-classification.js` | `public` / `internal` / `clinical` and what each demands. |
| `ai/ai-output-type.js` | `assistant_response` / `clinical_document`. Human review derives from here. |
| `ai/ai-audit.js` | Metadata-only events, built from a fixed field allowlist. |
| `ai/ai-kill-switch.js` | Global stop, two independent mechanisms. |
| `ai/providers/` | Transport only. Makes no policy decisions. |

**Why a gateway rather than securing each feature.** Per-feature security holds only while every future developer remembers it. A gateway plus a CI guard turns "remember not to call Anthropic directly" into a build failure.

---

## 2. Provider boundary rules

**Rule 1 — No AI SDK, vendor endpoint or raw model id may appear in executable code outside `backend/ai/`.**

Enforced by `backend/tests/ai-gateway-boundary.test.js`, which scans every backend `.js` file and fails on:

- SDK imports (`@anthropic-ai/sdk`, `@anthropic-ai/bedrock-sdk`, `@aws-sdk/client-bedrock-runtime`, `openai`, `@google/generative-ai`)
- vendor endpoints (`api.anthropic.com`, `api.openai.com`, `bedrock-runtime.`, `bedrock-mantle.`, `generativelanguage.googleapis.com`)
- raw model identifiers (`au.`/`global.`/`apac.`/`us.`/`eu.` prefixed ids, and bare `claude-*` strings)
- **any** vendor term — `anthropic`, `openai`, `bedrock`, `claude`, `gemini` — in code outside `backend/ai/`

Comments are stripped before the broad scan, so a file may *explain* the boundary in prose without failing. The narrow scans allow only:

| Allowed to contain | Files |
|---|---|
| AI SDK imports, vendor endpoints | `ai/providers/bedrock-provider.js`, `ai/providers/mock-provider.js` |
| Raw model ids | `ai/ai-model-registry.js` |

**This allowlist is the boundary.** Widening it is a governance decision, not a convenience — the test asserts its exact size so growth cannot pass unnoticed.

**Rule 2 — the gateway must be the caller, not a wrapper someone can bypass.** A feature that needs different behaviour changes its *policy*, never its transport.

**Rule 3 — `AnthropicBedrock`, never `AnthropicBedrockMantle`.** Australian geo inference profiles exist only on the `bedrock-runtime` endpoint; on `bedrock-mantle` the geo inference id is documented as `N/A`. The Mantle client has better ergonomics and cannot do the one thing this system requires.

---

## 3. Classification model

Classification describes the **input** — what a feature may be given. It is **declared by the feature, never sniffed from content**.

That inversion is deliberate. Content detection is unreliable: the only published evaluation of de-identification on Australian clinical text found best-case ~67% recall, and an LLM adversary re-identified 9% of notes that had already been de-identified. A boundary that depended on correctly detecting clinical data would fail open the first time detection missed something.

| Level | Meaning | Residency | Audit |
|---|---|---|---|
| `public` | Reference material. No personal information. | — | required |
| `internal` | Practice business content. Personal, not health. | Australia | required |
| `clinical` | Health information about an identifiable person — case notes, FCA content, WHODAS responses, therapy goals, diagnoses, or a client name in any context. | Australia | required |

**A caller may escalate a classification but never relax one.** Declaring a stricter level than the policy's default is honoured; declaring a laxer one is ignored, and declaring one the feature isn't permitted to receive is denied. That direction is how boundaries erode.

Automated detection may be layered on later, but only as a **second** check that can escalate — never one that can relax.

---

## 4. Output types

Output type describes the **answer** — what it is going to be. It is a separate axis from classification, and conflating them under-protects one case while over-protecting another.

Through the same Opa chat box:

| Ask | Classification | Output type | Human review |
|---|---|---|---|
| "Explain sensory processing difficulties" | clinical-capable | `assistant_response` | no |
| "Write a progress summary for Johan" | clinical | `clinical_document` | **yes** |

| Type | Meaning |
|---|---|
| `assistant_response` | An answer to a question. Informational. Never becomes documentation. |
| `clinical_document` | Content destined for a clinical record — case notes, report sections, assessment narrative, letters. |

**Producing a `clinical_document` forces the classification to `clinical`**, regardless of what the input looked like. An answer headed for a health record is clinical by destination.

---

## 5. Human review requirements

**`clinical_document` output ALWAYS requires human review. This is not configurable.**

Human review is **derived** from output type, never declared per feature. `clinical_document` sits on a review-mandatory list checked at policy load, so a well-meaning policy edit cannot turn a clinical document into something that files itself.

The workflow:

```
  Therapist requests a draft
        ↓
  AI generates              ai_interactions row · review_status = review_required
        ↓
  Draft stored              case_note_drafts   · generation_source = ai_assisted
        ↓                                       · review_status    = review_required
  Therapist reviews and edits
        ↓
  Approve / reject          POST /api/mobile/case-note-drafts/:id/review
        ↓                   updates BOTH the draft and the interaction
  Clinical record
```

Review states: `ai_generated` → `review_required` → `approved` | `rejected`.

**Never:** AI output becoming a final clinical record without a person accepting it. Database CHECK constraints enforce that an `approved` or `rejected` row names a reviewer and a timestamp — a review outcome without a reviewer is not a review.

Review is scoped to the owning user. One therapist cannot approve another's work.

---

## 6. Approved providers

| Provider | Status | Notes |
|---|---|---|
| **AWS Bedrock** (`aws-bedrock`) | **Approved** — the only production provider | Australian geo inference profiles only |
| `mock` | Approved for tests and local development | Deterministic, offline, no SDK, reaches nothing |

Everything else is forbidden. See §8.

**AWS is the data processor**, not Anthropic — Bedrock runs models in AWS-operated deployment accounts. Approved Anthropic Claude models are operated *through* Bedrock. The governing instrument is the AWS DPA; Anthropic's own ZDR agreement and BAA do not apply to this path and are not needed for it. This is a change of processor and contract, not a claim that Anthropic is uninvolved.

---

## 7. Approved models

Defined in `backend/ai/ai-model-registry.js`. **Nothing else in the codebase may contain a model id.**

| Registry key | Model id | Provider | Source regions |
|---|---|---|---|
| `clinical_standard` | `au.anthropic.claude-sonnet-4-6` | aws-bedrock | ap-southeast-2, ap-southeast-4 |
| `clinical_complex` | `au.anthropic.claude-opus-4-8` | aws-bedrock | ap-southeast-2, ap-southeast-4 |
| `mock` | `mock-model` | mock | (test only) |

Sonnet 4.6 is the everyday model; Opus 4.8 is for report-grade fidelity where omission risk matters most. Both carry a confirmed Australian geo profile from both regions.

**The registry is per-region on purpose.** Australian routing is not uniform across models — Claude Sonnet 5, for example, has a genuine `au.` profile that *cannot be sourced from Sydney*. A flat "these models are Australian" list would hide that class of mistake.

**Before adding a model**, verify at runtime rather than from documentation:

```bash
aws bedrock get-inference-profile \
  --inference-profile-identifier <id> --region <region>
```

Then add it to the registry, add it to the policies that may use it, and mirror it in the AWS IAM policy. All three.

---

## 8. Forbidden

Absolutely, in all circumstances:

| Forbidden | Why |
|---|---|
| **Direct Anthropic API** (`api.anthropic.com`) | US processing and US storage. `inference_geo` offers only `us` and `global` — there is no Australian option on the first-party API. |
| **OpenAI API for any clinical data** | OpenAI offers Australian data residency for *storage* but **not for inference** — regional processing is US, Europe and UAE only. Any product built on it cannot have onshore inference. |
| **`global.` inference profiles** | Route to every commercial AWS region worldwide. |
| **`apac.` inference profiles** | Reads as regional but also reaches Tokyo, Seoul, Osaka, Mumbai, Hyderabad and Singapore, with no way to choose. Only two of eight destinations are Australian. |
| **`us.` / `eu.` / any non-`au.` profile** | Not Australia. |
| **Claude Fable 5 and Mythos 5** | Covered Models: they *require* data retention, share prompts and completions with the model provider for up to 30 days on Bedrock (`provider_data_share`), and are excluded from Bedrock's HIPAA eligibility. Blocked in the registry with the reason recorded; must also be denied at the AWS organisation level. |
| **Any model not in the registry** | Unlisted is denied. |
| **Bedrock model invocation logging** | Writes full request and response bodies — clinical narrative — into your own S3 or CloudWatch, which then becomes your retention and access-control problem under APP 11. Off by default; keep it off. |
| **Prompts, responses or clinical text in any log, audit row or telemetry** | See §9. |
| **AI output becoming a clinical record without human review** | See §5. |
| **Long-lived AWS access keys in application configuration** | See §10. |

---

## 9. Audit design

**One `ai_interactions` row per gateway call — allowed and denied.** A denial that leaves no trace is indistinguishable from a call that never happened, which is exactly what you do not want when reconstructing an incident.

**No clinical content, ever.** An audit log that also holds clinical narrative doubles the surface area of every breach and creates a second copy to secure, retain and dispose of under APP 11.

That rule is enforced structurally, not by convention. `ai-audit.js` builds every event from a fixed field allowlist — unknown keys are dropped rather than passed through, and objects and arrays are rejected outright rather than serialised, since serialising is precisely how a transcript would end up in an audit row.

**The complete set of recordable fields:**

`eventId` · `feature` · `classification` · `outputType` · `provider` · `model` · `modelKey` · `sourceRegion` · `providerRequestId` · `humanReviewRequired` · `status` · `denyReason` · `latencyMs` · `auditCategory`

Adding a field is a deliberate decision — check it cannot carry clinical content.

**`sourceRegion` is not the processing region.** Under geographic cross-region inference an `au.` profile sourced from Sydney may be processed in Sydney *or* Melbourne. Both are Australian, so residency holds either way — but this field records where the request was **sent from**. The authoritative record of where it *ran* is CloudTrail:

```
additionalEventData.inferenceRegion
```

logged in the source region. Correlate on `provider_request_id` and timestamp. That is exactly why `provider_request_id` is stored.

**Clinical drafts link to their interaction** (`case_note_drafts.ai_interaction_id`), so the practice can answer *"which notes were AI-assisted, where were they processed, and who approved them"* without storing the conversation.

**The result object returned to callers** carries provenance metadata only — model, provider, source region, interaction id, review requirement. There is deliberately **no `rawPrompt` or `rawResponse`**: a caller cannot persist what it is never handed.

### Attribution is a precondition for clinical documents

A clinical document **reserves its audit row before the model is called**. If that write fails, generation is denied and nothing is transmitted.

The ordering is inverted on purpose. Recording after the fact is fine for an assistant answer — if the write fails you have lost a log line. It is not fine for a clinical document: a note in a client's file that cannot be traced to a model, a region and a person is worse than no note, and by the time an after-the-fact write fails the data has already left.

| Output type | Audit behaviour | If audit is unavailable |
|---|---|---|
| `assistant_response` | Recorded after the call | Warn and continue — a missing log line |
| `clinical_document` | **Reserved before the call**, finalised after | **Generation denied** (`audit_unavailable`) |

Lifecycle: `pending` → `generated`. A row left at `pending` means the call was made but its outcome was never confirmed, which is itself worth seeing.

Finalising is best effort — by then the call has happened, and failing a therapist's work because an `UPDATE` did not land helps nobody.

---

## 10. AWS target architecture

**Not yet implemented.** This is the target for Milestone 3. No AWS credentials or configuration exist today.

```
  Azure App Service  (Opal backend)
        │
        │  Azure Managed Identity / Entra workload identity
        ▼
  Microsoft Entra ID
        │
        │  OIDC token
        ▼
  AWS STS · AssumeRoleWithWebIdentity
        │
        │  short-lived credentials
        ▼
  IAM role: OpalClinicalAIRuntimeRole
        │
        ▼
  Bedrock Runtime · ap-southeast-2
        │
        ▼
  AU geo inference profile
        ├── Sydney
        └── Melbourne
```

**No permanent AWS secret anywhere in application configuration.** Not in `.env`, not in Azure Key Vault, not in a pipeline variable. The application receives temporary credentials by federation.

The code is already compatible: `ai/providers/bedrock-provider.js` resolves credentials through the standard AWS chain and never reads or logs a credential, so a role-based identity should require **no code change**.

### Account structure

Separate accounts, so clinical AI never shares an environment with experiments:

```
AWS Organisation
├── Opal Production
├── Opal Staging
└── Opal Security / Audit
```

### Roles — three, not one

| Role | May | Used by |
|---|---|---|
| `OpalClinicalAIRuntimeRole` | `bedrock:InvokeModel`, `bedrock:InvokeModelWithResponseStream` on approved profiles only | The application |
| `OpalAIOpsAdmin` | Change models, policies, permissions | Humans, deliberately |
| `OpalAIAuditReader` | Read CloudTrail and security logs | Review and incident response |

The runtime role gets nothing else. No `bedrock:*`, no `iam:*`, no `s3:*`, no Marketplace permissions, no ability to change retention settings.

**A cross-region inference profile authorises against both the profile ARN and the underlying foundation-model ARN in every destination region.** A policy naming only the model ARNs will fail. Foundation-model ARNs have an empty account field — that is correct, they are AWS-owned.

### Organisational guardrails

A Service Control Policy restricting Bedrock to `ap-southeast-2` and `ap-southeast-4` is the equivalent of the CI guard: the code says *don't*, AWS says *can't*. It must deny both `bedrock:*` and `bedrock-mantle:*` — separate IAM namespaces, and a `bedrock:*` deny does not cover the other.

Two details that matter: the `au.` profile's destinations are exactly these two regions, so legitimate traffic passes; and global cross-region requests evaluate `aws:RequestedRegion` as the literal string `unspecified`, which an allow-list style policy correctly denies (a deny-list style one would not).

### Logging

| Setting | State | Purpose |
|---|---|---|
| **CloudTrail** | **ON**, all regions, encrypted S3, log file validation enabled | Who called AI, when, which model, which region — including `inferenceRegion` |
| **Bedrock model invocation logging** | **OFF** | Would store prompts and responses |

Enable CloudTrail **before** the first AI request, so the first call is already auditable.

Copy-paste IAM and SCP policies, and the runtime verification commands: [`docs/mobile/CLINICAL_AI_PROVIDER_DECISION.md`](mobile/CLINICAL_AI_PROVIDER_DECISION.md) §2.7.

---

## 11. Emergency kill switch

**Two independent mechanisms. Either alone stops every AI call.**

### Mechanism 1 — database (normal path, instant, no redeploy)

```sql
UPDATE system_settings SET value = 'false', updated_at = NOW()
 WHERE key = 'ai_global_enabled';
```

Takes effect within 15 seconds (cache TTL). To re-enable, set `'true'`.

**The switch accepts exactly two values: `'true'` and `'false'`.** No trimming, no case folding, no synonyms — `'TRUE'`, `'off'`, `'0'`, `'enabled'` and `'false '` are all rejected.

Anything else is treated as **disabled** and raises an `invalid_kill_switch_value` security event naming the offending value. A database CHECK constraint also refuses to store it, so `UPDATE ... SET value = 'OFF'` fails at the database rather than appearing to work.

This is deliberately unforgiving. The switch stopped being an application feature the moment it became part of incident response, and an incident is exactly when nobody types carefully. Being permissive would mean choosing between two bad outcomes — silently interpreting `'OFF'` as "keep running", or silently interpreting `'true '` as "stop" — where the operator gets no signal either way. Failing closed *and* loudly avoids both.

### Mechanism 2 — environment (works with the database down)

```
AI_GLOBAL_DISABLE=true
```

Checked synchronously, needs nothing external. Requires a restart, but works when mechanism 1 cannot.

### When to use it

A model behaving badly · a provider incident · a privacy concern raised by a therapist · an AWS problem · any suspicion that data has gone somewhere it should not.

### Failure-mode behaviour, decided deliberately

On a database read error the **last known value is retained**. If the switch has never been read successfully, AI is treated as **enabled**.

Failing closed would mean a brief database hiccup halts clinical documentation mid-clinic, and the call is already gated by a feature flag and by gateway policy — the kill switch is a fourth control, not the only one. But a *deliberate* disable survives a later read failure: expiring the cache forces a re-read without discarding what was last seen.

### Record who and why, in the same statement

The system records the *transition* automatically, but only you know the reason. Set it while you are there:

```sql
UPDATE system_settings
   SET value = 'false',
       reason = 'Vendor advisory 2026-08-10 — pausing pending review',
       updated_by = '<your user id>',
       updated_at = NOW()
 WHERE key = 'ai_global_enabled';
```

On the next read the system writes an `ai_security_events` row capturing previous state, new state, actor and reason. **Only a genuine transition is recorded** — booting with AI already disabled is a state, not somebody flipping a switch, and recording it would bury the real events.

Six months later, the question "why was AI disabled last Tuesday" is one query:

```sql
SELECT created_at, event_type, previous_state, new_state, reason, actor_user_id
  FROM ai_security_events ORDER BY created_at DESC;
```

### After using it

1. Check `ai_interactions` for what ran before the stop: `SELECT ... WHERE created_at > <suspect time>`.
2. If data may have gone somewhere it should not, this is a potential eligible data breach. The NDB scheme allows **30 days** to assess, and OAIC treats that as a maximum. A breach at a processor is the practice's notifiable breach too.
3. Do not re-enable until the cause is understood — and record the reason on the way back up as well.

---

## 11a. Operational readiness

Three controls that exist for the moments when something is already wrong.

### Boot self-check — an unverified boundary is a broken one

`backend/ai/ai-self-check.js` runs at startup and prints a checklist:

```
AI SECURITY CHECK
-----------------
  ✓ policy registry loaded — 2 feature(s)
  ✓ model registry loaded — 3 model(s)
  ✓ approved models are Australian geo profiles — all onshore
  ✓ retention-mandating models are blocked — 4 blocked
  ✓ classification and output types intact — review invariant holds
  ✓ audit layer available and content-free — 14 metadata fields
  ✓ kill switch available — present

AI READY
```

**A failed check disables AI for the life of the process**, and the gateway denies with `ai_boundary_unverified`. The reasoning: the gateway's guards assume a policy registry that validated and a model registry containing only Australian profiles. If one is malformed, the guards are not weaker — they are *unproven*, which for a clinical system is the same thing.

It also runs lazily on first use if boot never called it, so a process that forgot to wire it still gets a verified boundary rather than an assumed one.

This is **not** a substitute for the CI boundary test. That scans source and catches a developer adding an SDK; this checks the runtime shape of what actually loaded.

### Health endpoint

```
GET /api/ai/security-status      (owner/admin only)
```

Returns whether AI is globally enabled, both kill-switch states, boundary verification result, provider, region, approved and blocked models, and per-feature flag/permission state with the blocking reason where applicable.

**Returns no credentials, no client data, no prompts, no clinical content, no user identifiers.** Everything in it is configuration already documented here.

### Security events

`ai_security_events` records: `ai_disabled`, `ai_enabled`, `invalid_kill_switch_value`, `policy_changed`, `model_registry_changed`, `self_check_failed`. Metadata only, as everywhere else.

`invalid_kill_switch_value` is distinct from `ai_disabled` so an incident review can tell "somebody turned it off" apart from "somebody tried to turn it off and typed something the system could not read". Both may appear for the same read — AI genuinely did become disabled, and the reason was a bad value. It is reported once per distinct value rather than once per cache expiry, so a bad row does not bury the events that matter.

---

## 12. How to add a new AI feature

The only correct procedure. Any deviation fails CI.

1. **Decide the classification** — what may this feature *receive*? (§3)
2. **Decide the output types** — what may it *produce*? If `clinical_document` is one of them, human review is mandatory and not negotiable. (§4, §5)
3. **Add a policy** to `backend/ai/ai-policy.js` with `allowedClassifications`, `outputTypes`, `defaultOutputType`, `allowedProviders`, `allowedModels` (registry keys), `defaultModel`, `region: 'australia'`, `auditCategory`.
4. **Call the gateway** — `require('./ai/ai-gateway').generate({ feature, outputType, messages, userId, ... })`. Never an SDK.
5. **Fail closed** — gate the feature on its own env flag AND `gateway.isAvailable(feature)`.
6. **Handle `AiPolicyError`** as a configuration state, not a transport failure, and never lose the user's input.
7. **If it produces clinical documents**, store `ai_interaction_id` on the record and implement the review transition.
8. **Add tests** to `tests/ai-gateway.test.js` proving the new feature's denials.

Features that will need this when they grow AI, and currently have none: `fca_generation`, `whodas_interpretation`, `report_writing`, `resource_generation`, `document_summarisation`. **Do not pre-declare policies for them** — an unused policy that turns out to be wrong is worse than a loud denial that forces the decision when the feature is actually built.

---

## 13. Current feature policies

| Feature | Inputs | Outputs | Models | Review |
|---|---|---|---|---|
| `clinical_note_generation` | clinical | `clinical_document` | clinical_complex (default), clinical_standard | always |
| `opa_assistant` | public, internal, clinical | `assistant_response` (default), `clinical_document` | clinical_standard | per output type |

**Opa is classified clinical-capable, not "general".** That is not an oversight. A chat box inside a clinical portal will eventually be asked to summarise a session, whatever the interface says, and the transport must already be safe when it happens. Classification reflects what a feature **can** receive, not what it is supposed to.

---

## 14. Roadmap

**AI capability layer.** Policies are currently per *feature*. As features multiply — `fca_generation`, `fca_summary`, `fca_rewrite`, `fca_improve` — there is a real risk of each implementing slightly different rules, which is policy drift by another name. A capability layer would let several features consume one shared declaration:

```
capability: clinical_documentation
  allowedInputs:  [clinical]
  allowedOutputs: [clinical_document]
  requiresReview: true
```

Not required before Milestone 3, but worth doing before the third or fourth clinical AI feature exists.

**Closing the audit-correlation gap.** `ai_interactions.provider_request_id` allows CloudTrail correlation, but reconstructing where a specific note was processed is still a manual join. A small admin view over `ai_interactions` would make it self-service.

**Automated classification as a second check** — escalate-only, never relax. (§3)

---

## 15. Change control

Changes to the following are **governance decisions**, not routine edits. Each should be deliberate, reviewed, and reflected here:

- the approved model registry
- the provider allowlist in the boundary test
- any policy's classification, output types or region
- the audit field allowlist
- anything that would weaken a `DENY`

**Every change to the style prompt or output schema of a clinical feature is also a regulatory decision**, because the TGA places an ongoing duty on the practitioner to reassess whether functionality still matches the stated intended purpose. Treat prompt versioning as change control, not tuning.

Related documents:

- [`docs/mobile/CLINICAL_AI_PROVIDER_DECISION.md`](mobile/CLINICAL_AI_PROVIDER_DECISION.md) — why Bedrock, the alternatives considered, regulatory obligations, AWS setup steps
- [`docs/mobile/CASE_NOTE_AI_PRIVACY.md`](mobile/CASE_NOTE_AI_PRIVACY.md) — the exact transmission contract for case-note generation
