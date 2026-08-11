# Clinical AI Provider — Options, Obligations and Recommendation

**Researched 9–10 August 2026.** Companion to `CASE_NOTE_AI_PRIVACY.md`, which describes what the system transmits today. This document answers the question that file defers: *which provider, on which platform, under what terms.*

Not legal advice. Section 7 lists the questions that need an Australian privacy/health lawyer rather than a summary.

---

## 1. Recommendation

**Move the clinical-note provider from the first-party Anthropic API to Amazon Bedrock using an Australian geo inference profile (`au.anthropic.*`), pinned to Sydney and Melbourne.**

The reasoning is one fact and one consequence.

**The fact:** Anthropic's first-party API has no Australian data residency. The `inference_geo` request parameter accepts only `us` and `global`; workspace geo (data at rest) is `us` only and cannot be changed after workspace creation. Anthropic's own documentation states plainly that data is stored in the US. There is no EU option either — the widely repeated "US/EU" framing is wrong.
→ https://platform.claude.com/docs/en/manage-claude/data-residency

**The consequence:** sending a dictated clinical transcript to a US endpoint is a cross-border disclosure of health information under APP 8. That triggers s 16C of the Privacy Act, which makes the practice **accountable for the overseas recipient's acts** as if they were its own — even where reasonable steps were taken, even for an inadvertent breach, and even where the breach was a subcontractor's. Running inference onshore removes APP 8 and s 16C from the analysis entirely. That is a far larger risk reduction than any contractual term available on the US path.

**Don't expect the "cloud is a use, not a disclosure" argument to save you.** Vendors reach for APP Guidelines para 8.14, which allows provision to an overseas provider to count as a *use* rather than a disclosure. But that carve-out is written for **storage and access** — it requires a binding contract limiting the provider to *"the limited purpose of performing the services of storing and ensuring the entity may access the personal information."* An LLM that ingests a transcript and generates a note is analysing and transforming it, not storing it. The OAIC's default rule (para 8.12) is the opposite: *"Where an APP entity engages a contractor located overseas to perform services on its behalf, in most circumstances, the provision of personal information to that contractor is a disclosure."* Assume disclosure.

**A regulator has already reached this conclusion in almost these words.** Victoria's *Ambient AI Scribes Sector Advisory* requires that *"Health services must only use AI scribes that store and process data in Australia,"* and explains why: *"While legislation does allow international data storage and processing, if equivalent privacy and security standards are met per Australian Privacy Principle eight, in practice assuring this [is] challenging. Given this and considering the sensitivity of the information and elevated risk of re-identification, the most pragmatic and safe option is to mandate domestic storage and processing."* That advisory binds Victorian *public* health services, not a WA private practice — but it is the clearest available statement of what an Australian health regulator considers the safe standard, and it is the benchmark expectations will be measured against. The RACGP reaches the same place from the other direction: if a vendor cannot assure equivalent overseas protection, *"it is advisable to avoid their products."*

Bedrock's Australian geo profile keeps inference within Sydney and Melbourne for the entire request lifecycle, over the AWS backbone rather than the public internet. Bedrock stores nothing by default, invocation logging is off by default, and Anthropic has no access to the data (models run in AWS-operated deployment accounts). It is also IRAP-assessed to PROTECTED and HIPAA-eligible — useful supporting evidence, though see the box below for how much weight that actually carries.

Cost at this volume is roughly US$10–30/month — the platform choice is not a cost decision.

> **What IRAP is and isn't — don't over-weight it.** IRAP is a Commonwealth **government procurement** instrument, not a health-sector one, and it does not bind a private practice. ASD's own guidance states that IRAP assessors *"do not accredit, certify, endorse or register systems on behalf of ASD"* — an assessment produces a residual-risk report, not a pass/fail badge. There is no longer any government "certified cloud" list to appear on: the Cloud Services Certification Program ceased in March 2020 and the Certified Cloud Services List was retired in July 2020, replaced by a model where the *consuming* organisation makes its own risk-based authorisation. The OAIC's *Guide to Health Privacy* nowhere requires or mentions IRAP or PROTECTED.
>
> What binds this practice is **APP 11** — reasonable steps to protect personal information, scaled to sensitivity. An IRAP report is legitimate *evidence* to weigh in that assessment, but it is a signal, not a requirement, and it is an expensive signal that providers price in. **Do not select or reject a provider on IRAP status alone.** The things that genuinely move the APP 8 and APP 11 position are where the data physically sits, whether the provider retains or trains on inputs, the contractual terms, breach notification, access control and encryption. The same applies to the DTA Hosting Certification Framework ("Certified Strategic"/"Certified Assured"), which several Australian vendors advertise — also a Commonwealth-entity procurement requirement, also irrelevant here.

### Why not the alternatives

| Option | Verdict |
|---|---|
| **First-party Anthropic API** | Best privacy *controls* (ZDR or HIPAA-readiness, contractual no-training, self-serve BAA) but US processing and US storage. The controls do not solve the residency problem. |
| **Google Vertex AI** | **No Claude model is available in any Australian region.** Nearest is Singapore. Vertex's only Australian-committed generative model is Gemini 2.5 Flash (128k), which would mean abandoning Claude. |
| **Microsoft Foundry / Azure** | **No Claude in Australia East** — US regions and Sweden Central only. Its "Data Zone" APAC option is not Australia: it spans Japan, Korea, Singapore and India, and Microsoft may add regions without notice. |
| **Self-hosting an open-weight model** | Buys architectural control, costs operational security assurance. See §6. |

One warning worth recording: Anthropic's marketing page at `claude.com/regional-compliance` advertises Asia-Pacific residency "including… Australia" across Bedrock, Vertex and Foundry. **Only the Bedrock half is supported by product documentation.** Vertex's own residency table (7 Aug 2026) has no Australia column for Claude, and Foundry's region table has no Claude in `australiaeast`. Treat that page as aggregate marketing, not a per-platform commitment.

---

## 2. Concrete configuration changes

These are the specific edits implied by the recommendation. `backend/clinical-note-provider.js` is the only file that reaches a provider, so the blast radius is one module plus its tests.

### 2.1 The model default must change

`CLINICAL_NOTE_MODEL` currently defaults to `claude-sonnet-5`. Per AWS's model cards, **Sonnet 5 has no Australian geo route from Sydney** — it is Melbourne-only. Models with a confirmed `au` geo route from Sydney include Opus 4.8, Opus 4.7, Sonnet 4.6 and Sonnet 4.5.

Verify current availability in the AWS console before choosing; region/model matrices move. **Sonnet 4.6 or Opus 4.8** are the likely targets.

### 2.2 Never use `apac.*` or `global.*` inference profiles

This is the trap that would quietly defeat the whole exercise:

- `au.anthropic.*` — Sydney ↔ Melbourne only. **This is the one you want.**
- `apac.anthropic.*` — routes to Tokyo, Seoul, Osaka, Mumbai, Hyderabad or Singapore as well. Only two of eight destinations are Australian, and you cannot choose which.
- `global.anthropic.*` — every commercial AWS region worldwide.

