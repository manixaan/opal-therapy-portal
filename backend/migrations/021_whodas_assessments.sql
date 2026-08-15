-- ═══════════════════════════════════════════════════════════════════════════
--  021 — WHODAS 2.0 (36-item) digital assessment module
-- ═══════════════════════════════════════════════════════════════════════════
-- Electronic administration of the World Health Organization Disability
-- Assessment Schedule 2.0, 36-item version, in all three official modes:
-- interviewer-, self- and proxy-administered.
--
-- ── The instrument is not ours ─────────────────────────────────────────────
-- WHODAS 2.0 is a WHO instrument. Nothing here stores question text, response
-- wording or layout: those live in the immutable WHO source PDFs under
-- backend/whodas/templates/, registered in whodas_templates by SHA-256. The
-- database holds only what a person filling in the paper form would write on
-- it, plus the portal metadata needed to file and audit that record.
-- Production release is gated behind ENABLE_WHODAS_ASSESSMENT; see
-- docs/whodas/03_LICENSING_COMPLIANCE.md.
--
-- ── Why responses are text, not numbers ────────────────────────────────────
-- The supplied WHO sources disagree on coding: the manual's prose and its
-- Chapter 8 syntax use 1-5, both supplied scoring workbooks use 0-4. Storing a
-- numeral would be ambiguous forever. Responses are therefore stored as the
-- semantic category ('none' … 'extreme') and each scoring method applies its
-- own coding at calculation time. See docs/whodas/02_WHO_SOURCE_AUDIT.md §5.
--
-- ── Three scores, never blended ────────────────────────────────────────────
-- Every completed assessment stores all three WHO-derived scores side by side
-- (simple sum, domain mean, IRT), each with the methodology, source and engine
-- version that produced it. The IRT score is the default clinical result. A
-- score can never be reinterpreted later as having come from a different
-- method, because the method travels with the number.
--
-- ── Client identity ────────────────────────────────────────────────────────
-- client_id is TEXT: a Splose identifier. There is no clients table in this
-- database (see migration 018). Assessments are scoped by organisation_id and
-- keyed to the Splose client, exactly as fca_report_drafts is.
--
-- Additive only. No existing table is altered.

