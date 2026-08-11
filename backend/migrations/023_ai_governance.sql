-- ═══════════════════════════════════════════════════════════════════════════
--  023 — Clinical AI governance: attribution, review and a kill switch
-- ═══════════════════════════════════════════════════════════════════════════
-- Milestone 2 of the Opal Clinical AI Boundary. Milestone 1 controlled WHERE
-- inference runs (Australian Bedrock only, one gateway, enforced by CI).
-- This migration makes every interaction ATTRIBUTABLE, REVIEWABLE and
-- AUDITABLE — so the practice can answer "which documents were AI-assisted,
-- who approved them, and where was the data processed" without ever storing
-- the AI conversation.
--
-- ── THE RULE THAT SHAPES ALL THREE TABLES ─────────────────────────────────
-- NO CLINICAL CONTENT LIVES HERE. No prompts, no responses, no transcripts,
-- no note text, no client names. An audit trail that also holds clinical
-- narrative doubles the surface area of every breach and creates a second
-- copy to secure, retain and dispose of under APP 11. The clinical record
-- stays in case_note_drafts; this records only how it came to exist.
--
-- The application enforces the same rule structurally: backend/ai/ai-audit.js
-- builds events from a fixed field allowlist, so content has no path in even
-- by accident. See tests/ai-gateway.test.js.
--
-- ── WHY source_region IS NOT THE PROCESSING REGION ────────────────────────
-- Under geographic cross-region inference an `au.` profile sourced from
-- Sydney may be processed in Sydney OR Melbourne. Both are Australian, so
-- residency holds either way — but source_region records where the request
-- was SENT FROM. The authoritative processing region is CloudTrail's
-- additionalEventData.inferenceRegion, correlated via provider_request_id.
-- That is exactly why provider_request_id is stored.