AWS documentation also notes that cross-region requests can route to opt-in regions your account never enabled, and that where retention *is* configured, retained inputs and outputs are stored in destination regions.

### 2.3 Enforce it structurally, not by convention

A model-ID string is one careless edit away from offshore inference. Add Service Control Policies that:

- restrict `bedrock:InvokeModel*` to `ap-southeast-2` and `ap-southeast-4`;
- pin `bedrock-mantle:DataRetentionMode` to `none` organisation-wide.

Leave model invocation logging off, or point it at an S3 bucket in the same Australian region (destinations must be same-account and same-region).

### 2.4 Never use Fable 5 or Mythos 5 for clinical data

These are designated **Covered Models**: they *require* 30-day data retention, cannot run under zero data retention, and on Bedrock require a `provider_data_share` opt-in that shares data with Anthropic. They are also **excluded from Bedrock's HIPAA eligibility**. A ZDR-configured request naming one returns `400 invalid_request_error`.

This is worth an explicit guard in the provider module — a model allowlist rather than a free-text env var — so that a future config change cannot silently select one.

### 2.5 The client change

The current implementation posts raw JSON to `api.anthropic.com` with `x-api-key`. Bedrock uses SigV4 authentication. In Node the supported path is the Bedrock Mantle client from `@anthropic-ai/bedrock-sdk` (`new AnthropicBedrockMantle({ awsRegion })`), which exposes the same `messages.create` surface — so the forced `case_note` tool schema, `validateResult()`, the size caps and the status-only error logging all survive unchanged.

Confirm the exact inference-profile ID format and SDK support for geo-prefixed IDs in the console before committing; documentation and SDK typings for geo profiles are newer than the rest of the surface.

### 2.6 What you give up, stated honestly

On Bedrock, **AWS becomes the data processor and Anthropic's own arrangements no longer apply** — no Anthropic ZDR agreement, no Anthropic BAA. You are relying on the AWS Global DPA and Bedrock's default no-retention behaviour instead.

For an Australian health practice that is still the better trade, but the reason is narrower than it first appears: **it is the onshore processing that does the work**, because it removes the APP 8 and s 16C problem that no contract can fully solve. AWS's IRAP assessment is supporting evidence for an APP 11 reasonable-steps file, not the justification (see the box in §1). It remains a genuine trade rather than a free upgrade, and the privacy policy and vendor due-diligence file must name **AWS**, not Anthropic, as the processor.

---

## 2.7 AWS account setup — owner steps

The code side of Milestone 1 is done (see §2.8). These are the steps that must happen in the AWS console/CLI, and they are the ones that actually enforce residency — the provider's guards are defence in depth, not the primary control.

**1. Complete the Anthropic first-time-use form and activate the approved model subscriptions.** "Enable model access" is dated wording — Bedrock foundation-model access is now granted automatically once the Marketplace requirements are met. What remains is that Anthropic models require a one-time **first-time-use (FTU) form**, once per account or organisation, and the principal performing that activation needs Marketplace subscribe permissions. Expect a transient `AccessDeniedException` for up to ~15 minutes while the subscription completes on first call. **The runtime role does not need to keep Marketplace permissions afterwards** — activation is an administrative act, not a runtime one, and the role in step 2 deliberately has none.

On Melbourne: `ap-southeast-4` is an opt-in region, but that only matters if you **source** requests from it. As a *destination* inside the `au.` geo profile it needs nothing from you — AWS manages the profile's routing. Sourcing from Sydney, as configured, means there is no Melbourne enablement step.

**2. IAM policy for the app's role.** A cross-region inference profile is authorised against **both** the profile ARN **and** the underlying foundation-model ARN **in every destination region** — a policy listing only the model ARNs will fail. Foundation-model ARNs have an empty account field; that is correct, they are AWS-owned.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "InvokeViaAuProfile",
      "Effect": "Allow",
      "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
      "Resource": [
        "arn:aws:bedrock:ap-southeast-2:ACCOUNT_ID:inference-profile/au.anthropic.claude-opus-4-8",
        "arn:aws:bedrock:ap-southeast-4:ACCOUNT_ID:inference-profile/au.anthropic.claude-opus-4-8",
        "arn:aws:bedrock:ap-southeast-2::foundation-model/anthropic.claude-opus-4-8",
        "arn:aws:bedrock:ap-southeast-4::foundation-model/anthropic.claude-opus-4-8"
      ]
    },
    {
      "Sid": "ReadProfileMetadata",
      "Effect": "Allow",
      "Action": ["bedrock:GetInferenceProfile", "bedrock:ListInferenceProfiles"],
      "Resource": "*"
    }
  ]
}
```

**3. Service Control Policy — the real region lock.** This is what makes offshore inference structurally impossible rather than merely discouraged. `bedrock-mantle` is a separate IAM namespace, so a `bedrock:*` deny does not cover it; include both.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyBedrockOutsideAustralia",
      "Effect": "Deny",
      "Action": ["bedrock:*", "bedrock-mantle:*"],
      "Resource": "*",
      "Condition": {
        "StringNotEquals": {
          "aws:RequestedRegion": ["ap-southeast-2", "ap-southeast-4"]
        }
      }
    }
  ]
}
```

Two things this correctly handles: the `au.` profile's destinations are exactly these two regions, so legitimate traffic passes; and global cross-region requests evaluate `aws:RequestedRegion` as the literal string `unspecified`, which this allow-list style policy denies. (A deny-list style policy would not — don't rewrite it that way.)

**4. Separate security auditing from content logging — this is one decision, not two.**

- **Model invocation logging: OFF.** It is off by default. Turning it on writes full request and response bodies — clinical narrative — into your own S3 or CloudWatch, which then becomes your retention and access-control problem under APP 11. If you ever need it to debug, point it at an S3 bucket in the same Australian region with a short lifecycle rule, and turn it off again.
- **CloudTrail: ON.** CloudTrail records the API metadata — who invoked what, when, from where — without the content. Critically, for cross-region inference it records **`additionalEventData.inferenceRegion`**, which is the only authoritative record of *which* Australian region actually processed a given call. Cross-region calls are logged in the source region.

The application's own logs must stay content-free too: no raw prompts, clinical narrative, generated notes, request or response bodies, or client names in exception traces. The provider logs status codes only; keep it that way in Azure and Application Insights.

**5. Verify at runtime, because documentation alone can't settle this.**

```bash
aws bedrock get-inference-profile \
  --inference-profile-identifier au.anthropic.claude-opus-4-8 \
  --region ap-southeast-2
```

Confirm the status is active and every listed destination region is Australian. Then make one live generation call against a synthetic transcript and confirm it succeeds — forced tool use plus a geo profile is a combination worth proving once rather than assuming.

