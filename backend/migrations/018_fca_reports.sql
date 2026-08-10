-- ═══════════════════════════════════════════════════════════════════════════
--  018 — Functional Capacity Assessment (FCA) report generation
-- ═══════════════════════════════════════════════════════════════════════════
-- Therapist-driven composition of the Opal Functional Assessment Report from
-- a Word template of content controls. Nothing here is AI-assisted and nothing
-- leaves the building: no external model, no third-party service, no public URL.
--
-- ── The four data layers ───────────────────────────────────────────────────
--   1. Splose             live client data, fetched at request time. NOT stored
--                         here. Splose stays the system of record for identity
--                         and contact facts.
--   2. Client profile     fca_client_profiles (+ plans, + goals). Durable client
--                         facts Splose has no field for, keyed to the Splose
--                         client id and scoped to ONE organisation. It
--                         SUPPLEMENTS Splose and never replaces it. Nothing is
--                         ever written here implicitly — only an explicit,
--                         permissioned save-back from a draft writes a row.
--   3. Report overrides   fca_report_drafts.scalar_overrides, one report only.
--   4. Snapshot           fca_report_drafts.scalar_snapshot / scalar_sources,
--                         FROZEN at generate time. The download route re-reads
--                         the snapshot and never re-resolves, so a document can
--                         never quietly change after it was issued.
--
-- ── Plan versioning ────────────────────────────────────────────────────────
-- An NDIS plan is NEVER overwritten. A new plan supersedes the old one by
-- inserting a new row with is_current = TRUE and clearing the previous flag.
-- Old plan dates and their goals stay queryable forever, which is what makes a
-- report issued last year still explicable this year. A partial unique index
-- enforces at most one current plan per profile.
--
-- ── Organisation isolation ─────────────────────────────────────────────────
-- Profiles and drafts both carry organisation_id NOT NULL and every route
-- filters on it. UNIQUE (organisation_id, splose_client_id) means two
-- organisations can each hold their own profile for the same Splose client
-- without ever seeing each other's clinical context.

-- ── Templates ──────────────────────────────────────────────────────────────
-- Immutable once generated from: see the trigger below. Publishing a change
-- means inserting a NEW version row, never editing a used one, so every issued
-- document can always be traced to the exact template that produced it.
CREATE TABLE IF NOT EXISTS fca_templates (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key        VARCHAR(40)  NOT NULL,
  version             VARCHAR(20)  NOT NULL,
  name                TEXT         NOT NULL,
  storage_path        TEXT         NOT NULL,
  checksum            VARCHAR(64),
  is_active           BOOLEAN      NOT NULL DEFAULT TRUE,
  published_by_user_id UUID        REFERENCES users(id),
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT uniq_fca_template_version UNIQUE (template_key, version)
);

CREATE INDEX IF NOT EXISTS idx_fca_templates_active
  ON fca_templates (template_key, is_active);

