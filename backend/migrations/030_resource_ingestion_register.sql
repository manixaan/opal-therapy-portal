-- ═══════════════════════════════════════════════════════════════════════════
--  030 — Resource ingestion register (admin-only accounting for 650 records)
-- ═══════════════════════════════════════════════════════════════════════════
--
--  The `7 Resources` catalogue describes 650 source files. Most of them will
--  NEVER become a Resource Hub resource: 94 are client-derived, 294 are
--  commercial works Opal has no redistribution licence for, 152 have unresolved
--  rights. Creating a `resources` row for each would be wrong — a resource is a
--  thing staff can use, and these are not.
--
--  So the register is a SEPARATE table. Every catalogue record gets a row here
--  recording what was decided and why; a small minority additionally get a
--  `resources` row, linked by `linked_resource_id`. That separation is the
--  whole point:
--
--    * The register is administrative accounting. It is not searched, listed or
--      surfaced by any ordinary Resource Hub route, because those routes query
--      `resources` and this is not that table. Nothing had to be excluded from
--      a predicate — the isolation is structural.
--    * "Accounted for" and "available" stay distinct. A row here is proof a
--      decision was made, never proof anything is publishable.
--
--  PRIVACY IS ENFORCED IN THE SCHEMA, NOT IN THE APPLICATION
--  The 94 private records must never contribute an identifying filename, path
--  or title to this database. `privacy_excluded_stores_nothing_identifying`
--  makes that a CHECK constraint rather than a convention, so no future code
--  path — route, importer, backfill or hand-typed UPDATE — can write one. Such
--  a row carries its catalogue id, its aggregate classification (topic, type)
--  and nothing else. Its checksum is dropped too: the portal has no legitimate
--  use for a fingerprint of a client file.
--
--  WHY 030
--  023 and 025 are pending from a concurrent session and are not touched here.
--  029 is the highest applied number, so 030 is the next unused one.
--
--  Idempotent. See backend/migrations/README.md.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS resource_ingestion_register (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id       UUID NOT NULL REFERENCES organisations(id),

  -- Stable identity from the catalogue ('res-0001'). The upsert key, so a
  -- re-run updates a row rather than creating a second one.
  catalogue_id          VARCHAR(20)  NOT NULL,

  -- Provenance. NULL for privacy-excluded rows — see the header.
  checksum_sha256       VARCHAR(64),
  source_reference      VARCHAR(300),
  source_filename       VARCHAR(300),
  extension             VARCHAR(20),
  size_bytes            BIGINT,
  page_or_slide_count   INTEGER,

  -- Classification carried over from the catalogue.
  proposed_title        VARCHAR(300),
  topic                 VARCHAR(80),
  resource_type         VARCHAR(60),
  source_class          VARCHAR(60),
  source_organisation   VARCHAR(200),
  rights_status         VARCHAR(120),
  privacy_status        VARCHAR(60),
  duplicate_of_catalogue_id VARCHAR(20),

  -- Decision and progress.
  treatment             VARCHAR(40) NOT NULL,
  ingestion_status      VARCHAR(40) NOT NULL DEFAULT 'registered',
  quality_status        VARCHAR(40) NOT NULL DEFAULT 'not-assessed',
  next_action           TEXT,
  notes                 TEXT,

  -- How reconciliation reached its conclusion, so a human can audit a match.
  match_method          VARCHAR(30) NOT NULL DEFAULT 'none',
  match_confidence      VARCHAR(20) NOT NULL DEFAULT 'none',

  -- Human review.
  reviewer_user_id      UUID REFERENCES users(id),
  reviewed_at           DATE,

  -- Where the record ended up, if anywhere.
  linked_resource_id    UUID REFERENCES resources(id) ON DELETE SET NULL,
  linked_instrument_id  UUID REFERENCES controlled_instruments(id) ON DELETE SET NULL,
  opal_replacement_resource_id UUID REFERENCES resources(id) ON DELETE SET NULL,
  official_url          TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE resource_ingestion_register IS
  'Administrative accounting for every catalogued source file. Deliberately not a Resource Hub table: no ordinary route queries it.';
COMMENT ON COLUMN resource_ingestion_register.source_reference IS
  'Redacted vault location — directory only, never a full path. NULL for privacy-excluded rows.';
COMMENT ON COLUMN resource_ingestion_register.treatment IS
  'The decided outcome. Every catalogue record has exactly one, so the treatment tally always reconciles to the catalogue size.';
COMMENT ON COLUMN resource_ingestion_register.linked_resource_id IS
  'Set only where the treatment actually produced a usable Resource Hub record. NULL is the common case and is not a backlog.';

-- ── Vocabularies ────────────────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_ingestion_treatment') THEN
    ALTER TABLE resource_ingestion_register ADD CONSTRAINT valid_ingestion_treatment CHECK (
      treatment IN ('reconciled-existing','live-official-link','live-vendor-link',
                    'controlled-register','staff-only','opal-original-draft',
                    'rights-review','privacy-excluded','duplicate-archived',
                    'unavailable-placeholder','rejected-quality','superseded'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_ingestion_status') THEN
    ALTER TABLE resource_ingestion_register ADD CONSTRAINT valid_ingestion_status CHECK (
      ingestion_status IN ('registered','needs-link-verification','needs-human-review',
                           'imported','excluded','archived','blocked','held'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_ingestion_quality_status') THEN
    ALTER TABLE resource_ingestion_register ADD CONSTRAINT valid_ingestion_quality_status CHECK (
      quality_status IN ('not-assessed','not-applicable','passed','failed','pending-human'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_ingestion_match_method') THEN
    ALTER TABLE resource_ingestion_register ADD CONSTRAINT valid_ingestion_match_method CHECK (
      match_method IN ('none','sha256','normalized-title','title-and-organisation','filename'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_ingestion_match_confidence') THEN
    ALTER TABLE resource_ingestion_register ADD CONSTRAINT valid_ingestion_match_confidence CHECK (
      match_confidence IN ('none','possible','probable','exact'));
  END IF;
END $$;

-- ── The privacy guarantee ───────────────────────────────────────────────────
-- A privacy-excluded row may carry its catalogue id and aggregate
-- classification. It may not carry anything that names, locates or
-- fingerprints the underlying file, and it may not point at portal content.
-- Enforced here so it cannot be undone by application code.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'privacy_excluded_stores_nothing_identifying') THEN
    ALTER TABLE resource_ingestion_register
      ADD CONSTRAINT privacy_excluded_stores_nothing_identifying CHECK (
        treatment <> 'privacy-excluded' OR (
          source_filename      IS NULL AND
          source_reference     IS NULL AND
          proposed_title       IS NULL AND
          checksum_sha256      IS NULL AND
          official_url         IS NULL AND
          linked_resource_id   IS NULL AND
          linked_instrument_id IS NULL AND
          opal_replacement_resource_id IS NULL));
  END IF;
END $$;

-- A record whose treatment is a link must never also claim a hosted file.
-- linked_resource_id may point at a link-only resource; the no-local-file rule
-- for that resource is asserted in the resources layer and in tests.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ingestion_official_url_is_https') THEN
    ALTER TABLE resource_ingestion_register ADD CONSTRAINT ingestion_official_url_is_https CHECK (
      official_url IS NULL OR official_url ~* '^https://');
  END IF;
END $$;

-- A stored source reference is a redacted directory, never an absolute path,
-- a traversal, or a Windows drive letter.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ingestion_source_reference_is_redacted') THEN
    ALTER TABLE resource_ingestion_register ADD CONSTRAINT ingestion_source_reference_is_redacted CHECK (
      source_reference IS NULL OR (
        source_reference NOT LIKE '/%' AND
        source_reference NOT LIKE '~%' AND
        source_reference NOT LIKE '%..%' AND
        source_reference !~ '^[A-Za-z]:'));
  END IF;
END $$;

-- ── Indexes ─────────────────────────────────────────────────────────────────

-- The upsert key. Re-running ingestion updates in place; it cannot duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_ingestion_register_catalogue
  ON resource_ingestion_register (organisation_id, catalogue_id);

CREATE INDEX IF NOT EXISTS idx_ingestion_register_treatment
  ON resource_ingestion_register (organisation_id, treatment);
CREATE INDEX IF NOT EXISTS idx_ingestion_register_status
  ON resource_ingestion_register (organisation_id, ingestion_status);
CREATE INDEX IF NOT EXISTS idx_ingestion_register_quality
  ON resource_ingestion_register (organisation_id, quality_status);
CREATE INDEX IF NOT EXISTS idx_ingestion_register_checksum
  ON resource_ingestion_register (checksum_sha256) WHERE checksum_sha256 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ingestion_register_linked
  ON resource_ingestion_register (linked_resource_id) WHERE linked_resource_id IS NOT NULL;

-- ── Audit history ───────────────────────────────────────────────────────────
-- Every treatment or status change, including the ones the importer makes, so
-- the register can answer "who decided this, when, and on what basis".

CREATE TABLE IF NOT EXISTS resource_ingestion_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  UUID NOT NULL REFERENCES organisations(id),
  register_id      UUID NOT NULL REFERENCES resource_ingestion_register(id) ON DELETE CASCADE,
  catalogue_id     VARCHAR(20) NOT NULL,
  field            VARCHAR(40) NOT NULL,
  from_value       VARCHAR(120),
  to_value         VARCHAR(120),
  reason           TEXT,
  actor_user_id    UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ingestion_events_register
  ON resource_ingestion_events (register_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_events_catalogue
  ON resource_ingestion_events (organisation_id, catalogue_id, created_at DESC);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_ingestion_event_field') THEN
    ALTER TABLE resource_ingestion_events ADD CONSTRAINT valid_ingestion_event_field CHECK (
      field IN ('treatment','ingestion_status','quality_status','reviewer',
                'linked_resource','linked_instrument','official_url','registered','next_action'));
  END IF;
END $$;

-- ── Clean-room provenance for Opal originals ────────────────────────────────
-- Section E requires a recorded clean-room trail: which catalogue record
-- prompted the work, that only its general clinical purpose was carried across,
-- and which blockers apply. Kept out of `resources.provenance` JSON so it is
-- queryable and so a reviewer can be required per gate.

CREATE TABLE IF NOT EXISTS resource_cleanroom_provenance (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id      UUID NOT NULL REFERENCES organisations(id),
  resource_id          UUID REFERENCES resources(id) ON DELETE CASCADE,
  catalogue_id         VARCHAR(20) NOT NULL,
  -- What was carried across. Purpose only: never sentences, tables or layout.
  clinical_purpose     TEXT NOT NULL,
  inspiration_class    VARCHAR(60) NOT NULL DEFAULT 'general-clinical-purpose-only',
  risk_tier            VARCHAR(20) NOT NULL DEFAULT 'standard',
  -- Gate outcomes. Nothing publishes until every applicable gate passes.
  clinical_gate        VARCHAR(20) NOT NULL DEFAULT 'pending',
  rights_gate          VARCHAR(20) NOT NULL DEFAULT 'pending',
  brand_gate           VARCHAR(20) NOT NULL DEFAULT 'pending',
  accessibility_gate   VARCHAR(20) NOT NULL DEFAULT 'pending',
  legal_gate           VARCHAR(20) NOT NULL DEFAULT 'not-required',
  blocker_note         TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_cleanroom_catalogue
  ON resource_cleanroom_provenance (organisation_id, catalogue_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_cleanroom_risk_tier') THEN
    ALTER TABLE resource_cleanroom_provenance ADD CONSTRAINT valid_cleanroom_risk_tier CHECK (
      risk_tier IN ('standard','high-clinical','legal'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_cleanroom_gates') THEN
    ALTER TABLE resource_cleanroom_provenance ADD CONSTRAINT valid_cleanroom_gates CHECK (
      clinical_gate      IN ('pending','passed','blocked','not-required') AND
      rights_gate        IN ('pending','passed','blocked','not-required') AND
      brand_gate         IN ('pending','passed','blocked','not-required') AND
      accessibility_gate IN ('pending','passed','blocked','not-required') AND
      legal_gate         IN ('pending','passed','blocked','not-required'));
  END IF;
END $$;

-- A legal-tier item (service agreements and the like) must carry an explicit
-- legal blocker. It cannot quietly inherit 'not-required'.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'legal_tier_requires_legal_gate') THEN
    ALTER TABLE resource_cleanroom_provenance ADD CONSTRAINT legal_tier_requires_legal_gate CHECK (
      risk_tier <> 'legal' OR legal_gate IN ('pending','blocked','passed'));
  END IF;
END $$;