> ⚠️ **Zero-data-retention SCP — verify before trusting.** AWS documents a `DataRetentionMode` condition key for pinning an account to `none`, but publishes it under `bedrock-mantle:` in the service authorization reference while an AWS security blog example uses `bedrock:`. These are different namespaces, and a condition key that doesn't match evaluates as absent — which can make a `StringNotEquals` deny fire on everything, or not fire at all. Test any such policy in a non-production OU and confirm it actually denies before relying on it. Bedrock stores nothing by default regardless, so this is hardening, not a prerequisite.

## 2.8 The Opal AI boundary — one gateway, not per-feature security

Securing each AI feature independently only holds while every future developer remembers to. The backend therefore has **one** path to a model, and a test that fails the build if anything routes around it.

```
Feature (case notes · Opa · future FCA/WHODAS/reports/resources)
        │
        ▼
  backend/ai/ai-gateway.js          ← the only entry point
        │
   feature has a policy?  ─── no ──▶ DENY (there is no default policy)
   classification         ─── the stricter of policy and caller; never laxer
   region Australian?     ─── no ──▶ DENY
   model in policy?       ─── registry keys only, never raw ids
   model approved + AU?   ─── no ──▶ DENY
   provider in policy?    ─── no ──▶ DENY
        │
        ▼
  providers/bedrock-provider.js     ← the ONLY file that may import an AI SDK
        │
        ▼
  Bedrock runtime · AU geo profile · Sydney ⇄ Melbourne
        │
  audit: metadata only, allowed AND denied
```

| File | Responsibility |
|---|---|
| `ai/ai-gateway.js` | The single entry point. Evaluates policy, invokes, audits. `evaluate()` is pure, so the whole decision surface is unit-testable without mocking HTTP. |
| `ai/ai-policy.js` | Per-feature declarations: classification, allowed providers, allowed models, region, human review. Invariants enforced **at module load** — a policy that lets a clinical feature skip human review fails the process at boot. |
| `ai/ai-model-registry.js` | The only file permitted to contain a model id. Records which regions each model may be *sourced* from, because Australian routing is not uniform across models. |
| `ai/ai-classification.js` | `public` / `internal` / `clinical` and what each demands. Declared by features, not sniffed from content — detection that fails open is worse than none. |
| `ai/ai-audit.js` | Metadata-only events, built from a fixed field allowlist. Content cannot be smuggled in because there is no field for it. |
| `ai/providers/` | Transport only. Makes no policy decisions. |

**Three design choices worth keeping.**

*Opa is classified `clinical`.* Not because it is meant to receive clinical content, but because it **can**. A chat box in a clinical portal will eventually be asked to summarise a session, whatever the interface says. The classification reflects what a feature can receive, not what it is supposed to.

*A caller may escalate a classification but never relax one.* That direction is how boundaries erode.

*Denials are audited.* A refusal that leaves no trace is indistinguishable from a call that never happened — which is exactly what you do not want when reconstructing an incident.

### The boundary test

`tests/ai-gateway-boundary.test.js` scans every backend `.js` file for AI SDK imports, vendor endpoints and raw model identifiers, failing if any appear outside the allowlisted provider and registry files. **Verified by planting a violation:** a file under `fca/` importing the Anthropic SDK, referencing `api.anthropic.com` and naming a `global.` profile was caught on all three counts, and the suite returned to green when removed.

That converts "remember not to call Anthropic directly" into a build failure.

## 2.9 What was changed in code (Milestone 1, completed)

- `backend/clinical-note-provider.js` — rewritten onto `AnthropicBedrock` from `@anthropic-ai/bedrock-sdk` (the `bedrock-runtime` client). The `AnthropicBedrockMantle` client **cannot** be used: Australian geo profiles are unavailable on the `bedrock-mantle` endpoint, where the geo inference ID reads `N/A`. Adds the three onshore guards, a per-region model allowlist, and region-stamped provenance. `strict: true` is deliberately not set on the tool — AWS model cards currently list structured outputs as unsupported on Bedrock for these models, and `validateResult()` already enforces shape, types and size caps.
- `backend/tests/clinical-note-provider.test.js` — new, 12 tests covering the guards, including that `apac.`/`global.` are rejected, that Sonnet 5 is Melbourne-only, that Fable 5 and Mythos 5 can never be selected, and that a misconfiguration disables generation rather than routing offshore.
- `backend/.env.example` — documents the new variables and the region/model constraints.
- `backend/package.json` — adds `@anthropic-ai/bedrock-sdk`.

**Opa was migrated too.** It previously called the Anthropic API in the US on the strength of a documented "no clinical content" boundary. That reasoning was weak — a chat box inside a clinical portal will eventually be asked to summarise a session, whatever the interface says, and a documented boundary is a policy rather than a control. `api.anthropic.com` now appears nowhere in the backend.

## 2.10 Milestone 2 — clinical AI governance

Milestone 1 controlled **where** inference runs. Milestone 2 makes every interaction **attributable, reviewable and auditable** — so the practice can answer "which documents were AI-assisted, who approved them, and where was the data processed" without ever storing the AI conversation.

### Two axes, not one

Classification (what the request *contains*) and output type (what the answer *is*) are independent, and conflating them under-protects one case while over-protecting another. Through the same Opa chat box:

| Ask | Classification | Output type | Human review |
|---|---|---|---|
| "Explain sensory processing difficulties" | clinical-capable | `assistant_response` | no |
| "Write a progress summary for Johan" | clinical | `clinical_document` | **yes** |

Human review is **derived** from output type, never declared per feature — so a well-meaning policy edit cannot turn a clinical document into something that files itself. Producing a clinical document also forces the classification to clinical regardless of what the input looked like.

### What was added

- **Migration 023** — `ai_interactions` (one row per gateway call, allowed or denied), review/provenance columns on `case_note_drafts`, and a `system_settings` table. **No prompts, responses or clinical text anywhere in it.**
- **`ai/ai-output-type.js`** — the second axis, with `clinical_document` on a review-mandatory list enforced at policy load.
- **`ai/ai-kill-switch.js`** — stop all AI in seconds during an incident, via `system_settings.ai_global_enabled` (no redeploy) *or* `AI_GLOBAL_DISABLE=true` (works with the database down).
- **`ai/ai-audit.js`** — writes `ai_interactions` and mirrors a metadata entry into the general audit stream. `markReviewed()` records approval, scoped to the acting user.
- **`POST /api/mobile/case-note-drafts/:id/review`** — approve or reject, updating both the draft and the interaction so the clinical and governance records cannot drift apart.
- **Result metadata** — the gateway returns model, provider, source region, interaction id and review requirement. There is deliberately **no `rawPrompt` or `rawResponse`**: a caller cannot persist what it is never handed.

### The kill-switch failure mode, decided deliberately

On a database read error the **last known value is retained**. If the switch has never been read successfully, AI is treated as enabled.

Failing closed would mean a brief database hiccup halts clinical documentation mid-clinic, and the call is already gated by a feature flag and by gateway policy — the kill switch is a fourth control, not the only one. But a *deliberate* disable survives a later read failure: expiring the cache forces a re-read without discarding what was last seen. A test caught the original implementation getting this backwards.

