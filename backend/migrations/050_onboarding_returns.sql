-- ═══════════════════════════════════════════════════════════════════════════
-- 050 — The return leg: read, reconcile, apply
--
-- Returned documents are matched to the pack item they answer; every value
-- the extractor reads is kept PER DOCUMENT as a candidate; candidates are
-- reconciled into one resolved value per field with an OUTCOME —
--
--   reliable   sources agree and read clearly → applied to the profile by itself
--   review     a single or doubtful reading   → the Owner confirms it
--   conflict   sources disagree               → the Owner chooses
--
-- — and reliable values flow into the employee's profile tables, which are
-- the source of truth every register reads from. Original documents are
-- copied into pd_documents so the credential or identity record keeps its
-- evidence attached.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Per-document candidates ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS onboarding_field_candidates (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id     UUID REFERENCES organisations(id),
  assignment_id       UUID NOT NULL REFERENCES onboarding_assignments(id) ON DELETE CASCADE,
  run_id              UUID REFERENCES onboarding_extraction_runs(id) ON DELETE SET NULL,
  field_key           VARCHAR(60) NOT NULL CHECK (field_key NOT IN ('tfn', 'tax_file_number', 'tfn_number')),
  sensitivity         VARCHAR(20) NOT NULL DEFAULT 'standard' CHECK (sensitivity IN ('standard', 'sensitive')),
  value_text          TEXT,
  value_encrypted     TEXT,
  value_masked        VARCHAR(60),
  confidence          VARCHAR(10) NOT NULL DEFAULT 'medium' CHECK (confidence IN ('high', 'medium', 'low')),
  source_kind         VARCHAR(20) NOT NULL CHECK (source_kind IN ('document', 'record', 'offer')),
  source_document_id  UUID REFERENCES onboarding_returned_documents(id) ON DELETE CASCADE,
  source_label        VARCHAR(250),
  source_page         INTEGER,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_onboarding_field_candidate_sensitive CHECK (
    sensitivity <> 'sensitive' OR (value_text IS NULL AND (value_encrypted IS NULL OR value_masked IS NOT NULL))
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_onboarding_field_candidate
  ON onboarding_field_candidates (assignment_id, field_key, source_kind, COALESCE(source_document_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS idx_onboarding_field_candidates_assignment
  ON onboarding_field_candidates (assignment_id, field_key);

-- ── The resolved value carries its outcome ──────────────────────────────────
ALTER TABLE onboarding_extracted_fields ADD COLUMN IF NOT EXISTS outcome          VARCHAR(20)
  CHECK (outcome IS NULL OR outcome IN ('reliable', 'review', 'conflict'));
ALTER TABLE onboarding_extracted_fields ADD COLUMN IF NOT EXISTS outcome_reason   VARCHAR(250);
ALTER TABLE onboarding_extracted_fields ADD COLUMN IF NOT EXISTS resolution       VARCHAR(20)
  CHECK (resolution IS NULL OR resolution IN ('auto', 'owner'));
-- What the Owner is shown when choosing: [{ sourceKind, sourceLabel, value (masked if sensitive), confidence, candidateId }]
ALTER TABLE onboarding_extracted_fields ADD COLUMN IF NOT EXISTS conflict_options JSONB NOT NULL DEFAULT '[]';

-- ── Returned documents know which pack item they answer ────────────────────
ALTER TABLE onboarding_returned_documents ADD COLUMN IF NOT EXISTS pack_item_id      UUID REFERENCES onboarding_pack_items(id) ON DELETE SET NULL;
ALTER TABLE onboarding_returned_documents ADD COLUMN IF NOT EXISTS match_status      VARCHAR(20) NOT NULL DEFAULT 'pending'
  CHECK (match_status IN ('pending', 'matched', 'unrecognised', 'manual'));
ALTER TABLE onboarding_returned_documents ADD COLUMN IF NOT EXISTS match_confidence  VARCHAR(10)
  CHECK (match_confidence IS NULL OR match_confidence IN ('high', 'medium', 'low'));
ALTER TABLE onboarding_returned_documents ADD COLUMN IF NOT EXISTS document_kind     VARCHAR(40);
ALTER TABLE onboarding_returned_documents ADD COLUMN IF NOT EXISTS signature_status  VARCHAR(10) NOT NULL DEFAULT 'unknown'
  CHECK (signature_status IN ('present', 'missing', 'unknown'));
ALTER TABLE onboarding_returned_documents ADD COLUMN IF NOT EXISTS pd_document_id    UUID REFERENCES pd_documents(id) ON DELETE SET NULL;

-- ── Pack items carry the verification outcome ───────────────────────────────
ALTER TABLE onboarding_pack_items ADD COLUMN IF NOT EXISTS verification_status VARCHAR(20) NOT NULL DEFAULT 'pending'
  CHECK (verification_status IN ('pending', 'verified', 'attention', 'rejected'));
ALTER TABLE onboarding_pack_items ADD COLUMN IF NOT EXISTS verification_mode   VARCHAR(10)
  CHECK (verification_mode IS NULL OR verification_mode IN ('auto', 'owner'));
ALTER TABLE onboarding_pack_items ADD COLUMN IF NOT EXISTS attention_reason    VARCHAR(250);

-- ── Employment pay terms on the profile, and the vehicle ────────────────────
ALTER TABLE employment_profiles ADD COLUMN IF NOT EXISTS pay_basis VARCHAR(10)
  CHECK (pay_basis IS NULL OR pay_basis IN ('annual', 'hourly'));
ALTER TABLE employment_profiles ADD COLUMN IF NOT EXISTS pay_rate  NUMERIC(12,2);

CREATE TABLE IF NOT EXISTS employee_vehicles (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  organisation_id         UUID REFERENCES organisations(id),
  assignment_id           UUID REFERENCES onboarding_assignments(id) ON DELETE SET NULL,
  registration            VARCHAR(20),
  make                    VARCHAR(60),
  model                   VARCHAR(60),
  registration_expiry     DATE,
  insurance_policy_number VARCHAR(80),
  insurance_expiry        DATE,
  document_id             UUID REFERENCES pd_documents(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Payroll approval is an Owner act ────────────────────────────────────────
ALTER TABLE payroll_profiles ADD COLUMN IF NOT EXISTS bank_verified_by UUID REFERENCES users(id);
ALTER TABLE payroll_profiles ADD COLUMN IF NOT EXISTS bank_verified_at TIMESTAMPTZ;

-- ── Emergency contact email, when the form provides one ─────────────────────
ALTER TABLE employee_personal_details ADD COLUMN IF NOT EXISTS emergency_email VARCHAR(255);
