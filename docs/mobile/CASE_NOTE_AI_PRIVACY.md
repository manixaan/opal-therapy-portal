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

## Provider

- **Anthropic Messages API** (`api.anthropic.com`), called ONLY from `backend/clinical-note-provider.js` — a seam deliberately separate from Opa chat (`opa-provider.js`), which has a different privacy boundary (feature knowledge, no clinical content). Mobile never holds an AI credential and never calls a provider directly.
- Model: `CLINICAL_NOTE_MODEL` (default `claude-sonnet-5`). Structured output is forced through a `case_note` tool schema; the response is validated (shape, types, size caps) and anything else is rejected.

## Retention / data-use configuration — OWNER ACTION REQUIRED BEFORE ENABLEMENT

Before setting `CLINICAL_NOTE_AI_ENABLED='true'` with real client dictation, the practice owner must confirm on their Anthropic account:

1. **Zero data retention / no-training** posture for API traffic appropriate for health information (Anthropic's commercial API terms do not train on API inputs/outputs by default; confirm the current terms and any ZDR agreement suit clinical data).
2. That transmitting client-identifying dictation to the provider is acceptable under the practice's privacy policy and Australian Privacy Principles / NDIS requirements, or that therapists are instructed to dictate with minimal identifiers.
3. Until then: development/testing uses **synthetic clinical data only** (the QA fixtures are fully fictional).

## Logging & audit behaviour

- Provider failures log **status codes only** — never request/response bodies (they contain clinical narrative), never the key (`clinical-note-provider.js`).
- Route errors log the error message and path only — request bodies are never logged (`case-note-routes.js` `safe()`).
- Audit events (`mobile.case_note_generated|updated|regenerated|archived`) carry ids, style version, model id, character/warning **counts** — verified by test to contain no transcript or note content.
- Every draft records provenance: `style_version`, `provider_id`, `model_id`, `generated_at`, source `voice_note_id`, `linked_event_id`.

## Draft-only guarantee

Generated notes are **private drafts**: user-scoped (no cross-user access for any role), no automatic finalisation, no Splose/Outlook writes, no appointment-completion side effects. "Approve & send to Splose" is explicitly out of scope and would be a separate, governed workflow.