### The strengthened CI guard

The boundary test now also fails on **any** vendor term (`anthropic`, `openai`, `bedrock`, `claude`, `gemini`) appearing in executable code outside `backend/ai/` — comments stripped first, so a file can still explain the boundary in prose without failing the build. That catches shapes nobody anticipated: a new vendor, a renamed package, a model id typed from memory.

**Full suite: 1,712 passing.** The 6 failures in `frontend-stage3-guards.test.js` are the other session's FCA and progress-note-letter work, unrelated to AI.

## 3. If the first-party API is kept instead

Should the decision go the other way — for model availability, latency or simplicity — the configuration that follows is:

- **Use HIPAA readiness, not ZDR.** Anthropic's documentation is explicit: where an organisation handles health information, HIPAA readiness is the arrangement to use and ZDR is not additionally required. The BAA is now **self-serve** in the Console (Settings → Privacy → HIPAA compliance). Note it is **permanent once enabled** and enforced org-wide, so clinical and non-clinical workloads need separate organisations.
- ZDR by contrast is sales-gated with no published eligibility criteria, and — importantly — **it does not block non-eligible features**. Using the Files API under ZDR silently steps outside the arrangement with no error. HIPAA mode hard-blocks instead, which is the safer failure mode.
- Set `inference_geo: "us"` rather than leaving the `global` default, so processing is at least confined to a single known jurisdiction. Costs 1.1× tokens. Note this is unsupported on Haiku 4.5 (Claude 4.6 and later only).
- **Disable any feedback UI.** A thumbs-up/down submission stores the entire conversation for five years and may be used for training — the single largest exception to the no-training commitment.
- Trust-and-safety review still applies. Flagged content may be retained up to two years regardless of ZDR or HIPAA arrangements, and safety classifier scores up to seven years.
- Sub-processors include user-support vendors in **South Africa and Canada**, and identity verification in the UK. These belong in a privacy impact assessment.

The commercial no-training commitment is strong and contractual, not merely policy: *"Anthropic may not train models on Customer Content from Services"* (Commercial Terms §B, effective 17 June 2025).

---

## 4. The obligations that matter more than the vendor choice

Provider selection is the easy half. Three regulators reach this feature, and two of them impose requirements no configuration can satisfy.

### 4.1 NDIS Commission — the strictest requirement found, and the biggest gap

The Commission's **position statement on AI (February 2026)** states that if a provider uses AI, it expects **"all information is appropriately de-identified and that no personal information of participants is disclosed to AI systems,"** and that failing to do so *"may be breaking the law, including their legal obligations under the NDIS Act."* Its named risks include processing or storage of personal information overseas, and lack of transparency about how data is stored once entered into an AI system.

The statement is formally scoped to **behaviour support plans**, not case notes. But its reasoning rests on **s 6(b) of the NDIS Code of Conduct** — respect the privacy of people with disability — which binds registered *and unregistered* providers across all supports. Its risk list is generic to AI, and it is the only provider-facing AI guidance the Commission has published.

**This is the largest gap between what the system currently does and what a regulator expects.** The design deliberately withholds every structured identifier, but the transcript is free text: whatever the therapist speaks is transmitted. If a therapist says a participant's name, it goes. See §5 for what can and cannot be done about that.

Whether the Commission would apply this reasoning outside the behaviour-support-plan context is untested. It is a real regulatory risk, not a theoretical one.

### 4.2 AHPRA and the Occupational Therapy Board — informed consent is mandatory

AHPRA's *Meeting your professional obligations when using AI in healthcare* was adopted by the Occupational Therapy Board on 22 August 2024. It creates no new rules; it restates existing Code of Conduct obligations, which **are** enforceable through the National Law. Non-compliance is a professional conduct matter.

Two principles bite directly:

- **Informed consent.** *"If using an AI scribing tool that uses generative AI, this will generally require input of personal data and therefore require informed consent from your patient/client"* — and *"ideally note the patient's response in the health record."*
- **Accountability.** *"If using an AI scribing tool, the practitioner is responsible for checking the accuracy and relevance of records created using generative AI."*

AHPRA's own case study 1 is almost exactly this workflow: a practitioner dictating clinical findings to a generative AI tool and pasting the cleaned version into the notes.

**Assessment: the accountability half is already satisfied by design** — output is a draft, the therapist reviews and edits it, nothing finalises automatically, and the original transcript is retained alongside. **The consent half is a practice-process gap, not a code gap**, though the app could support it (see §8).

Consent must also meet the OAIC's four elements — informed, voluntary, current and specific, and from someone with capacity. Two consequences: **do not bundle AI consent into the general intake form**, and note that capacity is a live issue for a practice serving NDIS participants, where supported or substitute decision-making may be required.

### 4.3 TGA — where a scribe becomes a regulated medical device

**This is the fastest-moving item in this document, and the TGA is now enforcing.**

The TGA's digital scribes guidance was **last updated 30 January 2026**. The test:

- **Excluded:** scribes *"intended only to transcribe and translate clinical conversations into written records without performing analysis or interpretation."*
- **Regulated:** a scribe that *"analyses or interprets clinical conversations"* — the TGA's worked example being generation of *"a diagnosis, differential diagnosis or treatment recommendation **not explicitly stated by the healthcare practitioner**."*

Products meeting the device definition without ARTG inclusion *"are being supplied illegally"*, and the TGA states it may take compliance action.

**The enforcement posture changed six days ago.** At the HIC2026 conference (3–4 August 2026), TGA product quality division head Tracey Duffy reportedly announced that the digital scribes review has **moved from a roughly 12-month vendor engagement period into compliance action**, targeting organisations that deployed a scribe operating as a medical device without seeking approval. Conduct identified: scope creep, AI influencing clinician decisions, lack of transparency, weak post-market feedback, inadequate risk monitoring. Updated developer guidance was said to be weeks away, with compliance actions over the following 12 months. *(Trade-press report — The Medical Republic, 4 Aug 2026 — not an official TGA release. Verify before relying on the detail; the direction of travel is corroborated by earlier reporting from September 2025.)*

Note also: **as at September 2025 no AI scribe product was reported as ARTG-registered.** The market is not a safe harbour to benchmark against — several current participants may themselves be exposed.

#### Where this design sits — better than expected

The style prompt's absolute rule — *"Use ONLY information present in the dictation and the session context provided. Prefer omission or 'Not documented' over inventing anything"* — is, in effect, a direct engineering control against precisely the thing the TGA regulates. That is a strong position and worth stating explicitly in the practice's own documentation.

Checking each output field against the boundary:

