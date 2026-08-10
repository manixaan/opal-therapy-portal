-- ═══════════════════════════════════════════════════════════════════════════
--  019 — Progress note letters (a SECOND document type on the SAME tables)
-- ═══════════════════════════════════════════════════════════════════════════
-- The FCA report gave this database a template registry, a draft, a frozen
-- generation snapshot and a stored document. A progress note letter is the
-- same lifecycle over a different template, so this migration GENERALISES the
-- 018 tables rather than cloning them. There is no letter_templates, no
-- letter_drafts and no letter_documents table, and there never should be:
-- parallel tables would mean parallel RBAC, parallel org-isolation filters and
-- two places to get the frozen-snapshot rule wrong.
--
-- ── What generalises ───────────────────────────────────────────────────────
-- document_type on fca_templates and fca_report_drafts, DEFAULT 'fca_report'.
-- Every existing row is therefore correct without being touched, and every
-- existing query — none of which filters on the column — keeps its meaning.
--
-- These columns are REUSED as-is by the letter and are deliberately NOT
-- duplicated under letter-specific names:
--   selected_sections  the selected block tags
--   section_order      block order
--   custom_sections    the custom content definitions
--   scalar_overrides   the therapist's per-letter values
--   scalar_snapshot / scalar_sources / missing_fields
--                      the immutable snapshot frozen at generate time
--
-- ── What is genuinely new ──────────────────────────────────────────────────
-- Three JSONB columns holding the letter's own addressing data. They are
-- SNAPSHOTS: a recipient is copied onto the draft when it is chosen, so
-- editing a client profile afterwards can never silently re-address a letter
-- that has already been written, and generating never re-reads the profile.
--   letter_recipient      { name, role, organisation, address, salutation }
--   letter_cc_recipients  [ { name, organisation } ]
--   letter_details        { letterDate, subject, reportingPeriod }
--
-- ── Privacy note ───────────────────────────────────────────────────────────
-- These columns hold identifiable contact details for a third party. They are
-- organisation-scoped and own-user-scoped through the row they hang off, they
-- are never written to an audit row, and they are never logged.

-- ── document_type ──────────────────────────────────────────────────────────
ALTER TABLE fca_templates
  ADD COLUMN IF NOT EXISTS document_type VARCHAR(40) NOT NULL DEFAULT 'fca_report';

ALTER TABLE fca_report_drafts
  ADD COLUMN IF NOT EXISTS document_type VARCHAR(40) NOT NULL DEFAULT 'fca_report';

-- Added as named constraints so a third document type is a one-line change and
-- an unknown value can never reach a route that would not know what to do with
-- it. Guarded because ADD CONSTRAINT has no IF NOT EXISTS in PostgreSQL 14.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'valid_fca_template_document_type'
  ) THEN
    ALTER TABLE fca_templates
      ADD CONSTRAINT valid_fca_template_document_type
      CHECK (document_type IN ('fca_report', 'progress_note_letter'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'valid_fca_draft_document_type'
  ) THEN
    ALTER TABLE fca_report_drafts
      ADD CONSTRAINT valid_fca_draft_document_type
      CHECK (document_type IN ('fca_report', 'progress_note_letter'));
  END IF;
END $$;

-- ── Letter-specific snapshots ──────────────────────────────────────────────
ALTER TABLE fca_report_drafts
  ADD COLUMN IF NOT EXISTS letter_recipient     JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE fca_report_drafts
  ADD COLUMN IF NOT EXISTS letter_cc_recipients JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE fca_report_drafts
  ADD COLUMN IF NOT EXISTS letter_details       JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'valid_fca_draft_letter_recipient'
  ) THEN
    ALTER TABLE fca_report_drafts
      ADD CONSTRAINT valid_fca_draft_letter_recipient
      CHECK (jsonb_typeof(letter_recipient) = 'object');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'valid_fca_draft_letter_cc'
  ) THEN
    ALTER TABLE fca_report_drafts
      ADD CONSTRAINT valid_fca_draft_letter_cc
      CHECK (jsonb_typeof(letter_cc_recipients) = 'array');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'valid_fca_draft_letter_details'
  ) THEN
    ALTER TABLE fca_report_drafts
      ADD CONSTRAINT valid_fca_draft_letter_details
      CHECK (jsonb_typeof(letter_details) = 'object');
  END IF;
END $$;

-- The draft list is always scoped to one organisation, one user and one
-- document type, so that is the index it deserves.
CREATE INDEX IF NOT EXISTS idx_fca_drafts_org_user_type_created
  ON fca_report_drafts (organisation_id, created_by_user_id, document_type, created_at DESC);

-- A template is identified by key+version (already unique); this index serves
-- "the active template for this document type".
CREATE INDEX IF NOT EXISTS idx_fca_templates_document_type_active
  ON fca_templates (document_type, is_active);

-- ── Saved letter contacts on the client report profile ─────────────────────
-- other_contacts already exists on fca_client_profiles as a JSONB array and is
-- exactly the right home for saved letter recipients, so no new column is
-- added. Entries written by the letter's explicit save-to-profile carry
-- { name, role, organisation, address, salutation, savedAt }.
