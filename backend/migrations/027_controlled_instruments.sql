-- ═══════════════════════════════════════════════════════════════════════════
--  027 — Controlled instrument register + source-review audit vocabulary
-- ═══════════════════════════════════════════════════════════════════════════
--
--  A register of standardised clinical instruments (WHODAS, COPM, MoCA, RUDAS,
--  Sensory Profile, MOHOST) that records METADATA AND PERMITTED USE ONLY.
--
--  WHAT THIS TABLE IS NOT
--  It is not a place to store instruments. No proprietary form, manual, scoring
--  sheet or item wording is held here or anywhere the register can reach: the
--  columns are descriptive, the only file-shaped column is a URL pointing at the
--  rights holder's own site, and nothing in the schema can carry a document.
--  Where a rights position has not been confirmed by a person, the row says so —
--  hence the deliberately pessimistic defaults below.
--
--  DEFAULTS ARE PESSIMISTIC ON PURPOSE
--    rights_status    'unreviewed'   — nobody has checked the licence
--    clinical_status  'unreviewed'   — nobody has checked clinical currency
--    access_restriction 'clinician'  — the narrowest tier with a real audience
--    evidence_checked  FALSE
--  A register row therefore starts by asserting nothing. That is the correct
--  starting position for someone else's copyrighted instrument.
--
--  Also extends resource_governance_events so a source-review decision can
--  record a publisher correction. Migration 024 is NOT edited: the constraint is
--  dropped and recreated here, which is the supported way to widen a vocabulary.
--
--  Idempotent. See backend/migrations/README.md.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS controlled_instruments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id    UUID NOT NULL REFERENCES organisations(id),

  -- Identity
  key                VARCHAR(60)  NOT NULL,          -- stable slug, e.g. whodas-2.0-36
  name               VARCHAR(200) NOT NULL,
  abbreviation       VARCHAR(40)  NOT NULL,
  edition            VARCHAR(120),                   -- current edition / version

  -- Whose work this is. Never Opal's.
  rights_holder      VARCHAR(200),
  source_url         TEXT,
  licensing_notes    TEXT,
  permitted_use      TEXT,

  -- Governance
  access_restriction VARCHAR(30) NOT NULL DEFAULT 'clinician',
  rights_status      VARCHAR(40) NOT NULL DEFAULT 'unreviewed',
  clinical_status    VARCHAR(30) NOT NULL DEFAULT 'unreviewed',
  evidence_checked   BOOLEAN     NOT NULL DEFAULT FALSE,
  evidence_notes     TEXT,
  reviewer_user_id   UUID REFERENCES users(id),
  reviewed_at        DATE,
  next_review_due    DATE,

  -- Link to an implementing module rather than a copy of the instrument.
  linked_module      VARCHAR(60),                    -- e.g. whodas
  linked_module_route TEXT,                          -- in-app deep link

  state              VARCHAR(20) NOT NULL DEFAULT 'active',   -- active | retired

  created_by         UUID REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE controlled_instruments IS
  'Metadata and permitted-use register for standardised instruments. Holds no instrument content.';
COMMENT ON COLUMN controlled_instruments.rights_holder IS
  'The instrument publisher. Opal is never the rights holder of a controlled instrument.';
COMMENT ON COLUMN controlled_instruments.linked_module IS
  'Points at an implementing module (e.g. whodas) so the register links rather than duplicates.';
COMMENT ON COLUMN controlled_instruments.rights_status IS
  'Defaults to unreviewed. Only a human may move it, and doing so is audited.';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_instrument_rights_status') THEN
    ALTER TABLE controlled_instruments ADD CONSTRAINT valid_instrument_rights_status CHECK (
      rights_status IN ('unreviewed','restricted','licensed-for-use','licence-required',
                        'official-link-only','not-permitted','unknown'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_instrument_clinical_status') THEN
    ALTER TABLE controlled_instruments ADD CONSTRAINT valid_instrument_clinical_status CHECK (
      clinical_status IN ('unreviewed','current','superseded','withdrawn'));
  END IF;
END $$;

-- Same tier vocabulary as resources: an instrument is never broader than clinician.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_instrument_access_restriction') THEN
    ALTER TABLE controlled_instruments ADD CONSTRAINT valid_instrument_access_restriction CHECK (
      access_restriction IN ('clinician','admin'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_instrument_state') THEN
    ALTER TABLE controlled_instruments ADD CONSTRAINT valid_instrument_state CHECK (
      state IN ('active','retired'));
  END IF;
END $$;

-- A source URL must be an ordinary web link to the rights holder. No file
-- schemes, no local paths — the register must not be able to point at the disk.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'instrument_source_url_is_web') THEN
    ALTER TABLE controlled_instruments ADD CONSTRAINT instrument_source_url_is_web CHECK (
      source_url IS NULL OR source_url ~* '^https://');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_controlled_instruments_key
  ON controlled_instruments (organisation_id, key);
CREATE INDEX IF NOT EXISTS idx_controlled_instruments_state
  ON controlled_instruments (organisation_id, state, abbreviation);
CREATE INDEX IF NOT EXISTS idx_controlled_instruments_rights
  ON controlled_instruments (organisation_id, rights_status);
CREATE INDEX IF NOT EXISTS idx_controlled_instruments_module
  ON controlled_instruments (linked_module) WHERE linked_module IS NOT NULL;

-- ── Register audit ──────────────────────────────────────────────────────────
-- Separate from resource_governance_events because the subject is an instrument,
-- not a resource, and a foreign key to resources would be wrong.

CREATE TABLE IF NOT EXISTS controlled_instrument_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id),
  instrument_id   UUID NOT NULL REFERENCES controlled_instruments(id) ON DELETE CASCADE,
  field           VARCHAR(40) NOT NULL,
  from_value      TEXT,
  to_value        TEXT,
  reason          TEXT,
  actor_user_id   UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_controlled_instrument_events_instrument
  ON controlled_instrument_events (instrument_id, created_at DESC);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_instrument_event_field') THEN
    ALTER TABLE controlled_instrument_events ADD CONSTRAINT valid_instrument_event_field CHECK (
      field IN ('rights_status','clinical_status','access_restriction','state',
                'edition','rights_holder','permitted_use','licensing_notes',
                'evidence_checked','linked_module','created','next_review_due'));
  END IF;
END $$;

-- ── Source-review audit vocabulary ──────────────────────────────────────────
-- The unresolved-source queue records a publisher correction alongside a source
-- class decision, and 024's constraint has no value for it. Recreating the
-- constraint here widens the vocabulary WITHOUT editing the applied migration.

ALTER TABLE resource_governance_events DROP CONSTRAINT IF EXISTS valid_governance_event_field;
ALTER TABLE resource_governance_events ADD CONSTRAINT valid_governance_event_field CHECK (
  field IN ('publication_state','access_tier','rights_status','clinical_status',
            'source_class','brand_review_status',
            'source_publisher','evidence','source_review'));

-- The review queue pages through unresolved records ordered by title; this makes
-- that scan an index read rather than a sort over the catalogue.
CREATE INDEX IF NOT EXISTS idx_resources_source_review_queue
  ON resources (organisation_id, source_class, title);