| Field | Assessment |
|---|---|
| `identify`, `sessionDetails` | Restructuring dictated content. Comfortably excluded. |
| `plan` — *"a short list of genuine follow-up actions"* | Excluded **provided it stays extractive**. A plan item the therapist dictated is transcription; one the model composed, completed or tidied into existence — including plausible filler when the dictation was thin — is a treatment recommendation not explicitly stated. The risk is not intent; it is model helpfulness under sparse input. |
| `warnings` — *"brief notes where the dictation was ambiguous (unclear person, unclear sequence, unclear clinical statement, incomplete plan)"* | **Excluded as currently written, and this is the field that most easily drifts.** These are documentation-quality observations about the *dictation*, not clinical judgements — the correct side of the line. But a warnings feature that flagged clinical risk, deterioration signals, or suggested escalation or referral would be analysis and interpretation of clinical content, and on the plain wording points at the regulated side. The TGA's review specifically named *"AI influencing decisions of clinicians"* as a concern. |

**Recommended:**

1. Make clinical warnings an **explicit non-goal**, in the prompt, in this document, and in a comment on the tool schema — so a future prompt edit is a deliberate regulatory decision rather than a quality improvement.
2. Add a test asserting warnings stay in the documentation-quality class and plan items are traceable to the transcript.
3. **Watch the marketing language.** Intended purpose is determined partly from labelling, instructions and **marketing materials** (Clayton Utz, 24 July 2026). Describing the feature as "Opa suggests your next steps" could establish a therapeutic intended purpose that the code itself does not have.

**Open question — potentially decisive.** ARTG obligations are expressed in terms of goods *"imported, exported, or supplied in Australia"*, and enforcement language targets *suppliers*. A tool built and used solely within the practice that developed it may therefore engage the framework differently from a commercial product. This was **not resolved** in research, the TGA maintains distinct arrangements for some in-house devices, and it materially changes the obligations. It needs a direct answer from the TGA or a regulatory lawyer. **It also becomes the pivotal question the moment this is offered to any other practice.**

### 4.4 Privacy Act baseline

- The practice **is** covered regardless of turnover. The small-business exemption does not apply to health service providers, and allied health is expressly included.
- Health information is **sensitive information**; collection generally requires consent.
- **APP 8 and s 16C** apply if processing is offshore — the reason §1 recommends what it does.
- **APP 11.2** requires destruction or de-identification when no longer needed, and where storage is outsourced, reasonable steps include **verifying the provider actually completed the destruction** — not merely accepting that its policy says so.
- **Notifiable Data Breaches:** where multiple entities hold the same information, all hold obligations but only one need comply — *"If no assessment is conducted… each entity that holds the information may be found to be in breach."* A breach at the AI provider is the practice's notifiable breach too, and OAIC expects the entity with the direct relationship to notify. **The vendor contract therefore needs a breach-notification clause fast enough to preserve the 30-day assessment window — 24–72 hours.** This is the most commonly missed term.

### 4.5 Western Australia

WA has no private-sector health records statute; the Commonwealth Privacy Act governs alone. The **Privacy and Responsible Information Sharing Act 2024 (WA)** commenced 1 July 2026 but binds **public sector entities only** — a private practice is out of scope, unless a WA government contract explicitly imposes compliance. Worth checking any such contract.

One design decision already avoids a real criminal-law exposure: **the therapist dictates after the session rather than recording the consultation.** Surveillance devices legislation is a **separate criminal regime** sitting underneath privacy law — the RACGP states plainly that *"in some Australian jurisdictions, recording a private conversation without consent is considered a criminal offence"* — and AHPRA warns of *"criminal implications if consent is not obtained before recording."* Dictation-after-the-fact largely sidesteps this. Do not change that design without advice; moving toward in-session capture changes the risk category, not just its degree.

### 4.6 Four recent developments that change the risk picture

Most AI-scribe commentary online predates these. Each is verified from a primary source.

**A personal cause of action now exists, with no damages cap.** The statutory tort for serious invasions of privacy commenced **10 June 2025**. An individual can sue directly — it does not depend on OAIC enforcement — for intrusion upon seclusion or misuse of information, where they had a reasonable expectation of privacy and the invasion was intentional or reckless. Remedies include damages with no stated cap, injunctions, and an order to apologise. A leaked therapy transcript is close to a paradigm case. This materially changes the calculus versus any analysis written before mid-2025.

**The consent bar in psychology is now written and tool-specific.** The APS *Professional practice guidelines for the use of AI and emerging technologies* (announced 11 February 2026) require **written** informed consent before using AI that involves client data, influences clinical decision-making, or contributes to client records, and state that **"blanket consent for 'AI use' is not sufficient"** — an AI scribe is a different consent from a therapeutic assistant. Consent must be revisited over time rather than collected once. Two further lines are worth internalising: AI-produced content must be **clearly identified as such** in the record, and **"efficiency alone is not sufficient justification"** for using AI at all.

APS binds psychologists, not occupational therapists, so this is not directly binding on an OT practice. But it is the direction of travel across the professions, it applies immediately to any psychologist the practice employs or contracts, and building to the stricter standard costs little.

**There is no "exempt" tier for AI decision support.** Traditional clinical decision support software can be *exempt* — still a medical device, but not requiring ARTG inclusion — if it only supports a recommendation to a health professional, doesn't process medical images or signals, and doesn't replace clinical judgement. The TGA now states directly: **"an AI-enabled CDSS will not meet the exemption criteria."** So the cliff between "restructures what was said" and "suggests something that wasn't" is far steeper for an AI tool than for conventional software — there is no soft landing, only full ARTG inclusion. This sharpens §4.3 considerably.

**Monitoring the tool is an ongoing duty, not a procurement check.** The TGA's digital scribes guidance places obligations on the *practitioner* to reassess regularly whether functionality still matches the stated intended purpose and — specifically — whether **"software updates have introduced new functionality that changes the intended purpose."** For a bought product that means watching vendor release notes. For a tool the practice builds itself, it means **every change to the style prompt or the output schema is a regulatory decision**, and should be treated as one. The TGA also tells consumers directly that practitioners *"must tell you when they plan to use a digital scribe"* and that they *"can withdraw consent at any time and ask for another method"* — which is the consent and opt-out path §8 recommends building.

**Worth reading directly:** the ACSQHC's *Pragmatic AI guidance for clinicians* (13 August 2025) includes an **Ambient AI Scribe safety scenario** and is explicitly scoped to allied health professionals in private practice. It is the most directly applicable government resource identified and was not retrievable during this research.

---

## 5. De-identification — build it, but do not rely on it

The transcript is the only clinical carrier in this architecture, so redaction before transmission is the obvious lever. The evidence supports building it as defence-in-depth and **not** as a compliance boundary.

**The numbers are worse than the marketing suggests, and much worse outside the US.**

- The only published evaluation on **Australian** clinical text (El-Hayek et al., *Int J Med Inform* 2023, 300 GP progress notes) found the best tool reached **67% aggregate recall**. All four tools tested performed poorly on LOCATION. The authors concluded existing tools were *"not immediately suitable… without modification."*
- A UK study (Aug 2025) found Philter dropped from 99.46% recall on US data to **79%** on UK documents. Same software, different country.
- Adversarial testing is the sharpest finding: **DIRI** (arXiv 2410.17035) used an LLM attacker against three de-identifiers on real clinical notes. The best defender still left **9% of notes re-identifiable** — roughly one in eleven.

