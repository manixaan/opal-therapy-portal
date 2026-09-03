-- ═══════════════════════════════════════════════════════════════════════════
-- 048 — Letter of Offer as a document, sent through Outlook
--
-- Phase 1 of the onboarding journey reshaped around what actually happens:
--
--   terms entered → letter generated from the .docx template → previewed →
--   (optionally downloaded, edited in Word and uploaded back) → Email 1
--   prepared → an Outlook DRAFT created with the letter attached → the Owner
--   sends it from Outlook and marks it sent → waiting for the signed letter →
--   the signed copy is uploaded and stored → the Owner verifies it → done.
--
-- The token-based accept-online page from 047 is retired: a signed letter is
-- the acceptance. Its columns stay (append-only) and are simply unused.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Offer status ladder ─────────────────────────────────────────────────────
ALTER TABLE onboarding_offers DROP CONSTRAINT IF EXISTS onboarding_offers_status_check;
ALTER TABLE onboarding_offers
  ADD CONSTRAINT onboarding_offers_status_check CHECK (status IN (
    'draft',            -- terms entered; the letter regenerates from them
    'email_drafted',    -- Email 1 exists as an Outlook draft with the letter attached
    'sent',             -- the Owner sent it and marked it sent  (stage 1.5: waiting)
    'signed_received',  -- the signed letter is stored, awaiting verification
    'accepted',         -- verified: phase 1 complete
    'declined', 'withdrawn', 'not_required',
    -- 047's online-acceptance vocabulary, retired but retained for old rows
    'approved'
  ));

DROP INDEX IF EXISTS uq_onboarding_offer_live;
CREATE UNIQUE INDEX IF NOT EXISTS uq_onboarding_offer_live
  ON onboarding_offers (assignment_id)
  WHERE status IN ('draft', 'approved', 'email_drafted', 'sent', 'signed_received');

-- ── Email 1 and the signed copy ─────────────────────────────────────────────
ALTER TABLE onboarding_offers ADD COLUMN IF NOT EXISTS email_subject      VARCHAR(250);
ALTER TABLE onboarding_offers ADD COLUMN IF NOT EXISTS email_body         TEXT;
ALTER TABLE onboarding_offers ADD COLUMN IF NOT EXISTS email_draft_id     VARCHAR(300);
ALTER TABLE onboarding_offers ADD COLUMN IF NOT EXISTS email_web_link     TEXT;
ALTER TABLE onboarding_offers ADD COLUMN IF NOT EXISTS email_drafted_at   TIMESTAMPTZ;
ALTER TABLE onboarding_offers ADD COLUMN IF NOT EXISTS email_drafted_by   UUID REFERENCES users(id);
ALTER TABLE onboarding_offers ADD COLUMN IF NOT EXISTS email_sent_at      TIMESTAMPTZ;
ALTER TABLE onboarding_offers ADD COLUMN IF NOT EXISTS email_sent_by      UUID REFERENCES users(id);
ALTER TABLE onboarding_offers ADD COLUMN IF NOT EXISTS signed_received_at TIMESTAMPTZ;
ALTER TABLE onboarding_offers ADD COLUMN IF NOT EXISTS verified_at        TIMESTAMPTZ;
ALTER TABLE onboarding_offers ADD COLUMN IF NOT EXISTS verified_by        UUID REFERENCES users(id);
ALTER TABLE onboarding_offers ADD COLUMN IF NOT EXISTS template_version   INTEGER;

-- ── The letter's files ──────────────────────────────────────────────────────
-- kind: 'letter' = a letter the Owner edited in Word and uploaded back (it
-- replaces the generated one as the attachment); 'signed' = the copy the
-- candidate signed and returned. A freshly generated letter is not stored:
-- it is composed from the terms whenever it is asked for, so a change to the
-- terms always changes the letter. At most one live file of each kind.
CREATE TABLE IF NOT EXISTS onboarding_offer_documents (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  UUID REFERENCES organisations(id),
  offer_id         UUID NOT NULL REFERENCES onboarding_offers(id) ON DELETE CASCADE,
  assignment_id    UUID NOT NULL REFERENCES onboarding_assignments(id) ON DELETE CASCADE,
  kind             VARCHAR(20) NOT NULL CHECK (kind IN ('letter', 'signed')),
  file_name        VARCHAR(255) NOT NULL,
  file_mime        VARCHAR(100) NOT NULL,
  file_size_bytes  INTEGER NOT NULL,
  file_sha256      VARCHAR(64) NOT NULL,
  storage_backend  VARCHAR(10) NOT NULL DEFAULT 'db' CHECK (storage_backend IN ('db', 'local', 'blob')),
  storage_key      TEXT,
  file_data        TEXT,
  status           VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded')),
  uploaded_by      UUID REFERENCES users(id),
  uploaded_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  superseded_at    TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_onboarding_offer_document_live
  ON onboarding_offer_documents (offer_id, kind)
  WHERE status = 'active';