-- ── Client report profiles (layer 2) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS fca_client_profiles (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id             UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  splose_client_id            TEXT NOT NULL,
  -- Durable client facts only. Report-specific values (report date, reviewer,
  -- authorised recipients, referral reason, clinical conclusions) are
  -- deliberately absent — they belong to one report and are rejected by
  -- save-to-profile.
  preferred_name              TEXT,
  pronouns                    TEXT,
  date_of_birth               DATE,
  primary_disability          TEXT,
  other_conditions            TEXT,
  nominee_details             TEXT,
  support_coordinator_details TEXT,
  -- Suggested from here but genuinely editable per report: referrals change.
  referrer_details            TEXT,
  other_contacts              JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by_user_id          UUID REFERENCES users(id),
  updated_by_user_id          UUID REFERENCES users(id),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uniq_fca_profile_per_org_client UNIQUE (organisation_id, splose_client_id),
  CONSTRAINT valid_fca_profile_other_contacts CHECK (jsonb_typeof(other_contacts) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_fca_client_profiles_org_client
  ON fca_client_profiles (organisation_id, splose_client_id);

-- ── Versioned NDIS plans ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fca_client_ndis_plans (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_profile_id UUID NOT NULL REFERENCES fca_client_profiles(id) ON DELETE CASCADE,
  plan_start        DATE,
  plan_end          DATE,
  is_current        BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_user_id UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_fca_plan_dates CHECK (plan_start IS NULL OR plan_end IS NULL OR plan_end >= plan_start)
);

-- At most one current plan per profile. Superseded rows keep is_current FALSE
-- and are never deleted or edited.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_fca_one_current_plan_per_profile
  ON fca_client_ndis_plans (client_profile_id) WHERE is_current;

CREATE INDEX IF NOT EXISTS idx_fca_plans_profile_created
  ON fca_client_ndis_plans (client_profile_id, created_at DESC);

-- ── Structured, repeatable NDIS goals, attached to a plan version ──────────
-- Stored unbounded and ordered. fca-v1 exposes only OPAL_CLIENT_NDIS_GOAL_1
-- and _2, which map to the current plan's first two goals in sort_order; any
-- third or later goal is retained and queryable but has no control to render
-- into. A future template version can expose more without a data migration.
CREATE TABLE IF NOT EXISTS fca_client_ndis_goals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id     UUID NOT NULL REFERENCES fca_client_ndis_plans(id) ON DELETE CASCADE,
  goal_text   TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_fca_goal_sort_order CHECK (sort_order >= 0),
  CONSTRAINT valid_fca_goal_text CHECK (length(btrim(goal_text)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_fca_goals_plan_order
  ON fca_client_ndis_goals (plan_id, sort_order);

-- ── Report drafts ──────────────────────────────────────────────────────────
-- client_id is TEXT: it is a Splose identifier, not a local foreign key, and
-- there is no clients table in this database to point at.
CREATE TABLE IF NOT EXISTS fca_report_drafts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id       UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  client_id             TEXT NOT NULL,
  client_name           TEXT,
  client_preferred_name TEXT,
  therapist_profile_id  UUID REFERENCES therapist_profiles(id),
  therapist_name        TEXT,
  created_by_user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id           UUID REFERENCES fca_templates(id),
  template_version      VARCHAR(20) NOT NULL,
  status                VARCHAR(20) NOT NULL DEFAULT 'draft',
    CONSTRAINT valid_fca_draft_status CHECK (status IN ('draft','generated','archived')),
  selected_sections     JSONB NOT NULL DEFAULT '[]'::jsonb,
  section_order         JSONB NOT NULL DEFAULT '[]'::jsonb,
  custom_sections       JSONB NOT NULL DEFAULT '[]'::jsonb,
  scalar_overrides      JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Frozen at generate time. Never re-resolved at download.
  scalar_snapshot       JSONB NOT NULL DEFAULT '{}'::jsonb,
  scalar_sources        JSONB NOT NULL DEFAULT '{}'::jsonb,
  missing_fields        JSONB NOT NULL DEFAULT '[]'::jsonb,
  generated_document_id UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  generated_at          TIMESTAMPTZ,
  CONSTRAINT valid_fca_draft_selected_sections CHECK (jsonb_typeof(selected_sections) = 'array'),
  CONSTRAINT valid_fca_draft_section_order     CHECK (jsonb_typeof(section_order) = 'array'),
  CONSTRAINT valid_fca_draft_custom_sections   CHECK (jsonb_typeof(custom_sections) = 'array'),
  CONSTRAINT valid_fca_draft_missing_fields    CHECK (jsonb_typeof(missing_fields) = 'array'),
  CONSTRAINT valid_fca_draft_overrides         CHECK (jsonb_typeof(scalar_overrides) = 'object'),
  CONSTRAINT valid_fca_draft_snapshot          CHECK (jsonb_typeof(scalar_snapshot) = 'object'),
  CONSTRAINT valid_fca_draft_sources           CHECK (jsonb_typeof(scalar_sources) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_fca_drafts_org_user_created
  ON fca_report_drafts (organisation_id, created_by_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fca_drafts_org_client
  ON fca_report_drafts (organisation_id, client_id);

-- ── Generated documents ────────────────────────────────────────────────────
-- Bytes live in file_data (db backend) or behind storage_key (local/blob), via
-- the same storage abstraction the rest of the app uses. There is never a
-- public URL: downloads go through an authenticated, own-draft-only route.
CREATE TABLE IF NOT EXISTS fca_generated_documents (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id           UUID NOT NULL REFERENCES fca_report_drafts(id) ON DELETE CASCADE,
  storage_backend    VARCHAR(20) NOT NULL DEFAULT 'db',
  storage_key        TEXT,
  file_data          TEXT,
  filename           TEXT NOT NULL,
  byte_size          INTEGER NOT NULL,
  checksum           VARCHAR(64),
  template_version   VARCHAR(20) NOT NULL,
  created_by_user_id UUID REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_fca_document_size CHECK (byte_size > 0),
  CONSTRAINT valid_fca_document_bytes CHECK (file_data IS NOT NULL OR storage_key IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_fca_documents_draft
  ON fca_generated_documents (draft_id, created_at DESC);

-- ── Section presets (per user) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fca_section_presets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organisation_id   UUID REFERENCES organisations(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  selected_sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  section_order     JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uniq_fca_preset_name_per_user UNIQUE (user_id, name),
  CONSTRAINT valid_fca_preset_selected CHECK (jsonb_typeof(selected_sections) = 'array'),
  CONSTRAINT valid_fca_preset_order    CHECK (jsonb_typeof(section_order) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_fca_presets_user ON fca_section_presets (user_id, name);

-- ── Template immutability ──────────────────────────────────────────────────
-- Once a document has been generated from a template version, that row is
-- frozen. Reproducing an issued report a year later has to mean re-running the
-- exact same template, so silently editing one is not an option. Deactivating
-- (is_active) is still allowed — that retires a version without rewriting it.
CREATE OR REPLACE FUNCTION fca_templates_refuse_update() RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM fca_generated_documents gd
      JOIN fca_report_drafts d ON d.id = gd.draft_id
     WHERE d.template_id = OLD.id
  ) THEN
    -- Retiring a version is a status change, not a content change.
    IF NEW.template_key   IS DISTINCT FROM OLD.template_key
    OR NEW.version        IS DISTINCT FROM OLD.version
    OR NEW.name           IS DISTINCT FROM OLD.name
    OR NEW.storage_path   IS DISTINCT FROM OLD.storage_path
    OR NEW.checksum       IS DISTINCT FROM OLD.checksum THEN
      RAISE EXCEPTION
        'fca_templates row % is immutable: documents have already been generated from it. Publish a new version instead.', OLD.id
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fca_templates_immutable ON fca_templates;
CREATE TRIGGER trg_fca_templates_immutable
  BEFORE UPDATE ON fca_templates
  FOR EACH ROW EXECUTE FUNCTION fca_templates_refuse_update();