Expect **one to two leaked identifiers per note**, not one per thousand.

**Two factors make this design's position harder still.** ASR output arrives without reliable capitalisation or punctuation, and NER models lean heavily on capitalisation to find names — so recall on dictated transcripts is plausibly *worse* than published figures for typed notes, and nobody has measured it. And OT narrative is unusually dense in quasi-identifiers that survive any name-stripping: school, employer, home modifications, specific assistive equipment, funding scheme, rare diagnoses, carer constellation. A note can satisfy every token-level PHI schema and still be unique in a local population.

**If built:**

- Run it **locally** — Presidio (MIT) or Philter (BSD), self-hosted. Explicitly rule out AWS Comprehend Medical and Google Healthcare API/DLP for this purpose: both are cloud-only, so using them to de-identify means transmitting the un-redacted narrative to a third party first. That replaces one disclosure with two.
- Use **typed, consistent placeholders** (`[CLIENT_1]`), not deletion and not realistic fake names. Placeholders preserve coreference so the model can still track who did what, and — unlike surrogates — cannot silently corrupt a clinical record the therapist reads back and files. Note Presidio is stateless; the consistent-mapping layer is yours to write.
- Budget for Australian localisation: name distributions, suburb and postcode formats, Medicare/IHI/NDIS/DVA number patterns, DD/MM dates.
- **Measure it on your own dictated transcripts.** Australian + allied health + ASR output has zero published evaluation. You would be the first to measure it, so measure it rather than extrapolating.

**The honest framing for any privacy document:** do not state that data sent to the provider is de-identified. State that structured identifiers are withheld by design, that a redaction pass reduces spoken identifiers on a best-effort basis, and that the transcript is nonetheless handled as identified health information. The load-bearing protections are onshore processing, the provider agreement, and retention limits — not the regex.

There is also a lower-tech lever with a better cost-benefit ratio: **guidance and UI prompting for therapists to dictate using "the participant" rather than names.** It costs nothing, and it addresses the NDIS Commission's expectation more directly than any downstream filter.

---

## 6. Self-hosting — the maximum-control option, and why it probably isn't right

Measured against this actual workload: worst-case input is ~3,700 tokens (a ~1,390-token style prompt plus an 8,000-character transcript cap), output ~900–1,500 tokens. At 40 notes/day that is roughly **12 GPU-hours of real compute per month**. Self-hosting means owning or renting 730 hours to use 12.

Open-weight quality is adequate for structuring — this is summarisation and extraction, the easy end of the capability curve, not open-ended reasoning. A 27–32B dense model (Qwen3.5-27B or Gemma 4 31B, both Apache 2.0) at Q8 is the smallest thing worth trusting; below ~14B, omission rates rise, and **omission is the more dangerous failure for case notes**.

**But self-hosting is not automatically more private in a regulatory sense, and in several respects it is worse.** APP 11 security obligations do not diminish when the box comes in-house — they stop being shared. You inherit patching, disk encryption, backups, physical security, access control, availability and breach detection, with no vendor attestation to point to.

This is not theoretical. **CVE-2026-7482 ("Bleeding Llama"), CVSS 9.1, disclosed 5 May 2026** — an unauthenticated out-of-bounds read in Ollama's GGUF path leaking process memory including *"system prompts, user messages"*, across roughly 300,000 exposed servers. In a clinical deployment, "leaks user messages" means leaks the therapy transcript. The fix landed in February 2026 but CVE assignment lagged about three months, so scanners showed nothing during the window — patch-when-notified would have failed.

**Verdict:** self-hosting buys architectural control and costs operational security assurance. For a practice with no dedicated ops staff, that trade is negative.

### The middle ground: managed open-weight inference, Australian-owned and onshore

There is one option between "US hyperscaler" and "run it yourself" that is genuinely buyable. A survey of Australian sovereign-cloud and GPU providers found that almost all of them are either datacentre landlords selling megawatts (NEXTDC, CDC, Macquarie Data Centres), or enterprise/government IaaS with no published pricing and a six-figure sales motion (Vault Cloud, AUCyber, Sharon AI, Firmus, Interactive). None sells tokens to a small practice.

**The exception is ResetData** — the only Australian-owned provider found with a self-serve, OpenAI-compatible inference API, publicly priced in AUD, hosted in Australia. Its AI Factory (AI-F1) is in Melbourne CBD, NVIDIA H200, launched Q2 2025; Centuria Capital took a 50% stake in August 2024. Headline pricing starts around **A$0.09 per million tokens** for models including Gemma 4 26B and Qwen3 Coder 30B, which at this workload's volume is a few dollars a month. It claims ISO 27001 and SOC 2 (not IRAP — see §1 on why that matters less than it sounds).

**The trade is model quality, not privacy.** ResetData serves open-weight models, so this is the §6 quality question — adequate for structuring, with a real omission risk below ~27B — combined with hosted convenience and Australian ownership. It removes the "US company processes our clinical data" objection entirely, which neither Bedrock nor the first-party API does, even with onshore inference.

**Worth a trial** if Australian ownership (not just Australian hosting) is a requirement the practice wants to meet, or as a fallback provider. Before sending real dictation, get written answers on prompt and response retention, training use, sub-processors, which facility performs inference, breach notification, and whether the API terms name an Australian contracting entity. Note the public page shows only one headline rate — the full model and price table sits behind the app, and none of the signup terms were verifiable externally.

Revisit self-hosting proper only if the open-weight omission gap closes and an appliance-grade managed option appears.

**On-device (iPhone) is not viable for full-length notes**, though it is closer than expected and worth revisiting.

Apple's Foundation Models framework is attractive on paper: zero app-size cost, effectively zero memory cost (an Apple engineer confirmed on the developer forums in July 2025 that model memory is *"managed centrally by the operating system"* with *"very minimal"* app impact), no licensing question, and `@Generable` guided generation that maps cleanly onto the `case_note` schema.

**The blocker is the context window, now verified from Apple's own documentation:** *"Apple's on-device foundation model has a context window of 4096 tokens per session"*, and `SystemLanguageModel.contextSize` confirms this covers *"both input prompts and generated responses."* Short dictations (~400 tokens in, ~400 out) fit comfortably. This system's worst case — a 1,390-token style prompt plus an 8,000-character transcript, then ~1,000 tokens of output — does not. Apple's documented workaround is chunking across sessions, which risks exactly the cross-section consistency and detail-preservation failures that matter most here.

Two further cautions. Apple's safety guardrails are an unquantified risk on clinical content: therapy transcripts routinely contain suicidal ideation, self-harm, trauma and substance use, and one React Native wrapper's documentation explicitly warns the model *"may refuse certain categories of prompts (e.g. personal health data interpretation)."* Notably, **none of the React Native bridges surveyed maps Apple's `guardrailViolation` error to a typed code** — a refusal would surface as a generic failure. And Apple updates the system model in routine OS releases, so prompt behaviour can shift without a rebuild — a real consideration for a regulated-adjacent product where a bundled, frozen model is reproducible.