-- ── Template registry ──────────────────────────────────────────────────────
-- One row per official WHO source document. The hash is the point: a template
-- whose bytes changed must never quietly enter production, because every
-- issued assessment claims to have been rendered from a specific document.
CREATE TABLE IF NOT EXISTS whodas_templates (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key     VARCHAR(60)  NOT NULL,
  version          VARCHAR(20)  NOT NULL,
  instrument       VARCHAR(40)  NOT NULL DEFAULT 'WHODAS-2.0',
  item_set         VARCHAR(20)  NOT NULL DEFAULT '36-item',
  -- 'interviewer' | 'self' | 'proxy'. Flashcards are administration support
  -- for the interviewer form and carry that method.
  method           VARCHAR(20)  NOT NULL,
  name             TEXT         NOT NULL,
  -- Path relative to backend/whodas/templates/. The bytes are shipped with the
  -- application, not stored in the database: they are a fixed asset, identical
  -- in every environment, and must be verifiable at boot without a query.
  storage_path     TEXT         NOT NULL,
  sha256           CHAR(64)     NOT NULL,
  page_count       INTEGER      NOT NULL,
  -- Page geometry in PDF points, recorded so a field map can be validated
  -- against the document it was derived from.
  media_box        JSONB        NOT NULL,
  crop_box         JSONB        NOT NULL,
  -- Which pages of which WHO publication this was extracted from.
  source_provenance JSONB       NOT NULL DEFAULT '{}'::jsonb,
  is_active        BOOLEAN      NOT NULL DEFAULT TRUE,
  registered_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT uniq_whodas_template_version UNIQUE (template_key, version),
  CONSTRAINT valid_whodas_template_method CHECK (method IN ('interviewer','self','proxy')),
  CONSTRAINT valid_whodas_template_pages  CHECK (page_count > 0),
  CONSTRAINT valid_whodas_template_sha    CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT valid_whodas_template_media  CHECK (jsonb_typeof(media_box) = 'array'),
  CONSTRAINT valid_whodas_template_crop   CHECK (jsonb_typeof(crop_box) = 'array'),
  CONSTRAINT valid_whodas_template_prov   CHECK (jsonb_typeof(source_provenance) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_whodas_templates_active
  ON whodas_templates (template_key, is_active);
CREATE INDEX IF NOT EXISTS idx_whodas_templates_method
  ON whodas_templates (method, is_active);

-- ── Assessments ────────────────────────────────────────────────────────────
-- One row per administration of the instrument to one client.
--
-- status:
--   draft      in progress; responses may change; autosaved
--   completed  clinically signed off; responses frozen; scores calculated
--   voided     withdrawn in error; retained, never deleted, never scored
--   amended    superseded by a later corrected version (see amends_assessment_id)
--
-- A completed assessment is never edited. Correcting one means creating a new
-- assessment that points at it via amends_assessment_id, which is what keeps a
-- result issued last year still explicable this year.
CREATE TABLE IF NOT EXISTS whodas_assessments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id       UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  client_id             TEXT NOT NULL,
  -- Denormalised so history stays readable if Splose is unreachable. Never the
  -- source of truth for identity.
  client_name           TEXT,

  instrument            VARCHAR(40) NOT NULL DEFAULT 'WHODAS-2.0',
  instrument_version    VARCHAR(20) NOT NULL DEFAULT '2.0',
  item_set              VARCHAR(20) NOT NULL DEFAULT '36-item',
  administration_method VARCHAR(20) NOT NULL,

  -- The exact document this assessment was rendered from, pinned at creation.
  template_id           UUID NOT NULL REFERENCES whodas_templates(id),
  template_key          VARCHAR(60) NOT NULL,
  template_version      VARCHAR(20) NOT NULL,
  template_sha256       CHAR(64)    NOT NULL,

  status                VARCHAR(20) NOT NULL DEFAULT 'draft',

  -- Whether the respondent works (paid, non-paid, self-employed) or goes to
  -- school, which decides whether D5.5-D5.8 are administered at all. NULL until
  -- the clinician answers it. It is never inferred: guessing it would either
  -- fabricate four responses or silently discard them.
  work_school_applicable BOOLEAN,

  -- itemId → 'none'|'mild'|'moderate'|'severe'|'extreme' for the 36 scored
  -- items. Non-scored captured items (H1-H3, proxy H4, interviewer A1-A5,
  -- F1-F5, D5.01, D5.02, D5.9, D5.10) live in form_data.
  responses             JSONB NOT NULL DEFAULT '{}'::jsonb,
  form_data             JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Every scoring method's full result, keyed by method name, frozen at
  -- completion. Each entry carries its own label, sourceMethodology,
  -- scoringVersion and calculatedAt.
  scores                JSONB NOT NULL DEFAULT '{}'::jsonb,
  default_scoring_method VARCHAR(20),
  scoring_version       VARCHAR(20),
  scores_calculated_at  TIMESTAMPTZ,

  -- Optimistic concurrency. Incremented on every accepted write; a client
  -- sending a stale value gets 409 rather than overwriting newer responses.
  version               INTEGER NOT NULL DEFAULT 1,

  started_by_user_id    UUID NOT NULL REFERENCES users(id),
  started_by_name       TEXT,
  started_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_by_user_id  UUID REFERENCES users(id),
  completed_by_name     TEXT,
  completed_at          TIMESTAMPTZ,
  voided_by_user_id     UUID REFERENCES users(id),
  voided_at             TIMESTAMPTZ,
  void_reason           TEXT,

  -- Set on the OLD assessment when a correction supersedes it.
  amended_by_assessment_id UUID REFERENCES whodas_assessments(id),
  -- Set on the NEW assessment, pointing back at what it corrects.
  amends_assessment_id     UUID REFERENCES whodas_assessments(id),
  amendment_reason         TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT valid_whodas_method   CHECK (administration_method IN ('interviewer','self','proxy')),
  CONSTRAINT valid_whodas_status   CHECK (status IN ('draft','completed','voided','amended')),
  CONSTRAINT valid_whodas_itemset  CHECK (item_set IN ('36-item','32-item')),
  CONSTRAINT valid_whodas_resp     CHECK (jsonb_typeof(responses) = 'object'),
  CONSTRAINT valid_whodas_formdata CHECK (jsonb_typeof(form_data) = 'object'),
  CONSTRAINT valid_whodas_scores   CHECK (jsonb_typeof(scores) = 'object'),
  CONSTRAINT valid_whodas_version  CHECK (version >= 1),
  CONSTRAINT valid_whodas_client   CHECK (length(btrim(client_id)) > 0),
  -- A completed assessment must record who completed it, when, and on which
  -- item set — the three facts a later reader needs to trust the score.
  CONSTRAINT valid_whodas_completion CHECK (
    status <> 'completed' OR (
      completed_at IS NOT NULL
      AND completed_by_user_id IS NOT NULL
      AND work_school_applicable IS NOT NULL
    )
  ),
  CONSTRAINT valid_whodas_void CHECK (
    status <> 'voided' OR (voided_at IS NOT NULL AND voided_by_user_id IS NOT NULL)
  ),
  CONSTRAINT valid_whodas_no_self_amend CHECK (amends_assessment_id IS DISTINCT FROM id)
);

CREATE INDEX IF NOT EXISTS idx_whodas_assessments_org_client
  ON whodas_assessments (organisation_id, client_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_whodas_assessments_org_status
  ON whodas_assessments (organisation_id, status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_whodas_assessments_started_by
  ON whodas_assessments (started_by_user_id, status, started_at DESC);

-- A client can have at most one assessment in progress per administration
-- method. Autosave retries and double-clicked "Start assessment" buttons are
-- the normal way duplicate clinical records get created; this makes that
-- impossible rather than merely unlikely.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_whodas_one_draft_per_client_method
  ON whodas_assessments (organisation_id, client_id, administration_method)
  WHERE status = 'draft';

-- ── Generated documents ────────────────────────────────────────────────────
-- Completed-assessment PDFs, produced by overlaying responses onto a copy of
-- the immutable template. Bytes go through backend/storage/index.js like every
-- other clinical document; there is never a public URL.
CREATE TABLE IF NOT EXISTS whodas_generated_documents (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id      UUID NOT NULL REFERENCES whodas_assessments(id) ON DELETE CASCADE,
  storage_backend    VARCHAR(20) NOT NULL DEFAULT 'db',
  storage_key        TEXT,
  file_data          TEXT,
  filename           TEXT NOT NULL,
  mime_type          VARCHAR(80) NOT NULL DEFAULT 'application/pdf',
  byte_size          INTEGER NOT NULL,
  checksum           CHAR(64),
  -- The template this document was rendered from, so a re-issue can be proven
  -- to have used the same source.
  template_key       VARCHAR(60) NOT NULL,
  template_version   VARCHAR(20) NOT NULL,
  template_sha256    CHAR(64)    NOT NULL,
  page_count         INTEGER,
  created_by_user_id UUID REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_whodas_doc_size  CHECK (byte_size > 0),
  CONSTRAINT valid_whodas_doc_bytes CHECK (file_data IS NOT NULL OR storage_key IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_whodas_documents_assessment
  ON whodas_generated_documents (assessment_id, created_at DESC);

-- ── Completed assessments are immutable ────────────────────────────────────
-- Enforced in the database, not only in the route layer. Once an assessment is
-- completed, its clinical content is frozen: responses, form data, scores, the
-- item set and the template it was rendered from can never change. Only
-- lifecycle transitions remain — voiding it, or marking it superseded by an
-- amendment.
CREATE OR REPLACE FUNCTION whodas_assessments_refuse_content_change() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IN ('completed','amended','voided') THEN
    IF NEW.responses              IS DISTINCT FROM OLD.responses
    OR NEW.form_data              IS DISTINCT FROM OLD.form_data
    OR NEW.scores                 IS DISTINCT FROM OLD.scores
    OR NEW.work_school_applicable IS DISTINCT FROM OLD.work_school_applicable
    OR NEW.item_set               IS DISTINCT FROM OLD.item_set
    OR NEW.template_id            IS DISTINCT FROM OLD.template_id
    OR NEW.template_sha256        IS DISTINCT FROM OLD.template_sha256
    OR NEW.administration_method  IS DISTINCT FROM OLD.administration_method
    OR NEW.client_id              IS DISTINCT FROM OLD.client_id
    OR NEW.completed_at           IS DISTINCT FROM OLD.completed_at
    OR NEW.completed_by_user_id   IS DISTINCT FROM OLD.completed_by_user_id THEN
      RAISE EXCEPTION
        'whodas_assessments row % is % and its clinical content is immutable. Raise an amendment instead.',
        OLD.id, OLD.status
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;

  -- A draft can never silently regress to an earlier version.
  IF NEW.version < OLD.version THEN
    RAISE EXCEPTION 'whodas_assessments row % version cannot go backwards (% → %)',
      OLD.id, OLD.version, NEW.version
      USING ERRCODE = 'restrict_violation';
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_whodas_assessments_immutable ON whodas_assessments;
CREATE TRIGGER trg_whodas_assessments_immutable
  BEFORE UPDATE ON whodas_assessments
  FOR EACH ROW EXECUTE FUNCTION whodas_assessments_refuse_content_change();

-- ── Templates are immutable once used ──────────────────────────────────────
-- Same reasoning as fca_templates (migration 018): once an assessment has been
-- rendered from a template version, that row's content is frozen. Retiring a
-- version by clearing is_active is still allowed.
CREATE OR REPLACE FUNCTION whodas_templates_refuse_update() RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM whodas_assessments a WHERE a.template_id = OLD.id) THEN
    IF NEW.template_key IS DISTINCT FROM OLD.template_key
    OR NEW.version      IS DISTINCT FROM OLD.version
    OR NEW.sha256       IS DISTINCT FROM OLD.sha256
    OR NEW.storage_path IS DISTINCT FROM OLD.storage_path
    OR NEW.page_count   IS DISTINCT FROM OLD.page_count
    OR NEW.method       IS DISTINCT FROM OLD.method THEN
      RAISE EXCEPTION
        'whodas_templates row % is immutable: assessments have already been rendered from it. Register a new version instead.',
        OLD.id
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_whodas_templates_immutable ON whodas_templates;
CREATE TRIGGER trg_whodas_templates_immutable
  BEFORE UPDATE ON whodas_templates
  FOR EACH ROW EXECUTE FUNCTION whodas_templates_refuse_update();
