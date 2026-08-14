-- ═══════════════════════════════════════════════════════════════════════════
--  028 — WHODAS external completion (uploaded, manually completed forms)
-- ═══════════════════════════════════════════════════════════════════════════
--
--  Supports the real clinical workflow the electronic path cannot cover:
--  print a blank WHO form, have it completed on paper, scan it, upload it.
--
--  WHY A COLUMN AND NOT A NEW STATUS
--  An externally completed assessment IS completed — the clinical event
--  happened. What differs is HOW, and therefore how much the record can be
--  trusted to compute. Overloading `status` would make every existing query
--  that reads 'completed' quietly wrong. `completion_source` keeps the
--  lifecycle intact and records provenance beside it.
--
--  WHAT AN UPLOADED ASSESSMENT MAY NOT CLAIM
--  It carries no responses and no scores. Migration 021 requires a completed
--  assessment to record who completed it, when, and the work/school
--  applicability — all knowable for an uploaded form — but nothing in the
--  schema lets an upload assert a score. That is deliberate: this phase does
--  not OCR or interpret a handwritten form, so a score would be fabricated.
--  A clinician who wants a scored record enters the responses electronically.
--
--  Idempotent. See backend/migrations/README.md.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE whodas_assessments
  ADD COLUMN IF NOT EXISTS completion_source VARCHAR(20) NOT NULL DEFAULT 'electronic';

COMMENT ON COLUMN whodas_assessments.completion_source IS
  'electronic = completed through the in-portal overlay and scored. uploaded = completed outside Opal and attached as a document; carries no responses and no score.';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_whodas_completion_source') THEN
    ALTER TABLE whodas_assessments ADD CONSTRAINT valid_whodas_completion_source CHECK (
      completion_source IN ('electronic', 'uploaded'));
  END IF;
END $$;

-- An uploaded assessment must not carry a score. Nothing computed it, and a
-- score that nobody calculated is worse than no score at all.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uploaded_whodas_has_no_score') THEN
    ALTER TABLE whodas_assessments ADD CONSTRAINT uploaded_whodas_has_no_score CHECK (
      completion_source <> 'uploaded'
      OR (scores = '{}'::jsonb AND responses = '{}'::jsonb));
  END IF;
END $$;

-- The document side records the same distinction, so a file can be told apart
-- from a generated one without joining back to the assessment.
ALTER TABLE whodas_generated_documents
  ADD COLUMN IF NOT EXISTS document_source VARCHAR(20) NOT NULL DEFAULT 'generated';

COMMENT ON COLUMN whodas_generated_documents.document_source IS
  'generated = rendered by Opal from the immutable WHO template plus stored responses. uploaded = a file supplied by a clinician, rendered by nobody here.';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_whodas_document_source') THEN
    ALTER TABLE whodas_generated_documents ADD CONSTRAINT valid_whodas_document_source CHECK (
      document_source IN ('generated', 'uploaded'));
  END IF;
END $$;

-- An uploaded document was not rendered from a template, so the template
-- provenance columns describe the BLANK form it was completed on, and the
-- rendered-page count is meaningless. Relax NOT NULL on page_count only.
ALTER TABLE whodas_generated_documents ALTER COLUMN page_count DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_whodas_assessments_completion_source
  ON whodas_assessments (organisation_id, client_id, completion_source);