If revisited, two things changed in 2026 that improve the picture: **Gemma 4 is now Apache-2.0** (Gemma 3n was not) and **Qwen3.5 is Apache-2.0**, so a bundled ~1.3–2.7 GB open-weight model is now licence-clean for commercial healthcare use. A hybrid — Foundation Models for short dictations, a bundled model for long ones — is prototypable. Whichever path, **prototype the real clinical prompts against the real model first**, and build a faithfulness eval scoring specifically for invented content, dropped content and altered clinical meaning. No public benchmark measures that, and it is the entire risk surface.

---

## 6a. What the market does — and why it validates this design rather than replacing it

A survey of AI scribe and clinical-documentation products available to Australian clinicians (Corti, Nabla, Microsoft Dragon Copilot; and the Australian allied-health cohort: Perci Health, Splose, SecondShift, Halaxy, Zanda, ShiftCare, Nookal, Cliniko) produced three findings that bear on the build-versus-buy question.

**The Bedrock pattern recommended in §1 is what the best-documented Australian vendors already do.** ShiftCare publishes the strongest AI governance documentation of any Australian product reviewed, and its architecture is **Anthropic Claude via AWS Bedrock, inference pinned to `ap-southeast-2`** — it is the only vendor in the entire survey that explicitly separates *inference* locality from *storage* locality, which is exactly the distinction §2.2 turns on. Zanda's BizzyAI Scribe uses Anthropic via AWS Bedrock in Sydney. Cliniko, which deliberately ships no native AI, has publicly argued that sending clinical data directly to OpenAI is "irresponsible" and pointed to Azure or AWS Bedrock as the compliant pattern. Three independent Australian vendors converging on this architecture is useful corroboration.

**No product surveyed claims ARTG inclusion, and only one publishes any regulatory position at all.** Microsoft states Dragon Copilot is UKCA Class I in Great Britain and "in all other jurisdictions… not a medical device." Every Australian allied-health product is silent; the closest any comes is a liability disclaimer, which is a legal shield rather than a regulatory position. Combined with the TGA's move to compliance action (§4.3), **the market is not a safe harbour to benchmark against** — some current participants may themselves be exposed.

**Certification and residency are inversely distributed, and nothing offers both.** The international scribes have real certification stacks (Corti: ISO 27001, SOC 2 Type II, BSI C5; Nabla: SOC 2 Type II, ISO 27001, Texas RAMP) and **no Australian data residency** — Nabla would store an Australian clinician's data in Belgium while routing speech-to-text to Azure US regions, and Dragon Copilot does not list Australia as a customer location at all. The Australian products claim residency but hold almost no certifications: exactly **one** independently verifiable certificate exists across the entire Australian cohort (Zanda's ISO 27001, cert #122214, Prescient Security — **which expired 12 April 2026 with no renewal published**). Nobody holds ISO 42001. Nobody is IRAP-assessed at product level.

Several vendors also carry direct contradictions between their security pages and their own privacy policies — Perci Health assures data stays in Australia while its privacy policy discloses recipients "likely to be located in the United States"; Halaxy affirmatively denies using any third party for AI while its privacy policy lists 25+ overseas sub-processors.

**Implication:** building this in-house is defensible. The current design already exceeds the market on several axes that matter — audio is never retained anywhere (most vendors retain it briefly or are silent), structured identifiers are withheld by design and merged only after generation (no surveyed vendor does this), and the provider and model are known and pinned rather than undisclosed. What the market has that this does not is third-party attestation, which is a governance gap rather than an architectural one.

### The mechanism behind the market's residency gap

There is a systematic split in this market between **storage at rest** — easy to keep onshore, and widely advertised — and **inference** — hard to keep onshore, and almost never disclosed with a named region. The technical reason is documented by the providers themselves:

- **OpenAI offers Australian data residency for storage but not for inference.** OpenAI's own documentation lists Australia as available for regional storage and **not** available for regional processing; inference residency is limited to the US, Europe (EEA + Switzerland) and the UAE. **Any Australian product built directly on OpenAI's API therefore cannot have onshore inference**, regardless of what its marketing says about Australian data.
- **Azure OpenAI does support `australiaeast`** as a model deployment region, so Azure is a viable route to onshore inference for OpenAI-family models — but a vendor has to actually choose that region, and few say whether they have.
- **AWS Bedrock supports Claude with an Australian geo profile**, which is the route recommended in §1.

This is not a fringe concern. The Australian Department of Health's own briefing material (FOI 26-3154, published June 2026, including an AI Expert Advisory Group agenda dated 13 April 2026) records the Department's assessment that suppliers **"may be unaware their cloud platforms send data outside Australia"**, alongside an RACGP estimate that roughly 40% of GPs were using AI scribes as at November 2025 and a note that most scribes fall outside the software-as-a-medical-device framework with "little oversight."

The gap shows up concretely across the market. **Heidi Health** — the best-certified vendor reviewed, holding ISO 27001, ISO 42001, SOC 2 and Cyber Essentials Plus, with the strongest allied-health template coverage — publishes a sub-processor list that names regions for its AWS and Azure entries but leaves the region **blank** for the Google Cloud entry described as "hosting and processing for many of our AI models." **Lyrebird Health** markets that all LLM computation is performed locally in Australia, while its own privacy policy (effective 16 February 2026) discloses "European Union: Azure OpenAI for language processing." Speech-to-text does appear to be onshore in Sydney; the note-generation step is not.

**The conclusion that matters for this decision:** no product surveyed gives an Australian allied-health practice a certified scribe with *documented* onshore inference. The two that state onshore *processing* are coreplus (which has no AI feature to process anything with) and Telstra Health's Smart Scribe (which is GP-only and MedicalDirector-only). Built on Bedrock with an `au.` profile and SCP enforcement, **this system would be better documented on inference residency than anything currently purchasable** — which is a strong argument for building rather than buying, provided the governance gap (§8) is closed.

### ⚠️ A live issue in the existing stack: Splose and OpenAI

Not about the mobile app, but it surfaced during the survey and warrants separate action.

Splose's own help centre states that **"splose AI is a … generative AI feature in splose powered by OpenAI"** (updated 17 June 2026), covering Transcribe and Dictate as well as progress notes and letters. Its privacy policy confirms the AI features "utilise technologies provided by OpenAI LLC," that Splose "may transmit personal information to OpenAI," and that sharing within its group "will involve transferring your data outside of Australia."

Combined with the OpenAI residency fact above, this means **Splose consultation content is being processed offshore** — its "stored in Australia via AWS" claim is a storage claim, and the security page does not say this plainly. Splose holds no ISO 27001 or SOC 2. Its July 2026 setup guide asserts that data is not retained by OpenAI and never used for training; the binding privacy policy contains no such commitment. Sources also disagree on whether the feature is opt-in or opt-out, which is itself worth resolving.

