-- ═══════════════════════════════════════════════════════════════════════════
--  042 — Credential scans: the document behind the claim, and what a model
--        proposed after reading it
-- ═══════════════════════════════════════════════════════════════════════════
-- Until now a credential was an assertion. Somebody typed "WWCC, expires
-- 1 May 2029" and the practice's compliance position rested on that typing
-- being right. The registration number was never checked against anything,
-- because there was nothing to check it against: `credentials.document_id`
-- existed but no surface ever filled it.
--
-- Two changes follow from attaching the actual certificate.
--
-- 1. THE SCAN BECOMES THE EVIDENCE. A verifier can now look at what they are
--    verifying. That is the whole point of the Owner's Verify button, and it
--    was previously a click on somebody's word.
--
-- 2. A MODEL CAN READ IT — AND ITS READING IS A PROPOSAL, NEVER A FACT.
--    credential_extractions records what was proposed, from which document,
--    with the model's own per-field confidence, and separately what a human
--    accepted. The two are different columns because they are different
--    claims, and an audit that cannot tell them apart is not an audit.
--
-- ── WHY A CLOSED KEY SET IS ENFORCED AT THE DATABASE ───────────────────────
-- A driver's licence carries a date of birth, an address and a photograph. A
-- model asked to read "the credential details" will happily return all three.
-- None of them is needed to know whether a licence is current, so none of them
-- may be stored. The prompt says so, the parser drops unknown keys, and the
-- CHECK below refuses the row outright. Three layers, because the prompt is
-- the layer that can be talked out of it.
--
-- The same reasoning as migration 038's tax-file-number CHECK, applied to the
-- other document a practice photocopies without thinking.

-- ── Credential extraction proposals ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS credential_extractions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id        UUID REFERENCES organisations(id) ON DELETE CASCADE,

  -- Who ran the read. Not necessarily the credential holder: an Owner may
  -- re-run a read on a scan they can see.
  requested_by_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- The scan that was read. Kept even if the credential is later deleted, so
  -- "what did the model see" survives the record it fed.
  document_id            UUID REFERENCES pd_documents(id) ON DELETE SET NULL,

  -- NULL while the credential does not exist yet — the Add flow reads the
  -- document BEFORE there is a row to attach it to, which is the point.
  credential_id          UUID REFERENCES credentials(id) ON DELETE CASCADE,

  -- How the document reached the model. A scan with no text layer is read as
  -- an image; a born-digital certificate is read as text; most are both.
  source_kind            VARCHAR(30) NOT NULL DEFAULT 'unknown'
                         CHECK (source_kind IN ('text', 'image', 'text+image', 'unknown')),

  status                 VARCHAR(20) NOT NULL DEFAULT 'proposed'
                         CHECK (status IN ('proposed', 'applied', 'discarded', 'unreadable', 'refused')),

  -- { field_key: { value, confidence } } — the model's reading, untouched.
  proposed               JSONB NOT NULL DEFAULT '{}',
  -- The subset a human actually kept, written when the credential is saved.
  applied                JSONB,

  -- What the reviewer should know: "expiry not printed on this certificate".
  -- Never a value; the values live in `proposed`.
  notes                  TEXT,

  model_key              VARCHAR(60),
  ai_interaction_id      UUID,

  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_at             TIMESTAMPTZ,
  applied_by_user_id     UUID REFERENCES users(id) ON DELETE SET NULL
);

-- The closed vocabulary, enforced. `jsonb - text[]` removes the permitted keys;
-- anything left over is a key nobody approved, and the row is refused.
--
-- Deliberately absent, and never to be added without a decision that is
-- written down: date_of_birth, address, photograph, signature, medicare
-- number, tax file number.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_name = 'credential_extractions'
       AND constraint_name = 'credential_extractions_proposed_keys_check'
  ) THEN
    ALTER TABLE credential_extractions
      ADD CONSTRAINT credential_extractions_proposed_keys_check
      CHECK (
        (proposed - ARRAY[
          'credential_type', 'credential_name', 'issuing_body',
          'registration_number', 'issue_date', 'expiry_date',
          'holder_name', 'document_kind'
        ]) = '{}'::jsonb
        AND (
          applied IS NULL OR
          (applied - ARRAY[
            'credential_type', 'credential_name', 'issuing_body',
            'registration_number', 'issue_date', 'expiry_date',
            'holder_name', 'document_kind'
          ]) = '{}'::jsonb
        )
      );
  END IF;
END $$;

COMMENT ON TABLE credential_extractions IS
  'What a model proposed after reading a credential scan, and what a person then accepted. Proposals are never facts: nothing here reaches the credentials table without a human save.';
COMMENT ON COLUMN credential_extractions.proposed IS
  'The model reading: { key: { value, confidence } }. Keys are restricted by CHECK — a licence''s date of birth and address may not be stored.';
COMMENT ON COLUMN credential_extractions.applied IS
  'The subset a human kept. NULL until the credential is saved from this proposal.';

CREATE INDEX IF NOT EXISTS idx_credential_extractions_credential
  ON credential_extractions (credential_id) WHERE credential_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_credential_extractions_org_created
  ON credential_extractions (organisation_id, created_at DESC);

-- ── Finding the credentials that still have no evidence ────────────────────
-- The compliance question this answers: "which credentials are claims with
-- nothing behind them?" Before this migration the answer was "all of them".
CREATE INDEX IF NOT EXISTS idx_credentials_without_document
  ON credentials (organisation_id) WHERE document_id IS NULL;

-- ── The scan's own document row ────────────────────────────────────────────
-- Credential scans live in pd_documents alongside CPD evidence, but they are
-- not CPD evidence and must not appear in the Professional Development list —
-- they belong to the credential card. document_type carries that, and the
-- index makes the exclusion cheap.
CREATE INDEX IF NOT EXISTS idx_pd_documents_credential_scans
  ON pd_documents (user_id) WHERE document_type = 'credential_scan';
