-- ═══════════════════════════════════════════════════════════════════════════
-- 055 — Letter of Offer template, edited in the portal
--
-- The letter's wording used to be fixed in the shipped .docx. The practice
-- can now edit any paragraph from the portal and save; the result is the
-- standard letter for every offer generated from then on. Each save is a
-- new version of the whole .docx (the built-in template with the edits
-- applied), so the letter behind any past offer can be reproduced and a bad
-- edit can be walked back to the shipped original.
--
-- The document itself is small (tens of KB) and is practice configuration,
-- not a person's file, so it lives in the row as base64.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS onboarding_offer_templates (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  version          INTEGER NOT NULL,
  status           VARCHAR(20) NOT NULL DEFAULT 'active',   -- active | superseded
  file_data        TEXT NOT NULL,                            -- the .docx, base64
  file_sha256      VARCHAR(64) NOT NULL,
  note             VARCHAR(400),
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  superseded_at    TIMESTAMPTZ,
  UNIQUE (organisation_id, version)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_offer_templates_active
  ON onboarding_offer_templates (organisation_id) WHERE status = 'active';
