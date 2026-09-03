-- ═══════════════════════════════════════════════════════════════════════════
-- 052 — Edit Onboarding: package-level overrides of the default packs
--
-- The default documentation and induction packs are DERIVED from a package
-- and the employee's facts (onboarding-pack.js). This table lets the Owner
-- tweak that default per package — remove a document, rename it, change its
-- flags, add another — and every NEW record for that package inherits the
-- tweak. Existing records are untouched: their items were copied at
-- preparation and are theirs to edit.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS onboarding_pack_defaults (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id        UUID REFERENCES organisations(id),
  package_id             UUID NOT NULL REFERENCES onboarding_packages(id) ON DELETE CASCADE,
  phase                  VARCHAR(20) NOT NULL CHECK (phase IN ('documentation', 'induction')),
  code                   VARCHAR(80) NOT NULL,                 -- the derived item's code, or DEF_<hex> for an added one
  action                 VARCHAR(10) NOT NULL CHECK (action IN ('remove', 'override', 'add')),
  title                  VARCHAR(250),
  description            VARCHAR(1000),
  sends_document         BOOLEAN,
  employee_returns       BOOLEAN,
  requires_verification  BOOLEAN,
  required               BOOLEAN,
  document_id            UUID REFERENCES onboarding_documents(id) ON DELETE SET NULL,
  sort_order             INTEGER,
  updated_by             UUID REFERENCES users(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_onboarding_pack_default UNIQUE (package_id, phase, code)
);
