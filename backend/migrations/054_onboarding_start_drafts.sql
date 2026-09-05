-- ═══════════════════════════════════════════════════════════════════════════
-- 054 — Start Onboarding drafts
--
-- The Start Onboarding form is long. Before it is submitted nothing existed,
-- so a session timeout or a closed tab lost every field. A draft is that
-- unsubmitted form, saved as it is typed, so the person can come back to it
-- from the board. It is not an onboarding record: no account, no letter, no
-- tasks. Creating the record deletes the draft.
--
-- The form is stored whole as JSONB — it holds a name, personal email and
-- pay figures, so drafts are scoped to the organisation and readable only by
-- people who may start an onboarding.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS onboarding_start_drafts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  applicant_name   VARCHAR(200),
  position_title   VARCHAR(150),
  form             JSONB NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_start_drafts_org
  ON onboarding_start_drafts (organisation_id, updated_at DESC);