-- ── Every call to the AI gateway, allowed or denied ────────────────────────
CREATE TABLE IF NOT EXISTS ai_interactions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID REFERENCES users(id) ON DELETE SET NULL,
  organisation_id     UUID REFERENCES organisations(id),

  -- What ran, under which policy
  feature             VARCHAR(64)  NOT NULL,
  classification      VARCHAR(32)  NOT NULL,
  output_type         VARCHAR(32),
  audit_category      VARCHAR(64),

  -- Where it ran
  provider            VARCHAR(40),
  model_id            VARCHAR(80),
  source_region       VARCHAR(32),
  provider_request_id VARCHAR(128),

  -- Outcome. 'denied' rows are the security-interesting ones: a refusal that
  -- leaves no trace is indistinguishable from a call that never happened.
  --
  -- 'pending' exists because a clinical document RESERVES its row before the
  -- model is called. If that write fails, generation is denied before any
  -- data leaves — an unattributable clinical document should not exist. A row
  -- left at 'pending' means the call was made but its outcome could not be
  -- confirmed, which is itself worth seeing.
  status              VARCHAR(24)  NOT NULL DEFAULT 'generated',
  deny_reason         VARCHAR(120),
  latency_ms          INTEGER,

  -- Human accountability. AHPRA holds the practitioner responsible for the
  -- record regardless of what produced it, so a clinical output is never
  -- final until a person accepts it.
  review_required     BOOLEAN      NOT NULL DEFAULT TRUE,
  review_status       VARCHAR(24)  NOT NULL DEFAULT 'ai_generated',
  reviewed_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at         TIMESTAMPTZ,

  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT ai_interactions_status_chk
    CHECK (status IN ('pending', 'generated', 'denied', 'provider_error')),
  CONSTRAINT ai_interactions_review_status_chk
    CHECK (review_status IN ('ai_generated', 'review_required', 'approved', 'rejected')),
  -- A review outcome without a reviewer is not a review.
  CONSTRAINT ai_interactions_reviewer_chk
    CHECK (review_status NOT IN ('approved', 'rejected')
           OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_ai_interactions_user_created
  ON ai_interactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_interactions_feature_created
  ON ai_interactions (feature, created_at DESC);
-- Supports "show me everything still awaiting review".
CREATE INDEX IF NOT EXISTS idx_ai_interactions_pending_review
  ON ai_interactions (review_status, created_at DESC)
  WHERE review_status IN ('ai_generated', 'review_required');
-- Supports "which calls were refused, and why" during an incident review.
CREATE INDEX IF NOT EXISTS idx_ai_interactions_denied
  ON ai_interactions (created_at DESC) WHERE status = 'denied';

-- ── Link drafts to the interaction that produced them ──────────────────────
-- Answers "which notes were AI-assisted?" without storing the conversation.
ALTER TABLE case_note_drafts
  ADD COLUMN IF NOT EXISTS ai_interaction_id UUID REFERENCES ai_interactions(id) ON DELETE SET NULL,
  -- 'ai_assisted' | 'human'. Existing rows predate the gateway but were all
  -- AI-generated, so backfilling to 'ai_assisted' is accurate, not a guess.
  ADD COLUMN IF NOT EXISTS generation_source VARCHAR(24) NOT NULL DEFAULT 'ai_assisted',
  ADD COLUMN IF NOT EXISTS review_status     VARCHAR(24) NOT NULL DEFAULT 'ai_generated',
  ADD COLUMN IF NOT EXISTS reviewed_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at       TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'case_note_drafts_review_status_chk'
  ) THEN
    ALTER TABLE case_note_drafts
      ADD CONSTRAINT case_note_drafts_review_status_chk
      CHECK (review_status IN ('ai_generated', 'review_required', 'approved', 'rejected'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'case_note_drafts_generation_source_chk'
  ) THEN
    ALTER TABLE case_note_drafts
      ADD CONSTRAINT case_note_drafts_generation_source_chk
      CHECK (generation_source IN ('ai_assisted', 'human'));
  END IF;

  -- Same rule as above: an approval must name an approver.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'case_note_drafts_reviewer_chk'
  ) THEN
    ALTER TABLE case_note_drafts
      ADD CONSTRAINT case_note_drafts_reviewer_chk
      CHECK (review_status NOT IN ('approved', 'rejected')
             OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_case_note_drafts_review
  ON case_note_drafts (user_id, review_status, created_at DESC);

-- ── Server-side kill switch ────────────────────────────────────────────────
-- A generic settings table so an operator can disable ALL AI instantly during
-- a privacy, model or provider incident — no redeploy, no env change, no
-- code push. Deliberately separate from feature flags, which are deployment
-- configuration rather than an incident control.
--
-- Belt and braces: the application ALSO honours an AI_GLOBAL_DISABLE
-- environment variable, so AI can be stopped even if the database is
-- unreachable. Either mechanism alone is sufficient to disable.
CREATE TABLE IF NOT EXISTS system_settings (
  key         VARCHAR(64) PRIMARY KEY,
  value       TEXT        NOT NULL,
  description TEXT,
  -- Set these in the same UPDATE that flips the switch. Six months later
  -- somebody will ask why AI was disabled last Tuesday, and "who" and "why"
  -- are the two things nobody writes down at the time.
  reason      TEXT,
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO system_settings (key, value, description)
VALUES (
  'ai_global_enabled',
  'true',
  'Master kill switch for ALL AI features. Set to false to stop every AI call immediately during an incident. Per-feature flags and gateway policy still apply on top of this.'
)
ON CONFLICT (key) DO NOTHING;

-- ── Break-glass and boundary-change record ─────────────────────────────────
-- Deliberately a separate table rather than a filter over audit_logs. During
-- an incident you want one obvious place that answers "what changed, when,
-- who, and why" without knowing the shape of a metadata blob.
--
-- Records: the kill switch flipping either way, and the AI policy or model
-- registry changing between deployments. Metadata only, as everywhere else.
CREATE TABLE IF NOT EXISTS ai_security_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type     VARCHAR(48) NOT NULL,
  actor_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  previous_state VARCHAR(64),
  new_state      VARCHAR(64),
  reason         TEXT,
  detail         VARCHAR(200),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT ai_security_events_type_chk
    CHECK (event_type IN (
      'ai_disabled',
      'ai_enabled',
      'policy_changed',
      'model_registry_changed',
      'self_check_failed'
    ))
);

CREATE INDEX IF NOT EXISTS idx_ai_security_events_created
  ON ai_security_events (created_at DESC);
