# Case-Note AI — Provider & Privacy Configuration

**Status:** documented before enablement, as required. The clinical-note provider is **disabled by default and fails closed** — until `CLINICAL_NOTE_AI_ENABLED='true'` AND `ANTHROPIC_API_KEY` are both set on the server, `POST /api/mobile/case-note-drafts/generate` answers `503 generation_unavailable`, nothing is transmitted anywhere, and the therapist keeps their transcript (savable as a plain draft note). There is no fallback provider of any kind.

## What is transmitted to the AI provider (per generation)

| Sent | Value |
| --- | --- |
| Dictated transcript | Verbatim, exactly as the therapist reviewed it on the phone (≤8000 chars) |
| Session date | `DD/MM/YYYY` label only |
| Service label | The appointment title (e.g. "Therapy Session (OT)") |
| Style prompt | The versioned `OPAL_CASE_NOTE_STYLE_V1` text + optional regenerate modifier |

**Deliberately NOT transmitted:** client full name, address, DOB, event/user/organisation ids, therapist identity, billing amounts, travel data, appointment location, or any other appointment metadata. Those are merged into the note **server-side after generation** (`case-note-routes.js` `buildHeader`/`buildBillingLine`/`composeNoteBody`). The transcript itself is the only clinical carrier — whatever the therapist chooses to dictate. **No audio is ever sent to the backend or the provider** (transcription is on-device; the API has no audio field).

## Provider — Amazon Bedrock, Australian regions only

- **Amazon Bedrock** (`bedrock-runtime`, AWS SDK `@anthropic-ai/bedrock-sdk`), called ONLY from `backend/clinical-note-provider.js` — a seam deliberately separate from Opa chat (`opa-provider.js`), which has a different privacy boundary (feature knowledge, no clinical content). Mobile never holds a credential and never calls a provider directly.
- **Processing stays in Australia.** Requests use an Australian geo inference profile (`au.anthropic.*`) from `ap-southeast-2` (Sydney) or `ap-southeast-4` (Melbourne). AWS states such a profile keeps the request inside Australian regions for the entire lifecycle, over the AWS backbone rather than the public internet.
- **Who processes the data.** Amazon Web Services (Amazon Bedrock) provides the managed AI inference infrastructure. Approved Anthropic Claude models are operated **through** Bedrock using Australian geographic inference profiles. For this approved configuration, clinical inference is restricted to Australian AWS regions and model invocation content logging is disabled. AWS states that Bedrock customer inputs and outputs are not shared with model providers or used to train the underlying models, subject to the model-specific exceptions in its retention documentation — Fable 5 and Mythos 5 being the notable exceptions, which is precisely why they are blocked.
- The governing instrument is the **AWS DPA**. Anthropic's own zero-data-retention agreement and BAA are contracts with Anthropic and do not apply to this path; they are also not needed for it. This is a change of processor and contract, not a claim that Anthropic is uninvolved — the models are Anthropic's, operated by AWS.
- Model: `CLINICAL_NOTE_MODEL` (default `au.anthropic.claude-opus-4-8`). Structured output is forced through a `case_note` tool schema; the response is validated (shape, types, size caps) and anything else is rejected.

**Why onshore:** clinical narrative is health information. Sending it offshore is a cross-border disclosure under APP 8, which triggers s 16C of the Privacy Act — making the practice accountable for the recipient's acts as if they were its own, even where reasonable steps were taken. Onshore inference removes that exposure entirely. Full reasoning and the alternatives considered: `CLINICAL_AI_PROVIDER_DECISION.md`.

### Three guards against offshore drift

A model-id string is one careless edit away from leaving the country, so the provider enforces, and refuses to run if any fails:

1. the region must be `ap-southeast-2` or `ap-southeast-4`;
2. the model must carry the `au.` geo prefix — `global.` (worldwide) and `apac.` (also Tokyo, Seoul, Osaka, Mumbai, Hyderabad, Singapore) are rejected;
3. the model must be on the per-region allowlist — which notably excludes Claude Sonnet 5 from Sydney (no Australian route from there) and excludes Fable 5 / Mythos 5 everywhere, since those mandate data retention and are outside Bedrock's HIPAA eligibility.

Failure disables generation and returns `503 generation_unavailable`. There is **no silent fallback to a global route**. Covered by `backend/tests/clinical-note-provider.test.js`.

### What the stored provenance does and does not prove

Each saved draft records `provider_id` as `aws-bedrock:src=<region>` and `model_id` as the inference profile.

**`src=` means source, not processing location.** Under geographic cross-region inference an `au.` profile sourced from Sydney may be processed in Sydney *or* Melbourne. Both are Australian, so residency holds either way — but this field must not be cited as proof of where a specific request ran.

**The authoritative record is CloudTrail**, field `additionalEventData.inferenceRegion`, logged in the source region. To evidence the processing region for a particular note, correlate on timestamp and AWS request id.

**Known gap:** the AWS request id and the reviewing therapist are not currently stored against the draft, so that correlation is forensic rather than self-service. Closing it needs a migration adding `source_region`, `inference_profile_id`, `aws_request_id`, `ai_feature`, `human_review_required`, `reviewed_by` and `reviewed_at`. Not yet done.

## Configuration — OWNER ACTION REQUIRED BEFORE ENABLEMENT

Before setting `CLINICAL_NOTE_AI_ENABLED='true'` with real client dictation:

1. **AWS account setup** — see the setup steps in `CLINICAL_AI_PROVIDER_DECISION.md`: enable Claude model access in the Australian region, attach an IAM policy covering the inference profile and the underlying foundation models in both destination regions, leave model invocation logging **off**, and apply the SCP restricting Bedrock to the two Australian regions.
2. **Verify at runtime, not from documentation** — confirm the inference profile is active and the region list is Australian (`aws bedrock get-inference-profile`), and make one live forced-tool call before real use.
3. **Consent and disclosure** — the practice needs written, AI-specific client consent recorded in the file, plus an updated privacy policy and collection notice, before real dictation is processed. This is an AHPRA requirement, not just good practice.
4. Until all of the above: development and testing use **synthetic clinical data only** (the QA fixtures are fully fictional).

## Logging & audit behaviour

- Provider failures log **status codes only** — never request/response bodies (they contain clinical narrative), never the key (`clinical-note-provider.js`).
- Route errors log the error message and path only — request bodies are never logged (`case-note-routes.js` `safe()`).
- Audit events (`mobile.case_note_generated|updated|regenerated|archived`) carry ids, style version, model id, character/warning **counts** — verified by test to contain no transcript or note content.
- Every draft records provenance: `style_version`, `provider_id`, `model_id`, `generated_at`, source `voice_note_id`, `linked_event_id`.

## Draft-only guarantee

Generated notes are **private drafts**: user-scoped (no cross-user access for any role), no automatic finalisation, no Splose/Outlook writes, no appointment-completion side effects. "Approve & send to Splose" is explicitly out of scope and would be a separate, governed workflow.
