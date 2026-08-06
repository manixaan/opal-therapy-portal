# Resource Hub — Phase 3 plan: AI Resource Studio

**Status: PLANNED — not built. Generation is DISABLED in the portal and no AI
provider is connected.** Build only on explicit owner approval AND after the
privacy/consent controls below exist.

## Capabilities (target)

Draft generation of: worksheets, activities, checklists, visual supports,
home programs, session resources. Inputs: diagnosis, therapy goal, age range,
format, tone, plus optional grounding in selected APPROVED Shared Resources.
Optional daily suggested draft resources (off by default).

## Non-negotiable safety model

1. **Every AI output is a DRAFT** — labelled as such, unusable in sessions
   until a therapist reviews and explicitly approves it.
2. Approved outputs save back into Shared Resources with attribution
   ("AI-drafted, reviewed by <therapist>") and version history.
3. **No client-identifying or sensitive clinical information is ever sent to
   an AI provider** unless the practice has explicitly approved privacy,
   consent, and data-handling controls — enforced by input filtering and by
   the form offering only structured non-identifying fields.
4. Provider integration is modular and configurable (provider, model, region)
   — no hardcoded vendor; keys live in Key Vault, never the repo.
5. Generation stays behind a fail-closed feature flag
   (`ENABLE_RESOURCE_AI_SUGGESTIONS` already exists and is false everywhere);
   the flag is only turned on after the owner signs off the provider DPA.

## Prerequisites before any build

Owner-approved provider + data-processing agreement · practice privacy-policy
update · Phase 2 moderation/versioning shipped (drafts need somewhere safe to
land) · cost ceiling agreed.