Since the portal integrates with Splose as the practice management system, establish directly with Splose: which AI features are enabled on the practice's account; whether the feature is opt-in or opt-out and what the account's current state is; whether client information has already been transmitted to OpenAI; in which region OpenAI inference occurs; and what the contractual position on retention and training actually is, in the DPA rather than a marketing page. A cross-border disclosure through an existing vendor carries the same APP 8 and s 16C exposure as one through this feature — and it would never appear in a review of this codebase.

---

## 7. Questions requiring professional advice

Not resolvable from documentation. These need an Australian privacy/health lawyer.

1. **Is AI-assisted drafting within the primary purpose of collection, or a secondary purpose?** No OAIC guidance resolves this for clinical documentation. If secondary, the stricter "directly related" test for sensitive information applies. This determines the whole APP 6 analysis.
2. **Does the NDIS Commission's "no personal information to AI systems" expectation extend beyond behaviour support plans?** The largest gap between what privacy law permits and what a regulator expects.
3. **Does TGA regulation attach to a tool built and used only in-house?** Regulation attaches to supply; the in-house position is untested.
4. **WA Surveillance Devices Act** — confirm the dictation-after-session design fully avoids it, and what changes if the workflow ever moves toward in-session capture.
5. **Retention periods** for private health records in WA — no state statutory rule was identified; this is a question for the lawyer and the indemnity insurer.
6. **Professional indemnity cover** — AHPRA specifically advises consulting the insurer on whether AI tools used in practice are covered.

---

## 8. What the current architecture already gets right

Recording this so it is not lost in a redesign. Several decisions are load-bearing for compliance and were made before this research:

| Decision | Why it matters |
|---|---|
| On-device transcription; **no audio uploaded, stored or sent to any provider** | Audio is the highest-sensitivity artefact and the hardest to defend. There is no audio field in the API at all. |
| Only transcript + date label + name-stripped service label transmitted | Minimises the disclosure. `providerServiceLabel()` strips the client's name out of the appointment title. |
| Deterministic metadata merged **server-side after** generation | Client name, address, billing and travel never reach the model, and the model can never fabricate them. |
| Output is a **draft** the therapist reviews and edits; nothing auto-finalises | Directly satisfies AHPRA's accountability principle. |
| Original transcript retained alongside the draft | The therapist can verify the note against source — which is what AHPRA requires them to do. |
| Fail-closed provider (`isEnabled()` requires both env vars) | No accidental enablement, no silent fallback provider. |
| Forced tool schema + `validateResult()` size caps | Model output is data to be validated, never trusted markup. |
| Status-only error logging; audit events carry ids and counts only | No clinical narrative in logs, analytics or audit trails. |
| Strict `user_id` scoping, 404-on-not-yours | No cross-therapist visibility of drafts. |
| Dictation **after** the session, not recording the consultation | Sidesteps WA surveillance-device exposure. |
| Single provider seam in one file | This entire document's recommendation is a one-module change. |

### Gaps this research identifies

1. **Model default (`claude-sonnet-5`) has no Australian geo route from Sydney** — must change with the platform move.
2. **No model allowlist** — a config change could select a Covered Model (Fable 5 / Mythos 5) that mandates retention and is HIPAA-ineligible.
3. **No consent capture in the app.** AHPRA requires informed consent for AI scribing and recommends recording the response in the health record. Consider a per-client consent flag that gates the case-note flow, and a non-AI path for clients who decline or withdraw — the NDIS Practice Standards explicitly contemplate withdrawing consent.
4. **No transcript redaction pass** — see §5 for the honest assessment of what one would and would not achieve.
5. **`CASE_NOTE_AI_PRIVACY.md` names Anthropic as the provider**; it needs updating if the platform moves to Bedrock, since the processor and the governing contract both change.
6. **Compliance artefacts** not yet drafted: privacy policy update, collection notice, standalone AI consent wording, data flow map, PIA, vendor due-diligence file, retention and destruction policy with provider-deletion verification, breach response plan covering the vendor pathway.

---

## 9. Key sources

**Anthropic** — [Data residency](https://platform.claude.com/docs/en/manage-claude/data-residency) · [API and data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention) · [Covered Models](https://support.claude.com/en/articles/15425695) · [Commercial Terms](https://www.anthropic.com/legal/commercial-terms) · [Usage Policy](https://www.anthropic.com/legal/aup) · [Trust Center](https://trust.anthropic.com/faq)

**AWS** — [Bedrock data protection](https://docs.aws.amazon.com/bedrock/latest/userguide/data-protection.html) · [Data retention](https://docs.aws.amazon.com/bedrock/latest/userguide/data-retention.html) · [Inference profiles](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-support.html) · [IRAP services in scope](https://aws.amazon.com/compliance/services-in-scope/IRAP/) · [HIPAA-eligible services](https://aws.amazon.com/compliance/hipaa-eligible-services-reference/)

**Google / Microsoft** — [Vertex AI data residency](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/data-residency) · [Foundry partner model regions](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-from-partners)

**Regulators** — [OAIC guidance on commercially available AI products](https://www.oaic.gov.au/privacy/privacy-guidance-for-organisations-and-government-agencies/guidance-on-privacy-and-the-use-of-commercially-available-ai-products) · [APP 8 cross-border disclosure](https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines/chapter-8-app-8-cross-border-disclosure-of-personal-information) · [APP 11 security](https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines/chapter-11-app-11-security-of-personal-information) · [Notifiable Data Breaches](https://www.oaic.gov.au/privacy/privacy-guidance-for-organisations-and-government-agencies/preventing-preparing-for-and-responding-to-data-breaches/data-breach-preparation-and-response/part-4-notifiable-data-breach-ndb-scheme) · [AHPRA AI obligations](https://www.ahpra.gov.au/Resources/Artificial-Intelligence-in-healthcare.aspx) · [OT Board adoption](https://www.occupationaltherapyboard.gov.au/News/2024-08-22-AI-in-healthcare-code-of-conduct.aspx) · [NDIS Commission AI position statement (Feb 2026)](https://www.ndiscommission.gov.au/sites/default/files/2026-02/Position%20statement%20-%20Use%20of%20artificial%20intelligence%20in%20development%20of%20behaviour%20support%20plans.pdf) · [TGA digital scribes](https://www.tga.gov.au/products/medical-devices/software-and-artificial-intelligence-ai/overview/types-software-based-medical-devices/digital-scribes)

**Research** — El-Hayek et al., [Australian GP de-identification evaluation](https://pubmed.ncbi.nlm.nih.gov/36870249/), *Int J Med Inform* 2023 · Morris et al., [DIRI adversarial re-identification](https://arxiv.org/abs/2410.17035), 2024 · [Bleeding Llama CVE-2026-7482](https://www.cyera.com/research/bleeding-llama-critical-unauthenticated-memory-leak-in-ollama)
