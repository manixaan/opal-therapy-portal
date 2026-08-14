-- ═══════════════════════════════════════════════════════════════════════════
--  022 — Server-issued document control + per-field exclusion
-- ═══════════════════════════════════════════════════════════════════════════
-- Two additive JSONB columns on the SHARED draft table, so the FCA report and
-- the progress note letter both gain the behaviour from one migration. Nothing
-- is dropped, nothing is rewritten, and every existing row is already correct
-- under the defaults.
--
-- ── document_control ───────────────────────────────────────────────────────
-- The values Opal ISSUES rather than looks up: the document reference, the
-- document date, the version and the status. These were previously minted at
-- generate time, which meant the review step showed them as "Missing" — which
-- was simply wrong. They are ours to issue, so they are issued ONCE, when the
-- draft is created, and stored here.
--
-- Storing them (rather than recomputing them on every read) is what makes the
-- promise "regenerating never renumbers an existing document" structural
-- instead of incidental: the reference a therapist read in review is the
-- reference that reaches the footer, and a second generation reads the same
-- row rather than minting a second value.
--
--   { documentReference, reportDate, reportVersion, reportStatus }
--
-- The progress note letter's template carries only the reference control, so
-- only that key is rendered for a letter; the rest are stored for a future
-- template version rather than being invented at the moment one appears.
--
-- These are DEFAULTS, not decrees. A therapist may legitimately issue version
-- 2.0, or mark a report Final, and does so through the ordinary per-report
-- override — the value here is what applies when they have not.
--
-- A row created before this migration has '{}' and is resolved from the draft
-- id and its created_at, which yields exactly the same reference it would
-- always have had.
--
-- ── excluded_fields ────────────────────────────────────────────────────────
-- The tags the therapist has explicitly said Opal does not hold and should not
-- ask about again. An excluded tag renders as NOTHING in the finished document
-- — an empty content control the therapist can still type into in Word, or,
-- where the template marks the tag as owning a whole optional line, no line at
-- all. It is deliberately NOT the same thing as a missing value: missing means
-- "we could not find this", excluded means "do not put anything here".
--
-- It is an array of template tags, validated against the template's own tag
-- catalogue in the application layer; an unknown tag is dropped rather than
-- trusted, exactly as section tags and overrides already are.
--
-- Like every other draft column, this is frozen with the rest of the snapshot
-- at generate time, so an issued document can always be explained.

ALTER TABLE fca_report_drafts
  ADD COLUMN IF NOT EXISTS document_control JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE fca_report_drafts
  ADD COLUMN IF NOT EXISTS excluded_fields  JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Guarded because ADD CONSTRAINT has no IF NOT EXISTS in PostgreSQL 14.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'valid_fca_draft_document_control'
  ) THEN
    ALTER TABLE fca_report_drafts
      ADD CONSTRAINT valid_fca_draft_document_control
      CHECK (jsonb_typeof(document_control) = 'object');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'valid_fca_draft_excluded_fields'
  ) THEN
    ALTER TABLE fca_report_drafts
      ADD CONSTRAINT valid_fca_draft_excluded_fields
      CHECK (jsonb_typeof(excluded_fields) = 'array');
  END IF;
END $$;
